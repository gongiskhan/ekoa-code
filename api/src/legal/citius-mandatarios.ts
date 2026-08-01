/**
 * Caixa Citius (área de MANDATÁRIOS) — the PARSE half of the authenticated inbox connector
 * (CS1). This module is the single live-shape isolation point for the mandatários flow: every
 * byte of assumed portal shape lives HERE and in `api/tests/legal/fixtures/citius-mandatarios/`,
 * nowhere else in the codebase.
 *
 * SPECULATIVE BY CONSTRUCTION. The authenticated mandatários inbox HTML has NEVER been observed
 * (no account exists). Every fixture is SYNTHETIC, authored to the known ASP.NET WebForms /
 * ISO-8859-1 family the public Citius pages already use (`citius.ts`, `insolvencia-watch.ts`).
 * The parser is therefore deliberately LIBERAL (header-keyed, tolerant of column reordering and
 * quote/attribute-order drift) so the first real snapshot needs a fixture swap, not a rewrite.
 *
 * OPERATOR-LOCKED, STRUCTURAL — metadata only, documents never opened:
 *   The sync this parser feeds fetches notification METADATA ONLY and NEVER opens a document.
 *   This module MUST NOT export (or define) any function that fetches, downloads, or opens a
 *   document. A `documentoRef` on a row is an INERT captured string — recorded so a human can
 *   later act on it, NEVER dereferenced by this codebase. There is no injected fetch seam, no
 *   network, nothing to enumerate here at all; the authenticated HTTP enumerate/session-replay
 *   half is a separate later slice (CS4), and CS6 assembles the two.
 *
 * FIRST-REAL-ACCOUNT SPIKE (pinned unknowns to confirm against the first live snapshot — until
 * then every one is a guess encoded in the fixtures):
 *   1. Session lifetime — how long the authenticated cookie/VIEWSTATE stays valid; re-login cadence.
 *   2. Datacentre-IP / WAF replay — whether a server-side (non-residential) IP is challenged or
 *      blocked by the fronting WAF, and what a challenge page looks like.
 *   3. Concurrent-session logout — whether a second session invalidates the first (single-session
 *      portals silently log the older one out mid-sync).
 *   4. Pagination mode — GET (`?page=N`) vs WebForms `__doPostBack` postback vs none; `detectPagingMode`
 *      encodes both guesses so CS4 can branch on the observed reality.
 */
import { createHash } from 'node:crypto';
import { cellText, decodeEntities } from './portal-html.js';

/** PT-PT honest-failure copy (mirrors citius.ts's "indisponível" idiom). */
const UNAVAILABLE = 'Caixa de correio Citius indisponível';

/**
 * One inbox notification, METADATA ONLY. `documentoRef` is an inert captured string (the href /
 * token that WOULD address the document) — this module never dereferences it, and no function
 * here fetches a document.
 */
export interface CitiusNotificacaoMeta {
  /** Stable content-hash id for dedup (the portal rows carry no stable id). See `notificacaoRef`. */
  ref: string;
  processo: string;
  data: string;
  tribunal?: string;
  ato?: string;
  /** True when the row advertises an attached document (a link or a non-empty documento cell). */
  temDocumento: boolean;
  /** INERT captured href/token for the document — never fetched by this codebase. */
  documentoRef?: string;
}

export type ParseInboxResult =
  | { ok: true; rows: CitiusNotificacaoMeta[]; pageTotal?: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Zero-dependency HTML walkers (same discipline as citius.ts's parsePublicacoes:
// no cheerio; liberal regex table walk).
// ---------------------------------------------------------------------------

/** Inner HTML of every `<table>` on the page. */
function extractTables(html: string): string[] {
  const out: string[] = [];
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1] ?? '');
  return out;
}

/** Inner HTML of every `<tr>` inside a table fragment. */
function extractRows(tableInner: string): string[] {
  const out: string[] = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tableInner)) !== null) out.push(m[1] ?? '');
  return out;
}

/** Raw inner HTML of every `<td>`/`<th>` cell inside a row fragment (kept RAW so the documento
 *  column can be inspected for an anchor before its text is collapsed). */
function extractCells(rowInner: string): string[] {
  const out: string[] = [];
  const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowInner)) !== null) out.push(m[1] ?? '');
  return out;
}

/** First `href` inside a cell's raw HTML, entity-decoded. The captured value is INERT — it is
 *  stored as `documentoRef` and never dereferenced. */
function extractHref(cellHtml: string): string | undefined {
  const m = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(cellHtml);
  if (!m) return undefined;
  const raw = m[1] ?? m[2] ?? m[3] ?? '';
  const href = decodeEntities(raw).trim();
  return href || undefined;
}

/** Canonical field a header label maps to (accent-insensitive substring match), or '' if none. */
function fieldForHeader(label: string): string {
  const h = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (h.includes('processo')) return 'processo';
  if (h.includes('documento') || h.includes('anexo')) return 'documento';
  if (h.includes('tribunal')) return 'tribunal';
  if (h.includes('acto') || h.includes('ato')) return 'ato';
  if (h.includes('data')) return 'data';
  return '';
}

/**
 * Heurística "página indisponível" (idioma de `citius.ts`'s `looksUnavailable`): marcadores
 * duros de erro/manutenção do WebForms que NUNCA aparecem numa caixa de correio real. Não usa a
 * ausência de `<form>` como sinal (a caixa TEM formulário) — a distinção real "sem tabela vs
 * tabela vazia" é feita pela procura da tabela de notificações, abaixo.
 */
function looksUnavailable(html: string): boolean {
  const h = html.toLowerCase();
  return (
    h.includes('aspxerrorpath') ||
    h.includes('errorpage') ||
    h.includes('ocorreu um erro') ||
    h.includes('serviço indisponível') ||
    h.includes('servico indisponivel') ||
    h.includes('em manutenção') ||
    h.includes('em manutencao') ||
    h.includes('página de manutenção')
  );
}

/**
 * Reads the paging total from the pager, if the page advertises one: the highest N across GET
 * links (`?page=N` / `?p=N`) and `__doPostBack(...,'Page$N')` postback links. `undefined` when no
 * pager is present (a single-page inbox).
 */
function detectPageTotal(html: string): number | undefined {
  const nums: number[] = [];
  const getRe = /[?&]p(?:age)?=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = getRe.exec(html)) !== null) nums.push(parseInt(m[1] ?? '0', 10));
  const pbRe = /Page\$(\d+)/gi;
  while ((m = pbRe.exec(html)) !== null) nums.push(parseInt(m[1] ?? '0', 10));
  const valid = nums.filter((n) => Number.isFinite(n) && n > 0);
  return valid.length ? Math.max(...valid) : undefined;
}

/**
 * Classifies the pager so CS4 can drive it against the real portal.
 *  - a link carrying a GET page param (`href="...?page=N"` / `?p=N`) -> 'get'
 *  - a WebForms postback link (`href="javascript:__doPostBack(...)"` with call args) -> 'postback'
 *  - neither -> 'none'
 * GET is checked first. Postback detection matches only an ANCHOR invoking `__doPostBack` with
 * quoted args, so the `function __doPostBack(...)` definition every WebForms page emits (unquoted
 * params) is NOT mistaken for a pager — a GET-paged page that also ships that script stays 'get'.
 */
export function detectPagingMode(html: string): 'get' | 'postback' | 'none' {
  if (/href\s*=\s*["'][^"']*[?&]p(?:age)?=\d+/i.test(html)) return 'get';
  if (/href\s*=\s*["']\s*javascript:__doPostBack/i.test(html)) return 'postback';
  if (/__doPostBack\s*\(\s*["']/.test(html)) return 'postback';
  return 'none';
}

/**
 * A stable content-hash ref for one notification row (sha256 of the id-bearing fields, mirroring
 * `insolvencia-watch.publicacaoRef`) because the portal rows carry no stable id. Stable across a
 * re-parse of the same row and distinct across distinct rows. `temDocumento` is derived from
 * `documentoRef` and left out of the hash; `ref` itself is obviously not fed back in.
 */
export function notificacaoRef(row: Omit<CitiusNotificacaoMeta, 'ref'>): string {
  return createHash('sha256')
    .update([row.processo, row.data, row.tribunal ?? '', row.ato ?? '', row.documentoRef ?? ''].join('|'))
    .digest('hex')
    .slice(0, 24);
}

/**
 * Parses one caixa-de-correio (mandatários) inbox page into notification METADATA. A LIBERAL
 * header-keyed table walker (like `parsePublicacoes`): finds the notifications table by its
 * header row (a `<tr>` whose text names "processo" plus at least one other known column), maps
 * columns BY HEADER LABEL (so a reordered GridView still parses), and reads each following data
 * row by that column map. Entity-decoded throughout.
 *
 * THE ONE LIE THIS MUST NEVER TELL is a false empty — reporting `{ok:true, rows:[]}` ("inbox
 * complete, zero notifications") for a page that was actually a login redirect / error / empty
 * shell. So:
 *   - a hard error/maintenance marker (`looksUnavailable`) -> `{ok:false, error}`.
 *   - the notifications table FOUND, with data rows -> `{ok:true, rows:[...]}`.
 *   - the notifications table FOUND but with zero data rows (a genuinely empty inbox; the header
 *     is present, e.g. GridView ShowHeaderWhenEmpty) -> `{ok:true, rows:[]}`.
 *   - the notifications table NOT found (no table / login page / error shell) -> `{ok:false, error}`.
 * "Table present, zero rows" (ok, empty) is thus distinguished from "no table" (not ok) by the
 * positive presence of the header row — never conflated.
 */
export function parseInboxPage(html: string): ParseInboxResult {
  if (!html || looksUnavailable(html)) {
    return { ok: false, error: UNAVAILABLE };
  }

  for (const tableInner of extractTables(html)) {
    const rows = extractRows(tableInner);
    // The header is the first row whose text names the processo column.
    const headerIdx = rows.findIndex((r) => cellText(r).toLowerCase().includes('processo'));
    if (headerIdx === -1) continue;

    const headerCells = extractCells(rows[headerIdx] ?? '');
    const fieldByIndex = headerCells.map((c) => fieldForHeader(cellText(c)));
    // Require processo + at least one other known column, so a stray layout table that merely
    // contains the word "processo" is not mistaken for the notifications grid.
    const known = new Set(fieldByIndex.filter(Boolean));
    if (!known.has('processo') || known.size < 2) continue;

    const idxOf = (field: string): number => fieldByIndex.indexOf(field);
    const out: CitiusNotificacaoMeta[] = [];

    for (const rowInner of rows.slice(headerIdx + 1)) {
      const cells = extractCells(rowInner);
      if (cells.length < 2) continue; // skip an EmptyDataTemplate / footer / pager row (single colspan cell)

      const rawAt = (field: string): string | undefined => {
        const i = idxOf(field);
        return i >= 0 && i < cells.length ? cells[i] : undefined;
      };
      const textAt = (field: string): string => {
        const raw = rawAt(field);
        return raw === undefined ? '' : cellText(raw);
      };

      const processo = textAt('processo');
      if (!processo) continue; // a data row must have a processo; guards template/summary rows

      const tribunal = textAt('tribunal');
      const ato = textAt('ato');

      let temDocumento = false;
      let documentoRef: string | undefined;
      const docRaw = rawAt('documento');
      if (docRaw !== undefined) {
        const href = extractHref(docRaw);
        if (href) {
          documentoRef = href; // INERT — captured, never dereferenced
          temDocumento = true;
        } else if (cellText(docRaw)) {
          temDocumento = true; // e.g. a "Sim" / icon-only documento cell with no addressable link
        }
      }

      const base: Omit<CitiusNotificacaoMeta, 'ref'> = {
        processo,
        data: textAt('data'),
        temDocumento,
        ...(tribunal ? { tribunal } : {}),
        ...(ato ? { ato } : {}),
        ...(documentoRef ? { documentoRef } : {}),
      };
      out.push({ ref: notificacaoRef(base), ...base });
    }

    const pageTotal = detectPageTotal(html);
    return pageTotal !== undefined ? { ok: true, rows: out, pageTotal } : { ok: true, rows: out };
  }

  // No notifications table found anywhere -> honestly unavailable, NOT a false empty.
  return { ok: false, error: UNAVAILABLE };
}
