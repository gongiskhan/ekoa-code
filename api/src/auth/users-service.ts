/**
 * Users-management service (ch03 §3.8.2). Owns the `users`/`orgs` store access for the
 * users router — routes/ never touches data/ directly (ch02 §2.7). super-admin is
 * platform-wide; org-admin is confined to its own org.
 */
import type { Actor } from '@ekoa/shared';
import { users, orgs, type UserDoc } from '../data/stores.js';
import { setActivation, bumpTokenEpoch } from '../data/activation.js';
import { hashPassword } from './password.js';
import { setUserActive, authUserView, type AuthUserView, type Deps } from './service.js';

export type { AuthUserView };

export async function listUsers(actor: Actor): Promise<AuthUserView[]> {
  const rows = actor.role === 'super-admin' ? await users.find({}) : await users.find({ orgId: actor.orgId });
  return rows.map(authUserView);
}

export async function createUser(
  input: { username: string; password: string; role: UserDoc['role']; orgId?: string },
  deps: Deps,
): Promise<{ ok: true; user: AuthUserView } | { ok: false; reason: 'taken' }> {
  let orgId = input.orgId;
  if (!orgId) {
    orgId = deps.genId();
    await orgs.insert({ _id: orgId, name: input.username, createdAt: new Date(deps.now()).toISOString() });
  }
  const id = deps.genId();
  const inserted = await users.insert({
    _id: id,
    username: input.username,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    orgId,
    active: true,
    passwordChangeRequired: true,
  });
  if (!inserted) return { ok: false, reason: 'taken' };
  setActivation(id, { active: true, billingLocked: false });
  return { ok: true, user: authUserView((await users.get(id)) as UserDoc) };
}

export async function getUser(id: string): Promise<UserDoc | null> {
  return users.get(id);
}

export async function patchUser(
  actor: Actor,
  target: UserDoc,
  patch: { role?: UserDoc['role']; active?: boolean },
  deps: Deps,
): Promise<AuthUserView> {
  if (patch.role && patch.role !== target.role) {
    await users.update(target._id, (u) => ({ ...u, role: patch.role as UserDoc['role'] }));
    // A role change invalidates the user's outstanding tokens: bump the token epoch (real
    // JWT-iat clock, strictly after any token minted this second) so a demoted admin cannot
    // keep using a stale privileged JWT (ch09 §9.6). The user re-logs in with the new role.
    bumpTokenEpoch(target._id, Math.floor(Date.now() / 1000) + 1);
  }
  if (patch.active !== undefined) await setUserActive(target._id, patch.active, [], deps);
  return authUserView((await users.get(target._id)) as UserDoc);
}

export async function deleteUser(id: string): Promise<boolean> {
  return users.delete(id);
}
