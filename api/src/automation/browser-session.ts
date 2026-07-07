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
   * Release per-run resources at run end. Optional: the daemon session manages
   * pages daemon-side and needs no teardown; the in-process session closes its
   * page here so pages don't accumulate.
   */
  dispose?(): Promise<void>;
}

/**
 * BridgeConnection-backed implementation. One per run.
 */
export class DaemonBrowserSession implements BrowserSession {
  private readonly conn: DaemonConnection;
  private readonly runId: string;
  private readonly ownerUserId: string;
  private last: BrowserObservationData = {};
  private lastScreenshotB64 = '';
  private observed = false;

  constructor(opts: { connection: DaemonConnection; runId: string; ownerUserId: string }) {
    this.conn = opts.connection;
    this.runId = opts.runId;
    this.ownerUserId = opts.ownerUserId;
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

  // --- internals ------------------------------------------------------------

  private async dispatch(
    input: PlaywrightAction | PlaywrightAssertion,
    opts?: BrowserActOptions,
  ): Promise<ResultEnvelope> {
    // Reset the per-act assertion verdict so a stale `true` from a prior
    // assert never leaks into a later one whose observation omits the field.
    this.last.assertionPassed = undefined;
    const env = await this.conn.runStep(
      {
        capability: 'browser',
        input: this.toDaemonInput(input),
        stepId: opts?.stepId,
        runId: this.runId,
      },
      opts?.onProgress ? { onProgress: opts.onProgress } : undefined,
    );
    this.ingest(env);
    return env;
  }

  /**
   * Map a cortex PlaywrightAction/PlaywrightAssertion ({kind,...}) to the daemon
   * browser capability's input shape ({owner, action:{action,...}}). The locator
   * union is identical on both sides, so it passes through unchanged. (Actions the
   * daemon doesn't yet support — dblclick/select/check/uncheck/wait_for/scroll —
   * are rejected by the daemon's zod with a clear error; the engine's vision
   * fallback handles that. Reconcile the daemon action set as a follow-up.)
   */
  private toDaemonInput(
    input: PlaywrightAction | PlaywrightAssertion,
  ): { owner: string; action: Record<string, unknown> } {
    const { kind, ...rest } = input as { kind: string } & Record<string, unknown>;
    return { owner: this.ownerUserId, action: { action: kind, ...rest } };
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
