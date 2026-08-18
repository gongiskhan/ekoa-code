/**
 * session/grants.ts — the per-session grant table (ch18 §18.5.1 step 6, S2).
 *
 * A grant is an opaque ref → a real root directory the daemon holds, BOUND to the session that owns
 * it. Resolution is session-scoped: a task may only name a grant held for ITS OWN session, so a task
 * that forges another session's grantRef is refused (harness parity —
 * `ekoa-code/api/test/fake-daemon/daemon.ts` `grantFor`). In-memory state only; persistence and the
 * fs side of a grant (realpathing the root) live in the containment resolver, never here.
 */

/** A grant the daemon holds: an opaque ref → a real root dir, bound to the session that owns it. */
export interface Grant {
  grantRef: string;
  root: string;
  session: string;
}

/** In-memory table of the grants the daemon currently holds, resolved per owning session. */
export class GrantTable {
  private readonly grants: Grant[];

  constructor(initial: Grant[] = []) {
    // Copy so a caller mutating its input array cannot silently change the table.
    this.grants = [...initial];
  }

  add(grant: Grant): void {
    this.grants.push(grant);
  }

  /** Drop a grant by ref (browser/CLI revoke): effective at the NEXT resolution, never retroactive
   *  to reads already made (§12.6.3). Returns whether anything was removed (idempotent). */
  remove(grantRef: string): boolean {
    const before = this.grants.length;
    for (let i = this.grants.length - 1; i >= 0; i -= 1) {
      if (this.grants[i]!.grantRef === grantRef) this.grants.splice(i, 1);
    }
    return this.grants.length !== before;
  }

  list(): readonly Grant[] {
    return this.grants;
  }

  /**
   * Resolve a grantRef ONLY for the session that owns it (§18.5.1 step 6, S2). Returns undefined for
   * an unknown ref OR a ref held for a DIFFERENT session — the caller denies both as
   * "unknown or foreign-session grant".
   */
  grantFor(grantRef: string, session: string): Grant | undefined {
    return this.grants.find((g) => g.grantRef === grantRef && g.session === session);
  }
}
