/**
 * integrations/form-login.ts — a REUSABLE server-side HTML form login for integrations.
 *
 * WHAT IT IS. Given a portal's login-form description and a username/password stored (encrypted) for
 * an integration, it performs the classic multi-step web login entirely server-side and hands back a
 * cookie jar (and, optionally, the HTML of a target page fetched with that session):
 *
 *     GET login page  ->  read the hidden/anti-forgery fields (ASP.NET __VIEWSTATE / __EVENTVALIDATION,
 *                         or any framework's hidden inputs) and the form's POST target
 *     POST credentials -> username + password + every hidden field echoed verbatim + optional submit
 *                         button; capture the session `Set-Cookie` the portal sets ON the 302
 *     (follow the post-login redirect chain, carrying the jar, re-checking the origin binding each hop)
 *     GET target page  -> optional, with the session cookie, so the caller gets authenticated HTML
 *
 * WHY SERVER-SIDE HTTP AND NOT THE BROWSER. The browser/typist session-capture rail (ensureSession)
 * needs a human at a paired machine and a session that a portal expires in minutes. A stored-credential
 * HTTP login logs in and reads in ONE fast sequence with no human and no timing gap, which is what an
 * unattended poller needs. It is the right mechanism for any portal that accepts a plain username/
 * password FORM post (it is NOT a substitute for certificate / OTP / federated logins — those still
 * need the attended browser path).
 *
 * IT IS GENERIC. Nothing here is integration-specific: the whole login is driven by `FormLoginDescriptor`
 * (declared as reviewed package data, never model-authored). CITIUS/eTribunal (the Habilus username/
 * password `login.aspx`) is the first consumer; the same descriptor shape fits any form-login portal.
 * See docs/form-login.md.
 *
 * SECURITY POSTURE (non-negotiable, and asserted by the isolation suite):
 *   - The password NEVER reaches a model/prompt/URL/log. Every outward string (reasons, errors) is put
 *     through a run-scoped `SecretRegistry` that redacts the username and password; the credentials
 *     travel only in the POST body and the captured cookies never leave this module except as the
 *     opaque jar the caller stores encrypted.
 *   - Every request asserts an ORIGIN BINDING (`assertOriginAllowed`) before any byte or cookie is sent,
 *     regardless of the injected transport — a login POST / cookie can only travel to a host the
 *     credential is bound to. In production the transport is `guardedFetchManual`, which ALSO runs the
 *     SSRF guard; a redirect `Location` is never blindly followed to an unbound host.
 *   - AT MOST ONCE. A rejected password is a consumed attempt against portals with unknown lock-out
 *     policies, so there is no retry loop and success/failure classification is conservative (a 200
 *     re-render of the login form, or a declared failure marker, is treated as auth-failed).
 */
import { guardedFetchManual, type GuardedFetchOptions } from '../services/url-fetcher.js';
import { CookieJar, type JarCookie } from '../services/cookie-jar.js';
import { parseHiddenInputs, parseFormAction, looksLikeLoginForm } from '../services/portal-forms.js';
import { assertOriginAllowed } from '../security/origin-binding.js';
import { SecretRegistry, secretRegistryFromValues } from '../security/redaction.js';

/** A neutral, realistic UA — a bare fetch UA invites WAF friction. Not a secret; overridable. */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/** The reviewed description of a portal's login form. Declared as package data, never model-authored. */
export interface FormLoginDescriptor {
  /** The login page to GET (and the POST target, unless the page's own `<form action>` overrides it). */
  loginUrl: string;
  /** The form field NAME (not id) that carries the username, e.g. `ctl00$cph$txtUserName`. */
  usernameField: string;
  /** The form field NAME that carries the password, e.g. `ctl00$cph$txtUserPass`. */
  passwordField: string;
  /** Optional submit control name. An ASP.NET image button submits as `<name>.x`/`<name>.y`. */
  submitField?: string;
  /** How to submit the button: an image button (default) sends x/y coords; a plain button sends its value. */
  submitKind?: 'image' | 'button';
  /** Value for a plain submit button (ignored for an image button). */
  submitValue?: string;
  /** Constant extra fields to include in the POST (rarely needed; hidden fields are echoed automatically). */
  extraFields?: Record<string, string>;
  /** Login is OK when the final post-login URL contains this (e.g. the app landing path). */
  successUrlContains?: string;
  /** Login FAILED when the post response body contains this (e.g. a "credenciais inválidas" marker). */
  failureBodyContains?: string;
  /** Optional page to fetch after login; its HTML is returned when the session authenticates it. */
  targetUrl?: string;
  /** If the target GET's final URL contains this, the session did NOT cover the target (redirected to login). */
  targetLoginRedirectContains?: string;
  /** Redirect-follow ceiling for each leg. Default 5. */
  maxRedirects?: number;
  /** Override the request User-Agent. */
  userAgent?: string;
}

export type FormLoginStatus =
  | 'authenticated' // logged in; if a targetUrl was given, its HTML is included
  | 'authenticated-no-target' // logged in, but the session did not authenticate the target page
  | 'auth-failed' // the portal rejected the credentials (or presented a challenge) — do NOT retry
  | 'blocked' // a WAF / anti-bot layer refused the request (often a datacentre-IP block)
  | 'error'; // transport/parse failure before a verdict could be reached

export interface FormLoginResult {
  /** True when a usable session was established (`authenticated` or `authenticated-no-target`). */
  ok: boolean;
  status: FormLoginStatus;
  /** The URL the login flow ended on (redacted-safe: a portal URL, never a credential). */
  finalUrl: string;
  /** The session cookies, Playwright-`storageState`-shaped, for the caller to store encrypted / replay. */
  cookies: JarCookie[];
  /** When a targetUrl was fetched: its HTTP status and final URL. */
  targetStatus?: number;
  targetUrl?: string;
  /** The authenticated target-page HTML, present ONLY on `status: 'authenticated'` with a targetUrl. */
  targetHtml?: string;
  /** A short, SECRET-REDACTED explanation, for diagnostics. Never contains credentials. */
  reason?: string;
}

/** The manual, redirect-observing transport the runner drives. Default: the SSRF-guarded one. */
export type ManualFetch = (url: string, opts: GuardedFetchOptions) => Promise<Response>;

export interface PerformFormLoginOptions {
  /** Hosts the credential is bound to — REQUIRED and non-empty (from the Cofre item's boundOrigins). */
  allowedOrigins: string[];
  /** A run-scoped registry seeded with the credentials. Built from the credentials when omitted. */
  secrets?: SecretRegistry;
  /** Names the credential in a refusal/log message. */
  credentialLabel?: string;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  /**
   * The transport. Defaults to `guardedFetchManual` (full SSRF guard). Tests inject a loopback
   * transport to reach an in-process mock; the ORIGIN BINDING is asserted by the runner itself
   * BEFORE this is ever called, so a test transport cannot step around the binding.
   */
  fetchManual?: ManualFetch;
}

function failResult(status: FormLoginStatus, finalUrl: string, reason: string): FormLoginResult {
  return { ok: false, status, finalUrl, cookies: [], reason };
}

/**
 * Perform the form login. Never throws for an expected outcome (auth-failed / blocked / error are
 * returned as a typed result); only a programming error would throw.
 */
export async function performFormLogin(
  descriptor: FormLoginDescriptor,
  credentials: { username: string; password: string },
  opts: PerformFormLoginOptions,
): Promise<FormLoginResult> {
  // Fail closed on a missing/unbound binding BEFORE any work: an empty or wrong `allowedOrigins` is a
  // CALLER CONFIG ERROR (a mis-provisioned integration), not an auth outcome, so it throws the same
  // CredentialOriginError credentialedFetch throws (routes map it to HTTP 422) rather than being
  // swallowed into a status:'error' result. Per-request re-checks below still guard every redirect hop.
  assertOriginAllowed(descriptor.loginUrl, { allowedOrigins: opts.allowedOrigins, credentialLabel: opts.credentialLabel });

  const secrets = opts.secrets ?? secretRegistryFromValues([credentials.username, credentials.password]);
  const redact = (s: string): string => secrets.redact(s);
  const fetchManual = opts.fetchManual ?? guardedFetchManual;
  const maxRedirects = descriptor.maxRedirects ?? 5;
  const userAgent = descriptor.userAgent ?? DEFAULT_USER_AGENT;
  const jar = new CookieJar();

  // One request: assert the origin binding (always, before any byte), attach the jar's cookies, run
  // the transport, then absorb Set-Cookie. Returns the raw (possibly 3xx) Response.
  const request = async (
    url: string,
    init: { method: 'GET' | 'POST'; body?: string; contentType?: string },
  ): Promise<Response> => {
    assertOriginAllowed(url, { allowedOrigins: opts.allowedOrigins, credentialLabel: opts.credentialLabel });
    const headers: Record<string, string> = {
      'user-agent': userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    const cookie = jar.header(url);
    if (cookie) headers['cookie'] = cookie;
    if (init.contentType) headers['content-type'] = init.contentType;
    const res = await fetchManual(url, { method: init.method, body: init.body, headers, timeoutMs: opts.timeoutMs });
    jar.absorbResponse(res, url);
    return res;
  };

  // Follow a redirect chain by hand, carrying the jar; each hop re-guards via `request`.
  const follow = async (startRes: Response, startUrl: string): Promise<{ res: Response; url: string }> => {
    let res = startRes;
    let url = startUrl;
    for (let hop = 0; hop < maxRedirects && res.status >= 300 && res.status < 400; hop++) {
      const loc = res.headers.get('location');
      if (!loc) break;
      url = new URL(loc, url).toString();
      res = await request(url, { method: 'GET' });
    }
    return { res, url };
  };

  try {
    // 1) GET the login page (and follow to the real form if it redirects), absorbing any WAF cookie.
    const get0 = await request(descriptor.loginUrl, { method: 'GET' });
    if (get0.status === 403) return failResult('blocked', descriptor.loginUrl, redact('login page GET blocked (HTTP 403 — likely a WAF / datacentre-IP block)'));
    const { res: getRes, url: getUrl } = await follow(get0, descriptor.loginUrl);
    if (getRes.status >= 400) return failResult('error', getUrl, redact(`login page GET failed: HTTP ${getRes.status}`));
    const loginHtml = await getRes.text();

    // 2) Build the POST body: every hidden field echoed verbatim + username/password + submit + extras.
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(parseHiddenInputs(loginHtml))) body.set(k, v);
    body.set(descriptor.usernameField, credentials.username);
    body.set(descriptor.passwordField, credentials.password);
    if (descriptor.submitField) {
      if ((descriptor.submitKind ?? 'image') === 'image') {
        body.set(`${descriptor.submitField}.x`, '1');
        body.set(`${descriptor.submitField}.y`, '1');
      } else {
        body.set(descriptor.submitField, descriptor.submitValue ?? '');
      }
    }
    for (const [k, v] of Object.entries(descriptor.extraFields ?? {})) body.set(k, v);
    const action = parseFormAction(loginHtml);
    const postUrl = action ? new URL(action, getUrl).toString() : getUrl;

    // 3) POST credentials, SEE the 302 + its session Set-Cookie, then follow the chain carrying the jar.
    const post0 = await request(postUrl, {
      method: 'POST',
      body: body.toString(),
      contentType: 'application/x-www-form-urlencoded',
    });
    if (post0.status === 403) return failResult('blocked', postUrl, redact('credential POST blocked (HTTP 403 — likely a WAF / datacentre-IP block)'));
    const postWasRedirect = post0.status >= 300 && post0.status < 400;
    const { res: postRes, url: postUrlFinal } = await follow(post0, postUrl);
    const postHtml = await postRes.text();

    // 4) Classify — conservative, AT MOST ONCE. A 200 re-render of the login form = auth failed.
    const failedByMarker = Boolean(descriptor.failureBodyContains) && postHtml.includes(descriptor.failureBodyContains as string);
    const stillLogin = looksLikeLoginForm(postHtml);
    const successByUrl = descriptor.successUrlContains ? postUrlFinal.includes(descriptor.successUrlContains) : false;
    const looksAuthed = !stillLogin && postRes.status < 400;
    const authenticated =
      !failedByMarker && (successByUrl || (postWasRedirect && looksAuthed) || (looksAuthed && !descriptor.successUrlContains));
    if (!authenticated) {
      return failResult('auth-failed', postUrlFinal, redact('login rejected: credentials not accepted or a challenge was presented'));
    }

    // 5) Optionally fetch a target page with the session; detect a session that does not cover it.
    if (descriptor.targetUrl) {
      const t0 = await request(descriptor.targetUrl, { method: 'GET' });
      const { res: tRes, url: tUrl } = await follow(t0, descriptor.targetUrl);
      const tHtml = await tRes.text();
      const redirectedToLogin =
        looksLikeLoginForm(tHtml) ||
        Boolean(descriptor.targetLoginRedirectContains) && tUrl.includes(descriptor.targetLoginRedirectContains as string);
      if (redirectedToLogin) {
        return {
          ok: true,
          status: 'authenticated-no-target',
          finalUrl: postUrlFinal,
          cookies: jar.toStorageState(),
          targetStatus: tRes.status,
          targetUrl: tUrl,
          reason: redact('logged in, but the session did not authenticate the target page (redirected to login)'),
        };
      }
      return {
        ok: true,
        status: 'authenticated',
        finalUrl: postUrlFinal,
        cookies: jar.toStorageState(),
        targetStatus: tRes.status,
        targetUrl: tUrl,
        targetHtml: tHtml,
      };
    }

    return { ok: true, status: 'authenticated', finalUrl: postUrlFinal, cookies: jar.toStorageState() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failResult('error', descriptor.loginUrl, redact(`form login transport error: ${msg}`));
  }
}
