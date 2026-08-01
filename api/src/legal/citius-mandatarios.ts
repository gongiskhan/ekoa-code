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
 *      notifications never collide. Only an IDENTIFYING id is trusted: a static/non-identifying token
 *      (a checkbox `value="on"`) is rejected, and any id that turns out DUPLICATED across the page's
 *      rows is dropped for the colliding rows (`parseInboxPage` pass 2) — so the verbatim-id path can
 *      never make content-distinct rows clash on ref. ONLY when a row exposes no usable id does ref
 *      fall back to a content hash — and then two content-identical notifications WOULD share a ref
 *      (a dedup MISS that silently drops one). If the first real snapshot shows no per-row id, that
 *      collision is a pinned risk whose backstop is the completeness reconciliation's count-check
 *      downstream (a dropped row surfaces as a count mismatch), not this parser.
 *   6. Empty-inbox RENDER SHAPE — this parser proves an empty inbox POSITIVELY (a GridView-structural
 *      marker on the <table>, plus no <input>-bearing rows), never from "a header table with no
 *      rows". If the real portal OMITS the `gvNotificacoes` id (or renders no <table> at all) when
 *      the inbox is empty, `parseInboxPage` returns ok:false and the sync treats empty as
 *      UNAVAILABLE. That is the safe direction (never a false empty), but a genuinely-empty inbox
 *      that renders without the marker would keep reporting "indisponível" — a live LIVELOCK risk.
 *      CS4/CS6 MUST confirm the real empty-state markup on first real access, and (see the CS4/CS6
 *      note by PROCESS_NUMBER_RE) key the inbox off the authenticated page identity, not the header.
 */
import { createHash } from 'node:crypto';
import { cellText, decodeEntities } from './portal-html.js';

/** PT-PT honest-failure copy (mirrors citius.ts's "indisponível" idiom). */
const UNAVAILABLE = 'Caixa de correio Citius indisponível';

/**
 * POSITIVE-PROOF signal for the notifications grid. An empty inbox is NEVER inferred from "a
 * header table with no rows" (a filter/search/legend/login/WAF table has exactly that shape) — it
 * must be positively PROVEN by a GridView-STRUCTURAL marker, which is the whole anti-false-empty
 * guarantee.
 */

/**
 * GridView-STRUCTURAL notifications markers on the grid <table>'s id/class. These must be
 * GRIDVIEW-structural, NOT the bare domain word `notificac`: a filter/error/menu container such as
 * `ctl00_cph_pnlPesquisaNotificacoes`, `divNotificacoesErro`, or `menuNotificacoesLink` ALSO
 * contains `notificac`, and treating that as proof was the round-3 false-empty defect. So a marker
 * is EITHER an ASP.NET GridView id whose `gv` control-type prefix is token-bounded and precedes
 * `notific` (`gvNotificacoes`, `ctl00_cph_gvNotificacoes`) OR an explicit `GridView` CSS class.
 *
 * A bare `notificacoes` id/class token is DELIBERATELY NOT a marker: an error/filter container like
 * `notificacoes-erro` / `notificacoes-panel` carries it too, so accepting it would re-open the very
 * hole this fix closes (the task lists it as a candidate token, rejected here as not
 * gridview-structural). `gv` must be token-bounded (start / non-alphanumeric, so `_gv` in the
 * ASP.NET id namespace qualifies but `pnlgvx…` does not). Matched case-insensitively.
 */
const GRID_MARKERS: readonly RegExp[] = [
  /(?:^|[^a-z0-9])gv[\w-]*notific/i, // ASP.NET GridView id: gvNotificacoes, ctl00_cph_gvNotificacoes
  /gridview/i,                        // an explicit GridView CSS class (.GridView / RadGrid variants)
];

/**
 * A Citius process number, ANCHORED so a European date can never masquerade as one (round-3
 * false-POSITIVE defect: an unanchored regex accepted `15/06/2026` as a process number, letting a
 * search-results/related-cases table parse as the inbox). A Citius number has EXACTLY ONE '/':
 * `<number>/<year>` optionally followed by a dotted court-code that CONTAINS A LETTER
 * (`1234/26.0T8LSB`, `45/26.7T8ABC-A`), or the bare `NNNN/YYYY` form (`123/2026`). A `DD/MM/YYYY`
 * date has TWO '/', so the single literal '/' plus the `$` anchor structurally rejects it (and
 * `isProcessNumber` guards the exact date shape explicitly, belt-and-braces). A row's processo cell
 * must match THIS to count as a notification, so a filter panel's <input>/label row (empty or
 * "Pesquisar" text) or a date cell can't be one.
 *
 * CS4/CS6 RESIDUAL (reviewer): the column HEADER alone does not prove a page is the inbox — a
 * search-results / related-cases page can carry the same Processo/Data/Tribunal header at a
 * DIFFERENT authenticated URL. CS4/CS6 MUST key the inbox off the authenticated URL / page identity
 * (the CaixaCorreio.aspx endpoint reached with a valid session), not merely this header/column
 * shape, so such a page can never be parsed as the notifications inbox.
 */
const PROCESS_NUMBER_RE = /^\d{1,7}\/(?:\d{1,4}\.\d+[a-z][a-z0-9]*(?:-[a-z0-9]+)?|\d{2,4})$/i;

/** A European DD/MM/YYYY (or D/M/YY) date — the shape DEFECT 2 must keep OUT of the processo cell.
 *  It carries TWO '/' where a Citius number has exactly one; an explicit guard in `isProcessNumber`. */
const EURO_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

/** Static / non-identifying `<input value=…>` tokens that must NOT be trusted as a per-row source
 *  id (a checkbox `value="on"` is shared by every row) — see `isIdentifyingId` / `extractSourceId`. */
const NON_IDENTIFYING_IDS = new Set([
  'on', 'off', 'true', 'false', 'checked', 'selected', 'yes', 'no', 'sim', 'nao',
]);

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

/** One `<table>`: its opening-tag attribute string (for the grid id/class marker) plus its inner HTML. */
interface RawTable {
  attrs: string;
  inner: string;
}

/** Every `<table>` on the page, with its opening-tag attributes and its inner HTML. */
function extractTables(html: string): RawTable[] {
  const out: RawTable[] = [];
  const re = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push({ attrs: m[1] ?? '', inner: m[2] ?? '' });
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
 * OBSERVED-family labels (from the public Citius / registry pages) mapped to the canonical field,
 * keyed by their NORMALIZED form (`normalizeHeader`). A header cell counts as a column ONLY when it
 * EQUALS one of these keys, never as a substring — that exact-match is what stops a prose error /
 * session-expired page laid out as a table (cells like "contacte o suporte imediato" or
 * "…terminou nesta data") from being mistaken for the notifications grid via 'ato'/'data' substrings.
 */
const OBSERVED_HEADER_LABELS: Record<string, string> = {
  processo: 'processo',
  data: 'data',
  tribunal: 'tribunal',
  ato: 'ato',
  acto: 'ato',
  documento: 'documento',
  anexo: 'documento',
};

/**
 * SPIKE — UNOBSERVED GUESSES. Realistic PT header VARIANTS the authenticated inbox MIGHT use, added
 * so a real header doesn't stall the sync. Each is still matched EXACTLY after `normalizeHeader`
 * (never as a substring). These are guesses, not observations — confirm/prune against the first
 * real snapshot (see FIRST-REAL-ACCOUNT SPIKE). Keys are already in normalized form (the masculine
 * ordinal 'º' survives `normalizeHeader`; accents/ç are stripped: 'notificação' -> 'notificacao').
 */
const SPIKE_HEADER_LABELS: Record<string, string> = {
  'nº processo': 'processo',
  'n.º processo': 'processo',
  'numero do processo': 'processo',
  'numero processo': 'processo',
  'nº do processo': 'processo',
  'data da notificacao': 'data',
  'data notificacao': 'data',
};

const HEADER_LABELS: Record<string, string> = { ...OBSERVED_HEADER_LABELS, ...SPIKE_HEADER_LABELS };

/** Canonical field a header label maps to via NORMALIZED EXACT-LABEL match; '' when not a column. */
function fieldForHeader(label: string): string {
  return HEADER_LABELS[normalizeHeader(label)] ?? '';
}

/** A Citius process number shape in a row's processo cell (see `PROCESS_NUMBER_RE`). A `DD/MM/YYYY`
 *  date is rejected FIRST (its two '/' would otherwise be a false positive), then the anchored,
 *  single-'/' Citius shape is required — which independently rejects any cell with a second '/'. */
function isProcessNumber(text: string): boolean {
  const t = text.trim();
  if (EURO_DATE_RE.test(t)) return false; // a European date is never a process number
  return PROCESS_NUMBER_RE.test(t);
}

/** True when a `<table>`'s opening-tag attributes carry a GridView-STRUCTURAL notifications marker
 *  (id/class matches one of `GRID_MARKERS`) — the positive STRUCTURAL proof this IS the grid. A
 *  bare `notificac` substring (a `pnl…`/`div…`/`menu…` filter/error container) does NOT qualify. */
function hasGridMarker(tableAttrs: string): boolean {
  return GRID_MARKERS.some((re) => re.test(tableAttrs));
}

/** True when any NON-header row of a table bears an `<input>`. A genuine empty grid has a header +
 *  zero data rows (or an EmptyDataTemplate message row), NEVER `<input>` rows — so an input-bearing
 *  row is a filter/search panel and DISQUALIFIES the table from the empty-inbox verdict. */
function hasInputBearingRow(rows: RawRow[], headerIdx: number): boolean {
  return rows.some((r, i) => i !== headerIdx && /<input\b/i.test(r.inner));
}

/** A candidate per-row source id is IDENTIFYING only when it is not a static/non-identifying token
 *  (`NON_IDENTIFYING_IDS`, e.g. a checkbox `value="on"`) and is long enough to be a plausible id. */
function isIdentifyingId(v: string | undefined): v is string {
  if (!v) return false;
  const t = v.trim();
  if (t.length < 2) return false;
  return !NON_IDENTIFYING_IDS.has(t.toLowerCase());
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
  // 1) a checkbox / hidden input value in the row (must be IDENTIFYING — a static `value="on"` is
  //    rejected here, and any survivor that still collides across rows is dropped in parseInboxPage).
  const inputRe = /<input\b[^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = inputRe.exec(rowInner)) !== null) {
    const tag = im[0];
    if (!/\btype\s*=\s*["']?(?:checkbox|hidden)["']?/i.test(tag)) continue;
    const v = attrValue(tag, 'value');
    if (isIdentifyingId(v)) return v;
  }
  // 2) a data-* notification id (or a row id) on the <tr> itself
  const dataId = attrValue(rowAttrs, 'data-notif(?:icacao)?-?id|data-message-?id|data-msg-?id|data-id|data-key');
  if (isIdentifyingId(dataId)) return dataId;
  const rowId = attrValue(rowAttrs, 'id');
  if (isIdentifyingId(rowId)) return rowId;
  // 3) an id-bearing open-notification link (never the inert documento download href)
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  let am: RegExpExecArray | null;
  while ((am = anchorRe.exec(rowInner)) !== null) {
    const href = decodeEntities(am[1] ?? am[2] ?? am[3] ?? '').trim();
    if (isIdentifyingId(href) && /notific/i.test(href) && !/documento/i.test(href)) return href;
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

/** A positively-identified grid candidate reduced to its parsed rows + its known-column count. */
interface GridCandidate {
  knownCount: number;
  rows: CitiusNotificacaoMeta[];
}

/**
 * Header-row identification for one candidate `<tr>`: the mapped columns must contain an EXACT
 * 'processo' column AND at least TWO known columns in total. This is the NECESSARY header gate, not
 * sufficient on its own — a filter/search panel can carry the same label row — so a table that
 * passes here is only treated as the grid once it ALSO clears the positive-identification gate in
 * `parseInboxPage` (a GridView-structural marker with no input rows, OR a process-number-shaped data
 * row). Anything that fails the exact-label test (a section-title row, a prose error page laid out as
 * a table) is rejected outright here. Returns the per-index field map on success, `null` otherwise.
 */
function identifyHeader(rowInner: string): string[] | null {
  const fieldByIndex = extractCells(rowInner).map((c) => fieldForHeader(cellText(c)));
  const known = new Set(fieldByIndex.filter(Boolean));
  return known.has('processo') && known.size >= 2 ? fieldByIndex : null;
}

/**
 * Parses one caixa-de-correio (mandatários) inbox page into notification METADATA. A LIBERAL
 * header-keyed table walker (like `parsePublicacoes`), hardened against the way a naive walk
 * silently drops legal deadlines: it scans ALL `<table>`s and, WITHIN each, the FIRST row that
 * passes header identification (`identifyHeader`) — skipping caption / colspan / decorative rows —
 * then, among the POSITIVELY-IDENTIFIED grids, picks the BEST (one WITH data rows beats one with
 * none, then most known columns, then most data rows) so a filter / section table before the real
 * GridView cannot shadow it. Columns map BY HEADER LABEL (a reordered GridView still parses).
 *
 * THE ONE LIE THIS MUST NEVER TELL is a FALSE EMPTY — `{ok:true, rows:[]}` ("inbox complete, zero
 * notifications") for a page that was actually a login / WAF-challenge / session-expired / error /
 * filter-search-chrome page. An empty inbox is therefore POSITIVELY PROVEN, never inferred from
 * "a header table with no rows" (a filter/login/error table has exactly that shape). A table is a
 * POSITIVELY-IDENTIFIED notifications grid only when EITHER: it has >=1 PROCESS-NUMBER-SHAPED data
 * row (`isProcessNumber`); OR it carries a GridView-STRUCTURAL marker on the <table> (`hasGridMarker`
 * — NOT the bare word `notificac`) AND has NO `<input>`-bearing rows (`hasInputBearingRow` — a filter
 * panel's row of inputs is not an empty grid). An explicit empty-inbox MESSAGE is NOT sufficient
 * proof on its own (a `pnlPesquisaNotificacoes` filter panel and a `divNotificacoesErro` error page
 * can both show one over a Processo/Data header): the structural marker is REQUIRED for the empty
 * verdict, so a message-only, non-gv table reads ok:false. The message is corroboration only, and is
 * deliberately not part of the decision (round-3: the marker+input requirement replaces it).
 *
 * THE DECISION RULE:
 *   - `ok:true` WITH rows        ⇔ a grid with >=1 process-number-shaped data row.
 *   - `ok:true` rows:[]          ⇔ a table with a GridView-STRUCTURAL marker AND no <input>-bearing
 *                                  rows AND zero process-number-shaped rows (a genuinely empty inbox).
 *   - `ok:false` ('indisponível') ⇔ EVERYTHING ELSE: a hard error/maintenance marker or empty/absent
 *                                  HTML; and any header-only filter / search / legend / login / WAF /
 *                                  session/error table that has the right label TEXTS (even an empty
 *                                  message, even a `notificac` substring in its id) but NEITHER a
 *                                  process-number data row NOR a GridView-structural marker over
 *                                  input-free rows.
 * A filter/search/legend/error/login page satisfies NONE of the positive signals -> `ok:false`, the
 * SAFE outcome (a dropped-deadline false empty is never worth risking over an honest "indisponível").
 */
export function parseInboxPage(html: string): ParseInboxResult {
  if (!html || looksUnavailable(html)) {
    return { ok: false, error: UNAVAILABLE };
  }

  let best: GridCandidate | null = null;

  for (const table of extractTables(html)) {
    const rows = extractRows(table.inner);

    // The header is the FIRST row that passes header identification (not merely the first row
    // containing "processo"), so a caption / colspan row above the real <th> is skipped.
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
    if (headerIdx === -1) continue; // no notifications-grid header in this table

    const idxOf = (field: string): number => fieldByIndex.indexOf(field);

    // Pass 1: parse each data row. A row counts as a notification ONLY when its processo cell is
    // PROCESS-NUMBER-SHAPED — so a filter panel's <input>/label row (empty or "Pesquisar" text) can
    // never be miscounted. Each row's candidate source id is captured for the pass-2 collision resolve.
    const parsed: { base: Omit<CitiusNotificacaoMeta, 'ref' | 'sourceId'>; candidateId: string | undefined }[] = [];

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
      if (!isProcessNumber(processo)) continue; // not a notification (label / <input> / prose / summary row)

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

      const base: Omit<CitiusNotificacaoMeta, 'ref' | 'sourceId'> = {
        processo,
        data: textAt('data'),
        temDocumento,
        ...(tribunal ? { tribunal } : {}),
        ...(ato ? { ato } : {}),
        ...(documentoRef ? { documentoRef } : {}),
      };
      parsed.push({ base, candidateId: extractSourceId(row.attrs, row.inner) });
    }

    // Pass 2: a candidate source id DUPLICATED across this grid's rows is non-identifying — drop it
    // for the colliding rows so ref falls back to the content hash. This means the verbatim-id path
    // can NEVER introduce a collision worse than the documented id-less hash residual (SPIKE #5): a
    // static/aliased id shared by content-distinct rows degrades to the hash, not a cross-row clash.
    const idCounts = new Map<string, number>();
    for (const p of parsed) {
      if (p.candidateId) idCounts.set(p.candidateId, (idCounts.get(p.candidateId) ?? 0) + 1);
    }

    const out: CitiusNotificacaoMeta[] = parsed.map(({ base, candidateId }) => {
      const sourceId = candidateId && idCounts.get(candidateId) === 1 ? candidateId : undefined;
      const withId: Omit<CitiusNotificacaoMeta, 'ref'> = sourceId ? { ...base, sourceId } : { ...base };
      return { ref: notificacaoRef(withId), ...withId };
    });

    // POSITIVELY-IDENTIFIED grid gate: EITHER >=1 process-number-shaped data row, OR a GridView-
    // STRUCTURAL marker on the <table> WITH no <input>-bearing rows (a genuinely empty grid). A bare
    // `notificac` substring, an empty-inbox message alone, or a row of filter <input>s does NOT
    // qualify — a header-only filter / search / legend / login / WAF / session / error table with
    // NONE of these is NOT the grid, and skipping it (rather than treating it as an empty inbox) is
    // the whole anti-false-empty guarantee.
    const emptyGridProven = hasGridMarker(table.attrs) && !hasInputBearingRow(rows, headerIdx);
    const positivelyIdentified = out.length > 0 || emptyGridProven;
    if (!positivelyIdentified) continue;

    const candidate: GridCandidate = { knownCount: new Set(fieldByIndex.filter(Boolean)).size, rows: out };
    // BEST among identified grids: a table WITH data rows outranks one with none (so a marker-only
    // empty grid cannot shadow the real one), then most known columns, then most rows.
    if (best === null || isBetterGrid(candidate, best)) best = candidate;
  }

  if (best === null) {
    // No positively-identified notifications grid anywhere -> honestly unavailable, NOT a false empty.
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
