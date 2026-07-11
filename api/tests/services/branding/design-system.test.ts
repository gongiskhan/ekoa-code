import { describe, it, expect } from 'vitest';
import {
  trimDesignSystem,
  filterDesignSystemChrome,
  isUsableLogoUrl,
  type DesignSystem,
} from '../../../src/services/branding/design-system.js';
import { SITE_BUILDERS } from '../../../src/services/branding/site-builder.js';

/**
 * Design-system trim/scrub (ch05 §5.6.4). `fetchDesignSystem` spawns the dembrandt subprocess;
 * these exercise the pure parse-output transforms - including the dembrandt 0.23 schema drift
 * (typography `family`/`size`/`weight`/`context`, inline-SVG logos).
 */
describe('trimDesignSystem', () => {
  it('normalizes dembrandt 0.23 typography field names into the stored shape', () => {
    const ds: DesignSystem = {
      url: 'https://site.pt/',
      extractedAt: '2026-07-11T00:00:00Z',
      colors: {
        palette: [
          { color: 'rgb(13,148,136)', normalized: '#0d9488', count: 200, confidence: 'high', sources: ['button'] },
          { color: 'rgb(1,1,1)', normalized: '#010101', count: 3, confidence: 'low', sources: ['x'] },
        ],
        cssVariables: { '--brand-primary': { value: '#0d9488' }, '--spacing': { value: '8px' } },
      },
      typography: {
        // 0.23 spellings (context/family/size/weight), not the old fontFamily/fontSize/...
        styles: [{ context: 'heading-2', family: 'sohne-var', size: '56px', weight: 300, lineHeight: '1.03' } as never],
      },
      borderRadius: { values: [{ value: '8px', count: 12, confidence: 'high', numericValue: 8 }] },
      spacing: { scaleType: '8px', commonValues: [{ px: '8px', count: 40, numericValue: 8 }] },
      shadows: [{ shadow: 'rgba(0,0,0,0.1) 0 2px 4px', count: 5, confidence: 'high' }],
      components: { buttons: [{ states: { default: { backgroundColor: 'rgb(13,148,136)', borderRadius: '8px' } } }] },
      frameworks: [{ name: 'Next.js', confidence: 'high' }],
    };
    const trimmed = trimDesignSystem(ds);
    expect(trimmed.typography.families).toContain('sohne-var');
    expect(trimmed.typography.styles[0]).toMatchObject({
      role: 'heading-2',
      fontFamily: 'sohne-var',
      fontSize: '56px',
      fontWeight: '300',
      lineHeight: '1.03',
    });
    // Low-confidence palette entry dropped; the brand-named CSS var kept, the spacing var dropped.
    expect(trimmed.palette.map((p) => p.hex)).toEqual(['#0d9488']);
    expect(trimmed.cssVariables.map((v) => v.name)).toEqual(['--brand-primary']);
    expect(trimmed.borderRadius.values[0]).toEqual({ value: '8px', count: 12 });
    expect(trimmed.frameworks).toEqual(['Next.js']);
    expect(trimmed.primaryButton?.backgroundColor).toBe('rgb(13,148,136)');
  });

  it('drops an inline-SVG logo (no downloadable url) and keeps a real image url', () => {
    const inline: DesignSystem = { url: 'https://site.pt/', extractedAt: 'x', logo: { source: 'svg', url: 'https://site.pt/', inline: true } };
    expect(trimDesignSystem(inline).logo).toBeNull();

    const real: DesignSystem = { url: 'https://site.pt/', extractedAt: 'x', logo: { source: 'img', url: 'https://site.pt/logo.png', width: 200, height: 60 } };
    expect(trimDesignSystem(real).logo).toMatchObject({ url: 'https://site.pt/logo.png', width: 200, height: 60 });
  });
});

describe('isUsableLogoUrl', () => {
  it('accepts an http(s) image url, rejects inline SVGs and relative refs', () => {
    expect(isUsableLogoUrl({ source: 'img', url: 'https://x.pt/logo.svg' })).toBe(true);
    expect(isUsableLogoUrl({ source: 'svg', url: 'https://x.pt/', inline: true })).toBe(false);
    expect(isUsableLogoUrl({ source: 'img', url: '/logo.svg' })).toBe(false);
    expect(isUsableLogoUrl(null)).toBe(false);
  });
});

describe('filterDesignSystemChrome', () => {
  it('scrubs palette entries + css variables + button bg matching discovered builder chrome colors', () => {
    const webnode = SITE_BUILDERS.find((b) => b.id === 'webnode')!;
    const ds: DesignSystem = {
      url: 'https://marilia.webnode.pt/',
      extractedAt: 'x',
      colors: {
        palette: [
          { color: 'rgb(0,151,245)', normalized: '#0097f5', count: 50, confidence: 'medium', sources: ['wnd-free-stripe'] }, // builder stripe
          { color: 'rgb(13,148,136)', normalized: '#0d9488', count: 200, confidence: 'high', sources: ['header'] }, // owner
        ],
        cssVariables: { '--brand': { value: '#0d9488' }, '--stripe': { value: '#0097f5' } },
      },
      components: { buttons: [{ states: { default: { backgroundColor: '#0097f5' } } }, { states: { default: { backgroundColor: '#0d9488' } } }] },
    };
    const filtered = filterDesignSystemChrome(ds, { chromeColors: ['#0097f5'], chromeFonts: [], builder: webnode });
    expect(filtered.colors?.palette?.map((p) => p.normalized)).toEqual(['#0d9488']);
    expect(Object.keys(filtered.colors?.cssVariables ?? {})).toEqual(['--brand']);
    // The builder-stripe button (first) is dropped; the owner's button survives.
    expect(filtered.components?.buttons?.[0]?.states?.default?.backgroundColor).toBe('#0d9488');
  });

  it('scrubs cookie-consent vendor chrome from the palette even with NO builder detected (live: plmj.com Cookiebot)', () => {
    const ds: DesignSystem = {
      url: 'https://www.plmj.com/',
      extractedAt: 'x',
      colors: {
        palette: [
          { color: '#ffffff', normalized: '#ffffff', count: 298, confidence: 'high', sources: ['cybotcookiebotdialognavitemlin', 'cybotcookiebotscrollbarcontain'] },
          { color: '#110088', normalized: '#110088', count: 40, confidence: 'high', sources: ['header', 'hero'] },
          // Mixed sources survive: the colour is also painted by owner elements.
          { color: '#000000', normalized: '#000000', count: 209, confidence: 'high', sources: ['cybotcookiebotdialogtabpanel', 'footer'] },
        ],
      },
    };
    const filtered = filterDesignSystemChrome(ds, { chromeColors: [], builder: null });
    expect(filtered.colors?.palette?.map((p) => p.normalized)).toEqual(['#110088', '#000000']);
  });

  it('keeps colours that are not in the discovered chrome set (no chrome -> no-op)', () => {
    const ds: DesignSystem = {
      url: 'https://site.pt/',
      extractedAt: 'x',
      colors: { palette: [{ color: '#0d9488', normalized: '#0d9488', count: 5, confidence: 'high', sources: ['x'] }] },
    };
    // No builder detected -> scrubBuilderChrome never calls this; called directly with no chrome
    // colours it must not touch the owner's palette.
    const filtered = filterDesignSystemChrome(ds, { chromeColors: [], builder: null });
    expect(filtered.colors?.palette).toHaveLength(1);
  });
});
