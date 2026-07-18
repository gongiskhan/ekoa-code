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
import { StreamingIdentityRedactor } from './branding.js';
import { toolPolicyFor } from './tools.js';
import { knowledgeToolSpecs, delegateToolSpec } from './sdk-tools.js';
import { getLocalActivitySources, type DelegationToolResult } from './seams.js';
import { assembleRunContext, renderPrompt, referencesContextLine } from './context.js';
import { persistUserMessage, persistAssistantMessage, persistSessionContext } from './persistence.js';
import { scheduleReplySummary } from './reply-summary.js';
import { derivedSheetId, derivedRevisionId, findSessionSheet, appendSheetRevision } from '../data/session-sheets.js';

export interface StartChatRunInput {
  actor: Actor;
  username: string;
  sessionId: string;
  message: string;
  language: string;
  attachments?: unknown[];
  /** FC-400/D4 (run s6): composer reference tokens — injected as ONE context line so the
   *  model calls delegate_to_local with real grantRefs (never hand-typed chat text). */
  references?: Array<{ grantRef: string; label: string }>;
  /** B5 (locked 5+7): the composer chip's target — the completed reply persists as a NEW
   *  REVISION on this sheet (editSource 'agent', instruction = the user message) instead of
   *  spawning a new sheet. Unknown ids fall back to fresh-sheet behavior. */
  reviseSheetId?: string;
  /** C5 (BRIEF §5): 'voice' marks a voice-sourced turn — the run context then carries the
   *  spoken-modality system note (context.ts voiceContextNote; never shortens replies).
   *  C7 closed the seam: shared/ ChatRunCreateRequest.source rides the wire, routes/chat.ts
   *  copies it here verbatim, and the mic UI's send path (chat-panel.tsx / page.tsx
   *  handleChatSend) sets it when the composer sends a transcript from an active voice
   *  session. The paired audit signal (source:'voice' on the voice.turn activity row) is the
   *  voice WS session's own write (api/src/voice/index.ts auditTurn, C2) — independent of this
   *  field, which only drives output shaping. */
  source?: 'voice';
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
      voiceActive: input.source === 'voice',
      now: input.deps.now,
    });
    if (entry.abort.signal.aborted) { settleAborted(); return; }

    // Routing floored at the standard tier; attachments imply the code-generation hint (§5.6.1).
    const hasAttachments = !!input.attachments?.length;
    const decision = decideForTask(input.message, hasAttachments ? { complexityHint: 'high' } : undefined, 'WORKHORSE');
    const policy = hasAttachments ? toolPolicyFor('text-attachments') : toolPolicyFor('chat');
    // Chat runs mount the two knowledge tools + the §5.4.8 local-bridge delegation tool as
    // in-process MCP (§5.4.4; ch18 §18.2); the attachments variant is Read/Glob/Grep only and
    // mounts nothing. The delegation collector feeds the FC-402 trust chip: results carry the
    // citations + ledgerRefs the per-turn `local_activity` join reads (run s5, D3).
    const delegations: DelegationToolResult[] = [];
    const sdkTools = hasAttachments
      ? undefined
      : [
          ...knowledgeToolSpecs(input.actor),
          delegateToolSpec(input.actor, input.sessionId, (r) => delegations.push(r)),
        ];

    // FC-400/D4 (run s6): reference tokens become ONE system-prompt line with real grantRefs.
    // Only when the delegation tool is actually mounted (the attachments variant mounts no
    // tools — a line instructing an absent tool would be a lie to the model).
    const refLine = hasAttachments ? '' : referencesContextLine(input.references);
    const systemPrompt = [assembled.systemPrompt, refLine].filter(Boolean).join('\n\n');

    let liveMarkers = new MarkerProcessor(); // replaced on `text_reset` (B7 retraction)
    const handle = runAgent(
      {
        prompt: renderPrompt(assembled.history, input.message),
        systemPrompt: systemPrompt || undefined,
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

    // Live stream: marker-filter every delta so no marker — partial or whole — leaks on the
    // wire (§5.7.2), on EITHER channel. The thinking channel (intermediate turns + thinking
    // blocks, classified at the llm/ transport) gets its own processor (stateful hold-back)
    // and is engine-identity-redacted here (branding.ts): the persona governs answers, not
    // thinking, so the model self-identifies freely in commentary. Thinking findings never
    // trigger delegation — action markers are answer-level signals only.
    const thinkingMarkers = new MarkerProcessor();
    const thinkingRedactor = new StreamingIdentityRedactor(); // straddle-safe engine-identity redaction
    let thinkingClean = ''; // marker-free, redacted commentary — persisted for reload replay
    let thinkingStartedAt: number | undefined;
    let thinkingEndedAt: number | undefined;
    let streamedAny = false; // ANSWER chunks only: thinking must not mask a provider-error-as-result
    const emitThinking = (piece: string): void => {
      if (!piece) return;
      thinkingClean += piece;
      sink.thinking(piece);
    };
    for await (const ev of handle.events) {
      if (ev.type === 'thinking') {
        thinkingStartedAt ??= input.deps.now();
        emitThinking(thinkingRedactor.push(thinkingMarkers.push(ev.text)));
        continue;
      }
      if (ev.type === 'text_reset') {
        // B7 retraction: the deltas streamed so far this turn were narration (a tool turn's
        // preamble) or a diverged optimistic stream, not the answer. Fresh marker state for
        // the real answer; `streamedAny` returns to false so the §5.3.7 error-as-result scan
        // still applies to a run whose only streamed content was retracted. FORWARDED to the
        // client (codex B7 finding): the wire event is the ONLY signal on which the client
        // drops its buffered stream — a divergence reset has no tool_event following it, and
        // a tool call with no pre-tool text must not delete legitimate text.
        streamedAny = false;
        liveMarkers = new MarkerProcessor();
        sink.textReset();
        continue;
      }
      streamedAny = true;
      if (thinkingStartedAt !== undefined && thinkingEndedAt === undefined) thinkingEndedAt = input.deps.now();
      const clean = liveMarkers.push(ev.text);
      if (clean) sink.text(clean);
    }
    const thinkingTail = thinkingMarkers.end();
    emitThinking(thinkingRedactor.push(thinkingTail.text) + thinkingRedactor.end());
    if (thinkingStartedAt !== undefined && thinkingEndedAt === undefined) thinkingEndedAt = input.deps.now();
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
    // Scanned ONLY on the nothing-streamed fallback shape (a provider failure aborts the request,
    // so an error-as-result arrives with no deltas): with F20 making result.text the FULL answer,
    // scanning a streamed answer would discard legitimate prose that mentions an error term
    // ("o erro HTTP 429 significa...") as a fake provider outage.
    const provErr = streamedAny ? undefined : scanProviderError(result.text);
    if (provErr) {
      finishError(provErr === 'auth' ? 'AUTH_ERROR' : 'PROVIDER_UNAVAILABLE', 'O fornecedor de modelo está indisponível.');
      return;
    }

    // FC-402 (run s5, D3): a turn whose delegation read local excerpts emits ONE
    // `local_activity` event — files+ranges from the results' citations, bytes-out from the
    // buffered daemon ledger rows (falling back to result telemetry), mask counts from the
    // anon-audit join on the correlation ids. Transient: streamed, never persisted (§18.2).
    const activity = await joinLocalActivity(input.sessionId, input.actor.orgId, delegations);
    if (activity) sink.localActivity(activity);

    // Persist the last valid context block onto the session (§5.6.1 step 6). A context block
    // emitted during an intermediate turn (thinking channel) still counts; an answer-channel
    // block wins as "last" over any thinking-channel one.
    const contextBlocks = [...thinkingTail.findings.contextBlocks, ...findings.contextBlocks];
    if (contextBlocks.length) {
      await persistSessionContext(input.sessionId, contextBlocks[contextBlocks.length - 1]!);
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
    // Thinking rides in metadata (already marker-free + redacted) so a reloaded session can still
    // offer the collapsed thinking section the live stream showed. Provenance (B1): `traceId`
    // (the run id - the web's feedback buttons post it back as runId) and `memoriesUsed` (layer-1
    // injection count) were typed on the web ChatMessage.metadata since the port but never
    // written; they are stamped here on every persisted assistant turn.
    const thinkingMeta = thinkingClean.trim()
      ? {
          thinking: thinkingClean,
          ...(thinkingStartedAt !== undefined && thinkingEndedAt !== undefined
            ? { thinkingDurationMs: thinkingEndedAt - thinkingStartedAt }
            : {}),
        }
      : undefined;
    // Agent revision routing (B5, locked 5+7): a run sent WITH the composer chip persists its
    // reply as a NEW REVISION on the targeted sheet (editSource 'agent', instruction = the user
    // message) instead of spawning a new sheet. Resolved + appended BEFORE the terminal event so
    // the client's settle refetch always sees the grown revision list (no visible race). The base
    // (pre-append latest) content is captured first - it is the revision-turn summary's diff
    // basis. An unknown sheet id falls back to fresh-sheet behavior: the chip is a default,
    // never a hard failure.
    let revisionInfo: { sheetId: string; revisionId: string; revision: number; baseContent: string } | undefined;
    if (input.reviseSheetId && cleanText.trim()) {
      const base = await findSessionSheet(input.sessionId, input.reviseSheetId);
      const baseContent = base?.revisions[base.revisions.length - 1]?.content;
      if (base && baseContent !== undefined) {
        const updated = await appendSheetRevision(
          input.sessionId,
          input.reviseSheetId,
          { content: cleanText, instruction: input.message, editSource: 'agent' },
          input.deps,
        );
        const appended = updated?.revisions[updated.revisions.length - 1];
        if (updated && appended) {
          revisionInfo = {
            sheetId: updated.sheetId,
            revisionId: appended.revisionId,
            revision: updated.revisions.length,
            baseContent,
          };
        }
      }
    }

    // The revision turn's message back-references its sheet (decision B.B): the sheets read
    // path skips it (never a second derived sheet) and a reloaded transcript can render the
    // revision card framing + focus the SAME sheet.
    const persisted = cleanText.trim()
      ? await persistAssistantMessage(input.sessionId, cleanText, input.deps, {
          // Mirror the client's local turn shape (ch05 §5.6.1 step 7): the web's transcript
          // filter renders an assistant row that HAS metadata only when isEssential is true.
          // B1's traceId stamping gave every persisted reply a metadata bag WITHOUT the flag,
          // so a reloaded transcript dropped every assistant turn (B7 live proof, step 5).
          isEssential: true,
          type: 'text',
          traceId: runId,
          memoriesUsed: assembled.memoriesUsed,
          ...(thinkingMeta ?? {}),
          ...(revisionInfo
            ? { sheetId: revisionInfo.sheetId, revisionId: revisionInfo.revisionId, revisionNumber: revisionInfo.revision }
            : {}),
        })
      : undefined;
    finishComplete(cleanText);

    // Post-run memory extraction scheduled OFF the terminal event (§5.8): the terminal already
    // fired above, so extraction never delays completion.
    void scheduleExtraction(input, runId, `${input.message}\n\n${cleanText}`);

    // Post-run reply summary (B2, decision B.E): same off-the-terminal, fire-and-forget posture.
    // FRESH turn: the persisted assistant turn IS the sheet (B1's read path derives it), so the
    // event carries exactly the ids the sheets endpoint serves - threaded from the persisted
    // doc, never re-derived from content. REVISION turn (B5): the event carries the REVISED
    // sheet's ids (multiple cards -> one sheet, locked 5) and the hook summarises the edit
    // instruction + diff basis, never the whole reply (decision B.E). Failure inside the hook
    // emits nothing and never touches the run.
    if (persisted) {
      void scheduleReplySummary({
        userId: input.actor.userId,
        sessionId: input.sessionId,
        runId,
        // B7 finding 1: the hook persists the summary onto THIS turn's metadata after the
        // emit, so a reloaded transcript keeps the upgraded card (both turn shapes).
        messageId: persisted._id,
        ...(revisionInfo
          ? {
              sheetId: revisionInfo.sheetId,
              revisionId: revisionInfo.revisionId,
              revision: revisionInfo.revision,
              turn: { kind: 'revision', instruction: input.message, baseContent: revisionInfo.baseContent, revisedContent: cleanText },
            }
          : {
              sheetId: derivedSheetId(persisted._id),
              revisionId: derivedRevisionId(persisted._id),
              turn: { kind: 'fresh', replyText: cleanText },
            }),
      });
    }
  } catch (err) {
    finishError('ADAPTER_ERROR', err instanceof Error ? err.message : 'Erro na execução.');
  }
}

/**
 * Join one turn's delegation results into the FC-402 `local_activity` payload (run s5, D3).
 * Returns undefined when the turn touched no local files. Files come from the derived-only
 * citations; bytes-out prefers the daemon ledger rows the buffer holds for the results'
 * ledgerRefs (the egress ledger is the bytes authority), falling back to result telemetry;
 * mask counts come from the hosted anon-audit joined on the same correlation ids (§17.6;
 * §18.6 S6). Join failures degrade to bytes-only — never a fabricated count (§12.6.2).
 */
export async function joinLocalActivity(
  sessionId: string,
  orgId: string,
  delegations: DelegationToolResult[],
): Promise<{ files: Array<{ path: string; range?: string }>; bytesOut?: number; maskedCounts?: Record<string, number>; correlationId?: string } | undefined> {
  const ok = delegations.filter((d) => d.status === 'ok');
  if (ok.length === 0) return undefined;

  const seen = new Set<string>();
  const files: Array<{ path: string; range?: string }> = [];
  for (const d of ok) {
    for (const c of d.citations) {
      const key = `${c.path}|${c.range}`;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({ path: c.path, ...(c.range ? { range: c.range } : {}) });
    }
  }

  const refs = [...new Set(ok.flatMap((d) => d.ledgerRefs))];
  const sources = getLocalActivitySources();
  const rows = sources.ledgerRows(sessionId, refs.length > 0 ? refs : undefined);
  const bytesFromLedger = rows.reduce((sum, r) => sum + r.bytesOut, 0);
  const bytesOut = bytesFromLedger > 0 ? bytesFromLedger : ok.reduce((s, d) => s + d.telemetry.egressBytes, 0);

  // Rows without citations still name files (a compose-only read cites nothing).
  if (files.length === 0) {
    for (const r of rows) {
      if (seen.has(`${r.path}|${r.byteRange}`)) continue;
      seen.add(`${r.path}|${r.byteRange}`);
      files.push({ path: r.path, range: r.byteRange });
    }
  }
  if (files.length === 0) return undefined;

  const joinIds = [...new Set([...refs, ...rows.map((r) => r.correlationId)])];
  let maskedCounts: Record<string, number> | undefined;
  try {
    const counts = await sources.maskedCounts(orgId, joinIds);
    if (Object.keys(counts).length > 0) maskedCounts = counts;
  } catch {
    // Bytes-only chip (§12.6.2 cut-line): a failed join never invents counts.
  }

  return {
    files,
    ...(bytesOut > 0 ? { bytesOut } : {}),
    ...(maskedCounts ? { maskedCounts } : {}),
    ...(joinIds.length > 0 ? { correlationId: joinIds[0] } : {}),
  };
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
