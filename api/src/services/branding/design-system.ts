/**
 * Design System Extractor (ch05 §5.6.4).
 *
 * Wraps the `dembrandt` CLI (npm package, an api dependency) to extract a full
 * design system from a live website: colors with confidence + context, typography
 * styles per role, spacing scale, border radii, shadows, button/link components
 * with state styles, and framework detection.
 *
 * Why wrap a CLI instead of reimplementing: dembrandt already solved the hard
 * parts (SPA hydration wait, computed-style harvesting, color confidence scoring,
 * component discovery, CSS-variable extraction). Shelling out to `--json-only`
 * gives a stable JSON contract and zero in-process coupling.
 *
 * SSRF: dembrandt fetches the URL in a subprocess we cannot DOM-guard, so the URL
 * is validated with the same `assertSafeUrl` guard BEFORE the subprocess spawns
 * (ch09 invariant 8, FIXED-8).
 *
 * Non-fatal: any failure (timeout, exit code, parse error, SSRF rejection) returns
 * null so the caller falls back to the site-context + rendered-candidates pipeline.
 *
 * dembrandt 0.23 CLI (verified via `--help`): `--json-only --slow --no-sandbox <url>`.
 * Single-page is the default (the old `--pages 1` flag is gone; `--crawl N` opts
 * into multipage). Some field names changed from earlier versions - the readers
 * below normalize both (typography `family`/`size`/`weight`/`context`).
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { assertSafeUrl, SsrfError } from '../url-safety.js';
import { isBuilderPromoAsset, normalizeFontKey, type SiteBuilder } from './site-builder.js';
import { CONSENT_CHROME_TOKENS } from './consent-chrome.js';

// Resolve the workspace-hoisted dembrandt bin via Node's own resolver rather than
// hardcoding a relative path - the npm workspace roots node_modules above api/src.
const require_ = createRequire(import.meta.url);

// ============================================
// Types mirroring dembrandt's JSON schema
// ============================================

export interface DesignSystem {
  url: string;
  extractedAt: string;
  siteName?: string | null;
  logo?: DesignSystemLogo | null;
  favicons?: DesignSystemFavicon[];
  colors?: DesignSystemColors;
  typography?: DesignSystemTypography;
  spacing?: DesignSystemSpacing;
  borderRadius?: { values?: DesignSystemRadiusEntry[] };
  borders?: { combinations?: DesignSystemBorderEntry[] };
  shadows?: DesignSystemShadowEntry[];
  components?: DesignSystemComponents;
  breakpoints?: unknown[];
  iconSystem?: unknown[];
  frameworks?: string[] | Array<{ name: string; confidence?: string }>;
}

export interface DesignSystemSpacingValue {
  px?: string;
  rem?: string;
  count?: number;
  numericValue?: number;
}

export interface DesignSystemSpacing {
  scaleType?: string;
  commonValues?: Array<string | number | DesignSystemSpacingValue>;
}

export interface DesignSystemRadiusEntry {
  value: string;
  count: number;
  elements?: string[];
  confidence?: string;
  numericValue?: number;
}

export interface DesignSystemBorderEntry {
  width: string;
  style: string;
  color: string;
  count: number;
  elements?: string[];
  confidence?: string;
}

export interface DesignSystemShadowEntry {
  shadow: string;
  count: number;
  confidence?: string;
}

export interface DesignSystemLogo {
  source: string;
  url: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  safeZone?: { top: number; right: number; bottom: number; left: number };
  background?: string | null;
  /** 0.23: an inline SVG carries `inline: true` and `url` is the page URL, not an image. */
  inline?: boolean;
  markup?: string | null;
  context?: string | null;
  color?: string | null;
}

export interface DesignSystemFavicon {
  type: string;
  url: string;
  sizes?: string | null;
}

export interface DesignSystemColorEntry {
  color: string;
  normalized: string;
  count: number;
  confidence: 'high' | 'medium' | 'low';
  sources: string[];
  lch?: string;
  oklch?: string;
}

export interface DesignSystemCssVariable {
  value: string;
  lch?: string;
  oklch?: string;
}

export interface DesignSystemColors {
  semantic?: Record<string, unknown>;
  palette?: DesignSystemColorEntry[];
  cssVariables?: Record<string, DesignSystemCssVariable>;
}

/**
 * One typography sample. Field names drifted across dembrandt versions; this type
 * carries BOTH the old (`fontFamily`/`fontSize`/`fontWeight`/`role`) and the 0.23
 * (`family`/`size`/`weight`/`context`) spellings, and `normalizeTypographyStyle`
 * reads whichever is present.
 */
export interface DesignSystemTypographyStyle {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string | number;
  lineHeight?: string;
  letterSpacing?: string;
  textTransform?: string;
  role?: string;
  sources?: string[];
  confidence?: string;
  // 0.23 spellings:
  family?: string;
  fallbacks?: string;
  size?: string;
  weight?: string | number;
  spacing?: string;
  transform?: string;
  context?: string;
}

export interface DesignSystemTypography {
  styles?: DesignSystemTypographyStyle[];
  sources?: Record<string, unknown>;
}

export interface DesignSystemComponents {
  buttons?: Array<{ states?: Record<string, Record<string, string>>; sources?: string[] }>;
  inputs?: unknown[];
  links?: Array<{ states?: Record<string, Record<string, string>>; sources?: string[] }>;
  [key: string]: unknown;
}

/** Normalize a typography sample to the old field names, reading either spelling. */
function normalizeTypographyStyle(s: DesignSystemTypographyStyle): {
  role?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
} {
  const weight = s.fontWeight ?? s.weight;
  return {
    role: s.role ?? s.context,
    fontFamily: s.fontFamily ?? s.family,
    fontSize: s.fontSize ?? s.size,
    fontWeight: weight != null ? String(weight) : undefined,
    lineHeight: s.lineHeight,
  };
}

// ============================================
// Options
// ============================================

export interface FetchDesignSystemOptions {
  /** Timeout in ms for the whole extraction. Default 90s. */
  timeoutMs?: number;
  /** dembrandt `--slow` mode (3x timeouts) for tracker-heavy sites. Default on. */
  slow?: boolean;
}

// ============================================
// Public API
// ============================================

/**
 * Extract a design system from the given URL via the dembrandt CLI. Returns null
 * on any failure - the caller falls back to the CSS + rendered-candidate pipeline.
 * Progress text on stderr is captured for logs but discarded; only the structured
 * JSON on stdout is parsed.
 */
export async function fetchDesignSystem(
  url: string,
  options: FetchDesignSystemOptions = {},
): Promise<DesignSystem | null> {
  const { timeoutMs = 90_000, slow = true } = options;

  // SSRF: validate the URL BEFORE spawning the subprocess that will fetch it.
  try {
    assertSafeUrl(url);
  } catch (err) {
    if (err instanceof SsrfError) {
      console.warn(`[design-system] refusing blocked URL: ${err.message}`);
      return null;
    }
    throw err;
  }

  let binPath: string;
  try {
    binPath = resolveDembrandtBin();
  } catch (err) {
    console.warn(`[design-system] dembrandt bin not resolvable: ${errMsg(err)}`);
    return null;
  }

  const args = ['--json-only', ...(slow ? ['--slow'] : []), '--no-sandbox', url];

  return new Promise<DesignSystem | null>((resolve) => {
    const started = Date.now();
    // Invoke via `node <script>` (inheriting env so dembrandt's playwright-core
    // finds the installed Chromium cache) rather than relying on a shebang/PATH.
    const child = spawn(process.execPath, [binPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      console.warn(`[design-system] timeout (${timeoutMs}ms) for ${url}`);
      child.kill('SIGKILL');
      resolve(null);
    }, timeoutMs);

    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => errChunks.push(c));

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      console.warn(`[design-system] spawn error: ${err.message}`);
      resolve(null);
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      const elapsed = Date.now() - started;
      if (code !== 0) {
        const tail = Buffer.concat(errChunks).toString('utf8').slice(-500);
        console.warn(`[design-system] exit ${code} in ${elapsed}ms for ${url}. stderr tail: ${tail}`);
        resolve(null);
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8');
      const parsed = parseDembrandtJson(raw);
      if (!parsed) {
        console.warn(`[design-system] failed to parse JSON from dembrandt (${raw.length} bytes) for ${url}`);
        resolve(null);
        return;
      }
      console.log(
        `[design-system] ok in ${elapsed}ms - colors=${parsed.colors?.palette?.length ?? 0} typography=${parsed.typography?.styles?.length ?? 0} spacing=${parsed.spacing?.commonValues?.length ?? 0} radii=${parsed.borderRadius?.values?.length ?? 0} shadows=${parsed.shadows?.length ?? 0}`,
      );
      resolve(parsed);
    });
  });
}

// ============================================
// Site-builder chrome scrubbing
// ============================================

/** Convert a CSS color string (hex3/hex6/rgb/rgba) to a lowercase 6-digit hex, or null. */
function cssToHex(input: string): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s.startsWith('#')) {
    const rest = s.slice(1);
    if (/^[0-9a-f]{6}$/.test(rest)) return `#${rest}`;
    if (/^[0-9a-f]{8}$/.test(rest)) return `#${rest.slice(0, 6)}`;
    if (/^[0-9a-f]{3}$/.test(rest)) return '#' + rest.split('').map((c) => c + c).join('');
    return null;
  }
  const m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) {
    return '#' + [m[1]!, m[2]!, m[3]!].map((n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

/**
 * Scrub a detected site-builder's chrome out of dembrandt's output. dembrandt runs
 * in a separate subprocess WITH the builder's promo chrome, so its palette, CSS
 * variables, button colors, typography, and picked logo can be the builder's - not
 * the owner's. We filter against the chrome colors/fonts the in-process
 * rendered-candidates pass discovered on the same page. Returns a NEW DesignSystem;
 * pure/synchronous so it is unit-testable without a live browser.
 */
export function filterDesignSystemChrome(
  ds: DesignSystem,
  opts: { chromeColors?: string[]; chromeFonts?: string[]; builder?: SiteBuilder | null },
): DesignSystem {
  const colorSet = new Set((opts.chromeColors ?? []).map((c) => c.toLowerCase()));
  const fontSet = new Set((opts.chromeFonts ?? []).map((f) => normalizeFontKey(f)));
  const builder = opts.builder ?? null;

  const chromeTokens = (builder?.chromeSelectors ?? [])
    .flatMap((sel) => [...sel.matchAll(/(?:\.|\[class[*^$|~]?=["'])([a-z][a-z0-9_-]*)/gi)].map((m) => m[1]!))
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 6 && t.includes('-'));
  const PSEUDO_STATES = /^(hover|focus|active|visited)(\/(hover|focus|active|visited))*$/i;
  // Cookie-consent vendor chrome is NOT the owner's brand either, and unlike builder
  // chrome it shows up on any site regardless of detected builder (observed live
  // 2026-07-11: plmj.com's palette sources were all `cybotcookiebotdialog...`).
  // Token list shared with the rendered passes (consent-chrome.ts).
  const isConsentChromeSources = (sources: string[]): boolean =>
    sources.length > 0 &&
    sources.every((s) => CONSENT_CHROME_TOKENS.some((tok) => s.toLowerCase().includes(tok)));

  const isChromeColor = (raw: string | undefined | null): boolean => {
    if (!raw || colorSet.size === 0) return false;
    const hex = cssToHex(raw);
    return hex != null && colorSet.has(hex);
  };
  const isChromePaletteEntry = (c: DesignSystemColorEntry): boolean => {
    if (isChromeColor(c.normalized) || isChromeColor(c.color)) return true;
    if (isConsentChromeSources(c.sources ?? [])) return true;
    if (builder == null) return false;
    const sources = c.sources ?? [];
    if (sources.length === 0) return false;
    if (chromeTokens.length > 0 && sources.every((s) => chromeTokens.some((tok) => s.toLowerCase().includes(tok)))) return true;
    if (c.confidence !== 'high' && sources.every((s) => PSEUDO_STATES.test(s.toLowerCase()))) return true;
    return false;
  };
  const isChromeFont = (raw: string | undefined | null): boolean => {
    if (!raw || fontSet.size === 0) return false;
    return fontSet.has(normalizeFontKey(String(raw)));
  };

  let siteHost: string | undefined;
  try {
    if (ds.url) siteHost = new URL(ds.url).host;
  } catch {
    /* leave undefined */
  }
  const logo = ds.logo && builder && ds.logo.url && isBuilderPromoAsset(ds.logo.url, builder, siteHost) ? null : ds.logo;

  const colors: DesignSystemColors | undefined = ds.colors
    ? {
        ...ds.colors,
        palette: (ds.colors.palette ?? []).filter((c) => !isChromePaletteEntry(c)),
        cssVariables: Object.fromEntries(
          Object.entries(ds.colors.cssVariables ?? {}).filter(([, v]) => !isChromeColor(v?.value)),
        ),
      }
    : ds.colors;

  const typography: DesignSystemTypography | undefined = ds.typography
    ? { ...ds.typography, styles: (ds.typography.styles ?? []).filter((s) => !isChromeFont(s.fontFamily ?? s.family)) }
    : ds.typography;

  let components = ds.components;
  const btnBg = ds.components?.buttons?.[0]?.states?.default?.backgroundColor;
  if (components?.buttons && isChromeColor(btnBg)) {
    components = { ...components, buttons: components.buttons.slice(1) };
  }

  return { ...ds, logo, colors, typography, components };
}

// ============================================
// Summarization - digest for the agent prompt
// ============================================

/**
 * Render a compact markdown digest of the design system for injection into the
 * branding-agent prompt. Keeps to ~1-2KB. Empty slices are omitted.
 */
export function summarizeDesignSystem(ds: DesignSystem): string {
  const lines: string[] = [];
  lines.push('## Sistema de design (extraído via dembrandt)');
  lines.push('');

  if (ds.siteName) lines.push(`Nome do site: ${ds.siteName}`);

  if (ds.logo?.url && isUsableLogoUrl(ds.logo)) {
    const parts: string[] = [`Logo: ${ds.logo.url}`];
    if (ds.logo.background) parts.push(`sobre fundo ${ds.logo.background}`);
    if (ds.logo.width && ds.logo.height) parts.push(`${ds.logo.width}x${ds.logo.height}`);
    lines.push(parts.join(' '));
  }

  const palette = ds.colors?.palette ?? [];
  const confident = palette.filter((c) => c.confidence === 'high' || c.confidence === 'medium').slice(0, 8);
  if (confident.length > 0) {
    lines.push('');
    lines.push('Cores (ordenadas por confiança, do contexto de uso real):');
    for (const c of confident) {
      const ctx = c.sources.length > 0 ? ` [${c.sources.slice(0, 3).join(', ')}]` : '';
      lines.push(`  - ${c.normalized} (${c.count}x, ${c.confidence})${ctx}`);
    }
  }

  const cssVars = ds.colors?.cssVariables ?? {};
  const brandVars = Object.entries(cssVars)
    .filter(([name]) => /primary|brand|accent|main|theme|secondary/i.test(name))
    .slice(0, 6);
  if (brandVars.length > 0) {
    lines.push('');
    lines.push('Variáveis CSS com nome de marca (sinal de intenção mais forte):');
    for (const [name, v] of brandVars) {
      lines.push(`  - ${name}: ${v.value}`);
    }
  }

  const styles = ds.typography?.styles ?? [];
  if (styles.length > 0) {
    const families = new Set<string>();
    for (const s of styles) {
      const fam = s.fontFamily ?? s.family;
      if (fam) families.add((String(fam).split(',')[0] ?? '').trim().replace(/["']/g, ''));
    }
    if (families.size > 0) {
      lines.push('');
      lines.push(`Famílias tipográficas: ${[...families].slice(0, 5).join(', ')}`);
    }
  }

  const radiiEntries = (ds.borderRadius?.values ?? [])
    .filter((r) => r?.confidence !== 'low' || (r?.count ?? 0) >= 3)
    .slice(0, 8);
  if (radiiEntries.length > 0) {
    lines.push('');
    lines.push(`Raios de borda: ${radiiEntries.map((r) => `${r.value} (${r.count}x)`).join(', ')}`);
    lines.push(`Linguagem de forma: ${classifyShapeLanguage(radiiEntries.map((r) => r.value))}`);
  }

  if (ds.spacing) {
    const scale = ds.spacing.scaleType;
    const values = (ds.spacing.commonValues ?? [])
      .map((v) => {
        if (v == null) return null;
        if (typeof v === 'string' || typeof v === 'number') return String(v);
        if (typeof v === 'object' && 'px' in v && v.px) return String(v.px);
        if (typeof v === 'object' && 'numericValue' in v && v.numericValue != null) return `${v.numericValue}px`;
        return null;
      })
      .filter((v): v is string => v != null)
      .slice(0, 8);
    if (scale || values.length > 0) {
      lines.push('');
      if (scale) lines.push(`Unidade base de espaçamento: ${scale}`);
      if (values.length > 0) lines.push(`Valores de espaçamento: ${values.join(', ')}`);
    }
  }

  const shadows = ds.shadows ?? [];
  if (shadows.length > 0) {
    const top = shadows.slice(0, 3);
    lines.push('');
    lines.push(`Sombras (profundidade, ${shadows.length} distintas):`);
    for (const s of top) {
      lines.push(`  - ${s.shadow} (${s.count}x)`);
    }
  }

  const firstBtn = ds.components?.buttons?.[0];
  const btnDefault = firstBtn?.states?.default;
  if (btnDefault) {
    lines.push('');
    lines.push('Estilo do botão principal:');
    if (btnDefault.backgroundColor) lines.push(`  fundo: ${btnDefault.backgroundColor}`);
    if (btnDefault.color) lines.push(`  texto: ${btnDefault.color}`);
    if (btnDefault.borderRadius) lines.push(`  raio: ${btnDefault.borderRadius}`);
    if (btnDefault.padding) lines.push(`  espaçamento interno: ${btnDefault.padding}`);
  }

  const fw = ds.frameworks ?? [];
  const fwNames = Array.isArray(fw) ? fw.map((f) => (typeof f === 'string' ? f : f.name)).filter(Boolean) : [];
  if (fwNames.length > 0) {
    lines.push('');
    lines.push(`Frameworks: ${fwNames.join(', ')}`);
  }

  return lines.join('\n');
}

// ============================================
// Internal helpers
// ============================================

/**
 * A dembrandt logo entry is a usable image only when its `url` is an http(s)
 * address that is NOT the page itself. 0.23 reports inline SVG logos with
 * `inline: true` and `url` set to the page URL (no downloadable image), which we
 * treat as "no logo url" - the HTML/common-path logo extractor covers those.
 */
export function isUsableLogoUrl(logo: DesignSystemLogo | null | undefined): boolean {
  if (!logo?.url || !/^https?:\/\//i.test(logo.url)) return false;
  if (logo.inline) return false;
  return true;
}

function classifyShapeLanguage(radii: string[]): string {
  const numeric = radii.map((r) => parseFloat(r)).filter((n) => Number.isFinite(n));
  if (numeric.length === 0) return 'desconhecida';
  const max = Math.max(...numeric);
  const median = numeric.sort((a, b) => a - b)[Math.floor(numeric.length / 2)]!;
  if (max <= 2) return 'angular (raio ~0)';
  if (median <= 4) return 'sobretudo angular com alguns cantos suaves';
  if (median <= 10) return 'suave / moderna arredondada';
  if (median <= 20) return 'arredondada';
  return 'muito arredondada (pill)';
}

/** Resolve the dembrandt bin through Node's module resolution. 0.23 does not expose
 *  `package.json` in its `exports` map, so resolve the package entry directly (that
 *  IS the CLI: its `bin.dembrandt` === `main` === dist/index.js). */
function resolveDembrandtBin(): string {
  return require_.resolve('dembrandt');
}

/**
 * dembrandt writes progress to stderr and JSON to stdout (with `--json-only`). We
 * still guard by locating the first `{` and parsing from there.
 */
function parseDembrandtJson(raw: string): DesignSystem | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf('{');
  if (idx < 0) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(idx));
    if (typeof parsed !== 'object' || !parsed || typeof parsed.url !== 'string') return null;
    return parsed as DesignSystem;
  } catch {
    return null;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ============================================
// Trim for persistence
// ============================================

/**
 * Compact storable view of the design system. The raw dembrandt JSON runs 25-40KB
 * per site; we persist only what the UI renders and downstream generators read.
 * Mirrors the shared `StoredDesignSystem` schema.
 */
export interface StoredDesignSystem {
  logo: {
    url?: string;
    background?: string;
    width?: number | null;
    height?: number | null;
  } | null;
  palette: Array<{
    hex: string;
    count: number;
    confidence: 'high' | 'medium' | 'low';
    sources: string[];
  }>;
  cssVariables: Array<{ name: string; value: string }>;
  typography: {
    families: string[];
    styles: Array<{
      role?: string;
      fontFamily?: string;
      fontSize?: string;
      fontWeight?: string;
      lineHeight?: string;
    }>;
  };
  spacing: {
    scaleType?: string;
    values: Array<{ px: string; count: number }>;
  };
  borderRadius: {
    values: Array<{ value: string; count: number }>;
    shapeLanguage: string;
  };
  shadows: Array<{ shadow: string; count: number }>;
  primaryButton: Record<string, string> | null;
  frameworks: string[];
}

/**
 * Reduce the full dembrandt output to a persistable shape. Drops low-confidence
 * noise, normalizes wonky schema variants, and keeps the top entries per category
 * so a stored org record stays under ~5KB.
 */
export function trimDesignSystem(ds: DesignSystem): StoredDesignSystem {
  const paletteTop = (ds.colors?.palette ?? [])
    .filter((c) => c.confidence !== 'low')
    .slice(0, 10)
    .map((c) => ({
      hex: c.normalized,
      count: c.count,
      confidence: c.confidence,
      sources: (c.sources ?? []).slice(0, 4),
    }));

  const cssVars = Object.entries(ds.colors?.cssVariables ?? {})
    .filter(([name]) => /primary|brand|accent|main|theme|secondary|color/i.test(name))
    .filter(([, v]) => typeof v?.value === 'string' && /^#[0-9a-f]{3,8}$|rgb/i.test(v.value))
    .slice(0, 12)
    .map(([name, v]) => ({ name, value: v.value }));

  const rawStyles = ds.typography?.styles ?? [];
  const families = new Set<string>();
  for (const s of rawStyles) {
    const fam = s.fontFamily ?? s.family;
    if (fam) {
      const first = (String(fam).split(',')[0] ?? '').trim().replace(/["']/g, '');
      if (first) families.add(first);
    }
  }
  const typographyStyles = rawStyles.slice(0, 10).map((s) => normalizeTypographyStyle(s));

  const spacingValues = (ds.spacing?.commonValues ?? [])
    .map((v) => {
      if (v == null) return null;
      if (typeof v === 'string' || typeof v === 'number') return { px: String(v), count: 0 };
      if (typeof v === 'object') {
        const px = 'px' in v && v.px ? String(v.px) : 'numericValue' in v && v.numericValue != null ? `${v.numericValue}px` : null;
        if (!px) return null;
        return { px, count: 'count' in v && typeof v.count === 'number' ? v.count : 0 };
      }
      return null;
    })
    .filter((v): v is { px: string; count: number } => v != null)
    .slice(0, 10);

  const radiiEntries = (ds.borderRadius?.values ?? [])
    .filter((r) => r?.confidence !== 'low' || (r?.count ?? 0) >= 3)
    .slice(0, 10)
    .map((r) => ({ value: r.value, count: r.count }));

  const shadowEntries = (ds.shadows ?? []).slice(0, 5).map((s) => ({ shadow: s.shadow, count: s.count }));

  const btnState = ds.components?.buttons?.[0]?.states?.default ?? null;

  const fwRaw = ds.frameworks ?? [];
  const frameworks = Array.isArray(fwRaw)
    ? fwRaw.map((f) => (typeof f === 'string' ? f : f?.name)).filter((s): s is string => typeof s === 'string' && s.length > 0)
    : [];

  return {
    logo:
      ds.logo && isUsableLogoUrl(ds.logo)
        ? {
            url: ds.logo.url,
            background: ds.logo.background ?? undefined,
            width: ds.logo.width ?? null,
            height: ds.logo.height ?? null,
          }
        : null,
    palette: paletteTop,
    cssVariables: cssVars,
    typography: { families: [...families].slice(0, 6), styles: typographyStyles },
    spacing: { scaleType: ds.spacing?.scaleType, values: spacingValues },
    borderRadius: {
      values: radiiEntries,
      shapeLanguage: classifyShapeLanguage(radiiEntries.map((r) => r.value)),
    },
    shadows: shadowEntries,
    primaryButton: btnState ? { ...btnState } : null,
    frameworks,
  };
}
