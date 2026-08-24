/**
 * runtime/session-hold.ts - the daemon half of the S-inject session-delivery lifecycle.
 *
 * THE OBLIGATION, IN FULL, and it is `secret-hold.ts`'s obligation for a different shape of
 * credential. Cortex delivers a `storageState` on `session.deliver` because a browser step runs on
 * the USER'S machine and the run has to start already logged in. What the daemon owes back is
 * exactly what it owes for a delivered secret: hold it in RAM only, never on bridge disk, never in
 * a log, never in the ledger, inject it into the run's browser context when the lease is taken, and
 * DROP IT when that lease is released or the socket goes away. `docs/decisions.md` 2026-08-24 fixes
 * this as a custody rule rather than a nicety: a captured session is credential-equivalent.
 *
 * ── WHY THIS IS A SEPARATE MODULE FROM `SecretHold`, AND NOT A THIRD METHOD ON IT ────────────────
 *
 * The two differ in every dimension that matters to custody, and merging them would mean one class
 * with two lifetimes and two key spaces pretending to be one thing:
 *
 *  - KEY. A secret is keyed by INVOCATION (one child spawn consumes it and zeroizes it in that
 *    spawn's `finally`). A session is keyed by RUN, because the thing that wears it is the run's
 *    browser lease, which spans every step of the run.
 *  - LIFETIME. A secret's ends inside one step. A session's ends when the lease is released - and
 *    the release is a frame Cortex sends, so this hold has an explicit `release` the secret hold
 *    has no equivalent of.
 *  - SHAPE. A secret is a flat map of strings the hold can own as Buffers and genuinely overwrite.
 *    A `storageState` is a parsed JSON object whose strings came out of `JSON.parse` and are
 *    therefore already immutable and already unreachable. This module does NOT claim to zeroize it,
 *    because it cannot - see the note on `release` below. Claiming it would be the more comfortable
 *    lie; dropping the reference and saying so is the true statement.
 *
 * ── WHAT IT ARMS ────────────────────────────────────────────────────────────────────────────────
 *
 * Delivered COOKIE VALUES are registered with the outbound redactor, exactly as delivered secret
 * values are, so that a session token echoed back by a page - into captured text, an observation, a
 * `provider_request` body on its way to the model - is substituted before it can leave the machine.
 * That is the second leg of "never in a log, a trace or a model context": the first leg is that
 * nothing here ever puts the state on a frame, and this one covers the echo.
 *
 * LOCALSTORAGE VALUES ARE DELIBERATELY NOT REGISTERED. They are not session tokens as a class -
 * they are a site's whole client-side scratch space, full of things like `"dark"`, `"pt-PT"` and
 * `"true"` - and registering those would have the redactor substitute ordinary English out of every
 * page observation the run produces. A filter that mangles the page is not a safer filter; it is a
 * broken run plus a false sense of coverage. Cookies are where portal sessions live, which is also
 * why `profile.ts` injects cookies at `acquire` and seeds localStorage only per origin.
 */

/**
 * Below this, a cookie value is a preference flag and not a session token - `1`, `en`, `true`,
 * `PT`. Registering those with the redactor would substitute them wherever they occurred in ordinary
 * page text, which is the failure mode described in the docblock. Deliberately far above the
 * redactor's own `MIN_MASKABLE_LENGTH` (3): that floor exists to stop a two-character secret
 * destroying a stream, this one exists to stop a short NON-secret being treated as one. A real
 * portal session cookie is dozens of characters.
 */
const MIN_SESSION_VALUE_LENGTH = 12;

/** How long an undelivered-to-a-lease session survives before it is swept. A delivery whose run
 *  never takes a lease is a run that died on the way; holding an authenticated session past that is
 *  pure residency risk for nothing. Matches `SecretHold`'s reasoning and its horizon. */
const HOLD_TTL_MS = 5 * 60_000;

interface Held {
  runId: string;
  storageState: unknown;
  createdAt: number;
}

export interface SessionHoldDeps {
  now?: () => number;
  ttlMs?: number;
  /** Called with the cookie values of a delivery, so the outbound redactor can arm BEFORE the run
   *  those cookies authenticate can echo one back. */
  onRegister?: (values: string[]) => void;
}

export class SessionHold {
  private readonly holds = new Map<string, Held>();

  constructor(private readonly deps: SessionHoldDeps = {}) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /**
   * Take custody of a delivered session for one run.
   *
   * A second delivery for the same run REPLACES the first. Cortex sends one per run, on the
   * lease-taking frame; if a second ever arrives the safe reading is that the newer one is the
   * current session, exactly as `SecretHold` reads a second delivery for one invocation.
   */
  deliver(runId: string, storageState: unknown): void {
    this.sweep();
    this.holds.set(runId, { runId, storageState, createdAt: this.now() });
    const values = cookieValuesOf(storageState);
    if (values.length > 0) this.deps.onRegister?.(values);
  }

  /**
   * The session to wear for this run, or `undefined`.
   *
   * KEYED STRICTLY BY `runId`, WITH NO FALLBACK OF ANY KIND. There is deliberately no "the only
   * session we hold" convenience and no most-recent-delivery default: a daemon serves ONE owner but
   * runs many runs, and a lookup that answered for a run it was not delivered for is precisely how
   * one run would wear another's cookies. An unknown run gets nothing and starts signed out, which
   * is the correct, visible, recoverable answer.
   */
  get(runId: string): unknown {
    this.sweep();
    return this.holds.get(runId)?.storageState;
  }

  /**
   * Forget one run's session - its lease was released, so the jar it was injected into has been
   * wiped (`profile.ts` `releaseRun`) and the copy here is a credential with nothing left to
   * authenticate.
   *
   * IT DROPS THE REFERENCE AND CLAIMS NOTHING MORE. The strings inside a `storageState` came from
   * `JSON.parse` on the frame; they are immutable and this module never held a mutable copy of
   * them, so there is no memory here to overwrite and pretending otherwise would be a stronger
   * claim than the code can support. `SecretHold` can say more because it copies its values into
   * Buffers on arrival; this cannot, and says so.
   */
  release(runId: string): void {
    this.holds.delete(runId);
  }

  /** Drop everything past its TTL. Called on every deliver/get so it needs no timer - a timer would
   *  keep the process alive and would be the one thing that stops on a busy loop. */
  sweep(): void {
    const ttl = this.deps.ttlMs ?? HOLD_TTL_MS;
    const now = this.now();
    for (const [id, held] of this.holds) {
      if (now - held.createdAt > ttl) this.holds.delete(id);
    }
  }

  /**
   * Drop every held session. The socket dropped, or the daemon is shutting down.
   *
   * A DROPPED SOCKET IS A SUFFICIENT REASON, and not an over-cautious one: Cortex fails every
   * in-flight invocation for a pairing whose socket closed (`bridge/tool-invocation.ts`
   * `failInvocationsForPairing`), so no run whose session is held here can still be running. Every
   * remaining entry is an authenticated session belonging to nothing.
   */
  clear(): void {
    this.holds.clear();
  }

  /** Live hold count. Tests assert it returns to zero; nothing in `src/` should need it. */
  get size(): number {
    return this.holds.size;
  }
}

/**
 * The cookie values inside a delivered state, for the redactor to arm on.
 *
 * Accepts both shapes `parseSessionState` does - a raw Playwright `storageState` and the
 * `{ storageState, capturedAt }` wrapper the Cofre stores - because arming must not depend on which
 * of the two a given item happened to be written as. Anything it does not recognise yields nothing:
 * an unarmed filter is a smaller failure than a thrown exception on the delivery path, which would
 * cost the run its session as well.
 */
function cookieValuesOf(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const state =
    obj['storageState'] && typeof obj['storageState'] === 'object'
      ? (obj['storageState'] as Record<string, unknown>)
      : obj;
  const cookies = state['cookies'];
  if (!Array.isArray(cookies)) return [];
  const out: string[] = [];
  for (const cookie of cookies) {
    if (!cookie || typeof cookie !== 'object') continue;
    const value = (cookie as Record<string, unknown>)['value'];
    if (typeof value === 'string' && value.length >= MIN_SESSION_VALUE_LENGTH) out.push(value);
  }
  return out;
}
