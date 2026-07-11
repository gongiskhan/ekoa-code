import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  indexDoc, removeDoc, clearOrg, search, orgStatus, totalRows, closeIndex,
  collectionAuthority, toMatchQuery, bulkIndexDocs, optimizeIndex, type IndexRow,
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
