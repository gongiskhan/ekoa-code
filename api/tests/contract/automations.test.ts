import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { connect } from 'node:net';
import {
  Automation,
  AutomationListResponse,
  PlanResponse,
  RunRecord,
  RunListResponse,
  RunCreateResponse,
  RunCancelResponse,
  RunResumeResponse,
  RunLogsResponse,
  RUN_LOG_STEP_MAX_CHARS,
  RUN_LOG_TOTAL_MAX_CHARS,
  CatalogResponse,
  ApprovedCommandListResponse,
  RevokeApprovedCommandResponse,
  OkResponse,
  ErrorEnvelope,
  automationsEndpoints,
} from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, activityLogs, automationRuns } from '../../src/data/stores.js';
import { setActivation } from '../../src/data/activation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { X_CLIENT_MAX } from '../../src/auth/api-key-middleware.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { automationsRouter } from '../../src/routes/automations.js';
import { gatewayKeysRouter } from '../../src/routes/gateway-keys.js';

/**
 * Contract test for the automations endpoints (ch03 §3.8.18): every response validates against
 * its shared/ schema (ch13 §13.5), the Amendment-2 creation authority is enforced (org-admin by
 * default, builder only behind the flippable org setting), and every non-2xx body validates
 * against the shared error envelope. The planner's model call is mocked (LLM-free per PR).
 *
 * Slice E4 adds the run lifecycle an OUTSIDE client needs: idempotent create (body field or
 * `Idempotency-Key` header), the per-step logs endpoint, and the `user-or-key` flip — exercised
 * here under BOTH admissions, a platform JWT and a REAL key minted through POST /gateway-keys
 * (mounted beside the automations router for exactly that).
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
  await users.insert({ _id: 'b1', username: 'b1', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'o1', active: true } as never);
  setActivation('admin1', { active: true, billingLocked: false });
  setActivation('b1', { active: true, billingLocked: false });
  __resetCapabilityRateForTests();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/automations', automationsRouter());
  app.use('/api/v1/gateway-keys', gatewayKeysRouter(deps));
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

  /**
   * A plan step the wire shape cannot express is refused at CREATE/PATCH, not stored and left to
   * fail at run time. The live defect: a caller correctly sent `integrationKey`/`integrationAction`,
   * got 201 with `{stepId, description, tool}` (the mapper had dropped both, and the wire projection
   * hid the loss), and the run then failed with "integration step <id> missing integrationKey or
   * integrationAction" - the API blaming the caller for fields it discarded itself.
   */
  it('a step the wire plan cannot express is refused with the error envelope, and never stored', async () => {
    const t = await adminToken();
    const step = { description: 'List Gmail labels', tool: 'integration', integrationKey: 'google-workspace', integrationAction: 'list_labels' };
    const res = await api('/api/v1/automations', t, { method: 'POST', body: JSON.stringify({ name: 'CT-etiquetas', plan: { steps: [step] } }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    // Actionable: names the fields that cannot travel and the route that CAN author them.
    expect(body.error.message).toContain('integrationKey, integrationAction');
    expect(body.error.message).toContain('POST /api/v1/automations/plan');

    // PATCH refuses identically, and the stored plan is untouched.
    const created = (await (await api('/api/v1/automations', t, { method: 'POST', body: JSON.stringify({ name: 'CT-editavel', plan: { steps: [{ stepId: 's1', description: 'abrir', tool: 'browser' }] } }) })).json()) as Record<string, unknown>;
    const patched = await api(`/api/v1/automations/${created.id}`, t, { method: 'PATCH', body: JSON.stringify({ plan: { steps: [step] } }) });
    expect(patched.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await patched.json()).success).toBe(true);
    const reread = (await (await api(`/api/v1/automations/${created.id}`, t)).json()) as { plan: { steps: unknown[] } };
    expect(reread.plan.steps).toEqual([{ stepId: 's1', description: 'abrir', tool: 'browser' }]);

    const list = (await (await api('/api/v1/automations', t)).json()) as { items: Array<{ name: string }> };
    expect(list.items.some((a) => a.name === 'CT-etiquetas')).toBe(false);
  });

  it('an unrecognised tool is refused, not coerced into a browser step', async () => {
    const t = await adminToken();
    const res = await api('/api/v1/automations', t, { method: 'POST', body: JSON.stringify({ name: 'CT-gralha', plan: { steps: [{ description: 'clicar em guardar', tool: 'brwoser' }] } }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('browser, verify, wait'); // what this endpoint can express
    const list = (await (await api('/api/v1/automations', t)).json()) as { items: Array<{ name: string }> };
    expect(list.items.some((a) => a.name === 'CT-gralha')).toBe(false);
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

  it('F29: an unusable model plan returns 200 plan_failed (never an opaque 500)', async () => {
    const t = await adminToken();
    // Each of these makes the planner unable to produce a valid plan. Pre-F29 they threw a plain
    // Error the route wrapper masked as 500 INTERNAL; now each is a structured plan_failed.
    for (const bad of [
      'this is not JSON at all, just prose',
      JSON.stringify({ status: 'ok', steps: [] }), // no steps
      JSON.stringify({ status: 'ok', steps: [{ type: 'not_a_real_step' }] }), // invalid step type
      JSON.stringify({ status: 'weird' }), // unexpected status
    ]) {
      hoisted.planText = bad;
      const res = await api('/api/v1/automations/plan', t, { method: 'POST', body: JSON.stringify({ goal: 'faz algo', language: 'pt' }) });
      expect(res.status, `input: ${bad}`).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(PlanResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
      expect((body.plan as { status?: string }).status).toBe('plan_failed');
      expect(typeof (body.plan as { reason?: string }).reason).toBe('string');
      expect(body.automation).toBeUndefined(); // nothing persisted
      expect(body.runId).toBeUndefined(); // no rehearsal run started
      expect((body as { code?: string }).code).toBeUndefined(); // NOT an error envelope
    }
  });

  it('an egress outage returns 200 plan_unavailable with a retry-soon reason (never plan_failed)', async () => {
    const t = await adminToken();
    // Empty transport text = the model service failing quietly (dead credential / provider
    // outage). The wire must say "service unavailable, retry soon" — not blame the goal.
    hoisted.planText = '';
    const res = await api('/api/v1/automations/plan', t, { method: 'POST', body: JSON.stringify({ goal: 'faz algo', language: 'pt' }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(PlanResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect((body.plan as { status?: string }).status).toBe('plan_unavailable');
    expect((body.plan as { reason?: string }).reason).toMatch(/indisponível/i);
    expect(body.automation).toBeUndefined(); // nothing persisted
    expect(body.runId).toBeUndefined(); // no rehearsal run started
  });

  it('plan-from-goal honours the creation-authority gate: a builder is 403 by default (Codex G8)', async () => {
    hoisted.planText = JSON.stringify({ status: 'ok', name: 'X', description: '', inputs: [], steps: [{ type: 'wait', durationMs: 1 }], reasoning: '' });
    const t = await builderToken();
    // Org setting is off by default (the earlier test restored it) → a builder may not create via /plan.
    const denied = await api('/api/v1/automations/plan', t, { method: 'POST', body: JSON.stringify({ goal: 'x', language: 'pt' }) });
    expect(denied.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await denied.json()).success).toBe(true);
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

// ============================================================================
// Slice E4 — idempotent create, logs, user-or-key
// ============================================================================

/** Create an automation and return its id (admin token; no steps → the run completes at once). */
async function newAutomation(t: string, name: string): Promise<string> {
  const res = await api('/api/v1/automations', t, { method: 'POST', body: JSON.stringify({ name }) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const startRunReq = (id: string, t: string, body: unknown, headers: Record<string, string> = {}) =>
  api(`/api/v1/automations/${id}/runs`, t, { method: 'POST', body: JSON.stringify(body), headers });

/**
 * A POST down a RAW socket, so a header can be sent MORE THAN ONCE — `fetch` and undici both
 * collapse repeats, and Node's server side joins them with ', ' before Express ever sees them, so
 * a raw request is the only way to exercise the duplicate-header refusal.
 */
function rawPost(path: string, token: string, extraHeaderLines: string[]): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = '{}';
    const lines = [
      `POST ${path} HTTP/1.1`,
      'Host: 127.0.0.1',
      `Authorization: Bearer ${token}`,
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(body)}`,
      'Connection: close',
      ...extraHeaderLines,
      '',
      body,
    ];
    const socket = connect(port, '127.0.0.1', () => socket.write(lines.join('\r\n')));
    const chunks: Buffer[] = [];
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('error', reject);
    socket.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const status = Number(raw.slice(9, 12));
      const sep = raw.indexOf('\r\n\r\n');
      resolve({ status, body: sep >= 0 ? raw.slice(sep + 4) : '' });
    });
  });
}

/** Wait until the async engine has written its LAST record for a run (finalize), so a test that
 *  mutates the run row afterwards is not racing the engine. */
async function waitForTerminalRun(runId: string, t: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const res = await api(`/api/v1/automations/runs/${runId}`, t);
    if (res.status === 200) {
      const { status } = (await res.json()) as { status: string };
      if (status !== 'running') return;
    } else {
      await res.body?.cancel();
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`run ${runId} never reached a terminal status`);
}

describe('automations run lifecycle (slice E4)', () => {
  it('descriptors: the whole domain is user-or-key EXCEPT the SSE stream, which stays token-query', () => {
    for (const [name, d] of Object.entries(automationsEndpoints)) {
      if (name === 'events') {
        // A key must never ride a jti-bearing platform JWT (E1 review, binding constraint).
        expect(d.auth, 'events').toBe('token-query');
        continue;
      }
      expect(d.auth, name).toBe('user-or-key');
    }
    expect(automationsEndpoints.getRunLogs.path).toBe('/api/v1/automations/runs/:id/logs');
    expect(automationsEndpoints.getRunLogs.method).toBe('GET');
  });

  it('the same idempotencyKey answers 202 then 200 with the SAME runId, and starts exactly ONE run', async () => {
    const t = await adminToken();
    const id = await newAutomation(t, 'Idem-1');

    const first = await startRunReq(id, t, { idempotencyKey: 'chave-1' });
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { runId: string };
    expect(RunCreateResponse.safeParse(firstBody).success).toBe(true);

    const replay = await startRunReq(id, t, { idempotencyKey: 'chave-1' });
    expect(replay.status).toBe(200); // fresh create is 202; a replay is 200
    const replayBody = (await replay.json()) as { runId: string };
    expect(RunCreateResponse.safeParse(replayBody).success).toBe(true);
    expect(replayBody.runId).toBe(firstBody.runId);

    // ONE run exists for this automation — the replay started nothing.
    const runs = (await (await api(`/api/v1/automations/runs?automationId=${id}`, t)).json()) as { items: Array<{ id: string }> };
    expect(RunListResponse.safeParse(runs).success).toBe(true);
    expect(runs.items.map((r) => r.id)).toEqual([firstBody.runId]);
  });

  it('two SIMULTANEOUS creates with one key race on the insert: both callers get the same runId, one run exists', async () => {
    const t = await adminToken();
    const id = await newAutomation(t, 'Idem-race');

    // The reason the mapping is inserted BEFORE the run is created: the loser of this race must
    // read the winner's runId, never mint a second run.
    const [a, b] = await Promise.all([
      startRunReq(id, t, { idempotencyKey: 'corrida' }),
      startRunReq(id, t, { idempotencyKey: 'corrida' }),
    ]);
    const [bodyA, bodyB] = (await Promise.all([a.json(), b.json()])) as [{ runId: string }, { runId: string }];
    expect(RunCreateResponse.safeParse(bodyA).success).toBe(true);
    expect(RunCreateResponse.safeParse(bodyB).success).toBe(true);
    expect(bodyA.runId).toBe(bodyB.runId);
    // Exactly one of them created it (202); the other replayed it (200).
    expect([a.status, b.status].sort()).toEqual([200, 202]);

    const runs = (await (await api(`/api/v1/automations/runs?automationId=${id}`, t)).json()) as { items: Array<{ id: string }> };
    expect(runs.items.map((r) => r.id)).toEqual([bodyA.runId]);
  });

  it('the dedupe key spans (automation, owner, key): a different key, automation or owner starts a DISTINCT run', async () => {
    const t = await adminToken();
    const one = await newAutomation(t, 'Idem-scope-1');
    const two = await newAutomation(t, 'Idem-scope-2');

    const base = ((await (await startRunReq(one, t, { idempotencyKey: 'ka' })).json()) as { runId: string }).runId;
    const otherKey = ((await (await startRunReq(one, t, { idempotencyKey: 'kb' })).json()) as { runId: string }).runId;
    const otherAutomation = ((await (await startRunReq(two, t, { idempotencyKey: 'ka' })).json()) as { runId: string }).runId;

    // A different OWNER: the builder runs their OWN automation under the same key string.
    await orgs.update('o1', (o) => ({ ...o, settings: { allowBuilderAutomations: true } }));
    const bt = await builderToken();
    const builderAutomation = await newAutomation(bt, 'Idem-scope-builder');
    const otherOwner = ((await (await startRunReq(builderAutomation, bt, { idempotencyKey: 'ka' })).json()) as { runId: string }).runId;
    await orgs.update('o1', (o) => ({ ...o, settings: { allowBuilderAutomations: false } }));

    expect(new Set([base, otherKey, otherAutomation, otherOwner]).size).toBe(4);
  });

  it('no idempotency key: behaviour is unchanged — every POST mints a fresh run with 202', async () => {
    const t = await adminToken();
    const id = await newAutomation(t, 'Sem-chave');
    const a = await startRunReq(id, t, {});
    const b = await startRunReq(id, t, {});
    expect([a.status, b.status]).toEqual([202, 202]);
    const [bodyA, bodyB] = (await Promise.all([a.json(), b.json()])) as [{ runId: string }, { runId: string }];
    expect(bodyA.runId).not.toBe(bodyB.runId);
  });

  it('the Idempotency-Key HEADER is the same field; a body/header disagreement is refused, not resolved', async () => {
    const t = await adminToken();
    const id = await newAutomation(t, 'Idem-header');

    const first = await startRunReq(id, t, {}, { 'idempotency-key': 'cabecalho-1' });
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { runId: string };

    // Header alone replays.
    const replay = await startRunReq(id, t, {}, { 'idempotency-key': 'cabecalho-1' });
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { runId: string }).runId).toBe(firstBody.runId);

    // Header + IDENTICAL body field is fine (the two are one field).
    const agreeing = await startRunReq(id, t, { idempotencyKey: 'cabecalho-1' }, { 'idempotency-key': 'cabecalho-1' });
    expect(agreeing.status).toBe(200);
    expect(((await agreeing.json()) as { runId: string }).runId).toBe(firstBody.runId);

    // Disagreeing: refused. Picking a winner would bind at-most-once to a key the client did not
    // think it was using.
    const conflict = await startRunReq(id, t, { idempotencyKey: 'corpo-2' }, { 'idempotency-key': 'cabecalho-1' });
    expect(conflict.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await conflict.json()).success).toBe(true);

    // An over-long header key is a validation failure, not a silent truncation.
    const tooLong = await startRunReq(id, t, {}, { 'idempotency-key': 'x'.repeat(129) });
    expect(tooLong.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await tooLong.json()).success).toBe(true);


    // Neither refusal started anything: the automation still has exactly the one run.
    const runs = (await (await api(`/api/v1/automations/runs?automationId=${id}`, t)).json()) as { items: Array<{ id: string }> };
    expect(runs.items.map((r) => r.id)).toEqual([firstBody.runId]);
  });

  it('a REPEATED Idempotency-Key header is refused, never joined into a third key', async () => {
    const t = await adminToken();
    const id = await newAutomation(t, 'Idem-repetido');

    // Node collapses `aa` + `bb` into the single value 'aa, bb'. Accepting that silently moves the
    // caller into a key namespace neither the client nor the proxy chose — the same class of bug
    // the body/header conflict check exists to prevent (E4 review, hardening 4).
    const repeated = await rawPost(`/api/v1/automations/${id}/runs`, t, ['Idempotency-Key: aa', 'Idempotency-Key: bb']);
    expect(repeated.status).toBe(400);
    expect(ErrorEnvelope.safeParse(JSON.parse(repeated.body)).success).toBe(true);

    // Nothing ran, and NEITHER spelling was claimed: 'aa' is still free, and the joined 'aa, bb'
    // never became a key at all.
    const runs = (await (await api(`/api/v1/automations/runs?automationId=${id}`, t)).json()) as { items: unknown[] };
    expect(runs.items).toEqual([]);
    const claimAa = await startRunReq(id, t, { idempotencyKey: 'aa' });
    expect(claimAa.status).toBe(202);
    const joined = await startRunReq(id, t, { idempotencyKey: 'aa, bb' });
    expect(joined.status).toBe(202); // a fresh key, not a replay of anything
    expect(((await joined.json()) as { runId: string }).runId).not.toBe(((await claimAa.json()) as { runId: string }).runId);

    // A single header line is still perfectly fine down the same raw path.
    const single = await rawPost(`/api/v1/automations/${id}/runs`, t, ['Idempotency-Key: cc']);
    expect(single.status).toBe(202);
    expect(RunCreateResponse.safeParse(JSON.parse(single.body)).success).toBe(true);
  });

  it('a mapping whose run is GONE still answers the mapping — the retry never re-executes', async () => {
    const t = await adminToken();
    const id = await newAutomation(t, 'Idem-orfa');
    const created = (await (await startRunReq(id, t, { idempotencyKey: 'orfa' })).json()) as { runId: string };

    // Simulate a deleted / reaped run (after the engine's last write, so the delete sticks).
    await waitForTerminalRun(created.runId, t);
    await automationRuns.delete(created.runId);

    const replay = await startRunReq(id, t, { idempotencyKey: 'orfa' });
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { runId: string }).runId).toBe(created.runId);
    // And the endpoint is honest about it: the run really is gone.
    const gone = await api(`/api/v1/automations/runs/${created.runId}`, t);
    expect(gone.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await gone.json()).success).toBe(true);
    // Nothing was re-created behind the caller's back.
    const runs = (await (await api(`/api/v1/automations/runs?automationId=${id}`, t)).json()) as { items: Array<{ id: string }> };
    expect(runs.items).toEqual([]);
  });

  it('a REAL minted gateway key drives a run: 202 + ONE audit row carrying keyId and the x-client tag', async () => {
    const t = await adminToken();
    const id = await newAutomation(t, 'Chave-corre');
    await activityLogs.deleteMany({ category: 'automations' } as never);

    const mint = await api('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label: 'automations-e4' }) });
    expect(mint.status).toBe(201);
    const minted = (await mint.json()) as { id: string; key: string };
    expect(minted.key.startsWith('ekoa_gk_')).toBe(true);

    const keyed = (p: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}${p}`, {
        ...init,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${minted.key}`, 'x-client': 'claude-code', ...(init.headers ?? {}) },
      });

    const started = await keyed(`/api/v1/automations/${id}/runs`, { method: 'POST', body: JSON.stringify({ idempotencyKey: 'via-chave' }) });
    expect(started.status).toBe(202);
    const startedBody = (await started.json()) as { runId: string };
    expect(RunCreateResponse.safeParse(startedBody).success).toBe(true);

    // The key reads its own run back (same user-or-key admission on every route).
    const rec = await keyed(`/api/v1/automations/runs/${startedBody.runId}`);
    expect(rec.status).toBe(200);
    expect(RunRecord.safeParse(await rec.json()).success).toBe(true);

    // A replay under the key is the same 200 + same runId, and is audited as such.
    const replay = await keyed(`/api/v1/automations/${id}/runs`, { method: 'POST', body: JSON.stringify({ idempotencyKey: 'via-chave' }) });
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { runId: string }).runId).toBe(startedBody.runId);

    const rows = (await activityLogs.find({ category: 'automations' } as never)) as unknown as Array<{ type: string; metadata: Record<string, unknown> }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.type).toBe('automation_run_create');
      expect(row.metadata.keyId).toBe(minted.id);
      expect(row.metadata.xClient).toBe('claude-code'); // trace only — nothing branches on it
      expect(row.metadata.automationId).toBe(id);
      expect(row.metadata.runId).toBe(startedBody.runId);
    }
    expect(rows.map((r) => r.metadata.idempotent).sort()).toEqual([false, true]);
  });

  it('an oversized x-client is BOUNDED before it reaches the audit row (E1 middleware, hardening 7)', async () => {
    const t = await adminToken();
    const id = await newAutomation(t, 'Chave-xclient');
    await activityLogs.deleteMany({ category: 'automations' } as never);
    const minted = (await (await api('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label: 'xclient' }) })).json()) as { id: string; key: string };

    // x-client is caller-controlled and audited verbatim by every consumer. Unbounded, a 4 KB
    // header lands whole in activity_logs on EVERY call — audit-trail amplification the durable
    // store pays for forever. The cap lives in the middleware so memvault inherits it too.
    const started = await fetch(`http://127.0.0.1:${port}/api/v1/automations/${id}/runs`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${minted.key}`, 'x-client': 'C'.repeat(4000) },
    });
    expect(started.status).toBe(202);

    const [row] = (await activityLogs.find({ category: 'automations' } as never)) as unknown as Array<{ metadata: { xClient: string } }>;
    expect(row!.metadata.xClient.length).toBe(X_CLIENT_MAX + 1); // 128 kept + the truncation marker
    expect(row!.metadata.xClient.startsWith('C'.repeat(X_CLIENT_MAX))).toBe(true);
    expect(row!.metadata.xClient.endsWith('…')).toBe(true); // a cut tag is never mistaken for a name
  });

  it('`visibility: private` is ENFORCED, not merely echoed: owner-only, uniform 404, JWT and key alike', async () => {
    // The field is published in the contract (`Automation.visibility`), so a client reads it as
    // access control. It used to be stored and echoed and enforced NOWHERE — any member of the org
    // read the automation by id and got it in their list. The full matrix (org-admin/super-admin,
    // patch-to-private, absent-visibility parity, the trigger delivery path) lives in
    // api/tests/security/automation-visibility.test.ts; this pins the CONTRACT half of it.
    const t = await adminToken();
    const created = await api('/api/v1/automations', t, { method: 'POST', body: JSON.stringify({ name: 'Privada', visibility: 'private', plan: { steps: [] } }) });
    expect(created.status).toBe(201);
    const body = (await created.json()) as Record<string, unknown>;
    expect(Automation.safeParse(body).success).toBe(true);
    expect(body.visibility).toBe('private');
    const id = body.id as string;

    // The owner still holds it, by id and in their list.
    expect((await api(`/api/v1/automations/${id}`, t)).status).toBe(200);
    const ownerList = (await (await api('/api/v1/automations', t)).json()) as { items: Array<{ id: string }> };
    expect(AutomationListResponse.safeParse(ownerList).success).toBe(true);
    expect(ownerList.items.some((a) => a.id === id)).toBe(true);

    // A same-org peer, under BOTH admissions: 404 by id, absent from a still schema-valid list.
    const bt = await builderToken();
    const minted = (await (await api('/api/v1/gateway-keys', bt, { method: 'POST', body: JSON.stringify({ label: 'peer-visibility' }) })).json()) as { key: string };
    const peers = [bt, minted.key];
    for (const cred of peers) {
      const hidden = await api(`/api/v1/automations/${id}`, cred);
      const missing = await api('/api/v1/automations/nao-existe', cred);
      const [hiddenBody, missingBody] = [await hidden.text(), await missing.text()];
      expect(hidden.status).toBe(404);
      expect(ErrorEnvelope.safeParse(JSON.parse(hiddenBody)).success).toBe(true);
      // Indistinguishable from a genuinely missing id — status AND body bytes.
      expect(hidden.status).toBe(missing.status);
      expect(hiddenBody).toBe(missingBody);

      const list = (await (await api('/api/v1/automations', cred)).json()) as { items: Array<{ id: string }> };
      expect(AutomationListResponse.safeParse(list).success).toBe(true);
      expect(list.items.some((a) => a.id === id)).toBe(false);
    }
  });

  it('plan-from-goal cannot be aimed at someone else`s private automation (same refusal as a missing id)', async () => {
    // /plan with an `automationId` OVERWRITES that automation — it is a write path, gated by
    // canWriteAutomation, which now refuses an automation the caller cannot see. The refusal is
    // the SAME FORBIDDEN this endpoint already gives for an id that does not exist, so it is not
    // an existence oracle either.
    // The non-owner here is the ORG-ADMIN, who otherwise passes canWriteAutomation on any row in
    // the org — the only caller for whom the private gate is what stops the overwrite.
    hoisted.planText = JSON.stringify({ status: 'ok', name: 'Reescrita', description: '', inputs: [], steps: [{ type: 'wait', durationMs: 1 }], reasoning: '' });
    await orgs.update('o1', (o) => ({ ...o, settings: { allowBuilderAutomations: true } }));
    const bt = await builderToken();
    const priv = (await (await api('/api/v1/automations', bt, { method: 'POST', body: JSON.stringify({ name: 'Plan-alvo', visibility: 'private' }) })).json()) as { id: string };
    await orgs.update('o1', (o) => ({ ...o, settings: { allowBuilderAutomations: false } }));

    const t = await adminToken();
    const onPrivate = await api('/api/v1/automations/plan', t, { method: 'POST', body: JSON.stringify({ goal: 'reescreve', language: 'pt', automationId: priv.id }) });
    const onGhost = await api('/api/v1/automations/plan', t, { method: 'POST', body: JSON.stringify({ goal: 'reescreve', language: 'pt', automationId: 'nao-existe-mesmo' }) });
    const [pb, gb] = [await onPrivate.text(), await onGhost.text()];
    expect(onPrivate.status).toBe(403);
    expect(ErrorEnvelope.safeParse(JSON.parse(pb)).success).toBe(true);
    expect(onPrivate.status).toBe(onGhost.status);
    expect(pb).toBe(gb);

    // Untouched: the owner's automation still has its own name, and no run was started on it.
    const still = (await (await api(`/api/v1/automations/${priv.id}`, bt)).json()) as { name: string };
    expect(still.name).toBe('Plan-alvo');
    const runs = (await (await api(`/api/v1/automations/runs?automationId=${priv.id}`, bt)).json()) as { items: unknown[] };
    expect(runs.items).toEqual([]);
  });

  it('run logs: schema-valid, bounded per step AND per run, cross-owner is the uniform 404', async () => {
    const t = await adminToken();
    const id = await newAutomation(t, 'Logs');

    // A run record shaped exactly as the engine persists one: step 0 carries the streamed tail
    // (plus the final stderr), step 1 an api_call body far over the cap, step 2 nothing at all.
    const runId = 'run-logs-fixture';
    await automationRuns.insert({
      _id: runId,
      id: runId,
      automationId: id,
      startedAt: new Date().toISOString(),
      status: 'completed',
      inputs: {},
      triggeredBy: 'user',
      ownerUserId: 'admin1',
      orgId: 'o1',
      steps: [
        {
          stepId: 's0', index: 0, status: 'completed', tier: 'cache', durationMs: 5,
          logTail: { text: `${'a'.repeat(RUN_LOG_STEP_MAX_CHARS - 3)}FIM`, truncated: true },
          output: { kind: 'local_command', stdout: 'ignorado', stderr: 'aviso no stderr', exitCode: 0, durationMs: 5, truncated: false, timedOut: false },
        },
        {
          stepId: 's1', index: 1, status: 'completed', tier: 'cache', durationMs: 7,
          output: { kind: 'api_call', status: 200, responseHeaders: {}, responseBody: 'b'.repeat(200_000), responseBodyIsJson: false, truncated: false, durationMs: 7 },
        },
        { stepId: 's2', index: 2, status: 'completed', tier: 'cache', durationMs: 1 },
      ],
    } as never);

    const res = await api(`/api/v1/automations/runs/${runId}/logs`, t);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; steps: Array<{ stepIndex: number; log: string; truncated: boolean }> };
    expect(RunLogsResponse.safeParse(body).success).toBe(true);
    expect(body.runId).toBe(runId);

    // Only the steps that produced something are listed.
    expect(body.steps.map((s) => s.stepIndex)).toEqual([0, 1]);

    // Step 0: the streamed tail wins over the stored stdout, the final stderr is appended, and the
    // whole thing is re-capped at the per-step bound.
    const s0 = body.steps[0]!;
    expect(s0.log.length).toBeLessThanOrEqual(RUN_LOG_STEP_MAX_CHARS);
    expect(s0.truncated).toBe(true);
    expect(s0.log).toContain('aviso no stderr'); // the tail keeps the END
    expect(s0.log).not.toContain('ignorado'); // the streamed tail replaced the stored stdout

    // Step 1: a 200 000-char response body cannot become a 200 000-char log.
    const s1 = body.steps[1]!;
    expect(s1.log.length).toBeLessThanOrEqual(RUN_LOG_STEP_MAX_CHARS);
    expect(s1.truncated).toBe(true);

    // And the whole response is bounded, whatever is on disk.
    const total = body.steps.reduce((n, s) => n + s.log.length, 0);
    expect(total).toBeLessThanOrEqual(RUN_LOG_TOTAL_MAX_CHARS);

    // Tenancy: the same uniform 404 GET /runs/:id gives — never an existence oracle.
    const bt = await builderToken();
    const foreign = await api(`/api/v1/automations/runs/${runId}/logs`, bt);
    expect(foreign.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await foreign.json()).success).toBe(true);
    const foreignRun = await api(`/api/v1/automations/runs/${runId}`, bt);
    expect(foreignRun.status).toBe(404);

    // A run that does not exist answers identically.
    const ghost = await api('/api/v1/automations/runs/ghost-run/logs', t);
    expect(ghost.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await ghost.json()).success).toBe(true);
  });
});
