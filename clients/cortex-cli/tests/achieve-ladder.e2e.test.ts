import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * THE REUSE LADDER THROUGH `cortex-cli`, END TO END - the layer seven rounds of this slice never
 * ran through.
 *
 * Every previous round verified the ladder at the ROUTE and stopped there, and the compose rung's
 * whole answer did not survive the generated client: `integrations achieve` treated any outcome
 * that was not `executed` as "nothing ran", so a `composed` answer - a trusted read, run, and
 * narrowed against the caller's own collection - exited 1 with the code `authored` and the message
 * "has NOT run", printing nothing on stdout. A rung whose answer is correct at the route and wrong
 * at the client is wrong: the client is where a person and a script actually meet it.
 *
 * So this file drives the BUILT binary as a child process against the REAL routers, the way
 * `e2e.test.ts` does, and it is the ladder's standing end-to-end case. It asserts the two halves a
 * route-level suite structurally cannot:
 *
 *   1. THE EXIT CODE AND THE STREAMS. `composed` is an ANSWER: exit 0, exactly one JSON document on
 *      stdout, an empty stderr - and in human mode the narrowed rows, not a failure line.
 *   2. THE ARM'S ENVELOPE SURVIVES THE COMPOSITION. The action answered HTTP 206 carrying
 *      `nextPage`; the composed answer used to carry neither, so a caller could not tell a PAGE of
 *      somebody's processes from all of them. `result` now rides the composed outcome exactly as it
 *      rides the executed one, and the client carries it through.
 *
 * TWO FAKES, BOTH AT THE EDGES, everything between them real (the same pair the api contract suite
 * uses, for the same reasons): `guardedFetch`, so the remote is deterministic, and
 * `agents/authoring-core.js`, so no test makes a model call - only the model TURN is faked, and
 * both output contracts, both parsers, both deterministic guardrail suites, the owner-scoped
 * collection reader and the join stage are the real ones. The api routers, the executor, the
 * gateway-key auth, HTTP, argv parsing, the generated client and the process exit code are not
 * faked at all.
 *
 * WHAT THE CANONICAL CASE PROVES, AND WHAT IT DOES NOT. It proves the COMPOSE RUNG, through the
 * real app and out through the real client. It does NOT prove the Citius ongoing-processes path:
 * `get-ongoing-processes` exists nowhere in `api/src` or `shared/src`, so the fixture below is a
 * LOCAL one of the same shape, seeded into a probe integration by this file.
 *
 * These test files are the ONE place in `clients/` allowed to import `api/` - see `e2e.test.ts`.
 */
import { connectMongo, closeMongo, getDb } from '../../../api/src/data/mongo.js';
import { users, orgs, artifacts, userSettings } from '../../../api/src/data/stores.js';
import { setActivation } from '../../../api/src/data/activation.js';
import { __resetCapabilityRateForTests } from '../../../api/src/auth/api-key-rate.js';
import { login } from '../../../api/src/auth/service.js';
import { hashPassword } from '../../../api/src/auth/password.js';
import { buildApp } from '../../../api/src/server.js';
import { closeAllIndexes } from '../../../api/src/memvault/fts.js';
import { closeIndex } from '../../../api/src/knowledge/index-store.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../../api/src/config.js';
import { integrationDefinitionStore } from '../../../api/src/integrations/definition-store.js';
import { CollectionsEngine, sharedScope, APP_DATA_COLLECTION } from '../../../api/src/data/collections-engine.js';
import type { IntegrationAction } from '../../../api/src/integrations/definitions.js';

const upstream = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method?: string }>,
  status: 200,
  body: '{"ok":true}',
}));
vi.mock('../../../api/src/services/url-fetcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/src/services/url-fetcher.js')>();
  return {
    ...actual,
    guardedFetch: async (url: string, opts: { method?: string } = {}) => {
      upstream.calls.push({ url, method: opts.method });
      return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json' } });
    },
  };
});

/** The faked turns, one reply per output contract - a single canned reply for every question is the
 *  shape that makes an assertion unfailable, so the mock dispatches on the caller's own contract. */
const plans = vi.hoisted(() => ({ args: '', compose: '', turns: 0 }));
vi.mock('../../../api/src/agents/authoring-core.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/src/agents/authoring-core.js')>();
  return {
    ...actual,
    authorWithRepair: async (input: {
      outputContract: string;
      userText: (v: readonly string[] | null) => string;
      parse: (t: string) => { draft: unknown; violations: string[] };
    }) => {
      plans.turns++;
      input.userText(null);
      const reply = input.outputContract.includes('args-json') ? plans.args : plans.compose;
      const parsed = input.parse(reply);
      return { status: 'authored' as const, text: reply, draft: parsed.draft, violations: parsed.violations, attempts: 1 };
    },
  };
});

const BIN = fileURLToPath(new URL('../bin/cortex.mjs', import.meta.url));
const DIST = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const PROBE = 's4s5-ladder-cli';
const HOST = 'https://ladder-cli.example';
const ART = 'art-crm-cli';
const CANONICAL_GOAL = 'todos os processos de clientes com menos de 40 anos';

let mem: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let apiKey: string;
let jwt: string;
let workDir: string;

let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

/** A trusted READ whose one declared argument lands in the query string. */
const processos: IntegrationAction = {
  actionName: 'processos',
  description: 'Processos do mandatario',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/processos', queryParams: { tribunal: '{{tribunal}}' } },
  argsSchema: { type: 'object', properties: { tribunal: { type: 'string' } } },
};

/** A WRITE with one targeting argument and TWO body arguments: D1 offers a model only the body
 *  pair, and the write gate refuses the call until a person has approved the shape. Two rather than
 *  one so the refusal has a LIST to render, in an order a person can rely on. */
const submeterPeca: IntegrationAction = {
  actionName: 'submeter_peca',
  description: 'Submete uma peca',
  mutates: true,
  httpConfig: {
    method: 'POST',
    baseUrl: HOST,
    path: '/processos/{{numero}}/pecas',
    bodyTemplate: { titulo: '{{titulo}}', resumo: '{{resumo}}' },
  },
  argsSchema: {
    type: 'object',
    properties: { numero: { type: 'string' }, titulo: { type: 'string' }, resumo: { type: 'string' } },
  },
};

const PROCESS_ROWS = [
  { numeroProcesso: '111/24.0T8LSB', clienteId: 'c1' },
  { numeroProcesso: '222/24.0T8PRT', clienteId: 'c2' },
  { numeroProcesso: '333/24.0T8CBR', clienteId: 'c3' },
  { numeroProcesso: '444/24.0T8FAR', clienteId: 'c4' },
];

/** ONE PAGE of processes, and the two facts that say so: HTTP 206 and a `nextPage` cursor beside
 *  the list. Both belong to the ENVELOPE the action answered in, and neither is derivable from the
 *  narrowed rows - which is exactly why a composition that drops the envelope is a defect. */
const UPSTREAM_PAGE = JSON.stringify({ processos: PROCESS_ROWS, nextPage: 'cursor-2' });

const COMPOSE_PLAN = {
  compose: true,
  collection: 'clients',
  where: { field: 'idade', op: 'lt', value: 40 },
  join: { resultField: 'clienteId', collectionField: 'id' },
};

const argsBlock = (args: Record<string, unknown>) => `\`\`\`args-json\n${JSON.stringify({ args })}\n\`\`\``;
const composeBlock = (plan: Record<string, unknown>) => `\`\`\`compose-json\n${JSON.stringify(plan)}\n\`\`\``;

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the real binary. Async on purpose: the api server lives in THIS process's event loop. */
function cortex(args: string[], origin?: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CORTEX_BASE_URL: origin ?? baseUrl, CORTEX_API_KEY: apiKey };
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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

/** The single JSON document a `--json` invocation prints on stdout. */
function jsonOf(res: CliResult): Record<string, unknown> {
  expect(res.stderr, res.stderr).toBe('');
  expect(res.code, res.stdout).toBe(0);
  return JSON.parse(res.stdout) as Record<string, unknown>;
}

const authed = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}`, ...(init.headers ?? {}) },
  });

async function seedDefinition(actions: IntegrationAction[]): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId: 'o1', userId: 'usr', visibility: 'private', key: PROBE,
      displayName: 'Ladder CLI', configSchema: [], actions, skillMd: '# probe', authType: 'none',
    },
    { actor: { userId: 'usr', orgId: 'o1', role: 'org-admin' }, onConflict: 'replace' },
  );
}

/** The tenant's `clients` collection, seeded through the PRODUCTION WRITER: `CollectionsEngine.create`
 *  under `sharedScope(appId, ownerUserId)`, verbatim what `apps/served-data.ts` binds when a running
 *  app writes its own data. A fixture written any other way would prove the join works on a shape
 *  production cannot emit. */
async function seedClients(): Promise<void> {
  await artifacts.insert({
    _id: ART, name: 'CRM', slug: ART, userId: 'usr', orgId: 'o1', visibility: 'private',
    status: 'ready', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as never);
  const engine = new CollectionsEngine(deps);
  const scope = sharedScope(ART, 'usr');
  await engine.create(scope, 'clients', { id: 'c1', nome: 'Ana', idade: 31 });
  await engine.create(scope, 'clients', { id: 'c2', nome: 'Bruno', idade: 52 });
  await engine.create(scope, 'clients', { id: 'c3', nome: 'Carla', idade: 39 });
  await engine.create(scope, 'clients', { id: 'c4', nome: 'Duarte', idade: 40 });
}

beforeAll(async () => {
  if (!existsSync(DIST)) {
    throw new Error(`the CLI is not built (${DIST} missing). Run: npm run build --workspace @ekoa/cortex-cli`);
  }
  workDir = mkdtempSync(join(tmpdir(), 'cortex-cli-ladder-'));
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  process.env.EKOA_MEMVAULT_ROOT = join(workDir, 'memvault');
  process.env.EKOA_DATA_DIR = join(workDir, 'data');
  __resetConfigForTests();
  loadConfig();
  __resetCapabilityRateForTests();

  mem = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await connectMongo(mem.getUri(), 'ekoa_cortex_cli_ladder');
  await orgs.insert({ _id: 'o1', name: 'orgA' } as never);
  await users.insert({
    _id: 'usr', username: 'usr', passwordHash: await hashPassword('pw123456'),
    role: 'org-admin', orgId: 'o1', active: true,
  } as never);
  setActivation('usr', { active: true, billingLocked: false });
  await userSettings.put({ _id: 'usr', memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);

  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  jwt = (await login('usr', 'pw123456', false, deps)).token;

  const minted = await authed('/api/v1/gateway-keys', { method: 'POST', body: JSON.stringify({ label: 'ladder-e2e' }) });
  expect(minted.status).toBe(201);
  apiKey = ((await minted.json()) as { key: string }).key;

  await seedDefinition([processos, submeterPeca]);
  await seedClients();
}, 180_000);

afterAll(async () => {
  server?.close();
  closeAllIndexes();
  closeIndex();
  await getDb().collection(APP_DATA_COLLECTION).deleteMany({});
  await closeMongo();
  await mem?.stop();
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.EKOA_MEMVAULT_ROOT;
  delete process.env.EKOA_DATA_DIR;
});

describe('the compose rung through the built binary', () => {
  it('a composed answer is a SUCCESS: exit 0, one document on stdout, the narrowed rows in it', async () => {
    upstream.calls.length = 0;
    upstream.status = 206;
    upstream.body = UPSTREAM_PAGE;
    plans.args = argsBlock({ tribunal: 'Lisboa' });
    plans.compose = composeBlock(COMPOSE_PLAN);

    const res = await cortex(['integrations', 'achieve', PROBE, '--goal', CANONICAL_GOAL, '--json']);

    // THE BLOCKER. This exited 1 with `{"error":{"code":"authored"}}` and an empty stdout: the
    // client turned an answer the platform had computed correctly into a failed goal.
    const doc = jsonOf(res);
    expect(doc).toMatchObject({ ok: true, command: 'integrations achieve', status: 200 });
    const body = doc.data as Record<string, unknown>;
    expect(body.outcome).toBe('composed');
    expect(body.actionName).toBe('processos');
    expect((body.items as Array<{ numeroProcesso: string }>).map((r) => r.numeroProcesso))
      .toEqual(['111/24.0T8LSB', '333/24.0T8CBR']);
    expect((body.composition as { matched: number; scanned: number }).matched).toBe(2);
    // Both rungs ran, and the ladder says which one answered.
    expect(body.filledArgs).toEqual(['tribunal']);
    const ladder = body.ladder as Array<{ rung: string; verdict: string }>;
    expect(ladder.find((s) => s.rung === 'parametrize')?.verdict).toBe('taken');
    expect(ladder.find((s) => s.rung === 'compose')?.verdict).toBe('taken');
    // …and the model's value really reached the request the executor addressed.
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.url).toContain('tribunal=Lisboa');
  });

  /**
   * THE MAJOR, through the client: the composition is a POST-STAGE and must not destroy what the
   * arm returned. The action answered ONE PAGE - HTTP 206, `nextPage` beside the list - and the
   * composed answer carried neither, so a page of somebody's processes was indistinguishable from
   * all of them. Neither fact is recoverable from `items` or from `composition`.
   */
  it('carries the action\'s own response ENVELOPE, so an upstream page is still a page', async () => {
    upstream.calls.length = 0;
    upstream.status = 206;
    upstream.body = UPSTREAM_PAGE;
    plans.args = argsBlock({ tribunal: 'Lisboa' });
    plans.compose = composeBlock(COMPOSE_PLAN);

    const body = jsonOf(await cortex(['integrations', 'achieve', PROBE, '--goal', CANONICAL_GOAL, '--json'])).data as {
      outcome: string;
      result?: { success: boolean; status?: number; data?: { nextPage?: string; processos?: unknown[] } };
    };

    expect(body.outcome).toBe('composed');
    expect(body.result?.success).toBe(true);
    expect(body.result?.status).toBe(206);
    expect(body.result?.data?.nextPage).toBe('cursor-2');
    // The arm's own rows travel whole: `items` is the NARROWING of them, never a replacement that
    // hands back a document the third party never emitted.
    expect(body.result?.data?.processos).toHaveLength(PROCESS_ROWS.length);
  });

  it('human mode prints the narrowed rows and the upstream status, not a failure line', async () => {
    upstream.calls.length = 0;
    upstream.status = 206;
    upstream.body = UPSTREAM_PAGE;
    plans.args = argsBlock({ tribunal: 'Lisboa' });
    plans.compose = composeBlock(COMPOSE_PLAN);

    const res = await cortex(['integrations', 'achieve', PROBE, '--goal', CANONICAL_GOAL]);

    expect(res.code, res.stderr).toBe(0);
    expect(res.stderr).toBe('');
    expect(res.stdout).toContain(`ok  ${PROBE}/processos`);
    expect(res.stdout).toContain('upstream HTTP 206');
    expect(res.stdout).toContain('2 of 4 rows kept, joined against "clients"');
    expect(res.stdout).toContain('111/24.0T8LSB');
    expect(res.stdout).toContain('333/24.0T8CBR');
    // The rows the join dropped are not printed as if they had been kept.
    expect(res.stdout).not.toContain('222/24.0T8PRT');
  });

  /**
   * THE WRITE GATE, THROUGH THE CLIENT: the one moment a human is in the loop, and what they are
   * shown at it.
   *
   * The gate refuses before the request goes out, so this refusal is the whole story of a call a
   * model helped shape. The person answering it is being asked to authorise a peça whose TITLE a
   * model wrote - and the name `titulo` authorises nothing, so the VALUE is printed. Everything
   * asserted here travels in the refusal's own `details`, which is why `--json` stays exactly one
   * document while the human form grows lines.
   */
  it('the consent refusal shows a person which rung filled the call and what it chose', async () => {
    upstream.calls.length = 0;
    // Written titulo-first, so the rendered list below is in a DIFFERENT order from the one the
    // model replied in - which is what makes the ordering a property of this client rather than of
    // whatever a model happened to emit.
    plans.args = argsBlock({ titulo: 'Contestação', resumo: 'Resumo da peça' });
    plans.compose = composeBlock({ compose: false });
    const argv = ['integrations', 'achieve', PROBE, '--goal', 'submeter peca de contestacao', '--arg', 'numero=111/24.0T8LSB'];

    const human = await cortex(argv);
    expect(human.code).toBe(1);
    expect(human.stdout).toBe('');
    expect(human.stderr).toContain('awaiting_consent');
    expect(human.stderr).toContain('submeter_peca');
    // THE LINES THAT WERE MISSING - the values being approved, and the rung that produced them.
    expect(human.stderr).toContain('a model filled these arguments');
    expect(human.stderr).toContain('titulo = "Contestação"');
    expect(human.stderr).toContain('resumo = "Resumo da peça"');
    expect(human.stderr.indexOf('resumo =')).toBeLessThan(human.stderr.indexOf('titulo ='));
    expect(human.stderr).toContain('parametrize: taken');
    expect(human.stderr).toContain('CANNOT grant that approval');
    // NOTHING RAN, which is what makes the refusal worth reading.
    expect(upstream.calls).toHaveLength(0);

    // …and under --json the same facts travel machine-readably, in ONE document on stderr.
    const json = await cortex([...argv, '--json']);
    expect(json.code).toBe(1);
    expect(json.stdout).toBe('');
    const doc = JSON.parse(json.stderr) as {
      error: { status: number; details?: { code?: string; filledArgs?: string[]; filledArgValues?: Record<string, unknown> } };
    };
    expect(doc.error.status).toBe(403);
    expect(doc.error.details?.code).toBe('awaiting_consent');
    expect(doc.error.details?.filledArgs).toEqual(['resumo', 'titulo']);
    expect(doc.error.details?.filledArgValues).toEqual({ titulo: 'Contestação', resumo: 'Resumo da peça' });
  });

  /**
   * THE ASYMMETRY IS REAL, AND THIS IS THE CONTROL FOR IT: `/execute` refuses the SAME action with
   * the SAME gate and carries none of it, because its arguments are the caller's own and no rung
   * ran above it. Without this case a client that printed the header unconditionally - or invented
   * an empty list - would look exactly as correct on the test above.
   */
  it('the same gate on `execute` says nothing about a model, because none was asked', async () => {
    const res = await cortex(['integrations', 'execute', PROBE, 'submeter_peca', '--arg', 'numero=111/24.0T8LSB']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('awaiting_consent');
    expect(res.stderr).toContain('CANNOT grant that approval');
    expect(res.stderr).not.toContain('a model filled');
    expect(res.stderr).not.toContain('ladder:');
  });

  /**
   * A HOSTILE ORIGIN, which is a production case for THIS client and not a hypothetical:
   * `CORTEX_BASE_URL` is caller-supplied and deliberately unvalidated, so the binary can be pointed
   * at a server that answers whatever it likes - the same threat model as the F1/F2 cases in
   * `e2e.test.ts`, which is the only honest way to exercise a shape the real route cannot emit.
   *
   * The refusal below is gate-shaped and its `filledArgValues` is NOT: an empty object on one run,
   * a nested object on the next, and a `ladder` that is a string. A person reading this is about to
   * authorise a write, so the rule is that a half-shaped answer prints NOTHING rather than a
   * confident header over an empty list, the word `undefined`, or `[object Object]`.
   */
  it('a malformed refusal prints no claim about a model at all', async () => {
    const consentRequest = {
      integrationKey: PROBE, actionName: 'submeter_peca', description: 'Submete uma peca',
      target: `POST ${HOST}/processos/{{numero}}/pecas`, shape: 'sha256:deadbeef',
    };
    const bodies = [
      { code: 'awaiting_consent', consentRequest, filledArgs: [], filledArgValues: {} },
      { code: 'awaiting_consent', consentRequest, filledArgValues: { titulo: { $ne: 1 } }, ladder: 'nope' },
    ];
    let index = 0;
    const rogue = createServer((_req, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Precisa de autorizacao.', details: bodies[index] } }));
    });
    await new Promise<void>((r) => rogue.listen(0, '127.0.0.1', () => r()));
    const origin = `http://127.0.0.1:${(rogue.address() as { port: number }).port}`;
    try {
      for (index = 0; index < bodies.length; index++) {
        const res = await cortex(['integrations', 'achieve', PROBE, '--goal', 'submeter peca'], origin);
        expect(res.code, JSON.stringify(bodies[index])).toBe(1);
        // The descriptor still prints - the refusal IS the gate, and the destination is the part a
        // person needs. What does not print is any claim about a model.
        expect(res.stderr).toContain('POST');
        expect(res.stderr).not.toContain('a model filled');
        expect(res.stderr).not.toContain('ladder:');
        expect(res.stderr).not.toContain('undefined');
        expect(res.stderr).not.toContain('[object Object]');
      }
    } finally {
      await new Promise<void>((r) => rogue.close(() => r()));
    }
  });

  /** The rung below, through the same client: nothing changed for an answer that was not composed. */
  it('an executed answer is still an executed answer, with the action\'s body under `result`', async () => {
    upstream.calls.length = 0;
    upstream.status = 200;
    upstream.body = UPSTREAM_PAGE;
    plans.args = argsBlock({ tribunal: 'Porto' });
    plans.compose = composeBlock({ compose: false });

    const body = jsonOf(await cortex(['integrations', 'achieve', PROBE, '--goal', CANONICAL_GOAL, '--json'])).data as {
      outcome: string;
      items?: unknown;
      result?: { status?: number; data?: { processos?: unknown[] } };
    };

    expect(body.outcome).toBe('executed');
    expect(body.items).toBeUndefined();
    expect(body.result?.status).toBe(200);
    expect(body.result?.data?.processos).toHaveLength(PROCESS_ROWS.length);
  });
});
