/**
 * bridge/token.ts — the bridge-token class (ch18 §18.3.2, §18.3.6; ch09 §9.2). A pairing token
 * is a SECOND token class over the SAME JWT secret as the platform session token, never
 * interchangeable with it: audience `ekoa-bridge`, a `pairingId` claim (carried alias
 * `connectionId`), TTL 600 s. The bridge verifier positively rejects platform tokens (no
 * `ekoa-bridge` audience => `jwt.verify` throws) and the platform verifier positively rejects
 * bridge tokens (the additive guard in auth/jwt.ts). Two classes, one secret (§18.3.6).
 */
import jwt from 'jsonwebtoken';
import { loadConfig } from '../config.js';

/** The bridge audience — the class marker that separates a pairing token from a platform JWT. */
export const BRIDGE_AUDIENCE = 'ekoa-bridge';

/** Default bridge-token TTL (§18.3.2; reference/invisible-behaviors.md §1.5). */
export const BRIDGE_TOKEN_TTL_SECONDS = 600;

/** The claims carried by a verified bridge token. `connectionId` is the carried alias of
 *  `pairingId` (§18.3.2) and always mirrors it on a token this module mints. */
export interface BridgeTokenClaims {
  sub: string; // owner user id (the pairing owner)
  pairingId: string; // the pairing this token authorises
  connectionId: string; // carried alias of pairingId (compat)
  aud: string; // BRIDGE_AUDIENCE
  exp?: number;
  iat?: number;
}

/** A connect-time / provider-time bridge auth failure. `reason` is a stable machine code used
 *  in the connect-auth chain (§18.3.2): `connection-mismatch`, `ownership-mismatch`, etc. */
export class BridgeAuthError extends Error {
  constructor(readonly reason: string, message?: string) {
    super(message ?? reason);
    this.name = 'BridgeAuthError';
  }
}

/**
 * Mint a short-lived bridge token from a platform user's claims for a specific pairing (§18.3.2).
 * Signed with the SAME secret as platform JWTs (loadConfig().jwtSecret) but in the bridge class:
 * `aud: ekoa-bridge` + a `pairingId` claim make it un-usable on the platform API (the platform
 * verifier rejects it — auth/jwt.ts) and bound to exactly one pairing on the bridge upgrade.
 */
export function mintBridgeToken(userClaims: { sub: string }, pairingId: string): { token: string; expiresIn: number } {
  const expiresIn = BRIDGE_TOKEN_TTL_SECONDS;
  const token = jwt.sign(
    { sub: userClaims.sub, pairingId, connectionId: pairingId },
    loadConfig().jwtSecret,
    { algorithm: 'HS256', audience: BRIDGE_AUDIENCE, expiresIn },
  );
  return { token, expiresIn };
}

/**
 * Verify a bridge token's signature + class and return its claims, WITHOUT binding it to a path
 * pairing. HS256 only (no alg downgrade); the `audience` option makes `jwt.verify` reject any
 * token whose `aud !== ekoa-bridge` — so a platform session JWT (no audience) is rejected here,
 * which is the bridge half of the token-class separation (§18.3.6). Used by the provider-endpoint
 * credential resolution (§18.4.4), where the pairing is read FROM the credential, not asserted.
 */
export function readBridgeToken(token: string): BridgeTokenClaims {
  const decoded = jwt.verify(token, loadConfig().jwtSecret, {
    algorithms: ['HS256'],
    audience: BRIDGE_AUDIENCE,
  }) as Partial<BridgeTokenClaims> & { sub?: string };
  // Belt-and-braces beyond the `audience` verify option.
  if (decoded.aud !== BRIDGE_AUDIENCE) throw new BridgeAuthError('audience-mismatch', 'not a bridge token');
  const pairingId = decoded.pairingId ?? decoded.connectionId;
  if (!pairingId || typeof pairingId !== 'string') throw new BridgeAuthError('missing-pairing-claim', 'bridge token has no pairing claim');
  if (!decoded.sub || typeof decoded.sub !== 'string') throw new BridgeAuthError('missing-subject', 'bridge token has no subject');
  return { sub: decoded.sub, pairingId, connectionId: decoded.connectionId ?? pairingId, aud: decoded.aud, exp: decoded.exp, iat: decoded.iat };
}

/**
 * Verify a bridge token AND bind it to the pairing id in the URL path (§18.3.2): the token's
 * pairing claim must equal `expectedPairingId`, else `connection-mismatch`. This is the connect
 * upgrade's first auth step.
 */
export function verifyBridgeToken(token: string, expectedPairingId: string): BridgeTokenClaims {
  const claims = readBridgeToken(token);
  if (claims.pairingId !== expectedPairingId) {
    throw new BridgeAuthError('connection-mismatch', 'bridge token pairing does not match the path');
  }
  return claims;
}

/**
 * Cheap structural test used by the platform verifier's rejection guard (auth/jwt.ts): a decoded
 * payload that carries the bridge audience or a pairing/connection claim is a bridge token and must
 * never verify as a platform token (§18.3.6, ch09 §9.2). Kept here so the two classes' shape rules
 * live in one place.
 */
export function looksLikeBridgeToken(payload: Record<string, unknown>): boolean {
  return payload.aud === BRIDGE_AUDIENCE || payload.pairingId !== undefined || payload.connectionId !== undefined;
}
