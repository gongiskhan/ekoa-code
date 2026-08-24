import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { JobCreateResponse, Job, JobCancelResponse } from '@ekoa/shared';
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
import { setBuildMechanics, setVerifyRunner, type BuildMechanics, type VerifyRunResult } from '../../src/agents/seams.js';
import { makeFakeTransport } from '../agents/_fake-transport.js';

/**
 * Contract test for the s1 per-user build cap + queued FIFO dispatch (run 20260719): the wire
 * behavior of a beyond-cap build. `queued` rides the existing Job contract (status is a string on
 * the wire), so every body must still validate against `shared/`. LLM-free: fake transport +
 * stubbed build mechanics/verify seams (internal seams, not response stubs).
 */
let mem: MongoMemoryServer; let server: Server; let port: number; let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const api = (p: string, t: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });

function fastMechanics(): BuildMechanics {
  return {
    async prepareFirstBuild(input) { return { artifactId: `art_${input.sessionId}`, projectDir: '/pd', slug: 'app', appUrl: 'http://app' }; },
    async resolveFollowUp() { return { projectDir: '/pd', slug: 'app', appUrl: 'http://app' }; },
    async revalidateWritable() { return 'ok'; },
    async finalizeBundle() { return { ok: true }; },
    async snapshot() {},
    async watchRebuilds() {},
    screenshot() {},
    async persistSdkSessionId() {},
    async activateArtifact() {},
    async assertProgress() { return { clean: true, reasons: [] }; },
  };
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  process.env.MAX_CONCURRENT_BUILDS_PER_USER = '1'; // the cap under test, read at config load
  __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_contract_jobs_queue');
  await setCredential({ mode: 'oauth', secret: 'tok' });
  __setTransportForTests(makeFakeTransport({ finalText: 'built' }));
  setBuildMechanics(fastMechanics());
  setVerifyRunner(async (): Promise<VerifyRunResult> => ({ ran: true, passed: true }));
  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'org-admin', orgId: 'o1', active: true });
  setActivation('u1', { active: true, billingLocked: false });
  await userSettings.put({ _id: 'u1', memory: { autoExtract: false }, build: { verifyBuilds: false } });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/jobs', jobsRouter(deps));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  delete process.env.MAX_CONCURRENT_BUILDS_PER_USER;
  await new Promise((r) => setTimeout(r, 300));
  server.close(); await closeMongo(); await mem.stop();
});

const tokenFor = async () => (await login('u1', 'pw123456', false, deps)).token;
async function getJob(t: string, id: string): Promise<{ status: string }> {
  const res = await api(`/api/v1/jobs/${id}`, t);
  const j = await res.json();
  expect(Job.safeParse(j).success).toBe(true);
  return j as { status: string };
}
async function waitTerminal(t: string, id: string, ms = 8000): Promise<string> {
  const t0 = Date.now();
  for (;;) {
    const { status } = await getJob(t, id);
    if (['completed', 'failed', 'cancelled'].includes(status)) return status;
    if (Date.now() - t0 > ms) throw new Error(`job ${id} not terminal (last: ${status})`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('build-queue contract (per-user cap, run 20260719)', () => {
  it('beyond-cap POST -> 202 JobCreateResponse with job.status queued; GET parses as Job', async () => {
    const t = await tokenFor();
    const first = await api('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: 'app one', sessionId: 'qa1', language: 'pt' }) });
    expect(first.status).toBe(202);
    const firstBody = await first.json();
    expect(JobCreateResponse.safeParse(firstBody).success).toBe(true);
    const firstId = (firstBody as { job: { id: string } }).job.id;

    const second = await api('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: 'app two', sessionId: 'qa2', language: 'pt' }) });
    expect(second.status).toBe(202); // queue, never reject: still a 202 on the same contract
    const secondBody = await second.json();
    expect(JobCreateResponse.safeParse(secondBody).success).toBe(true);
    const secondJob = (secondBody as { job: { id: string; status: string } }).job;
    expect(secondJob.status).toBe('queued');
    expect((await getJob(t, secondJob.id)).status).toBe('queued');

    // FIFO over the wire: when the executing build reaches a terminal state, the queued one is
    // dispatched without any further client action and runs to completion.
    expect(await waitTerminal(t, firstId)).toBe('completed');
    expect(await waitTerminal(t, secondJob.id)).toBe('completed');
  });

  it('cancel of a queued job -> JobCancelResponse {cancelled:true}, record cancelled, never dispatched', async () => {
    const t = await tokenFor();
    const a = await api('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: 'holder', sessionId: 'qb1', language: 'pt' }) });
    const aId = ((await a.json()) as { job: { id: string } }).job.id;
    const b = await api('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: 'queued victim', sessionId: 'qb2', language: 'pt' }) });
    const bJob = ((await b.json()) as { job: { id: string; status: string } }).job;
    expect(bJob.status).toBe('queued');

    const cancelled = await api(`/api/v1/jobs/${bJob.id}/cancel`, t, { method: 'POST' });
    const cancelBody = await cancelled.json();
    expect(JobCancelResponse.safeParse(cancelBody).success).toBe(true);
    expect((cancelBody as { cancelled: boolean }).cancelled).toBe(true);
    expect(await waitTerminal(t, bJob.id)).toBe('cancelled');

    // The holder finishing must not resurrect the cancelled job.
    expect(await waitTerminal(t, aId)).toBe('completed');
    expect((await getJob(t, bJob.id)).status).toBe('cancelled');
  });
});
