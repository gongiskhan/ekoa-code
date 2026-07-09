import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, jobs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { BrandingResearchResponse, OrgConfig, ErrorEnvelope } from '@ekoa/shared';

/**
 * F4 (batch-1 S6): the branding surface must live at its CONTRACT paths.
 *  - `PUT /api/v1/branding` — the contract path. Only `PUT /api/v1/org/branding` was mounted, so
 *    the declared path 404'd (HTML) and the branding save journey failed.
 *  - `POST /api/v1/branding/research` — never mounted at all, so the brand-research journey failed
 *    at step one, despite `agents/brand-research.ts` existing and working.
 *
 * Research enqueues the EXISTING agent job (no new LLM egress path) and answers the contract's
 * `BrandingResearchResponse { jobId }` — not a job envelope.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

/** The job is persisted asynchronously after the 202 (the agent fires off the response path),
 *  so poll briefly rather than assume the write already landed. */
async function awaitJob(jobId: string): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 50; i++) {
    const job = await jobs.get(jobId);
    if (job) return job as unknown as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'builder') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: 'orgA', active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_branding_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await orgs.deleteMany({}); await jobs.deleteMany({});
  await orgs.insert({ _id: 'orgA', name: 'Org A', displayName: 'Org A', createdAt: 'x' } as never);
});

describe('PUT /api/v1/branding (the contract path)', () => {
  it('org-admin saves branding at the contract path and gets an OrgConfig back', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding', t, {
      method: 'PUT', body: JSON.stringify({ branding: { primaryColor: '#123456' }, displayName: 'Nova Marca' }),
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(OrgConfig.safeParse(body).success).toBe(true);
    expect((body.branding as Record<string, unknown>).primaryColor).toBe('#123456');
    expect(body.displayName).toBe('Nova Marca');
  });

  it('a builder gets a 403 envelope; nothing is saved', async () => {
    await mkUser('bob', 'builder');
    const t = await tokenFor('bob');
    const res = await authed('/api/v1/branding', t, { method: 'PUT', body: JSON.stringify({ branding: { primaryColor: '#000000' } }) });
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('the legacy /api/v1/org/branding path keeps working (alias, not a move — no duplicated logic)', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/org/branding', t, { method: 'PUT', body: JSON.stringify({ branding: { primaryColor: '#abcdef' } }) });
    expect(res.status).toBe(200);
    expect(OrgConfig.safeParse(await readJson(res)).success).toBe(true);
  });

  it('a schema-invalid body gets a 400 envelope', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding', t, { method: 'PUT', body: JSON.stringify({ nope: 1 }) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});

describe('POST /api/v1/branding/research', () => {
  it('org-admin enqueues the brand-research job and gets BrandingResearchResponse { jobId }', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://exemplo.pt' }) });
    expect(res.status).toBe(202);
    const body = await readJson(res);
    // the contract answers { jobId } — NOT a job envelope
    expect(BrandingResearchResponse.safeParse(body).success).toBe(true);
    expect(typeof body.jobId).toBe('string');

    // the job really exists and is a brand-research job owned by the caller
    const job = (await awaitJob(body.jobId as string)) as unknown as { kind: string; userId: string } | null;
    expect(job?.kind).toBe('brand-research');
    expect(job?.userId).toBe('admin');
  });

  it('the requested websiteUrl reaches the agent prompt (contract field -> prompt mapping)', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://marca-unica.example' }) });
    const body = await readJson(res);
    const job = (await awaitJob(body.jobId as string)) as unknown as { request?: Record<string, unknown> } | null;
    expect(JSON.stringify(job?.request ?? {})).toContain('marca-unica.example');
  });

  it('a builder gets a 403 envelope and NO job is created', async () => {
    await mkUser('bob', 'builder');
    const t = await tokenFor('bob');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({ websiteUrl: 'https://exemplo.pt' }) });
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect(await jobs.find({})).toHaveLength(0);
  });

  it('a missing websiteUrl gets a 400 envelope', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/branding/research', t, { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('unauthenticated gets a 401 envelope', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/branding/research`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ websiteUrl: 'https://x.pt' }),
    });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});
