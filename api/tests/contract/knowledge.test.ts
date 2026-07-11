import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, knowledgeUploads } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { closeIndex } from '../../src/knowledge/index-store.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  CollectionsResponse, DocumentsResponse, CreateDocumentResponse, OkResponse,
  CreateUploadResponse, DeleteUploadResponse, UploadsResponse, ReindexResponse, IndexStatus, ErrorEnvelope,
} from '@ekoa/shared';

/**
 * G7B contract: the org-partitioned knowledge vault + lexical index REST surface (ch03 §3.8.20).
 * Every response validates against its named shared/ schema; cross-org isolation and the
 * org-admin gate on the heal operations are exercised.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number; let dir: string;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'builder') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
const upload = (t: string, filename: string, collection: string, body: string, contentType: string) =>
  fetch(`http://127.0.0.1:${port}/api/v1/knowledge/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${t}`, 'content-type': contentType, 'x-filename': encodeURIComponent(filename), 'x-collection': collection },
    body,
  });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_g7b');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  closeIndex();
  dir = await mkdtemp(join(tmpdir(), 'ekoa-g7b-'));
  process.env.EKOA_DATA_DIR = dir;
  for (const s of [users, orgs, knowledgeUploads]) await s.deleteMany({});
});

describe('vault documents (ch03 §3.8.20)', () => {
  it('ingest → list → collections → delete, each validating its shared schema', async () => {
    await mkUser('u1', 'orgA', 'builder');
    const t = await tokenFor('u1');

    const created = await api('/api/v1/knowledge/documents', t, { method: 'POST', body: JSON.stringify({ collection: 'jurisprudencia', title: 'Prazos de recurso', text: 'o prazo de recurso é de 30 dias' }) });
    expect(created.status).toBe(201);
    const cbody = await created.json();
    expect(CreateDocumentResponse.safeParse(cbody).success).toBe(true);
    const docId = (cbody as { id: string }).id;

    const list = await api('/api/v1/knowledge/documents', t);
    expect(list.status).toBe(200);
    const lbody = await list.json();
    expect(DocumentsResponse.safeParse(lbody).success).toBe(true);
    expect((lbody as { total: number }).total).toBe(1);

    const collections = await api('/api/v1/knowledge/collections', t);
    const colBody = await collections.json();
    expect(CollectionsResponse.safeParse(colBody).success).toBe(true);
    expect((colBody as { items: string[] }).items).toContain('jurisprudencia');

    const del = await api(`/api/v1/knowledge/collections/jurisprudencia/documents/${docId}`, t, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(OkResponse.safeParse(await del.json()).success).toBe(true);

    const empty = await api('/api/v1/knowledge/documents', t);
    expect((await empty.json() as { total: number }).total).toBe(0);
  });

  it('deleting an unknown document returns the uniform 404 error envelope', async () => {
    await mkUser('u1', 'orgA', 'builder');
    const res = await api('/api/v1/knowledge/collections/c/documents/nope', await tokenFor('u1'), { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });
});

describe('uploads (raw body + X-Filename/X-Collection)', () => {
  it('a .md upload is ingested + searchable; a binary upload is registered un-indexed', async () => {
    await mkUser('u1', 'orgA', 'builder');
    const t = await tokenFor('u1');

    const md = await upload(t, 'nota.md', 'uploads', 'texto sobre penhora de bens', 'text/markdown');
    expect(md.status).toBe(201);
    const mdBody = await md.json();
    expect(CreateUploadResponse.safeParse(mdBody).success).toBe(true);
    expect((mdBody as { status: string }).status).toBe('indexed');

    const bin = await upload(t, 'contrato.pdf', 'uploads', '%PDF-1.4 binary', 'application/pdf');
    expect(bin.status).toBe(201);
    expect((await bin.json() as { status: string }).status).toBe('registered');

    // the .md content is discoverable via the grounding surface's collection listing
    const docs = await api('/api/v1/knowledge/documents', t);
    expect((await docs.json() as { total: number }).total).toBe(1);

    const del = await api(`/api/v1/knowledge/uploads/${(mdBody as { uploadId: string }).uploadId}`, t, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const dbody = await del.json();
    expect(DeleteUploadResponse.safeParse(dbody).success).toBe(true);
    expect(dbody).toEqual({ removed: true, docsRemoved: 1 });
  });

  it('GET /uploads validates UploadsResponse (rows carry `id`, not the store `_id`)', async () => {
    await mkUser('u1', 'orgA', 'builder');
    const t = await tokenFor('u1');
    const created = await upload(t, 'nota.md', 'uploads', 'texto sobre penhora de bens', 'text/markdown');
    expect(created.status).toBe(201);
    const uploadId = ((await created.json()) as { uploadId: string }).uploadId;

    const res = await api('/api/v1/knowledge/uploads', t);
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = UploadsResponse.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error)).toBe(true);
    const items = (body as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(uploadId);
    expect(items[0]!.filename).toBe('nota.md');
  });

  it('rejects an upload with no X-Filename (400 envelope)', async () => {
    await mkUser('u1', 'orgA', 'builder');
    const t = await tokenFor('u1');
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/knowledge/uploads`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'text/plain' }, body: 'x' });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });
});

describe('org-admin heal operations', () => {
  it('reindex is org-admin-gated (builder 403, org-admin 202) and index-status validates', async () => {
    await mkUser('adm', 'orgA', 'org-admin');
    await mkUser('bld', 'orgA', 'builder');

    const bldRes = await api('/api/v1/knowledge/reindex', await tokenFor('bld'), { method: 'POST' });
    expect(bldRes.status).toBe(403);
    const admT = await tokenFor('adm');
    const admRes = await api('/api/v1/knowledge/reindex', admT, { method: 'POST' });
    expect(admRes.status).toBe(202);
    expect(ReindexResponse.safeParse(await admRes.json()).success).toBe(true);

    const status = await api('/api/v1/knowledge/index-status', admT);
    expect(status.status).toBe(200);
    expect(IndexStatus.safeParse(await status.json()).success).toBe(true);
  });
});

describe('cross-org isolation', () => {
  it('orgB never sees orgA documents, collections, or uploads', async () => {
    await mkUser('a', 'orgA', 'builder');
    await mkUser('b', 'orgB', 'builder');
    const ta = await tokenFor('a'); const tb = await tokenFor('b');
    await api('/api/v1/knowledge/documents', ta, { method: 'POST', body: JSON.stringify({ collection: 'c', title: 'Segredo', text: 'cláusula confidencial do processo' }) });
    await upload(ta, 'a.md', 'c', 'texto privado', 'text/markdown');

    expect((await (await api('/api/v1/knowledge/documents', tb)).json() as { total: number }).total).toBe(0);
    expect((await (await api('/api/v1/knowledge/collections', tb)).json() as { items: string[] }).items).toEqual([]);
    expect((await (await api('/api/v1/knowledge/uploads', tb)).json() as { items: unknown[] }).items).toHaveLength(0);
  });
});
