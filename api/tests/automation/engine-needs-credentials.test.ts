import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { runAutomation, type RunContext } from '../../src/automation/engine.js';
import {
  setDaemonConnectionResolver,
  setScopedMemoryResolver,
  setIntegrationActionDeclarationResolver,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import {
  __resetCredentialWaitersForTests,
  credentialWaiterCount,
} from '../../src/automation/credential-waiters.js';
import { automations, automationRuns } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import { RunCredentialRequest } from '@ekoa/shared';
import type { Automation, RunRecord } from '../../src/automation/types.js';

/**
 * THE `needs_credentials` HALT, through the REAL engine and REAL persistence (P3.1).
 *
 * Modelled on `engine-daemon.test.ts` because the state is modelled on `awaiting_daemon`: the run
 * HALTS and RETURNS rather than blocking a listener tick, and the proof that it did is the persisted
 * row — the human is about to leave this page.
 *
 * WHAT MAKES IT GENERAL rather than a Citius special case, and why two integrations are exercised:
 * the halt is driven by the step's own DECLARATION (`credentialRefs`) plus the origin derived from
 * the action's `httpConfig.baseUrl`. Nothing reads an integration key. So two different
 * integrations, declared identically, must produce byte-identical halts apart from their own origin
 * and key — which is what `it('treats two unrelated integrations identically')` asserts.
 */

const ctx: RunContext = {
  ownerUserId: 'u1',
  orgId: 'o1',
  triggeredBy: 'user',
  visitedAutomationIds: new Set(),
  traceId: 't1',
};

/** A browser step that DECLARES it consumes a Cofre credential, against a declared integration. */
function automationFor(id: string, integrationKey: string): Automation {
  return {
    id,
    name: `Fetch from ${integrationKey}`,
    description: '',
    ownerUserId: 'u1',
    steps: [
      {
        id: 's1',
        description: `open ${integrationKey}`,
        type: 'integration',
        integrationKey,
        integrationAction: 'fetch',
        declaration: { credentialRefs: ['cofre:itm_password_1'] },
      },
    ],
    createdAt: '',
    updatedAt: '',
  } as Automation;
}

/** An automation whose step declares NOTHING — the backward-compatibility case (trap T6). */
const undeclared: Automation = {
  id: 'auto-undeclared',
  name: 'Plain browser thing',
  description: '',
  ownerUserId: 'u1',
  steps: [{ id: 's1', description: 'click save', type: 'browser' }],
  createdAt: '',
  updatedAt: '',
};

const ORIGINS: Record<string, string> = {
  citius: 'https://citius.mj.pt/portal',
  acme: 'https://portal.acme.example/app',
};

describe('engine needs_credentials halt (P3.1)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_needs_credentials'));
  afterAll(shutdownAgentTestDb);

  beforeEach(async () => {
    resetAgentState();
    __resetAutomationSeamsForTests();
    __resetCredentialWaitersForTests();
    process.env.EKOA_AUTOMATION_LOCAL_BROWSER = 'false';
    __resetAutomationConfigForTests();
    setDaemonConnectionResolver(() => null);
    setScopedMemoryResolver(async () => []);
    // The action declaration seam: every integration answers the same SHAPE, differing only in the
    // base URL it declares. No posture and no authProfile => the closed classification.
    setIntegrationActionDeclarationResolver(async (key) =>
      ORIGINS[key] ? { httpConfig: { baseUrl: ORIGINS[key]! } } : null,
    );
    for (const a of [automationFor('auto-citius', 'citius'), automationFor('auto-acme', 'acme'), undeclared]) {
      await automations.insert({ _id: a.id, ...a } as never);
    }
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetCredentialWaitersForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
  });

  it('halts a declared step in needs_credentials and persists the request', async () => {
    const result = await runAutomation('auto-citius', ctx);

    expect(result.status).toBe('needs_credentials');
    expect(result.lastStepIndex).toBe(0);

    const run = (await automationRuns.get(result.runId)) as unknown as RunRecord;
    expect(run.status).toBe('needs_credentials');
    // The persisted payload must satisfy the PUBLISHED shape, not merely look like it: it is
    // handed to a client verbatim.
    const parsed = RunCredentialRequest.safeParse(run.credentialRequest);
    expect(parsed.success).toBe(true);
    expect(run.credentialRequest).toMatchObject({
      stepIndex: 0,
      origin: 'citius.mj.pt',
      integrationKey: 'citius',
      portalDeepLink: '/cofre?origin=citius.mj.pt',
    });
  });

  it('NOTHING in the persisted halt is a credential', async () => {
    const result = await runAutomation('auto-citius', ctx);
    const run = (await automationRuns.get(result.runId)) as unknown as RunRecord;
    const serialised = JSON.stringify(run);
    // An origin and a deep link, and no field that could hold a value. Asserted over the WHOLE run
    // record rather than the request, because the halt also writes a step record and an error
    // message, and both are streamed.
    for (const forbidden of ['password', 'storageState', 'valueCiphertext', 'cofre:itm_password_1']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('registers a waiter for the origin, so a later mint can wake the run', async () => {
    expect(credentialWaiterCount()).toBe(0);
    await runAutomation('auto-citius', ctx);
    expect(credentialWaiterCount()).toBe(1);
  });

  it('emits the needs_credentials event with the same payload it persisted', async () => {
    const runNeedsCredentials = vi.fn();
    const emit = {
      stepUpdate: () => {},
      runComplete: () => {},
      runError: () => {},
      runPaused: () => {},
      runNeedsCredentials,
    } as never;

    const result = await runAutomation('auto-citius', ctx, { emit });
    expect(runNeedsCredentials).toHaveBeenCalledTimes(1);
    const [, payload] = runNeedsCredentials.mock.calls[0]!;
    const run = (await automationRuns.get(result.runId)) as unknown as RunRecord;
    expect(payload).toEqual(run.credentialRequest);
  });

  it('treats two unrelated integrations identically (Rule 3: no consumer special-casing)', async () => {
    const citius = await runAutomation('auto-citius', ctx);
    const acme = await runAutomation('auto-acme', ctx);

    expect(citius.status).toBe('needs_credentials');
    expect(acme.status).toBe('needs_credentials');

    const a = (await automationRuns.get(citius.runId)) as unknown as RunRecord;
    const b = (await automationRuns.get(acme.runId)) as unknown as RunRecord;

    // Identical apart from the two facts that are genuinely about the integration. If a branch on
    // the key ever creeps back in, the modes or the shapes diverge here.
    expect(a.credentialRequest?.mode).toBe(b.credentialRequest?.mode);
    expect(Object.keys(a.credentialRequest ?? {}).sort()).toEqual(Object.keys(b.credentialRequest ?? {}).sort());
    expect(b.credentialRequest?.origin).toBe('portal.acme.example');
    expect(b.credentialRequest?.portalDeepLink).toBe('/cofre?origin=portal.acme.example');
  });

  it('a step that declares NO credential is not gated at all (backward compat, trap T6)', async () => {
    // The pre-existing behaviour, unchanged: no daemon and no in-process fallback => awaiting_daemon.
    const result = await runAutomation('auto-undeclared', ctx);
    expect(result.status).toBe('awaiting_daemon');
    expect(credentialWaiterCount()).toBe(0);
  });

  it('a run persisted before this state existed still loads and reads back', async () => {
    // Trap T6 from the other end: an old row has no `credentialRequest` and a status this build
    // still knows. Nothing in the read path may assume the new field.
    await automationRuns.insert({
      _id: 'run_legacy',
      id: 'run_legacy',
      automationId: 'auto-citius',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'completed',
      inputs: {},
      steps: [],
      triggeredBy: 'user',
      ownerUserId: 'u1',
      orgId: 'o1',
    } as never);
    const legacy = (await automationRuns.get('run_legacy')) as unknown as RunRecord;
    expect(legacy.status).toBe('completed');
    expect(legacy.credentialRequest).toBeUndefined();
  });
});
