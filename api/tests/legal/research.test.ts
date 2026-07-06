/**
 * Ported from cortex/tests/services/legal-research.test.ts. Adapted harness: the
 * knowledge FTS hit is the injected `ResearchSearchHit` (the knowledge/ backend is
 * a seam), so the `hit()` helper builds that shape; assertions carried verbatim.
 */
import { describe, it, expect } from 'vitest';
import {
  legalResearch,
  extractCitation,
  type ResearchSearchImpl,
  type ResearchFetchImpl,
  type ResearchSearchHit,
} from '../../src/legal/research.js';

/** Build a knowledge hit with sane defaults. */
function hit(partial: Partial<ResearchSearchHit>): ResearchSearchHit {
  return { title: '', snippet: '', score: 1, date: '2026-01-01', ...partial };
}

/** A fetchImpl that resolves URLs by keyword: *good* → 2xx; *head405* → HEAD 405, GET 200; else 404. */
const keywordFetch: ResearchFetchImpl = async (url, init) => {
  if (url.includes('good')) return { ok: true, status: 200 };
  if (url.includes('head405')) return init.method === 'HEAD' ? { ok: false, status: 405 } : { ok: true, status: 200 };
  return { ok: false, status: 404 };
};

describe('legal-research · extractCitation', () => {
  it('extracts an ECLI identifier', () => {
    expect(extractCitation('Acórdão ECLI:PT:STJ:2020:123.45.6.S1 do Supremo')).toBe('ECLI:PT:STJ:2020:123.45.6.S1');
  });

  it('extracts a Decreto-Lei / Lei reference', () => {
    expect(extractCitation('nos termos do Decreto-Lei n.º 10/2024, de 5 de janeiro')).toMatch(/Decreto-Lei n\.º 10\/2024/);
    expect(extractCitation('Lei n.º 23/2007, de 4 de julho')).toMatch(/Lei n\.º 23\/2007/);
  });

  it('extracts a DGSI process number', () => {
    expect(extractCitation('Processo 1234/09.0TVLSB-A.S1')).toBe('1234/09.0TVLSB-A.S1');
  });

  it('prefers ECLI over a legislation reference when both are present', () => {
    expect(extractCitation('ECLI:PT:TRL:2019:1.2.3 aplicou a Lei n.º 7/2009')).toMatch(/^ECLI:PT:TRL/);
  });

  it('returns undefined when there is no recognizable citation', () => {
    expect(extractCitation('texto qualquer sem referências')).toBeUndefined();
  });
});

describe('legal-research · pipeline', () => {
  it('tags hits by source and searches the mapped collections', async () => {
    const seen: string[][] = [];
    const searchImpl: ResearchSearchImpl = (_q, { collections }) => {
      seen.push(collections);
      if (collections.includes('jurisprudencia')) {
        return [hit({ title: 'Acórdão', sourceUrl: 'https://dgsi.pt/good/1', snippet: 'ECLI:PT:STJ:2020:1.2.3' })];
      }
      if (collections.includes('legislacao')) {
        return [hit({ title: 'Decreto-Lei n.º 10/2024, de 5 de janeiro', sourceUrl: 'https://diariodarepublica.pt/good/2', snippet: 'artigo 1.º' })];
      }
      return [];
    };

    const res = await legalResearch('prescrição', { searchImpl, fetchImpl: keywordFetch });
    expect(res.ok).toBe(true);
    expect(seen).toContainEqual(['jurisprudencia']);
    expect(seen).toContainEqual(['legislacao']);
    const sources = res.hits.map((h) => h.source).sort();
    expect(sources).toEqual(['dgsi', 'dre']);
    const dgsiHit = res.hits.find((h) => h.source === 'dgsi')!;
    expect(dgsiHit.citation).toBe('ECLI:PT:STJ:2020:1.2.3');
    const dreHit = res.hits.find((h) => h.source === 'dre')!;
    expect(dreHit.citation).toMatch(/Decreto-Lei n\.º 10\/2024/);
  });

  it('keeps every hit unverified when verify=false', async () => {
    const searchImpl: ResearchSearchImpl = () => [hit({ sourceUrl: 'https://dgsi.pt/dead', title: 'A', snippet: 'x' })];
    const res = await legalResearch('q', { sources: ['dgsi'], verify: false, searchImpl });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]!.verification).toEqual({ checked: false });
  });

  it('drops broken links but keeps resolving ones when verify=true', async () => {
    const searchImpl: ResearchSearchImpl = () => [
      hit({ sourceUrl: 'https://dgsi.pt/good/live', title: 'Vivo', snippet: 's' }),
      hit({ sourceUrl: 'https://dgsi.pt/dead/gone', title: 'Morto', snippet: 's' }),
    ];
    const res = await legalResearch('q', { sources: ['dgsi'], verify: true, searchImpl, fetchImpl: keywordFetch });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]!.url).toContain('good');
    expect(res.hits[0]!.verification).toMatchObject({ checked: true, ok: true, status: 200 });
  });

  it('falls back from HEAD to GET when HEAD is not allowed', async () => {
    const searchImpl: ResearchSearchImpl = () => [hit({ sourceUrl: 'https://dgsi.pt/head405/doc', title: 'T', snippet: 's' })];
    const res = await legalResearch('q', { sources: ['dgsi'], verify: true, searchImpl, fetchImpl: keywordFetch });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]!.verification).toMatchObject({ checked: true, ok: true });
  });

  it('drops hits without a resolvable URL when verify=true', async () => {
    const searchImpl: ResearchSearchImpl = () => [
      hit({ sourceUrl: undefined, title: 'Sem link', snippet: 's' }),
      hit({ sourceUrl: 'https://dgsi.pt/good/x', title: 'Com link', snippet: 's' }),
    ];
    const res = await legalResearch('q', { sources: ['dgsi'], verify: true, searchImpl, fetchImpl: keywordFetch });
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]!.title).toBe('Com link');
  });

  it('degrades cleanly to ok:true, hits:[] with a note when the index is empty', async () => {
    const searchImpl: ResearchSearchImpl = () => [];
    const res = await legalResearch('qualquer coisa', { searchImpl });
    expect(res.ok).toBe(true);
    expect(res.hits).toEqual([]);
    expect(res.note).toBeTruthy();
  });

  it('notes when found sources all fail verification', async () => {
    const searchImpl: ResearchSearchImpl = () => [hit({ sourceUrl: 'https://dgsi.pt/dead', title: 'A', snippet: 's' })];
    const res = await legalResearch('q', { sources: ['dgsi'], verify: true, searchImpl, fetchImpl: keywordFetch });
    expect(res.ok).toBe(true);
    expect(res.hits).toEqual([]);
    expect(res.note).toMatch(/não resolveram/i);
  });

  it('ignores unknown sources and notes when none remain', async () => {
    const res = await legalResearch('q', { sources: ['bogus'], searchImpl: () => [] });
    expect(res.ok).toBe(true);
    expect(res.note).toMatch(/fonte/i);
  });

  it('returns an empty result for an empty query', async () => {
    const res = await legalResearch('   ', { searchImpl: () => [hit({ sourceUrl: 'https://x' })] });
    expect(res.hits).toEqual([]);
  });
});
