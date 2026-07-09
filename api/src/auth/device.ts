/**
 * Device authorization flow (F1, ch03 §3.8.1; shared/src/auth.ts deviceStart/devicePoll/
 * deviceApprove). A minimal mongo-backed state machine per the shared contract:
 *
 *   start (public)   -> a pending row { deviceCode, userCode, expiresAt }
 *   approve (authed) -> pending -> approved (binds the APPROVER's identity) | denied
 *   poll (public)    -> pending | slow_down | denied | expired
 *                       | approved { token, user, expiresIn } — SINGLE-USE: the row is
 *                       consumed on the approved poll; a replayed deviceCode never re-mints.
 *
 * Codes: deviceCode is a 128-bit random secret (the polling capability); userCode is a short
 * human-typable code shown on the device (the approval capability). Expiry + poll interval are
 * enforced server-side; polling faster than the interval yields slow_down (RFC 8628 semantics,
 * minimally). Rows self-expire: any poll/approve past expiresAt flips the row to expired.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { getDb } from '../data/mongo.js';
import { users } from '../data/stores.js';
import { signToken } from './jwt.js';
import { authUserView, mintIat, type AuthUserView, type Deps } from './service.js';

const COLLECTION = 'device_auth';
const EXPIRES_IN_SEC = 600; // 10 min approval window
const POLL_INTERVAL_SEC = 5;

interface DeviceAuthDoc {
  _id: string; // deviceCode
  userCode: string;
  status: 'pending' | 'approved' | 'denied';
  /** Set on approval: the approver's user id (whose identity the device token carries). */
  userId?: string;
  createdAtMs: number;
  expiresAtMs: number;
  lastPollAtMs?: number;
}

const col = () => getDb().collection<DeviceAuthDoc>(COLLECTION);

/** Short human-typable approval code, XXXX-XXXX over an unambiguous alphabet. */
function newUserCode(): string {
  const alphabet = 'BCDFGHJKLMNPQRSTVWXZ23456789';
  const pick = () => alphabet[randomBytes(1)[0]! % alphabet.length];
  const part = () => Array.from({ length: 4 }, pick).join('');
  return `${part()}-${part()}`;
}

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

export async function startDeviceAuth(deps: Deps): Promise<DeviceStart> {
  const deviceCode = randomUUID() + randomUUID().replace(/-/g, '');
  const userCode = newUserCode();
  const now = deps.now();
  await col().insertOne({
    _id: deviceCode,
    userCode,
    status: 'pending',
    createdAtMs: now,
    expiresAtMs: now + EXPIRES_IN_SEC * 1000,
  });
  return { deviceCode, userCode, verificationUri: '/settings/devices', interval: POLL_INTERVAL_SEC, expiresIn: EXPIRES_IN_SEC };
}

export type DevicePoll =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'approved'; token: string; user: AuthUserView; expiresIn: number };

export async function pollDeviceAuth(deviceCode: string, deps: Deps): Promise<DevicePoll> {
  const now = deps.now();
  const row = await col().findOne({ _id: deviceCode });
  if (!row) return { status: 'expired' }; // unknown == expired: no oracle for guessing codes
  if (now >= row.expiresAtMs) {
    await col().deleteOne({ _id: deviceCode });
    return { status: 'expired' };
  }
  if (row.lastPollAtMs !== undefined && now - row.lastPollAtMs < POLL_INTERVAL_SEC * 1000 && row.status === 'pending') {
    await col().updateOne({ _id: deviceCode }, { $set: { lastPollAtMs: now } });
    return { status: 'slow_down' };
  }
  await col().updateOne({ _id: deviceCode }, { $set: { lastPollAtMs: now } });

  if (row.status === 'pending') return { status: 'pending' };
  if (row.status === 'denied') {
    await col().deleteOne({ _id: deviceCode });
    return { status: 'denied' };
  }
  // approved: CONSUME the row atomically FIRST, then mint. findOneAndDelete is the single
  // mongo operation that both claims and removes it, so two concurrent polls of the same
  // approved code can never both mint a token (the loser sees no row).
  const claimed = await col().findOneAndDelete({ _id: deviceCode, status: 'approved' });
  if (!claimed) return { status: 'expired' }; // another poll already consumed it
  const u = claimed.userId ? await users.get(claimed.userId) : null;
  if (!u || !u.active) return { status: 'expired' }; // approver vanished/deactivated: fail closed
  const { token, expiresIn } = signToken(
    { sub: u._id, role: u.role, scope: 'user', orgId: u.orgId, username: u.username, jti: `${u._id}.${deps.genId()}`, iat: mintIat(u._id) },
    false,
  );
  return { status: 'approved', token, user: authUserView(u), expiresIn };
}

/** Approve (or deny) a pending device code as the AUTHED user. Returns false when the userCode
 *  matches no live pending row (expired rows are treated as absent). */
export async function approveDeviceAuth(userCode: string, approverUserId: string, deny: boolean, deps: Deps): Promise<boolean> {
  const now = deps.now();
  const row = await col().findOne({ userCode, status: 'pending' });
  if (!row || now >= row.expiresAtMs) return false;
  await col().updateOne(
    { _id: row._id, status: 'pending' },
    { $set: deny ? { status: 'denied' as const } : { status: 'approved' as const, userId: approverUserId } },
  );
  return true;
}
