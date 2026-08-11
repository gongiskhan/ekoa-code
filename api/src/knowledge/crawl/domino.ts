/**
 * Knowledge Domino harvest (WS8c, ported from ekoa-dev's `cortex/src/services/
 * knowledge-domino-ingest.ts`) - for Lotus Domino sites (dgsi.pt) whose view pages render their
 * document rows via JavaScript (0 links in raw HTML). Instead of rendering, this uses Domino's
 * built-in `?ReadViewEntries` XML API, which enumerates a view's entries (with document UNIDs)
 * deterministically, no JS needed:
 *
 *   <db>/<view>?ReadViewEntries&Start=N&Count=1000
 *     -> <viewentry unid="..." .../> ...   (paged by Start/Count)
 *   <db>/0/<unid>?OpenDocument             -> the document HTML (ISO-8859-1)
 *
 * This is THE workhorse behind the 209,196 jurisprudência documents already on disk (`_shared`):
 * DGSI's 8 higher-court databases (jstj/jsta/jtrl/jtrp/jtre/jtrc/jtrg/jtca.nsf - STJ, STA, and
 * the Relação courts of Lisboa/Porto/Évora/Coimbra/Guimarães + the Tribunal Central
 * Administrativo). One source covers many databases; documents fetch concurrently with
 * conditional GETs (the ledger stores ETag/Last-Modified/hash), so re-runs skip unchanged
 * acórdãos. The runner (`runner.ts`) dispatches here when `source.kind === 'domino'`.
 */
import { createHash } from 'node:crypto';
import * as vault from '../vault.js';
import * as index from '../index-store.js';
import { assertSafeUrl, isSafeUrl } from '../../services/url-safety.js';
import { SHARED_ORG_ID } from '../paths.js';
import { knowledgeLedger, type LedgerPage } from './ledger.js';
import { extractContent, decodeHtmlBuffer, readCapped, MIN_TEXT_CHARS } from './extract.js';
import type { CrawlOptions, CrawlProgress, CrawlSummary } from './engine.js';
import type { KnowledgeSourceDoc } from '../service.js';

const DOMINO_UA = process.env.EKOA_CRAWL_USER_AGENT || 'EkoaKnowledgeBot/1.0 (+https://ekoa.io; legal knowledge crawler)';
const CONCURRENCY = Math.max(1, Number(process.env.EKOA_CRAWL_CONCURRENCY) || 4);
const FETCH_TIMEOUT_MS = Number(process.env.EKOA_CRAWL_TIMEOUT_MS) || 20_000;
const MAX_BODY_BYTES = Number(process.env.EKOA_CRAWL_MAX_BODY_BYTES) || 5_000_000;

/** Document UNIDs from a ReadViewEntries XML response (32-hex per `<viewentry>`). */
export function parseUnids(xml: string): string[] {
  const out: string[] = [];
  const re = /<viewentry\b[^>]*\bunid="([0-9A-Fa-f]{32})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push((m[1] as string).toUpperCase());
  return out;
}

/** Count of `<viewentry>` elements (to advance Start exactly, incl. any unid-less category rows). */
function countEntries(xml: string): number {
  return (xml.match(/<viewentry\b/g) || []).length;
}

/** Stable, source-scoped doc id for a Domino document. */
function dominoDocId(sourceId: string, db: string, unid: string): string {
  return `dom-${createHash('sha256').update(`${sourceId}|${db}|${unid}`, 'utf-8').digest('hex').slice(0, 40)}`;
}

/** A small-retry SSRF-guarded fetch (2 attempts on a network-level failure only - a 4xx/5xx is
 *  not retried, it is a real answer). No TLS auto-repair (see `engine.ts`'s module doc). */
async function guardedFetch(url: string, init: RequestInit, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<Response> {
  if (!isSafeUrl(url)) throw new Error('URL bloqueado (host interno/privado)');
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetchImpl(url, { ...init, signal: ctrl.signal });
      } catch (err) {
        lastErr = err;
        if (ctrl.signal.aborted) throw err;
      }
    }
    throw lastErr;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export async function crawlDominoSource(source: KnowledgeSourceDoc, opts: CrawlOptions): Promise<CrawlSummary> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date().toISOString());
  const start = Date.now();
  const startedAt = now();
  const sourceId = source._id;
  const collection = source.collection || 'jurisprudencia';
  const summary = { fetched: 0, ingested: 0, updated: 0, unchanged: 0, discovered: 0, failed: 0, capped: false };
  const finalize = (error?: string): CrawlSummary => ({
    ...summary, pendingRemaining: 0, durationMs: Date.now() - start, finishedAt: now(), ...(error ? { error } : {}),
  });

  const cfg = source.domino;
  if (!cfg || !cfg.databases?.length) return finalize('Fonte Domino sem configuração');
  assertSafeUrl(cfg.baseUrl);

  const userAgent = source.userAgent || DOMINO_UA;
  const count = cfg.count ?? 1000;
  const docBudget = Math.max(1, source.maxPages ?? 200_000);

  const ledger = new Map<string, LedgerPage>();
  for (const p of await knowledgeLedger.list(sourceId)) ledger.set(p.id, p);
  const flushLedger = () => knowledgeLedger.replaceAll(sourceId, [...ledger.values()]);

  const emit = (state: CrawlProgress['state']) =>
    opts.onProgress?.({
      sourceId, state, fetched: summary.fetched, ingested: summary.ingested, updated: summary.updated,
      unchanged: summary.unchanged, discovered: summary.discovered, failed: summary.failed, queued: 0,
      capped: summary.capped, startedAt,
    });

  const ingestDoc = async (db: string, unid: string): Promise<void> => {
    const docUrl = `${cfg.baseUrl}/${db}/0/${unid}?OpenDocument`;
    const pid = dominoDocId(sourceId, db, unid);
    const prev = ledger.get(pid);
    const cond: Record<string, string> = {};
    if (prev?.etag) cond['If-None-Match'] = prev.etag;
    if (prev?.lastModified) cond['If-Modified-Since'] = prev.lastModified;
    const res = await guardedFetch(docUrl, { headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml,*/*', ...cond } }, fetchImpl, opts.signal);
    if (res.status === 304) {
      summary.unchanged += 1;
      if (prev) ledger.set(pid, { ...prev, lastFetchedAt: now() });
      return;
    }
    if (!res.ok) {
      summary.failed += 1;
      return;
    }
    const ct = res.headers.get('content-type') || '';
    const buf = await readCapped(res, MAX_BODY_BYTES);
    const html = decodeHtmlBuffer(buf, ct);
    const content = extractContent(html, docUrl);
    if (content.text.length < MIN_TEXT_CHARS) return; // category row / empty -> skip

    const stamp = now();
    await vault.writeDoc(SHARED_ORG_ID, collection, pid, {
      title: content.title, sourceUrl: docUrl, sourceType: 'crawl', language: 'pt', createdAt: prev?.firstSeenAt || stamp,
    }, content.text);
    index.indexDoc({ orgId: SHARED_ORG_ID, collection, docId: pid, title: content.title, body: content.text, createdAt: prev?.firstSeenAt || stamp, sourceUrl: docUrl, sourceType: 'crawl', language: 'pt' });

    ledger.set(pid, {
      id: pid, sourceId, url: docUrl, depth: 0, collection,
      etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'),
      contentHash: createHash('sha256').update(content.text, 'utf-8').digest('hex'), docId: pid, title: content.title,
      status: 'ok', firstSeenAt: prev?.firstSeenAt ?? stamp, lastFetchedAt: stamp,
    });
    if (prev?.docId) summary.updated += 1; else summary.ingested += 1;
  };

  try {
    for (const dbEntry of cfg.databases) {
      if (opts.signal?.aborted || summary.fetched >= docBudget) {
        if (summary.fetched >= docBudget) summary.capped = true;
        break;
      }
      const view = dbEntry.view ?? cfg.view ?? 'Por Ano';
      const maxPagesForDb = dbEntry.maxPages && dbEntry.maxPages > 0 ? dbEntry.maxPages : Infinity;
      let dbPages = 0;
      let startPos = 1;

      while (summary.fetched < docBudget && dbPages < maxPagesForDb) {
        if (opts.signal?.aborted) break;
        const viewUrl = `${cfg.baseUrl}/${dbEntry.db}/${encodeURIComponent(view)}?ReadViewEntries&Start=${startPos}&Count=${count}`;
        let xml: string;
        try {
          const res = await guardedFetch(viewUrl, { headers: { 'User-Agent': userAgent, Accept: 'text/xml,application/xml,*/*' } }, fetchImpl, opts.signal);
          if (!res.ok) { summary.failed += 1; break; }
          xml = await res.text();
        } catch {
          summary.failed += 1;
          break;
        }

        const entries = countEntries(xml);
        if (entries === 0) break; // end of view
        const unids = parseUnids(xml);
        dbPages += 1;

        let idx = 0;
        while (idx < unids.length && summary.fetched < docBudget) {
          const take = Math.min(docBudget - summary.fetched, CONCURRENCY, unids.length - idx);
          const batch = unids.slice(idx, idx + take);
          idx += take;
          summary.fetched += take;
          await Promise.all(batch.map((unid) => ingestDoc(dbEntry.db, unid).catch(() => { summary.failed += 1; })));
          emit('running');
        }
        if (idx < unids.length) summary.capped = true;

        startPos += entries;
        if (entries < count) break; // last page
      }
    }

    await flushLedger();
    emit('done');
    return finalize();
  } catch (err) {
    await flushLedger().catch(() => {});
    return finalize(err instanceof Error ? err.message : String(err));
  }
}

export async function crawlDominoSourceById(getSource: (id: string) => Promise<KnowledgeSourceDoc | null>, sourceId: string, opts: CrawlOptions): Promise<CrawlSummary> {
  const source = await getSource(sourceId);
  if (!source) throw new Error(`Fonte não encontrada: ${sourceId}`);
  return crawlDominoSource(source, opts);
}
