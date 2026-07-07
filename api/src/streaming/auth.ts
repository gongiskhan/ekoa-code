/**
 * streaming/auth.ts — short-TTL canvas token mint + verify (ch03 §3.7 carve-out, B17 port).
 *
 * The token rides the automation run's `streaming_available` SSE event ({ token, wsUrl,
 * viewport }, ch03 §3.6.3) and authenticates the WebSocket upgrade — it is the ONLY auth on
 * the media channel (no JSON API payload ever crosses it). It is a distinct, short-lived JWT
 * bound to { userId, traceId }, signed with the same secret as session tokens but NEVER a
 * session token itself. Per module-map §2.6, streaming/ imports config.ts only.
 */
import jwt, { type SignOptions } from 'jsonwebtoken';
import { loadConfig } from '../config.js';

const TOKEN_TTL_SECONDS = parseInt(process.env.EKOA_STREAMING_TOKEN_TTL_SECONDS || '600', 10);

export interface StreamTokenClaims {
  sub: string;
  traceId: string;
  iat: number;
  exp: number;
}

export function signStreamToken(payload: { userId: string; traceId: string }): string {
  const opts: SignOptions = { expiresIn: TOKEN_TTL_SECONDS };
  return jwt.sign(
    { sub: payload.userId, traceId: payload.traceId },
    loadConfig().jwtSecret,
    opts,
  );
}

export type StreamAuthFailure =
  | { ok: false; reason: 'jwt-invalid' }
  | { ok: false; reason: 'jwt-missing' }
  | { ok: false; reason: 'trace-mismatch' };

export type StreamAuthSuccess = { ok: true; claims: StreamTokenClaims };

export function verifyStreamToken(token: string | undefined, expectedTraceId: string): StreamAuthSuccess | StreamAuthFailure {
  if (!token) return { ok: false, reason: 'jwt-missing' };
  let decoded: jwt.JwtPayload;
  try {
    const result = jwt.verify(token, loadConfig().jwtSecret);
    if (typeof result === 'string') return { ok: false, reason: 'jwt-invalid' };
    decoded = result;
  } catch {
    return { ok: false, reason: 'jwt-invalid' };
  }
  const sub = decoded.sub;
  const traceId = decoded.traceId;
  if (typeof sub !== 'string' || typeof traceId !== 'string') {
    return { ok: false, reason: 'jwt-invalid' };
  }
  if (traceId !== expectedTraceId) {
    return { ok: false, reason: 'trace-mismatch' };
  }
  return {
    ok: true,
    claims: {
      sub,
      traceId,
      iat: typeof decoded.iat === 'number' ? decoded.iat : 0,
      exp: typeof decoded.exp === 'number' ? decoded.exp : 0,
    },
  };
}

export function tokenTtlSeconds(): number {
  return TOKEN_TTL_SECONDS;
}
