/**
 * Caixa Citius (área de MANDATÁRIOS) — the TRANSPORT half of the authenticated inbox connector
 * (CS4). CS1 (`citius-mandatarios.ts`) owns every byte of PARSE shape; this module owns every byte
 * of REQUEST shape, and the two together are the only places in the codebase that know anything
 * about the authenticated mandatários portal.
 *
 * THE TRANSPORT IS HYBRID (RUN_SPEC criterion 10 + assumption 9, binding): a typist BROWSER login
 * ESTABLISHES the session (CS5's `ensureSession`), and this module then replays that session's
 * COOKIE JAR over typed HTTP to ENUMERATE the inbox. Nothing here logs in, and nothing here opens a
 * browser: `ensureSession` hands over a Playwright `storageState`, this module reads cookies out of
 * it and never writes one back. The split is what makes metadata-only structurally provable — a
 * typed module with no document-fetch function and a single request builder, rather than a browser
 * session that could be told to click anything.
 *
 * ================================ METADATA ONLY (OPERATOR-LOCKED) ================================
 * The sync reads notification METADATA ONLY and NEVER opens a document. Two INDEPENDENT proofs, both
 * committed in `api/tests/legal/citius-mandatarios-http.test.ts`:
 *
 *   STRUCTURAL — this module MUST NOT define or export any function that fetches, downloads or opens
 *   a document, and it goes further: THE ONLY URL THIS MODULE EVER REQUESTS IS THE CONFIGURED INBOX
 *   URL, and the only BODY it ever sends is an ALLOWLISTED one. What varies across requests is (a)
 *   the page number — an integer this module generated — and (b), on the postback rail, the WebForms
 *   hidden fields named in `POSTBACK_FIELD_ALLOWLIST` (`__VIEWSTATE`, `__VIEWSTATEGENERATOR`,
 *   `__VIEWSTATEENCRYPTED`, `__EVENTVALIDATION`, `__LASTFOCUS`, `__SCROLLPOSITION*`) echoed back
 *   verbatim, which is the minimum a WebForms server accepts. EVERY OTHER hidden input the page
 *   offers is DROPPED — a `hdnAbrirDocumento` / `hdnComando` the page seeded is never replayed, so
 *   the body is as provable as the URL (round-6 review, MEDIUM 1). No href, no `documentoRef`, no
 *   `Location`, no form action from the page is ever fetched — not even followed (see `redirect`
 *   below). The module's code therefore never so much as NAMES `documentoRef` / `Documento.aspx` /
 *   `docId`; a `documentoRef` rides through inside the opaque `CitiusNotificacaoMeta` rows and is
 *   never read here. The guard suite asserts all of it, plus an exact export allowlist so a new
 *   exported function cannot appear without a reviewer seeing it.
 *
 *   BEHAVIOURAL — a full multi-page enumerate against the CS2 mock (whose rows DO carry document
 *   links) leaves the mock's per-document hit counter at ZERO, with the counter proven able to
 *   increment in the same test so the assertion cannot pass vacuously.
 *
 * ==================================== HONESTY (the whole point) ==================================
 * Inherited from CS1's SAFETY HIERARCHY and CS3's completeness contract. A page the parser reports
 * `ok:false` MUST NEVER degrade into "no notifications"; a dead session MUST NEVER look like an
 * empty inbox. So the outcome is a FOUR-member union — the shape CS5's `EnsureSessionResult` set as
 * the precedent, for the same reason: these are genuinely different problems and collapsing them
 * sends the operator (and the sync rail) to the wrong place.
 *
 *   `complete`     — every page walked parsed, the pager was exhausted, and any advertised page
 *                    count agrees with what was actually walked. THE HARD-TO-REACH VERDICT: it is
 *                    reached only after four independent refusals below have each declined to fire.
 *   `incomplete`   — the walk is PROVED PARTIAL: a page the parser refused, a truncation at
 *                    `maxPages`, a pager this module could not drive, or an advertised page count
 *                    the walk did not reach. Rows captured so far are RETURNED (they are real), and
 *                    `reason` says which. Never silently upgraded to `complete`.
 *   `session-dead` — the portal answered with a login page / a redirect to one. Its OWN outcome,
 *                    never an empty inbox: the caller must re-establish (CS5) and re-enumerate.
 *   `failed`       — machinery: the transport threw, a non-2xx, an unbound origin, an unusable
 *                    configuration. Nothing is known about completeness.
 *
 * ================================= HOW `complete` IS EARNED (round 6) ===========================
 * A fresh-context review found that a truncated sweep reported `complete` whenever the pager was not
 * literally `?p=N` / `?page=N` in a quoted href: an entity-encoded `&amp;page=2`, a `?pagina=2`, a
 * `?pg=2` labelled "Seguinte", an `<img alt="Seguinte">`, an `onclick="goPage(2)"`, or an
 * `<input type=submit value="Seguinte">` each walked ONE page and certified the sweep. `complete`
 * now has to survive, in this order:
 *
 *   1. SCOPE. Every pager scan runs on `scanScope(html)` — the page with its scripts, styles,
 *      comments and GRID DATA ROWS removed — and, where it matters, on `pagerRegion(...)` of that:
 *      the containers a portal names like a pager plus the single-cell rows a GridView renders one
 *      into. A `?page=2` in a ROW link, a `&p=3` inside a row's own href, and a `Page$` token in a
 *      `<script>` therefore no longer speak for the pager (round-6 HIGH).
 *   2. ENTITY DECODING. Hrefs are `decodeEntities`d before any page-number scan, so `&amp;page=2`
 *      and `&#38;page=2` read as `&page=2`.
 *   3. EVERY NAVIGATIONAL CONTROL, not just postback anchors. Anchors, `<button>`s, and
 *      `<input type=submit|button|image>` are all inspected, and a control's LABEL is its text, its
 *      nested `<img alt>`, its `value` / `title`, and its humanised `name` / `id`. A control that
 *      reads like next/last and cannot be driven numerically blocks `complete`; so does a control
 *      whose label is a page NUMBER beyond the page we are on that we cannot address (the
 *      `?pagina=2` shape — which the `pageParam` input then makes drivable, SPIKE #2).
 *   4. THE FLOOR. Even with no pager signal at all, a last page whose grid came back FULL (at a
 *      `pageSize` the caller configured, or at the size observed on an earlier page of this walk)
 *      cannot be `complete` unless the pager NAMED every page up to this one. A windowed pager
 *      (`… 8 9 [10]`) fails that on purpose: it names no page 1, so it is not evidence of the end.
 *
 * The reasons are deliberately DISTINGUISHABLE so an operator can tell cry-wolf from real
 * truncation: `pager-unrecognised` is a control inside the pager region, `pager-ambiguous` is a
 * page-ish signal only found OUTSIDE it, `page-full-no-pager` is the floor. All three are
 * fail-closed (no data loss); only the second is expected to be noisy, and the escape hatch for all
 * three is configuration (`pageParam`, `pageSize`) plus the raw markup capture SPIKE #3 demands.
 *
 * ================================== CS6 WIRING CONTRACT (READ THIS) ==============================
 * CS6 adapts this to `events/verified-sync.ts`'s `EnumerateResult`. The mapping is NOT mechanical:
 *
 *   complete      -> { ok:true,  result:{ items, pages, reachedEnd:TRUE  } }
 *   incomplete    -> { ok:true,  result:{ items, pages, reachedEnd:FALSE } }   // rows still land
 *   session-dead  -> { ok:false, error }  AND `markSessionUnhealthy` so the next run re-establishes
 *   failed        -> { ok:false, error }
 *
 *   (a) `incomplete` MUST map to `reachedEnd:false`. `runVerifiedSync` then keeps the watermark
 *       where it is and re-sweeps, which is exactly right; the rows still land (at-least-once,
 *       idempotent), so nothing captured is thrown away.
 *   (b) DO NOT PASS `advertisedPageCount` AS `EnumerateResult.pageTotal`. They are different
 *       quantities that unfortunately share a name upstream: CS1's `pageTotal` (whose idioms this
 *       module re-reads, region-scoped, as `advertisedPageCount`) is a count of PAGES read off the
 *       pager, while CS3's `pageTotal` is documented as "the source's TRUE, COMPLETE count of ITEMS
 *       in the window" and is compared against `items.length`. Feeding pages into an item count
 *       would either block every run (harmless) or — with 2 pages and 2 items — CERTIFY a truncated
 *       sweep as complete and advance the watermark past unpaged notifications. This module
 *       therefore never emits a field named `pageTotal`, and CS6 MUST OMIT CS3's `pageTotal`
 *       ENTIRELY: a connector that cannot compute a true ITEM total for the window relies on
 *       `reachedEnd` (CS3 contract clause #complete-or-ok:false says so in as many words). CS6 MUST
 *       NOT SYNTHESISE ONE FROM `rows.length` — `pageTotal === items.length` is tautological and
 *       would certify anything, including a sweep that stopped at page 1 of 40.
 *   (c) THE WINDOW IS THE CALLER'S. This module does no date filtering: it walks pages and returns
 *       every row it saw, deduped by `ref` within the walk. A connector that dropped rows whose
 *       `data` cell it could not parse would be inventing a silent miss; CS6 applies the
 *       `[since, until]` window (and CS3's seen-set does the cross-run dedup).
 *   (d) TWO MORE NAME COLLISIONS ACROSS THE SAME SEAM, both silent if CS6 gets them wrong:
 *       - `pages` HERE is `CitiusPageOutcome[]` (one record per page ATTEMPTED, with its verdict);
 *         `EnumerateResult.result.pages` upstream is a NUMBER. Map `pagesWalked` (or
 *         `pages.length`) into it — never the array, and never a `.length` of the ROWS.
 *       - `maxPages`: CS3 hands the enumerator an `EnumerateWindow.maxPages`, while this module
 *         defaults its OWN `maxPages` to 50 (`DEFAULT_MAX_PAGES`) and clamps it at 500. CS6 MUST
 *         FORWARD the window's bound into `EnumerateInboxInput.maxPages`; otherwise the truncation
 *         evidence in the run report describes a bound that was never applied.
 *
 * ============================= FIRST-REAL-ACCOUNT SPIKE (transport half) =========================
 * CS1's docblock carries the PARSE unknowns; these are the TRANSPORT ones. Nothing below has ever
 * been observed against a real account — the fixtures and the CS2 mock encode the guesses, so this
 * list is the checklist for the first real access (which this module meets before anything else
 * does). Items 11-12 are the CS1 verifier's findings, recorded here because this connector is what
 * will meet those grids first.
 *
 *   1. SESSION-EXPIRED SIGNATURE — 302-to-login, a 200 that re-renders the login form, or a 401/403?
 *      Only the 200-login-render is detectable with the SHIPPED default transport: `credentialedFetch`
 *      goes through `guardedFetch`, which uses `redirect:'error'`, so a real 302 arrives as a
 *      REJECTED fetch and is reported `failed`, not `session-dead`. That is the safe direction (the
 *      run stops and nothing advances) but it is not the accurate one. If the portal turns out to
 *      302, the fix is a redirect-OBSERVING credentialed variant in `services/url-fetcher.ts` —
 *      deliberately NOT widened here (that file is a shared security primitive and its
 *      `redirect:'error'` is load-bearing for every other caller). This module already classifies a
 *      3xx correctly when the transport surfaces one, which is what the committed tests drive.
 *      NOTE (round-6 LOW 5): `isLoginLocation` inspects the redirect target's PATHNAME only, so a
 *      `Location: /?ReturnUrl=%2fLogin.aspx` reads as `failed`, not `session-dead`. That is the safe
 *      direction — `session-dead` SPENDS a login attempt against a portal whose lock-out policy is
 *      unobserved, and `failed` spends nothing — but it is a real detection gap to close with the
 *      first observed redirect, not with a guess about the query string.
 *   2. INBOX PATH + PAGE PARAM — `/habilus/myhabilus/CaixaCorreio.aspx` and `?page=N` are synthetic
 *      guesses (CS1's fixtures / CS2's mock). Both are configurable inputs, so the first real
 *      snapshot is a config change, not a rewrite — and `pageParam` is now REALLY wired (round-6
 *      CRITICAL-2: it used to be inert because the GET/postback decision came from a classifier that
 *      only knows `p`/`page`, so `pageParam:'pagina'` still truncated silently). A page parameter
 *      this module does not know is now DETECTED (the pager names a page we cannot address ->
 *      `pager-unrecognised`) rather than ignored, so the config change is prompted, not guessed at.
 *      `pageSize` is the same kind of input: set it and the FLOOR below can fire on page 1.
 *   3. PAGER IDIOM — numeric page links (`?page=N`) or `__doPostBack(target,'Page$N')` are assumed.
 *      THIS IS THE CONNECTOR'S MOST DANGEROUS UNKNOWN: a pager that only exposes a next/previous
 *      control would stop the walk after page 1 and call it COMPLETE. Guards, in the pager region:
 *      a non-numeric `Page$…` token (`Page$Next`), a non-numeric page parameter, ANY navigational
 *      control (anchor, `<button>`, `<input type=submit|button|image>`) whose label — text, nested
 *      `<img alt>`, `value`, `title`, or humanised `name`/`id` — reads like a next/last control, a
 *      control whose label is a page NUMBER we cannot address, a region CS1 classifies as a pager
 *      when we recognised no numbers in it, and finally the full-grid FLOOR. What still reads as a
 *      single-page inbox: a GET link with neither a numeric parameter nor a recognised label nor a
 *      numeric label (`?dir=next` rendered as an icon with no `alt`) on a page whose grid is NOT
 *      full. Confirm the pager markup on first access before trusting any `complete`, and capture
 *      the raw HTML: the residual risk here is a WINDOWED pager whose "Seguinte" is rendered as a
 *      live control on the last page (fires `pager-unrecognised` forever — cry-wolf) or as inert
 *      text (silently reads as exhausted).
 *   4. POSTBACK TARGET — read off the page's own `__doPostBack('target','Page$N')` and refused
 *      unless it matches the WebForms id charset. Whether the real grid's target is stable across
 *      pages (and whether a `__EVENTVALIDATION` from page N is accepted for page N+1) is unobserved.
 *      The postback sends `Referer` (this module's own inbox URL) and the ALLOWLISTED hidden state
 *      only; whether the real deployment needs more than that (an `X-MicrosoftAjax` header, an
 *      async-postback wrapper, a hidden field outside the allowlist) is unknown until a real page is
 *      seen. If it does, the allowlist grows by review — it does not become "echo everything".
 *   5. NO SERVER-SIDE WINDOW FILTER is assumed to exist, so every run walks from page 1. A large
 *      inbox therefore truncates at `maxPages` and reports INCOMPLETE for ever, rather than
 *      pretending. If the real page offers a date filter, plumb it and revisit clause (c) above.
 *   6. GRID SORT ORDER unknown — the walk never stops early on a date, because "newest first" is a
 *      guess and stopping on it is a silent miss.
 *   7. WAF ON A DATACENTRE IP — a challenge page is a 200 that is not the inbox: the parser refuses
 *      it and the walk reports `incomplete`, never empty. A challenge that merely renders a password
 *      field is NO LONGER read as `session-dead` (round-6 MEDIUM 2): `looksLikeLoginPage` now
 *      requires the pinned Citius login control ids, or a password field AND a login-shaped
 *      `<form action>`. That keeps the login rail consistent with the 401/403 rail one branch up —
 *      both refuse to spend a login attempt on a guess.
 *   8. COOKIE ROTATION — the jar absorbs `Set-Cookie` during the walk (WAF cookies and rotating
 *      `ASP.NET_SessionId`s are the normal WebForms/Incapsula behaviour), but whether the real rail
 *      rotates anything is unobserved. A `Domain` attribute that is not a suffix of the request host
 *      is REJECTED (RFC 6265 §5.3), the header is emitted longest-path-first and deduped by name
 *      (§5.4). There is NO public-suffix list, so a `Domain=example` from `portal.example` is
 *      accepted as a legitimate parent — RFC-conformant, and harmless here only because this
 *      connector requests exactly ONE host, which is also why the §5.3 rejection is belt-and-braces
 *      over the send-side matcher rather than an independently observable behaviour. Cookie
 *      ATTRIBUTES beyond name/value/domain/path/secure (SameSite, Max-Age semantics beyond a
 *      delete) are still not modelled.
 *   9. CONCURRENT-SESSION LOGOUT (CS1 spike #3) — a second session may kill this one mid-walk; it
 *      would surface as `session-dead` at page N, which is exactly the outcome that exists for it.
 *  10. RATE LIMITS — unknown. The throttle defaults to a bounded delay per page and there is NO
 *      retry loop and NO backoff: a 429 reads as `failed`. Retrying an unknown rate limiter (or an
 *      unknown lock-out policy) is how a court portal blocks an account.
 *  11. GRIDS THE PARSER NOW REFUSES (CS1 round-5c verifier): multi-row grouped headers, a 2-cell
 *      toolbar row above the header, and select-all header rows all come back `ok:false`. Against a
 *      real inbox of that shape this connector reports INCOMPLETE on page 1 — safe, but a livelock
 *      until a fixture is captured. CAPTURE THE RAW HTML on first access; it is the only way CS1's
 *      conservative rules get relaxed with evidence instead of guesses.
 *  12. PER-ROW SOURCE ID (CS1 spike #5) — within-walk dedup here keys on `ref`. If real rows expose
 *      no stable id, two content-identical notifications share a ref and one is dropped from the
 *      walk; the backstop is CS3's count reconciliation, not this module.
 *  13. RESPONSE SIZE — `MAX_RESPONSE_BYTES` is enforced against a declared `Content-Length` BEFORE
 *      the body is read, and again after buffering for a response that declared none (or lied). A
 *      chunked response with no length is therefore still bounded only by the request timeout: the
 *      seam this module is given (`arrayBuffer()`) cannot stop mid-stream, and widening it is a
 *      change to `services/url-fetcher.ts`, which is out of this module's scope.
 */
import { parseInboxPage, detectPagingMode, type CitiusNotificacaoMeta } from './citius-mandatarios.js';
import { decodeEntities, decodeHtml, parseHiddenFields } from './portal-html.js';
import {
  CredentialOriginError,
  assertOriginAllowed,
  credentialedFetch,
  originFromBaseUrl,
} from '../security/origin-binding.js';

/** The real portal. Every one of these is an INPUT default, never a hard-coded destination. */
export const CITIUS_MANDATARIOS_HOST = 'citius.tribunaisnet.mj.pt';
export const CITIUS_MANDATARIOS_BASE_URL = `https://${CITIUS_MANDATARIOS_HOST}`;
/** The caixa-de-correio page (SPIKE #2 — synthetic, from the CS1 fixtures / CS2 mock). */
export const CITIUS_INBOX_PATH = '/habilus/myhabilus/CaixaCorreio.aspx';

/** Pages one call will walk before it truncates and says so. */
const DEFAULT_MAX_PAGES = 50;
/** A ceiling on `maxPages` no caller can raise: this is a court's infrastructure. */
const HARD_MAX_PAGES = 500;
/** Bounded, deterministic delay between page requests (SPIKE #10). Injectable so tests never sleep. */
const DEFAULT_THROTTLE_MS = 1_500;
const MAX_THROTTLE_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
/** A postback body carries the page's whole VIEWSTATE; above this the page is not one we understand. */
const MAX_POSTBACK_BODY_BYTES = 2 * 1024 * 1024;
/** A response larger than this is not a mandatários inbox page (CS1 refuses such payloads too). */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** A grid page that holds more rows than this is not a page of a court inbox. */
const MAX_PAGE_SIZE = 10_000;

/** Browser-ish UA + Accept, the same shape the other legal connectors send. */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': 'Mozilla/5.0 (compatible; EkoaLegal/1.0; +https://ekoa.io)',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'pt-PT,pt;q=0.9',
};

/**
 * The ONLY page-supplied fields a postback body may carry (round-6 MEDIUM 1). A WebForms server
 * needs these to accept a POST; everything else the page seeded into a hidden input is the page
 * telling us to do something, and this module does not take instructions from the page. Keeping the
 * body to an allowlist is what makes the BODY as structurally provable as the URL.
 */
const POSTBACK_FIELD_ALLOWLIST: ReadonlySet<string> = new Set([
  '__VIEWSTATE',
  '__VIEWSTATEGENERATOR',
  '__VIEWSTATEENCRYPTED',
  '__EVENTVALIDATION',
  '__LASTFOCUS',
]);
/** `__SCROLLPOSITIONX` / `__SCROLLPOSITIONY` — same rationale, a family rather than two literals. */
const SCROLL_POSITION_FIELD_RE = /^__SCROLLPOSITION[A-Z]{0,8}$/;

// ---------------------------------------------------------------------------
// The transport seam
// ---------------------------------------------------------------------------

/** The subset of `Response` this module reads. `getSetCookie` is optional because a test double
 *  (or an older runtime) may only carry the folded `set-cookie` header. */
export interface CitiusTransportResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null; getSetCookie?: () => string[] };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface CitiusTransportRequest {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /** REQUIRED and non-empty — this request carries a session cookie, so it declares where that
   *  credential may travel. Handed straight to `credentialedFetch`, which refuses an empty list. */
  allowedOrigins: string[];
}

export type CitiusTransport = (url: string, init: CitiusTransportRequest) => Promise<CitiusTransportResponse>;

/**
 * The production transport: `credentialedFetch` — origin binding FIRST, then the SSRF guard and its
 * DNS-rebinding re-check. Never a bare `fetch`: the request carries a session cookie, and
 * `credentialedFetch` is the one entry point that cannot be called without declaring the hosts that
 * credential may reach.
 *
 * Tests inject their own transport because the guard (correctly) refuses a 127.0.0.1 mock — the
 * house pattern (`integrations/pipedream.ts`). What that would otherwise cost in coverage is bought
 * back two ways: this module runs `assertOriginAllowed` ITSELF before every request, so the binding
 * holds even against an injected transport, and a committed test drives the DEFAULT transport at an
 * unbound host and at a loopback host to prove both guards are really in the path.
 */
const defaultTransport: CitiusTransport = async (url, init) =>
  credentialedFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    timeoutMs: init.timeoutMs,
    allowedOrigins: init.allowedOrigins,
    credentialLabel: 'sessão Caixa Citius',
  });

/** The real throttle. Injectable so a test asserts the delay without spending it. */
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Input / output
// ---------------------------------------------------------------------------

export interface EnumerateInboxInput {
  /**
   * The ESTABLISHED session, exactly as CS5's `ensureSession` returns it (a Playwright
   * `storageState`). Cookies are read out of it and replayed; nothing from it is logged, returned or
   * written back. A state with no usable cookie is refused rather than fetched anonymously — an
   * anonymous hit on a court portal is not a thing to do by accident.
   */
  sessionState: unknown;
  /** Portal origin. Defaults to the real Citius base URL. */
  baseUrl?: string;
  /** Inbox path on that origin (SPIKE #2). */
  inboxPath?: string;
  /** The GET pager's page parameter (SPIKE #2 — `page` is a guess). Refused unless it is a plain
   *  query-parameter name, so a caller cannot smuggle a second parameter into the URL. Really
   *  wired: the GET/postback decision is made HERE, against this name, not by a classifier that
   *  only knows `p`/`page`. */
  pageParam?: string;
  /**
   * Hosts the session credential is bound to — the Cofre item's `boundOrigins`. CS6 SHOULD pass
   * them: the default is derived from `baseUrl` (never from the RESOLVED inbox URL, so an absolute
   * `inboxPath` cannot redefine the binding it is then checked against).
   */
  boundOrigins?: string[];
  /** Pages this call will walk before truncating (and reporting `incomplete`). */
  maxPages?: number;
  /**
   * Rows one page of the grid holds when it is FULL. Unobserved (SPIKE #2), so unset by default.
   * When set, it arms the FLOOR on page 1 too: a first page that came back with `pageSize` rows and
   * a pager that named no page numbers cannot be `complete`.
   */
  pageSize?: number;
  /** Delay between page requests, ms. Clamped to `[0, 60_000]`. */
  throttleMs?: number;
  /** Per-request timeout, ms. Clamped to `[1, 60_000]`. */
  requestTimeoutMs?: number;
}

export interface EnumerateInboxDeps {
  transport?: CitiusTransport;
  sleep?: (ms: number) => Promise<void>;
}

/** What happened on ONE page request. Always present for every page attempted, in order — the
 *  "honest per-page outcome" the caller needs to see WHERE a walk stopped being trustworthy. */
export interface CitiusPageOutcome {
  page: number;
  outcome: 'ok' | 'unparseable' | 'login' | 'http-error' | 'transport-error' | 'refused';
  /** Rows the parser returned for this page (0 unless `outcome === 'ok'`). */
  rows: number;
  /** HTTP status, when there was a response at all. */
  status?: number;
  /** Short, credential-free detail. Never a cookie, never a response body. */
  note?: string;
}

/** Why a walk is PROVED PARTIAL. Every one of these keeps the caller's watermark where it is. */
export type CitiusIncompleteReason =
  /** The parser refused a page (`ok:false`) — the page exists, its rows are unknown. */
  | 'page-unparseable'
  /** The walk hit `maxPages` with more pages advertised or linked. */
  | 'max-pages'
  /** The pager advertised more pages than the walk actually reached. */
  | 'page-count-disagreement'
  /** A control INSIDE THE PAGER REGION that means "more pages" and that this module cannot drive
   *  numerically (a `Page$Next` token, a next/last label, a page number it cannot address) —
   *  SPIKE #3. The high-confidence truncation signal. */
  | 'pager-unrecognised'
  /** The same kind of signal, but found only OUTSIDE the pager region (page chrome, help text, an
   *  unrecognised layout). Fail-closed like the others, named apart because it is the cry-wolf-prone
   *  one: an operator seeing this repeatedly should capture the markup, not widen a guard. */
  | 'pager-ambiguous'
  /** THE FLOOR: the last page's grid came back FULL and the pager did not account for every page up
   *  to it. Nothing said "there is more" — and nothing proved there is not. */
  | 'page-full-no-pager'
  /** A postback page whose target/hidden state could not be read, so the next page is unreachable. */
  | 'pager-unavailable'
  /** A page re-served rows already seen this walk (a clamped/looping pager). */
  | 'repeat-page';

/** Fields every outcome carries, whatever the status. Rows are ALWAYS the ones actually captured —
 *  a failure never blanks them, and a caller never has to guess what was already read. */
interface EnumerationBase {
  rows: CitiusNotificacaoMeta[];
  /** Pages whose response was actually read (a page that failed to fetch is not counted here). */
  pagesWalked: number;
  pages: CitiusPageOutcome[];
  /** The highest page number the PAGER REGION advertised through a parameter this module can drive,
   *  anywhere in the walk. A PAGE count — see the CS6 wiring contract clause (b): this is NOT CS3's
   *  item-level `pageTotal`. */
  advertisedPageCount?: number;
}

export type CitiusInboxEnumeration =
  | (EnumerationBase & { status: 'complete' })
  | (EnumerationBase & { status: 'incomplete'; reason: CitiusIncompleteReason })
  | (EnumerationBase & { status: 'session-dead'; detectedBy: 'login-redirect' | 'login-page'; atPage: number })
  | (EnumerationBase & { status: 'failed'; error: string; atPage: number });

// ---------------------------------------------------------------------------
// Cookie jar (replay only — nothing here is ever logged or returned)
// ---------------------------------------------------------------------------

interface JarCookie {
  name: string;
  value: string;
  /** Bare domain, leading dot stripped (the matcher already treats a parent as covering children). */
  domain: string;
  path: string;
  secure: boolean;
}

/**
 * Cookies out of a Playwright `storageState`. Anything malformed is skipped, never guessed at — and
 * a cookie with NO domain is skipped too: a session cookie is credential-equivalent, and a domain is
 * the only statement the jar makes about where it may be replayed. The Cofre treats a domain-less
 * cookie the same way (`originsFromStorageState` ignores it), so a session whose jar says nothing
 * fails loudly here rather than being replayed at whatever host the caller happened to configure.
 */
function jarFromStorageState(state: unknown): JarCookie[] {
  const raw = (state as { cookies?: unknown } | null)?.cookies;
  if (!Array.isArray(raw)) return [];
  const out: JarCookie[] = [];
  for (const entry of raw) {
    const c = entry as { name?: unknown; value?: unknown; domain?: unknown; path?: unknown; secure?: unknown };
    if (typeof c?.name !== 'string' || !c.name || typeof c.value !== 'string') continue;
    const domain = typeof c.domain === 'string' ? c.domain.replace(/^\./, '').toLowerCase() : '';
    if (!domain) continue;
    out.push({
      name: c.name,
      value: c.value,
      domain,
      path: typeof c.path === 'string' && c.path.startsWith('/') ? c.path : '/',
      secure: c.secure === true,
    });
  }
  return out;
}

/** RFC 6265-ish domain match: exact host, or a parent domain of it. A domain-less cookie never
 *  matches (it never reaches the jar either — see `jarFromStorageState`). */
function domainMatches(host: string, domain: string): boolean {
  if (!domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

/** RFC 6265-ish path match: `/` matches everything; otherwise a path prefix on a `/` boundary. */
function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (cookiePath === '/') return true;
  if (requestPath === cookiePath) return true;
  return requestPath.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`);
}

/**
 * The `Cookie` header for one request, or '' when nothing in the jar applies to it. RFC 6265 §5.4
 * ordering: longest path first, then jar order (a rotated cookie replaces its entry in place, so
 * jar order is arrival order). Deduped BY NAME — two jar entries that differ only in domain or path
 * would otherwise send the same name twice and let the server pick, which for a session id is a
 * coin toss this module has no business tossing.
 */
function cookieHeaderFor(jar: JarCookie[], url: URL): string {
  const host = url.hostname.toLowerCase();
  const isHttps = url.protocol === 'https:';
  const applicable = jar
    .map((c, index) => ({ c, index }))
    .filter(({ c }) =>
      (!c.secure || isHttps) && domainMatches(host, c.domain) && pathMatches(url.pathname, c.path))
    .sort((a, b) => (b.c.path.length - a.c.path.length) || (a.index - b.index));
  const sent = new Set<string>();
  const parts: string[] = [];
  for (const { c } of applicable) {
    if (sent.has(c.name)) continue;
    sent.add(c.name);
    parts.push(`${c.name}=${c.value}`);
  }
  return parts.join('; ');
}

/**
 * Fold a response's `Set-Cookie`s into the jar (rotation is normal WebForms/WAF behaviour —
 * SPIKE #8). An empty value deletes; everything else replaces by (name, domain, path). A `Domain`
 * attribute that is not the request host or a parent of it is REJECTED outright (RFC 6265 §5.3
 * step 6): a `domain=example` from `portal.example` must not put a cookie in the jar that would
 * then replay at any `*.example`.
 */
function absorbSetCookies(jar: JarCookie[], res: CitiusTransportResponse, url: URL): void {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? ''].filter(Boolean);
  const host = url.hostname.toLowerCase();
  for (const line of raw) {
    const [pair, ...attrs] = line.split(';');
    const eq = (pair ?? '').indexOf('=');
    if (eq <= 0) continue;
    const name = (pair ?? '').slice(0, eq).trim();
    const value = (pair ?? '').slice(eq + 1).trim();
    if (!name) continue;
    let domain = host;
    let path = '/';
    let secure = false;
    let rejected = false;
    for (const attr of attrs) {
      const [k, v] = attr.split('=');
      const key = (k ?? '').trim().toLowerCase();
      if (key === 'domain' && v) {
        const declared = v.trim().replace(/^\./, '').toLowerCase();
        if (!declared || !domainMatches(host, declared)) { rejected = true; break; }
        domain = declared;
      } else if (key === 'path' && v && v.trim().startsWith('/')) path = v.trim();
      else if (key === 'secure') secure = true;
    }
    if (rejected) continue;
    const at = jar.findIndex((c) => c.name === name && c.domain === domain && c.path === path);
    if (!value) {
      if (at >= 0) jar.splice(at, 1);
      continue;
    }
    const next: JarCookie = { name, value, domain, path, secure };
    if (at >= 0) jar[at] = next;
    else jar.push(next);
  }
}

// ---------------------------------------------------------------------------
// Page / pager shape (the transport half of the live-shape risk)
// ---------------------------------------------------------------------------

/** A WebForms control id (`ctl00$cph$gvNotificacoes`). Anything else is not a postback target. */
const WEBFORMS_ID_RE = /^[A-Za-z0-9_$:.-]{1,200}$/;
/** The reviewed Citius login control ids (the three the `recipes.json` entry pins). */
const LOGIN_CONTROL_RE = /txtUserPass|txtUserName|ImBtnLogin/i;
const PASSWORD_INPUT_RE = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
/** A `<form action=…>` pointing at an authentication endpoint. */
const FORM_ACTION_RE = /<form\b[^>]*\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const LOGIN_PATH_RE = /login|autentica/i;

/** A pager token this module cannot drive numerically (`Page$Next`) — SPIKE #3. */
const NON_NUMERIC_PAGE_TOKEN_RE = /Page\$(?![0-9])/i;

/** A plain query-parameter name. Anything else is not a page parameter. */
const PAGE_PARAM_RE = /^[A-Za-z0-9_.$-]{1,40}$/;

/**
 * Labels a next/last-page control wears, read AFTER entity decoding (so `&gt;&gt;` and `&raquo;`
 * arrive here as `>>` and `»`). Deliberately narrow, and only ever consulted on a NAVIGATIONAL
 * control inside the scan scope: an ordinary "página seguinte" sentence in help prose is not a
 * control, and a prose LINK to a help page carries no query string, so neither reaches this test.
 */
const NEXT_LABEL_RE = /seguinte|pr[oó]xim|[uú]ltim|avan[cç]|>>|»|\bnext\b|\blast\b/i;

/** Script/style bodies and comments: never pager markup, and the classic source of a phantom
 *  `Page$` token or `?page=` string (round-6 HIGH). */
const NOISE_RE = /<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi;
/** One table row, and the cells in it. A row with >= 2 direct cells is a DATA row (CS1's own
 *  structural rule) and is removed before any pager scan: a notification's own links are not the
 *  pager, so a `?page=2` or `&p=3` riding inside one can no longer speak for it. */
const ROW_RE = /<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi;
const CELL_RE = /<t[dh]\b/gi;

/** Containers a portal names like a pager. */
const PAGER_NAMED_RE = /\b(?:class|id)\s*=\s*["']?[^"'>]*(?:pager|paging|pagination|pagina|pgr)/i;
const CONTAINER_OPEN_RE = /<(div|span|table|tbody|tr|td|nav|ul|ol|p)\b([^>]*)>/gi;
/** Bounds on the region scan, so a hostile or broken page cannot make this quadratic. */
const MAX_REGION_ELEMENT_BYTES = 64 * 1024;
const MAX_REGION_BYTES = 256 * 1024;

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]{0,800}?)<\/a\s*>/gi;
const INPUT_TAG_RE = /<input\b[^>]*>/gi;
const BUTTON_RE = /<button\b([^>]*)>([\s\S]{0,800}?)<\/button\s*>/gi;
/** `alt` / `title` / `value` on anything NESTED inside a control — an `<img alt="Seguinte">` is the
 *  whole label of an image-only pager button. */
const NESTED_LABEL_ATTR_RE = /\b(?:alt|title|value)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
/** A label that is nothing but a page number (`2`, `[2]`, `Página 2`). */
const NUMERIC_LABEL_RE = /^[^0-9]{0,12}([0-9]{1,6})[^0-9]{0,12}$/;

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

/** One attribute off an already-isolated tag / attribute string, entity-decoded, '' when absent. */
function attrOf(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return decodeEntities(m?.[1] ?? m?.[2] ?? m?.[3] ?? '');
}

/** `ctl00$cph$btnNext` -> `ctl00 cph btn Next`, so a control's NAME can be read as a label. */
function humanise(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9À-ɏ]+/g, ' ').trim();
}

function cellCount(row: string): number {
  CELL_RE.lastIndex = 0;
  let n = 0;
  while (CELL_RE.exec(row) !== null) n += 1;
  return n;
}

/**
 * THE SCAN SCOPE: the page with its scripts, styles, comments and GRID DATA ROWS removed. Every
 * pager scan starts here, so ordinary page content cannot be mistaken for pagination (round-6
 * HIGH). Removing content can only ever make this module see FEWER pages, which is why the pager
 * checks that survive are all fail-CLOSED ones: what is left after this cut is the only place a
 * pager is allowed to speak from.
 */
function scanScope(html: string): string {
  NOISE_RE.lastIndex = 0;
  const quiet = html.replace(NOISE_RE, ' ');
  ROW_RE.lastIndex = 0;
  return quiet.replace(ROW_RE, (row) => (cellCount(row) >= 2 ? ' ' : row));
}

/** The inner html of an element whose opening tag ends at `from`, matching nesting, bounded. */
function elementInner(html: string, name: string, from: number): string {
  const re = new RegExp(`<${name}\\b|</${name}\\s*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index - from > MAX_REGION_ELEMENT_BYTES) break;
    if ((m[0] ?? '').startsWith('</')) {
      depth -= 1;
      if (depth === 0) return html.slice(from, m.index);
    } else depth += 1;
  }
  return html.slice(from, Math.min(html.length, from + MAX_REGION_ELEMENT_BYTES));
}

/**
 * THE PAGER REGION inside an already-scoped page: containers the portal names like a pager, plus
 * the single-cell rows a WebForms GridView renders its pager into. `''` when the page shows nothing
 * pager-shaped — which is itself a signal (it is what arms the FLOOR).
 */
function pagerRegion(scoped: string): string {
  const parts: string[] = [];
  let size = 0;
  const take = (s: string): void => {
    if (!s || size >= MAX_REGION_BYTES) return;
    parts.push(s.slice(0, MAX_REGION_BYTES - size));
    size += s.length;
  };
  CONTAINER_OPEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONTAINER_OPEN_RE.exec(scoped)) !== null) {
    if (!PAGER_NAMED_RE.test(m[2] ?? '')) continue;
    take(elementInner(scoped, m[1] ?? 'div', m.index + (m[0] ?? '').length));
  }
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(scoped)) !== null) {
    const row = m[0];
    if (cellCount(row) >= 2) continue;
    if (!/<a\b|<input\b|<button\b/i.test(row)) continue;
    take(row);
  }
  return parts.join('\n');
}

/** One navigational control, reduced to everything that could say "this goes to another page". */
interface NavControl {
  /** Entity-decoded `href` / `formaction`, '' when the control carries none. */
  href: string;
  /** Everything scriptable on it (href + onclick), entity-decoded — where `Page$N` lives. */
  drive: string;
  /** Every label it wears: its text, its nested `alt`/`title`/`value`, its humanised `name`/`id`. */
  label: string;
  /** A form/script control (as opposed to a plain prose link, which is never a pager). */
  navigational: boolean;
  disabled: boolean;
}

function isDisabled(attrs: string): boolean {
  return /\bdisabled\b/i.test(attrs) || /\bclass\s*=\s*["'][^"']*(?:aspnetdisabled|disabled)/i.test(attrs);
}

/** Text + every nested `alt`/`title`/`value` of a control's inner html, entity-decoded. */
function labelsIn(inner: string): string {
  const attrs: string[] = [];
  NESTED_LABEL_ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NESTED_LABEL_ATTR_RE.exec(inner)) !== null) attrs.push(m[1] ?? m[2] ?? m[3] ?? '');
  const text = inner.replace(/<[^>]*>/g, ' ');
  return decodeEntities(`${text} ${attrs.join(' ')}`).replace(/\s+/g, ' ').trim();
}

/**
 * EVERY navigational control in a scope — anchors, `<button>`s and `<input type=submit|button|image>`
 * alike. The round-6 CRITICAL: the old guard read only `<a href="…__doPostBack…">`, so a labelled
 * GET link, an `<img alt="Seguinte">` and a submit button were never inspected at all.
 */
function navControls(scope: string): NavControl[] {
  const out: NavControl[] = [];
  let m: RegExpExecArray | null;

  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(scope)) !== null) {
    const attrs = m[1] ?? '';
    const href = attrOf(attrs, 'href');
    const onclick = attrOf(attrs, 'onclick');
    const label = `${labelsIn(m[2] ?? '')} ${attrOf(attrs, 'title')}`.trim();
    out.push({
      href,
      drive: `${href} ${onclick}`,
      label,
      // A prose link carries a plain path and no script; a pager link carries a query, a fragment,
      // a `javascript:` url or a handler. A bare NUMBER as its whole label makes it one too.
      navigational:
        !href || href === '#' || /^javascript:/i.test(href) || href.includes('?') || Boolean(onclick)
        || NUMERIC_LABEL_RE.test(label),
      disabled: isDisabled(attrs),
    });
  }

  INPUT_TAG_RE.lastIndex = 0;
  while ((m = INPUT_TAG_RE.exec(scope)) !== null) {
    const tag = m[0];
    const type = attrOf(tag, 'type').toLowerCase();
    if (type !== 'submit' && type !== 'button' && type !== 'image') continue;
    const href = attrOf(tag, 'formaction');
    out.push({
      href,
      drive: `${href} ${attrOf(tag, 'onclick')}`,
      label: [
        attrOf(tag, 'value'), attrOf(tag, 'alt'), attrOf(tag, 'title'),
        humanise(attrOf(tag, 'name')), humanise(attrOf(tag, 'id')),
      ].join(' ').trim(),
      navigational: true,
      disabled: isDisabled(tag),
    });
  }

  BUTTON_RE.lastIndex = 0;
  while ((m = BUTTON_RE.exec(scope)) !== null) {
    const attrs = m[1] ?? '';
    const href = attrOf(attrs, 'formaction');
    out.push({
      href,
      drive: `${href} ${attrOf(attrs, 'onclick')}`,
      label: [
        labelsIn(m[2] ?? ''), attrOf(attrs, 'value'), attrOf(attrs, 'title'), humanise(attrOf(attrs, 'name')),
      ].join(' ').trim(),
      navigational: true,
      disabled: isDisabled(attrs),
    });
  }
  return out;
}

/** What one scope says about pagination. */
interface PagerReading {
  /** Highest page number advertised through a parameter this module can DRIVE. */
  advertised?: number;
  /** Every page number the pager NAMES — drivable links plus the plain numbers it prints (a
   *  WebForms pager renders the current page as text). Used only for the exhaustion check. */
  numbers: number[];
  /** How `page + 1` can be reached, when this scope offers it drivably. */
  next?: 'get' | 'postback';
  /** A control that means "there are more pages" and that this module cannot drive numerically. */
  undrivable: boolean;
}

/** The page number a control addresses in an idiom we can drive, or null. */
function drivenPageOf(control: NavControl, namesAlt: string): number | null {
  const found: number[] = [];
  const target = `${control.href} ${control.drive}`;
  const getRe = new RegExp(`[?&](?:${namesAlt})=(\\d{1,6})(?![0-9])`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = getRe.exec(target)) !== null) found.push(Number(m[1]));
  const pbRe = /Page\$(\d{1,6})(?![0-9])/gi;
  while ((m = pbRe.exec(target)) !== null) found.push(Number(m[1]));
  const valid = found.filter((n) => n > 0);
  return valid.length ? Math.max(...valid) : null;
}

/**
 * Read one scope's pagination. `isPagerRegion` says the scope IS the pager, which means (a) every
 * control in it is a pager control, whatever its shape, and (b) the plain numbers it prints count
 * as page numbers for the exhaustion check.
 */
function readPager(scope: string, page: number, names: string[], isPagerRegion: boolean): PagerReading {
  const namesAlt = names.map(escapeForRegExp).join('|');
  const decoded = decodeEntities(scope);
  const drivable: number[] = [];
  const getNums = new Set<number>();
  const pbNums = new Set<number>();
  let m: RegExpExecArray | null;

  const getRe = new RegExp(`[?&](?:${namesAlt})=(\\d{1,6})(?![0-9])`, 'gi');
  while ((m = getRe.exec(decoded)) !== null) {
    const n = Number(m[1]);
    if (n > 0) { getNums.add(n); drivable.push(n); }
  }
  const pbRe = /Page\$(\d{1,6})(?![0-9])/gi;
  while ((m = pbRe.exec(decoded)) !== null) {
    const n = Number(m[1]);
    if (n > 0) { pbNums.add(n); drivable.push(n); }
  }

  const numbers = [...drivable];
  if (isPagerRegion) {
    const textNums = decodeEntities(scope.replace(/<[^>]*>/g, ' ')).match(/\b\d{1,6}\b/g) ?? [];
    for (const t of textNums) {
      const n = Number(t);
      if (n > 0) numbers.push(n);
    }
  }

  const nonNumericParamRe = new RegExp(`[?&](?:${namesAlt})=(?![0-9])`, 'i');
  let undrivable = false;
  for (const control of navControls(scope)) {
    if (control.disabled) continue;
    if (!isPagerRegion && !control.navigational) continue;
    const driven = drivenPageOf(control, namesAlt);
    // A control that points at THIS page or an earlier one is a "1"/"Anterior"/"Última(=here)"
    // control on the last page, not evidence of more.
    if (driven !== null && driven <= page) continue;
    if (NON_NUMERIC_PAGE_TOKEN_RE.test(control.drive) || nonNumericParamRe.test(control.href)) {
      undrivable = true;
      continue;
    }
    if (NEXT_LABEL_RE.test(control.label)) { undrivable = true; continue; }
    // A link labelled with a page number BEYOND this one that we cannot address: the `?pagina=2`
    // shape. `pageParam` is the fix (SPIKE #2) and this is what prompts it.
    const labelled = NUMERIC_LABEL_RE.exec(control.label);
    if (driven === null && labelled && Number(labelled[1]) > page) undrivable = true;
  }
  // A region CS1 classifies as a pager, in which we recognised no page number at all: an unlabelled
  // postback chevron is exactly this shape.
  if (isPagerRegion && drivable.length === 0 && scope.trim() !== '' && detectPagingMode(scope) !== 'none') {
    undrivable = true;
  }

  const next: 'get' | 'postback' | undefined =
    getNums.has(page + 1) ? 'get' : pbNums.has(page + 1) ? 'postback' : undefined;
  const advertised = drivable.length ? Math.max(...drivable) : undefined;
  return {
    numbers,
    undrivable,
    ...(advertised === undefined ? {} : { advertised }),
    ...(next === undefined ? {} : { next }),
  };
}

/**
 * Did the pager NAME every page from 1 up to the one we are on? A WebForms pager renders the
 * current page as a label and the others as links, so `{1..page}` all present is the pager saying
 * "this is the last page" — the one thing that exempts a full grid from the FLOOR. A WINDOWED pager
 * (`… 8 9 [10]`) fails this on purpose: it names no page 1, so it proves nothing about the end.
 */
function pagerAccountsForEveryPageUpTo(numbers: number[], page: number): boolean {
  if (numbers.length === 0) return false;
  const named = new Set(numbers);
  named.add(page);
  for (let n = 1; n <= page; n += 1) if (!named.has(n)) return false;
  return true;
}

/** The `__EVENTTARGET` that drives this page's pager to `page`, or null when the page does not
 *  offer one in a shape we recognise. Refused unless it looks like a WebForms control id. Read off
 *  the SCOPED page, so a `Page$N` inside a `<script>` cannot supply a target. */
function postbackTargetFor(scoped: string, page: number): string | null {
  const re = new RegExp(`__doPostBack\\s*\\(\\s*["']([^"']*)["']\\s*,\\s*["']Page\\$${page}["']`, 'i');
  const m = re.exec(scoped);
  const target = m?.[1]?.trim();
  if (!target || !WEBFORMS_ID_RE.test(target)) return null;
  return target;
}

/** A 3xx `Location` that points at a login page. Resolved against the request URL, so a bare path
 *  works; the target is never FETCHED, only classified. Pathname only — SPIKE #1's LOW note. */
function isLoginLocation(location: string, from: string): boolean {
  if (!location) return false;
  try {
    return LOGIN_PATH_RE.test(new URL(location, from).pathname);
  } catch {
    return LOGIN_PATH_RE.test(location);
  }
}

/** Does the page post to an authentication endpoint? */
function hasLoginShapedFormAction(html: string): boolean {
  FORM_ACTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FORM_ACTION_RE.exec(html)) !== null) {
    if (LOGIN_PATH_RE.test(decodeEntities(m[1] ?? m[2] ?? m[3] ?? ''))) return true;
  }
  return false;
}

/**
 * A login page: the reviewed Citius login control ids, or a password field ON A FORM THAT POSTS TO
 * AN AUTHENTICATION ENDPOINT. A bare password input is NOT enough (round-6 MEDIUM 2): the WAF
 * challenge SPIKE #7 names can carry one, and `session-dead` SPENDS a login attempt against a portal
 * whose lock-out policy is unobserved — the same reason 401/403 is `failed` one branch up. The two
 * rails now agree. Consulted ONLY where the parser has ALREADY refused the page — see the call site
 * — so a populated inbox can never be re-read as a login page.
 */
function looksLikeLoginPage(html: string): boolean {
  if (LOGIN_CONTROL_RE.test(html)) return true;
  return PASSWORD_INPUT_RE.test(html) && hasLoginShapedFormAction(html);
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, min), max);
}

/** An optional bound: `undefined` stays `undefined` (unset is not zero). */
function clampOptional(value: number | undefined, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.floor(value), min), max);
}

// ---------------------------------------------------------------------------
// enumerateInbox
// ---------------------------------------------------------------------------

/**
 * Walk the authenticated caixa de correio and return notification METADATA.
 *
 * NEVER THROWS: every failure resolves to a typed outcome, because this is the seam a sync rail
 * calls and an exception there is an outage, not an answer (`events/verified-sync.ts` expects
 * `ok:false`, not a rejection). The `try` covers the whole walk for that reason.
 */
export async function enumerateInbox(
  input: EnumerateInboxInput,
  deps: EnumerateInboxDeps = {},
): Promise<CitiusInboxEnumeration> {
  try {
    return await walk(input, deps);
  } catch (err) {
    // A bug here must still be an honest outcome. The message is this module's own or a class name
    // — never an upstream string that might have been composed around a cookie.
    return {
      status: 'failed',
      error: safeFailure(err),
      atPage: 0,
      rows: [],
      pagesWalked: 0,
      pages: [],
    };
  }
}

/** Errors this module composes are safe to repeat; anything else is reduced to its class name (the
 *  `session-establishment.ts` rule: a message we cannot vouch for is replaced, not echoed). The
 *  test is `instanceof`, never a duck-typed `code` string — a foreign error carrying that code is
 *  not a message this module vouches for (round-6 LOW 1). */
function safeFailure(err: unknown): string {
  if (err instanceof RangeError || err instanceof TypeError || err instanceof SyntaxError) {
    return `erro de transporte (${err.name})`;
  }
  if (err instanceof CredentialOriginError) return err.message;
  const name = (err as { constructor?: { name?: unknown } } | null)?.constructor?.name;
  return `erro de transporte (${typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'Error'})`;
}

async function walk(input: EnumerateInboxInput, deps: EnumerateInboxDeps): Promise<CitiusInboxEnumeration> {
  const transport = deps.transport ?? defaultTransport;
  const sleep = deps.sleep ?? defaultSleep;
  const maxPages = clamp(input.maxPages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES);
  const throttleMs = clamp(input.throttleMs, DEFAULT_THROTTLE_MS, 0, MAX_THROTTLE_MS);
  const timeoutMs = clamp(input.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 1, MAX_REQUEST_TIMEOUT_MS);
  const configuredPageSize = clampOptional(input.pageSize, 1, MAX_PAGE_SIZE);

  const rows: CitiusNotificacaoMeta[] = [];
  const pages: CitiusPageOutcome[] = [];
  const seenRefs = new Set<string>();
  /** Rows each SUCCESSFULLY PARSED page returned, in order — the FLOOR's page-size evidence. */
  const rowsPerPage: number[] = [];
  let pagesWalked = 0;
  let advertisedPageCount: number | undefined;

  const fail = (error: string, atPage: number): CitiusInboxEnumeration => ({
    status: 'failed', error, atPage, rows, pagesWalked, pages,
    ...(advertisedPageCount === undefined ? {} : { advertisedPageCount }),
  });
  const partial = (reason: CitiusIncompleteReason): CitiusInboxEnumeration => ({
    status: 'incomplete', reason, rows, pagesWalked, pages,
    ...(advertisedPageCount === undefined ? {} : { advertisedPageCount }),
  });

  // --- configuration: the ONE url this walk will ever request ------------------------------------
  const baseUrl = input.baseUrl ?? CITIUS_MANDATARIOS_BASE_URL;
  let inboxUrl: URL;
  try {
    inboxUrl = new URL(input.inboxPath ?? CITIUS_INBOX_PATH, baseUrl);
  } catch {
    return fail('configuração inválida: URL da caixa de correio', 0);
  }
  const pageParam = input.pageParam ?? 'page';
  if (!PAGE_PARAM_RE.test(pageParam)) return fail('configuração inválida: parâmetro de página', 0);
  const pageNames = [...new Set([pageParam, 'p', 'page'])];
  // The default binding comes from the CONFIGURED BASE URL, never from the RESOLVED inbox url: an
  // absolute `inboxPath` would otherwise redefine the very binding it is checked against, which is
  // a check that cannot fail (round-6 LOW 4).
  const allowedOrigins = (input.boundOrigins?.length
    ? input.boundOrigins
    : [originFromBaseUrl(baseUrl)].filter((h): h is string => Boolean(h)));
  if (allowedOrigins.length === 0) return fail('configuração inválida: origem sem host', 0);

  // --- the session -------------------------------------------------------------------------------
  const jar = jarFromStorageState(input.sessionState);
  if (cookieHeaderFor(jar, inboxUrl) === '') {
    // Refuse rather than fetch anonymously: an unauthenticated hit would come back as a login page
    // and read as `session-dead`, which would then send the caller off to re-establish a session
    // that was never the problem.
    return fail('sessão sem cookies replicáveis para esta origem', 0);
  }

  let page = 1;
  /** How the PREVIOUS page said this one is reached. Page 1 is always a plain GET. */
  let nextKind: 'get' | 'postback' = 'get';
  // The html of the page we are currently ON — a postback for page N+1 is built from ITS hidden
  // state, which is the only thing a WebForms server will accept. `currentScope` is the same page
  // with rows/scripts/comments cut, which is where the postback TARGET is read from.
  let currentHtml = '';
  let currentScope = '';

  for (;;) {
    if (page > 1 && throttleMs > 0) await sleep(throttleMs);

    // ---- build the request. The URL is ALWAYS the configured inbox URL; only the page number and
    // ---- the ALLOWLISTED, page-supplied WebForms hidden fields vary. Nothing from the page is ever
    // ---- used as a destination, and nothing outside the allowlist is ever echoed back.
    const requestUrl = new URL(inboxUrl.toString());
    let method: 'GET' | 'POST' = 'GET';
    let body: string | undefined;
    const headers: Record<string, string> = { ...BASE_HEADERS };

    if (page === 1 || nextKind === 'get') {
      if (page > 1) requestUrl.searchParams.set(pageParam, String(page));
    } else {
      const target = postbackTargetFor(currentScope, page);
      if (!target) {
        pages.push({ page, outcome: 'refused', rows: 0, note: 'postback sem alvo reconhecível' });
        return partial('pager-unavailable');
      }
      const form = new URLSearchParams();
      for (const [name, value] of Object.entries(parseHiddenFields(currentHtml))) {
        if (!POSTBACK_FIELD_ALLOWLIST.has(name) && !SCROLL_POSITION_FIELD_RE.test(name)) continue;
        form.set(name, value);
      }
      form.set('__EVENTTARGET', target);
      form.set('__EVENTARGUMENT', `Page$${page}`);
      body = form.toString();
      if (Buffer.byteLength(body, 'utf8') > MAX_POSTBACK_BODY_BYTES) {
        pages.push({ page, outcome: 'refused', rows: 0, note: 'estado oculto acima do limite' });
        return partial('pager-unavailable');
      }
      method = 'POST';
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      // A browser sends this on a postback and some WebForms deployments check it. It can only ever
      // be OUR OWN inbox URL, so it discloses nothing the request does not already state.
      headers.Referer = inboxUrl.toString();
    }

    // ---- origin binding BEFORE the credential travels, whatever transport is wired in ------------
    try {
      assertOriginAllowed(requestUrl.toString(), { allowedOrigins, credentialLabel: 'sessão Caixa Citius' });
    } catch (err) {
      pages.push({ page, outcome: 'refused', rows: 0, note: 'destino não vinculado à credencial' });
      return fail(safeFailure(err), page);
    }

    const cookie = cookieHeaderFor(jar, requestUrl);
    if (cookie) headers.Cookie = cookie;

    // ---- send ------------------------------------------------------------------------------------
    let res: CitiusTransportResponse;
    try {
      res = await transport(requestUrl.toString(), { method, headers, body, timeoutMs, allowedOrigins });
    } catch (err) {
      pages.push({ page, outcome: 'transport-error', rows: 0, note: safeFailure(err) });
      return fail(safeFailure(err), page);
    }
    absorbSetCookies(jar, res, requestUrl);

    // ---- a redirect is CLASSIFIED, never followed. Following one with a session cookie attached is
    // ---- how a credential ends up on a host that was never bound to it.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') ?? '';
      if (isLoginLocation(location, requestUrl.toString())) {
        pages.push({ page, outcome: 'login', rows: 0, status: res.status, note: 'redireção para a autenticação' });
        return {
          status: 'session-dead', detectedBy: 'login-redirect', atPage: page, rows, pagesWalked, pages,
          ...(advertisedPageCount === undefined ? {} : { advertisedPageCount }),
        };
      }
      pages.push({ page, outcome: 'http-error', rows: 0, status: res.status, note: 'redireção inesperada' });
      return fail(`redireção inesperada (HTTP ${res.status})`, page);
    }
    if (!res.ok) {
      // 401/403 included DELIBERATELY: an auth-shaped refusal from a portal whose WAF and lock-out
      // policy are unobserved is not proof the session died, and `session-dead` costs a login
      // attempt (CS5's caller contract: never spend one on a guess).
      pages.push({ page, outcome: 'http-error', rows: 0, status: res.status });
      return fail(`resposta HTTP ${res.status}`, page);
    }

    // A declared length over the cap is refused BEFORE the body is read; the post-buffer check below
    // still stands for a response that declared none or lied (SPIKE #13).
    const declaredLength = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      pages.push({ page, outcome: 'http-error', rows: 0, status: res.status, note: 'resposta acima do limite' });
      return fail('resposta acima do limite', page);
    }

    let html: string;
    try {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_RESPONSE_BYTES) {
        pages.push({ page, outcome: 'http-error', rows: 0, status: res.status, note: 'resposta acima do limite' });
        return fail('resposta acima do limite', page);
      }
      html = decodeHtml(buf, res.headers.get('content-type') ?? '');
    } catch (err) {
      pages.push({ page, outcome: 'transport-error', rows: 0, status: res.status, note: safeFailure(err) });
      return fail(safeFailure(err), page);
    }
    pagesWalked += 1;

    // ---- parse. CS1 owns this verdict entirely; this module never second-guesses it. --------------
    const parsed = parseInboxPage(html);
    if (!parsed.ok) {
      // The login check runs HERE, on the refused branch only, and never on a page that parsed: a
      // populated inbox must never be re-read as a login page because a marker appeared somewhere in
      // its markup. CS1 already guarantees a login/WAF/session page cannot parse.
      if (looksLikeLoginPage(html)) {
        pages.push({ page, outcome: 'login', rows: 0, status: res.status, note: 'página de autenticação' });
        return {
          status: 'session-dead', detectedBy: 'login-page', atPage: page, rows, pagesWalked, pages,
          ...(advertisedPageCount === undefined ? {} : { advertisedPageCount }),
        };
      }
      // "The parser could not read this page" NEVER becomes "there are no notifications". The walk
      // stops here on purpose: whatever the portal just returned, we did not understand it, and
      // continuing to hammer it for more pages we may also not understand buys nothing — the run is
      // already proved partial and the caller will re-sweep.
      pages.push({ page, outcome: 'unparseable', rows: 0, status: res.status, note: parsed.error });
      return partial('page-unparseable');
    }

    const fresh = parsed.rows.filter((r) => !seenRefs.has(r.ref));
    if (page > 1 && parsed.rows.length > 0 && fresh.length === 0) {
      // Every row was already seen this walk: the pager clamped an out-of-range page back to a page
      // we read (the CS2 mock does exactly this), or it is looping. Stop, and say so.
      pages.push({ page, outcome: 'ok', rows: parsed.rows.length, status: res.status, note: 'página repetida' });
      return partial('repeat-page');
    }
    for (const row of fresh) {
      seenRefs.add(row.ref);
      rows.push(row);
    }
    pages.push({ page, outcome: 'ok', rows: parsed.rows.length, status: res.status });
    rowsPerPage.push(parsed.rows.length);

    // ---- read the pager, inside its own region first ------------------------------------------------
    currentHtml = html;
    currentScope = scanScope(html);
    const region = pagerRegion(currentScope);
    const inPager = readPager(region, page, pageNames, true);
    // The advertised count is the MAX across the walk: a WebForms pager renders the current page as
    // a label rather than a link, so page N's own markup can advertise FEWER pages than page 1's did.
    if (inPager.advertised !== undefined && inPager.advertised > (advertisedPageCount ?? 0)) {
      advertisedPageCount = inPager.advertised;
    }

    // ---- next page? -------------------------------------------------------------------------------
    const next = page + 1;
    if (!inPager.next) {
      // Exhausted — unless something says otherwise. Every check here is the SAFE direction: each
      // can only turn a `complete` into an `incomplete`, never the reverse. They are ordered by how
      // much an operator can trust them, and named apart for exactly that reason.
      if (advertisedPageCount !== undefined && advertisedPageCount > page) return partial('page-count-disagreement');
      if (inPager.undrivable) return partial('pager-unrecognised');
      // THE FLOOR. A full last page with no pager account of itself is not proof of the end.
      const priorPages = rowsPerPage.slice(0, -1);
      const knownPageSize = configuredPageSize
        ?? (priorPages.length ? Math.max(...priorPages) || undefined : undefined);
      const lastRows = rowsPerPage[rowsPerPage.length - 1] ?? 0;
      if (lastRows > 0 && knownPageSize !== undefined && lastRows >= knownPageSize
          && !pagerAccountsForEveryPageUpTo(inPager.numbers, page)) {
        return partial('page-full-no-pager');
      }
      // Last: the same signals, but from OUTSIDE the pager region. Fail-closed like the rest, named
      // apart because this is the rail that cries wolf on unusual page chrome.
      const outside = readPager(currentScope, page, pageNames, false);
      if (outside.undrivable || (outside.advertised !== undefined && outside.advertised > page)) {
        return partial('pager-ambiguous');
      }
      return {
        status: 'complete', rows, pagesWalked, pages,
        ...(advertisedPageCount === undefined ? {} : { advertisedPageCount }),
      };
    }
    if (next > maxPages) {
      // There IS another page and we are not allowed to fetch it. That is a truncation, and CS3's
      // contract turns exactly this into `reachedEnd:false` so the watermark cannot advance.
      return partial('max-pages');
    }
    nextKind = inPager.next;
    page = next;
  }
}
