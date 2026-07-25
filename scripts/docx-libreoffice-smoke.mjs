#!/usr/bin/env node
/**
 * LibreOffice conversion smoke for the Word track-changes pipeline (the docx gate, 2C-S7).
 *
 *   npm run build --workspace api && node scripts/docx-libreoffice-smoke.mjs [--require]
 *
 * WHY IT IS A SCRIPT AND NOT A TEST. Every other leg of the docx gate is a committed,
 * hermetic test (tests/apps/docx-word-gate.test.ts for the OOXML proof and the re-upload
 * round-trip, web/e2e/document-redline.spec.ts for the served review surface). This leg
 * needs `soffice` INSTALLED ON THE MACHINE, so putting it in the vitest lane would either
 * fail on machines without LibreOffice or - worse - self-skip into a green that proves
 * nothing. It stays an operator-run smoke: run it, read the verdict.
 *
 * WHAT IT PROVES. That the bytes the product actually serves open in a real word
 * processor: the working document (GET /api/app-docx/current) with native tracked changes
 * plus a resolved comment thread, AND the accepted-revisions copy (POST /api/app-docx/clean).
 * Both come out of apps/document-source.ts - the very code path the routes call - over a
 * temp EKOA_DATA_DIR, seeded from the committed redline fixture. A converter that chokes
 * on our OOXML is a real defect the structural assertions cannot see.
 *
 * Exit codes: 0 pass (or LibreOffice absent, unless --require), 1 fail.
 * A desktop Word review-pane pass remains the gold standard and is still a human step.
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'web/e2e/fixtures/contrato-redline.docx');
const DIST = join(ROOT, 'api/dist/apps/document-source.js');
const REQUIRE = process.argv.includes('--require');
const APP_ID = 'docx-libreoffice-smoke';

function log(msg) {
  process.stdout.write(`[libreoffice-smoke] ${msg}\n`);
}

function findSoffice() {
  for (const bin of ['soffice', 'libreoffice']) {
    try {
      const path = execSync(`command -v ${bin}`, { encoding: 'utf8' }).trim();
      if (path) return path;
    } catch {
      /* not on PATH */
    }
  }
  return null;
}

if (!existsSync(DIST)) {
  log('FAIL: api/dist is missing - run `npm run build --workspace api` first.');
  process.exit(1);
}

const soffice = findSoffice();
if (!soffice) {
  log('NOT RUN: neither `soffice` nor `libreoffice` is on PATH.');
  log('Install LibreOffice and re-run to exercise this leg of the docx gate.');
  process.exit(REQUIRE ? 1 : 0);
}
log(`converter: ${soffice}`);

const work = mkdtempSync(join(tmpdir(), 'ekoa-docx-soffice-'));
process.env.EKOA_DATA_DIR = join(work, 'data');

const { setSource, applyEdits, getCurrent, getClean } = await import(DIST);

// The fixture already carries two pending tracked changes and a comment thread; add a
// reply + a resolve so the converted file also exercises commentsExtended (w15:done).
await setSource(APP_ID, {
  buffer: readFileSync(FIXTURE),
  fileName: 'contrato.docx',
  origin: 'path',
});
await applyEdits(
  APP_ID,
  [
    { type: 'reply', target_id: '1', text: 'De acordo - fica um ano após a cessação.' },
    { type: 'resolve', target_id: '1' },
  ],
  { author: 'Dra. Ana Marques (Ekoa)' },
);

const produced = [];
for (const [label, get] of [
  ['current', getCurrent],
  ['clean', getClean],
]) {
  const { buffer, fileName } = await get(APP_ID);
  const path = join(work, `${label}-${fileName}`);
  writeFileSync(path, buffer);
  produced.push([label, path, buffer.length]);
  log(`produced ${label}: ${path} (${buffer.length} bytes)`);
}

let failures = 0;
for (const [label, path] of produced) {
  const outDir = join(work, `pdf-${label}`);
  try {
    execFileSync(
      soffice,
      [
        '--headless',
        `-env:UserInstallation=file://${join(work, 'profile')}`,
        '--convert-to',
        'pdf',
        '--outdir',
        outDir,
        path,
      ],
      { stdio: 'pipe', timeout: 180_000 },
    );
  } catch (err) {
    failures += 1;
    log(`FAIL ${label}: converter exited non-zero - ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  const pdf = join(outDir, `${path.split('/').pop().replace(/\.docx$/i, '')}.pdf`);
  if (!existsSync(pdf)) {
    failures += 1;
    log(`FAIL ${label}: no PDF produced at ${pdf}`);
    continue;
  }
  const size = statSync(pdf).size;
  const head = readFileSync(pdf).subarray(0, 5).toString('latin1');
  if (size <= 0 || head !== '%PDF-') {
    failures += 1;
    log(`FAIL ${label}: output is not a non-empty PDF (${size} bytes, magic "${head}")`);
    continue;
  }
  log(`PASS ${label}: ${pdf} (${size} bytes)`);
}

rmSync(work, { recursive: true, force: true });
log(failures === 0 ? 'OK - every produced .docx converted to a non-empty PDF' : `FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
