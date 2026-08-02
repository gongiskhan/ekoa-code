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
 *   6. Empty-inbox RENDER SHAPE — this parser proves an empty inbox STRUCTURALLY (a GridView id
 *      marker on the <table>, ZERO structural data rows, and no interactive-control chrome
 *      anywhere in the table), never from "zero rows PARSED". If the real portal OMITS the
 *      `gvNotificacoes` id (or renders no <table> at all, or puts a select-all control in the
 *      grid header) when the inbox is empty, `parseInboxPage` returns ok:false and the sync treats
 *      empty as UNAVAILABLE. That is the safe direction (never a false empty), but a
 *      genuinely-empty inbox that renders without the marker would keep reporting "indisponível" —
 *      a live LIVELOCK risk. CS4/CS6 MUST confirm the real empty-state markup on first real
 *      access, and (see the CS4/CS6 note by PROCESS_NUMBER_RE) key the inbox off the authenticated
 *      page identity, not the header. Likewise a real grid that embeds a filter/pager row with
 *      >=2 DIRECT <td>s would read "indisponível" until CS4 confirms and the fixtures are updated
 *      — again the safe direction. (RadGrid-style chrome that wraps its controls in a NESTED
 *      table is handled structurally: nested tables are stripped from the outer grid's own rows —
 *      round-5 F1 — so such a command row degrades to a single-colspan non-data row and the grid
 *      still parses.)
 *
 * SAFETY HIERARCHY (pinned; the round-4 root-flaw redesign — attempt 5):
 *   1. A FALSE EMPTY (`{ok:true, rows:[]}` for a page that was NOT a genuinely empty inbox) is the
 *      CATASTROPHIC outcome: the completeness-verification rail downstream reads it as "inbox
 *      complete, zero notifications" and a legal notification is silently lost.
 *   2. A PARTIAL PARSE presented as complete (returning a SUBSET of a grid's data rows) is the
 *      same loss in miniature and is equally forbidden: a grid whose data rows do not ALL parse is
 *      `ok:false`, never a subset.
 *   3. `ok:false` ("indisponível") is always the SAFE answer. When uncertain, the parser says
 *      indisponível — never empty.
 *   The round-4 root flaw was conflating three distinct situations under "zero PARSED rows under a
 *   marker": a GENUINELY EMPTY inbox (structurally proven — zero DATA ROWS in a marked, control-free
 *   grid), a PARSE FAILURE (data rows exist but do not all parse -> ok:false), and PAGE CHROME
 *   (login / error / filter / WAF pages -> ok:false). "Zero rows parsed" proves NONE of them, and
 *   no verdict here is ever inferred from it.
 *
 * ROUND-5 SEAM HARDENING (the fresh-context review of attempt 5 confirmed the redesign but broke
 * the WALKERS it stands on; each fix is pinned by a "round-5" regression test):
 *   F1 nested-`</table>` truncation — tables are now paired DEPTH-AWARE to their matching close,
 *      HTML comments are stripped first, and nested tables are stripped from the outer grid's own
 *      structural rows (they classify as their own tables instead).
 *   F2 the interactive-control disqualifier scans the table's ENTIRE inner HTML, not just its
 *      `<tr>`s — a control in a <caption> / direct child / after the last row blocks EMPTY too.
 *   F3 rows (and cells) split on OPENERS: `</tr>`/`</td>` are optional end tags, and the lazy
 *      close-tag match silently merged the row after an omitted `</tr>` into the previous one.
 *   F4 the bare `NNNN/YYYY` process-number form requires a full 4-digit year, so a `DD/MM`
 *      fragment (`15/06`) or a 2-digit prose ref (`123/26`) can never be invented into a processo.
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
 * The GridView-STRUCTURAL notifications marker on the grid <table>'s id/class: an ASP.NET GridView
 * id whose `gv` control-type prefix is token-bounded and precedes `notific` (`gvNotificacoes`,
 * `ctl00_cph_gvNotificacoes`). This must be GRIDVIEW-structural, NOT the bare domain word
 * `notificac`: a filter/error/menu container such as `ctl00_cph_pnlPesquisaNotificacoes`,
 * `divNotificacoesErro`, or `menuNotificacoesLink` ALSO contains `notificac`, and treating that as
 * proof was the round-3 false-empty defect. `gv` must be token-bounded (start / non-alphanumeric,
 * so `_gv` in the ASP.NET id namespace qualifies but `pnlgvx…` does not). Matched
 * case-insensitively.
 *
 * DELIBERATELY NOT markers (each would re-open a false-empty hole):
 *   - a bare `notificacoes` id/class token — an error/filter container (`notificacoes-erro`,
 *     `notificacoes-panel`) carries it too (round-3 defect);
 *   - the attempt-4 `/gridview/i` class heuristic, DROPPED in round 4 (P1/P6): it was UNANCHORED,
 *     so any error/login chrome styled with the portal's `GridView` skin class satisfied it and a
 *     header-passing error panel became a false empty. A `GridView`-classed table with data that
 *     actually parses is still recognised through the data path (`parseInboxPage` rule 1); the
 *     class alone can no longer prove an EMPTY.
 */
const GRID_MARKER_RE = /(?:^|[^a-z0-9])gv[\w-]*notific/i;

/**
 * A Citius process number, ANCHORED so a European date can never masquerade as one (round-3
 * false-POSITIVE defect: an unanchored regex accepted `15/06/2026` as a process number, letting a
 * search-results/related-cases table parse as the inbox). A Citius number has EXACTLY ONE '/':
 * `<number>/<year>` optionally followed by a dotted court-code that CONTAINS A LETTER
 * (`1234/26.0T8LSB`, `45/26.7T8ABC-A`), or the bare `NNNN/YYYY` form (`123/2026`). A `DD/MM/YYYY`
 * date has TWO '/', so the single literal '/' plus the `$` anchor structurally rejects it (and
 * `isProcessNumber` guards the exact date shape explicitly, belt-and-braces).
 *
 * The BARE form requires a FULL 4-DIGIT year (round-5 F4): a 2-digit bare year (`15/06`, `123/26`)
 * is indistinguishable from a DD/MM day-month fragment or a prose reference, and under substring
 * extraction it would be INVENTED into a canonical processo — masking the row's parse failure with
 * wrong data. The lettered court-code form keeps 2-digit years (`1234/26.0T8LSB`): the letter
 * requirement already excludes every date shape.
 *
 * Applied PER WHITESPACE-DELIMITED TOKEN of the processo cell by `extractProcessNumber` (round-4
 * P4/P8): the anchors bound the TOKEN, not the whole cell, so a cell prefixed "Processo n.º
 * 1234/26.0T8LSB" still parses while a date token (`15/06/2026`) — whose inner fragment `06/2026`
 * is never a token of its own — still cannot match. A row counts as a notification only when its
 * processo cell CONTAINS such a token, so a filter panel's <input>/label row (empty or "Pesquisar"
 * text) or a date cell can't be one.
 *
 * CS4/CS6 RESIDUAL (reviewer): the column HEADER alone does not prove a page is the inbox — a
 * search-results / related-cases page can carry the same Processo/Data/Tribunal header at a
 * DIFFERENT authenticated URL. CS4/CS6 MUST key the inbox off the authenticated URL / page identity
 * (the CaixaCorreio.aspx endpoint reached with a valid session), not merely this header/column
 * shape, so such a page can never be parsed as the notifications inbox.
 */
const PROCESS_NUMBER_RE = /^\d{1,7}\/(?:\d{1,4}\.\d+[a-z][a-z0-9]*(?:-[a-z0-9]+)?|\d{4})$/i;

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

/**
 * Every `<table>` on the page — NESTED tables included, each with its opening-tag attributes and
 * its inner HTML spanning to its MATCHING `</table>` (depth-aware pairing — round-5 F1). The
 * previous lazy-regex walk ended a table at the FIRST `</table>` in document order, so a nested
 * table (RadGrid command/filter chrome between header and data rows, an icon table inside a cell)
 * TRUNCATED the grid fragment and every row after it vanished from the structural proof — a
 * reachable FALSE EMPTY and a reachable silent subset. A stray `</table>` closes the innermost
 * open table (how a browser recovers); an unterminated `<table>` spans to end-of-input (liberal —
 * a junk tail can only ADD chrome that blocks an empty verdict, never hide a data row).
 */
function extractTables(html: string): RawTable[] {
  const out: RawTable[] = [];
  const tokenRe = /<table\b([^>]*)>|<\/table\s*>/gi;
  const open: { attrs: string; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[0].charAt(1) !== '/') {
      open.push({ attrs: m[1] ?? '', contentStart: tokenRe.lastIndex });
    } else if (open.length > 0) {
      const o = open.pop()!;
      out.push({ attrs: o.attrs, inner: html.slice(o.contentStart, m.index) });
    }
  }
  while (open.length > 0) {
    const o = open.pop()!;
    out.push({ attrs: o.attrs, inner: html.slice(o.contentStart) });
  }
  return out;
}

/** The table's OWN inner HTML with nested `<table>…</table>` blocks removed (depth-aware), so a
 *  nested chrome/icon table can never contribute phantom rows, cells, or row-splits to the OUTER
 *  grid's structural classification (round-5 F1). Nested tables still surface as their own entries
 *  from `extractTables` and are classified independently on their own structure. */
function stripNestedTables(tableInner: string): string {
  const tokenRe = /<table\b[^>]*>|<\/table\s*>/gi;
  let depth = 0;
  let keptFrom = 0;
  let own = '';
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(tableInner)) !== null) {
    if (m[0].charAt(1) !== '/') {
      if (depth === 0) own += tableInner.slice(keptFrom, m.index);
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) keptFrom = tokenRe.lastIndex;
    }
  }
  if (depth === 0) own += tableInner.slice(keptFrom);
  // depth > 0: an unterminated NESTED table — its whole tail is nested content, excluded from OWN rows.
  return own;
}

/** One `<tr>`: its opening-tag attribute string (for `data-*` / `id` on the row) plus its inner HTML. */
interface RawRow {
  attrs: string;
  inner: string;
}

/**
 * Every `<tr>` inside a table fragment, with its opening-tag attributes and its inner HTML. Rows
 * are split on `<tr>` OPENERS (round-5 F3): `</tr>` is an OPTIONAL end tag in HTML, and the
 * previous lazy `<tr>…</tr>` match swallowed the row FOLLOWING an omitted `</tr>` into the current
 * row's trailing cells — the merged row still "parsed", so the swallowed notification vanished
 * SILENTLY from a populated verdict. A row's content ends at its own `</tr>` (anything between it
 * and the next opener is inter-row junk) or at the next `<tr>` opener, matching spec recovery.
 */
function extractRows(tableInner: string): RawRow[] {
  const out: RawRow[] = [];
  const openRe = /<tr\b([^>]*)>/gi;
  const opens: { attrs: string; index: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(tableInner)) !== null) {
    opens.push({ attrs: m[1] ?? '', index: m.index, contentStart: openRe.lastIndex });
  }
  for (let i = 0; i < opens.length; i++) {
    const end = i + 1 < opens.length ? opens[i + 1]!.index : tableInner.length;
    const inner = tableInner.slice(opens[i]!.contentStart, end).replace(/<\/tr\s*>[\s\S]*$/i, '');
    out.push({ attrs: opens[i]!.attrs, inner });
  }
  return out;
}

/** Raw inner HTML of every `<td>`/`<th>` cell inside a row fragment (kept RAW so the documento
 *  column can be inspected for an anchor before its text is collapsed). Cells split on OPENERS —
 *  `</td>`/`</th>` are optional end tags (the same omitted-end-tag family as round-5 F3), so an
 *  omitted close under the old lazy match merged neighbouring cells and shifted every column
 *  mapping after it. A cell ends at its own close tag or at the next cell opener. */
function extractCells(rowInner: string): string[] {
  const out: string[] = [];
  const openRe = /<t[dh]\b[^>]*>/gi;
  const opens: { index: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(rowInner)) !== null) opens.push({ index: m.index, contentStart: openRe.lastIndex });
  for (let i = 0; i < opens.length; i++) {
    const end = i + 1 < opens.length ? opens[i + 1]!.index : rowInner.length;
    out.push(rowInner.slice(opens[i]!.contentStart, end).replace(/<\/t[dh]\s*>[\s\S]*$/i, ''));
  }
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

/** A Citius process number shape for ONE token (see `PROCESS_NUMBER_RE`). A `DD/MM/YYYY` date is
 *  rejected FIRST (its two '/' would otherwise be a false positive), then the anchored,
 *  single-'/' Citius shape is required — which independently rejects any token with a second '/'. */
function isProcessNumber(text: string): boolean {
  const t = text.trim();
  if (EURO_DATE_RE.test(t)) return false; // a European date is never a process number
  return PROCESS_NUMBER_RE.test(t);
}

/** Punctuation trimmed off a token's EDGES before the process-number test (never internal dots —
 *  the court code carries them: `1234/26.0T8LSB.` trims to `1234/26.0T8LSB`). */
const TOKEN_EDGE_PUNCT_RE = /^[\s"'«»()[\]{}.,;:!?]+|[\s"'«»()[\]{}.,;:!?]+$/g;

/** A recognised process-label prefix GLUED to the number in the same token (`nº1234/26.0T8LSB`,
 *  `Proc.1234/26`). ONLY this closed family is stripped — an arbitrary leading run of non-digits is
 *  NOT (stripping `ABC` off `ABC123/26` would extract a number from a token that is something
 *  else entirely; such a row stays UNPARSED and rule 2 of `parseInboxPage` makes that ok:false). */
const TOKEN_PROCESS_PREFIX_RE = /^(?:processo|proc\.?|n\.?[ºo°]\.?)/i;

/**
 * The Citius process number CONTAINED in a processo cell's text, or `undefined` when the cell holds
 * none. Round-4 P4/P8 — the DANGEROUS defect: attempt 4 required the WHOLE cell to equal the
 * number, so a POPULATED inbox whose cells read "Processo n.º 1234/26.0T8LSB" parsed ZERO rows and
 * the verdict decayed toward the false-empty side. The number is now matched as a SUBSTRING,
 * token by token, while the date guard is KEPT: tokens are whitespace-delimited, so a `15/06/2026`
 * date stays one token, `isProcessNumber` still rejects it, and its inner fragment (`06/2026`) is
 * never a token of its own. Each token is tried verbatim (edge punctuation trimmed), then with a
 * RECOGNISED glued label prefix stripped (`nº1234/…`). First match wins; the extracted CANONICAL
 * number (not the prefixed cell prose) is what lands in `CitiusNotificacaoMeta.processo`.
 */
function extractProcessNumber(text: string): string | undefined {
  for (const rawToken of text.split(/\s+/)) {
    let token = rawToken.replace(TOKEN_EDGE_PUNCT_RE, '');
    if (!token) continue;
    if (isProcessNumber(token)) return token;
    // Retry with recognised glued prefixes stripped ("nº1234/26.0T8LSB", "Proc.1234/26"), a small
    // bounded loop so "Proc.nº1234/26" also resolves. Anything else stays unparsed on purpose.
    for (let guard = 0; guard < 3; guard++) {
      const next = token.replace(TOKEN_PROCESS_PREFIX_RE, '').replace(TOKEN_EDGE_PUNCT_RE, '');
      if (next === token || !next) break;
      token = next;
      if (isProcessNumber(token)) return token;
    }
  }
  return undefined;
}

/** True when a `<table>`'s opening-tag attributes carry the GridView-STRUCTURAL notifications
 *  marker (`GRID_MARKER_RE`) — the positive STRUCTURAL identification of the grid. A bare
 *  `notificac` substring (a `pnl…`/`div…`/`menu…` filter/error container) does NOT qualify, and
 *  neither does a `GridView` skin CLASS (dropped attempt-4 marker2 — see `GRID_MARKER_RE`). */
function hasGridMarker(tableAttrs: string): boolean {
  return GRID_MARKER_RE.test(tableAttrs);
}

/** Interactive-control shapes that disqualify a table from the EMPTY verdict: any form control
 *  (`<input>` — hidden included, a genuine empty grid carries none — `<select>`, `<button>`,
 *  `<textarea>`) or an editable region (`contenteditable`). Round-4 P3/P9: attempt 4 checked
 *  `<input>` only, so login/filter chrome built from a <select>+<button> (or a contenteditable
 *  region) evaded the disqualifier and produced a false empty. */
const INTERACTIVE_CONTROL_RE = /<(?:input|select|button|textarea)\b|\bcontenteditable\b/i;

/** True when the table carries ANY interactive control — in its own attributes or ANYWHERE in its
 *  ENTIRE inner HTML (round-5 F2): the previous per-`<tr>` scan missed a control in a `<caption>`,
 *  as a direct child of `<table>` before the first row, or after the last `</tr>` — each a false
 *  empty on a marked header-only grid. The whole-inner test is strictly stronger and includes the
 *  header row (attempt 4's evasion) and nested-table chrome by construction. A genuine empty grid
 *  is a header + an optional EmptyDataTemplate message row and NOTHING interactive; a table with
 *  controls is login/filter/search chrome and can NEVER prove an empty inbox. (A real empty grid
 *  with a select-all header checkbox would read "indisponível" until CS4 confirms the real markup
 *  — the safe direction; see SPIKE #6.) */
function hasInteractiveControl(table: RawTable): boolean {
  return INTERACTIVE_CONTROL_RE.test(table.attrs) || INTERACTIVE_CONTROL_RE.test(table.inner);
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
 * passes here is only treated as the grid once it ALSO clears `parseInboxPage`'s decision rules
 * (every data row parses, or a structurally-proven empty). Anything that fails the exact-label test
 * (a section-title row, a prose error page laid out as a table) is rejected outright here. Returns
 * the per-index field map on success, `null` otherwise.
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
 * then classifies each header-passing table by its STRUCTURAL DATA ROWS (a `<tr>` after the header
 * with >=2 cells; a single-colspan EmptyDataTemplate / pager / footer row is structurally NOT a
 * data row). Columns map BY HEADER LABEL (a reordered GridView still parses).
 *
 * THE ONE LIE THIS MUST NEVER TELL is a FALSE EMPTY — `{ok:true, rows:[]}` ("inbox complete, zero
 * notifications") for a page that was actually a login / WAF-challenge / session-expired / error /
 * filter-search-chrome page — see the SAFETY HIERARCHY in the module docblock. The round-4 root
 * flaw was inferring verdicts from "zero rows PARSED", which conflates a genuinely empty inbox, a
 * parse failure, and page chrome. Attempt 5 separates them STRUCTURALLY:
 *
 * PER-TABLE CLASSIFICATION (header-passing tables only; everything else is ignored):
 *   1. POPULATED grid  — >=1 structural data row and EVERY data row parses (its processo cell
 *      contains a process number, `extractProcessNumber`). The grid marker is corroboration, not
 *      required: fully-parsing data identifies the grid by content.
 *   2. PARSE FAILURE   — a gv-MARKED table with data rows where NOT all parse. Structurally this IS
 *      the grid, but it cannot be read completely, so the WHOLE PAGE is `ok:false` — returning the
 *      parseable subset would silently drop the rest, and returning empty would be the false empty.
 *      A NON-marked table with unparseable data rows is ambiguous chrome and merely proves nothing.
 *   3. PROVEN EMPTY    — a gv-MARKED table with ZERO structural data rows and NO interactive
 *      control anywhere in it (`hasInteractiveControl`: input/select/button/textarea/
 *      contenteditable — login/filter chrome can never be "empty"). This is the ONLY way an empty
 *      verdict arises: zero DATA ROWS proven structurally, never zero rows PARSED.
 *
 * PAGE-LEVEL DECISION (in precedence order):
 *   - any PARSE-FAILURE table            -> `ok:false` ('indisponível') — even if another table
 *     parsed fully: a marked grid we could not read completely means completeness cannot be
 *     claimed for this page (deliberate: availability is sacrificed, data loss never is).
 *   - else any POPULATED grid            -> `ok:true` with the BEST populated grid's rows (most
 *     known columns, then most rows — a marker-only empty grid can never shadow a populated one).
 *   - else any PROVEN-EMPTY grid         -> `ok:true, rows:[]` — the ONE legitimate empty.
 *   - else                               -> `ok:false` ('indisponível'): hard error/maintenance
 *     markers, empty/absent HTML, and every filter / search / legend / login / WAF / session /
 *     error page that has the right label TEXTS but neither fully-parsing data nor structural
 *     empty proof. The SAFE outcome — a dropped-deadline false empty is never worth risking over
 *     an honest "indisponível".
 */
export function parseInboxPage(html: string): ParseInboxResult {
  if (!html || looksUnavailable(html)) {
    return { ok: false, error: UNAVAILABLE };
  }

  // HTML comments are stripped up front (round-5 F1): a `</table>` inside a comment is not markup,
  // but the regex-based structural walkers below would otherwise truncate the grid at it and every
  // row after the comment would vanish from the structural proof.
  const page = html.replace(/<!--[\s\S]*?-->/g, '');

  let bestPopulated: GridCandidate | null = null;
  let provenEmpty = false;
  let parseFailure = false;

  for (const table of extractTables(page)) {
    // Structural rows are the table's OWN rows: nested chrome/icon tables are stripped first so
    // they cannot inject phantom rows or split a data row (round-5 F1); they are classified as
    // their own tables by the outer loop instead.
    const rows = extractRows(stripNestedTables(table.inner));

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

    // Pass 1: walk the STRUCTURAL DATA ROWS (>=2 cells after the header; a single-colspan
    // EmptyDataTemplate / pager / footer row is structurally not a data row) and parse each one. A
    // data row PARSES only when its processo cell CONTAINS a process number (`extractProcessNumber`
    // — substring, date-guarded). dataRowCount vs parsed.length is what separates a genuinely empty
    // grid from a parse failure below. Each row's candidate source id is captured for the pass-2
    // collision resolve.
    const parsed: { base: Omit<CitiusNotificacaoMeta, 'ref' | 'sourceId'>; candidateId: string | undefined }[] = [];
    let dataRowCount = 0;

    for (const row of rows.slice(headerIdx + 1)) {
      const cells = extractCells(row.inner);
      if (cells.length < 2) continue; // structurally NOT a data row (EmptyDataTemplate / footer / pager colspan)
      dataRowCount++;

      const rawAt = (field: string): string | undefined => {
        const i = idxOf(field);
        return i >= 0 && i < cells.length ? cells[i] : undefined;
      };
      const textAt = (field: string): string => {
        const raw = rawAt(field);
        return raw === undefined ? '' : cellText(raw);
      };

      const processo = extractProcessNumber(textAt('processo'));
      if (!processo) continue; // an UNPARSED data row (label / <input> / prose / summary row) — dataRowCount still counted it

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

    const marked = hasGridMarker(table.attrs);

    // CLASSIFICATION 3 — zero structural data rows: a PROVEN EMPTY only with the structural marker,
    // no interactive control anywhere in the ENTIRE table (round-5 F2 — caption / direct-child /
    // after-last-row controls included), and NO nested <table> at all (round-5: an empty GridView
    // renders a header + optional EmptyDataTemplate row and nothing else, so nested-table content
    // inside a marked zero-data-row grid is unmodelled chrome — never an empty proof). Otherwise
    // the table proves nothing (a header-only filter / legend / login shell) and is skipped.
    if (dataRowCount === 0) {
      if (marked && !hasInteractiveControl(table) && !/<table\b/i.test(table.inner)) provenEmpty = true;
      continue;
    }

    // CLASSIFICATION 2 — data rows exist but NOT all parse: on a MARKED grid that is a parse
    // failure (poisons the page verdict — never a subset, never an empty); on an unmarked table it
    // is ambiguous chrome and proves nothing.
    if (parsed.length < dataRowCount) {
      if (marked) parseFailure = true;
      continue;
    }

    // CLASSIFICATION 1 — a fully-parsing POPULATED grid.
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

    const candidate: GridCandidate = { knownCount: new Set(fieldByIndex.filter(Boolean)).size, rows: out };
    if (bestPopulated === null || isBetterGrid(candidate, bestPopulated)) bestPopulated = candidate;
  }

  // PAGE-LEVEL DECISION — precedence pinned in the docblock: parse-failure > populated > proven-empty.
  if (parseFailure) {
    // A marked grid whose data rows did not all parse: completeness cannot be claimed for this
    // page. Never a subset, never an empty — honestly unavailable.
    return { ok: false, error: UNAVAILABLE };
  }
  if (bestPopulated !== null) {
    const pageTotal = detectPageTotal(page);
    return pageTotal !== undefined
      ? { ok: true, rows: bestPopulated.rows, pageTotal }
      : { ok: true, rows: bestPopulated.rows };
  }
  if (provenEmpty) {
    const pageTotal = detectPageTotal(page);
    return pageTotal !== undefined ? { ok: true, rows: [], pageTotal } : { ok: true, rows: [] };
  }

  // No populated grid, no structurally-proven empty -> honestly unavailable, NOT a false empty.
  return { ok: false, error: UNAVAILABLE };
}

/** True when populated grid `a` should be preferred over `b`: most known columns, then most rows.
 *  (Only fully-parsing POPULATED grids compete here — an empty or failing table never becomes a
 *  candidate, so the old has-data-rows tier is structural now, not a comparison.) */
function isBetterGrid(a: GridCandidate, b: GridCandidate): boolean {
  if (a.knownCount !== b.knownCount) return a.knownCount > b.knownCount;
  return a.rows.length > b.rows.length;
}
