import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { artifacts, orgs } from '../../src/data/stores.js';
import { appBuilder, validateBundle } from '../../src/apps/builder.js';
import { scaffoldApp } from '../../src/apps/scaffold.js';
import { designTokensHandler } from '../../src/services/design-tokens.js';

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
    // The ?app= parameter is what makes the ORG's brand resolve at serve time: no Referer
    // reaches the api (Referrer-Policy), so a bare link served every app the platform default.
    const tokensIdx = html.indexOf('<link rel="stylesheet" href="/api/design-tokens.css?app=jsx-css">');
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
    expect(copied).toContain('<h1>plain html app</h1>'); // the agent's document, not the template
    expect(copied).not.toContain('./bundle.js');
    expect(await fileExists(join(dir, 'dist', 'style.css'))).toBe(true);
    expect(await fileExists(join(dir, 'dist', 'bundle.js'))).toBe(false); // esbuild never ran
    // The agent's own <head> carries no tokens link, so this whole app class sat outside the
    // brand contract with no CSS variables to read.
    expect(copied).toContain('<link rel="stylesheet" href="/api/design-tokens.css?app=plain">');
    expect(copied.indexOf('/api/design-tokens.css')).toBeLessThan(copied.indexOf('<h1>'));
    // The SOURCE document is never rewritten - the injection lands on the built copy only.
    expect(await readFile(join(dir, 'index.html'), 'utf-8')).toBe(htmlBody);
  });

  it('leaves a document that already links the design tokens alone', async () => {
    const dir = await mkTemp();
    const htmlBody = '<!doctype html><html><head><link rel="stylesheet" href="/api/design-tokens.css?app=self"></head><body>x</body></html>';
    await writeFile(join(dir, 'index.html'), htmlBody, 'utf-8');

    expect((await appBuilder.build('plain-linked', dir)).success).toBe(true);
    const copied = await readFile(join(dir, 'dist', 'index.html'), 'utf-8');
    expect(copied).toBe(htmlBody);
    expect(copied.match(/design-tokens\.css/g)).toHaveLength(1);
  });

  it('leaves a head-less document VERBATIM - <header> is not <head> (regex fix, 2026-08-15)', async () => {
    // /<head[^>]*>/ also matched `<header class=...>`, splicing the tokens link into the
    // visible header of a document with no <head> at all - against the injector's own
    // "left as written" contract. This pin restores the verbatim guarantee for that class.
    const dir = await mkTemp();
    const htmlBody = '<!doctype html><html><body><header class="nav">menu</header><h1>landing</h1></body></html>';
    await writeFile(join(dir, 'index.html'), htmlBody, 'utf-8');

    expect((await appBuilder.build('plain-headless', dir)).success).toBe(true);
    const copied = await readFile(join(dir, 'dist', 'index.html'), 'utf-8');
    expect(copied).toBe(htmlBody); // verbatim - nothing injected anywhere
    expect(copied).not.toContain('design-tokens.css');
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

describe('AppBuilder — pre-installed dependency resolution (WS7, motion/react)', () => {
  // WS7 design-defaults incident follow-up: the build prompt (api/src/agents/build.ts
  // BUILD_SYSTEM_PROMPT), the presentation base conventions, and coding-agent/SKILL.md all now
  // tell the build agent `import { motion, AnimatePresence } from 'motion/react'` bundles. That
  // claim was verified by hand against this same builder before it was written into any prompt -
  // this test PINS it, so a future dependency bump or lockfile change that silently breaks the
  // import does not leave a load-bearing prompt claim quietly false. NOTE the mechanism: bare
  // specifier imports are NEVER routed through the CDN resolver (cdnResolverPlugin only
  // intercepts literal `https://` URL imports, per its onResolve filters) - `motion/react`
  // bundles here ONLY because `motion` is an explicit `api/package.json` dependency, resolved by
  // esbuild's own local resolution (nodePaths). Removing that dependency would make this test
  // fail with "Could not resolve", not silently fall back to a CDN fetch.
  it("`import { motion, AnimatePresence } from 'motion/react'` resolves locally and bundles", async () => {
    const dir = await mkTemp();
    await mkdir(join(dir, 'frontend', 'src'), { recursive: true });
    await writeManifest(dir);
    await writeFile(
      join(dir, 'frontend', 'src', 'index.jsx'),
      [
        "import { createRoot } from 'react-dom/client';",
        "import { motion, AnimatePresence } from 'motion/react';",
        'function App() {',
        '  return (',
        '    <AnimatePresence>',
        '      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Hello</motion.div>',
        '    </AnimatePresence>',
        '  );',
        '}',
        "const el = document.getElementById('root');",
        'if (el) createRoot(el).render(<App />);',
        '',
      ].join('\n'),
      'utf-8',
    );

    const result = await appBuilder.build('motion-app', dir);
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);

    const bundle = await readFile(join(dir, 'dist', 'bundle.js'), 'utf-8');
    expect(bundle).toContain('AnimatePresence'); // the real library landed in the bundle
  });
});

/**
 * The whole brand chain in the shape a browser exercises it: the document the builder writes
 * carries `?app=<id>`, and that URL - fetched with NO Referer, against the REAL org resolver
 * (slug/artifact -> org -> branding) - returns the org's brand. Every link in this chain was
 * broken at once (live 2026-08-12): the template's link had no ?app=, the api stamps
 * no-referrer, and the logo path was prefixed twice, so every served app on the platform
 * rendered the default teal with a 404 logo.
 */
describe('brand chain - the built document resolves its org brand', () => {
  it('serves the org palette and a single-prefixed logo for the href the builder wrote', async () => {
    await orgs.insert({
      _id: 'org-brand-chain',
      name: 'Acme',
      branding: { primaryColor: '#7C3AED', logo: '/brand-assets/acme-mark.png', fonts: ['Inter', 'Lora'] },
      createdAt: new Date().toISOString(),
    } as never);
    await artifacts.insert({ _id: 'brand-chain-app', name: 'Branded', orgId: 'org-brand-chain' } as never);

    const dir = await mkJsxApp({ css: false });
    expect((await appBuilder.build('brand-chain-app', dir)).success).toBe(true);
    const html = await readFile(join(dir, 'dist', 'index.html'), 'utf-8');
    const href = /<link rel="stylesheet" href="([^"]*design-tokens[^"]*)">/.exec(html)?.[1];
    expect(href).toBe('/api/design-tokens.css?app=brand-chain-app');

    const app = express();
    app.get('/api/design-tokens.css', designTokensHandler()); // the real resolver, no injection
    const server = await new Promise<Server>((r) => {
      const s = app.listen(0, () => r(s));
    });
    try {
      const { port } = server.address() as { port: number };
      const css = await (await fetch(`http://127.0.0.1:${port}${href}`)).text();
      expect(css).toContain('--color-primary: #7C3AED;');
      expect(css).toContain('--logo-url: url("/brand-assets/acme-mark.png");');
      expect(css).toContain("--font-sans: 'Inter',");
      expect(css).not.toContain('#0F766E'); // the platform default this app used to receive
    } finally {
      server.close();
    }
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
