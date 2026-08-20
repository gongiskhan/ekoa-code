import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
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
import type { IntegrationAction } from '../../src/integrations/definitions.js';
import { AchieveIntegrationGoalResponse } from '@ekoa/shared';

/**
 * `achieve` COMPOSE-RUNG ISOLATION suite (slice S5), of the class of
 * `api/tests/security/memvault-isolation.test.ts`.
 *
 * The compose rung is a NEW READ PATH into an existing tenant-scoped store: it takes a collection
 * NAME chosen by a model and turns it into rows of somebody's `app_data`. Rule 5 says tenancy is
 * enforced here and never in the consumer, so this suite attacks the boundary directly, through
 * the REAL app and the REAL composition-root binding rather than through a stub of it:
 *
 *   1. THE NAMES A MODEL MAY CHOOSE FROM ARE THIS TENANT'S. A collection that exists only in
 *      another org must not appear in the prompt at all - a leak of "org B runs a `payroll` app"
 *      is a leak before a single row moves.
 *   2. NAMING ANOTHER ORG'S COLLECTION READS NOTHING. The same name that resolves for its owner
 *      is `compose_unknown_collection` for a peer org, byte-identical with a name nobody holds.
 *   3. A SHARED COLLECTION NAME DOES NOT SHARE ROWS. Both orgs hold `clients`; the join must be
 *      built from the caller's rows only, and the assertion is a process row that would ONLY
 *      survive if the OTHER org's client had been read.
 *
 * THE MUTATION THAT PROVES IT IS A GATE: replace `listArtifacts(actor)` in the `achieveCollections`
 * binding (`api/src/server.ts`) with an unscoped `artifacts.find({})`. Every test in this file goes
 * red, and nothing else in the estate notices. That was run, and the result is in the slice report.
 */
const upstream = vi.hoisted(() => ({ calls: [] as string[], body: '{}' }));
vi.mock('../../src/services/url-fetcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/url-fetcher.js')>();
  return {
    ...actual,
    guardedFetch: async (url: string) => {
      upstream.calls.push(url);
      return new Response(upstream.body, { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
});

/** The faked planning turn, plus the PROMPT it was given - test 1 asserts on that prompt. */
const plans = vi.hoisted(() => ({ compose: '', sections: [] as string[] }));
vi.mock('../../src/agents/authoring-core.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/authoring-core.js')>();
  return {
    ...actual,
    authorWithRepair: async (input: {
      contentSections: readonly string[];
      outputContract: string;
      userText: (v: readonly string[] | null) => string;
      parse: (t: string) => { draft: unknown; violations: string[] };
    }) => {
      plans.sections.push([...input.contentSections].join('\n'));
      input.userText(null);
      const parsed = input.parse(plans.compose);
      return { status: 'authored' as const, text: plans.compose, draft: parsed.draft, violations: parsed.violations, attempts: 1 };
    },
  };
});

let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const PROBE_INTEGRATION = 's5-compose-isolation';
const HOST = 'https://compose-isolation.example';
const GOAL = 'todos os processos de clientes com menos de 40 anos';

/** No declared arguments, so the PARAMETRIZE rung never fires and every planning turn in this
 *  file is the compose one - the prompt assertion in test 1 would otherwise be ambiguous. */
const processos: IntegrationAction = {
  actionName: 'processos',
  description: 'Processos do mandatario',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/processos' },
};

const PROCESS_ROWS = [
  { numeroProcesso: '111/24.0T8LSB', clienteId: 'cA' },
  { numeroProcesso: '222/24.0T8PRT', clienteId: 'cB' },
];

const PLAN = {
  compose: true,
  collection: 'clients',
  where: { field: 'idade', op: 'lt', value: 40 },
  join: { resultField: 'clienteId', collectionField: 'id' },
};

const composeBlock = (plan: Record<string, unknown>) => `\`\`\`compose-json\n${JSON.stringify(plan)}\n\`\`\``;

const call = (p: string, auth: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}`, ...(init.headers ?? {}) },
  });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const achieve = (auth: string) =>
  call(`/api/v1/integrations/${PROBE_INTEGRATION}/achieve`, auth, { method: 'POST', body: JSON.stringify({ goal: GOAL }) });

async function okBody(res: Response): Promise<Record<string, unknown>> {
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(AchieveIntegrationGoalResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
  return body;
}

async function mkUser(id: string, orgId: string): Promise<void> {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'user', orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

/** Each org gets its OWN definition under the same key - A2's tenant-scoped registry. */
async function seedDefinition(orgId: string, userId: string): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId, visibility: 'private', key: PROBE_INTEGRATION,
      displayName: 'Compose isolation', configSchema: [], actions: [processos], skillMd: '# probe', authType: 'none',
    },
    { actor: { userId, orgId, role: 'user' }, onConflict: 'replace' },
  );
}

/** An artifact + its collection rows, written through the production writers under the SAME scope
 *  the composition root reads them back with. */
async function seedApp(
  artifactId: string,
  orgId: string,
  userId: string,
  collections: Record<string, Array<Record<string, unknown>>>,
): Promise<void> {
  await artifacts.insert({
    _id: artifactId, name: artifactId, slug: artifactId, userId, orgId, visibility: 'private',
    status: 'ready', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as never);
  const engine = new CollectionsEngine(deps);
  const scope = sharedScope(artifactId, userId);
  for (const [name, rows] of Object.entries(collections)) {
    for (const row of rows) await engine.create(scope, name, row);
  }
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s5_compose_isolation');
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
  upstream.body = JSON.stringify({ processos: PROCESS_ROWS });
  plans.sections.length = 0;
  plans.compose = composeBlock(PLAN);
  for (const s of [users, gatewayKeys, activityLogs, billingAccounts, integrationConfigs, integrationDefinitions, approvedIntegrationActions, artifacts]) {
    await s.deleteMany({});
  }
  await getDb().collection(APP_DATA_COLLECTION).deleteMany({});
  await mkUser('userA', 'orgA');
  await mkUser('userB', 'orgB');
  await seedDefinition('orgA', 'userA');
  await seedDefinition('orgB', 'userB');
});

describe('the compose rung cannot see another organisation\'s collections', () => {
  it('1. the collection NAMES offered to the model are the caller\'s own', async () => {
    await seedApp('app-a', 'orgA', 'userA', { clients: [{ id: 'cA', idade: 31 }] });
    await seedApp('app-b', 'orgB', 'userB', { payroll: [{ id: 'p1', salario: 1 }] });

    await okBody(await achieve(await tokenFor('userA')));

    const prompt = plans.sections.join('\n');
    expect(prompt).toContain('clients');
    // Even the EXISTENCE of org B's app is a leak, before a row moves.
    expect(prompt).not.toContain('payroll');
  });

  it('2. naming a collection only ANOTHER org holds reads nothing and answers like a name nobody holds', async () => {
    await seedApp('app-b', 'orgB', 'userB', { clients: [{ id: 'cB', idade: 20 }] });
    // Org A holds a collection of its own, so the rung is entered (a tenant with none skips it).
    await seedApp('app-a', 'orgA', 'userA', { matters: [{ id: 'm1' }] });

    const body = await okBody(await achieve(await tokenFor('userA')));
    expect(body.outcome).toBe('refused');
    expect(body.code).toBe('compose_unknown_collection');

    // The very same plan, for the org that owns the rows, composes.
    const owner = await okBody(await achieve(await tokenFor('userB')));
    expect(owner.outcome).toBe('composed');
  });

  it('3. a collection name both orgs hold does not share its rows', async () => {
    // Org A: only cA is under 40. Org B: cB is under 40, and process 222 keys on cB.
    await seedApp('app-a', 'orgA', 'userA', { clients: [{ id: 'cA', idade: 31 }] });
    await seedApp('app-b', 'orgB', 'userB', { clients: [{ id: 'cB', idade: 20 }] });

    const body = await okBody(await achieve(await tokenFor('userA')));
    expect(body.outcome).toBe('composed');
    const items = body.items as Array<{ numeroProcesso: string }>;
    // THE LOAD-BEARING ASSERTION: 222 survives ONLY if org B's client row was read.
    expect(items.map((r) => r.numeroProcesso)).toEqual(['111/24.0T8LSB']);
    const composition = body.composition as { matchedCollectionRows: number };
    expect(composition.matchedCollectionRows).toBe(1);

    // …and the mirror image, so the assertion is about scoping rather than about which row happens
    // to be first: org B sees exactly its own.
    plans.sections.length = 0;
    const other = await okBody(await achieve(await tokenFor('userB')));
    expect((other.items as Array<{ numeroProcesso: string }>).map((r) => r.numeroProcesso)).toEqual(['222/24.0T8PRT']);
  });

  it('4. a peer\'s PRIVATE artifact inside the same org is invisible too (the rule is the platform\'s own)', async () => {
    await mkUser('userA2', 'orgA');
    await seedApp('app-a', 'orgA', 'userA', { matters: [{ id: 'm1' }] });
    // Same org, another user, `visibility: 'private'` - not visible to userA by the platform's own
    // predicate, so its collections are neither named nor readable here either.
    await seedApp('app-a2', 'orgA', 'userA2', { clients: [{ id: 'cA', idade: 31 }] });

    const body = await okBody(await achieve(await tokenFor('userA')));
    expect(plans.sections.join('\n')).not.toContain('clients');
    expect(body.outcome).toBe('refused');
    expect(body.code).toBe('compose_unknown_collection');
  });
});
