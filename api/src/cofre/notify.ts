/**
 * cofre/notify.ts - the "a credential became available" notifier seam.
 *
 * WHY A SEAM AND NOT A CALL. A run halted in `needs_credentials` is waiting for exactly one event:
 * a credential for its origin appearing in this user's Cofre. The thing that must learn about that
 * event lives in `automation/` (the waiter registry), and `cofre/` sits BELOW `automation/` in the
 * tier table - the dependency runs one way, and a `import ... from '../automation/...'` here would
 * be an upward edge the lint zones forbid and the architecture does not have. So the direction is
 * inverted exactly as it is for the daemon (`automation/seams.ts` `setDaemonConnectionResolver`):
 * this module declares a callback with a safe default, and the composition root (`server.ts`) binds
 * the real observer.
 *
 * WHY NOT AN EVENT BUS. There isn't one. `recordCofreEvent` (`cofre/audit.ts`) is called only from
 * `routes/cofre.ts`, and half the `CofreRegistoEvent` vocabulary is defined-but-never-emitted - so
 * "subscribe to cofre_session_established" would be subscribing to something nothing publishes.
 * The events that actually happen are the DOMAIN function calls, so that is where this hangs.
 *
 * WHY IT CANNOT THROW. A mint that fails because an observer threw would mean the credential the
 * user just typed is lost to a bug in a resume optimisation. The notification is best-effort by
 * construction: the resume it drives is one of two independent paths (the other is the client-side
 * establish -> resume call), and neither is load-bearing alone.
 *
 * WHAT TRAVELS. An org, a user and BOUND ORIGINS. There is no field here a credential VALUE could
 * occupy, and that is deliberate: this payload is handed to a process-local registry, but the shape
 * is what stops a future consumer from asking for more.
 */

/** A credential usable against `boundOrigins` now exists for this (org, user). Never a value. */
export interface CredentialEstablishedEvent {
  orgId: string;
  /** Cofre items are owner-scoped, so a waiter is only woken by ITS OWN user's credential. */
  userId: string;
  /** The hosts the new credential may be replayed against (`CofreItemDoc.boundOrigins`). */
  boundOrigins: readonly string[];
}

export type CredentialEstablishedNotifier = (event: CredentialEstablishedEvent) => void;

/** The honest default: nobody is listening, and a mint behaves exactly as it did before. */
const defaultNotifier: CredentialEstablishedNotifier = () => {};
let notifier: CredentialEstablishedNotifier = defaultNotifier;

export function setCredentialEstablishedNotifier(fn: CredentialEstablishedNotifier): void {
  notifier = fn;
}

/** Test-only: drop the bound observer so one suite cannot wake another suite's waiters. */
export function __resetCredentialNotifierForTests(): void {
  notifier = defaultNotifier;
}

/**
 * Announce that a credential became usable. Swallows everything: see the docblock.
 *
 * A call with no bound origins is dropped rather than broadcast - an item with no binding is
 * unusable (I6), so announcing it would wake every waiter for a credential none of them can use.
 */
export function notifyCredentialEstablished(event: CredentialEstablishedEvent): void {
  if (event.boundOrigins.length === 0) return;
  try {
    notifier(event);
  } catch (err) {
    // The class name only. This is on the mint path, where the surrounding scope held a value.
    console.warn(
      `[cofre-notify] credential-established observer failed: ${
        (err as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'Error'
      }`,
    );
  }
}
