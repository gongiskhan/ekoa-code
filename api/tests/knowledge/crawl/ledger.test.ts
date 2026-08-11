import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { knowledgeLedger, pageId, type LedgerPage } from '../../../src/knowledge/crawl/ledger.js';

/**
 * WS8c: the crawl ledger - the per-page registry that makes a crawl resumable. Shape decision
 * (stated in the module doc): one JSON file per source at `<dataDir>/knowledge/ledger/<id>.json`,
 * matching ekoa-dev's path exactly so a pre-existing ledger on a machine that already ran its
 * crawler is picked up automatically instead of orphaned.
 */
let dir: string;
const page = (over: Partial<LedgerPage> = {}): LedgerPage => ({
  id: pageId(over.url ?? 'https://example.pt/a'),
  sourceId: 'src-1',
  url: 'https://example.pt/a',
  depth: 0,
  collection: 'legislacao',
  status: 'pending',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastFetchedAt: '',
  ...over,
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-ledger-'));
  process.env.EKOA_DATA_DIR = dir;
});
afterEach(async () => {
  delete process.env.EKOA_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('pageId', () => {
  it('is a stable sha1 of the URL - the same URL always maps to the same page', () => {
    expect(pageId('https://dgsi.pt/a')).toBe(pageId('https://dgsi.pt/a'));
    expect(pageId('https://dgsi.pt/a')).not.toBe(pageId('https://dgsi.pt/b'));
    expect(pageId('https://dgsi.pt/a')).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('knowledgeLedger persistence', () => {
  it('list() on a source with no ledger file yet returns empty, not an error', async () => {
    expect(await knowledgeLedger.list('never-seen')).toEqual([]);
  });

  it('replaceAll() then list() round-trips the exact pages, and the file lands at the documented path', async () => {
    const pages = [page(), page({ id: pageId('https://example.pt/b'), url: 'https://example.pt/b', status: 'ok', docId: 'doc-1' })];
    await knowledgeLedger.replaceAll('src-1', pages);

    const path = knowledgeLedger.pathFor('src-1');
    expect(path).toBe(join(dir, 'knowledge', 'ledger', 'src-1.json'));
    expect(existsSync(path)).toBe(true);

    const listed = await knowledgeLedger.list('src-1');
    expect(listed).toEqual(pages);
  });

  it('a second replaceAll() REPLACES the whole file (bulk, not merge) - a dropped page stays dropped', async () => {
    await knowledgeLedger.replaceAll('src-1', [page(), page({ id: pageId('https://example.pt/b'), url: 'https://example.pt/b' })]);
    await knowledgeLedger.replaceAll('src-1', [page()]);
    expect(await knowledgeLedger.list('src-1')).toHaveLength(1);
  });

  it('a hostile sourceId can never escape the ledger directory (path traversal defense)', async () => {
    await knowledgeLedger.replaceAll('../../etc/passwd', [page({ sourceId: '../../etc/passwd' })]);
    const path = knowledgeLedger.pathFor('../../etc/passwd');
    // `/` is neutralized to `_`, so the result is ONE filename living directly inside
    // ledgerDir() - a literal ".." can survive as harmless filename characters (no separator
    // around it to make it a path segment), but the resolved file can never sit outside the
    // ledger directory. `dirname` proves the "one segment, no traversal" invariant directly.
    expect(dirname(path)).toBe(join(dir, 'knowledge', 'ledger'));
  });

  it('clear() removes the file entirely - a subsequent list() is empty, not a stale read', async () => {
    await knowledgeLedger.replaceAll('src-1', [page()]);
    expect(existsSync(knowledgeLedger.pathFor('src-1'))).toBe(true);
    await knowledgeLedger.clear('src-1');
    expect(existsSync(knowledgeLedger.pathFor('src-1'))).toBe(false);
    expect(await knowledgeLedger.list('src-1')).toEqual([]);
  });

  it('clear() on a source with no file is a graceful no-op, never a throw', async () => {
    await expect(knowledgeLedger.clear('never-existed')).resolves.toBeUndefined();
  });

  it('stats() counts by status and by docId presence', async () => {
    await knowledgeLedger.replaceAll('src-1', [
      page({ id: '1', status: 'pending' }),
      page({ id: '2', status: 'ok', docId: 'doc-a' }),
      page({ id: '3', status: 'ok', docId: 'doc-b' }),
      page({ id: '4', status: 'error' }),
      page({ id: '5', status: 'ok' }), // ok but no docId yet (e.g. content below the ingest floor)
    ]);
    expect(await knowledgeLedger.stats('src-1')).toEqual({ total: 5, pending: 1, ok: 3, error: 1, withDoc: 2 });
  });

  it('stats() on an empty/absent ledger is all zeros, not a throw', async () => {
    expect(await knowledgeLedger.stats('never-seen')).toEqual({ total: 0, pending: 0, ok: 0, error: 0, withDoc: 0 });
  });

  it('two sources never share a file - each is isolated', async () => {
    await knowledgeLedger.replaceAll('src-1', [page({ sourceId: 'src-1' })]);
    await knowledgeLedger.replaceAll('src-2', [page({ sourceId: 'src-2' }), page({ id: 'x', sourceId: 'src-2' })]);
    expect(await knowledgeLedger.list('src-1')).toHaveLength(1);
    expect(await knowledgeLedger.list('src-2')).toHaveLength(2);
  });

  it('concurrent replaceAll() calls for the SAME source serialize (the write queue) rather than corrupt the file', async () => {
    const batches = Array.from({ length: 20 }, (_, i) => [page({ id: `p-${i}`, url: `https://example.pt/${i}` })]);
    await Promise.all(batches.map((b) => knowledgeLedger.replaceAll('src-race', b)));
    // Whichever write landed last, the file must be valid JSON with exactly one page - never a
    // torn/interleaved write from two concurrent writers.
    const raw = await readFile(knowledgeLedger.pathFor('src-race'), 'utf8');
    const parsed = JSON.parse(raw) as unknown[];
    expect(parsed).toHaveLength(1);
  });

  it('a corrupt (unparseable) ledger file is treated as empty, never crashes the caller', async () => {
    await knowledgeLedger.replaceAll('src-1', [page()]);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(knowledgeLedger.pathFor('src-1'), '{ not valid json', 'utf8');
    expect(await knowledgeLedger.list('src-1')).toEqual([]);
    expect(await knowledgeLedger.stats('src-1')).toEqual({ total: 0, pending: 0, ok: 0, error: 0, withDoc: 0 });
  });
});
