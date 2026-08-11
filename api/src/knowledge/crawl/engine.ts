/**
 * Knowledge crawl engine (WS8c, ported from ekoa-dev's `cortex/src/services/knowledge-crawl.ts`,
 * re-authored against THIS repo's vault + FTS index) - RESUMABLE, incremental, single-mode
 * "update", writing exclusively into the reserved `_shared` corpus (ch04 §4.4.1: `_shared` is
 * written ONLY by the offline importer CLI and now this crawler - both are internal system
 * components, neither is a request actor, so neither goes through the actor-gated
 * `ingestDocument`/`assertNotSharedActor` path; they call `vault`/`index-store` directly).
 *
 * The per-page LEDGER (`./ledger.ts`) IS the work queue. Each page is `pending` (discovered,
 * unfetched - the FRONTIER), `ok`, or `error`. One run:
 *   1. drains pending pages FIRST (new content, fetched fresh), discovering more links →
 *      persisted as new pending;
 *   2. re-checks already-fetched pages with conditional GETs (If-None-Match/If-Modified-Since) -
 *      a 304 is skipped without re-parsing, a changed page is re-ingested;
 *   3. stops at the per-run page budget (`source.maxPages`). Whatever frontier remains stays
 *      `pending`, so the NEXT run resumes exactly there instead of restarting.
 *
 * DELIBERATE CUTS vs. upstream (stated in the WS8c parity ledger row, not silent):
 *   - No PDF/office document extraction (`extract.ts`'s `docExtFor` recognizes and SKIPS a
 *     document link during discovery rather than fetching-then-dropping it).
 *   - No automatic TLS intermediate-chain repair (`tlsAwareFetch` upstream) - plain `fetch`.
 *     A source behind a broken cert chain (this repo found DGERT's crawl fails wholesale) is
 *     seeded `enabled: false` with a stated reason instead of silently shipping a broken source.
 *   - No `caCerts` manual pin.
 * All three are named OPEN items in `docs/dev-parity.md`, not silently dropped.
 */
import { createHash } from 'node:crypto';
import * as vault from '../vault.js';
import * as index from '../index-store.js';
import { assertSafeUrl, isSafeUrl } from '../../services/url-safety.js';
import { getSharedBrowser } from '../../services/browser-pool.js';
import { SHARED_ORG_ID } from '../paths.js';
import { knowledgeLedger, pageId, type LedgerPage } from './ledger.js';
import { docExtFor, extractContent, extractLinks, inScope, normalizeUrl, decodeHtmlBuffer, readCapped, MIN_TEXT_CHARS } from './extract.js';
import type { KnowledgeSourceDoc } from '../service.js';

const USER_AGENT = process.env.EKOA_CRAWL_USER_AGENT || 'EkoaKnowledgeBot/1.0 (+https://ekoa.io; legal knowledge crawler)';
const CONCURRENCY = Number(process.env.EKOA_CRAWL_CONCURRENCY) || 4;
const POLITE_DELAY_MS = Number(process.env.EKOA_CRAWL_DELAY_MS) || 200;
const FETCH_TIMEOUT_MS = Number(process.env.EKOA_CRAWL_TIMEOUT_MS) || 20_000;
const MAX_BODY_BYTES = Number(process.env.EKOA_CRAWL_MAX_BODY_BYTES) || 5_000_000;
const RENDER_TIMEOUT_MS = Number(process.env.EKOA_CRAWL_RENDER_TIMEOUT_MS) || 45_000;
const RENDER_SETTLE_MS = Number(process.env.EKOA_CRAWL_RENDER_SETTLE_MS) || 2_500;

export interface CrawlProgress {
  sourceId: string;
  state: 'running' | 'done' | 'error';
  fetched: number;
  ingested: number;
  updated: number;
  unchanged: number;
  discovered: number;
  failed: number;
  queued: number;
  capped: boolean;
  startedAt: string;
  error?: string;
}

export interface CrawlSummary {
  fetched: number;
  ingested: number;
  updated: number;
  unchanged: number;
  discovered: number;
  failed: number;
  capped: boolean;
  pendingRemaining?: number;
  durationMs: number;
  finishedAt: string;
  error?: string;
}

export interface CrawlOptions {
  onProgress?: (p: CrawlProgress) => void;
  signal?: AbortSignal;
  /** Inject fetch for tests (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Clock for tests (defaults to `() => new Date().toISOString()`). */
  now?: () => string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex');
}

/** A readable title for a binary document (unused while extraction is deferred, kept for the
 *  day it lands so callers don't need to change). */
function docTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return name || u.hostname;
  } catch {
    return url;
  }
}

/** Stable, SOURCE-scoped doc id for a crawled page: each (source, url) owns its own doc, so two
 *  sources crawling the same URL never collide on one file. */
function crawlDocId(sourceId: string, url: string): string {
  return createHash('sha1').update(`${sourceId}|${url}`).digest('hex');
}

/** Normalize a body the same way the vault's write path expects - collapses CRLF and trims, so
 *  the content hash used for change detection is stable across re-fetches of identical content. */
function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

interface FetchResult {
  status: number;
  ok: boolean;
  notModified: boolean;
  html?: string;
  etag?: string | null;
  lastModified?: string | null;
  isHtml: boolean;
  isDoc?: boolean;
  error?: string;
}

async function fetchPage(
  url: string,
  conditional: { etag?: string | null; lastModified?: string | null } | undefined,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  userAgent?: string,
): Promise<FetchResult> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'User-Agent': userAgent || USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
    };
    if (conditional?.etag) headers['If-None-Match'] = conditional.etag;
    if (conditional?.lastModified) headers['If-Modified-Since'] = conditional.lastModified;

    const res = await fetchImpl(url, { headers, redirect: 'follow', signal: ctrl.signal });
    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const isHtml = contentType.includes('html') || contentType === '';

    if (res.status === 304) return { status: 304, ok: false, notModified: true, etag, lastModified, isHtml };
    if (!res.ok) {
      try { await res.arrayBuffer(); } catch { /* drain to free the socket */ }
      return { status: res.status, ok: false, notModified: false, etag, lastModified, isHtml, error: `HTTP ${res.status}` };
    }
    if (!isHtml) {
      // A recognized document (PDF/office): extraction is deferred (module doc) - do not read
      // the body, just report it as a doc so the caller can skip it cleanly.
      if (docExtFor(contentType, url)) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        return { status: res.status, ok: true, notModified: false, etag, lastModified, isHtml: false, isDoc: true };
      }
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { status: res.status, ok: true, notModified: false, etag, lastModified, isHtml: false };
    }

    const buf = await readCapped(res, MAX_BODY_BYTES);
    const html = decodeHtmlBuffer(buf, contentType);
    return { status: res.status, ok: true, notModified: false, html, etag, lastModified, isHtml: true };
  } catch (err) {
    return { status: 0, ok: false, notModified: false, isHtml: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Fetch a page with the SHARED headless-browser pool (`services/browser-pool.ts`, already used
 * by artifact screenshots) and return its rendered HTML - for JS/SPA sources (e.g. ACT's JS
 * mega-menu) whose static HTML carries no content/links. No conditional GET (the browser has no
 * ETag); render-mode change detection relies purely on the content hash.
 */
async function renderPage(url: string, signal?: AbortSignal, userAgent?: string): Promise<FetchResult> {
  const aborted = (): FetchResult => ({ status: 0, ok: false, notModified: false, isHtml: false, error: 'aborted' });
  if (signal?.aborted) return aborted();
  let context: import('playwright').BrowserContext | null = null;
  try {
    const browser = await getSharedBrowser();
    if (signal?.aborted) return aborted();
    context = await browser.newContext({ userAgent: userAgent || USER_AGENT });
    const page = await context.newPage();
    const onAbort = () => void page.close().catch(() => {});
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
      const status = resp?.status() ?? 0;
      if (status >= 400) return { status, ok: false, notModified: false, isHtml: true, error: `HTTP ${status}` };
      await page.waitForTimeout(RENDER_SETTLE_MS);
      if (signal?.aborted) return aborted();
      const full = await page.content();
      const html =
        Buffer.byteLength(full, 'utf8') > MAX_BODY_BYTES
          ? Buffer.from(full, 'utf8').subarray(0, MAX_BODY_BYTES).toString('utf8')
          : full;
      return { status: status || 200, ok: true, notModified: false, html, isHtml: true };
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  } catch (err) {
    if (signal?.aborted) return aborted();
    return { status: 0, ok: false, notModified: false, isHtml: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

export async function crawlSource(source: KnowledgeSourceDoc, opts: CrawlOptions): Promise<CrawlSummary> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date().toISOString());
  const start = Date.now();
  const startedAt = now();
  const sourceId = source._id;
  const collection = source.collection || 'documentos';
  const scope = source.scope ?? 'same-domain';
  const levels = source.levels ?? 1;

  const summary = { fetched: 0, ingested: 0, updated: 0, unchanged: 0, discovered: 0, failed: 0, capped: false };
  const finalize = (error?: string): CrawlSummary => ({
    ...summary, durationMs: Date.now() - start, finishedAt: now(), ...(error ? { error } : {}),
  });

  const normalizedSeed = normalizeUrl(source.url);
  if (!normalizedSeed) return finalize('URL da fonte inválido');
  // Re-bound after the guard because `handle()` below is a hoisted function declaration, and the
  // narrowing from that early return does not reach inside it - the scope check TypeScript applies
  // to a hoisted declaration cannot know it only ever runs after the guard.
  const seed: string = normalizedSeed;

  const ledger = new Map<string, LedgerPage>();
  for (const p of await knowledgeLedger.list(sourceId)) ledger.set(p.id, p);

  // Self-prime: ensure every resolved seed (source.url + explicit `seeds` + the `seedTemplate`
  // expansion) is in the frontier. Adds only MISSING seeds, so a re-run is fully resumable.
  const seedUrls = resolveSeeds(source).map((u) => normalizeUrl(u)).filter((u): u is string => !!u);
  for (const s of seedUrls.length ? seedUrls : [seed]) {
    const sid = pageId(s);
    if (!ledger.has(sid)) {
      ledger.set(sid, { id: sid, sourceId, url: s, depth: 0, collection, status: 'pending', firstSeenAt: startedAt, lastFetchedAt: '' });
    }
  }

  interface QItem { id: string; url: string; depth: number; recheck: boolean }
  const pendingItems: QItem[] = [];
  const recheckItems: QItem[] = [];
  for (const p of ledger.values()) {
    if (p.status === 'pending') pendingItems.push({ id: p.id, url: p.url, depth: p.depth, recheck: false });
    else if (p.status === 'ok' || p.status === 'error') recheckItems.push({ id: p.id, url: p.url, depth: p.depth, recheck: true });
  }
  pendingItems.sort((a, b) => a.depth - b.depth);
  recheckItems.sort((a, b) => (ledger.get(a.id)?.lastFetchedAt || '').localeCompare(ledger.get(b.id)?.lastFetchedAt || ''));
  const queue: QItem[] = [...pendingItems, ...recheckItems];
  const queuedIds = new Set<string>(ledger.keys());
  const budget = Math.max(1, source.maxPages ?? 2000);
  let outstanding = 0;
  let dispatched = 0;
  let dirty = 0;

  const flush = async () => { await knowledgeLedger.replaceAll(sourceId, [...ledger.values()]); dirty = 0; };

  const emit = (state: CrawlProgress['state']) =>
    opts.onProgress?.({
      sourceId, state, fetched: summary.fetched, ingested: summary.ingested, updated: summary.updated,
      unchanged: summary.unchanged, discovered: summary.discovered, failed: summary.failed,
      queued: queue.length, capped: summary.capped, startedAt,
    });

  const ingestExtracted = async (url: string, text: string, docTitle: string, prev: LedgerPage | undefined, ts: string): Promise<{ docId: string | null; contentHash: string | null; changedAt: string | null }> => {
    if (text.length < MIN_TEXT_CHARS) return { docId: prev?.docId ?? null, contentHash: prev?.contentHash ?? null, changedAt: prev?.lastChangedAt ?? null };
    const newHash = sha256(normalizeBody(text));
    const stableId = crawlDocId(sourceId, url);
    if (prev && prev.contentHash === newHash && prev.docId === stableId) {
      summary.unchanged += 1;
      return { docId: stableId, contentHash: newHash, changedAt: prev.lastChangedAt ?? null };
    }
    await vault.writeDoc(SHARED_ORG_ID, collection, stableId, {
      title: docTitle, sourceUrl: url, sourceType: 'crawl', language: 'pt', createdAt: prev?.firstSeenAt || ts,
    }, text);
    index.indexDoc({ orgId: SHARED_ORG_ID, collection, docId: stableId, title: docTitle, body: text, createdAt: prev?.firstSeenAt || ts, sourceUrl: url, sourceType: 'crawl', language: 'pt' });
    if (prev?.docId) summary.updated += 1; else summary.ingested += 1;
    return { docId: stableId, contentHash: newHash, changedAt: ts };
  };

  async function handle(item: QItem): Promise<void> {
    const prev = ledger.get(item.id);
    const ts = now();

    if (!isSafeUrl(item.url)) {
      summary.failed += 1;
      ledger.set(item.id, {
        id: item.id, sourceId, url: item.url, depth: item.depth, collection,
        etag: prev?.etag ?? null, lastModified: prev?.lastModified ?? null, contentHash: prev?.contentHash ?? null,
        docId: prev?.docId ?? null, title: prev?.title, status: 'error',
        firstSeenAt: prev?.firstSeenAt ?? ts, lastFetchedAt: ts, lastChangedAt: prev?.lastChangedAt ?? null,
        error: 'URL bloqueado (host interno/privado)',
      });
      return;
    }

    const conditional = item.recheck && prev && (prev.etag || prev.lastModified) ? { etag: prev.etag, lastModified: prev.lastModified } : undefined;
    const looksLikeDoc = docExtFor('', item.url) !== null;
    const res = source.render && !looksLikeDoc
      ? await renderPage(item.url, opts.signal, source.userAgent)
      : await fetchPage(item.url, conditional, fetchImpl, opts.signal, source.userAgent);

    if (opts.signal?.aborted) return;

    if (res.notModified) {
      summary.unchanged += 1;
      if (prev) ledger.set(item.id, { ...prev, status: 'ok', lastFetchedAt: ts, error: null });
      return;
    }

    if (res.isDoc) {
      // Recognized document link - discovery skipped it already (see the frontier-add filter
      // below); reaching here means the SEED itself is a doc URL. Record honestly, no extraction.
      ledger.set(item.id, {
        id: item.id, sourceId, url: item.url, depth: item.depth, collection,
        etag: res.etag ?? null, lastModified: res.lastModified ?? null, contentHash: prev?.contentHash ?? null,
        docId: prev?.docId ?? null, title: prev?.title ?? docTitleFromUrl(item.url), status: 'ok',
        firstSeenAt: prev?.firstSeenAt ?? ts, lastFetchedAt: ts, lastChangedAt: prev?.lastChangedAt ?? null,
        error: null,
      });
      return;
    }

    if (!res.ok || (res.isHtml && !res.html)) {
      summary.failed += 1;
      ledger.set(item.id, {
        id: item.id, sourceId, url: item.url, depth: item.depth, collection,
        etag: res.etag ?? prev?.etag ?? null, lastModified: res.lastModified ?? prev?.lastModified ?? null,
        contentHash: prev?.contentHash ?? null, docId: prev?.docId ?? null, title: prev?.title, status: 'error',
        firstSeenAt: prev?.firstSeenAt ?? ts, lastFetchedAt: ts, lastChangedAt: prev?.lastChangedAt ?? null,
        error: res.error ?? `HTTP ${res.status}`,
      });
      return;
    }

    summary.fetched += 1;
    let title = prev?.title;
    let docId = prev?.docId ?? null;
    let contentHash = prev?.contentHash ?? null;
    let changedAt = prev?.lastChangedAt ?? null;

    if (res.isHtml && res.html) {
      const content = extractContent(res.html, item.url);
      title = content.title;
      const ing = await ingestExtracted(item.url, content.text, content.title, prev, ts);
      docId = ing.docId; contentHash = ing.contentHash; changedAt = ing.changedAt;

      if (item.depth < levels) {
        for (const link of extractLinks(res.html, item.url)) {
          const lid = pageId(link);
          if (queuedIds.has(lid)) continue;
          if (!isSafeUrl(link)) continue;
          if (!inScope(link, seed, scope)) continue;
          if (docExtFor('', link)) continue; // document link - extraction deferred (module doc)
          queuedIds.add(lid);
          ledger.set(lid, { id: lid, sourceId, url: link, depth: item.depth + 1, collection, status: 'pending', firstSeenAt: ts, lastFetchedAt: '' });
          queue.push({ id: lid, url: link, depth: item.depth + 1, recheck: false });
          summary.discovered += 1;
        }
      }
    }

    ledger.set(item.id, {
      id: item.id, sourceId, url: item.url, depth: item.depth, collection,
      etag: res.etag ?? null, lastModified: res.lastModified ?? null, contentHash, docId, title,
      status: 'ok', firstSeenAt: prev?.firstSeenAt ?? ts, lastFetchedAt: ts, lastChangedAt: changedAt, error: null,
    });
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (opts.signal?.aborted) return;
      if (dispatched >= budget) {
        if (queue.length > 0) summary.capped = true;
        return;
      }
      const item = queue.shift();
      if (item === undefined) {
        if (outstanding === 0) return;
        await sleep(20);
        continue;
      }
      outstanding += 1;
      dispatched += 1;
      try {
        await handle(item);
      } catch (err) {
        summary.failed += 1;
        console.warn('[knowledge-crawl] handle error:', err instanceof Error ? err.message : err);
      } finally {
        outstanding -= 1;
      }
      dirty += 1;
      if (dirty >= 50) await flush().catch(() => {});
      emit('running');
      if (POLITE_DELAY_MS > 0) await sleep(POLITE_DELAY_MS);
    }
  }

  emit('running');
  let runError: string | undefined;
  try {
    await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()));
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
  }

  if (opts.signal?.aborted && queue.length > 0) summary.capped = true;
  await flush().catch((err) => console.warn('[knowledge-crawl] ledger flush failed:', err instanceof Error ? err.message : err));

  let pendingRemaining = 0;
  for (const p of ledger.values()) if (p.status === 'pending') pendingRemaining += 1;

  const result = { ...finalize(runError), pendingRemaining };
  emit('done');
  return result;
}

/** Every seed URL for a source: `url`, any explicit `seeds`, and the `seedTemplate` expansion -
 *  deduped, `url` first. Pure (ported from ekoa-dev's `resolveSeeds`). */
export function resolveSeeds(source: Pick<KnowledgeSourceDoc, 'url' | 'seeds' | 'seedTemplate'>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u: string) => { if (u && !seen.has(u)) { seen.add(u); out.push(u); } };
  add(source.url);
  for (const s of source.seeds ?? []) add(s);
  const t = source.seedTemplate;
  if (t && Number.isSafeInteger(t.from) && Number.isSafeInteger(t.to) && t.from <= t.to) {
    const step = Number.isSafeInteger(t.step as number) && (t.step as number) >= 1 ? (t.step as number) : 1;
    const MAX_TEMPLATE_SEEDS = 100_000;
    let count = 0;
    for (let n = t.from; n <= t.to && count < MAX_TEMPLATE_SEEDS; n += step, count++) {
      add(t.url.replace(/\{n\}/gi, String(n)));
    }
  }
  return out;
}

/** Convenience: load a source and crawl it. Throws if the source is gone. */
export async function crawlSourceById(getSource: (id: string) => Promise<KnowledgeSourceDoc | null>, sourceId: string, opts: CrawlOptions): Promise<CrawlSummary> {
  const source = await getSource(sourceId);
  if (!source) throw new Error(`Fonte não encontrada: ${sourceId}`);
  // A source's own URL must itself pass the same SSRF gate every fetch does (defense in depth -
  // it was already checked at write time, this catches a hand-edited store row).
  assertSafeUrl(source.url);
  return crawlSource(source, opts);
}
