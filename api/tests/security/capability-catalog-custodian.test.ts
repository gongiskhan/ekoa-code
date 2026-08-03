import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { activityLogs, integrationConfigs, integrationDefinitions, approvedIntegrationActions } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { executeUserIntegrationAction } from '../../src/integrations/action-executor.js';
import {
  getIntegrationCapability,
  executeIntegrationCapabilityAction,
  resolveCapabilityDefinition,
  type CapabilityContext,
  type CapabilityOutcome,
} from '../../src/integrations/integration-capability.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';

/**
 * SECURITY / COHERENCE — the capability CATALOG and the capability EXECUTE resolve the same
 * package, as the same principal (slice D3, closing the residual the 2026-08-03 credential fix
 * routed here).
 *
 * WHAT WAS WRONG. That fix made EXECUTION resolve a definition as the credential's CUSTODIAN,
 * because for an org-shared config the reader is not the person whose ceremony produced the
 * bundle. `getIntegrationCapability` kept resolving as `ctx.actor`, so a same-org peer who had
 * authored their OWN private package under the shared key was shown THEIR actions and then had the
 * CUSTODIAN's run. Security held — the executor is the gate — but a read that disagrees with the
 * write it describes is how a client is told one thing and handed another, and it is how the next
 * reader of the file concludes the reader-resolution is the correct one.
 *
 * THE SETUP IS THE EXFILTRATION'S OWN PRECONDITION, not a contrived one: the key resolves to a
 * `global` publication, the org holds no row for it, and a plain `user` peer creates the org's row
 * as their own PRIVATE package (the documented `PUT …/integration-builder/package` path). From
 * that moment the peer's row is the one THEY resolve and the global row is the one the custodian
 * resolves.
 */
let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };

const KEY = 'd3-coherence-probe';
const PUBLISHED_HOST = 'https://published.example';
const PEER_HOST = 'https://peer-authored.example';

const actor = (userId: string, orgId: string) => ({ userId, orgId, role: 'user' as const });

function valueOf<T>(out: CapabilityOutcome<T>): T {
  if (!out.ok) throw new Error(`expected an admitted outcome, got refusal: ${out.refusal}`);
  return out.value;
}

function ctxFor(userId: string, orgId: string): CapabilityContext {
  return { actor: actor(userId, orgId), deps, username: userId };
}

const publishedAction: IntegrationAction = {
  actionName: 'listar_publicado',
  description: 'A acção que o pacote publicado oferece',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: PUBLISHED_HOST, path: '/itens' },
};
const peerAction: IntegrationAction = {
  actionName: 'listar_do_peer',
  description: 'A acção que o peer escreveu no seu proprio pacote',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: PEER_HOST, path: '/itens' },
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_d3_coherence');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  for (const s of [integrationDefinitions, integrationConfigs, approvedIntegrationActions, activityLogs]) {
    await s.deleteMany({});
  }
  // 1. A published package every org resolves.
  await integrationDefinitionStore.create(
    {
      orgId: 'orgPUB', userId: 'authorPUB', visibility: 'global', key: KEY,
      displayName: 'Published', configSchema: [], actions: [publishedAction], skillMd: '# published', authType: 'api_key',
    },
    { actor: { userId: 'authorPUB', orgId: 'orgPUB', role: 'super-admin' } },
  );
  // 2. A plain `user` peer of orgA takes the org's row for that key as their own PRIVATE package.
  await integrationDefinitionStore.create(
    {
      orgId: 'orgA', userId: 'peerA', visibility: 'private', key: KEY,
      displayName: 'Peer copy', configSchema: [], actions: [peerAction], skillMd: '# peer', authType: 'api_key',
    },
    { actor: actor('peerA', 'orgA') },
  );
  // 3. The ORG-SHARED credential the admin typed: usable by the whole org, custody with the admin.
  await integrationConfigs.insert({
    _id: 'cfg_shared', orgId: 'orgA', integrationKey: KEY, name: KEY, enabled: true, custodianUserId: 'adminA',
  } as never);
});

describe('the catalog resolves as the CUSTODIAN, exactly as the execute does', () => {
  it('a peer reading the capability sees the CUSTODIAN\'s package, not their own private one', async () => {
    const view = valueOf(await getIntegrationCapability(ctxFor('peerA', 'orgA'), KEY));
    expect(view.actions.map((a) => a.actionName)).toEqual(['listar_publicado']);
    expect(JSON.stringify(view)).not.toContain('peer-authored.example');
  });

  it('and the EXECUTE agrees with it, in both directions', async () => {
    // The action the catalog offers is the one that runs…
    const ran = valueOf(await executeIntegrationCapabilityAction(ctxFor('peerA', 'orgA'), KEY, 'listar_publicado', {}));
    expect(ran.code).not.toBe('unknown_action');
    // …and the action the peer authored into their own row is not addressable, on either rail.
    const view = valueOf(await getIntegrationCapability(ctxFor('peerA', 'orgA'), KEY));
    expect(view.actions.map((a) => a.actionName)).not.toContain('listar_do_peer');
    const refused = valueOf(await executeIntegrationCapabilityAction(ctxFor('peerA', 'orgA'), KEY, 'listar_do_peer', {}));
    expect(refused.code).toBe('unknown_action');
  });

  it('the two rails answer from the SAME resolution primitive, so they cannot drift apart', async () => {
    const resolved = valueOf(await resolveCapabilityDefinition(actor('peerA', 'orgA'), KEY));
    expect(resolved.definitionActor.userId).toBe('adminA');
    expect(resolved.definition.actions.map((a) => a.actionName)).toEqual(['listar_publicado']);
    // The executor reaches the same verdict about the same call, independently.
    const direct = await executeUserIntegrationAction(
      { orgId: 'orgA', ownerUserId: 'peerA', integrationKey: KEY, actionName: 'listar_do_peer', args: {} },
      { fetchImpl: async () => { throw new Error('the request must never be issued'); } },
    );
    expect(direct.code).toBe('unknown_action');
  });

  it('with NO shared credential in play the reader is still the reader (the ordinary case is unchanged)', async () => {
    await integrationConfigs.deleteMany({});
    const view = valueOf(await getIntegrationCapability(ctxFor('peerA', 'orgA'), KEY));
    // No config row means no credential at stake, so the definition resolves as the reader — the
    // peer's own private package, which is theirs to hold. Narrowing here would break every
    // ordinary tenant that has simply not connected an integration yet.
    expect(view.actions.map((a) => a.actionName)).toEqual(['listar_do_peer']);
  });

  it('an OWNER-scoped credential also leaves the reader as the reader', async () => {
    await integrationConfigs.deleteMany({});
    await integrationConfigs.insert({
      _id: 'cfg_own', orgId: 'orgA', ownerUserId: 'peerA', custodianUserId: 'peerA',
      integrationKey: KEY, name: KEY, enabled: true,
    } as never);
    const view = valueOf(await getIntegrationCapability(ctxFor('peerA', 'orgA'), KEY));
    expect(view.actions.map((a) => a.actionName)).toEqual(['listar_do_peer']);
    expect(view.connected).toBe(true);
  });
});
