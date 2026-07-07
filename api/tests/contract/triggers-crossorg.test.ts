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

/**
 * Cross-org trigger-binding guard (ch09; Codex G8): POST /api/v1/triggers must reject a target —
 * automation OR artifact-backend — that the creator's org cannot read, so org A can never bind a
 * webhook to org B's automation/backend and drive its execution on delivery.
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
  await connectMongo(mem.getUri(), 'ekoa_triggers_crossorg');
  await orgs.insert({ _id: 'oA', name: 'A' } as never);
  await orgs.insert({ _id: 'oB', name: 'B' } as never);
  await users.insert({ _id: 'ua', username: 'ua', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'oA', active: true } as never);
  setActivation('ua', { active: true, billingLocked: false });
  // org B's automation + artifact — the foreign targets org A must not bind to.
  await automations.insert({ _id: 'autoB', id: 'autoB', name: 'B auto', ownerUserId: 'ub', orgId: 'oB', steps: [] } as never);
  await artifacts.insert({ _id: 'artB', userId: 'ub', orgId: 'oB', visibility: 'private' } as never);
  // org A's own automation + artifact — the legitimate same-org targets.
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

const tokenA = async () => (await login('ua', 'pw123456', false, deps)).token;

describe('cross-org trigger binding guard (§3.8.17)', () => {
  it('rejects binding to another org\'s automation with 404', async () => {
    const res = await api('/api/v1/triggers', await tokenA(), { method: 'POST', body: JSON.stringify({ automationId: 'autoB', integrationKey: 'gh', eventName: 'push' }) });
    expect(res.status).toBe(404);
    expect(await triggerStore.find({})).toHaveLength(0);
  });

  it('rejects binding to another org\'s artifact backend with 404', async () => {
    const res = await api('/api/v1/triggers', await tokenA(), { method: 'POST', body: JSON.stringify({ integrationKey: 'wa', eventName: 'message', target: { kind: 'artifact-backend', artifactId: 'artB', entrypoint: 'onMessage' } }) });
    expect(res.status).toBe(404);
    expect(await triggerStore.find({})).toHaveLength(0);
  });

  it('allows binding to the creator\'s own automation (201) and artifact backend (201)', async () => {
    const t = await tokenA();
    const a = await api('/api/v1/triggers', t, { method: 'POST', body: JSON.stringify({ automationId: 'autoA', integrationKey: 'gh', eventName: 'push' }) });
    expect(a.status).toBe(201);
    const b = await api('/api/v1/triggers', t, { method: 'POST', body: JSON.stringify({ integrationKey: 'wa', eventName: 'message', target: { kind: 'artifact-backend', artifactId: 'artA', entrypoint: 'onMessage' } }) });
    expect(b.status).toBe(201);
  });
});
