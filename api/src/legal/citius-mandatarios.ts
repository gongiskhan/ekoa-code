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
 *   The sync this parser feeds reads notification METADATA ONLY and NEVER opens a document.
 *   This module MUST NOT export (or define) any function that downloads or opens a document. A
 *   `documentoRef` on a row is an INERT captured string — recorded so a human can later act on
 *   it, NEVER dereferenced by this codebase. There is no injected network seam, no network,
 *   nothing to enumerate here at all; the authenticated HTTP enumerate/session-replay half is a
 *   separate later slice (CS4), and CS6 assembles the two.
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
 *      table is handled structurally: a nested table classifies as its own candidate and never
 *      contributes rows or cells to the outer grid — round-5 F1 — so such a command row degrades
 *      to a single-colspan non-data row and the grid still parses.)
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
 * ROUND-5 / ROUND-5B (history, pinned by the committed regression suites): the fresh-context
 * reviews of attempt 5 confirmed the structural redesign but broke the hand-rolled WALKERS it
 * stood on — nested-`</table>` truncation, controls outside every `<tr>`, omitted end tags,
 * 2-digit bare years (round 5, F1-F4); then `<table>`/`<!--` byte sequences honoured in contexts
 * an HTML tokenizer treats as text — quoted attribute values, script raw text — plus phantom /
 * unterminated openers and truncated payloads (round 5b, R6-1..R6-7). Each round patched the
 * hand-rolled lexer; round 5c then proved five spec-tokenizer divergences REMAINED (abrupt
 * comment closes `<!-->`/`<!--->`/`--!>` over-eaten to the next `-->`; `<script src/>` wrongly
 * treated as self-closing; raw-text closes matched by PREFIX so `</scripty>` ended a mask; the
 * script double-escaped state unmodeled; a stray quote in an unquoted attribute value flipping
 * the quote state). Verdict, accepted: hand-rolled resynchronization after divergence is
 * unfixable — use a spec parser or fail closed.
 *
 * ROUND-5C — the structural layer is REBUILT ON parse5 (the canonical WHATWG HTML parser; what a
 * browser actually renders is the truth every regression round was judged against). The HYBRID
 * safety design:
 *   1. TRUNCATION fails closed: the page is parsed with `sourceCodeLocationInfo` and a parse-error
 *      collector; ANY error code starting `eof-` (eof-in-comment, eof-in-tag, eof-in-script-html-
 *      comment-like-text, eof-in-cdata, eof-before-tag-name, …) marks the payload structurally
 *      TRUNCATED -> ok:false outright (the round-5b R6-5 semantics: the server-side truth may have
 *      held rows the bytes no longer show). Non-EOF parse errors are NOT corruption — spec
 *      recovery matches what a browser renders.
 *   2. The POSITIVE path (rows) is TREE-EXACT: every descendant `<table>` is a candidate (nested
 *      ones surface as their own candidates — round-5 F1e); a table's OWN rows are its `<tr>`
 *      descendants reached WITHOUT descending into a nested `<table>`; cells are a row's DIRECT
 *      `<td>`/`<th>` children. Serialized fragments (parse5 `serialize`, innerHTML semantics) feed
 *      the unchanged string helpers; the tree is sanitized first (`sanitizeTree`) so serialized
 *      output is context-safe for them.
 *   3. The `terminated` rule (round-5b R6-2) via source locations: a table whose
 *      `sourceCodeLocation.endTag` is ABSENT was never explicitly closed — the payload was cut
 *      mid-grid, or its close was stolen (the spec ALSO implies-closes a table when a sibling
 *      `<table>` opens: exactly the R6-2a probe). Such a table is NEVER classified: gv-MARKED ->
 *      parse failure (poisons the page, ok:false); unmarked -> proves nothing, skipped.
 *   4. The NEGATIVE path (the EMPTY proof) OVER-APPROXIMATES on the RAW SOURCE SLICE, not the
 *      tree — LOAD-BEARING, do not "simplify" to a tree walk: parse5 FOSTER-PARENTS content that
 *      sits directly inside `<table>` but not in a cell (an `<input>`/`<button>` direct child is
 *      hoisted OUT of the table element in the tree), so a tree-only control scan would re-open
 *      round-5 F2 (a reachable false empty). Instead the ORIGINAL html between the table's start
 *      tag end and end tag start is tested TEXTUALLY: PROVEN EMPTY requires gv-marked AND zero
 *      structural data rows (tree) AND the raw slice carries no interactive control and no nested
 *      `<table>` (a control hidden in script text or an attribute value still blocks EMPTY —
 *      over-blocking is the SAFE direction and only ever affects the empty verdict, never a
 *      populated read). The table's own attributes are tested for controls/contenteditable too.
 *   5. Data-row structural rule unchanged: >=2 direct cells = data row; EVERY data row must parse
 *      (its processo cell CONTAINS a process number) or a MARKED grid poisons the page; a
 *      single-cell colspan row (EmptyDataTemplate / pager / footer) is non-data.
 *   6. `detectPageTotal` / `detectPagingMode` / `looksUnavailable` keep reading the RAW html:
 *      pager over-detection is the safe direction (a phantom pageTotal makes the sync look for
 *      MORE pages, never fewer), and the unavailability markers are prose, not structure.
 *   R6-6 stands unchanged: the bare-form serial may not lead with '0', closing the `MM/YYYY`
 *   month-fragment shapes (01-09); 10-12/YYYY is irreducibly ambiguous with a real bare number
 *   and stays liberal.
 */
import { createHash } from 'node:crypto';
import { defaultTreeAdapter, parse, serialize } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { cellText, decodeEntities } from './portal-html.js';

type P5Element = DefaultTreeAdapterTypes.Element;
type P5ParentNode = DefaultTreeAdapterTypes.ParentNode;
type P5Template = DefaultTreeAdapterTypes.Template;

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
 * requirement already excludes every date shape. The SERIAL may not lead with '0' (round-5b R6-6):
 * no genuine Citius serial is zero-padded, but an `MM/YYYY` prose fragment (`06/2026`) is — so the
 * leading-zero ban closes the month-year shapes 01-09/YYYY. (A 10-12/YYYY fragment remains
 * structurally identical to a real bare number `10/2026` — irreducible ambiguity, accepted as
 * liberal-by-design and left to the completeness rail's count reconciliation.)
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
const PROCESS_NUMBER_RE = /^[1-9]\d{0,6}\/(?:\d{1,4}\.\d+[a-z][a-z0-9]*(?:-[a-z0-9]+)?|\d{4})$/i;

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
 * here reads a document.
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
  /** INERT captured href/token for the document — never dereferenced by this codebase. */
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
// ROUND-5C structural layer: a parse5 (WHATWG-spec) tree walk. The string
// helpers further down are fed SERIALIZED fragments of the sanitized tree,
// never raw source — the raw source is consulted only by the over-approximate
// EMPTY disqualifier (rule 4) and the raw-html page-level heuristics (rule 6).
// ---------------------------------------------------------------------------

/**
 * Elements whose CONTENT is character data to an HTML tokenizer (raw text / RCDATA): script /
 * style / textarea / title. parse5 already tokenizes their content spec-exactly (round-5b R6-1/
 * R6-4 and the round-5c divergences are handled structurally by the parser), but their content
 * would SURVIVE into serialized fragments — script text is serialized raw, so a
 * `document.write` template could leak into `cellText` output or fabricate an `<input>` for the
 * source-id scan. `sanitizeTree` therefore EMPTIES these elements; the TAGS survive, so a
 * `<textarea>` in a raw slice or in serialized output still reads as the interactive control it is.
 */
const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  // Tokenizer raw-text / RCDATA elements.
  'script',
  'style',
  'textarea',
  'title',
  // NOT-RENDERED elements (round-5c verification F3). The masking rule is not "what the TOKENIZER
  // treats as raw text" but "what the RENDERER does not show as content" — parse5's serializer
  // emits these children verbatim too, so an unmasked `<template>` row template or a `<noscript>`
  // fallback FABRICATES a notification: the verifier proved a cell rendering "1234/26.0T8LSB"
  // returned the template's "9999/2026" instead (a real processo silently REPLACED), and hidden
  // inputs / anchors inside them fabricated `sourceId` (the dedup identity) and `documentoRef`.
  // `<template>` is the modern equivalent of the `<script>` row template round-5b R6-4 hardened
  // against; `<noscript>` fallbacks are commonplace in WebForms cells.
  'noscript',
  'iframe',
  'noframes',
  'noembed',
  'xmp',
]);

/**
 * ONE normalization pass over the PARSED TREE before any serialization (round-5c). Structure is
 * already fixed by the spec parse — this pass only makes the serialized fragments CONTEXT-SAFE
 * for the regex string helpers below (`cellText`, `extractHref`, `extractSourceId`, `attrValue`):
 *   - COMMENT nodes are dropped (comment data serializes raw, so `<!-- <input> -->` inside a row
 *     could otherwise fabricate a control or leak prose into cell text — browser truth: comments
 *     are not content);
 *   - RAW-TEXT elements (script/style/textarea/title) are EMPTIED, tags kept (see
 *     `RAW_TEXT_ELEMENTS`);
 *   - `<`/`>` inside attribute VALUES are neutralized to `&lt;`/`&gt;` (parse5's serializer
 *     escapes text nodes but, per the HTML serialization spec, NOT angle brackets in attribute
 *     values — round-5b R6-1a's `title="</table>"` would otherwise re-enter serialized output as
 *     a literal tag byte sequence). `decodeEntities` round-trips the value wherever it is
 *     actually read.
 */
/**
 * Is this element NOT RENDERED as content by a browser (round-5c verification F-B)? The masking
 * rule the docblock states is "what the RENDERER does not show", and the tokenizer's raw-text set
 * is only half of that. The CSS/attribute-driven half leaked in 100 of 100 of the verifier's
 * probes — and far more idiomatically for WebForms than `<template>` ever was:
 *   `<td><span style="display:none">9999/2026</span>1234/26.0T8LSB</td>`
 * returned the HIDDEN number as the notification's `processo`, silently REPLACING the real one,
 * and hidden `<input>`/`<a>` inside such a span fabricated `sourceId` (the dedup identity) and
 * `documentoRef` on a cell that renders blank.
 * `<details>` is deliberately NOT here: its body is real content a user can reveal.
 */
function isNotRendered(el: P5Element): boolean {
  for (const attr of el.attrs) {
    const name = attr.name.toLowerCase();
    if (name === 'hidden') return true;
    if (name === 'style' && hidesContent(attr.value)) return true;
  }
  // A <dialog> shows nothing until opened; <canvas>/<video>/<audio>/<object> children are FALLBACK
  // content for agents that cannot render the element, never the rendered cell text.
  if (el.tagName === 'dialog') return !el.attrs.some((a) => a.name.toLowerCase() === 'open');
  return NEVER_RENDERED_CHILDREN.has(el.tagName);
}

/**
 * Does this inline `style` DECLARE the element away? Parsed as DECLARATIONS rather than pattern-
 * matched on the raw attribute (round-5c verification round 3 F2): the previous regex required
 * `;` or end-of-string immediately after the keyword, so the single most common real spelling —
 * `display:none !important` — sailed straight through and a hidden number again REPLACED a real
 * processo. Splitting on `;`/`:` and stripping a `!important` suffix covers every spelling
 * (spacing, case, `! important`) without matching look-alikes like `display:none-x`,
 * `background:url(display:none)` or a commented-out declaration.
 */
function hidesContent(style: string): boolean {
  // CSS comments are stripped first and `collapse` is a hiding value too (final-verification R1/R2:
  // `visibility:collapse` and `display:/*x*/none` both hide in a browser and both fabricated a row).
  return style.replace(/\/\*[\s\S]*?\*\//g, '').split(';').some((decl) => {
    const idx = decl.indexOf(':');
    if (idx < 0) return false;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).replace(/!\s*important\s*$/i, '').trim().toLowerCase();
    return (prop === 'display' && value === 'none') || (prop === 'visibility' && (value === 'hidden' || value === 'collapse'));
  });
}

const NEVER_RENDERED_CHILDREN: ReadonlySet<string> = new Set([
  'datalist',
  'canvas',
  'video',
  'audio',
  'object',
  'embed',
  'map',
  'select',
]);

function sanitizeTree(root: P5ParentNode): void {
  // ITERATIVE (round-5c verification F2): a recursive walk overflowed the stack at ~3.7k nesting
  // depth and made `parseInboxPage` THROW where its contract says it must answer ok:false. parse5
  // itself parses arbitrary depth happily, so the walk must too.
  const stack: P5ParentNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.childNodes = node.childNodes.filter((c) => c.nodeName !== '#comment');
    for (const child of node.childNodes) {
      if (!defaultTreeAdapter.isElementNode(child)) continue;
      for (const attr of child.attrs) {
        attr.value = attr.value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      // A <template>'s parsed content lives in `.content`, NEVER in `.childNodes` — so clearing
      // childNodes alone is a no-op for it. This must happen BEFORE the mask branch below, or a
      // `<template hidden>` / `<template style="display:none">` takes the `isNotRendered` early
      // exit and its row template survives into serialize() (round-5c verification round 3 F1 — a
      // regression the first form of the not-rendered mask introduced, reopening the closed
      // <template> fabrication for its most idiomatic spelling).
      if (child.tagName === 'template') (child as P5Template).content.childNodes = [];
      if (RAW_TEXT_ELEMENTS.has(child.tagName) || isNotRendered(child)) {
        child.childNodes = [];
        continue;
      }
      stack.push(child);
    }
  }
}

/**
 * Does this table carry NOTIFICATION DATA, judged by CONTENT rather than by the id marker? True
 * when any row has >=2 direct cells and one of them CONTAINS a process number. The marker is a
 * documented guess (SPIKE #6), so every poison rule that gated on it alone left a door open; a
 * process number is the one thing page chrome never carries, which is why legend/filter/menu and
 * layout tables stay neutral under this test.
 */
function looksLikeNotificationData(rows: P5Element[]): boolean {
  return rows.some((row) => {
    const cells = rowCells(row);
    return cells.length >= 2 && cells.some((c) => extractProcessNumber(cellText(serialize(c))) !== undefined);
  });
}

/** Every `<table>` element in the document, nested ones included (each nested table surfaces as
 *  its OWN candidate and never contributes rows to the outer grid — round-5 F1/F1e). */
function collectTables(root: P5ParentNode): P5Element[] {
  const out: P5Element[] = [];
  const walk = (node: P5ParentNode): void => {
    for (const child of node.childNodes) {
      if (!defaultTreeAdapter.isElementNode(child)) continue;
      if (child.tagName === 'table') out.push(child);
      // A <template>'s content is deliberately NOT walked: browsers never render it, so a table
      // inside one is not a candidate grid (and could never be the inbox).
      walk(child);
    }
  };
  walk(root);
  return out;
}

/**
 * A table's OWN structural rows: its `<tr>` descendants (through the implied
 * thead/tbody/tfoot) reached WITHOUT descending into a nested `<table>` — a nested chrome/icon
 * table can never contribute phantom rows or row-splits to the outer grid (round-5 F1); it is
 * classified independently by `collectTables`. The walk also never descends INTO a row: the spec
 * guarantees a `<tr>` inside a cell belongs to a nested table (a bare `<tr>` in a cell
 * implies-closes the current row instead).
 */
function ownRows(table: P5Element): P5Element[] {
  const out: P5Element[] = [];
  const walk = (node: P5ParentNode): void => {
    for (const child of node.childNodes) {
      if (!defaultTreeAdapter.isElementNode(child)) continue;
      if (child.tagName === 'table') continue;
      if (child.tagName === 'tr') {
        out.push(child);
        continue;
      }
      walk(child);
    }
  };
  walk(table);
  return out;
}

/** A row's structural cells: its DIRECT `<td>`/`<th>` children (spec recovery already re-parents
 *  the omitted-end-tag shapes — round-5 F3 — and a nested table's cells are never direct children). */
function rowCells(row: P5Element): P5Element[] {
  return row.childNodes.filter(
    (c): c is P5Element => defaultTreeAdapter.isElementNode(c) && (c.tagName === 'td' || c.tagName === 'th'),
  );
}

/**
 * An element's attributes re-joined as a `name="value"` string, so the attribute-string regex
 * helpers (`GRID_MARKER_RE` via `hasGridMarker`, `attrValue`) keep working on tree nodes. Values
 * are entity-escaped (`&` and `"`; angle brackets were already neutralized by `sanitizeTree`), so
 * a value can never fabricate a quote boundary or a tag; `attrValue`'s `decodeEntities` restores
 * the literal value on read.
 */
function attrsString(el: P5Element): string {
  return el.attrs
    .map((a) => `${a.name}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
    .join(' ');
}

/** First `href` inside a cell's serialized HTML, entity-decoded. The captured value is INERT — it
 *  is stored as `documentoRef` and never dereferenced. */
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
 *  else entirely; such a row stays UNPARSED and rule 5 of `parseInboxPage` makes that ok:false). */
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

/** True when a `<table>`'s attribute string carries the GridView-STRUCTURAL notifications marker
 *  (`GRID_MARKER_RE`) — the positive STRUCTURAL identification of the grid. A bare `notificac`
 *  substring (a `pnl…`/`div…`/`menu…` filter/error container) does NOT qualify, and neither does
 *  a `GridView` skin CLASS (dropped attempt-4 marker2 — see `GRID_MARKER_RE`). */
function hasGridMarker(tableAttrs: string): boolean {
  return GRID_MARKER_RE.test(tableAttrs);
}

/**
 * Interactive-control shapes that disqualify a table from the EMPTY verdict: any form control
 * (`<input>` — hidden included, a genuine empty grid carries none — `<select>`, `<button>`,
 * `<textarea>`) or an editable region (`contenteditable`). Round-4 P3/P9: attempt 4 checked
 * `<input>` only, so login/filter chrome built from a <select>+<button> (or a contenteditable
 * region) evaded the disqualifier and produced a false empty. Applied to the RAW SOURCE SLICE of
 * the table (and its own attribute string) — see ROUND-5C rule 4 in the module docblock: the raw
 * slice over-approximates (a control byte-sequence in script text or an attribute value still
 * blocks EMPTY), which is the safe direction, and it survives parse5's foster-parenting of
 * direct-child controls out of the table element (the round-5 F2 shapes).
 */
const INTERACTIVE_CONTROL_RE = /<(?:input|select|button|textarea)\b|\bcontenteditable\b/i;

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
  // ATTRIBUTE-BOUNDARY ANCHORED (round-5c verification F-C). The previous `\b(name)\s*=` scan read
  // an assignment out of ANOTHER attribute's VALUE, so well-formed, spec-valid WebForms markup
  // fabricated the dedup identity: `<input onclick="…getElementById('hdn').value=1;" value="14235">`
  // yielded sourceId "1;" instead of "14235", and a per-row-varying poison produces silently wrong
  // refs that the pass-2 collision resolve cannot catch. Attributes are now walked in order with
  // quoted values skipped, so only a real attribute position can match.
  const nameRe = new RegExp(`^(?:${nameAlt})$`, 'i');
  for (const [name, value] of attributePairs(source)) {
    if (!nameRe.test(name)) continue;
    const v = decodeEntities(value).trim();
    if (v) return v;
  }
  return undefined;
}

/** Walk a tag / attribute string as `[name, value]` pairs, honouring quoting so an `=` inside a
 *  quoted value can never look like an attribute assignment. */
function* attributePairs(source: string): Generator<[string, string]> {
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  // Skip a leading `<tagname` so the element name is never mistaken for an attribute.
  re.lastIndex = /^\s*<\s*[a-z][^\s/>]*/i.exec(source)?.[0]?.length ?? 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    yield [m[1] ?? '', m[2] ?? m[3] ?? m[4] ?? ''];
  }
}

/**
 * The row's own STABLE SOURCE ID as the portal exposes it — preferred over a content hash for
 * dedup so two content-identical notifications never collide. Fed the row's re-joined attribute
 * string (`attrsString`) and its SERIALIZED inner HTML. Looks, in priority order, for:
 *   1. a select-checkbox / hidden `<input>` value in the row (the classic WebForms GridView
 *      select-column key);
 *   2. a `data-*` notification id (or a row `id`) on the `<tr>` element itself;
 *   3. an id-bearing OPEN-notification link (an href naming a `notific…` endpoint) — never the
 *      inert documento download href.
 * Returns `undefined` when the row exposes none, in which case `notificacaoRef` falls back to a
 * content hash. This is pure string reading over the row's own markup — nothing is dereferenced.
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
 * tabela vazia" é feita pela procura da tabela de notificações, abaixo. Lê o html BRUTO
 * (ROUND-5C rule 6): são marcadores de prosa, não estrutura.
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
 * pager is present (a single-page inbox). Reads the RAW html (ROUND-5C rule 6): a phantom match
 * in script text or a comment can only OVER-detect the total, which makes the sync look for MORE
 * pages, never fewer — the safe direction.
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
 * Classifies the pager so CS4 can drive it against the real portal. Raw html, same
 * over-detection rationale as `detectPageTotal`.
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
 * Header-row identification for one candidate row's cells: the mapped columns must contain an
 * EXACT 'processo' column AND at least TWO known columns in total. This is the NECESSARY header
 * gate, not sufficient on its own — a filter/search panel can carry the same label row — so a
 * table that passes here is only treated as the grid once it ALSO clears `parseInboxPage`'s
 * decision rules (every data row parses, or a structurally-proven empty). Anything that fails the
 * exact-label test (a section-title row, a prose error page laid out as a table) is rejected
 * outright here. Returns the per-index field map on success, `null` otherwise.
 */
function identifyHeader(cells: P5Element[]): string[] | null {
  const fieldByIndex = cells.map((c) => fieldForHeader(cellText(serialize(c))));
  const known = new Set(fieldByIndex.filter(Boolean));
  return known.has('processo') && known.size >= 2 ? fieldByIndex : null;
}

/**
 * Parses one caixa-de-correio (mandatários) inbox page into notification METADATA. A LIBERAL
 * header-keyed table walker (like `parsePublicacoes`), hardened against the way a naive walk
 * silently drops legal deadlines: it scans ALL `<table>`s and, WITHIN each, the FIRST row that
 * passes header identification (`identifyHeader`) — skipping caption / colspan / decorative rows —
 * then classifies each header-passing table by its STRUCTURAL DATA ROWS (a `<tr>` after the header
 * with >=2 direct cells; a single-colspan EmptyDataTemplate / pager / footer row is structurally
 * NOT a data row). Columns map BY HEADER LABEL (a reordered GridView still parses).
 *
 * THE ONE LIE THIS MUST NEVER TELL is a FALSE EMPTY — `{ok:true, rows:[]}` ("inbox complete, zero
 * notifications") for a page that was actually a login / WAF-challenge / session-expired / error /
 * filter-search-chrome page — see the SAFETY HIERARCHY in the module docblock. The round-4 root
 * flaw was inferring verdicts from "zero rows PARSED", which conflates a genuinely empty inbox, a
 * parse failure, and page chrome. Attempt 5 separates them STRUCTURALLY (and ROUND-5C grounds the
 * structure in a spec parse — see the module docblock):
 *
 * PER-TABLE CLASSIFICATION (header-passing, TERMINATED tables only; an unterminated table is
 * never classified — ROUND-5C rule 3 — and everything else is ignored):
 *   1. POPULATED grid  — >=1 structural data row and EVERY data row parses (its processo cell
 *      contains a process number, `extractProcessNumber`). The grid marker is corroboration, not
 *      required: fully-parsing data identifies the grid by content.
 *   2. PARSE FAILURE   — a gv-MARKED table with data rows where NOT all parse. Structurally this IS
 *      the grid, but it cannot be read completely, so the WHOLE PAGE is `ok:false` — returning the
 *      parseable subset would silently drop the rest, and returning empty would be the false empty.
 *      A NON-marked table with unparseable data rows is ambiguous chrome and merely proves nothing.
 *   3. PROVEN EMPTY    — a gv-MARKED table with ZERO structural data rows whose RAW SOURCE SLICE
 *      carries NO interactive control and NO nested `<table>` (ROUND-5C rule 4 — the
 *      over-approximate raw-slice disqualifier: login/filter chrome can never be "empty", and an
 *      empty GridView renders a header + optional EmptyDataTemplate row and nothing else). This
 *      is the ONLY way an empty verdict arises: zero DATA ROWS proven structurally, never zero
 *      rows PARSED.
 *
 * PAGE-LEVEL DECISION (in precedence order):
 *   - any PARSE-FAILURE table            -> `ok:false` ('indisponível') — even if another table
 *     parsed fully: a marked grid we could not read completely means completeness cannot be
 *     claimed for this page (deliberate: availability is sacrificed, data loss never is).
 *   - else any POPULATED grid            -> `ok:true` with the BEST populated grid's rows (most
 *     known columns, then most rows — a marker-only empty grid can never shadow a populated one).
 *   - else any PROVEN-EMPTY grid         -> `ok:true, rows:[]` — the ONE legitimate empty.
 *   - else                               -> `ok:false` ('indisponível'): hard error/maintenance
 *     markers, a structurally TRUNCATED payload (ROUND-5C rule 1), empty/absent HTML, and every
 *     filter / search / legend / login / WAF / session / error page that has the right label
 *     TEXTS but neither fully-parsing data nor structural empty proof. The SAFE outcome — a
 *     dropped-deadline false empty is never worth risking over an honest "indisponível".
 */
export function parseInboxPage(html: string): ParseInboxResult {
  // NEVER THROWS (round-5c verification F2). `sanitizeTree` is iterative, but `collectTables`,
  // `ownRows` and parse5's own `serialize` all recurse, so a pathologically deep page can still
  // overflow — this catch, not the iterative walk, is what actually holds the contract (an earlier
  // docblock claimed otherwise and the verifier caught the inaccuracy). The depth/size guard in
  // `parseInboxPageInner` refuses such a page earlier and far more cheaply; this remains the
  // backstop. An exception escaping into the sync rail is an unhandled outage, not an honest verdict.
  try {
    return parseInboxPageInner(html);
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}

/** Bytes above which a page is refused unparsed. A real mandatários inbox page is tens of KB; the
 *  cap only excludes payloads no portal renders. */
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
/** Open-tag nesting above which a page is refused. parse5's parse is QUADRATIC in nesting depth
 *  (round-5c verification, measured: 10k -> 0.74s, 60k -> 25.5s, 200k -> 312s of blocked event
 *  loop), so a deep payload is a soft-DoS on a connector fed attacker-influenced HTML. Real portal
 *  markup nests in the tens; 5k is far above any of it and below the measured cliff. */
const MAX_TAG_DEPTH = 5000;

/**
 * Elements counted by the depth estimate: containers that genuinely NEST and always carry an
 * explicit end tag. Everything else is excluded on purpose (round-5c verification round 3 — the
 * first estimate counted `opens - closes` over ALL tags and was a TIME BOMB in the REFUSAL
 * direction): VOID elements never close, so 5010 flat `<br>`/`<img>`/`<input>` refused a page whose
 * real nesting depth was 4, and the table elements whose end tags the spec lets you OMIT
 * (`</td>`, `</tr>` — the very shape this parser handles elsewhere) inflated it so far that an
 * ordinary 1000-row grid was refused at 46 KB. Restricting the count to a known list also stops
 * `i<n` inside a script from reading as an open tag.
 */
const DEPTH_COUNTED_ELEMENTS: ReadonlySet<string> = new Set([
  'div', 'span', 'table', 'form', 'fieldset', 'section', 'article', 'nav', 'aside', 'main',
  'header', 'footer', 'blockquote', 'a', 'b', 'i', 'u', 'em', 'strong', 'font', 'center',
  'small', 'label', 'ul', 'ol', 'dl', 'figure', 'iframe', 'object', 'video', 'audio', 'picture',
]);

/** Cheap pre-parse nesting estimate over `DEPTH_COUNTED_ELEMENTS` only. Linear, no parse. */
function exceedsTagDepth(html: string, limit: number): boolean {
  let depth = 0;
  const re = /<(\/?)([a-z][a-z0-9]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!DEPTH_COUNTED_ELEMENTS.has((m[2] ?? '').toLowerCase())) continue;
    if (m[1] === '/') depth = depth > 0 ? depth - 1 : 0;
    else if (++depth > limit) return true;
  }
  return false;
}

function parseInboxPageInner(html: string): ParseInboxResult {
  if (!html || looksUnavailable(html)) {
    return { ok: false, error: UNAVAILABLE };
  }
  // Refuse a payload no portal renders BEFORE handing it to parse5 (round-5c verification: the
  // never-throw try/catch made a deep page safe but not CHEAP — it still burned minutes of event
  // loop first). An honest "indisponível" is the right answer for a page this shape.
  if (html.length > MAX_PAGE_BYTES || exceedsTagDepth(html, MAX_TAG_DEPTH)) {
    return { ok: false, error: UNAVAILABLE };
  }

  // ROUND-5C rule 1 — spec parse with the truncation tripwire. Any `eof-*` parse error means the
  // payload ended INSIDE a construct (comment, tag, script text, CDATA): a structurally TRUNCATED
  // payload whose server-side truth may have held rows the bytes no longer show. That can never
  // prove anything — honestly unavailable (the round-5b R6-5 semantics). Non-EOF parse errors are
  // recovered exactly as a browser would render them.
  let truncated = false;
  const document = parse(html, {
    sourceCodeLocationInfo: true,
    onParseError: (err) => {
      if (err.code.startsWith('eof-')) truncated = true;
    },
  });
  if (truncated) {
    return { ok: false, error: UNAVAILABLE };
  }

  // Make serialized fragments context-safe for the string helpers (comments dropped, raw-text
  // content masked, attribute-value angle brackets neutralized). Structure is untouched.
  sanitizeTree(document);

  let bestPopulated: GridCandidate | null = null;
  let populatedGrids = 0;
  let provenEmpty = false;
  let parseFailure = false;

  for (const table of collectTables(document)) {
    const tableAttrs = attrsString(table);
    const marked = hasGridMarker(tableAttrs);

    const loc = table.sourceCodeLocation;
    const rows = ownRows(table);

    // IS THIS NOTIFICATION DATA, whatever its id says? The marker is a GUESS (SPIKE #6 — the real
    // portal may omit `gv…notific` entirely), so gating the poison rules on it left three doors
    // open that the final verification proved reachable with ordinary two-table WebForms pages:
    // a frozen-header layout whose BODY table is unmarked (parser said `{ok:true, rows:[]}` for a
    // page rendering two notifications), and a split "por ler" / "lidas" inbox whose second table
    // does not fully parse (parser returned the first table as the COMPLETE inbox). Content is the
    // reliable signal: a row of >=2 direct cells one of whose cells CONTAINS A PROCESS NUMBER is
    // notification data. Legend, filter, menu and layout tables carry no process numbers, so they
    // stay neutral and the realistic-page pass rate is unchanged.
    const carriesNotifications = marked || looksLikeNotificationData(rows);

    // The `terminated` rule. A table whose end tag is ABSENT was never explicitly closed: the
    // payload was cut mid-grid, or a phantom/sibling opener stole its close (the spec
    // implies-closes a table when a sibling <table> opens). A truncated structure can never prove
    // empty NOR claim a complete populated read.
    if (!loc?.startTag || !loc.endTag) {
      if (carriesNotifications) parseFailure = true;
      continue;
    }

    // The header is the FIRST row that passes header identification (not merely the first row
    // containing "processo"), so a caption / colspan row above the real <th> is skipped.
    let headerIdx = -1;
    let fieldByIndex: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const mapped = identifyHeader(rowCells(rows[i]!));
      if (mapped) {
        headerIdx = i;
        fieldByIndex = mapped;
        break;
      }
    }
    if (headerIdx === -1) {
      // A MARKED table carrying data rows we could not key (round-5c verification round 3 F3 —
      // catastrophic). The bare `continue` here was the same "not neutral" mistake F-A described:
      // a frozen-header GridView splits header and body across two tables, so the BODY table is
      // gv-marked with rows but no header, and the header-only sibling — zero data rows, no
      // controls — then proved the inbox EMPTY. `{ok:true, rows:[]}` for a page rendering two
      // notifications. A marked table IS the grid; rows we cannot read mean the page cannot be
      // read. Unmarked headerless tables still prove nothing (they are ordinary page chrome).
      if (carriesNotifications && rows.some((r) => rowCells(r).length >= 2)) parseFailure = true;
      continue;
    }

    // ROUND-5C VERIFICATION F1 — the CATASTROPHIC one. Only `rows.slice(headerIdx + 1)` is ever
    // parsed or counted, so every row ABOVE the identified header was invisible to BOTH the empty
    // proof and the populated read: a grid whose real header failed the exact-label gate (a sort
    // glyph in the `<th>`) while a repeated footer/legend row passed it reported `{ok:true,
    // rows:[]}` for a page rendering two notifications (false empty), and a data row above a
    // mid-table header was silently dropped from an otherwise-correct populated read (subset).
    // Reachability is not exotic: `SPIKE_HEADER_LABELS` is documented as UNOBSERVED GUESSES, so a
    // real header missing the gate is an EXPECTED first-real-access condition — the verifier's
    // permutation fuzz produced a false empty in 1087 of 3000 header positions.
    // A pre-header row with >=2 direct cells is therefore structurally indistinguishable from a
    // notification we failed to key, and resolves the only safe way: a MARKED grid is poisoned
    // (parse-failure -> ok:false, never empty, never a subset); an unmarked table proves nothing.
    // POISONS REGARDLESS OF THE MARKER (round-5c verification F-A — a regression this very fix
    // introduced in its first form): `continue`-ing on an UNMARKED table is not neutral, because a
    // SIBLING table can then claim the page and its rows are returned as COMPLETE. The verifier's
    // probe was a plausible split inbox (unread + read tables, neither gv-marked, a 2-cell section
    // row above the unread header): the two UNREAD notifications — the live deadlines — were
    // silently dropped and the single read row was returned as the whole inbox. A header-passing
    // table with rows above its header means the header identification itself is in doubt, and
    // that doubt is not confined to the table: it invalidates the page.
    const preHeaderDataRows = rows.slice(0, headerIdx).filter((r) => rowCells(r).length >= 2).length;
    if (preHeaderDataRows > 0) {
      parseFailure = true;
      continue;
    }

    const idxOf = (field: string): number => fieldByIndex.indexOf(field);

    // Pass 1: walk the STRUCTURAL DATA ROWS (>=2 direct cells after the header; a single-colspan
    // EmptyDataTemplate / pager / footer row is structurally not a data row) and parse each one. A
    // data row PARSES only when its processo cell CONTAINS a process number (`extractProcessNumber`
    // — substring, date-guarded). dataRowCount vs parsed.length is what separates a genuinely empty
    // grid from a parse failure below. Each row's candidate source id is captured for the pass-2
    // collision resolve.
    const parsed: { base: Omit<CitiusNotificacaoMeta, 'ref' | 'sourceId'>; candidateId: string | undefined }[] = [];
    let dataRowCount = 0;

    for (const row of rows.slice(headerIdx + 1)) {
      const cells = rowCells(row);
      if (cells.length < 2) continue; // structurally NOT a data row (EmptyDataTemplate / footer / pager colspan)
      dataRowCount++;

      const cellHtml = cells.map((c) => serialize(c)); // innerHTML per cell, context-safe (sanitizeTree)
      const rawAt = (field: string): string | undefined => {
        const i = idxOf(field);
        return i >= 0 && i < cellHtml.length ? cellHtml[i] : undefined;
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
      parsed.push({ base, candidateId: extractSourceId(attrsString(row), serialize(row)) });
    }

    // CLASSIFICATION 3 — zero structural data rows: a PROVEN EMPTY only with the structural marker
    // and a clean RAW SOURCE SLICE (ROUND-5C rule 4): the ORIGINAL html between the table's start
    // and end tags must carry no interactive control (round-5 F2 — caption / direct-child /
    // after-last-row controls included, which the TREE cannot see: parse5 foster-parents them out
    // of the table element) and no nested `<table>` (round-5 F1d — an empty GridView renders a
    // header + optional EmptyDataTemplate row and nothing else, so nested-table content inside a
    // marked zero-data-row grid is unmodelled chrome). The textual test over-approximates — a
    // control byte-sequence in script text or an attribute value still blocks EMPTY — which is
    // the safe direction and only ever affects the empty verdict, never a populated read. The
    // table's own attributes are tested too (a contenteditable grid is chrome). Otherwise the
    // table proves nothing (a header-only filter / legend / login shell) and is skipped.
    if (dataRowCount === 0) {
      const innerRaw = html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
      if (
        marked &&
        !INTERACTIVE_CONTROL_RE.test(tableAttrs) &&
        !INTERACTIVE_CONTROL_RE.test(innerRaw) &&
        !/<table\b/i.test(innerRaw) &&
        // NO HIDING MARKERS (round-5c verification round 3 F5). `dataRowCount` is counted on the
        // MASKED tree while this proof reads the RAW slice, so hiding markup REDUCES the row count
        // and makes EMPTY *easier* to reach — exactly inverting "over-blocking the empty verdict is
        // the safe direction" (a `<tbody style="display:none">` holding two rows proved the inbox
        // empty). Any hiding marker in the slice therefore blocks the empty proof outright: masked
        // content may legitimately vanish from a POPULATED read, but it can never help prove that
        // there is nothing to read.
        !/(?:\shidden(?=[\s=>/])|display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|<template\b)/i.test(innerRaw)
      ) {
        provenEmpty = true;
      }
      continue;
    }

    // CLASSIFICATION 2 — data rows exist but NOT all parse. This poisons the page whenever the
    // table CARRIES NOTIFICATIONS (marked, or content-proven by a parsed row) — never a subset,
    // never an empty. The old marker-only guard is what let a split "por ler" / "lidas" inbox
    // return the first table as the complete inbox whenever the second table did not fully parse.
    // A table where NOTHING parsed and no marker claims it is ambiguous chrome and proves nothing.
    if (parsed.length < dataRowCount) {
      if (marked || parsed.length > 0) parseFailure = true;
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

    // MORE THAN ONE populated grid means the page cannot be read completely (round-5c verification
    // round 3 F4 — catastrophic silent subset). `isBetterGrid` picked one and DISCARDED the rest,
    // so a split "por ler" / "lidas" inbox returned one table's rows as the whole inbox — and when
    // the second table had more known columns, BOTH unread notifications were the ones dropped.
    // Choosing between two candidate grids is a guess, and a wrong guess here loses legal
    // deadlines; the page identity that would settle it (the authenticated CaixaCorreio endpoint)
    // is CS4/CS6's to establish, and until then honest unavailability is the only safe answer.
    populatedGrids++;
    const candidate: GridCandidate = { knownCount: new Set(fieldByIndex.filter(Boolean)).size, rows: out };
    if (bestPopulated === null || isBetterGrid(candidate, bestPopulated)) bestPopulated = candidate;
  }

  // PAGE-LEVEL DECISION — precedence pinned in the docblock: parse-failure > populated > proven-empty.
  if (parseFailure || populatedGrids > 1) {
    // A marked grid whose data rows did not all parse (or whose close tag was never found):
    // completeness cannot be claimed for this page. Never a subset, never an empty — honestly
    // unavailable.
    return { ok: false, error: UNAVAILABLE };
  }
  if (bestPopulated !== null) {
    const pageTotal = detectPageTotal(html);
    return pageTotal !== undefined
      ? { ok: true, rows: bestPopulated.rows, pageTotal }
      : { ok: true, rows: bestPopulated.rows };
  }
  if (provenEmpty) {
    const pageTotal = detectPageTotal(html);
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
