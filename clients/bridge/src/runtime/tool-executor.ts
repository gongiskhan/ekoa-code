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
  type LocalBrowserObservation,
} from '../wire/index.js';
import {
  describeStepFailure,
  observePage,
  parseSessionState,
  runBrowserAction,
  type ProfileLease,
  ProfileManager,
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
  const { owner, action } = parsed.data;

  const profileId = deps.profileIdFor
    ? deps.profileIdFor({ capability: 'browser', runId: envelope.runId, owner })
    : owner;
  const sessionState = deps.sessionStateFor?.(envelope.runId);

  let lease: ProfileLease;
  try {
    // ACQUIRE SERIALISES. A second run for the same profile queues here rather than racing the
    // Chromium SingletonLock - see browser/profile.ts for why racing it cannot be won.
    lease = await deps.profiles.acquire(profileId, parseSessionState(sessionState));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    ledgerAutomation(ctx, 'browser', action.action, 'error', undefined, reason);
    return { ok: false, error: reason };
  }

  try {
    const page = await lease.page();
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

    // OBSERVE EVEN ON FAILURE. The hosted vision fallback resolves the NEXT attempt from the page
    // as it actually is; handing it nothing because the action threw is what turns one failed step
    // into a stalled run.
    const observation = await observePage(page);
    const data: LocalBrowserObservation = {
      ...observation.data,
      ...(assertionPassed !== undefined ? { assertionPassed } : {}),
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
  } finally {
    // ALWAYS release: the lease holds the profile mutex AND the injected session. A leaked lease
    // deadlocks every later run on that profile and leaves a live session in a shared jar.
    await lease.release().catch(() => undefined);
  }
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
