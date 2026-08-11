import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings, activityLogs, jobs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { setCredential } from '../../src/llm/credentials.js';
import { __setTransportForTests, __resetTransportForTests, proxyGatewayMessages } from '../../src/llm/client.js';
import { makeFakeTransport } from '../agents/_fake-transport.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { RegistoListResponse, RegistoEntry } from '@ekoa/shared';

/**
 * F3 (batch-final s3): the covered actions produce Registo rows visible to the org admin,
 * metadata-only. Registo READ + org scoping already worked; the gap was that no login and no
 * build lifecycle event was ever audit-logged, so the org's admin oversight surface was blind
 * to the headline events. This drives the REAL routes (login -> /jobs -> /registo) and asserts
 * the rows appear, validate against the shared schema, are org-scoped, and carry NO prompt text.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
const BUILD_DESC = 'construir um CRM secreto para o cliente Petrova';

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_registo_contract');
  await setCredential({ mode: 'oauth', secret: 'tok' });
  __setTransportForTests(makeFakeTransport({ finalText: 'built' }));
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
// Builds fire async (POST /jobs returns 202 while executeBuildJob runs on the fake transport).
// Drain them before closing mongo so an in-flight build's terminal store reads settle first —
// by POLLING for terminal status, not a fixed sleep (a 400ms sleep raced under machine load and
// an in-flight patchJob then rejected on the closed Mongo; observed 2026-07-12 full-suite run).
afterAll(async () => {
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
  for (let i = 0; i < 200; i++) {
    const rows = (await jobs.find({})) as Array<{ status?: string }>;
    if (rows.every((j) => typeof j.status === 'string' && TERMINAL.has(j.status))) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  __resetTransportForTests(); server.close(); await closeMongo(); await mem.stop();
});
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await activityLogs.deleteMany({}); await userSettings.deleteMany({});
  // H1: building an app now requires canBuildApps (org-admin+); the org-member-of-record that
  // POSTs the build below is an org-admin so its build.created row is produced (a plain `user`
  // would be refused 403 at the capability gate before any job/audit row exists).
  for (const [id, role, org] of [['admA', 'org-admin', 'orgA'], ['bldA', 'org-admin', 'orgA'], ['admB', 'org-admin', 'orgB']] as const) {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: org, active: true });
    setActivation(id, { active: true, billingLocked: false });
    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
  }
});
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const registo = async (t: string) => readJson(await authed('/api/v1/registo?limit=500', t));
// The default-view masking-events filter (registo-anon-audit-actor-blank mitigation) is opted
// back into with this - see the `F-registo-mask-default-filter` describe block below.
const registoWithMasks = async (t: string) => readJson(await authed('/api/v1/registo?limit=500&includeAnonymisation=true', t));

describe('F3 Registo: login + build + session rows, org-scoped, metadata-only', () => {
  it('a login produces an auth.login row visible to the org admin, schema-valid', async () => {
    await tokenFor('bldA'); // the audited login
    const admT = await tokenFor('admA');
    const body = await registo(admT);
    expect(RegistoListResponse.safeParse(body).success, JSON.stringify(RegistoListResponse.safeParse(body))).toBe(true);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items.some((r) => r.actionType === 'auth.login' && r.actor === 'bldA')).toBe(true);
  });

  it('POST /sessions produces a session.create row; POST /jobs produces a build.created row', async () => {
    const t = await tokenFor('bldA');
    await authed('/api/v1/sessions', t, { method: 'POST', body: JSON.stringify({ name: 'Nova sessão' }) });
    await authed('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: BUILD_DESC, sessionId: 'sReg', language: 'pt' }) });
    const admT = await tokenFor('admA');
    const items = (await registo(admT)).items as Array<Record<string, unknown>>;
    expect(items.some((r) => r.actionType === 'session.create')).toBe(true);
    expect(items.some((r) => r.actionType === 'build.created' && r.actor === 'bldA')).toBe(true);
  });

  it('every row validates against RegistoEntry (targetIds is an ARRAY, not the metadata object)', async () => {
    const t = await tokenFor('bldA');
    await authed('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: BUILD_DESC, sessionId: 'sReg2', language: 'pt' }) });
    const admT = await tokenFor('admA');
    const items = (await registo(admT)).items as Array<Record<string, unknown>>;
    for (const item of items) {
      const p = RegistoEntry.safeParse(item);
      expect(p.success, `row ${String(item.actionType)}: ${JSON.stringify(p.success ? {} : p.error.issues)}`).toBe(true);
    }
    const build = items.find((r) => r.actionType === 'build.created')!;
    expect(Array.isArray(build.targetIds)).toBe(true); // the F3/F22-class wire-shape fix
  });

  it('rows are org-scoped: org B admin sees NONE of org A\'s activity', async () => {
    await tokenFor('bldA'); // org A login
    const admB = await tokenFor('admB');
    const items = (await registo(admB)).items as Array<Record<string, unknown>>;
    expect(items.some((r) => r.actor === 'bldA')).toBe(false);
    expect(items.every((r) => r.orgId === 'orgB')).toBe(true);
  });

  it('rows are METADATA-ONLY: no prompt/description text, no password, ever', async () => {
    const t = await tokenFor('bldA');
    await authed('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: BUILD_DESC, sessionId: 'sReg3', language: 'pt' }) });
    const admT = await tokenFor('admA');
    const serialized = JSON.stringify(await registo(admT));
    expect(serialized).not.toContain('Petrova'); // the build description never reaches the audit surface
    expect(serialized).not.toContain('secreto');
    expect(serialized).not.toContain('pw123456'); // the password never reaches the audit surface
  });
});

/**
 * Find the anonymisation-audit row a specific `proxyGatewayMessages` call produced, by its
 * OWN correlationId (the join key `recordAnonAudit` stamps into `metadata.correlationId`,
 * ch17 §17.6) - never by a coarse `{category: 'anonymisation'}` / `{userId: 'system'}` query.
 * Every describe block below calls `proxyGatewayMessages(..., '')`, and several other tests in
 * this FILE (the build-job tests above, other `proxyGatewayMessages`/`runAgent` calls elsewhere
 * in the suite) also write 'anonymisation' rows through the SAME fire-and-forget path
 * (`audit.ts`); under load one can straggle past its own test's `beforeEach` cleanup and land
 * during a later test's short polling window. A coarse query can silently pick up that leftover
 * instead of the row this test caused (observed: a second, unrelated 'system' row landed mid-run
 * once six-plus sibling agents were hammering the same machine) - matching on the exact
 * correlationId this call minted makes the lookup correct regardless of that noise.
 */
async function findOwnMaskRow(correlationId: string): Promise<{ _id: string; userId?: string; username?: string; orgId?: string } | undefined> {
  for (let i = 0; i < 50; i++) {
    const rows = (await activityLogs.find({ category: 'anonymisation', 'metadata.correlationId': correlationId })) as Array<{ _id: string; userId?: string; username?: string; orgId?: string }>;
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 20));
  }
  return undefined;
}

describe('F-registo-actor-blank: an anonymisation-audit row with no per-request principal still validates', () => {
  // The empirically-confirmed root cause: `proxyGatewayMessages`/`proxyGatewayCountTokens`
  // (llm/client.ts) are the real call path for the static gateway-key principal - the credential
  // EVERY Agent SDK subprocess presents when it talks back to this chokepoint (buildSubprocessEnv,
  // credentials.ts). That principal carries no per-request user identity, so `billeeUserId` is ''
  // - which used to flow straight into the anon-audit actor and fail RegistoEntry's
  // `actor: Id = z.string().min(1)` on read. Drive the REAL audit path (not a hand-inserted doc)
  // and assert the persisted row now carries the 'system' sentinel and validates.
  it('the row is tagged with the "system" sentinel (never blank) and only a super-admin sees it', async () => {
    const result = await proxyGatewayMessages({ messages: [{ role: 'user', content: 'hello there' }] }, '');
    const row = await findOwnMaskRow(result.correlationId);
    expect(row, 'the anon-audit row for this call never landed').toBeTruthy();
    expect(row!.userId).toBe('system'); // the belt-fix sentinel - never '' (audit.ts)
    expect(row!.username).toBe('system');
    expect(row!.orgId).toBe('system');

    await users.insert({ _id: 'superA', username: 'superA', passwordHash: await hashPassword('pw123456'), role: 'super-admin', orgId: 'orgA', active: true });
    setActivation('superA', { active: true, billingLocked: false });
    const superT = await tokenFor('superA');
    // includeAnonymisation=true: the default-view masking filter (F-registo-mask-default-filter,
    // below) would otherwise hide this row from even a super-admin's unscoped view.
    const body = await registoWithMasks(superT);
    expect(RegistoListResponse.safeParse(body).success, JSON.stringify(RegistoListResponse.safeParse(body))).toBe(true);
    const items = body.items as Array<Record<string, unknown>>;
    const maskRow = items.find((r) => r.id === row!._id);
    expect(maskRow).toBeTruthy();
    expect(RegistoEntry.safeParse(maskRow).success, JSON.stringify(RegistoEntry.safeParse(maskRow))).toBe(true);
    expect(maskRow!.actor).toBe('system'); // registoEntry() maps actor <- userId
  });

  it('an org-admin never sees the system-attributed row (orgId sentinel never matches a real org, AND the default masking filter hides it anyway)', async () => {
    const result = await proxyGatewayMessages({ messages: [{ role: 'user', content: 'hi again' }] }, '');
    const row = await findOwnMaskRow(result.correlationId);
    expect(row).toBeTruthy();
    const admT = await tokenFor('admA');
    const items = (await registo(admT)).items as Array<Record<string, unknown>>;
    expect(items.some((r) => r.id === row!._id)).toBe(false);
    // even asking explicitly (org-admin, includeAnonymisation=true): still org-scoped out.
    const itemsIncl = (await registoWithMasks(admT)).items as Array<Record<string, unknown>>;
    expect(itemsIncl.some((r) => r.id === row!._id)).toBe(false);
  });
});

describe('F-registo-mask-default-filter: category:\'anonymisation\' is hidden by default, visibly reversible', () => {
  // registo-anon-audit-actor-blank mitigation (docs/findings.md): a single chat/build turn's
  // Agent SDK subprocess writes many `anonymisation.egress-mask` rows per one human action, so
  // `readRegisto` hides that category by default in the one place it would otherwise dominate -
  // a super-admin's unscoped cross-org view. Never silent: `includeAnonymisation=true` or an
  // explicit `type` always wins.
  it('super-admin unscoped, no filters: the mask row is absent by default, present with includeAnonymisation=true', async () => {
    const result = await proxyGatewayMessages({ messages: [{ role: 'user', content: 'default-filter probe' }] }, '');
    const row = await findOwnMaskRow(result.correlationId);
    expect(row).toBeTruthy();

    await users.insert({ _id: 'superB', username: 'superB', passwordHash: await hashPassword('pw123456'), role: 'super-admin', orgId: 'orgA', active: true });
    setActivation('superB', { active: true, billingLocked: false });
    const superT = await tokenFor('superB');

    const byDefault = await registo(superT);
    expect(RegistoListResponse.safeParse(byDefault).success).toBe(true);
    const defaultItems = byDefault.items as Array<Record<string, unknown>>;
    expect(defaultItems.some((r) => r.id === row!._id)).toBe(false);
    expect(defaultItems.some((r) => r.actionType === 'anonymisation.egress-mask')).toBe(false);

    const included = await registoWithMasks(superT);
    expect(RegistoListResponse.safeParse(included).success).toBe(true);
    const includedItems = included.items as Array<Record<string, unknown>>;
    expect(includedItems.some((r) => r.id === row!._id)).toBe(true);
  });

  it('an explicit type filter always wins, without includeAnonymisation', async () => {
    const result = await proxyGatewayMessages({ messages: [{ role: 'user', content: 'explicit-type probe' }] }, '');
    const row = await findOwnMaskRow(result.correlationId);
    expect(row).toBeTruthy();

    await users.insert({ _id: 'superC', username: 'superC', passwordHash: await hashPassword('pw123456'), role: 'super-admin', orgId: 'orgA', active: true });
    setActivation('superC', { active: true, billingLocked: false });
    const superT = await tokenFor('superC');

    const body = await readJson(await authed('/api/v1/registo?limit=500&type=anonymisation.egress-mask', superT));
    expect(RegistoListResponse.safeParse(body).success).toBe(true);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items.some((r) => r.id === row!._id)).toBe(true);
    expect(items.every((r) => r.actionType === 'anonymisation.egress-mask')).toBe(true);
  });
});

describe('F-registo-date-filter: RegistoQuery.from/to are wired through to the read', () => {
  it('to=<row A timestamp> excludes a later row; from=<row B timestamp> excludes the earlier one', async () => {
    const t = await tokenFor('bldA');
    await authed('/api/v1/sessions', t, { method: 'POST', body: JSON.stringify({ name: 'Early' }) });
    const admT1 = await tokenFor('admA');
    const early = ((await registo(admT1)).items as Array<Record<string, unknown>>).find((r) => r.actionType === 'session.create')!;
    const earlyTs = early.timestamp as string;

    await authed('/api/v1/sessions', t, { method: 'POST', body: JSON.stringify({ name: 'Late' }) });
    const admT2 = await tokenFor('admA');
    const late = ((await registo(admT2)).items as Array<Record<string, unknown>>).find(
      (r) => r.actionType === 'session.create' && r.timestamp !== earlyTs,
    )!;
    const lateTs = late.timestamp as string;
    expect(lateTs > earlyTs).toBe(true); // sanity: distinct, increasing timestamps

    const admT3 = await tokenFor('admA');
    const uptoEarly = await readJson(await authed(`/api/v1/registo?limit=500&to=${encodeURIComponent(earlyTs)}`, admT3));
    expect(RegistoListResponse.safeParse(uptoEarly).success).toBe(true);
    const uptoEarlyCreates = (uptoEarly.items as Array<Record<string, unknown>>).filter((r) => r.actionType === 'session.create');
    expect(uptoEarlyCreates.map((r) => r.timestamp)).toEqual([earlyTs]);

    const admT4 = await tokenFor('admA');
    const fromLate = await readJson(await authed(`/api/v1/registo?limit=500&from=${encodeURIComponent(lateTs)}`, admT4));
    expect(RegistoListResponse.safeParse(fromLate).success).toBe(true);
    const fromLateCreates = (fromLate.items as Array<Record<string, unknown>>).filter((r) => r.actionType === 'session.create');
    expect(fromLateCreates.map((r) => r.timestamp)).toEqual([lateTs]);
  });
});
