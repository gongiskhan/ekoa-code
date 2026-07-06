import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, createWriteStream, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAppFiles, streamFiles, safeZipName } from '../../src/services/app-archive.js';
import { SecretCommitError } from '../../src/services/commit-guard.js';

// Planted credential assembled at runtime so the fixture never exists as a
// literal on disk (the repo's own gitleaks gate stays strict).
const plantedKey = ['sk-ant', 'api03', 'FAKE'.repeat(6)].join('-');


/**
 * App archive (spec/07 §7.9 code-egress door): zips the working copy (excluding
 * build/VCS/data noise) and refuses to archive a tree containing a credential -
 * the guard verdict the download route turns into 422 SECRET_GUARD_BLOCKED.
 */

describe('app-archive', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'archive-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('collects the user files and excludes build/VCS/data noise', async () => {
    writeFileSync(join(dir, 'index.html'), '<!doctype html>hi', 'utf-8');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.ts'), 'export const x = 1;', 'utf-8');
    // Excluded trees.
    mkdirSync(join(dir, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;', 'utf-8');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'bundle.js'), 'x', 'utf-8');

    const files = await collectAppFiles(dir);
    const rels = files.map((f) => f.rel).sort();
    expect(rels).toEqual(['index.html', 'src/main.ts']);
  });

  it('streams a PK zip whose entries include the collected file names', async () => {
    writeFileSync(join(dir, 'hello.txt'), 'world', 'utf-8');
    writeFileSync(join(dir, 'readme.md'), '# app', 'utf-8');
    const files = await collectAppFiles(dir);

    const zipPath = join(dir, 'out.zip');
    // Write the zip into a sibling temp (not under the collected tree).
    const outPath = join(tmpdir(), `out-${Date.now()}.zip`);
    const out = createWriteStream(outPath);
    const res = await streamFiles(files, out);
    expect(res.files).toBe(2);

    const buf = readFileSync(outPath);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK'); // zip local-file-header magic
    // Entry names are stored in plaintext in the local file headers.
    expect(buf.includes(Buffer.from('hello.txt'))).toBe(true);
    expect(buf.includes(Buffer.from('readme.md'))).toBe(true);
    rmSync(outPath, { force: true });
    void zipPath;
  });

  it('refuses to archive a tree containing a credential (guard verdict)', async () => {
    writeFileSync(join(dir, 'app.js'), 'const html = "<h1>ok</h1>";', 'utf-8');
    // Synthetic, checksum-invalid fake credential (matches the Anthropic key rule).
    writeFileSync(join(dir, 'config.js'), `const key = "${plantedKey}";`, 'utf-8');

    await expect(collectAppFiles(dir)).rejects.toBeInstanceOf(SecretCommitError);
    try {
      await collectAppFiles(dir);
    } catch (err) {
      expect((err as SecretCommitError).findings.some((f) => f.path === 'config.js')).toBe(true);
    }
  });

  it('safeZipName sanitizes to a filesystem-safe base', () => {
    expect(safeZipName('Gestor de Clientes!!')).toBe('gestor-de-clientes');
    expect(safeZipName('')).toBe('app');
  });
});
