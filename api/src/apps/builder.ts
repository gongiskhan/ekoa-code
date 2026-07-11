/**
 * AppBuilder (ch07 §7.1.1, §7.2 - port-as-is, carryover-audit A3) - esbuild-based build
 * system for sandbox apps.
 *
 * Handles:
 * - JSX bundling (React bundled from the workspace node_modules, no CDN)
 * - CSS imports (raw CSS)
 * - Static assets (images, fonts)
 * - Incremental rebuilds via esbuild watch contexts
 * - index.html generation
 *
 * Design: output is IIFE format. React is bundled directly into the output from the
 * workspace node_modules. Sandboxes do NOT need npm install.
 */

import * as esbuild from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, access, readdir, readFile, copyFile, stat, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest, type AppManifest } from './manifest.js';
import { artifacts } from '../data/stores.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const _require = createRequire(import.meta.url);

// ============================================
// Types
// ============================================

export interface BuildResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  durationMs: number;
  outputFiles: string[];
}

// ============================================
// Workspace node_modules resolution
// ============================================

/**
 * Resolve the workspace node_modules so esbuild (and the CDN plugin) can find React etc.
 * npm workspaces hoist shared deps to the repo root, but some may be co-located under
 * api/, so both are searched in order: api/node_modules first, then the repo root's.
 * This resolves correctly from BOTH api/src/apps (dev, ts-node) and api/dist/apps (built),
 * since __dirname/../.. is `api/` in either layout.
 */
const API_DIR = join(__dirname, '..', '..');
const REPO_ROOT = join(__dirname, '..', '..', '..');
const WORKSPACE_NODE_MODULES = [join(API_DIR, 'node_modules'), join(REPO_ROOT, 'node_modules')];

// ============================================
// HTML template (loaded from content file)
// ============================================

/**
 * Path to the HTML template content file. Assets live at api/assets, which is __dirname/../..
 * plus assets/ in both the dev (api/src/apps) and built (api/dist/apps) layouts.
 */
const HTML_TEMPLATE_PATH = join(__dirname, '..', '..', 'assets', 'scaffold-templates', 'index.html');
let htmlTemplateCache: string | null = null;

async function loadHtmlTemplate(): Promise<string> {
  if (htmlTemplateCache) return htmlTemplateCache;
  htmlTemplateCache = await readFile(HTML_TEMPLATE_PATH, 'utf-8');
  return htmlTemplateCache;
}

async function generateIndexHtml(appName: string, _manifest: AppManifest | null, hasCss: boolean): Promise<string> {
  const template = await loadHtmlTemplate();
  const cssLink = hasCss
    ? '\n  <link rel="stylesheet" href="./bundle.css">'
    : '';

  return template
    .replace('{{APP_NAME}}', escapeHtml(appName))
    .replace('{{CSS_LINK}}', cssLink);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================
// CDN resolver plugin
// ============================================

/**
 * Extract a bare package specifier from a CDN URL.
 * Returns null if the URL doesn't match any known CDN pattern.
 *
 * Examples:
 *   https://esm.sh/react@18          -> "react"
 *   https://esm.sh/react-dom@18/client -> "react-dom/client"
 *   https://cdn.jsdelivr.net/npm/recharts@2.12.7/+esm -> "recharts"
 */
function extractPackageFromCdnUrl(url: string): string | null {
  // esm.sh: https://esm.sh/react@18 or https://esm.sh/react-dom@18/client
  const esmShMatch = url.match(/^https?:\/\/esm\.sh\/([^@]+)@[^/]*(\/.*)?$/);
  if (esmShMatch && esmShMatch[1]) return esmShMatch[1] + (esmShMatch[2] ?? '');

  // jsdelivr: https://cdn.jsdelivr.net/npm/react@18/+esm
  const jsdelivrMatch = url.match(/^https?:\/\/cdn\.jsdelivr\.net\/npm\/([^@]+)@[^/]*(\/.*?)?(\/\+esm)?$/);
  if (jsdelivrMatch && jsdelivrMatch[1]) return jsdelivrMatch[1] + (jsdelivrMatch[2] ?? '');

  // unpkg: https://unpkg.com/react@18/...
  const unpkgMatch = url.match(/^https?:\/\/unpkg\.com\/([^@]+)@[^/]*(\/.*)?$/);
  if (unpkgMatch && unpkgMatch[1]) return unpkgMatch[1] + (unpkgMatch[2] ?? '');

  return null;
}

/**
 * Normalize a CDN URL to a canonical esm.sh URL for fetching.
 * esm.sh is preferred because it returns ESM modules that esbuild can bundle.
 */
/** The known public CDN hosts a build may fetch ESM from. Anything else (a raw app-authored
 *  import URL, an internal host) is refused - the build-time fetch is an SSRF sink otherwise. */
const ALLOWED_CDN_HOSTS = new Set(['esm.sh', 'cdn.jsdelivr.net', 'unpkg.com', 'cdn.skypack.dev']);
function isAllowedCdnUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_CDN_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function toEsmShUrl(url: string): string {
  // Already esm.sh - use as-is
  if (url.match(/^https?:\/\/esm\.sh\//)) return url;

  // Extract package and convert to esm.sh
  const pkg = extractPackageFromCdnUrl(url);
  if (pkg) return `https://esm.sh/${pkg}`;

  // Unknown CDN, try using URL directly
  return url;
}

/**
 * esbuild plugin that resolves CDN imports:
 *
 * 1. If the package exists in the workspace node_modules (react, react-dom),
 *    resolve locally for fastest builds with zero network.
 * 2. Otherwise, fetch the module from esm.sh at build time and bundle it.
 *    This handles any library the agent imports (recharts, chart.js, etc.)
 *    without requiring pre-installation.
 *
 * IIFE format makes `external: true` emit `require()` which breaks in
 * browsers, so we NEVER return external for CDN URLs.
 */
function cdnResolverPlugin(): esbuild.Plugin {
  const fetchCache = new Map<string, string>();

  return {
    name: 'cdn-resolver',
    setup(build) {
      // Step 0: SERVER-ABSOLUTE paths (`/api/design-tokens.css`, `/apps/...`) are RUNTIME URLs
      // the serving plane answers - they can never be bundle-resolved, and the coding agent is
      // explicitly taught to use them (content/coding-agent). Pre-fix, one `@import
      // '/api/design-tokens.css'` failed the whole build ("could not resolve", live 2026-07-11).
      //  - CSS @import / url(): keep as external (the browser resolves it at runtime).
      //  - JS import of an absolute path: swap in an empty stub - external would emit a
      //    browser-breaking require() under IIFE, and the generated index.html already links
      //    the design tokens, so the import is redundant.
      build.onResolve({ filter: /^\// }, (args) => {
        if (args.namespace === 'cdn-fetch') return null; // esm.sh internals keep their handler
        // Real filesystem paths (the entry point itself, tool-resolved absolute imports) are
        // NOT server routes - let esbuild handle them.
        if (args.kind === 'entry-point' || existsSync(args.path)) return null;
        if (args.kind === 'import-rule' || args.kind === 'url-token') {
          return { path: args.path, external: true };
        }
        return { path: args.path, namespace: 'server-absolute' };
      });
      build.onLoad({ filter: /.*/, namespace: 'server-absolute' }, (args) => ({
        contents: `/* runtime-served path, loaded by the browser (see index.html): ${args.path} */`,
        loader: args.path.endsWith('.css') ? 'css' : 'js',
      }));

      // Step 1: Resolve CDN URLs - try local, else mark for fetch.
      // Skip CSS @import url() - those are handled by esbuild's native CSS
      // loader. Only intercept JS/module imports from CDN URLs.
      build.onResolve({ filter: /^https?:\/\// }, (args) => {
        const url = args.path;

        // Let esbuild handle CSS @import url() natively (Google Fonts, etc.)
        if (args.kind === 'import-rule') {
          return { path: url, external: true };
        }

        const pkg = extractPackageFromCdnUrl(url);

        // Try local resolution first (for react, react-dom, etc.)
        if (pkg) {
          try {
            const resolved = _require.resolve(pkg, { paths: WORKSPACE_NODE_MODULES });
            return { path: resolved };
          } catch {
            // Not installed locally - will be fetched from CDN
          }
        }

        // Mark for CDN fetch (namespace tells onLoad to fetch it)
        const fetchUrl = toEsmShUrl(url);
        return { path: fetchUrl, namespace: 'cdn-fetch' };
      });

      // Step 2: Fetch CDN modules at build time
      build.onLoad({ filter: /.*/, namespace: 'cdn-fetch' }, async (args) => {
        const url = args.path;

        // SSRF guard (Codex checkpoint): app-authored imports reach here; toEsmShUrl falls through
        // to the raw URL for unknown hosts, so a `import x from 'http://internal/'` would otherwise
        // be fetched server-side. Only fetch from the known public CDN hosts - reject anything else
        // rather than let a build reach an internal service.
        if (!isAllowedCdnUrl(url)) {
          return { contents: `/* Blocked non-CDN import ${url} */\nexport default {};`, loader: 'js' };
        }

        // Check cache
        const cached = fetchCache.get(url);
        if (cached) {
          return { contents: cached, loader: 'js' };
        }

        try {
          console.log(`[cdn-resolver] fetching: ${url}`);
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (!res.ok) {
            return { contents: `/* Failed to fetch ${url}: ${res.status} */\nexport default {};`, loader: 'js' };
          }
          const contents = await res.text();
          fetchCache.set(url, contents);
          return { contents, loader: 'js' };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[cdn-resolver] fetch failed for ${url}: ${msg}`);
          return { contents: `/* Fetch error: ${msg} */\nexport default {};`, loader: 'js' };
        }
      });

      // Step 3: Resolve imports within fetched CDN modules
      // esm.sh modules import their dependencies as relative URLs like
      // /v135/recharts@2.12.7/es2022/recharts.mjs - resolve these back to esm.sh
      build.onResolve({ filter: /.*/, namespace: 'cdn-fetch' }, (args) => {
        // Absolute URLs (https://...) - keep in cdn-fetch namespace
        if (args.path.match(/^https?:\/\//)) {
          return { path: args.path, namespace: 'cdn-fetch' };
        }

        // Relative or absolute path from esm.sh (e.g., /v135/...)
        if (args.path.startsWith('/')) {
          const base = new URL(args.importer);
          const resolved = `${base.protocol}//${base.host}${args.path}`;
          return { path: resolved, namespace: 'cdn-fetch' };
        }

        // Bare specifier from within a CDN module (e.g., "react" imported by recharts)
        // Try local first, then esm.sh
        try {
          const resolved = _require.resolve(args.path, { paths: WORKSPACE_NODE_MODULES });
          return { path: resolved };
        } catch {
          return { path: `https://esm.sh/${args.path}`, namespace: 'cdn-fetch' };
        }
      });
    },
  };
}

// ============================================
// Shared esbuild options
// ============================================

function sharedBuildOptions(entryPath: string, outDir: string): esbuild.BuildOptions {
  return {
    entryPoints: [entryPath],
    bundle: true,
    outdir: outDir,
    entryNames: 'bundle',
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    // JSX automatic transform - no need for `import React` in every file
    jsx: 'automatic',
    // Resolve React from the workspace node_modules (not each sandbox)
    nodePaths: WORKSPACE_NODE_MODULES,
    plugins: [cdnResolverPlugin()],
    // Loaders
    loader: {
      '.js': 'jsx',
      '.jsx': 'jsx',
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.css': 'css',
      '.png': 'file',
      '.jpg': 'file',
      '.jpeg': 'file',
      '.gif': 'file',
      '.svg': 'file',
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file',
      '.eot': 'file',
    },
    assetNames: 'assets/[name]-[hash]',
    // Dev-friendly defaults
    minify: false,
    sourcemap: true,
    metafile: true,
    logLevel: 'silent',
    define: {
      'process.env.NODE_ENV': '"development"',
    },
  };
}

// ============================================
// AppBuilder
// ============================================

class AppBuilder {
  private contexts = new Map<string, esbuild.BuildContext>();

  /**
   * Wipe the artifact's stale runtime health verdict after a successful (re)build so the
   * next probe re-evaluates. Best-effort: a missing appId (not every build flow corresponds
   * to an artifact instance) and any store failure are swallowed - health is observational.
   * Uses the `artifacts` store directly; data/ never imports back into apps/, so the static
   * import carries no circular-dependency risk.
   */
  private async clearArtifactHealth(appId: string): Promise<void> {
    try {
      const existing = await artifacts.get(appId);
      if (!existing || existing.health === undefined) return;
      await artifacts.update(appId, (cur) => {
        const next = { ...cur };
        delete next.health;
        return next;
      });
    } catch { /* non-fatal: health is observational */ }
  }

  /**
   * Build an app: the frontend bundle plus, when the manifest declares one, the
   * server-side backend bundle (Layer 2). Backend build errors are merged into
   * the result so a backend that doesn't compile fails the build loudly.
   */
  async build(appId: string, sandboxPath: string): Promise<BuildResult> {
    const frontend = await this.buildFrontend(appId, sandboxPath);

    let manifest: AppManifest | null = null;
    try { manifest = await readManifest(sandboxPath); } catch { /* invalid - no backend */ }
    if (!manifest?.backend) return frontend;

    const backend = await this.buildBackend(appId, sandboxPath, manifest.backend);
    return {
      success: frontend.success && backend.success,
      errors: [...frontend.errors, ...backend.errors],
      warnings: [...frontend.warnings, ...backend.warnings],
      durationMs: frontend.durationMs + backend.durationMs,
      outputFiles: [...frontend.outputFiles, ...backend.outputFiles],
    };
  }

  /**
   * Bundle an artifact's backend entry with esbuild for Node (esm, bundled) to
   * `dist-backend/backend.mjs`. The worker imports that bundle; the `ekoa`
   * capability handle arrives at call time and is never imported here.
   */
  private async buildBackend(
    appId: string,
    sandboxPath: string,
    backend: NonNullable<AppManifest['backend']>,
  ): Promise<BuildResult> {
    const start = performance.now();
    const entryPath = join(sandboxPath, backend.entryPoint);
    const outDir = join(sandboxPath, 'dist-backend');

    try {
      await access(entryPath);
    } catch {
      return {
        success: false,
        errors: [`Backend entry point not found: ${backend.entryPoint}`],
        warnings: [],
        durationMs: performance.now() - start,
        outputFiles: [],
      };
    }

    await mkdir(outDir, { recursive: true });
    try {
      const result = await esbuild.build({
        entryPoints: [entryPath],
        bundle: true,
        outfile: join(outDir, 'backend.mjs'),
        platform: 'node',
        format: 'esm',
        target: ['node20'],
        // Resolve any npm deps the handler imports from the workspace node_modules,
        // mirroring the frontend bundle (sandboxes don't run npm install).
        nodePaths: WORKSPACE_NODE_MODULES,
        loader: { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'ts', '.json': 'json' },
        logLevel: 'silent',
        metafile: true,
        sourcemap: false,
        minify: false,
      });
      const errors = result.errors.map((e) => e.text);
      const outputFiles = Object.keys(result.metafile?.outputs ?? {});
      if (errors.length === 0) {
        console.log(`[app-builder] ${appId}: backend bundled -> dist-backend/backend.mjs (handlers: ${backend.handlers.join(', ')})`);
      }
      return {
        success: errors.length === 0,
        errors,
        warnings: result.warnings.map((w) => w.text),
        durationMs: performance.now() - start,
        outputFiles,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[app-builder] ${appId}: backend build failed: ${message}`);
      return { success: false, errors: [message], warnings: [], durationMs: performance.now() - start, outputFiles: [] };
    }
  }

  /**
   * Build an app's frontend. Reads manifest.json to determine
   * entry point and output directory.
   */
  private async buildFrontend(appId: string, sandboxPath: string): Promise<BuildResult> {
    const start = performance.now();

    // Read manifest for entry point and output dir.
    // Tolerate invalid manifests (e.g. agent writes an unrecognised type)
    // so the build can still proceed with defaults.
    let manifest: AppManifest | null = null;
    try {
      manifest = await readManifest(sandboxPath);
    } catch {
      // Invalid or missing manifest - proceed with defaults
    }
    const outputDir = manifest?.outputDir ?? 'dist/';
    const outDir = join(sandboxPath, outputDir);
    await mkdir(outDir, { recursive: true });

    // Check if the agent wrote a plain HTML file at the project root.
    // Plain HTML apps don't need esbuild - just copy the HTML (and any
    // co-located CSS/JS) to dist/.
    const plainHtmlResult = await this.tryPlainHtmlBuild(appId, sandboxPath, outDir, start);
    if (plainHtmlResult) {
      if (plainHtmlResult.success) await this.clearArtifactHealth(appId);
      return plainHtmlResult;
    }

    // JSX app: build with esbuild
    const entryPoint = manifest?.entryPoint ?? 'frontend/src/index.jsx';
    const appName = manifest?.name ?? 'App';
    const entryPath = join(sandboxPath, entryPoint);

    // Ensure entry point exists
    try {
      await access(entryPath);
    } catch {
      // Generate index.html even on failure so the preview shows
      // something instead of a raw 404.
      await this.writeErrorHtml(outDir, appName, `Entry point not found: ${entryPoint}`);
      return {
        success: false,
        errors: [`Entry point not found: ${entryPoint}`],
        warnings: [],
        durationMs: performance.now() - start,
        outputFiles: ['index.html'],
      };
    }

    try {
      const result = await esbuild.build(sharedBuildOptions(entryPath, outDir));

      const errors = result.errors.map((e) => e.text);
      const warnings = result.warnings.map((w) => w.text);
      const outputFiles = Object.keys(result.metafile?.outputs ?? {});

      // Check if CSS was produced
      let dirFiles: string[];
      try {
        dirFiles = await readdir(outDir);
      } catch {
        dirFiles = [];
      }
      const hasCss = dirFiles.some((f) => f === 'bundle.css');

      // Generate index.html with importmap
      const htmlPath = join(outDir, 'index.html');
      await writeFile(htmlPath, await generateIndexHtml(appName, manifest, hasCss), 'utf-8');
      outputFiles.push('index.html');

      const durationMs = performance.now() - start;
      console.log(`[app-builder] ${appId}: built in ${durationMs.toFixed(0)}ms (${outputFiles.length} files)`);

      if (errors.length === 0) await this.clearArtifactHealth(appId);

      return {
        success: errors.length === 0,
        errors,
        warnings,
        durationMs,
        outputFiles,
      };
    } catch (err) {
      const durationMs = performance.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[app-builder] ${appId}: build failed: ${message}`);

      // Generate index.html even on failure
      await this.writeErrorHtml(outDir, appName, message);

      return {
        success: false,
        errors: [message],
        warnings: [],
        durationMs,
        outputFiles: ['index.html'],
      };
    }
  }

  /**
   * Check if the agent wrote a plain HTML file at the project root.
   * The scaffold never creates root-level index.html (only frontend/src/),
   * so any index.html at the root is the agent's intended output.
   * Copies it + co-located assets to dist/ instead of running esbuild.
   * Returns a BuildResult if handled, or null to fall through to esbuild.
   */
  private async tryPlainHtmlBuild(
    appId: string,
    sandboxPath: string,
    outDir: string,
    start: number,
  ): Promise<BuildResult | null> {
    const htmlPath = join(sandboxPath, 'index.html');
    try {
      await access(htmlPath);
    } catch {
      return null; // No root-level index.html - use esbuild
    }

    // Copy all web-relevant files from the project root to dist/
    const outputFiles: string[] = [];
    const WEB_EXTENSIONS = new Set(['.html', '.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf']);

    try {
      const files = await readdir(sandboxPath);
      for (const file of files) {
        const ext = extname(file).toLowerCase();
        if (!WEB_EXTENSIONS.has(ext)) continue;
        const src = join(sandboxPath, file);
        try {
          const s = await stat(src);
          if (s.isFile()) {
            await copyFile(src, join(outDir, file));
            outputFiles.push(file);
          }
        } catch { /* skip unreadable files */ }
      }

      const durationMs = performance.now() - start;
      console.log(`[app-builder] ${appId}: plain HTML copied in ${durationMs.toFixed(0)}ms (${outputFiles.length} files)`);

      return {
        success: true,
        errors: [],
        warnings: [],
        durationMs,
        outputFiles,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[app-builder] ${appId}: plain HTML copy failed: ${message}`);
      return null; // Fall through to esbuild
    }
  }

  /**
   * Start watching an app's frontend source for changes and rebuild
   * incrementally. Uses esbuild's context API for fast rebuilds.
   */
  async watch(appId: string, sandboxPath: string, onRebuild?: () => void): Promise<void> {
    // Always dispose existing esbuild context first (e.g. the scaffold watcher
    // started before the agent converted the app to plain HTML).
    await this.unwatch(appId);

    // Plain HTML apps don't need esbuild watching - the dist/ already
    // has the agent's HTML file copied by build().
    const rootHtml = join(sandboxPath, 'index.html');
    try {
      await access(rootHtml);
      console.log(`[app-builder] ${appId}: plain HTML app - skipping esbuild watch`);
      return;
    } catch { /* not a plain HTML app, continue to esbuild */ }

    let manifest: AppManifest | null = null;
    try {
      manifest = await readManifest(sandboxPath);
    } catch {
      // Invalid manifest - proceed with defaults
    }
    const entryPoint = manifest?.entryPoint ?? 'frontend/src/index.jsx';
    const outputDir = manifest?.outputDir ?? 'dist/';
    const appName = manifest?.name ?? 'App';

    const entryPath = join(sandboxPath, entryPoint);
    const outDir = join(sandboxPath, outputDir);

    // Ensure entry point exists before starting watch
    try {
      await access(entryPath);
    } catch {
      console.warn(`[app-builder] ${appId}: skipping watch - entry point not found: ${entryPoint}`);
      return;
    }

    await mkdir(outDir, { recursive: true });

    const sharedOpts = sharedBuildOptions(entryPath, outDir);
    // Captured for the esbuild plugin closure below (object-literal `setup`
    // would otherwise lose `this`).
    const self = this;

    let ctx: esbuild.BuildContext;
    try {
      ctx = await esbuild.context({
        ...sharedOpts,
        plugins: [
          // Keep CDN-to-local plugin from shared options
          ...(sharedOpts.plugins ?? []),
          // Plugin to regenerate index.html after each rebuild
          {
            name: 'html-generator',
            setup(build) {
              build.onEnd(async (result) => {
                if (result.errors.length === 0) {
                  try {
                    // Re-check for CSS each rebuild
                    let dirFiles: string[];
                    try {
                      dirFiles = await readdir(outDir);
                    } catch {
                      dirFiles = [];
                    }
                    const hasCss = dirFiles.some((f) => f === 'bundle.css');
                    await writeFile(
                      join(outDir, 'index.html'),
                      await generateIndexHtml(appName, manifest, hasCss),
                      'utf-8',
                    );
                    await self.clearArtifactHealth(appId);
                    // Notify caller of successful rebuild
                    if (onRebuild) onRebuild();
                  } catch {
                    // Non-fatal: HTML generation failure shouldn't block builds
                  }
                }
              });
            },
          },
        ],
      });
    } catch (err) {
      console.error(`[app-builder] ${appId}: esbuild context creation failed:`, err instanceof Error ? err.message : err);
      return;
    }

    this.contexts.set(appId, ctx);

    // Start watching (esbuild watches the source files automatically)
    try {
      await ctx.watch();
    } catch (err) {
      console.error(`[app-builder] ${appId}: esbuild watch failed:`, err instanceof Error ? err.message : err);
      this.contexts.delete(appId);
      return;
    }

    // Do an initial build
    try {
      await ctx.rebuild();
      console.log(`[app-builder] ${appId}: watching for changes`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[app-builder] ${appId}: initial build failed: ${msg}`);
    }
  }

  /** Stop watching a specific app. */
  async unwatch(appId: string): Promise<void> {
    const ctx = this.contexts.get(appId);
    if (ctx) {
      try {
        await ctx.dispose();
      } catch (err) {
        console.error(`[app-builder] ${appId}: esbuild dispose failed:`, err instanceof Error ? err.message : err);
      }
      this.contexts.delete(appId);
      console.log(`[app-builder] ${appId}: stopped watching`);
    }
  }

  /** Stop all watchers and dispose all contexts. */
  async dispose(): Promise<void> {
    const ids = [...this.contexts.keys()];
    for (const id of ids) {
      await this.unwatch(id);
    }
    console.log('[app-builder] disposed');
  }

  /** Write an index.html with a build error message so the preview never 404s. */
  private async writeErrorHtml(outDir: string, appName: string, errorMsg: string): Promise<void> {
    const safeError = escapeHtml(errorMsg);
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(appName)} - Build Error</title>
<style>
body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:system-ui,sans-serif;background:#fafafa;color:#525252}
.container{text-align:center;max-width:480px;padding:2rem}
h1{font-size:1.25rem;color:#dc2626;margin-bottom:0.5rem}
pre{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:1rem;text-align:left;font-size:0.75rem;overflow-x:auto;white-space:pre-wrap;word-break:break-word;color:#991b1b}
.retry{font-size:0.75rem;color:#a3a3a3;margin-top:1rem}
</style></head><body>
<div class="container">
<h1>Build Error</h1>
<pre>${safeError}</pre>
<p class="retry">This page will refresh automatically when the build succeeds.</p>
</div>
<script>setTimeout(function(){location.reload()},5000);</script>
</body></html>`;
    try {
      await writeFile(join(outDir, 'index.html'), html, 'utf-8');
    } catch { /* non-fatal */ }
  }
}

// ============================================
// Bundle validation
// ============================================

export interface BundleValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate that the dist output contains a proper IIFE bundle.
 * Catches cases where the agent ran its own esbuild (producing ESM)
 * or the build failed silently.
 */
export async function validateBundle(distDir: string): Promise<BundleValidation> {
  const bundlePath = join(distDir, 'bundle.js');
  try {
    await access(bundlePath);
  } catch {
    return { valid: false, error: 'bundle.js not found in dist/' };
  }
  try {
    // Read just the first 20 bytes to check the IIFE wrapper
    const fd = await open(bundlePath, 'r');
    const buf = Buffer.alloc(20);
    await fd.read(buf, 0, 20, 0);
    await fd.close();
    const head = buf.toString('utf-8');
    if (!head.startsWith('(() => {')) {
      return { valid: false, error: `bundle.js is not IIFE format (starts with: ${head.substring(0, 15)}...)` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `bundle.js validation error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ============================================
// Singleton
// ============================================

export const appBuilder = new AppBuilder();
