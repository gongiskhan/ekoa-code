import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { automationRuns, automations } from '../../src/data/stores.js';
import {
  screenshotPlaneRouter,
  sweepExpiredScreenshots,
  deleteRunScreenshots,
} from '../../src/automation/screenshot-plane.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';

/**
 * SECURITY SUITE — the per-step screenshot plane is authenticated and tenant-scoped (Cofre R-3;
 * invariants I2, I4).
 *
 * These PNGs are screenshots of an AUTHENTICATED session on a client portal. They were served by a
 * bare `express.static` mount with no auth middleware, no tenant check and no expiry, on the
 * recorded rationale that "the unguessable automationId/runId path IS the capability" — a run id
 * that travels in SSE frames, persisted records, logs and the run API.
 */
const AUT = 'aut-1';
const RUN = 'run-1';

let dataDir: string;

function makeApp(claims: { sub: string; orgId: string; role: string } | null) {
  const app = express();
  app.use(
    '/automation-screenshots',
    screenshotPlaneRouter({
      verifyQueryToken: (token) =>
        token && claims
          ? { ok: true as const, claims }
          : { ok: false as const, status: 401, code: 'UNAUTHENTICATED' },
    }),
  );
  return app;
}

describe('screenshot plane authorization', () => {
  beforeAll(() => bootAgentTestDb('ekoa_sec_screenshots'));
  afterAll(shutdownAgentTestDb);

  beforeEach(async () => {
    resetAgentState();
    dataDir = mkdtempSync(join(tmpdir(), 'ekoa-shots-'));
    process.env.EKOA_AUTOMATION_DATA_DIR = dataDir;
    __resetAutomationConfigForTests();
    mkdirSync(join(dataDir, 'automation-runs', AUT, RUN), { recursive: true });
    writeFileSync(join(dataDir, 'automation-runs', AUT, RUN, 'step-0.png'), Buffer.from('PNGDATA'));
    await automations.insert({ _id: AUT, id: AUT, name: 'A', ownerUserId: 'owner-1', steps: [] } as never);
    await automationRuns.insert({
      _id: RUN,
      id: RUN,
      automationId: AUT,
      orgId: 'orgA',
      ownerUserId: 'owner-1',
      startedAt: 'x',
      status: 'completed',
      inputs: {},
      steps: [],
    } as never);
  });

  afterEach(async () => {
    restoreTransport();
    delete process.env.EKOA_AUTOMATION_DATA_DIR;
    __resetAutomationConfigForTests();
    rmSync(dataDir, { recursive: true, force: true });
    await automationRuns.deleteMany({});
    await automations.deleteMany({});
  });

  it('serves the PNG to the owner', async () => {
    const app = makeApp({ sub: 'owner-1', orgId: 'orgA', role: 'user' });
    const res = await request(app).get(`/automation-screenshots/${AUT}/${RUN}/step-0.png?token=t`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toContain('private');
  });

  it('REFUSES an unauthenticated request — the old mount served it to anyone', async () => {
    const app = makeApp(null);
    const res = await request(app).get(`/automation-screenshots/${AUT}/${RUN}/step-0.png`);
    expect(res.status).toBe(401);
    expect(res.text).not.toContain('PNGDATA');
  });

  it('REFUSES a caller from another tenant, and does not confirm the run exists', async () => {
    const app = makeApp({ sub: 'other-user', orgId: 'orgB', role: 'org-admin' });
    const res = await request(app).get(`/automation-screenshots/${AUT}/${RUN}/step-0.png?token=t`);
    // 404 not 403: a 403 would confirm the run's existence to another tenant.
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('PNGDATA');
  });

  it('REFUSES a same-org user who is neither the owner nor an admin', async () => {
    const app = makeApp({ sub: 'colleague', orgId: 'orgA', role: 'user' });
    const res = await request(app).get(`/automation-screenshots/${AUT}/${RUN}/step-0.png?token=t`);
    expect(res.status).toBe(404);
  });

  it('ALLOWS a same-org org-admin', async () => {
    const app = makeApp({ sub: 'boss', orgId: 'orgA', role: 'org-admin' });
    const res = await request(app).get(`/automation-screenshots/${AUT}/${RUN}/step-0.png?token=t`);
    expect(res.status).toBe(200);
  });

  it('REFUSES an unattributable legacy run rather than serving it', async () => {
    await automationRuns.update(RUN, (r) => ({ ...r, orgId: undefined }) as never);
    const app = makeApp({ sub: 'owner-1', orgId: 'orgA', role: 'user' });
    const res = await request(app).get(`/automation-screenshots/${AUT}/${RUN}/step-0.png?token=t`);
    expect(res.status).toBe(404);
  });

  it('REFUSES path traversal out of the screenshot root', async () => {
    const app = makeApp({ sub: 'owner-1', orgId: 'orgA', role: 'user' });
    const res = await request(app).get(
      `/automation-screenshots/${AUT}/${RUN}/${encodeURIComponent('../../../../etc/passwd')}?token=t`,
    );
    expect(res.status).toBe(404);
  });

  it('REFUSES a non-PNG file', async () => {
    writeFileSync(join(dataDir, 'automation-runs', AUT, RUN, 'notes.txt'), 'secret');
    const app = makeApp({ sub: 'owner-1', orgId: 'orgA', role: 'user' });
    const res = await request(app).get(`/automation-screenshots/${AUT}/${RUN}/notes.txt?token=t`);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('secret');
  });

  it('404s for a run id that does not exist', async () => {
    const app = makeApp({ sub: 'owner-1', orgId: 'orgA', role: 'user' });
    const res = await request(app).get(`/automation-screenshots/${AUT}/nope/step-0.png?token=t`);
    expect(res.status).toBe(404);
  });
});

describe('screenshot retention (R-3)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ekoa-retain-'));
    mkdirSync(join(root, 'a1', 'old'), { recursive: true });
    mkdirSync(join(root, 'a1', 'fresh'), { recursive: true });
    writeFileSync(join(root, 'a1', 'old', 'step-0.png'), 'x');
    writeFileSync(join(root, 'a1', 'fresh', 'step-0.png'), 'x');
    const longAgo = new Date('2020-01-01T00:00:00Z');
    utimesSync(join(root, 'a1', 'old'), longAgo, longAgo);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('removes run dirs past the retention window and keeps fresh ones', async () => {
    const { removed, scanned } = await sweepExpiredScreenshots({ retentionDays: 7, root });
    expect(scanned).toBe(2);
    expect(removed).toBe(1);
    expect(existsSync(join(root, 'a1', 'old'))).toBe(false);
    expect(existsSync(join(root, 'a1', 'fresh'))).toBe(true);
  });

  it('is a safe no-op when the tree does not exist', async () => {
    await expect(sweepExpiredScreenshots({ root: join(root, 'missing') })).resolves.toEqual({
      removed: 0,
      scanned: 0,
    });
  });

  it('deleteRunScreenshots erases exactly one run (the erasure-request path)', async () => {
    // deleteRunScreenshots resolves under <dataDir>/automation-runs, so build that real layout.
    const dd = mkdtempSync(join(tmpdir(), 'ekoa-erase-'));
    mkdirSync(join(dd, 'automation-runs', 'a1', 'r1'), { recursive: true });
    mkdirSync(join(dd, 'automation-runs', 'a1', 'r2'), { recursive: true });
    writeFileSync(join(dd, 'automation-runs', 'a1', 'r1', 'step-0.png'), 'x');
    writeFileSync(join(dd, 'automation-runs', 'a1', 'r2', 'step-0.png'), 'x');
    process.env.EKOA_AUTOMATION_DATA_DIR = dd;
    __resetAutomationConfigForTests();
    try {
      await deleteRunScreenshots('a1', 'r1');
      expect(existsSync(join(dd, 'automation-runs', 'a1', 'r1'))).toBe(false);
      expect(existsSync(join(dd, 'automation-runs', 'a1', 'r2'))).toBe(true); // siblings untouched
    } finally {
      delete process.env.EKOA_AUTOMATION_DATA_DIR;
      __resetAutomationConfigForTests();
      rmSync(dd, { recursive: true, force: true });
    }
  });

  it('deleteRunScreenshots cannot be walked out of the screenshot root', async () => {
    const dd = mkdtempSync(join(tmpdir(), 'ekoa-erase-esc-'));
    const victim = mkdtempSync(join(tmpdir(), 'ekoa-victim-'));
    writeFileSync(join(victim, 'keep.txt'), 'important');
    mkdirSync(join(dd, 'automation-runs'), { recursive: true });
    process.env.EKOA_AUTOMATION_DATA_DIR = dd;
    __resetAutomationConfigForTests();
    try {
      await deleteRunScreenshots('..', join('..', '..', victim));
      expect(existsSync(join(victim, 'keep.txt'))).toBe(true);
    } finally {
      delete process.env.EKOA_AUTOMATION_DATA_DIR;
      __resetAutomationConfigForTests();
      rmSync(dd, { recursive: true, force: true });
      rmSync(victim, { recursive: true, force: true });
    }
  });
});
