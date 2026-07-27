/**
 * routes/bridge.ts — the bridge token mint (ch03 §3.10; ch18 §18.3.2). `POST /api/v1/bridge/token`
 * takes an authenticated PLATFORM JWT and returns a short-lived BRIDGE-class token for a pairing.
 * requireAuth verifies the platform token (and, via the token-class guard in auth/jwt.ts, refuses a
 * bridge token presented here). The WS connect + provider endpoint are NOT REST — they live on the
 * WS server (bridge/server.ts), mounted at the composition root.
 *
 * COFRE R-8/R-9. Two additions:
 *   - `/token` also returns the pairing's PER-PAIRING task-signing secret. It used to be the
 *     platform-wide JWT secret, so making delegation work meant copying the key that signs every
 *     user's session onto every paired laptop. Delivered here because this is already the
 *     authenticated, owner-bound, TLS-protected exchange the daemon makes before every dial.
 *   - `DELETE /pairings/:pairingId` mounts the kill switch. `revokePairing` existed in the registry
 *     with revocation-tombstone semantics and a live-socket close, and had NO production caller at
 *     all — it was reachable only from tests, so a compromised machine could not be cut off except
 *     by deactivating the whole account.
 */
import { Router, type Response } from 'express';
import type { BridgeStatusResponse, BridgeTokenResponse } from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import {
  getConnectionByOwner,
  getPairingById,
  getPairingsByOwner,
  getPairingSigningSecret,
  mintBridgeToken,
  revokePairingAudited,
} from '../bridge/index.js';

/** True when `userId` owns a non-revoked pairing with this id. */
async function ownsPairing(userId: string, pairingId: string): Promise<boolean> {
  const rows = await getPairingsByOwner(userId);
  return rows.some((row) => row.pairingId === pairingId);
}

/** Carried charset for a pairing/connection id (reference/invisible-behaviors.md §9.1). */
const PAIRING_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function bridgeTokenRouter(): Router {
  const r = Router();

  r.post('/token', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = (req.body ?? {}) as { pairingId?: unknown; connectionId?: unknown };
    const raw = body.pairingId ?? body.connectionId ?? 'default';
    const pairingId = String(raw);
    if (!PAIRING_ID.test(pairingId)) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Identificador de emparelhamento inválido.' } });
    }
    const { token, expiresIn } = mintBridgeToken({ sub: req.user!.sub }, pairingId);
    // R-8: hand the daemon its pairing's own signing secret. Only the OWNER of a live, non-revoked
    // pairing gets one; an unknown or revoked pairing simply omits it, and the daemon then fails
    // closed (its verifier refuses an empty secret) rather than falling back to anything.
    const signingSecret = await getPairingSigningSecret(pairingId, req.user!.orgId);
    const payload: BridgeTokenResponse = {
      token,
      expiresIn,
      ...(signingSecret && (await ownsPairing(req.user!.sub, pairingId)) ? { signingSecret } : {}),
    };
    res.json(payload);
  });

  /**
   * R-9 — the kill switch, previously unreachable. Revoking is terminal and survives a redial
   * (`registerPairing` preserves the tombstone), and it closes the live socket immediately.
   * Owner-or-org-admin: a compromised machine is exactly the case where the org's admin may need to
   * act without the owner. Answers 404 (never 403) for a pairing outside the caller's scope so the
   * route is not an existence oracle.
   */
  r.delete('/pairings/:pairingId', requireAuth, async (req: AuthedRequest, res: Response) => {
    const pairingId = String(req.params.pairingId ?? '');
    if (!PAIRING_ID.test(pairingId)) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Identificador de emparelhamento inválido.' } });
    }
    const actor = req.user!;
    const row = await getPairingById(pairingId, actor.orgId);
    const isOwner = row?.ownerUserId === actor.sub;
    const isOrgAdmin = actor.role === 'org-admin' || actor.role === 'super-admin';
    if (!row || !(isOwner || isOrgAdmin)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Emparelhamento não encontrado.' } });
    }
    // Revoke + Registo row as ONE domain operation: routes/ may not import data/ (ch02 §2.7), so
    // the audit write lives in bridge/, not here.
    const revoked = await revokePairingAudited(
      pairingId,
      { userId: actor.sub, orgId: actor.orgId, ...(actor.username ? { username: actor.username } : {}) },
      row.ownerUserId,
    );
    res.json({ ok: true, revoked });
  });

  // FC-401/FC-405 presence (ch18 §18.3.3): owner-scoped, derived from the pairing registry
  // ONLY — never a daemon round trip. "not installed" = no non-revoked row for this user;
  // "offline" = a row but no live socket; "connected" = a live socket in this process.
  r.get('/status', requireAuth, async (req: AuthedRequest, res: Response) => {
    const owner = req.user!.sub;
    const liveConn = getConnectionByOwner(owner);
    if (liveConn) {
      const payload: BridgeStatusResponse = {
        paired: true,
        live: true,
        pairingId: liveConn.pairingId,
        lastSeenAt: liveConn.lastSeenAt,
      };
      return res.json(payload);
    }
    const rows = await getPairingsByOwner(owner);
    if (rows.length === 0) {
      const payload: BridgeStatusResponse = { paired: false, live: false };
      return res.json(payload);
    }
    const payload: BridgeStatusResponse = { paired: true, live: false, pairingId: rows[0]!.pairingId };
    res.json(payload);
  });

  return r;
}
