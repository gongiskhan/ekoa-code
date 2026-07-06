#!/usr/bin/env node
/**
 * App-files upload — committed, re-runnable end-to-end driver (dev-serve).
 *
 * Proves the full consumer contract from INSIDE a served jsx-app page:
 *   1. registers a throwaway dev app via POST /api/dev/register,
 *   2. opens /apps/<id>/ in headless chromium,
 *   3. runs `window.__ekoa.uploadFile(new File([...], 'Cartão de Cidadão.pdf',
 *      { type: 'application/pdf' }))` in the page,
 *   4. asserts the returned `{ id, url, name, size, type }` shape and that the
 *      RELATIVE url fetches 200 with byte-identical content,
 *   5. exercises `__ekoa.deleteFile` round-trip on a second file.
 *
 * Restart survival: run once normally, then restart cortex, then re-run with
 *   node tests/e2e/app-files-upload.e2e.mjs --verify-only '<url>' '<sha256>'
 * which only asserts the previously returned url still serves the same bytes.
 *
 * The backend port is read from <repo>/backend.port (the repo's single source
 * of truth for dev ports). Requires a running dev cortex (dev-serve routes are
 * disabled in production).
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
const DEV_ID = 'dev-e2e-app-files';

const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function fail(msg) {
  console.error(`E2E FAIL: ${msg}`);
  process.exit(1);
}

async function verifyUrl(url, expectedHash) {
  const res = await fetch(`${BASE}${url}`);
  if (res.status !== 200) fail(`GET ${url} -> ${res.status} (expected 200)`);
  const got = Buffer.from(await res.arrayBuffer());
  if (sha256(got) !== expectedHash) fail(`GET ${url} bytes differ from upload`);
  const ct = res.headers.get('content-type');
  if (ct !== 'application/pdf') fail(`GET ${url} content-type ${ct} (expected application/pdf)`);
}

// --verify-only <url> <sha256>: post-restart persistence check, no browser.
if (process.argv[2] === '--verify-only') {
  const [, , , url, hash] = process.argv;
  if (!url || !hash) fail('--verify-only needs <url> <sha256>');
  await verifyUrl(url, hash);
  console.log(`E2E PASS (verify-only): ${url} serves identical bytes after restart`);
  process.exit(0);
}

// 1. Scaffold + register a minimal dev app.
const projectDir = mkdtempSync(join(tmpdir(), 'ekoa-e2e-app-files-'));
mkdirSync(join(projectDir, 'frontend', 'src'), { recursive: true });
writeFileSync(
  join(projectDir, 'manifest.json'),
  JSON.stringify({
    id: DEV_ID,
    name: 'App-files e2e',
    version: '1.0.0',
    entryPoint: 'frontend/src/index.jsx',
    outputDir: 'dist/',
    type: 'jsx-app',
  }, null, 2),
);
writeFileSync(
  join(projectDir, 'frontend', 'src', 'index.jsx'),
  [
    "import { createRoot } from 'react-dom/client';",
    "createRoot(document.getElementById('root')).render(<h1>app-files e2e</h1>);",
    '',
  ].join('\n'),
);

const reg = await fetch(`${BASE}/api/dev/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: DEV_ID, dir: projectDir, name: 'App-files e2e' }),
});
if (!reg.ok) fail(`dev register -> ${reg.status}: ${await reg.text()}`);

// 2-5. Drive the served page.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const resp = await page.goto(`${BASE}/apps/${DEV_ID}/`, { waitUntil: 'load' });
  if (!resp || !resp.ok()) fail(`page load -> ${resp && resp.status()}`);
  await page.waitForFunction(() => window.__ekoa && typeof window.__ekoa.uploadFile === 'function');

  const uploaded = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'Cartão de Cidadão.pdf', {
      type: 'application/pdf',
    });
    return window.__ekoa.uploadFile(file);
  }, Array.from(PDF_BYTES));

  const { id, url, name, size, type } = uploaded ?? {};
  if (!id || !url) fail(`uploadFile returned ${JSON.stringify(uploaded)}`);
  if (url !== `/api/app-files/${DEV_ID}/${id}`) fail(`unexpected url: ${url}`);
  if (name !== 'Cartão de Cidadão.pdf') fail(`unicode name not preserved: ${name}`);
  if (size !== PDF_BYTES.length) fail(`size ${size} != ${PDF_BYTES.length}`);
  if (type !== 'application/pdf') fail(`type ${type}`);
  await verifyUrl(url, sha256(PDF_BYTES));

  // deleteFile round-trip on a second file.
  const gone = await page.evaluate(async () => {
    const f = new File([new Uint8Array([1, 2, 3])], 'temp.bin', { type: 'application/octet-stream' });
    const up = await window.__ekoa.uploadFile(f);
    const ok = await window.__ekoa.deleteFile(up.id);
    const after = await fetch(up.url);
    return { ok, status: after.status, again: await window.__ekoa.deleteFile(up.id) };
  });
  if (gone.ok !== true) fail('deleteFile did not return true');
  if (gone.status !== 404) fail(`GET after delete -> ${gone.status} (expected 404)`);
  if (gone.again !== false) fail('second deleteFile did not return false');

  console.log('E2E PASS: uploadFile shape + byte-identical serve + deleteFile round-trip');
  console.log(`RESTART_CHECK: node tests/e2e/app-files-upload.e2e.mjs --verify-only '${url}' '${sha256(PDF_BYTES)}'`);
} finally {
  await browser.close();
  rmSync(projectDir, { recursive: true, force: true });
}
