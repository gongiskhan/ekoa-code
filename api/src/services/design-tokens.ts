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
 *
 * The overlay DERIVES what brand research does not state, because a half-applied brand
 * renders worse than none: the primary's hover step and its label colour come from the
 * primary itself (WCAG contrast, not the house teal), the neutral layer comes from the
 * org's extracted palette when it names a canvas (a dark brand serves a DARK app, every
 * neutral moving together), the researched `fonts` array feeds the font stacks, and the
 * full logo stands in for the compact mark the pipeline never writes. Every value is
 * shape-checked before it is emitted - a branding record is admin-editable free text
 * landing verbatim in a stylesheet that every served app loads.
 */
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { artifacts, slugs, orgs } from '../data/stores.js';

/** Platform default design system (neutral). Carried from the old design-tokens-css. */
const DEFAULT_VARS: Record<string, string> = {
  '--color-primary': '#0F766E',
  // A hover state on a light canvas must DARKEN. The previous default (#0D9488) was
  // lighter than --color-primary, so every consumer that paints a white label on it
  // (a primary button) or uses it as link-hover text measured 3.74:1 - under the 4.5:1
  // floor - and hovering the most prominent control on a page dropped it out of AA.
  // #115E59 measures 7.58:1 in both roles (the `document` base had already hardcoded
  // this value as its own fallback, which is what surfaced the mismatch).
  '--color-primary-hover': '#115E59',
  '--color-accent': '#14B8A6',
  // The label colour ON a primary-filled surface. Consumers previously reached for
  // --color-bg here, which silently breaks for a brand whose background resolves dark
  // (dark label on a dark button). Kept separate so it can be inverted independently.
  '--color-on-primary': '#FFFFFF',
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
  '--font-display': "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  '--font-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
  '--text-xs': '0.75rem',
  '--text-sm': '0.875rem',
  '--text-base': '0.9375rem',
  '--text-lg': '1.125rem',
  '--text-xl': '1.25rem',
  '--text-2xl': '1.5rem',
  '--text-3xl': '1.875rem',
  '--text-4xl': '2.25rem',
  '--text-5xl': '3rem',
  '--text-6xl': '3.75rem',
  '--space-1': '0.25rem',
  '--space-2': '0.5rem',
  '--space-3': '0.75rem',
  '--space-4': '1rem',
  '--space-6': '1.5rem',
  '--space-8': '2rem',
  '--space-12': '3rem',
  '--space-16': '4rem',
  '--space-20': '5rem',
  '--space-24': '6rem',
  '--space-32': '8rem',
  '--radius-sm': '0.25rem',
  '--radius-md': '0.5rem',
  '--radius-lg': '0.75rem',
  '--radius-xl': '1rem',
  '--radius-full': '9999px',
  '--shadow-sm': '0 1px 2px rgba(15, 23, 42, 0.05)',
  '--shadow-md': '0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -2px rgba(15, 23, 42, 0.04)',
  '--shadow-lg': '0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.05)',
  '--shadow-xl': '0 24px 48px -12px rgba(15, 23, 42, 0.18)',
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

/**
 * The value shapes allowed into a colour token: a hex literal, an rgb()/hsl() functional form,
 * or a bare colour keyword. A branding record is admin-editable free text that lands VERBATIM in
 * a stylesheet every served app loads, so anything else (a `url(...)`, a value carrying `;` or
 * `}` that would break out of the declaration) is DROPPED rather than escaped - a missing token
 * falls back to the platform default, which is always a safe render.
 */
const CSS_COLOR_RE = /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgb|rgba|hsl|hsla)\([0-9.,%/\sdeg-]+\)|[a-zA-Z]{3,20})$/;
function isCssColor(v: unknown): v is string {
  return typeof v === 'string' && CSS_COLOR_RE.test(v.trim());
}

type Rgb = readonly [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
/** The platform's ink and its inverse (the DEFAULT_VARS text/surface values), reused as the two
 *  candidate label colours everywhere a readable-on-X decision is made. */
const INK_DARK = '#0F172A';
const INK_LIGHT = '#F8FAFC';

function parseHex(v: string): Rgb | null {
  const h = v.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Linear-blend `a` towards `b` by `t` (0..1). */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** WCAG 2.1 relative luminance. */
function relativeLuminance(rgb: Rgb): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG 2.1 contrast ratio between two colours (1..21). */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The readable label colour ON a filled surface: whichever of the two candidate inks measures
 *  the higher WCAG contrast against it. */
function inkOn(bg: Rgb, light: string, dark: string): string {
  const lightRgb = parseHex(light) ?? WHITE;
  const darkRgb = parseHex(dark) ?? BLACK;
  return contrastRatio(lightRgb, bg) >= contrastRatio(darkRgb, bg) ? light : dark;
}

/** The hover step for a brand fill: a visible move AWAY from the resting colour. Darkening is the
 *  house rule (see the --color-primary-hover note above), but a near-black brand primary has no
 *  room left to darken into, so that one lightens instead. */
function hoverFor(primary: Rgb): string {
  return relativeLuminance(primary) < 0.1 ? toHex(mix(primary, WHITE, 0.14)) : toHex(mix(primary, BLACK, 0.1));
}

/** A canvas is a colour a page can actually be painted with: near-paper or near-ink. A mid-tone
 *  brand hue is a FILL, never the background, so it is refused here. */
const CANVAS_LIGHT_FLOOR = 0.8;
const CANVAS_DARK_CEILING = 0.12;

export interface BrandCanvas {
  /** The org's page background as a hex literal. */
  background: string;
  /** True when the canvas is dark - the app must be BUILT dark, not light with dark accents. */
  isDark: boolean;
}

/**
 * The org's canvas, read from the brand-research design system (`branding.designSystem.palette`,
 * the shape in shared/src/org.ts: `{ hex, count, confidence, sources }[]`). The most-used colour
 * that is extreme enough to BE a canvas wins; a palette of nothing but mid-tones yields null and
 * the platform's light default stands. Exported because the build agent's brand prompt section
 * must state the same verdict the stylesheet encodes (one implementation, two consumers).
 */
export function resolveBrandCanvas(branding: Record<string, unknown> | null | undefined): BrandCanvas | null {
  const designSystem = branding?.designSystem as { palette?: unknown } | undefined;
  const palette = designSystem && Array.isArray(designSystem.palette) ? designSystem.palette : [];
  let best: { hex: string; rgb: Rgb; count: number } | null = null;
  for (const raw of palette) {
    const entry = raw as { hex?: unknown; count?: unknown } | null;
    if (!entry || !isCssColor(entry.hex)) continue;
    const rgb = parseHex(entry.hex);
    if (!rgb) continue;
    const lum = relativeLuminance(rgb);
    if (lum < CANVAS_LIGHT_FLOOR && lum > CANVAS_DARK_CEILING) continue;
    const count = typeof entry.count === 'number' ? entry.count : 0;
    if (!best || count > best.count) best = { hex: toHex(rgb), rgb, count };
  }
  if (!best) return null;
  return { background: best.hex, isDark: relativeLuminance(best.rgb) < 0.5 };
}

/**
 * Paint the whole neutral layer from one canvas colour. Every neutral moves TOGETHER: a dark
 * background with the light-mode surface/border/text defaults left standing is worse than no
 * brand at all (invisible text on near-black), so surfaces and borders are stepped off the
 * canvas towards its ink and the text tokens are stepped off the ink back towards the canvas.
 */
function applyCanvas(vars: Record<string, string>, canvas: BrandCanvas): void {
  const bg = parseHex(canvas.background);
  if (!bg) return;
  const ink = parseHex(inkOn(bg, INK_LIGHT, INK_DARK)) ?? BLACK;
  vars['--color-bg'] = toHex(bg);
  vars['--color-surface'] = toHex(mix(bg, ink, 0.05));
  vars['--color-surface-muted'] = toHex(mix(bg, ink, 0.09));
  vars['--color-border'] = toHex(mix(bg, ink, 0.16));
  vars['--color-text'] = toHex(ink);
  vars['--color-text-muted'] = toHex(mix(ink, bg, 0.3));
  vars['--color-text-subtle'] = toHex(mix(ink, bg, 0.45));
}

/** Resolve a stored brand-asset reference to a served URL token.
 *  The branding record stores what the brand pipeline wrote - a full served path
 *  `/brand-assets/<file>` (brand-assets.ts storeLogo) - while older/hand-written records carry a
 *  bare filename. Prefixing unconditionally produced `url("/brand-assets//brand-assets/x.png")`,
 *  a 404 on every app whose org actually HAD a logo, so an already-rooted path is taken as-is.
 *  A remote reference is dropped: the stylesheet every served app loads never points a brand
 *  asset at a third-party host. */
function brandAssetUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.includes('://') || v.startsWith('//')) return null;
  const path = escapeUrlPart(v.startsWith('/') ? v : `/brand-assets/${v}`);
  return path.startsWith('/') ? `url("${path}")` : null;
}

/** A font family name safe to emit inside a quoted CSS font stack. */
function quoteFontFamily(name: string): string | null {
  const clean = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  return clean ? `'${clean}'` : null;
}

/** Overlay an org's brand onto the platform default variable bag. */
function tokensToVars(brand: OrgBrand | null): Record<string, string> {
  const vars: Record<string, string> = { ...DEFAULT_VARS };
  if (!brand) return vars;
  const branding = (brand.branding ?? {}) as Record<string, unknown>;

  // A design-system colours bag, when brand research produced one.
  const colors = branding.colors as Record<string, string> | undefined;
  let brandPrimary: Rgb | null = null;
  let hoverGiven = false;
  let onPrimaryGiven = false;
  if (colors) {
    if (isCssColor(colors.primary)) vars['--color-primary'] = colors.primary;
    if (isCssColor(colors.primaryHover)) { vars['--color-primary-hover'] = colors.primaryHover; hoverGiven = true; }
    if (isCssColor(colors.onPrimary)) { vars['--color-on-primary'] = colors.onPrimary; onPrimaryGiven = true; }
    if (isCssColor(colors.accent)) vars['--color-accent'] = colors.accent;
    if (isCssColor(colors.background)) vars['--color-bg'] = colors.background;
    if (isCssColor(colors.surface)) vars['--color-surface'] = colors.surface;
    if (isCssColor(colors.surfaceMuted)) vars['--color-surface-muted'] = colors.surfaceMuted;
    if (isCssColor(colors.border)) vars['--color-border'] = colors.border;
    if (isCssColor(colors.text)) vars['--color-text'] = colors.text;
    if (isCssColor(colors.textMuted)) vars['--color-text-muted'] = colors.textMuted;
    if (isCssColor(colors.success)) vars['--color-success'] = colors.success;
    if (isCssColor(colors.warning)) vars['--color-warning'] = colors.warning;
    if (isCssColor(colors.danger)) vars['--color-danger'] = colors.danger;
    if (isCssColor(colors.info)) vars['--color-info'] = colors.info;
    if (isCssColor(colors.primary)) brandPrimary = parseHex(colors.primary);
  } else {
    // No colours bag (nothing writes one today) - the neutral layer comes from the org's own
    // extracted design system instead, so a dark brand serves a dark app.
    const canvas = resolveBrandCanvas(branding);
    if (canvas) applyCanvas(vars, canvas);
  }

  // Top-level branding fields (the agent writes these directly).
  if (isCssColor(branding.primaryColor)) {
    vars['--color-primary'] = branding.primaryColor;
    brandPrimary = parseHex(branding.primaryColor);
  }
  if (isCssColor(branding.secondaryColor)) vars['--color-accent'] = branding.secondaryColor;
  if (isCssColor(branding.accentColor)) vars['--color-accent'] = branding.accentColor;

  // The derived pair. A rebranded primary with the platform's default hover/label is the bug
  // this closes: a #2DD4BF button hovering to the house teal #115E59, and a white label on a
  // pale brand fill. Only derived when the brand supplied a primary AND the design system did
  // not state the value itself.
  if (brandPrimary) {
    if (!hoverGiven) vars['--color-primary-hover'] = hoverFor(brandPrimary);
    if (!onPrimaryGiven) vars['--color-on-primary'] = inkOn(brandPrimary, '#FFFFFF', INK_DARK);
  }

  // Fonts. Brand research writes `fonts` (an ordered array of family names); the older
  // fontFamily/displayFontFamily strings, when present, still win - they are the explicit choice.
  const fonts = Array.isArray(branding.fonts)
    ? branding.fonts.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    : [];
  if (typeof branding.fontFamily === 'string' && branding.fontFamily.trim().length > 0) {
    const family = quoteFontFamily(branding.fontFamily);
    if (family) {
      vars['--font-sans'] = `${family}, ${vars['--font-sans']}`;
      // The display face follows the brand font unless research produced a dedicated one.
      vars['--font-display'] = `${family}, ${vars['--font-display']}`;
    }
  } else if (fonts.length > 0) {
    const first = fonts[0];
    // A second researched family is the display face; with only one, both roles share it.
    const second = fonts[1] ?? first;
    const sans = first ? quoteFontFamily(first) : null;
    const display = second ? quoteFontFamily(second) : null;
    if (sans) vars['--font-sans'] = `${sans}, ${DEFAULT_VARS['--font-sans']}`;
    if (display) vars['--font-display'] = `${display}, ${DEFAULT_VARS['--font-display']}`;
  }
  if (typeof branding.displayFontFamily === 'string' && branding.displayFontFamily.trim().length > 0) {
    const family = quoteFontFamily(branding.displayFontFamily);
    if (family) vars['--font-display'] = `${family}, ${DEFAULT_VARS['--font-display']}`;
  }

  if (typeof branding.logo === 'string' && branding.logo.length > 0) {
    const url = brandAssetUrl(branding.logo);
    if (url) vars['--logo-url'] = url;
  }
  if (typeof branding.logoIcon === 'string' && branding.logoIcon.length > 0) {
    const url = brandAssetUrl(branding.logoIcon);
    if (url) vars['--logo-icon-url'] = url;
  }
  // Nothing writes a separate compact mark today, and the app shell reads --logo-icon-url FIRST,
  // so an org WITH a logo would render no brand mark at all. The full logo stands in for it.
  if (!vars['--logo-icon-url'] && vars['--logo-url']) {
    vars['--logo-icon-url'] = vars['--logo-url'];
  }
  return vars;
}

function renderCss(vars: Record<string, string>): string {
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`);
  return [
    '/* Generated by api/src/services/design-tokens.ts */',
    '/* Locked contract: api/assets/bases/CSS_VARS_CONTRACT.md */',
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
