/**
 * The lexical index (ch04 §4.4.1): SQLite FTS5 over the same markdown corpus the vault owns.
 * It is DERIVED DATA — regenerable from the filesystem, never migrated — but persisted across
 * restarts to avoid the multi-minute backfill (§6.2).
 *
 * Design points fixed by the spec:
 *  - Accent-folded matching: the `unicode61 remove_diacritics 2` tokenizer folds diacritics on
 *    BOTH sides, so a query for "acoes" finds "ações" (and vice-versa) with no app-side folding.
 *  - BM25 relevance with a title weight, then a collection-authority multiplier (a firm's
 *    authoritative collections — its legal spine — outrank incidental matches on a tie).
 *  - Org partition on EVERY row and EVERY query: `orgId` is stored on each row and every search
 *    filters by it, so a cross-org search is structurally impossible (proven by test).
 *  - Write/delete hooks (called by the service) and a startup backfill / admin reindex.
 *
 * better-sqlite3 is a native, synchronous driver. This module is the ONLY importer of it. If the
 * native build is unavailable on a host, the spec's sanctioned fallback (a ripgrep-style scan
 * over the same files) would sit behind this same interface — on this build the native path is
 * live (RUN_LOG decision).
 */
import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { indexDbPath, SHARED_ORG_ID } from './paths.js';

export interface IndexRow {
  orgId: string;
  collection: string;
  docId: string;
  title: string;
  body: string;
  createdAt?: string;
  sourceUrl?: string;
  sourceType?: string;
  language?: string;
}

export interface SearchHit {
  docId: string;
  collection: string;
  title: string;
  sourceUrl?: string;
  snippet: string;
  score: number;
  /** Which partition the hit came from: the caller's own vault, or the shared corpus. The row's
   *  orgId itself never surfaces on a hit (a caller must not learn the shared id or its own). */
  scope: 'org' | 'shared';
}

/** Collection-authority weight: a firm's authoritative legal collections outrank incidental
 *  matches on an otherwise-equal BM25 score. Deterministic, keyword-based, default 1.0. */
export function collectionAuthority(collection: string): number {
  const c = collection.toLowerCase();
  if (c.includes('spine') || c.includes('espinha')) return 1.5;
  if (c.includes('legal') || c.includes('shared') || c.includes('jurisprud')) return 1.25;
  return 1.0;
}

// Portuguese + English stopwords: dropped from the MATCH query so grounding never triggers on
// grammatical filler ("de", "the"). Small and deterministic.
const STOPWORDS = new Set([
  'de', 'a', 'o', 'e', 'do', 'da', 'em', 'um', 'uma', 'os', 'as', 'no', 'na', 'por', 'para', 'com',
  'que', 'se', 'dos', 'das', 'ao', 'aos', 'pela', 'pelo', 'sua', 'seu', 'ou',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'for', 'on', 'with', 'as', 'at', 'by',
]);

/** Turn free text into a safe FTS5 MATCH expression: fold to tokens, drop stopwords/short tokens,
 *  quote each (so punctuation can never inject FTS operators), OR-join for recall. Returns null
 *  when nothing meaningful remains (→ the caller stays silent). */
export function toMatchQuery(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  if (tokens.length === 0) return null;
  // de-dup preserving order
  const seen = new Set<string>();
  const uniq = tokens.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  return uniq.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

let db: Database.Database | undefined;
let openPath: string | undefined;

function connect(): Database.Database {
  const want = indexDbPath();
  if (db && openPath === want) return db;
  if (db) {
    db.close();
    db = undefined;
  }
  if (!existsSync(dirname(want))) mkdirSync(dirname(want), { recursive: true });
  const d = new Database(want);
  d.pragma('journal_mode = WAL');
  // WAL-safe durability trade: NORMAL fsyncs at checkpoints, not every commit — the bulk import of
  // a large corpus is otherwise fsync-bound, and the index is derived data (a lost tail rebuilds).
  d.pragma('synchronous = NORMAL');
  d.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
       orgId UNINDEXED, collection UNINDEXED, docId UNINDEXED,
       title, body,
       createdAt UNINDEXED, sourceUrl UNINDEXED, sourceType UNINDEXED, language UNINDEXED,
       tokenize = 'unicode61 remove_diacritics 2'
     );`,
  );
  // Doc-identity → fts rowid side map (same regenerable db). The FTS5 columns are all UNINDEXED, so
  // a DELETE keyed on (orgId, collection, docId) is a full table scan — O(table) per write, which
  // does not scale to a 500k-row shared corpus. The map turns every write/delete into a point
  // lookup + `DELETE ... WHERE rowid = ?`. It is derived data: rebuilt from one fts scan whenever
  // it drifts from the fts table (below), never migrated.
  d.exec(
    `CREATE TABLE IF NOT EXISTS knowledge_doc_map (
       orgId TEXT NOT NULL, collection TEXT NOT NULL, docId TEXT NOT NULL,
       ftsRowid INTEGER NOT NULL,
       PRIMARY KEY (orgId, collection, docId)
     ) WITHOUT ROWID;`,
  );
  db = d;
  openPath = want;
  healDocMap(d);
  return d;
}

/** Self-heal the doc-map on open: if its row count differs from the fts table (a pre-map index, a
 *  crash between the two writes, or any drift), rebuild it from one fts scan. Derived data — no
 *  migration. Runs once per connection open; a fresh db has both counts 0 and is a no-op. */
function healDocMap(d: Database.Database): void {
  const ftsCount = (d.prepare('SELECT COUNT(*) AS n FROM knowledge_fts').get() as { n: number }).n;
  const mapCount = (d.prepare('SELECT COUNT(*) AS n FROM knowledge_doc_map').get() as { n: number }).n;
  if (ftsCount === mapCount) return;
  const rows = d.prepare('SELECT rowid, orgId, collection, docId FROM knowledge_fts').all() as {
    rowid: number; orgId: string; collection: string; docId: string;
  }[];
  const ins = d.prepare('INSERT OR REPLACE INTO knowledge_doc_map(orgId, collection, docId, ftsRowid) VALUES (?, ?, ?, ?)');
  const tx = d.transaction(() => {
    d.exec('DELETE FROM knowledge_doc_map');
    for (const r of rows) ins.run(r.orgId, r.collection, r.docId, r.rowid);
  });
  tx();
}

/** Insert-or-replace one document's row (the write hook). A single-row {@link bulkIndexDocs}, so
 *  the replace-by-map semantics are identical to a batched import. */
export function indexDoc(row: IndexRow): void {
  bulkIndexDocs([row]);
}

/**
 * Bulk insert-or-replace (the importer's write path): ONE transaction for the whole batch, with
 * map-based replace semantics — re-indexing a docId that already exists deletes its old fts row by
 * rowid and re-inserts, so a re-bulk of the same doc replaces it with no duplicate rows. Prepared
 * statements are hoisted out of the loop. A single {@link indexDoc} routes through here too.
 */
export function bulkIndexDocs(rows: IndexRow[]): void {
  if (rows.length === 0) return;
  const d = connect();
  const findRowid = d.prepare('SELECT ftsRowid FROM knowledge_doc_map WHERE orgId = ? AND collection = ? AND docId = ?');
  const delFts = d.prepare('DELETE FROM knowledge_fts WHERE rowid = ?');
  const insFts = d.prepare(
    `INSERT INTO knowledge_fts(orgId, collection, docId, title, body, createdAt, sourceUrl, sourceType, language)
     VALUES (@orgId, @collection, @docId, @title, @body, @createdAt, @sourceUrl, @sourceType, @language)`,
  );
  const upsertMap = d.prepare(
    `INSERT INTO knowledge_doc_map(orgId, collection, docId, ftsRowid) VALUES (?, ?, ?, ?)
     ON CONFLICT(orgId, collection, docId) DO UPDATE SET ftsRowid = excluded.ftsRowid`,
  );
  const tx = d.transaction((batch: IndexRow[]) => {
    for (const r of batch) {
      const existing = findRowid.get(r.orgId, r.collection, r.docId) as { ftsRowid: number } | undefined;
      if (existing) delFts.run(existing.ftsRowid);
      const info = insFts.run({
        orgId: r.orgId,
        collection: r.collection,
        docId: r.docId,
        title: r.title,
        body: r.body,
        createdAt: r.createdAt ?? '',
        sourceUrl: r.sourceUrl ?? '',
        sourceType: r.sourceType ?? '',
        language: r.language ?? '',
      });
      upsertMap.run(r.orgId, r.collection, r.docId, info.lastInsertRowid);
    }
  });
  tx(rows);
}

/** FTS5 optimize: merge the b-tree segments into one for query-time speed after a bulk import.
 *  Off the hot path — the importer calls it once at the end of an execute run. */
export function optimizeIndex(): void {
  connect().prepare(`INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize')`).run();
}

/** Remove one document's row (the delete hook): map lookup → point delete by rowid. */
export function removeDoc(orgId: string, collection: string, docId: string): void {
  const d = connect();
  const tx = d.transaction(() => {
    const existing = d.prepare('SELECT ftsRowid FROM knowledge_doc_map WHERE orgId = ? AND collection = ? AND docId = ?').get(orgId, collection, docId) as { ftsRowid: number } | undefined;
    if (!existing) return;
    d.prepare('DELETE FROM knowledge_fts WHERE rowid = ?').run(existing.ftsRowid);
    d.prepare('DELETE FROM knowledge_doc_map WHERE orgId = ? AND collection = ? AND docId = ?').run(orgId, collection, docId);
  });
  tx();
}

/** Drop every row for an org (used before an org reindex). Deletes the fts rows by rowid via the
 *  map, then the org's map rows — so only the target partition is touched. */
export function clearOrg(orgId: string): void {
  const d = connect();
  const tx = d.transaction(() => {
    const rows = d.prepare('SELECT ftsRowid FROM knowledge_doc_map WHERE orgId = ?').all(orgId) as { ftsRowid: number }[];
    const delFts = d.prepare('DELETE FROM knowledge_fts WHERE rowid = ?');
    for (const r of rows) delFts.run(r.ftsRowid);
    d.prepare('DELETE FROM knowledge_doc_map WHERE orgId = ?').run(orgId);
  });
  tx();
}

interface RawHit {
  orgId: string;
  docId: string;
  collection: string;
  title: string;
  sourceUrl: string;
  snip: string;
  score: number;
}

/**
 * Dual-scope lexical search: accent-folded BM25 (title-weighted) re-ranked by collection authority.
 * A search consults the caller's OWN partition AND the reserved shared corpus (`_shared`), and
 * NOTHING else — a cross-org search remains structurally impossible. When the caller IS the shared
 * partition the two ids collapse to one (no duplicate scope). Each hit carries `scope` derived from
 * its row's orgId; the orgId itself never surfaces.
 */
export function search(orgId: string, query: string, limit = 5): SearchHit[] {
  const match = toMatchQuery(query);
  if (!match) return [];
  const d = connect();
  // The caller's partition + the shared corpus. `IN (?, ?)` with equal ids when the caller is the
  // shared partition collapses to a single-partition scan with no duplicate rows.
  const shared = orgId === SHARED_ORG_ID ? orgId : SHARED_ORG_ID;
  // Over-fetch so the authority re-rank has candidates, then trim to `limit`.
  const rows = d
    .prepare(
      // bm25 weights are positional over EVERY column (incl. UNINDEXED): only title (col 3) and
      // body (col 4) carry weight; title is up-weighted so a title hit outranks a body-only hit.
      // Adding orgId to the SELECT does not shift the weights — bm25 is keyed on table columns.
      `SELECT orgId, docId, collection, title, sourceUrl,
              snippet(knowledge_fts, -1, '', '', ' … ', 12) AS snip,
              bm25(knowledge_fts, 0.0, 0.0, 0.0, 10.0, 1.0, 0.0, 0.0, 0.0, 0.0) AS score
       FROM knowledge_fts
       WHERE knowledge_fts MATCH ? AND orgId IN (?, ?)
       ORDER BY score
       LIMIT ?`,
    )
    .all(match, orgId, shared, Math.max(limit * 4, limit)) as RawHit[];
  // bm25 is smaller-is-better (negative); relevance = -score, then scale by authority.
  const ranked = rows
    .map((r) => ({
      docId: r.docId,
      collection: r.collection,
      title: r.title,
      sourceUrl: r.sourceUrl || undefined,
      snippet: r.snip,
      score: -r.score * collectionAuthority(r.collection),
      scope: (r.orgId === SHARED_ORG_ID ? 'shared' : 'org') as 'org' | 'shared',
    }))
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

export interface IndexStatus {
  documentCount: number;
  collectionCount: number;
}

/** Per-org index counts (org-admin heal surface). */
export function orgStatus(orgId: string): IndexStatus {
  const row = connect()
    .prepare('SELECT COUNT(*) AS documentCount, COUNT(DISTINCT collection) AS collectionCount FROM knowledge_fts WHERE orgId = ?')
    .get(orgId) as { documentCount: number; collectionCount: number };
  return { documentCount: row.documentCount, collectionCount: row.collectionCount };
}

/** Total rows across all orgs (backfill emptiness check). */
export function totalRows(): number {
  return (connect().prepare('SELECT COUNT(*) AS n FROM knowledge_fts').get() as { n: number }).n;
}

/** Ensure the index directory exists (used by boot before a scan writes rows). */
export async function ensureIndexDir(): Promise<void> {
  await mkdir(dirname(indexDbPath()), { recursive: true });
}

/** Close the DB handle (tests; graceful shutdown). Safe to call when never opened. */
export function closeIndex(): void {
  if (db) {
    db.close();
    db = undefined;
    openPath = undefined;
  }
}
