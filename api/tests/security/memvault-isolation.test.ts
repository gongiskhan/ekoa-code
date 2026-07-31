import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings, gatewayKeys, activityLogs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { closeAllIndexes, rebuild } from '../../src/memvault/fts.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { ErrorEnvelope } from '@ekoa/shared';

/**
 * Fault injection for the E3-review finding 3 probes. "An index update failed" is the premise
 * of that defect, and provoking it through the filesystem means chmod games that behave
 * differently as root — so the failure is injected at the module boundary instead, which is
 * exactly the contract under test. Both wrappers delegate verbatim while their flag is off.
 */
const faults = vi.hoisted(() => ({ indexThrows: false, invalidateThrows: false }));
vi.mock('../../src/memvault/fts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memvault/fts.js')>();
  return {
    ...actual,
    indexNote: (...args: Parameters<typeof actual.indexNote>) =>
      faults.indexThrows ? Promise.reject(new Error('falha simulada ao indexar')) : actual.indexNote(...args),
    invalidate: (...args: Parameters<typeof actual.invalidate>) =>
      faults.invalidateThrows ? Promise.reject(new Error('falha simulada ao descartar o indice')) : actual.invalidate(...args),
  };
});

/**
 * memvault ISOLATION suite (slices E2 + E3). Tenancy isolation is the capability's whole point,
 * so this suite attacks it directly through the real app:
 *   - traversal payloads (.. variants, encodings, null bytes, absolute paths, 512-char abuse)
 *     are refused at the contract level and leave NO file outside the caller's tree;
 *   - pre-planted symlinks inside user A's tree pointing at user B's tree and at /etc fail
 *     CLOSED (uniform 404 on the wire, `jail_violation` in the audit trail, listings blind);
 *   - the USER ROOT ITSELF symlinked at a sibling tenant or at /etc fails closed on read, list
 *     AND delete — the E2 review's F2 breach, where containment was anchored on the per-user
 *     directory and therefore resolved away the very link it was meant to catch;
 *   - cross-tenant reads/lists/deletes under B's JWT AND B's real gateway key are uniform
 *     404s / empty, byte-identical to plain missing (no existence oracle);
 *   - two tenants interleaving writes/reads (Promise.all) never bleed;
 *   - the E3 search index is PHYSICALLY per tenant (one db file each, no shared table) and,
 *     being derived, is rebuilt from the markdown when it is missing or corrupt — without ever
 *     reading another tenant's tree to do it;
 *   - the E3 export ships one tenant's markdown and never the derived index;
 *   - unauthenticated / unknown-key / revoked-key admission is refused;
 *   - a grep gate pins jail.ts as the ONLY path-resolution point in api/src/memvault/.
 */
const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/api/tests/security

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
const writeNote = (t: string, body: Record<string, unknown>) =>
  authed('/api/v1/memvault/notes', t, { method: 'POST', body: JSON.stringify(body) });

const MISSING_404 = JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Não encontrado.' } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  vaultRoot = mkdtempSync(join(tmpdir(), 'ekoa-memvault-isolation-'));
  process.env.EKOA_MEMVAULT_ROOT = vaultRoot;
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_memvault_isolation');
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
  faults.indexThrows = false;
  faults.invalidateThrows = false;
  closeAllIndexes();
  __resetActivationForTests();
  __resetRevocationsForTests();
  __resetCapabilityRateForTests();
  await users.deleteMany({});
  await userSettings.deleteMany({});
  await gatewayKeys.deleteMany({});
  await activityLogs.deleteMany({});
  rmSync(vaultRoot, { recursive: true, force: true });
  // Same org on purpose: memvault isolation is PER USER, stricter than org scoping.
  for (const id of ['usrA', 'usrB'] as const) {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true } as never);
    setActivation(id, { active: true, billingLocked: false });
    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
  }
});

const mintKeyFor = async (t: string): Promise<{ id: string; key: string }> => {
  const res = await authed('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label: 'iso' }) });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; key: string };
};

describe('memvault isolation (slices E2 + E3)', () => {
  it('grep gate: jail.ts is the ONLY path-resolution point in api/src/memvault/', () => {
    const dir = resolve(HERE, '../../src/memvault');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files).toContain('jail.ts');
    expect(files.length).toBeGreaterThanOrEqual(3); // jail + store + service
    const pathImportRe = /from\s+['"](node:)?path['"]|require\(\s*['"](node:)?path['"]\s*\)/;
    for (const f of files) {
      if (f === 'jail.ts') continue;
      const content = readFileSync(join(dir, f), 'utf8');
      expect(pathImportRe.test(content), `${f} must not import node:path (jail.ts is the single path-resolution point)`).toBe(false);
      expect(/\bpath\.(join|resolve)\s*\(/.test(content), `${f} must not call path.join/path.resolve`).toBe(false);
      expect(content.includes('memvaultConfig'), `${f} must not read the memvault root config directly`).toBe(false);
    }
    // Non-tautology: the matchers DO fire on planted violations (both import spellings).
    expect(pathImportRe.test("import { join } from 'node:path';")).toBe(true);
    expect(pathImportRe.test("const path = require('path');")).toBe(true);
    expect(/\bpath\.(join|resolve)\s*\(/.test('const p = path.join(root, userInput);')).toBe(true);
  });

  it('traversal payloads in permalink/folder are 400 envelopes and touch NOTHING on disk', async () => {
    const tA = await tokenFor('usrA');
    const permalinkPayloads = [
      '../fora',
      '..%2Ffora', // still encoded after express decoding of the JSON body -> '%' fails charset
      '%2e%2e/fora',
      'a/../b',
      '/etc/passwd',
      'a//b',
      '.oculto',
      'a/.oculto',
      'a\\b',
      'a\u0000b',
      'A/maiuscula',
      'a'.repeat(513), // 512-char ceiling abuse
      '-comeca-mal',
    ];
    for (const p of permalinkPayloads) {
      const viaBody = await writeNote(tA, { permalink: p, title: 'x', contentMd: 'x' });
      expect(viaBody.status, `write permalink ${JSON.stringify(p)}`).toBe(400);
      expect(ErrorEnvelope.safeParse(await viaBody.json()).success).toBe(true);
      const viaQuery = await authed(`/api/v1/memvault/note?permalink=${encodeURIComponent(p)}`, tA);
      expect(viaQuery.status, `read permalink ${JSON.stringify(p)}`).toBe(400);
      expect(ErrorEnvelope.safeParse(await viaQuery.json()).success).toBe(true);
      const viaDelete = await authed(`/api/v1/memvault/note?permalink=${encodeURIComponent(p)}`, tA, { method: 'DELETE' });
      expect(viaDelete.status, `delete permalink ${JSON.stringify(p)}`).toBe(400);
    }
    for (const folder of ['../fora', '/abs', 'a/../b', '..', 'a\u0000b']) {
      const res = await writeNote(tA, { title: 'x', folder, contentMd: 'x' });
      expect(res.status, `folder ${JSON.stringify(folder)}`).toBe(400);
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    }
    // Raw URL-encoded probes (server-side decode happens BEFORE zod sees the value).
    for (const q of ['..%2Ffora', '%2e%2e%2Ffora', 'a%00b', '%2Fetc%2Fpasswd']) {
      const res = await authed(`/api/v1/memvault/note?permalink=${q}`, tA);
      expect(res.status, `raw query ${q}`).toBe(400);
    }
    // Nothing escaped: the vault root gained no entries at all (no user dir was even created).
    expect(existsSync(vaultRoot) ? readdirSync(vaultRoot) : []).toEqual([]);
  });

  it('a traversal-shaped TITLE is slugified into harmlessness, never resolved', async () => {
    const tA = await tokenFor('usrA');
    const res = await writeNote(tA, { title: '../../etc/passwd', contentMd: 'inofensivo' });
    expect(res.status).toBe(200);
    const rec = (await res.json()) as { permalink: string };
    expect(rec.permalink).toBe('etc-passwd');
    expect(existsSync(join(vaultRoot, 'usrA', 'etc-passwd.md'))).toBe(true);
    expect(readdirSync(vaultRoot)).toEqual(['usrA']);
  });

  it('512-char boundary: a 512-char multi-segment permalink works; the derived overflow is refused', async () => {
    const tA = await tokenFor('usrA');
    const seg = (c: string, n: number) => c.repeat(n);
    const permalink512 = `${seg('a', 200)}/${seg('b', 200)}/${seg('c', 110)}`; // 200+1+200+1+110 = 512
    expect(permalink512.length).toBe(512);
    const ok = await writeNote(tA, { permalink: permalink512, title: 'limite', contentMd: 'x' });
    expect(ok.status).toBe(200);
    const read = await authed(`/api/v1/memvault/note?permalink=${encodeURIComponent(permalink512)}`, tA);
    expect(read.status).toBe(200);
    // folder(511 chars) + slug pushes the DERIVED permalink past 512 -> 400, not a truncation.
    const folder511 = `${seg('a', 255)}/${seg('b', 255)}`;
    const overflow = await writeNote(tA, { title: 'um titulo bastante longo para estourar', folder: folder511.slice(0, 500), contentMd: 'x' });
    expect(overflow.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await overflow.json()).success).toBe(true);
  });

  it('symlink escapes fail CLOSED: planted links to another tenant and to /etc are uniform 404s, invisible to list', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    expect((await writeNote(tA, { permalink: 'privado/minha', title: 'A', contentMd: 'SEGREDO_A' })).status).toBe(200);
    expect((await writeNote(tB, { permalink: 'privado/segredo', title: 'B', contentMd: 'SEGREDO_B' })).status).toBe(200);

    // Pre-plant, inside A's tree: a dir link to B's tree, a dir link to /etc, a file link to /etc/passwd.
    symlinkSync(join(vaultRoot, 'usrB'), join(vaultRoot, 'usrA', 'linkb'));
    symlinkSync('/etc', join(vaultRoot, 'usrA', 'etcdir'));
    symlinkSync('/etc/passwd', join(vaultRoot, 'usrA', 'leak.md'));

    // Read THROUGH the planted links: uniform 404, byte-identical to plain missing.
    for (const p of ['linkb/privado/segredo', 'etcdir/passwd', 'leak']) {
      const res = await authed(`/api/v1/memvault/note?permalink=${encodeURIComponent(p)}`, tA);
      expect(res.status, p).toBe(404);
      expect(await res.text(), p).toBe(MISSING_404);
    }
    // Write through the tenant link: refused, and NOTHING lands in B's tree.
    const inject = await writeNote(tA, { permalink: 'linkb/injetado', title: 'x', contentMd: 'x' });
    expect(inject.status).toBe(404);
    expect(await inject.text()).toBe(MISSING_404);
    expect(existsSync(join(vaultRoot, 'usrB', 'injetado.md'))).toBe(false);
    // Delete through the tenant link: refused, B's note survives.
    const del = await authed(`/api/v1/memvault/note?permalink=${encodeURIComponent('linkb/privado/segredo')}`, tA, { method: 'DELETE' });
    expect(del.status).toBe(404);
    expect(existsSync(join(vaultRoot, 'usrB', 'privado', 'segredo.md'))).toBe(true);
    // A's listing never follows the links (symlinked dirs are not descended; leak.md is not a file).
    const list = (await (await authed('/api/v1/memvault/notes', tA)).json()) as { items: Array<{ permalink: string }> };
    expect(list.items.map((i) => i.permalink)).toEqual(['privado/minha']);
    // The audit trail names the escapes for what they were.
    const rows = await activityLogs.find({ category: 'memvault' } as never);
    const verdicts = rows.map((r) => (r as unknown as { metadata: { verdict: string } }).metadata.verdict);
    expect(verdicts.filter((v) => v === 'jail_violation').length).toBeGreaterThanOrEqual(5);
  });

  it('cross-tenant: B (JWT and real key) cannot read/list/delete A\'s note - uniform 404s, no oracle', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    const keyB = await mintKeyFor(tB);
    expect((await writeNote(tA, { permalink: 'so-do-a/nota', title: 'A', contentMd: 'privado de A' })).status).toBe(200);

    const asKeyB = (p: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${keyB.key}`, ...(init.headers ?? {}) } });

    for (const attempt of [
      () => authed('/api/v1/memvault/note?permalink=so-do-a/nota', tB),
      () => asKeyB('/api/v1/memvault/note?permalink=so-do-a/nota'),
      () => authed('/api/v1/memvault/note?permalink=so-do-a/nota', tB, { method: 'DELETE' }),
      () => asKeyB('/api/v1/memvault/note?permalink=so-do-a/nota', { method: 'DELETE' }),
    ]) {
      const res = await attempt();
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(MISSING_404); // byte-identical to plain missing - no existence oracle
    }
    const listJwt = (await (await authed('/api/v1/memvault/notes', tB)).json()) as { items: unknown[] };
    expect(listJwt.items).toEqual([]);
    const listKey = (await (await asKeyB('/api/v1/memvault/notes')).json()) as { items: unknown[] };
    expect(listKey.items).toEqual([]);
    // The "delete" attempts changed nothing: A still reads its note.
    const still = await authed('/api/v1/memvault/note?permalink=so-do-a/nota', tA);
    expect(still.status).toBe(200);
    expect(((await still.json()) as { contentMd: string }).contentMd).toBe('privado de A');
  });

  it('two tenants writing/reading CONCURRENTLY at the same permalinks never bleed', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    const n = 5;
    const writes: Array<Promise<Response>> = [];
    for (let i = 0; i < n; i++) {
      writes.push(writeNote(tA, { permalink: `race/n${i}`, title: `A${i}`, contentMd: `corpo-A-${i}` }));
      writes.push(writeNote(tB, { permalink: `race/n${i}`, title: `B${i}`, contentMd: `corpo-B-${i}` }));
    }
    for (const res of await Promise.all(writes)) expect(res.status).toBe(200);
    const reads: Array<Promise<void>> = [];
    for (let i = 0; i < n; i++) {
      reads.push((async () => {
        const a = (await (await authed(`/api/v1/memvault/note?permalink=race/n${i}`, tA)).json()) as { contentMd: string; title: string };
        expect(a.contentMd).toBe(`corpo-A-${i}`);
        expect(a.title).toBe(`A${i}`);
      })());
      reads.push((async () => {
        const b = (await (await authed(`/api/v1/memvault/note?permalink=race/n${i}`, tB)).json()) as { contentMd: string; title: string };
        expect(b.contentMd).toBe(`corpo-B-${i}`);
        expect(b.title).toBe(`B${i}`);
      })());
    }
    await Promise.all(reads);
    const listA = (await (await authed('/api/v1/memvault/notes?folder=race', tA)).json()) as { items: Array<{ permalink: string }> };
    expect(listA.items.map((i) => i.permalink)).toEqual([0, 1, 2, 3, 4].map((i) => `race/n${i}`));
  });

  it('admission: unauthenticated, unknown-key and REVOKED-key calls are refused with envelopes', async () => {
    const anon = await fetch(`http://127.0.0.1:${port}/api/v1/memvault/notes`);
    expect(anon.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await anon.json()).success).toBe(true);

    const unknown = await fetch(`http://127.0.0.1:${port}/api/v1/memvault/notes`, { headers: { authorization: 'Bearer ekoa_gk_nope' } });
    expect(unknown.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await unknown.json()).success).toBe(true);

    const tB = await tokenFor('usrB');
    const keyB = await mintKeyFor(tB);
    const revoke = await authed(`/api/v1/gateway-keys/${keyB.id}/revoke`, tB, { method: 'POST' });
    expect(revoke.status).toBe(200);
    const revoked = await fetch(`http://127.0.0.1:${port}/api/v1/memvault/notes`, { headers: { authorization: `Bearer ${keyB.key}` } });
    expect(revoked.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await revoked.json()).success).toBe(true);
  });

  // ---------------------------------------------------------------------------------------
  // E2 fresh-context review, finding F2 (HIGH, reproduced end-to-end): containment was checked
  // against `realpath(<memvaultRoot>/<userId>)`. When the USER ROOT ITSELF was a symlink, that
  // resolved the link away and compared the target with itself, so every op passed — a real
  // cross-tenant breach, audited as verdict "ok". list/delete additionally never containment-
  // checked the root at all. Both directions are pinned below.
  // ---------------------------------------------------------------------------------------

  it('E2 review F2: a SYMLINKED USER ROOT pointing at a sibling tenant fails closed on read, list AND delete', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    expect((await writeNote(tB, { permalink: 'privado/segredo', title: 'B', contentMd: 'SEGREDO_DE_B' })).status).toBe(200);
    // A has no tree yet — plant its whole root as a link into B's.
    expect(existsSync(join(vaultRoot, 'usrA'))).toBe(false);
    symlinkSync(join(vaultRoot, 'usrB'), join(vaultRoot, 'usrA'));

    // READ through the root link: uniform 404, byte-identical to plain missing.
    const read = await authed('/api/v1/memvault/note?permalink=privado/segredo', tA);
    expect(read.status).toBe(404);
    expect(await read.text()).toBe(MISSING_404);

    // LIST through the root link: refused, and B's permalinks never appear.
    const list = await authed('/api/v1/memvault/notes', tA);
    expect(list.status).toBe(404);
    const listText = await list.text();
    expect(listText).toBe(MISSING_404);
    expect(listText).not.toContain('privado');

    // SEARCH and EXPORT ride the same walk and are refused identically.
    const search = await authed('/api/v1/memvault/search', tA, { method: 'POST', body: JSON.stringify({ query: 'segredo' }) });
    expect(search.status).toBe(404);
    expect(await search.text()).toBe(MISSING_404);
    const exported = await authed('/api/v1/memvault/export', tA);
    expect(exported.status).toBe(404);
    expect(await exported.text()).toBe(MISSING_404);

    // DELETE through the root link: refused, and B's note survives untouched.
    const del = await authed('/api/v1/memvault/note?permalink=privado/segredo', tA, { method: 'DELETE' });
    expect(del.status).toBe(404);
    expect(existsSync(join(vaultRoot, 'usrB', 'privado', 'segredo.md'))).toBe(true);
    // WRITE through the root link: refused, nothing injected into B's tree.
    const inject = await writeNote(tA, { permalink: 'injetado', title: 'x', contentMd: 'x' });
    expect(inject.status).toBe(404);
    expect(existsSync(join(vaultRoot, 'usrB', 'injetado.md'))).toBe(false);

    // B still owns its note, and the audit trail names every attempt for what it was.
    const still = await authed('/api/v1/memvault/note?permalink=privado/segredo', tB);
    expect(still.status).toBe(200);
    expect(((await still.json()) as { contentMd: string }).contentMd).toBe('SEGREDO_DE_B');
    const rows = await activityLogs.find({ category: 'memvault' } as never);
    const byUserA = rows
      .map((r) => r as unknown as { userId: string; metadata: { op: string; verdict: string } })
      .filter((r) => r.userId === 'usrA');
    expect(byUserA.length).toBe(6); // read, list, search, export, delete, write
    for (const r of byUserA) expect(r.metadata.verdict, r.metadata.op).toBe('jail_violation');
    expect(byUserA.map((r) => r.metadata.op).sort()).toEqual(['delete', 'export', 'list', 'read', 'search', 'write']);
  });

  it('E3 review nit 1: a DANGLING symlink at the user root answers the uniform 404, not a 500', async () => {
    // The containment check runs BEFORE mkdir precisely so this shape classifies as a jail
    // refusal. With mkdir first it threw ENOENT and escaped as INTERNAL (audited `error`),
    // breaking the uniform-404 invariant and mislabelling a jail-relevant event in the audit.
    const tA = await tokenFor('usrA');
    mkdirSync(vaultRoot, { recursive: true });
    expect(existsSync(join(vaultRoot, 'usrA'))).toBe(false);
    symlinkSync(join(vaultRoot, 'nao-existe-alvo'), join(vaultRoot, 'usrA')); // dangling

    for (const attempt of [
      () => authed('/api/v1/memvault/note?permalink=qualquer', tA),
      () => authed('/api/v1/memvault/notes', tA),
      () => writeNote(tA, { permalink: 'injetado', title: 'x', contentMd: 'x' }),
      () => authed('/api/v1/memvault/search', tA, { method: 'POST', body: JSON.stringify({ query: 'x' }) }),
      () => authed('/api/v1/memvault/export', tA),
    ]) {
      const res = await attempt();
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(MISSING_404);
    }
    // The dangling target was never created - open(O_CREAT) never got to follow the link.
    expect(existsSync(join(vaultRoot, 'nao-existe-alvo'))).toBe(false);
  });

  it('E2 review F2: a user root symlinked at /etc fails closed on read, list and delete - and writes nothing there', async () => {
    const tA = await tokenFor('usrA');
    mkdirSync(vaultRoot, { recursive: true }); // beforeEach wipes it; nothing has written yet
    expect(existsSync(join(vaultRoot, 'usrA'))).toBe(false);
    symlinkSync('/etc', join(vaultRoot, 'usrA'));

    for (const attempt of [
      () => authed('/api/v1/memvault/note?permalink=passwd', tA),
      () => authed('/api/v1/memvault/note?permalink=hosts', tA),
      () => authed('/api/v1/memvault/notes', tA),
      () => authed('/api/v1/memvault/note?permalink=passwd', tA, { method: 'DELETE' }),
      () => writeNote(tA, { permalink: 'injetado', title: 'x', contentMd: 'x' }),
      () => authed('/api/v1/memvault/search', tA, { method: 'POST', body: JSON.stringify({ query: 'root' }) }),
      () => authed('/api/v1/memvault/export', tA),
    ]) {
      const res = await attempt();
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).toBe(MISSING_404); // uniform - the wire cannot tell an escape from a miss
      expect(body).not.toContain('root:'); // and no /etc/passwd content ever rides along
    }
    // /etc is untouched: no note file, no reserved index dir was created inside it.
    expect(existsSync('/etc/injetado.md')).toBe(false);
    expect(existsSync('/etc/.index')).toBe(false);
    expect(existsSync('/etc/passwd')).toBe(true); // sanity: the delete attempt was a no-op

    const rows = await activityLogs.find({ category: 'memvault' } as never);
    const verdicts = rows.map((r) => (r as unknown as { metadata: { verdict: string } }).metadata.verdict);
    expect(verdicts).toHaveLength(7);
    expect(verdicts.every((v) => v === 'jail_violation')).toBe(true);
  });

  // ---------------------------------------------------------------------------------------
  // Slice E3 — the search index and the export must be as physically per-tenant as the files.
  // ---------------------------------------------------------------------------------------

  const dbFileFor = (user: string) => join(vaultRoot, user, '.index', 'notes.db');
  const searchAs = (t: string, query: string, limit?: number) =>
    authed('/api/v1/memvault/search', t, { method: 'POST', body: JSON.stringify({ query, ...(limit ? { limit } : {}) }) });
  const hitsOf = async (res: Response) => ((await res.json()) as { hits: Array<{ permalink: string; title: string }> }).hits;

  /** Two tenants whose notes deliberately share vocabulary, each with one unique token. */
  const seedOverlappingTenants = async (tA: string, tB: string): Promise<void> => {
    expect((await writeNote(tA, { permalink: 'partilhado/nota', title: 'Projeto Comum A', tags: ['comum'], contentMd: 'orçamento comum do projeto, token AAAUNICOA' })).status).toBe(200);
    expect((await writeNote(tA, { permalink: 'so-do-a/extra', title: 'Extra A', contentMd: 'mais notas do projeto comum' })).status).toBe(200);
    expect((await writeNote(tB, { permalink: 'partilhado/nota', title: 'Projeto Comum B', tags: ['comum'], contentMd: 'orçamento comum do projeto, token BBBUNICOB' })).status).toBe(200);
    expect((await writeNote(tB, { permalink: 'so-do-b/segredo', title: 'Segredo B', contentMd: 'apenas de B, token BBBUNICOB' })).status).toBe(200);
  };

  it('E3 per-tenant FTS: the index is a separate FILE per user, and A\'s search NEVER returns B\'s rows', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    await seedOverlappingTenants(tA, tB);
    expect((await searchAs(tA, 'comum')).status).toBe(200);
    expect((await searchAs(tB, 'comum')).status).toBe(200);

    // STRUCTURAL: two distinct database files, one per user root. There is no shared table for
    // a missing WHERE clause to expose.
    expect(dbFileFor('usrA')).not.toBe(dbFileFor('usrB'));
    expect(existsSync(dbFileFor('usrA'))).toBe(true);
    expect(existsSync(dbFileFor('usrB'))).toBe(true);
    expect(readdirSync(vaultRoot).sort()).toEqual(['usrA', 'usrB']);

    // BEHAVIOURAL: the overlapping term hits only the caller's own rows...
    const commonA = await hitsOf(await searchAs(tA, 'comum'));
    expect(commonA.map((h) => h.permalink).sort()).toEqual(['partilhado/nota', 'so-do-a/extra']);
    expect(commonA.every((h) => h.title.endsWith('A'))).toBe(true);
    const commonB = await hitsOf(await searchAs(tB, 'comum'));
    expect(commonB.map((h) => h.permalink).sort()).toEqual(['partilhado/nota']);
    expect(commonB.some((h) => h.title === 'Projeto Comum B')).toBe(true);
    expect(commonB.some((h) => h.title.endsWith('A'))).toBe(false);

    // ...and B's unique token is invisible to A, in both directions.
    expect(await hitsOf(await searchAs(tA, 'bbbunicob'))).toEqual([]);
    expect(await hitsOf(await searchAs(tB, 'aaaunicoa'))).toEqual([]);
    expect((await hitsOf(await searchAs(tB, 'bbbunicob'))).map((h) => h.permalink).sort()).toEqual(['partilhado/nota', 'so-do-b/segredo']);
    // The colliding permalink resolves to each tenant's OWN note.
    expect((await hitsOf(await searchAs(tA, 'aaaunicoa'))).map((h) => h.permalink)).toEqual(['partilhado/nota']);
  });

  it('E3 export is per-tenant: A\'s tar contains zero B files, zero B bytes, and no derived index', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    await seedOverlappingTenants(tA, tB);
    expect((await searchAs(tA, 'comum')).status).toBe(200); // materialise A's .index/

    const res = await authed('/api/v1/memvault/export', tA);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-tar');
    const tar = Buffer.from(await res.arrayBuffer());
    const text = tar.toString('binary');

    // Entry names: the tar's 512-byte headers start with the entry path, so scanning the raw
    // bytes for B's exclusive permalink is a stronger check than parsing.
    expect(text).toContain('partilhado/nota.md');
    expect(text).toContain('so-do-a/extra.md');
    expect(text).not.toContain('so-do-b');
    expect(text).not.toContain('BBBUNICOB'); // not one byte of B's content
    expect(text).toContain('AAAUNICOA'); // ...while A's own content IS there
    expect(text).toContain('Projeto Comum A');
    expect(text).not.toContain('Projeto Comum B');
    // The derived index is absent by construction (a dot-dir the walk never sees).
    expect(existsSync(dbFileFor('usrA'))).toBe(true);
    expect(text).not.toContain('.index');
    expect(text).not.toContain('notes.db');
    expect(tar.includes(Buffer.from('SQLite format 3'))).toBe(false);
  });

  it('E3 index recovery: DELETING the db file rebuilds it from the markdown with identical hits', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    await seedOverlappingTenants(tA, tB);
    const before = await hitsOf(await searchAs(tA, 'comum'));
    expect(before.length).toBe(2);
    expect(existsSync(dbFileFor('usrA'))).toBe(true);

    // Blow the derived index away entirely — files are the source of truth.
    rmSync(join(vaultRoot, 'usrA', '.index'), { recursive: true, force: true });
    expect(existsSync(dbFileFor('usrA'))).toBe(false);

    const after = await hitsOf(await searchAs(tA, 'comum'));
    expect(after.map((h) => h.permalink).sort()).toEqual(before.map((h) => h.permalink).sort());
    expect(existsSync(dbFileFor('usrA'))).toBe(true); // rebuilt in place
    // The rebuild read A's tree and only A's tree.
    expect(await hitsOf(await searchAs(tA, 'bbbunicob'))).toEqual([]);
    // B's own index was never touched by A's rebuild.
    expect((await hitsOf(await searchAs(tB, 'bbbunicob'))).length).toBe(2);
  });

  // ---------------------------------------------------------------------------------------
  // E3 fresh-context review, finding 1 (HIGH, reproduced end-to-end): F2 was only half closed.
  // ensureIndexDir containment-checked the .index DIRECTORY, but nothing checked the DATABASE
  // FILE inside it, so a planted `<userRoot>/.index/notes.db` symlink pointed one tenant's
  // index at another's — A's search returned B's rows (audited "ok"), and A's next write
  // injected rows into B's database. The jail now checks the db file and its SQLite sidecars at
  // file granularity, exactly like notePath.
  // ---------------------------------------------------------------------------------------

  it('E3 review 1: a notes.db SYMLINKED at another tenant\'s index fails closed on SEARCH - no read leak', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    await seedOverlappingTenants(tA, tB);
    // Materialise B's real index, then point A's db path straight at it.
    expect((await searchAs(tB, 'comum')).status).toBe(200);
    expect(existsSync(dbFileFor('usrB'))).toBe(true);
    rmSync(join(vaultRoot, 'usrA', '.index'), { recursive: true, force: true });
    mkdirSync(join(vaultRoot, 'usrA', '.index'), { recursive: true });
    symlinkSync(dbFileFor('usrB'), dbFileFor('usrA'));

    // A's search fails closed — it does NOT return B's rows.
    const res = await searchAs(tA, 'comum');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toBe(MISSING_404);
    expect(body).not.toContain('BBBUNICOB');
    expect(body).not.toContain('Projeto Comum B');
    // B's unique token stays invisible to A through the planted link.
    const targeted = await searchAs(tA, 'bbbunicob');
    expect(targeted.status).toBe(404);
    expect(await targeted.text()).toBe(MISSING_404);

    // The audit names it an escape, not an ok search and not a mere index hiccup.
    const rows = await activityLogs.find({ category: 'memvault' } as never);
    const aSearches = rows
      .map((r) => r as unknown as { userId: string; metadata: { op: string; verdict: string } })
      .filter((r) => r.userId === 'usrA' && r.metadata.op === 'search');
    expect(aSearches).toHaveLength(2);
    for (const r of aSearches) expect(r.metadata.verdict).toBe('jail_violation');
    // B is untouched and still owns its own rows.
    expect((await hitsOf(await searchAs(tB, 'bbbunicob'))).length).toBe(2);
  });

  it('E3 review 1: a notes.db SYMLINKED at another tenant\'s index fails closed on WRITE - no index poisoning', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    await seedOverlappingTenants(tA, tB);
    expect((await searchAs(tB, 'comum')).status).toBe(200);
    rmSync(join(vaultRoot, 'usrA', '.index'), { recursive: true, force: true });
    mkdirSync(join(vaultRoot, 'usrA', '.index'), { recursive: true });
    symlinkSync(dbFileFor('usrB'), dbFileFor('usrA'));

    // A writes a note carrying a marker. The MARKDOWN is A's own and must land (200) — only the
    // derived index is under attack.
    const wrote = await writeNote(tA, { permalink: 'ataque/nota', title: 'Ataque', contentMd: 'VENENO_DE_A' });
    expect(wrote.status).toBe(200);
    expect(existsSync(join(vaultRoot, 'usrA', 'ataque', 'nota.md'))).toBe(true);

    // B's index must NOT have been poisoned: B cannot see A's marker, and B's own rows survive.
    expect(await hitsOf(await searchAs(tB, 'veneno'))).toEqual([]);
    expect(await hitsOf(await searchAs(tB, 'ataque'))).toEqual([]);
    expect((await hitsOf(await searchAs(tB, 'comum'))).map((h) => h.permalink)).toEqual(['partilhado/nota']);
    expect((await hitsOf(await searchAs(tB, 'bbbunicob'))).length).toBe(2);

    // The refused index update is audited as an escape (verdict jail_violation on the index op),
    // while the write itself stays ok — the note is legitimately A's.
    const rows = await activityLogs.find({ category: 'memvault' } as never);
    const aRows = rows
      .map((r) => r as unknown as { userId: string; metadata: { op: string; verdict: string; permalink?: string } })
      .filter((r) => r.userId === 'usrA' && r.metadata.permalink === 'ataque/nota');
    expect(aRows.map((r) => `${r.metadata.op}:${r.metadata.verdict}`).sort()).toEqual(['index:jail_violation', 'write:ok']);
  });

  it('E3 review 1: a notes.db symlinked OUTSIDE the vault root fails closed and is never written', async () => {
    const tA = await tokenFor('usrA');
    const outside = join(tmpdir(), `ekoa-memvault-outside-${process.pid}.db`);
    rmSync(outside, { force: true });
    expect((await writeNote(tA, { permalink: 'so-do-a/nota', title: 'A', contentMd: 'conteudo de A' })).status).toBe(200);
    rmSync(join(vaultRoot, 'usrA', '.index'), { recursive: true, force: true });
    mkdirSync(join(vaultRoot, 'usrA', '.index'), { recursive: true });
    symlinkSync(outside, dbFileFor('usrA'));

    const res = await searchAs(tA, 'conteudo');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(MISSING_404);
    // Nothing was created at the escape target — not the db, not its sidecars.
    for (const suffix of ['', '-wal', '-shm', '-journal']) expect(existsSync(`${outside}${suffix}`), suffix).toBe(false);
    // A's markdown is untouched: reads and list still work, only the index path is refused.
    expect((await authed('/api/v1/memvault/note?permalink=so-do-a/nota', tA)).status).toBe(200);
    rmSync(outside, { force: true });
  });

  it('E3 index recovery: a CORRUPT db file is quarantined and rebuilt - no crash, no leak', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    await seedOverlappingTenants(tA, tB);
    const before = await hitsOf(await searchAs(tA, 'comum'));
    expect(before.length).toBe(2);
    const realDb = readFileSync(dbFileFor('usrA'));
    expect(realDb.subarray(0, 15).toString()).toBe('SQLite format 3');

    // Two flavours of a broken index, each replacing the file (a new inode, which is what a
    // hostile or crashed writer actually produces).
    for (const payload of [
      Buffer.from('isto nao e uma base de dados, apenas ruido BBBUNICOB'), // garbage + a poisoned token
      realDb.subarray(0, 200), // a truncated real database
      Buffer.alloc(0), // an empty file
    ]) {
      rmSync(join(vaultRoot, 'usrA', '.index'), { recursive: true, force: true });
      mkdirSync(join(vaultRoot, 'usrA', '.index'), { recursive: true });
      writeFileSync(dbFileFor('usrA'), payload);
      const res = await searchAs(tA, 'comum');
      expect(res.status, payload.length.toString()).toBe(200); // no crash, no 500
      const hits = await hitsOf(res);
      expect(hits.map((h) => h.permalink).sort()).toEqual(before.map((h) => h.permalink).sort());
      // The corrupt bytes are not searchable content and never leak into a result.
      expect(await hitsOf(await searchAs(tA, 'bbbunicob'))).toEqual([]);
      expect(await hitsOf(await searchAs(tA, 'ruido'))).toEqual([]);
      // A healthy sqlite file is back in place.
      expect(readFileSync(dbFileFor('usrA')).subarray(0, 15).toString()).toBe('SQLite format 3');
    }
    // B is unaffected throughout.
    expect((await hitsOf(await searchAs(tB, 'bbbunicob'))).length).toBe(2);
  });

  // ---------------------------------------------------------------------------------------
  // E3 fresh-context review, finding 2 (MEDIUM, reproduced under ordinary load): the bounded
  // handle cache evicted by calling db.close() on the OLDEST entry, while useIndex held that
  // same handle across an await. With more concurrent tenants than the bound, 8 of 40
  // LEGITIMATE own-vault searches answered HTTP 500 ("The database connection is not open").
  // Handles are now reference-counted and only idle entries are ever evicted.
  // ---------------------------------------------------------------------------------------

  it('E3 review 2: concurrent cold searches ACROSS MORE TENANTS THAN THE HANDLE CACHE BOUND all succeed', async () => {
    const TENANTS = 40; // > MAX_OPEN (32) in fts.ts, so eviction is guaranteed to run
    const NOTES = 25; // the fill must still be IN FLIGHT when a later tenant triggers eviction
    const ids = Array.from({ length: TENANTS }, (_, i) => `usrC${String(i).padStart(2, '0')}`);
    const passwordHash = await hashPassword('pw123456'); // hashed ONCE: 40 bcrypts would dominate
    for (const id of ids) {
      await users.insert({ _id: id, username: id, passwordHash, role: 'user', orgId: 'orgA', active: true } as never);
      setActivation(id, { active: true, billingLocked: false });
      await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
    }
    const tokens = await Promise.all(ids.map((id) => tokenFor(id)));

    // Build one tenant's corpus over HTTP, then COPY the markdown to the other 39 — 1000 real
    // writes would make this a minutes-long test without making it a better probe. Each tenant
    // then adds one note over HTTP carrying a marker unique to it.
    const first = tokens[0] as string;
    for (let n = 0; n < NOTES; n++) {
      expect((await writeNote(first, { permalink: `carga/n${String(n).padStart(2, '0')}`, title: `Carga ${n}`, contentMd: `documento partilhado numero ${n}` })).status).toBe(200);
    }
    for (const id of ids.slice(1)) {
      cpSync(join(vaultRoot, ids[0] as string), join(vaultRoot, id), { recursive: true });
      rmSync(join(vaultRoot, id, '.index'), { recursive: true, force: true });
    }
    await Promise.all(
      tokens.map(async (t, i) => {
        expect((await writeNote(t, { permalink: 'carga/marca', title: `Marca ${i}`, contentMd: `documento com marca UNICO${i}` })).status).toBe(200);
      }),
    );

    // COLD: drop every cached handle AND every on-disk index, so all 40 searches race through
    // acquire + a 26-note fill together — the window the eviction bug lived in.
    closeAllIndexes();
    for (const id of ids) rmSync(join(vaultRoot, id, '.index'), { recursive: true, force: true });
    await activityLogs.deleteMany({});

    const results = await Promise.all(tokens.map((t) => searchAs(t, 'documento', 100)));
    expect(results.map((r) => r.status).filter((s) => s !== 200)).toEqual([]); // ZERO 500s - the point
    const bodies = await Promise.all(results.map((r) => hitsOf(r)));
    bodies.forEach((hits, i) => {
      expect(hits.length, ids[i]).toBe(NOTES + 1); // every tenant sees its OWN complete vault
    });
    // ...and only its own marker.
    const mine = await hitsOf(await searchAs(first, 'unico0'));
    expect(mine.map((h) => h.permalink)).toEqual(['carga/marca']);
    expect(await hitsOf(await searchAs(first, 'unico17'))).toEqual([]);

    // No search was degraded into an index failure or an error.
    const rows = await activityLogs.find({ category: 'memvault' } as never);
    const verdicts = rows.map((r) => (r as unknown as { metadata: { verdict: string } }).metadata.verdict);
    expect(verdicts.filter((v) => v !== 'ok')).toEqual([]);
  }, 180_000);

  // ---------------------------------------------------------------------------------------
  // E3 fresh-context review, finding 3 (MEDIUM, reproduced): a failed index update was
  // swallowed into an index_failed row whose docstring promised "the next search repairs the
  // drift" - it did not. acquire only refilled a MISSING/empty/corrupt db, so a valid-but-stale
  // one was never rebuilt and every later search under-reported the user's own vault, across
  // restarts. Two mechanisms now close it: invalidate (discard on failure) and a row-count
  // reconcile against the markdown on every cache miss.
  // ---------------------------------------------------------------------------------------

  it('E3 review 3: after a FAILED index write, a later search returns the COMPLETE set', async () => {
    const tA = await tokenFor('usrA');
    expect((await writeNote(tA, { permalink: 'notas/uma', title: 'Uma', contentMd: 'documento um' })).status).toBe(200);
    expect((await writeNote(tA, { permalink: 'notas/duas', title: 'Duas', contentMd: 'documento dois' })).status).toBe(200);
    expect((await hitsOf(await searchAs(tA, 'documento'))).length).toBe(2);
    await activityLogs.deleteMany({});

    // The index update for the third note fails. The MARKDOWN must still land and the call must
    // still be a 200 - that part was always right.
    faults.indexThrows = true;
    const wrote = await writeNote(tA, { permalink: 'notas/tres', title: 'Tres', contentMd: 'documento tres' });
    faults.indexThrows = false;
    expect(wrote.status).toBe(200);
    expect(existsSync(join(vaultRoot, 'usrA', 'notas', 'tres.md'))).toBe(true);

    // Exactly one index_failed row, and the write itself stayed ok.
    const rows = await activityLogs.find({ category: 'memvault' } as never);
    const metas = rows.map((r) => (r as unknown as { metadata: { op: string; verdict: string } }).metadata);
    expect(metas.filter((m) => m.verdict === 'index_failed')).toHaveLength(1);
    expect(metas.filter((m) => m.op === 'write' && m.verdict === 'ok')).toHaveLength(1);

    // THE DEFECT: this used to return 2 forever. The next search must see all three.
    const hits = await hitsOf(await searchAs(tA, 'documento'));
    expect(hits.map((h) => h.permalink).sort()).toEqual(['notas/duas', 'notas/tres', 'notas/uma']);
    // ...and the note is individually findable, not merely counted.
    expect((await hitsOf(await searchAs(tA, 'tres'))).map((h) => h.permalink)).toEqual(['notas/tres']);
  });

  it('E3 review 3: staleness heals across a RESTART even when the index could not be discarded', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    expect((await writeNote(tB, { permalink: 'de-b/nota', title: 'B', contentMd: 'documento de B' })).status).toBe(200);
    for (const n of ['uma', 'duas']) {
      expect((await writeNote(tA, { permalink: `notas/${n}`, title: n, contentMd: `documento ${n}` })).status).toBe(200);
    }
    expect((await hitsOf(await searchAs(tA, 'documento'))).length).toBe(2);

    // A failed index write where the DISCARD also fails (a read-only .index, a vanished mount):
    // the stale database survives on disk, valid and non-empty.
    faults.indexThrows = true;
    faults.invalidateThrows = true;
    expect((await writeNote(tA, { permalink: 'notas/tres', title: 'tres', contentMd: 'documento tres' })).status).toBe(200);
    faults.indexThrows = false;
    faults.invalidateThrows = false;
    expect(existsSync(dbFileFor('usrA'))).toBe(true);
    expect(readFileSync(dbFileFor('usrA')).subarray(0, 15).toString()).toBe('SQLite format 3');

    // Simulate a process restart: every handle gone, nothing in memory to remember the failure.
    closeAllIndexes();

    // The row-count reconcile against the markdown catches it with no marker of any kind.
    const hits = await hitsOf(await searchAs(tA, 'documento'));
    expect(hits.map((h) => h.permalink).sort()).toEqual(['notas/duas', 'notas/tres', 'notas/uma']);
    // The rebuild read A's tree and only A's tree.
    expect(await hitsOf(await searchAs(tA, 'de-b'))).toEqual([]);
    expect((await hitsOf(await searchAs(tB, 'documento'))).map((h) => h.permalink)).toEqual(['de-b/nota']);
  });

  it('E3: rebuild() re-indexes one tenant from the markdown and touches no other', async () => {
    const tA = await tokenFor('usrA');
    const tB = await tokenFor('usrB');
    await seedOverlappingTenants(tA, tB);
    expect((await searchAs(tA, 'comum')).status).toBe(200);
    expect((await searchAs(tB, 'comum')).status).toBe(200);

    expect(await rebuild('usrA')).toBe(2); // A's two notes, counted from the files
    expect(await rebuild('usrB')).toBe(2);
    // Still strictly partitioned after an explicit rebuild of both.
    expect(await hitsOf(await searchAs(tA, 'bbbunicob'))).toEqual([]);
    expect((await hitsOf(await searchAs(tA, 'aaaunicoa'))).map((h) => h.permalink)).toEqual(['partilhado/nota']);
    expect((await hitsOf(await searchAs(tB, 'bbbunicob'))).length).toBe(2);
  });
});
