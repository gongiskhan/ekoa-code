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
