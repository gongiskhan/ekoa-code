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
import { mintCofreItem, issueGrant } from '../../src/cofre/index.js';
import type { Actor } from '@ekoa/shared';
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

/**
 * A browser context that WORKS - just enough of one for a `wait` step to complete.
 *
 * The suite above proves refusals, and for those a context that records-then-throws is ideal. The
 * suite below proves what happens across TWO successful browser steps (the route switch), and that
 * needs the first one to actually finish. Nothing here simulates a browser: it is the smallest set
 * of methods `LocalBrowserSession` touches on the way through a `wait` - the action itself
 * (`waitForTimeout`) and the post-action observation (screenshot, fingerprint, url).
 */
function workingContext(url = 'https://portal.example.com/') {
  let current = url;
  const page = {
    url: () => current,
    isClosed: () => false,
    close: async () => undefined,
    waitForTimeout: async () => undefined,
    waitForLoadState: async () => undefined,
    screenshot: async () => Buffer.from('png'),
    locator: () => ({}),
    evaluate: async () => '',
    title: async () => '',
    viewportSize: () => ({ width: 1280, height: 800 }),
    goto: async (to: string) => { current = to; return null; },
  };
  return {
    context: {
      newPage: async () => page,
      addCookies: async () => undefined,
      close: async () => undefined,
    } as never,
    page,
  };
}

/**
 * P4.1 - THE ROUTE SWITCH. A browser session is created once per run and reused across steps, and
 * the proxy is a LAUNCH option: a context opened for the datacenter cannot be re-pointed at a
 * machine afterwards. So a later step that resolves to a DIFFERENT route out must be refused, not
 * quietly run through the door the first step opened.
 *
 * This is the guard that stops a step launched for the datacenter reusing a context launched
 * through a machine's residential proxy, and it shipped with no test at all: replacing its
 * condition with `false` left every automation and security suite green.
 */
describe('a run does not switch the route out from under itself', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_locality_route'));
  afterAll(shutdownAgentTestDb);

  beforeEach(async () => {
    resetAgentState();
    __resetAutomationSeamsForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    contextRequests = [];
    setDaemonConnectionResolver(() => null);
    setScopedMemoryResolver(async () => []);
    setIntegrationActionExecutor(async () => ({ success: true, data: { ok: true } }));
    setIntegrationActionDeclarationResolver(async () => ({
      posture: 'permissive',
      httpConfig: { baseUrl: 'https://portal.example.com' },
    }));
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: 'pair_home', org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.7:1080', live: true },
    ]);
    const { context } = workingContext();
    setLocalBrowserContextProvider(async (ownerUserId, egress) => {
      contextRequests.push({ ownerUserId, ...(egress ? { egress } : {}) });
      return context;
    });
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
  });

  /** Step 1 opens a datacenter context; step 2 asks for a residential machine. */
  const switchingSteps: Step[] = [
    integrationStep,
    { ...waitStep, id: 's_dc' } as Step,
    {
      ...waitStep,
      id: 's_resi',
      declaration: { target: { kind: 'any', capability: 'egress.residential' } },
    } as Step,
  ];

  it('refuses the second step rather than reusing a context launched for a different door', async () => {
    await seed('a_switch', switchingSteps);
    const result = await runAutomation('a_switch', ctx);

    // EXACTLY ONE context: the datacenter one step 1 opened. A second request would mean the engine
    // launched another context mid-run; ZERO extra plus a completed run would mean it reused the
    // first one for traffic that resolved elsewhere. Both are the substitution under test.
    expect(contextRequests).toHaveLength(1);
    expect(contextRequests[0]!.egress).toEqual({ outcome: 'datacenter', reason: 'no-requirement' });
    expect(result.status).toBe('awaiting_daemon');

    const run = (await automationRuns.get(result.runId)) as unknown as {
      steps: Array<{ index: number; status: string; error?: { message?: string } }>;
    };
    const refused = run.steps.find((s) => s.index === 2);
    expect(refused?.status).toBe('failed');
    expect(refused?.error?.message).toMatch(/different route out of the network/);
    // ...and the step BEFORE it really did run, so the refusal is about the switch and not about
    // `wait` steps being unrunnable here.
    expect(run.steps.find((s) => s.index === 1)?.status).toBe('completed');
  });

  it('two steps on the SAME route run through one context, so the refusal is not a blanket one', async () => {
    await seed('a_same', [integrationStep, { ...waitStep, id: 's_a' } as Step, { ...waitStep, id: 's_b' } as Step]);
    const result = await runAutomation('a_same', ctx);
    expect(result.status).toBe('completed');
    expect(contextRequests).toHaveLength(1);
  });

  /**
   * P4.1 - POSTURE IS ABOUT ONE ORIGIN, AND THE PAGE MUST STILL BE ON IT.
   *
   * Posture is declared on an ACTION and applies to the origin that action is about. The step list
   * honours that; the LIVE PAGE cannot be made to. A `browser` step acts, an act can navigate, and
   * the next step inherits the same permissive label while the hosted Chromium now sits on a bank
   * portal reached by one click. The label was never about that host.
   */
  it('a hosted browser that has DRIFTED off the declared origin carries no further steps', async () => {
    const { context, page } = workingContext();
    setLocalBrowserContextProvider(async (ownerUserId, egress) => {
      contextRequests.push({ ownerUserId, ...(egress ? { egress } : {}) });
      return context;
    });
    await seed('a_drift', [integrationStep, { ...waitStep, id: 's_one' } as Step, { ...waitStep, id: 's_two' } as Step]);

    // The act in step 1 navigated the session away - a click, an OAuth hop, a 302 - and the
    // POST-ACTION OBSERVATION is where that fact lands. Flipping the page at the moment of the
    // first capture IS that sequence: the step succeeds, and the session it leaves behind is
    // somewhere the declaration never spoke about.
    const drifted = 'https://bank.example.pt/transfers';
    const screenshot = page.screenshot;
    page.screenshot = async () => {
      page.url = () => drifted;
      return screenshot();
    };

    const result = await runAutomation('a_drift', ctx);
    expect(result.status).toBe('awaiting_daemon');
    const run = (await automationRuns.get(result.runId)) as unknown as {
      steps: Array<{ index: number; error?: { message?: string } }>;
    };
    expect(run.steps.find((s) => s.index === 2)?.error?.message).toMatch(/bank\.example\.pt/);
    expect(run.steps.find((s) => s.index === 2)?.error?.message).toMatch(/undeclared site/);
  });
});

/**
 * P4.1 - THE CREDENTIAL GATE MAY NOT OPEN A BROWSER AHEAD OF THE LOCALITY DECISION.
 *
 * THE DEFECT THIS PINS, which the first cut of this slice shipped with. The run loop called
 * `credentialGateRecord` BEFORE resolving locality, and the gate fires on nothing more than a step
 * declaring `credentialRefs`. Its `ensureSession` typist path opens the HOSTED Chromium - through
 * `defaultOpenBrowser`, which reached the context seam with no route argument at all, i.e. the
 * datacenter - and submits the password there. Posture was consulted for `requiresAttendedAuth` and
 * for nothing else, so a step naming a Cofre item against a portal nobody had classified would type
 * a real password into an adversarial origin from a datacenter IP, before the code that exists to
 * forbid exactly that had run.
 *
 * The setup is the repro verbatim: a real Cofre password item, a real standing grant, a real login
 * recipe for the origin (without one, `resolveLoginUrl` refuses before the browser and the test
 * would prove nothing), an origin with no posture declaration, no stored session. The load-bearing
 * assertion is `contextRequests`: whether a hosted browser was reached AT ALL.
 */
describe('the credential gate never opens a browser locality has not authorised', () => {
  /** The one host with a REVIEWED login recipe - i.e. the one where the typist can actually get as
   *  far as opening a browser. Nothing declares a posture for it, so it classifies CLOSED. */
  const PORTAL = 'citius.tribunaisnet.mj.pt';
  const actor: Actor = { userId: 'u1', orgId: 'org_a', role: 'user' } as Actor;
  let credentialRef: string;

  beforeAll(() => bootAgentTestDb('ekoa_automation_locality_gate'));
  afterAll(shutdownAgentTestDb);

  beforeEach(async () => {
    resetAgentState();
    __resetAutomationSeamsForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    contextRequests = [];
    setScopedMemoryResolver(async () => []);
    setIntegrationActionExecutor(async () => ({ success: true, data: { ok: true } }));
    // The portal's origin, declared with NO posture - which is what every automation authored
    // before posture existed looks like, and classifies adversarial.
    setIntegrationActionDeclarationResolver(async () => ({ httpConfig: { baseUrl: `https://${PORTAL}/` } }));
    const { context } = workingContext(`https://${PORTAL}/`);
    setLocalBrowserContextProvider(async (ownerUserId, egress) => {
      contextRequests.push({ ownerUserId, ...(egress ? { egress } : {}) });
      return context;
    });

    // A real password, really granted: `ensureSession` reaches the typist only with a standing
    // grant, so without this the run would refuse for an unrelated reason and prove nothing.
    const item = await mintCofreItem(actor, {
      type: 'password',
      label: 'portal',
      value: ['pw', 'P4', 'FIXTURE', '0001'].join('-'),
      boundOrigins: [PORTAL],
    });
    await issueGrant(actor, item._id, 'until_locked');
    credentialRef = `cofre:${item._id}`;
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
  });

  const gatedSteps = (): Step[] => [
    integrationStep,
    { ...waitStep, id: 's_gated', declaration: { credentialRefs: [credentialRef] } } as Step,
  ];

  it('WITH A DAEMON CONNECTED, an adversarial origin still gets no hosted login', async () => {
    // Locality says `bridge`, so the step is NOT refused and the gate really does run - which is
    // what makes this the posture gate's own test rather than the ordering's.
    setDaemonConnectionResolver(() => ({
      runStep: async () => ({ ok: true, observation: { screenshotB64: '', data: { url: `https://${PORTAL}/`, title: 'P', domShapeSketch: 'tags:|roles:|landmarks:0', viewport: { w: 1280, h: 800 } } } }),
    }));
    await seed('a_gate_bridge', gatedSteps());
    const result = await runAutomation('a_gate_bridge', ctx);

    // NOTHING was opened. This is the whole assertion: the password was never typed anywhere.
    expect(contextRequests).toEqual([]);
    // And the run says what it needs - a person - rather than pretending it succeeded.
    expect(result.status).toBe('needs_credentials');
  });

  it('WITH NO DAEMON, locality refuses first and the gate is never consulted at all', async () => {
    setDaemonConnectionResolver(() => null);
    await seed('a_gate_blocked', gatedSteps());
    const result = await runAutomation('a_gate_blocked', ctx);

    expect(contextRequests).toEqual([]);
    // `awaiting_daemon`, NOT `needs_credentials`: the terminal status is the observable proof of
    // WHICH decision ran first. Gate-first produces the credential halt, because the gate answers
    // before anything has asked where the step belongs.
    expect(result.status).toBe('awaiting_daemon');
    const run = (await automationRuns.get(result.runId)) as unknown as {
      steps: Array<{ index: number; error?: { message?: string } }>;
    };
    expect(run.steps.find((s) => s.index === 1)?.error?.message).toMatch(/adversarial/);
  });
});
