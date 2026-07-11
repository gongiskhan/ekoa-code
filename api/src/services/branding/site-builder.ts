/**
 * Site-builder chrome detection + suppression for brand research (ch05 §5.6.4).
 *
 * Free-tier website builders (Webnode, Wix, Squarespace, Weebly, WordPress.com,
 * ...) inject their OWN promotional chrome into every hosted page: a fixed
 * "Create your website" stripe in the builder's brand color, a "Powered by X"
 * footer credit, a default favicon that is the builder's own logo. None of that
 * is the site owner's brand - but the four signal sources (rendered color
 * sampling, dembrandt design-system, visual-vibe screenshots, logo extraction)
 * happily capture it, and on a minimalist owner site the builder's saturated
 * stripe is often the ONLY non-neutral color on the page, so it wins
 * `primaryColor` outright.
 *
 * This module:
 *   1. Detects the builder from the final URL host + `<meta generator>`.
 *   2. Strips the builder's injected chrome from a live Playwright page BEFORE
 *      colors/fonts/screenshots are sampled - and, crucially, DISCOVERS the
 *      chrome's colors/fonts from the page itself (no hardcoded hex blocklist),
 *      so callers can also scrub the same values out of the subprocess-based
 *      dembrandt output and the raw-CSS scan.
 *   3. Flags assets served from the builder's own marketing/CDN hosts so a
 *      default favicon can't be mistaken for the owner's logo.
 *
 * The strip is color-agnostic and self-updating: it removes the DOM the builder
 * injected and reads whatever colors/fonts that DOM used, so a builder changing
 * its brand blue next year needs no code change here.
 */

import type { Page } from 'playwright';

export interface SiteBuilder {
  id: string;
  name: string;
  /** Final-URL host patterns that mean the site is hosted ON this builder. */
  hostPatterns: RegExp[];
  /** `<meta name="generator">` content patterns. */
  generatorPatterns: RegExp[];
  /**
   * Host patterns for the builder's own MARKETING site (where its "create your
   * website" promo links point and its default logo/favicon lives). Used to
   * (a) identify injected promo links to strip, and (b) reject a default
   * favicon/logo served from the builder itself.
   *
   * CRITICAL: a match is only treated as chrome when the host ALSO differs from
   * the site's own host (see `isBuilderPromoAsset` / the in-page strip). Free
   * builder sites live UNDER the builder's domain (e.g. the owner site is
   * `marilia.webnode.pt`), so a pattern like `webnode.` matches the owner host
   * too - the different-host guard is what keeps the owner's own internal links
   * and same-host uploads from being mistaken for the builder's promo chrome.
   * List MARKETING domains only, never the per-site content CDN (owner uploads).
   */
  promoHostPatterns: RegExp[];
  /**
   * Precise CSS selectors for the builder's injected chrome. Optional - the
   * generic "positioned banner containing a promo-host link" rule catches most
   * builders without needing exact selectors, but naming the known containers
   * makes stripping robust against oddly-positioned or non-linked chrome.
   */
  chromeSelectors: string[];
}

/**
 * The builders we recognize. Ordered most-specific-host first. Adding a new
 * builder is a data change: give it host/generator/promo patterns and, if you
 * know them, its chrome selectors.
 */
export const SITE_BUILDERS: SiteBuilder[] = [
  {
    id: 'webnode',
    name: 'Webnode',
    hostPatterns: [/\.webnode\.[a-z.]+$/i],
    generatorPatterns: [/webnode/i],
    promoHostPatterns: [/(^|\.)webnode\.[a-z.]+$/i],
    chromeSelectors: ['.wnd-free-stripe', '[class*="wnd-free-stripe"]', '.wnd-editor-bar'],
  },
  {
    id: 'wix',
    name: 'Wix',
    hostPatterns: [/\.wixsite\.com$/i, /\.editorx\.io$/i, /\.wix\.com$/i],
    generatorPatterns: [/wix\.com/i],
    promoHostPatterns: [/(^|\.)wix\.com$/i],
    chromeSelectors: ['#WIX_ADS', '[id*="wixAds"]', '[data-testid="wixBannerContainer"]', '#bannerAds'],
  },
  {
    id: 'squarespace',
    name: 'Squarespace',
    hostPatterns: [/\.squarespace\.com$/i],
    generatorPatterns: [/squarespace/i],
    promoHostPatterns: [/(^|\.)squarespace\.com$/i],
    chromeSelectors: ['.sqs-announcement-bar-dropzone-wrapper[data-test="announcement"]'],
  },
  {
    id: 'weebly',
    name: 'Weebly',
    hostPatterns: [/\.weebly\.com$/i, /\.weeblysite\.com$/i],
    generatorPatterns: [/weebly/i],
    promoHostPatterns: [/(^|\.)weebly\.com$/i, /(^|\.)weeblysite\.com$/i],
    chromeSelectors: ['#footer-banner', '.weebly-footer', '.wsite-footer-banner'],
  },
  {
    id: 'wordpress-com',
    name: 'WordPress.com',
    hostPatterns: [/\.wordpress\.com$/i, /\.home\.blog$/i],
    generatorPatterns: [/wordpress\.com/i],
    promoHostPatterns: [/(^|\.)wordpress\.com$/i],
    chromeSelectors: ['#wpadminbar', '.wpcom-actionbar', '#actionbar'],
  },
  {
    id: 'jimdo',
    name: 'Jimdo',
    hostPatterns: [/\.jimdofree\.com$/i, /\.jimdosite\.com$/i, /\.jimdo\.com$/i],
    generatorPatterns: [/jimdo/i],
    promoHostPatterns: [/(^|\.)jimdo(free|site)?\.com$/i],
    chromeSelectors: ['.cc-jimdo', '.powered-by-jimdo', '[class*="jimdo-footer"]'],
  },
  {
    id: 'godaddy',
    name: 'GoDaddy Website Builder',
    hostPatterns: [/\.godaddysites\.com$/i],
    generatorPatterns: [/godaddy (website builder|websites)/i],
    promoHostPatterns: [/(^|\.)godaddy\.com$/i],
    chromeSelectors: [],
  },
  {
    id: 'strikingly',
    name: 'Strikingly',
    hostPatterns: [/\.mystrikingly\.com$/i, /\.strikingly\.com$/i],
    generatorPatterns: [/strikingly/i],
    promoHostPatterns: [/(^|\.)strikingly\.com$/i],
    chromeSelectors: ['#strikingly-footer-banner', '.strikingly-footer-banner'],
  },
  {
    id: 'google-sites',
    name: 'Google Sites',
    hostPatterns: [/^sites\.google\.com$/i],
    generatorPatterns: [],
    promoHostPatterns: [/(^|\.)sites\.google\.com$/i],
    chromeSelectors: [],
  },
  {
    id: 'carrd',
    name: 'Carrd',
    hostPatterns: [/\.carrd\.co$/i],
    generatorPatterns: [/carrd/i],
    promoHostPatterns: [/(^|\.)carrd\.co$/i],
    chromeSelectors: ['#branding', '.branding'],
  },
];

/**
 * Detect the builder a site is hosted on, from its final URL host and the
 * `<meta name="generator">` value. Returns null for a normal (self-hosted or
 * agency-built) site - the strip is only applied when a builder is detected, so
 * a normal site that happens to link to wix.com is never touched.
 */
export function detectSiteBuilder(finalUrl: string, generator?: string | null): SiteBuilder | null {
  let host = '';
  try {
    host = new URL(finalUrl).host.toLowerCase();
  } catch {
    // Fall through to generator-only matching with an empty host.
  }
  const gen = (generator ?? '').trim();

  for (const b of SITE_BUILDERS) {
    if (host && b.hostPatterns.some((re) => re.test(host))) return b;
    if (gen && b.generatorPatterns.some((re) => re.test(gen))) return b;
  }
  return null;
}

/**
 * True when an asset URL is the builder's own default asset (served from its
 * marketing host), i.e. chrome and not the owner's upload. Rejects a default
 * favicon/logo.
 *
 * `siteHost` is the owner site's host. It is REQUIRED for correctness on free
 * builders: the owner site lives under the builder's domain (e.g.
 * `marilia.webnode.pt`), so its own-origin assets would match
 * `promoHostPatterns`. We only treat an asset as the builder's default when its
 * host DIFFERS from the owner's host - the builder's marketing host is always a
 * different host than the owner's subdomain.
 */
export function isBuilderPromoAsset(assetUrl: string, builder: SiteBuilder, siteHost?: string): boolean {
  let host = '';
  try {
    host = new URL(assetUrl).host.toLowerCase();
  } catch {
    return false;
  }
  if (siteHost && host === siteHost.toLowerCase()) return false;
  return builder.promoHostPatterns.some((re) => re.test(host));
}

export interface StripResult {
  /** Count of chrome subtrees removed from the DOM. */
  removed: number;
  /** Non-neutral hex colors used by the removed chrome (lowercase 6-digit). */
  chromeColors: string[];
  /** Lowercase primary font-family names used by the removed chrome. */
  chromeFonts: string[];
}

/**
 * The in-page strip routine, kept as a PLAIN-JS STRING and injected via
 * `page.evaluate('(' + source + ')(args)')`.
 *
 * Why a string and not a typed function: (1) the api tsconfig ships no DOM lib,
 * so DOM globals in a typed evaluate would not type-check; (2) passing a compiled
 * function to `page.evaluate` breaks under esbuild's `keepNames` transform (tsx +
 * vitest), which wraps every named inner helper in a `__name()` call that does
 * not exist in the page context. A string is never touched by any compiler, so
 * this works identically under tsx, tsc, and vitest.
 *
 * Runs in the browser context: may reference ONLY DOM globals, no imports.
 * Returns the chrome's discovered colors/fonts so the caller can scrub the same
 * values from sources it cannot DOM-strip (dembrandt, raw CSS).
 */
const CHROME_STRIP_SOURCE = `function (args) {
  var selectors = args.selectors, promoHostSources = args.promoHostSources;
  var promoRes = promoHostSources.map(function (s) { return new RegExp(s, 'i'); });

  var siteHost = location.host.toLowerCase();
  function hostOf(href) {
    try { return new URL(href, location.href).host.toLowerCase(); } catch (e) { return ''; }
  }
  function isPromoHref(href) {
    var h = hostOf(href);
    return !!h && h !== siteHost && promoRes.some(function (re) { return re.test(h); });
  }

  var chrome = new Set();

  for (var i = 0; i < selectors.length; i++) {
    try { document.querySelectorAll(selectors[i]).forEach(function (el) { chrome.add(el); }); } catch (e) {}
  }

  document.querySelectorAll('a[href]').forEach(function (a) {
    var href = a.getAttribute('href') || '';
    if (!isPromoHref(href)) return;
    var el = a, positioned = null, hops = 0;
    while (el && el !== document.body && hops < 10) {
      var pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') { positioned = el; break; }
      el = el.parentElement; hops++;
    }
    if (positioned) { chrome.add(positioned); return; }
    var wrap = a, h2 = 0;
    while (wrap.parentElement && wrap.parentElement !== document.body &&
           (wrap.parentElement.textContent || '').trim().length <= 140 && h2 < 4) {
      wrap = wrap.parentElement; h2++;
    }
    chrome.add(wrap);
  });

  var list = Array.from(chrome);
  var outer = list.filter(function (el) {
    return !list.some(function (o) { return o !== el && o.contains(el); });
  });

  function toHex(s) {
    if (!s) return null;
    var m = s.match(/rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)(?:[,/\\s]+([\\d.]+))?/i);
    if (!m) return null;
    if (m[4] !== undefined && parseFloat(m[4]) < 0.25) return null;
    var hx = [m[1], m[2], m[3]].map(function (n) {
      return Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
    }).join('');
    return '#' + hx;
  }
  function isNeutral(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn <= 12) return true;
    if (mx <= 20 || mn >= 235) return true;
    return false;
  }

  var colors = new Set(), fonts = new Set();
  function collect(el) {
    var cs;
    try { cs = getComputedStyle(el); } catch (e) { return; }
    var candidateColors = [cs.backgroundColor, cs.color, cs.borderTopColor, cs.borderBottomColor];
    for (var i = 0; i < candidateColors.length; i++) {
      var hex = toHex(candidateColors[i]);
      if (hex && !isNeutral(hex)) colors.add(hex);
    }
    var ff = (cs.fontFamily || '').split(',')[0].trim().replace(/["']/g, '').toLowerCase();
    if (ff && !/^(inherit|initial|unset|revert|system-ui|sans-serif|serif|monospace)$/.test(ff)) fonts.add(ff);
    var children = el.children;
    for (var j = 0; j < children.length; j++) collect(children[j]);
  }
  for (var k = 0; k < outer.length; k++) collect(outer[k]);

  var removed = 0;
  for (var m2 = 0; m2 < outer.length; m2++) {
    try { outer[m2].remove(); removed++; } catch (e) {}
  }

  return { removed: removed, chromeColors: Array.from(colors), chromeFonts: Array.from(fonts) };
}`;

/**
 * Strip a detected builder's injected chrome from a live page and return the
 * chrome's discovered colors/fonts. Call this AFTER navigation/settle and
 * BEFORE sampling colors, fonts, or screenshots. Non-fatal: any failure returns
 * an empty result and leaves the page untouched.
 */
export async function stripBuilderChrome(page: Page, builder: SiteBuilder): Promise<StripResult> {
  try {
    const args = {
      selectors: builder.chromeSelectors,
      promoHostSources: builder.promoHostPatterns.map((re) => re.source),
    };
    const result = (await page.evaluate(`(${CHROME_STRIP_SOURCE})(${JSON.stringify(args)})`)) as StripResult;
    if (result.removed > 0) {
      console.log(
        `[site-builder] Stripped ${result.removed} ${builder.name} chrome node(s); ` +
          `chrome colors=[${result.chromeColors.join(', ')}] fonts=[${result.chromeFonts.join(', ')}]`,
      );
    }
    return result;
  } catch (err) {
    console.warn(`[site-builder] chrome strip failed (${builder.name}): ${err instanceof Error ? err.message : err}`);
    return { removed: 0, chromeColors: [], chromeFonts: [] };
  }
}

/** Normalize a font-family label to the key used for chrome-font comparison. */
export function normalizeFontKey(family: string): string {
  return (family.split(',')[0] ?? '').trim().replace(/["']/g, '').toLowerCase();
}
