/**
 * browser/inject.ts - replay ONE learned call INSIDE the authenticated page (slice P2.3, trap T3).
 *
 * ── WHY IN THE PAGE, AND NOT FROM NODE ───────────────────────────────────────────────────────
 *
 * A compiled recipe's `injectedCalls` are the private API the site's own UI already talks to. The
 * cheapest correct way to speak it again is to let the site's own JavaScript context make the
 * request: `fetch(..., {credentials:'include'})` running in the page inherits the origin, the cookie
 * jar including HttpOnly and SameSite=Strict cookies, the TLS session, and the IP. A bare Node
 * request from Cortex inherits NONE of those - a same-origin XHR becomes a cross-origin one (CORS
 * refuses it), SameSite cookies are simply not sent, and the request arrives from a datacenter with
 * a different TLS fingerprint. That is not a slower path; it is a path that returns 401 on any site
 * worth automating. Node HTTP stays available for permissive origins that need none of it, and it
 * is the SECOND choice for exactly that reason (`automation/executors/injected-call.ts` owns the
 * ordering).
 *
 * ── VALUES ARE READ HERE, NEVER STORED ANYWHERE ──────────────────────────────────────────────
 *
 * The frame from Cortex carries header NAMES. The values are read from the recorder's live map
 * (`capture.ts`) at the moment of the call and interpolated into the script that runs in the page -
 * which is where they came from in the first place. They exist in this process for the duration of
 * one call and in the recorder for the duration of one lease. Nothing about them is written down,
 * and the RESULT this function returns carries response header NAMES only, on the same terms.
 */
import type { LocalBrowserInjectedCall, LocalBrowserInjectedCallResult } from '@ekoa/shared';
import type { ProfilePage } from './types.js';

/** Cap on the body handed back to Cortex. It becomes a step output and, on a drift, a model prompt. */
export const MAX_INJECTED_BODY_CHARS = 256 * 1024;

const DEFAULT_TIMEOUT_MS = 20_000;

/** Header names a replay may NEVER set from the machine's live map, because the browser owns them
 *  and a forged one either breaks the request or defeats the very inheritance this path exists for.
 *  `cookie` is the important one: it arrives automatically from the jar, and setting it by hand
 *  would replace the live session with a remembered one. */
const BROWSER_OWNED_HEADERS: ReadonlySet<string> = new Set([
  'cookie', 'cookie2', 'host', 'connection', 'content-length', 'origin', 'referer',
  'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user', 'user-agent',
  'accept-encoding', 'transfer-encoding', 'upgrade', 'via', 'keep-alive', 'te', 'trailer',
]);

export class InjectedCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InjectedCallError';
  }
}

/** Which of the requested names the machine may actually forward. Exported so the unit lane can
 *  pin the browser-owned set without reaching through a page. */
export function forwardableHeaderNames(names: readonly string[]): string[] {
  return names.map((n) => n.toLowerCase()).filter((n) => !BROWSER_OWNED_HEADERS.has(n));
}

/**
 * Run one injected call. `resolveHeaderValues` is the recorder's live map, injected rather than
 * imported so a lease with no capture armed simply forwards nothing (and the site's cookie-borne
 * session still carries the request).
 */
export async function runInjectedCall(
  page: ProfilePage,
  call: LocalBrowserInjectedCall,
  resolveHeaderValues: (origin: string, names: readonly string[]) => Record<string, string>,
): Promise<LocalBrowserInjectedCallResult> {
  let origin: string;
  try {
    origin = new URL(call.url).origin;
  } catch {
    throw new InjectedCallError('injected call url is not absolute');
  }

  const names = forwardableHeaderNames(call.headerNames);
  const headers: Record<string, string> = { ...resolveHeaderValues(origin, names) };
  if (call.contentType !== undefined && call.body !== undefined) headers['content-type'] = call.contentType;

  const request = {
    url: call.url,
    method: call.method.toUpperCase(),
    headers,
    body: call.body ?? null,
    timeoutMs: call.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    cap: MAX_INJECTED_BODY_CHARS,
  };

  // String-form evaluate: the daemon compiles with `lib: ES2022` and has no DOM types, and
  // `ProfilePage.evaluate` deliberately takes only a string so the fake page in the unit lane can
  // answer it. The request rides as a JSON literal - never as concatenated code.
  const script = `(async () => { const req = ${JSON.stringify(request)};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
  try {
    const init = { method: req.method, headers: req.headers, credentials: 'include', signal: ctrl.signal };
    if (req.body !== null && req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body;
    const res = await fetch(req.url, init);
    const text = await res.text();
    const names = [];
    res.headers.forEach((_v, k) => { names.push(k); });
    return JSON.stringify({
      status: res.status,
      ok: res.ok,
      bodyText: text.length > req.cap ? text.slice(0, req.cap) : text,
      truncated: text.length > req.cap,
      contentType: res.headers.get('content-type') || undefined,
      responseHeaderNames: names,
    });
  } catch (e) {
    return JSON.stringify({ failed: (e && e.message) ? String(e.message) : String(e) });
  } finally {
    clearTimeout(timer);
  }
})()`;

  const raw = await page.evaluate(script);
  if (typeof raw !== 'string') {
    throw new InjectedCallError('the page did not answer the injected call');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InjectedCallError('the injected call answered a non-JSON envelope');
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  if (typeof obj.failed === 'string') {
    // The page's own failure text, verbatim. It goes through the outbound redactor before it leaves
    // the machine, and it never quotes a response body.
    throw new InjectedCallError(`the injected call failed in the page: ${obj.failed}`);
  }
  if (typeof obj.status !== 'number' || typeof obj.bodyText !== 'string') {
    throw new InjectedCallError('the injected call answered an envelope this daemon does not understand');
  }
  return {
    status: obj.status,
    ok: obj.ok === true,
    bodyText: obj.bodyText,
    responseHeaderNames: Array.isArray(obj.responseHeaderNames)
      ? obj.responseHeaderNames.filter((n): n is string => typeof n === 'string').map((n) => n.toLowerCase()).sort()
      : [],
    ...(typeof obj.contentType === 'string' ? { contentType: obj.contentType.split(';')[0]?.trim() ?? obj.contentType } : {}),
    ...(obj.truncated === true ? { truncated: true } : {}),
  };
}
