import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings, gatewayKeys, activityLogs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { closeAllIndexes } from '../../src/memvault/fts.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  memvaultEndpoints,
  NOTE_PERMALINK_SEGMENT_MAX,
  WriteNoteResponse,
  NoteRecord,
  NoteListResponse,
  DeleteNoteResponse,
  NoteSearchResponse,
  ErrorEnvelope,
} from '@ekoa/shared';

/**
 * Fault injection for the E2-review F1(c) probe ONLY: the terminal error middleware is a NET
 * for a throw that escapes a handler, and once the service funnels every failure through its
 * own guard there is (by design) no natural way to reach it. `vi.hoisted` keeps the flag
 * addressable from the hoisted factory; the wrapper delegates verbatim while it is off, so
 * every other test in this file runs against the real service.
 */
const faults = vi.hoisted(() => ({ listThrows: false }));
vi.mock('../../src/memvault/service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memvault/service.js')>();
  return {
    ...actual,
    listNotes: (...args: Parameters<typeof actual.listNotes>) =>
      faults.listThrows
        ? Promise.reject(new Error('falha simulada em /home/segredo/absoluto/store.ts:123'))
        : actual.listNotes(...args),
  };
});

/**
 * memvault CONTRACT test (slices E2 + E3): the write/read/list/delete/search/export wire
 * shapes validate against the shared schemas through the REAL app, under BOTH admissions the
 * `user-or-key` class carries — a platform JWT and a REAL key minted through POST
 * /api/v1/gateway-keys. Every non-2xx body validates against the shared error envelope;
 * missing-note 404s are uniform; every call leaves one activity row; the on-disk file is
 * stock-basic-memory frontmatter; the export tar carries markdown and nothing else.
 */

/**
 * A minimal ustar READER (~20 lines), on purpose: parsing the export with the same library
 * that wrote it would only prove archiver round-trips itself. This decodes the raw 512-byte
 * headers, so the test asserts the bytes on the wire really are a tar and really contain
 * exactly the expected entries.
 */
function readTar(buf: Buffer): Array<{ name: string; content: string; mode: string; mtime: number }> {
  const out: Array<{ name: string; content: string; mode: string; mtime: number }> = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break; // end-of-archive marker
    const cstr = (start: number, len: number): string => {
      const raw = h.subarray(start, start + len);
      const end = raw.indexOf(0);
      return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
    };
    const octal = (start: number, len: number): number => parseInt(cstr(start, len).replace(/[^0-7]/g, '') || '0', 8);
    const prefix = cstr(345, 155);
    const base = cstr(0, 100);
    const size = octal(124, 12);
    const typeflag = String.fromCharCode(h[156] ?? 0);
    const content = buf.subarray(off + 512, off + 512 + size).toString('utf8');
    if (typeflag === '0' || typeflag === '\0') {
      out.push({ name: prefix ? `${prefix}/${base}` : base, content, mode: cstr(100, 8).trim(), mtime: octal(136, 12) });
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
let vaultRoot: string;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  vaultRoot = mkdtempSync(join(tmpdir(), 'ekoa-memvault-contract-'));
  process.env.EKOA_MEMVAULT_ROOT = vaultRoot;
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_memvault_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  server.close();
  closeAllIndexes(); // release the per-user sqlite handles before the vault root is removed
  await closeMongo();
  await mem.stop();
  rmSync(vaultRoot, { recursive: true, force: true });
  delete process.env.EKOA_MEMVAULT_ROOT;
});
beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  __resetCapabilityRateForTests();
  await users.deleteMany({});
  await userSettings.deleteMany({});
  await gatewayKeys.deleteMany({});
  await activityLogs.deleteMany({});
  rmSync(vaultRoot, { recursive: true, force: true });
  for (const id of ['usr'] as const) {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true } as never);
    setActivation(id, { active: true, billingLocked: false });
    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
  }
});

describe('memvault contract (slices E2 + E3)', () => {
  it('descriptors: all four ops are user-or-key on the /api/v1/memvault surface', () => {
    expect(memvaultEndpoints.writeNote.auth).toBe('user-or-key');
    expect(memvaultEndpoints.readNote.auth).toBe('user-or-key');
    expect(memvaultEndpoints.listNotes.auth).toBe('user-or-key');
    expect(memvaultEndpoints.deleteNote.auth).toBe('user-or-key');
    expect(memvaultEndpoints.writeNote.path).toBe('/api/v1/memvault/notes');
    expect(memvaultEndpoints.readNote.path).toBe('/api/v1/memvault/note');
  });

  it('JWT round trip: write (server-derived permalink) -> read -> list -> delete, all schema-valid', async () => {
    const t = await tokenFor('usr');
    const wrote = await authed('/api/v1/memvault/notes', t, {
      method: 'POST',
      body: JSON.stringify({ title: 'Reunião do Cliente!', folder: 'briefs', tags: ['cliente'], contentMd: '# Nota\ncorpo' }),
    });
    expect(wrote.status).toBe(200);
    const record: unknown = await wrote.json();
    expect(WriteNoteResponse.safeParse(record), JSON.stringify(record)).toMatchObject({ success: true });
    const rec = record as { permalink: string; folder?: string; type: string; created: string; modified: string };
    expect(rec.permalink).toBe('briefs/reuniao-do-cliente'); // diacritics stripped, lowercased, sluged
    expect(rec.folder).toBe('briefs');
    expect(rec.type).toBe('note');

    const read = await authed(`/api/v1/memvault/note?permalink=${encodeURIComponent(rec.permalink)}`, t);
    expect(read.status).toBe(200);
    const readBody: unknown = await read.json();
    expect(NoteRecord.safeParse(readBody), JSON.stringify(readBody)).toMatchObject({ success: true });
    expect((readBody as { contentMd: string }).contentMd).toBe('# Nota\ncorpo');
    expect((readBody as { title: string }).title).toBe('Reunião do Cliente!');

    const list = await authed('/api/v1/memvault/notes', t);
    expect(list.status).toBe(200);
    const listBody: unknown = await list.json();
    expect(NoteListResponse.safeParse(listBody), JSON.stringify(listBody)).toMatchObject({ success: true });
    const items = (listBody as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((i) => i.permalink)).toContain('briefs/reuniao-do-cliente');
    expect(items[0]).not.toHaveProperty('contentMd'); // list rows are metadata-only

    const del = await authed(`/api/v1/memvault/note?permalink=${encodeURIComponent(rec.permalink)}`, t, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(DeleteNoteResponse.safeParse(await del.json()).success).toBe(true);

    const gone = await authed(`/api/v1/memvault/note?permalink=${encodeURIComponent(rec.permalink)}`, t);
    expect(gone.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await gone.json()).success).toBe(true);
  });

  it('REAL minted gateway key round trip: every op admitted, schema-valid, and audit rows carry the keyId', async () => {
    const t = await tokenFor('usr');
    const mintRes = await authed('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label: 'memvault-e2' }) });
    expect(mintRes.status).toBe(201);
    const minted = (await mintRes.json()) as { id: string; key: string };
    expect(minted.key.startsWith('ekoa_gk_')).toBe(true);

    const keyed = (p: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${minted.key}`, 'x-client': 'claude-code', ...(init.headers ?? {}) } });

    const wrote = await keyed('/api/v1/memvault/notes', { method: 'POST', body: JSON.stringify({ permalink: 'agenda/hoje', title: 'Agenda', contentMd: 'corpo via chave' }) });
    expect(wrote.status).toBe(200);
    expect(WriteNoteResponse.safeParse(await wrote.json()).success).toBe(true);

    const read = await keyed('/api/v1/memvault/note?permalink=agenda/hoje');
    expect(read.status).toBe(200);
    const rec = (await read.json()) as Record<string, unknown>;
    expect(NoteRecord.safeParse(rec).success).toBe(true);
    expect(rec.contentMd).toBe('corpo via chave');

    const list = await keyed('/api/v1/memvault/notes?folder=agenda');
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { items: Array<{ permalink: string }> };
    expect(NoteListResponse.safeParse(listBody).success).toBe(true);
    expect(listBody.items.map((i) => i.permalink)).toEqual(['agenda/hoje']);

    const del = await keyed('/api/v1/memvault/note?permalink=agenda/hoje', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(DeleteNoteResponse.safeParse(await del.json()).success).toBe(true);

    // Per-call audit: one memvault activity row per op, key-attributed with the xClient tag.
    const rows = await activityLogs.find({ category: 'memvault' } as never);
    const ops = rows.map((r) => (r as unknown as { type: string; metadata: Record<string, unknown> }));
    expect(ops).toHaveLength(4);
    for (const row of ops) {
      expect(row.metadata.keyId).toBe(minted.id);
      expect(row.metadata.xClient).toBe('claude-code');
      expect(row.metadata.verdict).toBe('ok');
      expect(typeof row.metadata.ms).toBe('number');
    }
    expect(ops.map((r) => r.type).sort()).toEqual(['memvault_delete', 'memvault_list', 'memvault_read', 'memvault_write']);
  });

  it('overwrite preserves created, bumps modified; explicit permalink wins over derivation', async () => {
    const t = await tokenFor('usr');
    const first = (await (await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify({ permalink: 'planos/q3', title: 'Planos', contentMd: 'v1' }) })).json()) as { permalink: string; created: string; modified: string };
    expect(first.permalink).toBe('planos/q3');
    const second = (await (await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify({ permalink: 'planos/q3', title: 'Planos v2', contentMd: 'v2' }) })).json()) as { created: string; modified: string };
    expect(second.created).toBe(first.created);
    expect(second.modified).not.toBe(first.modified);
    const read = (await (await authed('/api/v1/memvault/note?permalink=planos/q3', t)).json()) as { contentMd: string; title: string };
    expect(read.contentMd).toBe('v2');
    expect(read.title).toBe('Planos v2');
  });

  it('on-disk shape: plain markdown + YAML frontmatter a stock basic-memory sync can index', async () => {
    const t = await tokenFor('usr');
    await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify({ permalink: 'briefs/fm-shape', title: 'Forma: "exata"', tags: ['a', 'b'], contentMd: 'corpo md\n' }) });
    const raw = readFileSync(join(vaultRoot, 'usr', 'briefs', 'fm-shape.md'), 'utf8');
    const lines = raw.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe(`title: ${JSON.stringify('Forma: "exata"')}`); // JSON scalar = valid YAML double-quoted scalar
    expect(lines[2]).toBe('type: "note"');
    expect(lines[3]).toBe('permalink: "briefs/fm-shape"');
    expect(lines[4]).toBe('tags: ["a","b"]'); // JSON array = valid YAML flow sequence
    expect(lines[5]).toMatch(/^created: "\d{4}-\d{2}-\d{2}T.*Z"$/);
    expect(lines[6]).toMatch(/^modified: "\d{4}-\d{2}-\d{2}T.*Z"$/);
    expect(lines[7]).toBe('---');
    expect(raw.endsWith('---\ncorpo md\n')).toBe(true);
  });

  it('404 uniformity: read-missing and delete-missing answer the byte-identical NOT_FOUND envelope', async () => {
    const t = await tokenFor('usr');
    const read = await authed('/api/v1/memvault/note?permalink=nao/existe', t);
    const del = await authed('/api/v1/memvault/note?permalink=nao/existe', t, { method: 'DELETE' });
    expect(read.status).toBe(404);
    expect(del.status).toBe(404);
    const readBody = await read.text();
    expect(readBody).toBe(await del.text());
    expect(ErrorEnvelope.safeParse(JSON.parse(readBody)).success).toBe(true);
  });

  it('validation failures are 400 envelopes: bad charset, traversal, missing title, bad folder', async () => {
    const t = await tokenFor('usr');
    for (const q of ['..%2Fetc', 'UPPER%2Fcase', '.hidden', 'a%2F%2Fb']) {
      const res = await authed(`/api/v1/memvault/note?permalink=${q}`, t);
      expect(res.status, q).toBe(400);
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    }
    const noTitle = await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify({ contentMd: 'x' }) });
    expect(noTitle.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await noTitle.json()).success).toBe(true);
    const badFolder = await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify({ title: 'T', folder: '../fora', contentMd: 'x' }) });
    expect(badFolder.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await badFolder.json()).success).toBe(true);
  });

  it('unauthenticated and unknown-key requests are 401 envelopes', async () => {
    const anon = await fetch(`http://127.0.0.1:${port}/api/v1/memvault/notes`, { method: 'GET' });
    expect(anon.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await anon.json()).success).toBe(true);

    const badKey = await fetch(`http://127.0.0.1:${port}/api/v1/memvault/notes`, { headers: { authorization: 'Bearer ekoa_gk_definitely-not-a-key' } });
    expect(badKey.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await badKey.json()).success).toBe(true);
  });

  it('both admissions address ONE partition: a JWT-written note reads back under a key, and vice versa', async () => {
    const t = await tokenFor('usr');
    const minted = (await (await authed('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label: 'partition' }) })).json()) as { key: string };
    const keyed = (p: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${minted.key}`, ...(init.headers ?? {}) } });

    // Written with the JWT -> readable with the key.
    expect((await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify({ permalink: 'via/jwt', title: 'Via JWT', contentMd: 'corpo jwt' }) })).status).toBe(200);
    const viaKey = await keyed('/api/v1/memvault/note?permalink=via/jwt');
    expect(viaKey.status).toBe(200);
    const viaKeyBody: unknown = await viaKey.json();
    expect(NoteRecord.safeParse(viaKeyBody).success).toBe(true);
    expect((viaKeyBody as { contentMd: string }).contentMd).toBe('corpo jwt');

    // Written with the key -> readable with the JWT.
    expect((await keyed('/api/v1/memvault/notes', { method: 'POST', body: JSON.stringify({ permalink: 'via/chave', title: 'Via Chave', contentMd: 'corpo chave' }) })).status).toBe(200);
    const viaJwt = await authed('/api/v1/memvault/note?permalink=via/chave', t);
    expect(viaJwt.status).toBe(200);
    expect((((await viaJwt.json()) as { contentMd: string })).contentMd).toBe('corpo chave');

    // ONE partition, one listing, regardless of which credential asked.
    const listJwt = (await (await authed('/api/v1/memvault/notes', t)).json()) as { items: Array<{ permalink: string }> };
    const listKey = (await (await keyed('/api/v1/memvault/notes')).json()) as { items: Array<{ permalink: string }> };
    expect(listJwt.items.map((i) => i.permalink)).toEqual(['via/chave', 'via/jwt']);
    expect(listKey.items.map((i) => i.permalink)).toEqual(listJwt.items.map((i) => i.permalink));
    // The one on-disk tree both credentials resolved to.
    expect(existsSync(join(vaultRoot, 'usr', 'via', 'jwt.md'))).toBe(true);
    expect(existsSync(join(vaultRoot, 'usr', 'via', 'chave.md'))).toBe(true);
  });

  // ---------------------------------------------------------------------------------------
  // Slice E3 — per-tenant FTS search + markdown export.
  // ---------------------------------------------------------------------------------------

  it('descriptors: search + export join the memvault surface as user-or-key (E3)', () => {
    expect(memvaultEndpoints.searchNotes.auth).toBe('user-or-key');
    expect(memvaultEndpoints.searchNotes.method).toBe('POST');
    expect(memvaultEndpoints.searchNotes.path).toBe('/api/v1/memvault/search');
    expect(memvaultEndpoints.exportVault.auth).toBe('user-or-key');
    expect(memvaultEndpoints.exportVault.method).toBe('GET');
    expect(memvaultEndpoints.exportVault.path).toBe('/api/v1/memvault/export');
    expect(memvaultEndpoints.exportVault.kind).toBe('binary');
  });

  it('search round trip (E3): writes are indexed; a distinctive term returns exactly the right note', async () => {
    const t = await tokenFor('usr');
    const search = (body: Record<string, unknown>) =>
      authed('/api/v1/memvault/search', t, { method: 'POST', body: JSON.stringify(body) });

    for (const n of [
      { permalink: 'briefs/alfa', title: 'Reunião Alfa', tags: ['cliente'], contentMd: 'notas sobre orçamento e prazos' },
      { permalink: 'briefs/beta', title: 'Reunião Beta', tags: ['interno'], contentMd: 'notas sobre contratação, palavra ZEBRAQUIX' },
      { permalink: 'planos/gama', title: 'Plano Gama', tags: [], contentMd: 'roteiro trimestral' },
    ]) {
      expect((await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify(n) })).status).toBe(200);
    }

    const one = await search({ query: 'zebraquix' });
    expect(one.status).toBe(200);
    const oneBody: unknown = await one.json();
    expect(NoteSearchResponse.safeParse(oneBody), JSON.stringify(oneBody)).toMatchObject({ success: true });
    const hits = (oneBody as { hits: Array<{ permalink: string; title: string; snippet?: string; score?: number }> }).hits;
    expect(hits.map((h) => h.permalink)).toEqual(['briefs/beta']);
    expect(hits[0]?.title).toBe('Reunião Beta');
    expect(hits[0]?.snippet).toContain('ZEBRAQUIX');
    expect(typeof hits[0]?.score).toBe('number');

    // Accent folding both ways (unicode61 remove_diacritics 2): "reuniao" finds "Reunião".
    const folded = await search({ query: 'reuniao' });
    expect(folded.status).toBe(200);
    const foldedBody: unknown = await folded.json();
    expect(NoteSearchResponse.safeParse(foldedBody).success).toBe(true);
    expect((foldedBody as { hits: Array<{ permalink: string }> }).hits.map((h) => h.permalink).sort())
      .toEqual(['briefs/alfa', 'briefs/beta']);

    // A tag is searchable; `limit` caps the page.
    const tagged = await search({ query: 'cliente' });
    expect((((await tagged.json()) as { hits: Array<{ permalink: string }> })).hits.map((h) => h.permalink)).toEqual(['briefs/alfa']);
    const capped = await search({ query: 'notas OR roteiro', limit: 1 });
    expect((((await capped.json()) as { hits: unknown[] })).hits).toHaveLength(1);

    // The index really is a per-user FILE, created beside (never inside) the markdown.
    expect(existsSync(join(vaultRoot, 'usr', '.index', 'notes.db'))).toBe(true);
  });

  it('search (E3): a delete drops the row; an untokenizable query is an empty result, not an error', async () => {
    const t = await tokenFor('usr');
    const search = (query: string) =>
      authed('/api/v1/memvault/search', t, { method: 'POST', body: JSON.stringify({ query }) });
    expect((await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify({ permalink: 'efemera/nota', title: 'Efémera', contentMd: 'contém XPTOUNICO' }) })).status).toBe(200);
    expect((((await (await search('xptounico')).json()) as { hits: unknown[] })).hits).toHaveLength(1);

    expect((await authed('/api/v1/memvault/note?permalink=efemera/nota', t, { method: 'DELETE' })).status).toBe(200);
    const after = await search('xptounico');
    expect(after.status).toBe(200);
    const afterBody: unknown = await after.json();
    expect(NoteSearchResponse.safeParse(afterBody).success).toBe(true);
    expect((afterBody as { hits: unknown[] }).hits).toEqual([]);

    // Punctuation-only: nothing tokenizable survives, so it is an empty result rather than an
    // FTS5 syntax error (the quoting also means '"' / NEAR / '*' can never inject an operator).
    for (const q of ['---', '"NEAR(a b)"', '*']) {
      const res = await search(q);
      expect(res.status, q).toBe(200);
      const body: unknown = await res.json();
      expect(NoteSearchResponse.safeParse(body).success).toBe(true);
      expect((body as { hits: unknown[] }).hits).toEqual([]);
    }
  });

  it('export (E3): the tar is exactly the caller\'s markdown, verbatim, and never the derived .index/', async () => {
    const t = await tokenFor('usr');
    const notes = [
      { permalink: 'briefs/alfa', title: 'Alfa', contentMd: 'corpo alfa\n' },
      { permalink: 'briefs/2026/beta', title: 'Beta: "citada"', tags: ['x'], contentMd: 'corpo beta' },
      { permalink: 'raiz', title: 'Raiz', contentMd: 'corpo raiz' },
    ];
    for (const n of notes) {
      expect((await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify(n) })).status).toBe(200);
    }
    // Force the derived index into existence so its absence from the tar is a real assertion.
    expect((await authed('/api/v1/memvault/search', t, { method: 'POST', body: JSON.stringify({ query: 'corpo' }) })).status).toBe(200);
    expect(existsSync(join(vaultRoot, 'usr', '.index', 'notes.db'))).toBe(true);

    const res = await authed('/api/v1/memvault/export', t);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-tar');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="memvault.tar"');
    const tar = Buffer.from(await res.arrayBuffer());
    const entries = readTar(tar);

    // Exactly the caller's markdown — nothing more, nothing less.
    expect(entries.map((e) => e.name)).toEqual(['briefs/2026/beta.md', 'briefs/alfa.md', 'raiz.md']);
    for (const e of entries) {
      expect(e.name.endsWith('.md')).toBe(true);
      expect(e.name.includes('.index')).toBe(false);
      expect(e.name.startsWith('/')).toBe(false);
      expect(e.mode).toBe('000644');
    }
    expect(entries.some((e) => e.name.includes('notes.db'))).toBe(false);
    // Not one byte of the sqlite file leaked into the stream, under any entry name.
    expect(tar.includes(Buffer.from('SQLite format 3'))).toBe(false);

    // Byte-verbatim: each entry is the file on disk, frontmatter included.
    for (const e of entries) {
      const onDisk = readFileSync(join(vaultRoot, 'usr', ...e.name.split('/')), 'utf8');
      expect(e.content).toBe(onDisk);
    }
    expect(entries[2]?.content.startsWith('---\ntitle: "Raiz"')).toBe(true);

    // Deterministic: the mtime is the note's own `modified`, never wall-clock, so an unchanged
    // vault exports byte-identically.
    const again = Buffer.from(await (await authed('/api/v1/memvault/export', t)).arrayBuffer());
    expect(again.equals(tar)).toBe(true);

    // An empty vault is still a valid (empty) tar, not an error.
    for (const n of notes) await authed(`/api/v1/memvault/note?permalink=${encodeURIComponent(n.permalink)}`, t, { method: 'DELETE' });
    const empty = await authed('/api/v1/memvault/export', t);
    expect(empty.status).toBe(200);
    expect(readTar(Buffer.from(await empty.arrayBuffer()))).toEqual([]);
  });

  it('search + export refusals: bad request bodies are 400 envelopes, unauthenticated calls are 401 envelopes', async () => {
    const t = await tokenFor('usr');
    for (const body of [{}, { query: '' }, { query: 'ok', limit: 0 }, { query: 'ok', limit: 101 }, { query: 'a'.repeat(1001) }]) {
      const res = await authed('/api/v1/memvault/search', t, { method: 'POST', body: JSON.stringify(body) });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    }
    for (const p of ['/api/v1/memvault/search', '/api/v1/memvault/export']) {
      const anon = await fetch(`http://127.0.0.1:${port}${p}`, p.endsWith('search') ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"x"}' } : {});
      expect(anon.status, p).toBe(401);
      expect(ErrorEnvelope.safeParse(await anon.json()).success).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------------------
  // E2 fresh-context review — regression tests for F1 (HTML 500 + unaudited failure) and F3
  // (unaudited router-level refusals).
  // ---------------------------------------------------------------------------------------

  it('E2 review F1(a): an over-long permalink SEGMENT is a 400 envelope, and a long title derives a capped slug', async () => {
    const t = await tokenFor('usr');
    // 300 chars in ONE segment: contract-valid before the fix (< 512 total), ENAMETOOLONG on disk.
    const long = 'a'.repeat(300);
    for (const body of [
      { permalink: long, title: 'x', contentMd: 'x' },
      { permalink: `briefs/${long}`, title: 'x', contentMd: 'x' },
      { title: 'x', folder: long, contentMd: 'x' },
    ]) {
      const res = await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify(body) });
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(res.headers.get('content-type') ?? '').toContain('application/json');
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    }
    // Reading one is refused at the same gate.
    const read = await authed(`/api/v1/memvault/note?permalink=${long}`, t);
    expect(read.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await read.json()).success).toBe(true);

    // The derivation respects the same ceiling: a 300-char title still writes, with a capped slug.
    const derived = await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify({ title: 'b'.repeat(300), contentMd: 'x' }) });
    expect(derived.status).toBe(200);
    const rec = (await derived.json()) as { permalink: string };
    expect(rec.permalink).toBe('b'.repeat(NOTE_PERMALINK_SEGMENT_MAX));
    expect(rec.permalink.length).toBe(NOTE_PERMALINK_SEGMENT_MAX);
    expect(existsSync(join(vaultRoot, 'usr', `${rec.permalink}.md`))).toBe(true);
    // A segment that fits still round-trips at the boundary.
    const atLimit = await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify({ permalink: 'c'.repeat(NOTE_PERMALINK_SEGMENT_MAX), title: 'limite', contentMd: 'x' }) });
    expect(atLimit.status).toBe(200);
  });

  it('E2 review F1(b): an unexpected store failure is AUDITED and answered as an envelope, never an HTML 500', async () => {
    const t = await tokenFor('usr');
    // A directory squatting on the note's filename makes the store's rename fail with a plain
    // errno — not a jail violation, i.e. exactly the class that used to escape the service.
    mkdirSync(join(vaultRoot, 'usr', 'colisao.md'), { recursive: true });
    const res = await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify({ permalink: 'colisao', title: 'Colisão', contentMd: 'x' }) });
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    const body: unknown = await res.json();
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body as { error: { code: string } }).error.code).toBe('INTERNAL');
    // No stack, no absolute server path on the wire.
    expect(JSON.stringify(body)).not.toContain(vaultRoot);
    expect(JSON.stringify(body)).not.toContain('.md');

    const rows = await activityLogs.find({ category: 'memvault' } as never);
    const metas = rows.map((r) => (r as unknown as { metadata: { op: string; verdict: string; permalink?: string } }).metadata);
    expect(metas.filter((m) => m.verdict === 'error' && m.op === 'write')).toHaveLength(1);
    expect(metas.find((m) => m.verdict === 'error')?.permalink).toBe('colisao');
  });

  it('E2 review F1(c): an error escaping a handler still answers the shared envelope, with no stack or absolute path', async () => {
    const t = await tokenFor('usr');
    faults.listThrows = true;
    try {
      const res = await authed('/api/v1/memvault/notes', t);
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type') ?? '').toContain('application/json');
      const body: unknown = await res.json();
      expect(ErrorEnvelope.safeParse(body).success).toBe(true);
      expect((body as { error: { code: string } }).error.code).toBe('INTERNAL');
      const text = JSON.stringify(body);
      expect(text).not.toContain('/home/segredo');
      expect(text).not.toContain('falha simulada');
      expect(text).not.toContain('<!DOCTYPE');
    } finally {
      faults.listThrows = false;
    }
  });

  it('E2 review F3: router-level schema refusals leave a denied audit row + the addressed path', async () => {
    const t = await tokenFor('usr');
    await activityLogs.deleteMany({});
    // The four refusal shapes that never reach the service — traversal payloads die here.
    expect((await authed('/api/v1/memvault/note?permalink=..%2F..%2Fetc%2Fpasswd', t)).status).toBe(400);
    expect((await authed('/api/v1/memvault/note?permalink=..%2Fetc', t, { method: 'DELETE' })).status).toBe(400);
    expect((await authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify({ title: 'x', folder: '../fora', contentMd: 'x' }) })).status).toBe(400);
    expect((await authed('/api/v1/memvault/notes?folder=..%2F..', t)).status).toBe(400);
    expect((await authed('/api/v1/memvault/search', t, { method: 'POST', body: JSON.stringify({ query: '' }) })).status).toBe(400);

    const rows = await activityLogs.find({ category: 'memvault' } as never);
    const metas = rows.map((r) => (r as unknown as { type: string; metadata: { op: string; verdict: string; permalink?: string; ms: number } }));
    expect(metas).toHaveLength(5); // one row per refused call — none is silent any more
    for (const m of metas) expect(m.metadata.verdict).toBe('denied');
    expect(metas.map((m) => m.metadata.op).sort()).toEqual(['delete', 'list', 'read', 'search', 'write']);
    // The audit carries the path the caller was aiming at (capped, never resolved).
    expect(metas.find((m) => m.metadata.op === 'read')?.metadata.permalink).toBe('../../etc/passwd');
    expect(metas.find((m) => m.metadata.op === 'delete')?.metadata.permalink).toBe('../etc');
    expect(metas.find((m) => m.metadata.op === 'write')?.metadata.permalink).toBe('../fora');
    expect(metas.find((m) => m.metadata.op === 'list')?.metadata.permalink).toBe('../..');
    expect(metas.every((m) => typeof m.metadata.ms === 'number')).toBe(true);
  });
});
