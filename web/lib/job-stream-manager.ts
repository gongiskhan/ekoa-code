'use client';

/**
 * Multi-job SSE stream manager (S4, session parallelism).
 *
 * Replaces the single active-session-bound `useJobStream` hook. A build's liveness - not
 * which session is on screen - owns its stream, so a backgrounded build keeps ingesting
 * events. Module-level like `useAutomationRun`'s `runEntries` (hooks/useAutomationRun.ts),
 * but keyed by liveness instead of mount ref-counting: a background session has no mounted
 * component to hold a ref, and the job's own liveness IS the ownership.
 *
 * Every handler writes to the OWNING session's store buckets (captured at trackJob time),
 * NEVER `store.activeSessionId` - the old `useJobStream` activeSessionId fallback
 * misattributed a background build's output onto whatever session was focused. That fallback
 * is gone here.
 *
 * The web transport already supports N concurrent EventSources (lib/api/stream.ts); this
 * module opens one per running/queued job via the existing `openJobStream` factory, routes
 * each typed `shared/events.ts` event to the session's buckets, and closes + forgets the
 * stream on the terminal event. On auth-ready `rehydrateJobs()` re-derives truth from the
 * server for every tracked session and reattaches live streams (the refresh path).
 */

import { api, tryCall, openJobStream, type EventStream } from '@/lib/api';
import type { JobEvent } from '@ekoa/shared';
import {
  useOrchestrationStore,
  type OutputEntry,
  type SessionJobState,
} from '@/stores/orchestration';
import { getLocale } from '@/lib/i18n';
import {
  getFriendlyPhaseMessage,
  getFriendlyToolActivity,
  getFriendlySummary,
  getRotatingFillerMessage,
} from '@/lib/friendly-messages';
import { sanitizeUserFacingError } from '@/lib/sanitize-error';

// ============================================
// CONSTANTS
// ============================================

/** Minimum interval (ms) between activity message updates to avoid flickering. */
const ACTIVITY_THROTTLE_MS = 2000;

/** Job event types the stream carries (mirrors the old useJobStream subscription set). */
const EVENT_TYPES = [
  'ready',
  'routing',
  'text_chunk',
  'thinking_chunk',
  'tool_event',
  'context_event',
  'plan_step',
  'artifact',
  'preview_reload',
  'complete',
  'error',
] as const;

// ============================================
// WHITE-LABEL HELPERS (ported verbatim from useJobStream)
// ============================================

/** Strip the server-side sandbox root (.../sandboxes/<user>/<artifact>/) - or any absolute home
 *  prefix - so the user only ever sees project-relative paths (white-label, ch12). */
function relativizeSandboxPath(p: string): string {
  const m = p.match(/\/sandboxes\/[^/]+\/[^/]+\/(.+)$/);
  if (m) return m[1] as string;
  return p.replace(/^\/(?:Users|home)\/[^/]+\//, '');
}

/** Friendly, white-labelled activity line for a tool start: the localized tool label plus the
 *  touched file relativized to the project. Never raw commands, never absolute paths. */
function describeToolForUser(
  toolName: string,
  args: Record<string, unknown> | undefined,
  locale: string,
): string | null {
  const label = getFriendlyToolActivity(toolName, args ?? {}, locale);
  if (!label) return null;
  const rawPath =
    args && typeof args.file_path === 'string'
      ? args.file_path
      : args && typeof args.path === 'string'
        ? args.path
        : null;
  return rawPath ? `${label}: ${relativizeSandboxPath(rawPath)}` : label;
}

function scheduleFrame(cb: () => void): number | null {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  cb();
  return null;
}

function cancelFrame(handle: number | null): void {
  if (handle !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
}

// ============================================
// PER-JOB ENTRY
// ============================================

interface JobEntry {
  readonly jobId: string;
  /** The session this job's events belong to - captured at trackJob time, never activeSessionId. */
  readonly sessionId: string;
  readonly stream: EventStream<JobEvent>;
  teardown: () => void;
  /** Count of `ready` events; >1 means a manual reconnect (lost ring-buffer position), so
   *  we re-sync via GET /jobs/:id (FC-026). Native replay reconnects keep Last-Event-ID. */
  readyCount: number;
  isComplete: boolean;
  outputId: number;
  lastActivityUpdate: number;
  fillerTimer: ReturnType<typeof setInterval> | null;
  fillerIndex: number;
  lastPhase: string | null;
  chatStreamBuffer: string;
  chatStreamRaf: number | null;
  /** Thinking window (per run): first thinking_chunk opens it, first answer chunk closes it. */
  thinkingStartedAt: number | null;
  thinkingEndedAt: number | null;
}

const jobEntries = new Map<string, JobEntry>();

// ============================================
// PER-ENTRY STORE WRITERS (owning session only)
// ============================================

function startFillerTimer(entry: JobEntry, phase: string | null): void {
  const { sessionId } = entry;
  if (entry.fillerTimer) clearInterval(entry.fillerTimer);
  entry.fillerIndex = 0;
  entry.fillerTimer = setInterval(() => {
    const locale = getLocale();
    const msg = getRotatingFillerMessage(phase, entry.fillerIndex, locale);
    entry.fillerIndex++;
    useOrchestrationStore.getState().setActivityMessage(sessionId, msg);
  }, 4000);
}

function stopFillerTimer(entry: JobEntry): void {
  if (entry.fillerTimer) {
    clearInterval(entry.fillerTimer);
    entry.fillerTimer = null;
  }
}

function flushChatStreamBuffer(entry: JobEntry): void {
  const buffered = entry.chatStreamBuffer;
  if (buffered) {
    entry.chatStreamBuffer = '';
    useOrchestrationStore.getState().appendStreamingChat(entry.sessionId, buffered);
  }
  entry.chatStreamRaf = null;
}

function extractFileOps(
  sessionId: string,
  data: { type: string; toolName?: string; toolInput?: Record<string, unknown> },
): void {
  if (data.type !== 'tool_use' || !data.toolName) return;
  const toolLower = data.toolName.toLowerCase();
  let action: 'created' | 'modified' | 'deleted' | null = null;
  if (toolLower.includes('write') || toolLower === 'write_file') action = 'created';
  else if (toolLower.includes('edit') || toolLower === 'edit_file') action = 'modified';
  else if (toolLower.includes('delete') || toolLower === 'delete_file') action = 'deleted';
  if (!action) return;

  let filePath: string | null = null;
  if (data.toolInput && typeof data.toolInput.file_path === 'string') filePath = data.toolInput.file_path;
  else if (data.toolInput && typeof data.toolInput.path === 'string') filePath = data.toolInput.path;
  if (filePath) {
    // Project-relative: file endpoints are path-confined server-side (P-15), and the user
    // must never see the host's absolute sandbox root (white-label, ch12).
    useOrchestrationStore.getState().addFileOperation(sessionId, relativizeSandboxPath(filePath), action);
  }
}

/** A queued job's stream opens and sits silent until dispatch; the first execution event is
 *  the queued->running transition. Flip the owning session's status on it (DESIGN B2). */
function ensureRunning(sessionId: string): void {
  const store = useOrchestrationStore.getState();
  const status = store.sessionJobs[sessionId]?.status;
  if (status === 'queued' || status === 'idle') {
    store.setSessionJob(sessionId, { status: 'running' });
  }
}

// ============================================
// EVENT HANDLER (pure: (entry, event) -> owning session's store)
// ============================================

function handleJobEvent(entry: JobEntry, event: JobEvent): void {
  const { sessionId } = entry;
  const store = useOrchestrationStore.getState();

  switch (event.type) {
    case 'ready': {
      // On a manual reconnect (2nd+ ready) the ring-buffer position is lost, so re-sync
      // job status via GET /jobs/:id (FC-026, mirrors useAutomationRun). Native replay
      // reconnects still keep Last-Event-ID.
      entry.readyCount += 1;
      if (entry.readyCount > 1 && !entry.isComplete) {
        void tryCall(() => api.jobs.get({ id: event.jobId })).then((res) => {
          if (!res.ok || entry.isComplete) return;
          const status = res.data.status;
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            useOrchestrationStore.getState().setSessionJob(sessionId, { status });
            finalize(entry);
          }
        });
      }
      break;
    }

    case 'routing': {
      // Internal routing decision - NEVER surfaced to the end user (white-label leak,
      // operator report 2026-07-11). It only marks the run as live.
      ensureRunning(sessionId);
      break;
    }

    case 'text_chunk': {
      ensureRunning(sessionId);
      const content = event.text;
      if (entry.thinkingStartedAt !== null && entry.thinkingEndedAt === null) {
        entry.thinkingEndedAt = Date.now();
      }
      store.appendToLastOutput(sessionId, content);
      // Buffer for the chat streaming bubble (batched via rAF).
      entry.chatStreamBuffer += content;
      if (entry.chatStreamRaf === null) {
        entry.chatStreamRaf = scheduleFrame(() => flushChatStreamBuffer(entry));
      }
      break;
    }

    case 'thinking_chunk': {
      // Working commentary (server-side marker-filtered + identity-redacted). Renders in the
      // live collapsible thinking UI - NEVER as transcript messages. Flushed into the final
      // message's metadata on complete.
      ensureRunning(sessionId);
      if (event.text) {
        entry.thinkingStartedAt ??= Date.now();
        store.appendStreamingThinking(sessionId, event.text);
      }
      break;
    }

    case 'tool_event': {
      // WHITE-LABEL (ch12): the end user NEVER sees raw tool traffic - no tool names as-is,
      // no commands, no absolute sandbox paths, no raw results/errors. The activity feed gets
      // a friendly one-liner per tool START (touched file relativized); results are dropped.
      ensureRunning(sessionId);
      if (event.phase === 'started') {
        const locale = getLocale();
        const friendly = describeToolForUser(event.tool, event.args, locale);
        if (friendly) {
          addOutput(entry, {
            id: `${sessionId}-tool-${entry.outputId++}`,
            timestamp: new Date().toISOString(),
            type: 'status',
            content: friendly,
            phase: entry.lastPhase || undefined,
          });
        }
        extractFileOps(sessionId, { type: 'tool_use', toolName: event.tool, toolInput: event.args });

        const now = Date.now();
        if (now - entry.lastActivityUpdate >= ACTIVITY_THROTTLE_MS) {
          const activity = getFriendlyToolActivity(event.tool, event.args || {}, locale);
          if (activity) {
            entry.lastActivityUpdate = now;
            store.setActivityMessage(sessionId, activity);
            startFillerTimer(entry, entry.lastPhase);
          }
        }
      }
      break;
    }

    case 'context_event': {
      // FC-201: agent-context activity (loaded/used), rendered as a generic activity line.
      ensureRunning(sessionId);
      const now = Date.now();
      if (now - entry.lastActivityUpdate >= ACTIVITY_THROTTLE_MS) {
        entry.lastActivityUpdate = now;
        store.setActivityMessage(sessionId, event.name);
        startFillerTimer(entry, entry.lastPhase);
      }
      break;
    }

    case 'plan_step': {
      ensureRunning(sessionId);
      const phase = event.status;
      const detail = event.detail;
      const stepDescription = event.description;
      // Mirror the phase into the store's sessionJob so phase-gated UI (the FC-505
      // verification banner) sees it.
      store.setSessionJob(sessionId, { phase });

      if (phase !== entry.lastPhase) {
        entry.lastPhase = phase;
        const locale = getLocale();
        const phaseLabel = getFriendlyPhaseMessage(phase, locale);
        if (phaseLabel) {
          store.addMessage(sessionId, {
            role: 'assistant',
            content: detail || phaseLabel,
            metadata: { isEssential: true, type: 'status', phase },
          });
        }
        addOutput(entry, {
          id: `${sessionId}-phase-${entry.outputId++}`,
          timestamp: new Date().toISOString(),
          type: 'status',
          content: stepDescription || detail || phaseLabel || phase,
          phase,
        });
        store.setActivityMessage(sessionId, null);
        startFillerTimer(entry, phase);
      } else if (stepDescription || detail) {
        // Same-status repeat carrying a description: live progress narration (verify-stage
        // per-action lines). Updates the spinner label + Output tab - never a chat message.
        const narration = (stepDescription || detail) as string;
        store.setActivityMessage(sessionId, narration);
        startFillerTimer(entry, phase); // restart so the filler rotation doesn't clobber it
        addOutput(entry, {
          id: `${sessionId}-phase-${entry.outputId++}`,
          timestamp: new Date().toISOString(),
          type: 'status',
          content: narration,
          phase,
        });
      }
      break;
    }

    case 'artifact': {
      // The build's artifact is scaffolded + served BEFORE the agent runs: show the live
      // preview and fetch the real file tree from second zero, instead of waiting for
      // `complete`. Watcher rebuilds then stream `preview_reload`.
      ensureRunning(sessionId);
      store.setSessionJob(sessionId, {
        artifactInstanceId: event.artifactId,
        ...(event.slug ? { slug: event.slug } : {}),
      });
      store.setSessionPreview(sessionId, {
        previewId: event.artifactId,
        appUrl: event.appUrl,
        status: 'running',
        reloadCount: 0,
      });
      void store.loadSessionFiles(sessionId, event.artifactId);
      break;
    }

    case 'preview_reload': {
      // Hot-reload: esbuild watcher rebuilt the app - refresh the preview. Payload-free;
      // reuse the session's known artifact.
      const current = store.sessionPreviews[sessionId];
      const artId = current?.previewId || store.sessionJobs[sessionId]?.artifactInstanceId;
      if (artId) {
        store.setSessionPreview(sessionId, {
          previewId: artId,
          appUrl: api.appUrl(artId),
          status: 'running',
          reloadCount: (current?.reloadCount || 0) + 1,
        });
      }
      break;
    }

    case 'complete': {
      handleComplete(entry, event);
      break;
    }

    case 'error': {
      handleError(entry, event);
      break;
    }
  }
}

/** Write an output entry to the owning session (the store dedups by id). */
function addOutput(entry: JobEntry, out: OutputEntry): void {
  useOrchestrationStore.getState().addSessionJobOutput(entry.sessionId, out);
}

function handleComplete(entry: JobEntry, event: Extract<JobEvent, { type: 'complete' }>): void {
  const { sessionId } = entry;
  const store = useOrchestrationStore.getState();

  // Clear the pending stream buffer without persisting it as a separate message - the full
  // response is captured in event.result and added below. Flush the thinking buffer FIRST so
  // the collapsed commentary survives on the final message metadata.
  cancelFrame(entry.chatStreamRaf);
  entry.chatStreamRaf = null;
  entry.chatStreamBuffer = '';
  const completedThinking = store.flushStreamingThinking(sessionId);
  store.clearStreamingChat(sessionId);
  if (entry.thinkingStartedAt !== null && entry.thinkingEndedAt === null) {
    entry.thinkingEndedAt = Date.now();
  }
  entry.isComplete = true;

  const result = typeof event.result === 'string' ? event.result : '';
  const artifactInstanceId = event.artifactId;
  const slug = event.slug;
  const appUrlFromEvent = event.appUrl;

  store.setSessionJob(sessionId, { status: 'completed' });
  store.setSessionJob(sessionId, {
    result: { success: true, summary: result },
    slug: slug || null,
  });

  // Refresh preview when the build completes - prefer the event's appUrl, else slug URL.
  if (artifactInstanceId) {
    const appIdentifier = slug || artifactInstanceId;
    const current = store.sessionPreviews[sessionId];
    store.setSessionPreview(sessionId, {
      previewId: appIdentifier,
      appUrl: appUrlFromEvent || api.appUrl(appIdentifier),
      status: 'running',
      reloadCount: (current?.reloadCount || 0) + 1,
    });
    // Final truth for the Files tab: the completed project tree.
    void store.loadSessionFiles(sessionId, artifactInstanceId);
  }

  const locale = getLocale();
  store.addMessage(sessionId, {
    role: 'assistant',
    content: getFriendlySummary({ success: true, summary: result }, locale),
    metadata: {
      isEssential: true,
      type: 'result',
      ...(completedThinking
        ? {
            thinking: completedThinking,
            ...(entry.thinkingStartedAt !== null && entry.thinkingEndedAt !== null
              ? { thinkingDurationMs: entry.thinkingEndedAt - entry.thinkingStartedAt }
              : {}),
          }
        : {}),
    },
  });
  store.setActivityMessage(sessionId, null);
  finalize(entry);
}

function handleError(entry: JobEntry, event: Extract<JobEvent, { type: 'error' }>): void {
  const { sessionId } = entry;
  const store = useOrchestrationStore.getState();

  cancelFrame(entry.chatStreamRaf);
  entry.chatStreamRaf = null;
  entry.chatStreamBuffer = '';
  store.clearStreamingChat(sessionId);
  entry.isComplete = true;

  // Strip any provider/engine leak before it reaches the user (backend already sanitizes the
  // wire; this guards replays / any bypass).
  const error = sanitizeUserFacingError(event.message, getLocale());
  store.setSessionJob(sessionId, { status: 'failed' });
  store.addMessage(sessionId, {
    role: 'assistant',
    content: error,
    metadata: { isEssential: true, type: 'error' },
  });
  store.setActivityMessage(sessionId, null);
  finalize(entry);
}

/** Close the stream, clear timers, and forget the job. Safe to call twice. */
function finalize(entry: JobEntry): void {
  stopFillerTimer(entry);
  cancelFrame(entry.chatStreamRaf);
  entry.chatStreamRaf = null;
  entry.teardown();
  jobEntries.delete(entry.jobId);
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Open (idempotently) a live stream for `jobId`, routing every event to `sessionId`'s store
 * buckets. Call on the 202 from POST /jobs - including a queued job, whose stream opens and
 * sits silent until dispatch, so the queued->running transition is never missed.
 */
export function trackJob(jobId: string, sessionId: string): void {
  if (!jobId || !sessionId) return;
  if (jobEntries.has(jobId)) return; // idempotent

  const stream = openJobStream(jobId);
  const unsubs = EVENT_TYPES.map((type) =>
    stream.on(type, (event) => {
      const current = jobEntries.get(jobId);
      if (current) handleJobEvent(current, event as JobEvent);
    }),
  );

  const entry: JobEntry = {
    jobId,
    sessionId,
    stream,
    teardown: () => {
      for (const u of unsubs) u();
      stream.close();
    },
    readyCount: 0,
    isComplete: false,
    outputId: 0,
    lastActivityUpdate: 0,
    fillerTimer: null,
    fillerIndex: 0,
    lastPhase: null,
    chatStreamBuffer: '',
    chatStreamRaf: null,
    thinkingStartedAt: null,
    thinkingEndedAt: null,
  };
  jobEntries.set(jobId, entry);
}

/** Explicit stop (cancel / reset). Closes the stream without writing a terminal status. */
export function untrackJob(jobId: string): void {
  const entry = jobEntries.get(jobId);
  if (!entry) return;
  entry.isComplete = true;
  stopFillerTimer(entry);
  cancelFrame(entry.chatStreamRaf);
  entry.chatStreamRaf = null;
  entry.teardown();
  jobEntries.delete(jobId);
}

/** Whether a job is currently tracked (exposed for tests + callers avoiding a double-track). */
export function isTracked(jobId: string): boolean {
  return jobEntries.has(jobId);
}

/**
 * Reconcile ONE session's build with the server and (re)attach its stream when still live.
 * The single recovery primitive (review #3/#4/#5/#6):
 * - a live entry with a live/connecting stream is left alone;
 * - a dead entry (stream force-closed, e.g. token cleared on logout) is dropped and rebuilt;
 * - server 'created' (persisted, not yet patched running) is LIVE - shown as 'queued' (the
 *   client union has no 'created') and tracked; the ring replays anything missed;
 * - only a definitive 404 marks the build failed; a transient error (network/5xx/auth) leaves
 *   the state untouched so a later visit retries instead of showing a phantom failure.
 */
export async function ensureTracked(jobId: string, sessionId: string): Promise<void> {
  if (!jobId || !sessionId) return;
  const entry = jobEntries.get(jobId);
  if (entry && entry.stream.status !== 'disconnected') return; // live or reconnecting
  if (entry) untrackJob(jobId); // dead entry: closed stream survives in the map (review #4)

  const res = await tryCall(() => api.jobs.get({ id: jobId }));
  const store = useOrchestrationStore.getState();
  if (!res.ok) {
    if (res.error.status === 404) store.setSessionJob(sessionId, { status: 'failed' });
    return;
  }
  const status = res.data.status;
  if (status === 'running' || status === 'queued' || status === 'created') {
    store.setSessionJob(sessionId, { status: status === 'running' ? 'running' : 'queued' });
    trackJob(jobId, sessionId);
  } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    store.setSessionJob(sessionId, { status: status as SessionJobState['status'] });
  }
}

/**
 * Re-derive live-build truth from the server for every tracked session and reattach streams.
 * Called once on auth-ready (api-provider). The persist layer sanitizes running/queued -> idle
 * on reload (orchestration partialize), so a mid-build refresh lands here as idle+jobId;
 * ensureTracked recovers the real status per session. Terminal statuses are preserved through
 * persist and skipped. This is the refresh-with-two-runs rehydration path.
 */
export async function rehydrateJobs(): Promise<void> {
  const sessionJobs = useOrchestrationStore.getState().sessionJobs;
  for (const [sessionId, job] of Object.entries(sessionJobs)) {
    const jobId = job?.jobId;
    if (!jobId) continue;
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') continue;
    await ensureTracked(jobId, sessionId);
  }
}

/** Test-only: drop all tracked jobs without touching the store. */
export function __resetJobStreamManager(): void {
  for (const entry of jobEntries.values()) {
    stopFillerTimer(entry);
    cancelFrame(entry.chatStreamRaf);
    entry.chatStreamRaf = null;
    entry.teardown();
  }
  jobEntries.clear();
}
