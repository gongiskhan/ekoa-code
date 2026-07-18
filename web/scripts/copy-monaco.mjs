#!/usr/bin/env node
/**
 * Copy monaco-editor's AMD distribution (min/vs) into public/monaco/vs.
 *
 * WHY: the dashboard CSP is script-src 'self' (next.config.ts, ch09 D1) - the
 * @monaco-editor/loader default pulls from cdn.jsdelivr.net, which the CSP blocks
 * (the file-editor dialog then dies with "Monaco initialization: error"). Serving
 * the tree same-origin keeps the CSP intact and needs no bundler involvement
 * (dev is Turbopack, prod build is webpack - the runtime AMD loader sidesteps
 * both). Runs as predev/prebuild; a version stamp makes re-runs a no-op.
 * public/monaco/ is gitignored (~10 MB of vendored assets).
 */
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgJsonPath = require.resolve('monaco-editor/package.json');
const version = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version;
const src = join(dirname(pkgJsonPath), 'min', 'vs');
const destRoot = join(here, '..', 'public', 'monaco');
const dest = join(destRoot, 'vs');
const stamp = join(destRoot, '.version');

if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === version && existsSync(dest)) {
  process.exit(0); // already current
}
rmSync(destRoot, { recursive: true, force: true });
mkdirSync(destRoot, { recursive: true });
cpSync(src, dest, { recursive: true });
writeFileSync(stamp, `${version}\n`);
console.log(`[copy-monaco] monaco-editor@${version} -> public/monaco/vs`);
