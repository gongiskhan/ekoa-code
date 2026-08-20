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
 *   2. NAMING ANOTHER ORG'S COLLECTION READS NOTHING, and says the same thing a name nobody holds
 *      anywhere says. The composition simply does not apply, so the caller keeps the answer their
 *      OWN action produced (the ladder invariant: a rung may only ever ADD an answer) - and the two
 *      responses are asserted BYTE-IDENTICAL, which is what makes "no existence oracle" a property
 *      rather than a coincidence of wording. This used to be a `compose_unknown_collection`
 *      refusal, decided after the caller's own read had already succeeded.
 *   3. A SHARED COLLECTION NAME DOES NOT SHARE ROWS. Both orgs hold `clients`; the join must be
 *      built from the caller's rows only, and the assertion is a process row that would ONLY
 *      survive if the OTHER org's client had been read.
 *   4/5. A SAME-ORG COLLEAGUE IS A STRANGER TO THIS RUNG, private artifact or org-visible one.
 *      Test 5 is the blocker this suite was extended for: shared `app_data` is keyed
 *      `usr.<ownerUserId>` with NO app dimension, so binding a peer's VISIBLE artifact resolved to
 *      that peer's ENTIRE namespace - apps the caller cannot see, collections the artifact never
 *      names. Artifact visibility is not entitlement to its owner's rows.
 *   6. ONE OWNER IS ONE SCOPE. A second app owned by the caller must not make one namespace read
 *      twice look like two sources; deciding ambiguity per ARTIFACT over data scoped per OWNER
 *      refused every owner of a second app. Tests 5 and 6 were both verified RED against the
 *      per-artifact binding before it was replaced.
 *
 * THE MUTATION THAT PROVES IT IS A GATE: DELETE THE TENANCY FILTER at the single query-binding
 * point - drop `appId: scope.scopeKey` from `CollectionsEngine.list` (rows) or from
 * `listCollections` (the names put in the prompt). The suite goes red in both directions and
 * nothing else in the estate notices. Both were run; the results are in the slice report.
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

/** The compose rung's own verdict on this answer. `refused` here means the JOIN did not happen -
 *  it never means the CALL was refused, which is the whole point of the ladder invariant. */
const composeStep = (body: Record<string, unknown>) =>
  (body.ladder as Array<{ rung: string; verdict: string; detail?: string }> | undefined)?.find((s) => s.rung === 'compose');

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
  visibility: 'private' | 'org' = 'private',
): Promise<void> {
  await artifacts.insert({
    _id: artifactId, name: artifactId, slug: artifactId, userId, orgId, visibility,
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

  it('2. naming a collection only ANOTHER org holds reads nothing, and answers IDENTICALLY to a name nobody holds', async () => {
    // Org A holds a collection of its own, so the rung is entered (a tenant with none skips it).
    await seedApp('app-a', 'orgA', 'userA', { matters: [{ id: 'm1' }] });
    // The SAME name in both halves, so the two answers are compared directly rather than through
    // string surgery.
    //
    // HONEST NOTE ABOUT WHAT THE EQUALITY BELOW PROVES. It is a REGRESSION GUARD, not a mutation-
    // killable assertion, and saying so is better than letting it look like more. `applyComposition`
    // reads exactly one scope - the caller's own - so it holds no fact about org B to disclose, and
    // no mutation of it can make these two answers differ (one that fabricated a difference out of
    // `actor.orgId` survived the sweep, correctly, because it did not vary with the thing it claimed
    // to leak). What this pins is that a FUTURE reader which could tell - a "did you mean", a count
    // of other holders - reds here. The shape that keeps it impossible today is pinned separately,
    // in `achieve-reuse-ladder.test.ts`: `AppCollectionRead`'s not-found answer is a bare tag.
    plans.compose = composeBlock({ ...PLAN, collection: 'payroll' });

    // (i) NOBODY holds `payroll`, anywhere.
    const nobody = await okBody(await achieve(await tokenFor('userA')));
    expect(nobody.outcome).toBe('executed');
    expect(composeStep(nobody)?.verdict).toBe('refused');

    // (ii) ORG B holds `payroll`, with a row that would satisfy the predicate and key the join.
    await seedApp('app-b', 'orgB', 'userB', { payroll: [{ id: 'cA', idade: 31 }] });
    const peer = await okBody(await achieve(await tokenFor('userA')));

    // THE LOAD-BEARING ASSERTIONS. Nothing of org B's moved: no `items`, no `composition`. And the
    // answer is byte-identical to the one for a name that exists nowhere, so it discloses nothing
    // about whether some other tenant holds it.
    expect(peer.items).toBeUndefined();
    expect(peer.composition).toBeUndefined();
    expect(peer).toEqual(nobody);
    // …and the caller still got their OWN action's answer: the ladder never subtracts one.
    expect((peer.result as { success: boolean }).success).toBe(true);

    // The very same plan, for the org that owns those rows, composes.
    plans.compose = composeBlock({ ...PLAN, collection: 'payroll' });
    const owner = await okBody(await achieve(await tokenFor('userB')));
    expect(owner.outcome).toBe('composed');
    expect((owner.items as Array<{ numeroProcesso: string }>).map((r) => r.numeroProcesso)).toEqual(['111/24.0T8LSB']);
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
    // Not offered in the prompt, and not readable when named anyway.
    expect(plans.sections.join('\n')).not.toContain('clients');
    expect(body.items).toBeUndefined();
    expect(body.composition).toBeUndefined();
    expect(composeStep(body)?.verdict).toBe('refused');
    // The rung stood down; the call did not. userA keeps their own action's answer.
    expect(body.outcome).toBe('executed');
    expect((body.result as { success: boolean }).success).toBe(true);
  });

  it('5. a peer\'s ORG-VISIBLE artifact does not open that peer\'s owner-shared namespace', async () => {
    await mkUser('userA2', 'orgA');
    await seedApp('app-a', 'orgA', 'userA', { matters: [{ id: 'm1' }] });
    // The artifact userA MAY see. `app_data`'s shared rows are keyed `usr.<owner>` with NO artifact
    // dimension, so reading "this artifact's collections" reads the whole of userA2's namespace -
    // every app they own, including the ones userA cannot see, and collections this artifact never
    // names. Visibility of an ARTIFACT is not entitlement to its OWNER's data.
    await seedApp('app-a2', 'orgA', 'userA2', { clients: [{ id: 'cA', idade: 31 }] }, 'org');

    const body = await okBody(await achieve(await tokenFor('userA')));
    expect(plans.sections.join('\n')).not.toContain('clients');
    // `cA` keys process 111, so a binding that reached userA2's namespace would COMPOSE here and
    // hand userA a row selected by a colleague's data. Nothing was joined.
    expect(body.items).toBeUndefined();
    expect(body.composition).toBeUndefined();
    expect(composeStep(body)?.verdict).toBe('refused');
    expect(body.outcome).toBe('executed');
    expect((body.result as { success: boolean }).success).toBe(true);
  });

  it('6. an owner with TWO apps composes from their one owner-shared scope', async () => {
    // `sharedScope(artifactId, ownerUserId)` keys on `usr.<ownerUserId>` alone - `Scope.appId` is
    // carried but never queried on. So a SECOND app owned by the same person holds nothing of its
    // own: both artifacts address one namespace. A rung that decided anything per-ARTIFACT here
    // would see one collection as two sources and refuse a call that has no ambiguity in it.
    await seedApp('app-a', 'orgA', 'userA', { clients: [{ id: 'cA', idade: 31 }] });
    await seedApp('app-a-second', 'orgA', 'userA', { matters: [{ id: 'm1' }] });

    const body = await okBody(await achieve(await tokenFor('userA')));
    expect(body.outcome).toBe('composed');
    expect((body.items as Array<{ numeroProcesso: string }>).map((r) => r.numeroProcesso)).toEqual(['111/24.0T8LSB']);
    // Both collections are offered, once each: one namespace, not two sources of the same name.
    const prompt = plans.sections.join('\n');
    expect(prompt).toContain('clients');
    expect(prompt).toContain('matters');
  });
});
