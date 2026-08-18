/**
 * automation/credential-waiters.ts - who is waiting for which credential, and what wakes them.
 *
 * A run halted in `needs_credentials` (engine.ts) is parked on exactly one question: does this
 * user's Cofre now hold something usable for that origin? This module holds the answer's other
 * half - a process-local registry of (org, user, host) -> waiting run ids - and turns a Cofre
 * domain event into a re-dispatch.
 *
 * WHY IN-PROCESS AND NOT PERSISTED. Because it must never be the ONLY thing that resumes a run.
 * The registry is an OPTIMISATION on top of a state that is already durable: the run is persisted
 * `needs_credentials` with its `credentialRequest`, and the client can drive the same resume itself
 * (`POST /automations/runs/:id/resume`) after establishing the credential. Persisting the waiter
 * set would create a second durable source of truth about a run's state, which is the thing that
 * goes stale after a crash. A restart loses the registry and loses NOTHING ELSE: the run is still
 * `needs_credentials`, the reloading client still recovers it through `NON_TERMINAL_RUN_STATUSES`,
 * and the `/cofre` establish action still calls resume. Two independent paths, neither load-bearing
 * alone - which is exactly the belt-and-braces the cross-process gap (plan trap T7) needs.
 *
 * WHY (org, user) AND NOT (org). Cofre items are OWNER-scoped: `mintCofreItem` stamps `userId` and
 * every read is owner-scoped. A credential minted by one member of an org is not usable by another,
 * so waking a peer's run would be a re-dispatch that can only halt again - and, more importantly,
 * it would be this module quietly asserting a cross-user relationship the Cofre does not have.
 *
 * ONE-SHOT WAITERS. A fired waiter is removed. If the credential turns out to be insufficient the
 * run halts again and registers again, so a mint-then-grant pair costs at most two re-dispatches
 * rather than an unbounded storm.
 */
import type { CredentialEstablishedEvent } from '../cofre/index.js';

/** How the run gets going again. Injected so this module does not import the run service. */
export type CredentialResumeDriver = (runId: string) => void;

const noopDriver: CredentialResumeDriver = () => {};
let resumeDriver: CredentialResumeDriver = noopDriver;

/**
 * Bind the re-dispatcher. Called once at the composition root with `service.ts`'s
 * `redispatchRunAwaitingCredentials`.
 *
 * Injected rather than imported because `service.ts` is the run ORCHESTRATOR: it imports the
 * engine, which imports this module. A direct import here would close that cycle for the sake of
 * one call.
 */
export function setCredentialResumeDriver(fn: CredentialResumeDriver): void {
  resumeDriver = fn;
}

interface Waiter {
  runId: string;
  orgId: string;
  userId: string;
  /** The bare host the run needs a credential for, lower-cased. */
  host: string;
}

/** runId -> waiter. Keyed by run so a run can only ever wait for one thing at a time. */
const waiters = new Map<string, Waiter>();

/** Test-only: empty the registry and drop the bound driver. */
export function __resetCredentialWaitersForTests(): void {
  waiters.clear();
  resumeDriver = noopDriver;
}

/** How many runs are parked. Exposed for tests and for an operator read, never branched on. */
export function credentialWaiterCount(): number {
  return waiters.size;
}

/**
 * Park a run against an origin. Idempotent per run: re-registering replaces, so a run that halts,
 * resumes and halts again on a different origin is never waiting for both.
 */
export function registerCredentialWaiter(input: {
  runId: string;
  orgId: string;
  userId: string;
  origin: string;
}): void {
  const host = bareHost(input.origin);
  if (!host || !input.runId || !input.orgId || !input.userId) return;
  waiters.set(input.runId, { runId: input.runId, orgId: input.orgId, userId: input.userId, host });
}

/** Un-park a run. Called when it is resumed, cancelled, or reaches a terminal state. */
export function clearCredentialWaiter(runId: string): void {
  waiters.delete(runId);
}

/**
 * A credential became usable. Wake every run whose origin it covers, and return their ids.
 *
 * Returned rather than merely acted on so a test can assert WHICH runs a mint woke without having
 * to observe the run engine - the alternative is a test that passes because nothing happened.
 */
export function onCredentialEstablished(event: CredentialEstablishedEvent): string[] {
  const bound = event.boundOrigins.map(bareHost).filter((h): h is string => !!h);
  if (bound.length === 0) return [];

  const woken: string[] = [];
  for (const waiter of [...waiters.values()]) {
    if (waiter.orgId !== event.orgId || waiter.userId !== event.userId) continue;
    if (!bound.some((b) => coversHost(b, waiter.host))) continue;
    // One-shot: drop it BEFORE dispatching, so a driver that re-enters (a synchronous resume that
    // halts again immediately) re-registers into a clean slot instead of racing this loop.
    waiters.delete(waiter.runId);
    woken.push(waiter.runId);
  }
  for (const runId of woken) {
    try {
      resumeDriver(runId);
    } catch {
      // A driver failure must not stop the remaining runs from being woken, and must not propagate
      // into the Cofre mint that triggered this. The run stays `needs_credentials` and the
      // client-side resume path still reaches it.
    }
  }
  return woken;
}

/**
 * Does a credential bound to `boundHost` cover a run waiting on `waitingHost`?
 *
 * The same rule `unwrap`'s origin binding uses: an item bound to `example.com` covers
 * `portal.example.com`, and one bound to `portal.example.com` does NOT cover `example.com`. The
 * direction matters - inverting it would let a credential for one subdomain claim to satisfy a run
 * pointed at the parent domain and every other subdomain under it.
 */
function coversHost(boundHost: string, waitingHost: string): boolean {
  return waitingHost === boundHost || waitingHost.endsWith(`.${boundHost}`);
}

/** A bare lower-cased host from either a host or a full URL. Unparseable input answers null. */
function bareHost(origin: string): string | null {
  const trimmed = origin.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      return new URL(trimmed).hostname || null;
    } catch {
      return null;
    }
  }
  return (trimmed.split('/')[0] ?? '').split(':')[0] || null;
}
