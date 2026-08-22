import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { AutomationMigrationReportResponse, ErrorEnvelope, integrationsEndpoints } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { buildMigrationReport } from '../../src/automation/migration-report.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, automations } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';

/**
 * Slice S7 - the automations -> integrations MIGRATION REPORT, over the real app.
 *
 * Three things, and the third is the one a later tidy-up would break silently:
 *
 *  1. THE CONTRACT. The 200 validates against `AutomationMigrationReportResponse` and every non-2xx
 *     against the shared error envelope, through the one common helper.
 *
 *  2. REPORT-ONLY IS AN OBSERVABLE PROPERTY, not a claim in a comment. The suite counts the
 *     automation rows before and after the call and asserts the collection is byte-identical: the
 *     endpoint may classify anything it likes as long as it changes nothing.
 *
 *  3. THE LITERAL PATH OUTRANKS `:key`. `/automation-migration-report` shares its first segment
 *     position with `GET /api/v1/integrations/:key`, so a registration in the wrong order would make
 *     this endpoint answer as the CAPABILITY handler for an integration named
 *     "automation-migration-report" - a 404 that looks like an ordinary missing integration and
 *     reads, in CI, exactly like a feature that was never mounted.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const REPORT_PATH = '/api/v1/integrations/automation-migration-report';

const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const get = (p: string, t: string | null) =>
  fetch(`http://127.0.0.1:${port}${p}`, { headers: { ...(t ? { authorization: `Bearer ${t}` } : {}) } });

async function expectEnvelope(res: Response, status: number): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(ErrorEnvelope.safeParse(body).success, `non-2xx body must validate against ErrorEnvelope: ${JSON.stringify(body)}`).toBe(true);
}

async function expectReport(res: Response): Promise<AutomationMigrationReportResponse> {
  expect(res.status).toBe(200);
  const body = await res.json();
  const parsed = AutomationMigrationReportResponse.safeParse(body);
  expect(parsed.success, `2xx body must validate against AutomationMigrationReportResponse: ${JSON.stringify(body)}`).toBe(true);
  return parsed.data as AutomationMigrationReportResponse;
}

async function mkUser(id: string, orgId: string) {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'user', orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

async function seedAutomation(id: string, orgId: string, ownerUserId: string, over: Record<string, unknown> = {}) {
  await automations.insert({
    _id: id,
    id,
    orgId,
    ownerUserId,
    name: `A ${id}`,
    description: 'goal',
    steps: [{ id: 's1', description: 'call', type: 'api_call', apiRequest: { method: 'GET', url: 'https://api.example.test/v1/x' } }],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as never);
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_migration_report');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  for (const s of [users, automations]) await s.deleteMany({});
  await mkUser('ownerA', 'orgA');
  await mkUser('peerA', 'orgA');
  await mkUser('ownerB', 'orgB');
});

describe('S7 contract - the migration report answers the shared schema and nothing else', () => {
  it('the descriptor says what the route is: GET, user, that exact path', () => {
    expect(integrationsEndpoints.automationMigrationReport.method).toBe('GET');
    expect(integrationsEndpoints.automationMigrationReport.path).toBe(REPORT_PATH);
    expect(integrationsEndpoints.automationMigrationReport.auth).toBe('user');
  });

  it('an empty estate is an honest empty report, not a 404', async () => {
    const report = await expectReport(await get(REPORT_PATH, await tokenFor('ownerA')));
    expect(report.mode).toBe('report-only');
    expect(report.scanned).toBe(0);
    expect(report.entries).toEqual([]);
    expect(report.truncated).toBe(false);
    expect(report.errors).toEqual([]);
  });

  it('classifies the caller\'s own automations and counts them into the tiers', async () => {
    await seedAutomation('flat1', 'orgA', 'ownerA');
    await seedAutomation('wrap1', 'orgA', 'ownerA', {
      steps: [{ id: 's1', description: 'click', type: 'browser' }],
    });

    const report = await expectReport(await get(REPORT_PATH, await tokenFor('ownerA')));
    expect(report.scanned).toBe(2);
    expect(report.tiers.flatten).toBe(1);
    expect(report.tiers.wrap).toBe(1);
    expect(report.tiers.engineInternalBehindWrappers).toBe(1);

    const wrapped = report.entries.find((e) => e.automationId === 'wrap1');
    expect(wrapped?.engineInternal).toContain('rehearsal-vision');
    expect(wrapped?.degradations).toContain('mid-run-pause-collapses');
  });

  it('WRITES NOTHING: the automations collection is identical before and after the call', async () => {
    await seedAutomation('flat1', 'orgA', 'ownerA');
    await seedAutomation('wrap1', 'orgA', 'ownerA', { steps: [{ id: 's1', description: 'click', type: 'browser' }] });
    // WHOLE documents, in a deterministic order (the second argument is `Store.find`'s SORT, not a
    // projection): every field of every row, so a new stamp or a rewritten step is a difference.
    const wholeCollection = async () => JSON.stringify(await automations.find({}, { _id: 1 }));
    const before = await wholeCollection();

    await expectReport(await get(REPORT_PATH, await tokenFor('ownerA')));

    expect(await wholeCollection()).toBe(before);
  });

  it('refuses an unauthenticated caller with the shared envelope', async () => {
    await expectEnvelope(await get(REPORT_PATH, null), 401);
  });
});

/**
 * THE ROUTE'S TENANCY, AT THE ROUTE (review round BLOCKER / F1 / F17 / F21).
 *
 * The first cut pinned this at the wrong unit. The isolation suite drives `buildMigrationReport`
 * directly with hand-passed scopes, so it proves the module's filter arithmetic and says nothing
 * about the route's argument passing; and this contract suite seeded exactly one user in one org,
 * so the caller scope, the org scope and the ESTATE scope all returned identical bytes. Changing
 * the route to `buildMigrationReport({})` - which hands every tenant's automation names to any
 * authenticated caller - left all 46 tests green.
 *
 * THE TWO-LAYER FORM, and it is the point rather than ceremony: asserting an absence proves nothing
 * on its own, because an empty database also has no orgB rows. Each case first shows through the
 * MODULE at estate scope that the row is really there and really classifiable, and only then asserts
 * the authenticated HTTP response omits it. That is what makes the refusal attributable to the
 * route, which is the thing under test.
 */
describe('S7 tenancy AT THE ROUTE - what the endpoint refuses, and that the refusal is the route\'s', () => {
  /** Every automation id the module can see with no scope at all - the estate the route must narrow. */
  const estateIds = async () => (await buildMigrationReport({})).entries.map((e) => e.automationId).sort();

  const reportIds = async (token: string) => (await expectReport(await get(REPORT_PATH, token))).entries.map((e) => e.automationId).sort();

  it('another org\'s automations are absent, and the estate scope proves they were there to leak', async () => {
    await seedAutomation('mine', 'orgA', 'ownerA');
    await seedAutomation('theirs', 'orgB', 'ownerB');

    // LAYER 1 - the rows exist and the module classifies both when nothing narrows it.
    expect(await estateIds()).toEqual(['mine', 'theirs']);

    // LAYER 2 - the route hands the caller only their own org's.
    expect(await reportIds(await tokenFor('ownerA'))).toEqual(['mine']);
    expect(await reportIds(await tokenFor('ownerB'))).toEqual(['theirs']);
  });

  it('a same-org peer\'s PRIVATE automation is absent, while their org-visible one is not', async () => {
    await seedAutomation('mine', 'orgA', 'ownerA');
    await seedAutomation('peer-shared', 'orgA', 'peerA', { visibility: 'org' });
    await seedAutomation('peer-private', 'orgA', 'peerA', { visibility: 'private' });

    expect(await estateIds()).toEqual(['mine', 'peer-private', 'peer-shared']);

    // The org filter alone would hand back all three: only the reader term removes the private row.
    expect(await reportIds(await tokenFor('ownerA'))).toEqual(['mine', 'peer-shared']);
    // …and it is genuinely the READER's, not a blanket hide: its owner still sees it.
    expect(await reportIds(await tokenFor('peerA'))).toEqual(['mine', 'peer-private', 'peer-shared']);
  });

  it('the caller\'s OWN private automation is theirs to see, so the filter is not "hide every private row"', async () => {
    await seedAutomation('mine-private', 'orgA', 'ownerA', { visibility: 'private' });
    expect(await reportIds(await tokenFor('ownerA'))).toEqual(['mine-private']);
  });

  it('no automation NAME from another tenant reaches the body, which is why this endpoint is not user-or-key', async () => {
    await seedAutomation('theirs', 'orgB', 'ownerB', { name: 'Faturas confidenciais do outro escritório' });
    await seedAutomation('mine', 'orgA', 'ownerA');

    const res = await get(REPORT_PATH, await tokenFor('ownerA'));
    expect(res.status).toBe(200);
    // Asserted on the raw bytes rather than the parsed entries: a name leaking through any field -
    // an error string, a destination, a future addition - fails here too.
    expect(await res.text()).not.toContain('confidenciais');
  });

  it('is NOT swallowed by the :key capability route - the literal path wins', async () => {
    const t = await tokenFor('ownerA');
    // The capability handler answers 404 for an unknown key. A report body proves this request did
    // not reach it; a 404 here would mean the router matched `:key` first.
    const report = await expectReport(await get(REPORT_PATH, t));
    expect(report.mode).toBe('report-only');

    // …and the capability route still works for an ordinary (absent) key, so the fix is ordering and
    // not a route that shadows the capability surface.
    const absent = await get('/api/v1/integrations/no-such-integration-key', t);
    expect(absent.status).toBe(404);
  });
});
