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
import { indexDbPath } from './paths.js';

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
  d.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
       orgId UNINDEXED, collection UNINDEXED, docId UNINDEXED,
       title, body,
       createdAt UNINDEXED, sourceUrl UNINDEXED, sourceType UNINDEXED, language UNINDEXED,
       tokenize = 'unicode61 remove_diacritics 2'
     );`,
  );
  db = d;
  openPath = want;
  return d;
}

/** Insert-or-replace one document's row (the write hook). */
export function indexDoc(row: IndexRow): void {
  const d = connect();
  const tx = d.transaction((r: IndexRow) => {
    d.prepare('DELETE FROM knowledge_fts WHERE orgId = ? AND collection = ? AND docId = ?').run(r.orgId, r.collection, r.docId);
    d.prepare(
      `INSERT INTO knowledge_fts(orgId, collection, docId, title, body, createdAt, sourceUrl, sourceType, language)
       VALUES (@orgId, @collection, @docId, @title, @body, @createdAt, @sourceUrl, @sourceType, @language)`,
    ).run({
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
  });
  tx(row);
}

/** Remove one document's row (the delete hook). */
export function removeDoc(orgId: string, collection: string, docId: string): void {
  connect().prepare('DELETE FROM knowledge_fts WHERE orgId = ? AND collection = ? AND docId = ?').run(orgId, collection, docId);
}

/** Drop every row for an org (used before an org reindex). */
export function clearOrg(orgId: string): void {
  connect().prepare('DELETE FROM knowledge_fts WHERE orgId = ?').run(orgId);
}

interface RawHit {
  docId: string;
  collection: string;
  title: string;
  sourceUrl: string;
  snip: string;
  score: number;
}

/** Org-partitioned lexical search: accent-folded BM25 (title-weighted) re-ranked by
 *  collection authority. Only ever returns rows for the given org. */
export function search(orgId: string, query: string, limit = 5): SearchHit[] {
  const match = toMatchQuery(query);
  if (!match) return [];
  const d = connect();
  // Over-fetch so the authority re-rank has candidates, then trim to `limit`.
  const rows = d
    .prepare(
      // bm25 weights are positional over EVERY column (incl. UNINDEXED): only title (col 3) and
      // body (col 4) carry weight; title is up-weighted so a title hit outranks a body-only hit.
      `SELECT docId, collection, title, sourceUrl,
              snippet(knowledge_fts, -1, '', '', ' … ', 12) AS snip,
              bm25(knowledge_fts, 0.0, 0.0, 0.0, 10.0, 1.0, 0.0, 0.0, 0.0, 0.0) AS score
       FROM knowledge_fts
       WHERE knowledge_fts MATCH ? AND orgId = ?
       ORDER BY score
       LIMIT ?`,
    )
    .all(match, orgId, Math.max(limit * 4, limit)) as RawHit[];
  // bm25 is smaller-is-better (negative); relevance = -score, then scale by authority.
  const ranked = rows
    .map((r) => ({
      docId: r.docId,
      collection: r.collection,
      title: r.title,
      sourceUrl: r.sourceUrl || undefined,
      snippet: r.snip,
      score: -r.score * collectionAuthority(r.collection),
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
