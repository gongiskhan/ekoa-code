import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { JobCreateRequest, JobCreateResponse, Job, JobCancelResponse, ErrorEnvelope } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings } from '../../src/data/stores.js';
import { setActivation } from '../../src/data/activation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { setCredential } from '../../src/llm/credentials.js';
import { __setTransportForTests } from '../../src/llm/client.js';
import { jobsRouter } from '../../src/routes/jobs.js';
import { makeFakeTransport } from '../agents/_fake-transport.js';

/**
 * Contract test for the build jobs endpoints (ch03 §3.8.8): responses validate against `shared/`.
 * The router is mounted on a bare app (server.ts wiring is the lead's) with the fake transport.
 */
let mem: MongoMemoryServer; let server: Server; let port: number; let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const api = (p: string, t: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_contract_jobs');
  await setCredential({ mode: 'oauth', secret: 'tok' });
  __setTransportForTests(makeFakeTransport({ finalText: 'built' }));
  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'o1', active: true });
  setActivation('u1', { active: true, billingLocked: false });
  await userSettings.put({ _id: 'u1', memory: { autoExtract: false }, build: { verifyBuilds: false } });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/jobs', jobsRouter(deps));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { await drain(); server.close(); await closeMongo(); await mem.stop(); });

const tokenFor = async () => (await login('u1', 'pw123456', false, deps)).token;
const drain = () => new Promise((r) => setTimeout(r, 300)); // let the fire-and-forget build settle

describe('build jobs contract (§3.8.8)', () => {
  it('POST /jobs (build) → 202 JobCreateResponse (created); GET → Job; cancel → JobCancelResponse', async () => {
    const t = await tokenFor();
    const created = await api('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: 'build a crm', sessionId: 'sX', language: 'pt' }) });
    expect(created.status).toBe(202);
    const body = await created.json();
    expect(JobCreateResponse.safeParse(body).success).toBe(true);
    const jobId = (body as { status: 'created'; job: { id: string } }).job.id;

    // Wait for the fire-and-forget build to reach a terminal state so its async writes finish
    // before teardown (the build runs LLM-free via the fake transport).
    for (let i = 0; i < 40; i++) {
      const g = await api(`/api/v1/jobs/${jobId}`, t);
      const j = await g.json();
      expect(Job.safeParse(j).success).toBe(true);
      if (['completed', 'failed', 'cancelled'].includes((j as { status: string }).status)) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    const cancelled = await api(`/api/v1/jobs/${jobId}/cancel`, t, { method: 'POST' });
    expect(JobCancelResponse.safeParse(await cancelled.json()).success).toBe(true);
  });

  it('JobCreateRequest carries knowledgeDocs (additive, bounded) - codex F1 finding 1', () => {
    const doc = { title: 'Manual de subscrição', text: 'regras de subscrição' };
    const base = { kind: 'build', description: 'seguros', sessionId: 's1' };
    // The field must SURVIVE parsing (it was silently stripped before the fix).
    const parsed = JobCreateRequest.safeParse({ ...base, knowledgeDocs: [doc] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.knowledgeDocs).toEqual([doc]);
    // Bounds enforced at the boundary: count and per-doc text size.
    expect(JobCreateRequest.safeParse({ ...base, knowledgeDocs: Array(21).fill(doc) }).success).toBe(false);
    expect(JobCreateRequest.safeParse({ ...base, knowledgeDocs: [{ title: 't', text: 'x'.repeat(262145) }] }).success).toBe(false);
    expect(JobCreateRequest.safeParse({ ...base, knowledgeDocs: [{ title: '', text: 'x' }] }).success).toBe(false);
    // Optional: absent field stays valid (older clients unaffected).
    expect(JobCreateRequest.safeParse(base).success).toBe(true);
  });

  it('POST /jobs with an invalid kind → 400 error envelope', async () => {
    const t = await tokenFor();
    const res = await api('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'brand-research', description: 'x', sessionId: 's' }) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it('GET events with no token → 401 error envelope', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/jobs/x/events`);
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it("GET events for ANOTHER user's job → 403 (cross-user ownership, Codex checkpoint)", async () => {
    // u1 owns the job; u2 holds a valid SSE token but must NOT be able to stream u1's job events.
    const t1 = await tokenFor();
    const created = await api('/api/v1/jobs', t1, { method: 'POST', body: JSON.stringify({ kind: 'build', description: 'u1 private job', sessionId: 'sOwn', language: 'pt' }) });
    const jobId = ((await created.json()) as { job: { id: string } }).job.id;
    await users.insert({ _id: 'u2', username: 'u2', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'o2', active: true });
    setActivation('u2', { active: true, billingLocked: false });
    await userSettings.put({ _id: 'u2', memory: { autoExtract: false }, build: { verifyBuilds: false } });
    const t2 = (await login('u2', 'pw123456', false, deps)).token;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/jobs/${jobId}/events?token=${t2}`);
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    await drain();
  });
});
