/**
 * Ported from cortex/tests/services/citius-consulta.test.ts. Adapted harness:
 * imports from legal/citius (de-cheerio'd parser) and reads the committed citius
 * fixtures from api/tests/e2e/fixtures/ (ported at G1). Assertions carried verbatim
 * — the regex table walker must reproduce the same publicações the cheerio parser
 * produced for these fixtures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  consultarCitius,
  parsePublicacoes,
  decodeHtml,
  buildConsultaUrl,
  type FetchImpl,
  type FetchLikeResponse,
} from '../../src/legal/citius.js';

const fx = (name: string): string => fileURLToPath(new URL(`../e2e/fixtures/${name}`, import.meta.url));
const utf8Fixture = readFileSync(fx('citius-consulta.html'), 'utf-8');
const latin1Buffer = readFileSync(fx('citius-consulta-latin1.html')); // raw ISO-8859-1 bytes

/** Build a fetchImpl seam that always answers with the given bytes + content-type. */
function fakeFetch(buf: Buffer, contentType: string, opts: { ok?: boolean; status?: number } = {}): FetchImpl {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  return async (): Promise<FetchLikeResponse> => ({
    status,
    ok,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  });
}

describe('citius-consulta · parsePublicacoes', () => {
  it('extracts each publicação row (processo/tribunal/data/acto/texto)', () => {
    const pubs = parsePublicacoes(utf8Fixture);
    expect(pubs).toHaveLength(2);
    expect(pubs[0]).toMatchObject({
      processo: '1234/26.0T8LSB',
      tribunal: 'Tribunal Judicial da Comarca de Lisboa',
      data: '2026-06-15',
      ato: 'Citação',
    });
    expect(pubs[0]!.texto).toContain('contestar');
    expect(pubs[1]!.processo).toBe('5678/26.1T8PRT');
    expect(pubs[1]!.ato).toBe('Notificação');
  });

  it('ignores tables that are not a results table', () => {
    const pubs = parsePublicacoes('<table><tr><th>Outra coisa</th></tr><tr><td>x</td></tr></table>');
    expect(pubs).toHaveLength(0);
  });
});

describe('citius-consulta · decodeHtml (charset)', () => {
  it('decodes ISO-8859-1 bytes without mojibake', () => {
    const html = decodeHtml(latin1Buffer, 'text/html; charset=iso-8859-1');
    expect(html).toContain('Citação');
    expect(html).toContain('Notificação');
    expect(html).not.toContain('Ã'); // classic utf8-misread-of-latin1 artifact
  });

  it('decodes UTF-8 by default', () => {
    const html = decodeHtml(Buffer.from(utf8Fixture, 'utf-8'), 'text/html; charset=utf-8');
    expect(html).toContain('Citação');
  });
});

describe('citius-consulta · consultarCitius (fetchImpl seam)', () => {
  it('parses a live-shaped latin1 response through the full path', async () => {
    const res = await consultarCitius('1234/26.0T8LSB', {
      fetchImpl: fakeFetch(latin1Buffer, 'text/html; charset=iso-8859-1'),
    });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('live');
    expect(res.processo).toBe('1234/26.0T8LSB');
    expect(res.publicacoes).toHaveLength(2);
    expect(res.publicacoes[0]!.ato).toBe('Citação'); // accents survived the decode
  });

  it('rejects an empty processo with a clean PT error', async () => {
    const res = await consultarCitius('   ');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Número de processo em falta');
  });

  it('returns "indisponível" when the portal redirects to an error page', async () => {
    const errorPage = '<html><head><title>Erro</title></head><body>Ocorreu um erro. aspxerrorpath=/portal</body></html>';
    const res = await consultarCitius('1234/26.0T8LSB', {
      fetchImpl: fakeFetch(Buffer.from(errorPage, 'utf-8'), 'text/html; charset=utf-8'),
    });
    expect(res.ok).toBe(false);
    expect(res.source).toBe('unavailable');
    expect(res.error).toBe('Consulta Citius indisponível');
  });

  it('returns "indisponível" on a non-2xx upstream', async () => {
    const res = await consultarCitius('1234/26.0T8LSB', {
      fetchImpl: fakeFetch(Buffer.from('', 'utf-8'), 'text/html', { ok: false, status: 500 }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Consulta Citius indisponível');
  });

  it('returns "indisponível" when the fetch throws', async () => {
    const res = await consultarCitius('1234/26.0T8LSB', {
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Consulta Citius indisponível');
  });

  it('builds a consulta URL carrying the processo number', () => {
    const url = buildConsultaUrl('1234/26.0T8LSB');
    expect(url).toContain('ConsultasCitacoes.aspx');
    expect(decodeURIComponent(url)).toContain('1234/26.0T8LSB');
  });
});
