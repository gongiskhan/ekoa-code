/**
 * Shared HTML helpers for PT-PT registry portals (Citius, certidão comercial/predial/civil).
 * Extracted out of `citius.ts` per `08-portal-audit.md` "Part E pins" #4 ("decodeHtml is
 * directly reusable for any PT registry HTML; extract it to a shared helper inside
 * api/src/legal/ when E2 lands"). `citius.ts` re-exports `decodeHtml` for byte-compat
 * (its test imports it from there); `portal-connectors.ts` (E2/E3) imports everything here
 * directly.
 */

/**
 * Descodifica um corpo HTML segundo o charset declarado. Os portais legais PT servem com
 * frequência ISO-8859-1 / Windows-1252 (não UTF-8); descodificar isso como UTF-8 estraga
 * cada acento. Lê o charset do Content-Type, com fallback para um <meta charset>, e trata a
 * família latin-1 como Node 'latin1'.
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

/** Decode the small set of HTML entities that can appear in a PT registry portal's cell text. */
export function decodeEntities(s: string): string {
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
export function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Accent-stripped, lowercased, `_`-joined label key ("Forma Jurídica" -> "forma_juridica"). */
function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Parses a 2-column "campo/valor" HTML table into a plain field map keyed by the
 * normalized label. Liberal by design (same discipline as citius.ts's `parsePublicacoes`):
 * walks every `<table>`, and any row with >=2 cells becomes one field (first cell = label,
 * the rest joined = value). Zero-dependency (no cheerio), reused by every certidão
 * connector (E2/E3) to read a portal's "resultado da consulta" page.
 */
export function parseCampoValorTable(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const tableInner = tableMatch[1] ?? '';
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(tableInner)) !== null) {
      const row = rowMatch[1] ?? '';
      const cells: string[] = [];
      const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(row)) !== null) cells.push(cellText(cellMatch[1] ?? ''));
      if (cells.length < 2) continue;
      const key = normalizeLabel(cells[0] ?? '');
      if (!key) continue;
      const value = cells.slice(1).join(' ').trim();
      if (value) out[key] = value;
    }
  }
  return out;
}
