/**
 * tools/tier2/browser.ts — the Tier-2 `browser` tool (ADR-002, build-only). A FIXED, minimal browser
 * vocabulary over Playwright chromium: navigate to a URL and read the page title / visible text. It is
 * exfiltration-capable by nature (a browser can POST anywhere), so — like bash — it is gated behind
 * per-session enablement, ledgered with the navigation target, never reachable from a file-tier
 * delegation, and excluded from every claim + the custody map.
 *
 * Bounds: a navigation timeout, headless always, and the browser is launched + closed per call (no
 * long-lived session state this run). This is BUILD-ONLY: one smoke test proves the round trip; the
 * tier is not evidence-validated and makes no confidentiality claim.
 */
import { ledgerAutomation, Tier2Error, type Tier2Context } from './context.js';

const DEFAULT_NAV_TIMEOUT_MS = 30_000;

export interface BrowseOptions {
  timeoutMs?: number;
}

export interface BrowseResult {
  url: string;
  title: string;
  /** The page's visible text, truncated (build-only; not egress-metered — this tier is uncontained). */
  text: string;
}

const TEXT_CAP = 100_000;

export async function browse(ctx: Tier2Context, url: string, opts: BrowseOptions = {}): Promise<BrowseResult> {
  // Enablement gate (ADR-002): OFF by default; a disabled session is refused + ledgered.
  if (!ctx.enablement.isEnabled(ctx.session)) {
    ledgerAutomation(ctx, 'browser', url, 'denied', undefined, 'automation tier not enabled for this session');
    throw new Tier2Error('automation tier not enabled for this session', 'disabled');
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_NAV_TIMEOUT_MS;
  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    // A launch failure (e.g. the chromium binary is not installed) is ledgered as an error and
    // surfaced as a Tier2Error, so callers/tests can classify it — never a raw Playwright throw.
    ledgerAutomation(ctx, 'browser', url, 'error', undefined, err instanceof Error ? err.message : String(err));
    throw new Tier2Error(`browser launch failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
  try {
    const page = await browser.newPage();
    await page.goto(url, { timeout: timeoutMs, waitUntil: 'load' });
    const title = await page.title();
    // String form of evaluate: the code runs in the BROWSER context, so `document` must not be
    // typechecked against the Node lib (the daemon has no DOM lib). Cast the unknown result.
    const rawText = (await page.evaluate('document.body ? document.body.innerText : ""')) as string;
    const text = rawText.slice(0, TEXT_CAP);
    ledgerAutomation(ctx, 'browser', url, 'ran');
    return { url, title, text };
  } catch (err) {
    ledgerAutomation(ctx, 'browser', url, 'error', undefined, err instanceof Error ? err.message : String(err));
    throw new Tier2Error(`navigation failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
  } finally {
    await browser.close();
  }
}
