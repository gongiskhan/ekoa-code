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
import type {
  BridgeGrantCapabilityResponse,
  BridgeMachinesResponse,
  BridgeRevokeCapabilityResponse,
  BridgeStatusResponse,
  BridgeTokenResponse,
} from '@ekoa/shared';
import { BridgeGrantCapabilityRequest } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import {
  CapabilityGrantError,
  getConnectionByOwner,
  getPairingById,
  getPairingsByOwner,
  getPairingSigningSecret,
  grantCapabilityAudited,
  machineForOrg,
  mintBridgeToken,
  orgMachines,
  revokeCapabilityAudited,
  revokePairingAudited,
} from '../bridge/index.js';
import { sendError, parseBody } from './helpers.js';

/** True when `userId` owns a non-revoked pairing with this id. */
async function ownsPairing(userId: string, pairingId: string): Promise<boolean> {
  const rows = await getPairingsByOwner(userId);
  return rows.some((row) => row.pairingId === pairingId);
}

/** Carried charset for a pairing/connection id (reference/invisible-behaviors.md §9.1). */
const PAIRING_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Carried charset for a capability name. Deliberately WIDER than the closed `BridgeCapability`
 *  vocabulary, because this guards the REVOKE path too and a grant for a capability since removed
 *  from that vocabulary must stay revocable. Granting is narrowed to the enum at the body schema. */
const CAPABILITY = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The role gate on the three capability-grant routes, matching the tier their descriptors declare
 * (`auth: 'org-admin'`) and the shape `routes/registo.ts` uses for that same tier.
 *
 * BOTH ROLES ARE NAMED because `requireRole` is an exact membership test (`auth/middleware.ts`):
 * it does not treat `super-admin` as a superset of `org-admin`, so `requireRole('org-admin')`
 * alone would refuse a super-admin.
 *
 * IT IS MIDDLEWARE, so it runs before the handler and therefore before any store read. That
 * ordering is the security property rather than a style choice: the refusal depends on the
 * caller's ROLE alone, so it is identical for a machine that exists, one that does not, and one in
 * another tenant - a non-admin learns nothing about the fleet by probing. Only callers past it
 * reach the org-scoped lookup, whose own 404 is then uniform across "unknown" and "not yours"
 * (`machineForOrg`). Hand-rolled as the first line of each handler this held by convention; as
 * middleware it holds by construction.
 *
 * Deliberately NOT the owner-or-admin rule `DELETE /pairings/:pairingId` uses. That route lets an
 * owner cut off their own compromised machine, which is an emergency anyone must be able to
 * perform on their own hardware. Granting is the opposite direction: it WIDENS what the org's work
 * may be routed through, so the answer belongs to whoever answers for the tenant. A user who could
 * grant their own machine `local.bash` would be authorising their own laptop to execute the org's
 * automations - the self-authorisation this whole field exists to prevent.
 */
const requireGrantAdmin = requireRole('org-admin', 'super-admin');

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
    // R-8: hand the daemon its pairing's own signing secret AND the org that pairing is scoped to.
    // Only the OWNER of a live, non-revoked pairing gets them; an unknown or revoked pairing simply
    // omits both, and the daemon then fails closed (its verifier refuses an empty secret) rather
    // than falling back to anything.
    //
    // The org travels WITH the secret because the daemon needs both to accept a task: its verifier
    // checks the signature first and cross-org addressing second, so a daemon holding the secret
    // and no org denies every delegated task on a check the signature failure used to mask. The org
    // is the authenticated caller's own (`req.user.orgId`), never a request-body value, and this is
    // already the owner-bound TLS exchange the daemon makes before every dial - no new trust surface.
    const signingSecret = await getPairingSigningSecret(pairingId, req.user!.orgId);
    const payload: BridgeTokenResponse = {
      token,
      expiresIn,
      ...(signingSecret && (await ownsPairing(req.user!.sub, pairingId))
        ? { signingSecret, org: req.user!.orgId }
        : {}),
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

  /**
   * The org's paired machines, each carrying what it ADVERTISES and what the org has GRANTED
   * (I-3). Two lists rather than one because they answer different questions - "what can this
   * computer do" versus "what may our work be routed through it for" - and the surface that
   * conflates them is the one that lets a machine's self-assertion read as an authorisation.
   */
  r.get('/machines', requireAuth, requireGrantAdmin, async (req: AuthedRequest, res: Response) => {
    const actor = req.user!;
    const payload: BridgeMachinesResponse = { items: await orgMachines(actor.orgId) };
    res.json(payload);
  });

  /**
   * Turn a capability ON for one machine, for this org. The write the whole I-3 model was missing:
   * `grantCapability` existed with no caller, so `daemon-step-seam.ts`'s default-deny refused every
   * browser and bash step in production and no administrator had any way to say otherwise.
   *
   * The org is `actor.orgId` and the granter is `actor.sub`. Neither is ever a body value, so a
   * grant cannot be aimed at another tenant or attributed to another person.
   */
  r.post('/pairings/:pairingId/capabilities', requireAuth, requireGrantAdmin, async (req: AuthedRequest, res: Response) => {
    const pairingId = String(req.params.pairingId ?? '');
    if (!PAIRING_ID.test(pairingId)) {
      return sendError(res, 'VALIDATION_FAILED', 'Identificador de emparelhamento inválido.');
    }
    const actor = req.user!;
    const body = parseBody(res, BridgeGrantCapabilityRequest, req.body ?? {});
    if (!body) return;
    // Org-scoped: a machine in another tenant is indistinguishable from one that does not exist.
    if (!(await machineForOrg(actor.orgId, pairingId))) {
      return sendError(res, 'NOT_FOUND', 'Máquina não encontrada.');
    }
    try {
      await grantCapabilityAudited(
        {
          pairingId,
          capability: body.capability,
          ...(body.egressEndpoint !== undefined ? { egressEndpoint: body.egressEndpoint } : {}),
        },
        { userId: actor.sub, orgId: actor.orgId, ...(actor.username ? { username: actor.username } : {}) },
      );
    } catch (error) {
      // A residential-egress grant with no usable endpoint is a CALLER error, and its message names
      // what is missing. Swallowing it would store nothing and answer 200 - the grant that
      // authorises no route, which is the exact failure `CapabilityGrantError` was raised to stop.
      if (error instanceof CapabilityGrantError) {
        return sendError(res, 'VALIDATION_FAILED', error.message);
      }
      throw error;
    }
    // Re-read rather than assemble: the response then shows what is actually stored, including the
    // canonicalised endpoint and the case where the machine does not advertise what was granted.
    const machine = await machineForOrg(actor.orgId, pairingId);
    if (!machine) return sendError(res, 'NOT_FOUND', 'Máquina não encontrada.');
    const payload: BridgeGrantCapabilityResponse = { ok: true, machine };
    res.json(payload);
  });

  /** Turn a capability OFF. Idempotent: `revoked: false` means there was no live grant, which is
   *  the state the caller asked for, so it is a 200 and not a 404. */
  r.delete('/pairings/:pairingId/capabilities/:capability', requireAuth, requireGrantAdmin, async (req: AuthedRequest, res: Response) => {
    const pairingId = String(req.params.pairingId ?? '');
    const capability = String(req.params.capability ?? '');
    if (!PAIRING_ID.test(pairingId) || !CAPABILITY.test(capability)) {
      return sendError(res, 'VALIDATION_FAILED', 'Identificador inválido.');
    }
    const actor = req.user!;
    if (!(await machineForOrg(actor.orgId, pairingId))) {
      return sendError(res, 'NOT_FOUND', 'Máquina não encontrada.');
    }
    const revoked = await revokeCapabilityAudited(
      { pairingId, capability },
      { userId: actor.sub, orgId: actor.orgId, ...(actor.username ? { username: actor.username } : {}) },
    );
    const machine = await machineForOrg(actor.orgId, pairingId);
    if (!machine) return sendError(res, 'NOT_FOUND', 'Máquina não encontrada.');
    const payload: BridgeRevokeCapabilityResponse = { ok: true, revoked, machine };
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
