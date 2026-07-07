/**
 * LocalBrowserSession — in-process BrowserSession fallback for dev (and any
 * deployment without a local ekoa daemon).
 *
 * The executor face (browser-session.ts) normally dispatches resolved
 * PlaywrightActions to the external ekoa-local daemon. When no daemon is dialed
 * in, the engine would otherwise halt every browser step in `awaiting_daemon`.
 * This session implements the SAME BrowserSession interface against a local
 * Playwright page (the persistent per-owner stealth context from
 * automation-browser.ts), running actions through the intact page-level runner
 * `executor.ts` and capturing the post-action observation (screenshot +
 * fingerprint + a11y) exactly like the daemon's observation envelope — so cached
 * actions resolve identically whether they run here or on the daemon.
 *
 * Gated by config.automationLocalBrowser (default ON in dev / OFF in prod), so
 * production keeps the daemon model unchanged.
 */

import type { Page } from 'playwright';
import type { BrowserSession } from './browser-session.js';
import type { PlaywrightAction, PlaywrightAssertion, PageFingerprint } from './types.js';
import { executePlaywrightAction, executePlaywrightAssertion } from './executor.js';
import { computePageFingerprint, fingerprintFromParts } from './fingerprint.js';
import { getLocalBrowserContext as getAutomationBrowserContext } from './seams.js';

/**
 * Minimal cookie shape accepted by `BrowserContext.addCookies`. We validate
 * leniently — the payload crosses the credential boundary as opaque data,
 * so we guard each field instead of trusting the shape.
 */
interface SessionCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  url?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Extract the cookie list from a captured browser session payload.
 *
 * Accepts BOTH shapes the integration layer may hand over as
 * `inputs.credentials.storageState`:
 *   - a raw Playwright storageState: `{ cookies: [...], origins: [...] }`
 *   - the CapturedStorageState wrapper from integration-session-capture.ts:
 *     `{ storageState: { cookies: [...] }, capturedAt: "..." }`
 *
 * Returns null when no usable cookie list exists. Entries missing the
 * fields addCookies needs (name/value + domain-or-url) are dropped rather
 * than failing the whole injection — best-effort by contract. Cookie
 * VALUES are never logged by any caller of this helper.
 */
export function extractSessionCookies(raw: unknown): SessionCookie[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const inner = obj.storageState && typeof obj.storageState === 'object'
    ? (obj.storageState as Record<string, unknown>)
    : obj;
  const cookies = inner.cookies;
  if (!Array.isArray(cookies)) return null;
  const usable: SessionCookie[] = [];
  for (const c of cookies) {
    if (!c || typeof c !== 'object') continue;
    const cookie = c as Record<string, unknown>;
    if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string') continue;
    if (typeof cookie.domain !== 'string' && typeof cookie.url !== 'string') continue;
    usable.push(cookie as unknown as SessionCookie);
  }
  return usable;
}

export class LocalBrowserSession implements BrowserSession {
  private readonly ownerUserId: string;
  /**
   * Captured browser session for this run (`inputs.credentials.storageState`,
   * passed by the engine when an integration action launched the run with
   * `passCredentials`). Opaque and SECRET: never logged, never surfaced in
   * errors, consumed only by injectSessionState below. Undefined for runs
   * without a session credential.
   */
  private readonly sessionState: unknown;
  private sessionInjectAttempted = false;
  private page: Page | null = null;
  // Single-flight page creation so concurrent first-use can't open (and leak) two.
  private pagePromise: Promise<Page> | null = null;
  private lastScreenshotB64 = '';
  private lastFingerprint: PageFingerprint | null = null;
  private lastUrl = 'about:blank';
  private lastA11y: string | undefined;
  private observed = false;

  constructor(opts: { runId: string; ownerUserId: string; sessionState?: unknown }) {
    this.ownerUserId = opts.ownerUserId;
    this.sessionState = opts.sessionState;
  }

  // One page PER SESSION (per run), opened in the owner's persistent context.
  // Concurrent runs for the same owner each get their own page (Playwright
  // contexts hold many pages) — they share cookies/consent but never the page,
  // so their navigation/actions can't interleave. Closed in dispose().
  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.pagePromise) {
      this.pagePromise = (async () => {
        const ctx = await getAutomationBrowserContext(this.ownerUserId);
        // Cookies must land BEFORE the page opens / the first navigation, so
        // the very first request already carries the captured session.
        await this.injectSessionState(ctx);
        const page = await ctx.newPage();
        this.page = page;
        return page;
      })().catch((err) => { this.pagePromise = null; throw err; });
    }
    return this.pagePromise;
  }

  /**
   * Best-effort injection of the captured session cookies into the run's
   * browser context. Non-fatal on malformed input: a bad payload degrades
   * to the semi-attended flow (the verify step pauses for a manual login)
   * instead of failing the run. Logs NEVER include cookie names or values
   * — only counts. localStorage `origins` seeding is explicitly out of
   * scope for now: it requires an origin-scoped page evaluation before the
   * real navigation, which the per-step engine loop doesn't support yet.
   */
  private async injectSessionState(ctx: Awaited<ReturnType<typeof getAutomationBrowserContext>>): Promise<void> {
    if (this.sessionState === undefined || this.sessionInjectAttempted) return;
    this.sessionInjectAttempted = true;
    const cookies = extractSessionCookies(this.sessionState);
    if (!cookies || cookies.length === 0) {
      if (this.sessionState !== null) {
        console.warn('[automation] captured session has no usable cookies — continuing without injection');
      }
      return;
    }
    try {
      await ctx.addCookies(cookies as Parameters<typeof ctx.addCookies>[0]);
    } catch {
      // Deliberately message-free: Playwright's addCookies error can quote
      // the offending cookie, and cookie material must never reach a log.
      console.warn(`[automation] session cookie injection failed (${cookies.length} cookie(s)) — continuing without injection`);
    }
  }

  async dispose(): Promise<void> {
    const page = this.page;
    this.page = null;
    this.pagePromise = null;
    if (page && !page.isClosed()) await page.close().catch(() => { /* best-effort */ });
  }

  async act(action: PlaywrightAction): Promise<void> {
    if (action.kind === 'noop') return;
    const page = await this.ensurePage();
    await executePlaywrightAction(page, action);
    await this.capture(page);
  }

  async assert(assertion: PlaywrightAssertion): Promise<true> {
    const page = await this.ensurePage();
    const result = await executePlaywrightAssertion(page, assertion);
    await this.capture(page);
    return result;
  }

  async observe(): Promise<void> {
    await this.capture(await this.ensurePage());
  }

  async ensureObserved(): Promise<void> {
    if (!this.observed) await this.observe();
  }

  hasObservation(): boolean { return this.observed; }
  screenshotPng(): Buffer { return Buffer.from(this.lastScreenshotB64, 'base64'); }
  screenshotB64(): string { return this.lastScreenshotB64; }
  url(): string { return this.lastUrl; }

  fingerprint(): PageFingerprint {
    return this.lastFingerprint ?? fingerprintFromParts({
      url: this.lastUrl, title: '', headingText: '', shapeSketch: 'tags:|roles:|landmarks:0', viewport: { w: 0, h: 0 },
    });
  }

  accessibilitySnapshot(): string | undefined { return this.lastA11y; }

  private async capture(page: Page): Promise<void> {
    try {
      const shot = await page.screenshot({ type: 'png' }).catch(() => null);
      if (shot) this.lastScreenshotB64 = shot.toString('base64');
      this.lastFingerprint = await computePageFingerprint(page).catch(() => this.lastFingerprint);
      this.lastUrl = page.url();
      // a11y outline is left undefined in-process (the rehearsal fixer degrades
      // gracefully when absent, same as a daemon observation that omits it).
    } finally {
      this.observed = true;
    }
  }
}
