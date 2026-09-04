/**
 * services/cookie-jar.ts — a small, conservative HTTP cookie jar for multi-step server-side flows.
 *
 * WHY IT EXISTS. A form login is three requests that must share state: GET the login page (a portal
 * often sets a WAF/anti-bot cookie here), POST the credentials (the portal answers with a session
 * `Set-Cookie` on a 302), then fetch the target page carrying that session cookie. `fetch` keeps no
 * jar of its own, and the two guarded fetchers deliberately do not surface intermediate `Set-Cookie`
 * (see `guardedFetchManual`). This jar is the missing shared state.
 *
 * SAFETY POSTURE — it is used with CREDENTIAL-bearing requests, so it is deliberately strict:
 *   - Every cookie is scoped to the HOST that set it. A `Domain=` attribute is honoured ONLY when
 *     the setting host is that domain or a subdomain of it — so a page on `evil.example.com` cannot
 *     forge a `Domain=example.com` cookie, and a cookie never widens to an unrelated host.
 *   - A `Cookie` header is emitted ONLY for a request whose host the cookie scopes and whose path is
 *     at or under the cookie's path; a `Secure` cookie is withheld from an `http://` request.
 *   - It stores at most one value per (scope-host, path, name); a later `Set-Cookie` replaces it, and
 *     an expiry in the past (or `Max-Age<=0`) deletes it.
 *   - It does NOT consult a public-suffix list. Pair it with an origin binding (`credentialedFetch`
 *     / `assertOriginAllowed`) so the set of hosts it is ever driven against is already constrained.
 *
 * It parses cookies from the standard `Set-Cookie` header list (`Headers.getSetCookie()`), and
 * exposes them in a Playwright-`storageState`-shaped array so a downstream reader that already
 * consumes a browser session (e.g. the CITIUS notifications enumerator) can be fed unchanged.
 */

/** One stored cookie. `host` is the effective scope host (the Domain when honoured, else the set host). */
interface StoredCookie {
  name: string;
  value: string;
  host: string; // scope host, lowercased, no leading dot
  hostOnly: boolean; // true when no valid Domain was given (send to the exact host only)
  path: string;
  secure: boolean;
  expires: number; // epoch ms, or Infinity for a session cookie
}

/** Playwright `storageState.cookies[]`-shaped entry — the shape a browser-session reader expects. */
export interface JarCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
}

function nowMs(): number {
  return Date.now();
}

/** Default path for a request URL per RFC 6265 §5.1.4 (directory of the request path). */
function defaultPath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/';
  const lastSlash = pathname.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash);
}

/** RFC 6265 §5.1.4 path-match: request path equals the cookie path, or is a sub-path of it. */
function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

/** `host` is `scope` or a subdomain of it. Never a suffix-string match (evil-example.com !~ example.com). */
function domainMatches(host: string, scope: string): boolean {
  return host === scope || host.endsWith(`.${scope}`);
}

export class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  private static key(c: Pick<StoredCookie, 'host' | 'path' | 'name'>): string {
    return `${c.host}\n${c.path}\n${c.name}`;
  }

  /**
   * Absorb every `Set-Cookie` on a response received from `requestUrl`. Unparseable or
   * unsafely-scoped cookies are dropped, never widened.
   */
  absorbResponse(res: Response, requestUrl: string): void {
    // getSetCookie() returns the un-folded per-cookie list; fall back to a single combined header.
    const list: string[] =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
    for (const raw of list) this.absorbOne(raw, requestUrl);
  }

  /** Absorb one raw `Set-Cookie` header value. */
  absorbOne(raw: string, requestUrl: string): void {
    let reqHost: string;
    try {
      reqHost = new URL(requestUrl).hostname.toLowerCase();
    } catch {
      return;
    }
    const parts = raw.split(';');
    const first = (parts.shift() ?? '').trim();
    const eq = first.indexOf('=');
    if (eq <= 0) return; // no name, or an empty name — drop
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) return;

    let domainAttr: string | null = null;
    let path: string | null = null;
    let secure = false;
    let expires = Infinity;
    for (const attr of parts) {
      const seg = attr.trim();
      const i = seg.indexOf('=');
      const key = (i === -1 ? seg : seg.slice(0, i)).trim().toLowerCase();
      const val = i === -1 ? '' : seg.slice(i + 1).trim();
      if (key === 'domain') domainAttr = val.replace(/^\./, '').toLowerCase() || null;
      else if (key === 'path') path = val || null;
      else if (key === 'secure') secure = true;
      else if (key === 'max-age') {
        const secs = Number(val);
        if (Number.isFinite(secs)) expires = secs <= 0 ? 0 : nowMs() + secs * 1000;
      } else if (key === 'expires' && expires === Infinity) {
        const t = Date.parse(val);
        if (Number.isFinite(t)) expires = t;
      }
    }

    // Domain scoping: honour a Domain= only when the setting host is within it. Otherwise host-only.
    let host = reqHost;
    let hostOnly = true;
    if (domainAttr && domainMatches(reqHost, domainAttr)) {
      host = domainAttr;
      hostOnly = false;
    }
    const scopedPath = path && path.startsWith('/') ? path : defaultPath(new URL(requestUrl).pathname);
    const cookie: StoredCookie = { name, value, host, hostOnly, path: scopedPath, secure, expires };
    const k = CookieJar.key(cookie);
    if (expires <= nowMs() || value === '') {
      this.cookies.delete(k); // an expired/blanked cookie is a delete instruction
      return;
    }
    this.cookies.set(k, cookie);
  }

  /** The `Cookie` request-header value for `requestUrl`, or '' when no cookie is in scope. */
  header(requestUrl: string): string {
    let url: URL;
    try {
      url = new URL(requestUrl);
    } catch {
      return '';
    }
    const host = url.hostname.toLowerCase();
    const isHttps = url.protocol === 'https:';
    const now = nowMs();
    const matched: StoredCookie[] = [];
    for (const c of this.cookies.values()) {
      if (c.expires <= now) continue;
      if (c.secure && !isHttps) continue;
      const hostOk = c.hostOnly ? host === c.host : domainMatches(host, c.host);
      if (!hostOk) continue;
      if (!pathMatches(url.pathname || '/', c.path)) continue;
      matched.push(c);
    }
    // Longer paths first (RFC 6265 §5.4 ordering); ties are irrelevant for a single-value-per-name jar.
    matched.sort((a, b) => b.path.length - a.path.length);
    return matched.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  /** True when at least one live cookie is in scope for `requestUrl` (a cheap "has a session" probe). */
  hasAnyFor(requestUrl: string): boolean {
    return this.header(requestUrl).length > 0;
  }

  /** All live cookies, in the Playwright `storageState.cookies[]` shape (for a browser-session reader). */
  toStorageState(): JarCookie[] {
    const now = nowMs();
    const out: JarCookie[] = [];
    for (const c of this.cookies.values()) {
      if (c.expires <= now) continue;
      out.push({ name: c.name, value: c.value, domain: c.hostOnly ? c.host : `.${c.host}`, path: c.path, secure: c.secure });
    }
    return out;
  }
}
