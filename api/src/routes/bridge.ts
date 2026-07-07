/**
 * routes/bridge.ts — the bridge token mint (ch03 §3.10; ch18 §18.3.2). `POST /api/v1/bridge/token`
 * takes an authenticated PLATFORM JWT and returns a short-lived BRIDGE-class token for a pairing.
 * requireAuth verifies the platform token (and, via the token-class guard in auth/jwt.ts, refuses a
 * bridge token presented here). The WS connect + provider endpoint are NOT REST — they live on the
 * WS server (bridge/server.ts), mounted at the composition root.
 */
import { Router, type Response } from 'express';
import type { BridgeTokenResponse } from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { mintBridgeToken } from '../bridge/index.js';

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

  return r;
}
