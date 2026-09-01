import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { runAutomation, type RunContext, type RunEventEmitter } from '../../src/automation/engine.js';
import {
  setDaemonConnectionResolver,
  setScopedMemoryResolver,
  setIntegrationActionDeclarationResolver,
  setIntegrationActionExecutor,
  __resetAutomationSeamsForTests,
  type DaemonStepRequest,
} from '../../src/automation/seams.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import {
  __resetCredentialWaitersForTests,
  credentialWaiterCount,
} from '../../src/automation/credential-waiters.js';
import { automations, automationRuns } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import { captureSessionWithGrant } from '../../src/cofre/index.js';
import { cofreItems, cofreGrants } from '../../src/cofre/store.js';
import { RunCredentialRequest } from '@ekoa/shared';
import type { Actor, SessionMetadata } from '@ekoa/shared';
import type { Automation, RunRecord, Step } from '../../src/automation/types.js';

/**
 * THE ONE BEHAVIOURAL FORK: an adversarial login wall halts DURABLY, a permissive one still pauses
 * (S-durable / S-login-step; docs/decisions.md 2026-08-24 D-ADHOC-5, finding
 * `ad-hoc-adversarial-browser-run-pauses-in-process-not-durably`).
 *
 * WHAT THE FINDING MEASURED, LIVE. A bridge run against Uber Eats reached the sign-in wall, the
 * detector caught it, and the run paused via `paused_for_user` - the in-process 250 ms poll. That
 * pause dies with the process: a deploy, a crash or a human who takes an hour loses it, and the run
 * has to be re-fired from the start. It also HOLDS the machine's per-owner Chromium profile for the
 * whole pause, so a second run against the same origin could not acquire the profile and timed out.
 *
 * WHAT IS REAL HERE. The engine, the persistence, `resolveStepOrigin`, `classifyOrigin`,
 * `resolveLocality`, the credential gate, the Cofre and the waiter registry. Faked: the daemon
 * connection (a recorder that answers, or refuses, whatever the case needs) and nothing else. In
 * particular the DETECTION is real - the run fails on a page whose message is a sign-in prompt, and
 * the regex fast-path classifies it, exactly as it does in production.
 *
 * WHY THE FAILING STEP IS A `browser` STEP AND THE MESSAGE COMES FROM THE MACHINE: that is the shape
 * the finding recorded - a run that reached the sign-in page and then could not act on it. The
 * resolver's answer is scripted (any valid action will do) so the step gets past the vision tier and
 * fails at the MACHINE, carrying the portal's own words; the classification of those words is the
 * real code path, which is what lets this suite pin the ROUTING with no model in the loop.
 */

const HOST = 'orders.adhoc-halt.example';
/** A SECOND undeclared adversarial portal, for the run that carries a session for the first one. */
const OTHER_HOST = 'invoices.adhoc-halt.example';
const PERMISSIVE_HOST = 'portal.permissive-halt.example';
const SIGN_IN_WALL = 'Please sign in to continue';

const ctx: RunContext = {
  ownerUserId: 'u1',
  orgId: 'o1',
  triggeredBy: 'user',
  visitedAutomationIds: new Set(),
  traceId: 't1',
};

/** The actor the engine builds from `ctx` - a session must be minted under exactly this one. */
const actor: Actor = { userId: 'u1', orgId: 'o1', role: 'user' } as Actor;

const COOKIE = 'adhoc-halt-session-cookie-0001';
const STORAGE_STATE = { cookies: [{ name: 'SESSIONID', value: COOKIE, domain: HOST, path: '/' }], origins: [] };
const METADATA: SessionMetadata = {
  establishedBy: { kind: 'cloud' },
  boundEgress: { kind: 'datacenter' },
  establishedAt: new Date().toISOString(),
  healthy: true,
} as SessionMetadata;

/** An UNDECLARED origin the run states for itself, then a step that walks into the wall. */
const adversarial: Automation = {
  id: 'auto-adversarial',
  name: 'Read my orders',
  description: '',
  ownerUserId: 'u1',
  steps: [
    { id: 's_nav', description: 'open the orders page', type: 'navigate', url: `https://${HOST}/orders` },
    { id: 's_read', description: 'read the orders list', type: 'browser' },
  ] as Step[],
  createdAt: '',
  updatedAt: '',
};

/**
 * THE SAME RUN AGAINST A DECLARED PERMISSIVE ORIGIN. Identical in every respect that matters -
 * bridge-routed, same failing step type, same sign-in message - so the ONLY thing that can explain a
 * different outcome is the posture, which is the property under test.
 */
const permissive: Automation = {
  id: 'auto-permissive',
  name: 'Read the permissive portal',
  description: '',
  ownerUserId: 'u1',
  steps: [
    {
      id: 's_int',
      description: 'open the portal',
      type: 'integration',
      integrationKey: 'friendly',
      integrationAction: 'fetch',
    },
    { id: 's_read', description: 'read the list', type: 'browser' },
  ] as Step[],
  createdAt: '',
  updatedAt: '',
};

/**
 * A run whose page was reached THROUGH a side effect. The `integration` step between the navigation
 * and the wall is what makes the resume index a safety question rather than a convenience one.
 */
const effectful: Automation = {
  id: 'auto-effectful',
  name: 'Notify then read',
  description: '',
  ownerUserId: 'u1',
  steps: [
    { id: 's_nav', description: 'open the orders page', type: 'navigate', url: `https://${HOST}/orders` },
    {
      id: 's_notify',
      description: 'tell someone we started',
      type: 'integration',
      integrationKey: 'notifier',
      integrationAction: 'send',
    },
    { id: 's_read', description: 'read the orders list', type: 'browser' },
  ] as Step[],
  createdAt: '',
  updatedAt: '',
};

/**
 * A signature ask, which no login ceremony can clear (I8).
 *
 * A `verify` step, NOT a browser step, and that is the whole point of the fixture. The kind has to
 * come from somewhere: there is no `signature` rule in the regex table, so a browser step failing
 * with signature-shaped prose yields `detectedKind === null` and the fork declines because the
 * failure was UNCLASSIFIED - which is a different reason, and would leave the exclusion untested. A
 * verifier CAN return `humanAction.kind === 'signature'`, so this drives the real kind through the
 * real detection layer and the fork then declines for the reason under test.
 */
const signatureWall: Automation = {
  id: 'auto-signature',
  name: 'Sign the thing',
  description: '',
  ownerUserId: 'u1',
  steps: [
    { id: 's_nav', description: 'open the portal', type: 'navigate', url: `https://${HOST}/sign` },
    { id: 's_sign', description: 'the document is signed', type: 'verify', expectedOutcome: 'the document is signed' },
  ] as Step[],
  createdAt: '',
  updatedAt: '',
};

/**
 * TWO PORTALS, ONE RUN. A session exists for HOST, so the gate injects it at the first navigate;
 * the wall is then hit on OTHER_HOST, which has its own session and its own answer.
 */
const twoPortals: Automation = {
  id: 'auto-two-portals',
  name: 'Read orders, then invoices',
  description: '',
  ownerUserId: 'u1',
  steps: [
    { id: 's_nav_a', description: 'open the orders page', type: 'navigate', url: `https://${HOST}/orders` },
    { id: 's_nav_b', description: 'open the invoices page', type: 'navigate', url: `https://${OTHER_HOST}/invoices` },
    { id: 's_read', description: 'read the invoices list', type: 'browser' },
  ] as Step[],
  createdAt: '',
  updatedAt: '',
};

/** A verifier verdict carrying the kind the fork must REFUSE to act on. */
const VERIFIER_SIGNATURE = JSON.stringify({
  pageClassObserved: 'assinatura com cartão',
  pageClassExpected: 'documento assinado',
  passed: false,
  reasoning: 'a página pede a assinatura com o cartão',
  cachedAssertion: null,
  humanAction: {
    kind: 'signature',
    userInstructions: 'Assine o documento com o seu cartão na janela aberta, depois clique em Continuar.',
  },
  extractedInputs: null,
});

/** How many times the run loop executed an integration ACTION. A resume that re-ran one would show
 *  up here as a second call, which is the whole point of counting. */
let integrationCalls = 0;

interface DaemonLog {
  requests: DaemonStepRequest[];
  /** Every lease op the run sent, in order. `release` is what S-profile is about. */
  leaseOps: string[];
}

/** A 1x1 PNG. Non-empty is the whole requirement: the engine refuses to run vision against a blank
 *  image, and an empty observation would fail these steps for that reason instead of the one under
 *  test. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** What the scripted resolver answers for a browser step. The ACTION does not matter - what matters
 *  is that the resolve SUCCEEDS, so the step gets as far as the machine and fails there, on the
 *  portal's words rather than on a model's. */
const RESOLVER_ANSWER = JSON.stringify({
  action: { kind: 'click', locator: { strategy: 'text', value: 'Orders' } },
  reasoning: 'abrir a lista de encomendas',
  confidence: 'high',
});

/**
 * A machine that answers every frame, except the ACTIONS of `failStepId`, which it refuses with the
 * page's own words.
 *
 * OBSERVATIONS STILL SUCCEED, deliberately: a wall is something the run walks into while acting on a
 * page it can see, which is exactly the live shape - the finding's run reached the sign-in page and
 * then could not do anything on it. Refusing the observe instead would fail the step for "no
 * screenshot", a different failure with a different message that the detector correctly ignores.
 */
function daemon(failStepId: string, failMessage = SIGN_IN_WALL): DaemonLog {
  const log: DaemonLog = { requests: [], leaseOps: [] };
  // WHERE THE FAKE BROWSER IS. It used to report `HOST/orders` however it had been navigated, which
  // made it unable to exercise the engine's landed-where-we-asked check (added 2026-08-28) and, in
  // the two-portal case below, actively contradicted the scenario the test describes.
  let at = `https://${HOST}/orders`;
  setDaemonConnectionResolver(() => ({
    pairingId: 'p-1',
    runStep: async (req: DaemonStepRequest) => {
      log.requests.push(req);
      const input = req.input as { leaseOp?: string; action?: { action?: string; url?: string } } | null;
      if (input?.leaseOp) log.leaseOps.push(input.leaseOp);
      if (input?.action?.action === 'navigate' && typeof input.action.url === 'string') at = input.action.url;
      if (req.stepId === failStepId && input?.action?.action !== 'screenshot') {
        return { ok: false, error: { message: failMessage } } as never;
      }
      return {
        ok: true,
        observation: {
          screenshotB64: PNG_1X1,
          data: {
            url: at,
            title: 'Orders',
            domShapeSketch: 'tags:|roles:|landmarks:0',
            viewport: { w: 1280, h: 800 },
          },
        },
      } as never;
    },
  }));
  return log;
}

/** Captures the two halt events so a pause and a durable halt can be told apart by what the UI saw,
 *  not only by the persisted row. */
function recordingEmitter(): {
  emit: RunEventEmitter;
  pauses: number;
  credentials: RunCredentialRequest[];
} {
  const seen = { pauses: 0, credentials: [] as RunCredentialRequest[] };
  const emit = {
    stepUpdate: () => undefined,
    runComplete: () => undefined,
    runError: () => undefined,
    runPaused: () => undefined,
    runPauseForUser: () => {
      seen.pauses += 1;
    },
    runNeedsCredentials: (_runId: string, info: RunCredentialRequest) => {
      seen.credentials.push(info);
    },
  } as unknown as RunEventEmitter;
  return {
    emit,
    get pauses() {
      return seen.pauses;
    },
    get credentials() {
      return seen.credentials;
    },
  };
}

describe('an adversarial login wall halts durably instead of pausing in process', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_adhoc_durable_halt'));
  afterAll(shutdownAgentTestDb);

  beforeEach(async () => {
    // The resolver's answer is scripted so every browser step here gets past the vision tier and
    // fails on the MACHINE, which is the only failure this suite is about.
    resetAgentState({ oneShotText: RESOLVER_ANSWER });
    __resetAutomationSeamsForTests();
    __resetCredentialWaitersForTests();
    // The hosted fallback stays OFF: every case here is about a BRIDGE-routed run, and leaving the
    // in-process route available would let a green result mean "it ran here instead".
    process.env.EKOA_AUTOMATION_LOCAL_BROWSER = 'false';
    __resetAutomationConfigForTests();
    setScopedMemoryResolver(async () => []);
    setIntegrationActionDeclarationResolver(async (key) =>
      key === 'friendly'
        ? ({ httpConfig: { baseUrl: `https://${PERMISSIVE_HOST}` }, posture: 'permissive' } as never)
        : null,
    );
    integrationCalls = 0;
    setIntegrationActionExecutor(async () => {
      integrationCalls += 1;
      return { success: true, data: { ok: true } };
    });
    for (const a of [adversarial, permissive, signatureWall, effectful, twoPortals]) {
      await automations.insert({ _id: a.id, ...a } as never);
    }
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetCredentialWaitersForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
  });

  it('halts in needs_credentials with a CEREMONY ask naming the origin, not paused_for_user', async () => {
    daemon('s_read');
    const emitter = recordingEmitter();

    const result = await runAutomation(adversarial.id, ctx, { emit: emitter.emit });

    expect(result.status).toBe('needs_credentials');
    expect(emitter.pauses).toBe(0);
    expect(emitter.credentials).toHaveLength(1);

    const ask = emitter.credentials[0]!;
    expect(ask.mode).toBe('ceremony');
    expect(ask.origin).toBe(HOST);
    // The deep link is where the human is sent, and the origin has to survive the trip: it is what
    // the Cofre page opens the ceremony for.
    expect(ask.portalDeepLink).toBe(`/cofre?origin=${encodeURIComponent(HOST)}`);
    // Composed from the host and the kind. Never the page's own words - a failure body is prose
    // this product does not echo back to a user.
    expect(ask.reason).toContain(HOST);
    expect(ask.reason).not.toContain(SIGN_IN_WALL);
  });

  it('SURVIVES A RESTART: everything a resume needs is in the store, not in a listener tick', async () => {
    daemon('s_read');

    const result = await runAutomation(adversarial.id, ctx);

    // Re-read from persistence, which is the only thing that outlives the process. A
    // `paused_for_user` run persists a `pauseRequest` and NO `credentialRequest`, and its resume is
    // an in-memory flag that a restart destroys - so these two assertions are the durability.
    const run = (await automationRuns.get(result.runId)) as unknown as RunRecord;
    expect(run.status).toBe('needs_credentials');
    expect(run.credentialRequest).toBeDefined();
    // Handed to a client verbatim, so it must satisfy the PUBLISHED shape rather than merely look
    // like it.
    expect(RunCredentialRequest.safeParse(run.credentialRequest).success).toBe(true);
  });

  it('parks a waiter, so the capture that ends the ceremony wakes the run by itself', async () => {
    daemon('s_read');

    await runAutomation(adversarial.id, ctx);

    // The fast path back. Without it a captured session sits in the Cofre and the run waits for a
    // human to press resume - which is the half of the lifecycle the ceremony exists to remove.
    expect(credentialWaiterCount()).toBe(1);
  });

  it('names the NAVIGATION as the resume point, because the page is gone by then', async () => {
    daemon('s_read');

    const result = await runAutomation(adversarial.id, ctx);

    const run = (await automationRuns.get(result.runId)) as unknown as RunRecord;
    // The human is told about the step that hit the wall...
    expect(run.credentialRequest?.stepIndex).toBe(1);
    // ...and the re-dispatch starts at the step that put the run on that page. Restarting at the
    // blocked step would drive a blank tab: this halt RETURNS the run, which disposes the browser.
    expect(run.credentialRequest?.resumeFromStepIndex).toBe(0);
  });

  /**
   * S-PROFILE, stated as the property that can actually fail.
   *
   * "The lease is released" alone proves nothing: a pause with no `resumeSignal` also returns (as
   * cancelled) and also reaches the same `finally`. The difference the finding measured is WHEN -
   * a pause holds the machine's Chromium profile for as long as the human is away, which is
   * unbounded, and a second run against that origin dies at the 120s invocation window in the
   * meantime.
   *
   * So this drives a run that CAN be paused - a `resumeSignal` that never resumes - and a
   * cancellation that only trips at a deadline. A durable halt must be out, with the lease given
   * back, LONG before that deadline; the paused run can only get out by hitting it. The clock is
   * the assertion, and the margin (a ~150 ms run against a 3 s deadline) is what keeps it honest
   * rather than flaky.
   */
  it('gives the machine profile back WITHOUT waiting for the human - the S-profile contention', async () => {
    const log = daemon('s_read');
    const cancelAt = Date.now() + 3_000;
    const patientCtx: RunContext = {
      ...ctx,
      resumeSignal: { shouldResume: () => false, clear: () => undefined },
      cancellation: { isCancelled: () => Date.now() >= cancelAt },
    } as RunContext;

    const result = await runAutomation(adversarial.id, patientCtx);

    expect(result.status).toBe('needs_credentials');
    // Out, and the machine's profile handed back, without a human having done anything.
    expect(Date.now()).toBeLessThan(cancelAt);
    expect(log.leaseOps).toContain('release');
  });

  it('...whereas the pause it replaces sits on that profile until somebody answers', async () => {
    daemon('s_read');
    const cancelAt = Date.now() + 3_000;
    const patientCtx: RunContext = {
      ...ctx,
      resumeSignal: { shouldResume: () => false, clear: () => undefined },
      cancellation: { isCancelled: () => Date.now() >= cancelAt },
    } as RunContext;

    // The permissive twin, which still takes the in-process pause. It gets out ONLY because the
    // cancellation eventually trips - i.e. it spent that whole window inside the run loop holding
    // the lease. That is the behaviour the adversarial path no longer has, and the pair is what
    // makes the case above mean something.
    const result = await runAutomation(permissive.id, patientCtx);

    expect(result.status).toBe('cancelled');
    expect(Date.now()).toBeGreaterThanOrEqual(cancelAt);
  });

  /**
   * THE SATISFIED-GUARD IS ABOUT AN ORIGIN, NOT ABOUT A RUN (review round F2/F4).
   *
   * `sessionState` is one variable for a whole run. A run that checked a session out at portal A and
   * then walks into a sign-in wall at portal B would, on a run-scoped guard, answer B with A's
   * session: it would mark a genuine login wall "already signed in", stamp that false claim onto B's
   * step record, and pre-empt the durable fork for an origin that qualifies for it.
   */
  it('does NOT answer a second portal with the first portal\'s session', async () => {
    await captureSessionWithGrant(actor, {
      label: HOST,
      boundOrigins: [HOST],
      storageState: STORAGE_STATE,
      metadata: METADATA,
    });
    const log = daemon('s_read');
    const emitter = recordingEmitter();

    const result = await runAutomation(twoPortals.id, ctx, { emit: emitter.emit });

    // Non-vacuous: the run really is carrying HOST's session when it reaches OTHER_HOST's wall.
    expect(log.requests[0]?.sessionState).toEqual(STORAGE_STATE);
    // And the wall at the OTHER portal gets the durable halt, naming that portal - not a silent
    // "already signed in" on a session that has nothing to do with it.
    expect(result.status).toBe('needs_credentials');
    expect(emitter.credentials).toHaveLength(1);
    expect(emitter.credentials[0]!.origin).toBe(OTHER_HOST);
  });

  it('a PERMISSIVE origin still pauses in process - the fork is real, not global', async () => {
    daemon('s_read');
    const emitter = recordingEmitter();

    const result = await runAutomation(permissive.id, ctx, { emit: emitter.emit });

    // Same routing, same failing step, same message; only the declared posture differs.
    expect(emitter.pauses).toBe(1);
    expect(emitter.credentials).toEqual([]);
    // No `resumeSignal` on this ctx, so the pause resolves immediately as "not resumed" and the run
    // cancels. What matters is which of the two roads it took, and `needs_credentials` is not it.
    expect(result.status).toBe('cancelled');
    const run = (await automationRuns.get(result.runId)) as unknown as RunRecord;
    expect(run.credentialRequest).toBeUndefined();
    expect(credentialWaiterCount()).toBe(0);
  });

  it('REFUSES to rewind over a side effect: the resume point is the blocked step instead', async () => {
    daemon('s_read');

    const result = await runAutomation(effectful.id, ctx);

    expect(result.status).toBe('needs_credentials');
    const run = (await automationRuns.get(result.runId)) as unknown as RunRecord;
    // A navigate DOES sit before the wall, but reaching it means stepping back over an integration
    // action - an effect on the user's behalf. Recovering a PAGE by sending a second email is not a
    // trade this halt is allowed to make, so it gives up and resumes where every other credential
    // halt resumes: the blocked step. That resume may fail on a blank page, which is bounded and
    // explainable; a duplicated side effect is neither.
    expect(run.credentialRequest?.stepIndex).toBe(2);
    expect(run.credentialRequest?.resumeFromStepIndex).toBe(2);
    // Non-vacuous: the run really did execute the side effect once on the way in.
    expect(integrationCalls).toBe(1);
  });

  /**
   * I8, PINNED ON THE EXCLUSION ITSELF. The earlier version of this case asserted only that an
   * UNCLASSIFIED failure produces no ceremony - true, and unrelated: adding `signature` to
   * `CEREMONY_CLEARABLE_HUMAN_ACTIONS` left it green, so it guarded nothing. This one makes the
   * verifier return `kind: 'signature'`, so the kind reaches the fork and the fork declines because
   * signature is EXCLUDED. A signature is an act of legal authorship bound to the card in the reader
   * in front of a named person; routing it to a session-capture rail would offer "a human completed
   * a ceremony" as evidence for it, which is exactly what I8 forbids.
   */
  it('a SIGNATURE ask never takes the halt - no ceremony captures a signature (I8)', async () => {
    // The verifier's verdict is what carries the kind, so the resolver script is swapped for it.
    resetAgentState({ oneShotText: VERIFIER_SIGNATURE });
    daemon('s_nothing_fails');
    const emitter = recordingEmitter();

    const result = await runAutomation(signatureWall.id, ctx, { emit: emitter.emit });

    // Non-vacuous: the verifier's SIGNATURE kind actually reached the record. Without this the
    // assertions below would pass for an unclassified failure, which is what the earlier version of
    // this case was silently doing.
    const run = (await automationRuns.get(result.runId)) as unknown as RunRecord;
    expect(run.steps.find((x) => x.index === 1)?.humanAction?.kind).toBe('signature');
    // No ceremony was opened...
    expect(emitter.credentials).toEqual([]);
    expect(result.status).not.toBe('needs_credentials');
    // ...and the run DID reach the detection block and take the ordinary human pause, which is what
    // makes the assertion above about the exclusion rather than about nothing happening at all.
    expect(emitter.pauses).toBe(1);
  });
});

describe('a re-dispatched run does not ask the human to log in twice', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_adhoc_login_step'));
  afterAll(shutdownAgentTestDb);

  beforeEach(async () => {
    // The resolver's answer is scripted so every browser step here gets past the vision tier and
    // fails on the MACHINE, which is the only failure this suite is about.
    resetAgentState({ oneShotText: RESOLVER_ANSWER });
    __resetAutomationSeamsForTests();
    __resetCredentialWaitersForTests();
    process.env.EKOA_AUTOMATION_LOCAL_BROWSER = 'false';
    __resetAutomationConfigForTests();
    setScopedMemoryResolver(async () => []);
    setIntegrationActionDeclarationResolver(async () => null);
    await automations.insert({ _id: adversarial.id, ...adversarial } as never);
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetCredentialWaitersForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
  });

  /**
   * THE INFINITE LOOP THIS CLOSES, measured live and written down as gap (b) of the finding.
   *
   * The human completes the ceremony, the capture lands, the run is re-dispatched with the session
   * injected - and comes back to the same sign-in step, now on an authenticated page. Asked to
   * PERFORM a sign-in there, the resolver finds no such action and refuses; every layer above reads
   * that as "a human is needed", and the run asks again. Before this guard the ceremony made it
   * WORSE than the old pause, because each round of the loop now cost a walk to a machine.
   */
  it('completes instead of halting again when the run was given a session for this origin', async () => {
    await captureSessionWithGrant(actor, {
      label: HOST,
      boundOrigins: [HOST],
      storageState: STORAGE_STATE,
      metadata: METADATA,
    });
    const log = daemon('s_read');
    const emitter = recordingEmitter();

    const result = await runAutomation(adversarial.id, ctx, { emit: emitter.emit });

    // Neither road: not a second ceremony, not a pause. The platform answered the question itself.
    expect(emitter.credentials).toEqual([]);
    expect(emitter.pauses).toBe(0);
    expect(result.status).toBe('completed');
    // The assertion is non-vacuous only if the session actually reached the machine - otherwise this
    // would be testing a run that never had one.
    expect(log.requests[0]?.sessionState).toEqual(STORAGE_STATE);

    const run = (await automationRuns.get(result.runId)) as unknown as RunRecord;
    const loginStep = run.steps.find((s) => s.index === 1);
    // Recorded as done, and SAYING WHY. A step that silently vanished from the timeline would make
    // the next failure unreadable.
    expect(loginStep?.status).toBe('completed');
    expect(loginStep?.visionReasoning).toMatch(/stored session/i);
  });

  it('finds the session behind a {{config.*}} address too - the gate reads the EXECUTED view (found live, 2026-09-01)', async () => {
    // The same shape with its address AUTHORED AS A TEMPLATE - which is every shipped package with
    // a portal_url config field. The gate used to walk the AUTHORED steps, parse no origin out of
    // the placeholder, and never look the session up at all: the run drove into the wall the
    // ceremony had already answered, and halted asking for it again.
    await captureSessionWithGrant(actor, {
      label: HOST,
      boundOrigins: [HOST],
      storageState: STORAGE_STATE,
      metadata: METADATA,
    });
    const templated: Automation = {
      ...adversarial,
      id: 'auto-templated',
      steps: [
        { id: 's_nav', description: 'open the orders page', type: 'navigate', url: '{{config.portal_url}}/orders' },
        { id: 's_read', description: 'read the orders list', type: 'browser' },
      ] as Step[],
    };
    await automations.insert({ _id: templated.id, ...templated } as never);
    const log = daemon('s_read');
    const emitter = recordingEmitter();

    const result = await runAutomation(
      templated.id,
      { ...ctx, configValues: { portal_url: `https://${HOST}` } },
      { emit: emitter.emit },
    );

    expect(emitter.credentials).toEqual([]);
    expect(result.status).toBe('completed');
    expect(log.requests[0]?.sessionState).toEqual(STORAGE_STATE);
  });

  it('still halts when the run has NO session - the guard is about the session, not the step', async () => {
    // Same automation, same wall, nothing captured. If this passed too, the guard above would be
    // walking past every login wall rather than answering one it already had the answer to.
    daemon('s_read');
    const emitter = recordingEmitter();

    const result = await runAutomation(adversarial.id, ctx, { emit: emitter.emit });

    expect(result.status).toBe('needs_credentials');
    expect(emitter.credentials).toHaveLength(1);
  });
});
