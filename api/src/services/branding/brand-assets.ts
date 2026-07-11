/**
 * Brand asset store + multi-strategy logo extraction (ch05 §5.6.4).
 *
 * Downloads external brand images and serves them locally so the dashboard never
 * hotlinks a third-party URL (CORS / hotlink protection / disappearing assets).
 * Files land under `<dataDir>/brand-assets` - beside `<dataDir>/artifact-screenshots`
 * - and are served read-only at `/brand-assets/<file>` (server.ts mount).
 *
 * SSRF: every download of a user/agent-derived URL goes through
 * `guardedFetchFollow` (ch09 invariant 8, FIXED-8): scheme allowlist +
 * private/loopback rejection, re-validated per redirect hop. Content-type is
 * validated as an image and the size is capped.
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { guardedFetchFollow } from '../url-fetcher.js';
import { isBuilderPromoAsset, type SiteBuilder } from './site-builder.js';

/** Max bytes accepted for a single brand image (brief: ~1.5MB). */
const MAX_IMAGE_BYTES = 1_500_000;
/** Minimum bytes for a candidate to count as a real logo (not an icon/pixel). */
const MIN_LOGO_SIZE = 500;

const IMAGE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const HTML_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html',
};

/**
 * Operational data directory - env-derived and late-bound (read per call), the
 * same resolution `services/artifact-screenshot.ts` uses so brand assets sit
 * beside artifact screenshots under one data root.
 */
function dataDir(): string {
  const raw = process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/** Absolute path to the brand-assets directory (`<dataDir>/brand-assets`). */
export function getBrandAssetsDir(): string {
  return join(dataDir(), 'brand-assets');
}

function ensureBrandAssetsDir(): string {
  const dir = getBrandAssetsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface ProxyResult {
  success: boolean;
  localUrl?: string;
  filename?: string;
  originalUrl: string;
  error?: string;
  contentType?: string;
  size?: number;
}

/** Generate a filename from the image CONTENT (md5 of the bytes) with an extension from
 *  content-type/URL. Content-keyed, not URL-keyed: a re-research whose logo changed at the
 *  same source URL must produce a NEW local path, or every browser keeps serving its cached
 *  copy of the old file (observed live 2026-07-11: "kept the old brand until a refresh"). */
function generateFilename(content: Buffer, url: string, contentType?: string): string {
  const hash = createHash('md5').update(content).digest('hex').substring(0, 12);
  let ext = 'png';
  if (contentType) {
    if (contentType.includes('svg')) ext = 'svg';
    else if (contentType.includes('png')) ext = 'png';
    else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
    else if (contentType.includes('webp')) ext = 'webp';
    else if (contentType.includes('gif')) ext = 'gif';
    else if (contentType.includes('ico') || contentType.includes('icon')) ext = 'ico';
  } else {
    const u = url.toLowerCase();
    if (u.includes('.svg')) ext = 'svg';
    else if (u.includes('.png')) ext = 'png';
    else if (u.includes('.jpg') || u.includes('.jpeg')) ext = 'jpg';
    else if (u.includes('.webp')) ext = 'webp';
    else if (u.includes('.gif')) ext = 'gif';
    else if (u.includes('.ico')) ext = 'ico';
  }
  return `${hash}.${ext}`;
}

/**
 * Read a Response body into a Buffer, capping at MAX_IMAGE_BYTES. Returns null if
 * the stream exceeds the cap (a server that lies about content-length can't make
 * us buffer 100MB).
 */
async function readCapped(res: Response): Promise<Buffer | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    total += r.value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(r.value);
  }
  return Buffer.concat(chunks);
}

/**
 * Download an external image (SSRF-guarded) and cache it locally. Returns a
 * relative URL path (`/brand-assets/<file>`) on success.
 */
export async function downloadAndProxyImage(imageUrl: string): Promise<ProxyResult> {
  try {
    const response = await guardedFetchFollow(imageUrl, { headers: IMAGE_HEADERS, timeoutMs: 12_000 });
    if (!response.ok) {
      return { success: false, originalUrl: imageUrl, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);

    if (!contentType.includes('image') && !contentType.includes('svg')) {
      return { success: false, originalUrl: imageUrl, error: `Not an image: ${contentType}` };
    }
    if (contentLength > MAX_IMAGE_BYTES) {
      return { success: false, originalUrl: imageUrl, error: `Too large: ${contentLength}B` };
    }
    if (contentLength > 0 && contentLength < 100) {
      return { success: false, originalUrl: imageUrl, error: 'Too small (tracking pixel)' };
    }

    const buffer = await readCapped(response);
    if (!buffer) {
      return { success: false, originalUrl: imageUrl, error: `Too large (> ${MAX_IMAGE_BYTES}B)` };
    }

    const dir = ensureBrandAssetsDir();
    const filename = generateFilename(buffer, imageUrl, contentType);
    writeFileSync(join(dir, filename), buffer);

    return {
      success: true,
      localUrl: `/brand-assets/${filename}`,
      filename,
      originalUrl: imageUrl,
      contentType,
      size: buffer.length,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, originalUrl: imageUrl, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Multi-strategy logo extraction
// ---------------------------------------------------------------------------

const COMMON_LOGO_PATHS = [
  '/logo.svg', '/logo.png', '/logo.webp',
  '/assets/logo.svg', '/assets/logo.png',
  '/assets/images/logo.svg', '/assets/images/logo.png',
  '/images/logo.svg', '/images/logo.png',
  '/img/logo.svg', '/img/logo.png',
  '/static/logo.svg', '/static/logo.png',
  '/favicon.svg', '/apple-touch-icon.png',
  '/favicon-32x32.png', '/favicon.ico',
];

export interface LogoCandidate {
  url: string;
  localPath: string; // /brand-assets/{hash}.{ext}
  filename: string;
  size: number;
  contentType: string;
  source: string; // 'rendered-header' | 'agent' | 'og-image' | 'common-path' | 'favicon' | 'design-system' | ...
  /** Placement score from the rendered-header harvest (higher = more logo-like). */
  harvestScore?: number;
}

/**
 * Store an INLINE <svg> logo harvested from the rendered header. Modern sites often ship the
 * logo as inline SVG with no fetchable URL at all - the old favicon-only fallback then picked
 * a touch-icon as "the logo" (operator report 2026-07-11). Conservatively rejects any svg
 * carrying active content (script/event handlers/external refs): the file is served from our
 * origin, and a logo never needs those.
 */
export function storeSvgLogo(svgText: string): { localPath: string; filename: string; size: number } | null {
  const t = svgText.trim();
  if (!t.toLowerCase().startsWith('<svg') || t.length > 100_000) return null;
  if (/<script|javascript:|\son\w+\s*=|<foreignobject|href\s*=\s*["']\s*(?!#)/i.test(t)) return null;
  try {
    const dir = ensureBrandAssetsDir();
    const hash = createHash('md5').update(t).digest('hex').substring(0, 12);
    const filename = `${hash}.svg`;
    writeFileSync(join(dir, filename), t, 'utf-8');
    return { localPath: `/brand-assets/${filename}`, filename, size: Buffer.byteLength(t) };
  } catch {
    return null;
  }
}

/** Try to download a logo from a URL. Returns null if it fails or is too small. */
async function tryDownloadLogo(imageUrl: string, source: string, harvestScore?: number): Promise<LogoCandidate | null> {
  try {
    const result = await downloadAndProxyImage(imageUrl);
    if (!result.success || !result.localUrl || !result.filename) return null;

    const size = result.size ?? 0;
    if (size < MIN_LOGO_SIZE) {
      const filePath = join(getBrandAssetsDir(), result.filename);
      if (existsSync(filePath)) {
        try {
          unlinkSync(filePath);
        } catch {
          /* best-effort cleanup */
        }
      }
      return null;
    }

    return {
      url: imageUrl,
      localPath: result.localUrl,
      filename: result.filename,
      size,
      contentType: result.contentType || 'image/png',
      source,
      ...(harvestScore !== undefined ? { harvestScore } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Extract logo candidates from multiple strategies (agent-proposed URLs +
 * design-system/favicon URLs + og:image + header <img logo> + common paths), and
 * return every successfully downloaded candidate for ranking by `selectBestLogo`.
 * On a detected builder host, assets served from the builder's own marketing host
 * are rejected (its default favicon/logo, never the owner's).
 */
export async function extractLogoCandidates(
  websiteUrl: string,
  extraUrls: Array<{ url: string; source: string; score?: number }> = [],
  builder?: SiteBuilder | null,
): Promise<LogoCandidate[]> {
  const candidates: LogoCandidate[] = [];
  const tried = new Set<string>();
  const originUrl = new URL(websiteUrl);
  const origin = originUrl.origin;
  const siteHost = originUrl.host;

  const resolveUrl = (href: string): string => {
    try {
      return new URL(href, origin).href;
    } catch {
      return '';
    }
  };

  const tryUrl = async (url: string | null | undefined, source: string, score?: number): Promise<void> => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return;
    if (tried.has(url)) return;
    tried.add(url);
    if (builder && isBuilderPromoAsset(url, builder, siteHost)) return;
    const c = await tryDownloadLogo(url, source, score);
    if (c) candidates.push(c);
  };

  // Strategy 1: caller-provided URLs (rendered-header harvest + dembrandt logo/favicons).
  for (const { url, source, score } of extraUrls) await tryUrl(url, source, score);

  // Strategy 2: fetch homepage HTML and extract og:image, header <img logo>, icons.
  const htmlUrls: Array<{ url: string; source: string }> = [];
  try {
    const res = await guardedFetchFollow(websiteUrl, { headers: HTML_HEADERS, timeoutMs: 10_000 });
    if (res.ok) {
      const html = await res.text();

      const ogMatch =
        html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
      if (ogMatch?.[1]) htmlUrls.push({ url: resolveUrl(ogMatch[1]), source: 'og-image' });

      const headerHtml = html.substring(0, Math.floor(html.length * 0.3));
      const imgRegex = /<img[^>]*(?:class|alt|src|id)=[^>]*logo[^>]*>/gi;
      let imgMatch: RegExpExecArray | null;
      while ((imgMatch = imgRegex.exec(headerHtml)) !== null) {
        const srcMatch = imgMatch[0].match(/src=["']([^"']+)["']/i);
        if (srcMatch?.[1]) htmlUrls.push({ url: resolveUrl(srcMatch[1]), source: 'html-logo-img' });
      }

      const touchMatch = html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i);
      if (touchMatch?.[1]) htmlUrls.push({ url: resolveUrl(touchMatch[1]), source: 'apple-touch-icon' });

      for (const m of html.matchAll(/<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["'][^>]*>/gi)) {
        if (m[1]) htmlUrls.push({ url: resolveUrl(m[1]), source: 'favicon-link' });
      }
    }
  } catch (err) {
    console.warn(`[brand-assets] HTML fetch failed for logo extraction: ${err instanceof Error ? err.message : err}`);
  }

  if (htmlUrls.length > 0) {
    await Promise.allSettled(htmlUrls.map(({ url, source }) => tryUrl(url, source)));
  }

  // Strategy 3: common paths on the domain.
  const priorityPaths = COMMON_LOGO_PATHS.slice(0, 6);
  await Promise.allSettled(priorityPaths.map((p) => tryUrl(`${origin}${p}`, 'common-path')));

  console.log(
    `[brand-assets] Found ${candidates.length} logo candidate(s): ${candidates.map((c) => `${c.source}:${c.filename}(${c.size}B)`).join(', ')}`,
  );
  return candidates;
}

/**
 * Trust tier dominates: what the RENDERED PAGE actually shows as the logo (the rendered-header
 * harvest) beats everything; then a logo the owner deliberately PLACED (an explicit header
 * `<img class=...logo>`, an agent/design-system-provided logo, or a `/logo.svg` at a
 * conventional path); DERIVED assets (og:image, favicon, touch-icon) are the last resort —
 * they are almost never the logo (og:image is a social banner; a 380KB touch-icon was served
 * as "the logo" pre-fix, operator report 2026-07-11). Within a tier: harvest score, then
 * format (SVG > PNG > other, photos/JPEGs demoted).
 */
const SOURCE_TIER: Record<string, number> = {
  'rendered-header': 3,
  agent: 2, 'design-system': 2, 'html-logo-img': 2, 'common-path': 2,
  'og-image': 1, 'agent-icon': 1, 'apple-touch-icon': 1, 'favicon-link': 1, favicon: 1,
};

const SOURCE_SCORE: Record<string, number> = {
  'rendered-header': 6,
  agent: 5, 'design-system': 5, 'html-logo-img': 4, 'common-path': 3,
  'og-image': 3, 'agent-icon': 2, 'apple-touch-icon': 2, 'favicon-link': 0, favicon: 0,
};

export function selectBestLogo(candidates: LogoCandidate[]): LogoCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  return (
    [...candidates].sort((a, b) => {
    const aTier = SOURCE_TIER[a.source] ?? 2;
    const bTier = SOURCE_TIER[b.source] ?? 2;
    if (aTier !== bTier) return bTier - aTier;

    // Rendered-harvest placement score dominates within its tier.
    const aHarvest = a.harvestScore ?? -1;
    const bHarvest = b.harvestScore ?? -1;
    if (aHarvest !== bHarvest) return bHarvest - aHarvest;

    const aIsSvg = a.contentType.includes('svg') ? 1 : 0;
    const bIsSvg = b.contentType.includes('svg') ? 1 : 0;
    if (aIsSvg !== bIsSvg) return bIsSvg - aIsSvg;

    // Photographs are almost never logos: a JPEG loses to any non-JPEG peer.
    const aIsJpeg = a.contentType.includes('jpeg') || a.contentType.includes('jpg') ? 1 : 0;
    const bIsJpeg = b.contentType.includes('jpeg') || b.contentType.includes('jpg') ? 1 : 0;
    if (aIsJpeg !== bIsJpeg) return aIsJpeg - bIsJpeg;

    const aScore = SOURCE_SCORE[a.source] ?? 1;
    const bScore = SOURCE_SCORE[b.source] ?? 1;
    if (aScore !== bScore) return bScore - aScore;

    const aIsPng = a.contentType.includes('png') ? 1 : 0;
    const bIsPng = b.contentType.includes('png') ? 1 : 0;
    if (aIsPng !== bIsPng) return bIsPng - aIsPng;

      return Math.min(b.size, 500_000) - Math.min(a.size, 500_000);
    })[0] ?? null
  );
}

/**
 * Resolve the best local logo path for a site. Ties the extraction + selection together:
 * downloads all candidates (rendered-header harvest + design-system + HTML + common paths),
 * folds in pre-stored inline-SVG logos, picks the best heuristically, and - when the caller
 * supplies the rendered header strip - lets ONE vision call override the pick among the raster
 * candidates ("which of these is the logo actually shown on the site?"). Returns the winner's
 * `/brand-assets/<file>` path or null.
 */
export interface ResolveBrandLogoInput {
  websiteUrl: string;
  extraUrls?: Array<{ url: string; source: string; score?: number }>;
  builder?: SiteBuilder | null;
  /** Inline-SVG logos already stored by the caller (rendered-header harvest). */
  preStored?: Array<{ localPath: string; filename: string; size: number; score: number }>;
  /** Vision confirmation inputs - omitted in tests / when the render produced no header shot. */
  vision?: {
    headerShot: Buffer;
    pick: (args: { headerShot: Buffer; candidates: LogoCandidate[] }) => Promise<LogoCandidate | null>;
  };
}

export async function resolveBrandLogo(input: ResolveBrandLogoInput): Promise<string | null> {
  const candidates = await extractLogoCandidates(input.websiteUrl, input.extraUrls ?? [], input.builder);
  for (const p of input.preStored ?? []) {
    candidates.push({
      url: '',
      localPath: p.localPath,
      filename: p.filename,
      size: p.size,
      contentType: 'image/svg+xml',
      source: 'rendered-header',
      harvestScore: p.score,
    });
  }
  const best = selectBestLogo(candidates);
  if (!best) return null;

  // Vision gate: a high-scoring inline header SVG IS the rendered logo (trust it outright);
  // otherwise let the model compare the raster candidates against the header strip.
  if (input.vision && !(best.source === 'rendered-header' && best.contentType.includes('svg'))) {
    try {
      const picked = await input.vision.pick({ headerShot: input.vision.headerShot, candidates });
      if (picked) {
        if (picked.localPath !== best.localPath) {
          console.log(`[brand-assets] vision overrode heuristic pick: ${best.source}:${best.filename} -> ${picked.source}:${picked.filename}`);
        }
        return picked.localPath;
      }
    } catch {
      /* vision is best-effort - keep the heuristic pick */
    }
  }
  return best.localPath;
}
