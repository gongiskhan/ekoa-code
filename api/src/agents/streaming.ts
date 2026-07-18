/**
 * The streaming pipeline (ch05 §5.7.1): the one internal sink `agents/` writes to, which maps
 * run activity to the typed `shared/events.ts` union members and hands them to `events/` for
 * SSE delivery. Every payload emitted here is a valid member of its per-stream union (the ch13
 * streaming-contract gate). `subagent_event`, `phase_changed`, and `usage_progress` are NEVER
 * emitted (§5.7.3, P-11): plan/subtask notifications are consumed internally (they reset the
 * inactivity timer) and usage deltas feed billing capture only.
 *
 * Terminal events (`complete`/`error`) go through the dual-fire guard at the call site
 * (registry.finalizeOnce, §5.3.4), never here.
 */
import { sseManager } from '../events/sse-manager.js';
import { loadAgentsConfig } from '../config.js';
import type { ChatRunEvent, JobEvent, NotificationEvent } from '@ekoa/shared';

/** Truncate a tool arg/result value's string form to the configured cap (§5.7.1). */
function truncate(value: unknown): unknown {
  if (value === undefined) return undefined;
  const cap = loadAgentsConfig().toolResultTruncateChars;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (s === undefined) return value;
  return s.length > cap ? s.slice(0, cap) : s;
}

/** A tool_event payload (shared by chat + job streams). */
export interface ToolEventInput {
  phase: 'started' | 'finished' | 'failed';
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
}

function toolEventPayload(e: ToolEventInput): Record<string, unknown> {
  return {
    type: 'tool_event',
    phase: e.phase,
    tool: e.tool,
    ...(e.args !== undefined ? { args: e.args } : {}),
    ...(e.result !== undefined ? { result: truncate(e.result) } : {}),
    ...(e.isError !== undefined ? { isError: e.isError } : {}),
    ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
  };
}

/** Chat-run stream sink (§3.6.1 `ChatRunEvent`). */
export class ChatStreamSink {
  constructor(private runId: string) {}
  private emit(ev: ChatRunEvent): void {
    sseManager.emit('chat', this.runId, ev.type, ev);
  }
  text(text: string): void {
    if (text) this.emit({ type: 'text_chunk', text });
  }
  /** Working-commentary channel (§3.6.1 `thinking_chunk`). Callers pass text already
   *  marker-filtered AND engine-identity-redacted (branding.ts) — never raw model output. */
  thinking(text: string): void {
    if (text) this.emit({ type: 'thinking_chunk', text });
  }
  toolEvent(e: ToolEventInput): void {
    this.emit(toolEventPayload(e) as ChatRunEvent);
  }
  contextEvent(name: string, action: 'loaded' | 'used'): void {
    this.emit({ type: 'context_event', name, action });
  }
  /** FC-402 per-turn local-file activity (run s5): transient display metadata for the trust
   *  chip — files+bytes from the daemon ledger buffer, mask counts from the anon-audit join. */
  localActivity(a: {
    files: Array<{ path: string; range?: string }>;
    bytesOut?: number;
    maskedCounts?: Record<string, number>;
    correlationId?: string;
  }): void {
    if (a.files.length === 0) return;
    this.emit({ type: 'local_activity', ...a });
  }
  complete(result: unknown, durationMs: number, delegate?: { kind: 'build' | 'integration'; request: Record<string, unknown> }): void {
    this.emit({ type: 'complete', result, durationMs, ...(delegate ? { delegate } : {}) });
  }
  error(code: string, message: string): void {
    this.emit({ type: 'error', code, message });
  }
}

/** Job stream sink (§3.6.2 `JobEvent`). */
export class JobStreamSink {
  constructor(private jobId: string) {}
  private emit(ev: JobEvent): void {
    sseManager.emit('job', this.jobId, ev.type, ev);
  }
  routing(tier: string, reason: string): void {
    this.emit({ type: 'routing', tier, reason });
  }
  text(text: string): void {
    if (text) this.emit({ type: 'text_chunk', text });
  }
  /** Working-commentary channel (mirrors ChatStreamSink.thinking). Callers pass text already
   *  marker-filtered AND engine-identity-redacted (branding.ts) — never raw model output. */
  thinking(text: string): void {
    if (text) this.emit({ type: 'thinking_chunk', text });
  }
  toolEvent(e: ToolEventInput): void {
    this.emit(toolEventPayload(e) as JobEvent);
  }
  contextEvent(name: string, action: 'loaded' | 'used'): void {
    this.emit({ type: 'context_event', name, action });
  }
  planStep(status: string, description?: string, detail?: string): void {
    this.emit({ type: 'plan_step', status, ...(description ? { description } : {}), ...(detail ? { detail } : {}) });
  }
  previewReload(): void {
    this.emit({ type: 'preview_reload' });
  }
  /** The build's artifact is scaffolded + served — fired BEFORE the agent runs so the client
   *  shows the live preview and the real file tree from second zero. */
  artifact(payload: { artifactId: string; appUrl: string; slug?: string }): void {
    this.emit({ type: 'artifact', ...payload });
  }
  complete(payload: { result?: unknown; artifactId?: string; slug?: string; appUrl?: string }, durationMs: number): void {
    this.emit({ type: 'complete', durationMs, ...payload });
  }
  error(code: string, message: string): void {
    this.emit({ type: 'error', code, message });
  }
}

// --- Notifications channel (§3.6.4 `NotificationEvent`) -----------------------------------

/** Fire a `build_intent` on the target user's notifications channel (§5.7.2). */
export function emitBuildIntent(userId: string, ev: { sessionId: string; sourceRunId: string; request: { description: string; artifactId?: string } }): void {
  const payload: NotificationEvent = { type: 'build_intent', ...ev };
  sseManager.emit('notifications', userId, 'build_intent', payload);
}

/** Fire an `integration_build_intent` on the target user's notifications channel (§5.7.2). */
export function emitIntegrationBuildIntent(userId: string, ev: { sessionId: string; hint?: string }): void {
  const payload: NotificationEvent = { type: 'integration_build_intent', ...ev };
  sseManager.emit('notifications', userId, 'integration_build_intent', payload);
}

/** Deliver a `chat_answer` on the notifications channel (§5.6.2 in-build answer flow). */
export function emitChatAnswer(userId: string, ev: { sessionId: string; sourceRunId: string; text: string }): void {
  const payload: NotificationEvent = { type: 'chat_answer', ...ev };
  sseManager.emit('notifications', userId, 'chat_answer', payload);
}

/** Deliver a `reply_summary` on the notifications channel (Part B decision B.E): the FAST-tier
 *  post-run {title, summary} for the sheet a completed chat turn produced. Per-user channel,
 *  the chat_answer pattern - the run stream is already torn down when this fires. Emitted only
 *  on success; a failed summarisation emits nothing (the client keeps its placeholder). */
export function emitReplySummary(
  userId: string,
  ev: { sessionId: string; sheetId: string; revisionId: string; title: string; summary: string; revision?: number },
): void {
  const payload: NotificationEvent = { type: 'reply_summary', ...ev };
  sseManager.emit('notifications', userId, 'reply_summary', payload);
}

/** A user filed a change request into an org-admin's queue (operator-run H4): push a live
 *  refetch signal onto that admin's per-user notifications channel. Fired once per org-admin of
 *  the target org — the queue is org-scoped, so only that org's admins are notified. */
export function emitChangeRequest(userId: string, ev: { appId?: string }): void {
  const payload: NotificationEvent = { type: 'change_request', ...(ev.appId ? { appId: ev.appId } : {}) };
  sseManager.emit('notifications', userId, 'change_request', payload);
}

/** Org branding changed (brand research applied): tell the user's clients to refetch the
 *  company config so the header logo + theme update live (no page reload). Per-user channel -
 *  other org members pick the change up on their next company fetch. */
export function emitBrandingUpdated(userId: string): void {
  const payload: NotificationEvent = { type: 'branding_updated' };
  sseManager.emit('notifications', userId, 'branding_updated', payload);
}
