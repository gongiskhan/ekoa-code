#!/usr/bin/env node
/**
 * Copy monaco-editor's AMD distribution (min/vs) into public/monaco/vs.
 *
 * WHY: the dashboard CSP is script-src 'self' (next.config.ts, ch09 D1) - the
 * @monaco-editor/loader default pulls from cdn.jsdelivr.net, which the CSP blocks
 * (the file-editor dialog then dies with "Monaco initialization: error"). Serving
 * the tree same-origin keeps the CSP intact and needs no bundler involvement
 * (dev is Turbopack, prod build is webpack - the runtime AMD loader sidesteps
 * both). public/monaco/ is gitignored (~10 MB of vendored assets); a version
 * stamp makes re-runs a no-op.
 *
 * INVOKED TWO WAYS:
 *  1. CLI (predev/prebuild in package.json) - the normal path via `npm run dev`.
 *  2. `ensureMonacoAssets()` imported straight into next.config.ts, which runs on
 *     EVERY `next dev`/`next build` regardless of how the process was launched.
 *     That second call matters: npm's predev hook only fires for `npm run dev`
 *     specifically. A dev server started any other way (bare `next dev`, an IDE
 *     run config, a fresh checkout's first boot before predev ever ran) skips it,
 *     `public/monaco/vs/loader.js` 404s, and @monaco-editor/loader's init promise
 *     rejects with the raw script-error Event. That rejection is NOT something
 *     calling code can guard against with its own `.catch()` - @monaco-editor/loader
 *     1.7.0's `makeCancelable()` forks the promise into two chains (one properly
 *     forwarded to the promise callers receive, one an orphaned `promise.then()`
 *     with no rejection handler) and the orphaned half surfaces as a genuine
 *     browser `unhandledrejection` carrying the raw Event no matter who catches
 *     the promise callers actually hold - Next's dev overlay stringifies that
 *     Event to "Runtime Error: [object Event]". Calling this at config-eval time
 *     removes the trigger instead of trying to catch the consequence.
 */
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Idempotently mirror the installed monaco-editor's AMD dist into public/monaco/vs.
 * Never throws - a missing monaco-editor package (e.g. a partial install) is reported
 * back rather than crashing the caller, since next.config.ts calls this synchronously
 * on every Next boot.
 * @returns {{ ok: boolean, copied: boolean, version?: string, reason?: string }}
 */
export function ensureMonacoAssets() {
  const require = createRequire(import.meta.url);
  let pkgJsonPath;
  try {
    pkgJsonPath = require.resolve('monaco-editor/package.json');
  } catch {
    return { ok: false, copied: false, reason: 'monaco-editor is not installed (run npm install)' };
  }
  const version = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version;
  const src = join(dirname(pkgJsonPath), 'min', 'vs');
  const destRoot = join(here, '..', 'public', 'monaco');
  const dest = join(destRoot, 'vs');
  const stamp = join(destRoot, '.version');

  if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === version && existsSync(dest)) {
    return { ok: true, copied: false, version };
  }
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });
  cpSync(src, dest, { recursive: true });
  writeFileSync(stamp, `${version}\n`);
  return { ok: true, copied: true, version };
}

// CLI entry point (predev/prebuild): `node scripts/copy-monaco.mjs`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = ensureMonacoAssets();
  if (!result.ok) {
    console.error(`[copy-monaco] ${result.reason}`);
    process.exit(1);
  }
  if (result.copied) {
    console.log(`[copy-monaco] monaco-editor@${result.version} -> public/monaco/vs`);
  }
}
