import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { request as httpRequest, type Server } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { ErrorEnvelope, KnowledgeSearchResponse, KnowledgeDocumentResponse } from '@ekoa/shared';

/**
 * knowledge SCOPING suite (slice E5). The knowledge vault was org-partitioned long before this
 * slice; E5 puts SEARCH and READ on the public REST surface under a `user-or-key` admission, so
 * the partition is now reachable by a credential that lives outside the browser. This suite
 * attacks that reach directly, through the real app:
 *
 *   (a) two orgs are blind to each other through BOTH new capabilities — a search never returns
 *       another org's row and a read of a known-good (collection, docId) answers the uniform 404;
 *   (b) the reserved `_shared` corpus is readable by every org, writable by none, and can never be
 *       PRESENTED as an actor org (a caller claiming it is refused on every endpoint it can reach,
 *       read included — the E5 tightening of assertNotSharedActor);
 *   (c) NO request field selects the partition: `orgId` in the body, in the query string and in a
 *       header (three spellings) changes nothing — the answer is byte-identical to the request
 *       without it, on both new endpoints;
 *   (d) unauthenticated, unknown-key and REVOKED-key calls are refused;
 *   (e) a gateway key resolves to its owner's org EXACTLY as that user's JWT does — same bytes —
 *       and a key never reaches another org, nor the write half of the domain;
 *   plus two structural gates: every content-bearing FTS query filters on orgId, and no knowledge
 *   source file ever reads an org from a request.
 */
const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/api/tests/security

let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
let dir: string;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const MISSING_404 = JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Não encontrado.' } });
// E5 review F6: the message names the actual invariant (WHO is calling), so it reads correctly on
// a refused READ as well as on a refused write — "é só de leitura" did not.
const SHARED_403 = JSON.stringify({ error: { code: 'FORBIDDEN', message: 'A coleção partilhada não pode ser a organização do pedido.' } });

const api = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user' = 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

const ingest = async (t: string, collection: string, title: string, text: string): Promise<string> => {
  const res = await api('/api/v1/knowledge/documents', t, { method: 'POST', body: JSON.stringify({ collection, title, text }) });
  expect(res.status, `ingest ${title}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
};
const search = (t: string, body: Record<string, unknown>) =>
  api('/api/v1/knowledge/search', t, { method: 'POST', body: JSON.stringify(body) });
const hitsOf = async (res: Response) =>
  ((await res.json()) as { hits: Array<{ collection: string; docId: string; title?: string; scope: string }> }).hits;

/** A raw GET whose path reaches the server byte-for-byte (fetch's URL parser normalises
 *  dot-segments client-side, so a traversal probe sent through it never arrives as one). */
const rawGet = (path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> =>
  new Promise((resolveP, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolveP({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.end();
  });

/** Plant a document in the reserved `_shared` partition the only way it is ever written: a vault
 *  file placed offline plus an index backfill. There is no online write path to this corpus. */
const plantSharedDoc = async (collection: string, docId: string, title: string, body: string): Promise<string> => {
  const destDir = join(dir, 'knowledge', 'vault', SHARED_ORG_ID, collection);
  await mkdir(destDir, { recursive: true });
  const path = join(destDir, `${docId}.md`);
  await writeFile(path, serializeDoc({ title, createdAt: new Date(1_700_000_000_000).toISOString() }, body), 'utf8');
  await backfillKnowledgeIndex({ force: true });
  return path;
};

const mintKeyFor = async (t: string, label = 'scoping'): Promise<{ id: string; key: string }> => {
  const res = await api('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label }) });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; key: string };
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_knowledge_scoping');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  server.close();
  closeIndex(); // release the sqlite handle before the data dir goes away
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  __resetCapabilityRateForTests();
  closeIndex();
  dir = await mkdtemp(join(tmpdir(), 'ekoa-knowledge-scoping-'));
  process.env.EKOA_DATA_DIR = dir;
  for (const s of [users, orgs, knowledgeUploads, gatewayKeys, activityLogs]) await s.deleteMany({});
  await mkUser('usrA', 'orgA');
  await mkUser('usrB', 'orgB');
});

describe('knowledge scoping (slice E5)', () => {
  // -------------------------------------------------------------------------------------------
  // (a) Two orgs, blind to each other through BOTH new capabilities.
  // -------------------------------------------------------------------------------------------

  it('cross-org: B never sees A\'s documents through SEARCH, under a JWT or a real key', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    const keyB = await mintKeyFor(tB);
    // Deliberately overlapping vocabulary, one unique token each.
    await ingest(tA, 'processos', 'Processo A', 'cláusula de confidencialidade, token AAAUNICOA');
    await ingest(tA, 'processos', 'Segundo A', 'mais uma cláusula do mesmo processo');
    const bDoc = await ingest(tB, 'processos', 'Processo B', 'cláusula de confidencialidade, token BBBUNICOB');

    // The shared term hits only the caller's own rows.
    const commonA = await hitsOf(await search(tA, { query: 'clausula confidencialidade' }));
    expect(commonA.map((h) => h.title).sort()).toEqual(['Processo A', 'Segundo A']);
    const commonB = await hitsOf(await search(tB, { query: 'clausula confidencialidade' }));
    expect(commonB.map((h) => h.title)).toEqual(['Processo B']);
    expect(commonB.every((h) => h.scope === 'org')).toBe(true);

    // The other org's unique token is invisible, in both directions and under both admissions.
    expect(await hitsOf(await search(tA, { query: 'bbbunicob' }))).toEqual([]);
    expect(await hitsOf(await search(tB, { query: 'aaaunicoa' }))).toEqual([]);
    const asKeyB = await fetch(`http://127.0.0.1:${port}/api/v1/knowledge/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${keyB.key}` },
      body: JSON.stringify({ query: 'aaaunicoa' }),
    });
    expect(asKeyB.status).toBe(200);
    expect(await hitsOf(asKeyB)).toEqual([]);
    // Sanity (non-tautology): the terms ARE findable by their own owner.
    expect((await hitsOf(await search(tB, { query: 'bbbunicob' }))).map((h) => h.docId)).toEqual([bDoc]);
  });

  it('cross-org: B cannot READ A\'s document even holding its exact (collection, docId)', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    const keyB = await mintKeyFor(tB);
    const aDoc = await ingest(tA, 'processos', 'Só do A', 'SEGREDO_DE_A');

    for (const attempt of [
      () => api(`/api/v1/knowledge/documents/processos/${aDoc}`, tB),
      () => fetch(`http://127.0.0.1:${port}/api/v1/knowledge/documents/processos/${aDoc}`, { headers: { authorization: `Bearer ${keyB.key}` } }),
    ]) {
      const res = await attempt();
      expect(res.status).toBe(404);
      const body = await res.text();
      // Byte-identical to a plain miss — no cross-org existence oracle, and not one byte of A's.
      expect(body).toBe(MISSING_404);
      expect(body).not.toContain('SEGREDO_DE_A');
    }
    // A missing id under B's OWN org answers the same bytes (that is what "uniform" means here).
    expect(await (await api('/api/v1/knowledge/documents/processos/nunca-existiu', tB)).text()).toBe(MISSING_404);
    // A still reads its own document — the probes changed nothing.
    const mine = await api(`/api/v1/knowledge/documents/processos/${aDoc}`, tA);
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as { contentMd: string }).contentMd).toBe('SEGREDO_DE_A');
  });

  it('cross-org: the two flipped BROWSE endpoints stay blind as well', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    const keyB = await mintKeyFor(tB);
    await ingest(tA, 'processos', 'Só do A', 'conteúdo do A');

    const keyed = (p: string) => fetch(`http://127.0.0.1:${port}${p}`, { headers: { authorization: `Bearer ${keyB.key}` } });
    for (const res of [await api('/api/v1/knowledge/collections', tB), await keyed('/api/v1/knowledge/collections')]) {
      expect(res.status).toBe(200);
      expect(((await res.json()) as { items: string[] }).items).toEqual([]);
    }
    for (const res of [await api('/api/v1/knowledge/documents', tB), await keyed('/api/v1/knowledge/documents')]) {
      expect(res.status).toBe(200);
      expect(((await res.json()) as { total: number; items: unknown[] })).toMatchObject({ total: 0, items: [] });
    }
  });

  // -------------------------------------------------------------------------------------------
  // (b) The reserved `_shared` corpus: readable by all, writable by none, never an actor org.
  // -------------------------------------------------------------------------------------------

  it('`_shared` is READABLE by every org and WRITABLE by none', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    const sharedPath = await plantSharedDoc('legal', 'cc-483', 'Artigo 483.º', 'responsabilidade civil PARTILHADOUNICO');
    const before = readFileSync(sharedPath, 'utf8');

    for (const t of [tA, tB]) {
      expect((await hitsOf(await search(t, { query: 'partilhadounico' }))).map((h) => h.scope)).toEqual(['shared']);
      const read = await api('/api/v1/knowledge/documents/legal/cc-483', t);
      expect(read.status).toBe(200);
      expect(KnowledgeDocumentResponse.safeParse(await read.clone().json()).success).toBe(true);
      expect(((await read.json()) as { scope: string }).scope).toBe('shared');
      // Every write shape an org actor can express, aimed at the same collection/docId.
      const del = await api('/api/v1/knowledge/collections/legal/documents/cc-483', t, { method: 'DELETE' });
      expect(del.status).toBe(404);
      expect(await del.text()).toBe(MISSING_404);
      const overwrite = await api('/api/v1/knowledge/documents', t, { method: 'POST', body: JSON.stringify({ collection: 'legal', title: 'Artigo 483.º', text: 'VENENO' }) });
      expect(overwrite.status).toBe(201); // it lands in the caller's OWN partition, by construction
    }
    // The shared file on disk is byte-identical, and the partition gained no new file.
    expect(readFileSync(sharedPath, 'utf8')).toBe(before);
    expect(readdirSync(join(dir, 'knowledge', 'vault', SHARED_ORG_ID, 'legal'))).toEqual(['cc-483.md']);
    // The poisoned text is searchable ONLY in the org that wrote it, and never as `shared`.
    expect((await hitsOf(await search(tA, { query: 'veneno' }))).every((h) => h.scope === 'org')).toBe(true);
    expect(await hitsOf(await search(tB, { query: 'veneno' }))).toHaveLength(1);
    // A's own doc SHADOWS the shared one on a colliding (collection, docId)? It cannot collide:
    // ids are server-minted, so the shared doc still answers under its own id for both orgs.
    expect(((await (await api('/api/v1/knowledge/documents/legal/cc-483', tA)).json()) as { scope: string }).scope).toBe('shared');
  });

  it('an actor PRESENTING `_shared` as its org is refused on every knowledge endpoint it can reach', async () => {
    await mkUser('usrS', SHARED_ORG_ID);
    const tS = await tokenFor('usrS');
    await plantSharedDoc('legal', 'cc-483', 'Artigo 483.º', 'responsabilidade civil PARTILHADOUNICO');

    // Reads (E5 tightening) AND writes (pre-existing) — one uniform 403, never a partial read.
    for (const [path, init] of [
      ['/api/v1/knowledge/search', { method: 'POST', body: JSON.stringify({ query: 'partilhadounico' }) }],
      ['/api/v1/knowledge/documents/legal/cc-483', {}],
      ['/api/v1/knowledge/collections', {}],
      ['/api/v1/knowledge/documents', {}],
      ['/api/v1/knowledge/documents', { method: 'POST', body: JSON.stringify({ collection: 'legal', title: 'T', text: 'x' }) }],
      ['/api/v1/knowledge/collections/legal/documents/cc-483', { method: 'DELETE' }],
    ] as Array<[string, RequestInit]>) {
      const res = await api(path, tS, init);
      expect(res.status, `${init.method ?? 'GET'} ${path}`).toBe(403);
      const body = await res.text();
      expect(body, path).toBe(SHARED_403);
      expect(body).not.toContain('PARTILHADOUNICO'); // no content rides along on the refusal
    }
    // The corpus is intact and still readable by a NORMAL org — the guard refuses the claimant,
    // it does not take the corpus away.
    const tA = await tokenFor('usrA');
    expect((await api('/api/v1/knowledge/documents/legal/cc-483', tA)).status).toBe(200);
  });

  it('the shared org id is structurally unreachable by a real org (no UUID can collide)', () => {
    expect(SHARED_ORG_ID).toBe('_shared');
    // randomUUID emits lowercase hex + dashes: a leading '_' is not in that alphabet.
    for (let i = 0; i < 50; i++) expect(/^[0-9a-f-]+$/.test(randomUUIDish())).toBe(true);
    expect(SHARED_ORG_ID.startsWith('_')).toBe(true);
  });

  // -------------------------------------------------------------------------------------------
  // (c) No request field selects the partition.
  // -------------------------------------------------------------------------------------------

  it('orgId in the BODY, the QUERY or a HEADER changes nothing on either new endpoint', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    const aDoc = await ingest(tA, 'processos', 'Só do A', 'SEGREDO_DE_A com token AAAUNICOA');
    await ingest(tB, 'processos', 'Só do B', 'conteúdo do B com token BBBUNICOB');

    // The honest baselines: what B legitimately sees.
    const baselineSearch = await (await search(tB, { query: 'aaaunicoa' })).text();
    const baselineRead = await (await api(`/api/v1/knowledge/documents/processos/${aDoc}`, tB)).text();
    expect(baselineSearch).toBe(JSON.stringify({ hits: [] }));
    expect(baselineRead).toBe(MISSING_404);

    const injections: Array<Record<string, string>> = [
      { orgId: 'orgA' }, { org: 'orgA' }, { orgid: 'orgA' }, { tenant: 'orgA' }, { tenantId: 'orgA' },
      { userId: 'usrA' }, { scope: 'org' }, { orgId: SHARED_ORG_ID },
    ];

    // 1. BODY fields on POST /search.
    for (const extra of injections) {
      const res = await search(tB, { query: 'aaaunicoa', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(200);
      expect(await res.text(), JSON.stringify(extra)).toBe(baselineSearch);
    }
    // 2. QUERY-STRING params on both endpoints.
    for (const extra of injections) {
      const qs = new URLSearchParams(extra).toString();
      const s = await api(`/api/v1/knowledge/search?${qs}`, tB, { method: 'POST', body: JSON.stringify({ query: 'aaaunicoa' }) });
      expect(s.status, qs).toBe(200);
      expect(await s.text(), qs).toBe(baselineSearch);
      const r = await api(`/api/v1/knowledge/documents/processos/${aDoc}?${qs}`, tB);
      expect(r.status, qs).toBe(404);
      expect(await r.text(), qs).toBe(baselineRead);
    }
    // 3. HEADERS, including the shapes a proxy or a mis-built client might set.
    for (const name of ['x-org-id', 'x-orgid', 'x-org', 'x-tenant-id', 'x-ekoa-org', 'orgid', 'x-user-id']) {
      for (const value of ['orgA', 'usrA', SHARED_ORG_ID]) {
        const s = await search(tB, { query: 'aaaunicoa' });
        expect(await s.text()).toBe(baselineSearch); // control, same loop
        const injected = await api('/api/v1/knowledge/search', tB, { method: 'POST', headers: { [name]: value }, body: JSON.stringify({ query: 'aaaunicoa' }) });
        expect(injected.status, `${name}: ${value}`).toBe(200);
        expect(await injected.text(), `${name}: ${value}`).toBe(baselineSearch);
        const r = await api(`/api/v1/knowledge/documents/processos/${aDoc}`, tB, { headers: { [name]: value } });
        expect(r.status, `${name}: ${value}`).toBe(404);
        expect(await r.text(), `${name}: ${value}`).toBe(baselineRead);
      }
    }
    // 4. And the same injections do not let B into the SHARED partition's write side either:
    //    B's own view is unchanged throughout.
    expect((await hitsOf(await search(tB, { query: 'bbbunicob' }))).map((h) => h.title)).toEqual(['Só do B']);
  });

  it('a `collection` argument cannot escape the partition (it is one path segment, jailed twice)', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    await ingest(tA, 'processos', 'Só do A', 'SEGREDO_DE_A token AAAUNICOA');

    // Contract-level refusal on search…
    for (const collection of ['../orgA/processos', '..', '.', 'a/b', '/etc', 'a\u0000b', 'x'.repeat(101)]) {
      const res = await search(tB, { query: 'aaaunicoa', collection });
      expect(res.status, collection).toBe(400);
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    }
    // …and on read, over a RAW path so the dot-segments actually reach the server.
    for (const path of [
      `/api/v1/knowledge/documents/%2e%2e%2forgA%2fprocessos/x`,
      `/api/v1/knowledge/documents/%2e%2e/x`,
      `/api/v1/knowledge/documents/processos/%2e%2e%2f%2e%2e%2forgA%2fprocessos%2fdoc`,
      `/api/v1/knowledge/documents/%2fetc/passwd`,
    ]) {
      const res = await rawGet(path, { authorization: `Bearer ${tB}` });
      expect(res.status, path).toBe(400);
      expect(ErrorEnvelope.safeParse(JSON.parse(res.body)).success).toBe(true);
      expect(res.body).not.toContain('SEGREDO_DE_A');
      expect(res.body).not.toContain(dir); // no absolute server path on the wire
    }
    // Nothing was created outside A's partition by any of it.
    expect(readdirSync(join(dir, 'knowledge', 'vault')).sort()).toEqual(['orgA']);
  });

  // -------------------------------------------------------------------------------------------
  // (d) Admission: unauthenticated, unknown key, revoked key.
  // -------------------------------------------------------------------------------------------

  it('admission: unauthenticated, unknown-key and REVOKED-key calls are refused with envelopes', async () => {
    const tB = await tokenFor('usrB');
    const keyB = await mintKeyFor(tB);
    const paths: Array<[string, RequestInit]> = [
      ['/api/v1/knowledge/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"x"}' }],
      ['/api/v1/knowledge/documents/processos/qualquer', {}],
      ['/api/v1/knowledge/collections', {}],
      ['/api/v1/knowledge/documents', {}],
    ];

    for (const [p, init] of paths) {
      const anon = await fetch(`http://127.0.0.1:${port}${p}`, init);
      expect(anon.status, `anon ${p}`).toBe(401);
      expect(ErrorEnvelope.safeParse(await anon.json()).success).toBe(true);

      const unknown = await fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { ...(init.headers ?? {}), authorization: 'Bearer ekoa_gk_nao-existe' } });
      expect(unknown.status, `unknown ${p}`).toBe(401);
      expect(ErrorEnvelope.safeParse(await unknown.json()).success).toBe(true);
    }

    // The key works, is revoked, and then does not.
    const live = await fetch(`http://127.0.0.1:${port}/api/v1/knowledge/collections`, { headers: { authorization: `Bearer ${keyB.key}` } });
    expect(live.status).toBe(200);
    expect((await api(`/api/v1/gateway-keys/${keyB.id}/revoke`, tB, { method: 'POST' })).status).toBe(200);
    for (const [p, init] of paths) {
      const revoked = await fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${keyB.key}` } });
      expect(revoked.status, `revoked ${p}`).toBe(401);
      const body: unknown = await revoked.json();
      expect(ErrorEnvelope.safeParse(body).success).toBe(true);
      // One uniform message: a revoked key must not be distinguishable from an unknown one.
      expect((body as { error: { message: string } }).error.message).toBe('Chave de API inválida.');
    }
  });

  it('a key whose OWNER is deactivated stops resolving to that owner\'s org', async () => {
    const tB = await tokenFor('usrB');
    const keyB = await mintKeyFor(tB);
    await ingest(tB, 'processos', 'Do B', 'conteúdo do B');
    const keyed = (p: string) => fetch(`http://127.0.0.1:${port}${p}`, { headers: { authorization: `Bearer ${keyB.key}` } });
    expect((await keyed('/api/v1/knowledge/collections')).status).toBe(200);

    await users.update('usrB', (cur) => ({ ...cur, active: false } as never));
    const after = await keyed('/api/v1/knowledge/collections');
    expect(after.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await after.json()).success).toBe(true);
  });

  // -------------------------------------------------------------------------------------------
  // (e) A key resolves to its owner's org exactly like that user's JWT.
  // -------------------------------------------------------------------------------------------

  it('key and JWT of the SAME user answer byte-identically on both new endpoints', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    const keyA = await mintKeyFor(tA, 'parity');
    const aDoc = await ingest(tA, 'processos', 'Do A', 'conteúdo do A com token AAAUNICOA');
    await ingest(tB, 'processos', 'Do B', 'conteúdo do B com token BBBUNICOB');
    await plantSharedDoc('legal', 'cc-483', 'Artigo 483.º', 'responsabilidade civil PARTILHADOUNICO');

    const keyed = (p: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${keyA.key}`, ...(init.headers ?? {}) } });

    for (const [p, init] of [
      ['/api/v1/knowledge/collections', {}],
      ['/api/v1/knowledge/documents', {}],
      [`/api/v1/knowledge/documents/processos/${aDoc}`, {}],
      ['/api/v1/knowledge/documents/legal/cc-483', {}],
      ['/api/v1/knowledge/search', { method: 'POST', body: JSON.stringify({ query: 'aaaunicoa' }) }],
      ['/api/v1/knowledge/search', { method: 'POST', body: JSON.stringify({ query: 'partilhadounico' }) }],
      ['/api/v1/knowledge/search', { method: 'POST', body: JSON.stringify({ query: 'bbbunicob' }) }],
    ] as Array<[string, RequestInit]>) {
      const viaJwt = await api(p, tA, init);
      const viaKey = await keyed(p, init);
      expect(viaKey.status, p).toBe(viaJwt.status);
      expect(await viaKey.text(), p).toBe(await viaJwt.text());
    }
    // Concretely: A's own token is found, the shared corpus is found, B's token is not.
    expect((await hitsOf(await keyed('/api/v1/knowledge/search', { method: 'POST', body: JSON.stringify({ query: 'aaaunicoa' }) }))).map((h) => h.scope)).toEqual(['org']);
    expect((await hitsOf(await keyed('/api/v1/knowledge/search', { method: 'POST', body: JSON.stringify({ query: 'partilhadounico' }) }))).map((h) => h.scope)).toEqual(['shared']);
    expect(await hitsOf(await keyed('/api/v1/knowledge/search', { method: 'POST', body: JSON.stringify({ query: 'bbbunicob' }) }))).toEqual([]);
  });

  it('every audited call carries the ORG the answer was scoped to, key-attributed or not', async () => {
    const tA = await tokenFor('usrA');
    const keyA = await mintKeyFor(tA, 'audit');
    const aDoc = await ingest(tA, 'processos', 'Do A', 'conteúdo do A');
    await activityLogs.deleteMany({});

    expect((await search(tA, { query: 'conteudo' })).status).toBe(200);
    const keyed = await fetch(`http://127.0.0.1:${port}/api/v1/knowledge/documents/processos/${aDoc}`, {
      headers: { authorization: `Bearer ${keyA.key}`, 'x-client': 'cortex-cli' },
    });
    expect(keyed.status).toBe(200);

    const rows = (await activityLogs.find({ category: 'knowledge' } as never))
      .map((r) => r as unknown as { userId: string; orgId: string; metadata: Record<string, unknown> });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.userId).toBe('usrA');
      expect(r.orgId).toBe('orgA'); // the org the call was scoped to, recorded per call
      expect(r.metadata.verdict).toBe('ok');
    }
    const keyRow = rows.find((r) => r.metadata.op === 'read');
    expect(keyRow?.metadata.keyId).toBe(keyA.id);
    expect(keyRow?.metadata.xClient).toBe('cortex-cli');
    expect(rows.find((r) => r.metadata.op === 'search')?.metadata.keyId).toBeUndefined();
  });

  // -------------------------------------------------------------------------------------------
  // Structural gates: the properties above must hold by construction, not by test luck.
  // -------------------------------------------------------------------------------------------

  it('grep gate: every CONTENT-bearing knowledge_fts query filters on orgId', () => {
    const src = readFileSync(resolve(HERE, '../../src/knowledge/index-store.ts'), 'utf8');
    // Statements that can return document CONTENT (title/body/snippet) must carry an orgId
    // predicate. The two org-agnostic statements that remain are counters/identity scans:
    // COUNT(*) for the backfill emptiness check and the doc-map heal, neither of which reads text.
    const selects = src.match(/SELECT[\s\S]*?FROM knowledge_fts[\s\S]*?(?=`)/g) ?? [];
    expect(selects.length).toBeGreaterThanOrEqual(3);
    for (const stmt of selects) {
      const returnsContent = /\btitle\b|\bbody\b|snippet\(/.test(stmt);
      if (!returnsContent) continue;
      expect(/orgId\s+IN\s*\(|orgId\s*=\s*\?/.test(stmt), `content query without an orgId predicate:\n${stmt}`).toBe(true);
    }
    // Non-tautology: the matcher DOES fire on a planted violation.
    expect(/orgId\s+IN\s*\(|orgId\s*=\s*\?/.test('SELECT title, body FROM knowledge_fts WHERE knowledge_fts MATCH ?')).toBe(false);
  });

  it('grep gate: no knowledge source file reads an org/tenant from a request', () => {
    const files = ['../../src/knowledge/service.ts', '../../src/knowledge/index-store.ts', '../../src/knowledge/vault.ts',
      '../../src/knowledge/paths.ts', '../../src/knowledge/grounding.ts', '../../src/routes/knowledge.ts'];
    // An org may only ever arrive from the verified principal: `actorOf(req)` / `req.user`, both
    // of which the auth middleware owns. Reading one out of a body, a query or a header is the
    // single mistake this whole suite exists to prevent, so it is banned at the source level.
    const banned = [
      /req\.(body|query|params)[^\n]*\borg/i,
      /req\.headers\[[^\]]*org/i,
      /header\(\s*['"][^'"]*org/i,
      /req\.(body|query|params)[^\n]*tenant/i,
    ];
    for (const rel of files) {
      const path = resolve(HERE, rel);
      expect(existsSync(path), rel).toBe(true);
      const content = readFileSync(path, 'utf8');
      for (const re of banned) {
        expect(re.test(content), `${rel} must not read an org from the request (${re})`).toBe(false);
      }
    }
    // Non-tautology: each matcher fires on its planted violation.
    expect(banned[0]!.test('const orgId = req.body.orgId;')).toBe(true);
    expect(banned[1]!.test("const o = req.headers['x-org-id'];")).toBe(true);
    expect(banned[2]!.test("const o = req.header('x-org-id');")).toBe(true);
    expect(banned[3]!.test('const t = req.query.tenantId;')).toBe(true);
  });
});

/** A stand-in for the id shape `randomUUID()` produces, used only to state the alphabet fact the
 *  `_shared` collision-proof rests on. Kept local: importing node:crypto for one assertion would
 *  suggest the test depends on randomness, which it does not. */
function randomUUIDish(): string {
  return '00000000-0000-4000-8000-000000000000'.replace(/0/g, () => '0123456789abcdef'[Math.floor(Math.random() * 16)] as string);
}
