/**
 * Server-side site fetcher for brand research (ch05 §5.6.4).
 *
 * The brand-research agent stays TOOL-LESS (§5.6.4 anti-injection): it never
 * touches the target site. All site access is deterministic SERVER-SIDE code
 * here. Fetching the HTML with realistic browser headers and extracting
 * structured signals lets us (a) hit URLs that reject curl's default UA, and
 * (b) cap what the agent sees to a server-built snapshot it cannot influence.
 *
 * Every network fetch of the user-supplied URL (and its linked stylesheets)
 * goes through `guardedFetchFollow` (ch09 invariant 8, FIXED-8): scheme
 * allowlist + private/loopback/link-local rejection, re-validated on each
 * redirect hop.
 */
import { guardedFetchFollow } from '../url-fetcher.js';
import { SsrfError } from '../url-safety.js';

export type HueBucket =
  | 'red'
  | 'orange-amber'
  | 'yellow'
  | 'green'
  | 'teal-cyan'
  | 'blue'
  | 'violet'
  | 'pink-magenta';

/**
 * Where a candidate came from. `css` = parsed out of raw HTML/stylesheets, count
 * is literal-occurrence frequency. `rendered-area` = sampled from a live-rendered
 * page, count is cumulative visible pixel area. `screenshot` = quantized from the
 * rendered page's PIXELS (the low-confidence fallback for imagery-branded sites
 * whose computed styles paint nothing non-neutral), count is sampled pixels.
 * The scales are not comparable; the agent prompt treats rendered-area as
 * higher-priority because it reflects what a human actually SEES.
 */
export type ColorCandidateSource = 'css' | 'rendered-area' | 'screenshot';

export interface ColorCandidate {
  hex: string;
  /** Frequency or area weight, depending on `source`. Do not compare across sources. */
  count: number;
  bucket: HueBucket;
  /** HSL saturation (0-1) - used to down-rank muddy/washed shades. */
  saturation: number;
  /** HSL lightness (0-1). Brand colors tend to cluster around 0.35-0.55. */
  lightness: number;
  /** Brand-fit score in [0, 1]: high saturation + mid lightness rank higher. */
  brandFit: number;
  /** `css` by default for back-compat with existing callers. */
  source?: ColorCandidateSource;
}

export interface SiteContext {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  title: string | null;
  description: string | null;
  ogSiteName: string | null;
  ogImage: string | null;
  themeColor: string | null;
  favicon: string | null;
  /** `<meta name="generator">` - used to detect website builders (Webnode, Wix, ...). */
  generator: string | null;
  colorCandidates: ColorCandidate[];
  fontCandidates: string[];
  textSample: string;
  error?: string;
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const MAX_BODY_BYTES = 512 * 1024;
const MAX_CSS_BYTES_PER_FILE = 256 * 1024;
const MAX_STYLESHEETS = 6;
const CSS_FETCH_TIMEOUT_MS = 8_000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function firstMeta(html: string, ...attrs: { name: string; value: string }[]): string | null {
  for (const { name, value } of attrs) {
    const re = new RegExp(`<meta\\b[^>]*\\b${name}=["']${value}["'][^>]*\\bcontent=["']([^"']+)["']`, 'i');
    const m = html.match(re);
    if (m) return decodeEntities(m[1]!).trim();
    const reSwapped = new RegExp(`<meta\\b[^>]*\\bcontent=["']([^"']+)["'][^>]*\\b${name}=["']${value}["']`, 'i');
    const m2 = html.match(reSwapped);
    if (m2) return decodeEntities(m2[1]!).trim();
  }
  return null;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]!).replace(/\s+/g, ' ').trim() : null;
}

function extractLink(html: string, rel: string): string | null {
  const re = new RegExp(`<link\\b[^>]*\\brel=["']${rel}["'][^>]*\\bhref=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  if (m) return m[1]!.trim();
  const reSwapped = new RegExp(`<link\\b[^>]*\\bhref=["']([^"']+)["'][^>]*\\brel=["']${rel}["']`, 'i');
  const m2 = html.match(reSwapped);
  return m2 ? m2[1]!.trim() : null;
}

/**
 * Extract color candidates from arbitrary text (HTML, CSS, or both concatenated),
 * ranked by frequency, each tagged with its hue bucket. Hue bucketing forces the
 * agent to pick primary and secondary from different hue families.
 *
 * Recognized notations: 6-digit hex, 3-digit hex (expanded), `rgb()`/`rgba()`
 * (comma and space syntax).
 */
export function extractColorCandidates(text: string): ColorCandidate[] {
  const counts = new Map<string, number>();

  const bump = (hex: string): void => {
    if (!hex) return;
    if (isNeutralGray(hex)) return;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  };

  const hex6 = /#([0-9a-fA-F]{6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = hex6.exec(text)) !== null) {
    bump('#' + m[1]!.toLowerCase());
  }

  const hex3 = /#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])(?![0-9a-fA-F])/g;
  while ((m = hex3.exec(text)) !== null) {
    const r = m[1]!.toLowerCase();
    const g = m[2]!.toLowerCase();
    const b = m[3]!.toLowerCase();
    bump(`#${r}${r}${g}${g}${b}${b}`);
  }

  const rgbRe = /rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})(?:\s*[,/]\s*[\d.%]+)?\s*\)/gi;
  while ((m = rgbRe.exec(text)) !== null) {
    const r = Math.min(255, parseInt(m[1]!, 10));
    const g = Math.min(255, parseInt(m[2]!, 10));
    const b = Math.min(255, parseInt(m[3]!, 10));
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
    bump('#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join(''));
  }

  return [...counts.entries()]
    .map(([hex, count]) => {
      const { s, l } = toHsl(hex);
      return {
        hex,
        count,
        bucket: classifyHue(hex),
        saturation: s,
        lightness: l,
        brandFit: computeBrandFit(s, l),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

export function toHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

export function computeBrandFit(s: number, l: number): number {
  // Target lightness ~0.35 (the dominant brand-shade range for most modern
  // palettes). Asymmetric decay: very-light colors are penalized harder than
  // slightly-dark ones, because light mints/pastels are almost always UI accents.
  let lightnessFit: number;
  if (l <= 0.15) {
    lightnessFit = l / 0.15;
  } else if (l <= 0.45) {
    lightnessFit = 1.0;
  } else if (l <= 0.6) {
    lightnessFit = 1 - ((l - 0.45) / 0.15) * 0.5;
  } else {
    lightnessFit = Math.max(0, 0.5 - ((l - 0.6) / 0.2) * 0.5);
  }
  return Math.max(0, Math.min(1, s * lightnessFit));
}

export function isNeutralGray(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  if (maxC - minC <= 12) return true;
  if (maxC <= 20 || minC >= 235) return true;
  return false;
}

export function classifyHue(hex: string): HueBucket {
  const { h } = toHsl(hex);
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange-amber';
  if (h < 70) return 'yellow';
  if (h < 155) return 'green';
  if (h < 200) return 'teal-cyan';
  if (h < 255) return 'blue';
  if (h < 290) return 'violet';
  return 'pink-magenta';
}

/**
 * Parse `<link rel="stylesheet" href=...>` tags and return absolute URLs.
 * Handles both attribute orders and deduplicates.
 */
export function extractStylesheetHrefs(html: string, baseUrl: string): string[] {
  const hrefs = new Set<string>();
  const patterns = [
    /<link\b[^>]*\brel=["'](?:stylesheet|preload)["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["'](?:stylesheet|preload)["'][^>]*>/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const tag = m[0];
      if (/rel=["']preload["']/i.test(tag) && !/\bas=["']style["']/i.test(tag)) continue;
      const abs = absolutize(baseUrl, m[1]!);
      if (abs) hrefs.add(abs);
    }
  }
  return [...hrefs].slice(0, MAX_STYLESHEETS);
}

/**
 * Fetch up to MAX_STYLESHEETS linked CSS files (SSRF-guarded, parallel) and
 * concatenate their bodies. Per-file size and timeout caps protect us from
 * hostile or broken sites. A stylesheet that redirects to a private address is
 * rejected by the guard and simply skipped.
 */
export async function fetchLinkedStylesheets(hrefs: string[]): Promise<string> {
  if (hrefs.length === 0) return '';
  const results = await Promise.allSettled(
    hrefs.map(async (href) => {
      try {
        const res = await guardedFetchFollow(href, { headers: BROWSER_HEADERS, timeoutMs: CSS_FETCH_TIMEOUT_MS });
        if (!res.ok) return '';
        const reader = res.body?.getReader();
        if (!reader) return '';
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (total < MAX_CSS_BYTES_PER_FILE) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.byteLength;
        }
        reader.cancel().catch(() => {});
        return Buffer.concat(chunks).toString('utf-8');
      } catch {
        return '';
      }
    }),
  );
  return results.map((r) => (r.status === 'fulfilled' ? r.value : '')).join('\n');
}

/**
 * Push the site's `<meta name=theme-color>` hex to the front of the candidate
 * list when it is a non-neutral color. Returns a new array; does not mutate.
 */
export function seedWithThemeColor(candidates: ColorCandidate[], themeColor: string): ColorCandidate[] {
  const normalized = normalizeHexLike(themeColor);
  if (!normalized || isNeutralGray(normalized)) return candidates;

  const { s, l } = toHsl(normalized);
  const seeded: ColorCandidate = {
    hex: normalized,
    count: Math.max(50, candidates[0]?.count ?? 0),
    bucket: classifyHue(normalized),
    saturation: s,
    lightness: l,
    brandFit: computeBrandFit(s, l),
  };
  const existing = candidates.find((c) => c.hex === normalized);
  if (existing) {
    existing.count = Math.max(existing.count, seeded.count);
    return candidates;
  }
  return [seeded, ...candidates];
}

/** Normalize a `#rgb`/`#rrggbb` string to lowercase 6-digit hex; null for anything else.
 *  Exported for the snapshot's allowed-hex collection and the research membership guard. */
export function normalizeHexLike(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (s.startsWith('#')) {
    const rest = s.slice(1);
    if (/^[0-9a-f]{6}$/.test(rest)) return `#${rest}`;
    if (/^[0-9a-f]{3}$/.test(rest)) {
      return '#' + rest.split('').map((c) => c + c).join('');
    }
  }
  return null;
}

function extractFontCandidates(html: string): string[] {
  const fonts = new Set<string>();
  const re = /font-family\s*:\s*([^;}\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const stack = m[1]!.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
    const primary = stack[0];
    if (primary && !/^(inherit|initial|unset|revert|var\(|system-ui|sans-serif|serif|monospace|ui-)/i.test(primary)) {
      fonts.add(primary);
    }
  }
  const gfontRe = /fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi;
  while ((m = gfontRe.exec(html)) !== null) {
    const family = decodeURIComponent(m[1]!).replace(/\+/g, ' ').split(':')[0];
    if (family) fonts.add(family);
  }
  return [...fonts].slice(0, 10);
}

function extractTextSample(html: string, limit = 4000): string {
  const body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return decodeEntities(body).slice(0, limit);
}

function absolutize(base: string, ref: string | null): string | null {
  if (!ref) return null;
  try {
    return new URL(ref, base).toString();
  } catch {
    return null;
  }
}

/**
 * Fetch a site and extract a structured brand snapshot. Non-fatal: any failure
 * (SSRF rejection, network error, non-HTML, timeout) returns `ok: false` with an
 * `error`, and the caller falls back to knowledge-only research honestly.
 */
export async function fetchSiteContext(url: string, timeoutMs = 15_000): Promise<SiteContext> {
  const skeleton: SiteContext = {
    url,
    finalUrl: url,
    status: 0,
    ok: false,
    title: null,
    description: null,
    ogSiteName: null,
    ogImage: null,
    themeColor: null,
    favicon: null,
    generator: null,
    colorCandidates: [],
    fontCandidates: [],
    textSample: '',
  };

  try {
    const response = await guardedFetchFollow(url, { headers: BROWSER_HEADERS, timeoutMs });
    skeleton.status = response.status;
    skeleton.finalUrl = response.url || url;
    skeleton.ok = response.ok;

    if (!response.ok) {
      skeleton.error = `HTTP ${response.status}`;
      return skeleton;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('html') && !contentType.includes('xhtml')) {
      skeleton.error = `non-HTML content-type: ${contentType}`;
      return skeleton;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      skeleton.error = 'no response body';
      return skeleton;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks).toString('utf-8');

    skeleton.title = extractTitle(html);
    skeleton.description = firstMeta(html, { name: 'name', value: 'description' }, { name: 'property', value: 'og:description' });
    skeleton.ogSiteName = firstMeta(html, { name: 'property', value: 'og:site_name' });
    const ogImage = firstMeta(html, { name: 'property', value: 'og:image' }, { name: 'name', value: 'og:image' });
    skeleton.ogImage = absolutize(skeleton.finalUrl, ogImage);
    skeleton.themeColor = firstMeta(html, { name: 'name', value: 'theme-color' });
    skeleton.generator = firstMeta(html, { name: 'name', value: 'generator' });
    const favRef =
      extractLink(html, 'icon') || extractLink(html, 'shortcut icon') || extractLink(html, 'apple-touch-icon');
    skeleton.favicon = absolutize(skeleton.finalUrl, favRef);

    // Modern sites keep their brand colors in linked CSS bundles, not inline in
    // the HTML. Fetch the linked stylesheets (capped, parallel, guarded) and run
    // the extractors on HTML + CSS combined.
    const cssHrefs = extractStylesheetHrefs(html, skeleton.finalUrl);
    let cssText = '';
    try {
      cssText = await fetchLinkedStylesheets(cssHrefs);
    } catch (err) {
      console.warn(`[site-context] Stylesheet fetch failed: ${err instanceof Error ? err.message : err}`);
    }
    const combined = cssText ? `${html}\n${cssText}` : html;

    skeleton.colorCandidates = extractColorCandidates(combined);
    if (skeleton.themeColor) {
      skeleton.colorCandidates = seedWithThemeColor(skeleton.colorCandidates, skeleton.themeColor);
    }
    for (const c of skeleton.colorCandidates) c.source = 'css';
    skeleton.fontCandidates = extractFontCandidates(combined);
    skeleton.textSample = extractTextSample(html);
  } catch (err) {
    // An SSRF rejection is a non-fatal "unreachable" for research purposes.
    skeleton.error = err instanceof SsrfError ? `blocked: ${err.message}` : err instanceof Error ? err.message : String(err);
  }

  return skeleton;
}

export function summarizeSiteContext(ctx: SiteContext, renderedCandidates: ColorCandidate[] = []): string {
  const lines: string[] = [];
  lines.push(`URL: ${ctx.url}`);
  if (ctx.finalUrl !== ctx.url) lines.push(`Final URL (after redirects): ${ctx.finalUrl}`);
  lines.push(`HTTP status: ${ctx.status}`);
  if (ctx.title) lines.push(`<title>: ${ctx.title}`);
  if (ctx.description) lines.push(`description: ${ctx.description}`);
  if (ctx.ogSiteName) lines.push(`og:site_name: ${ctx.ogSiteName}`);
  if (ctx.ogImage) lines.push(`og:image: ${ctx.ogImage}`);
  if (ctx.favicon) lines.push(`favicon: ${ctx.favicon}`);
  if (ctx.themeColor) lines.push(`<meta theme-color>: ${ctx.themeColor}`);

  if (renderedCandidates.length) {
    const top = renderedCandidates.slice(0, 10);
    lines.push(
      `Rendered brand-color candidates (PREFERRED - sampled from the live page, pre-ranked by brand-fit x sqrt(area)). The first entry is the strongest brand color that actually paints the page; use this list ahead of the CSS buckets below when picking primary/secondary/accent.`,
    );
    for (const c of top) {
      lines.push(`  - ${c.hex} (area=${c.count}, fit=${c.brandFit.toFixed(2)}, ${c.bucket}, L=${c.lightness.toFixed(2)})`);
    }
  }

  if (ctx.colorCandidates.length) {
    const grouped = groupByBucket(ctx.colorCandidates);
    const sortedBuckets = [...grouped.entries()].sort((a, b) => b[1].totalCount - a[1].totalCount);
    const header = renderedCandidates.length
      ? `CSS-frequency candidates (SECONDARY - fallback/supplement to the rendered list above). Raw occurrences in HTML + linked stylesheets, grouped by hue bucket.`
      : `Color candidates, grouped by hue bucket. Bucket ORDER reflects hue dominance on the site (total occurrences per bucket, highest first) - the #1 bucket is the brand's main hue family. Within each bucket, entries are sorted by a combined score = brandFit x sqrt(count), so the FIRST entry is the recommended brand shade. Light-mint accents often out-count the true brand shade on raw frequency, so DO NOT pick by raw count - use the order as given.`;
    lines.push(header);
    for (const [bucket, info] of sortedBuckets) {
      const picks = info.items
        .slice(0, 4)
        .map((c) => `${c.hex} (${c.count}x, fit=${c.brandFit.toFixed(2)}, L=${c.lightness.toFixed(2)})`)
        .join(', ');
      lines.push(`  - ${bucket}: ${picks} [bucket total: ${info.totalCount}x, best-fit: ${info.bestBrandFit.toFixed(2)}]`);
    }
  }

  if (ctx.fontCandidates.length) {
    lines.push(`Font families found: ${ctx.fontCandidates.join(', ')}`);
  }
  if (ctx.textSample) {
    lines.push(`Visible text sample (first ~4000 chars, tags stripped):`);
    lines.push(ctx.textSample);
  }
  if (!ctx.ok) lines.push(`FETCH ERROR: ${ctx.error ?? 'unknown'}`);
  return lines.join('\n');
}

interface BucketGroup {
  totalCount: number;
  bestBrandFit: number;
  items: ColorCandidate[];
}

function groupByBucket(candidates: ColorCandidate[]): Map<HueBucket, BucketGroup> {
  const map = new Map<HueBucket, BucketGroup>();
  for (const c of candidates) {
    const entry = map.get(c.bucket) ?? { totalCount: 0, bestBrandFit: 0, items: [] };
    entry.totalCount += c.count;
    entry.items.push(c);
    if (c.brandFit > entry.bestBrandFit) entry.bestBrandFit = c.brandFit;
    map.set(c.bucket, entry);
  }
  for (const entry of map.values()) {
    entry.items.sort((a, b) => bucketScore(b) - bucketScore(a));
  }
  return map;
}

function bucketScore(c: ColorCandidate): number {
  return c.brandFit * Math.sqrt(c.count);
}
