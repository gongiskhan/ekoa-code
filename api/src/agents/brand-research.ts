/**
 * Brand-research jobs (ch05 §5.6.4). Created via `POST /branding/research`; state + events ride
 * the jobs resource (ch03 §3.8.4). The research AGENT is deliberately TOOL-LESS - no Bash/Read,
 * no browser - so a prompt-injected page cannot launder server configuration back as "the brand"
 * (§5.6.4). ALL site access is deterministic SERVER-SIDE code (services/branding/), reached only
 * through the injected pipeline seam; the model receives a server-built snapshot it cannot
 * influence and returns constrained JSON. Attributed `user_work` `brand-research`.
 *
 * Flow (site reachable): fetch site-context (fast HTML+CSS scrape) -> in parallel, rendered
 * colours + dembrandt design-system + visual-vibe screenshots -> scrub any website-builder chrome
 * -> build a grounded snapshot -> ONE tool-less `runOneShot` returning strict JSON (colours/fonts/
 * tone/instructions from the snapshot ONLY) -> resolve + store a real logo file -> merge colours/
 * fonts/tone/logo + designSystem + visualVibe onto org.branding. Site unreachable -> honest
 * degradation to the knowledge-only prompt (the pre-port behaviour), noted on the job result.
 */
import { BrandResearchResult, type Actor } from '@ekoa/shared';
import { checkAllowance } from '../billing/index.js';
import { runOneShot, decideForTask, LlmAbortedError, type LlmAttribution } from '../llm/index.js';
import { parseFirstJsonObject } from '../services/json-extract.js';
import { getOrg, updateOrg } from '../services/platform-crud.js';
import {
  getBrandingPipeline,
  detectSiteBuilder,
  scrubBuilderChrome,
  buildGroundedPrompt,
  trimDesignSystem,
  sanitizeBrandColors,
  isUsableLogoUrl,
  storeSvgLogo,
  pickLogoByVision,
  GROUNDED_SYSTEM,
  KNOWLEDGE_SYSTEM,
  type SiteContext,
  type RenderedCandidates,
  type DesignSystem,
  type VisualVibe,
  type StoredDesignSystem,
  type ResolveBrandLogoInput,
} from '../services/branding/index.js';
import { registerRun, removeRun, finalizeOnce } from './registry.js';
import { JobStreamSink, emitBrandingUpdated } from './streaming.js';
import { persistJob, patchJob, jobView, type JobRecord } from './jobs.js';

/** Research-metadata keys: ride the job record, never written onto org branding. */
const RESEARCH_META_KEYS = new Set(['summary', 'confidence', 'status']);

/**
 * Build the org-branding patch from a validated research result plus the server-attached
 * extractor outputs. Copies the branding-shaped fields (defined, non-empty), NEVER the research
 * metadata and NEVER an agent-proposed `logo` URL (the logo is server-resolved to a stored file).
 */
function buildBrandingPatch(
  result: BrandResearchResult,
  extras: { logo?: string | null; designSystem?: StoredDesignSystem; visualVibe?: VisualVibe | null },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result)) {
    if (RESEARCH_META_KEYS.has(k) || k === 'logo') continue; // logo is server-resolved only
    if (v === undefined || v === null || v === '') continue;
    patch[k] = v;
  }
  if (extras.logo) patch.logo = extras.logo;
  if (extras.designSystem) patch.designSystem = extras.designSystem;
  if (extras.visualVibe) patch.visualVibe = extras.visualVibe;
  return patch;
}

/**
 * Parse the model's text into a BrandResearchResult and MERGE the branding-shaped fields (plus
 * the server-attached design system / visual vibe / logo) onto the org's branding. Defined fields
 * only - a research result never wipes an existing value. Unparseable prose is not an error: the
 * job completes with `brandingApplied: false`.
 */
async function applyResearchedBranding(
  actor: Actor,
  text: string,
  extras: { logo?: string | null; designSystem?: StoredDesignSystem; visualVibe?: VisualVibe | null },
): Promise<{ branding: BrandResearchResult | null; applied: boolean }> {
  const parsed = parseFirstJsonObject(text);
  if (!parsed) return { branding: null, applied: false };
  const validated = BrandResearchResult.safeParse(parsed);
  if (!validated.success) return { branding: null, applied: false };

  // Sanitize a CLONE for the patch (a hallucinated grayscale primary is dropped), leaving the
  // job-result `branding` pristine so it still validates against the shared schema.
  const forPatch = sanitizeBrandColors({ ...validated.data });
  const patch = buildBrandingPatch(forPatch, extras);
  if (Object.keys(patch).length === 0) return { branding: validated.data, applied: false };

  const org = await getOrg(actor.orgId);
  const merged = { ...((org?.branding as Record<string, unknown>) ?? {}), ...patch };
  const updated = await updateOrg(actor.orgId, { branding: merged });
  return { branding: validated.data, applied: Boolean(updated) };
}

export interface BrandResearchInput {
  actor: Actor;
  /** The user turn (job.request.description + routing input): "URL do sítio web a investigar: ...". */
  prompt: string;
  /** The validated, scheme-normalised research target. */
  websiteUrl: string;
  language: string;
  deps: { now: () => number; genId: () => string };
}

/** Create the brand-research job synchronously and return its id; execution fires after. */
export function runBrandResearch(input: BrandResearchInput): { jobId: string; fire: () => void } {
  const jobId = input.deps.genId();
  const abort = new AbortController();
  registerRun({ id: jobId, ownerUserId: input.actor.userId, orgId: input.actor.orgId, kind: 'brand-research', abort, startedAt: input.deps.now() });
  const record: JobRecord = {
    _id: jobId,
    kind: 'brand-research',
    status: 'created',
    userId: input.actor.userId,
    request: { description: input.prompt, language: input.language },
    createdAt: new Date(input.deps.now()).toISOString(),
  };
  return { jobId, fire: () => void persistJob(record).then(() => executeBrandResearch(jobId, input, abort)) };
}

/**
 * Gather the deterministic snapshot for a reachable site: rendered colours + dembrandt +
 * visual-vibe run in parallel (each non-fatal), then builder chrome is scrubbed. Returns the
 * grounded user prompt, the scrubbed (trimmed) design system, the visual vibe, and the logo
 * extra-URL hints harvested from the server-side signals.
 */
async function gatherSnapshot(
  jobId: string,
  site: SiteContext,
  attribution: LlmAttribution,
  sink: JobStreamSink,
): Promise<{
  prompt: string;
  designSystem: StoredDesignSystem | undefined;
  visualVibe: VisualVibe | null;
  logoHints: Array<{ url: string; source: string; score?: number }>;
  /** Inline-SVG header logos, already stored as brand assets. */
  logoPreStored: Array<{ localPath: string; filename: string; size: number; score: number }>;
  /** Rendered header strip - the vision ground truth for the logo pick. */
  headerShot: Buffer | null;
}> {
  const pipeline = getBrandingPipeline();
  const builder = detectSiteBuilder(site.finalUrl, site.generator);
  if (builder) sink.planStep('running', `Construtor de sites detetado: ${builder.name} (chrome promocional será removido)`);

  sink.planStep('running', 'A amostrar cores renderizadas, sistema de design e vibe visual...');
  const [rendered, designSystemRaw, visualVibe] = await Promise.all([
    pipeline.fetchRenderedCandidates(site.finalUrl, { builder }).catch((): RenderedCandidates => ({ ok: false, candidates: [], paintedHexes: [], topFonts: [], chromeColors: [], chromeFonts: [] })),
    pipeline.fetchDesignSystem(site.finalUrl).catch((): DesignSystem | null => null),
    pipeline.fetchVisualVibe(site.finalUrl, { builder }, attribution).catch((): VisualVibe | null => null),
  ]);

  const scrubbed = scrubBuilderChrome(site, rendered, designSystemRaw, builder);
  const prompt = buildGroundedPrompt({ site: scrubbed.site, rendered, designSystem: scrubbed.designSystem, visualVibe, builder });

  // Logo hints, strongest first: what the RENDERED page shows as the logo (URL candidates +
  // inline SVGs stored immediately), then dembrandt's pick, then derived assets (favicons,
  // og:image) as last resorts.
  const logoHints: Array<{ url: string; source: string; score?: number }> = [];
  const logoPreStored: Array<{ localPath: string; filename: string; size: number; score: number }> = [];
  for (const cand of rendered.logoCandidates ?? []) {
    if (cand.url) {
      logoHints.push({ url: cand.url, source: 'rendered-header', score: cand.score });
    } else if (cand.svgText) {
      const stored = storeSvgLogo(cand.svgText);
      if (stored) logoPreStored.push({ ...stored, score: cand.score });
    }
  }
  const dsLogo = scrubbed.designSystem?.logo;
  if (dsLogo && isUsableLogoUrl(dsLogo)) logoHints.push({ url: dsLogo.url, source: 'design-system' });
  for (const f of scrubbed.designSystem?.favicons ?? []) if (f.url) logoHints.push({ url: f.url, source: 'favicon' });
  if (site.ogImage) logoHints.push({ url: site.ogImage, source: 'og-image' });
  if (site.favicon) logoHints.push({ url: site.favicon, source: 'favicon-link' });

  return {
    prompt,
    designSystem: scrubbed.designSystem ? trimDesignSystem(scrubbed.designSystem) : undefined,
    visualVibe,
    logoHints,
    logoPreStored,
    headerShot: rendered.headerShot ?? null,
  };
}

async function executeBrandResearch(jobId: string, input: BrandResearchInput, abort: AbortController): Promise<void> {
  const sink = new JobStreamSink(jobId);
  const start = input.deps.now();
  const pipeline = getBrandingPipeline();
  const attribution: LlmAttribution = { kind: 'user_work', agentType: 'brand-research', billeeUserId: input.actor.userId, runId: jobId };
  try {
    await patchJob(jobId, { status: 'running', startedAt: new Date(input.deps.now()).toISOString() });
    const allow = await checkAllowance(input.actor.userId);
    if (abort.signal.aborted) { removeRun(jobId); return; }
    if (!allow.ok) {
      if (finalizeOnce(jobId)) { sink.error('BILLING_BLOCKED', allow.message ?? 'Faturação bloqueada.'); await patchJob(jobId, { status: 'failed', error: { code: 'BILLING_BLOCKED', message: allow.message ?? '' }, endedAt: new Date(input.deps.now()).toISOString() }); }
      removeRun(jobId);
      return;
    }

    // 1) Fast HTML+CSS scrape. On failure the site is UNREACHABLE - degrade honestly to knowledge.
    sink.planStep('running', 'A obter o site...');
    const site = await pipeline.fetchSiteContext(input.websiteUrl).catch((): SiteContext | null => null);
    const reachable = !!site && site.ok;

    let systemPrompt: string;
    let userPrompt: string;
    let designSystem: StoredDesignSystem | undefined;
    let visualVibe: VisualVibe | null = null;
    let logoHints: Array<{ url: string; source: string; score?: number }> = [];
    let logoPreStored: Array<{ localPath: string; filename: string; size: number; score: number }> = [];
    let headerShot: Buffer | null = null;

    if (reachable && site) {
      // 2-3) Parallel signal gathering + grounded snapshot.
      const snap = await gatherSnapshot(jobId, site, attribution, sink);
      if (abort.signal.aborted) { removeRun(jobId); return; }
      systemPrompt = GROUNDED_SYSTEM;
      userPrompt = snap.prompt;
      designSystem = snap.designSystem;
      visualVibe = snap.visualVibe;
      logoHints = snap.logoHints;
      logoPreStored = snap.logoPreStored;
      headerShot = snap.headerShot;
    } else {
      // Honest degradation: no snapshot, knowledge-only proposals.
      sink.planStep('running', 'Site inacessível - a propor identidade a partir de conhecimento de marca.');
      systemPrompt = KNOWLEDGE_SYSTEM;
      userPrompt = input.prompt;
    }

    const decision = decideForTask(input.prompt, undefined, 'WORKHORSE');
    sink.routing(decision.tier, reachable ? 'brand research (grounded)' : 'brand research (knowledge)');

    // 3) ONE tool-less synthesis. runOneShot is tool-less by construction (§5.6.4).
    let res;
    try {
      res = await runOneShot({ prompt: userPrompt, systemPrompt, decision, signal: abort.signal }, attribution);
    } catch (err) {
      if (err instanceof LlmAbortedError || abort.signal.aborted) { removeRun(jobId); return; }
      throw err;
    }
    if (abort.signal.aborted) { removeRun(jobId); return; }
    const finalText = res.text;

    // 4) Resolve + store a real logo file (reachable sites only - a store needs a live fetch).
    // Selection = rendered-header harvest first, then ONE vision confirmation against the
    // header strip (what the old browser-driving agent did by eye, tool-lessly).
    let logo: string | null = null;
    if (reachable && site) {
      sink.planStep('running', 'A selecionar e guardar o logótipo...');
      const resolveInput: ResolveBrandLogoInput = {
        websiteUrl: site.finalUrl,
        extraUrls: logoHints,
        builder: detectSiteBuilder(site.finalUrl, site.generator),
        preStored: logoPreStored,
        ...(headerShot
          ? {
              vision: {
                headerShot,
                pick: (args) => pickLogoByVision({ ...args, attribution }),
              },
            }
          : {}),
      };
      logo = await pipeline.resolveBrandLogo(resolveInput).catch(() => null);
    }
    if (abort.signal.aborted) { removeRun(jobId); return; }

    // 5) Parse + merge-write onto org branding (colours/fonts/tone/instructions + designSystem +
    // visualVibe + logo). This is the persistence step the pre-port research skipped.
    const { branding, applied } = await applyResearchedBranding(input.actor, finalText, { logo, designSystem, visualVibe });
    // Live brand refresh: the header logo/theme must follow WITHOUT a page reload
    // (operator report 2026-07-11: "kept the old brand until a refresh").
    if (applied) emitBrandingUpdated(input.actor.userId);

    if (finalizeOnce(jobId)) {
      sink.complete({ result: finalText }, input.deps.now() - start);
      await patchJob(jobId, {
        status: 'completed',
        result: {
          text: finalText,
          branding: (branding ?? undefined) as Record<string, unknown> | undefined,
          brandingApplied: applied,
          // Honest signal for the job viewer: whether the site could be read.
          siteReachable: reachable,
        },
        endedAt: new Date(input.deps.now()).toISOString(),
      });
    }
  } catch (err) {
    if (finalizeOnce(jobId)) { sink.error('ADAPTER_ERROR', 'A pesquisa falhou.'); await patchJob(jobId, { status: 'failed', error: { code: 'ADAPTER_ERROR', message: err instanceof Error ? err.message : '' }, endedAt: new Date(input.deps.now()).toISOString() }); }
  } finally {
    removeRun(jobId);
  }
}

export { jobView };
