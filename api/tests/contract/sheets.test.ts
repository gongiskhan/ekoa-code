import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, sessions, messages } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { Sheet, SheetListResponse, ErrorEnvelope } from '@ekoa/shared';

/**
 * Sheets contract (mega-run B1, decision B.B). Sheets live as SUBDOCUMENTS on the session
 * record; a legacy session (no sheets field) reads as one derived sheet per assistant message
 * (no backfill). Every 2xx body must satisfy the shared Sheet / SheetListResponse schemas and
 * every non-2xx the shared error envelope; a user edit records who/when/what server-side
 * (editedBy from the JWT, createdAt stamped, instruction carried) - never claimed by the body.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++ * 1000, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_sheets_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await sessions.deleteMany({}); await messages.deleteMany({});
  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true });
  await users.insert({ _id: 'u2', username: 'u2', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgB', active: true });
  setActivation('u1', { active: true, billingLocked: false });
  setActivation('u2', { active: true, billingLocked: false });
});
const tokenFor = async (u = 'u1') => (await login(u, 'pw123456', false, deps)).token;

/** Seed a session with a transcript THROUGH the API (real router stack, no store shortcuts). */
async function seedLegacySession(t: string): Promise<{ sessionId: string; assistantIds: string[] }> {
  const created = await readJson(await authed('/api/v1/sessions', t, { method: 'POST', body: JSON.stringify({ name: 'com folhas' }) }));
  const sessionId = created.id as string;
  const assistantIds: string[] = [];
  const add = async (role: string, content: string) =>
    readJson(await authed(`/api/v1/sessions/${sessionId}/messages`, t, { method: 'POST', body: JSON.stringify({ role, content }) }));
  await add('user', 'faz-me uma minuta');
  assistantIds.push((await add('assistant', '# Minuta\ncorpo da minuta')).id as string);
  await add('user', 'e um resumo');
  assistantIds.push((await add('assistant', 'Resumo breve')).id as string);
  return { sessionId, assistantIds };
}

describe('sheets contract (B1, decision B.B)', () => {
  it('GET /sessions/:id/sheets on a legacy session derives one sheet per assistant message (SheetListResponse)', async () => {
    const t = await tokenFor();
    const { sessionId, assistantIds } = await seedLegacySession(t);
    const res = await authed(`/api/v1/sessions/${sessionId}/sheets`, t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const parsed = SheetListResponse.safeParse(body);
    expect(parsed.success, `SheetListResponse.safeParse failed: ${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`).toBe(true);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2); // one per ASSISTANT message, user turns spawn none
    expect(items.map((s) => s.createdFromMessageId)).toEqual(assistantIds);
    const first = items[0]!;
    expect(first.title).toBe('Minuta'); // heading markers stripped from the derived title
    const revs = first.revisions as Array<Record<string, unknown>>;
    expect(revs).toHaveLength(1);
    expect(revs[0]!.editSource).toBe('agent');
    expect(revs[0]!.content).toBe('# Minuta\ncorpo da minuta');
  });

  it('POST .../sheets/:sheetId/revisions records who/when/what and returns the updated Sheet (201)', async () => {
    const t = await tokenFor();
    const { sessionId } = await seedLegacySession(t);
    const list = await readJson(await authed(`/api/v1/sessions/${sessionId}/sheets`, t));
    const sheetId = (list.items as Array<{ sheetId: string }>)[0]!.sheetId;
    const res = await authed(`/api/v1/sessions/${sessionId}/sheets/${sheetId}/revisions`, t, {
      method: 'POST',
      body: JSON.stringify({ content: 'corpo revisto pelo utilizador', instruction: 'muda a data para hoje' }),
    });
    expect(res.status).toBe(201);
    const body = await readJson(res);
    const parsed = Sheet.safeParse(body);
    expect(parsed.success, `Sheet.safeParse failed: ${JSON.stringify(parsed.success ? [] : parsed.error.issues)}`).toBe(true);
    const revs = body.revisions as Array<Record<string, unknown>>;
    expect(revs).toHaveLength(2); // derived original + the user edit, oldest first
    expect(revs[1]).toMatchObject({
      content: 'corpo revisto pelo utilizador',
      editSource: 'user', // stamped server-side, never from the body
      editedBy: 'u1', // who
      instruction: 'muda a data para hoje', // what
    });
    expect(typeof revs[1]!.createdAt).toBe('string'); // when
    // Forged stamp fields in the body must NEVER win over the server's own values
    // (codexSliceReview B1 finding 3: pin server-side stamping against a client regression).
    const forged = await authed(`/api/v1/sessions/${sessionId}/sheets/${sheetId}/revisions`, t, {
      method: 'POST',
      body: JSON.stringify({
        content: 'segunda revisão',
        instruction: 'ajusta o tom',
        editSource: 'agent',
        editedBy: 'intruso',
        createdAt: '1999-01-01T00:00:00Z',
      }),
    });
    expect([201, 400]).toContain(forged.status); // strict schemas may reject unknown keys outright
    if (forged.status === 201) {
      const forgedBody = await readJson(forged);
      const fRevs = forgedBody.revisions as Array<Record<string, unknown>>;
      const last = fRevs[fRevs.length - 1]!;
      expect(last.editSource).toBe('user'); // server stamp wins
      expect(last.editedBy).toBe('u1'); // server identity wins
      expect(last.createdAt).not.toBe('1999-01-01T00:00:00Z'); // server clock wins
    }
    // Persisted: a re-read returns the materialised sheet AND keeps the sibling derived sheet.
    const after = await readJson(await authed(`/api/v1/sessions/${sessionId}/sheets`, t));
    const items = after.items as Array<{ sheetId: string; revisions: unknown[] }>;
    expect(items).toHaveLength(2);
    expect(items.find((s) => s.sheetId === sheetId)!.revisions.length).toBeGreaterThanOrEqual(2);
  });

  it('PATCH .../sheets/:sheetId renames the sheet and the rename persists (Sheet)', async () => {
    const t = await tokenFor();
    const { sessionId } = await seedLegacySession(t);
    const list = await readJson(await authed(`/api/v1/sessions/${sessionId}/sheets`, t));
    const sheetId = (list.items as Array<{ sheetId: string }>)[1]!.sheetId;
    const res = await authed(`/api/v1/sessions/${sessionId}/sheets/${sheetId}`, t, { method: 'PATCH', body: JSON.stringify({ title: 'Resumo executivo' }) });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(Sheet.safeParse(body).success).toBe(true);
    expect(body.title).toBe('Resumo executivo');
    const after = await readJson(await authed(`/api/v1/sessions/${sessionId}/sheets`, t));
    expect((after.items as Array<{ sheetId: string; title: string }>).find((s) => s.sheetId === sheetId)!.title).toBe('Resumo executivo');
  });

  it('an invalid body is a 400 VALIDATION_FAILED with the shared error envelope (both writes)', async () => {
    const t = await tokenFor();
    const { sessionId } = await seedLegacySession(t);
    const list = await readJson(await authed(`/api/v1/sessions/${sessionId}/sheets`, t));
    const sheetId = (list.items as Array<{ sheetId: string }>)[0]!.sheetId;
    for (const [path, method] of [
      [`/api/v1/sessions/${sessionId}/sheets/${sheetId}/revisions`, 'POST'],
      [`/api/v1/sessions/${sessionId}/sheets/${sheetId}`, 'PATCH'],
    ] as const) {
      const res = await authed(path, t, { method, body: JSON.stringify({}) });
      expect(res.status).toBe(400);
      const body = await readJson(res);
      expect(ErrorEnvelope.safeParse(body).success).toBe(true);
      expect((body.error as { code: string }).code).toBe('VALIDATION_FAILED');
    }
  });

  it('an unknown sheet id is a 404 NOT_FOUND envelope (rename + revision)', async () => {
    const t = await tokenFor();
    const { sessionId } = await seedLegacySession(t);
    for (const [path, method, payload] of [
      [`/api/v1/sessions/${sessionId}/sheets/sheet-nope`, 'PATCH', { title: 'x' }],
      [`/api/v1/sessions/${sessionId}/sheets/sheet-nope/revisions`, 'POST', { content: 'x' }],
    ] as const) {
      const res = await authed(path, t, { method, body: JSON.stringify(payload) });
      expect(res.status).toBe(404);
      const body = await readJson(res);
      expect(ErrorEnvelope.safeParse(body).success).toBe(true);
      expect((body.error as { code: string }).code).toBe('NOT_FOUND');
    }
  });

  it("another user's session sheets are a uniform not-found on all three endpoints", async () => {
    const t1 = await tokenFor('u1');
    const t2 = await tokenFor('u2');
    const { sessionId } = await seedLegacySession(t1);
    const list = await readJson(await authed(`/api/v1/sessions/${sessionId}/sheets`, t1));
    const sheetId = (list.items as Array<{ sheetId: string }>)[0]!.sheetId;
    for (const [path, init] of [
      [`/api/v1/sessions/${sessionId}/sheets`, {}],
      [`/api/v1/sessions/${sessionId}/sheets/${sheetId}`, { method: 'PATCH', body: JSON.stringify({ title: 'x' }) }],
      [`/api/v1/sessions/${sessionId}/sheets/${sheetId}/revisions`, { method: 'POST', body: JSON.stringify({ content: 'x' }) }],
    ] as const) {
      const res = await authed(path, t2, init as RequestInit);
      expect(res.status, path).toBe(404);
      const body = await readJson(res);
      expect(ErrorEnvelope.safeParse(body).success).toBe(true);
      expect((body.error as { code: string }).code).toBe('NOT_FOUND');
    }
  });
});
