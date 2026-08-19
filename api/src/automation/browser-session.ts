/**
 * BrowserSession — the executor face's view of the daemon's `browser`
 * capability, in place of a local Playwright `Page`.
 *
 * Phase 5 of the executor-face migration: the real browser (Playwright,
 * persistent per-owner context, anti-bot stealth) now lives on the
 * ekoa-local daemon. Cortex keeps all the *logic* — the three-tier
 * cache → vision → escalate loop, the vision resolver/verifier, the
 * page-fingerprint cache, the per-automation memory — but no longer
 * drives a `Page` directly. Instead it dispatches each resolved
 * `PlaywrightAction`/`PlaywrightAssertion` to the daemon over the control
 * channel (`BridgeConnection.runStep({ capability:'browser', ... })`) and
 * consumes the returned **observation envelope**.
 *
 * Act-and-observe (architecture.md §3): every browser act returns a
 * post-action observation `{ kind:'page', screenshotB64, text,
 * data:{ url, domSnapshot, fingerprint } }`. That observation is exactly
 * what the vision resolver/verifier and the fingerprint cache feed on for
 * the NEXT step — so this session caches the most recent observation and
 * exposes it through the same shapes the engine used to read off `Page`:
 *
 *   - `act(action)` / `assert(assertion)` → dispatch + refresh observation
 *   - `observe()`                         → fresh observation without acting
 *   - `screenshotPng()` / `screenshotB64()` → from the latest observation
 *   - `url()` / `fingerprint()` / `accessibilitySnapshot()` → from the latest
 *
 * The fingerprint is computed HOSTED-side from the daemon's observation
 * (URL + title + first-heading + DOM-shape) via `fingerprintFromParts`,
 * preserving the existing cache key `(automationId, stepId, fingerprint)`.
 */

import type {
  LocalBrowserCapture,
  LocalBrowserInjectedCall,
  LocalBrowserInjectedCallResult,
} from '@ekoa/shared';
import type { DaemonConnection, ResultEnvelope } from './seams.js';
import { fingerprintFromParts } from './fingerprint.js';
import type {
  PageFingerprint,
  PlaywrightAction,
  PlaywrightAssertion,
} from './types.js';

/**
 * Shape of the structured payload the daemon's `browser` capability
 * returns under `observation.data`. Validated leniently — the daemon is a
 * trust boundary, so we coerce/guard each field rather than assume it.
 */
interface BrowserObservationData {
  url?: string;
  title?: string;
  /** First H1/H2 visible text; feeds the fingerprint heading hash. */
  heading?: string;
  /** Normalised tag+role/landmark sketch; feeds the fingerprint DOM-shape hash. */
  domShapeSketch?: string;
  /** Trimmed accessibility outline the rehearsal fixer reads. */
  accessibilitySnapshot?: string;
  /** Page viewport as reported by the daemon. */
  viewport?: { w?: number; h?: number; width?: number; height?: number };
  /** Assertion verdict, when the act was a PlaywrightAssertion. */
  assertionPassed?: boolean;
  /** Exchanges the page made since the previous frame, when capture is armed (slice P2.2). */
  captures?: LocalBrowserCapture[];
  /** The verdict of an `injectedCall` frame (slice P2.3). */
  injectedCall?: LocalBrowserInjectedCallResult;
}

export interface BrowserActOptions {
  /** Correlates the daemon step with the run UI; reused as the exec_step id. */
  stepId?: string;
  /** Forwarded daemon step_progress chunks (rarely used for browser acts). */
  onProgress?: (chunk: string) => void;
}

/**
 * The subset of a browser page the automation engine needs. Implemented
 * by `DaemonBrowserSession`; kept as an interface so tests can supply a
 * fake without a live BridgeConnection.
 */
export interface BrowserSession {
  /** Run a resolved action on the daemon; refreshes the held observation. */
  act(action: PlaywrightAction, opts?: BrowserActOptions): Promise<void>;
  /**
   * Run a resolved assertion on the daemon. Returns true on pass; throws
   * on fail — same contract as the old in-proc `executePlaywrightAssertion`.
   */
  assert(assertion: PlaywrightAssertion, opts?: BrowserActOptions): Promise<true>;
  /**
   * Refresh the observation without mutating the page (daemon runs a
   * `screenshot` no-op act). Used before a vision call on cache miss.
   */
  observe(opts?: BrowserActOptions): Promise<void>;
  /**
   * Guarantee the held observation reflects the CURRENT page before a step
   * reads it (fingerprint / screenshot going INTO the step). No-op once an
   * observation exists — act-and-observe means the previous step's act
   * already left a fresh one. Observes once for the first browser step in
   * a run (no prior act).
   */
  ensureObserved(opts?: BrowserActOptions): Promise<void>;
  /** True once any act/observe has populated the held observation. */
  hasObservation(): boolean;
  /** Latest post-action screenshot as a PNG buffer (no daemon round-trip). */
  screenshotPng(): Buffer;
  /** Latest post-action screenshot as raw base64 (no data: prefix). */
  screenshotB64(): string;
  /** Current page URL, from the latest observation. */
  url(): string;
  /** Page fingerprint computed hosted-side from the latest observation. */
  fingerprint(): PageFingerprint;
  /** Trimmed accessibility outline from the latest observation, if any. */
  accessibilitySnapshot(): string | undefined;
  /**
   * Release THIS SESSION's own resources. BOTH implementations need it: the
   * in-process session closes its per-run page so pages do not accumulate, and
   * the daemon session stops the keepalive heartbeat it holds for the run's
   * browser lease.
   *
   * IT IS NOT THE RUN-END SIGNAL, and the difference matters. Ending the
   * daemon's lease is `releaseBrowserLease`, which the engine calls ONCE for a
   * whole call tree - a sub-automation has its own session but shares its
   * parent's lease, so a session that ended the lease on dispose would tear the
   * browser down under the parent the moment a sub-automation finished.
   */
  dispose?(): Promise<void>;

  // --- the discovery spine's additions (P2.2 / P2.3) --------------------------
  //
  // ALL OPTIONAL, and they must stay that way. `LocalBrowserSession` (the in-process fallback) has
  // no daemon to arm a recorder on, and every fake session in the suite predates them; a required
  // member here would break both for a capability only the discovery driver ever asks for. The
  // driver treats an absent member as "this session cannot capture", which is the honest reading.

  /**
   * Arm the machine's network recorder for this lease. Everything the page requests from now on is
   * buffered there and drained onto each subsequent observation.
   *
   * ARMED BY THE DISCOVERY DRIVER AND NOTHING ELSE. It is not a page verb and no resolver can emit
   * it (see `LocalBrowserCaptureOp`): "record every request this authenticated page makes" is a
   * decision a phase takes, never one a model reaches.
   */
  startCapture?(opts?: BrowserActOptions): Promise<void>;
  /** Disarm, and drop the machine-side buffer including the live header values it held. */
  stopCapture?(opts?: BrowserActOptions): Promise<void>;
  /** Everything captured since the last drain. Draining EMPTIES: an exchange belongs to exactly one
   *  observation, so the calls a step provoked are attributable to that step. */
  drainCaptures?(): LocalBrowserCapture[];
  /**
   * Replay one learned call INSIDE the authenticated page (trap T3). The values of the named
   * headers are resolved ON THE MACHINE from the live session; nothing here has ever held them.
   */
  injectCall?(call: LocalBrowserInjectedCall, opts?: BrowserActOptions): Promise<LocalBrowserInjectedCallResult>;
}

/**
 * One browser lease, shared by a run and every sub-automation run beneath it.
 *
 * WHY IT IS NOT THE RUN ID. The daemon holds one page and one cookie jar per
 * lease. A sub-automation is a separate run - own runId, own run record - on the
 * same owner, therefore the same daemon and the same profile; keyed by runId it
 * would queue behind the lease its parent holds for the whole parent run, while
 * the parent is blocked waiting for it. That is a deadlock on the most ordinary
 * composition the product has, and the two-minute idle backstop then reaped the
 * parent while it waited. The parent's lease id travels down `RunContext`
 * instead, so parent and child are one tenant of one lease and the child
 * continues on the page its parent left open.
 *
 * WHY IT IS MINTED PER PASS rather than derived from the root run id: a run that
 * halts on `needs_credentials` and is resumed re-enters with the SAME runId, and
 * the daemon tombstones a lease id when its lease ends so a late step cannot be
 * served a blank page. A per-pass id means the resumed pass takes a clean lease
 * instead of colliding with the tombstone its own earlier pass left.
 *
 * `used` is set by the session the first time it actually SENDS a frame naming
 * this lease - not when a session is constructed, which the engine does for
 * every step of a daemon-connected run whatever its type. It is READ BY THE
 * OWNING PASS: the run that minted the lease must send the release even when the
 * browser was only ever driven by a sub-automation (they share this object, so
 * the child's mark is visible to the parent), and must not send one for a run
 * tree that never opened a browser at all.
 */
export interface BrowserLease {
  readonly id: string;
  used: boolean;
}

/** How often a live run tells the daemon its lease is still wanted. Comfortably under the daemon's
 *  two-minute idle backstop, so several lost heartbeats in a row are survivable, and far above the
 *  cost of one frame. See `releaseBrowserLease` for why the heartbeat exists at all. */
export const BROWSER_KEEPALIVE_MS = 45_000;

/**
 * END OF RUN on the daemon: drop the page, and WIPE the injected Cofre session
 * out of a cookie jar that outlives the run.
 *
 * Called once per call tree, from the engine's run `finally`, by the pass that
 * minted the lease - never by a sub-automation, which would end the browser
 * under its parent.
 *
 * IT NEVER THROWS (the engine's `finally` must not lose the run's real outcome)
 * BUT IT IS NEVER SILENT. A release the daemon could not complete means an
 * authenticated session may still be resident in a profile the user's next
 * automation shares; that is a security-relevant outcome, so it is logged as an
 * error rather than swallowed. A machine that has gone away is the one benign
 * case and reads the same way, which is the right trade: the daemon's idle
 * backstop then ends the lease, minutes later.
 */
export async function releaseBrowserLease(
  conn: DaemonConnection,
  input: { leaseId: string; ownerUserId: string; runId: string },
): Promise<void> {
  try {
    const env = await conn.runStep({
      capability: 'browser',
      input: { owner: input.ownerUserId, leaseId: input.leaseId, leaseOp: 'release' },
      runId: input.runId,
    });
    if (!env.ok) {
      console.error(
        `[automation] daemon could not end the browser session for run ${input.runId}: ` +
          `${env.error?.message ?? 'unknown reason'} - a session may still be resident on that machine`,
      );
    }
  } catch (err) {
    console.error(
      `[automation] the machine did not answer the browser session release for run ${input.runId} ` +
        `(${err instanceof Error ? err.message : String(err)}); its idle backstop will end the lease`,
    );
  }
}

/**
 * BridgeConnection-backed implementation. One per run.
 */
export class DaemonBrowserSession implements BrowserSession {
  private readonly conn: DaemonConnection;
  private readonly runId: string;
  private readonly ownerUserId: string;
  /**
   * The lease every frame from this session names, and the object this session MARKS AS USED the
   * first time it sends one. Defaults to a private lease named after the runId, which is what a run
   * with no parent and no children means anyway.
   *
   * Marking happens on the first dispatch and not at construction because the engine builds a
   * session for every step of a daemon-connected run regardless of the step's type: constructing
   * one proves nothing, sending a frame is what makes the daemon take a lease that then has to be
   * given back.
   */
  private readonly lease: BrowserLease;
  private readonly keepAliveMs: number;
  private keepAlive: ReturnType<typeof setInterval> | undefined;
  private last: BrowserObservationData = {};
  private lastScreenshotB64 = '';
  private observed = false;
  /**
   * Exchanges accumulated from every observation since the last drain.
   *
   * ACCUMULATED HERE rather than read off `last`, because `ingest` MERGES observations: a frame that
   * omits `captures` would otherwise leave the previous frame's captures in place and the driver
   * would read the same exchanges twice, once per step, for the rest of the pass.
   */
  private captured: LocalBrowserCapture[] = [];

  constructor(opts: {
    connection: DaemonConnection;
    runId: string;
    ownerUserId: string;
    lease?: BrowserLease;
    /** 0 disables the heartbeat (tests that drive the lifecycle by hand). */
    keepAliveMs?: number;
  }) {
    this.conn = opts.connection;
    this.runId = opts.runId;
    this.ownerUserId = opts.ownerUserId;
    this.lease = opts.lease ?? { id: opts.runId, used: false };
    this.keepAliveMs = opts.keepAliveMs ?? BROWSER_KEEPALIVE_MS;
    this.startKeepAlive();
  }

  async act(action: PlaywrightAction, opts?: BrowserActOptions): Promise<void> {
    if (action.kind === 'noop') return; // resolver no-op — nothing to run on the daemon
    const env = await this.dispatch(action, opts);
    if (!env.ok) {
      throw new Error(env.error?.message ?? 'browser action failed on daemon');
    }
  }

  async assert(
    assertion: PlaywrightAssertion,
    opts?: BrowserActOptions,
  ): Promise<true> {
    const env = await this.dispatch(assertion, opts);
    // The daemon executes the assertion and reports pass/fail. Two encodings
    // are accepted: a `false` envelope (ok:false), or an ok envelope whose
    // observation.data.assertionPassed is false. Either way we throw on
    // fail so the engine's existing catch → vision-fallback path is reached
    // unchanged.
    const passed =
      env.ok &&
      (this.last.assertionPassed === undefined
        ? true
        : this.last.assertionPassed === true);
    if (!passed) {
      throw new Error(
        env.error?.message ?? 'assertion did not hold on daemon page',
      );
    }
    return true;
  }

  async observe(opts?: BrowserActOptions): Promise<void> {
    // `screenshot` is a pure observe at the executor level — the daemon
    // returns a fresh page observation without mutating the page (mirrors
    // the old in-proc `page.screenshot()` before a vision resolve).
    const env = await this.dispatch({ kind: 'screenshot' }, opts);
    if (!env.ok) {
      throw new Error(env.error?.message ?? 'browser observe failed on daemon');
    }
  }

  async startCapture(opts?: BrowserActOptions): Promise<void> {
    await this.lifecycle({ captureOp: 'start' }, 'arm network capture', opts);
  }

  async stopCapture(opts?: BrowserActOptions): Promise<void> {
    await this.lifecycle({ captureOp: 'stop' }, 'stop network capture', opts);
  }

  drainCaptures(): LocalBrowserCapture[] {
    return this.captured.splice(0, this.captured.length);
  }

  /**
   * Replay one learned call in the page. The result comes back on `observation.data.injectedCall`,
   * the same slot every other browser frame's payload lands in.
   *
   * A NON-2xx IS NOT A FAILURE HERE. The daemon answers `ok:true` for any call it managed to make,
   * because a 404 from a replayed call ran perfectly and means the recipe has DRIFTED - a signal
   * `self-heal.ts` classifies and acts on. Throwing on it would erase the distinction between
   * "the machine could not make the call" and "the site answered differently than the recipe expects".
   */
  async injectCall(
    call: LocalBrowserInjectedCall,
    opts?: BrowserActOptions,
  ): Promise<LocalBrowserInjectedCallResult> {
    const env = await this.lifecycle({ injectedCall: call }, 'replay a learned call', opts);
    const result = this.last.injectedCall;
    if (!result) {
      throw new Error(env.error?.message ?? 'the machine answered no verdict for the replayed call');
    }
    return result;
  }

  async ensureObserved(opts?: BrowserActOptions): Promise<void> {
    if (this.observed) return;
    await this.observe(opts);
  }

  hasObservation(): boolean {
    return this.observed;
  }

  screenshotPng(): Buffer {
    return Buffer.from(this.lastScreenshotB64, 'base64');
  }

  screenshotB64(): string {
    return this.lastScreenshotB64;
  }

  url(): string {
    return this.last.url ?? 'about:blank';
  }

  fingerprint(): PageFingerprint {
    const vp = this.last.viewport;
    const w = vp?.w ?? vp?.width ?? 0;
    const h = vp?.h ?? vp?.height ?? 0;
    return fingerprintFromParts({
      url: this.last.url ?? 'about:blank',
      title: this.last.title ?? '',
      headingText: this.last.heading ?? '',
      shapeSketch: this.last.domShapeSketch ?? 'tags:|roles:|landmarks:0',
      viewport: { w, h },
    });
  }

  accessibilitySnapshot(): string | undefined {
    const s = this.last.accessibilitySnapshot;
    return typeof s === 'string' && s.length > 0 ? s : undefined;
  }

  /**
   * Stop this session's heartbeat. It does NOT end the daemon's lease - see the
   * interface comment and `releaseBrowserLease`: the lease outlives a
   * sub-automation's session and is ended once, by the pass that minted it.
   *
   * NEVER THROWS. The engine calls it from its run `finally`, where a throw
   * would replace the run's real outcome with a teardown error.
   */
  async dispose(): Promise<void> {
    this.stopKeepAlive();
  }

  // --- internals ------------------------------------------------------------

  /**
   * Clear the fields that describe THIS FRAME'S outcome, before sending one.
   *
   * `ingest` merges, so a field the next observation omits keeps its previous value - which is
   * correct for everything describing the page (url, title, viewport) and WRONG for a per-frame
   * verdict. Without this, an assert whose observation omits `assertionPassed` inherits an earlier
   * `true`, and an injected call whose frame omits `injectedCall` is handed the previous call's
   * answer as if it were its own.
   *
   * Called from BOTH send paths. It lived inline in `dispatch` alone until `lifecycle` was added
   * beside it, and the injected-call half of the hazard reappeared immediately - which is why it is
   * one named method now rather than two lines repeated in two places.
   */
  private resetPerFrameVerdicts(): void {
    this.last.assertionPassed = undefined;
    this.last.injectedCall = undefined;
  }

  /**
   * Send a NON-PAGE frame (a capture op, an injected call) and absorb whatever observation came
   * back. It shares `ingest` with the page path so captures and injected-call verdicts land in the
   * same place a page act's do, and it MARKS THE LEASE USED for the same reason `dispatch` does -
   * arming a recorder or replaying a call takes the machine's lease exactly as a click does, and a
   * lease taken has to be given back.
   */
  private async lifecycle(
    input: Record<string, unknown>,
    what: string,
    opts?: BrowserActOptions,
  ): Promise<ResultEnvelope> {
    this.resetPerFrameVerdicts();
    const env = await this.conn.runStep({
      capability: 'browser',
      input: { owner: this.ownerUserId, leaseId: this.lease.id, ...input },
      ...(opts?.stepId !== undefined ? { stepId: opts.stepId } : {}),
      runId: this.runId,
    });
    this.lease.used = true;
    this.ingest(env);
    if (!env.ok) {
      throw new Error(env.error?.message ?? `the machine could not ${what}`);
    }
    return env;
  }

  private async dispatch(
    input: PlaywrightAction | PlaywrightAssertion,
    opts?: BrowserActOptions,
  ): Promise<ResultEnvelope> {
    this.resetPerFrameVerdicts();
    const env = await this.conn.runStep(
      {
        capability: 'browser',
        input: this.toDaemonInput(input),
        stepId: opts?.stepId,
        runId: this.runId,
      },
      opts?.onProgress ? { onProgress: opts.onProgress } : undefined,
    );
    // The daemon has now taken the lease, so the run that owns it must give it
    // back. Marked from the FIRST step rather than at construction, which proves
    // nothing: the engine builds a session for every step of a daemon-connected
    // run, whatever its type.
    this.lease.used = true;
    this.ingest(env);
    return env;
  }

  /**
   * THE RUN IS STILL ALIVE. The daemon reaps a lease nothing has arrived for in
   * two minutes, because a Cortex that died mid-run must not leave an
   * authenticated jar and a headed window resident on somebody's machine. But a
   * live run routinely goes minutes without a browser step - it is blocked on a
   * sub-automation, on a slow API call, or on a HUMAN solving a CAPTCHA in that
   * very window (`pause_for_user` has no timeout on purpose) - and reaping those
   * would close the browser out from under the person using it. This is the
   * signal that separates "nobody is driving this" from "nobody is driving this
   * right now", and it is what lets the daemon's window stay short.
   *
   * ARMED AT CONSTRUCTION, BUT SILENT UNTIL THE LEASE IS ACTUALLY TAKEN - and the
   * gap between those two is the whole reason it works this way. A run whose
   * browser work happens entirely inside a SUB-AUTOMATION never dispatches from
   * its own session: it would have nothing to heartbeat with while it sat through
   * a ten-minute api_call between the sub-automation and its next browser step,
   * and the lease its child opened would be reaped out from under it. The timer
   * therefore exists from the start and reads the SHARED lease object, so any
   * pass in the tree can keep the tree's lease alive. Until something has taken
   * the lease there is nothing to keep alive, so it sends nothing.
   *
   * Best-effort by construction: a heartbeat that fails changes nothing (the
   * next one is 45 seconds away, and several in a row have to be lost before the
   * backstop fires), and it must never surface as a run error.
   */
  private startKeepAlive(): void {
    if (this.keepAlive || this.keepAliveMs <= 0) return;
    const timer = setInterval(() => {
      if (!this.lease.used) return; // nothing has taken the lease yet
      void this.conn
        .runStep({
          capability: 'browser',
          input: { owner: this.ownerUserId, leaseId: this.lease.id, leaseOp: 'keepalive' },
          runId: this.runId,
        })
        .catch(() => undefined);
    }, this.keepAliveMs);
    // The heartbeat must never be the reason a process stays alive.
    timer.unref?.();
    this.keepAlive = timer;
  }

  private stopKeepAlive(): void {
    if (!this.keepAlive) return;
    clearInterval(this.keepAlive);
    this.keepAlive = undefined;
  }

  /**
   * Map a cortex PlaywrightAction/PlaywrightAssertion ({kind,...}) to the daemon
   * browser capability's input shape ({owner, leaseId, action:{action,...}}). The
   * locator union is identical on both sides, so it passes through unchanged, and
   * the daemon now runs the whole vocabulary - the six verbs this comment used to
   * list as unsupported (dblclick/select/check/uncheck/wait_for/scroll) were
   * reconciled in `shared/src/ekoa-local.ts` and `browser/executor.ts`.
   */
  private toDaemonInput(
    input: PlaywrightAction | PlaywrightAssertion,
  ): { owner: string; leaseId: string; action: Record<string, unknown> } {
    const { kind, ...rest } = input as { kind: string } & Record<string, unknown>;
    return { owner: this.ownerUserId, leaseId: this.lease.id, action: { action: kind, ...rest } };
  }

  /** Absorb a daemon observation into the cached page state. */
  private ingest(env: ResultEnvelope): void {
    const obs = env.observation;
    if (!obs) return;
    this.observed = true;
    if (typeof obs.screenshotB64 === 'string') {
      this.lastScreenshotB64 = obs.screenshotB64;
    }
    const data = (obs.data ?? {}) as BrowserObservationData;
    // CAPTURES ACCUMULATE, they do not merge. Every other field on the observation describes the
    // page as it is NOW and is correct to overwrite; captures are a LOG of what happened between
    // two frames, so the merge below (which keeps a previous value when the new frame omits one)
    // would re-deliver the same exchanges on every subsequent step.
    if (Array.isArray(data.captures) && data.captures.length > 0) {
      this.captured.push(...data.captures);
    }
    // Merge so a screenshot-only observe that omits some fields keeps the
    // last known values (the daemon should always send url/fingerprint,
    // but be defensive at the trust boundary).
    this.last = {
      ...this.last,
      ...stripUndefined({
        url: typeof data.url === 'string' ? data.url : undefined,
        title: typeof data.title === 'string' ? data.title : undefined,
        heading: typeof data.heading === 'string' ? data.heading : undefined,
        domShapeSketch:
          typeof data.domShapeSketch === 'string'
            ? data.domShapeSketch
            : undefined,
        accessibilitySnapshot:
          typeof data.accessibilitySnapshot === 'string'
            ? data.accessibilitySnapshot
            : undefined,
        viewport:
          data.viewport && typeof data.viewport === 'object'
            ? data.viewport
            : undefined,
        assertionPassed:
          typeof data.assertionPassed === 'boolean'
            ? data.assertionPassed
            : undefined,
        injectedCall:
          data.injectedCall && typeof data.injectedCall === 'object'
            ? data.injectedCall
            : undefined,
      }),
    };
  }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
