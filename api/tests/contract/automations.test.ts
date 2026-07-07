import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import {
  Automation,
  AutomationListResponse,
  PlanResponse,
  RunRecord,
  RunListResponse,
  RunCreateResponse,
  RunCancelResponse,
  RunResumeResponse,
  CatalogResponse,
  ApprovedCommandListResponse,
  RevokeApprovedCommandResponse,
  OkResponse,
  ErrorEnvelope,
} from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs } from '../../src/data/stores.js';
import { setActivation } from '../../src/data/activation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { automationsRouter } from '../../src/routes/automations.js';

/**
 * Contract test for the automations endpoints (ch03 §3.8.18): every response validates against
 * its shared/ schema (ch13 §13.5), the Amendment-2 creation authority is enforced (org-admin by
 * default, builder only behind the flippable org setting), and every non-2xx body validates
 * against the shared error envelope. The planner's model call is mocked (LLM-free per PR).
 */
const hoisted = vi.hoisted(() => ({ planText: '' }));
vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runOneShot: vi.fn(async () => ({ text: hoisted.planText, usage: {} })),
    decideForTier: vi.fn((tier: string) => ({ tier, model: 'm', effort: 'high', weight: 1 })),
  };
});

let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const api = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) },
  });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_contract_automations');
  await orgs.insert({ _id: 'o1', name: 'orgA' } as never);
  await users.insert({ _id: 'admin1', username: 'admin1', passwordHash: await hashPassword('pw123456'), role: 'org-admin', orgId: 'o1', active: true } as never);
  await users.insert({ _id: 'b1', username: 'b1', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'o1', active: true } as never);
  setActivation('admin1', { active: true, billingLocked: false });
  setActivation('b1', { active: true, billingLocked: false });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/automations', automationsRouter());
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  server.close();
  await closeMongo();
  await mem.stop();
});

const adminToken = async () => (await login('admin1', 'pw123456', false, deps)).token;
const builderToken = async () => (await login('b1', 'pw123456', false, deps)).token;

describe('automations contract (§3.8.18)', () => {
  it('CRUD round trip validates against the shared schemas', async () => {
    const t = await adminToken();
    const created = await api('/api/v1/automations', t, { method: 'POST', body: JSON.stringify({ name: 'A1', description: 'd' }) });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as Record<string, unknown>;
    expect(Automation.safeParse(createdBody).success).toBe(true);
    const id = createdBody.id as string;

    const list = (await (await api('/api/v1/automations', t)).json()) as Record<string, unknown>;
    expect(AutomationListResponse.safeParse(list).success).toBe(true);
    expect((list.items as Array<{ id: string }>).some((a) => a.id === id)).toBe(true);

    const got = await (await api(`/api/v1/automations/${id}`, t)).json();
    expect(Automation.safeParse(got).success).toBe(true);

    const patched = (await (await api(`/api/v1/automations/${id}`, t, { method: 'PATCH', body: JSON.stringify({ name: 'A1b' }) })).json()) as Record<string, unknown>;
    expect(Automation.safeParse(patched).success).toBe(true);
    expect(patched.name).toBe('A1b');

    const del = await (await api(`/api/v1/automations/${id}`, t, { method: 'DELETE' })).json();
    expect(OkResponse.safeParse(del).success).toBe(true);
  });

  it('creation authority (Amendment 2): builder 403 by default, allowed when the org flips the setting', async () => {
    const t = await builderToken();
    const denied = await api('/api/v1/automations', t, { method: 'POST', body: JSON.stringify({ name: 'B1' }) });
    expect(denied.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await denied.json()).success).toBe(true);

    await orgs.update('o1', (o) => ({ ...o, settings: { allowBuilderAutomations: true } }));
    const allowed = await api('/api/v1/automations', t, { method: 'POST', body: JSON.stringify({ name: 'B1' }) });
    expect(allowed.status).toBe(201);
    expect(Automation.safeParse(await allowed.json()).success).toBe(true);
    await orgs.update('o1', (o) => ({ ...o, settings: { allowBuilderAutomations: false } }));
  });

  it('runs lifecycle: 202 create, get, list, idempotent cancel, resume — all schema-valid', async () => {
    const t = await adminToken();
    const auto = (await (await api('/api/v1/automations', t, { method: 'POST', body: JSON.stringify({ name: 'Runner' }) })).json()) as Record<string, unknown>;
    const started = await api(`/api/v1/automations/${auto.id}/runs`, t, { method: 'POST', body: JSON.stringify({}) });
    expect(started.status).toBe(202);
    const startedBody = (await started.json()) as Record<string, unknown>;
    expect(RunCreateResponse.safeParse(startedBody).success).toBe(true);
    const runId = startedBody.runId as string;

    const rec = await (await api(`/api/v1/automations/runs/${runId}`, t)).json();
    expect(RunRecord.safeParse(rec).success).toBe(true);

    const list = (await (await api(`/api/v1/automations/runs?automationId=${auto.id}`, t)).json()) as Record<string, unknown>;
    expect(RunListResponse.safeParse(list).success).toBe(true);
    expect((list.items as Array<{ id: string }>).some((r) => r.id === runId)).toBe(true);

    const c1 = await (await api(`/api/v1/automations/runs/${runId}/cancel`, t, { method: 'POST' })).json();
    expect(RunCancelResponse.safeParse(c1).success).toBe(true);
    const c2 = await (await api(`/api/v1/automations/runs/${runId}/cancel`, t, { method: 'POST' })).json();
    expect(RunCancelResponse.safeParse(c2).success).toBe(true); // idempotent (§5.6.7)

    const resumed = await (await api(`/api/v1/automations/runs/${runId}/resume`, t, { method: 'POST' })).json();
    expect(RunResumeResponse.safeParse(resumed).success).toBe(true);
  });

  it('plan-from-goal (landmine 9): persists the automation AND starts a rehearsal run', async () => {
    hoisted.planText = JSON.stringify({
      status: 'ok',
      name: 'Plano E2E',
      description: 'passo único',
      inputs: [],
      steps: [{ type: 'wait', description: 'esperar 1ms', durationMs: 1 }],
      reasoning: 'simples',
    });
    const t = await adminToken();
    const res = await api('/api/v1/automations/plan', t, { method: 'POST', body: JSON.stringify({ goal: 'esperar', language: 'pt' }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(PlanResponse.safeParse(body).success).toBe(true);
    expect(body.automation).toBeTruthy();
    expect(body.runId).toBeTruthy();
    expect(body.rehearsing).toBe(true);
  });

  it('catalog + approved-commands respond schema-valid', async () => {
    const t = await adminToken();
    const cat = await (await api('/api/v1/automations/catalog', t)).json();
    expect(CatalogResponse.safeParse(cat).success).toBe(true);

    const ac = await (await api('/api/v1/automations/approved-commands', t)).json();
    expect(ApprovedCommandListResponse.safeParse(ac).success).toBe(true);

    const revoked = await (await api('/api/v1/automations/approved-commands/revoke', t, { method: 'POST', body: JSON.stringify({ shape: 'git status' }) })).json();
    expect(RevokeApprovedCommandResponse.safeParse(revoked).success).toBe(true);
  });

  it('a missing automation is a uniform NOT_FOUND envelope (ch04 parity)', async () => {
    const t = await adminToken();
    const res = await api('/api/v1/automations/ghost', t);
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });
});
