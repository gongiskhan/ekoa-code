/**
 * Rendered brand-color sampling via the shared headless Chromium (ch05 §5.6.4).
 *
 * The CSS-frequency scan in `site-context.ts` picks whatever color appears most
 * often in stylesheets. That breaks on sites that declare one-off saturated
 * colors for tiny UI elements (a Share-to-WhatsApp button) and keep the real
 * brand hue inside background images. By rendering the page and weighting each
 * color by the visible ELEMENT AREA it covers, we see what a human sees.
 *
 * The agent stays tool-less: rendering happens here, and the agent receives a
 * structured candidate list it cannot influence.
 */

import { classifyHue, computeBrandFit, isNeutralGray, toHsl, type ColorCandidate } from './site-context.js';
import { getSharedBrowser } from '../browser-pool.js';
import { stripBuilderChrome, type SiteBuilder } from './site-builder.js';
import { stripConsentChrome } from './consent-chrome.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const RENDER_SETTLE_MS = 800;
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 900;
const MAX_CANDIDATES = 40;
const MAX_ELEMENTS_WALKED = 3000;
/** Drop candidates whose score is less than this fraction of the top score. */
const MIN_SCORE_RATIO = 0.05;
/**
 * brandFit floor. Candidates below this threshold are almost always page chrome -
 * body/wrapper backgrounds, muted gradients, overlay fills - that dominate by raw
 * area but no human reads as a brand color. The fallback guard below preserves
 * rendered output when a muted-palette site has ALL candidates below the floor.
 */
const MIN_RENDERED_FIT = 0.3;

/**
 * A logo candidate harvested from the RENDERED page - the element a human sees as "the logo"
 * (header img / inline svg / css background), scored by placement + attributes. This is what
 * the old browser-driving research agent did by eye; the tool-less design does it
 * deterministically (operator report 2026-07-11: a favicon-only heuristic picked a 380KB
 * touch-icon as "the logo").
 */
export interface RenderedLogoCandidate {
  /** Absolute image URL (img src / background-image). Absent for inline SVGs. */
  url?: string;
  /** Inline <svg> markup (modern sites often have no logo URL at all). */
  svgText?: string;
  /** Placement/attribute score - higher = more likely the real header logo. */
  score: number;
  width: number;
  height: number;
  /**
   * True only when the element carries a STRUCTURAL logo signal (logo-ish attrs, inside
   * header/nav, or wrapped in a home link). Position/aspect alone must never make a
   * top-tier candidate: a team-portrait carousel at the top of the page scores on
   * position/aspect and won the pick pre-fix (observed live 2026-07-11, plmj.com).
   */
  strong: boolean;
}

export interface RenderedCandidates {
  /**
   * True when the Playwright render actually ran and sampled the DOM. Lets the
   * caller tell "render failed -> fall back to CSS" apart from "render succeeded
   * but the owner site is genuinely monochrome". False on every error/empty return.
   */
  ok: boolean;
  /** Area-weighted brand-color candidates, chrome-stripped, pre-ranked. */
  candidates: ColorCandidate[];
  /**
   * EVERY non-neutral hex that actually paints the page (chrome-stripped), before
   * the brand-fit / score-ratio ranking that trims `candidates`. The "does the
   * owner actually use this color at all" signal. Empty when the render failed.
   */
  paintedHexes: string[];
  /** Font families that actually PAINT the page, ranked by visible area, chrome excluded. */
  topFonts: string[];
  /** Non-neutral colors used by stripped builder chrome (for cross-source scrubbing). */
  chromeColors: string[];
  /** Font families used by stripped builder chrome. */
  chromeFonts: string[];
  /** Rendered-header logo candidates, best-first (optional: absent when the render failed). */
  logoCandidates?: RenderedLogoCandidate[];
  /** JPEG screenshot of the page's top strip - the vision ground truth for logo confirmation. */
  headerShot?: Buffer | null;
  /**
   * Pixel-quantized candidates from the page SCREENSHOT - the low-confidence fallback for
   * imagery-branded sites, present ONLY when the computed-style walk painted nothing
   * non-neutral. A brand color living exclusively in a hero photo/overlay is invisible to
   * computed-style sampling (observed live 2026-07-12, mariliasantoscabral.webnode.pt: navy
   * hero JPEG, all-grayscale computed styles - research came back colorless).
   */
  screenshotCandidates?: ColorCandidate[];
}

export interface FetchRenderedOptions {
  timeoutMs?: number;
  /** When set, the builder's injected chrome is stripped before sampling. */
  builder?: SiteBuilder | null;
}

/**
 * In-page walker as a PLAIN-JS STRING (see site-builder.ts for why a string, not
 * a typed function: no DOM lib in the api tsconfig, and esbuild's `__name`
 * transform breaks compiled functions in the page context). Accumulates
 * color -> visible area and font-family -> visible area across the visible DOM.
 */
const RENDERED_WALK_SOURCE = `function (args) {
  var maxElements = args.maxElements;
  var weights = {};
  var fontWeights = {};
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  var counted = 0;
  var node;
  while ((node = walker.nextNode())) {
    var el = node;
    var rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight * 3) continue;
    counted++;
    if (counted > maxElements) break;
    var area = Math.max(1, Math.round(rect.width * rect.height));
    var style = getComputedStyle(el);
    var sources = [style.backgroundColor, style.color, style.borderColor, el.getAttribute('fill'), el.getAttribute('stroke')];
    for (var i = 0; i < sources.length; i++) {
      var src = sources[i];
      if (!src) continue;
      weights[src] = (weights[src] || 0) + area;
    }
    var fam = (style.fontFamily || '').split(',')[0].trim().replace(/["']/g, '');
    if (fam && !/^(inherit|initial|unset|revert|system-ui|sans-serif|serif|monospace|ui-)/i.test(fam)) {
      fontWeights[fam] = (fontWeights[fam] || 0) + area;
    }
  }
  var colors = Object.keys(weights).map(function (k) { return [k, weights[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 120);
  var fonts = Object.keys(fontWeights).map(function (k) { return [k, fontWeights[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 12).map(function (e) { return e[0]; });
  return { colors: colors, fonts: fonts };
}`;

/**
 * In-page logo harvester (plain-JS string, same constraints as RENDERED_WALK_SOURCE).
 * Scores every visible img / inline-svg / logo-classed background element by the signals a
 * human uses to spot "the logo": logo-ish attributes, header/nav placement, top-of-page,
 * wrapped in a home link, top-left, logo-like aspect ratio and size. Returns the top 6.
 */
const LOGO_WALK_SOURCE = `function () {
  var W = window.innerWidth, H = window.innerHeight;
  var out = [];
  var seen = {};
  function absUrl(u) { try { return new URL(u, location.href).href; } catch (e) { return ''; } }
  function scoreEl(el, rect, isPhotoUrl) {
    var text = ((el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '') + ' ' + (el.getAttribute('alt') || '') + ' ' + (el.getAttribute('src') || '')).toLowerCase();
    var score = 0;
    var strong = false;
    if (text.indexOf('logo') >= 0 || el.closest('[class*="logo" i], [id*="logo" i]')) { score += 40; strong = true; }
    if (el.closest('header, nav, [role="banner"]')) { score += 30; strong = true; }
    if (rect.top < 160) score += 20;
    var link = el.closest('a');
    if (link) {
      var href = link.getAttribute('href') || '';
      if (href === '/' || href === location.origin || href === location.origin + '/' || href === location.href) { score += 25; strong = true; }
    }
    if (rect.left < W / 2) score += 10;
    var ar = rect.width / Math.max(1, rect.height);
    if (ar >= 0.5 && ar <= 8) score += 15; else if (ar > 10) score -= 25;
    if (rect.height >= 20 && rect.height <= 160) score += 10;
    if (rect.width > 700) score -= 20;
    if (rect.top > H) score -= 30;
    if (isPhotoUrl) score -= 15; // .jpg/.jpeg: photographs are almost never logos
    return { score: score, strong: strong };
  }
  var els = document.querySelectorAll('img, svg, [class*="logo" i]');
  for (var i = 0; i < els.length && out.length < 24; i++) {
    var el = els[i];
    var rect = el.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 12) continue;
    if (rect.height > 500) continue;
    if (rect.top > H * 1.5) continue;
    var tag = el.tagName.toLowerCase();
    var entry = null;
    if (tag === 'img') {
      var src = el.currentSrc || el.getAttribute('src') || '';
      var abs = absUrl(src);
      if (!abs || abs.indexOf('data:') === 0) continue;
      if (seen[abs]) continue;
      seen[abs] = 1;
      entry = { url: abs };
    } else if (tag === 'svg') {
      if (el.querySelector('image')) continue;
      var xml = el.outerHTML;
      if (!xml || xml.length > 60000) continue;
      var key = 'svg:' + xml.length + ':' + Math.round(rect.width);
      if (seen[key]) continue;
      seen[key] = 1;
      entry = { svgText: xml };
    } else {
      var bg = getComputedStyle(el).backgroundImage || '';
      var m = bg.match(/url\\((['"]?)(.*?)\\1\\)/);
      if (!m || !m[2]) continue;
      var burl = absUrl(m[2]);
      if (!burl || burl.indexOf('data:') === 0) continue;
      if (seen[burl]) continue;
      seen[burl] = 1;
      entry = { url: burl };
    }
    var isPhotoUrl = !!(entry.url && /\\.jpe?g(\\?|$)/i.test(entry.url));
    var scored = scoreEl(el, rect, isPhotoUrl);
    entry.score = scored.score;
    entry.strong = scored.strong;
    entry.width = Math.round(rect.width);
    entry.height = Math.round(rect.height);
    // Only STRONG candidates qualify (structural logo signal). Position/aspect-only hits are
    // page content (hero photos, portrait carousels), not the logo.
    if (entry.strong && entry.score > 0) out.push(entry);
  }
  out.sort(function (a, b) { return b.score - a.score; });
  return out.slice(0, 6);
}`;

/** Height of the header strip screenshot used as vision ground truth for the logo pick. */
const HEADER_SHOT_HEIGHT = 220;

/** Pixel fallback: sample every Nth pixel in both axes (1280x900 / 6 ≈ 32k samples). */
const PIXEL_SAMPLE_STRIDE = 6;
/** Pixel fallback: a cluster below this share of sampled pixels is noise, not a brand color. */
const PIXEL_MIN_SHARE = 0.02;
const MAX_SCREENSHOT_CANDIDATES = 6;

/**
 * In-page pixel quantizer (plain-JS string, same constraints as RENDERED_WALK_SOURCE).
 * The screenshot bytes are injected back as a data: URL and drawn onto a canvas INSIDE the
 * page - drawing the site's own cross-origin imagery would taint the canvas and make
 * getImageData throw, but a data: image is same-origin, so the round-trip through
 * Playwright's screenshot is what makes pixel access possible at all. Quantizes to 16
 * levels per channel and returns the average color + sample count of the top clusters.
 */
const PIXEL_SAMPLE_SOURCE = `function (args) {
  return new Promise(function (resolve) {
    var img = new Image();
    img.onload = function () {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        var stride = args.stride;
        var acc = {};
        var total = 0;
        for (var y = 0; y < canvas.height; y += stride) {
          for (var x = 0; x < canvas.width; x += stride) {
            var i = (y * canvas.width + x) * 4;
            if (data[i + 3] < 128) continue;
            var r = data[i], g = data[i + 1], b = data[i + 2];
            var key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            var c = acc[key];
            if (c) { c.n++; c.r += r; c.g += g; c.b += b; } else { acc[key] = { n: 1, r: r, g: g, b: b }; }
            total++;
          }
        }
        var clusters = Object.keys(acc).map(function (k) {
          var c = acc[k];
          var hx = function (v) { return ('0' + Math.round(v / c.n).toString(16)).slice(-2); };
          return { hex: '#' + hx(c.r) + hx(c.g) + hx(c.b), count: c.n };
        }).sort(function (a, b) { return b.count - a.count; }).slice(0, 24);
        resolve({ total: total, clusters: clusters });
      } catch (e) { resolve({ total: 0, clusters: [] }); }
    };
    img.onerror = function () { resolve({ total: 0, clusters: [] }); };
    img.src = args.dataUrl;
  });
}`;

/**
 * Sample area-weighted color candidates (and dominant fonts) from a rendered
 * page. Non-fatal by design - any failure returns an empty result so the caller
 * can fall back to CSS-based candidates without breaking brand research.
 */
export async function fetchRenderedCandidates(
  url: string,
  options: FetchRenderedOptions = {},
): Promise<RenderedCandidates> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, builder = null } = options;
  const empty: RenderedCandidates = { ok: false, candidates: [], paintedHexes: [], topFonts: [], chromeColors: [], chromeFonts: [] };

  let browser;
  try {
    browser = await getSharedBrowser();
  } catch (err) {
    console.warn(`[rendered-candidates] Browser launch failed: ${errMsg(err)}`);
    return empty;
  }

  let page;
  try {
    page = await browser.newPage({ viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } });
    // Block only on `domcontentloaded`, then best-effort wait for `load` and
    // `networkidle`: a slow tracker-heavy site gets slightly less settled DOM,
    // not an empty candidate list.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('load', { timeout: 8_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(RENDER_SETTLE_MS);

    // Consent-vendor overlays pollute EVERY rendered signal (painted colours, the logo
    // harvest, the header-strip screenshot) - remove them before sampling, on any site.
    await stripConsentChrome(page);

    let chrome = { removed: 0, chromeColors: [] as string[], chromeFonts: [] as string[] };
    if (builder) chrome = await stripBuilderChrome(page, builder);

    const raw = (await page.evaluate(
      `(${RENDERED_WALK_SOURCE})(${JSON.stringify({ maxElements: MAX_ELEMENTS_WALKED })})`,
    )) as { colors: Array<[string, number]>; fonts: string[] };

    // Logo harvest + header-strip screenshot (vision ground truth). Both non-fatal.
    let logoCandidates: RenderedLogoCandidate[] = [];
    try {
      logoCandidates = (await page.evaluate(`(${LOGO_WALK_SOURCE})()`)) as RenderedLogoCandidate[];
    } catch (err) {
      console.warn(`[rendered-candidates] logo harvest failed: ${errMsg(err)}`);
    }
    let headerShot: Buffer | null = null;
    try {
      headerShot = await page.screenshot({
        clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: HEADER_SHOT_HEIGHT },
        type: 'jpeg',
        quality: 70,
      });
    } catch (err) {
      console.warn(`[rendered-candidates] header shot failed: ${errMsg(err)}`);
    }

    const chromeSet = new Set(chrome.chromeColors);
    const candidates = normalizeCandidates(raw.colors).filter((c) => !chromeSet.has(c.hex));

    const paintedHexes = [
      ...new Set(
        raw.colors
          .map(([colorStr]) => toHex(colorStr))
          .filter((hex): hex is string => hex != null && !isNeutralGray(hex) && !chromeSet.has(hex)),
      ),
    ];

    // Imagery-branded fallback: the computed-style walk painted NOTHING non-neutral, so the
    // brand color (if any) lives in photos/overlays. Quantize the rendered pixels themselves.
    // Builder/consent chrome was DOM-stripped above, so the screenshot is chrome-free. Kept
    // out of `paintedHexes` on purpose: the builder-scrub intersection must stay a
    // computed-style signal. Non-fatal like every other signal here.
    let screenshotCandidates: ColorCandidate[] | undefined;
    if (paintedHexes.length === 0) {
      try {
        const shot = await page.screenshot({ type: 'png' });
        const sampled = (await page.evaluate(
          `(${PIXEL_SAMPLE_SOURCE})(${JSON.stringify({
            dataUrl: `data:image/png;base64,${shot.toString('base64')}`,
            stride: PIXEL_SAMPLE_STRIDE,
          })})`,
        )) as { total: number; clusters: Array<{ hex: string; count: number }> };
        const fromPixels = screenshotClustersToCandidates(sampled.clusters, sampled.total);
        if (fromPixels.length > 0) screenshotCandidates = fromPixels;
      } catch (err) {
        console.warn(`[rendered-candidates] pixel sampling failed for ${url}: ${errMsg(err)}`);
      }
    }

    return {
      ok: true,
      candidates,
      paintedHexes,
      topFonts: raw.fonts,
      chromeColors: chrome.chromeColors,
      chromeFonts: chrome.chromeFonts,
      logoCandidates,
      headerShot,
      ...(screenshotCandidates ? { screenshotCandidates } : {}),
    };
  } catch (err) {
    console.warn(`[rendered-candidates] Sampling failed for ${url}: ${errMsg(err)}`);
    return empty;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/**
 * Convert raw color strings (rgb/rgba/hex) from the page to hex + area pairs,
 * drop transparent/neutral values, then transform into the `ColorCandidate`
 * shape the rest of the pipeline expects. Exported for unit tests - the full
 * `fetchRenderedCandidates` entry point requires Playwright, but this pure
 * transform can be exercised with hand-built `(color, area)` tuples.
 */
export function normalizeCandidates(raw: Array<[string, number]>): ColorCandidate[] {
  const byHex = new Map<string, number>();
  for (const [colorStr, area] of raw) {
    const hex = toHex(colorStr);
    if (!hex) continue;
    if (isNeutralGray(hex)) continue;
    byHex.set(hex, (byHex.get(hex) ?? 0) + area);
  }
  const candidates = [...byHex.entries()].map(([hex, area]) => {
    const { s, l } = toHsl(hex);
    return {
      hex,
      count: area,
      bucket: classifyHue(hex),
      saturation: s,
      lightness: l,
      brandFit: computeBrandFit(s, l),
      source: 'rendered-area' as const,
    };
  });
  candidates.sort((a, b) => rankScore(b) - rankScore(a));

  const byFit = candidates.filter((c) => c.brandFit >= MIN_RENDERED_FIT);
  const brandScoped = byFit.length > 0 ? byFit : candidates;

  const topScore = brandScoped[0] ? rankScore(brandScoped[0]) : 0;
  const minScore = topScore * MIN_SCORE_RATIO;
  const filtered = brandScoped.filter((c) => rankScore(c) >= minScore);

  return filtered.slice(0, MAX_CANDIDATES);
}

/**
 * Turn the in-page quantizer's clusters into screenshot-sourced candidates: drop neutrals
 * and sub-{PIXEL_MIN_SHARE} noise, keep AREA order. Deliberately no brand-fit floor or
 * fit-based ranking: pixel clusters of a photo overlay are inherently desaturated, and the
 * floor that trims the computed-style list would erase exactly the color this fallback
 * exists to find. Exported for unit tests (pure transform; the entry point needs Playwright).
 */
export function screenshotClustersToCandidates(
  clusters: Array<{ hex: string; count: number }>,
  totalSampled: number,
): ColorCandidate[] {
  if (!Number.isFinite(totalSampled) || totalSampled <= 0) return [];
  const out: ColorCandidate[] = [];
  for (const { hex, count } of clusters) {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/.test(hex)) continue;
    if (isNeutralGray(hex)) continue;
    if (count / totalSampled < PIXEL_MIN_SHARE) continue;
    const { s, l } = toHsl(hex);
    out.push({
      hex,
      count,
      bucket: classifyHue(hex),
      saturation: s,
      lightness: l,
      brandFit: computeBrandFit(s, l),
      source: 'screenshot',
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, MAX_SCREENSHOT_CANDIDATES);
}

function rankScore(c: ColorCandidate): number {
  return c.brandFit * Math.sqrt(c.count);
}

function toHex(input: string): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();

  if (s === 'transparent' || s === 'none' || s === 'currentcolor' || s === 'inherit') return null;

  if (s.startsWith('#')) {
    const rest = s.slice(1);
    if (/^[0-9a-f]{6}$/.test(rest)) return `#${rest}`;
    if (/^[0-9a-f]{3}$/.test(rest)) {
      return '#' + rest.split('').map((c) => c + c).join('');
    }
    return null;
  }

  const rgbMatch = s.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+%?))?\s*\)$/);
  if (rgbMatch) {
    const alpha = rgbMatch[4] ? parseAlpha(rgbMatch[4]) : 1;
    if (alpha < 0.25) return null;
    const r = clamp255(rgbMatch[1]!);
    const g = clamp255(rgbMatch[2]!);
    const b = clamp255(rgbMatch[3]!);
    return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  }

  return null;
}

function clamp255(s: string): number {
  const n = Math.round(parseFloat(s));
  return Math.max(0, Math.min(255, Number.isFinite(n) ? n : 0));
}

function parseAlpha(s: string): number {
  if (s.endsWith('%')) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n / 100 : 1;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 1;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
