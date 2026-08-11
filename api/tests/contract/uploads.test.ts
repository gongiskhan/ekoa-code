import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { resolveUpload } from '../../src/uploads/service.js';
import { UploadResult, ErrorEnvelope } from '@ekoa/shared';

/**
 * WS4a contract: POST /api/v1/uploads (`shared/src/uploads.ts`), the composer's staging endpoint.
 * Same raw-body-plus-header protocol as routes/knowledge.ts's /uploads sub-route (X-Filename
 * required, X-Folder optional). This endpoint was DECLARED but never MOUNTED - every attach
 * silently 404'd (mount-coverage.test.ts's DESCOPED set, now shrunk). `auth: 'user'` in the
 * descriptor - platform session only, no gateway-key admission.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number; let dir: string;
const deps = { now: () => 1_700_000_000_000 + seq, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

async function mkUser(id: string, orgId: string) {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'user', orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const upload = (t: string, filename: string, body: string, extraHeaders: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}/api/v1/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${t}`, 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(filename), ...extraHeaders },
    body,
  });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_uploads_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  dir = await mkdtemp(join(tmpdir(), 'ekoa-uploads-'));
  process.env.EKOA_DATA_DIR = dir;
  await users.deleteMany({});
});

describe('POST /api/v1/uploads (WS4a)', () => {
  it('stages a single file: 201, UploadResult-shaped, no folderRoot', async () => {
    await mkUser('u1', 'orgA');
    const t = await tokenFor('u1');
    const res = await upload(t, 'nota de anexo.txt', 'conteudo do anexo');
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(UploadResult.safeParse(body).success).toBe(true);
    const parsed = body as { uploadId: string; displayName: string; size: number; folderRoot?: string };
    expect(parsed.displayName).toBe('nota de anexo.txt');
    expect(parsed.size).toBe(Buffer.byteLength('conteudo do anexo'));
    expect(parsed.folderRoot).toBeUndefined();

    // The staged blob is readable back through the service the agent run class uses -
    // the actual mechanism a chat run relies on (no GET endpoint exists to prove this over HTTP).
    const resolved = await resolveUpload('u1', parsed.uploadId);
    expect(resolved?.displayName).toBe('nota de anexo.txt');
  });

  it('rejects an upload with no X-Filename (400 envelope)', async () => {
    await mkUser('u1', 'orgA');
    const t = await tokenFor('u1');
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/octet-stream' },
      body: 'x',
    });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it('refuses an unauthenticated upload (401 envelope, never a bare 404/500)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-filename': 'x.txt' },
      body: 'x',
    });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it('groups a folder batch under ONE stable folderRoot, preserving relative paths', async () => {
    await mkUser('u1', 'orgA');
    const t = await tokenFor('u1');
    const folder = 'dir-abc123-Contrato';
    const a = await upload(t, 'capa.txt', 'capa', { 'x-folder': folder });
    const b = await upload(t, 'anexos/clausulas.txt', 'clausulas', { 'x-folder': folder });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const aBody = (await a.json()) as { folderRoot?: string };
    const bBody = (await b.json()) as { folderRoot?: string };
    expect(aBody.folderRoot).toBeTruthy();
    expect(bBody.folderRoot).toBe(aBody.folderRoot); // same batch -> same root
  });

  it("userB cannot resolve userA's uploadId (per-user isolation, not org-shared)", async () => {
    await mkUser('u1', 'orgA');
    await mkUser('u2', 'orgA'); // SAME org - isolation is per-USER, not per-org, for attachments
    const t1 = await tokenFor('u1');
    const res = await upload(t1, 'privado.txt', 'segredo');
    const { uploadId } = (await res.json()) as { uploadId: string };
    expect(await resolveUpload('u2', uploadId)).toBeNull();
    expect(await resolveUpload('u1', uploadId)).not.toBeNull();
  });

  it('resolveUpload rejects a path-traversal id instead of escaping the per-user directory', async () => {
    await mkUser('u1', 'orgA');
    expect(await resolveUpload('u1', '../u2/secret')).toBeNull();
    expect(await resolveUpload('u1', '..')).toBeNull();
  });
});
