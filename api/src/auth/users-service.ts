/**
 * Users-management service (ch03 §3.8.2). Owns the `users`/`orgs` store access for the
 * users router — routes/ never touches data/ directly (ch02 §2.7). super-admin is
 * platform-wide; org-admin is confined to its own org.
 */
import type { Actor } from '@ekoa/shared';
import { users, orgs, type UserDoc } from '../data/stores.js';
import { setActivation, bumpTokenEpoch, clearActivation } from '../data/activation.js';
import { hashPassword } from './password.js';
import { setUserActive, authUserView, type AuthUserView, type Deps } from './service.js';

export type { AuthUserView };

export async function listUsers(actor: Actor): Promise<AuthUserView[]> {
  const rows = actor.role === 'super-admin' ? await users.find({}) : await users.find({ orgId: actor.orgId });
  return rows.map(authUserView);
}

export async function createUser(
  input: { username: string; password: string; role?: UserDoc['role']; orgId?: string },
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
    // H1: `user` is the base non-admin role and the default when a caller omits one (the HTTP
    // contract still requires `role` via CreateUserRequest; this default protects direct callers).
    role: input.role ?? 'user',
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

/**
 * Delete a user AND drop their activation entry in the same operation (ch09 §9.7.1 write-through).
 * Without the clear, `getActivation` keeps returning the stale `{active:true}` row, so a deleted
 * account's outstanding tokens stay admissible to their JWT expiry — and with `/auth/refresh`
 * mounted (F1) an attacker holding one could re-sign it indefinitely: an unbounded session for a
 * deleted account. Clearing the entry makes every admission plane fail closed immediately.
 */
export async function deleteUser(id: string): Promise<boolean> {
  const ok = await users.delete(id);
  if (ok) clearActivation(id);
  return ok;
}

/**
 * H1 role rename `builder` → `user`: an idempotent boot-step migration (the repo has no migration
 * framework — schema/data evolution rides idempotent steps in `bootState`, ch09 §9.7). Every user
 * row still carrying the retired `builder` role is rewritten to `user` and its token epoch bumped,
 * reusing the exact role-change revocation path (`patchUser`): a bumped epoch invalidates every
 * outstanding legacy JWT (its `iat < epoch`), forcing a re-login that mints a `user` token. Runs
 * AFTER `loadActivation` so the epoch bump lands in the freshly-loaded in-memory map. Idempotent:
 * once no row carries `builder`, the query matches nothing and nothing is bumped. Returns the count
 * migrated (0 on a clean/already-migrated store). The `role: 'builder'` filter reads a legacy value
 * no longer in the Role type, so it is a string filter (the store's `find` takes `Record<string,
 * unknown>`); the update writes the current `user` value. */
export async function migrateBuilderRole(): Promise<number> {
  const legacy = await users.find({ role: 'builder' });
  const epochSec = Math.floor(Date.now() / 1000) + 1;
  for (const u of legacy) {
    await users.update(u._id, (doc) => ({ ...doc, role: 'user' }));
    bumpTokenEpoch(u._id, epochSec);
  }
  return legacy.length;
}
