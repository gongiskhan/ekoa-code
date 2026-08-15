/**
 * Design tokens builder + `/api/design-tokens.css` byte-contract (ch03 §3.8.23,
 * ch07 §7.2.2, Amendment 2 Part 4). Covers the platform default (neutral palette,
 * system font, no logo), org-brand overlay, the Amendment-2 org isolation (an app
 * of org A never receives org B's tokens; a no-brand org gets the default), and the
 * HTTP contract (text/css, cache headers, ETag + 304, CORS *).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { generateDesignTokensCss, designTokensHandler, appIdFromRequest, type OrgBrand } from '../../src/services/design-tokens.js';

const ETAG_RE = /^W\/".+:[a-f0-9]{12}"$/;
/** The platform's fallback stack, appended after every brand family (DEFAULT_VARS). */
const DEFAULT_SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

describe('generateDesignTokensCss · platform default', () => {
  it('serves the neutral palette, system font stack and no logo when there is no brand', async () => {
    const { css, etag } = await generateDesignTokensCss(undefined, { resolveOrgBrand: async () => null });
    expect(css).toContain(':root {');
    expect(css).toContain('--color-primary: #0F766E;'); // platform default teal
    expect(css).toContain('--font-sans: system-ui');
    expect(css).toContain('--logo-url: ;'); // no logo
    expect(etag).toMatch(ETAG_RE);
  });
});

describe('generateDesignTokensCss · org brand overlay', () => {
  it('applies the org brand colours and logo', async () => {
    const brand: OrgBrand = { branding: { primaryColor: '#FF00AA', logo: 'acme-logo.png' }, updatedAt: '2026-07-01' };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(css).toContain('--color-primary: #FF00AA;');
    expect(css).toContain('--logo-url: url("/brand-assets/acme-logo.png");');
  });
});

/** Read a single custom property out of the rendered `:root { … }` block. */
function varOf(css: string, name: string): string | undefined {
  const m = new RegExp(`^\\s*${name}: (.*);$`, 'm').exec(css);
  return m?.[1];
}

/** Channel sum of a `#RRGGBB` token - enough to tell a dark neutral from a light one. */
function brightness(hex: string): number {
  const rgb = parseInt(hex.replace('#', ''), 16);
  return ((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff);
}

describe('generateDesignTokensCss · brand fields the pipeline actually writes', () => {
  it('does not double-prefix a logo already stored as a served /brand-assets path', async () => {
    // The brand pipeline stores what it served (`/brand-assets/<file>`); prefixing it again
    // produced url("/brand-assets//brand-assets/x.png") - a 404 on every app that HAD a logo.
    const brand: OrgBrand = { branding: { logo: '/brand-assets/acme-mark.png' } };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(css).toContain('--logo-url: url("/brand-assets/acme-mark.png");');
    expect(css).not.toContain('/brand-assets//brand-assets/');
  });

  it('falls back to the logo for the compact mark, which nothing writes (the app shell reads it first)', async () => {
    const brand: OrgBrand = { branding: { logo: '/brand-assets/acme-mark.png' } };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(css).toContain('--logo-icon-url: url("/brand-assets/acme-mark.png");');
  });

  it('drops a remote logo reference instead of emitting a mangled path', async () => {
    const brand: OrgBrand = { branding: { logo: 'https://cdn.example.com/mark.png' } };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(css).toContain('--logo-url: ;');
    expect(css).not.toContain('cdn.example.com');
  });

  it('maps the researched fonts array onto the sans and display stacks', async () => {
    const brand: OrgBrand = { branding: { fonts: ['Inter', 'Lora'] } };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(varOf(css, '--font-sans')).toBe(`'Inter', ${DEFAULT_SANS}`);
    expect(varOf(css, '--font-display')).toBe(`'Lora', ${DEFAULT_SANS}`);
  });

  it('shares a single researched family across both roles', async () => {
    const brand: OrgBrand = { branding: { fonts: ['Inter'] } };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(varOf(css, '--font-sans')).toBe(`'Inter', ${DEFAULT_SANS}`);
    expect(varOf(css, '--font-display')).toBe(`'Inter', ${DEFAULT_SANS}`);
  });

  it('keeps an explicit fontFamily ahead of the researched array', async () => {
    const brand: OrgBrand = { branding: { fontFamily: 'Sohne', fonts: ['Inter', 'Lora'] } };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(varOf(css, '--font-sans')).toBe(`'Sohne', ${DEFAULT_SANS}`);
  });
});

describe('generateDesignTokensCss · colours derived from the brand primary', () => {
  it('derives a darker hover and a white label for a mid-tone brand primary', async () => {
    const brand: OrgBrand = { branding: { primaryColor: '#7C3AED' } };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(css).toContain('--color-primary: #7C3AED;');
    expect(css).toContain('--color-primary-hover: #7034D5;'); // 10% darker, never the house teal
    expect(css).not.toContain('#115E59'); // the platform default hover
    expect(css).toContain('--color-on-primary: #FFFFFF;');
  });

  it('picks the dark ink as the label on a pale brand primary', async () => {
    const brand: OrgBrand = { branding: { primaryColor: '#FDE047' } };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(css).toContain('--color-primary-hover: #E4CA40;');
    expect(css).toContain('--color-on-primary: #0F172A;'); // white on yellow measures 1.3:1
  });

  it('lightens the hover for a near-black brand primary (nothing left to darken into)', async () => {
    const brand: OrgBrand = { branding: { primaryColor: '#101B3C' } };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(css).toContain('--color-primary-hover: #313B57;');
    expect(css).toContain('--color-on-primary: #FFFFFF;');
  });

  it('never overrides a hover the design system stated itself', async () => {
    const brand: OrgBrand = { branding: { colors: { primary: '#7C3AED', primaryHover: '#4C1D95', onPrimary: '#F5F3FF' } } };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(css).toContain('--color-primary-hover: #4C1D95;');
    expect(css).toContain('--color-on-primary: #F5F3FF;');
  });

  it('refuses a colour value that is not a colour rather than emitting it into the stylesheet', async () => {
    const brand: OrgBrand = { branding: { primaryColor: 'red; } body { display: none; } :root { --x: 1' } };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(css).toContain('--color-primary: #0F766E;'); // the platform default stands
    expect(css).not.toContain('display: none');
  });
});

describe('generateDesignTokensCss · the org design system paints the canvas', () => {
  const darkBrand: OrgBrand = {
    branding: {
      primaryColor: '#7C3AED',
      designSystem: {
        palette: [
          { hex: '#6D4AFF', count: 40, confidence: 'high', sources: ['css'] }, // a mid-tone FILL
          { hex: '#080C14', count: 22, confidence: 'high', sources: ['css'] }, // the canvas
          { hex: '#1E293B', count: 9, confidence: 'medium', sources: ['css'] },
        ],
      },
    },
  };

  it('serves a dark app for a dark brand, with every neutral moving together', async () => {
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => darkBrand });
    expect(css).toContain('--color-bg: #080C14;');
    expect(varOf(css, '--color-text')).toBe('#F8FAFC'); // the ink inverts with the canvas
    for (const token of ['--color-surface', '--color-surface-muted', '--color-border']) {
      const value = varOf(css, token);
      expect(value).toMatch(/^#[0-9A-F]{6}$/);
      expect(brightness(value!)).toBeLessThan(3 * 128); // a light default left standing here is the bug
    }
  });

  it('refuses a palette of mid-tones as a canvas (a brand hue is a fill, not a background)', async () => {
    const brand: OrgBrand = {
      branding: {
        designSystem: { palette: [{ hex: '#6D4AFF', count: 40, confidence: 'high', sources: ['css'] }] },
      },
    };
    const { css } = await generateDesignTokensCss('app-a', { resolveOrgBrand: async () => brand });
    expect(css).toContain('--color-bg: #FFFFFF;');
    expect(css).toContain('--color-text: #0F172A;');
  });
});

describe('generateDesignTokensCss · Amendment 2 org isolation', () => {
  const resolveOrgBrand = async (appIdOrSlug: string): Promise<OrgBrand | null> => {
    if (appIdOrSlug === 'app-a') return { branding: { primaryColor: '#AA0000' } };
    if (appIdOrSlug === 'app-b') return { branding: { primaryColor: '#00BB00' } };
    return null; // any other app's org has no brand research
  };

  it('an app of org A never receives org B tokens', async () => {
    const a = await generateDesignTokensCss('app-a', { resolveOrgBrand });
    const b = await generateDesignTokensCss('app-b', { resolveOrgBrand });
    expect(a.css).toContain('--color-primary: #AA0000;');
    expect(a.css).not.toContain('#00BB00');
    expect(b.css).toContain('--color-primary: #00BB00;');
    expect(b.css).not.toContain('#AA0000');
    // different orgs -> different etags
    expect(a.etag).not.toBe(b.etag);
  });

  it('an app whose org has no brand research gets the platform default', async () => {
    const { css } = await generateDesignTokensCss('app-without-brand', { resolveOrgBrand });
    expect(css).toContain('--color-primary: #0F766E;');
  });
});

describe('appIdFromRequest', () => {
  it('reads the app from ?app= first, then a /apps/<slug>/ Referer', () => {
    expect(appIdFromRequest({ query: { app: 'gestor' }, headers: {} } as never)).toBe('gestor');
    expect(appIdFromRequest({ query: {}, headers: { referer: 'https://host/apps/legal-calculos/index.html' } } as never)).toBe('legal-calculos');
    expect(appIdFromRequest({ query: {}, headers: {} } as never)).toBeUndefined();
  });
});

describe('/api/design-tokens.css · HTTP byte-contract', () => {
  let server: Server;
  let port: number;
  beforeAll(async () => {
    const app = express();
    app.get('/api/design-tokens.css', designTokensHandler({ resolveOrgBrand: async () => null }));
    await new Promise<void>((r) => {
      server = app.listen(0, () => r());
    });
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => {
    server.close();
  });

  it('serves text/css with the carried cache headers, an ETag and CORS *', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/design-tokens.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('etag')).toMatch(ETAG_RE);
    expect(await res.text()).toContain('--color-primary: #0F766E;');
  });

  it('honours a conditional GET with 304 Not Modified', async () => {
    const first = await fetch(`http://127.0.0.1:${port}/api/design-tokens.css`);
    const etag = first.headers.get('etag')!;
    const second = await fetch(`http://127.0.0.1:${port}/api/design-tokens.css`, { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
  });
});

/**
 * The request a REAL browser makes against a served app: the document's <head> carries
 * `?app=<id>` and NO Referer reaches the api (the served-app document is same-origin with the
 * tokens endpoint, but the api stamps no-referrer on its own surface and every cross-origin
 * embed strips it anyway). Before the parametrised link, this exact request resolved no org and
 * every browser on the platform received the default teal.
 */
describe('/api/design-tokens.css · the browser request a served app makes', () => {
  let server: Server;
  let port: number;
  beforeAll(async () => {
    const app = express();
    app.get(
      '/api/design-tokens.css',
      designTokensHandler({
        resolveOrgBrand: async (id) => (id === 'served-app-1' ? { branding: { primaryColor: '#7C3AED' } } : null),
      }),
    );
    await new Promise<void>((r) => {
      server = app.listen(0, () => r());
    });
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => {
    server.close();
  });

  it('resolves the org brand from ?app= alone, with no Referer', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/design-tokens.css?app=served-app-1`);
    const css = await res.text();
    expect(res.status).toBe(200);
    expect(css).toContain('--color-primary: #7C3AED;');
    expect(css).not.toContain('#0F766E'); // the platform default every app used to get
  });

  it('still serves the platform default when the request names no app', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/design-tokens.css`);
    expect(await res.text()).toContain('--color-primary: #0F766E;');
  });
});
