/*
 * Panel-runtime compile step (operator-run G2).
 *
 * Compiles the operator assistant panel (AssistantPanel.jsx + tour-player.js +
 * AssistantPanel.css, entry src/index.jsx) into ONE self-contained browser IIFE at
 * api/assets/panel-runtime.js, served by serving.ts at /__ekoa/panel-runtime.js next
 * to the C3 action runtime. Mirrors the app builder's sharedBuildOptions conventions
 * (api/src/apps/builder.ts): format 'iife', platform 'browser', target es2020, jsx
 * automatic, React resolved from the WORKSPACE node_modules via nodePaths (no CDN, no
 * per-sandbox install). Two deliberate deviations, appropriate for a served PLATFORM
 * asset (not a per-app dev bundle): a PRODUCTION React build (NODE_ENV production, no
 * dev warnings in a lawyer's face) and minify on (the asset caches once across every
 * served app), which both keep the byte cost down.
 *
 * CSS is bundled INTO the single JS via the cssInject plugin (a `.css` import becomes
 * a style-injecting IIFE), so the one asset is fully self-contained - no sibling
 * bundle.css, no extra request.
 *
 * The output api/assets/panel-runtime.js is BUILT (npm run build --workspace api) and
 * is NOT committed (.gitignore). serving.ts reads it once at boot and serves a clear
 * "unavailable" comment body if it is missing.
 *
 * Importable: `buildPanelRuntime({ write })` returns the compiled code (used by the
 * offline compile test, tests/apps/panel-lazy.test.ts). Run directly to write the
 * asset: `node assets/panel-runtime/build.mjs`.
 */
import * as esbuild from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve React from the workspace node_modules exactly as the app builder does: npm
// workspaces hoist to the repo root, but some deps co-locate under api/, so both are
// searched in order (api/node_modules first, then the repo root's).
const API_DIR = join(__dirname, '..', '..'); // api/
const REPO_ROOT = join(__dirname, '..', '..', '..'); // repo root
const WORKSPACE_NODE_MODULES = [join(API_DIR, 'node_modules'), join(REPO_ROOT, 'node_modules')];

const ENTRY = join(__dirname, 'src', 'index.jsx');
const OUTPUT = join(API_DIR, 'assets', 'panel-runtime.js');

/**
 * esbuild plugin: bundle each `.css` import as a style-injecting JS module, so the
 * compiled asset carries its own styles and injects them once on load - no sibling
 * bundle.css. Guarded against double injection (the asset self-guards its mount too).
 */
function cssInjectPlugin() {
  return {
    name: 'ekoa-panel-css-inject',
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = await readFile(args.path, 'utf8');
        const contents = `(function(){
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-ekoa-panel]')) return;
  var s = document.createElement('style');
  s.setAttribute('data-ekoa-panel', '');
  s.textContent = ${JSON.stringify(css)};
  (document.head || document.documentElement).appendChild(s);
})();`;
        return { contents, loader: 'js' };
      });
    },
  };
}

/**
 * Compile the panel runtime. Returns { code, warnings, errors }. When `write` is a
 * path (default: api/assets/panel-runtime.js) the code is also written there; pass
 * `write: false` to compile in memory only (the offline test does this).
 */
export async function buildPanelRuntime({ write = OUTPUT } = {}) {
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    // JSX automatic transform - no `import React` in every file (matches the builder).
    jsx: 'automatic',
    // Resolve React from the workspace node_modules (not a per-app install / CDN).
    nodePaths: WORKSPACE_NODE_MODULES,
    plugins: [cssInjectPlugin()],
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    // Served platform asset: a production React build, minified, cached once.
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    metafile: false,
    logLevel: 'silent',
    write: false,
  });

  const code = result.outputFiles[0].text;
  if (write) await writeFile(write, code, 'utf8');
  return { code, warnings: result.warnings, errors: result.errors };
}

// CLI: `node assets/panel-runtime/build.mjs` - write the served asset.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildPanelRuntime()
    .then(({ code, errors }) => {
      if (errors && errors.length) {
        console.error('[panel-runtime] build failed:', errors);
        process.exit(1);
      }
      console.log(`[panel-runtime] built assets/panel-runtime.js (${code.length} bytes)`);
    })
    .catch((err) => {
      console.error('[panel-runtime] build error:', err && err.stack ? err.stack : err);
      process.exit(1);
    });
}
