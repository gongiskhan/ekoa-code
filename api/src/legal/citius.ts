/**
 * Consulta pública Citius — busca on-demand das publicações (citações e
 * notificações) por número de processo no portal público www.citius.mj.pt.
 *
 * ACEITAVELMENTE FRÁGIL, por desenho. O portal público é ASP.NET WebForms; um
 * simples GET costuma redirecionar para uma página de erro sem sessão. Este
 * serviço funciona SEMPRE contra fixtures/HTML já obtido (o parser é a parte
 * estável e testada), através de uma costura `fetchImpl` injetável; contra o site
 * real faz o melhor esforço (descodifica o charset ISO-8859-1/1252 dos portais
 * legais PT) e devolve `{ ok:false, error:'Consulta Citius indisponível' }` quando
 * o fluxo WebForms se revela indisponível.
 *
 * Carried from cortex/src/services/citius-consulta.ts (B21). ADAPTED off cheerio
 * (not installed): `parsePublicacoes` is re-implemented with a zero-dependency
 * regex table walker that reproduces the same output for the committed fixtures.
 * The default live fetch rides the SSRF-guarded `guardedFetch` (ch09 invariant 8).
 */
import { guardedFetch } from '../services/url-fetcher.js';

/** URL público da consulta de citações e notificações do Citius. */
export const CITIUS_CONSULTA_URL = 'https://www.citius.mj.pt/portal/consultas/ConsultasCitacoes.aspx';

export interface CitiusPublicacao {
  processo: string;
  tribunal: string;
  data: string;
  ato: string;
  texto: string;
}

export interface CitiusConsultaResult {
  ok: boolean;
  processo: string;
  publicacoes: CitiusPublicacao[];
  source: 'live' | 'unavailable';
  /** Mensagem PT-PT quando `ok` é false. */
  error?: string;
}

/** Resposta mínima de que o serviço precisa — compatível com `fetch` global. */
export interface FetchLikeResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchImpl = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchLikeResponse>;

/** Milliseconds before the default (live) fetch aborts a hung portal request. */
const LIVE_FETCH_TIMEOUT_MS = 12_000;

/** Default live fetch: SSRF-guarded. Tests inject their own `fetchImpl`. */
const defaultFetch: FetchImpl = async (url, init) => {
  return guardedFetch(url, { headers: init?.headers, timeoutMs: LIVE_FETCH_TIMEOUT_MS });
};

/**
 * Descodifica um corpo HTML segundo o charset declarado. Os portais legais PT
 * servem com frequência ISO-8859-1 / Windows-1252 (não UTF-8); descodificar isso
 * como UTF-8 estraga cada acento. Lê o charset do Content-Type, com fallback para
 * um <meta charset>, e trata a família latin-1 como Node 'latin1'.
 */
export function decodeHtml(buf: Buffer, contentType: string): string {
  let charset = '';
  const m = /charset\s*=\s*["']?([^;"'>\s]+)/i.exec(contentType || '');
  if (m) charset = m[1] ?? '';
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    const mm = /<meta[^>]+charset\s*=\s*["']?\s*([^;"'>\s]+)/i.exec(head);
    if (mm) charset = mm[1] ?? '';
  }
  const c = charset.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (c.includes('8859') || c.includes('1252') || c.includes('latin')) {
    return buf.toString('latin1');
  }
  return buf.toString('utf-8');
}

/** Decode the small set of HTML entities that can appear in Citius cell text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)));
}

/** Strip tags + decode entities + collapse whitespace on a cell/row fragment. */
function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Heurística: a resposta é uma página de erro / redireção do WebForms (e não uma
 * página de resultados). Detetamos os marcadores típicos de erro e a ausência do
 * formulário ASP.NET para devolver "indisponível" com honestidade.
 */
function looksUnavailable(html: string): boolean {
  const h = html.toLowerCase();
  if (h.includes('aspxerrorpath') || h.includes('errorpage') || h.includes('ocorreu um erro')) {
    return true;
  }
  return !h.includes('aspnetform') && !h.includes('processo');
}

/**
 * Faz parse das publicações de uma página de resultados Citius. Liberal por
 * desenho para tolerar a drift do id exato do GridView: qualquer <table> cujo
 * cabeçalho (primeira <tr>) mencione "processo" é uma tabela de resultados; cada
 * linha de dados seguinte com >=4 células <td> vira uma publicação
 * (processo | tribunal | data | acto | texto…). Zero-dependency (sem cheerio).
 */
export function parsePublicacoes(html: string): CitiusPublicacao[] {
  const out: CitiusPublicacao[] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const tableInner = tableMatch[1] ?? '';
    const rows: string[] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tableInner)) !== null) rows.push(rowMatch[1] ?? '');
    if (rows.length < 2) continue;

    const headerText = cellText(rows[0] ?? '').toLowerCase();
    if (!headerText.includes('processo')) continue;

    for (const row of rows.slice(1)) {
      const cells: string[] = [];
      const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(row)) !== null) cells.push(cellText(cellMatch[1] ?? ''));
      if (cells.length < 4) continue;
      const [processo, tribunal, data, ato, ...rest] = cells;
      if (!processo) continue;
      out.push({
        processo,
        tribunal: tribunal || '',
        data: data || '',
        ato: ato || '',
        texto: cellText(rest.join(' ')) || ato || '',
      });
    }
  }
  return out;
}

/** Constrói o URL de consulta para um número de processo. */
export function buildConsultaUrl(processo: string): string {
  const u = new URL(CITIUS_CONSULTA_URL);
  u.searchParams.set('NumProcesso', processo);
  return u.toString();
}

/**
 * Consulta as publicações Citius de um número de processo.
 *
 * @param processo Número de processo (ex.: "1234/26.0T8LSB").
 * @param opts.fetchImpl Costura de teste. Por omissão usa o fetch SSRF-guarded.
 */
export async function consultarCitius(
  processo: string,
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<CitiusConsultaResult> {
  const proc = String(processo || '').trim();
  if (!proc) {
    return { ok: false, processo: '', publicacoes: [], source: 'unavailable', error: 'Número de processo em falta' };
  }

  const fetchImpl: FetchImpl = opts.fetchImpl ?? defaultFetch;

  try {
    const res = await fetchImpl(buildConsultaUrl(proc), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EkoaLegal/1.0; +https://ekoa.io)',
        Accept: 'text/html',
      },
    });
    if (!res || !res.ok) {
      return { ok: false, processo: proc, publicacoes: [], source: 'unavailable', error: 'Consulta Citius indisponível' };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const html = decodeHtml(buf, res.headers.get('content-type') || '');
    const publicacoes = parsePublicacoes(html);

    // Página de erro/redireção sem publicações -> indisponível (não falso vazio).
    if (publicacoes.length === 0 && looksUnavailable(html)) {
      return { ok: false, processo: proc, publicacoes: [], source: 'unavailable', error: 'Consulta Citius indisponível' };
    }

    return { ok: true, processo: proc, publicacoes, source: 'live' };
  } catch {
    return { ok: false, processo: proc, publicacoes: [], source: 'unavailable', error: 'Consulta Citius indisponível' };
  }
}
