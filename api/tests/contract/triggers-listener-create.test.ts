import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, automations, artifacts, triggers as triggerStore } from '../../src/data/stores.js';
import { setActivation } from '../../src/data/activation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { triggersRouter } from '../../src/routes/triggers.js';
import { TriggerCreateRequest, TriggerCreateResponse, TriggerListResponse, ErrorEnvelope } from '@ekoa/shared';

/**
 * POST /api/v1/triggers listener inference + GET view contract (2A-S2). The wire proof that the
 * "Ligações" card's exact request (integrationKey + eventName + artifact-backend target, nothing
 * else) now produces a kind:'listener' row the supervisor polls - not a dead webhook row - and
 * that the list view exposes entrypoint/kind/pollConfig so the card can recognise an existing
 * connection. Old-shape requests (no pollIntervalMs, non-platform providers) are byte-for-byte
 * unaffected (Rule 7 additive).
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const api = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_triggers_listener_create');
  await orgs.insert({ _id: 'oA', name: 'A' } as never);
  await users.insert({ _id: 'ua', username: 'ua', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'oA', active: true } as never);
  setActivation('ua', { active: true, billingLocked: false });
  await automations.insert({ _id: 'autoA', id: 'autoA', name: 'A auto', ownerUserId: 'ua', orgId: 'oA', steps: [] } as never);
  await artifacts.insert({ _id: 'artA', userId: 'ua', orgId: 'oA', visibility: 'private' } as never);
  const app = express();
  app.use(express.json());
  app.use('/api/v1/triggers', triggersRouter(deps));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  server.close();
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => { await triggerStore.deleteMany({}); });

const token = async () => (await login('ua', 'pw123456', false, deps)).token;

// The EXACT body the web "Ligações" card sends (backend-trigger-card.tsx onConnect).
const cardBody = (integrationKey: string, extra: Record<string, unknown> = {}) => ({
  integrationKey,
  eventName: 'email.received',
  target: { kind: 'artifact-backend', artifactId: 'artA', entrypoint: 'onEmail' },
  ...extra,
});

describe('POST /api/v1/triggers — platform listener inference (2A-S2)', () => {
  it('the card request against microsoft-365 creates a SUPERVISED listener, response validates', async () => {
    const body = cardBody('microsoft-365');
    expect(TriggerCreateRequest.safeParse(body).success).toBe(true);
    const res = await api('/api/v1/triggers', await token(), { method: 'POST', body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    const parsed = TriggerCreateResponse.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.trigger.kind).toBe('listener');
    expect(parsed.data.trigger.pollConfig).toEqual({ actionName: 'list_emails', intervalMs: 60_000 });
    expect(parsed.data.trigger.entrypoint).toBe('onEmail');
    // The row the supervisor's find({ kind:'listener' }) discovers - the armed-watch proof.
    expect(await triggerStore.find({ kind: 'listener' })).toHaveLength(1);
  });

  it('pollIntervalMs (additive, Rule 7) overrides the cadence; google-workspace infers too', async () => {
    const body = cardBody('google-workspace', { pollIntervalMs: 30_000 });
    expect(TriggerCreateRequest.safeParse(body).success).toBe(true);
    const res = await api('/api/v1/triggers', await token(), { method: 'POST', body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    const parsed = TriggerCreateResponse.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.trigger.kind).toBe('listener');
    expect(parsed.data.trigger.pollConfig).toEqual({ actionName: 'list_emails', intervalMs: 30_000 });
  });

  it('old-shape request (non-platform, no pollIntervalMs) is untouched: 201, kind webhook, no pollConfig', async () => {
    const body = { automationId: 'autoA', integrationKey: 'gh', eventName: 'push' };
    expect(TriggerCreateRequest.safeParse(body).success).toBe(true); // pre-2A-S2 clients still parse
    const res = await api('/api/v1/triggers', await token(), { method: 'POST', body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    const parsed = TriggerCreateResponse.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.trigger.kind).toBe('webhook');
    expect(parsed.data.trigger.pollConfig).toBeUndefined();
    expect(parsed.data.secret).toBeTruthy(); // webhook path still hands the secret out exactly once
  });

  it('a sub-1s pollIntervalMs fails validation with the shared error envelope', async () => {
    const body = cardBody('microsoft-365', { pollIntervalMs: 500 });
    expect(TriggerCreateRequest.safeParse(body).success).toBe(false);
    const res = await api('/api/v1/triggers', await token(), { method: 'POST', body: JSON.stringify(body) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    expect(await triggerStore.find({})).toHaveLength(0);
  });
});

describe('GET /api/v1/triggers — the card can see an existing connection', () => {
  it('list view carries entrypoint + kind + pollConfig and validates against TriggerListResponse', async () => {
    const t = await token();
    await api('/api/v1/triggers', t, { method: 'POST', body: JSON.stringify(cardBody('microsoft-365')) });
    await api('/api/v1/triggers', t, { method: 'POST', body: JSON.stringify({ automationId: 'autoA', integrationKey: 'gh', eventName: 'push' }) });
    const res = await api('/api/v1/triggers', t);
    expect(res.status).toBe(200);
    const parsed = TriggerListResponse.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const listener = parsed.data.items.find((i) => i.kind === 'listener');
    expect(listener).toBeDefined();
    // Exactly the fields backend-trigger-card.tsx matches on to render "Ligado".
    expect(listener?.artifactId).toBe('artA');
    expect(listener?.entrypoint).toBe('onEmail');
    expect(listener?.pollConfig).toEqual({ actionName: 'list_emails', intervalMs: 60_000 });
    const webhook = parsed.data.items.find((i) => i.kind === 'webhook');
    expect(webhook).toBeDefined();
    expect(webhook?.entrypoint).toBeUndefined(); // absent, never null (view omission discipline)
  });
});
