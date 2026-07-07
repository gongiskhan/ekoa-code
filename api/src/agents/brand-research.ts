/**
 * Brand-research jobs (ch05 §5.6.4). Created via `POST /branding/research`; state + events ride
 * the jobs resource (ch03 §3.8.4). The research agent is deliberately TOOL-LESS — no Bash/Read —
 * so a prompt-injected page cannot launder server configuration back as "the brand" (§5.6.4).
 * Attributed `user_work` `brand-research`.
 */
import type { Actor } from '@ekoa/shared';
import { checkAllowance } from '../billing/index.js';
import { runAgent, decideForTask } from '../llm/index.js';
import { registerRun, removeRun, finalizeOnce } from './registry.js';
import { JobStreamSink } from './streaming.js';
import { toolPolicyFor } from './tools.js';
import { persistJob, patchJob, jobView, type JobRecord } from './jobs.js';

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
      { prompt: input.prompt, decision, disallowedTools: policy.disallowedTools, maxTurns: policy.maxTurns, signal: abort.signal },
      { kind: 'user_work', agentType: 'brand-research', billeeUserId: input.actor.userId, runId: jobId },
    );
    let text = '';
    for await (const ev of handle.events) { text += ev.text; sink.text(ev.text); }
    const result = await handle.result;
    if (result.aborted) { removeRun(jobId); return; }
    if (finalizeOnce(jobId)) {
      sink.complete({ result: result.text || text }, input.deps.now() - start);
      await patchJob(jobId, { status: 'completed', result: { text: result.text || text }, endedAt: new Date(input.deps.now()).toISOString() });
    }
  } catch (err) {
    if (finalizeOnce(jobId)) { sink.error('ADAPTER_ERROR', 'A pesquisa falhou.'); await patchJob(jobId, { status: 'failed', error: { code: 'ADAPTER_ERROR', message: err instanceof Error ? err.message : '' }, endedAt: new Date(input.deps.now()).toISOString() }); }
  } finally {
    removeRun(jobId);
  }
}

export { jobView };
