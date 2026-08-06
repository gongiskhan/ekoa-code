import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs } from '../../src/data/stores.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { envelopeDecrypt } from '../../src/data/crypto.js';
import {
  createConfig,
  updateConfig,
  upsertConfig,
  mergeCredentialValues,
  CLEAR_CREDENTIAL,
  type IntegrationConfigDoc,
} from '../../src/integrations/service.js';

/**
 * A CREDENTIAL SAVE MERGES; IT NEVER REPLACES.
 *
 * A credential form only carries what was typed in THIS browser session. A masked field the user
 * did not retype comes back as an empty string; a field the form does not render does not come
 * back at all. The old platform replaced the whole bundle with that patch, so re-pasting a Zoho
 * client_id/secret destroyed the permanent `refresh_token` and took a customer's e-signature down
 * (ekoa-dev `ca446cb0`, 2026-07-28). This suite is that incident, reproduced against THIS repo's
 * write path, plus the rules that make a wipe possible only when it is asked for.
 */
let mem: MongoMemoryServer;
let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

const alice: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' };
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq, genId: () => `cfg-${++seq}` };

/** The exact field set a Zoho Sign config holds: two typed client fields plus the one permanent
 *  secret nobody ever retypes, because it arrives from the provider. */
const ZOHO = { client_id: 'zclient.1', client_secret: 'zsecret.1', refresh_token: 'ZOHO-REFRESH-PERMANENT', dc: 'eu' };

async function defineIntegration(key: string): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId: alice.orgId,
      userId: alice.userId,
      visibility: 'private',
      key,
      displayName: key,
      configSchema: [
        { key: 'client_id', label: 'Client ID', type: 'string', required: true, secret: false },
        { key: 'client_secret', label: 'Client Secret', type: 'password', required: true, secret: true },
        { key: 'refresh_token', label: 'Refresh Token', type: 'password', required: false, secret: true },
        { key: 'dc', label: 'Data centre', type: 'string', required: false, secret: false },
      ],
      actions: [{ actionName: 'ping', description: 'd', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://sign.zoho.eu', path: '/ping' } }],
      skillMd: '# k',
    },
    { actor: alice, onConflict: 'replace' },
  );
}

const SECRET_KEYS = ['client_secret', 'refresh_token'];

async function connect(values: Record<string, unknown> = ZOHO): Promise<IntegrationConfigDoc> {
  await defineIntegration('zoho-sign');
  return createConfig(alice, { integrationKey: 'zoho-sign', configValues: values, secretKeys: SECRET_KEYS }, deps);
}

/** The stored bundle as the executor reads it — decrypted from the row, not from a return value. */
async function storedBundle(id: string): Promise<Record<string, unknown>> {
  const row = (await integrationConfigs.get(id)) as IntegrationConfigDoc;
  return JSON.parse(await envelopeDecrypt(row.credentialsCiphertext!, row.orgId)) as Record<string, unknown>;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-cred-merge-'));
  mkdirSync(join(tmp, 'baseline'), { recursive: true });
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  savedEnv.EKOA_DATA_DIR = process.env.EKOA_DATA_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = join(tmp, 'baseline');
  process.env.EKOA_DATA_DIR = join(tmp, 'data');
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_cred_merge');
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
  await integrationConfigs.deleteMany({});
});

describe('the incident: a partial save must not destroy the fields it omits', () => {
  it('re-pasting client_id + client_secret KEEPS the refresh_token', async () => {
    const cfg = await connect();
    const res = await updateConfig(alice, cfg._id, {
      configValues: { client_id: 'zclient.2', client_secret: 'zsecret.2' },
      secretKeys: SECRET_KEYS,
    });
    expect(res.verdict).toBe('ok');
    expect(await storedBundle(cfg._id)).toEqual({
      client_id: 'zclient.2',
      client_secret: 'zsecret.2',
      refresh_token: 'ZOHO-REFRESH-PERMANENT', // the one that used to disappear
      dc: 'eu',
    });
  });

  it('an untouched masked field (empty string) leaves the stored secret alone', async () => {
    const cfg = await connect();
    await updateConfig(alice, cfg._id, {
      configValues: { client_id: 'zclient.2', client_secret: '', refresh_token: '   ' },
      secretKeys: SECRET_KEYS,
    });
    const bundle = await storedBundle(cfg._id);
    expect(bundle.client_secret).toBe('zsecret.1');
    expect(bundle.refresh_token).toBe('ZOHO-REFRESH-PERMANENT');
    expect(bundle.client_id).toBe('zclient.2');
  });

  it('null / undefined are never an implicit wipe', async () => {
    const cfg = await connect();
    await updateConfig(alice, cfg._id, {
      configValues: { client_secret: null, refresh_token: undefined, dc: 'com' },
      secretKeys: SECRET_KEYS,
    });
    const bundle = await storedBundle(cfg._id);
    expect(bundle.client_secret).toBe('zsecret.1');
    expect(bundle.refresh_token).toBe('ZOHO-REFRESH-PERMANENT');
    expect(bundle.dc).toBe('com');
  });

  it('a patch that changes nothing is a true no-op — no re-encrypt, no custody move', async () => {
    const cfg = await connect();
    await integrationConfigs.update(cfg._id, (cur) => ({ ...cur, custodianUserId: 'someone-else' }));
    const before = (await integrationConfigs.get(cfg._id)) as IntegrationConfigDoc;
    // Every field re-sent identical, plus an untouched masked field.
    const res = await updateConfig(alice, cfg._id, { configValues: { ...ZOHO, client_secret: '' }, secretKeys: SECRET_KEYS });
    expect(res.verdict).toBe('ok');
    const after = (await integrationConfigs.get(cfg._id)) as IntegrationConfigDoc;
    expect(after.credentialsCiphertext).toBe(before.credentialsCiphertext);
    // Custody follows the ceremony; saving a form nobody edited is not one.
    expect(after.custodianUserId).toBe('someone-else');
  });

  it('toggling `enabled` alone does not touch the bundle at all', async () => {
    const cfg = await connect();
    const before = (await integrationConfigs.get(cfg._id)) as IntegrationConfigDoc;
    await updateConfig(alice, cfg._id, { enabled: false });
    const after = (await integrationConfigs.get(cfg._id)) as IntegrationConfigDoc;
    expect(after.enabled).toBe(false);
    expect(after.credentialsCiphertext).toBe(before.credentialsCiphertext);
  });
});

describe('clearing a field is possible, but only on purpose', () => {
  it('CLEAR_CREDENTIAL deletes exactly that key', async () => {
    const cfg = await connect();
    await updateConfig(alice, cfg._id, {
      configValues: { refresh_token: CLEAR_CREDENTIAL },
      secretKeys: SECRET_KEYS,
    });
    const bundle = await storedBundle(cfg._id);
    expect('refresh_token' in bundle).toBe(false);
    expect(bundle.client_secret).toBe('zsecret.1'); // nothing else moved
  });

  it('a full re-entry replaces every value, because every value was sent', async () => {
    const cfg = await connect();
    await updateConfig(alice, cfg._id, {
      configValues: { client_id: 'c2', client_secret: 's2', refresh_token: 'r2', dc: 'com' },
      secretKeys: SECRET_KEYS,
    });
    expect(await storedBundle(cfg._id)).toEqual({ client_id: 'c2', client_secret: 's2', refresh_token: 'r2', dc: 'com' });
  });
});

describe('everything downstream is computed from the MERGED bundle', () => {
  it('the non-secret projection keeps a field the patch did not resend', async () => {
    const cfg = await connect();
    // `dc` is a non-secret destination-shaping value. Projected from the PATCH it would vanish
    // here, silently re-opening any approval bound to the destination it names.
    await updateConfig(alice, cfg._id, { configValues: { client_secret: 'zsecret.2' }, secretKeys: SECRET_KEYS });
    const row = (await integrationConfigs.get(cfg._id)) as IntegrationConfigDoc;
    expect(row.publicConfigValues).toEqual({ client_id: 'zclient.1', dc: 'eu' });
    expect(JSON.stringify(row.publicConfigValues)).not.toContain('zsecret');
  });

  it('the WS-C shadow follows the merged bundle, not the patch', async () => {
    const cfg = await connect();
    await updateConfig(alice, cfg._id, { configValues: { client_id: 'zclient.2' }, secretKeys: SECRET_KEYS });
    const row = (await integrationConfigs.get(cfg._id)) as IntegrationConfigDoc;
    expect(row.cofreItemId).toBeTruthy();
    // The shadow and the live column must agree after a partial save, or the Rule-10 cutover
    // would restore a bundle missing whatever this save omitted.
    expect(await storedBundle(cfg._id)).toEqual({ ...ZOHO, client_id: 'zclient.2' });
  });
});

describe('an undecryptable bundle refuses the write instead of wiping it', () => {
  it('returns `undecryptable` and leaves the stored ciphertext untouched', async () => {
    const cfg = await connect();
    // Corrupt the stored blob the way a rotated/incorrect encryption key would.
    await integrationConfigs.update(cfg._id, (cur) => ({ ...cur, credentialsCiphertext: 'v2:not-a-real-envelope' }));
    const res = await updateConfig(alice, cfg._id, { configValues: { client_id: 'c9' }, secretKeys: SECRET_KEYS });
    expect(res.verdict).toBe('undecryptable');
    const row = (await integrationConfigs.get(cfg._id)) as IntegrationConfigDoc;
    expect(row.credentialsCiphertext).toBe('v2:not-a-real-envelope');
  });

  it('a config with no bundle yet is not "undecryptable" — it merges into nothing', async () => {
    const cfg = await connect();
    await integrationConfigs.update(cfg._id, (cur) => { const n = { ...cur }; delete (n as Record<string, unknown>).credentialsCiphertext; return n; });
    const res = await updateConfig(alice, cfg._id, { configValues: { client_id: 'c9' }, secretKeys: SECRET_KEYS });
    expect(res.verdict).toBe('ok');
    expect(await storedBundle(cfg._id)).toEqual({ client_id: 'c9' });
  });
});

describe('the dashboard save is an upsert, so a re-save cannot fork the row', () => {
  it('a second save updates the same config and merges into it', async () => {
    await defineIntegration('zoho-sign');
    const first = await upsertConfig(alice, { integrationKey: 'zoho-sign', configValues: ZOHO, secretKeys: SECRET_KEYS }, deps);
    expect(first.created).toBe(true);
    const second = await upsertConfig(alice, {
      integrationKey: 'zoho-sign',
      configValues: { client_id: 'zclient.2', client_secret: 'zsecret.2' },
      secretKeys: SECRET_KEYS,
    }, deps);
    expect(second.created).toBe(false);
    expect(second.config!._id).toBe(first.config!._id);
    const rows = await integrationConfigs.find({ orgId: alice.orgId, integrationKey: 'zoho-sign' });
    expect(rows).toHaveLength(1); // the duplicate that used to accumulate on every save
    expect(await storedBundle(first.config!._id)).toEqual({ ...ZOHO, client_id: 'zclient.2', client_secret: 'zsecret.2' });
  });

  it('a user’s save never redirects into the org-shared row an admin authored', async () => {
    await defineIntegration('zoho-sign');
    const admin: Actor = { userId: 'adminA', orgId: 'orgA', role: 'org-admin' };
    const shared = await upsertConfig(admin, { integrationKey: 'zoho-sign', configValues: { client_id: 'shared', client_secret: 's', refresh_token: 'SHARED-REFRESH' }, secretKeys: SECRET_KEYS }, deps);
    expect(shared.config!.ownerUserId).toBeUndefined();

    const own = await upsertConfig(alice, { integrationKey: 'zoho-sign', configValues: { client_id: 'mine', client_secret: 'm' }, secretKeys: SECRET_KEYS }, deps);
    expect(own.created).toBe(true);
    expect(own.config!._id).not.toBe(shared.config!._id);
    expect(own.config!.ownerUserId).toBe('alice');
    // The admin's shared bundle is untouched — a peer's save is not an edit of it.
    expect(await storedBundle(shared.config!._id)).toEqual({ client_id: 'shared', client_secret: 's', refresh_token: 'SHARED-REFRESH' });
    // ...and the peer's own row holds only what the peer typed.
    expect(await storedBundle(own.config!._id)).toEqual({ client_id: 'mine', client_secret: 'm' });
  });

  it('an admin re-save updates the shared row rather than adding a second one', async () => {
    await defineIntegration('zoho-sign');
    const admin: Actor = { userId: 'adminA', orgId: 'orgA', role: 'org-admin' };
    const first = await upsertConfig(admin, { integrationKey: 'zoho-sign', configValues: ZOHO, secretKeys: SECRET_KEYS }, deps);
    const again = await upsertConfig(admin, { integrationKey: 'zoho-sign', configValues: { dc: 'com' }, secretKeys: SECRET_KEYS }, deps);
    expect(again.created).toBe(false);
    expect(again.config!._id).toBe(first.config!._id);
    expect(await storedBundle(first.config!._id)).toEqual({ ...ZOHO, dc: 'com' });
  });
});

describe('mergeCredentialValues (the rule, in isolation)', () => {
  it('reports whether anything actually changed', () => {
    expect(mergeCredentialValues({ a: '1' }, { a: '1' })).toEqual({ values: { a: '1' }, changed: false });
    expect(mergeCredentialValues({ a: '1' }, { a: '2' })).toEqual({ values: { a: '2' }, changed: true });
    expect(mergeCredentialValues({ a: '1' }, {})).toEqual({ values: { a: '1' }, changed: false });
    expect(mergeCredentialValues({ a: '1' }, { a: '' })).toEqual({ values: { a: '1' }, changed: false });
    expect(mergeCredentialValues({ a: '1' }, { b: CLEAR_CREDENTIAL })).toEqual({ values: { a: '1' }, changed: false });
  });

  it('keeps non-string values (a numeric port, a boolean flag) addressable', () => {
    expect(mergeCredentialValues({ port: 993, tls: true }, { port: 143 }).values).toEqual({ port: 143, tls: true });
  });

  it('does not mutate the bundle it was given', () => {
    const current = { a: '1' };
    mergeCredentialValues(current, { a: '2', b: '3' });
    expect(current).toEqual({ a: '1' });
  });
});
