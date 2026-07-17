/**
 * Per-user LLM-gateway API keys (S4a, run 20260717). Long-lived, revocable, self-service
 * credentials for stock Anthropic clients (Claude Code) pointed at the gateway; the billee is
 * always the key OWNER. Secrets are `ekoa_gk_` + 32 random bytes base64url; at rest: the
 * sha256 (the store `_id`, so verification is one O(1) `get` - no index machinery, and
 * `Store.insert`'s duplicate-key refusal covers the 2^-256 collision) PLUS a 4-char display
 * tail of the secret (`secretHint`) - a deliberate, industry-standard recognition hint costing
 * 24 of 256 entropy bits (decision 2026-07-17; the full plaintext is never stored or logged).
 *
 * Admission on key use fails CLOSED through the activation cache exactly like the platform
 * middleware: unknown owner / inactive -> refused; billingLocked -> a distinct verdict the
 * gateway maps to 402. Verification lives here (auth/) and is INJECTED into the gateway as the
 * `verifyGatewayKey` seam - llm/ never imports auth/ (ch02 §2.7).
 */
import { createHash, randomBytes } from 'node:crypto';
import { gatewayKeys, type GatewayKeyDoc } from '../data/stores.js';
import { getActivation } from '../data/activation.js';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';

export const GATEWAY_KEY_PREFIX = 'ekoa_gk_';

/** At most one lastUsedAt write per key per interval - the anomaly surface must not turn
 *  every gateway turn into a store write. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000;
const lastUsedWrites = new Map<string, number>();

export type GatewayKeyVerdict =
  | {
      ok: true;
      userId: string;
      orgId: string;
      keyId: string;
      username: string;
      caps?: { maxCallsPerWindow?: number; maxSpendPerWindow?: number };
    }
  | { ok: false; reason: 'unknown' | 'revoked' | 'inactive' | 'billing_locked' };

export type VerifyGatewayKey = (secret: string) => Promise<GatewayKeyVerdict>;

function hashOf(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export interface MintedGatewayKey {
  id: string;
  /** The plaintext secret - returned exactly once, never stored. */
  key: string;
  label: string;
  secretHint: string;
  createdAt: string;
}

export async function mintGatewayKey(actor: ActivityActor, label: string, deps: LogActivityDeps): Promise<MintedGatewayKey> {
  const secret = GATEWAY_KEY_PREFIX + randomBytes(32).toString('base64url');
  const id = hashOf(secret);
  const doc: GatewayKeyDoc = {
    _id: id,
    ownerUserId: actor.userId,
    ownerUsername: actor.username,
    orgId: actor.orgId,
    label,
    secretHint: secret.slice(-4),
    createdAt: new Date(deps.now()).toISOString(),
  };
  const inserted = await gatewayKeys.insert(doc);
  if (!inserted) throw new Error('gateway key id collision');
  await logActivity(actor, 'security', 'gateway_key_minted', deps, { keyId: id, label });
  return { id, key: secret, label, secretHint: doc.secretHint, createdAt: doc.createdAt };
}

export interface GatewayKeyRow {
  id: string;
  label: string;
  secretHint: string;
  createdAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

/** Owner's keys, newest first. NEVER contains a secret (none is stored). */
export async function listGatewayKeys(ownerUserId: string): Promise<GatewayKeyRow[]> {
  const rows = await gatewayKeys.find({ ownerUserId } as Partial<GatewayKeyDoc>);
  return rows
    .map((d) => ({
      id: d._id,
      label: d.label,
      secretHint: d.secretHint,
      createdAt: d.createdAt,
      ...(d.revokedAt ? { revokedAt: d.revokedAt } : {}),
      ...(d.lastUsedAt ? { lastUsedAt: d.lastUsedAt } : {}),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Owner-only revoke; a foreign or unknown id returns false (the route answers uniform 404 -
 *  never a cross-user existence oracle). Idempotent on an already-revoked key. */
export async function revokeGatewayKey(actor: ActivityActor, keyId: string, deps: LogActivityDeps): Promise<boolean> {
  const doc = await gatewayKeys.get(keyId);
  if (!doc || doc.ownerUserId !== actor.userId) return false;
  if (!doc.revokedAt) {
    await gatewayKeys.update(keyId, (d) => ({ ...d, revokedAt: new Date(deps.now()).toISOString() }));
    await logActivity(actor, 'security', 'gateway_key_revoked', deps, { keyId, label: doc.label });
  }
  return true;
}

/** The gateway auth seam. Fail-closed: unknown/revoked/inactive/deleted owners are refused;
 *  a billing-locked owner gets a distinct verdict (402 at the gateway, matching the platform
 *  middleware posture). Revocation is durable (the doc row), effective on the next call. */
export async function verifyGatewayKey(secret: string): Promise<GatewayKeyVerdict> {
  if (!secret.startsWith(GATEWAY_KEY_PREFIX)) return { ok: false, reason: 'unknown' };
  const doc = await gatewayKeys.get(hashOf(secret));
  if (!doc) return { ok: false, reason: 'unknown' };
  if (doc.revokedAt) return { ok: false, reason: 'revoked' };
  const act = getActivation(doc.ownerUserId);
  if (!act || !act.active) return { ok: false, reason: 'inactive' };
  if (act.billingLocked) return { ok: false, reason: 'billing_locked' };
  const nowMs = Date.now();
  if (nowMs - (lastUsedWrites.get(doc._id) ?? 0) > LAST_USED_WRITE_INTERVAL_MS) {
    lastUsedWrites.set(doc._id, nowMs);
    void gatewayKeys.update(doc._id, (d) => ({ ...d, lastUsedAt: new Date(nowMs).toISOString() })).catch(() => {
      /* best-effort anomaly stamp - never fails the call */
    });
  }
  return {
    ok: true,
    userId: doc.ownerUserId,
    orgId: doc.orgId,
    keyId: doc._id,
    username: doc.ownerUsername,
    ...(doc.caps ? { caps: doc.caps } : {}),
  };
}

export function __resetGatewayKeysServiceForTests(): void {
  lastUsedWrites.clear();
}
