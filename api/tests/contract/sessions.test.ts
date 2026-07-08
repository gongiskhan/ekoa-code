import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { Session, SessionSummaryListResponse } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, sessions } from '../../src/data/stores.js';
import { setActivation } from '../../src/data/activation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { sessionsRouter } from '../../src/routes/sessions.js';

/**
 * Contract test for the sessions endpoints (ch03 §3.8.6): every response validates against
 * `shared/`. This locks a regression where the API's `sessionView` omitted the `createdAt`/
 * `updatedAt` that `Session`/`SessionSummary` require - the web client's dev-mode contract
 * check (core.ts) threw CONTRACT_MISMATCH, `initializeBuilderSession` bailed at its
 * `!sessionsRes.ok` guard, and `/chat` hung forever on "A carregar mensagens...".
 */
let mem: MongoMemoryServer; let server: Server; let port: number; let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const api = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_contract_sessions');
  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'o1', active: true });
  setActivation('u1', { active: true, billingLocked: false });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/sessions', sessionsRouter(deps));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

const tokenFor = async () => (await login('u1', 'pw123456', false, deps)).token;
const isIso = (v: unknown) => typeof v === 'string' && !Number.isNaN(new Date(v).getTime());

describe('sessions contract (§3.8.6)', () => {
  it('POST → Session with required createdAt/updatedAt + name mirroring title', async () => {
    const t = await tokenFor();
    const res = await api('/api/v1/sessions', t, { method: 'POST', body: JSON.stringify({ name: 'My session' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(Session.safeParse(body).success).toBe(true);
    expect(isIso((body as { createdAt: unknown }).createdAt)).toBe(true);
    expect(isIso((body as { updatedAt: unknown }).updatedAt)).toBe(true);
    // The web session list renders `name`, so the view must surface the stored title as `name`.
    expect((body as { name: unknown }).name).toBe('My session');
  });

  it('GET list → SessionSummaryListResponse; every item carries createdAt/updatedAt', async () => {
    const t = await tokenFor();
    await api('/api/v1/sessions', t, { method: 'POST', body: JSON.stringify({ name: 'A' }) });
    const res = await api('/api/v1/sessions', t);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(SessionSummaryListResponse.safeParse(body).success).toBe(true);
    const items = (body as { items: Array<{ createdAt: unknown; updatedAt: unknown }> }).items;
    expect(items.length).toBeGreaterThan(0);
    for (const s of items) { expect(isIso(s.createdAt)).toBe(true); expect(isIso(s.updatedAt)).toBe(true); }
  });

  it('GET list validates a titleless / legacy doc (null title, no timestamps)', async () => {
    // Reproduces the regression: a session stored with title=null and no
    // createdAt/updatedAt. `name` is optional-string (rejects null) and the
    // timestamps are required, so sessionView must omit name + backfill dates.
    await sessions.insert({ _id: 'legacy1', userId: 'u1', title: null as unknown as string, status: 'active', messageCount: 0 });
    const t = await tokenFor();
    const res = await api('/api/v1/sessions', t);
    expect(res.status).toBe(200);
    const parsed = SessionSummaryListResponse.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    const legacy = parsed.success && parsed.data.items.find((s) => s.id === 'legacy1');
    expect(legacy && ('name' in legacy)).toBe(false); // omitted, not null
    expect(legacy && isIso((legacy as { createdAt: unknown }).createdAt)).toBe(true);
  });

  it('GET :id → Session; PATCH bumps updatedAt and stays contract-valid', async () => {
    const t = await tokenFor();
    const created = await (await api('/api/v1/sessions', t, { method: 'POST', body: JSON.stringify({ name: 'Before' }) })).json() as { id: string; createdAt: string };
    const got = await api(`/api/v1/sessions/${created.id}`, t);
    expect(got.status).toBe(200);
    expect(Session.safeParse(await got.json()).success).toBe(true);

    const patched = await api(`/api/v1/sessions/${created.id}`, t, { method: 'PATCH', body: JSON.stringify({ name: 'After' }) });
    expect(patched.status).toBe(200);
    const pbody = await patched.json() as { updatedAt: string; name: string };
    expect(Session.safeParse(pbody).success).toBe(true);
    expect(new Date(pbody.updatedAt).getTime()).toBeGreaterThan(new Date(created.createdAt).getTime());
    expect(pbody.name).toBe('After');
  });
});
