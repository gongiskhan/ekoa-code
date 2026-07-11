/**
 * Cookie-consent vendor chrome (ch05 §5.6.4). Unlike website-builder chrome it appears on ANY
 * site regardless of detected builder, and it POLLUTES every rendered signal: painted colours,
 * the visual-vibe screenshots, the header-strip logo ground truth (observed live 2026-07-11:
 * plmj.com's Cookiebot overlay covered the header, so the vision logo pick never saw the logo
 * and a team-portrait won), and the dembrandt palette sources.
 *
 * One shared token list + one in-page removal used by every rendered pass.
 */

/** Class/id fragments of the major consent-management vendors + generic banner names. */
export const CONSENT_CHROME_TOKENS = [
  'cybotcookiebot', 'cookiebot', 'onetrust', 'optanon', 'cookieyes', 'cc-window',
  'cc-banner', 'cc-compliance', 'didomi', 'usercentrics', 'cmplz', 'cookie-notice',
  'cookie-banner', 'cookie-consent', 'cookielaw', 'iubenda', 'termly',
] as const;

/** CSS selector matching any element whose id/class carries a consent-vendor token. */
const CONSENT_SELECTOR = CONSENT_CHROME_TOKENS.flatMap((tok) => [
  `[id*="${tok}" i]`,
  `[class*="${tok}" i]`,
]).join(', ');

/**
 * Remove consent-vendor chrome from the live page before sampling/screenshotting.
 * Best-effort and non-fatal; returns the number of elements removed.
 * `page` is typed loosely (the api tsconfig has no DOM lib; same pattern as
 * site-builder.ts stripBuilderChrome).
 */
export async function stripConsentChrome(page: { evaluate: (src: string) => Promise<unknown> }): Promise<number> {
  try {
    const removed = await page.evaluate(
      `(function () {
        var els = document.querySelectorAll(${JSON.stringify(CONSENT_SELECTOR)});
        var n = 0;
        for (var i = 0; i < els.length; i++) { els[i].remove(); n++; }
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        return n;
      })()`,
    );
    return typeof removed === 'number' ? removed : 0;
  } catch {
    return 0;
  }
}
