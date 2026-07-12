import { describe, it, expect } from 'vitest';
import { scrubBuilderChrome, buildGroundedPrompt, collectAllowedHexes } from '../../../src/services/branding/snapshot.js';
import { extractColorCandidates, type SiteContext } from '../../../src/services/branding/site-context.js';
import { SITE_BUILDERS } from '../../../src/services/branding/site-builder.js';
import type { RenderedCandidates } from '../../../src/services/branding/rendered-candidates.js';
import type { DesignSystem } from '../../../src/services/branding/design-system.js';
import type { VisualVibe } from '../../../src/services/branding/visual-vibe.js';

function makeSite(over: Partial<SiteContext> = {}): SiteContext {
  return {
    url: 'https://marilia.webnode.pt',
    finalUrl: 'https://marilia.webnode.pt/',
    status: 200,
    ok: true,
    title: 'Marília',
    description: null,
    ogSiteName: null,
    ogImage: null,
    themeColor: null,
    favicon: null,
    generator: 'Webnode',
    colorCandidates: extractColorCandidates('.stripe{color:#0097f5}.brand{color:#0d9488}'),
    fontCandidates: ['Metropolis', 'Montserrat Flex'],
    textSample: 'Texto visível.',
    ...over,
  };
}

const emptyRendered: RenderedCandidates = { ok: false, candidates: [], paintedHexes: [], topFonts: [], chromeColors: [], chromeFonts: [] };

/**
 * Snapshot assembly + builder-chrome scrub (ch05 §5.6.4). Pure - no browser, no model.
 */
describe('scrubBuilderChrome', () => {
  it('intersects CSS candidates/fonts with the rendered (painted) set on a builder site', () => {
    const webnode = SITE_BUILDERS.find((b) => b.id === 'webnode')!;
    const site = makeSite();
    const rendered: RenderedCandidates = {
      ok: true,
      candidates: [],
      paintedHexes: ['#0d9488'], // only the owner colour actually paints; the stripe was stripped
      topFonts: ['Metropolis'],
      chromeColors: ['#0097f5'],
      chromeFonts: ['montserrat flex'],
    };
    const ds: DesignSystem = {
      url: 'https://marilia.webnode.pt/',
      extractedAt: 'x',
      colors: {
        palette: [
          { color: '#0097f5', normalized: '#0097f5', count: 40, confidence: 'medium', sources: ['wnd-free-stripe'] },
          { color: '#0d9488', normalized: '#0d9488', count: 200, confidence: 'high', sources: ['header'] },
        ],
      },
    };
    const out = scrubBuilderChrome(site, rendered, ds, webnode);
    expect(out.site.colorCandidates.map((c) => c.hex)).toEqual(['#0d9488']);
    expect(out.site.fontCandidates).toEqual(['Metropolis']);
    expect(out.designSystem?.colors?.palette?.map((p) => p.normalized)).toEqual(['#0d9488']);
  });

  it('leaves the site untouched when no builder is detected (site scrub is builder-specific)', () => {
    const site = makeSite({ generator: null });
    const out = scrubBuilderChrome(site, emptyRendered, null, null);
    expect(out.site).toBe(site);
    expect(out.designSystem).toBeNull();
  });

  it('still strips cookie-consent chrome from the design system with NO builder (live: plmj.com Cookiebot)', () => {
    const site = makeSite({ generator: null });
    const ds = {
      url: 'https://www.plmj.com/',
      extractedAt: 'x',
      colors: {
        palette: [
          { color: '#ffffff', normalized: '#ffffff', count: 298, confidence: 'high' as const, sources: ['cybotcookiebotdialognavitemlin'] },
          { color: '#110088', normalized: '#110088', count: 40, confidence: 'high' as const, sources: ['header'] },
        ],
      },
    };
    const out = scrubBuilderChrome(site, emptyRendered, ds, null);
    expect(out.designSystem?.colors?.palette?.map((p) => p.normalized)).toEqual(['#110088']);
  });
});

describe('buildGroundedPrompt', () => {
  const vibe: VisualVibe = { mood: 'moderno minimalista', bullets: ['tipografia grande'], shape: 'rounded', density: 'minimal', texture: 'flat', hero: 'bloco de cor sólida' };

  it('grounds the model on the snapshot and selects the design-system colour rules when present', () => {
    const site = makeSite({ generator: null });
    const ds: DesignSystem = {
      url: 'https://site.pt/',
      extractedAt: 'x',
      colors: { palette: [{ color: '#0d9488', normalized: '#0d9488', count: 100, confidence: 'high', sources: ['button'] }], cssVariables: { '--primary': { value: '#0d9488' } } },
    };
    const prompt = buildGroundedPrompt({ site, rendered: emptyRendered, designSystem: ds, visualVibe: vibe, builder: null });
    expect(prompt).toContain('Snapshot do site');
    expect(prompt).toContain('Usa APENAS a informação do snapshot');
    expect(prompt).toContain('com sinais do sistema de design'); // design-system rules chosen
    expect(prompt).toContain('Vibe visual'); // vibe section injected
    expect(prompt).toContain('moderno minimalista');
  });

  it('falls back to the CSS-bucket colour rules when there is no rendered or design-system signal', () => {
    const site = makeSite({ generator: null });
    const prompt = buildGroundedPrompt({ site, rendered: emptyRendered, designSystem: null, visualVibe: null, builder: null });
    expect(prompt).toContain('agrupados por bucket de matiz');
    // The guidance text references "Vibe visual" unconditionally; the SECTION header (## ...) is
    // what's absent when there is no vibe.
    expect(prompt).not.toContain('## Vibe visual');
  });

  it('injects the pixel-sampled section + rule when the render surfaced screenshot candidates (imagery-branded site)', () => {
    // Live 2026-07-12 (mariliasantoscabral.webnode.pt): the navy exists only inside the hero
    // JPEG; without this section the prompt offered exactly four grayscale hexes and the model
    // could only return neutrals.
    const site = makeSite({ generator: null, colorCandidates: [] });
    const rendered: RenderedCandidates = {
      ...emptyRendered,
      ok: true,
      screenshotCandidates: [
        { hex: '#2a3547', count: 9_000, bucket: 'blue', saturation: 0.26, lightness: 0.22, brandFit: 0.26, source: 'screenshot' },
      ],
    };
    const prompt = buildGroundedPrompt({ site, rendered, designSystem: null, visualVibe: null, builder: null });
    expect(prompt).toContain('## Cores amostradas dos píxeis da página');
    expect(prompt).toContain('#2a3547');
    // The neutral ban + the pixel preference rule ride the color rules.
    expect(prompt).toContain('NUNCA serve como primaryColor');
    expect(prompt).toContain('usa a PRIMEIRA entrada não-neutra dessa secção como primaryColor');
  });

  it('omits the pixel section when the computed-style walk painted real colors', () => {
    const site = makeSite({ generator: null });
    const prompt = buildGroundedPrompt({ site, rendered: emptyRendered, designSystem: null, visualVibe: null, builder: null });
    expect(prompt).not.toContain('## Cores amostradas dos píxeis da página');
  });
});

describe('collectAllowedHexes', () => {
  it('gathers every snapshot-evidence hex (site CSS, theme-color, rendered, screenshot, design-system palette + css vars), normalized', () => {
    const site = makeSite({ generator: null, themeColor: '#ABC' }); // 3-digit uppercase -> #aabbcc
    const rendered: RenderedCandidates = {
      ...emptyRendered,
      ok: true,
      candidates: [{ hex: '#1032cf', count: 100, bucket: 'blue', saturation: 0.8, lightness: 0.44, brandFit: 0.8, source: 'rendered-area' }],
      screenshotCandidates: [{ hex: '#2a3547', count: 9_000, bucket: 'blue', saturation: 0.26, lightness: 0.22, brandFit: 0.26, source: 'screenshot' }],
    };
    const ds: DesignSystem = {
      url: 'https://site.pt/',
      extractedAt: 'x',
      colors: {
        palette: [{ color: '#F0B11A', normalized: '#f0b11a', count: 10, confidence: 'medium', sources: ['icon'] }],
        cssVariables: { '--brand': { value: '#00AA88' } },
      },
    };
    const allowed = collectAllowedHexes({ site, rendered, designSystem: ds, visualVibe: null, builder: null });
    expect(allowed.has('#aabbcc')).toBe(true); // theme-color, expanded + lowercased
    expect(allowed.has('#1032cf')).toBe(true); // rendered
    expect(allowed.has('#2a3547')).toBe(true); // screenshot fallback
    expect(allowed.has('#f0b11a')).toBe(true); // palette
    expect(allowed.has('#00aa88')).toBe(true); // css variable, lowercased
    expect(allowed.has('#0d9488')).toBe(true); // the site CSS scan fixture carries the teal literal
    // Nothing outside the evidence.
    expect(allowed.has('#123456')).toBe(false);
  });

  it('yields an empty set for an evidence-free snapshot (nothing is ever allowed by default)', () => {
    const site = makeSite({ generator: null, colorCandidates: [], themeColor: null });
    const allowed = collectAllowedHexes({ site, rendered: emptyRendered, designSystem: null, visualVibe: null, builder: null });
    expect(allowed.size).toBe(0);
  });
});
