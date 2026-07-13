import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, anonymisationDenyLists, activityLogs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { DenyListEntry, DenyListListResponse, OkResponse, ErrorEnvelope } from '@ekoa/shared';
import { __resetDenyListCacheForTests } from '../../src/services/deny-list.js';

/**
 * F10 (batch-final s1) — the org deny-list CRUD contract (`/api/v1/org/deny-list`, ch17 §17.4 b,
 * ch04 §4.3). The management surface did not exist; an org had NO way to register the firm
 * party names the anonymiser must mask. Bar: org-admin-only CRUD, responses metadata-only
 * (the cleartext value NEVER comes back — ch04 §4.3.4), value encrypted at rest, org-B blind,
 * writes audit-logged ids-only.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
const LITERAL = 'Sociedade Petrova Lda';

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_denylist_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests(); __resetDenyListCacheForTests();
  await users.deleteMany({}); await anonymisationDenyLists.deleteMany({}); await activityLogs.deleteMany({});
  for (const [id, role, org] of [['admA', 'org-admin', 'orgA'], ['bldA', 'user', 'orgA'], ['admB', 'org-admin', 'orgB']] as const) {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: org, active: true });
    setActivation(id, { active: true, billingLocked: false });
  }
});
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

describe('POST/GET/DELETE /api/v1/org/deny-list (F10 CRUD contract)', () => {
  it('org-admin adds an entry: 201, DenyListEntry-valid, and the LITERAL never comes back', async () => {
    const t = await tokenFor('admA');
    const res = await authed('/api/v1/org/deny-list', t, { method: 'POST', body: JSON.stringify({ value: LITERAL }) });
    expect(res.status).toBe(201);
    const body = await readJson(res);
    const p = DenyListEntry.safeParse(body);
    expect(p.success, JSON.stringify(p.success ? {} : p.error.issues)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('Petrova');

    const list = await readJson(await authed('/api/v1/org/deny-list', t));
    const lp = DenyListListResponse.safeParse(list);
    expect(lp.success, JSON.stringify(lp.success ? {} : lp.error.issues)).toBe(true);
    expect((list.items as unknown[]).length).toBe(1);
    expect(JSON.stringify(list)).not.toContain('Petrova');
  });

  it('the stored row is encrypted at rest (never the plaintext value)', async () => {
    const t = await tokenFor('admA');
    await authed('/api/v1/org/deny-list', t, { method: 'POST', body: JSON.stringify({ value: LITERAL }) });
    const rows = (await anonymisationDenyLists.find({})) as unknown as Array<{ value: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).not.toContain('Petrova');
  });

  it('a builder gets 403 (envelope-valid); org-B admin sees nothing and its cross-org DELETE 404s', async () => {
    const tA = await tokenFor('admA');
    const created = await readJson(await authed('/api/v1/org/deny-list', tA, { method: 'POST', body: JSON.stringify({ value: LITERAL }) }));

    const tBld = await tokenFor('bldA');
    const forbidden = await authed('/api/v1/org/deny-list', tBld, { method: 'POST', body: JSON.stringify({ value: 'X Lda' }) });
    expect(forbidden.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(forbidden)).success).toBe(true);

    const tB = await tokenFor('admB');
    const listB = await readJson(await authed('/api/v1/org/deny-list', tB));
    expect((listB.items as unknown[]).length).toBe(0);
    const delB = await authed(`/api/v1/org/deny-list/${String(created.id)}`, tB, { method: 'DELETE' });
    expect(delB.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await readJson(delB)).success).toBe(true);
  });

  it('org-admin DELETE removes the entry (OkResponse) and the write path is audit-logged ids-only', async () => {
    const t = await tokenFor('admA');
    const created = await readJson(await authed('/api/v1/org/deny-list', t, { method: 'POST', body: JSON.stringify({ value: LITERAL }) }));
    const del = await authed(`/api/v1/org/deny-list/${String(created.id)}`, t, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(OkResponse.safeParse(await readJson(del)).success).toBe(true);
    expect(((await readJson(await authed('/api/v1/org/deny-list', t))).items as unknown[]).length).toBe(0);

    const audit = (await activityLogs.find({ category: 'anonymisation' })) as Array<Record<string, unknown>>;
    const types = audit.map((a) => a.type);
    expect(types).toContain('deny-list.add');
    expect(types).toContain('deny-list.remove');
    expect(JSON.stringify(audit)).not.toContain('Petrova'); // ids only, never the literal
  });

  it('a malformed body 400s with the shared envelope', async () => {
    const t = await tokenFor('admA');
    const res = await authed('/api/v1/org/deny-list', t, { method: 'POST', body: JSON.stringify({ value: '' }) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('entityClass is a CLOSED enum - it cannot launder the literal into plaintext rest/audit/responses (codex s1 finding 1)', async () => {
    const t = await tokenFor('admA');
    // The laundering exploit: put the secret literal in the free-string entityClass field.
    const res = await authed('/api/v1/org/deny-list', t, { method: 'POST', body: JSON.stringify({ value: LITERAL, entityClass: LITERAL }) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    // nothing stored, nothing audit-logged with the literal
    expect((await anonymisationDenyLists.find({})).length).toBe(0);
    expect(JSON.stringify(await activityLogs.find({}))).not.toContain('Petrova');
  });
});
