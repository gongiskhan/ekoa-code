/**
 * H1 HIGH-2 — the OTHER app build/edit vectors are capability-gated (app-type-aware), exercised
 * through the REAL artifacts router over mongo-mem. The heavy service calls (import/fork/
 * bundle-update) are mocked so no real build runs: the gate lives in the route AFTER the ownership
 * check but BEFORE the service, so a refusal means the service was never reached, and a proceed
 * means it was.
 *
 * The gap this closes: a plain `user` OWNS the artifacts they create, so `writable()` passes and —
 * pre-fix — they could change app CODE without ever touching POST /jobs (bundle-update, PUT file,
 * version restore, backend toggle/sample-run, app-data snapshot/restore) or mint apps (import,
 * fork-of-app). The gate is app-type-aware: NON-app artifacts a user may still manage.
 *
 * Matrix:
 *  - a `user` who OWNS an APP is refused 403 canEditApps on every in-place app-edit vector, and
 *    403 canBuildApps on import / fork-of-app (the service is never called).
 *  - an org-admin proceeds (service mocked → 2xx).
 *  - a `user` forking a NON-app artifact they own is NOT refused (canCreateArtifacts preserved).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { ErrorEnvelope } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, artifacts } from '../../src/data/stores.js';
import { setActivation } from '../../src/data/activation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';

// Mock ONLY the two heavy services a 2xx path actually reaches (the gate short-circuits the 403
// paths before any service). Factory-only mocks so the real modules' esbuild/git machinery never
// loads. `artifactView` is applied to the import/update results, so they carry the view fields.
const { importMock, updateMock, forkMock } = vi.hoisted(() => ({
  importMock: vi.fn(),
  updateMock: vi.fn(),
  forkMock: vi.fn(),
}));
vi.mock('../../src/apps/artifact-bundle.js', () => ({
  exportArtifact: vi.fn(async () => ({ manifestId: 'x', files: [] })),
  importArtifact: importMock,
  updateArtifactFromBundle: updateMock,
  ManifestIdMismatchError: class extends Error {},
}));
vi.mock('../../src/apps/artifact-fork.js', () => ({ forkArtifact: forkMock }));

// Imported after the mocks are declared (vi.mock is hoisted above imports by vitest).
import { artifactsRouter } from '../../src/routes/artifacts.js';

let mem: MongoMemoryServer; let server: Server; let port: number; let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const api = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });

async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'user', orgId: string) {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (id: string) => (await login(id, 'pw123456', false, deps)).token;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_artifacts_capability');
  await mkUser('userA', 'user', 'orgA');      // plain member — owns the artifacts below
  await mkUser('adminA', 'org-admin', 'orgA'); // same-org admin — has canBuildApps + canEditApps
  // An APP (built code sandbox: data.projectDir present) owned by userA, and one owned by adminA.
  // A NON-app artifact (bare record, no projectDir) owned by userA. isAppArtifact reads the data
  // bag only — no on-disk dir is needed because every service touching disk is mocked.
  await artifacts.insert({ _id: 'app-userA', userId: 'userA', orgId: 'orgA', visibility: 'private', name: 'App U', status: 'active', data: { projectDir: '/sbx/user-userA/app-userA' } } as never);
  await artifacts.insert({ _id: 'app-adminA', userId: 'adminA', orgId: 'orgA', visibility: 'private', name: 'App A', status: 'active', data: { projectDir: '/sbx/user-adminA/app-adminA' } } as never);
  await artifacts.insert({ _id: 'plain-userA', userId: 'userA', orgId: 'orgA', visibility: 'private', name: 'Plain U', status: 'draft', data: {} } as never);
  const app = express(); app.use(express.json()); app.use('/api/v1/artifacts', artifactsRouter(deps));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

beforeEach(() => {
  importMock.mockReset().mockResolvedValue({ _id: 'imported1', name: 'Imported', slug: 'imported1', userId: 'adminA', orgId: 'orgA', visibility: 'private', status: 'active' });
  updateMock.mockReset().mockImplementation(async (art: { _id: string; name: string }) => ({ artifact: { _id: art._id, name: art.name, slug: 'app', userId: 'adminA', orgId: 'orgA', visibility: 'private', status: 'active' }, safetyNetSnapshotId: 'snap1', preUpdateVersionId: 'v1' }));
  forkMock.mockReset().mockResolvedValue({ artifact: { _id: 'fork1', slug: 'fork-1' } });
});

/** Assert a response is a 403 FORBIDDEN envelope carrying the expected capability. */
async function expect403(res: Response, capability: string): Promise<void> {
  expect(res.status).toBe(403);
  const body = (await res.json()) as { error: { code: string; details?: { capability?: string } } };
  expect(ErrorEnvelope.safeParse(body).success).toBe(true);
  expect(body.error.code).toBe('FORBIDDEN');
  expect(body.error.details?.capability).toBe(capability);
}

describe('HIGH-2 — in-place app-edit vectors require canEditApps (a user owning the app is refused)', () => {
  const bundleBody = JSON.stringify({ bundle: { manifestId: 'app-userA', files: [{ path: 'index.html', content: '<html>x</html>' }] } });
  const editVectors: Array<{ name: string; path: string; method: string; body?: string }> = [
    { name: 'bundle-update', path: '/app-userA/bundle-update', method: 'POST', body: bundleBody },
    { name: 'PUT file', path: '/app-userA/file', method: 'PUT', body: JSON.stringify({ path: 'notes.txt', content: 'x' }) },
    { name: 'version restore', path: '/app-userA/versions/deadbeef/restore', method: 'POST' },
    { name: 'backend enabled', path: '/app-userA/backend/enabled', method: 'PUT', body: JSON.stringify({ enabled: false }) },
    { name: 'backend sample-run', path: '/app-userA/backend/sample-run', method: 'POST', body: JSON.stringify({ entrypoint: 'onEvent', input: {} }) },
    { name: 'backups snapshot', path: '/app-userA/backups', method: 'POST' },
    { name: 'backups restore', path: '/app-userA/backups/restore', method: 'POST', body: JSON.stringify({ pointId: 'p1', source: 'local', at: 'now' }) },
  ];

  for (const v of editVectors) {
    it(`${v.name}: a user who OWNS the app is refused 403 canEditApps`, async () => {
      const res = await api(`/api/v1/artifacts${v.path}`, await tokenFor('userA'), { method: v.method, ...(v.body ? { body: v.body } : {}) });
      await expect403(res, 'canEditApps');
    });
  }

  it('bundle-update: an org-admin proceeds → 200 (service reached)', async () => {
    const res = await api('/api/v1/artifacts/app-adminA/bundle-update', await tokenFor('adminA'), {
      method: 'POST', body: JSON.stringify({ bundle: { manifestId: 'app-adminA' } }),
    });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});

describe('HIGH-2 — create-and-build vectors require canBuildApps', () => {
  it('import: a user is refused 403 canBuildApps, importArtifact never called', async () => {
    const res = await api('/api/v1/artifacts/import', await tokenFor('userA'), { method: 'POST', body: JSON.stringify({ bundle: { manifestId: 'anything' } }) });
    await expect403(res, 'canBuildApps');
    expect(importMock).not.toHaveBeenCalled();
  });

  it('import: an org-admin proceeds → 201 (importArtifact reached)', async () => {
    const res = await api('/api/v1/artifacts/import', await tokenFor('adminA'), { method: 'POST', body: JSON.stringify({ bundle: { manifestId: 'anything' } }) });
    expect(res.status).toBe(201);
    expect(importMock).toHaveBeenCalledTimes(1);
  });

  it('fork of an APP: a user is refused 403 canBuildApps, forkArtifact never called', async () => {
    const res = await api('/api/v1/artifacts/app-userA/fork', await tokenFor('userA'), { method: 'POST', body: JSON.stringify({ name: 'copy' }) });
    await expect403(res, 'canBuildApps');
    expect(forkMock).not.toHaveBeenCalled();
  });
});

describe('HIGH-2 — non-app artifact management stays with the user (canCreateArtifacts preserved)', () => {
  it('fork of a NON-app artifact the user owns is NOT refused → 201 (forkArtifact reached)', async () => {
    const res = await api('/api/v1/artifacts/plain-userA/fork', await tokenFor('userA'), { method: 'POST', body: JSON.stringify({ name: 'copy' }) });
    expect(res.status).toBe(201);
    expect(forkMock).toHaveBeenCalledTimes(1);
  });
});
