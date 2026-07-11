import { describe, it, expect } from 'vitest';
import {
  extractColorCandidates,
  classifyHue,
  isNeutralGray,
  computeBrandFit,
  extractStylesheetHrefs,
  seedWithThemeColor,
  summarizeSiteContext,
  type SiteContext,
} from '../../../src/services/branding/site-context.js';

/**
 * Brand-research site-context parsing (ch05 §5.6.4). Pure HTML/CSS extraction - the deterministic
 * server-side snapshot the tool-less agent reads. No network here; these exercise the parsers on
 * fixtures.
 */
describe('extractColorCandidates', () => {
  it('extracts 6-digit hex, 3-digit hex (expanded), and rgb()/rgba() and drops neutrals', () => {
    const css = `
      .a { color: #0d9488; background: #0d9488; }
      .b { color: #f0b11a; }
      .c { color: #0c9; }               /* expands to #00cc99 */
      .d { color: rgb(16, 50, 207); }
      .e { color: #ffffff; border: 1px solid #000; }  /* neutrals dropped */
      .f { color: #333333; }            /* neutral gray dropped */
    `;
    const cands = extractColorCandidates(css);
    const hexes = cands.map((c) => c.hex);
    expect(hexes).toContain('#0d9488');
    expect(hexes).toContain('#f0b11a');
    expect(hexes).toContain('#00cc99');
    expect(hexes).toContain('#1032cf');
    expect(hexes).not.toContain('#ffffff');
    expect(hexes).not.toContain('#333333');
    // #0d9488 appears twice -> highest count -> ranked first.
    expect(cands[0]!.hex).toBe('#0d9488');
    expect(cands[0]!.count).toBe(2);
  });

  it('tags each candidate with hue bucket, saturation, lightness and brandFit', () => {
    const [teal] = extractColorCandidates('.a{color:#0d9488}');
    expect(teal!.bucket).toBe('teal-cyan');
    expect(teal!.brandFit).toBeGreaterThan(0);
    expect(teal!.lightness).toBeGreaterThan(0);
    expect(teal!.lightness).toBeLessThan(1);
  });
});

describe('classifyHue', () => {
  it('buckets by hue family', () => {
    expect(classifyHue('#e11d48')).toBe('red');
    expect(classifyHue('#f0b11a')).toBe('orange-amber');
    expect(classifyHue('#16a34a')).toBe('green');
    expect(classifyHue('#0d9488')).toBe('teal-cyan');
    expect(classifyHue('#1032cf')).toBe('blue');
    expect(classifyHue('#7c3aed')).toBe('violet');
  });
});

describe('isNeutralGray', () => {
  it('flags black/white/low-chroma and passes saturated colors', () => {
    expect(isNeutralGray('#ffffff')).toBe(true);
    expect(isNeutralGray('#000000')).toBe(true);
    expect(isNeutralGray('#808080')).toBe(true);
    expect(isNeutralGray('#0d9488')).toBe(false);
    expect(isNeutralGray('#f0b11a')).toBe(false);
  });
});

describe('computeBrandFit', () => {
  it('rewards saturated mid-lightness and penalizes very light washed accents', () => {
    const mid = computeBrandFit(0.8, 0.4); // saturated, mid lightness
    const pale = computeBrandFit(0.4, 0.85); // washed near-white accent
    expect(mid).toBeGreaterThan(pale);
    expect(mid).toBeGreaterThan(0.5);
  });
});

describe('extractStylesheetHrefs', () => {
  it('resolves stylesheet links (both attribute orders) to absolute URLs and caps the count', () => {
    const html = `
      <link rel="stylesheet" href="/css/app.css">
      <link href="https://cdn.example.com/theme.css" rel="stylesheet">
      <link rel="preload" as="style" href="/css/preload.css">
      <link rel="preload" as="script" href="/js/ignore.js">
    `;
    const hrefs = extractStylesheetHrefs(html, 'https://site.pt/');
    expect(hrefs).toContain('https://site.pt/css/app.css');
    expect(hrefs).toContain('https://cdn.example.com/theme.css');
    expect(hrefs).toContain('https://site.pt/css/preload.css');
    expect(hrefs).not.toContain('https://site.pt/js/ignore.js');
  });
});

describe('seedWithThemeColor', () => {
  it('prepends a non-neutral theme-color as a high-count candidate', () => {
    const base = extractColorCandidates('.a{color:#f0b11a}');
    const seeded = seedWithThemeColor(base, '#0d9488');
    expect(seeded[0]!.hex).toBe('#0d9488');
    expect(seeded[0]!.count).toBeGreaterThanOrEqual(50);
  });

  it('ignores a neutral theme-color', () => {
    const base = extractColorCandidates('.a{color:#f0b11a}');
    const seeded = seedWithThemeColor(base, '#ffffff');
    expect(seeded[0]!.hex).toBe('#f0b11a');
  });
});

describe('summarizeSiteContext', () => {
  it('prefers the rendered candidates and includes the CSS buckets + text sample', () => {
    const ctx: SiteContext = {
      url: 'https://site.pt',
      finalUrl: 'https://site.pt',
      status: 200,
      ok: true,
      title: 'Marca',
      description: null,
      ogSiteName: null,
      ogImage: null,
      themeColor: '#0d9488',
      favicon: null,
      generator: null,
      colorCandidates: extractColorCandidates('.a{color:#0d9488}.b{color:#f0b11a}'),
      fontCandidates: ['Inter'],
      textSample: 'Somos uma empresa de exemplo.',
    };
    const rendered = extractColorCandidates('.a{color:#0d9488}').map((c) => ({ ...c, source: 'rendered-area' as const }));
    const summary = summarizeSiteContext(ctx, rendered);
    expect(summary).toContain('Rendered brand-color candidates');
    expect(summary).toContain('#0d9488');
    expect(summary).toContain('Inter');
    expect(summary).toContain('Somos uma empresa');
  });
});
