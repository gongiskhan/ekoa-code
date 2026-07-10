import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { users, artifacts, slugs, jobs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { appRegistry } from '../../src/apps/app-registry.js';
import { __resetSlugIndexForTests } from '../../src/apps/slug-index.js';
import { __resetAppHealthDedupeForTests } from '../../src/apps/serving.js';
import { Job } from '@ekoa/shared';

/**
 * F7 (batch-final s5): a FAILED build must serve an honest failed-state page — not a scaffold
 * shell, not a "Building…" spinner forever — and the persisted terminal error must reach the wire
 * via jobView. A failed REBUILD over a previously-good app keeps serving the old dist (stale-good
 * wins).
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number; let tmpRoot: string;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

/** Register a real on-disk SCAFFOLD dist for an artifact (as a failed build would leave). */
async function mkScaffoldDist(id: string): Promise<void> {
  const projectDir = join(tmpRoot, id);
  await mkdir(join(projectDir, 'dist'), { recursive: true });
  await writeFile(join(projectDir, 'manifest.json'), JSON.stringify({ id, name: id, type: 'react-app' }));
  await writeFile(join(projectDir, 'dist', 'index.html'), '<!DOCTYPE html><html><head><title>scaffold</title></head><body><div id="scaffold-root"></div><script src="bundle.js"></script></body></html>');
  await writeFile(join(projectDir, 'dist', 'bundle.js'), '/* scaffold */');
  await appRegistry.register(id, projectDir, 'owner1', id);
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_build_failure');
  tmpRoot = await mkdtemp(join(tmpdir(), 'ekoa-bf-'));
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
  await users.insert({ _id: 'owner1', username: 'owner1', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'orgA', active: true });
  setActivation('owner1', { active: true, billingLocked: false });
}, 60_000);
afterAll(async () => { server.close(); await appRegistry.stop(); await closeMongo(); await mem.stop(); await rm(tmpRoot, { recursive: true, force: true }); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests(); __resetSlugIndexForTests(); __resetAppHealthDedupeForTests();
  await appRegistry.stop();
  await artifacts.deleteMany({}); await slugs.deleteMany({}); await jobs.deleteMany({});
  await getDb().collection('app_data').deleteMany({});
  setActivation('owner1', { active: true, billingLocked: false });
});

describe('F7: failed build serves an honest failed-state page + jobView.error on the wire', () => {
  it('GET /jobs/:id surfaces the persisted terminal error (Job.error) for a failed job', async () => {
    await jobs.put({ _id: 'jobF', kind: 'build', status: 'failed', userId: 'owner1', artifactId: 'artF', request: { description: 'x', language: 'pt' }, error: { code: 'BUILD_UNFULFILLED', message: 'A construção falhou.' }, createdAt: 'x' } as never);
    const t = await tokenFor('owner1');
    const res = await api('/api/v1/jobs/jobF', { headers: { authorization: `Bearer ${t}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Job.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect((body.error as { code?: string })?.code).toBe('BUILD_UNFULFILLED'); // honest cause via the code
    // the wire message is a SAFE generic (never the raw persisted message, which can carry a
    // model-derived note with PII — Codex checkpoint finding)
    expect((body.error as { message?: string })?.message).toBe('A construção não produziu a aplicação pedida.');
  });

  it('a VERIFY_FAILED job never leaks the verifier note (which can carry PII) on the wire', async () => {
    // the persisted message embeds a model-derived note; jobView must return only a safe generic.
    await jobs.put({ _id: 'jobV', kind: 'build', status: 'failed', userId: 'owner1', artifactId: 'artV', request: { description: 'x', language: 'pt' }, error: { code: 'VERIFY_FAILED', message: 'A verificação falhou. Campo para PT50000201231234567895417 em falta.' }, createdAt: 'x' } as never);
    const t = await tokenFor('owner1');
    const body = (await (await api('/api/v1/jobs/jobV', { headers: { authorization: `Bearer ${t}` } })).json()) as Record<string, unknown>;
    expect((body.error as { code?: string })?.code).toBe('VERIFY_FAILED');
    expect((body.error as { message?: string })?.message).toBe('A verificação da aplicação falhou.');
    expect(JSON.stringify(body)).not.toContain('PT50000201231234567895417'); // the IBAN never reaches the wire
  });

  it('a failed build with a registered SCAFFOLD dist serves the honest failed page, NOT the scaffold shell', async () => {
    await artifacts.insert({ _id: 'artScaffold', name: 'App', slug: 'artScaffold', userId: 'owner1', orgId: 'orgA', status: 'draft', shareable: true } as never);
    await mkScaffoldDist('artScaffold');
    await jobs.put({ _id: 'j1', kind: 'build', status: 'failed', userId: 'owner1', artifactId: 'artScaffold', request: { description: 'x', language: 'pt' }, error: { code: 'VERIFY_FAILED', message: 'A verificação falhou.' }, createdAt: '2024-01-01' } as never);
    const res = await api('/apps/artScaffold/');
    const html = await res.text();
    expect(html).toContain('A construção falhou'); // the honest failed page
    expect(html).not.toContain('scaffold-root'); // NOT the scaffold shell
    expect(html).not.toContain('bundle.js'); // no dead bundle reference
    expect(html).not.toContain('location.reload'); // no auto-refresh loop
  });

  it('a failed build with NO dist shows the failed page, not "Building…" forever', async () => {
    await artifacts.insert({ _id: 'artNoDist', name: 'App', slug: 'artNoDist', userId: 'owner1', orgId: 'orgA', status: 'draft', shareable: true } as never);
    await jobs.put({ _id: 'j2', kind: 'build', status: 'failed', userId: 'owner1', artifactId: 'artNoDist', request: { description: 'x', language: 'pt' }, error: { code: 'BUILD_UNFULFILLED', message: 'x' }, createdAt: '2024-01-01' } as never);
    const res = await api('/apps/artNoDist/');
    const html = await res.text();
    expect(html).toContain('A construção falhou');
    expect(html).not.toContain('Building'); // not the mid-build spinner
  });

  it('a failed REBUILD over a previously-COMPLETED build keeps serving the old (good) dist', async () => {
    await artifacts.insert({ _id: 'artGood', name: 'App', slug: 'artGood', userId: 'owner1', orgId: 'orgA', status: 'active', shareable: true } as never);
    // the good dist on disk
    const projectDir = join(tmpRoot, 'artGood');
    await mkdir(join(projectDir, 'dist'), { recursive: true });
    await writeFile(join(projectDir, 'manifest.json'), JSON.stringify({ id: 'artGood', name: 'artGood', type: 'react-app' }));
    await writeFile(join(projectDir, 'dist', 'index.html'), '<!DOCTYPE html><html><head><title>real</title></head><body><div id="root">Pessoa app real</div></body></html>');
    await appRegistry.register('artGood', projectDir, 'owner1', 'artGood');
    // history: an OLD completed build + a NEWER failed rebuild
    await jobs.put({ _id: 'jOk', kind: 'build', status: 'completed', userId: 'owner1', artifactId: 'artGood', request: { description: 'x', language: 'pt' }, createdAt: '2024-01-01' } as never);
    await jobs.put({ _id: 'jFail', kind: 'build', status: 'failed', userId: 'owner1', artifactId: 'artGood', request: { description: 'x', language: 'pt' }, error: { code: 'VERIFY_FAILED', message: 'x' }, createdAt: '2024-02-01' } as never);
    const res = await api('/apps/artGood/');
    const html = await res.text();
    expect(html).toContain('Pessoa app real'); // the old good dist keeps serving (stale-good wins)
    expect(html).not.toContain('A construção falhou');
  });
});
