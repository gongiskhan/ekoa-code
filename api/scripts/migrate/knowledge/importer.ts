/**
 * Shared-corpus importer (ch04 §4.4.1 shared partition + ch10 §10.3 migration discipline).
 *
 * Bulk-migrates the old-cortex knowledge corpus into the ONE reserved shared vault partition
 * (`_shared`), which every org's search then consults. It is offline operator tooling: the sole
 * sanctioned writer of `_shared` (the online service refuses a shared-org actor). Structure mirrors
 * the ch10 import tool — dry-run by default, journaled, idempotent, read-only on the source:
 *
 *  - Walk staged collections (all source subdirs, or the `--collection` filter), parse each old
 *    markdown doc, write it to `vault/_shared/<collection>/<docId>.md`, and bulk-index it.
 *  - Idempotency: a state file (`<dataDir>/knowledge/index/shared-import-state.json`) maps
 *    `<collection>/<docId>` → source hash. A rerun skips unchanged docs, re-imports changed ones
 *    (replace semantics), and `--force` ignores the state. Flushed periodically for crash-resume.
 *  - `--prune` removes docs that are in the state but no longer in the source (off by default).
 *  - Dry-run parses + counts + journals and writes NOTHING (no vault, no index, no state).
 *
 * SAFETY: refuses (throws {@link SourceUnderDataDirError}) if the source resolves inside the
 * platform data dir — that would read the live corpus as its own import source.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { Journal } from '../journal.js';
import { writeDoc, deleteDoc, type DocFrontmatter } from '../../../src/knowledge/vault.js';
import { bulkIndexDocs, optimizeIndex, removeDoc, type IndexRow } from '../../../src/knowledge/index-store.js';
import { SHARED_ORG_ID, knowledgeRoot, dataDir, isSafeSegment } from '../../../src/knowledge/paths.js';
import { parseOldDoc } from './old-format.js';

export interface ImportOptions {
  sourceDir: string;
  /** Restrict to these collections (repeatable `--collection`); default: every source subdir. */
  collections?: string[];
  /** Cap the number of source files processed (trial runs). Prune still sees the full source. */
  limit?: number;
  /** Docs per write+index transaction (default 1000). */
  batch?: number;
  /** Write (default false = dry-run). */
  execute?: boolean;
  /** Re-import every doc, ignoring the idempotency state. */
  force?: boolean;
  /** Remove docs present in the state but missing from the source. */
  prune?: boolean;
  journalPath?: string;
  onProgress?: (line: string) => void;
}

export interface CollectionResult {
  collection: string;
  parsed: number;
  imported: number;
  skipped: number;
  malformed: number;
  anomalies: number;
  pruned: number;
}

export interface ImportResult {
  mode: 'dry-run' | 'execute';
  ok: boolean;
  /** Source files considered (after `--limit`). */
  total: number;
  parsed: number;
  /** Written (execute) or planned (dry-run) — parsed docs that were new/changed. */
  imported: number;
  skipped: number;
  malformed: number;
  /** Frontmatter-id-vs-filename disagreements (counted, not fatal). */
  anomalies: number;
  pruned: number;
  collections: CollectionResult[];
}

/** Flush the crash-resume state to disk every N batches during an execute run. */
const STATE_FLUSH_EVERY = 5;

export class SourceUnderDataDirError extends Error {}

/** Refuse a source that resolves inside (or equal to) the platform data dir — the live corpus must
 *  never be its own import source (mirrors the ch10 tool's read-only-on-source guard). */
export function assertSourceOutsideDataDir(sourceDir: string): void {
  const data = resolve(dataDir());
  const src = resolve(sourceDir);
  const rel = relative(data, src);
  const outside = rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
  if (!outside) {
    throw new SourceUnderDataDirError(
      `--source ${src} is inside the platform data dir ${data} - refusing to read the live corpus as an import source (pass a source outside EKOA_DATA_DIR)`,
    );
  }
}

interface SourceEntry {
  collection: string;
  docId: string;
  path: string;
}

const stateKey = (collection: string, docId: string): string => `${collection}/${docId}`;

function importStatePath(): string {
  return join(knowledgeRoot(), 'index', 'shared-import-state.json');
}

function readState(path: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
      return out;
    }
  } catch {
    /* missing or corrupt → start empty (state is derived, not authoritative) */
  }
  return {};
}

function writeState(path: string, state: Record<string, string>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

function mtimeIso(path: string): string {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/** The collections to walk: all safe source subdirs, or the `--collection` filter intersected with
 *  what exists on disk. Deterministic (sorted). */
function listStagedCollections(sourceDir: string, only?: string[]): string[] {
  let subdirs: string[];
  try {
    subdirs = readdirSync(sourceDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isSafeSegment(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const present = new Set(subdirs);
  if (only && only.length > 0) return only.filter((c) => isSafeSegment(c) && present.has(c)).sort();
  return subdirs.sort();
}

/** Enumerate every `<collection>/<docId>.md` under the staged collections, in deterministic order. */
function collectEntries(sourceDir: string, collections: string[]): SourceEntry[] {
  const out: SourceEntry[] = [];
  for (const collection of collections) {
    let files: string[];
    try {
      files = readdirSync(join(sourceDir, collection));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      out.push({ collection, docId: file.slice(0, -3), path: join(sourceDir, collection, file) });
    }
  }
  out.sort((a, b) => (a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0));
  return out;
}

interface PendingDoc {
  collection: string;
  docId: string;
  fm: DocFrontmatter;
  body: string;
  hash: string;
}

/** Run the shared-corpus import. Returns a per-collection + total summary; writes only in execute
 *  mode. Guards against a source under the data dir before touching anything. */
export async function runKnowledgeImport(opts: ImportOptions): Promise<ImportResult> {
  assertSourceOutsideDataDir(opts.sourceDir);

  const execute = opts.execute ?? false;
  const force = opts.force ?? false;
  const prune = opts.prune ?? false;
  const batchSize = Math.max(1, opts.batch ?? 1000);
  const mode: ImportResult['mode'] = execute ? 'execute' : 'dry-run';

  const journal = opts.journalPath ? new Journal(opts.journalPath) : null;
  journal?.line(`ekoa knowledge-import run - ${mode} - started ${new Date().toISOString()}`);
  journal?.line(`source: ${resolve(opts.sourceDir)}`);

  const staged = listStagedCollections(opts.sourceDir, opts.collections);
  const fullEntries = collectEntries(opts.sourceDir, staged);
  const sourceKeys = new Set(fullEntries.map((e) => stateKey(e.collection, e.docId)));
  const entries = opts.limit != null ? fullEntries.slice(0, Math.max(0, opts.limit)) : fullEntries;
  const total = entries.length;

  const statePath = importStatePath();
  const state = readState(statePath);
  const nextState: Record<string, string> = { ...state }; // preserve untouched entries; --force only skips the skip-check

  const byCollection = new Map<string, CollectionResult>();
  const col = (name: string): CollectionResult => {
    let c = byCollection.get(name);
    if (!c) {
      c = { collection: name, parsed: 0, imported: 0, skipped: 0, malformed: 0, anomalies: 0, pruned: 0 };
      byCollection.set(name, c);
    }
    return c;
  };

  let parsed = 0;
  let imported = 0;
  let skipped = 0;
  let malformed = 0;
  let anomalies = 0;
  let pruned = 0;
  let processed = 0;
  let batchNum = 0;
  const started = Date.now();
  const pending: PendingDoc[] = [];

  const flushBatch = async (): Promise<void> => {
    if (pending.length === 0) return;
    if (execute) {
      for (const p of pending) await writeDoc(SHARED_ORG_ID, p.collection, p.docId, p.fm, p.body);
      const rows: IndexRow[] = pending.map((p) => ({
        orgId: SHARED_ORG_ID,
        collection: p.collection,
        docId: p.docId,
        title: p.fm.title,
        body: p.body,
        createdAt: p.fm.createdAt,
        sourceUrl: p.fm.sourceUrl,
        sourceType: p.fm.sourceType,
        language: p.fm.language,
      }));
      bulkIndexDocs(rows);
    }
    for (const p of pending) {
      nextState[stateKey(p.collection, p.docId)] = p.hash;
      col(p.collection).imported++;
      imported++;
    }
    pending.length = 0;
    batchNum++;
    const elapsed = (Date.now() - started) / 1000;
    const rate = elapsed > 0 ? processed / elapsed : processed;
    const eta = rate > 0 ? Math.round((total - processed) / rate) : 0;
    opts.onProgress?.(`[knowledge-import] ${processed}/${total} docs, ${Math.round(rate)} docs/s, ETA ${eta}s`);
    if (execute && batchNum % STATE_FLUSH_EVERY === 0) writeState(statePath, nextState);
  };

  for (const e of entries) {
    processed++;
    if (!isSafeSegment(e.collection) || !isSafeSegment(e.docId)) {
      malformed++;
      col(e.collection).malformed++;
      journal?.line(`malformed (unsafe segment): ${e.collection}/${e.docId}`);
      continue;
    }
    let raw: string;
    try {
      raw = readFileSync(e.path, 'utf8');
    } catch {
      malformed++;
      col(e.collection).malformed++;
      journal?.line(`malformed (unreadable): ${e.collection}/${e.docId}`);
      continue;
    }
    const oldDoc = parseOldDoc(raw, e.docId, e.collection);
    if (!oldDoc) {
      malformed++;
      col(e.collection).malformed++;
      journal?.line(`malformed (no frontmatter/title): ${e.collection}/${e.docId}`);
      continue;
    }
    parsed++;
    col(e.collection).parsed++;
    if (oldDoc.idMismatch) {
      anomalies++;
      col(e.collection).anomalies++;
      journal?.line(`anomaly (frontmatter id != filename): ${e.collection}/${e.docId}`);
    }
    const hash = oldDoc.hash ?? sha256(raw);
    const key = stateKey(e.collection, e.docId);
    if (!force && state[key] === hash) {
      skipped++;
      col(e.collection).skipped++;
      continue;
    }
    const fm = oldDoc.fm.createdAt ? oldDoc.fm : { ...oldDoc.fm, createdAt: mtimeIso(e.path) };
    pending.push({ collection: e.collection, docId: e.docId, fm, body: oldDoc.body, hash });
    if (pending.length >= batchSize) await flushBatch();
  }
  await flushBatch();

  if (prune) {
    // Without a --collection filter, prune considers every state entry; with one, only the named
    // collections (so a targeted run never prunes collections it didn't walk).
    const scopeAll = !opts.collections || opts.collections.length === 0;
    const stagedSet = new Set(staged);
    for (const key of Object.keys(nextState)) {
      const slash = key.indexOf('/');
      if (slash === -1) continue;
      const c = key.slice(0, slash);
      const d = key.slice(slash + 1);
      if (!scopeAll && !stagedSet.has(c)) continue;
      if (sourceKeys.has(key)) continue;
      if (execute) {
        await deleteDoc(SHARED_ORG_ID, c, d);
        removeDoc(SHARED_ORG_ID, c, d);
        delete nextState[key];
      }
      pruned++;
      col(c).pruned++;
      journal?.line(`pruned (missing from source): ${c}/${d}`);
    }
  }

  if (execute) {
    writeState(statePath, nextState);
    optimizeIndex();
  }

  const result: ImportResult = {
    mode,
    ok: true,
    total,
    parsed,
    imported,
    skipped,
    malformed,
    anomalies,
    pruned,
    collections: [...byCollection.values()].sort((a, b) => (a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : 0)),
  };

  journal?.line(`counts: parsed=${parsed} imported=${imported} skipped=${skipped} malformed=${malformed} anomalies=${anomalies} pruned=${pruned}`);
  journal?.line(`ekoa knowledge-import run - ${mode} - ended ${new Date().toISOString()} - result: OK`);
  journal?.flush();

  return result;
}
