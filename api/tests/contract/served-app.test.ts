import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { users, artifacts, slugs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { appRegistry } from '../../src/apps/app-registry.js';
import { indexSlug, __resetSlugIndexForTests } from '../../src/apps/slug-index.js';
import { __resetAppHealthDedupeForTests } from '../../src/apps/serving.js';
import { AppDataListEnvelope } from '@ekoa/shared';
import { getArtifactScreenshotDir } from '../../src/services/artifact-screenshot.js';

/**
 * G6: the byte-compatible served-app plane (ch03 §3.9) - data plane wire shapes
 * (the old `{success:true,data}` envelope the injected window.__ekoa client
 * unwraps), the §7.5 serving pipeline, and the §7.6 injection contract. These are
 * compatibility assertions (FIXED-9), not designs - the old monolith's behavior
 * is the reference.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
let tmpRoot: string;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

async function mkUser(id: string, username: string, orgId: string, role: 'super-admin' | 'org-admin' | 'builder') {
  await users.insert({ _id: id, username, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const jwtApi = (p: string, t: string, init: RequestInit = {}) => api(p, { ...init, headers: { authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const appApi = (p: string, appId: string, init: RequestInit = {}) => api(p, { ...init, headers: { 'x-ekoa-app-id': appId, ...(init.headers ?? {}) } });

/** Create a real on-disk app (manifest + dist/index.html) and register it. */
async function mkServedApp(id: string, opts: { html?: string; extraDist?: Record<string, string> } = {}): Promise<string> {
  const projectDir = join(tmpRoot, id);
  await mkdir(join(projectDir, 'dist'), { recursive: true });
  await writeFile(join(projectDir, 'manifest.json'), JSON.stringify({ id, name: id, type: 'react-app' }));
  await writeFile(
    join(projectDir, 'dist', 'index.html'),
    opts.html ?? '<!DOCTYPE html>\n<html>\n<head>\n<title>x</title>\n</head>\n<body><div id="root">hi</div></body>\n</html>',
  );
  for (const [name, content] of Object.entries(opts.extraDist ?? {})) {
    await writeFile(join(projectDir, 'dist', name), content);
  }
  await appRegistry.register(id, projectDir, 'owner1', id);
  return projectDir;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  // buildApp pre-creates + mounts the artifact-screenshot dir — keep it off the real home dir.
  process.env.EKOA_DATA_DIR = await mkdtemp(join(tmpdir(), 'ekoa-served-data-'));
  __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_g6');
  tmpRoot = await mkdtemp(join(tmpdir(), 'ekoa-served-'));
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  server.close();
  await appRegistry.stop();
  await closeMongo();
  await mem.stop();
  await rm(tmpRoot, { recursive: true, force: true });
  if (process.env.EKOA_DATA_DIR) await rm(process.env.EKOA_DATA_DIR, { recursive: true, force: true });
  delete process.env.EKOA_DATA_DIR;
});
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests(); __resetSlugIndexForTests(); __resetAppHealthDedupeForTests();
  await appRegistry.stop();
  for (const s of [users, artifacts, slugs]) await s.deleteMany({});
  await getDb().collection('app_data').deleteMany({});
});

describe('artifact thumbnails static plane (ch07 §7.11)', () => {
  it('serves captured PNGs at /artifact-screenshots/<id>.png and 404s missing ones', async () => {
    const dir = getArtifactScreenshotDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'shot-a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const ok = await api('/artifact-screenshots/shot-a.png');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type') ?? '').toContain('image/png');

    const missing = await api('/artifact-screenshots/nope.png');
    expect(missing.status).toBe(404);
  });
});

describe('served-app data plane (ch03 §3.9) - the old wire envelope, byte-compatible', () => {
  beforeEach(async () => {
    // an app served under slug "gestor" with sharedData, owned by an ACTIVE owner
    await artifacts.insert({ _id: 'art1', name: 'Gestor', slug: 'gestor', userId: 'owner1', orgId: 'orgA', visibility: 'private', sharedData: true } as never);
    await slugs.put({ _id: 'gestor', artifactId: 'art1' });
    setActivation('owner1', { active: true, billingLocked: false });
  });

  it('POST → 201 {success,data}; GET list/item unwrap as the injected client expects; _rev never on the wire', async () => {
    const created = await appApi('/api/app-data/clientes', 'gestor', { method: 'POST', body: JSON.stringify({ nome: 'Maria', nif: '123456789' }) });
    expect(created.status).toBe(201);
    const cBody = (await created.json()) as { success: boolean; data: Record<string, unknown> };
    expect(cBody.success).toBe(true);
    expect(cBody.data.id).toBeTruthy();
    expect(cBody.data.createdAt).toBeTruthy();
    expect(cBody.data.nome).toBe('Maria');
    expect('_rev' in cBody.data).toBe(false);

    const list = (await (await appApi('/api/app-data/clientes', 'gestor')).json()) as { success: boolean; data: unknown[] };
    expect(AppDataListEnvelope.safeParse(list).success, JSON.stringify(list)).toBe(true);
    expect(list.success).toBe(true);
    expect(list.data).toHaveLength(1);

    const item = await appApi(`/api/app-data/clientes/${cBody.data.id}`, 'gestor');
    expect(item.status).toBe(200);
    expect(((await item.json()) as { data: { nome: string } }).data.nome).toBe('Maria');

    // resolve by canonical id too (byte-compat: header is slug OR id)
    const byId = (await (await appApi('/api/app-data/clientes', 'art1')).json()) as { data: unknown[] };
    expect(byId.data).toHaveLength(1);
  });

  it('PUT upserts: creates with the given id when absent (200), merges when present (200)', async () => {
    const up = await appApi('/api/app-data/notas/n1', 'gestor', { method: 'PUT', body: JSON.stringify({ texto: 'a' }) });
    expect(up.status).toBe(200);
    const created = (await up.json()) as { success: boolean; data: { id: string; texto: string } };
    expect(created.success).toBe(true);
    expect(created.data.id).toBe('n1');

    const merge = await appApi('/api/app-data/notas/n1', 'gestor', { method: 'PUT', body: JSON.stringify({ extra: 1 }) });
    const merged = (await merge.json()) as { data: { texto: string; extra: number } };
    expect(merged.data.texto).toBe('a');
    expect(merged.data.extra).toBe(1);
  });

  it('DELETE → {success:true}; missing id → 404 {error:"Not found"} (string errors, old shapes)', async () => {
    await appApi('/api/app-data/x/one', 'gestor', { method: 'PUT', body: JSON.stringify({ v: 1 }) });
    const del = await appApi('/api/app-data/x/one', 'gestor', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ success: true });

    const again = await appApi('/api/app-data/x/one', 'gestor', { method: 'DELETE' });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: 'Not found' });
  });

  it('OPTIONS → 204; header errors carry the old strings', async () => {
    expect((await api('/api/app-data/clientes', { method: 'OPTIONS' })).status).toBe(204);

    const missing = await api('/api/app-data/clientes');
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'Missing or invalid X-Ekoa-App-Id header' });

    // the reserved shared prefix is unreachable by header spoofing
    const reserved = await appApi('/api/app-data/clientes', 'usr.evil');
    expect(reserved.status).toBe(400);

    // invalid collection 400s before the header is looked at (old middleware order)
    const badCol = await api('/api/app-data/__files');
    expect(badCol.status).toBe(400);
    expect(await badCol.json()).toEqual({ error: 'Invalid collection name' });

    // Byte-compat: the PER-APP plane is key-value - an unknown-but-valid id is NOT
    // rejected (the old plane never required the app to exist; featured/dev/any id
    // work). It keys on itself and reads back empty.
    const unknown = await appApi('/api/app-data/clientes', 'nope');
    expect(unknown.status).toBe(200);
    expect(((await unknown.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  it('app A data is isolated from app B (scoping)', async () => {
    await artifacts.insert({ _id: 'art2', name: 'B', slug: 'appb', userId: 'owner2', orgId: 'orgB', visibility: 'private' } as never);
    await slugs.put({ _id: 'appb', artifactId: 'art2' });
    setActivation('owner2', { active: true, billingLocked: false });
    await appApi('/api/app-data/x', 'gestor', { method: 'POST', body: JSON.stringify({ v: 1 }) });
    const bList = (await (await appApi('/api/app-data/x', 'appb')).json()) as { data: unknown[] };
    expect(bList.data).toHaveLength(0);
  });

  it('shared namespace: opt-in gate, same-origin guard, owner-pooled across apps', async () => {
    // two apps of the SAME owner, both opted in → one pooled namespace
    await artifacts.insert({ _id: 'art3', name: 'C', slug: 'appc', userId: 'owner1', orgId: 'orgA', visibility: 'private', sharedData: true } as never);
    await slugs.put({ _id: 'appc', artifactId: 'art3' });
    const created = await appApi('/api/app-shared/spine', 'gestor', { method: 'POST', body: JSON.stringify({ k: 'v' }) });
    expect(created.status).toBe(201);
    const viaOtherApp = (await (await appApi('/api/app-shared/spine', 'appc')).json()) as { data: unknown[] };
    expect(AppDataListEnvelope.safeParse(viaOtherApp).success, JSON.stringify(viaOtherApp)).toBe(true);
    expect(viaOtherApp.data).toHaveLength(1);

    // non-opted-in app → 403 with the carried string
    await artifacts.insert({ _id: 'art4', name: 'D', slug: 'appd', userId: 'owner1', orgId: 'orgA', visibility: 'private' } as never);
    await slugs.put({ _id: 'appd', artifactId: 'art4' });
    const denied = await appApi('/api/app-shared/spine', 'appd');
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'app does not participate in shared data' });

    // foreign Origin → 403 (the CORS-* exfil guard)
    const foreign = await appApi('/api/app-shared/spine', 'gestor', { headers: { origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: 'cross-origin shared-data access denied' });
  });

  it('second admission plane (Amendment 2): deactivated owner → 403 ACCOUNT_DISABLED; billing-locked → 402 (CONV-2)', async () => {
    setActivation('owner1', { active: false, billingLocked: false });
    const disabled = await appApi('/api/app-data/clientes', 'gestor');
    expect(disabled.status).toBe(403);
    expect(((await disabled.json()) as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');

    setActivation('owner1', { active: true, billingLocked: true });
    const locked = await appApi('/api/app-data/clientes', 'gestor');
    expect(locked.status).toBe(402);
    expect(((await locked.json()) as { error: { code: string } }).error.code).toBe('BILLING_LOCKED');

    // no activation record at all fails CLOSED (ch09)
    __resetActivationForTests();
    expect((await appApi('/api/app-data/clientes', 'gestor')).status).toBe(403);
  });
});

describe('artifacts (ch03 §3.8.9) - CRUD + visibility + slug', () => {
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

describe('static serving pipeline (ch07 §7.5, carried exactly)', () => {
  it('trailing-slash 301; slug resolves to the canonical id in the injected context', async () => {
    await mkServedApp('svapp1');
    await artifacts.insert({ _id: 'svapp1', name: 'Served', slug: 'servedslug', userId: 'owner1', orgId: 'orgA', visibility: 'org', shareable: true } as never);
    indexSlug('servedslug', 'svapp1');

    const redir = await api('/apps/servedslug', { redirect: 'manual' });
    expect(redir.status).toBe(301);
    expect(redir.headers.get('location')).toBe('/apps/servedslug/');

    const res = await api('/apps/servedslug/');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    const html = await res.text();
    expect(html).toContain('window.__EKOA_APP_ID="svapp1"'); // canonical id, never the slug
    expect(html).toContain('<base href="/apps/svapp1/">');
  });

  it('shareability gate (§7.7): revoked slug → 410 PT page; owner bypass via ?token=; direct id hit is not gated', async () => {
    await mkUser('owner1', 'owner1', 'orgA', 'builder');
    await mkServedApp('svpriv');
    await artifacts.insert({ _id: 'svpriv', name: 'Priv', slug: 'privslug', userId: 'owner1', orgId: 'orgA', visibility: 'private', shareable: false } as never);
    indexSlug('privslug', 'svpriv');

    // via slug (not a direct registry hit) → revoked
    const revoked = await api('/apps/privslug/');
    expect(revoked.status).toBe(410);
    expect(await revoked.text()).toContain('O autor revogou a partilha deste artefacto.');

    // owner sees it (requester-token order includes ?token=; Q-05)
    const t = await tokenFor('owner1');
    const owner = await api(`/apps/privslug/?token=${t}`);
    expect(owner.status).toBe(200);

    // Hardened over the old plane (Codex G6 review finding 1): a revoked/non-shareable
    // artifact reached by its CANONICAL id is also gated - 410 without a token, 200 for
    // the owner. The old plane skipped the check for any registry hit, letting an
    // attacker who learned the canonical id keep loading a revoked share.
    const directAnon = await api('/apps/svpriv/');
    expect(directAnon.status).toBe(410);
    const directOwner = await api(`/apps/svpriv/?token=${t}`);
    expect(directOwner.status).toBe(200);

    // assets are never gated (browsers do not propagate ?token= on sub-resources)
    const asset = await api('/apps/privslug/bundle.js');
    expect(asset.status).not.toBe(410);
  });

  it('lazy-heal jails a client-set data.projectDir - a `..` escape never serves outside the sandbox (Codex G6 finding 2)', async () => {
    // ArtifactPatch permits `data`, so a client can set data.projectDir. A raw
    // startsWith(sandboxRoot) accepted `<sandboxRoot>/../<escape>` (starts with the
    // root, escapes via ..). The jail must refuse it -> the app stays "building"
    // (503/placeholder), never serving arbitrary on-disk files.
    const sandbox = process.env.SANDBOX_ROOT || join(tmpdir(), 'nope-sandbox');
    await artifacts.insert({
      _id: 'evilheal', name: 'Evil', userId: 'owner1', orgId: 'orgA', visibility: 'org', shareable: true,
      data: { projectDir: join(sandbox, '..', '..', '..', '..', 'etc') },
    } as never);
    setActivation('owner1', { active: true, billingLocked: false });
    const res = await api('/apps/evilheal/');
    const html = await res.text();
    // The jail refused the escape, so serving fell through to the "Building..."
    // placeholder (200 nav) - it NEVER registered/served the escaped directory.
    expect(res.status).toBe(200);
    expect(html).toContain('Building');
    expect(html).not.toContain('root:'); // never leaks /etc/* style content
  });

  it('building placeholder: 200 auto-refresh HTML for navigations, 503 plain for assets, both uncacheable', async () => {
    const nav = await api('/apps/notbuilt/');
    expect(nav.status).toBe(200);
    expect(nav.headers.get('cache-control')).toContain('no-store');
    const html = await nav.text();
    expect(html).toContain('Building your app...');
    expect(html).toContain('setTimeout(function(){location.reload()},3000)');

    const asset = await api('/apps/notbuilt/bundle.js');
    expect(asset.status).toBe(503);
    expect(asset.headers.get('cache-control')).toContain('no-store');
    expect(await asset.text()).toBe('/* app build not ready */');
  });

  it('asset miss → JSON 404 (never HTML-as-JS); deep navigation → SPA fallback to the injected index', async () => {
    await mkServedApp('svspa', { extraDist: { 'bundle.js': '(() => { /* app */ })();' } });
    await artifacts.insert({ _id: 'svspa', name: 'Spa', userId: 'owner1', orgId: 'orgA', visibility: 'org', shareable: true } as never);

    const missing = await api('/apps/svspa/missing.css');
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toContain('Asset not found');

    const deep = await api('/apps/svspa/clientes/c1');
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('window.__EKOA_APP_ID="svspa"');
  });

  it('cache discipline: bundle.js no-cache; hashed assets immutable 1y; others 1h', async () => {
    await mkServedApp('svcache', {
      extraDist: { 'bundle.js': '(() => {})();', 'main.a1b2c3d4.js': '(() => {})();', 'logo.png': 'png' },
    });
    await artifacts.insert({ _id: 'svcache', name: 'C', userId: 'owner1', orgId: 'orgA', visibility: 'org', shareable: true } as never);

    expect((await api('/apps/svcache/bundle.js')).headers.get('cache-control')).toContain('no-cache');
    expect((await api('/apps/svcache/main.a1b2c3d4.js')).headers.get('cache-control')).toContain('immutable');
    expect((await api('/apps/svcache/logo.png')).headers.get('cache-control')).toContain('max-age=3600');
  });
});

describe('context injection (ch07 §7.6) - every member of the injected table, string-asserted', () => {
  it('the served HTML carries the full byte-compatible __ekoa surface', async () => {
    await mkServedApp('svfull');
    await artifacts.insert({ _id: 'svfull', name: 'Full', userId: 'owner1', orgId: 'orgA', visibility: 'org', shareable: true } as never);

    const html = await (await api('/apps/svfull/')).text();
    for (const member of [
      'window.__EKOA_APP_ID="svfull"',
      'window.__ekoa=',
      'fetch:ekoaFetch',
      'list:function(collection)',
      'get:function(collection,id)',
      'create:function(collection,data)',
      'update:function(collection,id,patch)',
      'delete:function(collection,id)',
      'shared:{',
      'uploadFile:function(file,opts)',
      'deleteFile:function(id)',
      'signIn:function(returnPath)',
      'whoami:function()',
      'signOut:function()',
      'graphFetch:function(path,options)',
      'passwordSignIn:function(identity,password,opts)',
      'setUserPassword:function(o)',
      'exportPdf:function(opts)',
      'cloudFiles:{',
      "'/api/app-health'",
      '<script src="/__ekoa/demo-bridge.js"></script>',
      '<base href="/apps/svfull/">',
      "var APP_DATA_PREFIX='/api/app-data/'",
      "var SHARED_DATA_PREFIX='/api/app-shared/'",
    ]) {
      expect(html, `injected HTML must contain ${member}`).toContain(member);
    }
  });

  it('demo-bridge client is served at /__ekoa/demo-bridge.js', async () => {
    const res = await api('/__ekoa/demo-bridge.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toContain('Ekoa Tutorial Bridge');
  });
});

describe('app health probe sink (ch07 §7.11, carried)', () => {
  it('persists broken verdicts, skips featured, drops unknown ids, dedupes same-status', async () => {
    await artifacts.insert({ _id: 'ha1', name: 'H', userId: 'owner1', orgId: 'orgA', visibility: 'private' } as never);
    await artifacts.insert({ _id: 'haf', name: 'F', userId: 'owner1', orgId: 'orgA', visibility: 'org', featured: true } as never);

    const report = (id: string, status: string) =>
      api('/api/app-health', { method: 'POST', headers: { 'x-ekoa-app-id': id }, body: JSON.stringify({ status, reason: 'uncaught-error', errorMessage: 'boom', capturedAt: '2026-07-06T00:00:00Z' }) });

    expect((await report('ha1', 'broken')).status).toBe(204);
    const row = await artifacts.get('ha1');
    expect((row!.health as { status: string }).status).toBe('broken');
    expect((row!.health as { lastError: string }).lastError).toBe('boom');

    // featured skipped - verdict never written
    expect((await report('haf', 'broken')).status).toBe(204);
    expect((await artifacts.get('haf'))!.health).toBeUndefined();

    // unknown dropped silently
    expect((await report('nope', 'broken')).status).toBe(204);

    // same-status dedupe: a second broken within 60s does not rewrite (capturedAt sticks)
    await artifacts.update('ha1', (a) => ({ ...a, health: undefined }) as never);
    expect((await report('ha1', 'broken')).status).toBe(204);
    expect((await artifacts.get('ha1'))!.health ?? null).toBeNull(); // deduped, not re-persisted
  });
});
