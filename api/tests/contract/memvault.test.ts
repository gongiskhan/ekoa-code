import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  memvaultEndpoints,
  WriteNoteResponse,
  NoteRecord,
  NoteListResponse,
  DeleteNoteResponse,
  ErrorEnvelope,
} from '@ekoa/shared';

/**
 * memvault CONTRACT test (slice E2): the write/read/list/delete wire shapes validate against
 * the shared schemas through the REAL app, under BOTH admissions the `user-or-key` class
 * carries — a platform JWT and a REAL key minted through POST /api/v1/gateway-keys. Every
 * non-2xx body validates against the shared error envelope; missing-note 404s are uniform;
 * every call leaves one activity row; the on-disk file is stock-basic-memory frontmatter.
 */
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

describe('memvault contract (slice E2)', () => {
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
});
