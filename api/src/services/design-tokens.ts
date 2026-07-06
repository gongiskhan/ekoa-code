/**
 * Design Tokens CSS builder — the `GET /api/design-tokens.css` content (ch03
 * §3.8.23, ch07 §7.2.2, Amendment 2 Part 4). Every served app links this
 * stylesheet before its bundle, so a branding change cascades on the next load.
 *
 * Amendment 2: the org whose tokens are served is resolved SERVER-SIDE from the
 * requesting app's slug (the `?app=` query or the `/apps/<slug>/` Referer) — an app
 * of org A never receives org B's tokens. The org's brand tokens are served when
 * brand research exists for that org; otherwise the PLATFORM DEFAULT design system
 * (a neutral palette, a system font stack, no logo) — never the vendor's brand.
 * The URL and byte-contract (the `:root { --var: … }` shape + the ETag format) are
 * unchanged, so the 37 legal e2e specs do not move.
 *
 * The org→brand resolution is an injected seam (default: the data/ stores), so the
 * builder is testable and the module never imports apps/.
 */
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { artifacts, slugs, orgs } from '../data/stores.js';

/** Platform default design system (neutral). Carried from the old design-tokens-css. */
const DEFAULT_VARS: Record<string, string> = {
  '--color-primary': '#0F766E',
  '--color-primary-hover': '#0D9488',
  '--color-accent': '#14B8A6',
  '--color-bg': '#FFFFFF',
  '--color-surface': '#F8FAFC',
  '--color-surface-muted': '#F1F5F9',
  '--color-border': '#E2E8F0',
  '--color-text': '#0F172A',
  '--color-text-muted': '#475569',
  '--color-text-subtle': '#64748B',
  '--color-success': '#16A34A',
  '--color-warning': '#D97706',
  '--color-danger': '#DC2626',
  '--color-info': '#2563EB',
  '--font-sans': "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  '--font-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
  '--text-xs': '0.75rem',
  '--text-sm': '0.875rem',
  '--text-base': '0.9375rem',
  '--text-lg': '1.125rem',
  '--text-xl': '1.25rem',
  '--text-2xl': '1.5rem',
  '--text-3xl': '1.875rem',
  '--space-1': '0.25rem',
  '--space-2': '0.5rem',
  '--space-3': '0.75rem',
  '--space-4': '1rem',
  '--space-6': '1.5rem',
  '--space-8': '2rem',
  '--space-12': '3rem',
  '--space-16': '4rem',
  '--radius-sm': '0.25rem',
  '--radius-md': '0.5rem',
  '--radius-lg': '0.75rem',
  '--radius-full': '9999px',
  '--shadow-sm': '0 1px 2px rgba(15, 23, 42, 0.05)',
  '--shadow-md': '0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -2px rgba(15, 23, 42, 0.04)',
  '--shadow-lg': '0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.05)',
  '--logo-url': '',
  '--logo-icon-url': '',
};

/** The resolved brand for an org (brand research). `null` => platform default. */
export interface OrgBrand {
  branding: Record<string, unknown>;
  /** Cache-busting marker for the ETag (org updatedAt). */
  updatedAt?: string;
}

export interface DesignTokensDeps {
  /** app slug-or-id -> its org's brand (or null when the org has no brand research). */
  resolveOrgBrand?: (appIdOrSlug: string) => Promise<OrgBrand | null>;
}

function escapeUrlPart(s: string): string {
  return s.replace(/[^a-zA-Z0-9._/-]/g, '');
}

/** Overlay an org's brand onto the platform default variable bag. */
function tokensToVars(brand: OrgBrand | null): Record<string, string> {
  const vars: Record<string, string> = { ...DEFAULT_VARS };
  if (!brand) return vars;
  const branding = (brand.branding ?? {}) as Record<string, unknown>;

  // A design-system colours bag, when brand research produced one.
  const colors = branding.colors as Record<string, string> | undefined;
  if (colors) {
    if (colors.primary) vars['--color-primary'] = colors.primary;
    if (colors.primaryHover) vars['--color-primary-hover'] = colors.primaryHover;
    if (colors.accent) vars['--color-accent'] = colors.accent;
    if (colors.background) vars['--color-bg'] = colors.background;
    if (colors.surface) vars['--color-surface'] = colors.surface;
    if (colors.surfaceMuted) vars['--color-surface-muted'] = colors.surfaceMuted;
    if (colors.border) vars['--color-border'] = colors.border;
    if (colors.text) vars['--color-text'] = colors.text;
    if (colors.textMuted) vars['--color-text-muted'] = colors.textMuted;
    if (colors.success) vars['--color-success'] = colors.success;
    if (colors.warning) vars['--color-warning'] = colors.warning;
    if (colors.danger) vars['--color-danger'] = colors.danger;
    if (colors.info) vars['--color-info'] = colors.info;
  }

  // Top-level branding fields (the agent writes these directly).
  if (typeof branding.primaryColor === 'string') vars['--color-primary'] = branding.primaryColor;
  if (typeof branding.secondaryColor === 'string') vars['--color-accent'] = branding.secondaryColor;
  if (typeof branding.accentColor === 'string') vars['--color-accent'] = branding.accentColor;
  if (typeof branding.fontFamily === 'string' && branding.fontFamily.trim().length > 0) {
    vars['--font-sans'] = `'${String(branding.fontFamily).replace(/'/g, '')}', ${vars['--font-sans']}`;
  }
  if (typeof branding.logo === 'string' && branding.logo.length > 0) {
    vars['--logo-url'] = `url("/brand-assets/${escapeUrlPart(branding.logo)}")`;
  }
  if (typeof branding.logoIcon === 'string' && branding.logoIcon.length > 0) {
    vars['--logo-icon-url'] = `url("/brand-assets/${escapeUrlPart(branding.logoIcon)}")`;
  }
  return vars;
}

function renderCss(vars: Record<string, string>): string {
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`);
  return [
    '/* Generated by api/src/services/design-tokens.ts */',
    '/* Locked contract: ekoa-data/bases/CSS_VARS_CONTRACT.md */',
    ':root {',
    ...lines,
    '}',
    '',
  ].join('\n');
}

export interface DesignTokensCss {
  css: string;
  etag: string;
}

/** Default org-brand resolver: app slug/id -> artifact -> org -> branding. */
async function defaultResolveOrgBrand(appIdOrSlug: string): Promise<OrgBrand | null> {
  const id = String(appIdOrSlug || '').trim();
  if (!id) return null;
  const slugRow = await slugs.get(id);
  const artifactId = slugRow ? (slugRow.artifactId as string) : id;
  const art = await artifacts.get(artifactId);
  if (!art) return null;
  const orgId = art.orgId as string | undefined;
  if (!orgId) return null;
  const org = await orgs.get(orgId);
  if (!org) return null;
  const branding = (org.branding ?? {}) as Record<string, unknown>;
  if (!branding || Object.keys(branding).length === 0) return null; // no brand research -> platform default
  return { branding, updatedAt: org.updatedAt as string | undefined };
}

/**
 * Build the design-tokens stylesheet for the requesting app's org. When the app is
 * unknown or its org has no brand research, the platform default is served. The
 * ETag is `W/"<updatedAt|default>:<hash>"` so any brand change invalidates caches.
 */
export async function generateDesignTokensCss(appIdOrSlug: string | undefined, deps: DesignTokensDeps = {}): Promise<DesignTokensCss> {
  const resolve = deps.resolveOrgBrand ?? defaultResolveOrgBrand;
  let brand: OrgBrand | null = null;
  if (appIdOrSlug) {
    try {
      brand = await resolve(appIdOrSlug);
    } catch {
      brand = null; // resolution failure -> platform default (never 5xx)
    }
  }
  const vars = tokensToVars(brand);
  const css = renderCss(vars);
  const updatedAt = brand?.updatedAt ?? (brand ? 'brand' : 'default');
  const hash = createHash('sha1').update(JSON.stringify(vars)).digest('hex').slice(0, 12);
  const etag = `W/"${updatedAt}:${hash}"`;
  return { css, etag };
}

/** Extract the app slug/id from the request: `?app=` first, then a `/apps/<slug>/` Referer. */
export function appIdFromRequest(req: Request): string | undefined {
  const q = req.query.app;
  if (typeof q === 'string' && q.trim()) return q.trim();
  const referer = (req.headers.referer || req.headers.referrer) as string | undefined;
  if (referer) {
    const m = /\/apps\/([^/?#]+)/.exec(referer);
    if (m && m[1]) return decodeURIComponent(m[1]);
  }
  return undefined;
}

/**
 * Express handler for `GET /api/design-tokens.css`. Byte-contract: `text/css;
 * charset=utf-8`, `Cache-Control: public, max-age=60, must-revalidate`, an ETag
 * with a conditional-GET 304, CORS `*`, and a never-5xx error fallback.
 */
export function designTokensHandler(deps: DesignTokensDeps = {}) {
  return async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const { css, etag } = await generateDesignTokensCss(appIdFromRequest(req), deps);
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.status(200).send(css);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(`/* design tokens unavailable: ${msg} */\n:root {}\n`);
    }
  };
}
