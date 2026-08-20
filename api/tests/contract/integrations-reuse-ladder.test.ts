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
 * The tenant's `clients` collection, seeded through the PRODUCTION WRITERS: an artifact row of the
 * shape `createArtifact` writes, and rows through `CollectionsEngine.create` under the SAME
 * `sharedScope(artifactId, ownerUserId)` the composition root reads them back with. A fixture
 * written any other way would prove the join works on a shape production cannot emit.
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

  it('a plan naming an argument the action does not declare refuses, and nothing is sent', async () => {
    await seedDefinition([processos]);
    plans.args = argsBlock({ tribunal: 'Porto', api_base: 'https://elsewhere.example' });

    const body = await okBody(await achieve(await tokenFor('ownerA'), 'processos do tribunal certo'));
    expect(body.outcome).toBe('refused');
    expect(body.code).toBe('parametrize_refused');
    expect((body.violations as string[]).join(' ')).toContain('api_base');
    expect(upstream.calls).toHaveLength(0);
  });

  it('D1 on the real wire: a model that fills the TARGETING argument of a write is refused', async () => {
    await seedDefinition([submeterPeca]);
    // The model is only offered `titulo`; it answers with `numero` as well.
    plans.args = argsBlock({ titulo: 'Contestacao', numero: '999/24.0T8LSB' });

    const body = await okBody(await achieve(await tokenFor('ownerA'), 'submeter peca de contestacao'));
    expect(body.outcome).toBe('refused');
    expect(body.code).toBe('parametrize_refused');
    expect((body.violations as string[]).join(' ')).toContain('numero');
    expect(upstream.calls).toHaveLength(0);
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
    // The rungs considered, on the wire.
    const ladder = body.ladder as Array<{ rung: string; verdict: string }>;
    expect(ladder.find((s) => s.rung === 'compose')?.verdict).toBe('taken');

    // NOTHING WAS MINTED.
    const doc = await integrationDefinitionStore.getForActor({ userId: 'ownerA', orgId: 'orgA', role: 'user' }, PROBE_INTEGRATION);
    expect((doc?.actions ?? []).map((a) => a.actionName)).toEqual(['processos']);
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

  it('a collection name the tenant does not hold is refused by name', async () => {
    await seedDefinition([processos]);
    await seedClients();
    plans.compose = composeBlock({ ...COMPOSE_PLAN, collection: 'clientes' });

    const body = await okBody(await achieve(await tokenFor('ownerA'), CANONICAL_GOAL));
    expect(body.outcome).toBe('refused');
    expect(body.code).toBe('compose_unknown_collection');
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
