/**
 * H1 build-authorization gate + the follow-up-build IDOR fix (map §5.1), exercised through the
 * REAL jobs router over mongo-mem. The build EXECUTOR is mocked (`handleBuildCreate`) so no real
 * build runs: the gate lives entirely in the route BEFORE the executor, so a refusal means the
 * executor was never called, and a proceed means it was called with the expected args.
 *
 * Matrix under test:
 *  - first build: a `user` (no canBuildApps) is refused 403; an org-admin proceeds.
 *  - follow-up (artifactId): requires canEditApps AND writability. A `user` is refused on the
 *    capability (before any ownership probe — no existence leak). An org-admin who is not the
 *    owner of a PRIVATE target is refused 403 (the IDOR: previously any user could drive an agent
 *    against ANY artifact by id). A cross-org target is 404. An org-shared same-org target — and
 *    the actor's OWN app — proceed.
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

// Mock the build executor entry. The route's capability/ownership gate runs BEFORE this is called,
// so its call-count is the ground truth for "was the request authorized".
const { handleBuildCreateMock } = vi.hoisted(() => ({ handleBuildCreateMock: vi.fn() }));
vi.mock('../../src/agents/index.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/agents/index.js')>();
  return { ...actual, handleBuildCreate: handleBuildCreateMock };
});

// Imported after the mock is declared (vi.mock is hoisted above imports by vitest).
import { jobsRouter } from '../../src/routes/jobs.js';

let mem: MongoMemoryServer; let server: Server; let port: number; let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const api = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });

async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'user', orgId: string) {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (id: string) => (await login(id, 'pw123456', false, deps)).token;
const build = (extra: Record<string, unknown> = {}) => JSON.stringify({ kind: 'build', description: 'change it', sessionId: 's1', language: 'pt', ...extra });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_jobs_capability');
  await mkUser('userA', 'user', 'orgA');       // plain member, owns the artifacts below
  await mkUser('adminA', 'org-admin', 'orgA');  // same-org admin (has canEditApps)
  await mkUser('adminB', 'org-admin', 'orgB');  // other-org admin
  // userA's apps in orgA: one private, one org-shared. adminA owns a private app of its own.
  await artifacts.insert({ _id: 'artA-priv', userId: 'userA', orgId: 'orgA', visibility: 'private', name: 'A priv' } as never);
  await artifacts.insert({ _id: 'artA-shared', userId: 'userA', orgId: 'orgA', visibility: 'org', name: 'A shared' } as never);
  await artifacts.insert({ _id: 'artAdminA-priv', userId: 'adminA', orgId: 'orgA', visibility: 'private', name: 'adminA priv' } as never);
  const app = express(); app.use(express.json()); app.use('/api/v1/jobs', jobsRouter(deps));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

beforeEach(() => {
  handleBuildCreateMock.mockReset();
  handleBuildCreateMock.mockResolvedValue({ status: 'created', job: { id: 'jX', status: 'running', createdAt: 'x' }, fire: () => {} });
});

describe('POST /jobs — first-build capability gate (canBuildApps)', () => {
  it('a user (no canBuildApps) is refused 403 FORBIDDEN + details.capability, executor never called', async () => {
    const res = await api('/api/v1/jobs', await tokenFor('userA'), { method: 'POST', body: build() });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; details?: { capability?: string } } };
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.details?.capability).toBe('canBuildApps');
    expect(handleBuildCreateMock).not.toHaveBeenCalled();
  });

  it('an org-admin proceeds → 202, executor called with no artifactId', async () => {
    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build() });
    expect(res.status).toBe(202);
    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBeUndefined();
  });
});

describe('POST /jobs — follow-up build gate (canEditApps + writability, IDOR fix)', () => {
  it('a user (no canEditApps) is refused on the capability BEFORE any ownership probe → 403 canEditApps', async () => {
    const res = await api('/api/v1/jobs', await tokenFor('userA'), { method: 'POST', body: build({ artifactId: 'artA-shared' }) });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; details?: { capability?: string } } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.details?.capability).toBe('canEditApps');
    expect(handleBuildCreateMock).not.toHaveBeenCalled();
  });

  it("an org-admin targeting ANOTHER user's PRIVATE app in-org is refused 403 (the IDOR) — an ownership denial, no capability field, executor never called", async () => {
    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build({ artifactId: 'artA-priv' }) });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; details?: { capability?: string } } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.details?.capability).toBeUndefined(); // ownership denial, not a capability refusal
    expect(handleBuildCreateMock).not.toHaveBeenCalled();
  });

  it('a cross-org target is a uniform 404, executor never called', async () => {
    const res = await api('/api/v1/jobs', await tokenFor('adminB'), { method: 'POST', body: build({ artifactId: 'artA-shared' }) });
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    expect(handleBuildCreateMock).not.toHaveBeenCalled();
  });

  it('an org-admin editing an ORG-SHARED same-org app proceeds → 202, executor called with the artifactId', async () => {
    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build({ artifactId: 'artA-shared' }) });
    expect(res.status).toBe(202);
    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBe('artA-shared');
  });

  it('an org-admin editing its OWN private app proceeds → 202 (own always)', async () => {
    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build({ artifactId: 'artAdminA-priv' }) });
    expect(res.status).toBe(202);
    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBe('artAdminA-priv');
  });
});
