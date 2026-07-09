/**
 * Auth domain services (ch03 §3.8.1/§3.8.2, ch09 §9.7.1). Login, refresh, admin seeding,
 * and the deactivation write-through (the single operation that sets active=false, updates
 * the activation map, and revokes the user's tokens — ch09 §9.7.1).
 */
import { users, orgs, type UserDoc } from '../data/stores.js';
import { setActivation, getActivation, bumpTokenEpoch } from '../data/activation.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken, type JwtClaims } from './jwt.js';
import { revoke } from './revocation.js';

export interface Deps {
  now: () => number;
  genId: () => string;
}

export interface AuthUserView {
  id: string;
  username: string;
  role: UserDoc['role'];
  orgId: string;
  active: boolean;
  passwordChangeRequired?: boolean;
}

function view(u: UserDoc): AuthUserView {
  return {
    id: u._id,
    username: u.username,
    role: u.role,
    orgId: u.orgId,
    active: u.active,
    passwordChangeRequired: u.passwordChangeRequired,
  };
}

export class AuthError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

/** First-boot super-admin seeding: creates the founder's org + super-admin account if absent. */
export async function seedAdmin(username: string, password: string, deps: Deps): Promise<void> {
  const existing = await users.find({ role: 'super-admin' });
  if (existing.length > 0) return;
  const orgId = deps.genId();
  await orgs.insert({ _id: orgId, name: 'Founder', displayName: 'Founder', createdAt: new Date(deps.now()).toISOString() });
  const userId = deps.genId();
  await users.insert({
    _id: userId,
    username,
    passwordHash: await hashPassword(password),
    role: 'super-admin',
    orgId,
    active: true,
    passwordChangeRequired: true,
  });
  setActivation(userId, { active: true, billingLocked: false });
}

export async function login(username: string, password: string, rememberMe: boolean, deps: Deps): Promise<{ token: string; user: AuthUserView; passwordChangeRequired: boolean; expiresIn: number }> {
  const matches = await users.find({ username });
  const u = matches[0];
  if (!u || !(await verifyPassword(password, u.passwordHash))) {
    throw new AuthError('UNAUTHENTICATED', 401, 'Credenciais inválidas.');
  }
  // Deactivated accounts cannot mint a token (ACCOUNT_DISABLED). Check the AUTHORITATIVE
  // store field (login holds the row — no cache-miss window) and sync the write-through
  // map so the middleware is consistent. A billing lock does NOT block login — the account
  // authenticates and is refused per-request at the admission plane (middleware) with
  // BILLING_LOCKED (ch09 §9.7.1); that lock is preserved in the map from its cached value.
  const cached = getActivation(u._id);
  setActivation(u._id, { active: u.active, billingLocked: cached?.billingLocked ?? false });
  if (!u.active) throw new AuthError('ACCOUNT_DISABLED', 403, 'A sua conta está bloqueada. Contacte o suporte.');
  const { token, expiresIn } = signToken(
    { sub: u._id, role: u.role, scope: 'user', orgId: u.orgId, username: u.username, jti: `${u._id}.${deps.genId()}` },
    rememberMe,
  );
  return { token, user: view(u), passwordChangeRequired: !!u.passwordChangeRequired, expiresIn };
}

/**
 * Logout (F1, ch03 §3.8.1). Self: revoke the caller's jti (the middleware checks isRevoked on
 * every request, so the token dies immediately). Admin variant: super-admin anywhere, org-admin
 * scoped to its own org — the target's outstanding jtis are unknown (no per-user jti index), so
 * the target's token EPOCH is bumped, invalidating every outstanding token at once (same
 * mechanism as deactivation, ch09 §9.6). Cross-org for an org-admin reads as 'not-found' — no
 * user enumeration across orgs.
 */
export async function logoutSelf(claims: JwtClaims, deps: Deps): Promise<void> {
  await revoke(claims.jti, claims.sub, claims.exp ?? Math.floor(deps.now() / 1000) + 24 * 3600, deps.now());
}

export async function logoutOther(
  caller: Pick<JwtClaims, 'role' | 'orgId'>,
  targetUserId: string,
): Promise<'ok' | 'forbidden' | 'not-found'> {
  if (caller.role !== 'super-admin' && caller.role !== 'org-admin') return 'forbidden';
  const target = await users.get(targetUserId);
  if (!target) return 'not-found';
  if (caller.role === 'org-admin' && target.orgId !== caller.orgId) return 'not-found';
  // Epoch shares the JWT iat clock (real seconds), strictly after any token minted this second
  // (the setUserActive rule): every outstanding token for the target dies at once.
  bumpTokenEpoch(targetUserId, Math.floor(Date.now() / 1000) + 1);
  return 'ok';
}

/**
 * Self password change (F1, ch03 §3.8.1): verify the CURRENT password, hash + store the new
 * one, and clear `passwordChangeRequired` (the forced-change flow's exit). Wrong current
 * password is an AuthError 401 — never a silent overwrite.
 */
export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const u = await users.get(userId);
  if (!u) throw new AuthError('UNAUTHENTICATED', 401, 'Sessão expirada. Inicie sessão novamente.');
  if (!(await verifyPassword(currentPassword, u.passwordHash))) {
    throw new AuthError('UNAUTHENTICATED', 401, 'A palavra-passe atual está incorreta.');
  }
  const passwordHash = await hashPassword(newPassword);
  await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: false }));
}

/**
 * Admin password reset (F1, shared users.resetPassword): super-admin sets a new password and
 * FORCES a change on next login (`passwordChangeRequired: true`). Returns false when the user
 * does not exist (the router 404s).
 */
export async function resetPassword(userId: string, newPassword: string): Promise<boolean> {
  const passwordHash = await hashPassword(newPassword);
  const updated = await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: true }));
  return updated !== null;
}

/**
 * Deactivate a user (ch09 §9.7.1): one operation that (1) sets active=false in the store,
 * (2) updates the write-through activation map synchronously, (3) revokes the user's tokens.
 * `jtisToRevoke` are the user's outstanding token ids known to the caller/session registry.
 */
export async function setUserActive(
  userId: string,
  active: boolean,
  jtisToRevoke: Array<{ jti: string; expiresAtSec: number }>,
  deps: Deps,
): Promise<AuthUserView | null> {
  const cur = getActivation(userId);
  // MAP FIRST, synchronously (ch09 §9.7.1: the toggle updates the map synchronously so the
  // effect is immediate) — this closes the TOCTOU window where a concurrent login between
  // the store write and the cache update could mint a token off the stale cache. On
  // deactivation the token epoch is bumped so EVERY outstanding token is invalidated at once
  // (no per-user jti index needed); any explicitly-known jtis are additionally revoked.
  // The token epoch shares the JWT `iat` clock (real seconds), strictly after any token
  // minted this second, so every outstanding token is invalidated. deps.now drives stored
  // record timestamps; the epoch must track real time to align with jsonwebtoken's iat.
  const epochSec = Math.floor(Date.now() / 1000) + 1;
  setActivation(userId, { active, billingLocked: cur?.billingLocked ?? false, tokenEpoch: active ? cur?.tokenEpoch ?? 0 : epochSec });
  if (!active) {
    for (const t of jtisToRevoke) await revoke(t.jti, userId, t.expiresAtSec, deps.now());
  }
  const updated = await users.update(userId, (u) => ({ ...u, active }));
  if (!updated) {
    // The user vanished — restore the prior cache entry if we had one to avoid a phantom state.
    if (cur) setActivation(userId, cur);
    return null;
  }
  return view(updated);
}

export { view as authUserView };
