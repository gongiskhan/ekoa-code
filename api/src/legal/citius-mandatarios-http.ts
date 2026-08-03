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
 *   URL. Page numbers are the only thing that varies, and they are integers this module generated.
 *   No href, no `documentoRef`, no `Location`, no form action from the page is ever fetched — not
 *   even followed (see `redirect` below). The module's code therefore never so much as NAMES
 *   `documentoRef` / `Documento.aspx` / `docId`; a `documentoRef` rides through inside the opaque
 *   `CitiusNotificacaoMeta` rows and is never read here. The guard suite asserts all of it, plus an
 *   exact export allowlist so a new exported function cannot appear without a reviewer seeing it.
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
 *                    count agrees with what was actually walked.
 *   `incomplete`   — the walk is PROVED PARTIAL: a page the parser refused, a truncation at
 *                    `maxPages`, a pager this module could not drive, or an advertised page count
 *                    the walk did not reach. Rows captured so far are RETURNED (they are real), and
 *                    `reason` says which. Never silently upgraded to `complete`.
 *   `session-dead` — the portal answered with a login page / a redirect to one. Its OWN outcome,
 *                    never an empty inbox: the caller must re-establish (CS5) and re-enumerate.
 *   `failed`       — machinery: the transport threw, a non-2xx, an unbound origin, an unusable
 *                    configuration. Nothing is known about completeness.
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
 *       quantities that unfortunately share a name upstream: CS1's `pageTotal` (which this module
 *       re-exposes as `advertisedPageCount`) is a count of PAGES read off the pager, while CS3's
 *       `pageTotal` is documented as "the source's TRUE, COMPLETE count of ITEMS in the window" and
 *       is compared against `items.length`. Feeding pages into an item count would either block
 *       every run (harmless) or — with 2 pages and 2 items — CERTIFY a truncated sweep as complete
 *       and advance the watermark past unpaged notifications. This module therefore never emits a
 *       field named `pageTotal`, and a connector that cannot compute a true ITEM total for the
 *       window must omit CS3's `pageTotal` entirely and rely on `reachedEnd` (CS3 contract clause
 *       #complete-or-ok:false says so in as many words).
 *   (c) THE WINDOW IS THE CALLER'S. This module does no date filtering: it walks pages and returns
 *       every row it saw, deduped by `ref` within the walk. A connector that dropped rows whose
 *       `data` cell it could not parse would be inventing a silent miss; CS6 applies the
 *       `[since, until]` window (and CS3's seen-set does the cross-run dedup).
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
 *   2. INBOX PATH + PAGE PARAM — `/habilus/myhabilus/CaixaCorreio.aspx` and `?page=N` are synthetic
 *      guesses (CS1's fixtures / CS2's mock). Both are configurable inputs, so the first real
 *      snapshot is a config change, not a rewrite.
 *   3. PAGER IDIOM — numeric page links (`?page=N`) or `__doPostBack(target,'Page$N')` are assumed.
 *      THIS IS THE CONNECTOR'S MOST DANGEROUS UNKNOWN: a pager that only exposes a next/previous
 *      control would stop the walk after page 1 and call it COMPLETE. Three guards force
 *      `incomplete` instead — a non-numeric `Page$…` token (`Page$Next`), a non-numeric page
 *      parameter, and a POSTBACK anchor labelled like a next/last control
 *      (`hasUndrivablePagerControl`). A next control that is a plain GET link with neither a page
 *      parameter nor a recognised label (`?dir=next`) still reads as a single-page inbox. Confirm
 *      the pager markup on first access before trusting any `complete`.
 *   4. POSTBACK TARGET — read off the page's own `__doPostBack('target','Page$N')` and refused
 *      unless it matches the WebForms id charset. Whether the real grid's target is stable across
 *      pages (and whether a `__EVENTVALIDATION` from page N is accepted for page N+1) is unobserved.
 *      The postback sends `Referer` (this module's own inbox URL) and the page's whole hidden state;
 *      whether the real deployment needs more than that (an `X-MicrosoftAjax` header, a scroll
 *      position field, an async-postback wrapper) is unknown until a real page is seen.
 *   5. NO SERVER-SIDE WINDOW FILTER is assumed to exist, so every run walks from page 1. A large
 *      inbox therefore truncates at `maxPages` and reports INCOMPLETE for ever, rather than
 *      pretending. If the real page offers a date filter, plumb it and revisit clause (c) above.
 *   6. GRID SORT ORDER unknown — the walk never stops early on a date, because "newest first" is a
 *      guess and stopping on it is a silent miss.
 *   7. WAF ON A DATACENTRE IP — a challenge page is a 200 that is not the inbox: the parser refuses
 *      it and the walk reports `incomplete`, never empty. A challenge that happens to render a
 *      password field would be misread as `session-dead` (costing one re-establishment, not data).
 *   8. COOKIE ROTATION — the jar absorbs `Set-Cookie` during the walk (WAF cookies and rotating
 *      `ASP.NET_SessionId`s are the normal WebForms/Incapsula behaviour), but whether the real rail
 *      rotates anything is unobserved. Cookie ATTRIBUTES beyond name/value/domain/path/secure
 *      (SameSite, Max-Age semantics beyond a delete) are not modelled.
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
 */
import { parseInboxPage, detectPagingMode, type CitiusNotificacaoMeta } from './citius-mandatarios.js';
import { decodeHtml, parseHiddenFields } from './portal-html.js';
import { assertOriginAllowed, credentialedFetch, originFromBaseUrl } from '../security/origin-binding.js';

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

/** Browser-ish UA + Accept, the same shape the other legal connectors send. */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': 'Mozilla/5.0 (compatible; EkoaLegal/1.0; +https://ekoa.io)',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'pt-PT,pt;q=0.9',
};

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
   *  query-parameter name, so a caller cannot smuggle a second parameter into the URL. */
  pageParam?: string;
  /**
   * Hosts the session credential is bound to — the Cofre item's `boundOrigins`. CS6 SHOULD pass
   * them: the default (the base URL's own host) makes the check tautological, which is honest only
   * because the URL is ours, never the page's.
   */
  boundOrigins?: string[];
  /** Pages this call will walk before truncating (and reporting `incomplete`). */
  maxPages?: number;
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
  /** A pager idiom this module cannot drive numerically (e.g. a `Page$Next` token) — SPIKE #3. */
  | 'pager-unrecognised'
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
  /** The highest page number the pager advertised anywhere in the walk. A PAGE count — see the CS6
   *  wiring contract clause (b): this is NOT CS3's item-level `pageTotal`. */
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

/** The `Cookie` header for one request, or '' when nothing in the jar applies to it. */
function cookieHeaderFor(jar: JarCookie[], url: URL): string {
  const host = url.hostname.toLowerCase();
  const isHttps = url.protocol === 'https:';
  const parts: string[] = [];
  for (const c of jar) {
    if (c.secure && !isHttps) continue;
    if (!domainMatches(host, c.domain)) continue;
    if (!pathMatches(url.pathname, c.path)) continue;
    parts.push(`${c.name}=${c.value}`);
  }
  return parts.join('; ');
}

/** Fold a response's `Set-Cookie`s into the jar (rotation is normal WebForms/WAF behaviour —
 *  SPIKE #8). An empty value deletes; everything else replaces by (name, domain, path). */
function absorbSetCookies(jar: JarCookie[], res: CitiusTransportResponse, url: URL): void {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? ''].filter(Boolean);
  for (const line of raw) {
    const [pair, ...attrs] = line.split(';');
    const eq = (pair ?? '').indexOf('=');
    if (eq <= 0) continue;
    const name = (pair ?? '').slice(0, eq).trim();
    const value = (pair ?? '').slice(eq + 1).trim();
    if (!name) continue;
    let domain = url.hostname.toLowerCase();
    let path = '/';
    let secure = false;
    for (const attr of attrs) {
      const [k, v] = attr.split('=');
      const key = (k ?? '').trim().toLowerCase();
      if (key === 'domain' && v) domain = v.trim().replace(/^\./, '').toLowerCase();
      else if (key === 'path' && v && v.trim().startsWith('/')) path = v.trim();
      else if (key === 'secure') secure = true;
    }
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
/** A login page: a password field, or the reviewed Citius login control ids (the three the
 *  `recipes.json` entry pins). Consulted ONLY on the branch where the parser has ALREADY refused the
 *  page — see the call site — so a populated inbox can never be re-read as a login page. */
const PASSWORD_INPUT_RE = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
const LOGIN_CONTROL_RE = /txtUserPass|txtUserName|ImBtnLogin/i;
/** A pager token this module cannot drive numerically (`Page$Next`, `?page=` with no number) —
 *  SPIKE #3. Its presence at the end of a walk blocks `complete`. */
const NON_NUMERIC_PAGER_RE = /Page\$(?![0-9])|href\s*=\s*["'][^"']*[?&]p(?:age)?=(?![0-9])/i;

/** A plain query-parameter name. Anything else is not a page parameter. */
const PAGE_PARAM_RE = /^[A-Za-z0-9_.$-]{1,40}$/;

/** An anchor that drives a WebForms POSTBACK, with whatever it renders as its label. */
const POSTBACK_ANCHOR_RE = /<a\b[^>]*href\s*=\s*["'](?:javascript:)?__doPostBack[^>]*>([\s\S]{0,120}?)<\/a>/gi;
/** Labels a next/last-page control wears. Deliberately narrow, and only ever consulted on POSTBACK
 *  anchors: an ordinary "página seguinte" link in help text is not a pager. */
const NEXT_LABEL_RE = /seguinte|pr[oó]xim|[uú]ltim|&gt;&gt;|>>|&raquo;|»|\bnext\b|\blast\b/i;

/**
 * Is there a postback control that READS like "next page" but is not one this module can drive
 * numerically? Consulted only when the walk found no link for the next page — SPIKE #3, the
 * connector's most dangerous unknown. A pager that exposes only a next/last control (rather than
 * numbered pages) would otherwise stop the walk after page 1 and call it COMPLETE, which is the
 * silent miss the whole design exists to prevent. Over-firing costs an `incomplete` (the window is
 * re-swept); under-firing costs a lost legal notification.
 */
function hasUndrivablePagerControl(html: string): boolean {
  POSTBACK_ANCHOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = POSTBACK_ANCHOR_RE.exec(html)) !== null) {
    const label = (m[1] ?? '').replace(/<[^>]*>/g, ' ');
    if (NEXT_LABEL_RE.test(label)) return true;
  }
  return false;
}

/** Is there a link (GET) or a postback (WebForms) for this page number on this page? The GET form
 *  accepts the configured parameter name as well as CS1's `p`/`page` idiom (`detectPagingMode` reads
 *  the same two), because over-detecting a next page only ever makes the walk look for MORE. */
function hasPageLink(html: string, page: number, mode: 'get' | 'postback' | 'none', pageParam: string): boolean {
  if (mode === 'get') {
    const names = [...new Set(['p', 'page', pageParam])].map((n) => n.replace(/[.$*+?^${}()|[\]\\-]/g, '\\$&'));
    return new RegExp(`href\\s*=\\s*["'][^"']*[?&](?:${names.join('|')})=${page}\\b`, 'i').test(html);
  }
  if (mode === 'postback') {
    return new RegExp(`__doPostBack\\s*\\(\\s*["'][^"']*["']\\s*,\\s*["']Page\\$${page}["']`, 'i').test(html);
  }
  return false;
}

/** The `__EVENTTARGET` that drives this page's pager to `page`, or null when the page does not
 *  offer one in a shape we recognise. Refused unless it looks like a WebForms control id. */
function postbackTargetFor(html: string, page: number): string | null {
  const re = new RegExp(`__doPostBack\\s*\\(\\s*["']([^"']*)["']\\s*,\\s*["']Page\\$${page}["']`, 'i');
  const m = re.exec(html);
  const target = m?.[1]?.trim();
  if (!target || !WEBFORMS_ID_RE.test(target)) return null;
  return target;
}

/** A 3xx `Location` that points at a login page. Resolved against the request URL, so a bare path
 *  works; the target is never FETCHED, only classified. */
function isLoginLocation(location: string, from: string): boolean {
  if (!location) return false;
  try {
    return /login|autentica/i.test(new URL(location, from).pathname);
  } catch {
    return /login|autentica/i.test(location);
  }
}

function looksLikeLoginPage(html: string): boolean {
  return PASSWORD_INPUT_RE.test(html) || LOGIN_CONTROL_RE.test(html);
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, min), max);
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
 *  `session-establishment.ts` rule: a message we cannot vouch for is replaced, not echoed). */
function safeFailure(err: unknown): string {
  if (err instanceof RangeError || err instanceof TypeError || err instanceof SyntaxError) {
    return `erro de transporte (${err.name})`;
  }
  const name = (err as { constructor?: { name?: unknown } } | null)?.constructor?.name;
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'CREDENTIAL_ORIGIN_REFUSED' && err instanceof Error) return err.message;
  return `erro de transporte (${typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'Error'})`;
}

async function walk(input: EnumerateInboxInput, deps: EnumerateInboxDeps): Promise<CitiusInboxEnumeration> {
  const transport = deps.transport ?? defaultTransport;
  const sleep = deps.sleep ?? defaultSleep;
  const maxPages = clamp(input.maxPages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES);
  const throttleMs = clamp(input.throttleMs, DEFAULT_THROTTLE_MS, 0, MAX_THROTTLE_MS);
  const timeoutMs = clamp(input.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 1, MAX_REQUEST_TIMEOUT_MS);

  const rows: CitiusNotificacaoMeta[] = [];
  const pages: CitiusPageOutcome[] = [];
  const seenRefs = new Set<string>();
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
  let inboxUrl: URL;
  try {
    inboxUrl = new URL(input.inboxPath ?? CITIUS_INBOX_PATH, input.baseUrl ?? CITIUS_MANDATARIOS_BASE_URL);
  } catch {
    return fail('configuração inválida: URL da caixa de correio', 0);
  }
  const pageParam = input.pageParam ?? 'page';
  if (!PAGE_PARAM_RE.test(pageParam)) return fail('configuração inválida: parâmetro de página', 0);
  const allowedOrigins = (input.boundOrigins?.length
    ? input.boundOrigins
    : [originFromBaseUrl(inboxUrl.toString())].filter((h): h is string => Boolean(h)));
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
  let mode: 'get' | 'postback' | 'none' = 'get';
  // The html of the page we are currently ON — a postback for page N+1 is built from ITS hidden
  // state, which is the only thing a WebForms server will accept.
  let currentHtml = '';

  for (;;) {
    if (page > 1 && throttleMs > 0) await sleep(throttleMs);

    // ---- build the request. The URL is ALWAYS the configured inbox URL; only the page number and
    // ---- the (page-supplied, charset-checked) postback FIELDS vary. Nothing from the page is ever
    // ---- used as a destination.
    const requestUrl = new URL(inboxUrl.toString());
    let method: 'GET' | 'POST' = 'GET';
    let body: string | undefined;
    const headers: Record<string, string> = { ...BASE_HEADERS };

    if (page === 1 || mode === 'get') {
      if (page > 1) requestUrl.searchParams.set(pageParam, String(page));
    } else {
      const target = postbackTargetFor(currentHtml, page);
      if (!target) {
        pages.push({ page, outcome: 'refused', rows: 0, note: 'postback sem alvo reconhecível' });
        return partial('pager-unavailable');
      }
      const form = new URLSearchParams();
      for (const [name, value] of Object.entries(parseHiddenFields(currentHtml))) form.set(name, value);
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

    // The advertised count is the MAX across the walk: a WebForms pager renders the current page as
    // a label rather than a link, so page N's own markup can advertise FEWER pages than page 1's did.
    if (parsed.pageTotal !== undefined && parsed.pageTotal > (advertisedPageCount ?? 0)) {
      advertisedPageCount = parsed.pageTotal;
    }
    mode = detectPagingMode(html);
    currentHtml = html;

    // ---- next page? -------------------------------------------------------------------------------
    const next = page + 1;
    const hasNext = hasPageLink(html, next, mode, pageParam);
    if (!hasNext) {
      // Exhausted — unless the page itself says otherwise. Both checks are the SAFE direction: they
      // can only turn a "complete" into an "incomplete", never the reverse.
      if (advertisedPageCount !== undefined && advertisedPageCount > page) return partial('page-count-disagreement');
      if (NON_NUMERIC_PAGER_RE.test(html) || hasUndrivablePagerControl(html)) return partial('pager-unrecognised');
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
    page = next;
  }
}
