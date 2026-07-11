/**
 * Purpose-scoped app-preview tokens (ch07 §7.7 owner-bypass, verify-runner access).
 *
 * The per-build verifier drives the just-built app over HTTP, but a draft, non-shareable
 * artifact's document is gated to its OWNER (serving.ts §7.7) - and the verify agent must
 * never carry a real user JWT in its prompt/transcript (it would authenticate on EVERY API
 * route). This token grants exactly ONE capability: viewing ONE artifact's served document,
 * for a few minutes. It is not a JWT; it can never be confused for a session credential.
 *
 * Shape: `pv1.<artifactId>.<expMs>.<hmac-sha256-hex(artifactId + '.' + expMs)>`, keyed off
 * the process JWT secret. Verification is timing-safe and checks expiry.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../config.js';

const PREFIX = 'pv1';

function sig(artifactId: string, expMs: number): string {
  return createHmac('sha256', `app-preview:${loadConfig().jwtSecret}`)
    .update(`${artifactId}.${expMs}`)
    .digest('hex');
}

/** Mint a preview token for one artifact, valid for `ttlMs`. */
export function mintPreviewToken(artifactId: string, ttlMs: number): string {
  const exp = Date.now() + ttlMs;
  return `${PREFIX}.${artifactId}.${exp}.${sig(artifactId, exp)}`;
}

/** Verify a preview token; returns the artifactId it grants or null (bad shape/sig/expired). */
export function verifyPreviewToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, artifactId, expStr, mac] = parts as [string, string, string, string];
  const exp = Number(expStr);
  if (!artifactId || !Number.isFinite(exp) || Date.now() > exp) return null;
  const expected = sig(artifactId, exp);
  const a = Buffer.from(mac, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? artifactId : null;
}
