/**
 * Structural tenant scoping (ch09 invariant 5, FIXED-14). A repository layer that *cannot
 * express an unscoped query*: every read/write goes through an actor context and the org
 * (and, for owner-scoped resources, the user) filter is bound structurally — a caller
 * cannot omit it. This is the explicit replacement for the isolation that filesystem paths
 * used to give for free. Ownership/tenancy mismatch surfaces as a uniform NOT_FOUND (ch04).
 */
import type { Store, Doc } from './store.js';
import type { Actor } from '@ekoa/shared';

export type { Actor };

/** An org-scoped resource: every row carries `orgId`; access is confined to the actor's org
 *  (super-admin may cross orgs only via an explicit, separate super-admin path). */
export class OrgScoped<T extends Doc & { orgId: string }> {
  constructor(private store: Store<T>) {}

  /** List rows in the actor's org. A super-admin listing across orgs uses `listAllOrgs`. */
  async list(actor: Actor, extra: Record<string, unknown> = {}): Promise<T[]> {
    return this.store.find({ ...extra, orgId: actor.orgId });
  }

  /** Get a row ONLY if it belongs to the actor's org; otherwise null (→ uniform 404). */
  async get(actor: Actor, id: string): Promise<T | null> {
    const row = await this.store.get(id);
    if (!row || row.orgId !== actor.orgId) return null;
    return row;
  }

  /** Super-admin cross-org read (explicit; the ONLY way to leave the actor's org). */
  async getAnyOrg(id: string): Promise<T | null> {
    return this.store.get(id);
  }

  async listAllOrgs(orgId?: string): Promise<T[]> {
    return this.store.find(orgId ? { orgId } : {});
  }

  get raw(): Store<T> {
    return this.store;
  }
}

/** An owner-scoped resource with `visibility: private | org` (memories, artifacts). The
 *  resolver injects the owner's own rows PLUS org-shared rows; a private row is invisible to
 *  everyone else including org admins (existence may appear only in Registo metadata). */
export class OwnerVisibilityScoped<T extends Doc & { orgId: string; userId?: string; visibility?: 'private' | 'org' }> {
  constructor(private store: Store<T>) {}

  /** Rows the actor may see: own (any visibility) + org-shared. */
  async listVisible(actor: Actor, extra: Record<string, unknown> = {}): Promise<T[]> {
    const inOrg = await this.store.find({ ...extra, orgId: actor.orgId });
    return inOrg.filter((r) => r.userId === actor.userId || r.visibility === 'org');
  }

  /** Get a row the actor may read: own (any) or org-shared. Else null (→ uniform 404),
   *  so a private row of another user (or invisible to the org admin) is a clean not-found. */
  async getVisible(actor: Actor, id: string): Promise<T | null> {
    const row = await this.store.get(id);
    if (!row) return null;
    if (row.orgId !== actor.orgId) return null;
    if (row.userId === actor.userId) return row;
    if (row.visibility === 'org') return row;
    return null; // private row of another user — invisible even to the org admin
  }

  /** Can the actor WRITE this row? Own row always; org-shared row by any org member;
   *  a private row of another user → false (→ 403). Returns 'ok' | 'notfound' | 'forbidden'. */
  async writeGuard(actor: Actor, id: string): Promise<{ verdict: 'ok' | 'notfound' | 'forbidden'; row?: T }> {
    const row = await this.store.get(id);
    if (!row || row.orgId !== actor.orgId) return { verdict: 'notfound' };
    if (row.userId === actor.userId) return { verdict: 'ok', row };
    if (row.visibility === 'org') return { verdict: 'ok', row };
    return { verdict: 'forbidden', row }; // another user's private row
  }

  get raw(): Store<T> {
    return this.store;
  }
}
