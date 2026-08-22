import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  activityLogs,
  billingAccounts,
  integrationConfigs,
  integrationDefinitions,
  integrationActionFeedback,
} from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { actionFeedbackStore } from '../../src/integrations/action-feedback-store.js';
import {
  feedbackPromptSection,
  FEEDBACK_PROMPT_HEADING,
  FEEDBACK_PROMPT_MAX_CHARS,
} from '../../src/integrations/action-feedback.js';
import { composeIntegrationContext, LESSONS_PROMPT_HEADING } from '../../src/integrations/definition-lessons.js';
import {
  achieveIntegrationGoal,
  type AchieveContext,
  type ActionDrafter,
} from '../../src/integrations/integration-achieve.js';
import type { ActionFeedbackDoc } from '../../src/integrations/action-feedback-store.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';

/**
 * THE PROMPT SECTION, AND THE `achieve` SEAM THAT CARRIES IT (slice S3).
 *
 * ── WHAT THIS SUITE IS FOR ───────────────────────────────────────────────────────────────────
 *
 * `action-feedback-isolation.test.ts` proves WHOSE notes each seam reads, which is the security
 * property. This suite proves the two things that are not about identity:
 *
 *   1. the SHAPE of the section - the caps, the ordering, the whole-notes rule and the declared
 *      omission - driven directly against the pure function, so the budget arithmetic is pinned
 *      without standing anything up;
 *   2. that the section REACHES `achieve`'s drafting turn. The isolation suite asserts the module
 *      call is owner-scoped; only driving the real `achieveIntegrationGoal` through a recording
 *      drafter proves the result is actually handed to the model.
 *
 * The planner's and the fixer's halves of (2) live in
 * `api/tests/automation/feedback-prompt-seams.test.ts`, because they need the chokepoint mocked at
 * file scope and this suite must not be.
 */
let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const fixedNow = () => 1_700_000_000_000;

const KEY = 's3-seam-probe';
const HOST = 'https://portal.example';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s3_feedback_seams');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  __resetConfigForTests();
});

beforeEach(async () => {
  for (const s of [integrationDefinitions, integrationConfigs, activityLogs, billingAccounts, integrationActionFeedback]) {
    await s.deleteMany({});
  }
});

/** A stored row, built directly - this half of the suite is about the FORMATTER, not the store. */
function row(over: Partial<ActionFeedbackDoc> & { note: string; updatedAt: string }): ActionFeedbackDoc {
  return {
    _id: `id-${over.note.slice(0, 8)}-${over.updatedAt}`,
    orgId: 'orgA',
    userId: 'userA1',
    integrationKey: KEY,
    actionName: 'consultar_processo',
    createdAt: over.updatedAt,
    ...over,
  } as ActionFeedbackDoc;
}

// ---------------------------------------------------------------------------------------------
// 1. The section itself
// ---------------------------------------------------------------------------------------------

describe('feedbackPromptSection - the one place a row becomes prompt text', () => {
  it('names the integration, the action and the step, under a heading that says whose words these are', () => {
    const section = feedbackPromptSection([
      row({ note: 'sobre a acao', updatedAt: '2026-08-22T10:00:00.000Z' }),
      row({ note: 'sobre o passo', stepRef: 'abrir-portal', updatedAt: '2026-08-22T09:00:00.000Z' }),
    ]);
    expect(section).toContain(FEEDBACK_PROMPT_HEADING);
    expect(section).toContain(`- ${KEY}.consultar_processo: sobre a acao`);
    expect(section).toContain(`- ${KEY}.consultar_processo / step abrir-portal: sobre o passo`);
  });

  it('answers NULL for no rows - an empty heading spends tokens and announces a channel', () => {
    expect(feedbackPromptSection([])).toBeNull();
  });

  it('carries WHOLE notes only, and DECLARES what it left out', () => {
    // One note that alone exceeds the budget, followed by two that fit. The oversized one must be
    // skipped and counted, and - the reason the loop does not `break` - the short ones after it must
    // still be carried.
    const section = feedbackPromptSection([
      row({ note: 'x'.repeat(FEEDBACK_PROMPT_MAX_CHARS + 1), updatedAt: '2026-08-22T12:00:00.000Z' }),
      row({ note: 'nota curta A', updatedAt: '2026-08-22T11:00:00.000Z' }),
      row({ note: 'nota curta B', updatedAt: '2026-08-22T10:00:00.000Z' }),
    ]);
    expect(section).toContain('nota curta A');
    expect(section).toContain('nota curta B');
    expect(section).not.toContain('xxxxxxxxxx');
    expect(section, 'the omission is declared, never silent').toContain('(1 further note(s) omitted for length)');
  });

  it('never exceeds the character budget, however many notes there are', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      row({ note: 'n'.repeat(300), updatedAt: `2026-08-22T${String(i).padStart(2, '0')}:00:00.000Z` }));
    const section = feedbackPromptSection(many) ?? '';
    // The bullets are what the budget governs; the heading and the omission line sit outside it.
    const bullets = section.split('\n').filter((l) => l.startsWith(`- ${KEY}`));
    expect(bullets.join('\n').length).toBeLessThanOrEqual(FEEDBACK_PROMPT_MAX_CHARS);
    expect(section).toContain('omitted for length');
  });

  it('preserves the order it is handed, so a newest-first caller gets a newest-first section', () => {
    const section = feedbackPromptSection([
      row({ note: 'a mais recente', updatedAt: '2026-08-22T12:00:00.000Z' }),
      row({ note: 'a mais antiga', updatedAt: '2026-08-20T12:00:00.000Z' }),
    ]) ?? '';
    expect(section.indexOf('a mais recente')).toBeLessThan(section.indexOf('a mais antiga'));
  });
});

// ---------------------------------------------------------------------------------------------
// 2. `composeIntegrationContext` - the load_context join, additively
// ---------------------------------------------------------------------------------------------

describe('composeIntegrationContext carries three halves and stays additive', () => {
  it('an omitted feedback argument composes BYTE-IDENTICALLY to before this slice', () => {
    // Rule 7: the third parameter defaults, so every pre-S3 call site keeps its exact output.
    expect(composeIntegrationContext('# Portal\n\nDocs.', 'A licao.'))
      .toBe(`# Portal\n\nDocs.\n\n${LESSONS_PROMPT_HEADING}\n\nA licao.\n`);
    expect(composeIntegrationContext('# Portal\n\nDocs.', null)).toBe('# Portal\n\nDocs.');
    expect(composeIntegrationContext(null, null)).toBeNull();
  });

  it('the three sections appear widest-provenance first, each under its own heading', () => {
    const notes = feedbackPromptSection([row({ note: 'a minha nota', updatedAt: '2026-08-22T10:00:00.000Z' })]);
    const composed = composeIntegrationContext('# Portal\n\nDocs.', 'A licao.', notes) ?? '';
    // The package, then the organisation, then the person: decreasing breadth AND decreasing review.
    expect(composed.indexOf('Docs.')).toBeLessThan(composed.indexOf(LESSONS_PROMPT_HEADING));
    expect(composed.indexOf(LESSONS_PROMPT_HEADING)).toBeLessThan(composed.indexOf(FEEDBACK_PROMPT_HEADING));
  });

  it('notes alone compose without inventing an empty lessons section', () => {
    const notes = feedbackPromptSection([row({ note: 'a minha nota', updatedAt: '2026-08-22T10:00:00.000Z' })]);
    const composed = composeIntegrationContext(null, null, notes) ?? '';
    expect(composed).toContain('a minha nota');
    expect(composed).not.toContain(LESSONS_PROMPT_HEADING);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. SEAM 3: the section really reaches `achieve`'s drafting turn
// ---------------------------------------------------------------------------------------------

const existingRead: IntegrationAction = {
  actionName: 'consultar_processo',
  description: 'Consulta um processo no sistema remoto',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/processos/{{numero}}' },
};

async function seed(userId = 'ownerA', orgId = 'orgA'): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId, visibility: 'private', key: KEY,
      displayName: 'S3 Seam Probe',
      configSchema: [{ key: 'api_key', label: 'API key', type: 'password', required: true, secret: true }],
      actions: [existingRead],
      skillMd: '# probe',
      authType: 'none',
    },
    { actor: { userId, orgId, role: 'user' }, onConflict: 'replace' },
  );
}

/** A drafter that RECORDS the sections it was handed and then refuses, so nothing is persisted. */
function recordingDrafter(): { drafter: ActionDrafter; sections: string[][] } {
  const sections: string[][] = [];
  const drafter: ActionDrafter = async (input) => {
    sections.push([...input.contentSections]);
    // An unparseable reply: the draft is refused, so this suite exercises the PROMPT and writes
    // nothing to the definition.
    return { status: 'authored', text: 'no block here', draft: null, violations: ['no block'], attempts: 1 };
  };
  return { drafter, sections };
}

function ctxWith(userId: string, orgId: string, drafter: ActionDrafter): AchieveContext {
  return {
    actor: { userId, orgId, role: 'user' },
    deps,
    username: userId,
    now: fixedNow,
    runAutomationBackedAction: async () => ({ success: true, data: {} }),
    draftAction: drafter,
  };
}

describe('achieve hands the AUTHOR\'S own notes to the drafting turn', () => {
  it('THE CONTROL: with a note, the section is on the content the drafter receives', async () => {
    await seed();
    await actionFeedbackStore.putFeedback(
      { orgId: 'orgA', userId: 'ownerA', integrationKey: KEY, actionName: 'consultar_processo' },
      'o numero do processo tem de levar zeros a esquerda',
    );
    const { drafter, sections } = recordingDrafter();

    await achieveIntegrationGoal(ctxWith('ownerA', 'orgA', drafter), KEY, 'arquivar um processo antigo');

    expect(sections, 'the drafting turn must have happened').toHaveLength(1);
    const blob = sections[0]!.join('\n\n');
    expect(blob).toContain(FEEDBACK_PROMPT_HEADING);
    expect(blob).toContain('zeros a esquerda');
    // The section is LAST: narrowest provenance closest to the turn, and never displacing the
    // output contract, which the core keeps after every content section.
    expect(sections[0]![sections[0]!.length - 1]).toContain(FEEDBACK_PROMPT_HEADING);
  });

  it('a caller with NO notes gets the prompt it got before this slice - no empty section', async () => {
    await seed();
    const { drafter, sections } = recordingDrafter();

    await achieveIntegrationGoal(ctxWith('ownerA', 'orgA', drafter), KEY, 'arquivar um processo antigo');

    expect(sections).toHaveLength(1);
    expect(sections[0]!.join('\n\n')).not.toContain(FEEDBACK_PROMPT_HEADING);
  });

  it('a credential pasted into a note in a credential-value position does NOT reach the turn', async () => {
    await seed();
    const secret = 'sk_' + 'live_' + 'ACHIEVEaaaa1111bbbb2222cccc';
    await actionFeedbackStore.putFeedback(
      { orgId: 'orgA', userId: 'ownerA', integrationKey: KEY, actionName: 'consultar_processo' },
      `usa este acesso. api_key: ${secret}`,
    );
    const { drafter, sections } = recordingDrafter();

    await achieveIntegrationGoal(ctxWith('ownerA', 'orgA', drafter), KEY, 'arquivar um processo antigo');

    const blob = sections[0]!.join('\n\n');
    expect(blob, 'THE CONTROL: the prose still arrives').toContain('usa este acesso');
    expect(blob).not.toContain(secret);
  });
});
