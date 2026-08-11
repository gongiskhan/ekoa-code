/**
 * Knowledge crawl ledger (WS8c). The per-page registry that makes incremental refresh cheap and
 * a crawl RESUMABLE: for every page a crawl has fetched we keep its ETag, Last-Modified, and the
 * content hash of the extracted text, plus the knowledge doc id it maps to. A page's status is
 * `pending` (discovered, not yet fetched - the persisted FRONTIER), `ok`, or `error`. A refresh
 * replays each `ok`/`error` page with a conditional GET (If-None-Match / If-Modified-Since) so an
 * unchanged page 304s and is skipped without re-parsing.
 *
 * SHAPE DECISION (ported from ekoa-dev's `cortex/src/persistence/knowledge-ledger.ts`, matched
 * deliberately, not reinvented): one JSON file per source at
 * `<dataDir>/knowledge/ledger/<sourceId>.json`, holding a flat array of `LedgerPage`. Two reasons
 * to match rather than diverge:
 *   1. It is already proven at THIS corpus's real scale - `~/.ekoa/data/knowledge/ledger/` holds
 *      199MB across 14 files powering the actual 262k-document `_shared` corpus this repo reads.
 *   2. CONTINUITY: this repo's WS8b seed reuses the exact source ids ekoa-dev's runtime
 *      `~/.ekoa/data/knowledge/sources.json` already carries (see `sources.seed.json`'s
 *      comment). Matching the ledger's path means a source's pre-existing ledger file - if one
 *      exists on a given machine - is picked up automatically: the crawl sees 262k pages already
 *      `ok` with validators and does an incremental refresh, never a fresh crawl of the whole
 *      corpus. A different path/id scheme would silently orphan that history and make the FIRST
 *      "Atualizar" click attempt to re-fetch every page live - exactly what must never happen.
 *      On a machine with no such history (CI, a fresh deploy) this is simply an empty ledger,
 *      identical to any new source.
 *
 * One JSON file per source keeps a resumed crawl's flush O(N) (bulk replace) rather than the
 * O(N^2) of per-page upserts, and keeps sources isolated (a corrupt/huge file for one source never
 * touches another's). A simple in-process write queue per resolved path serializes concurrent
 * writers (mirrors the vault's per-file-write discipline) - single-process only, matching this
 * repo's "one api process per data dir" operating assumption elsewhere (mongo, the FTS index).
 */
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { knowledgeRoot } from '../paths.js';

/**
 * - `pending` : discovered but not yet fetched - the persisted crawl FRONTIER. A run drains
 *   pending pages first (new content) and a budget-capped run leaves the rest here so the next
 *   run resumes instead of restarting.
 * - `ok`      : fetched successfully (carries validators + docId).
 * - `error`   : last fetch failed (retried next run).
 */
export type LedgerPageStatus = 'pending' | 'ok' | 'error';

export interface LedgerPage {
  /** Stable id = sha1(url) hex - a re-crawl of the same URL upserts in place. */
  id: string;
  sourceId: string;
  url: string;
  /** Depth at which this page was discovered (0 = seed). */
  depth: number;
  collection: string;
  /** HTTP validators captured on the last 200, for conditional GETs. */
  etag?: string | null;
  lastModified?: string | null;
  /** sha256 of the last extracted body text - content-change fallback when no validators (render mode). */
  contentHash?: string | null;
  /** Knowledge doc id this page currently maps to (null if not ingested). */
  docId?: string | null;
  title?: string;
  status: LedgerPageStatus;
  firstSeenAt: string;
  lastFetchedAt: string;
  /** Last time the content actually changed (ingested/updated). */
  lastChangedAt?: string | null;
  error?: string | null;
}

function ledgerDir(): string {
  return join(knowledgeRoot(), 'ledger');
}

function ledgerPath(sourceId: string): string {
  // sourceId is typically a uuid (safe charset) but sanitize defensively - this becomes a filename.
  const safe = String(sourceId).replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
  return join(ledgerDir(), `${safe}.json`);
}

/** Stable per-URL id (matches the doc-id derivation the crawl engine uses for consistency). */
export function pageId(url: string): string {
  return createHash('sha1').update(url).digest('hex');
}

// Per-path write queue - a concurrent `replaceAll` for the SAME source serializes rather than
// interleaving two writers' output (the crawl's periodic flush + a final flush at run end, or two
// racing manual "Atualizar" clicks the runner's running-guard is meant to prevent in the first place).
const writeQueues = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  writeQueues.set(key, run.then(() => undefined, () => undefined));
  return run;
}

async function readPages(path: string): Promise<LedgerPage[]> {
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as LedgerPage[]) : [];
  } catch (err) {
    // A corrupt ledger file (partial write from a crash) must not crash the crawl - it is
    // regenerable (derived data, same posture as the FTS index): treat as empty and let the
    // next flush rewrite it cleanly. The vault/corpus itself is untouched either way.
    console.warn(`[knowledge-crawl-ledger] unreadable ledger at ${path}, treating as empty:`, err instanceof Error ? err.message : err);
    return [];
  }
}

/** Atomic-enough write: write to a temp file then rename over the target, so a crash mid-write
 *  never leaves a half-written (unparseable) ledger file for the next boot to trip over. */
async function writePages(path: string, pages: LedgerPage[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(pages), 'utf8');
  await rename(tmp, path);
}

export const knowledgeLedger = {
  /** All pages recorded for a source. */
  async list(sourceId: string): Promise<LedgerPage[]> {
    return readPages(ledgerPath(sourceId));
  },

  /**
   * Bulk-replace a source's whole ledger in one write. The crawl loads the ledger into memory
   * once, mutates it per page, and flushes it back with this - O(N) disk instead of the O(N^2)
   * churn of per-page upserts.
   */
  async replaceAll(sourceId: string, pages: LedgerPage[]): Promise<void> {
    const path = ledgerPath(sourceId);
    await enqueue(path, () => writePages(path, pages));
  },

  /** Drop the whole ledger for a source (used when a source is deleted). */
  async clear(sourceId: string): Promise<void> {
    const path = ledgerPath(sourceId);
    await enqueue(path, async () => {
      await rm(path, { force: true });
    });
  },

  /** Page counts by status (the Sources tab's "X indexadas / Y por indexar" line). */
  async stats(sourceId: string): Promise<{ total: number; pending: number; ok: number; error: number; withDoc: number }> {
    const pages = await readPages(ledgerPath(sourceId));
    let pending = 0, ok = 0, error = 0, withDoc = 0;
    for (const p of pages) {
      if (p.status === 'pending') pending++;
      else if (p.status === 'ok') ok++;
      else if (p.status === 'error') error++;
      if (p.docId) withDoc++;
    }
    return { total: pages.length, pending, ok, error, withDoc };
  },

  /** Test/ops hook: the resolved on-disk path for a source's ledger. */
  pathFor(sourceId: string): string {
    return ledgerPath(sourceId);
  },
};
