/**
 * Chat runs (ch05 §5.6.1). The ordered creation pipeline of §5.2 (register-first, respond-early,
 * billing gate, abort checkpoints, run, finalize) with chat-specific behavior: the user message
 * is persisted immediately at creation; routing is floored at the standard tier (attachments
 * imply the code-generation hint); the marker machinery is server-side only; and terminal state
 * is owned exclusively by the finalize path (dual-fire guarded). Chat runs are ephemeral — they
 * live only in the in-memory registry (§5.2.1), so nothing persists to the jobs collection.
 */
import type { Actor } from '@ekoa/shared';
import { loadAgentsConfig } from '../config.js';
import { checkAllowance } from '../billing/index.js';
import { BILLING_PAGE_URL } from '../billing/constants.js';
import { runAgent, decideForTask } from '../llm/index.js';
import { runPostRunExtraction } from '../memory/index.js';
import {
  registerRun,
  getRun,
  finalizeOnce,
  settleChatRun,
  type LiveRunEntry,
} from './registry.js';
import { ChatStreamSink, emitBuildIntent, emitIntegrationBuildIntent } from './streaming.js';
import { MarkerProcessor, scanProviderError } from './markers.js';
import { toolPolicyFor } from './tools.js';
import { knowledgeToolSpecs } from './sdk-tools.js';
import { assembleRunContext, renderPrompt } from './context.js';
import { persistUserMessage, persistAssistantMessage, persistSessionContext } from './persistence.js';

export interface StartChatRunInput {
  actor: Actor;
  username: string;
  sessionId: string;
  message: string;
  language: string;
  attachments?: unknown[];
  deps: { now: () => number; genId: () => string };
}

/**
 * Register the chat run synchronously (§5.2 step 1: a fast Stop must always find its target) and
 * return the run id. The caller responds `202` immediately, then invokes `executeChatRun` fire-
 * and-forget — results arrive on the SSE stream (§5.2 step 2).
 */
export function createChatRun(input: StartChatRunInput): { runId: string; entry: LiveRunEntry } {
  const runId = input.deps.genId();
  const abort = new AbortController();
  const entry = registerRun({
    id: runId,
    ownerUserId: input.actor.userId,
    orgId: input.actor.orgId,
    kind: 'chat',
    abort,
    startedAt: input.deps.now(),
    sessionId: input.sessionId,
  });
  return { runId, entry };
}

/**
 * Execute the chat run. Fire-and-forget: never awaited by the route. Terminal state transitions
 * exactly once through `finalizeOnce` (§5.3.4). Returns when the run has reached a terminal state
 * (used by tests to await completion).
 */
export async function executeChatRun(runId: string, input: StartChatRunInput): Promise<void> {
  const entry = getRun(runId);
  if (!entry) return;
  const sink = new ChatStreamSink(runId);
  const start = input.deps.now();
  const cfg = loadAgentsConfig();

  // Timeout timer (§5.3.6): a single timer shared with cancel via the one AbortController; the
  // `timedOut` flag distinguishes a timeout (surfaces an error) from a user Stop (silent).
  let timer: NodeJS.Timeout;

  // Chat runs keep a terminal snapshot in the registry (readable until process exit, §5.2.1);
  // they are never removed on finalize — a restart empties the registry, giving the 404 (crit 2).
  const cleanup = (): void => clearTimeout(timer);
  const settleCancelled = (): void => { cleanup(); settleChatRun(runId, { status: 'cancelled' }); };
  // Abort checkpoint resolution (§5.3.6): a timeout must surface a terminal ERROR even when the
  // timer fires during an early await (billing gate, context assembly) — only a user Stop is
  // silent. Without the timedOut check a timeout landing before the stream was misreported as a
  // silent cancel (machine-load dependent; found by the G7B fresh-context review).
  const settleAborted = (): void => {
    if (entry.timedOut && !entry.cancelled) finishError('TIMEOUT', 'A execução excedeu o tempo limite.');
    else settleCancelled();
  };
  const finishError = (code: string, message: string): void => {
    cleanup();
    if (finalizeOnce(runId)) sink.error(code, message);
    settleChatRun(runId, { status: 'error', error: { code, message } });
  };
  const finishComplete = (result: unknown, delegate?: { kind: 'build' | 'integration'; request: Record<string, unknown> }): void => {
    cleanup();
    const durationMs = input.deps.now() - start;
    if (finalizeOnce(runId)) sink.complete(result, durationMs, delegate);
    settleChatRun(runId, { status: 'complete', result, durationMs });
  };

  timer = setTimeout(() => {
    entry.timedOut = true;
    entry.abort.abort();
  }, cfg.chatRunTimeoutMs);

  try {
    // Billing gate (§5.2 step 3).
    const allow = await checkAllowance(input.actor.userId);
    if (entry.abort.signal.aborted) { settleAborted(); return; } // abort checkpoint (§5.2 step 4)
    if (!allow.ok) {
      // The wire error event is {code, message}; the billing URL rides the message text (§5.2.3).
      const url = allow.billingUrl ?? BILLING_PAGE_URL;
      finishError('BILLING_BLOCKED', `${allow.message ?? 'Faturação bloqueada.'} ${url}`);
      return;
    }

    // User message persisted immediately (§5.6.1 step 1).
    await persistUserMessage(input.sessionId, input.message, input.deps);

    // Context assembly (§5.5).
    const assembled = await assembleRunContext({
      actor: input.actor,
      agentKind: 'chat',
      query: input.message,
      sessionId: input.sessionId,
      isChat: true,
      groundKnowledge: false,
      now: input.deps.now,
    });
    if (entry.abort.signal.aborted) { settleAborted(); return; }

    // Routing floored at the standard tier; attachments imply the code-generation hint (§5.6.1).
    const hasAttachments = !!input.attachments?.length;
    const decision = decideForTask(input.message, hasAttachments ? { complexityHint: 'high' } : undefined, 'WORKHORSE');
    const policy = hasAttachments ? toolPolicyFor('text-attachments') : toolPolicyFor('chat');
    // Chat runs mount the two knowledge tools as in-process MCP (§5.4.4); the attachments
    // variant is Read/Glob/Grep only and mounts nothing.
    const sdkTools = hasAttachments ? undefined : knowledgeToolSpecs(input.actor);

    const liveMarkers = new MarkerProcessor();
    const handle = runAgent(
      {
        prompt: renderPrompt(assembled.history, input.message),
        systemPrompt: assembled.systemPrompt || undefined,
        decision,
        allowedTools: policy.allowedTools,
        disallowedTools: policy.disallowedTools,
        maxTurns: policy.maxTurns,
        ...(sdkTools ? { sdkTools } : {}),
        signal: entry.abort.signal,
        callbacks: {
          onToolEvent: (e) => sink.toolEvent(e),
        },
      },
      { kind: 'user_work', agentType: 'chat', billeeUserId: input.actor.userId, sessionId: input.sessionId, runId },
    );

    // Live stream: marker-filter every delta so no marker leaks on the wire (§5.7.2).
    for await (const ev of handle.events) {
      const clean = liveMarkers.push(ev.text);
      if (clean) sink.text(clean);
    }
    const tail = liveMarkers.end();
    if (tail.text) sink.text(tail.text);
    const result = await handle.result;
    clearTimeout(timer);

    // Abort handling (§5.3.1, §5.3.6): a user Stop is silent; a timeout surfaces an error.
    if (result.aborted) { settleAborted(); return; }

    // Authoritative marker pass over the final result text (the full accumulated answer, F20).
    // push() RETURNS the marker-safe prefix and holds back a split-marker tail that end() then
    // flushes — the clean text is push() + end() concatenated. Discarding push()'s return (the
    // old code) kept only the ~25-char hold-back tail: the F20 truncation's second leg.
    const finalMarkers = new MarkerProcessor();
    const cleanHead = finalMarkers.push(result.text);
    const { text: cleanTail, findings } = finalMarkers.end();
    const cleanText = cleanHead + cleanTail;

    // Provider-error-as-result reroute (§5.3.7): never a fake "completed", never persisted.
    const provErr = scanProviderError(result.text);
    if (provErr) {
      finishError(provErr === 'auth' ? 'AUTH_ERROR' : 'PROVIDER_UNAVAILABLE', 'O fornecedor de modelo está indisponível.');
      return;
    }

    // Persist the last valid context block onto the session (§5.6.1 step 6).
    if (findings.contextBlocks.length) {
      await persistSessionContext(input.sessionId, findings.contextBlocks[findings.contextBlocks.length - 1]!);
    }

    // Delegation as typed events (§5.7.2): build/integration handoffs.
    if (findings.build) {
      emitBuildIntent(input.actor.userId, { sessionId: input.sessionId, sourceRunId: runId, request: { description: findings.build.description } });
      finishComplete('', { kind: 'build', request: { description: findings.build.description } });
      void scheduleExtraction(input, runId, `${input.message}`);
      return;
    }
    if (findings.integration) {
      emitIntegrationBuildIntent(input.actor.userId, { sessionId: input.sessionId, ...(findings.integration.hint ? { hint: findings.integration.hint } : {}) });
      finishComplete('', { kind: 'integration', request: { ...(findings.integration.hint ? { hint: findings.integration.hint } : {}) } });
      return;
    }

    // Normal completion: persist the assistant message (unless a provider-error, already handled).
    if (cleanText.trim()) await persistAssistantMessage(input.sessionId, cleanText, input.deps);
    finishComplete(cleanText);

    // Post-run memory extraction scheduled OFF the terminal event (§5.8): the terminal already
    // fired above, so extraction never delays completion.
    void scheduleExtraction(input, runId, `${input.message}\n\n${cleanText}`);
  } catch (err) {
    finishError('ADAPTER_ERROR', err instanceof Error ? err.message : 'Erro na execução.');
  }
}

/** Fire the post-run extraction; awaited only in tests via the returned promise. */
export function scheduleExtraction(input: StartChatRunInput, runId: string, transcript: string): Promise<unknown> {
  return runPostRunExtraction({
    userId: input.actor.userId,
    username: input.username,
    orgId: input.actor.orgId,
    sessionId: input.sessionId,
    runId,
    transcript,
    deps: input.deps,
  }).catch(() => undefined);
}
