import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, memories } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { Memory, MemoryListResponse, ErrorEnvelope } from '@ekoa/shared';

/**
 * F22 (batch-1 S5): every memory RESPONSE must validate against the shared `Memory` schema.
 * `memoryView` omitted `orgId` (required) and passed `tags`/`tier` straight through — both
 * `undefined` for extracted/manual memories, both REQUIRED by the contract. All four memory
 * routes shape their body through the one view, so every one of them was malformed; the web
 * /memory page rejected each item client-side and rendered zero cards.
 *
 * This suite closes the named coverage gap: the Memory response body is now safeParse'd on the
 * way out (schema-coverage exercised the schema, nothing asserted the body).
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_memories_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await memories.deleteMany({});
  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'orgA', active: true });
  setActivation('u1', { active: true, billingLocked: false });
});
const tokenFor = async () => (await login('u1', 'pw123456', false, deps)).token;

/** Seed straight into the store so the fixtures carry the REAL shapes seen in production:
 *  a tagged memory, a tag-less one (extraction writes no tags), and a tier-less one (the UI
 *  create path sends no tier). */
async function seedMemories() {
  await memories.insert({ _id: 'm-full', orgId: 'orgA', userId: 'u1', visibility: 'private', type: 'fact', tier: 'active', tags: ['legal', 'cliente'], title: 'T1', content: 'C1', createdAt: 'x', updatedAt: 'x' } as never);
  await memories.insert({ _id: 'm-notags', orgId: 'orgA', userId: 'u1', visibility: 'private', type: 'fact', tier: 'active', title: 'T2', content: 'C2', createdAt: 'x', updatedAt: 'x' } as never);
  await memories.insert({ _id: 'm-notier', orgId: 'orgA', userId: 'u1', visibility: 'org', type: 'preference', title: 'T3', content: 'C3', createdAt: 'x', updatedAt: 'x' } as never);
}

describe('GET /api/v1/memories — every item validates against the shared Memory schema (F22)', () => {
  it('the list envelope validates against MemoryListResponse and every item against Memory', async () => {
    await seedMemories();
    const t = await tokenFor();
    const res = await authed('/api/v1/memories', t);
    expect(res.status).toBe(200);
    const body = await readJson(res);

    const parsed = MemoryListResponse.safeParse(body);
    expect(parsed.success, `list envelope must validate: ${JSON.stringify(parsed.success ? {} : parsed.error.issues)}`).toBe(true);

    const items = body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    for (const item of items) {
      const p = Memory.safeParse(item);
      expect(p.success, `item ${String(item.id)} must validate: ${JSON.stringify(p.success ? {} : p.error.issues)}`).toBe(true);
      // the three fields the view dropped / passed through as undefined
      expect(item.orgId).toBe('orgA');
      expect(Array.isArray(item.tags)).toBe(true);
      expect(typeof item.tier).toBe('string');
    }
    // a tag-less memory carries [] (not undefined); a tier-less one carries the honest default
    expect((items.find((i) => i.id === 'm-notags') as { tags: string[] }).tags).toEqual([]);
    expect((items.find((i) => i.id === 'm-full') as { tags: string[] }).tags).toEqual(['legal', 'cliente']);
    expect((items.find((i) => i.id === 'm-notier') as { tier: string }).tier).toBe('active');
  });

  it('GET /:id validates against Memory for a tag-less, tier-less memory', async () => {
    await seedMemories();
    const t = await tokenFor();
    const res = await authed('/api/v1/memories/m-notier', t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const p = Memory.safeParse(body);
    expect(p.success, `body must validate: ${JSON.stringify(p.success ? {} : p.error.issues)}`).toBe(true);
    expect(body.orgId).toBe('orgA');
    expect(body.tags).toEqual([]);
    expect(body.tier).toBe('active');
  });

  it('POST /memories (the UI create path: no tags, no tier) returns a contract-valid Memory', async () => {
    const t = await tokenFor();
    const res = await authed('/api/v1/memories', t, { method: 'POST', body: JSON.stringify({ type: 'fact', title: 'Novo', content: 'Conteúdo' }) });
    expect(res.status).toBe(201);
    const body = await readJson(res);
    const p = Memory.safeParse(body);
    expect(p.success, `created body must validate: ${JSON.stringify(p.success ? {} : p.error.issues)}`).toBe(true);
    expect(body.orgId).toBe('orgA');
    expect(body.tags).toEqual([]);
    expect(body.tier).toBe('active');
  });

  it('PATCH /memories/:id returns a contract-valid Memory', async () => {
    await seedMemories();
    const t = await tokenFor();
    const res = await authed('/api/v1/memories/m-notags', t, { method: 'PATCH', body: JSON.stringify({ title: 'Renomeado' }) });
    expect(res.status).toBe(200);
    const p = Memory.safeParse(await readJson(res));
    expect(p.success).toBe(true);
  });

  it('a non-2xx (unknown id) validates against the shared error envelope', async () => {
    const t = await tokenFor();
    const res = await authed('/api/v1/memories/nope', t);
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});
