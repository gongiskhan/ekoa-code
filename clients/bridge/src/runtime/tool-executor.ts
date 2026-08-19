/**
 * runtime/tool-executor.ts - the daemon actually RUNS a step now (P1.2).
 *
 * WHAT THIS REPLACES. `tool.invoke` used to be answered with a named refusal, and that refusal was
 * deliberate rather than lazy: executing a step on someone's machine on a remote instruction is an
 * exfiltration-capable surface, and turning it on before the gates existed would have been a
 * promise the code could not keep. The gates now exist, so the refusal becomes an executor.
 *
 * TWO GATES, IN ORDER, BOTH FAIL CLOSED.
 *
 *  1. ADVERTISEMENT. A capability this daemon does not advertise is refused outright. `local.bash`
 *     and `desktop.automation` are OFF by default (`resolveCapabilities` adds them only from an
 *     explicit `extraCapabilities` opt-in in the config file, which is an edit made by the human at
 *     the machine). This is the operator's switch, and it is per-capability: a machine that opted
 *     into browsing has not opted into a shell.
 *
 *  2. TIER-2 ENABLEMENT. The ADR-002 per-session check, the same one `tools/tier2/bash.ts` applies,
 *     runs before ANY step - bash or browser. Both are exfiltration-capable (a shell can curl, a
 *     browser can POST), so both sit behind it. Its stance is recorded in `docs/decisions.md`: today
 *     the enablement is DERIVED from gate 1 (serve.ts enables the bridge session exactly when the
 *     operator advertised a tier-2 capability), so it is defence-in-depth and a single flip point
 *     for a future runtime toggle, NOT an independent second factor. Saying that plainly is the
 *     point of the decision entry - an unenabled session is still refused and ledgered here, which
 *     is what makes the check live rather than decorative.
 *
 * Every refusal is LEDGERED (ADR-002: every invocation, with its detail) and answered with a
 * `tool.result{ok:false}` - never silence. Cortex waits out a full invocation timeout on silence
 * and then reports "the machine did not answer in time", which tells the user nothing true.
 */
import {
  LocalBashStepInput,
  LocalBrowserStepInput,
  LocalToolInvokeInput,
  type BridgeCapability,
  type LocalBashObservation,
  type LocalBrowserCaptureOp,
  type LocalBrowserInjectedCall,
  type LocalBrowserLeaseOp,
  type LocalBrowserObservation,
} from '../wire/index.js';
import {
  describeStepFailure,
  observePage,
  parseSessionState,
  runBrowserAction,
  runInjectedCall,
  NetworkRecorder,
  ProfileManager,
  type CapturePage,
} from '../browser/index.js';
import type { GrantTable } from '../session/index.js';
import type { EgressLedger } from '../ledger/index.js';
import { bashArgv, ledgerAutomation, Tier2Error, type AutomationEnablement, type Tier2Context } from '../tools/tier2/index.js';
import type { SecretHold } from './secret-hold.js';

/** What a step invocation produces. Mapped straight onto a `tool.result` frame by the caller. */
export interface ToolExecutionResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  /** Raw base64 PNG (P1.4). Present for browser steps that captured one. */
  screenshotB64?: string;
}

export interface ToolExecutorDeps {
  /** What this machine ADVERTISED. Gate 1 is membership in this list. */
  capabilities: readonly BridgeCapability[];
  enablement: AutomationEnablement;
  /** The enablement/ledger session for bridge-invoked tier-2 work (one per pairing). */
  session: string;
  ledger: EgressLedger;
  grants: GrantTable;
  profiles: ProfileManager;
  /** RAM-held credential material for the matching invocationId, injected at spawn and zeroized. */
  secrets: SecretHold;
  /**
   * Where a bash step runs when its own step names no grant - `<EKOA_BRIDGE_HOME>/work`.
   *
   * Without this the jail is VACUOUS for exactly the traffic Cortex sends today: `local-command.ts`
   * carries no `grantRef`, so there would be no root to resolve against, and the child would
   * inherit THE DAEMON'S OWN PROCESS CWD - whatever directory the LaunchAgent or systemd unit
   * happened to start it in, unbounded and different on every machine. A private, predictable root
   * makes containment a property of every bash step rather than only of the ones that name a grant.
   */
  defaultWorkRoot?: string;
  /** The profile the run targets - an integration/origin key when the run carries one, else the
   *  pairing (so a machine with no integration context still gets ONE stable profile, not a new
   *  one per run). */
  profileIdFor?: (input: { capability: 'browser' | 'bash'; runId: string; owner?: string }) => string;
  /** The Cofre session to wear for this run, when Cortex supplied one. */
  sessionStateFor?: (runId: string) => unknown;
  /**
   * The machine's OUTBOUND redaction leg, applied to every captured body before it can ride a frame
   * (slice P2.2, trap T8). It is the daemon's `OutboundRedactor.redactText`, which knows every
   * credential value delivered TO this machine.
   *
   * Injected rather than reached for, and optional, because it is one of TWO independent legs:
   * this one knows what was DELIVERED here, the hosted `SecretRegistry` knows what the RUN resolved,
   * and neither is a superset of the other. A daemon wired without it still captures - the hosted
   * leg and the store's own refusal still stand - it simply contributes nothing of its own.
   */
  redactOutbound?: (text: string) => string;
  now?: () => number;
  log?: (message: string) => void;
}

/** Capability -> the advertised name that authorises it. */
const REQUIRED_CAPABILITY: Record<'browser' | 'bash', BridgeCapability> = {
  browser: 'desktop.automation',
  bash: 'local.bash',
};

export async function executeToolInvocation(
  frame: { invocationId: string; capability: BridgeCapability; input?: unknown },
  deps: ToolExecutorDeps,
): Promise<ToolExecutionResult> {
  const ctx: Tier2Context = {
    ledger: deps.ledger,
    enablement: deps.enablement,
    session: deps.session,
    ...(deps.now ? { now: deps.now } : {}),
  };

  const parsed = LocalToolInvokeInput.safeParse(frame.input);
  if (!parsed.success) {
    // A malformed envelope names no capability we can attribute the denial to, so it is ledgered
    // under the frame's declared one and refused with a message that does not echo the payload.
    ledgerAutomation(ctx, capabilityTool(frame.capability), frame.capability, 'denied', undefined, 'invalid step envelope');
    return { ok: false, error: `pedido inválido para a capacidade ${frame.capability}` };
  }
  const envelope = parsed.data;

  // ---- Gate 1: advertisement -------------------------------------------------
  const required = REQUIRED_CAPABILITY[envelope.capability];
  if (frame.capability !== required) {
    // Cortex routed the step under a capability that does not match what it contains. Refuse
    // rather than trust the payload: the capability is what the org GRANTED, and honouring the
    // body over the grant would make the grant advisory.
    ledgerAutomation(ctx, capabilityTool(frame.capability), envelope.capability, 'denied', undefined, 'capability mismatch');
    return { ok: false, error: `a capacidade ${frame.capability} não corresponde ao passo pedido` };
  }
  if (!deps.capabilities.includes(required)) {
    ledgerAutomation(ctx, capabilityTool(frame.capability), envelope.capability, 'denied', undefined, 'capability not advertised');
    return { ok: false, error: `esta máquina não oferece a capacidade ${required}` };
  }

  // ---- Gate 2: tier-2 enablement --------------------------------------------
  if (!deps.enablement.isEnabled(deps.session)) {
    ledgerAutomation(ctx, capabilityTool(frame.capability), envelope.capability, 'denied', undefined, 'automation tier not enabled for this session');
    return { ok: false, error: 'a automação local não está activada nesta máquina' };
  }

  return envelope.capability === 'browser'
    ? runBrowserStep(envelope, ctx, deps)
    : runBashStep(frame.invocationId, envelope, ctx, deps);
}

// ---------------------------------------------------------------------------
// browser
// ---------------------------------------------------------------------------

async function runBrowserStep(
  envelope: LocalToolInvokeInput,
  ctx: Tier2Context,
  deps: ToolExecutorDeps,
): Promise<ToolExecutionResult> {
  const parsed = LocalBrowserStepInput.safeParse(envelope.input);
  if (!parsed.success) {
    ledgerAutomation(ctx, 'browser', 'invalid', 'denied', undefined, 'invalid browser step');
    return { ok: false, error: 'passo de navegador inválido' };
  }
  const { owner } = parsed.data;

  // THE PROFILE IS RESOLVED FIRST, for every frame including the lifecycle ones. It is what scopes
  // a frame to an owner: `runs` is a process-wide map keyed by an opaque string, so a `release`
  // handled before this point could end a lease belonging to somebody else by naming its id. Page
  // verbs were always scoped this way (they act on the profile's own page); the lifecycle verbs are
  // now no weaker than the verbs they end.
  const profileId = deps.profileIdFor
    ? deps.profileIdFor({ capability: 'browser', runId: envelope.runId, owner })
    : owner;
  // The lease this frame belongs to. It is NOT the runId: one lease spans a run AND every
  // sub-automation run beneath it (see `LocalBrowserStepInput`). Absent from an older Cortex, and
  // the runId is then the honest fallback - one lease per run, which is what that Cortex means.
  const leaseId = parsed.data.leaseId ?? envelope.runId;

  if ('leaseOp' in parsed.data) return await runLeaseOp(parsed.data.leaseOp, leaseId, profileId, ctx, deps);
  if ('captureOp' in parsed.data) return await runCaptureOp(parsed.data.captureOp, leaseId, profileId, ctx, deps);
  if ('injectedCall' in parsed.data) {
    return await runInjectedCallOp(parsed.data.injectedCall, leaseId, profileId, envelope.runId, ctx, deps);
  }

  const { action } = parsed.data;
  try {
    // ONE LEASE FOR THE WHOLE RUN. Cortex sends one invoke per act/assert/observe, so a lease taken
    // and released per FRAME closed the page and cleared the jar between every pair of steps - each
    // step after the first ran on a fresh about:blank, signed out. `withRunLease` keys the lease by
    // leaseId: the first step takes it, every later step naming it gets the same page back, and the
    // teardown happens at the `release` lifecycle op (`runLeaseOp` below) or, if Cortex went away,
    // at the daemon's idle backstop.
    //
    // ACQUIRE STILL SERIALISES per profile, so a second LEASE on the same profile now queues for the
    // duration of the first one rather than interleaving with it - which is the correct reading of
    // one browser, one jar. The backstop bounds that wait. A sub-automation is NOT a second lease:
    // it names its parent's, which is why it does not queue behind a lease its parent is waiting on.
    return await deps.profiles.withRunLease(
      {
        leaseId,
        profileId,
        // A THUNK: the Cofre session is resolved only when the lease is actually taken, i.e. on the
        // first step of the run. Re-resolving it per step would re-read credential material for a
        // jar that already carries it.
        session: () => parseSessionState(deps.sessionStateFor?.(envelope.runId)),
      },
      async (lease) => {
        const page = await lease.page();
        // RE-ATTACH ON EVERY ACT, not only on `captureOp:'start'`. A navigation can replace the
        // page object underneath a lease, and a recorder still listening to the old one records
        // nothing while reporting success - a discovery pass that silently learns nothing. `attach`
        // is a no-op when the page has not changed, so this costs nothing on the common path.
        recorderFor(leaseId, deps)?.attach(page as unknown as CapturePage);
        let assertionPassed: boolean | undefined;
        let failure: string | undefined;
        try {
          assertionPassed = await runBrowserAction(page, action);
          if (action.action === 'navigate') {
            // The session's localStorage half can only be seeded once an origin is loaded - a
            // persistent context takes no storageState. Cookies already landed at acquire.
            await lease.seedStorageForCurrentOrigin(page);
          }
        } catch (err) {
          failure = describeStepFailure(action, err, safeUrl(page.url.bind(page)));
        }

        // OBSERVE EVEN ON FAILURE. The hosted vision fallback resolves the NEXT attempt from the
        // page as it actually is; handing it nothing because the action threw is what turns one
        // failed step into a stalled run.
        const observation = await observePage(page);
        // DRAIN AFTER THE OBSERVATION, not before: the requests an act provoked are still landing
        // while the page settles, and observing first is what gives them time to arrive. They ride
        // the frame of the act that caused them, which is what makes a capture attributable.
        const captures = recorderFor(leaseId, deps)?.drain() ?? [];
        const data: LocalBrowserObservation = {
          ...observation.data,
          ...(assertionPassed !== undefined ? { assertionPassed } : {}),
          ...(captures.length > 0 ? { captures } : {}),
        };

        ledgerAutomation(
          ctx,
          'browser',
          action.action,
          failure ? 'error' : 'ran',
          undefined,
          failure ?? undefined,
        );

        return {
          ok: failure === undefined && assertionPassed !== false,
          output: data,
          ...(failure !== undefined ? { error: failure } : {}),
          ...(observation.screenshotB64 ? { screenshotB64: observation.screenshotB64 } : {}),
        };
      },
    );
  } catch (err) {
    // A launch that failed, a manager already shut down, a lease the idle backstop reaped, or a
    // frame naming a lease on another owner's profile. All of them are reported by name rather than
    // degraded into a step that "ran" on nothing.
    const reason = errorText(err);
    ledgerAutomation(ctx, 'browser', action.action, 'error', undefined, reason);
    return { ok: false, error: reason };
  }
}

/**
 * The two LIFECYCLE operations on a lease. Neither touches a page, which is why both are answered
 * before a profile context is ever needed: there is nothing to act on and nothing to observe, and a
 * release that had to open a browser in order to end a run would be absurd. Both still passed the
 * advertisement and tier-2 gates above, and both are LEDGERED, because both are still remote
 * instructions about state on this machine - and the pair of them is the audit record of how long
 * this machine held an authenticated browser session for a given run.
 */
async function runLeaseOp(
  op: LocalBrowserLeaseOp,
  leaseId: string,
  profileId: string,
  ctx: Tier2Context,
  deps: ToolExecutorDeps,
): Promise<ToolExecutionResult> {
  if (op === 'keepalive') {
    try {
      const held = deps.profiles.touchRun(leaseId, { profileId });
      ledgerAutomation(ctx, 'browser', 'keepalive', 'ran');
      // `held:false` is the honest answer for a lease this machine no longer has - Cortex asked to
      // keep something alive that is already gone. Saying so beats a bare ok, which would let a run
      // believe its session is still resident right up until its next step is refused.
      return { ok: true, output: { held } };
    } catch (err) {
      const reason = errorText(err);
      ledgerAutomation(ctx, 'browser', 'keepalive', 'denied', undefined, reason);
      return { ok: false, error: reason };
    }
  }

  // END OF RUN. The one moment a whole run's injected session leaves a jar that outlives it - and
  // therefore the moment the capture buffer must go too. The recorder holds the live header VALUES
  // an injected replay forwards; a buffer that survived its lease would be remembered credentials
  // for a session that no longer exists. Dropped BEFORE the release is attempted, so even a release
  // that fails cannot leave one behind.
  disposeNetworkRecorder(leaseId);
  try {
    await deps.profiles.releaseRun(leaseId, { profileId });
  } catch (err) {
    // A FAILED WIPE IS NOT A SUCCESSFUL RELEASE. Swallowing this (which is what a
    // `.catch(() => undefined)` here did) meant the daemon answered `ok:true` and Cortex recorded a
    // run that ended cleanly, while an authenticated Cofre session stayed resident in a profile the
    // user's next automation shares. It is ledgered as an error on this machine and reported as a
    // failed step on the wire, so it is visible at both ends.
    const reason = errorText(err);
    ledgerAutomation(ctx, 'browser', 'release', 'error', undefined, reason);
    deps.log?.(`Aviso: não foi possível terminar limpamente a sessão de navegador de uma execução (${reason}).`);
    return { ok: false, error: reason };
  }
  ledgerAutomation(ctx, 'browser', 'release', 'ran');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// network capture (P2.2) + injected-call replay (P2.3)
// ---------------------------------------------------------------------------

/**
 * leaseId -> its network recorder. Process-local and keyed exactly as the lease is, so a recorder
 * has the lifetime of the authenticated jar it observes and no longer.
 *
 * A MAP RATHER THAN A FIELD ON THE LEASE, deliberately: `ProfileLease` is the profile module's
 * contract and describes a browser profile, not a learning pass. Capture is armed by exactly one
 * caller on a small minority of leases, and threading an always-absent recorder through the profile
 * manager's whole lifecycle would make every lease carry a concern that belongs to one phase.
 *
 * ── EVERY EXIT DROPS IT, NOT JUST THE POLITE ONE ─────────────────────────────────────────────
 *
 * The recorder holds the live header VALUES an injected replay forwards. There are FOUR ways the
 * thing it is observing can end, and all four dispose it:
 *
 *   1. `captureOp:'stop'`               - the hosted side disarming (`runCaptureOp`);
 *   2. `leaseOp:'release'`              - end of run (`runLeaseOp`);
 *   3. the daemon's IDLE BACKSTOP       - nobody sent a frame; `ProfileManager` reaps the lease;
 *   4. daemon SHUTDOWN                  - `closeAll` releases every live lease.
 *
 * 3 and 4 send no frame at all, so wiring only 1 and 2 - which is what the first version of this
 * slice did - left a remembered credential resident for the lifetime of the process. They are
 * covered by `ProfileManager.onLeaseEnd`, which all three lease-ending routes funnel through, and
 * the hook is registered HERE, at the moment the recorder is created (`runCaptureOp`), rather than
 * at the composition root: whoever makes a per-lease holding registers its disposal in the same
 * breath, so there is no second file to remember to edit.
 */
const recorders = new Map<string, NetworkRecorder>();

function recorderFor(leaseId: string, _deps: ToolExecutorDeps): NetworkRecorder | undefined {
  return recorders.get(leaseId);
}

/**
 * The lease's recorder, CREATED if it has none.
 *
 * Two callers with different reasons and one object: `captureOp:'start'` wants exchanges handed
 * back (`buffer: true`), a REPLAY wants only the live header map (`buffer: false` - nothing drains
 * a replay's recorder, so buffering there would pile up bodies no code can read). A lease that does
 * both gets one recorder listening once, upgraded rather than duplicated.
 *
 * THE DISPOSAL IS REGISTERED HERE, in the same breath as the creation, because `releaseRun` is the
 * single funnel every lease-ending route lands on - including the two that send no frame (the idle
 * backstop and shutdown). This is the only place a recorder comes into existence, so it is the only
 * place that has to remember.
 */
function ensureRecorder(leaseId: string, deps: ToolExecutorDeps, opts: { buffer: boolean }): NetworkRecorder {
  const existing = recorders.get(leaseId);
  if (existing) {
    if (opts.buffer) existing.setBuffering(true);
    return existing;
  }
  const recorder = new NetworkRecorder({
    // The machine's own redaction leg: the outbound redactor already knows every credential this
    // daemon was delivered, so a body carrying one is masked before it can ride a frame.
    ...(deps.redactOutbound ? { redactBody: deps.redactOutbound } : {}),
    buffer: opts.buffer,
  });
  recorders.set(leaseId, recorder);
  deps.profiles.onLeaseEnd(leaseId, () => disposeNetworkRecorder(leaseId));
  return recorder;
}

/**
 * Drop one lease's recorder and the live header values in it. Idempotent, and safe to call for a
 * lease that never armed one - which is the common case, since it is bound to EVERY lease's end.
 */
export function disposeNetworkRecorder(leaseId: string): void {
  const recorder = recorders.get(leaseId);
  if (!recorder) return;
  recorder.detach();
  recorders.delete(leaseId);
}

/** Whether a lease currently holds a recorder. Exported for the suite, which has to be able to
 *  assert the ABSENCE of one after an idle reap - a property with no other observable. */
export function hasNetworkRecorder(leaseId: string): boolean {
  return recorders.has(leaseId);
}

/**
 * ARM or DISARM the network recorder for a lease.
 *
 * `start` takes the lease (so the page exists to listen to) and attaches. It is idempotent: a
 * second `start` re-attaches to the current page rather than doubling every exchange.
 *
 * Ledgered like every other remote instruction about this machine, and named in the ledger, because
 * "a remote party asked this machine to record every request an authenticated page makes" is
 * precisely the kind of thing an audit trail exists for.
 */
async function runCaptureOp(
  op: LocalBrowserCaptureOp,
  leaseId: string,
  profileId: string,
  ctx: Tier2Context,
  deps: ToolExecutorDeps,
): Promise<ToolExecutionResult> {
  if (op === 'stop') {
    disposeNetworkRecorder(leaseId);
    ledgerAutomation(ctx, 'browser', 'capture:stop', 'ran');
    return { ok: true, output: {} };
  }
  try {
    return await deps.profiles.withRunLease({ leaseId, profileId }, async (lease) => {
      const page = await lease.page();
      // `buffer: true` - this caller is the one that wants the exchanges themselves. It also
      // UPGRADES a values-only recorder a replay armed earlier on the same lease.
      const recorder = ensureRecorder(leaseId, deps, { buffer: true });
      recorder.attach(page as unknown as CapturePage);
      ledgerAutomation(ctx, 'browser', 'capture:start', 'ran');
      return { ok: true, output: {} };
    });
  } catch (err) {
    const reason = errorText(err);
    ledgerAutomation(ctx, 'browser', 'capture:start', 'error', undefined, reason);
    return { ok: false, error: reason };
  }
}

/**
 * REPLAY ONE LEARNED CALL inside the authenticated page.
 *
 * The result rides `observation.data.injectedCall` rather than a bespoke envelope so it lands in the
 * same slot every other browser frame's payload does - `DaemonBrowserSession.ingest` already reads
 * that object, and a second envelope shape would be a second thing to keep in step.
 *
 * NO PAGE OBSERVATION is taken here, and that is not an omission: an injected call does not touch
 * the DOM, so a screenshot and a fingerprint after it would be the same page as before it, taken at
 * the cost of a screenshot per call. A replay of twelve calls would pay twelve of them for nothing.
 *
 * ── A RECORDER IS ARMED EVEN THOUGH NOTHING WILL BE CAPTURED ─────────────────────────────────
 *
 * `runInjectedCall` navigates the page onto the call's origin (see `browser/inject.ts` for why that
 * is the whole mechanism and not a detail), and loading the origin runs the site's own JavaScript,
 * which authenticates and calls its own API. THAT traffic is where the current value of every
 * header name the recipe learned comes from - so a recorder has to be listening before the
 * navigation, or the names arrive with nothing to fill them and the replay sends an unauthenticated
 * request. It is armed values-only: nothing drains a replay's recorder.
 *
 * The first cut read `recorders.get(leaseId)` and forwarded `{}` when it found nothing, which on a
 * replay lease is always - so `headerNames`, the single most valuable thing a capture learns, was
 * decorative on the one path that exists to use it.
 */
async function runInjectedCallOp(
  call: LocalBrowserInjectedCall,
  leaseId: string,
  profileId: string,
  runId: string,
  ctx: Tier2Context,
  deps: ToolExecutorDeps,
): Promise<ToolExecutionResult> {
  try {
    return await deps.profiles.withRunLease(
      { leaseId, profileId, session: () => parseSessionState(deps.sessionStateFor?.(runId)) },
      async (lease) => {
        const page = await lease.page();
        // BEFORE the call, so the navigation `runInjectedCall` performs is observed and the live
        // header values it provokes are in the map by the time the call asks for them.
        const recorder = ensureRecorder(leaseId, deps, { buffer: false });
        recorder.attach(page as unknown as CapturePage);
        const result = await runInjectedCall(page, call, (origin, names) =>
          recorder.headerValuesFor(origin, names),
        );
        ledgerAutomation(ctx, 'browser', 'inject', result.ok ? 'ran' : 'error');
        const data: LocalBrowserObservation = { url: safeUrl(page.url.bind(page)), injectedCall: result };
        // `ok` follows the STEP, not the HTTP status: a 404 from a replayed call ran perfectly and
        // is a drift signal the hosted side classifies (`automation/self-heal.ts`). Collapsing the
        // two here would send every drift back as a machine failure.
        return { ok: true, output: data };
      },
    );
  } catch (err) {
    const reason = errorText(err);
    ledgerAutomation(ctx, 'browser', 'inject', 'error', undefined, reason);
    return { ok: false, error: reason };
  }
}

/** A thrown value as one line of text. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// bash
// ---------------------------------------------------------------------------

async function runBashStep(
  invocationId: string,
  envelope: LocalToolInvokeInput,
  ctx: Tier2Context,
  deps: ToolExecutorDeps,
): Promise<ToolExecutionResult> {
  const parsed = LocalBashStepInput.safeParse(envelope.input);
  if (!parsed.success) {
    ledgerAutomation(ctx, 'bash', 'invalid', 'denied', undefined, 'invalid bash step');
    return { ok: false, error: 'comando local inválido' };
  }
  const step = parsed.data;

  // The root that bounds the cwd. A named grantRef must belong to THIS session (S2); a forged or
  // foreign ref REFUSES the step. It must not resolve to `undefined` and fall through, because the
  // options spread below omits an undefined grantRoot entirely - which drops the jail rather than
  // narrowing it, and hands the child the daemon's own process cwd. Naming a grant you do not hold
  // has to be worse than naming none, never better. An unnamed step falls back to the session's
  // single grant when it has exactly one, and to the daemon's own work root otherwise, so every
  // bash step is bounded rather than only the declared ones.
  let grantRoot: string;
  if (step.grantRef !== undefined) {
    const named = deps.grants.grantFor(step.grantRef, deps.session)?.root;
    if (named === undefined) {
      ledgerAutomation(ctx, 'bash', 'invalid', 'denied', undefined, 'unresolvable grantRef');
      return { ok: false, error: 'a permissão de acesso indicada não existe nesta sessão' };
    }
    grantRoot = named;
  } else {
    // `defaultWorkRoot` is optional on the deps, so this can still come back empty - and an empty
    // root is the same fail-open as an unresolvable ref, by a quieter route. Refuse instead: a
    // daemon wired without a work root has nowhere safe to put a child process, and running it in
    // whatever directory the daemon happens to sit in is not an answer.
    const fallback = resolveGrantRoot(deps.grants, deps.session) ?? deps.defaultWorkRoot;
    if (fallback === undefined) {
      ledgerAutomation(ctx, 'bash', 'invalid', 'denied', undefined, 'no grant root available');
      return { ok: false, error: 'esta máquina não tem uma pasta de trabalho autorizada' };
    }
    grantRoot = fallback;
  }

  try {
    // The secret hold is consumed HERE and nowhere else, and its `finally` zeroizes whatever
    // happens to the child. A step with no delivery gets an empty injection and the same path.
    const result = await deps.secrets.withChildEnv(invocationId, (injected) =>
      bashArgv(ctx, step.argv, {
        ...(step.cwd !== undefined ? { cwd: step.cwd } : {}),
        grantRoot,
        ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}),
        ...(step.stdin !== undefined ? { stdin: step.stdin } : {}),
        env: injected,
      }),
    );

    const output: LocalBashObservation = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      truncated: result.truncated,
    };
    return { ok: result.exitCode === 0 && !result.timedOut, output };
  } catch (err) {
    // A Tier2Error is a REFUSAL (disabled tier, containment escape, timeout) and is already
    // ledgered by the runner. Its message is free text and goes through the outbound redactor.
    const message = err instanceof Tier2Error ? err.message : err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** The session's own grant when it holds exactly one. Two grants is ambiguous, and guessing which
 *  one a step meant is how a step ends up running under a root nobody chose for it. */
function resolveGrantRoot(grants: GrantTable, session: string): string | undefined {
  const own = grants.list().filter((g) => g.session === session);
  return own.length === 1 ? own[0]!.root : undefined;
}

function capabilityTool(capability: BridgeCapability): 'bash' | 'browser' {
  return capability === 'local.bash' ? 'bash' : 'browser';
}

function safeUrl(read: () => string): string {
  try {
    return read();
  } catch {
    return 'about:blank';
  }
}
