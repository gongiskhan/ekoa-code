import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import Database from 'better-sqlite3';
import {
  indexDoc, removeDoc, clearOrg, search, orgStatus, totalRows, closeIndex,
  collectionAuthority, toMatchQuery, bulkIndexDocs, optimizeIndex, listDocsPage, type IndexRow,
} from '../../src/knowledge/index-store.js';
import { SHARED_ORG_ID, indexDbPath } from '../../src/knowledge/paths.js';

/** White-box read of the derived doc-map row count (a second short-lived connection), used only to
 *  assert the map ↔ fts invariant the fast-delete path depends on. */
function mapCount(): number {
  const d = new Database(indexDbPath());
  try {
    return (d.prepare('SELECT COUNT(*) AS n FROM knowledge_doc_map').get() as { n: number }).n;
  } finally {
    d.close();
  }
}

/**
 * Lexical index tests (ch04 §4.4.1): SQLite FTS5. Accent-folded BM25 + collection-authority
 * ranking, write/delete hooks, and the org partition that makes cross-org search impossible.
 */
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-idx-'));
  process.env.EKOA_DATA_DIR = dir;
});
afterEach(async () => {
  closeIndex();
  delete process.env.EKOA_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

function doc(orgId: string, collection: string, docId: string, title: string, body: string) {
  indexDoc({ orgId, collection, docId, title, body, createdAt: '2026-01-01T00:00:00.000Z' });
}

describe('accent-folded matching', () => {
  it('finds "ações" when the query is the unaccented "acoes" (and vice-versa)', () => {
    doc('orgA', 'jurisprudencia', 'd1', 'Prazos', 'ações judiciais e prazos de recurso');
    expect(search('orgA', 'acoes', 5).map((h) => h.docId)).toContain('d1');
    doc('orgA', 'jurisprudencia', 'd2', 'Petição', 'peticao inicial');
    expect(search('orgA', 'petição', 5).map((h) => h.docId)).toContain('d2');
  });
});

describe('ranking', () => {
  it('collection authority breaks a BM25 tie in favour of the authoritative collection', () => {
    // Identical body → identical BM25; authority multiplier must order spine above a plain collection.
    doc('orgA', 'notas', 'plain', 'Prazo', 'prazo de recurso');
    doc('orgA', 'legal-spine', 'spine', 'Prazo', 'prazo de recurso');
    expect(collectionAuthority('legal-spine')).toBeGreaterThan(collectionAuthority('notas'));
    const hits = search('orgA', 'prazo recurso', 5);
    expect(hits[0]!.docId).toBe('spine');
  });

  it('a title match outranks a body-only match (title weight)', () => {
    doc('orgA', 'c', 'body', 'Documento genérico', 'menção a penhora algalgures no corpo');
    doc('orgA', 'c', 'title', 'Penhora de bens', 'texto sem o termo no corpo principal');
    const hits = search('orgA', 'penhora', 5);
    expect(hits[0]!.docId).toBe('title');
  });
});

describe('org partition (cross-org search is impossible)', () => {
  it('orgA search never returns an orgB document, even with the same terms', () => {
    doc('orgA', 'c', 'a1', 'Contrato', 'cláusula de rescisão do contrato');
    doc('orgB', 'c', 'b1', 'Contrato', 'cláusula de rescisão do contrato');
    const a = search('orgA', 'contrato clausula', 5).map((h) => h.docId);
    const b = search('orgB', 'contrato clausula', 5).map((h) => h.docId);
    expect(a).toEqual(['a1']);
    expect(b).toEqual(['b1']);
    expect(a).not.toContain('b1');
    expect(orgStatus('orgA').documentCount).toBe(1);
    expect(orgStatus('orgB').documentCount).toBe(1);
  });
});

describe('write/delete hooks', () => {
  it('re-indexing the same doc replaces (no duplicate rows); remove drops it', () => {
    doc('orgA', 'c', 'd1', 'V1', 'primeira versão sobre prazos');
    doc('orgA', 'c', 'd1', 'V2', 'segunda versão sobre prazos');
    expect(orgStatus('orgA').documentCount).toBe(1); // replaced, not duplicated
    expect(search('orgA', 'prazos', 5)).toHaveLength(1);
    removeDoc('orgA', 'c', 'd1');
    expect(search('orgA', 'prazos', 5)).toHaveLength(0);
    expect(totalRows()).toBe(0);
  });

  it('clearOrg drops only the target org partition', () => {
    doc('orgA', 'c', 'a1', 'T', 'prazo');
    doc('orgB', 'c', 'b1', 'T', 'prazo');
    clearOrg('orgA');
    expect(orgStatus('orgA').documentCount).toBe(0);
    expect(orgStatus('orgB').documentCount).toBe(1);
  });
});

describe('shared partition (dual-scope search)', () => {
  it('a normal org search sees its own docs + the shared corpus, never another org', () => {
    doc('orgA', 'notas', 'a1', 'Contrato orgA', 'cláusula sobre arrendamento urbano');
    doc('orgB', 'notas', 'b1', 'Contrato orgB', 'cláusula sobre arrendamento urbano');
    doc(SHARED_ORG_ID, 'legislacao', 's1', 'Lei do arrendamento', 'regime jurídico do arrendamento urbano');
    const ids = search('orgA', 'arrendamento clausula', 10).map((h) => h.docId);
    expect(ids).toContain('a1'); // own
    expect(ids).toContain('s1'); // shared surfaced
    expect(ids).not.toContain('b1'); // never another org
  });

  it('hits carry scope org|shared and never surface the row orgId', () => {
    doc('orgA', 'notas', 'a1', 'Prazo orgA', 'prazo de recurso');
    doc(SHARED_ORG_ID, 'legal-spine', 's1', 'Prazo partilhado', 'prazo de recurso');
    const hits = search('orgA', 'prazo recurso', 10);
    expect(hits.find((h) => h.docId === 'a1')!.scope).toBe('org');
    expect(hits.find((h) => h.docId === 's1')!.scope).toBe('shared');
    expect(hits.every((h) => !Object.prototype.hasOwnProperty.call(h, 'orgId'))).toBe(true);
  });

  it('a shared-scope caller reads only the shared corpus (ids collapse, no duplicate hits)', () => {
    doc(SHARED_ORG_ID, 'legal-spine', 's1', 'Prazo partilhado', 'prazo de recurso');
    const hits = search(SHARED_ORG_ID, 'prazo recurso', 10);
    expect(hits.map((h) => h.docId)).toEqual(['s1']); // exactly once
    expect(hits[0]!.scope).toBe('shared');
  });

  it('clearOrg(_shared) drops only the shared partition, leaving org rows intact', () => {
    doc('orgA', 'notas', 'a1', 'T', 'prazo de recurso');
    doc(SHARED_ORG_ID, 'legal-spine', 's1', 'T', 'prazo de recurso');
    clearOrg(SHARED_ORG_ID);
    expect(search('orgA', 'prazo', 10).map((h) => h.docId)).toEqual(['a1']);
    expect(orgStatus(SHARED_ORG_ID).documentCount).toBe(0);
    expect(orgStatus('orgA').documentCount).toBe(1);
  });
});

describe('doc-map (fast delete) + bulk index', () => {
  const rows: IndexRow[] = [
    { orgId: 'orgA', collection: 'c', docId: 'd1', title: 'Prazos', body: 'prazo de recurso', createdAt: '2026-01-01T00:00:00.000Z' },
    { orgId: 'orgA', collection: 'c', docId: 'd2', title: 'Penhora', body: 'penhora de bens', createdAt: '2026-01-01T00:00:00.000Z' },
  ];

  it('bulkIndexDocs equals an indexDoc loop and re-bulk replaces without duplicates', () => {
    for (const r of rows) indexDoc(r);
    const loop = search('orgA', 'prazo penhora', 10).map((h) => h.docId).sort();
    clearOrg('orgA');
    bulkIndexDocs(rows);
    expect(search('orgA', 'prazo penhora', 10).map((h) => h.docId).sort()).toEqual(loop);
    bulkIndexDocs(rows); // re-bulk the same docIds → replace, not duplicate
    expect(orgStatus('orgA').documentCount).toBe(2);
    expect(totalRows()).toBe(2);
    expect(mapCount()).toBe(2);
  });

  it('the map/fts row-count invariant holds across index, remove and clearOrg', () => {
    doc('orgA', 'c', 'a1', 'A', 'prazo');
    doc('orgB', 'c', 'b1', 'B', 'prazo');
    doc(SHARED_ORG_ID, 'c', 's1', 'S', 'prazo');
    expect(mapCount()).toBe(totalRows());
    indexDoc({ orgId: 'orgA', collection: 'c', docId: 'a1', title: 'A2', body: 'prazo novo', createdAt: '2026-01-01T00:00:00.000Z' }); // replace
    expect(mapCount()).toBe(totalRows());
    removeDoc('orgB', 'c', 'b1');
    expect(mapCount()).toBe(totalRows());
    clearOrg('orgA');
    expect(mapCount()).toBe(totalRows());
    expect(totalRows()).toBe(1); // only shared s1 remains
  });

  it('optimizeIndex compacts without disturbing results or the invariant', () => {
    doc('orgA', 'c', 'd1', 'Prazos', 'prazo de recurso');
    optimizeIndex();
    expect(search('orgA', 'prazo', 5).map((h) => h.docId)).toEqual(['d1']);
    expect(mapCount()).toBe(totalRows());
  });
});

describe('listDocsPage (F43 - the paginated browse listing, index-backed not filesystem-backed)', () => {
  it('orders by createdAt then docId, counts correctly, and pages', () => {
    indexDoc({ orgId: 'orgA', collection: 'c', docId: 'd2', title: 'Segundo', body: 'x', createdAt: '2026-01-02T00:00:00.000Z' });
    indexDoc({ orgId: 'orgA', collection: 'c', docId: 'd1', title: 'Primeiro', body: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
    indexDoc({ orgId: 'orgA', collection: 'c', docId: 'd3', title: 'Terceiro', body: 'x', createdAt: '2026-01-03T00:00:00.000Z' });

    const all = listDocsPage('orgA');
    expect(all.total).toBe(3);
    expect(all.items.map((d) => d.docId)).toEqual(['d1', 'd2', 'd3']); // createdAt ascending

    const page1 = listDocsPage('orgA', { limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.items.map((d) => d.docId)).toEqual(['d1', 'd2']);
    const page2 = listDocsPage('orgA', { limit: 2, offset: 2 });
    expect(page2.total).toBe(3);
    expect(page2.items.map((d) => d.docId)).toEqual(['d3']);
  });

  it('same createdAt ties break on docId ascending - deterministic, never flaky', () => {
    for (const id of ['c', 'a', 'b']) {
      indexDoc({ orgId: 'orgA', collection: 'x', docId: id, title: id, body: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
    }
    expect(listDocsPage('orgA').items.map((d) => d.docId)).toEqual(['a', 'b', 'c']);
  });

  it('collection filter narrows within the org, and never leaks another org\'s rows', () => {
    indexDoc({ orgId: 'orgA', collection: 'jurisprudencia', docId: 'j1', title: 'J', body: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
    indexDoc({ orgId: 'orgA', collection: 'legislacao', docId: 'l1', title: 'L', body: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
    indexDoc({ orgId: 'orgB', collection: 'jurisprudencia', docId: 'j2', title: 'Alheio', body: 'x', createdAt: '2026-01-01T00:00:00.000Z' });

    const narrowed = listDocsPage('orgA', { collection: 'jurisprudencia' });
    expect(narrowed.total).toBe(1);
    expect(narrowed.items.map((d) => d.docId)).toEqual(['j1']);
    expect(listDocsPage('orgA').total).toBe(2); // both collections, still never orgB's row
    expect(listDocsPage('orgA').items.map((d) => d.title)).not.toContain('Alheio');
  });

  it('carries title/sourceUrl/sourceType/language/createdAt, omitting each when absent (never empty-string)', () => {
    indexDoc({ orgId: 'orgA', collection: 'c', docId: 'full', title: 'Com tudo', body: 'x', createdAt: '2026-01-01T00:00:00.000Z', sourceUrl: 'https://x.pt', sourceType: 'crawl', language: 'pt' });
    indexDoc({ orgId: 'orgA', collection: 'c', docId: 'bare', title: 'Só título', body: 'x', createdAt: '2026-01-02T00:00:00.000Z' });
    const [full, bare] = listDocsPage('orgA').items;
    expect(full).toMatchObject({ docId: 'full', title: 'Com tudo', sourceUrl: 'https://x.pt', sourceType: 'crawl', language: 'pt' });
    expect(bare?.sourceUrl).toBeUndefined();
    expect(bare?.sourceType).toBeUndefined();
    expect(bare?.language).toBeUndefined();
  });

  it('a re-index (replace) updates the listing row - title/createdAt drift never survives a re-write', () => {
    indexDoc({ orgId: 'orgA', collection: 'c', docId: 'd1', title: 'Velho', body: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
    indexDoc({ orgId: 'orgA', collection: 'c', docId: 'd1', title: 'Novo', body: 'x', createdAt: '2026-02-01T00:00:00.000Z' }); // same docId, replace
    const { items, total } = listDocsPage('orgA');
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ docId: 'd1', title: 'Novo', createdAt: '2026-02-01T00:00:00.000Z' });
  });

  it('removeDoc/clearOrg drop the row from the listing too, not just from search', () => {
    indexDoc({ orgId: 'orgA', collection: 'c', docId: 'd1', title: 'D1', body: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
    indexDoc({ orgId: 'orgA', collection: 'c', docId: 'd2', title: 'D2', body: 'x', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(listDocsPage('orgA').total).toBe(2);
    removeDoc('orgA', 'c', 'd1');
    expect(listDocsPage('orgA').total).toBe(1);
    clearOrg('orgA');
    expect(listDocsPage('orgA').total).toBe(0);
  });

  it('an empty partition answers total:0, items:[] - never throws', () => {
    expect(listDocsPage('orgA-nunca-teve-nada')).toEqual({ items: [], total: 0 });
  });

  it('self-heals a PRE-F43 doc-map table (no listing columns) into the current schema on next open', async () => {
    closeIndex(); // drop this test's already-open connection so the manual DDL below is the only writer
    const dbPath = indexDbPath();
    await mkdir(dirname(dbPath), { recursive: true });
    const raw = new Database(dbPath);
    raw.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
         orgId UNINDEXED, collection UNINDEXED, docId UNINDEXED, title, body,
         createdAt UNINDEXED, sourceUrl UNINDEXED, sourceType UNINDEXED, language UNINDEXED,
         tokenize = 'unicode61 remove_diacritics 2'
       );`,
    );
    // The PRE-F43 shape: id -> ftsRowid only, no listing columns.
    raw.exec(`CREATE TABLE knowledge_doc_map (orgId TEXT NOT NULL, collection TEXT NOT NULL, docId TEXT NOT NULL, ftsRowid INTEGER NOT NULL, PRIMARY KEY (orgId, collection, docId)) WITHOUT ROWID;`);
    const info = raw
      .prepare(`INSERT INTO knowledge_fts(orgId, collection, docId, title, body, createdAt, sourceUrl, sourceType, language) VALUES ('orgA','c','legacy','Doc legado','corpo','2026-01-01T00:00:00.000Z','','','')`)
      .run();
    raw.prepare('INSERT INTO knowledge_doc_map(orgId, collection, docId, ftsRowid) VALUES (?,?,?,?)').run('orgA', 'c', 'legacy', info.lastInsertRowid);
    raw.close();

    // The next call through the module re-opens the SAME db file - `ensureDocMapTable` must detect
    // the missing listing columns, drop + recreate, and `healDocMap` must repopulate from the fts
    // scan (the map's row count goes 1 -> 0 on drop, which is exactly what triggers the heal).
    const { items, total } = listDocsPage('orgA');
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ docId: 'legacy', title: 'Doc legado', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(mapCount()).toBe(1);
  });
});

describe('query builder', () => {
  it('drops stopwords/short tokens and stays silent on meaningless input', () => {
    expect(toMatchQuery('de a o e')).toBeNull(); // all stopwords
    expect(toMatchQuery('   ')).toBeNull();
    expect(toMatchQuery('prazo de recurso')).toBe('"prazo" OR "recurso"');
  });

  it('neutralises FTS operator punctuation in the query (no injection)', () => {
    doc('orgA', 'c', 'd1', 'T', 'termo especial aqui');
    // punctuation like " OR ( must not break MATCH parsing
    expect(() => search('orgA', 'termo" OR ("x', 5)).not.toThrow();
    expect(search('orgA', 'termo" OR ("x', 5).map((h) => h.docId)).toContain('d1');
  });
});
