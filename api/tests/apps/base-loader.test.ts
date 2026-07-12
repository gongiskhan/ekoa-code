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
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
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

  it('throws loudly on a base file whose project path the scaffold guard would silently drop', async () => {
    const base = await loadBase('document');
    const cursed = { ...base, scaffoldFiles: [...base.scaffoldFiles, { relPath: 'frontend/src/notes..md', content: 'x' }] };
    expect(() => baseProjectFiles(cursed)).toThrow(/BaseInvalid.*unsafe project path/);
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

  // operator-run B2: the app base — the strategic default with the assistant mount.
  it('loads the app base: shipped shell carries the assistant mount, wiring maps the protocol client', async () => {
    expect(BASE_IDS).toContain('app');
    expect(isBaseId('app')).toBe(true);

    const base = await loadBase('app');
    expect(base.manifest.id).toBe('app');

    // The pre-built shell is scaffolded verbatim and carries the assistant mount point.
    const appJsx = base.scaffoldFiles.find((f) => f.relPath === 'frontend/src/App.jsx');
    expect(appJsx?.content).toContain('ekoa-assistant-root');

    // The hardened protocol client is wiring, mapped into the project's lib/.
    const projectFiles = baseProjectFiles(base);
    expect(projectFiles.map((f) => f.path)).toContain('frontend/src/lib/protocol-client.ts');
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

  // operator-run C1: with no explicit templateId the CLASSIFIER selects the base.
  it('no templateId classifies the request and scaffolds the type base (app default)', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 's-b2', description: 'A colorful budget tracker', language: 'pt' });
    const appJsx = await readFile(join(prep.projectDir, 'frontend', 'src', 'App.jsx'), 'utf-8');
    expect(appJsx).toContain('ekoa-assistant-root'); // the app base shell, not the generic starter
    expect((await readManifest(prep.projectDir))?.extends).toBe('app');
    expect(prep.basePromptSections?.length).toBeGreaterThan(0);
    const { artifacts } = await import('../../src/data/stores.js');
    const art = (await artifacts.get(prep.artifactId)) as { data?: Record<string, unknown> } | null;
    expect(art?.data?.artifactType).toBe('app');
  }, 60_000);

  it('a document-shaped request classifies to the document base without explicit selection', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 's-c1-doc', description: 'Um contrato de arrendamento comercial', language: 'pt' });
    expect((await readManifest(prep.projectDir))?.extends).toBe('document');
    expect(await fileExists(join(prep.projectDir, 'frontend', 'src', 'documentData.js'))).toBe(true);
    const { artifacts } = await import('../../src/data/stores.js');
    const art = (await artifacts.get(prep.artifactId)) as { data?: Record<string, unknown> } | null;
    expect(art?.data?.artifactType).toBe('document');
  }, 60_000);

  it('an unknown templateId classifies instead of failing (honest fallback)', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 's-b3', description: 'Um gestor de contactos', language: 'pt', templateId: 'featured-thing-123' });
    expect((await readManifest(prep.projectDir))?.extends).toBe('app');
    expect(prep.basePromptSections?.length).toBeGreaterThan(0);
  }, 60_000);

  // operator-run B2: the app base builds through the REAL pipeline (scaffold -> esbuild).
  it('templateId app scaffolds the shell, wires lib/, and the real builder bundles it', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 's-b2-app', description: 'Gestor de processos', language: 'pt', templateId: 'app' });
    const appJsx = await readFile(join(prep.projectDir, 'frontend', 'src', 'App.jsx'), 'utf-8');
    expect(appJsx).toContain('ekoa-assistant-root');
    expect(await fileExists(join(prep.projectDir, 'frontend', 'src', 'lib', 'protocol-client.ts'))).toBe(true);
    expect(await fileExists(join(prep.projectDir, 'frontend', 'src', 'lib', 'ErrorBoundary.jsx'))).toBe(true);
    expect((await readManifest(prep.projectDir))?.extends).toBe('app');
    // The initial build (trigger 1) ran inside prepareFirstBuild; the shell must have bundled.
    expect(await fileExists(join(prep.projectDir, 'dist', 'bundle.js'))).toBe(true);
    const bundle = await readFile(join(prep.projectDir, 'dist', 'bundle.js'), 'utf-8');
    expect(bundle).toContain('ekoa-assistant-root'); // the mount survived into the served bundle
  }, 90_000);

  // operator-run C2: activation captures the declared ui_actions (valid, invalid, absent).
  it('activateArtifact persists the ui_actions manifest (and clears it when absent)', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 's-c2', description: 'Gestor de clientes', language: 'pt' });
    const manifestMd = `---
name: Gestor
purpose: gerir clientes
ui_actions:
  - id: ir-clientes
    kind: navigate
    labelPt: Ver clientes
    description: Abre a lista de clientes
    route: /clientes
---
`;
    await writeFile(join(prep.projectDir, 'MANIFEST.md'), manifestMd, 'utf-8');
    await mech.activateArtifact({ artifactId: prep.artifactId, slug: prep.slug, appUrl: prep.appUrl, projectDir: prep.projectDir });
    const { artifacts } = await import('../../src/data/stores.js');
    let art = (await artifacts.get(prep.artifactId)) as { data?: Record<string, unknown> } | null;
    const persisted = art?.data?.actionManifest as { version: number; actions: Array<{ id: string }> };
    expect(persisted?.version).toBe(1);
    expect(persisted?.actions[0]?.id).toBe('ir-clientes');

    // An invalid declaration persists the ERROR (visible), not a manifest.
    await writeFile(join(prep.projectDir, 'MANIFEST.md'), manifestMd.replace('route: /clientes', ''), 'utf-8');
    await mech.activateArtifact({ artifactId: prep.artifactId, slug: prep.slug, appUrl: prep.appUrl, projectDir: prep.projectDir });
    art = (await artifacts.get(prep.artifactId)) as { data?: Record<string, unknown> } | null;
    expect(art?.data?.actionManifest).toBeUndefined();
    expect(String(art?.data?.actionManifestError)).toMatch(/requires route/);

    // Removing the section clears both keys (the operator surface follows the declaration).
    await writeFile(join(prep.projectDir, 'MANIFEST.md'), '---\nname: G\npurpose: p\n---\n', 'utf-8');
    await mech.activateArtifact({ artifactId: prep.artifactId, slug: prep.slug, appUrl: prep.appUrl, projectDir: prep.projectDir });
    art = (await artifacts.get(prep.artifactId)) as { data?: Record<string, unknown> } | null;
    expect(art?.data?.actionManifest).toBeUndefined();
    expect(art?.data?.actionManifestError).toBeUndefined();
  }, 60_000);

  // operator-run B3: the base-manifest mustEdit signal in the honest-completion gate.
  it('assertProgress FAILS a deliberately untouched base build and PASSES once mustEdit files are filled', async () => {
    const prep = await mech.prepareFirstBuild({ userId: USER, sessionId: 's-b3-gate', description: 'Contrato de arrendamento', language: 'pt', templateId: 'document' });

    // Untouched base: the shell serves plausibly, but documentData.js was never filled.
    const before = await mech.assertProgress({ artifactId: prep.artifactId, projectDir: prep.projectDir });
    expect(before.clean).toBe(false);
    expect(before.reasons.join(' ')).toContain('frontend/src/documentData.js');

    // Simulate the agent filling the document content and committing (the snapshot path commits in prod).
    const dataPath = join(prep.projectDir, 'frontend', 'src', 'documentData.js');
    const filled = (await readFile(dataPath, 'utf-8')) + '\n// contrato preenchido pelo agente\n';
    await writeFile(dataPath, filled, 'utf-8');
    const git = (args: string[]) => new Promise<void>((res, rej) => {
      execFile('git', args, { cwd: prep.projectDir }, (err) => (err ? rej(err) : res()));
    });
    await git(['add', '-A']);
    await git(['-c', 'user.name=test', '-c', 'user.email=t@t', 'commit', '--no-verify', '-m', 'fill document']);

    const after = await mech.assertProgress({ artifactId: prep.artifactId, projectDir: prep.projectDir });
    expect(after.reasons.join(' ')).not.toContain('modelo interno por preencher');
    expect(after.clean).toBe(true);
  }, 90_000);
});
