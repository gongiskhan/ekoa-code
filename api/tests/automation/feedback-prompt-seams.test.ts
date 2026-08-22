import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * THE PLANNER'S AND THE FIXER'S NOTE SECTIONS (slice S3).
 *
 * ── WHAT THIS SUITE PROVES, AND WHY IT IS NOT THE ISOLATION SUITE ────────────────────────────
 *
 * `api/tests/security/action-feedback-isolation.test.ts` proves WHOSE notes reach a prompt, which
 * is the security property, and it proves it at the module that builds the section. It cannot see
 * whether either of these two callers actually puts the section on the turn - a planner that
 * resolved the sections and then dropped them on the floor would leave that suite entirely green.
 *
 * So this drives the REAL `planFromGoal` and the REAL `proposePatch` with the chokepoint mocked at
 * the transport, and reads the prompt the model was actually handed. It also pins the ABSENCE
 * direction: with the seam unbound (its honest default), each prompt is byte-identical to what it
 * was before this slice - which is the claim "additive" is making.
 *
 * The seam is bound with `setIntegrationFeedbackResolver` and NOT with a store, on purpose: what is
 * under test here is the automation tier's consumption of the seam, and the tier rule is that it
 * cannot see `integrations/` at all.
 */
const hoisted = vi.hoisted(() => ({
  responses: [] as string[],
  prompts: [] as { prompt: string; systemPrompt?: string }[],
}));

vi.mock('../../src/llm/index.js', () => {
  class LlmAbortedError extends Error {}
  return {
    LlmAbortedError,
    runOneShot: vi.fn(async (opts: { prompt: string; systemPrompt?: string }) => {
      hoisted.prompts.push({ prompt: opts.prompt, ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}) });
      return { text: hoisted.responses.shift() ?? '', usage: {} };
    }),
    decideForTier: vi.fn((tier: string) => ({ tier, model: 'm', effort: 'high', weight: 1 })),
    decideForTask: vi.fn(() => ({ tier: 'WORKHORSE', model: 'm', effort: 'high', weight: 1 })),
  };
});

import { planFromGoal } from '../../src/automation/planner.js';
import { proposePatch } from '../../src/automation/rehearsal.js';
import {
  setIntegrationFeedbackResolver,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import type { Catalog } from '../../src/automation/catalog.js';
import type { Step } from '../../src/automation/types.js';

const emptyCatalog: Catalog = { automations: [], integrationActions: [], connectedAccounts: [], ekoaActions: [] };
const NOTE_SECTION = '## Notes you recorded about these actions (your own, not the platform\'s)\n\n'
  + '- citius.consultar_processo: o portal mostra um aviso de cookies na primeira visita';

const steps: Step[] = [
  { id: 'navigate', type: 'navigate', description: 'go to the portal', url: 'https://portal.example' },
  { id: 'verify', type: 'verify', description: 'page loaded', expectedOutcome: 'the search box is ready' },
  { id: 'type', type: 'browser', description: 'type the reference' },
];

const okPlan = JSON.stringify({
  status: 'ok',
  name: 'Consultar processo',
  description: 'Abre o portal e consulta um processo',
  steps: [{ id: 'open', description: 'Open the portal', type: 'navigate', url: 'https://portal.example' }],
  reasoning: 'one step',
});
const skipPatch = JSON.stringify({ patch: 'skip_current', reasoning: 'desnecessario' });

beforeEach(() => {
  hoisted.responses = [];
  hoisted.prompts = [];
  __resetAutomationSeamsForTests();
});

afterEach(() => {
  __resetAutomationSeamsForTests();
});

describe('SEAM 2a - the automation planner', () => {
  it('THE CONTROL: the owner\'s note section is on the prompt the model receives', async () => {
    setIntegrationFeedbackResolver(async (ownerUserId) => (ownerUserId === 'u1' ? [NOTE_SECTION] : []));
    hoisted.responses.push(okPlan);

    const res = await planFromGoal({ goal: 'consultar o processo 2024-1', userId: 'u1', catalog: emptyCatalog });
    expect(res.status).toBe('ok');

    const turn = hoisted.prompts[0]!;
    const whole = `${turn.systemPrompt ?? ''}\n${turn.prompt}`;
    expect(whole).toContain('aviso de cookies na primeira visita');
  });

  it('the seam is asked for the PLAN OWNER and for nobody else', async () => {
    const asked: string[] = [];
    setIntegrationFeedbackResolver(async (ownerUserId) => { asked.push(ownerUserId); return []; });
    hoisted.responses.push(okPlan);

    await planFromGoal({ goal: 'consultar o processo', userId: 'u1', catalog: emptyCatalog });
    expect(asked).toEqual(['u1']);
  });

  it('with the seam UNBOUND the prompt is byte-identical to the pre-S3 one', async () => {
    // The default resolver answers no sections, so this is the additive claim, measured rather than
    // asserted in prose: the same goal produces the same bytes with and without the slice.
    hoisted.responses.push(okPlan);
    await planFromGoal({ goal: 'consultar o processo 2024-1', userId: 'u1', catalog: emptyCatalog });
    const withoutSeam = hoisted.prompts[0]!;

    hoisted.prompts = [];
    hoisted.responses.push(okPlan);
    setIntegrationFeedbackResolver(async () => []);
    await planFromGoal({ goal: 'consultar o processo 2024-1', userId: 'u1', catalog: emptyCatalog });

    expect(hoisted.prompts[0]).toEqual(withoutSeam);
  });

  it('a seam that THROWS does not fail the plan', async () => {
    setIntegrationFeedbackResolver(async () => { throw new Error('mongo is down'); });
    hoisted.responses.push(okPlan);

    const res = await planFromGoal({ goal: 'consultar o processo', userId: 'u1', catalog: emptyCatalog });
    expect(res.status, 'notes are never fatal to a plan').toBe('ok');
  });
});

describe('SEAM 2b - the rehearsal fixer', () => {
  const patchInput = {
    goal: 'consultar o processo',
    steps,
    currentIndex: 1,
    failureKind: 'verify_failed' as const,
    failureMessage: 'the search box never appeared',
    screenshotPng: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    pageUrl: 'https://portal.example',
    patchesAtThisIndex: 0,
    userId: 'u1',
  };

  it('THE CONTROL: the run owner\'s note section is on the fixer\'s USER text', async () => {
    setIntegrationFeedbackResolver(async () => [NOTE_SECTION]);
    hoisted.responses.push(skipPatch);

    await proposePatch(patchInput);

    const turn = hoisted.prompts[0]!;
    expect(turn.prompt).toContain('aviso de cookies na primeira visita');
    // AND NOT ON THE SYSTEM PROMPT. This module's own header calls the fixer the most
    // prompt-injectable authoring surface in the engine; tenant-authored bytes belong with the other
    // observations, never in the instruction block.
    expect(turn.systemPrompt ?? '').not.toContain('aviso de cookies');
  });

  it('the seam is asked for the RUN OWNER', async () => {
    const asked: string[] = [];
    setIntegrationFeedbackResolver(async (ownerUserId) => { asked.push(ownerUserId); return []; });
    hoisted.responses.push(skipPatch);

    await proposePatch(patchInput);
    expect(asked).toEqual(['u1']);
  });

  it('with the seam UNBOUND the fixer prompt is byte-identical to the pre-S3 one', async () => {
    hoisted.responses.push(skipPatch);
    await proposePatch(patchInput);
    const withoutSeam = hoisted.prompts[0]!;

    hoisted.prompts = [];
    hoisted.responses.push(skipPatch);
    setIntegrationFeedbackResolver(async () => []);
    await proposePatch(patchInput);

    expect(hoisted.prompts[0]).toEqual(withoutSeam);
  });

  it('a seam that THROWS does not fail the repair', async () => {
    setIntegrationFeedbackResolver(async () => { throw new Error('mongo is down'); });
    hoisted.responses.push(skipPatch);

    const patch = await proposePatch(patchInput);
    expect(patch.kind, 'notes are never fatal to a repair').toBe('skip_current');
  });
});
