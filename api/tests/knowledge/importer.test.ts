import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOldDoc } from '../../scripts/migrate/knowledge/old-format.js';
import {
  runKnowledgeImport, assertSourceOutsideDataDir, SourceUnderDataDirError,
} from '../../scripts/migrate/knowledge/importer.js';
import { search, closeIndex } from '../../src/knowledge/index-store.js';
import { readDoc } from '../../src/knowledge/vault.js';
import { SHARED_ORG_ID } from '../../src/knowledge/paths.js';

/**
 * Shared-corpus importer (ch04 §4.4.1 + ch10 §10.3). The committed old-cortex fixture is the
 * oracle: old→new field mapping is exact (date→createdAt, colon-rich URL + accented title survive,
 * sourceId dropped, JSON-encoded frontmatter in the written vault file); a malformed file is
 * counted not silently dropped; a rerun is idempotent (0), a changed doc re-imports (1); --prune
 * removes docs gone from source; a dry-run writes nothing; and a source under the data dir refuses.
 */
const FIXTURE_SOURCE = join(__dirname, '..', '..', 'scripts', 'migrate', 'knowledge', 'fixtures', 'source');

let dataDir: string;
let tmpDirs: string[];
let jn = 0;
const journal = (): string => join(dataDir, `journal-${jn++}.log`);
/** A writable copy of the fixture outside the data dir (for the mutate/prune paths). */
function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ekoa-kimport-src-'));
  cpSync(FIXTURE_SOURCE, dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'ekoa-kimport-'));
  process.env.EKOA_DATA_DIR = dataDir;
  tmpDirs = [];
  jn = 0;
});
afterEach(() => {
  closeIndex();
  delete process.env.EKOA_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe('parseOldDoc field mapping (old → new)', () => {
  it('maps date→createdAt, keeps accented title + colon-rich sourceUrl, drops sourceId, keeps hash', () => {
    const raw = readFileSync(join(FIXTURE_SOURCE, 'jurisprudencia', 'acordao-stj-2024.md'), 'utf8');
    const doc = parseOldDoc(raw, 'acordao-stj-2024', 'jurisprudencia');
    expect(doc).not.toBeNull();
    expect(doc!.docId).toBe('acordao-stj-2024');
    expect(doc!.fm.title).toBe('Acórdão do STJ de 12 de Março de 2024'); // accents survive
    expect(doc!.fm.createdAt).toBe('2024-03-12T09:30:00.000Z'); // date → createdAt
    expect(doc!.fm.sourceUrl).toBe('https://www.dgsi.pt/jstj.nsf/954f0ce6/abc:123?OpenDocument'); // colons survive
    expect(doc!.fm.sourceType).toBe('crawl');
    expect(doc!.fm.language).toBe('pt');
    expect(doc!.hash).toBe('sha256:cafe1234');
    expect(doc!.idMismatch).toBe(false);
    expect((doc!.fm as unknown as Record<string, unknown>).sourceId).toBeUndefined(); // dropped
    expect(doc!.body).toContain('Supremo Tribunal de Justiça');
  });

  it('returns null for a file with no frontmatter (malformed, surfaced not silent)', () => {
    const raw = readFileSync(join(FIXTURE_SOURCE, 'jurisprudencia', 'broken.md'), 'utf8');
    expect(parseOldDoc(raw, 'broken', 'jurisprudencia')).toBeNull();
  });

  it('flags an id/filename mismatch as an anomaly but keeps the filename as docId', () => {
    const raw = readFileSync(join(FIXTURE_SOURCE, 'legislacao', 'id-mismatch.md'), 'utf8');
    const doc = parseOldDoc(raw, 'id-mismatch', 'legislacao');
    expect(doc!.docId).toBe('id-mismatch');
    expect(doc!.idMismatch).toBe(true);
  });
});

describe('runKnowledgeImport', () => {
  it('dry-run parses + counts and writes NOTHING', async () => {
    const res = await runKnowledgeImport({ sourceDir: FIXTURE_SOURCE, execute: false, journalPath: journal() });
    expect(res.mode).toBe('dry-run');
    expect(res.total).toBe(5); // 5 source .md files
    expect(res.parsed).toBe(4); // broken.md is malformed
    expect(res.malformed).toBe(1);
    expect(res.anomalies).toBe(1); // id-mismatch.md
    expect(res.imported).toBe(4); // would import
    expect(existsSync(join(dataDir, 'knowledge', 'vault'))).toBe(false);
    expect(existsSync(join(dataDir, 'knowledge', 'index', 'fts.db'))).toBe(false);
    expect(existsSync(join(dataDir, 'knowledge', 'index', 'shared-import-state.json'))).toBe(false);
  });

  it('execute writes the shared vault (JSON-encoded frontmatter) + index and makes it searchable', async () => {
    const res = await runKnowledgeImport({ sourceDir: FIXTURE_SOURCE, execute: true, journalPath: journal() });
    expect(res.imported).toBe(4);

    const rawVault = readFileSync(join(dataDir, 'knowledge', 'vault', SHARED_ORG_ID, 'jurisprudencia', 'acordao-stj-2024.md'), 'utf8');
    expect(rawVault).toContain('title: "Acórdão do STJ de 12 de Março de 2024"'); // JSON-encoded frontmatter
    expect(rawVault).toContain('createdAt: "2024-03-12T09:30:00.000Z"');
    expect(rawVault).toContain('sourceUrl: "https://www.dgsi.pt/jstj.nsf/954f0ce6/abc:123?OpenDocument"');

    const parsed = await readDoc(SHARED_ORG_ID, 'jurisprudencia', 'acordao-stj-2024');
    expect(parsed?.fm.title).toBe('Acórdão do STJ de 12 de Março de 2024');

    // A missing date fell back to a (non-empty) ISO createdAt.
    const parecer = await readDoc(SHARED_ORG_ID, 'jurisprudencia', 'parecer-sem-data');
    expect(parecer?.fm.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Searchable from ANY org via the shared corpus.
    expect(search('orgQualquer', 'penhora', 5).map((h) => h.docId)).toContain('parecer-sem-data');
    expect(existsSync(join(dataDir, 'knowledge', 'index', 'shared-import-state.json'))).toBe(true);
  });

  it('a second execute imports 0 (idempotent); a changed doc re-imports 1', async () => {
    const src = copyFixture();
    await runKnowledgeImport({ sourceDir: src, execute: true, journalPath: journal() });
    const second = await runKnowledgeImport({ sourceDir: src, execute: true, journalPath: journal() });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(4);

    // parecer-sem-data has no frontmatter `hash` → its identity is sha256(raw); a body change re-imports it.
    const p = join(src, 'jurisprudencia', 'parecer-sem-data.md');
    writeFileSync(p, readFileSync(p, 'utf8') + '\nlinha adicional sobre arresto.\n');
    const third = await runKnowledgeImport({ sourceDir: src, execute: true, journalPath: journal() });
    expect(third.imported).toBe(1);
    expect(third.skipped).toBe(3);
  });

  it('--force re-imports every doc, ignoring the idempotency state', async () => {
    const src = copyFixture();
    await runKnowledgeImport({ sourceDir: src, execute: true, journalPath: journal() });
    const forced = await runKnowledgeImport({ sourceDir: src, execute: true, force: true, journalPath: journal() });
    expect(forced.imported).toBe(4);
    expect(forced.skipped).toBe(0);
  });

  it('--prune removes docs that are in the state but gone from the source', async () => {
    const src = copyFixture();
    await runKnowledgeImport({ sourceDir: src, execute: true, journalPath: journal() });
    expect(existsSync(join(dataDir, 'knowledge', 'vault', SHARED_ORG_ID, 'legislacao', 'id-mismatch.md'))).toBe(true);

    rmSync(join(src, 'legislacao', 'id-mismatch.md'));
    const pruned = await runKnowledgeImport({ sourceDir: src, execute: true, prune: true, journalPath: journal() });
    expect(pruned.pruned).toBe(1);
    expect(existsSync(join(dataDir, 'knowledge', 'vault', SHARED_ORG_ID, 'legislacao', 'id-mismatch.md'))).toBe(false);
    expect(search('orgX', 'divergente', 5)).toHaveLength(0);
  });

  it('refuses (and the exported guard throws) a source inside the platform data dir', async () => {
    const inside = join(dataDir, 'knowledge', 'vault', SHARED_ORG_ID);
    mkdirSync(inside, { recursive: true });
    await expect(
      runKnowledgeImport({ sourceDir: inside, execute: false, journalPath: journal() }),
    ).rejects.toBeInstanceOf(SourceUnderDataDirError);
    expect(() => assertSourceOutsideDataDir(inside)).toThrow(SourceUnderDataDirError);
  });
});
