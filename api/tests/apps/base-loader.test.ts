import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Same partial mock as build-mechanics.test.ts: artifacts-service imports
// getArtifactScreenshotUrl from this module — keep the original otherwise.
vi.mock('../../src/services/artifact-screenshot.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/services/artifact-screenshot.js')>();
  return {
    ...orig,
    captureArtifactScreenshot: vi.fn(async () => ({ path: '', url: '', width: 1280, height: 800 })),
  };
});
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users } from '../../src/data/stores.js';
import { appBuilder } from '../../src/apps/builder.js';
import { appRegistry } from '../../src/apps/app-registry.js';
import { createBuildMechanics } from '../../src/apps/build-mechanics.js';
import { loadBase, baseProjectFiles, isBaseId, BASE_IDS } from '../../src/apps/base-loader.js';
import { readManifest } from '../../src/apps/manifest.js';

/**
 * operator-run B1 — the base registry/loader and its build-flow wiring.
 * The loader reads api/assets/bases (real content, no fixtures); the mechanics
 * integration runs over real scaffold + esbuild + in-memory Mongo, no model call.
 */

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

describe('base-loader — registry + loader (B1)', () => {
  it('exposes the closed id set and refuses unknown ids', async () => {
    expect(BASE_IDS).toContain('document');
    expect(isBaseId('document')).toBe(true);
    expect(isBaseId('not-a-base')).toBe(false);
    await expect(loadBase('not-a-base')).rejects.toThrow(/BaseNotFound/);
  });

  it('loads the document base: validated manifest, verbatim scaffold, prompt sections', async () => {
    const base = await loadBase('document');
    expect(base.manifest.id).toBe('document');
    expect(base.manifest.name.length).toBeGreaterThan(0);
    const paths = base.scaffoldFiles.map((f) => f.relPath);
    expect(paths).toContain('frontend/src/App.jsx');
    expect(paths).toContain('frontend/src/documentData.js');
    expect(base.promptSections.length).toBeGreaterThan(0);
    // The scaffold is the template, verbatim: project files come back as project-relative paths.
    const projectFiles = baseProjectFiles(base);
    expect(projectFiles.find((f) => f.path === 'frontend/src/App.jsx')?.content).toContain('documentData');
  });

  it('maps wiring files to frontend/src/lib/<basename> (app-auth-persistent)', async () => {
    const base = await loadBase('app-auth-persistent');
    expect(base.wiringFiles.length).toBeGreaterThan(0);
    const projectFiles = baseProjectFiles(base);
    const libPaths = projectFiles.filter((f) => f.path.startsWith('frontend/src/lib/')).map((f) => f.path);
    expect(libPaths).toContain('frontend/src/lib/auth.ts');
    expect(libPaths).toContain('frontend/src/lib/integrations.ts');
    expect(libPaths).toContain('frontend/src/lib/jsonStore.ts');
  });
});

describe('base-loader — build-flow wiring (B1 integration)', () => {
  let mem: MongoMemoryServer;
  let sandbox: string;
  let ids = 0;
  const deps = { now: () => Date.now(), genId: () => `base-art-${++ids}` };
  const mech = createBuildMechanics(deps);
  const USER = 'user-base';

  beforeAll(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'ekoa-base-sandbox-'));
    process.env.SANDBOX_ROOT = sandbox;
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_base_loader');
    await users.insert({ _id: USER, username: 'base', passwordHash: 'x', role: 'builder', orgId: 'org-1', active: true } as never);
  }, 60_000);

  afterAll(async () => {
    await appBuilder.dispose();
    await appRegistry.stop();
    await closeMongo();
    await mem.stop();
    await rm(sandbox, { recursive: true, force: true });
    delete process.env.SANDBOX_ROOT;
  });

  it('templateId naming a base scaffolds FROM the base, persists extends, returns prompt sections', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 's-b1', description: 'Um contrato de prestação de serviços', language: 'pt', templateId: 'document' });

    // Base scaffold files landed verbatim (documentData.js exists only in the document base).
    expect(await fileExists(join(prep.projectDir, 'frontend', 'src', 'documentData.js'))).toBe(true);
    const appJsx = await readFile(join(prep.projectDir, 'frontend', 'src', 'App.jsx'), 'utf-8');
    expect(appJsx).not.toContain("Let's build something"); // not the generic starter

    // The base linkage is persisted for follow-ups + the B3 verifier.
    const manifest = await readManifest(prep.projectDir);
    expect(manifest?.extends).toBe('document');

    // The base's conventions travel to the agent prompt.
    expect(prep.basePromptSections?.length).toBeGreaterThan(0);

    // Follow-up resolution re-derives the same sections from the persisted extends.
    const followUp = await mech.resolveFollowUp(prep.artifactId);
    expect(followUp?.basePromptSections?.length).toBeGreaterThan(0);
  }, 60_000);

  it('no templateId keeps the generic starters and writes no extends', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 's-b2', description: 'A colorful budget tracker', language: 'pt' });
    const appJsx = await readFile(join(prep.projectDir, 'frontend', 'src', 'App.jsx'), 'utf-8');
    expect(appJsx).toContain("Let's build something"); // the generic starter placeholder
    expect((await readManifest(prep.projectDir))?.extends).toBeUndefined();
    expect(prep.basePromptSections).toBeUndefined();
  }, 60_000);

  it('an unknown templateId falls back to generic starters (honest fallback, no failure)', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 's-b3', description: 'Qualquer coisa', language: 'pt', templateId: 'featured-thing-123' });
    expect((await readManifest(prep.projectDir))?.extends).toBeUndefined();
    expect(prep.basePromptSections).toBeUndefined();
  }, 60_000);
});
