import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crawlSource, resolveSeeds } from '../../../src/knowledge/crawl/engine.js';
import { knowledgeLedger } from '../../../src/knowledge/crawl/ledger.js';
import { closeIndex, search } from '../../../src/knowledge/index-store.js';
import { SHARED_ORG_ID } from '../../../src/knowledge/paths.js';
import type { KnowledgeSourceDoc } from '../../../src/knowledge/service.js';

/**
 * WS8c - the anchor crawl engine against a REAL local HTTP server serving fixture pages (never a
 * live site). `source.url` is a real public hostname (`https://www.pgdlisboa.pt`) so it clears
 * the SSRF guard exactly like production traffic; the injected `fetchImpl` rewrites that origin
 * to the fixture server before the socket opens, so this is real HTTP transport against fixtures,
 * not a mocked `crawlSource` call.
 */
const REAL_HOST = 'https://www.pgdlisboa.pt';
// A SECOND real-looking public hostname, also rewritten to the local fixture server below - lets
// the `scope: 'any'` test prove cross-origin discovery without ever making a real outbound
// request (the fixture server is the only thing either origin actually resolves to in-test).
const OFFSITE_HOST = 'https://outro-portal.pt';
let server: Server;
let port: number;
let dir: string;
let requestLog: string[] = [];

const PAGES: Record<string, string> = {
  '/': `<html><head><title>Índice</title></head><body><main>
    <p>página inicial com conteúdo suficientemente longo para passar o piso mínimo exigido</p>
    <a href="/a">Lei A</a>
    <a href="/relatorio.pdf">PDF (não deve ser seguido)</a>
    <a href="http://127.0.0.1:1/internal">host interno (não deve ser seguido)</a>
    <a href="${OFFSITE_HOST}/x">fora do domínio (só seguido com scope: any)</a>
  </main></body></html>`,
  '/a': `<html><head><title>Lei A</title></head><body><main>
    <p>texto da lei A com conteúdo suficientemente longo para o piso mínimo de extração</p>
    <a href="/b">Lei B</a>
  </main></body></html>`,
  '/b': `<html><head><title>Lei B</title></head><body><main>
    <p>texto da lei B, uma norma sobre prescrição de créditos em matéria civil portuguesa</p>
  </main></body></html>`,
  '/x': `<html><head><title>Portal Externo</title></head><body><main>
    <p>conteúdo de outro portal, alcançado apenas quando o âmbito é "qualquer ligação"</p>
  </main></body></html>`,
};

/** Rewrites EITHER fixture origin to the local server - never lets a real socket leave localhost. */
const fixtureFetch: typeof fetch = (input, init) => {
  const rewritten = input.toString().replace(REAL_HOST, `http://127.0.0.1:${port}`).replace(OFFSITE_HOST, `http://127.0.0.1:${port}`);
  return fetch(rewritten, init);
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-crawl-engine-'));
  process.env.EKOA_DATA_DIR = dir;
  closeIndex();
  requestLog = [];

  server = createServer((req, res) => {
    requestLog.push(req.url ?? '');
    const path = (req.url ?? '/').split('?')[0] as string;
    const body = PAGES[path];
    if (body === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  closeIndex();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.EKOA_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

function source(over: Partial<KnowledgeSourceDoc> = {}): KnowledgeSourceDoc {
  return {
    _id: 'pgdl-test',
    orgId: SHARED_ORG_ID,
    url: REAL_HOST,
    collection: 'legislacao',
    levels: 2,
    maxPages: 100,
    scope: 'same-domain',
    ...over,
  } as KnowledgeSourceDoc;
}

describe('resolveSeeds', () => {
  it('is `url` plus explicit `seeds`, deduped, `url` first', () => {
    expect(resolveSeeds({ url: 'https://x.pt/a', seeds: ['https://x.pt/a', 'https://x.pt/b'] })).toEqual(['https://x.pt/a', 'https://x.pt/b']);
  });
  it('expands a seedTemplate over its numeric range', () => {
    const seeds = resolveSeeds({ url: 'https://x.pt/', seedTemplate: { url: 'https://x.pt/lei?nid={n}', from: 1, to: 3 } });
    expect(seeds).toEqual(['https://x.pt/', 'https://x.pt/lei?nid=1', 'https://x.pt/lei?nid=2', 'https://x.pt/lei?nid=3']);
  });
});

describe('crawlSource (real HTTP transport, local fixtures)', () => {
  it('walks the frontier within `levels`, ingests HTML pages into `_shared`, and is searchable', async () => {
    const summary = await crawlSource(source(), { fetchImpl: fixtureFetch });
    expect(summary.error).toBeUndefined();
    expect(summary.failed).toBe(0);
    // Seed + /a + /b = 3 pages fetched and ingested.
    expect(summary.fetched).toBe(3);
    expect(summary.ingested).toBe(3);

    const hits = search(SHARED_ORG_ID, 'prescricao creditos', 5);
    expect(hits.map((h) => h.title)).toContain('Lei B');
    expect(hits.every((h) => h.scope === 'shared')).toBe(true);
  });

  it('never follows a document link, an off-domain link, or an SSRF-unsafe link discovered on the page', async () => {
    await crawlSource(source(), { fetchImpl: fixtureFetch });
    expect(requestLog).not.toContain(expect.stringContaining('relatorio.pdf'));
    expect(requestLog.some((u) => u.includes('.pdf'))).toBe(false);
    // Only the 3 in-scope HTML pages were ever requested - the .pdf/off-domain/internal anchors
    // on the seed page never turned into a fetch.
    expect(requestLog).toHaveLength(3);
  });

  it('respects `levels`: levels=1 fetches the seed + its direct links, never grandchildren', async () => {
    const summary = await crawlSource(source({ levels: 1 }), { fetchImpl: fixtureFetch });
    // Seed (depth 0, discovers depth-1 links since 0 < 1) + /a (depth 1, does NOT discover further
    // since 1 < 1 is false) - /b is never enqueued.
    expect(summary.fetched).toBe(2);
    expect(requestLog.some((u) => u === '/b')).toBe(false);
  });

  it('is RESUMABLE across runs: the per-run page budget caps progress, and the next run continues from the persisted frontier', async () => {
    const first = await crawlSource(source({ maxPages: 1 }), { fetchImpl: fixtureFetch });
    expect(first.fetched).toBe(1);
    expect(first.capped).toBe(true);
    expect(first.pendingRemaining).toBeGreaterThan(0);

    const stats1 = await knowledgeLedger.stats('pgdl-test');
    expect(stats1.pending).toBeGreaterThan(0);

    // A second run with the SAME small budget makes further progress - it does not restart from
    // the seed (that would just re-fetch page 1 forever).
    requestLog = [];
    const second = await crawlSource(source({ maxPages: 10 }), { fetchImpl: fixtureFetch });
    expect(second.fetched).toBeGreaterThan(0);
    const stats2 = await knowledgeLedger.stats('pgdl-test');
    expect(stats2.pending).toBe(0); // fully drained once budget allows it
  });

  it('a re-run with unchanged content skips re-ingestion (conditional GET has no validators here, so it relies on a fresh fetch + content-hash match)', async () => {
    await crawlSource(source(), { fetchImpl: fixtureFetch });
    const second = await crawlSource(source(), { fetchImpl: fixtureFetch });
    expect(second.unchanged).toBe(3);
    expect(second.ingested).toBe(0);
    expect(second.updated).toBe(0);
  });

  it('`scope: "any"` follows the off-domain link too; `scope: "same-domain"` (the default) never does', async () => {
    const sameDomain = await crawlSource(source({ levels: 1 }), { fetchImpl: fixtureFetch });
    expect(requestLog).not.toContain('/x');

    requestLog = [];
    const any = await crawlSource(source({ _id: 'pgdl-test-any', scope: 'any', levels: 1 }), { fetchImpl: fixtureFetch });
    expect(requestLog).toContain('/x');
    // The off-domain page's own content is ingested too - scope widening is a real discovery
    // change, not just a counter.
    expect(search(SHARED_ORG_ID, 'outro portal', 5).map((h) => h.title)).toContain('Portal Externo');
    expect(any.fetched).toBeGreaterThan(sameDomain.fetched);
  });

  it('an invalid seed URL fails cleanly with an honest error, no request is made', async () => {
    const summary = await crawlSource(source({ url: 'not a url' }), { fetchImpl: fixtureFetch });
    expect(summary.error).toBeTruthy();
    expect(requestLog).toHaveLength(0);
  });
});
