/**
 * Knowledge crawl runner (WS8c, ported from ekoa-dev's `cortex/src/services/
 * knowledge-crawl-runner.ts`) - owns the lifecycle of background crawls so a long crawl never
 * blocks (or times out) an HTTP action. `startCrawl` kicks a crawl off asynchronously, tracks
 * live progress in memory, persists the final summary onto the source (`lastCrawledAt`/
 * `lastRefreshAt`/`lastResult`) when it finishes, and guards against two crawls of the same
 * source running at once. The route's `crawlSource` returns immediately; the UI polls
 * `crawlStatus`. The nightly scheduler (`scheduler.ts`) reuses `startCrawl`.
 *
 * Dispatches by `source.kind`: `'domino'` -> the Domino harvester, anything else (including
 * absent) -> the anchor crawler. `kind: 'api'` is DECLARED on the schema (WS8c extends
 * `KnowledgeSourceDoc` to carry it) but its execution is an explicit OPEN parity item - this
 * build refuses it with an honest error rather than silently mis-running it through the anchor
 * crawler (which would just fetch a JSON endpoint, find no HTML/links, and produce a
 * misleadingly "successful" empty result).
 */
import { crawlSourceById, type CrawlProgress, type CrawlSummary } from './engine.js';
import { crawlDominoSourceById } from './domino.js';
import { patchSourceState, type KnowledgeSourceDoc } from '../service.js';

interface RunState {
  progress: CrawlProgress;
  controller: AbortController;
  /** Resolves when the background crawl has fully settled (ingest + ledger done). */
  done: Promise<void>;
}

/** Crawls currently in flight (the running guard), keyed by source id. */
const active = new Map<string, RunState>();
/** Most-recent FINAL progress snapshot per source (kept briefly after completion, so a status
 *  poll landing just after the run ends still sees the real numbers, not "not running / no data"). */
const lastProgress = new Map<string, CrawlProgress>();

export interface StartResult {
  started: boolean;
  alreadyRunning: boolean;
}

export function isCrawlRunning(sourceId: string): boolean {
  return active.has(sourceId);
}

export function getCrawlProgress(sourceId: string): CrawlProgress | null {
  return active.get(sourceId)?.progress ?? lastProgress.get(sourceId) ?? null;
}

/** A source-id lookup bound to no particular actor - the runner operates on the RESOLVED source
 *  (already visibility-checked by the route before calling `startCrawl`), never re-derives an org. */
type SourceLookup = (id: string) => Promise<KnowledgeSourceDoc | null>;

/**
 * Start a resumable incremental update of a source in the background. Returns immediately. A
 * second call while one is in flight is a no-op (`{ alreadyRunning: true }`).
 */
export async function startCrawl(sourceId: string, lookup: SourceLookup): Promise<StartResult> {
  if (active.has(sourceId)) return { started: false, alreadyRunning: true };

  // RESERVE the slot SYNCHRONOUSLY (before any await) so two overlapping calls can't both pass
  // the guard and start concurrent crawls racing the same ledger.
  const controller = new AbortController();
  const initial: CrawlProgress = {
    sourceId, state: 'running', fetched: 0, ingested: 0, updated: 0, unchanged: 0,
    discovered: 0, failed: 0, queued: 0, capped: false, startedAt: new Date().toISOString(),
  };
  const state: RunState = { progress: initial, controller, done: Promise.resolve() };
  active.set(sourceId, state);
  lastProgress.delete(sourceId);

  const source = await lookup(sourceId);
  if (!source) {
    active.delete(sourceId);
    throw new Error(`Fonte não encontrada: ${sourceId}`);
  }
  if (source.kind === 'api') {
    active.delete(sourceId);
    throw new Error('Fontes do tipo "api" ainda não têm execução implementada (WS8c OPEN item).');
  }

  state.done = (async () => {
    let finalProgress: CrawlProgress = initial;
    try {
      const summary: CrawlSummary =
        source.kind === 'domino'
          ? await crawlDominoSourceById(lookup, sourceId, { signal: controller.signal, onProgress: (p) => { state.progress = p; } })
          : await crawlSourceById(lookup, sourceId, { signal: controller.signal, onProgress: (p) => { state.progress = p; } });
      await patchSourceState(sourceId, { lastCrawledAt: summary.finishedAt, lastRefreshAt: summary.finishedAt, lastResult: summary });
      finalProgress = { ...state.progress, ...summary, state: summary.error ? 'error' : 'done', queued: 0 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[knowledge-crawl-runner] crawl ${sourceId} failed:`, msg);
      finalProgress = { ...state.progress, state: 'error', error: msg };
    } finally {
      active.delete(sourceId);
      lastProgress.set(sourceId, finalProgress);
      // Drop the cached final snapshot after a while so a later status poll falls back to the
      // persisted source.lastResult instead of holding this closure's memory forever.
      setTimeout(() => {
        if (lastProgress.get(sourceId) === finalProgress) lastProgress.delete(sourceId);
      }, 60_000).unref?.();
    }
  })();

  return { started: true, alreadyRunning: false };
}

/** Cancel an in-flight crawl (cooperative abort). Returns whether one was running. */
export function cancelCrawl(sourceId: string): boolean {
  const state = active.get(sourceId);
  if (!state) return false;
  state.controller.abort();
  return true;
}

/**
 * Abort an in-flight crawl AND wait for it to fully stop. Use before tearing a source down so a
 * late ingest/ledger write can't repopulate after the delete. Resolves immediately if nothing is
 * running.
 */
export async function cancelCrawlAndWait(sourceId: string): Promise<boolean> {
  const state = active.get(sourceId);
  if (!state) return false;
  state.controller.abort();
  await state.done.catch(() => {});
  return true;
}

/** Test hook: drop all in-memory run state between test files/suites. */
export function __resetCrawlRunnerForTests(): void {
  active.clear();
  lastProgress.clear();
}
