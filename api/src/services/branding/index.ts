/**
 * Brand-research pipeline seam (ch05 §5.6.4). The orchestrator in
 * `agents/brand-research.ts` reaches the deterministic server-side services
 * (site fetch, rendered sampling, dembrandt, visual vibe, logo store) ONLY
 * through this seam, so tests inject fixture data and never hit the network,
 * launch a browser, spawn dembrandt, or call the model - the same pattern the
 * llm/ chokepoint transport uses.
 *
 * The agent itself stays TOOL-LESS: this is server code, invisible to the model.
 */

import { fetchSiteContext, type SiteContext } from './site-context.js';
import { fetchRenderedCandidates, type RenderedCandidates, type FetchRenderedOptions } from './rendered-candidates.js';
import { fetchDesignSystem, type DesignSystem } from './design-system.js';
import { fetchVisualVibe, type VisualVibe, type FetchVisualVibeOptions } from './visual-vibe.js';
import { resolveBrandLogo } from './brand-assets.js';
import type { LlmAttribution } from '../../llm/index.js';

// Re-export the surface the orchestrator + tests consume so they import from one place.
export { detectSiteBuilder, type SiteBuilder } from './site-builder.js';
export { trimDesignSystem, isUsableLogoUrl, type DesignSystem, type StoredDesignSystem } from './design-system.js';
export { scrubBuilderChrome, buildGroundedPrompt, collectAllowedHexes, GROUNDED_SYSTEM, KNOWLEDGE_SYSTEM } from './snapshot.js';
export { sanitizeBrandColors, isGrayscale } from './color-filter.js';
export { getBrandAssetsDir, storeSvgLogo } from './brand-assets.js';
export { pickLogoByVision } from './logo-vision.js';
export type { ResolveBrandLogoInput, LogoCandidate } from './brand-assets.js';
export { normalizeHexLike } from './site-context.js';
export type { SiteContext } from './site-context.js';
export type { RenderedCandidates, RenderedLogoCandidate } from './rendered-candidates.js';
export type { VisualVibe } from './visual-vibe.js';

/**
 * The deterministic side of brand research. `fetchVisualVibe` and `resolveBrandLogo`
 * take the per-run attribution / site context they need; everything else is a thin
 * pass-through to the underlying service.
 */
export interface BrandingPipeline {
  fetchSiteContext(url: string): Promise<SiteContext>;
  fetchRenderedCandidates(url: string, opts: FetchRenderedOptions): Promise<RenderedCandidates>;
  fetchDesignSystem(url: string): Promise<DesignSystem | null>;
  fetchVisualVibe(url: string, opts: FetchVisualVibeOptions, attribution: LlmAttribution): Promise<VisualVibe | null>;
  resolveBrandLogo(input: import('./brand-assets.js').ResolveBrandLogoInput): Promise<string | null>;
}

/** The real pipeline: live fetch, browser, dembrandt, model, disk. */
export const defaultBrandingPipeline: BrandingPipeline = {
  fetchSiteContext,
  fetchRenderedCandidates,
  fetchDesignSystem,
  fetchVisualVibe,
  resolveBrandLogo,
};

let active: BrandingPipeline = defaultBrandingPipeline;

/** The pipeline the orchestrator runs. Reads the current binding at call time. */
export function getBrandingPipeline(): BrandingPipeline {
  return active;
}

/** Inject a fake pipeline for tests (no network/browser/dembrandt/model). */
export function __setBrandingPipelineForTests(p: Partial<BrandingPipeline>): void {
  active = { ...defaultBrandingPipeline, ...p };
}

export function __resetBrandingPipelineForTests(): void {
  active = defaultBrandingPipeline;
}
