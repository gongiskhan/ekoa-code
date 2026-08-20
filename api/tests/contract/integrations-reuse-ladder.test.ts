import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  users,
  gatewayKeys,
  activityLogs,
  billingAccounts,
  integrationConfigs,
  integrationDefinitions,
  approvedIntegrationActions,
  artifacts,
} from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { __resetGatewayKeysServiceForTests } from '../../src/auth/gateway-keys-service.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { CollectionsEngine, sharedScope, APP_DATA_COLLECTION } from '../../src/data/collections-engine.js';
import { getDb } from '../../src/data/mongo.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';
import { AchieveIntegrationGoalResponse, ErrorEnvelope } from '@ekoa/shared';

/**
 * Slices S4 + S5 - THE REUSE LADDER through the REAL app.
 *
 * WHAT ONLY AN END-TO-END SUITE CAN PIN, and what this one exists for:
 *
 *  1. THE COMPOSITION ROOT ACTUALLY BINDS BOTH SEAMS. `achieve`'s two new rungs arrive as
 *     `planStep` and `appCollections`, wired once in `server.ts` and handed to the router. A seam
 *     nobody binds is dead code that every module-level suite still passes, and this repo has
 *     found that exact defect three times - so the assertions below run against `buildApp`, and
 *     deleting either binding from the router mount turns them red. (Verified by doing it: see
 *     the slice report.)
 *  2. A FILLED ARGUMENT REALLY REACHES THE REQUEST. The model's value is asserted on the URL the
 *     executor actually addressed, not on the module's return value - the executor never reads
 *     `argsSchema`, so "it was in `args`" and "it was interpolated" are different claims.
 *  3. THE WRITE GATE IS UNMOVED. A `mutates` action still answers the identical 403 +
 *     `awaiting_consent` envelope, whichever rung filled its arguments.
 *  3b. A RUNG NEVER SUBTRACTS AN ANSWER, on the real wire, and this file now covers ALL FIVE ways
 *     it used to. A rejected argument plan is DISCARDED and the request still goes out - carrying
 *     the CALLER's targeting value, never the model's - including on a write a human has
 *     standing-approved through the production approval doors. An upstream 500 comes back verbatim
 *     through a planned composition. A rejected COMPOSE plan no longer cancels the read. And a
 *     collection name the tenant does not hold no longer discards a 200 THAT HAD ALREADY COME BACK
 *     - the last two are the ones this round fixed, and they were the worst, because the request
 *     had gone out and been answered before the refusal was decided. Every one of these was the
 *     pre-fix behaviour, and restoring any of them in the source reds this file.
 *  4. THE WIRE SHAPES. Every 2xx safeParses against `AchieveIntegrationGoalResponse` - including
 *     the new `composed` outcome and its `composition` block - and every non-2xx against the
 *     shared error envelope.
 *
 * TWO FAKES, BOTH AT THE EDGES, and everything between them is the real thing. `guardedFetch` is
 * mocked so the remote is deterministic (which is what makes "the upstream was never called" an
 * assertion about the REAL executor, and what lets the URL be inspected). `authoring-core.ts` is
 * mocked so no test makes a model call - and only the model TURN is faked: the mock drives the
 * caller's own `parse` seam, so both output contracts, both parsers, both deterministic guardrail
 * suites, the owner-scoped collection reader and the join stage are all real.
 */
const upstream = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method?: string }>,
  status: 200,
  body: '{"ok":true}',
}));
vi.mock('../../src/services/url-fetcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/url-fetcher.js')>();
  return {
    ...actual,
    guardedFetch: async (url: string, opts: { method?: string } = {}) => {
      upstream.calls.push({ url, method: opts.method });
      return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json' } });
    },
  };
});

/**
 * The faked turns, ONE REPLY PER OUTPUT CONTRACT. The two rungs ask different questions of the
 * same core, and a single canned reply for every question is the "stub answering one canned body
 * for every input" shape that makes assertions unfailable - the mock therefore dispatches on the
 * caller's own `outputContract`, exactly as a real model would be answering different prompts.
 */
const plans = vi.hoisted(() => ({ args: '', compose: '', turns: 0 }));
vi.mock('../../src/agents/authoring-core.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/authoring-core.js')>();
  return {
    ...actual,
    // A miniature of the real core: it honours the caller's `userText` + `parse`, so the only
    // thing that does NOT happen is the chokepoint call.
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

let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const PROBE_INTEGRATION = 's4s5-ladder-contract';
const HOST = 'https://ladder-contract.example';
const ART = 'art-crm-a';

/** A trusted READ whose declared argument lands in the QUERY STRING - the D1 `targeting` slot,
 *  fillable precisely because the action cannot write. */
const processos: IntegrationAction = {
  actionName: 'processos',
  description: 'Processos do mandatario',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/processos', queryParams: { tribunal: '{{tribunal}}' } },
  argsSchema: { type: 'object', properties: { tribunal: { type: 'string' } } },
};

/** A WRITE with one targeting argument and one body argument, so D1 has both cases in one action. */
const submeterPeca: IntegrationAction = {
  actionName: 'submeter_peca',
  description: 'Submete uma peca',
  mutates: true,
  httpConfig: {
    method: 'POST',
    baseUrl: HOST,
    path: '/processos/{{numero}}/pecas',
    bodyTemplate: { titulo: '{{titulo}}' },
  },
  argsSchema: { type: 'object', properties: { numero: { type: 'string' }, titulo: { type: 'string' } } },
};

const CANONICAL_GOAL = 'todos os processos de clientes com menos de 40 anos';

const PROCESS_ROWS = [
  { numeroProcesso: '111/24.0T8LSB', clienteId: 'c1' },
  { numeroProcesso: '222/24.0T8PRT', clienteId: 'c2' },
  { numeroProcesso: '333/24.0T8CBR', clienteId: 'c3' },
  // `c4` is exactly 40: the row that makes `lt` and `lte` distinguishable over this fixture.
  { numeroProcesso: '444/24.0T8FAR', clienteId: 'c4' },
];

const COMPOSE_PLAN = {
  compose: true,
  collection: 'clients',
  where: { field: 'idade', op: 'lt', value: 40 },
  join: { resultField: 'clienteId', collectionField: 'id' },
};

const argsBlock = (args: Record<string, unknown>) => `\`\`\`args-json\n${JSON.stringify({ args })}\n\`\`\``;
const composeBlock = (plan: Record<string, unknown>) => `\`\`\`compose-json\n${JSON.stringify(plan)}\n\`\`\``;

const call = (p: string, auth: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(init.headers ?? {}) },
  });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

const achieve = (auth: string, goal: string, args?: Record<string, unknown>) =>
  call(`/api/v1/integrations/${PROBE_INTEGRATION}/achieve`, auth, { method: 'POST', body: JSON.stringify({ goal, ...(args ? { args } : {}) }) });

/**
 * Bank a standing approval for a WRITE, through the PRODUCTION DOORS - the same two the dashboard
 * uses: read the shape the human would be shown, then echo it back on the approval endpoint. A row
 * inserted by hand would be a fixture of a shape only this file can produce, and the write gate
 * keys on exactly the shape+target these two routes agree on.
 */
async function approveWrite(auth: string, actionName: string): Promise<void> {
  const listed = await (await call(`/api/v1/integrations/${PROBE_INTEGRATION}/action-approvals`, auth)).json() as {
    items: Array<{ actionName: string; shape: string }>;
  };
  const shape = listed.items.find((i) => i.actionName === actionName)?.shape;
  expect(shape, `no approval row for ${actionName}`).toBeTruthy();
  const res = await call(`/api/v1/integrations/${PROBE_INTEGRATION}/actions/${actionName}/approval`, auth, {
    method: 'POST',
    body: JSON.stringify({ shape, decision: 'always' }),
  });
  expect(res.status).toBe(200);
}

/** Every 2xx validates against its named shared schema; that is the contract half of this suite. */
async function okBody(res: Response): Promise<Record<string, unknown>> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  const parsed = AchieveIntegrationGoalResponse.safeParse(body);
  expect(parsed.success, `2xx must satisfy AchieveIntegrationGoalResponse: ${JSON.stringify(parsed.error?.issues ?? body)}`).toBe(true);
  return body;
}

async function mkUser(id: string, orgId: string): Promise<void> {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'user', orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

async function seedDefinition(actions: IntegrationAction[]): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId: 'orgA', userId: 'ownerA', visibility: 'private', key: PROBE_INTEGRATION,
      displayName: 'Ladder Contract', configSchema: [], actions, skillMd: '# probe', authType: 'none',
    },
    { actor: { userId: 'ownerA', orgId: 'orgA', role: 'user' }, onConflict: 'replace' },
  );
}

/**
 * The tenant's `clients` collection, seeded through the PRODUCTION WRITER.
 *
 * Rows go in through `CollectionsEngine.create` under `sharedScope(appId, ownerUserId)` - which is
 * verbatim what `apps/served-data.ts` binds when a running app writes its own data, the ONLY way
 * these rows are ever created in production. A fixture written any other way would prove the join
 * works on a shape production cannot emit.
 *
 * THE READER USES A DIFFERENT FUNCTION AND THAT IS NOT A MISMATCH, so it is stated rather than
 * left to be rediscovered: the compose rung's binding is `ownerSharedScope(actor.userId)`
 * (D-S5-1), and both functions return `scopeKey: 'usr.<ownerUserId>'` while `Scope.appId` is never
 * part of any query in `CollectionsEngine`. Writer and reader address the same key by construction;
 * that they name it differently is exactly the store's own owner-not-app unit showing through.
 */
async function seedClients(orgId = 'orgA', userId = 'ownerA', artifactId = ART): Promise<void> {
  await artifacts.insert({
    _id: artifactId, name: 'CRM', slug: artifactId, userId, orgId, visibility: 'private',
    status: 'ready', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as never);
  const engine = new CollectionsEngine(deps);
  const scope = sharedScope(artifactId, userId);
  await engine.create(scope, 'clients', { id: 'c1', nome: 'Ana', idade: 31 });
  await engine.create(scope, 'clients', { id: 'c2', nome: 'Bruno', idade: 52 });
  await engine.create(scope, 'clients', { id: 'c3', nome: 'Carla', idade: 39 });
  await engine.create(scope, 'clients', { id: 'c4', nome: 'Duarte', idade: 40 });
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s4s5_ladder_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  __resetCapabilityRateForTests();
  __resetGatewayKeysServiceForTests();
  upstream.calls.length = 0;
  upstream.status = 200;
  upstream.body = JSON.stringify({ processos: PROCESS_ROWS });
  plans.turns = 0;
  plans.args = argsBlock({});
  plans.compose = composeBlock({ compose: false });
  for (const s of [users, gatewayKeys, activityLogs, billingAccounts, integrationConfigs, integrationDefinitions, approvedIntegrationActions, artifacts]) {
    await s.deleteMany({});
  }
  await getDb().collection(APP_DATA_COLLECTION).deleteMany({});
  await mkUser('ownerA', 'orgA');
});

// ---------------------------------------------------------------------------------------------
// 1. PARAMETRIZE, through the real executor
// ---------------------------------------------------------------------------------------------

describe('the parametrize rung is wired, and its value reaches the request', () => {
  it('fills a declared argument the caller omitted, and the URL the executor addressed carries it', async () => {
    await seedDefinition([processos]);
    plans.args = argsBlock({ tribunal: 'Coimbra' });
    const token = await tokenFor('ownerA');

    const body = await okBody(await achieve(token, 'processos do tribunal indicado pelo utilizador'));

    expect(body.outcome).toBe('executed');
    expect(body.filledArgs).toEqual(['tribunal']);
    // THE LOAD-BEARING ASSERTION. `argsSchema` is never read by the executor, so the only proof a
    // filled argument is real is the request it produced.
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.url).toContain('tribunal=Coimbra');
    // …and it did that because the COMPOSITION ROOT bound the seam. Unbind `planStep` in
    // server.ts and this is a plain execute with no query parameter.
    expect(plans.turns).toBeGreaterThan(0);
  });

  it('reports the ladder on the executed wire, so a client can see which rung answered', async () => {
    await seedDefinition([processos]);
    plans.args = argsBlock({ tribunal: 'Porto' });
    const body = await okBody(await achieve(await tokenFor('ownerA'), 'processos do tribunal certo'));
    const ladder = body.ladder as Array<{ rung: string; verdict: string }>;
    expect(ladder.find((s) => s.rung === 'parametrize')?.verdict).toBe('taken');
    expect(ladder.find((s) => s.rung === 'reuse')?.verdict).toBe('taken');
  });

  it('a plan naming an argument the action does not declare is DISCARDED, and the call still runs', async () => {
    await seedDefinition([processos]);
    plans.args = argsBlock({ tribunal: 'Porto', api_base: 'https://elsewhere.example' });

    const body = await okBody(await achieve(await tokenFor('ownerA'), 'processos do tribunal certo'));

    // A rung that can only ADD an answer must never SUBTRACT one: this used to answer
    // `refused` / `parametrize_refused`, which took away a call that ran before the slice.
    expect(body.outcome).toBe('executed');
    expect(body.filledArgs).toBeUndefined();
    // THE LOAD-BEARING ASSERTION: the URL is the one the CALLER asked for, and carries neither the
    // undeclared key nor the argument that would have passed on its own.
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.url).not.toContain('elsewhere.example');
    expect(upstream.calls[0]?.url).not.toContain('tribunal=Porto');
    const step = (body.ladder as Array<{ rung: string; verdict: string; violations?: string[] }>)
      .find((s) => s.rung === 'parametrize');
    expect(step?.verdict).toBe('refused');
    expect(step?.violations?.join(' ')).toContain('api_base');
  });

  it('D1 on the real wire: a discarded plan does not cancel an APPROVED write, and picks nothing in it', async () => {
    await seedDefinition([submeterPeca]);
    const token = await tokenFor('ownerA');
    // A STANDING HUMAN APPROVAL, banked through the production doors. This is the call the old
    // refusal took away: approved, targeted by the caller, executing for months.
    await approveWrite(token, 'submeter_peca');
    // The model is only offered `titulo`; it answers with `numero` - the TARGETING argument - too.
    plans.args = argsBlock({ titulo: 'Contestacao', numero: '999/24.0T8LSB' });

    const body = await okBody(await achieve(token, 'submeter peca de contestacao', { numero: '111/24.0T8LSB' }));

    expect(body.outcome).toBe('executed');
    // IT WENT OUT, at the resource the HUMAN named - the model chose nothing.
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.url).toContain('/processos/111/24.0T8LSB/pecas');
    expect(upstream.calls[0]?.url).not.toContain('999/24.0T8LSB');
    expect(body.filledArgs).toBeUndefined();
    const step = (body.ladder as Array<{ rung: string; verdict: string; violations?: string[] }>)
      .find((s) => s.rung === 'parametrize');
    expect(step?.verdict).toBe('refused');
    expect(step?.violations?.join(' ')).toContain('numero');
  });

  it('the write gate is unmoved: a filled BODY argument still answers the identical 403 envelope', async () => {
    await seedDefinition([submeterPeca]);
    plans.args = argsBlock({ titulo: 'Contestacao' });

    const res = await achieve(await tokenFor('ownerA'), 'submeter peca de contestacao', { numero: '111/24.0T8LSB' });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    const details = (body as { error: { details?: { code?: string; consentRequest?: { actionName?: string } } } }).error.details;
    expect(details?.code).toBe('awaiting_consent');
    expect(details?.consentRequest?.actionName).toBe('submeter_peca');
    expect(upstream.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. COMPOSE - the canonical case, end to end, against the tenant's real app_data
// ---------------------------------------------------------------------------------------------

describe('CANONICAL, through the real app: "todos os processos de clientes com menos de 40 anos"', () => {
  it('runs the trusted read, joins the tenant\'s clients collection, and mints nothing', async () => {
    await seedDefinition([processos]);
    await seedClients();
    plans.compose = composeBlock(COMPOSE_PLAN);

    const body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL));

    expect(body.outcome).toBe('composed');
    expect(body.actionName).toBe('processos');
    // The action ran ONCE, through the real gated executor and the real HTTP rail.
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.method).toBe('GET');
    // Only the under-40 clients' processes come back.
    expect((body.items as Array<{ numeroProcesso: string }>).map((r) => r.numeroProcesso))
      .toEqual(['111/24.0T8LSB', '333/24.0T8CBR']);
    const composition = body.composition as Record<string, unknown>;
    expect(composition.collection).toBe('clients');
    expect(composition.scanned).toBe(4);
    expect(composition.matchedCollectionRows).toBe(2);
    expect(composition.matched).toBe(2);
    expect(composition.truncated).toBe(false);
    // Both caps reported, on the wire, on every composed answer: the caller is told how much of
    // their own collection the join actually considered.
    expect(composition.collectionScanned).toBe(4);
    expect(composition.collectionTruncated).toBe(false);
    // The rungs considered, on the wire.
    const ladder = body.ladder as Array<{ rung: string; verdict: string }>;
    expect(ladder.find((s) => s.rung === 'compose')?.verdict).toBe('taken');

    // NOTHING WAS MINTED.
    const doc = await integrationDefinitionStore.getForActor({ userId: 'ownerA', orgId: 'orgA', role: 'user' }, PROBE_INTEGRATION);
    expect((doc?.actions ?? []).map((a) => a.actionName)).toEqual(['processos']);
  });

  /**
   * A COMPOSED ANSWER THAT WAS ALSO PARAMETRIZED REPORTS BOTH, and until this case nothing asserted
   * the second half. `filledArgs` is produced on the `composed` exit as well as the `executed` one,
   * and deleting it from the composed branch left the whole estate green - so an answer that a model
   * both filled arguments for AND narrowed could come back with no record that any argument was
   * model-supplied. That is precisely the answer an auditor most needs whole: two model decisions,
   * one response, and the wire told them about one.
   */
  it('an answer that was BOTH parametrized and composed reports both on the wire', async () => {
    await seedDefinition([processos]);
    await seedClients();
    plans.args = argsBlock({ tribunal: 'Lisboa' });
    plans.compose = composeBlock(COMPOSE_PLAN);

    // No `tribunal` supplied, so the parametrize rung fills it; the goal still has residue, so the
    // compose rung runs too.
    const body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL));

    expect(body.outcome).toBe('composed');
    expect((body.items as unknown[]).length).toBe(2);
    // THE ASSERTION THAT WAS MISSING.
    expect(body.filledArgs).toEqual(['tribunal']);
    // …and the value really reached the request, so `filledArgs` is a record of something that
    // happened rather than a label.
    expect(upstream.calls[0]?.url).toContain('tribunal=Lisboa');
    const ladder = body.ladder as Array<{ rung: string; verdict: string }>;
    expect(ladder.find((s) => s.rung === 'parametrize')?.verdict).toBe('taken');
    expect(ladder.find((s) => s.rung === 'compose')?.verdict).toBe('taken');
  });

  /**
   * MINOR, ON THE REAL WIRE: `where.value` IS THE ONE DOOR THE FIELD CHECK DOES NOT COVER.
   *
   * `{ "$gt": 40 }` is what a model that has seen a query language writes. `Number({...})` is `NaN`,
   * so `lt` matched nothing and the old rung answered `composed` with `items: []` - the same
   * confident, well-formed, wrong answer the invented field name produced. The sibling rung has
   * refused non-scalars since it shipped; this one did not.
   */
  it('a "where.value" that is not a scalar refuses the narrowing and returns the whole list', async () => {
    await seedDefinition([processos]);
    await seedClients();
    plans.compose = composeBlock({ ...COMPOSE_PLAN, where: { field: 'idade', op: 'lt', value: { $gt: 40 } } });

    const body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL));

    expect(body.outcome).toBe('executed');
    expect(body.items).toBeUndefined();
    expect((body.result as { data?: { processos?: unknown[] } }).data?.processos).toHaveLength(PROCESS_ROWS.length);
    const step = (body.ladder as Array<{ rung: string; verdict: string; violations?: string[] }>).find((s) => s.rung === 'compose');
    expect(step?.verdict).toBe('refused');
    expect(step?.violations?.join(' ')).toContain('"where.value" must be a string, number, boolean or null');
  });

  it('the collection the model may name comes from the tenant\'s OWN artifacts, not from anywhere else', async () => {
    await seedDefinition([processos]);
    // No artifact at all, and every declared argument supplied, so BOTH rungs skip without a turn
    // - which is what proves the collection list is a real read of this tenant's own rows rather
    // than a constant the rung could have carried.
    plans.compose = composeBlock(COMPOSE_PLAN);

    const body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL, { tribunal: 'Lisboa' }));
    expect(body.outcome).toBe('executed');
    expect(plans.turns).toBe(0);
  });

  /**
   * A REMOTE 500 IS AN ANSWER ABOUT THE REMOTE SYSTEM, and `POST …/execute` has always returned it
   * whole. Planning a composition must not change that story - the composition is a post-stage, not
   * an error boundary. This is the E2E half: a real non-2xx off the real executor, with a real
   * compose plan in hand and a real collection the caller does hold.
   */
  it('an upstream 500 survives the compose rung verbatim, on the same wire /execute would use', async () => {
    await seedDefinition([processos]);
    await seedClients();
    plans.compose = composeBlock(COMPOSE_PLAN);
    upstream.status = 500;
    upstream.body = JSON.stringify({ error: 'manutencao programada' });

    const body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL));

    // Before the fix this was `refused` / `compose_unshaped_result` - the caller was told their
    // action returned no list, and the 500 never reached them.
    expect(body.outcome).toBe('executed');
    const result = body.result as { success: boolean; status?: number; error?: string };
    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toContain('500');
    expect(body.code).toBeUndefined();
    const step = (body.ladder as Array<{ rung: string; verdict: string; detail?: string }>).find((s) => s.rung === 'compose');
    expect(step?.verdict).toBe('skipped');
    expect(step?.detail).toContain('did not succeed');
  });

  /**
   * THE WORST SHAPE THE LADDER EVER HAD, on the real wire: the request WENT OUT, it came back 200,
   * and then a later stage refused and the 200 was discarded. Spending the side effect and throwing
   * away the result is worse than refusing up front, because the caller's work was done and they
   * were handed nothing for it.
   */
  it('a collection name the tenant does not hold does not cancel the read the product already made', async () => {
    await seedDefinition([processos]);
    await seedClients();
    plans.compose = composeBlock({ ...COMPOSE_PLAN, collection: 'clientes' });

    const body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL));

    // Before the fix: `refused` / `compose_unknown_collection`, with the 200 below thrown away.
    expect(body.outcome).toBe('executed');
    expect(body.code).toBeUndefined();
    // THE LOAD-BEARING ASSERTION: the upstream WAS called, and what it answered reached the caller.
    expect(upstream.calls).toHaveLength(1);
    const result = body.result as { success: boolean; data?: { processos?: unknown[] } };
    expect(result.success).toBe(true);
    expect(result.data?.processos).toHaveLength(PROCESS_ROWS.length);
    // Nothing was narrowed, so no narrowing block claims it was.
    expect(body.items).toBeUndefined();
    expect(body.composition).toBeUndefined();
    const step = (body.ladder as Array<{ rung: string; verdict: string; violations?: string[] }>).find((s) => s.rung === 'compose');
    expect(step?.verdict).toBe('refused');
    expect(step?.violations?.join(' ')).toContain('"clientes" is not one of the collections you hold');
  });

  /**
   * THE MAJOR, ON THE REAL WIRE: A GUESSED FIELD NAME IS A REFUSAL, NEVER A SHORTER LIST.
   *
   * The compose planning turn is the only step of this rung a model touches, and until this slice it
   * was shown no field name from either side while its output contract demanded three. `age` for
   * `idade` is exactly what that produces. The old behaviour on this exact request:
   *
   *     200 { "outcome": "composed", "items": [], "composition": { "matched": 0, ... } }
   *
   * - a well-formed, confident, WRONG answer. `matchesSimpleQuery` reads an absent field as
   * `undefined`, so the predicate selected nothing and the join emptied, and nothing anywhere on the
   * wire distinguishes that from "you genuinely have no client under 40". A lawyer reading their own
   * docket cannot tell the two apart.
   *
   * Now the name is checked against the very list the prompt offered, and the caller gets their
   * whole answer back with the reason beside it. The load-bearing pair is `items` absent and
   * `result.data.processos` at full length.
   */
  it('a field name the model INVENTED refuses the narrowing and returns the whole list', async () => {
    await seedDefinition([processos]);
    await seedClients();
    plans.compose = composeBlock({ ...COMPOSE_PLAN, where: { field: 'age', op: 'lt', value: 40 } });

    const body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL));

    expect(body.outcome).toBe('executed');
    expect(upstream.calls).toHaveLength(1);
    // THE LOAD-BEARING PAIR.
    expect(body.items).toBeUndefined();
    expect((body.result as { data?: { processos?: unknown[] } }).data?.processos).toHaveLength(PROCESS_ROWS.length);
    expect(body.composition).toBeUndefined();
    const step = (body.ladder as Array<{ rung: string; verdict: string; violations?: string[] }>).find((s) => s.rung === 'compose');
    expect(step?.verdict).toBe('refused');
    // The violation names the field AND the set that was offered, both off the tenant's real rows.
    expect(step?.violations?.join(' ')).toContain('"where.field": "age" is not a field of "clients"');
    expect(step?.violations?.join(' ')).toContain('idade');
    // No join happened, so no audit row claims one did.
    expect(await activityLogs.find({ type: 'capability_achieve_compose' })).toHaveLength(0);
  });

  /**
   * …AND THE SAME FOR THE ACTION SIDE, which is the half that had no honest set to check against
   * until the rung moved below the execute. `clienteId` is a field of the UPSTREAM's rows - nothing
   * in this platform declares it, `returnSchema` is absent on this action as it is on almost every
   * shipped one - so the set can only come from the answer itself.
   */
  it('a "join.resultField" the upstream rows do not carry refuses the narrowing too', async () => {
    await seedDefinition([processos]);
    await seedClients();
    plans.compose = composeBlock({ ...COMPOSE_PLAN, join: { resultField: 'clientId', collectionField: 'id' } });

    const body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL));

    expect(body.outcome).toBe('executed');
    expect(body.items).toBeUndefined();
    expect((body.result as { data?: { processos?: unknown[] } }).data?.processos).toHaveLength(PROCESS_ROWS.length);
    const step = (body.ladder as Array<{ rung: string; verdict: string; violations?: string[] }>).find((s) => s.rung === 'compose');
    expect(step?.violations?.join(' ')).toContain('"join.resultField": "clientId" is not a field of the rows the action returned');
    // The offered set is the UPSTREAM's own row keys, read off the answer this call produced.
    expect(step?.violations?.join(' ')).toContain('numeroProcesso');
  });

  /**
   * THE BLOCKER, ON THE REAL WIRE: the route must answer 200 with the action's own body when the
   * post-stage's STORE READ FAILS.
   *
   * The test above covers a collection the tenant does not HOLD - an answer the reader RETURNS.
   * This one covers the reader not answering at all, which is a different exit and was the one
   * still open after three rounds of removing refusals: `achieveCollections.read` is bound in
   * `server.ts` to `CollectionsEngine.list`, a live Mongo query that rejects on a dropped
   * connection, a timeout or a replica-set election. That rejection propagated out of
   * `applyComposition`, out of `achieveIntegrationGoal`, and into the route's error handler:
   *
   *   the caller's request reaches the upstream -> 200 with the processos ->
   *   our own database blips -> the caller gets a 500 from US, and no processos.
   *
   * The side effect is SPENT and the rows are IN HAND at the moment the post-stage fails. A
   * refusal, a swallowed answer and an exception are three exits from one wrong idea.
   *
   * THE FAILURE IS INJECTED AT THE STORE, not at a seam this suite invented: one rejection from the
   * real engine method the real binding calls. Everything above it - the router mount, the
   * owner-scoped binding, `applyComposition`, the route's response mapping - is the product.
   */
  it('a store failure in the post-stage does not cancel the read the product already made', async () => {
    await seedDefinition([processos]);
    await seedClients();
    plans.compose = composeBlock(COMPOSE_PLAN);

    const spy = vi.spyOn(CollectionsEngine.prototype, 'list')
      .mockRejectedValueOnce(new Error('MongoNetworkError: connection 4 to ekoa-primary.internal:27017 closed'));
    let body: Record<string, unknown>;
    try {
      // Before the fix this was a 500 and `okBody` never got a body to validate.
      body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL));
    } finally {
      spy.mockRestore();
    }

    // The upstream WAS called - the "already spent" half of the blocker.
    expect(upstream.calls).toHaveLength(1);
    // THE CALLER RECEIVES THE EXECUTED ARM'S BODY, whole.
    expect(body.outcome).toBe('executed');
    expect((body.result as { success: boolean }).success).toBe(true);
    expect((body.result as { data?: { processos?: unknown[] } }).data?.processos).toHaveLength(PROCESS_ROWS.length);
    expect(body.items).toBeUndefined();
    expect(body.composition).toBeUndefined();
    // The composition did not apply and the ladder SAYS so - not swallowed, not a refused call.
    const step = (body.ladder as Array<{ rung: string; verdict: string; detail?: string }>).find((s) => s.rung === 'compose');
    expect(step?.verdict).toBe('refused');
    expect(step?.detail).toContain('could not be read');
    // The store's message names our host and our driver; it must not reach a caller's wire.
    expect(JSON.stringify(body)).not.toContain('MongoNetworkError');
    expect(JSON.stringify(body)).not.toContain('ekoa-primary.internal');
    // No join happened, so no audit row claims one did.
    expect(await activityLogs.find({ type: 'capability_achieve_compose' })).toHaveLength(0);
  });

  it('a compose plan the guardrails REJECT does not cancel the read either', async () => {
    await seedDefinition([processos]);
    await seedClients();
    // No `where` and no `join`: `verifyComposePlan`'s shape check rejects the plan outright.
    plans.compose = composeBlock({ compose: true, collection: 'clients' });

    const body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL));

    // Before the fix: `refused` / `compose_refused`, and `upstream.calls` was EMPTY - a read that
    // executed long before this slice existed, ended by something a model wrote.
    expect(body.outcome).toBe('executed');
    expect(upstream.calls).toHaveLength(1);
    expect((body.result as { success: boolean }).success).toBe(true);
    const step = (body.ladder as Array<{ rung: string; verdict: string; violations?: string[] }>).find((s) => s.rung === 'compose');
    expect(step?.verdict).toBe('refused');
    expect(step?.violations?.join(' ')).toContain('"where" is missing');
    expect(step?.violations?.join(' ')).toContain('"join" is missing');
  });
});

// ---------------------------------------------------------------------------------------------
// 3. The seams are REACHABLE from the composition root
// ---------------------------------------------------------------------------------------------

describe('the composition root binds both new seams', () => {
  it('planStep is bound: an achieve with residual intent actually spends a planning turn', async () => {
    await seedDefinition([processos]);
    await okBody(await achieve(await tokenFor('ownerA'), 'processos do tribunal escolhido pelo utilizador'));
    // A `planStep` the router never received would leave this at zero and every rung `skipped`.
    expect(plans.turns).toBeGreaterThan(0);
  });

  it('appCollections is bound: the tenant\'s real collections are what the model is offered', async () => {
    await seedDefinition([processos]);
    await seedClients();
    plans.compose = composeBlock(COMPOSE_PLAN);
    const body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL));
    // Reaching `composed` at all requires BOTH the list (to get past the "no collections" skip)
    // and the read (to get rows) - i.e. the whole owner-scoped binding, not a stub.
    expect(body.outcome).toBe('composed');
  });
});
