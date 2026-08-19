/**
 * THE INHERITANCE PROOF for the in-page replay (slice P2.3, trap T3) - REAL Chromium, REAL server.
 *
 * ── WHY THIS SUITE EXISTS AND WHY A FAKE PAGE CANNOT REPLACE IT ──────────────────────────────
 *
 * The whole argument for CDP call-injection is that the call executes INSIDE the authenticated page
 * and therefore inherits its cookie jar, its origin and its SameSite context. Every other test of
 * this path drives a fake `ProfilePage` whose `evaluate` returns a canned envelope - which pins the
 * envelope handling and pins NOTHING about inheritance, because no fetch ever happens. The first
 * cut of this module shipped a replay that ran from a blank page in a freshly-acquired profile, all
 * of its unit tests green, inheriting nothing: a slower Node fetch wearing a browser costume.
 *
 * So this suite asserts on WHAT THE SERVER RECEIVED. The fixture below refuses any request that
 * does not carry BOTH halves of the session, and the assertions read the recorded request headers -
 * not that `goto` was called, not that a code path was taken.
 *
 * ── THE A/B THAT MAKES IT FALSIFIABLE ────────────────────────────────────────────────────────
 *
 * A positive alone would be satisfied by a Node fetch that happened to attach a cookie. So each
 * property is proved against its own control, on the same browser, the same context and the same
 * jar, differing in one thing:
 *
 *   COOKIES  - the control issues the identical credentialed fetch from `about:blank` (which is what
 *              this module did before `ensureOriginForCall`). `about:blank` is an OPAQUE origin, so
 *              the request is cross-site: the SameSite=Strict session cookie is not attached. The
 *              real path navigates first and the same cookie rides.
 *   HEADERS  - the recipe carries the NAME `x-csrf-token` and no value, and the value is never
 *              written down anywhere in this file's call. It can only come from the live map the
 *              recorder filled by watching the site's OWN boot traffic after the navigation.
 *
 * ── WHAT IS NOT FAKED HERE ───────────────────────────────────────────────────────────────────
 *
 * `runInjectedCall` and `NetworkRecorder` are the production functions, unwrapped. The page is a
 * real Playwright page over a real Chromium; a Playwright `Page` satisfies `ProfilePage`
 * structurally, which is the same seam `profile.ts`'s default launcher casts at.
 *
 * HEADLESS, deliberately, and it is not a weakening: what is under test is the origin of the fetch
 * and the contents of a cookie jar, neither of which a window has any bearing on. The headed launch
 * is `ProfileManager`'s concern and is live verification.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInjectedCall } from '../../src/browser/inject.js';
import { NetworkRecorder, type CapturePage } from '../../src/browser/capture.js';
import type { ProfileContext, ProfilePage } from '../../src/browser/types.js';

/** The session cookie the portal set when the human signed in. HttpOnly + SameSite=Strict: the two
 *  properties a Node fetch and a cross-site fetch respectively cannot reproduce. */
const SESSION_COOKIE = 'ekoa-session-proof';
/** The header value the site's own JavaScript sends. It appears in the FIXTURE and in the assertion
 *  of what the server saw - never in the call this suite makes, which carries the NAME only. */
const LIVE_CSRF = 'csrf-live-value-9f3a';

let server: Server;
let origin: string;
let received: Array<{ path: string; cookie: string; csrf: string }> = [];

function startFixture(): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    received.push({
      path: url.pathname,
      cookie: req.headers.cookie ?? '',
      csrf: (req.headers['x-csrf-token'] as string | undefined) ?? '',
    });

    if (url.pathname === '/') {
      // The portal's own page. Its inline script is the site authenticating itself and calling its
      // private API - which is the ONLY place the live value of `x-csrf-token` is ever observable.
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><title>Portal</title><body>processos</body><script>
           fetch('/api/session-probe', { headers: { 'x-csrf-token': ${JSON.stringify(LIVE_CSRF)} } });
         </script>`,
      );
      return;
    }
    if (url.pathname === '/api/session-probe') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (url.pathname === '/api/cases') {
      // BOTH HALVES OR NOTHING. The cookie proves the jar was inherited; the header proves the
      // learned name was filled from the live session.
      const hasCookie = (req.headers.cookie ?? '').includes(`sid=${SESSION_COOKIE}`);
      const hasCsrf = req.headers['x-csrf-token'] === LIVE_CSRF;
      if (!hasCookie || !hasCsrf) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthenticated', hasCookie, hasCsrf }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"items":[{"id":41}],"total":1}');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('no');
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    }),
  );
}

let context: ProfileContext | null = null;
let userDataDir = '';
/** Set when Chromium is genuinely unavailable in this environment (the same honest skip the other
 *  browser smokes in this workspace take). Never used to swallow a real failure. */
let unavailable = '';

beforeAll(async () => {
  await startFixture();
  userDataDir = mkdtempSync(join(tmpdir(), 'ekoa-inject-proof-'));
  try {
    const { chromium } = await import('playwright');
    context = (await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      viewport: { width: 1280, height: 800 },
    })) as unknown as ProfileContext;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Executable doesn't exist|launch failed|install/i.test(msg)) unavailable = msg;
    else throw err;
  }
  if (context) {
    // The signed-in session, as the Cofre would have injected it. SameSite=Strict is the point:
    // it is exactly the cookie a cross-site request does not get.
    await context.addCookies([
      { name: 'sid', value: SESSION_COOKIE, url: origin, httpOnly: true, sameSite: 'Strict' },
    ]);
  }
}, 90_000);

afterAll(async () => {
  await context?.close().catch(() => undefined);
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The requests the fixture actually served for one path. */
const hits = (path: string) => received.filter((r) => r.path === path);

describe('the in-page replay genuinely executes in the authenticated session', () => {
  it('carries the jar\'s SameSite=Strict cookie AND the live value of the learned header name', async () => {
    if (unavailable) return; // chromium not installed here; the assertions below need a real one
    received = [];
    const page = (await context!.newPage()) as ProfilePage;

    // ── THE CONTROL: the pre-fix behaviour, on the same page, same jar, same browser. ─────────
    // A credentialed fetch issued from `about:blank`. This is precisely the request the first cut
    // sent, and it is what "runs inside the authenticated page" has to be measured against.
    expect(page.url()).toBe('about:blank');
    await page.evaluate(
      `fetch(${JSON.stringify(`${origin}/api/cases`)}, { credentials: 'include' }).then(() => 1, () => 0)`,
    );
    const fromBlank = hits('/api/cases');
    // Either the request never left (CORS refused a credentialed cross-origin send) or it arrived
    // stripped. BOTH are "inherited nothing"; what must never happen is it arriving authenticated.
    for (const hit of fromBlank) {
      expect(hit.cookie, 'a cross-site fetch must not carry the SameSite=Strict session').not.toContain(SESSION_COOKIE);
    }

    // ── THE REAL PATH. Same page. The recorder is armed BEFORE the call, exactly as ───────────
    // `runInjectedCallOp` arms it, so the navigation `runInjectedCall` performs is observed.
    received = [];
    const recorder = new NetworkRecorder({ buffer: false });
    recorder.attach(page as unknown as CapturePage);

    const result = await runInjectedCall(
      page,
      // THE RECIPE, as it is actually stored: a URL and header NAMES. No value anywhere.
      { method: 'GET', url: `${origin}/api/cases`, headerNames: ['x-csrf-token'] },
      (o, names) => recorder.headerValuesFor(o, names),
    );

    // The server answered 200, which it only does when BOTH halves arrived.
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.bodyText)).toEqual({ items: [{ id: 41 }], total: 1 });

    // …and here is the proof itself, read off what the SERVER received.
    const replayed = hits('/api/cases');
    expect(replayed).toHaveLength(1);
    expect(replayed[0]!.cookie, 'the replay must inherit the page\'s cookie jar').toContain(`sid=${SESSION_COOKIE}`);
    expect(replayed[0]!.csrf, 'the learned NAME must be filled from the live session').toBe(LIVE_CSRF);

    // The value was never in the call this test made - it came from the site's own boot traffic.
    expect(hits('/api/session-probe').length).toBeGreaterThan(0);

    await page.close();
  }, 90_000);

  it('refuses rather than sending from a page that could not reach the origin', async () => {
    if (unavailable) return;
    received = [];
    const page = (await context!.newPage()) as ProfilePage;
    // A port nothing is listening on: the navigation fails, so there is no authenticated page to
    // run in. The honest outcome is a named refusal - NOT a request sent from wherever the page is,
    // which is what would silently inherit nothing.
    await expect(
      runInjectedCall(
        page,
        { method: 'GET', url: 'http://127.0.0.1:1/api/cases', headerNames: [] },
        () => ({}),
      ),
    ).rejects.toThrow(/could not open/i);
    expect(received).toEqual([]);
    await page.close();
  }, 60_000);
});
