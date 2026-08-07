import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  probeImageDims,
  isSocialBannerShape,
  logoShapeScore,
  downscaleToStorableLogo,
  STORED_LOGO_MAX_SIDE,
} from '../../../src/services/branding/image-fit.js';

/**
 * Dimension probing + banner classification + oversized-logo rescue (ch05 §5.6.4). Both live
 * failures of 2026-08-07 (ekoa.io/info) are pinned here: the 1200x630 og:image banner must
 * classify as a banner, and a 2048x2048 4.5MB-class PNG must be rescued, not dropped.
 */

async function pngOf(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 15, g: 118, b: 110, alpha: 1 } } })
    .png()
    .toBuffer();
}

describe('probeImageDims', () => {
  it('reads png dimensions and returns null for svg/ico/garbage', async () => {
    expect(await probeImageDims(await pngOf(256, 256), 'image/png')).toEqual({ width: 256, height: 256 });
    expect(await probeImageDims(Buffer.from('<svg/>'), 'image/svg+xml')).toBeNull();
    expect(await probeImageDims(Buffer.from([0, 0, 1, 0]), 'image/x-icon')).toBeNull();
    expect(await probeImageDims(Buffer.from('not an image'), 'image/png')).toBeNull();
  });
});

describe('isSocialBannerShape', () => {
  it('flags the standard social-card shapes', () => {
    expect(isSocialBannerShape({ width: 1200, height: 630 })).toBe(true); // og:image standard
    expect(isSocialBannerShape({ width: 1024, height: 512 })).toBe(true);
    expect(isSocialBannerShape({ width: 1920, height: 1080 })).toBe(true); // 16:9 hero card
  });

  it('never flags marks, lockups, thumbnails, or unknown dimensions', () => {
    expect(isSocialBannerShape({ width: 256, height: 256 })).toBe(false); // square mark
    expect(isSocialBannerShape({ width: 2048, height: 2048 })).toBe(false); // big square logo
    expect(isSocialBannerShape({ width: 900, height: 300 })).toBe(false); // horizontal lockup (aspect 3)
    expect(isSocialBannerShape({ width: 300, height: 160 })).toBe(false); // small thumbnail
    expect(isSocialBannerShape(null)).toBe(false);
    expect(isSocialBannerShape(undefined)).toBe(false);
  });
});

describe('logoShapeScore', () => {
  it('ranks a mark above a banner and unknown dims neutral', () => {
    const mark = logoShapeScore({ width: 512, height: 512 });
    const banner = logoShapeScore({ width: 1200, height: 630 });
    const strip = logoShapeScore({ width: 1400, height: 160 });
    expect(mark).toBeGreaterThan(banner);
    expect(mark).toBeGreaterThan(strip);
    expect(logoShapeScore(null)).toBe(0);
  });
});

describe('downscaleToStorableLogo', () => {
  it('bounds an oversized png to STORED_LOGO_MAX_SIDE keeping png (the ekoa.io 2048x2048 rescue)', async () => {
    const big = await pngOf(2048, 2048);
    const rescued = await downscaleToStorableLogo(big);
    expect(rescued).not.toBeNull();
    expect(rescued!.contentType).toBe('image/png');
    const dims = await probeImageDims(rescued!.buf, rescued!.contentType);
    expect(dims).toEqual({ width: STORED_LOGO_MAX_SIDE, height: STORED_LOGO_MAX_SIDE });
  });

  it('never enlarges a small image', async () => {
    const small = await pngOf(200, 100);
    const rescued = await downscaleToStorableLogo(small);
    expect(rescued).not.toBeNull();
    expect(await probeImageDims(rescued!.buf, rescued!.contentType)).toEqual({ width: 200, height: 100 });
  });

  it('returns null for non-raster bytes', async () => {
    expect(await downscaleToStorableLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(await downscaleToStorableLogo(Buffer.from('garbage'))).toBeNull();
  });
});
