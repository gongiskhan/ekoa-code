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
import { mintCofreItem, issueGrant, captureSessionWithGrant } from '../../src/cofre/index.js';
import { cofreItems, cofreGrants } from '../../src/cofre/store.js';
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
    // Cofre rows too: these suites mint REAL items, and a session item surviving into the next case
    // silently changes which session `ensureSession` selects (newest `createdAt` wins). Left out,
    // a case can pass only because the previous one's fixture happened to sort lower.
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
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
    // Cofre rows too: these suites mint REAL items, and a session item surviving into the next case
    // silently changes which session `ensureSession` selects (newest `createdAt` wins). Left out,
    // a case can pass only because the previous one's fixture happened to sort lower.
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
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
    // Cofre rows too: these suites mint REAL items, and a session item surviving into the next case
    // silently changes which session `ensureSession` selects (newest `createdAt` wins). Left out,
    // a case can pass only because the previous one's fixture happened to sort lower.
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
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

/**
 * P4.2 - THE CEREMONY PREFERENCE, PINNED IN TWO HALVES.
 *
 * WHY TWO SUITES FOR ONE PROPERTY. The preference is wired through the run loop in two places, and
 * an adversarial verifier deleted EITHER of them without a single suite going red:
 *
 *   HALF A - `resolveLocalityForStep` forwards `preferredPairingId` into `resolveLocality`. Delete
 *            the forward and the requirement stays "any machine of yours" forever.
 *   HALF B - the post-gate RE-RESOLUTION. The gate is what discovers the preference, and it answers
 *            AFTER locality was first resolved, so the verdict for the gated step has to be taken
 *            again. Delete the re-resolution and the step that just learned it belongs on one
 *            machine runs on whichever machine happens to be dialled in.
 *
 * They fail differently and must be caught separately, so the suites are built to separate them:
 * the HALF A suite gates an `integration` step (which has no locality of its own, so no
 * re-resolution can occur) and observes the preference on the NEXT step; the HALF B suite gates the
 * browser step itself, where the re-resolution is the only thing that can apply what the gate found.
 *
 * THE FIXTURE IS THE REAL PATH. A real Cofre session item, really granted, carrying
 * `sessionMetadata.establishedBy = { kind: 'machine', pairingId: 'pair_ceremony' }` - which is what
 * `bridge/attended.ts` stamps when a human holds a ceremony on their laptop. `ensureSession` reuses
 * it (no browser, no password) and reports the pairing; the engine turns that into a preference.
 */
describe('an adversarial session prefers the machine its ceremony happened on', () => {
  /** Nothing declares a posture for this host, so it classifies ADVERSARIAL - which is the only
   *  posture the preference applies to (a permissive credential is portable and gets none). */
  const PORTAL = 'portal.example.com';
  const CEREMONY_PAIRING = 'pair_ceremony';
  const OTHER_PAIRING = 'pair_other';
  const actor: Actor = { userId: 'u1', orgId: 'org_a', role: 'user' } as Actor;
  let sessionRef: string;

  beforeAll(() => bootAgentTestDb('ekoa_automation_locality_pref'));
  afterAll(shutdownAgentTestDb);

  /** A daemon that answers as `pairingId`, and really runs a `wait` step - so "the preference was
   *  not applied" shows up as a COMPLETED run rather than as some unrelated failure. */
  const daemonAs = (pairingId: string) => () => ({
    pairingId,
    runStep: async () => ({
      ok: true,
      observation: {
        screenshotB64: '',
        data: { url: `https://${PORTAL}/`, title: 'P', domShapeSketch: 'tags:|roles:|landmarks:0', viewport: { w: 1280, h: 800 } },
      },
    }),
  });

  beforeEach(async () => {
    resetAgentState();
    __resetAutomationSeamsForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    contextRequests = [];
    setScopedMemoryResolver(async () => []);
    setIntegrationActionExecutor(async () => ({ success: true, data: { ok: true } }));
    setIntegrationActionDeclarationResolver(async () => ({ httpConfig: { baseUrl: `https://${PORTAL}/` } }));
    setLocalBrowserContextProvider(async (ownerUserId, egress) => {
      contextRequests.push({ ownerUserId, ...(egress ? { egress } : {}) });
      throw new Error('no real Chromium in this suite');
    });
    // BOTH machines are registered. `pair_ceremony` is merely not the one dialled in - it has NOT
    // been retired - so this exercises the preference itself and not the retirement branch.
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: CEREMONY_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.7:1080', live: false },
      { pairingId: OTHER_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.8:1080', live: true },
    ]);

    // The session the run will check out, established ON `pair_ceremony`. `boundEgress:
    // datacenter` keeps CHECKOUT out of the way: the session is healthy and reusable with no fleet
    // condition attached, so the only thing that can refuse the run is LOCALITY.
    const { item } = await captureSessionWithGrant(actor, {
      label: 'portal session',
      boundOrigins: [PORTAL],
      storageState: { cookies: [], origins: [] },
      metadata: {
        establishedBy: { kind: 'machine', pairingId: CEREMONY_PAIRING },
        boundEgress: { kind: 'datacenter' },
        establishedAt: new Date().toISOString(),
        healthy: true,
      },
    });
    sessionRef = `cofre:${item._id}`;
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
    // Cofre rows too: these suites mint REAL items, and a session item surviving into the next case
    // silently changes which session `ensureSession` selects (newest `createdAt` wins). Left out,
    // a case can pass only because the previous one's fixture happened to sort lower.
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
  });

  /**
   * HALF A - the forward into `resolveLocality`.
   *
   * The GATED step is the `integration` step, which is not a browser-needing type: no locality is
   * resolved for it, so the post-gate re-resolution (half B) cannot fire and is not under test
   * here. The preference it discovers has to survive into the NEXT step's own resolution, and the
   * only thing that carries it there is the forward.
   */
  it('the preference discovered on one step decides where the NEXT step runs', async () => {
    setDaemonConnectionResolver(daemonAs(OTHER_PAIRING));
    await seed('a_pref_carry', [
      { ...integrationStep, declaration: { credentialRefs: [sessionRef] } } as Step,
      waitStep,
    ]);
    const result = await runAutomation('a_pref_carry', ctx);

    // Without the forward the requirement is "any machine of yours", the connected one qualifies,
    // and the run COMPLETES on a machine the portal has never seen.
    expect(result.status).toBe('awaiting_daemon');
    const run = (await automationRuns.get(result.runId)) as unknown as {
      steps: Array<{ index: number; status: string; error?: { message?: string } }>;
    };
    expect(run.steps.find((s) => s.index === 0)?.status).toBe('completed');
    expect(run.steps.find((s) => s.index === 1)?.error?.message).toMatch(/machine where its session was established/);
    expect(contextRequests).toEqual([]);
  });

  /**
   * HALF B - the post-gate re-resolution.
   *
   * The gated step IS the browser step, so its locality was already resolved (to `bridge`, since a
   * machine is connected and nothing yet says WHICH machine) before the gate ran. Only re-resolving
   * after the gate can turn that into the refusal.
   */
  it('a step that learns its ceremony machine from its own gate is re-judged before it runs', async () => {
    setDaemonConnectionResolver(daemonAs(OTHER_PAIRING));
    await seed('a_pref_same_step', [
      integrationStep,
      { ...waitStep, declaration: { credentialRefs: [sessionRef] } } as Step,
    ]);
    const result = await runAutomation('a_pref_same_step', ctx);

    // Without the re-resolution the step keeps its pre-gate `bridge` verdict and runs on
    // `pair_other` - a different household, on a different ASN, replaying the portal's own cookie.
    expect(result.status).toBe('awaiting_daemon');
    const run = (await automationRuns.get(result.runId)) as unknown as {
      steps: Array<{ index: number; error?: { message?: string } }>;
    };
    expect(run.steps.find((s) => s.index === 1)?.error?.message).toMatch(/machine where its session was established/);
  });

  /** The preference is a preference for the RIGHT machine, not a blanket refusal: connect the
   *  ceremony machine and the same run goes through. Without this, both cases above would pass
   *  against an engine that simply refused every gated adversarial step. */
  it('...and the SAME run completes when the ceremony machine is the one connected', async () => {
    setDaemonConnectionResolver(daemonAs(CEREMONY_PAIRING));
    await seed('a_pref_match', [
      integrationStep,
      { ...waitStep, declaration: { credentialRefs: [sessionRef] } } as Step,
    ]);
    const result = await runAutomation('a_pref_match', ctx);
    expect(result.status).toBe('completed');
    expect(contextRequests).toEqual([]);
  });
});

/**
 * P4.1 - THE HOSTED-BROWSER PERMIT, AND THE ROUTE IT CARRIES.
 *
 * The permit (`CredentialGateInput.hostedBrowser`) is HALF of the typist's permission - the other
 * half being the origin's posture, applied inside the gate. This suite pins the half the run loop
 * owns, in both of the ways it was found to be unpinned:
 *
 *   1. WHETHER a permit is issued at all. It is issued only when this process has a hosted browser
 *      to offer (`localBrowserEnabled`), which is what keeps a password from being typed into a
 *      hosted Chromium in PRODUCTION, where the flag is off. Replacing the condition with an
 *      unconditional permit left every suite green.
 *   2. WHICH ROUTE it carries. The permit used to attach the resolved egress for an `in-process`
 *      verdict only, silently dropping it for `bridge` - so a permissive origin whose step declares
 *      residential egress had its WORK routed through the machine and its LOGIN typed out of the
 *      datacenter. Same portal, same session, two doors.
 *
 * The origin here is PERMISSIVE and has a reviewed login recipe, which is what it takes to reach
 * the typist at all: without both, the run refuses earlier and the suite would prove nothing.
 */
describe('the hosted-browser permit', () => {
  /** The one host with a REVIEWED login recipe, declared PERMISSIVE here so the posture half of
   *  the permission is satisfied and the run-loop half is the only thing left to decide. */
  const PORTAL = 'citius.tribunaisnet.mj.pt';
  const actor: Actor = { userId: 'u1', orgId: 'org_a', role: 'user' } as Actor;
  let credentialRef: string;

  beforeAll(() => bootAgentTestDb('ekoa_automation_locality_permit'));
  afterAll(shutdownAgentTestDb);

  const daemonAs = (pairingId: string) => () => ({
    pairingId,
    runStep: async () => ({
      ok: true,
      observation: {
        screenshotB64: '',
        data: { url: `https://${PORTAL}/`, title: 'P', domShapeSketch: 'tags:|roles:|landmarks:0', viewport: { w: 1280, h: 800 } },
      },
    }),
  });

  beforeEach(async () => {
    resetAgentState();
    __resetAutomationSeamsForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    contextRequests = [];
    setScopedMemoryResolver(async () => []);
    setIntegrationActionExecutor(async () => ({ success: true, data: { ok: true } }));
    setIntegrationActionDeclarationResolver(async () => ({
      posture: 'permissive',
      httpConfig: { baseUrl: `https://${PORTAL}/` },
    }));
    setLocalBrowserContextProvider(async (ownerUserId, egress) => {
      contextRequests.push({ ownerUserId, ...(egress ? { egress } : {}) });
      throw new Error('no real Chromium in this suite');
    });
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: 'pair_home', org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.7:1080', live: true },
    ]);

    // A real password with a real standing grant: `ensureSession` reaches the permit check only
    // after the re-auth policy is satisfied, so without the grant the run would refuse for an
    // unrelated reason and the permit would never be consulted.
    const item = await mintCofreItem(actor, {
      type: 'password',
      label: 'portal',
      value: ['pw', 'P4', 'FIXTURE', '0002'].join('-'),
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
    // Cofre rows too: these suites mint REAL items, and a session item surviving into the next case
    // silently changes which session `ensureSession` selects (newest `createdAt` wins). Left out,
    // a case can pass only because the previous one's fixture happened to sort lower.
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
  });

  /**
   * THE PRODUCTION POSTURE, which is the whole reason the permit is conditional. With the hosted
   * browser switched off, a permissive origin is STILL not logged into from one - the typist is
   * simply unreachable, and the run asks for a person instead.
   */
  it('is withheld entirely when this process has no hosted browser to offer', async () => {
    process.env.EKOA_AUTOMATION_LOCAL_BROWSER = 'false';
    __resetAutomationConfigForTests();
    setDaemonConnectionResolver(daemonAs('pair_home'));
    await seed('a_permit_off', [
      integrationStep,
      { ...waitStep, id: 's_gated', declaration: { credentialRefs: [credentialRef] } } as Step,
    ]);
    const result = await runAutomation('a_permit_off', ctx);

    // NOTHING was opened - the load-bearing assertion. An unconditional permit reaches
    // `establishWithTypist`, which opens the hosted Chromium and types the password into it.
    expect(contextRequests).toEqual([]);
    expect(result.status).toBe('needs_credentials');
  });

  /** ...and the same run with the hosted browser ON does reach the typist, so the case above is
   *  about the permit and not about this fixture being unable to log in at all. */
  it('...and is issued when it does, so the refusal above is the switch and not the fixture', async () => {
    setDaemonConnectionResolver(daemonAs('pair_home'));
    await seed('a_permit_on', [
      integrationStep,
      { ...waitStep, id: 's_gated', declaration: { credentialRefs: [credentialRef] } } as Step,
    ]);
    await runAutomation('a_permit_on', ctx);
    expect(contextRequests).toHaveLength(1);
  });

  /**
   * THE ROUTE THE PERMIT CARRIES, on a `bridge` verdict - the case that used to drop it.
   *
   * The step declares residential egress and a machine is connected, so the WORK is routed through
   * `pair_home`'s line. The login must leave by the same door. Before the fix the permit carried no
   * egress at all here and the typist opened a datacenter context.
   */
  it('carries the route the step resolved to, even when the work itself runs on the bridge', async () => {
    setDaemonConnectionResolver(daemonAs('pair_home'));
    await seed('a_permit_route', [
      integrationStep,
      {
        ...waitStep,
        id: 's_gated',
        declaration: {
          credentialRefs: [credentialRef],
          target: { kind: 'any', capability: 'egress.residential' },
        },
      } as Step,
    ]);
    await runAutomation('a_permit_route', ctx);

    expect(contextRequests).toHaveLength(1);
    expect(contextRequests[0]!.egress).toEqual({
      outcome: 'machine',
      pairingId: 'pair_home',
      proxyUrl: 'http://100.64.0.7:1080',
    });
  });
});

/**
 * P4.2 - A RETIRED CEREMONY MACHINE IS A TERMINAL STATE, NOT AN ETERNAL WAIT.
 *
 * THE DEFECT. `preferredPairingId` is read off a stored session and never revised. Retire the
 * laptop that established it - `revokePairing`, an ordinary admin action - and the preference
 * outlives the machine. `resolveLocality` correctly refuses to substitute another machine, but the
 * refusal was carried as `awaiting_daemon`, which the schedule rail treats as NEUTRAL against the
 * failure ceiling (`NEUTRAL_BLOCKED_CODES`) on the grounds that opening a laptop clears it. No
 * laptop can be opened for a machine that no longer exists, so the schedule re-fired nightly,
 * forever, against a condition that could not resolve, and the ceiling never counted one of them.
 *
 * THE FIX, and what these pin: the refusal halts in `needs_credentials` - the state that already
 * means "a person must do something", is already NOT neutral, and already deep-links to the Cofre -
 * and its message names the machine in WORDS, never a pairing UUID.
 */
describe('a session whose ceremony machine has been retired stops asking', () => {
  const PORTAL = 'portal.example.com';
  const RETIRED_PAIRING = 'pair_retired';
  const LIVE_PAIRING = 'pair_live';
  const actor: Actor = { userId: 'u1', orgId: 'org_a', role: 'user' } as Actor;
  let sessionRef: string;

  beforeAll(() => bootAgentTestDb('ekoa_automation_locality_retired'));
  afterAll(shutdownAgentTestDb);

  beforeEach(async () => {
    resetAgentState();
    __resetAutomationSeamsForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    contextRequests = [];
    setScopedMemoryResolver(async () => []);
    setIntegrationActionExecutor(async () => ({ success: true, data: { ok: true } }));
    setIntegrationActionDeclarationResolver(async () => ({ httpConfig: { baseUrl: `https://${PORTAL}/` } }));
    setLocalBrowserContextProvider(async (ownerUserId, egress) => {
      contextRequests.push({ ownerUserId, ...(egress ? { egress } : {}) });
      throw new Error('no real Chromium in this suite');
    });
    // A NON-EMPTY fleet listing that does not contain the ceremony pairing is the registry stating
    // the machine is gone. (An EMPTY listing means "this process does not know what this org has",
    // which is not a statement that anything was retired - see `preferenceMachineRetired`.)
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: LIVE_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.9:1080', live: true },
    ]);
    setDaemonConnectionResolver(() => ({
      pairingId: LIVE_PAIRING,
      runStep: async () => ({
        ok: true,
        observation: {
          screenshotB64: '',
          data: { url: `https://${PORTAL}/`, title: 'P', domShapeSketch: 'tags:|roles:|landmarks:0', viewport: { w: 1280, h: 800 } },
        },
      }),
    }));

    const { item } = await captureSessionWithGrant(actor, {
      label: 'portal session',
      boundOrigins: [PORTAL],
      storageState: { cookies: [], origins: [] },
      metadata: {
        establishedBy: { kind: 'machine', pairingId: RETIRED_PAIRING },
        boundEgress: { kind: 'datacenter' },
        establishedAt: new Date().toISOString(),
        healthy: true,
      },
    });
    sessionRef = `cofre:${item._id}`;
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
    // Cofre rows too: these suites mint REAL items, and a session item surviving into the next case
    // silently changes which session `ensureSession` selects (newest `createdAt` wins). Left out,
    // a case can pass only because the previous one's fixture happened to sort lower.
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
  });

  const retiredSteps = (): Step[] => [
    integrationStep,
    { ...waitStep, id: 's_gated', declaration: { credentialRefs: [sessionRef] } } as Step,
  ];

  it('halts in needs_credentials, NOT the neutral machine halt that would retry forever', async () => {
    await seed('a_retired', retiredSteps());
    const result = await runAutomation('a_retired', ctx);

    // `awaiting_daemon` here is the bug: it is exempt from the failure ceiling, so the schedule
    // would re-fire against a machine that no longer exists until somebody noticed by hand.
    expect(result.status).toBe('needs_credentials');
    expect(contextRequests).toEqual([]);
  });

  it('asks for the act that actually fixes it - a ceremony, at the portal, in the Cofre', async () => {
    await seed('a_retired_req', retiredSteps());
    const result = await runAutomation('a_retired_req', ctx);
    const run = (await automationRuns.get(result.runId)) as unknown as {
      credentialRequest?: {
        origin?: string;
        mode?: string;
        portalDeepLink?: string;
        preferredPairingId?: string;
        reason?: string;
      };
    };
    expect(run.credentialRequest?.mode).toBe('ceremony');
    expect(run.credentialRequest?.origin).toBe(PORTAL);
    expect(run.credentialRequest?.portalDeepLink).toContain('/cofre?origin=');
    // NO PREFERRED PAIRING. The portal surfaces `preferredPairingId` as "repeat the ceremony on the
    // machine the portal already knows" - and that machine is precisely the one that is gone.
    // Naming it would send the user to hardware they no longer own.
    expect(run.credentialRequest?.preferredPairingId).toBeUndefined();
  });

  it('names the machine in words a person can act on, never a pairing UUID', async () => {
    await seed('a_retired_msg', retiredSteps());
    const result = await runAutomation('a_retired_msg', ctx);
    const run = (await automationRuns.get(result.runId)) as unknown as {
      steps: Array<{ index: number; error?: { message?: string } }>;
      credentialRequest?: { reason?: string };
    };
    const message = run.steps.find((s) => s.index === 1)?.error?.message ?? '';
    expect(message).toMatch(/the machine where this session was established has been removed/);
    expect(message).toMatch(/establish this session again/);
    // A pairing id is an opaque identifier this product never shows a user; printing one reads as
    // a fault code and names nothing they can do anything about.
    expect(message).not.toContain(RETIRED_PAIRING);
    expect(run.credentialRequest?.reason ?? '').not.toContain(RETIRED_PAIRING);
  });

  /**
   * THE TERMINAL PATH LEADS SOMEWHERE, which is what makes it a fix rather than a dead end.
   *
   * A halt with no way out would be its own defect - worse than the substitution the preference
   * exists to prevent, because a substitution is at least visible. The act the halt asks for is
   * "establish this session again, from a machine you still have", and this drives exactly that:
   * a second session item, established on a pairing the fleet still lists. `ensureSession` picks
   * session items NEWEST FIRST (`findSessionItemsForOrigin` sorts by `createdAt` descending), so
   * the fresh one wins, its preference is a machine that exists, and the same automation runs.
   */
  it('...and the act it asks for actually clears it - the same run then completes', async () => {
    // The clock is INJECTED rather than left to wall time: selection sorts on `createdAt`, and two
    // captures inside the same millisecond would tie and fall back to insertion order - a green
    // test that depends on this machine being slow.
    const later = Date.now() + 60_000;
    await captureSessionWithGrant(
      actor,
      {
        label: 'portal session (re-established)',
        boundOrigins: [PORTAL],
        storageState: { cookies: [], origins: [] },
        metadata: {
          establishedBy: { kind: 'machine', pairingId: LIVE_PAIRING },
          boundEgress: { kind: 'datacenter' },
          establishedAt: new Date(later).toISOString(),
          healthy: true,
        },
      },
      { now: () => later },
    );
    await seed('a_reestablished', retiredSteps());
    const result = await runAutomation('a_reestablished', ctx);
    expect(result.status).toBe('completed');
  });

  /** The retirement branch is about a machine that is GONE, not one that is merely asleep. With the
   *  ceremony machine still in the fleet listing, the same run gets the ordinary NEUTRAL machine
   *  halt - so the terminal path above cannot be a blanket answer for every preference refusal. */
  it('a ceremony machine that is merely switched off still gets the neutral machine halt', async () => {
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: RETIRED_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.7:1080', live: false },
      { pairingId: LIVE_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.9:1080', live: true },
    ]);
    await seed('a_asleep', retiredSteps());
    const result = await runAutomation('a_asleep', ctx);
    expect(result.status).toBe('awaiting_daemon');
  });
});
