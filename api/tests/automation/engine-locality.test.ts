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

/**
 * THE STEP TYPES THAT CAN REACH A BROWSER, as fixtures - one per member of
 * `STEP_TYPES_NEEDING_BROWSER`, which is the sole gate deciding which steps get a locality verdict
 * at all.
 *
 * WHY THEY EXIST. Every locality case in this file used to drive a `wait` step, and `wait` alone.
 * Mutating that set to `new Set(['wait'])` - i.e. deleting `navigate`, `browser` and `verify` from
 * it, so that the three step types which actually drive a page stop being judged - left 94 files and
 * 1324 tests across tests/automation, tests/schedules and tests/security entirely green. Removing
 * just `browser` was green too. A silent regression there reopens BOTH P4.1 substitution and P4.2
 * wrong-machine execution on exactly the steps that matter, and nothing in the repository would have
 * noticed.
 *
 * A `navigate` step is the odd one: it STATES its own url, so `resolveStepOrigin` answers with that
 * url and NO action declaration - and `classifyOrigin` with no action is CLOSED. A navigate step is
 * therefore always adversarial about its own destination, which is why the permissive cases below
 * use the types that inherit their origin from a preceding integration step.
 */
const browserNeedingSteps: ReadonlyArray<{ type: string; step: (id: string) => Step }> = [
  {
    type: 'navigate',
    step: (id) => ({ id, description: 'open the inbox', type: 'navigate', url: 'https://portal.example.com/inbox' }) as Step,
  },
  { type: 'wait', step: (id) => ({ ...waitStep, id }) as Step },
  { type: 'browser', step: (id) => ({ id, description: 'click the thing', type: 'browser' }) as Step },
  { type: 'verify', step: (id) => ({ id, description: 'the thing is there', type: 'verify' }) as Step },
];

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

  it('...and halts rather than falling back to the datacenter when that machine is asleep', async () => {
    setIntegrationActionDeclarationResolver(async () => ({
      posture: 'permissive',
      httpConfig: { baseUrl: 'https://portal.example.com' },
    }));
    // Listed but not live: a machine exists, it is simply switched off, so the halt is the NEUTRAL
    // one and the next fire works once it wakes. (An EMPTY listing is a different fact with a
    // different answer - see `an org whose only machine was revoked` below.)
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: 'pair_home', org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.7:1080', live: false },
    ]);
    await seed('a_resi_gone', [
      integrationStep,
      { ...waitStep, declaration: { target: { kind: 'any', capability: 'egress.residential' } } } as Step,
    ]);
    const result = await runAutomation('a_resi_gone', ctx);

    expect(contextRequests).toEqual([]);
    expect(result.status).toBe('awaiting_daemon');
  });

  /**
   * AN ACCOUNT WITH NO MACHINE IN IT - the regression, driven through the real engine.
   *
   * The default seam resolver answers `null` ("this process has no listing"), which must keep the
   * NEUTRAL halt: not-knowing may never escalate a wait into a terminal failure. A resolver that
   * really asked the registry and got nothing answers `[]`, which is the registry saying THIS ORG
   * HAS NO MACHINES - and that is a dead end no laptop can clear, so it must not be neutral.
   *
   * The pair is asserted together because either one alone is satisfiable by the wrong code: making
   * everything terminal auto-pauses schedules for an unwired seam, and making everything neutral is
   * the defect.
   */
  it('an UNKNOWN fleet keeps the neutral machine halt', async () => {
    // No `setEgressCandidateResolver`: the unbound default, which answers `null`.
    await seed('a_fleet_unknown', [waitStep]);
    const result = await runAutomation('a_fleet_unknown', ctx);
    expect(result.status).toBe('awaiting_daemon');
    const run = (await automationRuns.get(result.runId)) as unknown as { steps: Array<{ error?: { message?: string } }> };
    expect(run.steps[0]?.error?.message).toMatch(/none is connected/);
  });

  it('a KNOWN-EMPTY fleet halts TERMINALLY instead of waiting for a machine that cannot arrive', async () => {
    setEgressCandidateResolver(async () => []); // the registry answered: this org has no machines
    await seed('a_fleet_empty', [waitStep]);
    const result = await runAutomation('a_fleet_empty', ctx);

    // NOT `awaiting_daemon`: that code is exempt from the failure ceiling
    // (`NEUTRAL_BLOCKED_CODES`), so a schedule would re-fire nightly forever telling the owner to
    // connect a machine their account does not have.
    expect(result.status).toBe('failed');
    expect(contextRequests).toEqual([]);
    const run = (await automationRuns.get(result.runId)) as unknown as { steps: Array<{ error?: { message?: string } }> };
    expect(run.steps[0]?.error?.message).toMatch(/no machine is paired to your account/);
    expect(run.steps[0]?.error?.message).toMatch(/pair a machine/);
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

  /**
   * EVERY step type that can reach a browser, not just the cheapest one to write a fixture for.
   *
   * The observable is the HALT MESSAGE, and it is chosen because it is the one thing that separates
   * "locality refused this step" from "this step asked for a browser and there wasn't one". Both end
   * the run in `awaiting_daemon` with no context request, which is exactly why a suite asserting
   * only the status stayed green while three of the four step types were being waved through.
   */
  describe.each(browserNeedingSteps)('a $type step is judged by locality', ({ type, step }) => {
    it('halts with the ORIGIN POSTURE refusal, not with "no daemon"', async () => {
      // The integration step ahead of it declares the origin for the types that inherit one; the
      // `navigate` step ignores it and states its own. Both resolve to the same adversarial host.
      setIntegrationActionDeclarationResolver(async () => ({ httpConfig: { baseUrl: 'https://portal.example.com/' } }));
      await seed(`a_types_${type}`, [integrationStep, step('s_typed')]);
      const result = await runAutomation(`a_types_${type}`, ctx);

      expect(result.status).toBe('awaiting_daemon');
      expect(contextRequests).toEqual([]);
      const run = (await automationRuns.get(result.runId)) as unknown as {
        steps: Array<{ index: number; error?: { message?: string } }>;
      };
      const message = run.steps.find((s) => s.index === 1)?.error?.message ?? '';
      // The locality refusal, which only exists if this step type was judged at all...
      expect(message).toMatch(/this origin is adversarial/);
      // ...and NOT the executor's own "there is no browser here", which is what a step waved past
      // locality falls through to. The two are indistinguishable by status alone.
      expect(message).not.toMatch(/local ekoa daemon not connected/);
    });
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
   * A REFUSED STEP IS NOT GATED - and the observable is a SECOND BROWSER, not a status.
   *
   * `engine.ts` skips the credential gate entirely for a step locality has already refused
   * (`localityRecord ? {} : await credentialGateRecord(...)`). Removing that guard left every suite
   * in this repo green, because the refusal record still wins the `??` chain that decides the step
   * record: the run status, the halt and the message are all identical either way. What changes is
   * everything the gate DOES on the way to an answer it will not be asked for - `ensureSession`
   * decrypts the stored credential for a step that is never going to run, and, as here, opens the
   * hosted browser and types a password into it.
   *
   * THE HARM IS THE SECOND DOOR, which is the exact thing the route-switch refusal above exists to
   * prevent. Step 2 is refused BECAUSE this run already opened a datacenter context and the step
   * resolved to a machine. Its locality verdict is still `in-process`, so `hostedTypistPermitFor`
   * issues a permit carrying the RESIDENTIAL route - and an ungated gate would take it and submit
   * the password out of a door no work in this run is using. Same portal, same account, two
   * identities, on a step whose whole point is that it may not run.
   *
   * The origin is the one host with a REVIEWED LOGIN RECIPE, declared permissive, because both are
   * what it takes to reach `openBrowser` at all: without them the gate refuses earlier and a second
   * context would never appear whether the guard existed or not.
   */
  it('a step locality already refused never reaches the credential gate, so no second door opens', async () => {
    const PORTAL = 'citius.tribunaisnet.mj.pt';
    const actor: Actor = { userId: ctx.ownerUserId, orgId: ctx.orgId, role: 'user' } as Actor;
    setIntegrationActionDeclarationResolver(async () => ({
      posture: 'permissive',
      httpConfig: { baseUrl: `https://${PORTAL}/` },
    }));
    const { context } = workingContext(`https://${PORTAL}/`);
    setLocalBrowserContextProvider(async (ownerUserId, egress) => {
      contextRequests.push({ ownerUserId, ...(egress ? { egress } : {}) });
      return context;
    });
    // A real password, really granted: the typist is reached only after the grant check, so without
    // one the gate would refuse for an unrelated reason and this would prove nothing.
    const item = await mintCofreItem(actor, {
      type: 'password',
      label: 'portal',
      value: ['pw', 'P4', 'FIXTURE', '0003'].join('-'),
      boundOrigins: [PORTAL],
    });
    await issueGrant(actor, item._id, 'until_locked');

    await seed('a_refused_not_gated', [
      integrationStep,
      { ...waitStep, id: 's_dc' } as Step,
      {
        ...waitStep,
        id: 's_resi_gated',
        declaration: {
          target: { kind: 'any', capability: 'egress.residential' },
          credentialRefs: [`cofre:${item._id}`],
        },
      } as Step,
    ]);
    const result = await runAutomation('a_refused_not_gated', ctx);

    // EXACTLY ONE context, and it is the datacenter one step 1 opened for the WORK. A second entry
    // is the typist's, opened for a step that was already refused.
    expect(contextRequests).toHaveLength(1);
    expect(contextRequests[0]!.egress).toEqual({ outcome: 'datacenter', reason: 'no-requirement' });

    // ...and the refusal is still the route-switch one. Were the gate consulted it would answer
    // first-and-loudest with a credential halt, which would send a person to the Cofre for a step
    // whose problem is the route out.
    const run = (await automationRuns.get(result.runId)) as unknown as {
      steps: Array<{ index: number; error?: { message?: string } }>;
    };
    expect(run.steps.find((s) => s.index === 2)?.error?.message).toMatch(/different route out of the network/);
  });

  /**
   * A STEP THAT RESOLVES NO LOCALITY MUST INHERIT NONE - `engine.ts` clears `stepLocality` at the
   * top of every iteration, before the `STEP_TYPES_NEEDING_BROWSER` check that may set it.
   *
   * Deleting that one line left every suite in this repo green, and the reason is that the variable
   * is only READ again by `hostedTypistPermitFor`. An `integration` or `api_call` step has no
   * locality of its own; without the reset it keeps the last BROWSER step's verdict and computes
   * its typist permit from a decision made about a DIFFERENT ORIGIN. Both directions are wrong and
   * both are silent: a stale `blocked` withholds the permit and halts `needs_credentials` for a
   * step that could simply have logged in, and a stale `in-process`/`bridge` hands the login a
   * proxy - which is what this pins, because it is the one that leaks.
   *
   * THE SHAPE. Step 1 is a browser step on PORTAL A declaring residential egress, so it resolves
   * `in-process` through `pair_home` and opens the run's context on that machine's line. Step 2 is
   * an INTEGRATION step on PORTAL B carrying a credential. Portal B's login has nothing to do with
   * portal A's machine, and the permit for it must be the plain hosted browser - `{}`, no proxy.
   * With the stale verdict the password for portal B is typed out of `pair_home`'s household line.
   */
  it('a step with no locality of its own does not inherit the last browser step’s door', async () => {
    const PORTAL_A = 'portal.example.com';
    const PORTAL_B = 'citius.tribunaisnet.mj.pt';
    const actor: Actor = { userId: ctx.ownerUserId, orgId: ctx.orgId, role: 'user' } as Actor;
    // Two portals, both PERMISSIVE - so posture never withholds the permit and the only thing that
    // can decide the login's door is which step's verdict is in the variable.
    setIntegrationActionDeclarationResolver(async (key) => ({
      posture: 'permissive',
      httpConfig: { baseUrl: key === 'citius' ? `https://${PORTAL_B}/` : `https://${PORTAL_A}/` },
    }));
    const { context } = workingContext(`https://${PORTAL_A}/`);
    setLocalBrowserContextProvider(async (ownerUserId, egress) => {
      contextRequests.push({ ownerUserId, ...(egress ? { egress } : {}) });
      return context;
    });
    const item = await mintCofreItem(actor, {
      type: 'password',
      label: 'portal b',
      value: ['pw', 'P4', 'FIXTURE', '0004'].join('-'),
      boundOrigins: [PORTAL_B],
    });
    await issueGrant(actor, item._id, 'until_locked');

    await seed('a_no_inherit', [
      integrationStep,
      {
        ...waitStep,
        id: 's_resi',
        declaration: { target: { kind: 'any', capability: 'egress.residential' } },
      } as Step,
      {
        id: 's_int_b',
        description: 'call portal B',
        type: 'integration',
        integrationKey: 'citius',
        integrationAction: 'fetch',
        declaration: { credentialRefs: [`cofre:${item._id}`] },
      } as Step,
    ]);
    await runAutomation('a_no_inherit', ctx);

    // TWO contexts, and the SECOND one is the assertion. The first is the work's, on portal A's
    // machine; the second is the typist's, for portal B.
    expect(contextRequests).toHaveLength(2);
    expect(contextRequests[0]!.egress).toEqual({ outcome: 'machine', pairingId: 'pair_home', proxyUrl: 'http://100.64.0.7:1080' });
    // NO PROXY. Portal B's login leaves by the plain hosted browser, because nothing resolved a
    // door for it. Inheriting step 1's verdict puts `pair_home` here instead.
    expect(contextRequests[1]!.egress).toBeUndefined();
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
    // BOTH machines are registered, LIVE, and granted residential egress. `pair_ceremony` is
    // merely not the one DIALLED IN - the daemon seam hands back one socket per owner and it is
    // the other machine's - so this exercises the preference itself and not the retirement branch.
    //
    // `pair_ceremony` being LIVE is load-bearing, not decoration: the session below is bound to
    // that machine's residential line (which is what a ceremony actually produces), so checkout
    // only hands the run a session - and with it the ceremony pairing - while that machine is
    // available. A fixture that switched it off would refuse at CHECKOUT and never reach locality.
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: CEREMONY_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.7:1080', live: true },
      { pairingId: OTHER_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.8:1080', live: true },
    ]);

    // The session the run will check out, established ON `pair_ceremony` - STAMPED EXACTLY AS
    // PRODUCTION STAMPS IT. `bridge/attended.ts` is the only writer of `establishedBy: machine`
    // in this repo and it always writes `boundEgress: residential` beside it (the hosted typist
    // writes cloud+datacenter; `EstablishmentVantage` has no production producer). This fixture
    // used to pair machine+datacenter, with a comment saying that kept CHECKOUT out of the way -
    // a variant the product cannot emit, and the reason the whole P4.2 path could be dead in
    // production while every case here passed.
    const { item } = await captureSessionWithGrant(actor, {
      label: 'portal session',
      boundOrigins: [PORTAL],
      storageState: { cookies: [], origins: [] },
      metadata: {
        establishedBy: { kind: 'machine', pairingId: CEREMONY_PAIRING },
        boundEgress: { kind: 'residential', pairingId: CEREMONY_PAIRING },
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

  /**
   * ...FOR EVERY STEP TYPE THAT CAN REACH A BROWSER, and not just for `wait`.
   *
   * This is the P4.2 half of the `STEP_TYPES_NEEDING_BROWSER` coverage: a type quietly dropped from
   * that set stops being re-judged after its gate, so the step that has just learned it belongs on
   * one particular machine runs on whichever machine happens to be dialled in - a different
   * household, on a different ASN, replaying the portal's own cookie. The observable is the refusal
   * MESSAGE rather than the run status, because a step waved past locality fails (or succeeds) for
   * its own reasons and the status alone cannot tell the two apart.
   */
  describe.each(browserNeedingSteps)('a gated $type step is re-judged against its ceremony machine', ({ type, step }) => {
    it('refuses the connected machine rather than substituting it', async () => {
      setDaemonConnectionResolver(daemonAs(OTHER_PAIRING));
      const gated = { ...step('s_typed'), declaration: { credentialRefs: [sessionRef] } } as Step;
      await seed(`a_pref_${type}`, [integrationStep, gated]);
      const result = await runAutomation(`a_pref_${type}`, ctx);

      const run = (await automationRuns.get(result.runId)) as unknown as {
        steps: Array<{ index: number; error?: { message?: string } }>;
      };
      expect(run.steps.find((s) => s.index === 1)?.error?.message)
        .toMatch(/machine where its session was established/);
      expect(contextRequests).toEqual([]);
    });
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
   * THE ROUTE THE PERMIT CARRIES, on a `bridge` verdict - and it is the CONNECTED machine's.
   *
   * THE FIXTURE THIS REPLACES had a fleet of ONE machine which was also the connected daemon, so it
   * passed identically whether the permit carried the daemon's own line or `resolveEgress`'s
   * independent pick - there was only one thing to pick. The fleet below lists `pair_office` FIRST,
   * so `usable[0]` is NOT the machine the work will run on: the assertion now separates the two.
   *
   * The step declares residential egress and `pair_home` is connected, so the WORK leaves by
   * `pair_home`'s line. The login must leave by the same door - not the datacenter (which is what
   * dropping the egress did) and not `pair_office` (which is what taking `resolveEgress`'s answer
   * does). Same portal, same session, one door.
   */
  it('carries the CONNECTED machine’s route, not the first residential machine in the fleet', async () => {
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: 'pair_office', org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.8:1080', live: true },
      { pairingId: 'pair_home', org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.7:1080', live: true },
    ]);
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

  /**
   * ...AND WHEN THERE IS NO MATCHING DOOR, THE PERMIT IS WITHHELD RATHER THAN DOWNGRADED.
   *
   * The step is pinned to the connected machine, and that machine advertises no residential egress
   * - a perfectly ordinary fleet, since `egress.residential` is about lending a line to others and
   * most machines never grant it. The work still runs there (the verdict is `bridge`), so the only
   * question is where the LOGIN goes. `proxyOptionFor` answers undefined for the refused resolution,
   * so carrying it through opened a plain datacenter context and typed the password into it while
   * the session it produced was used from the owner's home line: two doors onto one portal,
   * performed by the one act in a run that hands over a secret.
   */
  it('is withheld entirely when the connected machine has no line for the login to share', async () => {
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: 'pair_home', org: orgId, capabilities: [], live: true },
      { pairingId: 'pair_office', org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.8:1080', live: true },
    ]);
    setDaemonConnectionResolver(daemonAs('pair_home'));
    await seed('a_permit_nodoor', [
      integrationStep,
      {
        ...waitStep,
        id: 's_gated',
        declaration: {
          credentialRefs: [credentialRef],
          target: { kind: 'pinned', pairingId: 'pair_home' },
        },
      } as Step,
    ]);
    const result = await runAutomation('a_permit_nodoor', ctx);

    // NOTHING was opened - not a datacenter context, and emphatically not one through
    // `pair_office`, whose line this run has no business using.
    expect(contextRequests).toEqual([]);
    // ...and the run says what it needs, which is a person, rather than logging in out of the
    // wrong door and reporting success.
    expect(result.status).toBe('needs_credentials');
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
    // A fleet listing that does not contain the ceremony pairing is the registry stating the machine
    // is gone. (`null` - no listing at all - is a different fact: ignorance, which never reads as a
    // retirement. See `machineRetired`.)
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
        boundEgress: { kind: 'residential', pairingId: RETIRED_PAIRING },
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
          boundEgress: { kind: 'residential', pairingId: LIVE_PAIRING },
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

  /**
   * ================= THE SOLO TENANT WHO REVOKED THEIR ONLY LAPTOP =================
   *
   * The block above needs a SECOND machine to be reachable: the retirement is detected because the
   * listing still contains something. Take that second machine away and every mechanism in the slice
   * quietly stopped working.
   *
   * WHAT WENT WRONG, exactly. One laptop, an attended ceremony held on it, then `revokePairing`.
   * `egressCandidatesForOrg` filters revoked rows, so the org's listing is `[]` - and `[]` used to
   * read as "this process does not know what this org has". `machineRetired` therefore answered NO,
   * so neither retirement branch fired; with no daemon connected the run halted `awaiting_daemon`,
   * which this slice made NEUTRAL against the failure ceiling; and the schedule re-fired nightly,
   * forever, uncounted, telling the owner to connect a machine that no longer existed. A dead end
   * that used to be bounded (on main it counted as `failed` and auto-paused after 20 fires) became
   * unbounded - the exact pathology the retirement work was written to remove.
   *
   * NO DAEMON IS CONNECTED HERE, and that is the whole reason this needs its own block rather than a
   * variant above: with nothing dialled in, `resolveLocality` refuses BEFORE the credential gate
   * runs, so the gate's retirement branch never gets a chance to answer.
   */
  describe('an org whose only machine was revoked', () => {
    beforeEach(() => {
      // The registry ANSWERED, and this org has nothing: the shape `egressCandidatesForOrg` returns
      // once the only pairing is revoked. `tests/security/locality-isolation.test.ts` drives that
      // revocation against the real store, so this fixture is a shape production emits.
      setEgressCandidateResolver(async () => []);
      setDaemonConnectionResolver(() => null);
    });

    it('halts TERMINALLY rather than waiting nightly for hardware the account does not have', async () => {
      await seed('a_solo_revoked', retiredSteps());
      const result = await runAutomation('a_solo_revoked', ctx);

      // `awaiting_daemon` is the regression: exempt from the failure ceiling, so the schedule never
      // auto-pauses and the owner is never told anything is wrong.
      expect(result.status).toBe('needs_credentials');
      expect(contextRequests).toEqual([]);
    });

    it('asks for the acts that actually clear it - pair a machine, then establish the session', async () => {
      await seed('a_solo_revoked_req', retiredSteps());
      const result = await runAutomation('a_solo_revoked_req', ctx);
      const run = (await automationRuns.get(result.runId)) as unknown as {
        steps: Array<{ index: number; error?: { message?: string } }>;
        credentialRequest?: { origin?: string; mode?: string; portalDeepLink?: string; reason?: string };
      };
      expect(run.credentialRequest?.mode).toBe('ceremony');
      expect(run.credentialRequest?.origin).toBe(PORTAL);
      expect(run.credentialRequest?.portalDeepLink).toContain('/cofre?origin=');
      const message = run.steps.find((s) => s.index === 1)?.error?.message ?? '';
      expect(message).toMatch(/no machine is paired to your account/);
      // A pairing id is an opaque identifier this product never shows a user.
      expect(message).not.toContain(RETIRED_PAIRING);
    });

    /**
     * A STEP THAT WANTS NO CREDENTIAL GETS THE OTHER TERMINAL HALT.
     *
     * Still terminal - that is the property that bounds the retry - but not a credential ask:
     * sending a person to the Cofre to establish something the step never declared is a wrong
     * specific instruction, and a wrong specific instruction is worse than an honest general one.
     */
    it('...and a step declaring no credential fails terminally without asking for one', async () => {
      await seed('a_solo_revoked_nocred', [integrationStep, { ...waitStep, id: 's_plain' } as Step]);
      const result = await runAutomation('a_solo_revoked_nocred', ctx);

      expect(result.status).toBe('failed');
      const run = (await automationRuns.get(result.runId)) as unknown as {
        steps: Array<{ index: number; error?: { message?: string } }>;
        credentialRequest?: unknown;
      };
      expect(run.credentialRequest).toBeUndefined();
      expect(run.steps.find((s) => s.index === 1)?.error?.message ?? '').toMatch(/no machine is paired/);
    });

    /**
     * ...AND THE UNBOUND SEAM IS STILL NEUTRAL, driven through the same fixture so the difference is
     * the LISTING and nothing else. A process that has not wired its resolver knows nothing about
     * this org, and not-knowing must never auto-pause anybody's schedule.
     */
    it('an UNKNOWN listing over the identical run keeps the neutral machine halt', async () => {
      setEgressCandidateResolver(async () => null);
      await seed('a_solo_unknown', retiredSteps());
      const result = await runAutomation('a_solo_unknown', ctx);
      expect(result.status).toBe('awaiting_daemon');
    });
  });

  /**
   * THE SAME DISTINCTION ONE LAYER IN: what `credentialGateRecord` is told about the fleet.
   *
   * With a machine DIALLED IN, locality answers `bridge` and the credential gate runs, so checkout's
   * `needs-machine` refusal reaches the retirement question. The listing the engine hands it must
   * carry `null` through rather than flattening it to `[]` - `machineRetired(id, [])` is TRUE, so a
   * process with no listing would declare every session's machine retired and send its owner to
   * repeat a ceremony they do not need, precisely when it knows least.
   */
  it('an UNKNOWN listing never reads as a retirement, even with a machine connected', async () => {
    setEgressCandidateResolver(async () => null);
    await seed('a_unknown_listing_bridge', retiredSteps());
    const result = await runAutomation('a_unknown_listing_bridge', ctx);

    // The neutral machine halt (checkout wants `pair_retired`, which is not available), NOT the
    // terminal ceremony ask.
    expect(result.status).toBe('awaiting_daemon');
    const run = (await automationRuns.get(result.runId)) as unknown as {
      steps: Array<{ index: number; error?: { message?: string } }>;
    };
    expect(run.steps.find((s) => s.index === 1)?.error?.message ?? '')
      .not.toMatch(/has been removed from your account/);
  });
});

/**
 * P4.2 - A CEREMONY PREFERENCE BELONGS TO ITS PORTAL, AND TRAVELS NO FURTHER.
 *
 * THE DEFECT, reproduced below end to end through the real engine. `preferredPairingId` was ONE
 * run-level variable, set by whichever gated step last reported a pairing, and
 * `resolveLocalityForStep` forwarded it into EVERY later browser-needing step whatever origin that
 * step was about. A run that logs into portal A and then browses portal B therefore judged portal
 * B's steps against portal A's ceremony machine.
 *
 * WHAT THAT COST, and why it is the root cause rather than an edge case. With portal A's ceremony
 * machine retired, the step on PORTAL B halted `needs_credentials` naming PORTAL B, and told the
 * owner to establish that session again from a machine they still have. They could do exactly that,
 * correctly, as many times as they liked: the halt is about a machine belonging to a session for a
 * different site, so re-establishing portal B changed nothing and the next fire produced the
 * identical halt. Meanwhile `needs_credentials` is deliberately NOT in `NEUTRAL_BLOCKED_CODES`, so
 * every one of those fires counted against the failure ceiling until the schedule auto-paused -
 * having pointed the owner at the wrong portal the whole way.
 *
 * The lesser variant is the same misdirection wearing the neutral halt: with the ceremony machine
 * merely asleep, portal B's steps waited on a machine portal B was never established from.
 *
 * The fix is that a preference is filed under the ORIGIN it belongs to, and the gate hands the
 * origin over WITH the pairing so the two cannot be separated (`CredentialGateVerdict.ready`).
 *
 * WHAT ROUND FIVE CHANGED HERE, and why the cases below are shaped as they are. Portal A's session
 * now carries the metadata `bridge/attended.ts` actually writes - `establishedBy: machine` WITH
 * `boundEgress: residential` from the same pairing - so the machine's state decides WHICH of three
 * situations the run is in, and each is a different property:
 *   - ceremony machine LIVE, a different machine dialled in -> the session IS released, the
 *     preference IS learned, and locality refuses portal A's steps while portal B's run. That is
 *     the per-origin property this block is named for, and the default the `beforeEach` sets up.
 *   - ceremony machine RETIRED -> checkout refuses the session outright, so the run halts at portal
 *     A's own gate and never learns a preference at all. The misdirection is still the thing under
 *     test: the halt must name PORTAL A.
 *   - ceremony machine merely ASLEEP -> same refusal, neutral halt, still about portal A.
 * The fixtures used to pair machine+datacenter, which made the session releasable with no fleet
 * condition at all - a shape no code path in this repo emits, and the reason the whole path could be
 * dead in production with every case here green.
 */
describe('a ceremony preference for one portal does not judge steps on another', () => {
  /** Portal A: where the session was established, on the org's ceremony machine. */
  const PORTAL_A = 'porta.example.com';
  /** Portal B: a different site entirely, which this run merely browses. */
  const PORTAL_B = 'outra.example.com';
  const CEREMONY_PAIRING = 'pair_ceremony';
  const LIVE_PAIRING = 'pair_live';
  const actor: Actor = { userId: 'u1', orgId: 'org_a', role: 'user' } as Actor;
  let sessionRefA: string;

  beforeAll(() => bootAgentTestDb('ekoa_automation_locality_two_portals'));
  afterAll(shutdownAgentTestDb);

  /** Portal A is reached through integration `porta`, portal B through integration `outra`. */
  const integrationA: Step = {
    id: 's_int_a', description: 'open portal A', type: 'integration',
    integrationKey: 'porta', integrationAction: 'fetch',
  } as Step;
  const integrationB: Step = {
    id: 's_int_b', description: 'open portal B', type: 'integration',
    integrationKey: 'outra', integrationAction: 'fetch',
  } as Step;

  beforeEach(async () => {
    resetAgentState();
    __resetAutomationSeamsForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    contextRequests = [];
    setScopedMemoryResolver(async () => []);
    setIntegrationActionExecutor(async () => ({ success: true, data: { ok: true } }));
    // Neither portal declares a posture, so both classify ADVERSARIAL - the only posture a ceremony
    // preference applies to, and the one where getting the portal wrong costs an account.
    setIntegrationActionDeclarationResolver(async (key) => ({
      httpConfig: { baseUrl: key === 'outra' ? `https://${PORTAL_B}/` : `https://${PORTAL_A}/` },
    }));
    setLocalBrowserContextProvider(async (ownerUserId, egress) => {
      contextRequests.push({ ownerUserId, ...(egress ? { egress } : {}) });
      throw new Error('no real Chromium in this suite');
    });
    // BOTH machines are listed and LIVE, and the one DIALLED IN is not the ceremony machine.
    //
    // `pair_ceremony` being live is what makes this block reachable at all. Portal A's session is
    // bound to that machine's residential line - the shape a ceremony actually produces - so
    // checkout only releases it, and the run only ever LEARNS the preference, while the machine is
    // available. Switch it off or retire it and the run halts at portal A's own gate before any
    // preference exists, which is a different property, pinned in the two cases at the end.
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: CEREMONY_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.7:1080', live: true },
      { pairingId: LIVE_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.9:1080', live: true },
    ]);
    setDaemonConnectionResolver(() => ({
      pairingId: LIVE_PAIRING,
      runStep: async () => ({
        ok: true,
        observation: {
          screenshotB64: '',
          data: { url: `https://${PORTAL_B}/inbox`, title: 'B', domShapeSketch: 'tags:|roles:|landmarks:0', viewport: { w: 1280, h: 800 } },
        },
      }),
    }));

    const { item } = await captureSessionWithGrant(actor, {
      label: 'portal A session',
      boundOrigins: [PORTAL_A],
      storageState: { cookies: [], origins: [] },
      metadata: {
        establishedBy: { kind: 'machine', pairingId: CEREMONY_PAIRING },
        boundEgress: { kind: 'residential', pairingId: CEREMONY_PAIRING },
        establishedAt: new Date().toISOString(),
        healthy: true,
      },
    });
    sessionRefA = `cofre:${item._id}`;
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
  });

  /** Log into portal A with the session made on the ceremony machine, then browse portal B. */
  const twoPortalSteps = (): Step[] => [
    { ...integrationA, declaration: { credentialRefs: [sessionRefA] } } as Step,
    integrationB,
    { id: 's_nav_b', description: 'open the inbox', type: 'navigate', url: `https://${PORTAL_B}/inbox` } as Step,
  ];

  /**
   * Portal B FIRST, then a step on portal A that carries portal A's credential - so a halt about
   * portal A's machine has to leave portal B's step already completed behind it.
   *
   * The gated step is a `navigate`, not the `integration` step, and that is deliberate rather than
   * incidental: the engine reports ANY non-recoverable failure on an `integration` step as
   * `awaiting_integration` before it reads the `awaiting_daemon` detail (`engine.ts`, the halt
   * cascade), so gating the integration step would have these cases asserting a status about the
   * integration rather than about the machine. Pre-existing and recorded in docs/findings.md as
   * `a-machine-halt-on-an-integration-step-is-reported-as-awaiting-integration`.
   */
  const portalBThenGatedA = (): Step[] => [
    integrationA,
    integrationB,
    { id: 's_nav_b', description: 'open the inbox', type: 'navigate', url: `https://${PORTAL_B}/inbox` } as Step,
    {
      id: 's_nav_a', description: 'open portal A', type: 'navigate', url: `https://${PORTAL_A}/inbox`,
      declaration: { credentialRefs: [sessionRefA] },
    } as Step,
  ];

  it('the step on portal B runs, because portal A’s ceremony machine says nothing about it', async () => {
    await seed('a_two_portals', twoPortalSteps());
    const result = await runAutomation('a_two_portals', ctx);

    // Portal B's step declares no credential and has no session of its own, so it carries no
    // preference: a connected machine is a connected machine, and the bridge runs it. With the
    // preference held run-level it inherited portal A's ceremony machine and halted here instead.
    expect(result.status).toBe('completed');
    expect(contextRequests).toEqual([]);
  });

  /**
   * BOTH HALVES IN ONE RUN, which is what makes the store a MAP rather than a variable that happens
   * to be re-read. The same run browses portal B (must run) and then portal A (must refuse), and a
   * single latest-wins slot cannot produce both answers.
   */
  it('holds one answer per portal, and gives each step the one that is about its own site', async () => {
    await seed('a_two_portals_both', [
      { ...integrationA, declaration: { credentialRefs: [sessionRefA] } } as Step,
      integrationB,
      { id: 's_nav_b', description: 'open the inbox', type: 'navigate', url: `https://${PORTAL_B}/inbox` } as Step,
      { id: 's_nav_a', description: 'open portal A', type: 'navigate', url: `https://${PORTAL_A}/inbox` } as Step,
    ]);
    const result = await runAutomation('a_two_portals_both', ctx);
    const run = (await automationRuns.get(result.runId)) as unknown as {
      steps: Array<{ index: number; status?: string; error?: { message?: string } }>;
    };

    // Portal B: no preference is filed under it, so the connected machine carries it.
    expect(run.steps.find((s) => s.index === 2)?.status).toBe('completed');
    // Portal A: the preference IS filed under it, and the connected machine is not the ceremony
    // one - so the step refuses rather than replaying portal A's cookie from another household.
    expect(result.status).toBe('awaiting_daemon');
    expect(run.steps.find((s) => s.index === 3)?.error?.message ?? '')
      .toMatch(/machine where its session was established/);
    expect(contextRequests).toEqual([]);
  });

  /**
   * ...AND A PORTAL WHOSE MACHINE IS GONE NAMES ITSELF, never the other one.
   *
   * This is the misdirection the map exists to stop, in the shape production can actually reach.
   * Portal A's session is bound to its ceremony machine's residential line, so RETIRING that
   * machine refuses the session at CHECKOUT - the run halts at portal A's own gate, before portal
   * B is ever evaluated. The halt must be about portal A: the owner re-establishing portal B could
   * do it correctly for ever and the next fire would produce the identical halt.
   */
  it('a retired ceremony machine asks for the portal it was established for, never the other one', async () => {
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: LIVE_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.9:1080', live: true },
    ]);
    await seed('a_two_portals_retired', portalBThenGatedA());
    const result = await runAutomation('a_two_portals_retired', ctx);
    const run = (await automationRuns.get(result.runId)) as unknown as {
      credentialRequest?: { origin?: string; mode?: string };
      steps: Array<{ index: number; status?: string; error?: { message?: string } }>;
    };

    // Portal B was never the problem and is never disturbed by portal A's.
    expect(run.steps.find((s) => s.index === 2)?.status).toBe('completed');
    expect(result.status).toBe('needs_credentials');
    expect(run.credentialRequest?.origin).toBe(PORTAL_A);
    expect(run.credentialRequest?.origin).not.toBe(PORTAL_B);
    expect(run.credentialRequest?.mode).toBe('ceremony');
    expect(run.steps.find((s) => s.index === 3)?.error?.message ?? '')
      .toMatch(/has been removed from your account/);
    expect(contextRequests).toEqual([]);
  });

  /**
   * THE LESSER VARIANT: the ceremony machine is merely ASLEEP, not retired. Portal A's session is
   * still unusable - it is bound to that machine's line - but the halt is the NEUTRAL one, because
   * opening the laptop clears it. It must still be about portal A, and portal B still runs.
   */
  it('a ceremony machine that is merely asleep gets the neutral halt, still naming its own portal', async () => {
    setEgressCandidateResolver(async (orgId) => [
      { pairingId: CEREMONY_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.7:1080', live: false },
      { pairingId: LIVE_PAIRING, org: orgId, capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.0.9:1080', live: true },
    ]);
    await seed('a_two_portals_asleep', portalBThenGatedA());
    const result = await runAutomation('a_two_portals_asleep', ctx);
    const run = (await automationRuns.get(result.runId)) as unknown as {
      steps: Array<{ index: number; status?: string; error?: { message?: string } }>;
    };

    expect(run.steps.find((s) => s.index === 2)?.status).toBe('completed');
    expect(result.status).toBe('awaiting_daemon');
    const message = run.steps.find((s) => s.index === 3)?.error?.message ?? '';
    expect(message).toContain(PORTAL_A);
    expect(message).not.toContain(PORTAL_B);
    // A machine that is asleep has NOT been removed, and saying so would send the owner to repeat a
    // ceremony they do not need.
    expect(message).not.toMatch(/has been removed from your account/);
  });
});
