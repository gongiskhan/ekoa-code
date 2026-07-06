import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, artifacts, slugs } from '../../src/data/stores.js';
import { getDb } from '../../src/data/mongo.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, type Config } from '../../src/config.js';

/**
 * G6 data-plane core: the byte-compatible served-app data plane (ch03 §3.9, ch04 §4.2.7)
 * over the collections engine, header-scoped by X-Ekoa-App-Id; and artifact CRUD + visibility.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x' };

async function mkUser(id: string, username: string, orgId: string, role: 'super-admin' | 'org-admin' | 'builder') {
  await users.insert({ _id: id, username, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const jwtApi = (p: string, t: string, init: RequestInit = {}) => api(p, { ...init, headers: { authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const appApi = (p: string, appId: string, init: RequestInit = {}) => api(p, { ...init, headers: { 'x-ekoa-app-id': appId, ...(init.headers ?? {}) } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_g6');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  for (const s of [users, artifacts, slugs]) await s.deleteMany({});
  await getDb().collection('app_data').deleteMany({});
});

describe('served-app data plane (ch03 §3.9, byte-compatible)', () => {
  beforeEach(async () => {
    // an app served under slug "gestor" with sharedData
    await artifacts.insert({ _id: 'art1', name: 'Gestor', slug: 'gestor', userId: 'owner1', orgId: 'orgA', visibility: 'private', sharedData: true } as never);
    await slugs.put({ _id: 'gestor', artifactId: 'art1' });
  });

  it('POST creates the bare item (no wrapper, _rev absent); GET returns it; scoped by app', async () => {
    const created = await appApi('/api/app-data/clientes', 'gestor', { method: 'POST', body: JSON.stringify({ nome: 'Maria', nif: '123456789' }) });
    expect(created.status).toBe(201);
    const item = (await created.json()) as Record<string, unknown>;
    expect(item.id).toBeTruthy();
    expect(item.createdAt).toBeTruthy();
    expect(item.nome).toBe('Maria');
    expect('_rev' in item).toBe(false); // _rev never on the wire

    const list = (await (await appApi('/api/app-data/clientes', 'gestor')).json()) as unknown[];
    expect(list).toHaveLength(1);

    // resolve by canonical id too (byte-compat: header is slug OR id)
    const byId = (await (await appApi('/api/app-data/clientes', 'art1')).json()) as unknown[];
    expect(byId).toHaveLength(1);
  });

  it('PUT upserts (creates with the given id when absent)', async () => {
    const up = await appApi('/api/app-data/notas/n1', 'gestor', { method: 'PUT', body: JSON.stringify({ texto: 'a' }) });
    expect(up.status).toBe(200);
    expect(((await up.json()) as { id: string }).id).toBe('n1');
  });

  it('missing X-Ekoa-App-Id → 400; usr.-prefixed → 403; unknown app → 404; reserved collection → 403', async () => {
    expect((await api('/api/app-data/clientes')).status).toBe(400);
    expect((await appApi('/api/app-data/clientes', 'usr.evil')).status).toBe(403);
    expect((await appApi('/api/app-data/clientes', 'nope')).status).toBe(404);
    expect((await appApi('/api/app-data/__files', 'gestor', { method: 'POST', body: '{}' })).status).toBe(403);
  });

  it('app A data is isolated from app B (scoping)', async () => {
    await artifacts.insert({ _id: 'art2', name: 'B', slug: 'appb', userId: 'owner2', orgId: 'orgB', visibility: 'private' } as never);
    await slugs.put({ _id: 'appb', artifactId: 'art2' });
    await appApi('/api/app-data/x', 'gestor', { method: 'POST', body: JSON.stringify({ v: 1 }) });
    const bList = (await (await appApi('/api/app-data/x', 'appb')).json()) as unknown[];
    expect(bList).toHaveLength(0);
  });
});

describe('artifacts (ch03 §3.8.9) — CRUD + visibility + slug', () => {
  it('create returns a deterministic slug; list is the single {items,featured} shape', async () => {
    await mkUser('u1', 'u1', 'orgA', 'builder');
    const t = await tokenFor('u1');
    const created = (await (await jwtApi('/api/v1/artifacts', t, { method: 'POST', body: JSON.stringify({ name: 'Gestor de Clientes' }) })).json()) as { slug: string };
    expect(created.slug).toBe('gestor-clientes'); // stop-words stripped, deterministic
    const list = (await (await jwtApi('/api/v1/artifacts', t)).json()) as { items: unknown[]; featured: unknown[] };
    expect(Array.isArray(list.items)).toBe(true);
    expect(Array.isArray(list.featured)).toBe(true);
  });

  it("a private artifact of another user is 404; editing it is 403", async () => {
    await mkUser('ua', 'ua', 'orgA', 'builder');
    await mkUser('ub', 'ub', 'orgA', 'builder');
    await artifacts.insert({ _id: 'p1', name: 'B priv', userId: 'ub', orgId: 'orgA', visibility: 'private' } as never);
    const t = await tokenFor('ua');
    expect((await jwtApi('/api/v1/artifacts/p1', t)).status).toBe(404);
    expect((await jwtApi('/api/v1/artifacts/p1', t, { method: 'PATCH', body: JSON.stringify({ name: 'x' }) })).status).toBe(403);
  });
});

describe('served-app static serving + window.__ekoa injection (ch07 §7.5/7.6)', () => {
  it('injects window.__ekoa, base href, demo-bridge into a shareable app HTML', async () => {
    await artifacts.insert({ _id: 'sv1', name: 'Served', slug: 'served', userId: 'o', orgId: 'orgA', visibility: 'org', shareable: true, data: { distHtml: '<!doctype html><head></head><body>hi</body>' } } as never);
    await slugs.put({ _id: 'served', artifactId: 'sv1' });
    const res = await api('/apps/served/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('window.__EKOA_APP_ID="sv1"');
    expect(html).toContain('window.__ekoa');
    expect(html).toContain('<base href="/apps/sv1/">');
    expect(html).toContain('/__ekoa/demo-bridge.js');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('trailing-slash redirect; non-shareable without token → 403; not-yet-built → 503', async () => {
    await artifacts.insert({ _id: 'sv2', name: 'Priv', slug: 'priv', userId: 'o', orgId: 'orgA', visibility: 'private', shareable: false } as never);
    await slugs.put({ _id: 'priv', artifactId: 'sv2' });
    const redir = await api('/apps/priv', { redirect: 'manual' });
    expect(redir.status).toBe(301);
    const forbidden = await api('/apps/priv/');
    expect(forbidden.status).toBe(403);
    // shareable but no dist → building placeholder
    await artifacts.insert({ _id: 'sv3', name: 'Build', slug: 'bld', userId: 'o', orgId: 'orgA', visibility: 'org', shareable: true } as never);
    await slugs.put({ _id: 'bld', artifactId: 'sv3' });
    const building = await api('/apps/bld/');
    expect(building.status).toBe(503);
  });
});
