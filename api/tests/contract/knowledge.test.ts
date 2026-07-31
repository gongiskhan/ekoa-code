import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { request as httpRequest, type Server } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, knowledgeUploads, gatewayKeys, activityLogs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { closeIndex } from '../../src/knowledge/index-store.js';
import { backfillKnowledgeIndex } from '../../src/knowledge/service.js';
import { serializeDoc } from '../../src/knowledge/vault.js';
import { SHARED_ORG_ID } from '../../src/knowledge/paths.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  CollectionsResponse, DocumentsResponse, CreateDocumentResponse, OkResponse,
  CreateUploadResponse, DeleteUploadResponse, UploadsResponse, ReindexResponse, IndexStatus, ErrorEnvelope,
  KnowledgeSearchResponse, KnowledgeDocumentResponse, knowledgeEndpoints,
} from '@ekoa/shared';

/**
 * G7B contract: the org-partitioned knowledge vault + lexical index REST surface (ch03 §3.8.20).
 * Every response validates against its named shared/ schema; cross-org isolation and the
 * org-admin gate on the heal operations are exercised.
 *
 * SLICE E5 extends it with the capability READ surface: search + read-one over REST, under BOTH
 * admissions of the `user-or-key` class (a platform JWT and a REAL minted `ekoa_gk_` key), the
 * `_shared` corpus round trip, and the per-call audit trail.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number; let dir: string;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
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

/** Ingest one document through the REST write path and return its server-assigned id. */
const ingest = async (t: string, collection: string, title: string, text: string): Promise<string> => {
  const res = await api('/api/v1/knowledge/documents', t, { method: 'POST', body: JSON.stringify({ collection, title, text }) });
  expect(res.status, `ingest ${title}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
};
const search = (t: string, body: Record<string, unknown>) =>
  api('/api/v1/knowledge/search', t, { method: 'POST', body: JSON.stringify(body) });
/** A GET whose path reaches the server BYTE-FOR-BYTE: node:http never normalises `path`, while
 *  the WHATWG URL parser behind fetch resolves `%2e%2e` as a dot-segment before it is sent. */
const rawGet = (path: string, token: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers: { authorization: `Bearer ${token}` } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
const hitsOf = async (res: Response) =>
  ((await res.json()) as { hits: Array<{ collection: string; docId: string; title?: string; snippet?: string; score?: number; scope: string }> }).hits;

/**
 * Plant a document straight into the reserved `_shared` partition, the way the offline importer
 * CLI does: a vault file plus an index backfill. There is deliberately NO online write path to
 * this corpus, so the test cannot create one through the API.
 */
const plantSharedDoc = async (collection: string, docId: string, title: string, body: string): Promise<void> => {
  const dest = join(dir, 'knowledge', 'vault', SHARED_ORG_ID, collection);
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, `${docId}.md`), serializeDoc({ title, createdAt: new Date(1_700_000_000_000).toISOString() }, body), 'utf8');
  await backfillKnowledgeIndex({ force: true });
};

const mintKeyFor = async (t: string, label = 'e5'): Promise<{ id: string; key: string }> => {
  const res = await api('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label }) });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; key: string };
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_g7b');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); closeIndex(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests(); __resetCapabilityRateForTests();
  closeIndex();
  dir = await mkdtemp(join(tmpdir(), 'ekoa-g7b-'));
  process.env.EKOA_DATA_DIR = dir;
  for (const s of [users, orgs, knowledgeUploads, gatewayKeys, activityLogs]) await s.deleteMany({});
});

describe('vault documents (ch03 §3.8.20)', () => {
  it('ingest → list → collections → delete, each validating its shared schema', async () => {
    await mkUser('u1', 'orgA', 'user');
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
    await mkUser('u1', 'orgA', 'user');
    const res = await api('/api/v1/knowledge/collections/c/documents/nope', await tokenFor('u1'), { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });
});

describe('uploads (raw body + X-Filename/X-Collection)', () => {
  it('a .md upload is ingested + searchable; a binary upload is registered un-indexed', async () => {
    await mkUser('u1', 'orgA', 'user');
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
    await mkUser('u1', 'orgA', 'user');
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
    await mkUser('u1', 'orgA', 'user');
    const t = await tokenFor('u1');
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/knowledge/uploads`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'text/plain' }, body: 'x' });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });
});

describe('org-admin heal operations', () => {
  it('reindex is org-admin-gated (builder 403, org-admin 202) and index-status validates', async () => {
    await mkUser('adm', 'orgA', 'org-admin');
    await mkUser('bld', 'orgA', 'user');

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
    await mkUser('a', 'orgA', 'user');
    await mkUser('b', 'orgB', 'user');
    const ta = await tokenFor('a'); const tb = await tokenFor('b');
    await api('/api/v1/knowledge/documents', ta, { method: 'POST', body: JSON.stringify({ collection: 'c', title: 'Segredo', text: 'cláusula confidencial do processo' }) });
    await upload(ta, 'a.md', 'c', 'texto privado', 'text/markdown');

    expect((await (await api('/api/v1/knowledge/documents', tb)).json() as { total: number }).total).toBe(0);
    expect((await (await api('/api/v1/knowledge/collections', tb)).json() as { items: string[] }).items).toEqual([]);
    expect((await (await api('/api/v1/knowledge/uploads', tb)).json() as { items: unknown[] }).items).toHaveLength(0);
  });
});

// =================================================================================================
// SLICE E5 — the capability READ surface: search + read-one over REST, `user-or-key`.
// =================================================================================================

describe('E5 descriptors: which knowledge endpoints are a capability, and which deliberately are not', () => {
  it('the four READ endpoints are user-or-key on the declared paths', () => {
    expect(knowledgeEndpoints.searchKnowledge.method).toBe('POST');
    expect(knowledgeEndpoints.searchKnowledge.path).toBe('/api/v1/knowledge/search');
    expect(knowledgeEndpoints.searchKnowledge.auth).toBe('user-or-key');
    expect(knowledgeEndpoints.readKnowledgeDoc.method).toBe('GET');
    expect(knowledgeEndpoints.readKnowledgeDoc.path).toBe('/api/v1/knowledge/documents/:collection/:docId');
    expect(knowledgeEndpoints.readKnowledgeDoc.auth).toBe('user-or-key');
    // The two browse endpoints this slice FLIPPED so a key-holding client can navigate.
    expect(knowledgeEndpoints.listCollections.auth).toBe('user-or-key');
    expect(knowledgeEndpoints.listDocuments.auth).toBe('user-or-key');
  });

  it('the WRITE + admin half is untouched: no ingestion surface is open to a key', () => {
    for (const name of ['createDocument', 'deleteDocument', 'createUpload', 'deleteUpload', 'listUploads',
      'listSources', 'createSource', 'updateSource', 'deleteSource', 'crawlSource', 'crawlStatus', 'refreshSchedule'] as const) {
      expect(knowledgeEndpoints[name].auth, name).toBe('user');
    }
    for (const name of ['reindex', 'indexStatus'] as const) {
      expect(knowledgeEndpoints[name].auth, name).toBe('org-admin');
    }
    // No knowledge descriptor declares a request/query field that could name an org — a caller
    // cannot even SPELL one at the contract level, on any endpoint of the domain.
    type ShapedDescriptor = { request?: { shape?: Record<string, unknown> }; query?: { shape?: Record<string, unknown> } };
    for (const [name, d] of Object.entries(knowledgeEndpoints) as Array<[string, ShapedDescriptor]>) {
      for (const schema of [d.request, d.query]) {
        const keys = Object.keys(schema?.shape ?? {}).map((k) => k.toLowerCase());
        expect(keys.filter((k) => k.includes('org') || k.includes('tenant')), name).toEqual([]);
      }
    }
  });
});

describe('E5 search (POST /api/v1/knowledge/search)', () => {
  it('round trip: hits validate KnowledgeSearchResponse and carry title/snippet/score/scope', async () => {
    await mkUser('u1', 'orgA', 'user');
    const t = await tokenFor('u1');
    const penhora = await ingest(t, 'jurisprudencia', 'Penhora de bens', 'a penhora de bens móveis segue o regime XPTOUNICO');
    await ingest(t, 'jurisprudencia', 'Prazos de recurso', 'o prazo de recurso é de 30 dias');
    await ingest(t, 'modelos', 'Minuta de penhora', 'modelo de requerimento de penhora');

    const res = await search(t, { query: 'xptounico' });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(KnowledgeSearchResponse.safeParse(body), JSON.stringify(body)).toMatchObject({ success: true });
    const hits = (body as { hits: Array<{ docId: string; collection: string; title?: string; snippet?: string; score?: number; scope: string }> }).hits;
    expect(hits.map((h) => h.docId)).toEqual([penhora]);
    expect(hits[0]?.collection).toBe('jurisprudencia');
    expect(hits[0]?.title).toBe('Penhora de bens');
    expect(hits[0]?.snippet).toContain('XPTOUNICO');
    expect(typeof hits[0]?.score).toBe('number');
    expect(hits[0]?.scope).toBe('org');
    // A hit NEVER carries the org id it came from — `scope` is the only partition signal.
    expect(JSON.stringify(body)).not.toContain('orgA');

    // Accent folding both ways (unicode61 remove_diacritics 2).
    const folded = await search(t, { query: 'jurisprudencia moveis' });
    expect(folded.status).toBe(200);
    expect(KnowledgeSearchResponse.safeParse(await folded.clone().json()).success).toBe(true);
    expect((await hitsOf(folded)).map((h) => h.docId)).toContain(penhora);
  });

  it('collection narrows, limit caps, an untokenizable query is an empty result (not an error)', async () => {
    await mkUser('u1', 'orgA', 'user');
    const t = await tokenFor('u1');
    await ingest(t, 'jurisprudencia', 'Penhora A', 'penhora de bens imóveis');
    await ingest(t, 'modelos', 'Penhora B', 'minuta de penhora de bens');

    const all = await hitsOf(await search(t, { query: 'penhora' }));
    expect(all.map((h) => h.collection).sort()).toEqual(['jurisprudencia', 'modelos']);

    const narrowed = await search(t, { query: 'penhora', collection: 'modelos' });
    expect(narrowed.status).toBe(200);
    expect(KnowledgeSearchResponse.safeParse(await narrowed.clone().json()).success).toBe(true);
    expect((await hitsOf(narrowed)).map((h) => h.collection)).toEqual(['modelos']);

    const capped = await search(t, { query: 'penhora', limit: 1 });
    expect((await hitsOf(capped))).toHaveLength(1);

    // A collection that exists for nobody is simply empty — never another org's rows.
    expect(await hitsOf(await search(t, { query: 'penhora', collection: 'inexistente' }))).toEqual([]);

    // Punctuation-only / stopword-only: nothing tokenizable survives, so it is an empty result
    // rather than an FTS5 syntax error (the quoting means '*'/NEAR cannot inject an operator).
    for (const query of ['---', '*', '"NEAR(a b)"', 'de a o']) {
      const res = await search(t, { query });
      expect(res.status, query).toBe(200);
      const body: unknown = await res.json();
      expect(KnowledgeSearchResponse.safeParse(body).success).toBe(true);
      expect((body as { hits: unknown[] }).hits).toEqual([]);
    }
  });

  it('refusals are 400 envelopes and leave a `denied` audit row', async () => {
    await mkUser('u1', 'orgA', 'user');
    const t = await tokenFor('u1');
    for (const body of [{}, { query: '' }, { query: 'ok', limit: 0 }, { query: 'ok', limit: 51 },
      { query: 'a'.repeat(1001) }, { query: 'ok', collection: '../fora' }, { query: 'ok', collection: '..' }]) {
      const res = await search(t, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    }
    const rows = await activityLogs.find({ category: 'knowledge' } as never);
    const metas = rows.map((r) => (r as unknown as { type: string; metadata: { op: string; verdict: string; attempt?: string } }));
    expect(metas).toHaveLength(7);
    for (const m of metas) {
      expect(m.type).toBe('knowledge_search');
      expect(m.metadata.verdict).toBe('denied');
    }
    // The audit carries the segment the caller was aiming at — recorded, never resolved.
    expect(metas.map((m) => m.metadata.attempt).filter(Boolean).sort()).toEqual(['..', '../fora']);
  });
});

describe('E5 read one document (GET /api/v1/knowledge/documents/:collection/:docId)', () => {
  it('round trip: the body validates KnowledgeDocumentResponse and carries the markdown verbatim', async () => {
    await mkUser('u1', 'orgA', 'user');
    const t = await tokenFor('u1');
    const text = '# Prazos\n\no prazo de recurso é de 30 dias\n';
    const id = await ingest(t, 'jurisprudencia', 'Prazos de recurso', text);

    const res = await api(`/api/v1/knowledge/documents/jurisprudencia/${id}`, t);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(KnowledgeDocumentResponse.safeParse(body), JSON.stringify(body)).toMatchObject({ success: true });
    const doc = body as { id: string; collection: string; title: string; contentMd: string; scope: string; createdAt?: string };
    expect(doc.id).toBe(id);
    expect(doc.collection).toBe('jurisprudencia');
    expect(doc.title).toBe('Prazos de recurso');
    expect(doc.contentMd).toBe(text);
    expect(doc.scope).toBe('org');
    expect(doc.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    // The document a search surfaced is exactly the document this route opens.
    const hit = (await hitsOf(await search(t, { query: 'recurso' })))[0]!;
    expect(hit.docId).toBe(id);
    expect(hit.collection).toBe(doc.collection);
  });

  it('missing document / missing collection are the uniform 404 envelope; bad segments are 400', async () => {
    await mkUser('u1', 'orgA', 'user');
    const t = await tokenFor('u1');
    const id = await ingest(t, 'jurisprudencia', 'Existe', 'conteúdo existente');

    const missingDoc = await api('/api/v1/knowledge/documents/jurisprudencia/nao-existe', t);
    const missingColl = await api(`/api/v1/knowledge/documents/inexistente/${id}`, t);
    expect(missingDoc.status).toBe(404);
    expect(missingColl.status).toBe(404);
    const text404 = await missingDoc.text();
    expect(await missingColl.text()).toBe(text404); // byte-identical — no existence oracle
    expect(ErrorEnvelope.safeParse(JSON.parse(text404)).success).toBe(true);

    /**
     * Contract-invalid segments die one layer before the vault, as 400 envelopes. These go over a
     * RAW http request, not fetch: the WHATWG URL parser resolves `%2e%2e` as a double-dot path
     * segment client-side, so a dot-segment probe sent through fetch never reaches the server as
     * one. The raw path is what a hostile client actually puts on the wire.
     */
    for (const [collection, docId] of [['%2e%2e', 'x'], ['c', '%2e%2e'], ['c', '%2e'], ['c', 'com%20espaco'],
      ['c', 'a'.repeat(101)], ['c%00', 'x'], ['c', 'chave%2Fbarra'], ['c', 'a%5Cb']]) {
      const res = await rawGet(`/api/v1/knowledge/documents/${collection}/${docId}`, t);
      expect(res.status, `${collection}/${docId}`).toBe(400);
      expect(ErrorEnvelope.safeParse(JSON.parse(res.body)).success).toBe(true);
      // Nothing of the attempted path is echoed back except zod's own issue report on the value.
      expect(res.body).not.toContain('EKOA_DATA_DIR');
      expect(res.body).not.toContain(dir);
    }
  });

  it('each call leaves ONE knowledge activity row with op, verdict and duration', async () => {
    await mkUser('u1', 'orgA', 'user');
    const t = await tokenFor('u1');
    const id = await ingest(t, 'c', 'Auditada', 'documento auditado');
    await activityLogs.deleteMany({});

    expect((await search(t, { query: 'auditado' })).status).toBe(200);
    expect((await api(`/api/v1/knowledge/documents/c/${id}`, t)).status).toBe(200);
    expect((await api('/api/v1/knowledge/documents/c/nao-existe', t)).status).toBe(404);

    const rows = await activityLogs.find({ category: 'knowledge' } as never);
    const metas = rows.map((r) => (r as unknown as { type: string; userId: string; orgId: string; metadata: Record<string, unknown> }));
    expect(metas).toHaveLength(3);
    expect(metas.map((m) => `${m.metadata.op}:${m.metadata.verdict}`).sort()).toEqual(['read:not_found', 'read:ok', 'search:ok']);
    for (const m of metas) {
      expect(m.userId).toBe('u1');
      expect(m.orgId).toBe('orgA');
      expect(typeof m.metadata.ms).toBe('number');
      expect(m.metadata.keyId).toBeUndefined(); // JWT admission: no key principal
    }
    // The query TEXT is never persisted — the row records the shape of the call, not its content.
    expect(JSON.stringify(metas)).not.toContain('auditado');
    expect(metas.find((m) => m.metadata.op === 'search')?.metadata.hits).toBe(1);
  });
});

describe('E5 the reserved `_shared` corpus over REST', () => {
  it('every org searches and reads it, marked `shared`, and cannot delete from it', async () => {
    await mkUser('a', 'orgA', 'user');
    await mkUser('b', 'orgB', 'user');
    const ta = await tokenFor('a'); const tb = await tokenFor('b');
    await ingest(ta, 'propria', 'Nota da orgA', 'documento privado da orgA');
    await plantSharedDoc('legal', 'cc-artigo-483', 'Artigo 483.º do Código Civil', 'responsabilidade civil PARTILHADOUNICO');

    for (const t of [ta, tb]) {
      const hits = await hitsOf(await search(t, { query: 'partilhadounico' }));
      expect(hits.map((h) => h.docId)).toEqual(['cc-artigo-483']);
      expect(hits[0]?.scope).toBe('shared');

      const read = await api('/api/v1/knowledge/documents/legal/cc-artigo-483', t);
      expect(read.status).toBe(200);
      const doc: unknown = await read.json();
      expect(KnowledgeDocumentResponse.safeParse(doc), JSON.stringify(doc)).toMatchObject({ success: true });
      expect((doc as { scope: string }).scope).toBe('shared');
      expect((doc as { contentMd: string }).contentMd).toContain('PARTILHADOUNICO');

      // Read-only: the delete route only ever addresses the caller's OWN partition, so this is
      // the uniform 404 and the corpus survives.
      const del = await api('/api/v1/knowledge/collections/legal/documents/cc-artigo-483', t, { method: 'DELETE' });
      expect(del.status).toBe(404);
      expect(ErrorEnvelope.safeParse(await del.json()).success).toBe(true);
    }
    expect((await api('/api/v1/knowledge/documents/legal/cc-artigo-483', ta)).status).toBe(200); // still there

    // orgB still sees NOTHING of orgA's own partition through either capability.
    expect(await hitsOf(await search(tb, { query: 'privado orgA' }))).toEqual([]);
    // ...while the shared corpus never appears in a vault listing (it is not an org's own vault).
    const collections = (await (await api('/api/v1/knowledge/collections', tb)).json()) as { items: string[] };
    expect(CollectionsResponse.safeParse(collections).success).toBe(true);
    expect(collections.items).toEqual([]);
  });
});

describe('E5 gateway-key admission (the second half of `user-or-key`)', () => {
  it('a REAL minted key browses/searches/reads its OWNER\'s org, schema-valid, audited with keyId + xClient', async () => {
    await mkUser('u1', 'orgA', 'user');
    const t = await tokenFor('u1');
    const minted = await mintKeyFor(t);
    expect(minted.key.startsWith('ekoa_gk_')).toBe(true);
    const id = await ingest(t, 'jurisprudencia', 'Via chave', 'documento alcançável por chave, CHAVEUNICA');
    await activityLogs.deleteMany({});

    const keyed = (p: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${minted.key}`, 'x-client': 'claude-code', ...(init.headers ?? {}) } });

    const collections = await keyed('/api/v1/knowledge/collections');
    expect(collections.status).toBe(200);
    const cbody: unknown = await collections.json();
    expect(CollectionsResponse.safeParse(cbody).success).toBe(true);
    expect((cbody as { items: string[] }).items).toEqual(['jurisprudencia']);

    const docs = await keyed('/api/v1/knowledge/documents');
    expect(docs.status).toBe(200);
    const dbody: unknown = await docs.json();
    expect(DocumentsResponse.safeParse(dbody).success).toBe(true);
    expect((dbody as { total: number }).total).toBe(1);

    const found = await keyed('/api/v1/knowledge/search', { method: 'POST', body: JSON.stringify({ query: 'chaveunica' }) });
    expect(found.status).toBe(200);
    const sbody: unknown = await found.json();
    expect(KnowledgeSearchResponse.safeParse(sbody).success).toBe(true);
    expect((sbody as { hits: Array<{ docId: string }> }).hits.map((h) => h.docId)).toEqual([id]);

    const read = await keyed(`/api/v1/knowledge/documents/jurisprudencia/${id}`);
    expect(read.status).toBe(200);
    const rbody: unknown = await read.json();
    expect(KnowledgeDocumentResponse.safeParse(rbody).success).toBe(true);
    expect((rbody as { contentMd: string }).contentMd).toContain('CHAVEUNICA');

    // The audited calls (search + read) name the key and the trace-only client tag.
    const rows = await activityLogs.find({ category: 'knowledge' } as never);
    const metas = rows.map((r) => (r as unknown as { userId: string; orgId: string; metadata: Record<string, unknown> }));
    expect(metas).toHaveLength(2);
    for (const m of metas) {
      expect(m.metadata.keyId).toBe(minted.id);
      expect(m.metadata.xClient).toBe('claude-code');
      expect(m.metadata.verdict).toBe('ok');
      expect(m.userId).toBe('u1');
      expect(m.orgId).toBe('orgA');
    }
  });

  it('a key is refused on every WRITE/admin route — this slice opens no ingestion surface', async () => {
    await mkUser('adm', 'orgA', 'org-admin');
    const t = await tokenFor('adm');
    const minted = await mintKeyFor(t, 'write-attempt');
    const keyed = (p: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${minted.key}`, ...(init.headers ?? {}) } });

    for (const [path, init] of [
      ['/api/v1/knowledge/documents', { method: 'POST', body: JSON.stringify({ collection: 'c', title: 'T', text: 'x' }) }],
      ['/api/v1/knowledge/collections/c/documents/x', { method: 'DELETE' }],
      ['/api/v1/knowledge/sources', { method: 'GET' }],
      ['/api/v1/knowledge/sources', { method: 'POST', body: JSON.stringify({ url: 'https://exemplo.pt' }) }],
      ['/api/v1/knowledge/uploads', { method: 'GET' }],
      // content-type text/markdown on purpose: the global JSON parser would otherwise reject the
      // body BEFORE the router and answer 400, hiding the admission refusal this probe is about.
      ['/api/v1/knowledge/uploads', { method: 'POST', headers: { 'content-type': 'text/markdown', 'x-filename': 'a.md' }, body: 'x' }],
      ['/api/v1/knowledge/reindex', { method: 'POST' }],
      ['/api/v1/knowledge/index-status', { method: 'GET' }],
    ] as Array<[string, RequestInit]>) {
      const res = await keyed(path, init);
      expect(res.status, `${init.method} ${path}`).toBe(401);
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    }
    // ...and nothing was created by the attempts.
    expect((await (await api('/api/v1/knowledge/documents', t)).json() as { total: number }).total).toBe(0);
  });

  it('unauthenticated and unknown-key calls on both new endpoints are 401 envelopes', async () => {
    for (const [path, init] of [
      ['/api/v1/knowledge/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"x"}' }],
      ['/api/v1/knowledge/documents/c/x', {}],
    ] as Array<[string, RequestInit]>) {
      const anon = await fetch(`http://127.0.0.1:${port}${path}`, init);
      expect(anon.status, path).toBe(401);
      expect(ErrorEnvelope.safeParse(await anon.json()).success).toBe(true);

      const bad = await fetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: 'Bearer ekoa_gk_definitely-not-a-key' },
      });
      expect(bad.status, path).toBe(401);
      expect(ErrorEnvelope.safeParse(await bad.json()).success).toBe(true);
    }
  });
});
