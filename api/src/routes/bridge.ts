/**
 * routes/bridge.ts — the bridge token mint (ch03 §3.10; ch18 §18.3.2). `POST /api/v1/bridge/token`
 * takes an authenticated PLATFORM JWT and returns a short-lived BRIDGE-class token for a pairing.
 * requireAuth verifies the platform token (and, via the token-class guard in auth/jwt.ts, refuses a
 * bridge token presented here). The WS connect + provider endpoint are NOT REST — they live on the
 * WS server (bridge/server.ts), mounted at the composition root.
 */
import { Router, type Response } from 'express';
import type { BridgeStatusResponse, BridgeTokenResponse } from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { getConnectionByOwner, getPairingsByOwner, mintBridgeToken } from '../bridge/index.js';

/** Carried charset for a pairing/connection id (reference/invisible-behaviors.md §9.1). */
const PAIRING_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function bridgeTokenRouter(): Router {
  const r = Router();

  r.post('/token', requireAuth, (req: AuthedRequest, res: Response) => {
    const body = (req.body ?? {}) as { pairingId?: unknown; connectionId?: unknown };
    const raw = body.pairingId ?? body.connectionId ?? 'default';
    const pairingId = String(raw);
    if (!PAIRING_ID.test(pairingId)) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Identificador de emparelhamento inválido.' } });
    }
    const { token, expiresIn } = mintBridgeToken({ sub: req.user!.sub }, pairingId);
    const payload: BridgeTokenResponse = { token, expiresIn };
    res.json(payload);
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
