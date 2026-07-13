import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { ErrorEnvelope } from '@ekoa/shared';

/**
 * F6 (batch-1 S6, the 404-envelope half): every non-2xx body must validate against the shared
 * error envelope (QA block). An UNMOUNTED /api/v1/* path fell through to Express's default HTML
 * 404 ("Cannot GET /api/v1/..."), so the contract sweep saw `bodyKind: "html"` on every
 * not-mounted row and clients got HTML where they parse JSON.
 *
 * The terminal handler is scoped to /api/v1 ONLY: /api/design-tokens.css, the served-app data
 * plane mounted at /api, /api/m365 and the /apps/* SPA fallbacks must keep their own behavior.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const api = (p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const authed = (p: string, t: string, init: RequestInit = {}) =>
  api(p, { ...init, headers: { authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_error_envelope');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({});
});

describe('terminal JSON-404 for unmounted /api/v1 paths (F6)', () => {
  for (const [method, path] of [
    ['GET', '/api/v1/does-not-exist'],
    ['POST', '/api/v1/does-not-exist'],
    ['PATCH', '/api/v1/nope'],
  ] as const) {
    it(`${method} ${path} -> shared error envelope, never Express HTML`, async () => {
      const res = await api(path, { method });
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toContain('<!DOCTYPE html>');
      expect(text).not.toContain('Cannot ');
      const body = JSON.parse(text) as unknown;
      expect(ErrorEnvelope.safeParse(body).success).toBe(true);
      expect((body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    });
  }

  it('an unknown SUBPATH under a mounted router answers with that router\'s auth gate (401 envelope), and 404 envelope once authenticated - never HTML either way', async () => {
    // requireAuth runs before route matching inside the router, so an unauthenticated caller
    // cannot probe which subpaths exist. Both bodies are envelopes; neither is HTML.
    const anon = await api('/api/v1/memories/deep/unknown/path');
    expect(anon.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await anon.json()).success).toBe(true);

    await users.insert({ _id: 'u2', username: 'u2', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true });
    setActivation('u2', { active: true, billingLocked: false });
    const { token } = await login('u2', 'pw123456', false, deps);
    const res = await authed('/api/v1/memories/deep/unknown/path', token);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain('Cannot ');
    expect(ErrorEnvelope.safeParse(JSON.parse(text)).success).toBe(true);
  });

  it('an AUTHENTICATED caller on an unmounted /api/v1 path also gets the envelope', async () => {
    await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true });
    setActivation('u1', { active: true, billingLocked: false });
    const { token } = await login('u1', 'pw123456', false, deps);
    const res = await authed('/api/v1/definitely-not-mounted', token);
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it('does NOT swallow the non-v1 /api surfaces: /api/design-tokens.css still serves CSS', async () => {
    const res = await api('/api/design-tokens.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('css');
  });

  it('does NOT hijack a MOUNTED /api/v1 route: an unauthenticated call still gets its 401 envelope, not 404', async () => {
    const res = await api('/api/v1/memories');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });
});
