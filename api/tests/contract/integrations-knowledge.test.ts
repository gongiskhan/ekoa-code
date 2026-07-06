import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, integrationConfigs, knowledgeSources } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, type Config } from '../../src/config.js';

/**
 * G4 gate: encrypted org-scoped integration configs (credentials never returned + cross-org
 * isolation) and org-partitioned knowledge with per-entry-point SSRF rejection (ch09 inv 8).
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x' };

async function mkUser(id: string, username: string, orgId: string, role: 'super-admin' | 'org-admin' | 'builder') {
  await users.insert({ _id: id, username, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_g4');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  for (const s of [users, orgs, integrationConfigs, knowledgeSources]) await s.deleteMany({});
});

describe('integration configs (ch03 §3.8.13) — encrypted, org-scoped, credentials never returned', () => {
  it('creates a config; the credential is encrypted at rest and never in the response', async () => {
    await mkUser('u1', 'u1', 'orgA', 'builder');
    const t = await tokenFor('u1');
    const res = await api('/api/v1/integrations/configs', t, { method: 'POST', body: JSON.stringify({ integrationKey: 'stripe', configValues: { apiKey: 'sk-secret-123' } }) });
    expect(res.status).toBe(201);
    const body = await res.text();
    expect(body).not.toContain('sk-secret-123'); // credential never on the wire
    // stored ciphertext does not contain the cleartext
    const stored = (await integrationConfigs.find({ orgId: 'orgA' }))[0] as { credentialsCiphertext?: string };
    expect(stored.credentialsCiphertext).toBeTruthy();
    expect(stored.credentialsCiphertext).not.toContain('sk-secret-123');
  });

  it('cross-org: org B cannot list or see org A configs', async () => {
    await mkUser('a', 'a', 'orgA', 'org-admin');
    await mkUser('b', 'b', 'orgB', 'org-admin');
    await api('/api/v1/integrations/configs', await tokenFor('a'), { method: 'POST', body: JSON.stringify({ integrationKey: 'stripe', configValues: { k: 1 } }) });
    const bList = (await (await api('/api/v1/integrations/configs', await tokenFor('b'))).json()) as { items: unknown[] };
    expect(bList.items).toHaveLength(0);
  });

  it('a builder cannot overwrite or delete an org-admin-authored SHARED config (Codex regression)', async () => {
    await mkUser('adm', 'adm', 'orgA', 'org-admin');
    await mkUser('bld', 'bld', 'orgA', 'builder');
    // org-admin creates a shared config (ownerUserId undefined)
    await api('/api/v1/integrations/configs', await tokenFor('adm'), { method: 'POST', body: JSON.stringify({ integrationKey: 'stripe', configValues: { apiKey: 'admin-secret' } }) });
    const bld = await tokenFor('bld');
    // builder can SEE it (shared) ...
    const list = (await (await api('/api/v1/integrations/configs', bld)).json()) as { items: unknown[] };
    expect(list.items).toHaveLength(1);
    // ... but cannot overwrite it
    const patch = await api('/api/v1/integrations/configs/stripe', bld, { method: 'PATCH', body: JSON.stringify({ configValues: { apiKey: 'hacked' } }) });
    expect(patch.status).toBe(403);
    // ... nor delete it
    const del = await api('/api/v1/integrations/stripe', bld, { method: 'DELETE' });
    expect(del.status).toBe(403);
  });
});

describe('knowledge sources (ch03 §3.8.20) — org-partitioned + SSRF-validated at write', () => {
  it('rejects a private-address source URL with 400 VALIDATION_FAILED (SSRF, per-entry-point)', async () => {
    await mkUser('k1', 'k1', 'orgA', 'builder');
    const t = await tokenFor('k1');
    const res = await api('/api/v1/knowledge/sources', t, { method: 'POST', body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('accepts a public source URL and org-partitions it', async () => {
    await mkUser('k2', 'k2', 'orgA', 'builder');
    await mkUser('k3', 'k3', 'orgB', 'builder');
    const res = await api('/api/v1/knowledge/sources', await tokenFor('k2'), { method: 'POST', body: JSON.stringify({ url: 'https://dgsi.pt/jtrl' }) });
    expect(res.status).toBe(201);
    // org B does not see org A's source
    const bList = (await (await api('/api/v1/knowledge/sources', await tokenFor('k3'))).json()) as { items: unknown[] };
    expect(bList.items).toHaveLength(0);
  });
});
