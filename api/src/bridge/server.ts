/**
 * bridge/server.ts — the daemon-facing WebSocket server (ch18 §18.3). The ekoa-local daemon dials
 * OUT to Cortex (NAT-friendly; Cortex is the WS server, §18.3.1). This attaches a `noServer`
 * WebSocketServer to the HTTP server and scopes the Upgrade to `/api/v1/bridge/connect/:pairingId`
 * ONLY — Upgrades to any other path are left untouched for other listeners (the streaming media
 * channel), never destroyed.
 *
 * Connect auth is an ordered chain (§18.3.2): bridge-token verify -> pairing claim == path pairing
 * (`connection-mismatch`) -> resolved owner == token subject (`ownership-mismatch`) -> activation
 * admission (a deactivated owner is refused ACCOUNT_DISABLED, billing-locked BILLING_LOCKED — the
 * bridge is the THIRD admission plane, §18.3.2). On accept the durable pairing row is written and
 * the live socket registered; a presence heartbeat (§18.3.3) tracks live/offline; every inbound
 * frame is validated with BridgeFrame and dropped if unparseable/invalid (§18.3.1); `provider_request`
 * frames route to the provider endpoint (§18.4), `delegation_result` frames resolve the awaiting
 * delegation (§18.2), and a socket close fails every in-flight delegation cleanly (§18.3.5, S4).
 *
 * This is daemon-to-Cortex transport, explicitly OUTSIDE FIXED-2's frontend no-WebSockets rule
 * (§18.3.7); its governing invariants are the token-class separation, outbound-only/revocable, and
 * the pairing registry's org scoping.
 */
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { BridgeFrame, type EgressLedgerRow } from '@ekoa/shared';
import { getActivation as defaultGetActivation } from '../data/activation.js';
import { users } from '../data/stores.js';
import { verifyBridgeToken, BridgeAuthError } from './token.js';
import {
  registerPairing,
  attachLiveConnection,
  removeLiveConnection,
  getLiveConnection,
  isLive,
  getPairingById,
  isRevoked,
  sendToPairing,
  markAlive,
  markStale,
} from './registry.js';
import { resolveDelegationResult, resolveDenial, failDelegationsForPairing } from './delegation.js';
import { createProviderHandler, type ProviderHandler } from './provider.js';

const CONNECT_PATH = /^\/api\/v1\/bridge\/connect\/([^/?]+)$/;
const DEFAULT_HEARTBEAT_MS = 30_000;

export interface BridgeServerDeps {
  now?: () => number;
  /** userId -> org for the registry row. Default: the users store. */
  resolveUserOrg?: (userId: string) => Promise<string | undefined>;
  getActivation?: (userId: string) => { active: boolean; billingLocked: boolean } | undefined;
  /** Optional resolved-owner check (§18.3.2). Default: the existing pairing row's owner. */
  resolveOwner?: (pairingId: string) => Promise<string | undefined>;
  /** The provider-request handler (§18.4). Default: the real chokepoint-backed handler. */
  provider?: ProviderHandler;
  /** Trust-chip ledger rows streamed up during a delegation (§18.3.8). Default: dropped hosted
   *  (not persisted by default, §18.6). */
  onLedgerRow?: (taskId: string, row: EgressLedgerRow) => void;
  heartbeatIntervalMs?: number;
}

export interface BridgeServerHandle {
  close(): Promise<void>;
}

interface ConnCtx {
  pairingId: string;
  org: string;
  ownerUserId: string;
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  500: 'Internal Server Error',
};

/** Refuse an Upgrade with a raw HTTP response carrying a CONV-2 error envelope, then destroy the
 *  socket. Used for every connect-auth rejection (§18.3.2). */
function refuse(socket: Duplex, status: number, code: string, message: string, reason?: string): void {
  const payload = JSON.stringify({ error: { code, message, ...(reason ? { details: { reason } } : {}) } });
  socket.write(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\n` +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
      'Connection: close\r\n\r\n' +
      payload,
  );
  socket.destroy();
}

function extractToken(req: IncomingMessage, url: URL): string | undefined {
  const header = req.headers['authorization'];
  if (typeof header === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (m) return m[1];
  }
  // ?token= is accepted only as a transition fallback (URL tokens leak into proxy logs, §18.3.2).
  return url.searchParams.get('token') ?? undefined;
}

/**
 * Attach the bridge WS server to an HTTP server (§18.3). Returns a handle whose `close()` tears
 * down the heartbeat, the Upgrade listener, and every managed socket.
 */
export function attachBridgeServer(httpServer: HttpServer, deps: BridgeServerDeps = {}): BridgeServerHandle {
  const now = deps.now ?? Date.now;
  const getActivation = deps.getActivation ?? defaultGetActivation;
  const resolveUserOrg =
    deps.resolveUserOrg ??
    (async (userId: string) => ((await users.get(userId)) as { orgId?: string } | null)?.orgId ?? undefined);
  const provider = deps.provider ?? createProviderHandler();
  const heartbeatMs = deps.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;

  const wss = new WebSocketServer({ noServer: true });
  // Sockets THIS server manages (ws -> pairingId), for the heartbeat sweep and teardown.
  const managed = new Map<WebSocket, string>();

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let url: URL;
    try {
      url = new URL(req.url ?? '', 'http://localhost');
    } catch {
      return; // unparseable target — not ours; leave the socket for other listeners
    }
    const m = CONNECT_PATH.exec(url.pathname);
    if (!m) return; // NOT a bridge connect path — do not touch the socket (scope, §18.3.1)
    const pairingId = decodeURIComponent(m[1] as string);

    void (async () => {
      const token = extractToken(req, url);
      if (!token) return refuse(socket, 401, 'UNAUTHENTICATED', 'Token de ponte em falta.');

      // 1 + 2. Verify the bridge token AND bind it to the path pairing (`connection-mismatch`).
      let claims;
      try {
        claims = verifyBridgeToken(token, pairingId);
      } catch (e) {
        const reason = e instanceof BridgeAuthError ? e.reason : 'invalid-token';
        return refuse(socket, 401, 'UNAUTHENTICATED', 'Token de ponte inválido.', reason);
      }

      // 3. Resolved owner must agree with the token subject (`ownership-mismatch`). The default
      // resolved owner is an existing pairing row's owner; a structural cross-owner grab is refused.
      const resolvedOwner = deps.resolveOwner ? await deps.resolveOwner(pairingId) : (await getPairingById(pairingId))?.ownerUserId;
      if (resolvedOwner !== undefined && resolvedOwner !== claims.sub) {
        return refuse(socket, 401, 'UNAUTHENTICATED', 'Emparelhamento pertence a outro utilizador.', 'ownership-mismatch');
      }

      // 4. Activation admission — the third admission plane (§18.3.2). Fail closed on a cache miss.
      const act = getActivation(claims.sub);
      if (!act || !act.active) return refuse(socket, 403, 'ACCOUNT_DISABLED', 'A sua conta está bloqueada. Contacte o suporte.');
      if (act.billingLocked) return refuse(socket, 402, 'BILLING_LOCKED', 'A sua conta tem um problema de faturação. Contacte o suporte.');

      // Establish the org scope for the durable row (§18.3.4). A user with no resolvable org cannot
      // be scoped — refuse rather than register an unscoped pairing.
      const org = await resolveUserOrg(claims.sub);
      if (!org) return refuse(socket, 401, 'UNAUTHENTICATED', 'Não foi possível determinar a organização.', 'org-unresolved');

      // Revocation is terminal (§18.3.5, S4): a revoked pairingId must NEVER reconnect - the kill
      // switch would be meaningless otherwise. Re-pairing after a revoke uses a FRESH pairingId
      // (ch10 §10.2 row 12), not this one. Only an EXISTING revoked row blocks - a first-time connect
      // has no row yet (registerPairing runs below), so check the row directly, not isRevoked (which
      // treats a missing row as "not live" = true).
      const priorRow = await getPairingById(pairingId);
      if (priorRow && priorRow.revokedAt !== null) {
        return refuse(socket, 401, 'UNAUTHENTICATED', 'Este emparelhamento foi revogado. Emparelhe de novo.', 'pairing-revoked');
      }

      // Persist the durable pairing row BEFORE accepting, so the provider credential chain (§18.4.4)
      // and delegation resolution never race an unwritten row.
      let registered;
      try {
        registered = await registerPairing({ pairingId, org, ownerUserId: claims.sub }, { now });
      } catch {
        return refuse(socket, 500, 'INTERNAL', 'Falha ao registar o emparelhamento.');
      }
      // Close the precheck->register TOCTOU (§18.3.5): registerPairing preserves any revocation
      // tombstone, so if a revoke won the race between the precheck above and this write, the stored
      // row is revoked - refuse rather than admit a just-revoked pairing.
      if (registered.revokedAt !== null) {
        return refuse(socket, 401, 'UNAUTHENTICATED', 'Este emparelhamento foi revogado. Emparelhe de novo.', 'pairing-revoked');
      }

      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, { pairingId, org, ownerUserId: claims.sub }));
    })();
  };

  function onConnection(ws: WebSocket, ctx: ConnCtx): void {
    attachLiveConnection({ pairingId: ctx.pairingId, org: ctx.org, ownerUserId: ctx.ownerUserId, ws });
    managed.set(ws, ctx.pairingId);

    ws.on('pong', () => markAlive(ctx.pairingId));
    ws.on('message', (data) => {
      void onMessage(ctx.pairingId, typeof data === 'string' ? data : (data as Buffer).toString(), ws);
    });
    ws.on('close', () => {
      managed.delete(ws);
      removeLiveConnection(ctx.pairingId, ws);
      // A closed / revoked socket fails every in-flight delegation cleanly (§18.3.5, S4).
      failDelegationsForPairing(ctx.pairingId);
    });
    ws.on('error', () => {
      /* the 'close' event that follows runs the cleanup */
    });
  }

  async function onMessage(pairingId: string, raw: string, ws: WebSocket): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // drop unparseable frames (§18.3.1)
    }
    const res = BridgeFrame.safeParse(parsed);
    if (!res.success) return; // drop invalid frames (§18.3.1)
    const frame = res.data;

    // Liveness guard (§18.3.5, S4): drop any inbound frame that did NOT come from the pairing's
    // CURRENT live socket - one that was revoked or REPLACED by a redial. Checking isLive(pairingId)
    // alone is insufficient: after a redial the replacement socket keeps the pairingId live, so a
    // late frame from the retired socket would still pass. Bind to the exact delivering ws.
    if (getLiveConnection(pairingId)?.ws !== ws) return;

    switch (frame.type) {
      case 'provider_request': {
        // Bind the credential to THIS socket's pairing (§18.4.4): the frame's credential must
        // resolve to the pairing whose live socket it arrived on.
        const outcome = await provider.handle(frame, pairingId);
        sendToPairing(pairingId, outcome.frame);
        break;
      }
      case 'delegation_result':
        resolveDelegationResult(frame.taskId, frame.result);
        break;
      case 'denial':
        if (frame.taskId) resolveDenial(frame.taskId);
        break;
      case 'ledger_row':
        deps.onLedgerRow?.(frame.taskId, frame.row);
        break;
      case 'ping':
        sendToPairing(pairingId, { type: 'pong' });
        break;
      case 'pong':
        markAlive(pairingId);
        break;
      // delegate / provider_response / cancel are hosted->daemon (outbound); inbound copies are the
      // wrong direction and are ignored.
      default:
        break;
    }
  }

  // Presence heartbeat (§18.3.3): a pairing's live/offline state IS its heartbeat state. Terminate a
  // socket that missed the previous ping's pong; otherwise mark it stale and ping again.
  const heartbeat = setInterval(() => {
    for (const [ws, pairingId] of managed) {
      const conn = getLiveConnection(pairingId);
      if (!conn || conn.ws !== ws) {
        managed.delete(ws);
        continue;
      }
      if (!conn.alive) {
        try {
          ws.terminate();
        } catch {
          /* noop */
        }
        continue;
      }
      markStale(pairingId);
      try {
        ws.ping();
      } catch {
        /* noop */
      }
    }
  }, heartbeatMs);
  if (typeof heartbeat === 'object' && 'unref' in heartbeat) heartbeat.unref();

  httpServer.on('upgrade', onUpgrade);

  return {
    async close(): Promise<void> {
      clearInterval(heartbeat);
      httpServer.removeListener('upgrade', onUpgrade);
      for (const ws of managed.keys()) {
        try {
          ws.close(1001, 'server-closing');
        } catch {
          /* noop */
        }
      }
      managed.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
