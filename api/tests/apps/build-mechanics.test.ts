import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { artifacts, slugs, users } from '../../src/data/stores.js';
import { appBuilder } from '../../src/apps/builder.js';
import { appRegistry } from '../../src/apps/app-registry.js';
import { createBuildMechanics } from '../../src/apps/build-mechanics.js';
import { verifyRunner } from '../../src/apps/verify-runner.js';
import { __resetCredentialsForTests } from '../../src/llm/credentials.js';
import type { ArtifactDoc } from '../../src/apps/artifacts-service.js';

/**
 * G7B — the real build mechanics wired at the composition root (ch05 §5.6.2, ch07 §7.2-§7.4).
 * Exercises the seam implementation directly over real esbuild + git + the in-memory stores, with
 * NO model call: prepareFirstBuild (draft artifact + scaffold + initial build + registration),
 * finalizeBundle (IIFE validation), the data-bag MERGE on activate, persist-only-when-changed, and
 * the follow-up resolution. Plus the verify-runner's honest credential-skip.
 */

let mem: MongoMemoryServer;
let sandbox: string;
let ids = 0;
const deps = { now: () => Date.now(), genId: () => `test-art-${++ids}` };
const mech = createBuildMechanics(deps);
const USER = 'user-abc';

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'ekoa-bm-sandbox-'));
  process.env.SANDBOX_ROOT = sandbox;
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_build_mechanics');
  await users.insert({ _id: USER, username: 'abc', passwordHash: 'x', role: 'builder', orgId: 'org-1', active: true } as never);
}, 60_000);

afterAll(async () => {
  await appBuilder.dispose();
  await appRegistry.stop();
  await closeMongo();
  await mem.stop();
  await rm(sandbox, { recursive: true, force: true });
  delete process.env.SANDBOX_ROOT;
});

describe('createBuildMechanics — first build (ch05 §5.6.2, ch07 §7.3/§7.4)', () => {
  it('creates a draft artifact with session + projectDir in the data bag, scaffolds, builds, and registers', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 'sess-1', description: 'A colorful budget tracker', language: 'pt' });

    expect(prep.artifactId).toBeTruthy();
    expect(prep.appUrl).toBe(`/apps/${prep.artifactId}/`);
    expect(prep.slug).toBeTruthy();

    const art = (await artifacts.get(prep.artifactId)) as ArtifactDoc | null;
    expect(art?.status).toBe('draft');
    expect(art?.orgId).toBe('org-1'); // resolved from the users store (seam does not thread orgId)
    expect((art?.data as Record<string, unknown>).projectDir).toBe(prep.projectDir);
    expect((art?.data as Record<string, unknown>).sessionId).toBe('sess-1');

    // Slug reservation points at the artifact + the scaffold produced a real project tree.
    expect((await slugs.get(prep.slug))?.artifactId).toBe(prep.artifactId);
    expect(await fileExists(join(prep.projectDir, 'manifest.json'))).toBe(true);
    expect(await fileExists(join(prep.projectDir, 'frontend', 'src', 'index.jsx'))).toBe(true);
    expect(appRegistry.getApp(prep.artifactId)).toBeDefined();
  });

  it('finalizeBundle produces a valid IIFE bundle, snapshots, activates with a MERGED data bag, and resolves as a follow-up', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 'sess-2', description: 'A tiny notes app', language: 'pt' });

    const bundle = await mech.finalizeBundle({ artifactId: prep.artifactId, projectDir: prep.projectDir });
    expect(bundle.ok).toBe(true);
    expect(await fileExists(join(prep.projectDir, 'dist', 'bundle.js'))).toBe(true);

    // Version snapshot through the repo lock (scaffold seeded the git repo) — no throw.
    await expect(mech.snapshot({ artifactId: prep.artifactId, projectDir: prep.projectDir, broken: false })).resolves.toBeUndefined();

    // Seed a customization field, then activate: status/slug/appUrl set, existing data preserved.
    await artifacts.update(prep.artifactId, (a) => ({ ...a, data: { ...(a.data as Record<string, unknown>), customized: true } }));
    await mech.activateArtifact({ artifactId: prep.artifactId, slug: prep.slug, appUrl: prep.appUrl });
    const active = (await artifacts.get(prep.artifactId)) as ArtifactDoc | null;
    expect(active?.status).toBe('active');
    expect(active?.slug).toBe(prep.slug);
    expect((active?.data as Record<string, unknown>).appUrl).toBe(prep.appUrl);
    expect((active?.data as Record<string, unknown>).customized).toBe(true); // MERGE, not replace
    expect((active?.data as Record<string, unknown>).projectDir).toBe(prep.projectDir); // preserved

    // Follow-up resolution reads projectDir + the resume session id back off the record.
    await mech.persistSdkSessionId(prep.artifactId, 'sdk-123');
    const follow = await mech.resolveFollowUp(prep.artifactId);
    expect(follow?.projectDir).toBe(prep.projectDir);
    expect(follow?.resumeSessionId).toBe('sdk-123');
  });

  it('persistSdkSessionId writes only when the id changed', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 'sess-3', description: 'One', language: 'pt' });
    await mech.persistSdkSessionId(prep.artifactId, 'sid-1');
    const before = (await artifacts.get(prep.artifactId)) as ArtifactDoc;
    await mech.persistSdkSessionId(prep.artifactId, 'sid-1'); // unchanged — no write
    const after = (await artifacts.get(prep.artifactId)) as ArtifactDoc;
    expect((after.data as Record<string, unknown>).sdkSessionId).toBe('sid-1');
    expect(after).toEqual(before);
  });

  it('resolveFollowUp returns null for an unknown artifact', async () => {
    expect(await mech.resolveFollowUp('nope')).toBeNull();
  });
});

describe('verifyRunner — honest credential-skip (ch07 §7.2.6)', () => {
  it('reports not-run (no fake pass) when no model credential is configured', async () => {
    __resetCredentialsForTests(); // unconfigured → claudeAuthStatus().ok === false
    const verdict = await verifyRunner({ artifactId: 'a1', projectDir: sandbox, appUrl: '/apps/a1/', userId: USER, depth: 'full' });
    expect(verdict.ran).toBe(false);
    expect(verdict.passed).toBe(true);
    expect(verdict.note).toMatch(/credential unavailable/);
  });
});
