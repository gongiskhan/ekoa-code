import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket as WsClient } from 'ws';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { bridgePairings } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { mintBridgeToken } from '../../src/bridge/token.js';
import { attachBridgeServer, type BridgeServerHandle } from '../../src/bridge/server.js';
import { advertisesCapability, advertisedCapabilitiesForOrg, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';

/**
 * `hello` — the capability advertisement (Cofre I-1), over a real Upgrade.
 *
 * THE REGRESSION. The bridge server's frame switch had no `case 'hello'`: the frame parsed fine and
 * then fell through to `default: break`. So `capabilities` on a pairing row was never written by
 * anything, stayed `undefined` for every machine forever, and every consumer that asked "what can
 * this machine do" got an empty answer it then treated as "nothing to check". Downstream that made
 * `usableCapabilities` (advertised ∩ granted) empty for the whole fleet, and let the integrations
 * session endpoint report a machine as ready on the strength of an open socket alone.
 */
let mem: MongoMemoryServer;
let server: Server;
let handle: BridgeServerHandle;
let port: number;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-hello';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_bridge_hello_test');
  server = createServer();
  handle = attachBridgeServer(server, { resolveUserOrg: async () => 'org-1' });
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
  await bridgePairings.deleteMany({});
});

async function connect(pairingId: string, owner = 'owner-1'): Promise<WsClient> {
  setActivation(owner, { active: true, billingLocked: false });
  const { token } = mintBridgeToken({ sub: owner }, pairingId);
  const ws = new WsClient(`ws://127.0.0.1:${port}/api/v1/bridge/connect/${pairingId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  return ws;
}

/** Poll until the server has processed the frame (the switch is async and nothing acks a hello). */
async function until(pred: () => Promise<boolean>, ms = 3000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe('hello advertisement', () => {
  it('records the advertised capabilities and the egress endpoint on the pairing row', async () => {
    const ws = await connect('p-hello');
    expect(await advertisesCapability('p-hello', 'attended.card_login')).toBe(false); // before

    ws.send(JSON.stringify({
      type: 'hello',
      machineName: 'mac-do-joao',
      capabilities: ['attended.card_login', 'local.filesystem'],
      egressEndpoint: '100.64.0.7:7777',
      daemonVersion: '0.2.0',
    }));

    expect(await until(() => advertisesCapability('p-hello', 'attended.card_login'))).toBe(true);
    const rows = await advertisedCapabilitiesForOrg('org-1');
    expect(rows).toContainEqual({ pairingId: 'p-hello', advertised: ['attended.card_login', 'local.filesystem'] });
    ws.close();
  });

  it('REPLACES the stored list, so a machine that stops offering a capability stops being selected', async () => {
    const ws = await connect('p-shrink');
    ws.send(JSON.stringify({ type: 'hello', machineName: 'm', capabilities: ['attended.card_login', 'local.bash'], daemonVersion: '0.2.0' }));
    expect(await until(() => advertisesCapability('p-shrink', 'local.bash'))).toBe(true);

    // The operator turned bash off and restarted the daemon. A MERGE here would make revocation by
    // reconfiguration impossible — the machine could never un-claim anything it once claimed.
    ws.send(JSON.stringify({ type: 'hello', machineName: 'm', capabilities: ['attended.card_login'], daemonVersion: '0.2.0' }));
    expect(await until(async () => !(await advertisesCapability('p-shrink', 'local.bash')))).toBe(true);
    expect(await advertisesCapability('p-shrink', 'attended.card_login')).toBe(true);
    ws.close();
  });

  it('takes the ORG from the admitted connection, never from the frame', async () => {
    // A machine may describe its own abilities; it must not be able to name the tenant it belongs
    // to. `resolveUserOrg` pins every connection here to org-1, so a frame claiming otherwise must
    // change nothing about where the row lands.
    const ws = await connect('p-liar');
    ws.send(JSON.stringify({
      type: 'hello', machineName: 'm', capabilities: ['local.filesystem'], daemonVersion: '0.2.0',
      org: 'org-2', ownerUserId: 'someone-else',
    }));
    expect(await until(() => advertisesCapability('p-liar', 'local.filesystem'))).toBe(true);

    const row = (await bridgePairings.get('p-liar')) as { org: string; ownerUserId: string } | null;
    expect(row?.org).toBe('org-1');
    expect(row?.ownerUserId).toBe('owner-1');
    expect(await advertisedCapabilitiesForOrg('org-2')).toHaveLength(0);
    ws.close();
  });

  it('drops a hello whose capability is outside the closed vocabulary, rather than storing it', async () => {
    const ws = await connect('p-invented');
    ws.send(JSON.stringify({ type: 'hello', machineName: 'm', capabilities: ['local.everything'], daemonVersion: '0.2.0' }));
    // The frame fails BridgeFrame at the boundary, so nothing is recorded — a capability cannot be
    // invented by a daemon build or a hand-edited config.
    await new Promise((r) => setTimeout(r, 200));
    expect(await advertisesCapability('p-invented', 'local.everything')).toBe(false);
    const rows = await advertisedCapabilitiesForOrg('org-1');
    expect(rows).toContainEqual({ pairingId: 'p-invented', advertised: [] });
    ws.close();
  });
});
