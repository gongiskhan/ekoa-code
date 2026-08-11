import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUnids, crawlDominoSource } from '../../../src/knowledge/crawl/domino.js';
import { closeIndex, search } from '../../../src/knowledge/index-store.js';
import { readDoc } from '../../../src/knowledge/vault.js';
import { SHARED_ORG_ID } from '../../../src/knowledge/paths.js';
import type { KnowledgeSourceDoc } from '../../../src/knowledge/service.js';

/**
 * WS8c - the Domino harvest against SAVED FIXTURE PAGES over a REAL local HTTP server (never a
 * live site, per the task constraint). `source.domino.baseUrl` is the real public hostname
 * (`https://www.dgsi.pt`) so it passes the SSRF guard exactly like production traffic would; the
 * injected `fetchImpl` rewrites that origin to the local fixture server before the real socket
 * opens, so the actual bytes on the wire never leave localhost - this is real HTTP transport
 * (headers, ETags, streamed bodies) against fixtures, not a mocked `crawlDominoSource` call.
 */
const UNID_A = '11111111111111111111111111111111';
const UNID_B = '22222222222222222222222222222222';
const REAL_HOST = 'https://www.dgsi.pt';

let server: Server;
let port: number;
let dir: string;
let requestLog: string[] = [];
let etagFor: Record<string, string> = {};

function readViewEntriesXml(unids: string[]): string {
  const entries = unids.map((u) => `<viewentry unid="${u}" noteid="1"><entrydata columnnumber="0"><text>x</text></entrydata></viewentry>`).join('');
  return `<?xml version="1.0"?><viewentries toplevelentries="${unids.length}">${entries}</viewentries>`;
}

const DOC_HTML: Record<string, string> = {
  [UNID_A]: '<html><head><title>Acórdão do STJ 1/2026</title></head><body><main><p>o prazo de recurso é de 30 dias em processo cível, matéria de facto e de direito</p></main></body></html>',
  [UNID_B]: '<html><head><title>Acórdão do STJ 2/2026</title></head><body><main><p>a prescrição do crédito ocorre decorrido o prazo legalmente previsto na lei civil</p></main></body></html>',
};

const fixtureFetch: typeof fetch = (input, init) => {
  const rewritten = input.toString().replace(REAL_HOST, `http://127.0.0.1:${port}`);
  return fetch(rewritten, init);
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-domino-'));
  process.env.EKOA_DATA_DIR = dir;
  closeIndex();
  requestLog = [];
  etagFor = {};

  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requestLog.push(req.url ?? '');

    if (url.searchParams.has('ReadViewEntries')) {
      res.writeHead(200, { 'content-type': 'text/xml' });
      res.end(readViewEntriesXml([UNID_A, UNID_B]));
      return;
    }
    const m = /\/0\/([0-9A-Fa-f]{32})$/.exec(url.pathname);
    if (m) {
      const unid = (m[1] as string).toUpperCase();
      const inm = req.headers['if-none-match'];
      const etag = etagFor[unid] ?? `"${unid}-v1"`;
      etagFor[unid] = etag;
      if (inm === etag) {
        res.writeHead(304, { etag });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag });
      res.end(DOC_HTML[unid] ?? '<html><body><main>desconhecido</main></body></html>');
      return;
    }
    res.writeHead(404);
    res.end();
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
    _id: 'dgsi-test',
    orgId: SHARED_ORG_ID,
    url: REAL_HOST,
    collection: 'jurisprudencia',
    kind: 'domino',
    maxPages: 200_000,
    domino: { baseUrl: REAL_HOST, view: 'Por Ano', count: 1000, databases: [{ db: 'jstj.nsf' }] },
    ...over,
  } as KnowledgeSourceDoc;
}

describe('parseUnids', () => {
  it('extracts every 32-hex unid from a ReadViewEntries XML response, uppercased', () => {
    const xml = readViewEntriesXml([UNID_A, UNID_B.toLowerCase()]);
    expect(parseUnids(xml)).toEqual([UNID_A, UNID_B]);
  });
  it('returns an empty list for XML with no viewentry elements', () => {
    expect(parseUnids('<?xml version="1.0"?><viewentries toplevelentries="0"></viewentries>')).toEqual([]);
  });
});

describe('crawlDominoSource (real HTTP transport, local fixtures)', () => {
  it('harvests every document via ReadViewEntries + OpenDocument, ingests into `_shared`, and is searchable', async () => {
    const summary = await crawlDominoSource(source(), { fetchImpl: fixtureFetch });
    expect(summary.error).toBeUndefined();
    expect(summary.fetched).toBe(2);
    expect(summary.ingested).toBe(2);
    expect(summary.updated).toBe(0);
    expect(summary.failed).toBe(0);

    // The real request shape hit the fixture server: one ReadViewEntries + two OpenDocument GETs.
    expect(requestLog.filter((u) => u.includes('ReadViewEntries'))).toHaveLength(1);
    expect(requestLog.filter((u) => u.includes('OpenDocument'))).toHaveLength(2);

    // Both acórdãos landed in `_shared`, org-partitioned exactly like every other vault write.
    const hits = search(SHARED_ORG_ID, 'prescricao credito', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toContain('Acórdão do STJ 2/2026');

    const docId = hits[0]!.docId;
    const doc = await readDoc(SHARED_ORG_ID, 'jurisprudencia', docId);
    expect(doc?.fm.sourceType).toBe('crawl');
    expect(doc?.fm.sourceUrl).toContain('OpenDocument');
  });

  it('a second run conditional-GETs with the stored ETag; an unchanged doc is skipped, never re-ingested', async () => {
    await crawlDominoSource(source(), { fetchImpl: fixtureFetch });
    requestLog = [];
    const second = await crawlDominoSource(source(), { fetchImpl: fixtureFetch });

    expect(second.unchanged).toBe(2);
    expect(second.ingested).toBe(0);
    expect(second.updated).toBe(0);
    // Every OpenDocument re-fetch carried the conditional header and got a 304 from the fixture.
    expect(requestLog.filter((u) => u.includes('OpenDocument'))).toHaveLength(2);
  });

  it('changed content on a re-run is re-ingested as `updated`, not duplicated', async () => {
    await crawlDominoSource(source(), { fetchImpl: fixtureFetch });
    // Force a change: bump the fixture's ETag for UNID_A so the conditional GET misses.
    etagFor[UNID_A] = '"stale-etag-forces-refetch"';
    const second = await crawlDominoSource(source(), { fetchImpl: fixtureFetch });
    expect(second.updated).toBe(1);
    expect(second.ingested).toBe(0);
    expect(second.unchanged).toBe(1); // UNID_B still matches its stored ETag
  });

  it('the per-run document budget caps the harvest and reports `capped`', async () => {
    const summary = await crawlDominoSource(source({ maxPages: 1 }), { fetchImpl: fixtureFetch });
    expect(summary.fetched).toBe(1);
    expect(summary.capped).toBe(true);
  });

  it('a source with no domino config answers an honest error, no request is made', async () => {
    const summary = await crawlDominoSource(source({ domino: undefined }), { fetchImpl: fixtureFetch });
    expect(summary.error).toMatch(/domino/i);
    expect(requestLog).toHaveLength(0);
  });

  it('rejects a domino.baseUrl that is not SSRF-safe, even before any request', async () => {
    await expect(
      crawlDominoSource(source({ domino: { baseUrl: 'http://127.0.0.1:1/', databases: [{ db: 'jstj.nsf' }] } }), { fetchImpl: fixtureFetch }),
    ).rejects.toThrow();
  });
});
