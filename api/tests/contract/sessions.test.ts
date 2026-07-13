import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, sessions, messages } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { Session, SessionSummaryListResponse, SessionMessage, ErrorEnvelope, itemsResponse } from '@ekoa/shared';

/**
 * Sessions contract (ch03 §3.8.6). `sessions.*` was listed COVERED by the schema-coverage gate
 * while NO test ever requested `/api/v1/sessions` — so nothing asserted the bodies, and every
 * sessions response was malformed:
 *   - `sessionView` emitted `title` (never the wire field `name`) and no `createdAt`/`updatedAt`,
 *     both REQUIRED by `Session`/`SessionSummary`. The web safeParses every response
 *     (web/lib/api/core.ts) so `api.sessions.create` threw CONTRACT_MISMATCH and the
 *     orchestration store silently fell back to a CLIENT-LOCAL session id — chat runs then
 *     posted against a session that did not exist server-side and the transcript 404'd on
 *     reload, while orphan server sessions accumulated.
 *   - `PATCH {name}` wrote a `name` field but the view read `title`, so a rename never showed.
 *   - message bodies emitted `_id`/`timestamp` (+ the internal `_rev`) where `SessionMessage`
 *     requires `id`/`createdAt`.
 * Same family as F22 (`memoryView` omitted required fields → /memory rendered zero cards).
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_sessions_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await sessions.deleteMany({}); await messages.deleteMany({});
  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true });
  await users.insert({ _id: 'u2', username: 'u2', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgB', active: true });
  setActivation('u1', { active: true, billingLocked: false });
  setActivation('u2', { active: true, billingLocked: false });
});
const tokenFor = async (u = 'u1') => (await login(u, 'pw123456', false, deps)).token;

const createSession = async (t: string, body: Record<string, unknown> = {}) =>
  authed('/api/v1/sessions', t, { method: 'POST', body: JSON.stringify(body) });

describe('sessions contract (ch03 §3.8.6)', () => {
  it('POST /sessions returns a body validating against the shared Session schema', async () => {
    const t = await tokenFor();
    const res = await createSession(t, { name: 'primeira sessão' });
    expect(res.status).toBe(201);
    const body = await readJson(res);
    const parsed = Session.safeParse(body);
    expect(parsed.success, `Session.safeParse failed: ${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`).toBe(true);
    // The wire field is `name` (ch03), never the store-side `title` (ch04 §4.3.1).
    expect(body.name).toBe('primeira sessão');
    expect(body.title).toBeUndefined();
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.updatedAt).toBe('string');
  });

  it('POST /sessions with no name still satisfies the contract (name is optional, timestamps are not)', async () => {
    const t = await tokenFor();
    const body = await readJson(await createSession(t));
    const parsed = Session.safeParse(body);
    expect(parsed.success, `Session.safeParse failed: ${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`).toBe(true);
    expect(body.name).toBeUndefined();
  });

  it('POST /sessions persists `type` (onboarding reuse depends on it) and returns it', async () => {
    const t = await tokenFor();
    const created = await readJson(await createSession(t, { type: 'onboarding' }));
    expect(created.type).toBe('onboarding');
    const fetched = await readJson(await authed(`/api/v1/sessions/${created.id as string}`, t));
    expect(fetched.type).toBe('onboarding');
  });

  it('GET /sessions items validate against SessionSummary', async () => {
    const t = await tokenFor();
    await createSession(t, { name: 'a' });
    await createSession(t, { name: 'b' });
    const body = await readJson(await authed('/api/v1/sessions', t));
    const parsed = SessionSummaryListResponse.safeParse(body);
    expect(parsed.success, `SessionSummaryListResponse.safeParse failed: ${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`).toBe(true);
    expect((body.items as unknown[]).length).toBe(2);
  });

  it('GET /sessions/:id validates against Session', async () => {
    const t = await tokenFor();
    const created = await readJson(await createSession(t, { name: 'x' }));
    const body = await readJson(await authed(`/api/v1/sessions/${created.id as string}`, t));
    expect(Session.safeParse(body).success).toBe(true);
    expect(body.name).toBe('x');
  });

  it('PATCH /sessions/:id renames (the rename is actually reflected) and stamps updatedAt', async () => {
    const t = await tokenFor();
    const created = await readJson(await createSession(t, { name: 'antigo' }));
    const res = await authed(`/api/v1/sessions/${created.id as string}`, t, { method: 'PATCH', body: JSON.stringify({ name: 'novo' }) });
    const body = await readJson(res);
    expect(Session.safeParse(body).success).toBe(true);
    expect(body.name).toBe('novo');
    expect(Date.parse(body.updatedAt as string)).toBeGreaterThan(Date.parse(created.updatedAt as string));
    expect(body.createdAt).toBe(created.createdAt);
  });

  it('an empty PATCH is the carried touch: stamps updatedAt, leaves the name', async () => {
    const t = await tokenFor();
    const created = await readJson(await createSession(t, { name: 'mantido' }));
    const body = await readJson(await authed(`/api/v1/sessions/${created.id as string}`, t, { method: 'PATCH', body: JSON.stringify({}) }));
    expect(Session.safeParse(body).success).toBe(true);
    expect(body.name).toBe('mantido');
    expect(Date.parse(body.updatedAt as string)).toBeGreaterThan(Date.parse(created.updatedAt as string));
  });

  it('POST /sessions/:id/messages returns a SessionMessage (id + createdAt, no store internals)', async () => {
    const t = await tokenFor();
    const created = await readJson(await createSession(t));
    const res = await authed(`/api/v1/sessions/${created.id as string}/messages`, t, { method: 'POST', body: JSON.stringify({ role: 'user', content: 'olá' }) });
    expect(res.status).toBe(201);
    const body = await readJson(res);
    const parsed = SessionMessage.safeParse(body);
    expect(parsed.success, `SessionMessage.safeParse failed: ${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`).toBe(true);
    expect(body._id).toBeUndefined();
    expect(body._rev).toBeUndefined();
    expect(body.timestamp).toBeUndefined();
    expect(typeof body.createdAt).toBe('string');
  });

  it('GET /sessions/:id/messages items validate against SessionMessage and leak no _rev', async () => {
    const t = await tokenFor();
    const created = await readJson(await createSession(t));
    const sid = created.id as string;
    await authed(`/api/v1/sessions/${sid}/messages`, t, { method: 'POST', body: JSON.stringify({ role: 'user', content: 'olá' }) });
    await authed(`/api/v1/sessions/${sid}/messages`, t, { method: 'POST', body: JSON.stringify({ role: 'assistant', content: 'oi' }) });
    const body = await readJson(await authed(`/api/v1/sessions/${sid}/messages`, t));
    const parsed = itemsResponse(SessionMessage).safeParse(body);
    expect(parsed.success, `messages list safeParse failed: ${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`).toBe(true);
    for (const m of body.items as Array<Record<string, unknown>>) {
      expect(m._rev).toBeUndefined();
      expect(m._id).toBeUndefined();
    }
  });

  it('adding a message bumps messageCount and touches the session updatedAt', async () => {
    const t = await tokenFor();
    const created = await readJson(await createSession(t));
    const sid = created.id as string;
    await authed(`/api/v1/sessions/${sid}/messages`, t, { method: 'POST', body: JSON.stringify({ role: 'user', content: 'olá' }) });
    const body = await readJson(await authed(`/api/v1/sessions/${sid}`, t));
    expect(body.messageCount).toBe(1);
    expect(Date.parse(body.updatedAt as string)).toBeGreaterThan(Date.parse(created.updatedAt as string));
  });

  it("another user's session is a uniform not-found with the shared error envelope", async () => {
    const t1 = await tokenFor('u1');
    const t2 = await tokenFor('u2');
    const created = await readJson(await createSession(t1, { name: 'privada' }));
    const res = await authed(`/api/v1/sessions/${created.id as string}`, t2);
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body.error as { code: string }).code).toBe('NOT_FOUND');
  });
});
