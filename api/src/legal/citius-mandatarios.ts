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
 *   5. Per-row source id — whether each notification row exposes its OWN stable id (a select
 *      checkbox / hidden value, a `data-*` / row id, or an open-notification link). `extractSourceId`
 *      reads it and `notificacaoRef` uses it VERBATIM as the dedup ref, so two content-identical
 *      notifications never collide. ONLY when a row exposes no id does ref fall back to a content
 *      hash — and then two content-identical notifications WOULD share a ref (a dedup MISS that
 *      silently drops one). If the first real snapshot shows no per-row id, that collision is a
 *      pinned risk whose backstop is the completeness reconciliation's count-check downstream (a
 *      dropped row surfaces as a count mismatch), not this parser.
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
  /**
   * Dedup id for this notification: the row's own STABLE SOURCE ID (`sourceId`) when the portal
   * exposes one, otherwise a content hash of the id-bearing fields. See `notificacaoRef`.
   */
  ref: string;
  processo: string;
  data: string;
  tribunal?: string;
  ato?: string;
  /** True when the row advertises an attached document (a link or a non-empty documento cell). */
  temDocumento: boolean;
  /** INERT captured href/token for the document — never fetched by this codebase. */
  documentoRef?: string;
  /**
   * The row's own STABLE identifier as exposed by the portal (a select-checkbox / hidden input
   * value, a `data-*` / row id, or an open-notification link). Present only when the row carries
   * one; when present `ref` is set to it VERBATIM so content-identical notifications never collide.
   * Absent when the portal exposes no per-row id — see FIRST-REAL-ACCOUNT SPIKE #5.
   */
  sourceId?: string;
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

/** One `<tr>`: its opening-tag attribute string (for `data-*` / `id` on the row) plus its inner HTML. */
interface RawRow {
  attrs: string;
  inner: string;
}

/** Every `<tr>` inside a table fragment, with its opening-tag attributes and its inner HTML. */
function extractRows(tableInner: string): RawRow[] {
  const out: RawRow[] = [];
  const re = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tableInner)) !== null) out.push({ attrs: m[1] ?? '', inner: m[2] ?? '' });
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

/**
 * Normalizes a header cell for EXACT-label comparison: lowercase, strip accents, collapse
 * internal whitespace, trim, and drop a single trailing ':'. ("Ato:" / " ACTO " -> "ato").
 */
function normalizeHeader(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/:$/, '')
    .trim();
}

/**
 * Canonical field a header label maps to via NORMALIZED EXACT-LABEL match — a cell counts as a
 * column ONLY when it EQUALS a known label, never as a substring. This is what stops a prose
 * error / session-expired page laid out as a table (cells like "contacte o suporte imediato" or
 * "…terminou nesta data") from being mistaken for the notifications grid via 'ato'/'data'
 * substrings. Returns '' when the cell is not a known column.
 */
function fieldForHeader(label: string): string {
  switch (normalizeHeader(label)) {
    case 'processo':
      return 'processo';
    case 'data':
      return 'data';
    case 'tribunal':
      return 'tribunal';
    case 'ato':
    case 'acto':
      return 'ato';
    case 'documento':
    case 'anexo':
      return 'documento';
    default:
      return '';
  }
}

/**
 * Reads one attribute value off a raw tag / attribute string (attribute-order and
 * single/double/unquoted tolerant), entity-decoded and trimmed. `nameAlt` is a regex alternation
 * of acceptable attribute names. Returns `undefined` when absent or empty.
 */
function attrValue(source: string, nameAlt: string): string | undefined {
  const re = new RegExp(`\\b(?:${nameAlt})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(source);
  if (!m) return undefined;
  const v = decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim();
  return v || undefined;
}

/**
 * The row's own STABLE SOURCE ID as the portal exposes it — preferred over a content hash for
 * dedup so two content-identical notifications never collide. Looks, in priority order, for:
 *   1. a select-checkbox / hidden `<input>` value in the row (the classic WebForms GridView
 *      select-column key);
 *   2. a `data-*` notification id (or a row `id`) on the `<tr>` element itself;
 *   3. an id-bearing OPEN-notification link (an href naming a `notific…` endpoint) — never the
 *      inert documento download href.
 * Returns `undefined` when the row exposes none, in which case `notificacaoRef` falls back to a
 * content hash. This never fetches anything: every candidate is read out of the row's own markup.
 */
function extractSourceId(rowAttrs: string, rowInner: string): string | undefined {
  // 1) a checkbox / hidden input value in the row
  const inputRe = /<input\b[^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = inputRe.exec(rowInner)) !== null) {
    const tag = im[0];
    if (!/\btype\s*=\s*["']?(?:checkbox|hidden)["']?/i.test(tag)) continue;
    const v = attrValue(tag, 'value');
    if (v) return v;
  }
  // 2) a data-* notification id (or a row id) on the <tr> itself
  const dataId = attrValue(rowAttrs, 'data-notif(?:icacao)?-?id|data-message-?id|data-msg-?id|data-id|data-key');
  if (dataId) return dataId;
  const rowId = attrValue(rowAttrs, 'id');
  if (rowId) return rowId;
  // 3) an id-bearing open-notification link (never the inert documento download href)
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  let am: RegExpExecArray | null;
  while ((am = anchorRe.exec(rowInner)) !== null) {
    const href = decodeEntities(am[1] ?? am[2] ?? am[3] ?? '').trim();
    if (href && /notific/i.test(href) && !/documento/i.test(href)) return href;
  }
  return undefined;
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
 * The dedup ref for one notification row. When the row exposes its own stable id (`sourceId`,
 * from `extractSourceId`) that id is the ref VERBATIM, so two content-identical notifications with
 * distinct source ids keep distinct refs (no dedup MISS). ONLY when the row exposes no source id
 * does the ref fall back to a sha256 content hash of the id-bearing fields (mirroring
 * `insolvencia-watch.publicacaoRef`) — in which case two content-identical id-less notifications
 * WOULD share a ref (a pinned first-real-account risk; see SPIKE #5). Stable across a re-parse of
 * the same row. `temDocumento` is derived and left out of the hash; `ref` is not fed back in.
 */
export function notificacaoRef(row: Omit<CitiusNotificacaoMeta, 'ref'>): string {
  if (row.sourceId) return row.sourceId;
  return createHash('sha256')
    .update([row.processo, row.data, row.tribunal ?? '', row.ato ?? '', row.documentoRef ?? ''].join('|'))
    .digest('hex')
    .slice(0, 24);
}

/** A STRONG-grid candidate table already reduced to its parsed rows + its known-column count. */
interface GridCandidate {
  knownCount: number;
  rows: CitiusNotificacaoMeta[];
}

/**
 * STRONG grid identification for one header-candidate `<tr>`: the mapped columns must contain an
 * EXACT 'processo' column AND at least TWO known columns in total. Anything less is NOT the
 * notifications grid (a filter panel, a section-title row, or a prose error page laid out as a
 * table). Returns the per-index field map on success, `null` otherwise.
 */
function identifyHeader(rowInner: string): string[] | null {
  const fieldByIndex = extractCells(rowInner).map((c) => fieldForHeader(cellText(c)));
  const known = new Set(fieldByIndex.filter(Boolean));
  return known.has('processo') && known.size >= 2 ? fieldByIndex : null;
}

/**
 * Parses one caixa-de-correio (mandatários) inbox page into notification METADATA. A LIBERAL
 * header-keyed table walker (like `parsePublicacoes`), hardened against the two ways a naive walk
 * silently drops legal deadlines:
 *   - it scans ALL `<table>`s and, WITHIN each, the FIRST row that passes STRONG grid
 *     identification (`identifyHeader`) — skipping caption / colspan / decorative rows that merely
 *     mention "processo" in prose;
 *   - among the tables that pass, it picks the BEST grid (one WITH data rows beats one with none,
 *     then most known columns, then most data rows) rather than the first, so a filter / section
 *     table before the real GridView cannot shadow it.
 * Columns map BY HEADER LABEL (a reordered GridView still parses). Entity-decoded throughout.
 *
 * THE ONE LIE THIS MUST NEVER TELL is a false empty — reporting `{ok:true, rows:[]}` ("inbox
 * complete, zero notifications") for a page that was actually a login redirect / error / empty
 * shell. So the ONLY `{ok:true, rows:[]}` outcome is a STRONGLY-identified grid that positively
 * has zero data rows. Concretely:
 *   - a hard error/maintenance marker (`looksUnavailable`), or empty/absent HTML -> `{ok:false}`.
 *   - a STRONG grid FOUND with data rows -> `{ok:true, rows:[...]}`.
 *   - a STRONG grid FOUND with zero data rows (a genuinely empty inbox; header present, e.g.
 *     GridView ShowHeaderWhenEmpty) -> `{ok:true, rows:[]}`.
 *   - NO strong grid anywhere (no table / login page / error shell / prose-as-table) -> `{ok:false}`.
 */
export function parseInboxPage(html: string): ParseInboxResult {
  if (!html || looksUnavailable(html)) {
    return { ok: false, error: UNAVAILABLE };
  }

  let best: GridCandidate | null = null;

  for (const tableInner of extractTables(html)) {
    const rows = extractRows(tableInner);

    // The header is the FIRST row that passes strong grid identification (not merely the first
    // row containing "processo"), so a caption / colspan row above the real <th> is skipped.
    let headerIdx = -1;
    let fieldByIndex: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const mapped = identifyHeader(rows[i]!.inner);
      if (mapped) {
        headerIdx = i;
        fieldByIndex = mapped;
        break;
      }
    }
    if (headerIdx === -1) continue; // not the notifications grid

    const idxOf = (field: string): number => fieldByIndex.indexOf(field);
    const out: CitiusNotificacaoMeta[] = [];

    for (const row of rows.slice(headerIdx + 1)) {
      const cells = extractCells(row.inner);
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

      const sourceId = extractSourceId(row.attrs, row.inner);

      const base: Omit<CitiusNotificacaoMeta, 'ref'> = {
        processo,
        data: textAt('data'),
        temDocumento,
        ...(tribunal ? { tribunal } : {}),
        ...(ato ? { ato } : {}),
        ...(documentoRef ? { documentoRef } : {}),
        ...(sourceId ? { sourceId } : {}),
      };
      out.push({ ref: notificacaoRef(base), ...base });
    }

    const candidate: GridCandidate = { knownCount: new Set(fieldByIndex.filter(Boolean)).size, rows: out };
    // BEST among strong grids: a table WITH data rows outranks one with none (so a strong-but-empty
    // decorative / filter grid cannot shadow the real one), then most known columns, then most rows.
    if (best === null || isBetterGrid(candidate, best)) best = candidate;
  }

  if (best === null) {
    // No STRONG notifications grid anywhere -> honestly unavailable, NOT a false empty.
    return { ok: false, error: UNAVAILABLE };
  }

  const pageTotal = detectPageTotal(html);
  return pageTotal !== undefined ? { ok: true, rows: best.rows, pageTotal } : { ok: true, rows: best.rows };
}

/** True when grid `a` should be preferred over `b`: has-data-rows, then knownCount, then rowCount. */
function isBetterGrid(a: GridCandidate, b: GridCandidate): boolean {
  const aHasRows = a.rows.length > 0 ? 1 : 0;
  const bHasRows = b.rows.length > 0 ? 1 : 0;
  if (aHasRows !== bHasRows) return aHasRows > bHasRows;
  if (a.knownCount !== b.knownCount) return a.knownCount > b.knownCount;
  return a.rows.length > b.rows.length;
}
