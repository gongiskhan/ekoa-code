/**
 * Image dimension probing + logo-shape classification + oversized-logo rescue (ch05 §5.6.4).
 *
 * The logo selector can only rank what it can measure. Source labels alone proved
 * insufficient live (2026-08-07, ekoa.io/info): the only surviving candidates were a real
 * 256x256 icon and the site's 1200x630 og:image social banner - both labelled `favicon` by
 * the design-system extractor - and the byte-size tie-break crowned the banner. Dimensions
 * tell the two apart deterministically: an og:image card has a banner shape no real logo
 * has.
 *
 * The second live failure this module fixes: legitimate logos served as huge unoptimized
 * PNGs (ekoa.io ships its 2048x2048 logo as 4.5MB). The old flat 1.5MB download cap
 * silently discarded the REAL logo proposed by the rendered-header harvest, leaving only
 * derived assets to pick from. Rasters are now accepted up to a larger source cap and
 * downscaled/re-encoded to a bounded stored size with `sharp`.
 */

import sharp from 'sharp';

export interface ImageDims {
  width: number;
  height: number;
}

/** Longest side of a stored logo after rescue-downscaling. */
export const STORED_LOGO_MAX_SIDE = 1024;
/** A stored logo may never exceed this many bytes, even after re-encoding. */
export const MAX_STORED_LOGO_BYTES = 1_500_000;

const RASTER_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif', 'avif']);

/**
 * Probe a downloaded image's pixel dimensions. Vector (svg) and icon-container (ico)
 * formats return null - svg scales to any size and ico is a multi-image container;
 * neither needs shape policing. Non-fatal: unparseable bytes return null.
 */
export async function probeImageDims(buf: Buffer, contentType: string): Promise<ImageDims | null> {
  if (contentType.includes('svg') || contentType.includes('ico') || contentType.includes('icon')) return null;
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/**
 * True for the social-card shape (og:image / twitter:image): wide-and-TALL. The standard
 * card sizes are 1200x630, 1200x628, 1024x512 - aspect ~1.45-2.2 with real height. A
 * horizontal logo lockup is also wide, but short: its height stays far below a card's.
 * Both conditions are required - a 300x160 thumbnail or a 900x300 wordmark never matches.
 */
export function isSocialBannerShape(dims: ImageDims | null | undefined): boolean {
  if (!dims) return false;
  const aspect = dims.width / Math.max(1, dims.height);
  return dims.width >= 600 && dims.height >= 320 && aspect >= 1.45 && aspect <= 2.2;
}

/**
 * Shape score for tie-breaking candidates within a trust tier: how much do these
 * dimensions look like a logo (icon or lockup) rather than page imagery? 0 when
 * dimensions are unknown, so dimension-less candidates (svg/ico) fall through to the
 * later tie-breaks unchanged.
 */
export function logoShapeScore(dims: ImageDims | null | undefined): number {
  if (!dims) return 0;
  const aspect = dims.width / Math.max(1, dims.height);
  let score = 0;
  // Logo-ish aspect: square mark through horizontal lockup.
  if (aspect >= 0.5 && aspect <= 6) score += 2;
  // Enough resolution to be the deliberate asset, not a 16px favicon.
  if (Math.max(dims.width, dims.height) >= 64) score += 1;
  // The social-card shape is anti-logo evidence even when the banner flag missed.
  if (isSocialBannerShape(dims)) score -= 3;
  return score;
}

/**
 * Rescue an oversized raster: bound the longest side to {STORED_LOGO_MAX_SIDE} and
 * re-encode in the same family (png stays png for transparency, jpeg/webp keep their
 * format). Returns null when the bytes are not a decodable raster or the result still
 * exceeds {MAX_STORED_LOGO_BYTES} - the caller then drops the candidate as before.
 */
export async function downscaleToStorableLogo(
  buf: Buffer,
): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.format || !RASTER_FORMATS.has(meta.format)) return null;
    let pipeline = sharp(buf).resize({
      width: STORED_LOGO_MAX_SIDE,
      height: STORED_LOGO_MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    });
    let outType: string;
    if (meta.format === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: 85 });
      outType = 'image/jpeg';
    } else if (meta.format === 'webp') {
      pipeline = pipeline.webp({ quality: 90 });
      outType = 'image/webp';
    } else {
      // png/gif/avif -> png: keeps transparency, and the dashboard renders png everywhere.
      pipeline = pipeline.png({ compressionLevel: 9 });
      outType = 'image/png';
    }
    const out = await pipeline.toBuffer();
    if (out.length > MAX_STORED_LOGO_BYTES) return null;
    return { buf: out, contentType: outType };
  } catch {
    return null;
  }
}
