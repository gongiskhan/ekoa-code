/**
 * memvault per-tenant lexical index (slice E3) — SQLite FTS5 over the same markdown corpus
 * store.ts owns, one database file per user at `<userRoot>/.index/notes.db`.
 *
 * ISOLATION BY CONSTRUCTION, not by predicate. The knowledge index (api/src/knowledge/
 * index-store.ts, the pattern this mirrors) keeps one shared table and stamps `orgId` on every
 * row and every query. memvault does not: there is NO shared table to filter, so a
 * cross-tenant hit is not "prevented by a WHERE clause" that a future refactor could drop — it
 * has no representation. The db path is resolved through jail.indexDbFile, which containment-
 * checks the DATABASE FILE and its SQLite sidecars, not merely the directory holding them: a
 * `.index/notes.db` symlinked at another tenant's database fails closed on read AND on write.
 * (That distinction is not theoretical — the directory-only check shipped in the first cut of
 * this file and leaked both ways; see jail.indexDbFile.)
 *
 * DERIVED DATA, FILES ARE TRUTH. The markdown is the record; this index is a cache that may be
 * thrown away at any moment. Every entry point self-heals:
 *   - db missing, or replaced under us (detected by inode, not by existence) → open fresh, fill;
 *   - db present but empty, or corrupt at open or mid-query → quarantine (+ its -wal/-shm),
 *     reopen, fill, retry the operation ONCE;
 *   - an index UPDATE that failed → the service calls {@link invalidate}, which takes the handle
 *     out of the cache and deletes the db, so the next use rebuilds;
 *   - a database that opens cleanly and holds rows but no longer MATCHES the markdown → the
 *     row-count reconcile in {@link isStale}, run on every cache miss, rebuilds it.
 * The last two are what make "best effort" honest: before them a failed maintain left an index
 * that opened fine, probed non-empty and under-reported the user's own vault forever, across
 * restarts. Neither relies on an in-memory dirty flag, and the reconcile still works when the
 * file could not be deleted at all.
 * Nothing here can leak across tenants while healing: a rebuild reads only this user's tree.
 *
 * better-sqlite3 is the SAME native, synchronous driver knowledge/ already depends on (no new
 * dependency). This file deliberately never imports node:path — jail.ts is the module's single
 * path-resolution point (pinned by a grep gate in tests/security/memvault-isolation.test.ts).
 */
import Database from 'better-sqlite3';
import { statSync, unlinkSync } from 'node:fs';
import { indexDbFile, indexDbPath, JailViolationError } from './jail.js';
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

// ---------------------------------------------------------------------------------------
// Handle cache.
//
// Bounded, because a long-lived process must not hold one fd per user it has ever served —
// but a bound must NEVER be enforced by closing a handle somebody is still using. The first
// cut did exactly that (evict the oldest entry, `db.close()` it) while `useIndex` held the
// same handle across an `await`, and ordinary concurrent load past the bound turned 8 of 40
// legitimate own-vault searches into HTTP 500s ("The database connection is not open").
//
// So entries are REFERENCE-COUNTED. Eviction only ever picks an idle entry; a condemned entry
// is removed from the map at once (no new borrowers) and closed by whoever releases it last.
// If every entry is busy the cache simply runs over its target size until one frees up —
// overshooting a soft bound is a non-event, closing a live connection is a 500.
// ---------------------------------------------------------------------------------------

interface OpenIndex {
  file: string;
  db: Database.Database;
  /** Identity of the file this handle actually points at — a delete-and-replace (or a planted
   *  symlink) changes it, and the handle is then stale, not merely "missing". */
  dev: number;
  ino: number;
  /** In-flight operations holding this handle. */
  borrowers: number;
  /** Removed from the cache: no new borrowers, closed on the last release. */
  doomed: boolean;
  /** Unlink the file once the handle is really CLOSED — never while it is open: an unlinked
   *  database whose handle is still open recreates its `-wal` on close, which would then sit
   *  beside the replacement database as a stale (i.e. corrupting) journal. */
  purgeOnClose: boolean;
}

/** One operation's hold on a handle. `release` is idempotent, so every exit path may call it. */
interface Borrow {
  db: Database.Database;
  file: string;
  /** The handle is EMPTY and must be filled from the markdown before it can be trusted. */
  fresh: boolean;
  entry: OpenIndex;
  released: boolean;
}

const open = new Map<string, OpenIndex>();
/** Soft target, not a hard cap: exceeded rather than closing a borrowed handle. */
const MAX_OPEN = 32;

function closeEntry(entry: OpenIndex): void {
  if (open.get(entry.file) === entry) open.delete(entry.file);
  try {
    entry.db.close();
  } catch {
    /* already closed / file vanished — nothing to salvage, the index is derived */
  }
  if (entry.purgeOnClose) quarantine(entry.file);
}

/**
 * Take this file's handle out of service. It leaves the cache immediately (so nothing new can
 * borrow it) and is closed as soon as the last in-flight operation releases it — now, if there
 * are none. With `purge`, the file is deleted after the close; when no handle is open at all,
 * the file is deleted straight away.
 */
function condemn(file: string, purge: boolean): void {
  const entry = open.get(file);
  if (!entry) {
    if (purge) quarantine(file);
    return;
  }
  open.delete(file);
  entry.doomed = true;
  entry.purgeOnClose = entry.purgeOnClose || purge;
  if (entry.borrowers <= 0) closeEntry(entry);
}

function borrow(entry: OpenIndex, fresh: boolean): Borrow {
  entry.borrowers++;
  return { db: entry.db, file: entry.file, fresh, entry, released: false };
}

function release(b: Borrow): void {
  if (b.released) return;
  b.released = true;
  b.entry.borrowers--;
  if (b.entry.borrowers <= 0 && b.entry.doomed) closeEntry(b.entry);
}

/** Make room for one more handle by condemning IDLE entries only. Busy entries are skipped;
 *  if everything is busy the cache overshoots until an operation finishes. */
function evictIdle(): void {
  for (const entry of [...open.values()]) {
    if (open.size < MAX_OPEN) return;
    if (entry.borrowers <= 0) condemn(entry.file, false);
  }
}

/**
 * Close every per-user index. Used by test teardown; it is also the shape a process-shutdown
 * hook would call, but nothing in server.ts calls it today — the handles are released when the
 * process exits. A handle still in flight is condemned rather than yanked, and closes when its
 * operation finishes.
 */
export function closeAllIndexes(): void {
  for (const file of [...open.keys()]) condemn(file, false);
}

function identityOf(file: string): { dev: number; ino: number } | undefined {
  try {
    const st = statSync(file);
    return { dev: st.dev, ino: st.ino };
  } catch {
    return undefined;
  }
}

/** Delete a database and its sidecars. Only ever called on a jail-resolved path, and only when
 *  no handle to it is open. */
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
 * Open the index AND read one row from it.
 *
 * The read is the point, because FILE SIZE CANNOT TELL THESE APART: on this build a
 * created-but-never-filled FTS5 database is 24,576 bytes — exactly the size of a populated one
 * — so a size heuristic calls an index that holds nothing "healthy" and the vault stays
 * invisible to search forever. A zero-byte file is likewise a valid, empty database to SQLite.
 * The O(1) `SELECT rowid ... LIMIT 1` probe (never a COUNT) is what separates "has content"
 * from "has none".
 *
 * Outright damage takes the other path: a sub-page truncation does NOT read as empty here, it
 * throws SQLITE_CORRUPT ("database disk image is malformed"), and non-database bytes throw
 * SQLITE_NOTADB. Caller treats a throw and `empty` identically — neither is trustworthy, so
 * rebuild from the markdown.
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

/**
 * Is the index still a faithful projection of the markdown? Compares its row count with the
 * number of notes on disk — a difference means rows were lost or never written (a maintain that
 * failed, a partial fill, notes added out of band by a `basic-memory` client), and the honest
 * answer is to rebuild.
 *
 * Runs on a CACHE MISS only — process start, after an eviction, after the file was replaced or
 * condemned — never on the hot path, and the walk it costs is readdir-only (no file is opened).
 * This is the half of the staleness fix that survives a restart, and the half that still works
 * when the index file could not be deleted (a read-only directory): it needs no marker at all.
 *
 * KNOWN LIMIT, stated rather than hidden: counting cannot see a same-count difference — an
 * OVERWRITE whose index update failed leaves the row count intact with stale content. That case
 * is covered in-process by {@link invalidate}, which condemns the handle (forcing this very
 * cache miss) and deletes the file. It is only if BOTH the delete fails AND the process
 * restarts that a stale row can survive; the next write to that note repairs it.
 */
async function isStale(db: Database.Database, userId: string): Promise<boolean> {
  const rows = (db.prepare('SELECT COUNT(*) AS n FROM notes_fts').get() as { n: number }).n;
  return rows !== (await store.allPermalinks(userId)).length;
}

/**
 * Borrow this user's index, opening (and repairing) it if needed. Throws JailViolationError if
 * the database path — or one of its sidecars — resolves outside the tenant.
 *
 * The cache-hit path skips the jail resolution deliberately and safely: a handle is only reused
 * when the path still stats to the SAME inode it was opened on, so a symlink planted after the
 * fact changes the inode, misses the cache, and goes through the full check.
 */
async function acquire(userId: string): Promise<Borrow> {
  const { file } = indexDbPath(userId); // pure validated join — cache key only, never opened
  const cached = open.get(file);
  if (cached) {
    const id = identityOf(file);
    if (id && id.dev === cached.dev && id.ino === cached.ino) return borrow(cached, false);
    condemn(file, false); // deleted or replaced underneath us
  }

  // Cache miss: resolve through the jail (file-granular containment) BEFORE anything opens it.
  const jailed = await indexDbFile(userId);
  let fresh: boolean;
  let db: Database.Database;
  try {
    const probed = openProbed(jailed);
    db = probed.db;
    fresh = probed.empty;
  } catch {
    // Corrupt / truncated / not-a-database: the markdown is the record, so throw the file away.
    quarantine(jailed);
    db = openProbed(jailed).db;
    fresh = true;
  }
  // A database that opens cleanly and holds rows can still be WRONG. Reconcile against the
  // markdown while we are already off the hot path.
  if (!fresh && (await isStale(db, userId))) fresh = true;
  const id = identityOf(jailed);
  evictIdle();
  const entry: OpenIndex = {
    file: jailed,
    db,
    dev: id?.dev ?? -1,
    ino: id?.ino ?? -1,
    borrowers: 0,
    doomed: false,
    purgeOnClose: false,
  };
  open.set(jailed, entry);
  return borrow(entry, fresh);
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
 * Run one index operation under the self-healing contract: fill a fresh database before use,
 * and on failure discard the file, rebuild from the markdown and retry exactly once. The fill
 * is INSIDE the guarded region — it does file I/O and can fail like anything else. A second
 * failure propagates; the caller decides whether that is best-effort (writes) or an honest
 * error (search).
 *
 * A JailViolationError is re-thrown untouched: an escape is a security verdict, never something
 * to "recover" from by rebuilding (and the path it names is not ours to delete).
 *
 * If a CONCURRENT operation still holds the condemned handle, the file cannot be deleted until
 * that one finishes, so the retry may reopen the same bad database and fail. That is a rare,
 * self-correcting degradation — the next call repairs it — and the alternative (closing a
 * handle out from under a live query) is the bug this design exists to avoid.
 */
async function useIndex<T>(userId: string, fn: (db: Database.Database) => T): Promise<T> {
  let held = await acquire(userId);
  try {
    if (held.fresh) await fill(held.db, userId);
    return fn(held.db);
  } catch (e) {
    if (e instanceof JailViolationError) throw e;
    condemn(held.file, true);
    release(held); // our borrow was likely the last: closes the handle, then deletes the file
    held = await acquire(userId);
    await fill(held.db, userId);
    return fn(held.db);
  } finally {
    release(held);
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

/**
 * DISCARD this user's index, durably. Called when an index update failed: the markdown landed
 * but the index did not, so the index is now a LIE about the vault, and it will not fix itself
 * — a valid-but-stale database opens cleanly and probes non-empty, so nothing downstream would
 * ever notice. Deleting the file is the honest recovery: the next search rebuilds from the
 * markdown, and because the marker is the absence of a file rather than an in-memory flag, it
 * survives a restart.
 *
 * Throws JailViolationError rather than deleting anything if the path does not resolve inside
 * the tenant — a database symlinked at another tenant's index must never be unlinked by us.
 */
export async function invalidate(userId: string): Promise<void> {
  condemn(await indexDbFile(userId), true);
}

/** Re-index this user's whole tree from the markdown (the explicit heal path). Returns the
 *  number of notes indexed. */
export async function rebuild(userId: string): Promise<number> {
  const held = await acquire(userId);
  try {
    await fill(held.db, userId);
    return (held.db.prepare('SELECT COUNT(*) AS n FROM notes_fts').get() as { n: number }).n;
  } finally {
    release(held);
  }
}
