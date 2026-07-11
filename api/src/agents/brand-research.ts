/**
 * Brand-research jobs (ch05 §5.6.4). Created via `POST /branding/research`; state + events ride
 * the jobs resource (ch03 §3.8.4). The research agent is deliberately TOOL-LESS — no Bash/Read —
 * so a prompt-injected page cannot launder server configuration back as "the brand" (§5.6.4).
 * Attributed `user_work` `brand-research`.
 */
import { BrandResearchResult, type Actor } from '@ekoa/shared';
import { checkAllowance } from '../billing/index.js';
import { runAgent, decideForTask } from '../llm/index.js';
import { parseFirstJsonObject } from '../services/json-extract.js';
import { getOrg, updateOrg } from '../services/platform-crud.js';
import { registerRun, removeRun, finalizeOnce } from './registry.js';
import { JobStreamSink } from './streaming.js';
import { toolPolicyFor } from './tools.js';
import { persistJob, patchJob, jobView, type JobRecord } from './jobs.js';

/**
 * System prompt (distilled from the old-cortex brand-research instruction): the agent is
 * TOOL-LESS by design (§5.6.4 anti-injection) — it cannot browse, so colors/fonts/tone are
 * PROPOSALS from brand knowledge, honestly flagged by `confidence`, emitted as ONE JSON object
 * whose keys align with the shared BrandResearchResult / OrgBranding schemas.
 */
const BRAND_RESEARCH_SYSTEM = `És o investigador de marca da plataforma. Recebes o URL de um sítio web e propões a identidade de marca da empresa a partir do teu conhecimento sobre a marca e das convenções do setor. NÃO tens ferramentas nem acesso à web: nunca afirmes ter medido cores ou lido a página; as tuas propostas são estimativas assinaladas por "confidence".

Responde com EXATAMENTE um objeto JSON (sem texto antes ou depois, sem cercas de código):
{
  "websiteUrl": "<o URL recebido>",
  "primaryColor": "#RRGGBB",
  "accentColor": "#RRGGBB",
  "secondaryColor": "#RRGGBB",
  "logo": "<URL absoluto de um logotipo que conheças, senão omite>",
  "fonts": ["<família tipográfica proposta>"],
  "toneOfVoice": "<uma frase sobre o tom de comunicação>",
  "summary": "<2-3 frases sobre a empresa e o racional das escolhas>",
  "confidence": "low" | "medium" | "high"
}

Regras: cores em hexadecimal de 6 dígitos; omite qualquer campo que não consigas propor com razoabilidade (nunca inventes um URL de logotipo); "confidence" reflete o teu conhecimento real da marca — uma marca conhecida = "high", uma empresa desconhecida = "low" com uma paleta profissional adequada ao setor.`;

/** Research-metadata keys: ride the job record, never written onto org branding. */
const RESEARCH_META_KEYS = new Set(['summary', 'confidence']);

/**
 * Parse the agent's text into a BrandResearchResult and MERGE the branding-shaped fields onto
 * the org's branding (defined fields only — a research result never wipes existing values).
 * Unparseable prose is not an error: the job completes with `brandingApplied: false`.
 */
async function applyResearchedBranding(
  actor: Actor,
  text: string,
): Promise<{ branding: BrandResearchResult | null; applied: boolean }> {
  const parsed = parseFirstJsonObject(text);
  if (!parsed) return { branding: null, applied: false };
  const validated = BrandResearchResult.safeParse(parsed);
  if (!validated.success) return { branding: null, applied: false };

  const brandingPatch = Object.fromEntries(
    Object.entries(validated.data).filter(
      ([k, v]) => !RESEARCH_META_KEYS.has(k) && v !== undefined && v !== null && v !== '',
    ),
  );
  if (Object.keys(brandingPatch).length === 0) return { branding: validated.data, applied: false };

  const org = await getOrg(actor.orgId);
  const merged = { ...((org?.branding as Record<string, unknown>) ?? {}), ...brandingPatch };
  const updated = await updateOrg(actor.orgId, { branding: merged });
  return { branding: validated.data, applied: Boolean(updated) };
}

export interface BrandResearchInput {
  actor: Actor;
  prompt: string;
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

async function executeBrandResearch(jobId: string, input: BrandResearchInput, abort: AbortController): Promise<void> {
  const sink = new JobStreamSink(jobId);
  const start = input.deps.now();
  try {
    await patchJob(jobId, { status: 'running', startedAt: new Date(input.deps.now()).toISOString() });
    const allow = await checkAllowance(input.actor.userId);
    if (abort.signal.aborted) { removeRun(jobId); return; }
    if (!allow.ok) {
      if (finalizeOnce(jobId)) { sink.error('BILLING_BLOCKED', allow.message ?? 'Faturação bloqueada.'); await patchJob(jobId, { status: 'failed', error: { code: 'BILLING_BLOCKED', message: allow.message ?? '' }, endedAt: new Date(input.deps.now()).toISOString() }); }
      removeRun(jobId);
      return;
    }
    const decision = decideForTask(input.prompt, undefined, 'WORKHORSE');
    sink.routing(decision.tier, 'brand research');
    const policy = toolPolicyFor('brand-research');
    const handle = runAgent(
      { prompt: input.prompt, systemPrompt: BRAND_RESEARCH_SYSTEM, decision, disallowedTools: policy.disallowedTools, maxTurns: policy.maxTurns, signal: abort.signal },
      { kind: 'user_work', agentType: 'brand-research', billeeUserId: input.actor.userId, runId: jobId },
    );
    let text = '';
    for await (const ev of handle.events) { text += ev.text; sink.text(ev.text); }
    const result = await handle.result;
    if (result.aborted) { removeRun(jobId); return; }
    const finalText = result.text || text;
    // THE persistence step (pre-fix the research wrote only the jobs record while the UI reads
    // org branding — "success" with nothing stored): parse + merge-write onto org branding.
    const { branding, applied } = await applyResearchedBranding(input.actor, finalText);
    if (finalizeOnce(jobId)) {
      sink.complete({ result: finalText }, input.deps.now() - start);
      await patchJob(jobId, {
        status: 'completed',
        result: { text: finalText, branding: branding ?? undefined, brandingApplied: applied },
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
