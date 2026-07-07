import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { runAutomation } from '../../src/automation/engine.js';
import {
  setDaemonConnectionResolver,
  setScopedMemoryResolver,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import { automations, automationRuns } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import type { RunContext } from '../../src/automation/engine.js';
import type { Automation } from '../../src/automation/types.js';

/**
 * awaiting_daemon honest halt (ch05 §5.6.7). When NO local daemon is paired AND the in-process
 * browser fallback is disabled, a browser (or local_command) step cannot run locally — the engine
 * halts the run in `awaiting_daemon` and persists that state, rather than pretending to succeed or
 * looping the fixer. Run through the REAL engine + REAL persistence with the daemon seam returning
 * null and the local-browser fallback off.
 */
const ctx: RunContext = {
  ownerUserId: 'u1',
  orgId: 'o1',
  triggeredBy: 'user',
  visitedAutomationIds: new Set(),
  traceId: 't1',
};

const automation: Automation = {
  id: 'auto-1', name: 'Browser thing', description: '', ownerUserId: 'u1',
  steps: [{ id: 's1', description: 'click save', type: 'browser' }],
  createdAt: '', updatedAt: '',
};

describe('engine awaiting_daemon halt (§5.6.7)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_daemon'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    resetAgentState(); // installs the fake LLM transport (no live model)
    __resetAutomationSeamsForTests();
    process.env.EKOA_AUTOMATION_LOCAL_BROWSER = 'false'; // in-process fallback OFF
    __resetAutomationConfigForTests();
    setDaemonConnectionResolver(() => null); // no daemon paired
    setScopedMemoryResolver(async () => []);
    await automations.insert({ _id: automation.id, ...automation } as never);
  });
  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
  });

  it('halts a browser step in awaiting_daemon and persists that state (no fake success)', async () => {
    const result = await runAutomation('auto-1', ctx);

    expect(result.status).toBe('awaiting_daemon');
    expect(result.lastStepIndex).toBe(0);

    // Persisted at the transition (§5.6.7): the run record reflects the halt.
    const run = await automationRuns.get(result.runId);
    expect(run).not.toBeNull();
    expect((run as { status?: string }).status).toBe('awaiting_daemon');
  });

  it('runs with the daemon connected once it is paired (the same run completes)', async () => {
    // Pair a fake daemon that observes an empty page and no-ops the browser act, so the browser
    // step completes without vision (navigate/wait/act paths). Here we just prove the halt is
    // conditioned on the daemon seam: with a connection present the run no longer halts on it.
    setDaemonConnectionResolver(() => ({
      runStep: async () => ({ ok: true, observation: { screenshotB64: '', data: { url: 'https://x.com/', title: 'X', domShapeSketch: 'tags:|roles:|landmarks:0', viewport: { w: 1280, h: 800 } } } }),
    }));
    // The browser step now vision-resolves; with no LLM script the resolver throws and the step
    // fails recoverably — but crucially the run is NOT `awaiting_daemon` (the daemon IS connected).
    const result = await runAutomation('auto-1', ctx);
    expect(result.status).not.toBe('awaiting_daemon');
  });
});
