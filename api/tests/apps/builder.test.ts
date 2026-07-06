import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { artifacts } from '../../src/data/stores.js';
import { appBuilder, validateBundle } from '../../src/apps/builder.js';
import { scaffoldApp } from '../../src/apps/scaffold.js';

/**
 * G6 app-pipeline core (ch07 §7.1.1 - port-as-is): the esbuild builder (JSX bundling, plain-HTML
 * fast path, backend bundle, error page), bundle validation, and the scaffold. Real esbuild over
 * temp sandbox dirs; React resolves from the workspace node_modules via nodePaths (no CDN).
 */

let mem: MongoMemoryServer;
const tempDirs: string[] = [];

async function mkTemp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ekoa-builder-'));
  tempDirs.push(dir);
  return dir;
}

function writeManifest(dir: string, extra: Record<string, unknown> = {}): Promise<void> {
  const manifest = {
    id: 'test-app',
    name: 'Test App',
    version: '1.0.0',
    entryPoint: 'frontend/src/index.jsx',
    outputDir: 'dist/',
    type: 'jsx-app',
    ...extra,
  };
  return writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}

/** Write a minimal but real React JSX app into a fresh sandbox dir. */
async function mkJsxApp(opts: { css: boolean; manifest?: Record<string, unknown> } = { css: true }): Promise<string> {
  const dir = await mkTemp();
  await mkdir(join(dir, 'frontend', 'src'), { recursive: true });
  await writeManifest(dir, opts.manifest);
  const cssImport = opts.css ? "import './index.css';\n" : '';
  await writeFile(
    join(dir, 'frontend', 'src', 'index.jsx'),
    `import { createRoot } from 'react-dom/client';\n${cssImport}function App() {\n  return <div className="app">Hello from the Ekoa test app</div>;\n}\nconst el = document.getElementById('root');\nif (el) createRoot(el).render(<App />);\n`,
    'utf-8',
  );
  if (opts.css) {
    await writeFile(join(dir, 'frontend', 'src', 'index.css'), '.app { color: teal; }\n', 'utf-8');
  }
  return dir;
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_builder');
}, 60_000);

afterAll(async () => {
  await appBuilder.dispose();
  await closeMongo();
  await mem.stop();
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('AppBuilder — JSX path (ch07 §7.2)', () => {
  it('builds a JSX app to an IIFE bundle with the design-tokens link before the bundle script, and a bundle.css link when CSS exists', async () => {
    const dir = await mkJsxApp({ css: true });
    const result = await appBuilder.build('jsx-css', dir);
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);

    const distDir = join(dir, 'dist');
    const bundle = await readFile(join(distDir, 'bundle.js'), 'utf-8');
    expect(bundle.startsWith('(() => {')).toBe(true);

    const html = await readFile(join(distDir, 'index.html'), 'utf-8');
    const tokensIdx = html.indexOf('<link rel="stylesheet" href="/api/design-tokens.css">');
    const bundleScriptIdx = html.indexOf('./bundle.js');
    expect(tokensIdx).toBeGreaterThanOrEqual(0);
    expect(bundleScriptIdx).toBeGreaterThan(tokensIdx); // design tokens come before the bundle
    expect(html).toContain('<link rel="stylesheet" href="./bundle.css">'); // CSS present
    expect(await fileExists(join(distDir, 'bundle.css'))).toBe(true);
  });

  it('omits the bundle.css link when the app imports no CSS', async () => {
    const dir = await mkJsxApp({ css: false });
    const result = await appBuilder.build('jsx-nocss', dir);
    expect(result.success).toBe(true);

    const html = await readFile(join(dir, 'dist', 'index.html'), 'utf-8');
    expect(html).toContain('/api/design-tokens.css');
    expect(html).not.toContain('./bundle.css');
    expect(await fileExists(join(dir, 'dist', 'bundle.css'))).toBe(false);
  });

  it('clears the artifact health verdict after a successful build (adapted seam: data/stores)', async () => {
    await artifacts.insert({ _id: 'health-app', name: 'H', health: { status: 'red', checkedAt: 1 } });
    const dir = await mkJsxApp({ css: false });
    const result = await appBuilder.build('health-app', dir);
    expect(result.success).toBe(true);

    const after = await artifacts.get('health-app');
    expect(after).not.toBeNull();
    expect(after?.health).toBeUndefined(); // health field dropped on (re)build
  });
});

describe('AppBuilder — plain-HTML fast path (ch07 §7.2)', () => {
  it('copies a root index.html to dist/ without running esbuild (no bundle.js)', async () => {
    const dir = await mkTemp();
    const htmlBody = '<!doctype html><html><head><title>Plain</title></head><body><h1>plain html app</h1></body></html>';
    await writeFile(join(dir, 'index.html'), htmlBody, 'utf-8');
    await writeFile(join(dir, 'style.css'), 'h1 { color: red; }', 'utf-8');

    const result = await appBuilder.build('plain', dir);
    expect(result.success).toBe(true);

    const copied = await readFile(join(dir, 'dist', 'index.html'), 'utf-8');
    expect(copied).toBe(htmlBody); // verbatim copy, not the generated template
    expect(await fileExists(join(dir, 'dist', 'style.css'))).toBe(true);
    expect(await fileExists(join(dir, 'dist', 'bundle.js'))).toBe(false); // esbuild never ran
  });
});

describe('AppBuilder — missing entry point (ch07 §7.2)', () => {
  it('fails and writes an error page with the 5s auto-reload script', async () => {
    const dir = await mkTemp();
    await writeManifest(dir); // declares frontend/src/index.jsx but the file is absent
    const result = await appBuilder.build('missing', dir);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes('Entry point not found'))).toBe(true);

    const html = await readFile(join(dir, 'dist', 'index.html'), 'utf-8');
    expect(html).toContain('Build Error');
    expect(html).toContain('setTimeout(function(){location.reload()},5000)');
  });
});

describe('validateBundle (ch07 §7.2)', () => {
  it('passes on a real IIFE build output', async () => {
    const dir = await mkJsxApp({ css: false });
    const build = await appBuilder.build('validate-ok', dir);
    expect(build.success).toBe(true);
    const v = await validateBundle(join(dir, 'dist'));
    expect(v.valid).toBe(true);
  });

  it('fails on a hand-written ESM bundle', async () => {
    const dir = await mkTemp();
    const distDir = join(dir, 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'bundle.js'), 'export default {};\n', 'utf-8');
    const v = await validateBundle(distDir);
    expect(v.valid).toBe(false);
    expect(v.error).toContain('not IIFE format');
  });

  it('fails when bundle.js is absent', async () => {
    const dir = await mkTemp();
    await mkdir(join(dir, 'dist'), { recursive: true });
    const v = await validateBundle(join(dir, 'dist'));
    expect(v.valid).toBe(false);
    expect(v.error).toContain('not found');
  });
});

describe('AppBuilder — backend bundle (ch07 §7.2, Layer 2)', () => {
  it('bundles the manifest backend entry to dist-backend/backend.mjs', async () => {
    const dir = await mkJsxApp({
      css: false,
      manifest: { backend: { entryPoint: 'backend/index.js', handlers: ['onEmail'] } },
    });
    await mkdir(join(dir, 'backend'), { recursive: true });
    await writeFile(
      join(dir, 'backend', 'index.js'),
      'export function onEmail(input, ekoa) {\n  return { handled: true, subject: input?.subject };\n}\n',
      'utf-8',
    );

    const result = await appBuilder.build('backend-app', dir);
    expect(result.success).toBe(true);
    const mjs = await readFile(join(dir, 'dist-backend', 'backend.mjs'), 'utf-8');
    expect(mjs).toContain('onEmail'); // exported handler survives bundling
    expect(await fileExists(join(dir, 'dist', 'bundle.js'))).toBe(true); // frontend built too
  });
});

describe('scaffoldApp (ch07 §7.3)', () => {
  it('creates the starter tree, seeds git, and is idempotent (skip-if-exists)', async () => {
    const dir = await mkTemp();
    const first = await scaffoldApp({ appId: 'scaf1', name: 'Scaffolded', projectDir: dir });
    expect(first.filesCreated).toContain('manifest.json');
    expect(first.filesCreated).toContain('frontend/src/index.jsx');
    expect(first.filesCreated).toContain('frontend/src/App.jsx');
    expect(first.filesCreated).toContain('frontend/src/index.css');
    expect(await fileExists(join(dir, 'frontend', 'src', 'App.jsx'))).toBe(true);
    expect(await fileExists(join(dir, '.git'))).toBe(true); // best-effort git seed ran

    // second scaffold: everything already exists → nothing recreated
    const second = await scaffoldApp({ appId: 'scaf1', name: 'Scaffolded', projectDir: dir });
    expect(second.filesCreated).toEqual([]);
  });

  it('drops the legacy per-app content dirs (skills/recipes/instructions not created)', async () => {
    const dir = await mkTemp();
    await scaffoldApp({ appId: 'scaf2', name: 'NoContentDirs', projectDir: dir });
    expect(await fileExists(join(dir, 'skills'))).toBe(false);
    expect(await fileExists(join(dir, 'recipes'))).toBe(false);
    expect(await fileExists(join(dir, 'instructions'))).toBe(false);
  });

  it('rejects a template scaffold file whose path escapes the project (..), writes safe ones', async () => {
    const dir = await mkTemp();
    const result = await scaffoldApp({
      appId: 'scaf3',
      name: 'Templated',
      projectDir: dir,
      templateScaffoldFiles: [
        { path: '../escape.js', content: 'evil' },
        { path: 'frontend/src/index.jsx', content: 'export const ok = true;' },
      ],
    });
    expect(result.filesCreated).toContain('frontend/src/index.jsx');
    expect(result.filesCreated).not.toContain('../escape.js');
    expect(await fileExists(join(dir, '..', 'escape.js'))).toBe(false); // traversal blocked
    const written = await readFile(join(dir, 'frontend', 'src', 'index.jsx'), 'utf-8');
    expect(written).toBe('export const ok = true;'); // template file overwrote the starter
  });
});
