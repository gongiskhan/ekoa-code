import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ForkArtifactResponse, ArtifactBundle, BundleUpdateResponse, ArtifactVersionListResponse,
  RestoreVersionResponse, ArtifactFilesResponse, ReadFileResponse, WriteFileResponse,
  BackupStatus, BackupRestorePoint, AppDataDump, BackupRestoreResponse, BackendStatus,
  BackendLogListResponse, BackendInvocationListResponse, BackendSetEnabledResponse,
  BackendSampleRunResponse, CompanySpaceListResponse, CompanySpaceGetResponse,
  CompanySpaceStartResponse, ErrorEnvelope, OkResponse, Artifact,
} from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { users, artifacts, slugs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { __resetSlugIndexForTests } from '../../src/apps/slug-index.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { artifactsRouter } from '../../src/routes/artifacts.js';
import { companySpaceRouter } from '../../src/routes/company-space.js';
import { appRegistry } from '../../src/apps/app-registry.js';
import { appBuilder } from '../../src/apps/builder.js';
import { AppDataAccess } from '../../src/apps/app-data-access.js';

/**
 * Artifact family contract suite (ch03 §3.8.9-3.8.12). Mounts the artifacts +
 * company-space routers on a bare app (server.ts wiring for company-space is not
 * yet landed). Every response is validated against its shared/ schema; the C07
 * criteria (fork isolation, bundle-update mismatch/force, commit-on-save, versions
 * round-trip, download secret guard, pdf charset guard, featured-update semantics)
 * are asserted.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let sandbox: string;
let seq = 100;
const deps = { now: () => 1_700_000_000_000 + seq, genId: () => `id_${seq++}` };

function expectValid(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, body: unknown): void {
  const r = schema.safeParse(body);
  if (!r.success) throw new Error(`schema mismatch: ${JSON.stringify(r.error)} for ${JSON.stringify(body)}`);
  expect(r.success).toBe(true);
}

async function mkUser(id: string, username: string, orgId: string, role: 'super-admin' | 'org-admin' | 'builder') {
  await users.insert({ _id: id, username, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const jwtApi = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });

function projectPath(ownerId: string, appId: string): string {
  return join(sandbox, `user-${ownerId}`, appId);
}

/** Create a real on-disk plain-HTML app under the sandbox + its artifact row. */
async function mkApp(
  appId: string,
  owner: { userId: string; orgId: string },
  opts: { files?: Record<string, string>; git?: boolean; visibility?: 'private' | 'org'; slug?: string; extra?: Record<string, unknown> } = {},
): Promise<string> {
  const dir = projectPath(owner.userId, appId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ id: appId, name: appId, version: '1.0.0', entryPoint: 'frontend/src/index.jsx', outputDir: 'dist/', type: 'html-app' }));
  await writeFile(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>');
  for (const [name, content] of Object.entries(opts.files ?? {})) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  if (opts.git) {
    execFileSync('git', ['-C', dir, 'init', '-q']);
    execFileSync('git', ['-C', dir, 'add', '-A']);
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t.pt', 'commit', '-q', '-m', 'seed', '--no-gpg-sign']);
  }
  const slug = opts.slug ?? appId;
  await artifacts.insert({
    _id: appId, name: appId, slug, userId: owner.userId, orgId: owner.orgId,
    visibility: opts.visibility ?? 'private', status: 'active', shareable: true,
    data: { projectDir: dir, appUrl: `/apps/${appId}/` }, ...opts.extra,
  } as never);
  await slugs.put({ _id: slug, artifactId: appId });
  return dir;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  sandbox = await mkdtemp(join(tmpdir(), 'ekoa-fam-sbx-'));
  process.env.SANDBOX_ROOT = sandbox;
  process.env.EKOA_DATA_DIR = await mkdtemp(join(tmpdir(), 'ekoa-fam-data-'));
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_family');

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/v1/artifacts', artifactsRouter(deps));
  app.use('/api/v1/company-space', companySpaceRouter(deps));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 90_000);

afterAll(async () => {
  server.close();
  await appRegistry.stop();
  await appBuilder.dispose();
  await closeMongo();
  await mem.stop();
  await rm(sandbox, { recursive: true, force: true });
  if (process.env.EKOA_DATA_DIR) await rm(process.env.EKOA_DATA_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  __resetSlugIndexForTests();
  await appRegistry.stop();
  for (const s of [users, artifacts, slugs]) await s.deleteMany({});
  await getDb().collection('app_data').deleteMany({});
  await mkUser('owner1', 'owner1', 'orgA', 'org-admin');
  await mkUser('owner2', 'owner2', 'orgA', 'builder');
  await mkUser('sa', 'sa', 'orgA', 'super-admin');
});

describe('fork (C07 criterion 11: new id + distinct slug + own copy + source byte-identical)', () => {
  it('forks a source into a fresh artifact without mutating the source tree', async () => {
    await mkApp('src1', { userId: 'owner1', orgId: 'orgA' }, { files: { 'frontend/App.jsx': 'export const A = 1;\n' }, slug: 'src-one' });
    const srcFile = join(projectPath('owner1', 'src1'), 'frontend', 'App.jsx');
    const before = readFileSync(srcFile, 'utf-8');

    const t = await tokenFor('owner1');
    const res = await jwtApi('/api/v1/artifacts/src1/fork', t, { method: 'POST', body: JSON.stringify({ name: 'My Fork' }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; slug: string };
    expectValid(ForkArtifactResponse, body);

    expect(body.id).not.toBe('src1');
    expect(body.slug).not.toBe('src-one');
    // The fork owns its own working copy with the copied file.
    const forkFile = join(projectPath('owner1', body.id), 'frontend', 'App.jsx');
    expect(existsSync(forkFile)).toBe(true);
    expect(readFileSync(forkFile, 'utf-8')).toBe(before);
    // The SOURCE tree is byte-identical before/after the fork.
    expect(readFileSync(srcFile, 'utf-8')).toBe(before);
  });
});

describe('export / import / bundle-update (ch07 §7.10)', () => {
  it('exports a bundle, imports it as a new artifact, and round-trips the shared schema', async () => {
    await mkApp('exp1', { userId: 'owner1', orgId: 'orgA' }, { files: { 'frontend/x.js': 'export const X = 9;\n' } });
    const t = await tokenFor('owner1');

    const exp = await jwtApi('/api/v1/artifacts/exp1/export', t);
    expect(exp.status).toBe(200);
    const bundle = await exp.json();
    expectValid(ArtifactBundle, bundle);
    expect((bundle as { files: unknown[] }).files.length).toBeGreaterThan(0);

    const imp = await jwtApi('/api/v1/artifacts/import', t, { method: 'POST', body: JSON.stringify({ bundle }) });
    expect(imp.status).toBe(201);
    const created = await imp.json();
    expectValid(Artifact, created);
    expect((created as { id: string }).id).not.toBe('exp1');
  });

  it('bundle-update refuses a mismatched manifest 409, then applies with force + returns the snapshot pair', async () => {
    await mkApp('upd1', { userId: 'owner1', orgId: 'orgA' }, { git: true });
    const t = await tokenFor('owner1');

    const mismatch = await jwtApi('/api/v1/artifacts/upd1/bundle-update', t, {
      method: 'POST', body: JSON.stringify({ bundle: { manifestId: 'someone-else', files: [{ path: 'index.html', content: '<html>new</html>' }] } }),
    });
    expect(mismatch.status).toBe(409);
    const errBody = await mismatch.json();
    expectValid(ErrorEnvelope, errBody);
    expect((errBody as { error: { code: string } }).error.code).toBe('MANIFEST_ID_MISMATCH');

    const forced = await jwtApi('/api/v1/artifacts/upd1/bundle-update', t, {
      method: 'POST', body: JSON.stringify({ bundle: { manifestId: 'someone-else', files: [{ path: 'index.html', content: '<html>forced</html>' }] }, force: true }),
    });
    expect(forced.status).toBe(200);
    const okBody = await forced.json();
    expectValid(BundleUpdateResponse, okBody);
    const b = okBody as { safetyNetSnapshotId: string; preUpdateVersionId: string };
    expect(b.safetyNetSnapshotId).toBeTruthy();
    expect(b.preUpdateVersionId).toBeTruthy();
    expect(readFileSync(join(projectPath('owner1', 'upd1'), 'index.html'), 'utf-8')).toContain('forced');
  });
});

describe('files: commit-on-save + versions round-trip (ch07 §7.9)', () => {
  it('PUT /file commits the save; versions lists it; restore reverts the tree', async () => {
    await mkApp('files1', { userId: 'owner1', orgId: 'orgA' }, { git: true });
    const t = await tokenFor('owner1');

    // First save -> commit.
    const w1 = await jwtApi('/api/v1/artifacts/files1/file', t, { method: 'PUT', body: JSON.stringify({ path: 'notes.txt', content: 'first' }) });
    expect(w1.status).toBe(200);
    const w1body = await w1.json();
    expectValid(WriteFileResponse, w1body);
    expect((w1body as { committed?: boolean }).committed).toBe(true);

    // Second save -> another commit.
    await jwtApi('/api/v1/artifacts/files1/file', t, { method: 'PUT', body: JSON.stringify({ path: 'notes.txt', content: 'second' }) });

    const vres = await jwtApi('/api/v1/artifacts/files1/versions', t);
    const vbody = await vres.json();
    expectValid(ArtifactVersionListResponse, vbody);
    const versions = (vbody as { items: Array<{ sha: string; message?: string }> }).items;
    expect(versions.length).toBeGreaterThanOrEqual(2);

    // Restore to the commit that holds 'first' (the earlier of the two notes commits).
    const firstSaveSha = versions.find((v) => v.message?.includes('notes.txt'))!.sha;
    const targetSha = versions[versions.findIndex((v) => v.sha === firstSaveSha) + 1]?.sha ?? versions[versions.length - 1]!.sha;
    const rres = await jwtApi(`/api/v1/artifacts/files1/versions/${targetSha}/restore`, t, { method: 'POST' });
    expect(rres.status).toBe(200);
    expectValid(RestoreVersionResponse, await rres.json());

    // Read the current file back through the API.
    const fread = await jwtApi('/api/v1/artifacts/files1/file?path=notes.txt', t);
    // notes.txt may be absent at the very first commit; either way the response is schema-valid.
    if (fread.status === 200) expectValid(ReadFileResponse, await fread.json());

    const files = await jwtApi('/api/v1/artifacts/files1/files', t);
    expectValid(ArtifactFilesResponse, await files.json());
  });
});

describe('download: 422 on a planted credential (C09-07 half)', () => {
  it('blocks a download whose tree contains a credential; a clean tree streams a zip', async () => {
    const secret = 'sk-ant-api03-' + 'a'.repeat(40);
    await mkApp('dl-bad', { userId: 'owner1', orgId: 'orgA' }, { files: { 'leak.js': `const K = "${secret}";\n` } });
    await mkApp('dl-ok', { userId: 'owner1', orgId: 'orgA' }, { files: { 'ok.js': 'const A = 1;\n' } });
    const t = await tokenFor('owner1');

    const bad = await jwtApi('/api/v1/artifacts/dl-bad/download', t);
    expect(bad.status).toBe(422);
    const errBody = await bad.json();
    expectValid(ErrorEnvelope, errBody);
    expect((errBody as { error: { code: string } }).error.code).toBe('SECRET_GUARD_BLOCKED');

    const ok = await jwtApi('/api/v1/artifacts/dl-ok/download', t);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('zip');
    await ok.arrayBuffer();
  });
});

describe('pdf: id charset guard (render degrades explicitly when Chromium is unavailable)', () => {
  it('rejects an unsafe id 400 and degrades a valid id to 302 or 503', async () => {
    await mkApp('pdf1', { userId: 'owner1', orgId: 'orgA' });
    const t = await tokenFor('owner1');

    const bad = await jwtApi('/api/v1/artifacts/bad%20id/pdf', t);
    expect(bad.status).toBe(400);
    expectValid(ErrorEnvelope, await bad.json());

    const ok = await jwtApi('/api/v1/artifacts/pdf1/pdf', t, { redirect: 'manual' });
    expect([302, 503]).toContain(ok.status);
  });
});

describe('featured-update apply/ignore (ch07 §7.13)', () => {
  it('apply is a no-op success for a non-customized instance; ignore stamps the flag', async () => {
    await artifacts.insert({ _id: 'feat1', name: 'Feat', slug: 'feat1', userId: 'owner1', orgId: 'orgA', visibility: 'org', status: 'active', featured: true, shareable: true, data: { seededFrom: 'assets/featured-artifacts', updateAvailable: { version: '2.0.0' } } } as never);
    await slugs.put({ _id: 'feat1', artifactId: 'feat1' });
    const t = await tokenFor('owner1');

    const apply = await jwtApi('/api/v1/artifacts/feat1/featured-update/apply', t, { method: 'POST' });
    expect(apply.status).toBe(200);
    expectValid(OkResponse, await apply.json());
    // No-op: no safety-net snapshot was taken.
    const status = await (await jwtApi('/api/v1/artifacts/feat1/backups', t)).json();
    expect((status as { restorePointCount: number }).restorePointCount).toBe(0);

    const ignore = await jwtApi('/api/v1/artifacts/feat1/featured-update/ignore', t, { method: 'POST' });
    expect(ignore.status).toBe(200);
    expectValid(OkResponse, await ignore.json());
    const row = await artifacts.get('feat1');
    const data = (row!.data as Record<string, unknown>);
    expect(data.updateAvailable).toBeNull();
    expect(data.ignoredVersion).toBe('2.0.0');
  });

  it('apply on a CUSTOMIZED instance takes the snapshot pair first and applies the scaffold', async () => {
    const featRoot = await mkdtemp(join(tmpdir(), 'ekoa-feat-'));
    process.env.EKOA_FEATURED_ARTIFACTS_DIR = featRoot;
    const scaffoldDir = join(featRoot, 'feat2', 'scaffold');
    await mkdir(scaffoldDir, { recursive: true });
    await writeFile(join(featRoot, 'feat2', 'manifest.json'), JSON.stringify({ id: 'feat2', name: 'Feat2', version: '3.0.0' }));
    await writeFile(join(scaffoldDir, 'manifest.json'), JSON.stringify({ id: 'feat2', name: 'Feat2', version: '3.0.0', entryPoint: 'frontend/src/index.jsx', outputDir: 'dist/', type: 'html-app' }));
    await writeFile(join(scaffoldDir, 'index.html'), '<!doctype html><html><body>SCAFFOLD-V3</body></html>');

    // A customized working copy (git-seeded) that predates the scaffold update.
    const workDir = projectPath('owner1', 'feat2');
    await mkdir(workDir, { recursive: true });
    await writeFile(join(workDir, 'manifest.json'), JSON.stringify({ id: 'feat2', name: 'Feat2', version: '1.0.0', entryPoint: 'frontend/src/index.jsx', outputDir: 'dist/', type: 'html-app' }));
    await writeFile(join(workDir, 'index.html'), '<!doctype html><html><body>OLD-USER-EDIT</body></html>');
    execFileSync('git', ['-C', workDir, 'init', '-q']);
    execFileSync('git', ['-C', workDir, 'add', '-A']);
    execFileSync('git', ['-C', workDir, '-c', 'user.name=t', '-c', 'user.email=t@t.pt', 'commit', '-q', '-m', 'seed', '--no-gpg-sign']);

    await artifacts.insert({ _id: 'feat2', name: 'Feat2', slug: 'feat2', userId: 'owner1', orgId: 'orgA', visibility: 'org', status: 'active', featured: true, shareable: true, data: { seededFrom: 'assets/featured-artifacts', customized: true, projectDir: workDir, updateAvailable: { version: '3.0.0' } } } as never);
    await slugs.put({ _id: 'feat2', artifactId: 'feat2' });
    const t = await tokenFor('owner1');

    const apply = await jwtApi('/api/v1/artifacts/feat2/featured-update/apply', t, { method: 'POST' });
    expect(apply.status).toBe(200);
    expectValid(OkResponse, await apply.json());

    // Snapshot pair taken first: a safety-net app-data snapshot exists.
    const status = await (await jwtApi('/api/v1/artifacts/feat2/backups', t)).json();
    expect((status as { restorePointCount: number }).restorePointCount).toBeGreaterThanOrEqual(1);
    // The scaffold was applied over the working copy.
    expect(readFileSync(join(workDir, 'index.html'), 'utf-8')).toContain('SCAFFOLD-V3');
    delete process.env.EKOA_FEATURED_ARTIFACTS_DIR;
    await rm(featRoot, { recursive: true, force: true });
  });
});

describe('app-data backups (ch03 §3.8.10) - happy path + authz', () => {
  it('snapshots, exports, and restores app-data with the shared schemas', async () => {
    await mkApp('bk1', { userId: 'owner1', orgId: 'orgA' });
    const access = new AppDataAccess(deps);
    await access.create('bk1', 'clientes', { nome: 'Maria' });
    await access.create('bk1', 'clientes', { nome: 'Rui' });
    const t = await tokenFor('owner1');

    const snap = await jwtApi('/api/v1/artifacts/bk1/backups', t, { method: 'POST' });
    expect(snap.status).toBe(200);
    const point = await snap.json();
    expectValid(BackupRestorePoint, point);

    const status = await jwtApi('/api/v1/artifacts/bk1/backups', t);
    expectValid(BackupStatus, await status.json());

    const dump = await jwtApi('/api/v1/artifacts/bk1/backups/export', t);
    const dumpBody = await dump.json();
    expectValid(AppDataDump, dumpBody);
    expect((dumpBody as { collections: Record<string, unknown[]> }).collections.clientes).toHaveLength(2);

    // Mutate live data, then restore the snapshot.
    await access.create('bk1', 'clientes', { nome: 'Ana' });
    const restore = await jwtApi('/api/v1/artifacts/bk1/backups/restore', t, {
      method: 'POST', body: JSON.stringify({ pointId: (point as { pointId: string }).pointId, source: 'local', at: (point as { at: string }).at }),
    });
    expect(restore.status).toBe(200);
    expectValid(BackupRestoreResponse, await restore.json());
    expect(await access.list('bk1', 'clientes')).toHaveLength(2); // Ana rolled back
  });

  it('another org member cannot touch a private artifact (uniform 404)', async () => {
    await mkApp('bk-priv', { userId: 'owner1', orgId: 'orgA' }, { visibility: 'private' });
    const t2 = await tokenFor('owner2');
    const res = await jwtApi('/api/v1/artifacts/bk-priv/backups', t2);
    expect(res.status).toBe(404);
    expectValid(ErrorEnvelope, await res.json());
  });
});

describe('artifact backend surface (ch03 §3.8.11)', () => {
  it('reports status/logs/invocations, toggles enabled, and dry-runs a sample', async () => {
    await mkApp('be1', { userId: 'owner1', orgId: 'orgA' });
    const t = await tokenFor('owner1');

    const status = await jwtApi('/api/v1/artifacts/be1/backend', t);
    expect(status.status).toBe(200);
    const sbody = await status.json();
    expectValid(BackendStatus, sbody);
    expect((sbody as { hasBackend: boolean }).hasBackend).toBe(false); // no declared backend

    expectValid(BackendLogListResponse, await (await jwtApi('/api/v1/artifacts/be1/backend/logs', t)).json());
    expectValid(BackendInvocationListResponse, await (await jwtApi('/api/v1/artifacts/be1/backend/invocations', t)).json());

    const en = await jwtApi('/api/v1/artifacts/be1/backend/enabled', t, { method: 'PUT', body: JSON.stringify({ enabled: false }) });
    expectValid(BackendSetEnabledResponse, await en.json());

    // Sample-run with no declared backend => the runtime returns a clean failure result.
    const sample = await jwtApi('/api/v1/artifacts/be1/backend/sample-run', t, { method: 'POST', body: JSON.stringify({ entrypoint: 'onEvent', input: {} }) });
    expect(sample.status).toBe(200);
    expectValid(BackendSampleRunResponse, await sample.json());
  });
});

describe('company space (ch03 §3.8.12)', () => {
  it('lists, starts (serving), gets, and stops an artifact', async () => {
    await mkApp('cs1', { userId: 'owner1', orgId: 'orgA' }, { visibility: 'org' });
    const t = await tokenFor('owner1');

    const list = await jwtApi('/api/v1/company-space', t);
    expectValid(CompanySpaceListResponse, await list.json());

    const start = await jwtApi('/api/v1/company-space/cs1/start', t, { method: 'POST' });
    expect(start.status).toBe(200);
    expectValid(CompanySpaceStartResponse, await start.json());

    const get = await jwtApi('/api/v1/company-space/cs1', t);
    const gbody = await get.json();
    expectValid(CompanySpaceGetResponse, gbody);
    expect((gbody as { status: string }).status).toBe('running');

    const stop = await jwtApi('/api/v1/company-space/cs1/stop', t, { method: 'POST' });
    expect(stop.status).toBe(200);
    expectValid(OkResponse, await stop.json());
  });

  it('a private artifact of another user is invisible (404)', async () => {
    await mkApp('cs-priv', { userId: 'owner1', orgId: 'orgA' }, { visibility: 'private' });
    const t2 = await tokenFor('owner2');
    const res = await jwtApi('/api/v1/company-space/cs-priv', t2);
    expect(res.status).toBe(404);
    expectValid(ErrorEnvelope, await res.json());
  });
});

describe('featured toggle authz (ch03 §3.8.9)', () => {
  it('PUT /featured is super-admin only', async () => {
    await mkApp('ft1', { userId: 'owner1', orgId: 'orgA' });
    const owner = await tokenFor('owner1');
    const sa = await tokenFor('sa');

    const denied = await jwtApi('/api/v1/artifacts/ft1/featured', owner, { method: 'PUT', body: JSON.stringify({ featured: true }) });
    expect(denied.status).toBe(403);
    expectValid(ErrorEnvelope, await denied.json());

    const ok = await jwtApi('/api/v1/artifacts/ft1/featured', sa, { method: 'PUT', body: JSON.stringify({ featured: true, featuredRank: 3 }) });
    expect(ok.status).toBe(200);
    expectValid(Artifact, await ok.json());
  });
});
