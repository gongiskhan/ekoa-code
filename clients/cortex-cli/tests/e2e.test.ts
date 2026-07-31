import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * END-TO-END: the BUILT `cortex` binary against the REAL Cortex routers.
 *
 * The api app is booted in-process over mongodb-memory-server exactly the way the api contract
 * suites do, a REAL `ekoa_gk_` gateway key is minted through POST /api/v1/gateway-keys, and every
 * assertion below comes from running `bin/cortex.mjs` as a child process against that server -
 * so this exercises argv parsing, the generated client, HTTP, the server, and the process exit
 * code, with nothing stubbed.
 *
 * These test files are the ONE place in clients/ allowed to import api/ (the lint zone targets
 * clients/<pkg>/src + bin, the shipped code): a harness that boots the provider is not a consumer
 * reaching into it, and the same carve-out lets api/tests import server.ts.
 */
import { connectMongo, closeMongo } from '../../../api/src/data/mongo.js';
import { users, orgs, gatewayKeys, activityLogs, userSettings } from '../../../api/src/data/stores.js';
import { setActivation } from '../../../api/src/data/activation.js';
import { __resetCapabilityRateForTests } from '../../../api/src/auth/api-key-rate.js';
import { login } from '../../../api/src/auth/service.js';
import { hashPassword } from '../../../api/src/auth/password.js';
import { buildApp } from '../../../api/src/server.js';
import { closeAllIndexes } from '../../../api/src/memvault/fts.js';
import { closeIndex } from '../../../api/src/knowledge/index-store.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../../api/src/config.js';
import { MongoMemoryServer } from 'mongodb-memory-server';

const BIN = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const DIST = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let mem: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let apiKey: string;
let jwt: string;
let dataDir: string;
let vaultRoot: string;
let workDir: string;
let automationId: string;
let docId: string;

let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  bytes: Buffer;
}

/**
 * Run the real binary. Async on purpose: the api server lives in THIS process's event loop, so a
 * blocking spawnSync would deadlock against the request the child is making.
 */
function cortex(args: string[], opts: { env?: Record<string, string | undefined>; stdin?: string } = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      CORTEX_BASE_URL: baseUrl,
      CORTEX_API_KEY: apiKey,
      ...opts.env,
    };
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      const bytes = Buffer.concat(out);
      resolve({ code: code ?? -1, stdout: bytes.toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), bytes });
    });
    if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}

/** The single JSON document a `--json` invocation prints on stdout. */
function jsonOf(res: CliResult): Record<string, unknown> {
  expect(res.stderr, res.stderr).toBe('');
  return JSON.parse(res.stdout) as Record<string, unknown>;
}

const authed = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}`, ...(init.headers ?? {}) },
  });

beforeAll(async () => {
  if (!existsSync(DIST)) {
    throw new Error(`the CLI is not built (${DIST} missing). Run: npm run build --workspace @ekoa/cortex-cli`);
  }
  workDir = mkdtempSync(join(tmpdir(), 'cortex-cli-e2e-'));
  vaultRoot = join(workDir, 'memvault');
  dataDir = join(workDir, 'data');
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  process.env.EKOA_MEMVAULT_ROOT = vaultRoot;
  process.env.EKOA_DATA_DIR = dataDir;
  __resetConfigForTests();
  loadConfig();
  __resetCapabilityRateForTests();

  mem = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await connectMongo(mem.getUri(), 'ekoa_cortex_cli_e2e');
  await orgs.insert({ _id: 'o1', name: 'orgA' } as never);
  await users.insert({
    _id: 'usr',
    username: 'usr',
    passwordHash: await hashPassword('pw123456'),
    role: 'org-admin',
    orgId: 'o1',
    active: true,
  } as never);
  setActivation('usr', { active: true, billingLocked: false });
  await userSettings.put({ _id: 'usr', memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);

  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  jwt = (await login('usr', 'pw123456', false, deps)).token;

  // A REAL key: minting needs a platform session and is deliberately NOT on the key-reachable
  // surface, so the CLI can never bootstrap one - it is always handed one, as here.
  const minted = await authed('/api/v1/gateway-keys', { method: 'POST', body: JSON.stringify({ label: 'cortex-cli-e2e' }) });
  expect(minted.status).toBe(201);
  apiKey = ((await minted.json()) as { key: string }).key;
  expect(apiKey.startsWith('ekoa_gk_')).toBe(true);

  // Fixtures the key-reachable surface can only READ: a knowledge document and an automation.
  const doc = await authed('/api/v1/knowledge/documents', {
    method: 'POST',
    body: JSON.stringify({ collection: 'jurisprudencia', title: 'Prazos de recurso', text: 'o prazo de recurso é de 30 dias, palavra ZEBRAQUIX' }),
  });
  expect(doc.status).toBe(201);
  docId = ((await doc.json()) as { id: string }).id;

  const automation = await authed('/api/v1/automations', { method: 'POST', body: JSON.stringify({ name: 'CLI E2E' }) });
  expect(automation.status).toBe(201);
  automationId = ((await automation.json()) as { id: string }).id;
}, 120_000);

afterAll(async () => {
  server?.close();
  closeAllIndexes();
  closeIndex();
  await closeMongo();
  await mem?.stop();
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.EKOA_MEMVAULT_ROOT;
  delete process.env.EKOA_DATA_DIR;
});

describe('cortex memory (memvault) through the real binary', () => {
  it('write --file --permalink --json: the spool-drain invocation, verbatim', async () => {
    const file = join(workDir, 'capture-1.md');
    writeFileSync(file, '# Captura um\n\ncorpo capturado ZEBRAQUIX\n', 'utf8');

    const res = await cortex(['memory', 'write', '--file', file, '--permalink', 'capture/one', '--json']);
    expect(res.code).toBe(0);
    const doc = jsonOf(res);
    expect(doc).toMatchObject({ ok: true, command: 'memory write', status: 200 });
    expect(doc.data).toMatchObject({ permalink: 'capture/one', title: 'Captura um', type: 'note' });

    // The permalink IS the dedupe key: the same invocation twice leaves ONE note.
    const again = await cortex(['memory', 'write', '--file', file, '--permalink', 'capture/one', '--json']);
    expect(again.code).toBe(0);
    const list = jsonOf(await cortex(['memory', 'list', '--json']));
    const items = (list.data as { items: Array<{ permalink: string }> }).items;
    expect(items.filter((i) => i.permalink === 'capture/one')).toHaveLength(1);
  });

  it('read: the body comes back byte-for-byte, in --json and in human form', async () => {
    const res = jsonOf(await cortex(['memory', 'read', 'capture/one', '--json']));
    expect((res.data as { contentMd: string }).contentMd).toBe('# Captura um\n\ncorpo capturado ZEBRAQUIX\n');

    const human = await cortex(['memory', 'read', 'capture/one']);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain('# Captura um');
    expect(human.stdout).toContain('permalink: capture/one');
  });

  it('write --stdin + list + search: a second note is indexed and found by a distinctive term', async () => {
    const wrote = await cortex(['memory', 'write', '--permalink', 'capture/two', '--title', 'Captura dois', '--stdin', '--tag', 'spool', '--json'], {
      stdin: 'corpo dois com XPTOUNICO\n',
    });
    expect(wrote.code).toBe(0);
    expect((jsonOf(wrote).data as { tags: string[] }).tags).toEqual(['spool']);

    const found = jsonOf(await cortex(['memory', 'search', 'xptounico', '--json']));
    const hits = (found.data as { hits: Array<{ permalink: string }> }).hits;
    expect(hits.map((h) => h.permalink)).toEqual(['capture/two']);

    const human = await cortex(['memory', 'list']);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain('capture/one');
    expect(human.stdout).toContain('capture/two');
  });

  it('export: the binary path writes a real tar to --out, and streams raw bytes to stdout with --out -', async () => {
    const out = join(workDir, 'vault.tar');
    const res = await cortex(['memory', 'export', '--out', out, '--json']);
    expect(res.code).toBe(0);
    const doc = jsonOf(res);
    expect(doc).toMatchObject({ ok: true, command: 'memory export', status: 200, out });
    expect(doc.bytes as number).toBeGreaterThan(0);

    const tar = readFileSync(out);
    expect(tar.subarray(257, 262).toString('utf8')).toBe('ustar'); // the ustar magic, i.e. a real tar
    expect(tar.subarray(0, 100).toString('utf8').replace(/\0+$/, '')).toContain('capture/one.md');
    expect(tar.includes(Buffer.from('corpo capturado ZEBRAQUIX'))).toBe(true);

    const streamed = await cortex(['memory', 'export', '--out', '-']);
    expect(streamed.code).toBe(0);
    expect(streamed.bytes.equals(tar)).toBe(true);
  });

  it('delete: the note goes, and reading it back is exit 1 with the shared NOT_FOUND envelope', async () => {
    expect((await cortex(['memory', 'delete', 'capture/two', '--json'])).code).toBe(0);

    const gone = await cortex(['memory', 'read', 'capture/two', '--json']);
    expect(gone.code).toBe(1);
    expect(gone.stdout).toBe(''); // --json never contaminates stdout with an error
    expect(JSON.parse(gone.stderr)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', status: 404 } });
  });
});

describe('cortex knowledge through the real binary', () => {
  it('collections, documents, search and read all answer over a gateway key', async () => {
    const collections = jsonOf(await cortex(['knowledge', 'collections', '--json']));
    expect((collections.data as { items: string[] }).items).toContain('jurisprudencia');

    const documents = jsonOf(await cortex(['knowledge', 'documents', '--collection', 'jurisprudencia', '--json']));
    expect((documents.data as { items: Array<{ id: string }> }).items.map((d) => d.id)).toContain(docId);

    const search = jsonOf(await cortex(['knowledge', 'search', 'zebraquix', '--json']));
    const hits = (search.data as { hits: Array<{ docId: string; collection: string; scope: string }> }).hits;
    expect(hits.map((h) => h.docId)).toContain(docId);
    expect(hits[0]?.scope).toBe('org');

    const read = jsonOf(await cortex(['knowledge', 'read', 'jurisprudencia', docId, '--json']));
    expect(read.data).toMatchObject({ id: docId, collection: 'jurisprudencia', scope: 'org' });
    expect((read.data as { contentMd: string }).contentMd).toContain('30 dias');
  });

  it('a document that does not exist is exit 1, not a crash', async () => {
    const res = await cortex(['knowledge', 'read', 'jurisprudencia', 'nao-existe', '--json']);
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stderr)).toMatchObject({ ok: false, error: { status: 404 } });
  });
});

describe('cortex automations through the real binary', () => {
  it('list + show reach the automation created for this run', async () => {
    const list = jsonOf(await cortex(['automations', 'list', '--json']));
    expect((list.data as { items: Array<{ id: string }> }).items.map((a) => a.id)).toContain(automationId);

    const show = jsonOf(await cortex(['automations', 'show', automationId, '--json']));
    expect(show.data).toMatchObject({ id: automationId, name: 'CLI E2E' });
  });

  it('run: 202 is a fresh run and 200 an idempotent replay, and --json says which', async () => {
    const fresh = await cortex(['automations', 'run', automationId, '--idempotency-key', 'cli-e2e-1', '--json']);
    expect(fresh.code).toBe(0);
    const freshDoc = jsonOf(fresh);
    expect(freshDoc).toMatchObject({ ok: true, command: 'automations run', status: 202, created: true, replayed: false });
    const runId = (freshDoc.data as { runId: string }).runId;

    const replay = await cortex(['automations', 'run', automationId, '--idempotency-key', 'cli-e2e-1', '--json']);
    expect(replay.code).toBe(0);
    const replayDoc = jsonOf(replay);
    expect(replayDoc).toMatchObject({ status: 200, created: false, replayed: true });
    expect((replayDoc.data as { runId: string }).runId).toBe(runId);

    // The distinction survives into human output too.
    const human = await cortex(['automations', 'run', automationId, '--idempotency-key', 'cli-e2e-1']);
    expect(human.stdout).toContain('replayed run');
    expect(human.stdout).toContain('idempotent');
  });

  it('watch POLLS the run to a terminal state, then status and logs agree with it', async () => {
    const started = jsonOf(await cortex(['automations', 'run', automationId, '--json']));
    const runId = (started.data as { runId: string }).runId;

    const watched = jsonOf(await cortex(['automations', 'watch', runId, '--interval-ms', '100', '--timeout-ms', '20000', '--json']));
    expect(watched).toMatchObject({ ok: true, command: 'automations watch', terminal: true, blocked: false });
    expect(watched.polls as number).toBeGreaterThanOrEqual(1);
    expect((watched.data as { id: string; status: string }).id).toBe(runId);
    expect(['completed', 'failed', 'cancelled']).toContain((watched.data as { status: string }).status);

    const status = jsonOf(await cortex(['automations', 'status', runId, '--json']));
    expect((status.data as { status: string }).status).toBe((watched.data as { status: string }).status);

    const logs = jsonOf(await cortex(['automations', 'logs', runId, '--json']));
    expect(logs.data).toMatchObject({ runId });
    expect(Array.isArray((logs.data as { steps: unknown[] }).steps)).toBe(true);
  });

  it('watch surfaces a refusal instead of polling forever (the run-timeout path is unit-tested)', async () => {
    const res = await cortex(['automations', 'watch', 'nao-existe', '--interval-ms', '100', '--timeout-ms', '500', '--json']);
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stderr)).toMatchObject({ ok: false, error: { status: 404 } });
  });
});

describe('credentials, exit codes and the audit trail', () => {
  it('a wrong key is exit 1 with a 401 envelope; a missing key is exit 2 before any request', async () => {
    const bad = await cortex(['memory', 'list', '--json'], { env: { CORTEX_API_KEY: 'ekoa_gk_definitely-not-a-key' } });
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stderr)).toMatchObject({ ok: false, error: { status: 401 } });

    const missing = await cortex(['memory', 'list', '--json'], { env: { CORTEX_API_KEY: undefined } });
    expect(missing.code).toBe(2);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toContain('CORTEX_API_KEY');

    const noOrigin = await cortex(['memory', 'list'], { env: { CORTEX_BASE_URL: undefined } });
    expect(noOrigin.code).toBe(2);
    expect(noOrigin.stderr).toContain('CORTEX_BASE_URL');
  });

  it('a usage mistake is exit 2 and never reaches the server', async () => {
    for (const argv of [['memory'], ['memory', 'frobnicate'], ['memory', 'read'], ['nope', 'x'], ['memory', 'list', '--nope']]) {
      const res = await cortex(argv);
      expect(res.code, argv.join(' ')).toBe(2);
    }
  });

  it('every call is attributed to the KEY and tagged with the trace-only X-Client header', async () => {
    const rows = await activityLogs.find({ category: 'memvault' } as never);
    const metas = rows.map((r) => (r as unknown as { metadata: { keyId?: string; xClient?: string } }).metadata);
    expect(metas.length).toBeGreaterThan(0);
    const version = (JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string }).version;
    for (const meta of metas) {
      expect(meta.keyId, JSON.stringify(meta)).toBeTruthy();
      expect(meta.xClient).toBe(`cortex-cli/${version}`);
    }
    // The key really is the principal on the wire: the minted key id is the one audited.
    const keys = await gatewayKeys.find({} as never);
    expect(keys).toHaveLength(1);
    expect(new Set(metas.map((m) => m.keyId))).toEqual(new Set([(keys[0] as unknown as { _id: string })._id]));
  });
});
