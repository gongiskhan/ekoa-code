import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, integrationDefinitions } from '../../src/data/stores.js';
import { refreshDefinitions, type IntegrationAction } from '../../src/integrations/definitions.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import {
  createConfig,
  updateConfig,
  deleteConfig,
  findConfigForOwner,
  type IntegrationConfigDoc,
} from '../../src/integrations/service.js';
import {
  compareCredentialShadow,
  declaredOriginsForIntegration,
  egressOriginsForIntegration,
  reportCredentialShadow,
  __resetCredentialShadowReportingForTests,
} from '../../src/integrations/credential-cofre.js';
import { lockItem, listCofreItems, findIntegrationCredentialItem } from '../../src/cofre/index.js';

/**
 * The WS-C credential SHADOW and its Rule-10 comparator (slice B2).
 *
 * The shadow's contract is exactly two claims, and this file is what makes them checkable:
 *   - EVERY user-defined config write also lands in the Cofre, joined both ways, with the connect
 *     ceremony's single `until_locked` grant — and NOTHING that worked before changes;
 *   - the comparator answers, per config, what a cutover TODAY would do: the same values under the
 *     same policy (`match`), or a specific, named reason it would not.
 *
 * The comparator statuses are asserted individually because they are the Rule-10 review's only
 * input on 2026-08-15. A comparator that collapses "locked" and "not migrated" into one "not ready"
 * would make the review a guess.
 */
let mem: MongoMemoryServer;
let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

const alice: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' };
const bob: Actor = { userId: 'bob', orgId: 'orgA', role: 'user' };
const adminA: Actor = { userId: 'adminA', orgId: 'orgA', role: 'org-admin' };

const API_KEY = ['sk', 'live', 'B2SHADOW', '0001'].join('-');
const ROTATED = ['sk', 'live', 'B2SHADOW', '0002'].join('-');

let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq, genId: () => `cfg-${++seq}` };

const action = (name: string, baseUrl: string): IntegrationAction => ({
  actionName: name,
  description: 'd',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl, path: `/${name}` },
});

/** A tenant definition row for `actor`'s org, with the given action base URLs. */
async function defineIntegration(actor: Actor, key: string, baseUrls: string[]): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId: actor.orgId,
      userId: actor.userId,
      visibility: 'private',
      key,
      displayName: key,
      configSchema: [{ key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true }],
      actions: baseUrls.map((u, i) => action(`a${i}`, u)),
      skillMd: '# k',
    },
    { actor, onConflict: 'replace' },
  );
}

const reload = async (id: string) => (await integrationConfigs.get(id)) as IntegrationConfigDoc;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  // An EMPTY baseline dir: every definition in this suite is a tenant Mongo row, so a shipped
  // package can never quietly supply an origin the assertions attribute to the tenant row.
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-b2-shadow-'));
  mkdirSync(join(tmp, 'baseline'), { recursive: true });
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  savedEnv.EKOA_DATA_DIR = process.env.EKOA_DATA_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = join(tmp, 'baseline');
  process.env.EKOA_DATA_DIR = join(tmp, 'data');
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_b2_shadow');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  process.env.EKOA_INTEGRATIONS_DIR = savedEnv.EKOA_INTEGRATIONS_DIR;
  process.env.EKOA_DATA_DIR = savedEnv.EKOA_DATA_DIR;
  refreshDefinitions();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
  await integrationConfigs.deleteMany({});
  await integrationDefinitions.deleteMany({});
  __resetCredentialShadowReportingForTests();
  seq = 0;
});

describe('the shadow write follows every config write', () => {
  it('connect mints the joined item and stamps the join on the config row', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);

    expect(cfg.cofreItemId).toBeTruthy();
    expect((await reload(cfg._id)).cofreItemId).toBe(cfg.cofreItemId);

    const item = await findIntegrationCredentialItem(alice, cfg.cofreItemId!, {
      integrationKey: 'crm',
      configId: cfg._id,
    });
    expect(item).not.toBeNull();
    expect(item!.boundOrigins).toEqual(['api.crm.example']);
    expect((await listCofreItems(alice))[0]!.state).toBe('unlocked_until_locked');
  });

  it('an update rotates the SAME item rather than minting a second one', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    const result = await updateConfig(alice, cfg._id, { configValues: { api_key: ROTATED } });

    expect(result.verdict).toBe('ok');
    expect(result.config!.cofreItemId).toBe(cfg.cofreItemId);
    expect(await listCofreItems(alice)).toHaveLength(1);
    // …and the shadow now holds the rotated value, i.e. it stayed in step with the live column.
    const report = await compareCredentialShadow(alice, result.config!, { api_key: ROTATED });
    expect(report.status).toBe('match');
  });

  it('disconnect destroys the item and its grant', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    expect(await listCofreItems(alice)).toHaveLength(1);

    expect((await deleteConfig(alice, 'crm')).verdict).toBe('ok');
    expect(await listCofreItems(alice)).toHaveLength(0);
    const { cofreGrants } = await import('../../src/cofre/store.js');
    expect(await cofreGrants.listVisible(alice)).toHaveLength(0);
  });

  it('mints NOTHING when the integration declares no usable host (unbound is not unrestricted)', async () => {
    await defineIntegration(alice, 'hostless', []);
    const cfg = await createConfig(alice, { integrationKey: 'hostless', configValues: { api_key: API_KEY } }, deps);
    expect(cfg.cofreItemId).toBeUndefined();
    expect(await listCofreItems(alice)).toHaveLength(0);
    // The connect itself still succeeded — a shadow may never break the path it shadows.
    expect(cfg.credentialsCiphertext).toBeTruthy();
  });

  it('leaves RESERVED rows (platform-oauth / pipedream) alone — out of WS-C scope', async () => {
    await defineIntegration(alice, 'pipedream', ['https://api.pipedream.com']);
    const cfg = await createConfig(alice, { integrationKey: 'pipedream', configValues: { api_key: API_KEY } }, deps);
    expect(cfg.cofreItemId).toBeUndefined();
    expect(await listCofreItems(alice)).toHaveLength(0);
  });
});

describe('the comparator — what a cutover today would do', () => {
  const connect = async (key = 'crm', hosts = ['https://api.crm.example/v1']) => {
    await defineIntegration(alice, key, hosts);
    return createConfig(alice, { integrationKey: key, configValues: { api_key: API_KEY } }, deps);
  };

  it('match: both stores hold the same bundle under the same policy', async () => {
    const cfg = await connect();
    const report = await compareCredentialShadow(alice, cfg, { api_key: API_KEY });
    expect(report.status).toBe('match');
    expect(report.itemId).toBe(cfg.cofreItemId);
  });

  it('drift: reports the field NAMES that disagree, never a value', async () => {
    const cfg = await connect();
    const report = await compareCredentialShadow(alice, cfg, { api_key: ROTATED, extra: 'x' });
    expect(report.status).toBe('drift');
    expect(report.driftKeys).toEqual(['api_key', 'extra']);
    // The verdict is LOGGED. It must be safe to serialise in full — the
    // `secretregistry-serialized-credentials-in-plaintext` class (docs/findings.md).
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain(API_KEY);
    expect(serialised).not.toContain(ROTATED);
  });

  it('shadow_absent: the config was never migrated', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    // Simulate a pre-B2 row: the join is what makes it migrated.
    const legacy = { ...cfg, cofreItemId: undefined };
    expect((await compareCredentialShadow(alice, legacy, { api_key: API_KEY })).status).toBe('shadow_absent');
  });

  it('legacy_absent: nothing to compare against', async () => {
    const cfg = await connect();
    const report = await compareCredentialShadow(alice, { ...cfg, credentialsCiphertext: undefined }, {});
    expect(report.status).toBe('legacy_absent');
  });

  it('shadow_locked: the user revoked the grant, so a cutover read would REFUSE', async () => {
    const cfg = await connect();
    await lockItem(alice, cfg.cofreItemId!);
    expect((await compareCredentialShadow(alice, cfg, { api_key: API_KEY })).status).toBe('shadow_locked');
  });

  it('shadow_unreachable: the reader does not own the item (the org-shared residual)', async () => {
    const cfg = await connect();
    expect((await compareCredentialShadow(bob, cfg, { api_key: API_KEY })).status).toBe('shadow_unreachable');
  });

  it('shadow_refused: the definition now declares a host outside the GRANTED scope', async () => {
    const cfg = await connect();
    // The integration's actions are re-authored to point somewhere new AFTER the connect. The
    // credential was never granted for that host, so a cutover read refuses — which is precisely
    // the drift signal the review needs, and the same rule the egress rail enforces live.
    await defineIntegration(alice, 'crm', ['https://api.newhost.example/v1']);
    expect((await compareCredentialShadow(alice, cfg, { api_key: API_KEY })).status).toBe('shadow_refused');
  });

  it('never throws, whatever the join points at', async () => {
    const cfg = await connect();
    const broken = { ...cfg, cofreItemId: 'itm_not_a_real_item' };
    await expect(compareCredentialShadow(alice, broken, { api_key: API_KEY })).resolves.toMatchObject({
      status: 'shadow_unreachable',
    });
    expect(() => reportCredentialShadow({ status: 'drift', integrationKey: 'crm', configId: cfg._id })).not.toThrow();
  });
});

describe('the origin resolver, re-pointed at the Cofre', () => {
  it('answers the ITEM bound origins once connected, not the definition-derived list', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    expect(cfg.cofreItemId).toBeTruthy();

    // The definition is re-authored to add a host the human never granted.
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1', 'https://attacker.example/v1']);
    expect(await declaredOriginsForIntegration(alice, 'crm')).toEqual(['api.crm.example', 'attacker.example']);
    // …and the credential's allow-list does not follow it.
    expect(await egressOriginsForIntegration(alice, 'crm', findConfigForOwner)).toEqual(['api.crm.example']);
  });

  it('answers EMPTY (refuse) once the item is locked', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    await lockItem(alice, cfg.cofreItemId!);
    expect(await egressOriginsForIntegration(alice, 'crm', findConfigForOwner)).toEqual([]);
  });

  it('falls back to the declared origins for a config with no item (Rule 7 additive)', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    await integrationConfigs.update(cfg._id, (cur) => {
      const { cofreItemId: _drop, ...rest } = cur as IntegrationConfigDoc;
      return rest as never;
    });
    expect(await egressOriginsForIntegration(alice, 'crm', findConfigForOwner)).toEqual(['api.crm.example']);
  });

  it('falls back for a same-org PEER of an org-shared config, whose item is the admin\'s', async () => {
    await defineIntegration(adminA, 'crm', ['https://api.crm.example/v1']);
    await integrationDefinitionStore.setVisibility(
      (await integrationDefinitionStore.getForActor(adminA, 'crm'))!._id,
      adminA,
      'org',
    );
    const cfg = await createConfig(adminA, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    expect(cfg.ownerUserId).toBeUndefined(); // org-admin authors org-shared
    expect(cfg.cofreItemId).toBeTruthy();
    // The peer sees no item of their own, so the pre-WS-C binding still governs them: the shadow
    // narrows nobody it does not also cover. This is the residual the 2026-08-15 review must close.
    expect(await egressOriginsForIntegration(bob, 'crm', findConfigForOwner)).toEqual(['api.crm.example']);
    expect(await listCofreItems(bob)).toHaveLength(0);
  });

  it('answers EMPTY for an integration the actor cannot see at all', async () => {
    expect(await egressOriginsForIntegration(alice, 'nothing-here', findConfigForOwner)).toEqual([]);
  });
});
