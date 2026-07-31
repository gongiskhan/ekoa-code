import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket as WsClient } from 'ws';
import jwt from 'jsonwebtoken';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { bridgePairings } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { mintBridgeToken, readBridgeToken, BRIDGE_AUDIENCE } from '../../src/bridge/token.js';
import { attachBridgeServer, type BridgeServerHandle } from '../../src/bridge/server.js';
import { isLive, bridgeConnectionCount, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';
import {
  spendConnectNonce,
  __resetConnectNoncesForTests,
  __spentNonceCount,
} from '../../src/bridge/connect-nonce.js';

/**
 * SECURITY SUITE — bridge connect replay + revocation (Cofre J-2).
 *
 * THE VULNERABILITY, stated as the thing that could actually happen: a bridge token is a 600-second
 * bearer credential, and `attachLiveConnection` retires the incumbent socket when a new one arrives
 * for the same pairing (correct for redial after a network blip). Compose the two and a captured
 * token was not merely replayable — replaying it EVICTED the real daemon and put the attacker's
 * socket in its place, so every subsequent `delegate` frame for that pairing was delivered to the
 * attacker. The decisive case below is therefore not "the replay is refused" but "the replay is
 * refused AND the real daemon still holds its socket": a fix that rejected the replay after
 * `handleUpgrade` had already run would pass the first assertion and still lose the daemon.
 *
 * Single-use is safe against the shipped counterpart by construction, not by hope:
 * `../ekoa-bridge/src/transport/bridge-socket.ts` calls `getToken()` immediately before EVERY dial
 * and `src/auth/bridge-token.ts` mints over HTTP with no caching — so a legitimate reconnect always
 * carries a jti that has never been seen. The "a fresh token still connects" case pins that.
 */
let mem: MongoMemoryServer;
let server: Server;
let handle: BridgeServerHandle;
let port: number;
/** Drives the heartbeat sweep fast enough to assert on, without sleeping for the 30s default. */
const HEARTBEAT_MS = 40;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-replay';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_bridge_replay_test');
  server = createServer();
  handle = attachBridgeServer(server, { resolveUserOrg: async () => 'org-1', heartbeatIntervalMs: HEARTBEAT_MS });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  await handle.close();
  await new Promise<void>((r) => server.close(() => r()));
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  __resetLiveConnectionsForTests();
  __resetConnectNoncesForTests();
  await bridgePairings.deleteMany({});
});

const wsUrl = (pairingId: string) => `ws://127.0.0.1:${port}/api/v1/bridge/connect/${pairingId}`;

/** Dial with an explicit token. Resolves `{ok:true}` on open, or `{ok:false, status, reason}` on a
 *  refused Upgrade — the refusal carries the CONV-2 envelope `refuse()` writes. */
function dial(pairingId: string, token: string, via: 'header' | 'query' = 'header'): Promise<
  { ok: true; ws: WsClient } | { ok: false; status: number; reason?: string }
> {
  const url = via === 'query' ? `${wsUrl(pairingId)}?token=${encodeURIComponent(token)}` : wsUrl(pairingId);
  const ws = new WsClient(url, via === 'header' ? { headers: { authorization: `Bearer ${token}` } } : {});
  ws.on('error', () => undefined);
  return new Promise((resolve) => {
    ws.on('open', () => resolve({ ok: true, ws }));
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => {
        let reason: string | undefined;
        try {
          reason = JSON.parse(body)?.error?.details?.reason;
        } catch {
          /* a body we cannot parse simply carries no reason */
        }
        resolve({ ok: false, status: res.statusCode ?? 0, reason });
      });
    });
  });
}

function mint(owner: string, pairingId: string): string {
  setActivation(owner, { active: true, billingLocked: false });
  return mintBridgeToken({ sub: owner }, pairingId).token;
}

/** Wait until `predicate` holds or the budget runs out — the heartbeat sweep is asynchronous. */
async function until(predicate: () => boolean, budgetMs = 2000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return predicate();
}

describe('a bridge token authorises exactly one connect', () => {
  it('THE ATTACK: replaying a captured token is refused AND does not evict the live daemon', async () => {
    const token = mint('owner-1', 'p1');
    const first = await dial('p1', token);
    expect(first.ok).toBe(true);
    expect(bridgeConnectionCount()).toBe(1);

    const replay = await dial('p1', token);
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.status).toBe(401);
    expect(replay.reason).toBe('token-replayed');

    // The whole point. Before J-2 the replay would have taken this socket's slot.
    expect(isLive('p1')).toBe(true);
    expect(bridgeConnectionCount()).toBe(1);
    if (first.ok) expect(first.ws.readyState).toBe(WsClient.OPEN);
    if (first.ok) first.ws.close();
  });

  it('a FRESH token reconnects normally — single-use does not break redial', async () => {
    const a = await dial('p1', mint('owner-1', 'p1'));
    expect(a.ok).toBe(true);
    if (a.ok) a.ws.close();
    await until(() => !isLive('p1'));

    const b = await dial('p1', mint('owner-1', 'p1'));
    expect(b.ok).toBe(true);
    if (b.ok) b.ws.close();
  });

  it('every minted token carries a distinct jti', () => {
    setActivation('owner-1', { active: true, billingLocked: false });
    const jtis = new Set(
      Array.from({ length: 20 }, () => readBridgeToken(mintBridgeToken({ sub: 'owner-1' }, 'p1').token).jti),
    );
    expect(jtis.size).toBe(20);
    for (const j of jtis) expect(typeof j).toBe('string');
  });

  it('a token with NO jti is refused rather than admitted unspendable', async () => {
    // The bypass a jti-only-if-present design would leave: mint a structurally valid bridge token
    // omitting the claim, and it could be replayed for its whole 600s life.
    setActivation('owner-1', { active: true, billingLocked: false });
    const noJti = jwt.sign({ sub: 'owner-1', pairingId: 'p1', connectionId: 'p1' }, loadConfig().jwtSecret, {
      algorithm: 'HS256',
      audience: BRIDGE_AUDIENCE,
      expiresIn: 600,
    });
    const res = await dial('p1', noJti);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('missing-jti');
    expect(isLive('p1')).toBe(false);
  });
});

describe('the ?token= query form is gone', () => {
  it('a token in the URL is not accepted, even though the same token works in the header', async () => {
    const viaQuery = await dial('p1', mint('owner-1', 'p1'), 'query');
    expect(viaQuery.ok).toBe(false);
    if (!viaQuery.ok) expect(viaQuery.status).toBe(401);
    expect(isLive('p1')).toBe(false);

    // Same shape of token, header transport: admitted. So the refusal above is about the
    // TRANSPORT, not about the token being otherwise invalid.
    const viaHeader = await dial('p1', mint('owner-1', 'p1'));
    expect(viaHeader.ok).toBe(true);
    if (viaHeader.ok) viaHeader.ws.close();
  });
});

describe('token epoch — "terminar todas as sessões" reaches the bridge', () => {
  it('refuses a token minted before the current epoch', async () => {
    const token = mint('owner-1', 'p1');
    // The user terminates every session a moment after that token was minted.
    setActivation('owner-1', { active: true, billingLocked: false, tokenEpoch: Math.floor(Date.now() / 1000) + 60 });

    const res = await dial('p1', token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('token-epoch-stale');
    expect(isLive('p1')).toBe(false);
  });

  it('DROPS an already-open socket when the epoch is bumped under it', async () => {
    // A WebSocket is authorised once and then lives for hours. Without a re-check, "terminate all
    // sessions" would leave the offending socket running on the plane that executes commands on
    // the user's machine — the connect-time check alone does NOT give this property.
    const open = await dial('p1', mint('owner-1', 'p1'));
    expect(open.ok).toBe(true);
    expect(isLive('p1')).toBe(true);

    setActivation('owner-1', { active: true, billingLocked: false, tokenEpoch: Math.floor(Date.now() / 1000) + 60 });
    expect(await until(() => !isLive('p1'))).toBe(true);
  });

  it('DROPS an already-open socket when the account is deactivated', async () => {
    const open = await dial('p1', mint('owner-1', 'p1'));
    expect(open.ok).toBe(true);
    setActivation('owner-1', { active: false, billingLocked: false });
    expect(await until(() => !isLive('p1'))).toBe(true);
  });

  it('DROPS an already-open socket when billing locks', async () => {
    const open = await dial('p1', mint('owner-1', 'p1'));
    expect(open.ok).toBe(true);
    setActivation('owner-1', { active: true, billingLocked: true });
    expect(await until(() => !isLive('p1'))).toBe(true);
  });

  it('leaves a healthy socket alone across many sweeps', async () => {
    // The sweep must not be a slow disconnect generator: a live, admitted daemon survives it.
    const open = await dial('p1', mint('owner-1', 'p1'));
    expect(open.ok).toBe(true);
    await new Promise((r) => setTimeout(r, HEARTBEAT_MS * 5));
    expect(isLive('p1')).toBe(true);
    if (open.ok) open.ws.close();
  });
});

describe('the nonce store is bounded by token lifetime', () => {
  it('spends once, refuses the second time', () => {
    const nowSec = 1_000_000;
    expect(spendConnectNonce('jti-a', nowSec + 600, nowSec)).toBe(true);
    expect(spendConnectNonce('jti-a', nowSec + 600, nowSec)).toBe(false);
  });

  it('forgets a nonce once its token has expired — retaining longer would only grow the map', () => {
    const nowSec = 1_000_000;
    spendConnectNonce('jti-a', nowSec + 600, nowSec);
    expect(__spentNonceCount()).toBe(1);
    // Past the token's exp, jwt.verify rejects it anyway, so the entry has no work left to do.
    spendConnectNonce('jti-b', nowSec + 1200, nowSec + 601);
    expect(__spentNonceCount()).toBe(1);
  });

  it('a token with no exp is still retained for a bounded window', () => {
    // Otherwise omitting `exp` would buy unlimited replays.
    const nowSec = 1_000_000;
    expect(spendConnectNonce('jti-c', undefined, nowSec, 600)).toBe(true);
    expect(spendConnectNonce('jti-c', undefined, nowSec + 599, 600)).toBe(false);
    expect(spendConnectNonce('jti-c', undefined, nowSec + 601, 600)).toBe(true); // pruned, re-spendable
  });
});
