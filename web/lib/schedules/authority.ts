/**
 * Who may act on a schedule (and on a schedule's run), client-side.
 *
 * This mirrors `api/src/schedules/store.ts` exactly: reads are org-wide for an admin, writes
 * are OWNER-ONLY plus super-admin, because a schedule fires as its owner and letting one
 * principal edit another's would aim someone else's authority. The server refuses the rest
 * with a uniform 404 (no existence oracle), which is invisible to a user - so the UI's job is
 * to not offer the control at all. This is a RENDERING gate, never the enforcement.
 *
 * `ownerId` is optional on the wire (`shared/src/schedules.ts`) though the service always
 * fills it. An absent one is treated as "cannot prove this is a peer's": stripping the owner's
 * own controls off every row would be a worse failure than showing one that the server
 * refuses.
 */

export interface ActingUser {
  id: string;
  role: string;
}

export function canActOnOwned(actor: ActingUser | null | undefined, ownerId: string | undefined): boolean {
  if (!actor) return false;
  if (actor.role === 'super-admin') return true;
  return ownerId === undefined || ownerId === actor.id;
}
