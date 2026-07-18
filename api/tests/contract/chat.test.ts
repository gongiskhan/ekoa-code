import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { ChatRunCreateResponse, ChatRun, ChatRunCancelResponse, ErrorEnvelope } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings, sessions } from '../../src/data/stores.js';
import { setActivation } from '../../src/data/activation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { setCredential } from '../../src/llm/credentials.js';
import { __setTransportForTests } from '../../src/llm/client.js';
import { chatRouter } from '../../src/routes/chat.js';
import { makeFakeTransport } from '../agents/_fake-transport.js';

/**
 * Contract test for the chat runs endpoints (ch03 §3.8.7): every response validates against its
 * `shared/` schema (ch13 §13.5). The chat router is mounted on a bare app (server.ts wiring is
 * the lead's) with the fake transport, so creation runs LLM-free.
 */
let mem: MongoMemoryServer; let server: Server; let port: number; let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const api = (p: string, t: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_contract_chat');
  await setCredential({ mode: 'oauth', secret: 'tok' });
  __setTransportForTests(makeFakeTransport({ finalText: 'answer' }));
  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'o1', active: true });
  await users.insert({ _id: 'u2', username: 'u2', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'o2', active: true });
  setActivation('u1', { active: true, billingLocked: false });
  await userSettings.put({ _id: 'u1', memory: { autoExtract: false } }); // keep the test LLM-call-free
  // Run creation resolves session ownership (the B1 sessions/sheets idiom) BEFORE minting the
  // run, so the POSTs below need a REAL owned session; s2 belongs to u2 for the cross-user 404.
  const ts = new Date(1_700_000_000_000).toISOString();
  await sessions.insert({ _id: 's1', userId: 'u1', status: 'active', messageCount: 0, createdAt: ts, updatedAt: ts });
  await sessions.insert({ _id: 's2', userId: 'u2', status: 'active', messageCount: 0, createdAt: ts, updatedAt: ts });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/chat', chatRouter(deps));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { await new Promise((r) => setTimeout(r, 300)); server.close(); await closeMongo(); await mem.stop(); });

const tokenFor = async () => (await login('u1', 'pw123456', false, deps)).token;

describe('chat runs contract (§3.8.7)', () => {
  it('POST /chat/runs → 202 ChatRunCreateResponse; GET → ChatRun; cancel → ChatRunCancelResponse', async () => {
    const t = await tokenFor();
    const created = await api('/api/v1/chat/runs', t, { method: 'POST', body: JSON.stringify({ sessionId: 's1', message: 'hi', language: 'pt' }) });
    expect(created.status).toBe(202);
    const createBody = await created.json();
    expect(ChatRunCreateResponse.safeParse(createBody).success).toBe(true);
    const runId = (createBody as { runId: string }).runId;

    const got = await api(`/api/v1/chat/runs/${runId}`, t);
    expect(got.status).toBe(200);
    expect(ChatRun.safeParse(await got.json()).success).toBe(true);

    const cancelled = await api(`/api/v1/chat/runs/${runId}/cancel`, t, { method: 'POST' });
    expect(ChatRunCancelResponse.safeParse(await cancelled.json()).success).toBe(true);
  });

  it('POST /chat/runs accepts the B5 reviseSheetId field (202 ChatRunCreateResponse); a non-string one is a 400 envelope', async () => {
    const t = await tokenFor();
    // The agent-revision request shape (locked 5+7): the completed reply lands as a revision
    // on this sheet. Contract-level: the field parses and creation still answers 202 + runId.
    const ok = await api('/api/v1/chat/runs', t, {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', message: 'torna o tom mais formal', language: 'pt', reviseSheetId: 'sheet-abc' }),
    });
    expect(ok.status).toBe(202);
    expect(ChatRunCreateResponse.safeParse(await ok.json()).success).toBe(true);

    const bad = await api('/api/v1/chat/runs', t, {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', message: 'x', language: 'pt', reviseSheetId: 42 }),
    });
    expect(bad.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await bad.json()).success).toBe(true);
  });

  it('POST /chat/runs accepts the C7 source:"voice" field (202 ChatRunCreateResponse); any other value is a 400 envelope', async () => {
    const t = await tokenFor();
    // The wire-level pin: routes/chat.ts threads body.source into StartChatRunInput.source
    // (unit-pinned in agents/chat-lifecycle.test.ts); here only that the request PARSES and
    // creation still answers 202 + runId - no LLM call is asserted.
    const ok = await api('/api/v1/chat/runs', t, {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', message: 'qual é o prazo', language: 'pt', source: 'voice' }),
    });
    expect(ok.status).toBe(202);
    expect(ChatRunCreateResponse.safeParse(await ok.json()).success).toBe(true);

    const bad = await api('/api/v1/chat/runs', t, {
      method: 'POST',
      body: JSON.stringify({ sessionId: 's1', message: 'x', language: 'pt', source: 'typed' }),
    });
    expect(bad.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await bad.json()).success).toBe(true);
  });

  it("POST /chat/runs with another user's sessionId → uniform 404 envelope (session ownership, the sheets idiom)", async () => {
    const t = await tokenFor();
    for (const sessionId of ['s2', 'does-not-exist']) {
      const res = await api('/api/v1/chat/runs', t, {
        method: 'POST',
        body: JSON.stringify({ sessionId, message: 'hi', language: 'pt' }),
      });
      expect(res.status, sessionId).toBe(404);
      const body = await res.json();
      expect(ErrorEnvelope.safeParse(body).success).toBe(true);
      expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    }
  });

  it('GET an unknown run → 404 error envelope', async () => {
    const t = await tokenFor();
    const res = await api('/api/v1/chat/runs/does-not-exist', t);
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it('GET events with no token → 401 error envelope (CONV-1)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/chat/runs/x/events`);
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });
});
