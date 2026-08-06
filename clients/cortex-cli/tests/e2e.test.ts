import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
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

/**
 * Run the real binary under `sh -c`, so a real SHELL PIPELINE can be exercised. Resolves with the
 * shell's own exit code plus whatever the child wrote to the shared stderr.
 */
function shell(script: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CORTEX_BASE_URL: baseUrl, CORTEX_API_KEY: apiKey };
    const child = spawn('sh', ['-c', script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }),
    );
  });
}

/** Spawn the binary and CLOSE THE READ END immediately - a reader that walks away, deterministically. */
function cortexWithClosedStdout(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CORTEX_BASE_URL: baseUrl, CORTEX_API_KEY: apiKey };
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const err: Buffer[] = [];
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.stdout.destroy(); // before the child has even finished booting
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stderr: Buffer.concat(err).toString('utf8') }));
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

/**
 * The integrations group against the REAL router, with no integration connected - which is exactly
 * the state that produces both of this group's traps, so neither has to be simulated:
 *
 *   - a read-only action on a disconnected integration is an HTTP 200 saying `success: false`;
 *   - a mutating one is refused by the write gate BEFORE any credential is looked at, as a 403
 *     carrying the descriptor a human must answer.
 *
 * The action names are read out of `show` rather than hardcoded: the shipped package is the
 * platform's to change, and a client that pins its action names breaks when it does.
 */
describe('cortex integrations through the real binary', () => {
  interface CapabilityAction {
    actionName: string;
    requiresApproval: boolean;
    approved: boolean;
    target: string;
  }
  let readOnly: CapabilityAction;
  let mutating: CapabilityAction;

  it('list and show answer over a gateway key, and report the integration as not connected', async () => {
    const list = jsonOf(await cortex(['integrations', 'list', '--json']));
    expect((list.data as { items: Array<{ key: string }> }).items.map((i) => i.key)).toContain('slack');

    const show = jsonOf(await cortex(['integrations', 'show', 'slack', '--json']));
    const capability = show.data as { connected: boolean; actions: CapabilityAction[] };
    expect(capability.connected).toBe(false); // nothing was configured for this org
    readOnly = capability.actions.find((a) => !a.requiresApproval) as CapabilityAction;
    mutating = capability.actions.find((a) => a.requiresApproval) as CapabilityAction;
    expect(readOnly, 'the fixture needs one action outside the write gate').toBeTruthy();
    expect(mutating, 'the fixture needs one action behind the write gate').toBeTruthy();

    // Human mode names the trap the JSON only implies.
    const human = await cortex(['integrations', 'show', 'slack']);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain('connected: no');
    expect(human.stdout).toContain('needs-approval');
  });

  it('a not-connected action comes back HTTP 200 with success:false - and that is exit 1', async () => {
    const res = await cortex(['integrations', 'execute', 'slack', readOnly.actionName, '--json']);
    expect(res.code, 'a 200 whose body says success:false must not exit 0').toBe(1);
    expect(res.stdout, 'stdout stays empty on a failure').toBe('');
    const doc = JSON.parse(res.stderr) as { ok: boolean; error: { code: string; details?: { success: boolean } } };
    expect(doc.ok).toBe(false);
    expect(doc.error.code).toBe('not_connected');
    expect(doc.error.details?.success).toBe(false);
  });

  it('a mutating action is refused by the write gate, with the descriptor the human must see', async () => {
    const res = await cortex(['integrations', 'execute', 'slack', mutating.actionName, '--json']);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe('');
    const doc = JSON.parse(res.stderr) as {
      error: { status: number; details?: { code: string; consentRequest?: Record<string, string> } };
    };
    expect(doc.error.status).toBe(403);
    expect(doc.error.details?.code).toBe('awaiting_consent');
    expect(doc.error.details?.consentRequest).toMatchObject({
      integrationKey: 'slack',
      actionName: mutating.actionName,
      target: mutating.target,
    });
    expect(typeof doc.error.details?.consentRequest?.shape).toBe('string');

    // And the human is told both what would have run and that this CLI cannot approve it.
    const human = await cortex(['integrations', 'execute', 'slack', mutating.actionName]);
    expect(human.code).toBe(1);
    expect(human.stdout).toBe('');
    expect(human.stderr).toContain(mutating.target);
    expect(human.stderr).toContain('CANNOT grant that approval');
  });

  it('the approval endpoint really is off the key-reachable surface, so the refusal cannot self-clear', async () => {
    // The gate would be theatre if the key it just refused could bank its own approval.
    const res = await fetch(`${baseUrl}/api/v1/integrations/slack/actions/${mutating.actionName}/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ decision: 'always', shape: 'whatever' }),
    });
    expect(res.status).toBe(401);
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

  /**
   * E7 review F1, through the process boundary and against a HOSTILE ORIGIN. `CORTEX_BASE_URL` is
   * caller-supplied and deliberately unvalidated, so a typo'd or malicious origin receives the
   * `Authorization: Bearer <key>` header on the FIRST call and can echo it straight back; the CLI
   * used to quote that body into an error message and print it on stderr.
   */
  it('F1: an origin that reflects the auth header never gets the key printed back out', async () => {
    const reflector = createServer((req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream exploded', youSent: req.headers }));
    });
    await new Promise<void>((r) => reflector.listen(0, '127.0.0.1', () => r()));
    const origin = `http://127.0.0.1:${(reflector.address() as { port: number }).port}`;
    try {
      for (const argv of [
        ['memory', 'list', '--json'],
        ['memory', 'list'],
      ]) {
        const res = await cortex(argv, { env: { CORTEX_BASE_URL: origin } });
        expect(res.code, argv.join(' ')).toBe(1);
        const printed = `${res.stdout}${res.stderr}`;
        expect(printed, argv.join(' ')).not.toContain(apiKey);
        expect(printed, argv.join(' ')).not.toContain(apiKey.slice(8, 24));
        expect(res.stderr).toContain('<redacted>'); // the reflection is reported, just defused
      }
    } finally {
      await new Promise<void>((r) => reflector.close(() => r()));
    }
  });

  /**
   * E7 review F2, against the REAL transport: undici's header validation quotes the value it
   * rejected, so a key carrying an interior newline (a line-wrapped secret, a CRLF from a
   * Windows-authored env file) printed verbatim. `requiredEnv` only trims the ends, by design.
   */
  it('F2: a key with an interior newline is refused WITHOUT printing the key', async () => {
    const wrapped = 'ekoa_gk_SUPERSECRET\nVALUE123';
    for (const argv of [
      ['memory', 'list', '--json'],
      ['memory', 'list'],
    ]) {
      const res = await cortex(argv, { env: { CORTEX_API_KEY: wrapped } });
      expect(res.code, argv.join(' ')).toBe(1);
      expect(res.stderr, argv.join(' ')).not.toContain('SUPERSECRET');
      expect(res.stdout).not.toContain('SUPERSECRET');
      expect(res.stderr).toContain('<redacted>');
    }
  });

  /**
   * E7 review F3: the pipe patterns SKILL.md documents. An early-closing reader used to raise EPIPE
   * on a stream with no error listener - an uncaught exception, i.e. a raw Node stack on stderr and
   * an exit code that never came from main(), bypassing the three-code contract entirely.
   */
  it('F3: a reader that closes early ends the process quietly, with no stack trace', async () => {
    const bin = JSON.stringify(BIN);
    const node = JSON.stringify(process.execPath);

    // The exact pipeline SKILL.md documents, on the binary (tar) path.
    const tarPipe = await shell(`${node} ${bin} memory export --out - | head -c 10`);
    expect(tarPipe.stderr).not.toMatch(/EPIPE|Error:|at .*\(/);
    expect(tarPipe.code).toBe(0);

    // …and on the --json path, which pipes into head just as often.
    const jsonPipe = await shell(`${node} ${bin} memory list --json | head -c 20`);
    expect(jsonPipe.stderr).not.toMatch(/EPIPE|Error:|at .*\(/);
    expect(jsonPipe.code).toBe(0);

    // Deterministic version of the same failure: the read end is gone before the first write.
    for (const argv of [
      ['memory', 'export', '--out', '-'],
      ['memory', 'list', '--json'],
      ['memory', 'list'],
    ]) {
      const closed = await cortexWithClosedStdout(argv);
      expect(closed.stderr, argv.join(' ')).not.toMatch(/EPIPE|Error:|at .*\(/);
      expect(closed.code, argv.join(' ')).toBe(0);
    }
  });

  /** E7 review F4, against the real server: exit 2 means the vault was never exported. */
  it('F4: export refuses a contradictory invocation before spending a real export', async () => {
    const before = await activityLogs.find({ category: 'memvault' } as never);
    const exportsBefore = before.filter((r) => (r as unknown as { type: string }).type === 'memvault_export').length;

    for (const argv of [
      ['memory', 'export'],
      ['memory', 'export', '--out', '-', '--json'],
      ['memory', 'export', '--out', join(workDir, 'nope', 'x.tar'), '--json'],
    ]) {
      const res = await cortex(argv);
      expect(res.code, argv.join(' ')).toBe(2);
    }

    const after = await activityLogs.find({ category: 'memvault' } as never);
    const exportsAfter = after.filter((r) => (r as unknown as { type: string }).type === 'memvault_export').length;
    expect(exportsAfter, 'no export may have been served for a usage refusal').toBe(exportsBefore);

    // And the write-failure case really did reach the server, and is classified as exit 1.
    const onDir = await cortex(['memory', 'export', '--out', workDir, '--json']);
    expect(onDir.code).toBe(1);
    expect(JSON.parse(onDir.stderr)).toMatchObject({ ok: false, error: { code: 'WRITE_FAILED' } });
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
