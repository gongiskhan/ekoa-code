import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { artifacts, slugs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { appFilesRouter } from '../../src/apps/app-files.js';

/**
 * G6 S5: the byte-compatible /api/app-files plane (ch03 §3.9, FIXED-9) - raw-bytes upload,
 * the `{success:true,data:{id,url,name,size,type}}` envelope the injected window.__ekoa
 * client unwraps, header scoping, the 404→false delete semantics, and the Amendment 2
 * owner-activation gate. Mounted on a bare express app (server.ts does not own this router
 * yet); storage is a temp EKOA_DATA_DIR.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let dataDir: string;

const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, init);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_appfiles');
  dataDir = await mkdtemp(join(tmpdir(), 'ekoa-appfiles-'));
  process.env.EKOA_DATA_DIR = dataDir;

  const app = express();
  app.use('/api/app-files', appFilesRouter());
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
  await rm(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  __resetActivationForTests();
  for (const s of [artifacts, slugs]) await s.deleteMany({});
  await getDb().collection('app_data').deleteMany({});
  // an app owned by an ACTIVE owner, reachable by its canonical id AND a slug
  await artifacts.insert({ _id: 'art1', name: 'Gestor', slug: 'gestor', userId: 'owner1', orgId: 'orgA', visibility: 'private' } as never);
  await slugs.put({ _id: 'gestor', artifactId: 'art1' });
  setActivation('owner1', { active: true, billingLocked: false });
});

async function upload(appId: string, filename: string, type: string, body: Buffer) {
  return api('/api/app-files', {
    method: 'POST',
    headers: { 'x-ekoa-app-id': appId, 'x-filename': encodeURIComponent(filename), 'content-type': type },
    body,
  });
}

describe('app-files: upload → serve → delete round trip (raw bytes, byte-compat envelope)', () => {
  it('POST stores raw bytes and returns {success,data:{id,url,name,size,type}}; GET serves the exact bytes; DELETE is 200 then 404→false', async () => {
    const bytes = Buffer.from('olá mundo binário ', 'utf8');
    const res = await upload('art1', 'Cartão de Cidadão.txt', 'text/plain', bytes);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: { id: string; url: string; name: string; size: number; type: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data.url).toBe(`/api/app-files/art1/${body.data.id}`);
    expect(body.data.name).toBe('Cartão de Cidadão.txt');
    expect(body.data.size).toBe(bytes.length);
    expect(body.data.type).toBe('text/plain');

    // GET the url (no header needed; owner resolved from the :appId path segment)
    const served = await api(body.data.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('text/plain');
    expect(served.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    const servedBytes = Buffer.from(await served.arrayBuffer());
    expect(servedBytes.equals(bytes)).toBe(true);

    // DELETE (header must be present + match)
    const del = await api(body.data.url, { method: 'DELETE', headers: { 'x-ekoa-app-id': 'art1' } });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ success: true });

    // second delete → 404 {error:'Not found'} (injected client maps 404 → false)
    const again = await api(body.data.url, { method: 'DELETE', headers: { 'x-ekoa-app-id': 'art1' } });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: 'Not found' });

    // and the blob is gone
    expect((await api(body.data.url)).status).toBe(404);
  });

  it('a slug header resolves to the canonical id for storage + url', async () => {
    const res = await upload('gestor', 'nota.bin', 'application/octet-stream', Buffer.from('x'));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { url: string } };
    // canonical id in the url, never the slug
    expect(body.data.url).toMatch(/^\/api\/app-files\/art1\//);
  });
});

describe('app-files: header + admission errors (old string shapes; Amendment 2 gate)', () => {
  it('missing header → 400; reserved usr. → 400; unknown-but-valid id is key-value (byte-compat)', async () => {
    const noHeader = await api('/api/app-files', { method: 'POST', headers: { 'x-filename': 'a' }, body: Buffer.from('x') });
    expect(noHeader.status).toBe(400);
    expect(await noHeader.json()).toEqual({ error: 'Missing or invalid X-Ekoa-App-Id header' });

    const reserved = await upload('usr.evil', 'a', 'text/plain', Buffer.from('x'));
    expect(reserved.status).toBe(400);

    // Byte-compat: app-files (like app-data) never required the app to exist - an
    // unknown-but-valid id keys on itself and stores. A served app (dev-serve or
    // featured) that has no artifact record must still be able to upload.
    const unknown = await upload('nope', 'a', 'text/plain', Buffer.from('x'));
    expect(unknown.status).toBe(201);
  });

  it('DELETE with a mismatched app id → 403', async () => {
    await artifacts.insert({ _id: 'art2', name: 'B', userId: 'owner1', orgId: 'orgA', visibility: 'private' } as never);
    const up = await upload('art1', 'a.txt', 'text/plain', Buffer.from('x'));
    const { data } = (await up.json()) as { data: { url: string } };
    const mismatched = await api(data.url, { method: 'DELETE', headers: { 'x-ekoa-app-id': 'art2' } });
    expect(mismatched.status).toBe(403);
    expect(((await mismatched.json()) as { error: string }).error).toContain('does not match');
  });

  it('deactivated owner → 403 ACCOUNT_DISABLED; billing-locked → 402; no record fails closed', async () => {
    setActivation('owner1', { active: false, billingLocked: false });
    const disabled = await upload('art1', 'a', 'text/plain', Buffer.from('x'));
    expect(disabled.status).toBe(403);
    expect(((await disabled.json()) as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');

    setActivation('owner1', { active: true, billingLocked: true });
    const locked = await upload('art1', 'a', 'text/plain', Buffer.from('x'));
    expect(locked.status).toBe(402);
    expect(((await locked.json()) as { error: { code: string } }).error.code).toBe('BILLING_LOCKED');

    __resetActivationForTests();
    expect((await upload('art1', 'a', 'text/plain', Buffer.from('x'))).status).toBe(403);
  });
});
