import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  indexDoc, removeDoc, clearOrg, search, orgStatus, totalRows, closeIndex,
  collectionAuthority, toMatchQuery,
} from '../../src/knowledge/index-store.js';

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
