/**
 * memvault per-tenant lexical index (slice E3) — SQLite FTS5 over the same markdown corpus
 * store.ts owns, one database file per user at `<userRoot>/.index/notes.db`.
 *
 * ISOLATION BY CONSTRUCTION, not by predicate. The knowledge index (api/src/knowledge/
 * index-store.ts, the pattern this mirrors) keeps one shared table and stamps `orgId` on every
 * row and every query. memvault does not: there is NO shared table to filter, so a
 * cross-tenant hit is not "prevented by a WHERE clause" that a future refactor could drop — it
 * has no representation. The db path is minted by the jail from the validated userId, exactly
 * like a note path, so a pre-planted `.index` symlink fails closed too.
 *
 * DERIVED DATA, FILES ARE TRUTH. The markdown is the record; this index is a cache that can be
 * thrown away at any moment. Every entry point therefore self-heals:
 *   - db file missing (never created, deleted, or replaced under us — detected by inode, not
 *     just existence) → open fresh and rebuild from the markdown;
 *   - db file present but corrupt/truncated (SQLITE_NOTADB and friends, whether it surfaces at
 *     open or mid-query) → quarantine the file (+ its -wal/-shm), open fresh, rebuild, retry
 *     the operation ONCE.
 * Nothing here can leak across tenants while healing: a rebuild reads only this user's tree.
 *
 * Writes are best-effort from the service's point of view — the markdown lands first and an
 * index failure never fails the call (it gets its own audit line); the rebuild path is what
 * makes that safe.
 *
 * better-sqlite3 is the SAME native, synchronous driver knowledge/ already depends on (no new
 * dependency). This file deliberately never imports node:path — jail.ts is the module's single
 * path-resolution point (pinned by a grep gate in tests/security/memvault-isolation.test.ts).
 */
import Database from 'better-sqlite3';
import { statSync, unlinkSync } from 'node:fs';
import { ensureIndexDir, indexDbPath } from './jail.js';
import * as store from './store.js';

/** What a note contributes to the index. Structurally satisfied by store.StoredNote. */
export interface IndexedNote {
  permalink: string;
  title: string;
  tags: string[];
  contentMd: string;
}

export interface NoteHit {
  permalink: string;
  title: string;
  snippet?: string;
  score?: number;
}

/**
 * Free text → a safe FTS5 MATCH expression: fold to tokens, quote each (so punctuation can
 * never inject an FTS operator such as NEAR/`*`/`"`), OR-join for recall — BM25 does the
 * ranking. Returns null when nothing tokenizable remains, which the caller answers with zero
 * hits rather than a syntax error.
 *
 * Deliberately a LOCAL 12-line copy of the knowledge/ helper rather than an import: memvault is
 * a sibling capability, and coupling a per-user notes index to the org knowledge subsystem to
 * save a dozen lines would be the wrong dependency.
 */
export function toMatchQuery(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const seen = new Set<string>();
  const uniq = tokens.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  return uniq.map((t) => `"${t}"`).join(' OR ');
}

/** Open handles, keyed by db file path. Bounded: memvault is per user, so an idle process must
 *  not hold one fd per user it has ever served. */
interface OpenIndex {
  db: Database.Database;
  /** Identity of the file this handle actually points at — a delete-and-replace (or a test
   *  wiping the vault root) changes it, and the handle is then stale, not merely "missing". */
  dev: number;
  ino: number;
}
const open = new Map<string, OpenIndex>();
const MAX_OPEN = 32;

function closeHandle(file: string): void {
  const h = open.get(file);
  if (!h) return;
  open.delete(file);
  try {
    h.db.close();
  } catch {
    /* already closed / file vanished — nothing to salvage, the index is derived */
  }
}

/** Close every open per-user index (graceful shutdown; test teardown). */
export function closeAllIndexes(): void {
  for (const file of [...open.keys()]) closeHandle(file);
}

function identityOf(file: string): { dev: number; ino: number } | undefined {
  try {
    const st = statSync(file);
    return { dev: st.dev, ino: st.ino };
  } catch {
    return undefined;
  }
}

/** Discard a db that could not be opened or queried, together with its sidecars — a stale WAL
 *  against a freshly created database is its own corruption. */
function quarantine(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    try {
      unlinkSync(f);
    } catch {
      /* absent already */
    }
  }
}

function openAt(file: string): Database.Database {
  const d = new Database(file);
  d.pragma('journal_mode = WAL');
  // Derived data: a lost tail rebuilds from the markdown, so the per-commit fsync is not worth
  // paying (same trade as knowledge/index-store.ts).
  d.pragma('synchronous = NORMAL');
  d.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
       permalink UNINDEXED,
       title, tags, body,
       tokenize = 'unicode61 remove_diacritics 2'
     );`,
  );
  return d;
}

/**
 * Open the index AND read one row from it. The read is the point: not every damaged file
 * announces itself at open time. A database truncated below one full page still has an intact
 * header, so SQLite reads it as a zero-page — i.e. EMPTY — database and `CREATE TABLE IF NOT
 * EXISTS` succeeds silently; an index that has quietly lost everything looks perfectly healthy
 * until someone asks it for rows. `empty` (an O(1) probe, never a count) and a throw are handled
 * the same way by the caller: neither is trustworthy, so rebuild from the markdown. A zero-byte
 * file falls out of this for free — SQLite treats it as a valid new, empty database.
 */
function openProbed(file: string): { db: Database.Database; empty: boolean } {
  const db = openAt(file);
  try {
    return { db, empty: db.prepare('SELECT rowid FROM notes_fts LIMIT 1').get() === undefined };
  } catch (e) {
    try {
      db.close();
    } catch {
      /* nothing to salvage */
    }
    throw e;
  }
}

/** Open (creating if needed) this user's index. `fresh` means the caller is holding an EMPTY
 *  database that has not yet been filled from the markdown. */
async function acquire(userId: string): Promise<{ db: Database.Database; file: string; fresh: boolean }> {
  const { file } = indexDbPath(userId);
  const cached = open.get(file);
  if (cached) {
    const id = identityOf(file);
    if (id && id.dev === cached.dev && id.ino === cached.ino) return { db: cached.db, file, fresh: false };
    closeHandle(file); // deleted or replaced underneath us
  }
  await ensureIndexDir(userId);
  let fresh: boolean;
  let db: Database.Database;
  try {
    const probed = openProbed(file);
    db = probed.db;
    fresh = probed.empty;
  } catch {
    // Corrupt/truncated/not-a-database: the markdown is the record, so throw the file away.
    quarantine(file);
    db = openProbed(file).db;
    fresh = true;
  }
  const id = identityOf(file);
  if (open.size >= MAX_OPEN) {
    const oldest = open.keys().next();
    if (!oldest.done) closeHandle(oldest.value);
  }
  open.set(file, { db, dev: id?.dev ?? -1, ino: id?.ino ?? -1 });
  return { db, file, fresh };
}

/** Drop every row and re-index the user's whole tree from the markdown, in one transaction. */
async function fill(db: Database.Database, userId: string): Promise<void> {
  const notes: IndexedNote[] = [];
  for (const permalink of await store.allPermalinks(userId)) {
    const note = await store.readNote(userId, permalink);
    if (note) notes.push(note);
  }
  const wipe = db.prepare('DELETE FROM notes_fts');
  const ins = db.prepare('INSERT INTO notes_fts(permalink, title, tags, body) VALUES (?, ?, ?, ?)');
  const tx = db.transaction((rows: IndexedNote[]) => {
    wipe.run();
    for (const n of rows) ins.run(n.permalink, n.title, n.tags.join(' '), n.contentMd);
  });
  tx(notes);
}

/**
 * Run one synchronous index operation with the self-healing contract: fill a fresh database
 * before use, and on ANY failure from the sqlite layer discard the file, rebuild from the
 * markdown and retry exactly once. A second failure propagates — the caller decides whether
 * that is best-effort (writes) or an honest error (search).
 */
async function useIndex<T>(userId: string, fn: (db: Database.Database) => T): Promise<T> {
  const first = await acquire(userId);
  if (first.fresh) await fill(first.db, userId);
  try {
    return fn(first.db);
  } catch {
    closeHandle(first.file);
    quarantine(first.file);
    const second = await acquire(userId);
    await fill(second.db, userId);
    return fn(second.db);
  }
}

interface RawHit {
  permalink: string;
  title: string;
  snip: string;
  score: number;
}

/**
 * Search ONE tenant's notes. Accent-folded BM25 with a title weight (a title match outranks a
 * body-only match) and tags between the two. Returns [] for an untokenizable query.
 */
export async function search(userId: string, query: string, limit = 20): Promise<NoteHit[]> {
  const match = toMatchQuery(query);
  if (!match) return [];
  const rows = await useIndex(userId, (db) =>
    db
      .prepare(
        // bm25 weights are positional over EVERY column, including UNINDEXED ones:
        // (permalink, title, tags, body).
        `SELECT permalink, title,
                snippet(notes_fts, -1, '', '', ' … ', 12) AS snip,
                bm25(notes_fts, 0.0, 10.0, 4.0, 1.0) AS score
           FROM notes_fts
          WHERE notes_fts MATCH ?
          ORDER BY score
          LIMIT ?`,
      )
      .all(match, Math.max(1, limit)) as RawHit[],
  );
  // bm25 is smaller-is-better (negative); publish relevance as larger-is-better.
  return rows.map((r) => ({ permalink: r.permalink, title: r.title, snippet: r.snip, score: -r.score }));
}

/** Insert-or-replace one note's row (the write hook). Replace-by-permalink, so re-indexing an
 *  already-indexed note — including a note a concurrent rebuild just inserted — never
 *  duplicates it. */
export async function indexNote(userId: string, note: IndexedNote): Promise<void> {
  await useIndex(userId, (db) => {
    const del = db.prepare('DELETE FROM notes_fts WHERE permalink = ?');
    const ins = db.prepare('INSERT INTO notes_fts(permalink, title, tags, body) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      del.run(note.permalink);
      ins.run(note.permalink, note.title, note.tags.join(' '), note.contentMd);
    })();
  });
}

/** Remove one note's row (the delete hook). A no-op when it was never indexed. */
export async function removeNote(userId: string, permalink: string): Promise<void> {
  await useIndex(userId, (db) => {
    db.prepare('DELETE FROM notes_fts WHERE permalink = ?').run(permalink);
  });
}

/** Re-index this user's whole tree from the markdown (admin/heal path; also what the
 *  self-healing entry points call internally). Returns the number of notes indexed. */
export async function rebuild(userId: string): Promise<number> {
  const { db } = await acquire(userId);
  await fill(db, userId);
  return (db.prepare('SELECT COUNT(*) AS n FROM notes_fts').get() as { n: number }).n;
}

/** Row count for this user's index (tests / heal surface). */
export async function indexedCount(userId: string): Promise<number> {
  return useIndex(userId, (db) => (db.prepare('SELECT COUNT(*) AS n FROM notes_fts').get() as { n: number }).n);
}
