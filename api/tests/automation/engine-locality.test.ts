import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { runAutomation, type RunContext } from '../../src/automation/engine.js';
import {
  setDaemonConnectionResolver,
  setScopedMemoryResolver,
  setIntegrationActionDeclarationResolver,
  setIntegrationActionExecutor,
  setLocalBrowserContextProvider,
  setEgressCandidateResolver,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import { automations, automationRuns } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import type { EgressResolution } from '../../src/automation/egress-policy.js';
import type { Automation, Step } from '../../src/automation/types.js';

/**
 * LOCALITY, THROUGH THE REAL ENGINE (P4.1).
 *
 * THE DIVERGENCE THIS CLOSES. `localBrowserEnabled` defaulted to `!isProd`, so outside production
 * EVERY browser step silently ran in the hosted Chromium — including steps against portals that
 * score datacenter IPs. Production only looked correct because the flag happened to be off there.
 * The gate is now the ORIGIN POSTURE, in every environment, and these cases run with the fallback
 * switch ON (its default) precisely so that a green result cannot be an artefact of the old flag.
 *
 * WHAT IS REAL HERE: the engine, the persistence, `resolveStepOrigin`, `classifyOrigin`,
 * `resolveLocality`, `resolveEgress`, and the browser-context seam the composition root binds. What
 * is faked is only what sits OUTSIDE the decision — the daemon connection, the action declaration
 * lookup, the fleet listing, and the Chromium context itself (which records what it was asked for
 * and then refuses, so no real browser is launched).
 *
 * The load-bearing assertion in every case is `contextRequests`: whether the hosted browser was
 * reached AT ALL, and with what route out. A run's final status alone would not distinguish "ran
 * hosted and then failed" from "never ran hosted", which is exactly the distinction under test.
 */

const ctx: RunContext = {
  ownerUserId: 'u1',
  orgId: 'org_a',
  triggeredBy: 'user',
  visitedAutomationIds: new Set(),
  traceId: 't1',
};

/** Every request the engine made for a hosted browser context, with the route it asked for. */
let contextRequests: Array<{ ownerUserId: string; egress?: EgressResolution }> = [];

/** A `wait` step has no URL of its own, so its origin is inherited from what preceded it — which
 *  is what makes it the cheapest browser-needing step to drive a locality decision with. */
const waitStep: Step = { id: 's_wait', description: 'let the page settle', type: 'wait', durationMs: 10 } as Step;

/** An integration step whose action declaration is where the posture is declared. */
const integrationStep: Step = {
  id: 's_int',
  description: 'open the portal',
  type: 'integration',
  integrationKey: 'portal',
  integrationAction: 'fetch',
} as Step;

async function seed(id: string, steps: Step[]): Promise<Automation> {
  const automation: Automation = {
    id, name: 'Locality', description: '', ownerUserId: 'u1', steps, createdAt: '', updatedAt: '',
  };
  await automations.insert({ _id: id, ...automation } as never);
  return automation;
}

describe('engine locality', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_locality'));
  afterAll(shutdownAgentTestDb);

  beforeEach(async () => {
    resetAgentState();
    __resetAutomationSeamsForTests();
    // The env kill switch stays at its DEFAULT (on). Posture is what must refuse.
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    contextRequests = [];
    setDaemonConnectionResolver(() => null); // no machine connected
    setScopedMemoryResolver(async () => []);
    setIntegrationActionExecutor(async () => ({ success: true, data: { ok: true } }));
    setLocalBrowserContextProvider(async (ownerUserId, egress) => {
      contextRequests.push({ ownerUserId, ...(egress ? { egress } : {}) });
      throw new Error('no real Chromium in this suite');
    });
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
  });

  it('an UNDECLARED origin never reaches the hosted browser, and halts instead — with the fallback ON', async () => {
    await seed('a_undeclared', [waitStep]);
    const result = await runAutomation('a_undeclared', ctx);

    expect(contextRequests).toEqual([]); // the whole point: nothing was launched
    expect(result.status).toBe('awaiting_daemon');
    const run = await automationRuns.get(result.runId);
    expect((run as { status?: string }).status).toBe('awaiting_daemon');
  });

  it('the halt says WHY — an origin posture, not a missing dev flag', async () => {
    await seed('a_reason', [waitStep]);
    const result = await runAutomation('a_reason', ctx);
    const run = (await automationRuns.get(result.runId)) as unknown as { steps: Array<{ error?: { message?: string } }> };
    expect(run.steps[0]?.error?.message).toMatch(/adversarial/);
  });

  it('an ADVERSARIAL declaration is refused exactly as an absent one is', async () => {
    setIntegrationActionDeclarationResolver(async () => ({
      posture: 'adversarial',
      httpConfig: { baseUrl: 'https://portal.example.com' },
    }));
    await seed('a_adv', [integrationStep, waitStep]);
    const result = await runAutomation('a_adv', ctx);
    expect(contextRequests).toEqual([]);
    expect(result.status).toBe('awaiting_daemon');
  });

  it('a PERMISSIVE origin DOES reach the hosted browser, by the datacenter route', async () => {
    setIntegrationActionDeclarationResolver(async () => ({
      posture: 'permissive',
      httpConfig: { baseUrl: 'https://portal.example.com' },
    }));
    await seed('a_perm', [integrationStep, waitStep]);
    const result = await runAutomation('a_perm', ctx);

    expect(contextRequests).toHaveLength(1);
    expect(contextRequests[0]!.egress).toEqual({ outcome: 'datacenter', reason: 'no-requirement' });
    // It failed for its own reason (there is no Chromium here), which is NOT the locality halt.
    expect(result.status).not.toBe('awaiting_daemon');
  });

  it('a permissive step declaring residential egress is launched THROUGH the machine proxy', async () => {
    setIntegrationActionDeclarationResolver(async () => ({
      posture: 'permissive',
      httpConfig: { baseUrl: 'https://portal.example.com' },
    }));
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: 'pair_home', org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.7:1080', live: true },
    ]);
    await seed('a_resi', [
      integrationStep,
      { ...waitStep, declaration: { target: { kind: 'any', capability: 'egress.residential' } } } as Step,
    ]);
    await runAutomation('a_resi', ctx);

    expect(contextRequests).toHaveLength(1);
    expect(contextRequests[0]!.egress).toEqual({
      outcome: 'machine',
      pairingId: 'pair_home',
      proxyUrl: 'http://100.64.0.7:1080',
    });
  });

  it('...and halts rather than falling back to the datacenter when that machine is gone', async () => {
    setIntegrationActionDeclarationResolver(async () => ({
      posture: 'permissive',
      httpConfig: { baseUrl: 'https://portal.example.com' },
    }));
    setEgressCandidateResolver(async () => []); // the fleet went dark
    await seed('a_resi_gone', [
      integrationStep,
      { ...waitStep, declaration: { target: { kind: 'any', capability: 'egress.residential' } } } as Step,
    ]);
    const result = await runAutomation('a_resi_gone', ctx);

    expect(contextRequests).toEqual([]);
    expect(result.status).toBe('awaiting_daemon');
  });

  it('a connected machine carries the undeclared origin — the bridge is the default, not a refusal', async () => {
    // Proves the refusals above are about LOCALITY and not about `wait` steps being unrunnable.
    setDaemonConnectionResolver(() => ({
      runStep: async () => ({ ok: true, observation: { screenshotB64: '', data: { url: 'https://portal.example.com/', title: 'P', domShapeSketch: 'tags:|roles:|landmarks:0', viewport: { w: 1280, h: 800 } } } }),
    }));
    await seed('a_bridge', [waitStep]);
    const result = await runAutomation('a_bridge', ctx);
    expect(contextRequests).toEqual([]);
    expect(result.status).toBe('completed');
  });

  it('a run with no browser-needing step is untouched by locality', async () => {
    setIntegrationActionDeclarationResolver(async () => null);
    await seed('a_nobrowser', [integrationStep]);
    const result = await runAutomation('a_nobrowser', ctx);
    // The integration step ran and the run completed: an adversarial (undeclared) origin does not
    // halt a step that never wanted a browser.
    expect(result.status).toBe('completed');
    expect(contextRequests).toEqual([]);
  });
});
