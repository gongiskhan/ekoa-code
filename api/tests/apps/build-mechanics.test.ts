import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Partial mock: the seam test needs a spyable capture, but artifacts-service imports
// getArtifactScreenshotUrl from the same module — keep the original for everything else.
vi.mock('../../src/services/artifact-screenshot.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/services/artifact-screenshot.js')>();
  return {
    ...orig,
    captureArtifactScreenshot: vi.fn(async () => ({ path: '', url: '', width: 1280, height: 800 })),
  };
});
import { mkdtemp, rm, access, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { artifacts, slugs, users } from '../../src/data/stores.js';
import { appBuilder } from '../../src/apps/builder.js';
import { appRegistry } from '../../src/apps/app-registry.js';
import { createBuildMechanics } from '../../src/apps/build-mechanics.js';
import { verifyRunner, buildPrompt } from '../../src/apps/verify-runner.js';
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

  it('screenshot seam fire-and-forgets a capture, honoring EKOA_SCREENSHOTS_DISABLED (ch07 §7.11)', async () => {
    const { captureArtifactScreenshot } = await import('../../src/services/artifact-screenshot.js');
    const mocked = vi.mocked(captureArtifactScreenshot);
    mocked.mockClear();

    process.env.EKOA_SCREENSHOTS_DISABLED = '1';
    try {
      mech.screenshot('art-shot-1');
      await new Promise((r) => setTimeout(r, 10));
      expect(mocked).not.toHaveBeenCalled();
    } finally {
      delete process.env.EKOA_SCREENSHOTS_DISABLED;
    }

    mech.screenshot('art-shot-1');
    await new Promise((r) => setTimeout(r, 10));
    expect(mocked).toHaveBeenCalledWith('art-shot-1');

    // A rejected capture never propagates (fire-and-forget).
    mocked.mockRejectedValueOnce(new Error('browser pool down'));
    expect(() => mech.screenshot('art-shot-2')).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe('assertProgress — the honest-completion gate over the real pipeline (F16, §5.6.2 step 5a)', () => {
  it('flags a scaffold build: entrypoint untouched, dist fingerprints as scaffold, orphan HTML named', async () => {
    // prepareFirstBuild scaffolds + runs the initial build — dist/bundle.js IS the compiled
    // scaffold and frontend/src is exactly the baseline commit: the J3 miss, reproduced for real.
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 'sess-f16a', description: 'A pessoa manager', language: 'pt' });
    await writeFile(join(prep.projectDir, 'pessoa.html'), '<html><body>the REAL app, orphaned</body></html>', 'utf-8');
    await mech.finalizeBundle({ artifactId: prep.artifactId, projectDir: prep.projectDir });

    const verdict = await mech.assertProgress({ artifactId: prep.artifactId, projectDir: prep.projectDir });
    expect(verdict.clean).toBe(false);
    const all = verdict.reasons.join(' | ');
    expect(all).toContain('frontend/src');
    expect(all).toContain('modelo');
    expect(all).toContain('pessoa.html');
  });

  it('passes a build that really edited the entrypoint and rebuilt', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 'sess-f16b', description: 'A counter', language: 'pt' });
    const appPath = join(prep.projectDir, 'frontend', 'src', 'App.jsx');
    await writeFile(appPath, [
      "import React from 'react';",
      'export default function App() {',
      "  const [n, setN] = React.useState(0);",
      "  return <button onClick={() => setN(n + 1)}>Contador: {n}</button>;",
      '}',
    ].join('\n'), 'utf-8');
    const bundle = await mech.finalizeBundle({ artifactId: prep.artifactId, projectDir: prep.projectDir });
    expect(bundle.ok).toBe(true);

    const verdict = await mech.assertProgress({ artifactId: prep.artifactId, projectDir: prep.projectDir });
    expect(verdict.clean).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it('does not flag a valid plain-HTML app (§7.2.1): served index, no bundle, frontend/src untouched', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 'sess-f16c', description: 'A static page', language: 'pt' });
    // Simulate the plain-HTML posture the builder produces: dist/index.html with REAL content,
    // no bundle.js — frontend/src never touched (its legit shape per bundleValid).
    const distDir = join(prep.projectDir, 'dist');
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'index.html'), '<html><body><h1>A landing page users asked for</h1></body></html>', 'utf-8');

    const verdict = await mech.assertProgress({ artifactId: prep.artifactId, projectDir: prep.projectDir });
    expect(verdict.clean).toBe(true);
  });
});

describe('verifyRunner buildPrompt — request-fulfilment contract (F28, ch07 §7.2.6)', () => {
  const base = { artifactId: 'a1', projectDir: '/pd', appUrl: '/apps/a1/', userId: USER, depth: 'full' as const };

  it('carries the user request so the verifier can assert fulfilment, not mere rendering', () => {
    const prompt = buildPrompt({ ...base, request: 'a pessoa manager with an add-person form' });
    expect(prompt).toContain('a pessoa manager with an add-person form');
    expect(prompt.toLowerCase()).toContain('request');
  });

  it('mandates the scaffold check: every scaffold marker is named and maps to FAIL', () => {
    const prompt = buildPrompt({ ...base, request: 'anything' });
    expect(prompt).toContain('Powered by Ekoa');
    expect(prompt).toContain('Your app is being created');
    expect(prompt).toContain('scaffold-root');
    expect(prompt).toContain('FAIL');
    // scaffold detection is mandatory and ordered before the acceptance pass
    expect(prompt.toLowerCase()).toContain('scaffold check');
  });

  it('keeps the machine-parseable PASS/FAIL final-line contract intact', () => {
    const prompt = buildPrompt({ ...base, request: 'x', depth: 'scoped' });
    expect(prompt).toContain('PASS - ');
    expect(prompt).toContain('FAIL - ');
    expect(prompt).toContain('FINAL line');
  });
});

describe('verifyRunner — honest credential-skip (ch07 §7.2.6)', () => {
  it('reports a not-run as a distinct non-passing state (no fake pass) when no credential is configured', async () => {
    __resetCredentialsForTests(); // unconfigured → claudeAuthStatus().ok === false
    const verdict = await verifyRunner({ artifactId: 'a1', projectDir: sandbox, appUrl: '/apps/a1/', userId: USER, depth: 'full', request: 'a notes app' });
    expect(verdict.ran).toBe(false);
    // A not-run must NOT claim passed:true — only a real ran+passed verification does (was a bug:
    // the skip returned passed:true, so build.ts surfaced no note and the skip read as "clean").
    expect(verdict.passed).toBe(false);
    // The note is user-facing PT-PT since the bounded-honest-verify change (bc22eb8).
    expect(verdict.note).toMatch(/credencial de modelo indisponível/);
  });
});
