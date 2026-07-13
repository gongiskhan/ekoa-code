import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, activityLogs, credentials as credentialsStore } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { __resetCredentialsForTests, claudeAuthStatus } from '../../src/llm/credentials.js';
import { CredentialSetResponse, ErrorEnvelope } from '@ekoa/shared';

/**
 * F2 (a): the model-credential provisioning surface (ch06 §6.2). Super-admin-only,
 * WRITE-ONLY (no read surface, secret never echoed), audit-logged as `credential.set`.
 * Every response validates against its named shared/ schema; every non-2xx against
 * the error envelope.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: 'orgA', active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const jwtApi = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

const SECRET = 'sk-test-model-secret-do-not-echo';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_credentials');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests(); __resetCredentialsForTests();
  for (const s of [users, activityLogs, credentialsStore]) await s.deleteMany({});
});

describe('POST /api/v1/credentials (super-admin, write-only, audit-logged)', () => {
  it('sets the credential, flips claudeAuth.configured, never echoes the secret, writes credential.set audit row', async () => {
    await mkUser('root', 'super-admin');
    const t = await tokenFor('root');
    const res = await jwtApi('/api/v1/credentials', t, { method: 'POST', body: JSON.stringify({ mode: 'api-key', secret: SECRET }) });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(CredentialSetResponse.safeParse(body).success).toBe(true);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(claudeAuthStatus()).toMatchObject({ configured: true, mode: 'api-key' });

    // health surface reflects the provisioned credential
    const health = await readJson(await fetch(`http://127.0.0.1:${port}/health`));
    expect((health.claudeAuth as Record<string, unknown>).configured).toBe(true);

    // audit: exactly one credential.set row, no secret material in it
    const rows = await activityLogs.find({});
    const audit = rows.filter((r) => r.category === 'credential' && r.type === 'set');
    expect(audit.length).toBe(1);
    expect(audit[0]!.userId).toBe('root');
    expect(JSON.stringify(audit[0])).not.toContain(SECRET);
  });

  it('non-super-admin gets a 403 error envelope; nothing is stored or audited', async () => {
    await mkUser('bob', 'user');
    const t = await tokenFor('bob');
    const res = await jwtApi('/api/v1/credentials', t, { method: 'POST', body: JSON.stringify({ mode: 'api-key', secret: SECRET }) });
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect(claudeAuthStatus().configured).toBe(false);
    expect((await activityLogs.find({})).filter((r) => r.category === 'credential').length).toBe(0);
  });

  it('unauthenticated gets a 401 error envelope', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/credentials`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'api-key', secret: SECRET }),
    });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('invalid body gets a 400 VALIDATION_FAILED envelope', async () => {
    await mkUser('root', 'super-admin');
    const t = await tokenFor('root');
    const res = await jwtApi('/api/v1/credentials', t, { method: 'POST', body: JSON.stringify({ mode: 'nope', secret: '' }) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('is write-only: GET /api/v1/credentials is not a mounted read surface', async () => {
    await mkUser('root', 'super-admin');
    const t = await tokenFor('root');
    const res = await jwtApi('/api/v1/credentials', t);
    expect(res.status).toBe(404);
    expect((await res.text())).not.toContain(SECRET);
  });
});
