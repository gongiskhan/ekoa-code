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
import { envelopeEncrypt, envelopeDecrypt } from '../../src/data/crypto.js';
import {
  createConfig,
  updateConfig,
  deleteConfig,
  findConfigForOwner,
  persistRotatedCredentials,
  type IntegrationConfigDoc,
} from '../../src/integrations/service.js';
import {
  compareCredentialShadow,
  declaredOriginsForIntegration,
  discardCredentialShadow,
  egressOriginsForIntegration,
  loadIntegrationCredentialFields,
  mintOrRefreshCredentialShadow,
  observeCredentialShadow,
  reportCredentialShadow,
  CREDENTIAL_SHADOW_SAMPLE_INTERVAL_MS,
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
const adminB: Actor = { userId: 'adminB', orgId: 'orgA', role: 'org-admin' };

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

/** An ORG-SHARED config: an org-admin authors it (`ownerUserId` undefined), so the whole org uses
 *  it, any org-admin may delete it, and its Cofre item belongs to the admin who typed it. That
 *  asymmetry is the subject of the B2 review's C1 and H1. */
async function defineSharedIntegration(key: string, hosts: string[]): Promise<void> {
  await defineIntegration(adminA, key, hosts);
  // Re-authoring replaces the row, so the org visibility has to be re-asserted: the whole point of
  // the C1 case is that the PEER can still resolve the widened definition.
  await integrationDefinitionStore.setVisibility(
    (await integrationDefinitionStore.getForActor(adminA, key))!._id,
    adminA,
    'org',
  );
}

async function connectShared(hosts = ['https://api.crm.example/v1']): Promise<IntegrationConfigDoc> {
  await defineSharedIntegration('crm', hosts);
  const cfg = await createConfig(adminA, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
  expect(cfg.ownerUserId).toBeUndefined();
  expect(cfg.cofreItemId).toBeTruthy();
  return cfg;
}

/** Capture `console.warn` for the duration of `body`, returning the lines it produced. The live
 *  array is handed to `body` too, for assertions that need to look mid-flight. */
async function captureWarnings(body: (lines: string[]) => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  try {
    await body(lines);
  } finally {
    console.warn = original;
  }
  return lines;
}

/** The legacy column's own encoding, so a test can move it out from under the shadow. */
const legacyCiphertext = (values: Record<string, unknown>, orgId = 'orgA') =>
  envelopeEncrypt(JSON.stringify(values), orgId);

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

  it('a rotation by a DIFFERENT org-admin keeps the join, moves no custody, and stays in step', async () => {
    const cfg = await connectShared();
    const originalItemId = cfg.cofreItemId!;

    const result = await updateConfig(adminB, cfg._id, { configValues: { api_key: ROTATED } });
    expect(result.verdict).toBe('ok');
    // The join is UNCHANGED — no second item was minted, so adminA's still-granted item cannot be
    // left joined to nothing (the orphan standing unlock the delete path exists to prevent), and
    // custody stays with the admin who typed the credentials (46df997).
    expect(result.config!.cofreItemId).toBe(originalItemId);
    expect(await listCofreItems(adminB)).toHaveLength(0);
    expect(await listCofreItems(adminA)).toHaveLength(1);
    // …AND the shadow now holds the rotated bundle. Before the B2 review this read `drift`: the
    // second admin's write reached the legacy column only, so the shadow was permanently stale from
    // the first shared rotation onward and a cutover would have restored the pre-rotation secret.
    expect((await compareCredentialShadow(adminA, result.config!, { api_key: ROTATED })).status).toBe('match');
    // The writer still cannot READ it — the reach is restriction and destruction, never disclosure.
    expect((await compareCredentialShadow(adminB, result.config!, { api_key: ROTATED })).status).toBe(
      'shadow_unreachable',
    );
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

  it('answers EMPTY for an integration the actor cannot see at all', async () => {
    expect(await egressOriginsForIntegration(alice, 'nothing-here', findConfigForOwner)).toEqual([]);
  });
});

/**
 * THE ORG-SHARED PEER (B2 review C1 + M4).
 *
 * B2 shipped this class as a "benign residual": a same-org peer of an org-shared config resolved
 * `unreachable` and fell through to the DEFINITION-derived list — the author-widenable artifact the
 * slice exists to stop trusting — and it was the ADMIN's credential that then egressed. The original
 * pin asserted only that the peer's list equalled the connect-time host and never widened the
 * definition afterwards, so it passed with the hole fully open. Every case here widens or revokes
 * AFTER the connect, which is the only direction that discriminates.
 */
describe('an org-shared config\'s PEER is governed by the admin\'s item, not by the definition', () => {
  it('THE DISCRIMINATING CASE: a host added to the definition after the connect does not reach the peer', async () => {
    await connectShared();
    // The peer owns nothing and typed nothing.
    expect(await listCofreItems(bob)).toHaveLength(0);
    expect(await egressOriginsForIntegration(bob, 'crm', findConfigForOwner)).toEqual(['api.crm.example']);

    // The authoring surface adds an action pointing somewhere new.
    await defineSharedIntegration('crm', ['https://api.crm.example/v1', 'https://exfil.example/v1']);
    expect(await declaredOriginsForIntegration(bob, 'crm')).toContain('exfil.example');
    // …and the peer's allow-list does NOT follow it. Pre-fix this answered both hosts.
    expect(await egressOriginsForIntegration(bob, 'crm', findConfigForOwner)).toEqual(['api.crm.example']);
    // The owner's own answer is the same one, from the same item.
    expect(await egressOriginsForIntegration(adminA, 'crm', findConfigForOwner)).toEqual(['api.crm.example']);
  });

  it('the admin\'s LOCK is the org\'s lock: the peer is refused, not widened', async () => {
    const cfg = await connectShared();
    await lockItem(adminA, cfg.cofreItemId!);
    expect(await egressOriginsForIntegration(bob, 'crm', findConfigForOwner)).toEqual([]);
  });

  it('a join that names an UNREACHABLE item refuses rather than restoring the wider list', async () => {
    const cfg = await connectShared();
    // The item is deleted out from under the config (a Cofre delete, a tampered id): the narrower
    // authority is gone, which is exactly when the wider list must not come back.
    await integrationConfigs.update(cfg._id, (cur) => ({ ...cur, cofreItemId: 'itm_not_a_real_item' }));
    expect(await egressOriginsForIntegration(bob, 'crm', findConfigForOwner)).toEqual([]);
    expect(await egressOriginsForIntegration(adminA, 'crm', findConfigForOwner)).toEqual([]);
  });

  it('but a config with NO join still falls back — an integration that worked yesterday works today', async () => {
    const cfg = await connectShared();
    await integrationConfigs.update(cfg._id, (cur) => {
      const { cofreItemId: _drop, ...rest } = cur as IntegrationConfigDoc;
      return rest as never;
    });
    expect(await egressOriginsForIntegration(bob, 'crm', findConfigForOwner)).toEqual(['api.crm.example']);
  });

  it('the peer still cannot READ the admin\'s credential — the reach is not disclosure', async () => {
    const cfg = await connectShared();
    expect((await compareCredentialShadow(bob, cfg, { api_key: API_KEY })).status).toBe('shadow_unreachable');
    expect(await listCofreItems(bob)).toHaveLength(0);
  });
});

/**
 * DISCONNECTING AN ORG-SHARED CONFIG (B2 review H1).
 *
 * `deleteConfig` deletes every row the actor may write, and an org-shared row is writable by ANY
 * org-admin. The discard was owner-scoped, so admin B deleting admin A's config left A's item alive,
 * still `until_locked`-granted, still bound, joined to a config row that no longer existed — and the
 * result was dropped on the floor, so nothing said so.
 */
describe('deleting an org-shared config takes its credential with it', () => {
  it('a PEER-ADMIN\'s delete destroys the owner\'s item and every grant on it', async () => {
    const cfg = await connectShared();
    const itemId = cfg.cofreItemId!;

    expect((await deleteConfig(adminB, 'crm')).verdict).toBe('ok');

    expect(await listCofreItems(adminA)).toHaveLength(0);
    const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
    expect(await cofreItems.raw.get(itemId)).toBeNull();
    // The grants are the half that makes the orphan extractable: an `until_locked` grant with no
    // config to reach it from is a standing unlock for a credential the user believes they removed.
    expect(await cofreGrants.raw.find({ itemId })).toHaveLength(0);
  });

  it('an owner\'s own delete is unchanged', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    expect((await deleteConfig(alice, 'crm')).verdict).toBe('ok');
    expect(await listCofreItems(alice)).toHaveLength(0);
  });

  it('a surviving item is LOUD, not silent: the discard reports it and the caller logs it', async () => {
    const cfg = await connectShared();
    // A join that no reach can resolve (the id names an item under a different link). The point is
    // the SILENCE, not this particular cause: before the fix the boolean was discarded, so an
    // orphaned credential produced no log line, no status, and no trace of any kind.
    await integrationConfigs.update(cfg._id, (cur) => ({ ...cur, cofreItemId: 'itm_not_a_real_item' }));
    const stale = await reload(cfg._id);

    const warnings = await captureWarnings(async () => {
      expect(await discardCredentialShadow(adminA, stale)).toBe('orphaned');
      expect((await deleteConfig(adminB, 'crm')).verdict).toBe('ok');
    });
    expect(warnings.filter((l) => l.includes('ORPHANED')).length).toBeGreaterThan(0);
    expect(warnings.filter((l) => l.includes('left its credential item behind')).length).toBeGreaterThan(0);
    // …and no line carries the credential itself.
    expect(warnings.join('\n')).not.toContain(API_KEY);
  });

  it('a config with no join reports `absent` and says nothing', async () => {
    await defineIntegration(alice, 'hostless', []);
    const cfg = await createConfig(alice, { integrationKey: 'hostless', configValues: { api_key: API_KEY } }, deps);
    const warnings = await captureWarnings(async () => {
      expect(await discardCredentialShadow(alice, cfg)).toBe('absent');
    });
    expect(warnings).toEqual([]);
  });
});

/**
 * PROVIDER-DRIVEN ROTATION (B2 review H2).
 *
 * An OAuth refresh writes the credential from the execution rail, not through `updateConfig`. The
 * served-app Zoho path wrote the legacy column and nothing else, so a shadowed row drifted
 * permanently from its first token refresh and a cutover would have replaced a live refresh_token
 * with the connect-time one.
 */
describe('persistRotatedCredentials writes BOTH stores', () => {
  it('an owner\'s rotation leaves the two stores in step', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);

    expect(await persistRotatedCredentials(cfg._id, 'alice', { api_key: API_KEY }, { api_key: ROTATED })).toBe(
      'updated',
    );
    const after = await reload(cfg._id);
    // Pre-fix this was `drift`: the legacy column moved and the shadow did not.
    expect((await compareCredentialShadow(alice, after, { api_key: ROTATED })).status).toBe('match');
    expect(after.cofreItemId).toBe(cfg.cofreItemId);
  });

  it('a PEER\'s rotation of an org-shared config refreshes the ADMIN\'s item in place', async () => {
    const cfg = await connectShared();
    expect(await persistRotatedCredentials(cfg._id, 'bob', { api_key: API_KEY }, { api_key: ROTATED })).toBe(
      'updated',
    );
    const after = await reload(cfg._id);
    expect(after.cofreItemId).toBe(cfg.cofreItemId);
    expect((await compareCredentialShadow(adminA, after, { api_key: ROTATED })).status).toBe('match');
    // Custody did not move to whoever happened to be running.
    expect(await listCofreItems(bob)).toHaveLength(0);
    expect(await listCofreItems(adminA)).toHaveLength(1);
  });

  it('never folds a captured browser session into the credential bundle', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    await persistRotatedCredentials(
      cfg._id,
      'alice',
      { api_key: API_KEY, storageState: '{"cookies":[]}' },
      { api_key: ROTATED },
    );
    const item = await findIntegrationCredentialItem(alice, cfg.cofreItemId!, {
      integrationKey: 'crm',
      configId: cfg._id,
    });
    expect(JSON.stringify(item)).not.toContain('storageState');
    expect((await compareCredentialShadow(alice, await reload(cfg._id), { api_key: ROTATED })).status).toBe('match');
  });

  it('a rotation does NOT perform the connect ceremony for an org-shared config with no item', async () => {
    // A shared config whose integration declares no bindable host mints no item at connect. A
    // rotation must not mint one either: it would put a fresh auto-granted item — and the lock
    // switch — in the Cofre of whoever happened to be running, for a credential they never typed.
    await defineSharedIntegration('hostless', []);
    const cfg = await createConfig(adminA, { integrationKey: 'hostless', configValues: { api_key: API_KEY } }, deps);
    expect(cfg.cofreItemId).toBeUndefined();

    expect(await persistRotatedCredentials(cfg._id, 'bob', { api_key: API_KEY }, { api_key: ROTATED })).toBe(
      'updated',
    );
    expect(await listCofreItems(bob)).toHaveLength(0);
    expect((await reload(cfg._id)).cofreItemId).toBeUndefined();
  });

  it('answers `notfound` for a config that is gone, without throwing', async () => {
    expect(await persistRotatedCredentials('cfg-gone', 'alice', {}, { api_key: ROTATED })).toBe('notfound');
  });
});

/**
 * THE LIVE READ AND ITS MEASUREMENT (B2 review L1 + M2 + M3).
 *
 * The read is the legacy column; the measurement is the WS-C comparator beside it. Everything here
 * is about keeping those two apart: a measurement may not change what the read returns, may not
 * cost what it used to on every step, and may not flood the log it exists to write to.
 */
describe('loadIntegrationCredentialFields — the live read, measured beside', () => {
  const readDeps = {
    resolveOwnerOrgId: async (userId: string) => (userId === 'nobody' ? null : 'orgA'),
    findConfig: findConfigForOwner,
    decrypt: (ciphertext: string, orgId: string) => envelopeDecrypt(ciphertext, orgId),
  };

  it('returns the decrypted fields and runs the comparator', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    // Drift the shadow so the measurement has something to say.
    const drifted = await legacyCiphertext({ api_key: ROTATED });
    await integrationConfigs.update(cfg._id, (cur) => ({ ...cur, credentialsCiphertext: drifted }));

    const warnings = await captureWarnings(async () => {
      expect(await loadIntegrationCredentialFields(readDeps, 'crm', 'alice')).toEqual({ api_key: ROTATED });
    });
    expect(warnings.some((l) => l.includes('drift') && l.includes('fields=[api_key]'))).toBe(true);
    expect(warnings.join('\n')).not.toContain(ROTATED);
  });

  it('A THROW ON THE MEASUREMENT PATH NEVER CHANGES THE READ', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    const drifted = await legacyCiphertext({ api_key: ROTATED });
    await integrationConfigs.update(cfg._id, (cur) => ({ ...cur, credentialsCiphertext: drifted }));

    // The measurement's last act is to LOG. A log sink that throws (a full disk, a hostile
    // transport, a future structured logger) used to be indistinguishable from "this integration is
    // not connected", because the whole measurement sat inside the read's `catch { return null }`.
    const original = console.warn;
    console.warn = () => {
      throw new Error('log sink is down');
    };
    try {
      await expect(loadIntegrationCredentialFields(readDeps, 'crm', 'alice')).resolves.toEqual({
        api_key: ROTATED,
      });
    } finally {
      console.warn = original;
    }
  });

  it('still fails closed on the things that ARE the read: no org, no config, no ciphertext', async () => {
    expect(await loadIntegrationCredentialFields(readDeps, 'crm', 'nobody')).toBeNull();
    expect(await loadIntegrationCredentialFields(readDeps, 'nothing-here', 'alice')).toBeNull();
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    await integrationConfigs.update(cfg._id, (cur) => ({ ...cur, credentialsCiphertext: 'not-decryptable' }));
    expect(await loadIntegrationCredentialFields(readDeps, 'crm', 'alice')).toBeNull();
  });

  it('SAMPLES: one measurement per (config, reader) per interval, not one per step', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);
    const t0 = 1_800_000_000_000;

    const warnings = await captureWarnings(async (lines) => {
      // A run's first step measures and reports `match` (which is not news, so no line).
      await observeCredentialShadow(alice, cfg, { api_key: API_KEY }, t0);
      // The legacy column then rotates away from the shadow: the state HAS changed…
      const drifted = { ...cfg, credentialsCiphertext: await legacyCiphertext({ api_key: ROTATED }) };
      // …but the next twenty steps of the same run are inside the window and cost nothing.
      for (let i = 1; i <= 20; i++) await observeCredentialShadow(alice, drifted, { api_key: ROTATED }, t0 + i * 100);
      expect(lines).toHaveLength(0);
      // A minute later the sample is taken again and the transition IS reported — the detection
      // latency is bounded by the interval, which is what makes the sample unbiased for a value
      // that only changes when a write lands.
      await observeCredentialShadow(alice, drifted, { api_key: ROTATED }, t0 + CREDENTIAL_SHADOW_SAMPLE_INTERVAL_MS);
    });
    expect(warnings.filter((l) => l.includes('drift'))).toHaveLength(1);
  });

  it('DE-DUPS PER READER: two readers of one org-shared config do not flap', async () => {
    const cfg = await connectShared();
    const t0 = 1_900_000_000_000;
    const warnings = await captureWarnings(async () => {
      // The owner reads `match`, the peer reads `shadow_unreachable`, forever, alternating. Keyed
      // on the config alone, EVERY read was a transition: 6 lines for 12 reads, which is exactly
      // the flood the de-dup was written to prevent.
      for (let i = 0; i < 6; i++) {
        const t = t0 + i * (CREDENTIAL_SHADOW_SAMPLE_INTERVAL_MS + 1) * 2;
        await observeCredentialShadow(adminA, cfg, { api_key: API_KEY }, t);
        await observeCredentialShadow(bob, cfg, { api_key: API_KEY }, t + CREDENTIAL_SHADOW_SAMPLE_INTERVAL_MS + 1);
      }
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('shadow_unreachable');
  });
});

/**
 * WHAT THE SHADOW IS ALLOWED TO SAY OUT LOUD (B2 review L2).
 *
 * Both catch blocks in the mint/discard path sit downstream of a bundle that was in plaintext
 * microseconds earlier, and a serialisation or envelope failure carries whatever text the offending
 * value or a third-party library put in it.
 */
describe('a failure on the credential path is logged by CLASS, never by message', () => {
  it('a mint failure never prints the third-party text it was handed', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm.example/v1']);
    const cfg = await createConfig(alice, { integrationKey: 'crm', configValues: { api_key: API_KEY } }, deps);

    // A value whose own serialisation throws WITH the secret in the message: the shape of an
    // upstream error echoing back what it was given.
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'api_key', {
      enumerable: true,
      get() {
        throw new TypeError(`upstream rejected ${ROTATED}`);
      },
    });

    const warnings = await captureWarnings(async () => {
      expect(await mintOrRefreshCredentialShadow(alice, cfg, hostile)).toBeNull();
    });
    expect(warnings.some((l) => l.includes('shadow mint failed'))).toBe(true);
    expect(warnings.join('\n')).not.toContain(ROTATED);
    // The CLASS survives, because that is what actually distinguishes these failures.
    expect(warnings.some((l) => l.includes('TypeError'))).toBe(true);
  });
});
