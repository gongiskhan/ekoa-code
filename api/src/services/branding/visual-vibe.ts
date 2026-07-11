/**
 * Visual vibe extraction (ch05 §5.6.4). Capture screenshots of the live site and
 * pass them to a vision model so brand research captures stylistic signals that
 * pure computed-style analysis misses: mood (playful/serious), density
 * (minimal/dense), texture (flat/glass/neon), hero treatment.
 *
 * The model call goes through the llm/ chokepoint (`runOneShot` with `images`,
 * FIXED-3) - there is no provider client here. Attribution is `user_work`
 * `brand-research`, billed to the requesting user.
 *
 * Non-fatal: any failure (screenshot timeout, model error, JSON parse failure)
 * returns null and the caller proceeds without vibe data.
 */

import { runOneShot, decideForTier, type LlmAttribution } from '../../llm/index.js';
import { getSharedBrowser } from '../browser-pool.js';
import { stripBuilderChrome, type SiteBuilder } from './site-builder.js';
import { stripConsentChrome } from './consent-chrome.js';

// ============================================
// Types
// ============================================

export interface VisualVibe {
  /** 2-4 word label summarizing the site's overall feel. */
  mood: string;
  /** Bulleted observations the agent can quote. */
  bullets: string[];
  /** One of: sharp, rounded, organic, mixed, unknown. */
  shape: 'sharp' | 'rounded' | 'organic' | 'mixed' | 'unknown';
  /** One of: minimal, balanced, dense, unknown. */
  density: 'minimal' | 'balanced' | 'dense' | 'unknown';
  /** One of: flat, glass, gradient-heavy, skeuomorphic, neon, mixed, unknown. */
  texture: 'flat' | 'glass' | 'gradient-heavy' | 'skeuomorphic' | 'neon' | 'mixed' | 'unknown';
  /** Hero treatment description. */
  hero: string;
}

export interface FetchVisualVibeOptions {
  /** Overall timeout for screenshots + model call. Default 45s. */
  timeoutMs?: number;
  /** When set, the builder's injected chrome is stripped before screenshots. */
  builder?: SiteBuilder | null;
}

// ============================================
// Constants
// ============================================

const SHOT_WIDTH = 1280;
const SHOT_HEIGHT = 800;
const NAV_TIMEOUT_MS = 20_000;
const SETTLE_MS = 600;

// ============================================
// Public API
// ============================================

/**
 * Capture three viewport screenshots of the live site (above-fold, mid-page,
 * footer) and ask the FAST vision model to describe its visual vibe as a
 * structured JSON object.
 */
export async function fetchVisualVibe(
  url: string,
  options: FetchVisualVibeOptions,
  attribution: LlmAttribution,
): Promise<VisualVibe | null> {
  const { timeoutMs = 45_000, builder = null } = options;
  const deadline = Date.now() + timeoutMs;

  let shots: Buffer[];
  try {
    shots = await captureStripScreenshots(url, deadline, builder);
  } catch (err) {
    console.warn(`[visual-vibe] screenshot failed: ${errMsg(err)}`);
    return null;
  }
  if (shots.length === 0) {
    console.warn(`[visual-vibe] no screenshots captured for ${url}`);
    return null;
  }

  try {
    return await analyzeScreenshots(shots, url, attribution);
  } catch (err) {
    console.warn(`[visual-vibe] analysis failed: ${errMsg(err)}`);
    return null;
  }
}

/**
 * Compact markdown block for injection into the branding-agent prompt. Returns an
 * empty string when vibe is null so the caller can unconditionally concatenate.
 */
export function summarizeVisualVibe(vibe: VisualVibe | null): string {
  if (!vibe) return '';
  const lines: string[] = [];
  lines.push('## Vibe visual (extraída de capturas de ecrã por modelo de visão)');
  lines.push('');
  lines.push(`Ambiente (mood): ${vibe.mood}`);
  lines.push(`Forma: ${vibe.shape}  -  Densidade: ${vibe.density}  -  Textura: ${vibe.texture}`);
  lines.push(`Hero: ${vibe.hero}`);
  if (vibe.bullets.length > 0) {
    lines.push('');
    lines.push('Observações:');
    for (const b of vibe.bullets.slice(0, 5)) {
      lines.push(`  - ${b}`);
    }
  }
  return lines.join('\n');
}

// ============================================
// Screenshot strip capture
// ============================================

/**
 * Capture three 1280x800 viewport screenshots at 0%, 50%, 100% of page height.
 * Uses the shared browser pool. Non-fatal per shot.
 */
async function captureStripScreenshots(
  url: string,
  deadline: number,
  builder: SiteBuilder | null = null,
): Promise<Buffer[]> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage({ viewport: { width: SHOT_WIDTH, height: SHOT_HEIGHT } });
  const shots: Buffer[] = [];

  try {
    const navBudget = Math.max(5_000, Math.min(NAV_TIMEOUT_MS, deadline - Date.now()));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navBudget });
    await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    // Remove the builder's promo chrome so the vision model judges the owner's
    // site, not the builder's "create your website" banner - and any consent-vendor
    // overlay, which otherwise covers the hero shot on any site.
    await stripConsentChrome(page);
    if (builder) await stripBuilderChrome(page, builder);

    const scrollTargets: Array<{ label: string; pct: number }> = [
      { label: 'hero', pct: 0 },
      { label: 'mid', pct: 0.5 },
      { label: 'footer', pct: 1 },
    ];

    for (const target of scrollTargets) {
      if (Date.now() > deadline) break;
      try {
        if (target.pct > 0) {
          // String evaluate (no DOM lib in the api tsconfig): scroll to a fraction
          // of the page height, instantly.
          await page.evaluate(`window.scrollTo({ top: document.body.scrollHeight * ${target.pct}, behavior: 'instant' })`);
          await page.waitForTimeout(SETTLE_MS);
        }
        // JPEG q60, not PNG: three viewport PNGs of a photo-heavy site can exceed the
        // provider's 32MB request cap once base64-encoded (observed live 2026-07-11,
        // "Request too large"); JPEG keeps each shot in the low hundreds of KB.
        const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
        shots.push(buf);
      } catch (err) {
        console.warn(`[visual-vibe] shot failed (${target.label}): ${errMsg(err)}`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }
  return shots;
}

// ============================================
// Vision analysis
// ============================================

const VIBE_SYSTEM = `És um designer de marca sénior a rever capturas de ecrã de um site de empresa. Descreve a "vibe" visual do site - sinais estilísticos que importam para reproduzir a marca em UI gerada.

Devolve APENAS um objeto JSON com esta forma exata, mais nada:

{
  "mood": "rótulo de 2-4 palavras, ex.: 'moderno minimalista', 'quente e acolhedor', 'ousado editorial'",
  "bullets": ["observação 1", "observação 2", "observação 3"],
  "shape": "sharp" | "rounded" | "organic" | "mixed" | "unknown",
  "density": "minimal" | "balanced" | "dense" | "unknown",
  "texture": "flat" | "glass" | "gradient-heavy" | "skeuomorphic" | "neon" | "mixed" | "unknown",
  "hero": "uma frase a descrever o tratamento do hero"
}

Regras:
- 3-5 bullets, cada uma com menos de 15 palavras. Observações visuais concretas (cores, tipografia, padrões de layout, estilo de imagens).
- Nunca inventes texto que não esteja nas imagens. As bullets descrevem elementos VISTOS, não pressupostos sobre o negócio.
- IGNORA qualquer chrome promocional de construtor de sites (uma barra "Cria o teu site / Powered by ...", banners de cookies). Não faz parte da marca - descreve só o conteúdo do dono.
- Se receberes menos de 3 capturas, trabalha com o que tens - não reclames.`;

async function analyzeScreenshots(shots: Buffer[], url: string, attribution: LlmAttribution): Promise<VisualVibe | null> {
  const res = await runOneShot(
    {
      prompt: `Site: ${url}`,
      systemPrompt: VIBE_SYSTEM,
      images: shots.map((buf) => ({ mediaType: 'image/jpeg', data: buf.toString('base64') })),
      decision: decideForTier('FAST'),
    },
    attribution,
  );
  return parseVibeJson(res.text);
}

/**
 * Extract the first JSON object from the model's response by brace counting.
 * Returns null on parse or shape failure; the caller treats that as "no vibe data".
 */
export function parseVibeJson(text: string): VisualVibe | null {
  if (!text) return null;
  const fenceless = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '');
  const start = fenceless.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < fenceless.length; i++) {
    const ch = fenceless[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    const obj = JSON.parse(fenceless.slice(start, end + 1)) as Partial<VisualVibe>;
    return {
      mood: typeof obj.mood === 'string' ? obj.mood : 'unknown',
      bullets: Array.isArray(obj.bullets) ? obj.bullets.filter((b): b is string => typeof b === 'string') : [],
      shape: normalizeEnum(obj.shape, ['sharp', 'rounded', 'organic', 'mixed', 'unknown']) as VisualVibe['shape'],
      density: normalizeEnum(obj.density, ['minimal', 'balanced', 'dense', 'unknown']) as VisualVibe['density'],
      texture: normalizeEnum(obj.texture, ['flat', 'glass', 'gradient-heavy', 'skeuomorphic', 'neon', 'mixed', 'unknown']) as VisualVibe['texture'],
      hero: typeof obj.hero === 'string' ? obj.hero : 'unknown',
    };
  } catch {
    return null;
  }
}

function normalizeEnum(value: unknown, allowed: string[]): string {
  if (typeof value !== 'string') return 'unknown';
  const lower = value.toLowerCase().trim();
  return allowed.includes(lower) ? lower : 'unknown';
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
