import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, integrationActionFeedback, integrationConfigs, integrationDefinitions } from '../../src/data/stores.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  integrationFeedbackSections,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import { actionFeedbackStore } from '../../src/integrations/action-feedback-store.js';
// SEAM 1's binding lives behind this: `loadContextContent` is the `load_context` tool
// implementation `buildApp` wires, and the only way to observe server.ts's third-section join.
import { loadContextContent, __resetAgentSeamsForTests } from '../../src/agents/seams.js';
import { createConfig } from '../../src/integrations/service.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';

/**
 * THE COMPOSITION ROOT'S S3 BINDINGS, under test - BOTH of them.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
 *
 * S3 wires a person's notes into three model seams, and TWO of them are bound in `server.ts`:
 * the `load_context` join (seam 1) and the automation resolver (seam 2). Seam 3 is not a binding
 * at all - `integration-achieve.ts` calls `feedbackForPrompt` directly, so its production path IS
 * the module and `tests/integrations/action-feedback-seams.test.ts` drives the real
 * `achieveIntegrationGoal` through a recording drafter (mutant M12). There is nothing in
 * `server.ts` for seam 3 to lose, which is why it has no case here.
 *
 * The first revision of this file covered seam 2 ONLY, and the review found the hole: seam 1's
 * binding could be deleted with the entire estate green - typecheck included, because
 * `composeIntegrationContext`'s third parameter defaults - so every note would silently stop
 * reaching build and chat agents through `load_context` while every lane stayed green. That is the
 * same defect class this file was written to close, missed in the file written to close it.
 *
 * SEAM 2. `server.ts` has exactly ONE block pointing the automation planner and the rehearsal fixer
 * at a person's own notes:
 *
 *     setIntegrationFeedbackResolver(async (ownerUserId) => { … resolve the org … })
 *
 * DELETE IT and everything stays green. `automation/seams.ts` answers `[]` by design when unbound -
 * that is the honest default the tier rule requires - so the planner still plans, the fixer still
 * repairs, `api/tests/automation/feedback-prompt-seams.test.ts` still passes (it binds the seam
 * ITSELF, which pins the CONSUMPTION and not the BINDING), and
 * `api/tests/security/action-feedback-isolation.test.ts` still passes (it calls the module
 * directly). Seam 2 would simply do nothing in production, silently, forever.
 *
 * That is the exact failure this repo has already paid for twice - `composition-root-action-seam.ts`
 * was written after the P2 spine went dead in production under a green lane, and
 * docs/findings.md's "the estate verification could not fail" entry is the same shape. So this boots
 * the REAL `buildApp` after resetting the seams and asserts what is actually bound, by OBSERVABLE
 * CONSEQUENCE: a note written through the real store comes back through the real seam, for the
 * right person and for nobody else.
 *
 * ── THE ORG RESOLUTION IS THE SECOND SUBJECT, AND IT IS THE SECURITY-RELEVANT HALF ───────────
 *
 * The seam takes a USER ID and nothing else, precisely so the automation tier cannot pass a tenant
 * it might have wrong. That makes the composition root the ONE place the org is resolved, from the
 * users store - and the one place that could resolve it wrongly. Two cases below drive it: a user
 * whose row names another org must not see the first org's notes, and a user with no row at all
 * must resolve to nothing rather than to everything.
 *
 * ── SEAM 1: THE SAME SHAPE, THROUGH A DIFFERENT DOOR ─────────────────────────────────────────
 *
 * `server.ts`'s `setLoadContextContent` handler resolves three halves and joins them
 * (`composeIntegrationContext(skillMd, lessons, feedback)`). Drop the `feedback` argument and the
 * call still compiles, still lints, and still passes every module-level suite - the isolation
 * suite's "SEAM 1" case calls `feedbackForPrompt` and `composeIntegrationContext` ITSELF, which
 * pins the modules and not the wiring. So the last describe drives the REAL `loadContextContent`
 * that `buildApp` installs, which is the precedent `contract/integrations-lessons.test.ts` set for
 * C3 and which this slice should have followed.
 */
let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = {
  port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test',
  llmChokepointBaseUrl: 'http://127.0.0.1:0/api/v1/llm', llm: defaultLlmConfig(),
};

const KEY = 's3-root-probe';
const ACTION = 'consultar_processo';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s3_root_seam');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  __resetAutomationSeamsForTests();
  __resetConfigForTests();
});

beforeEach(async () => {
  await users.deleteMany({});
  await integrationActionFeedback.deleteMany({});
  await integrationConfigs.deleteMany({});
  await integrationDefinitions.deleteMany({});
  // RESET FIRST, THEN BOOT. Without the reset a seam bound by an earlier suite in the same process
  // would answer, and this file would pass without `buildApp` having bound anything at all.
  //
  // THE GUARD THAT USED TO SIT HERE COULD NOT FIRE, and the review was right about it. It asserted
  // `integrationFeedbackSections('u-owner')` answers `[]` AFTER the collections were emptied - but
  // the PRODUCTION resolver answers `[]` for an unknown user too (it reads the users store and
  // returns early with no org), so it passed bound or unbound and distinguished nothing. It is
  // replaced by `seamsAreUnbound()` below, which plants a user AND a note first and only then
  // asserts the read is empty: with real data in place, only a genuinely unbound seam can answer
  // `[]`. Then the fixture is removed so each case starts from nothing.
  __resetAutomationSeamsForTests();
  __resetAgentSeamsForTests();
  await seamsAreUnbound();
  buildApp(cfg, deps);
});

/**
 * Prove the seams really are unbound, in a way that CAN fail.
 *
 * Plants the exact fixture a bound seam would answer from, asserts both seams answer empty, and
 * then clears it. A stale binding left by another suite in this process returns the note here and
 * reddens; the previous revision's guard ran against emptied collections, where a bound resolver
 * and an unbound one are indistinguishable.
 */
async function seamsAreUnbound(): Promise<void> {
  await seedUser('u-probe', 'orgProbe');
  await seedNote('orgProbe', 'u-probe', 'a nota que uma ligacao presa devolveria');
  expect(await integrationFeedbackSections('u-probe'), 'seam 2 must start UNBOUND').toEqual([]);
  expect(
    await loadContextContent({ userId: 'u-probe', agentKind: 'chat', name: `integration-${KEY}` }),
    'seam 1 must start UNBOUND',
  ).toBeNull();
  await users.deleteMany({});
  await integrationActionFeedback.deleteMany({});
}

async function seedUser(id: string, orgId: string): Promise<void> {
  await users.insert({ _id: id, username: id, role: 'user', orgId, active: true } as never);
}

async function seedNote(orgId: string, userId: string, note: string): Promise<void> {
  await actionFeedbackStore.putFeedback({ orgId, userId, integrationKey: KEY, actionName: ACTION }, note);
}

describe('buildApp binds the integration-feedback seam the planner and the fixer read', () => {
  it('THE CONTROL: a note written through the real store comes back through the real seam', async () => {
    await seedUser('u-owner', 'orgA');
    await seedNote('orgA', 'u-owner', 'o portal mostra um aviso de cookies na primeira visita');

    const sections = await integrationFeedbackSections('u-owner');
    expect(sections, 'the composition root did not bind the seam').toHaveLength(1);
    expect(sections[0]).toContain('aviso de cookies na primeira visita');
  });

  it('the ORG comes off the USERS STORE, so a member of another tenant reads their own and not this one', async () => {
    await seedUser('u-owner', 'orgA');
    await seedUser('u-foreign', 'orgB');
    await seedNote('orgA', 'u-owner', 'a nota do inquilino A');
    await seedNote('orgB', 'u-foreign', 'a nota do inquilino B');

    expect((await integrationFeedbackSections('u-owner')).join('\n')).toContain('inquilino A');
    const foreign = (await integrationFeedbackSections('u-foreign')).join('\n');
    expect(foreign).toContain('inquilino B');
    expect(foreign, 'the root must not resolve one tenant\'s notes under another\'s id').not.toContain('inquilino A');
  });

  it('a user id with NO row resolves to nothing rather than to everything', async () => {
    await seedUser('u-owner', 'orgA');
    await seedNote('orgA', 'u-owner', 'a nota do dono');

    // An unresolvable owner is the case where a missing org term would become a wildcard filter.
    expect(await integrationFeedbackSections('u-nobody')).toEqual([]);
  });

  it('the seam refuses an empty owner id before it reaches the root at all', async () => {
    await seedUser('u-owner', 'orgA');
    await seedNote('orgA', 'u-owner', 'a nota do dono');
    expect(await integrationFeedbackSections('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// SEAM 1 - the `load_context` join, through the REAL tool implementation `buildApp` wires
// ---------------------------------------------------------------------------------------------

/** The definition the `load_context` integration fallback resolves the SKILL.md from. */
async function seedDefinition(orgId: string, userId: string): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId, visibility: 'private', key: KEY,
      displayName: 'S3 Root Probe', configSchema: [],
      actions: [{
        actionName: ACTION, description: 'consulta um processo', mutates: false,
        httpConfig: { method: 'GET' as const, baseUrl: 'https://portal.example', path: '/p' },
      }],
      skillMd: '# S3 Root Probe\n\nCORPO DE CONHECIMENTO.\n',
    },
    { actor: { userId, orgId, role: 'user' }, onConflict: 'replace' },
  );
}

/** The fallback resolves `integration-<key>` only for an ENABLED config of that owner. */
async function enableConfig(orgId: string, userId: string): Promise<void> {
  await createConfig(
    { userId, orgId, role: 'user' },
    { integrationKey: KEY, configValues: { api_key: 'placeholder' } },
    deps,
  );
}

describe('buildApp binds the load_context join that carries a person\'s notes to chat and build agents', () => {
  beforeEach(async () => {
    await seedUser('u-owner', 'orgA');
    await seedDefinition('orgA', 'u-owner');
    await enableConfig('orgA', 'u-owner');
  });

  it('THE CONTROL: a note written through the real store reaches the real load_context body', async () => {
    await seedNote('orgA', 'u-owner', 'o portal mostra um aviso de cookies na primeira visita');

    const context = await loadContextContent({ userId: 'u-owner', agentKind: 'chat', name: `integration-${KEY}` });
    expect(context, 'the integration context must resolve for an enabled config').toBeTruthy();
    // The knowledge body is still there: S3 ADDS a section, it does not replace one.
    expect(context).toContain('CORPO DE CONHECIMENTO.');
    // …and the third section arrived. THIS is the assertion the module-level "SEAM 1" case cannot
    // make: it calls feedbackForPrompt and composeIntegrationContext itself, so it would stay green
    // with server.ts's join deleted.
    expect(context).toContain('aviso de cookies na primeira visita');
    expect(context).toContain('Notes you recorded about these actions');
  });

  it('the credential in a note does NOT reach the load_context body, but its prose does', async () => {
    const secret = 'sk_' + 'live_' + 'LOADCTXaaaa1111bbbb2222cccc';
    await seedNote('orgA', 'u-owner', `usa este acesso. api_key: ${secret}`);

    const context = await loadContextContent({ userId: 'u-owner', agentKind: 'chat', name: `integration-${KEY}` });
    expect(context, 'THE CONTROL: the prose still arrives').toContain('usa este acesso');
    expect(context).not.toContain(secret);
    expect(context).toContain('[REDACTED]');
  });

  it('a colleague reading the SAME integration gets their own notes and not the owner\'s', async () => {
    await seedUser('u-peer', 'orgA');
    await enableConfig('orgA', 'u-peer');
    await seedNote('orgA', 'u-owner', 'A-NOTA-DO-DONO');
    await seedNote('orgA', 'u-peer', 'A-NOTA-DO-COLEGA');

    const asPeer = await loadContextContent({ userId: 'u-peer', agentKind: 'chat', name: `integration-${KEY}` });
    expect(asPeer).toContain('A-NOTA-DO-COLEGA');
    // The join passes the CALLER's actor, so one member's free text never lands in another's turn.
    expect(asPeer).not.toContain('A-NOTA-DO-DONO');
  });

  it('an integration with NO notes yields exactly the body it did before this slice', async () => {
    const context = await loadContextContent({ userId: 'u-owner', agentKind: 'chat', name: `integration-${KEY}` });
    expect(context).toContain('CORPO DE CONHECIMENTO.');
    expect(context).not.toContain('Notes you recorded about these actions');
  });
});
