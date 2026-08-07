import { describe, it, expect } from 'vitest';
import { selectBestLogo, type LogoCandidate } from '../../../src/services/branding/brand-assets.js';

/**
 * Logo selection ranking (ch05 §5.6.4). The download side needs the network; `selectBestLogo` is
 * pure and encodes the trust-tier rule that fixes the Webnode bug (a real header logo must beat a
 * builder default favicon regardless of format).
 */
function cand(over: Partial<LogoCandidate>): LogoCandidate {
  return { url: 'https://x', localPath: '/brand-assets/x.png', filename: 'x.png', size: 4000, contentType: 'image/png', source: 'agent', ...over };
}

describe('selectBestLogo', () => {
  it('returns null for no candidates and the sole candidate for one', () => {
    expect(selectBestLogo([])).toBeNull();
    const only = cand({ source: 'favicon-link' });
    expect(selectBestLogo([only])).toBe(only);
  });

  it('a real header PNG logo beats a default favicon SVG (trust tier dominates format)', () => {
    const favSvg = cand({ source: 'favicon-link', contentType: 'image/svg+xml', filename: 'fav.svg', localPath: '/brand-assets/fav.svg' });
    const headerPng = cand({ source: 'html-logo-img', contentType: 'image/png', filename: 'logo.png', localPath: '/brand-assets/logo.png' });
    expect(selectBestLogo([favSvg, headerPng])).toBe(headerPng);
  });

  it('within the same trust tier, SVG beats PNG', () => {
    const png = cand({ source: 'common-path', contentType: 'image/png', filename: 'a.png' });
    const svg = cand({ source: 'common-path', contentType: 'image/svg+xml', filename: 'b.svg' });
    expect(selectBestLogo([png, svg])).toBe(svg);
  });

  it('a design-system logo is treated as a deliberately-placed (tier-2) logo, beating og:image', () => {
    const og = cand({ source: 'og-image', contentType: 'image/png', filename: 'og.png' });
    const ds = cand({ source: 'design-system', contentType: 'image/png', filename: 'ds.png' });
    expect(selectBestLogo([og, ds])).toBe(ds);
  });

  it('the RENDERED-header harvest (tier 3) beats every other source - live: a 380KB touch-icon won over the real logo (2026-07-11)', () => {
    const touchIcon = cand({ source: 'favicon', contentType: 'image/png', filename: 'touch.png', size: 380_761 });
    const ds = cand({ source: 'design-system', contentType: 'image/png', filename: 'ds.png' });
    const rendered = cand({ source: 'rendered-header', contentType: 'image/png', filename: 'hdr.png', harvestScore: 120, size: 8_000 });
    expect(selectBestLogo([touchIcon, ds, rendered])).toBe(rendered);
  });

  it('within rendered-header, the higher placement score wins', () => {
    const low = cand({ source: 'rendered-header', filename: 'low.png', harvestScore: 45 });
    const high = cand({ source: 'rendered-header', filename: 'high.png', harvestScore: 130 });
    expect(selectBestLogo([low, high])).toBe(high);
  });

  it('a JPEG (photo) loses to a non-JPEG peer within the same tier', () => {
    const photo = cand({ source: 'favicon', contentType: 'image/jpeg', filename: 'photo.jpg', size: 105_299 });
    const png = cand({ source: 'favicon-link', contentType: 'image/png', filename: 'icon.png', size: 2_000 });
    expect(selectBestLogo([photo, png])).toBe(png);
  });

  it('a banner-shaped candidate loses to a real icon regardless of source and byte size - live: the og:image banner beat the 256x256 icon on bytes (ekoa.io/info, 2026-08-07)', () => {
    // Both arrived labelled `favicon` via the design-system extractor; only the measured
    // shape tells them apart.
    const ogBanner = cand({ source: 'favicon', filename: 'og.png', size: 380_761, dims: { width: 1200, height: 630 }, banner: true });
    const icon = cand({ source: 'favicon', filename: 'icon.png', size: 53_781, dims: { width: 256, height: 256 } });
    expect(selectBestLogo([ogBanner, icon])).toBe(icon);
  });

  it('a banner-shaped candidate drops below even a favicon-link from another tier', () => {
    const banner = cand({ source: 'html-logo-img', filename: 'wide.png', size: 900_000, dims: { width: 1200, height: 630 }, banner: true });
    const fav = cand({ source: 'favicon-link', filename: 'fav.png', size: 2_000 });
    expect(selectBestLogo([banner, fav])).toBe(fav);
  });

  it('within a tier, measured logo shape beats raw byte size', () => {
    // An ultra-wide strip (page divider / decorative band, aspect > 6) vs a square mark:
    // the mark wins even though the strip has far more bytes.
    const strip = cand({ source: 'favicon', filename: 'strip.png', size: 450_000, dims: { width: 1400, height: 160 } });
    const mark = cand({ source: 'favicon', filename: 'mark.png', size: 20_000, dims: { width: 512, height: 512 } });
    expect(selectBestLogo([strip, mark])).toBe(mark);
  });

  it('dimension-less candidates keep the pre-dims byte-size behaviour', () => {
    const small = cand({ source: 'favicon', filename: 'a.png', size: 10_000 });
    const big = cand({ source: 'favicon', filename: 'b.png', size: 90_000 });
    expect(selectBestLogo([small, big])).toBe(big);
  });
});

describe('storeSvgLogo', () => {
  it('stores a clean inline svg and rejects active content', async () => {
    const { mkdtempSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    // dataDir() is late-bound (read per call) - point it at a throwaway dir for this test.
    const prev = process.env.EKOA_DATA_DIR;
    process.env.EKOA_DATA_DIR = mkdtempSync(join(tmpdir(), 'ekoa-brand-test-'));
    try {
      const { storeSvgLogo, getBrandAssetsDir } = await import('../../../src/services/branding/brand-assets.js');

      const ok = storeSvgLogo('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#110088"/></svg>');
      expect(ok).not.toBeNull();
      expect(ok!.localPath).toMatch(/^\/brand-assets\/[0-9a-f]{12}\.svg$/);
      expect(existsSync(join(getBrandAssetsDir(), ok!.filename))).toBe(true);

      expect(storeSvgLogo('<svg><script>alert(1)</script></svg>')).toBeNull();
      expect(storeSvgLogo('<svg onload="x()"></svg>')).toBeNull();
      expect(storeSvgLogo('<div>not svg</div>')).toBeNull();
      // external hrefs are rejected (fragment refs like href="#grad" stay allowed)
      expect(storeSvgLogo('<svg><use href="https://evil.example/x.svg#a"/></svg>')).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.EKOA_DATA_DIR;
      else process.env.EKOA_DATA_DIR = prev;
    }
  });
});
