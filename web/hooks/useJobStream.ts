'use client';

/**
 * SSE Streaming Hook for Job Output
 *
 * Subscribes to SSE stream events (routing, stream, tool_event, complete, error, etc.)
 * Filters by trace_id to isolate events for a specific job
 * Dispatches to orchestration store
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api, openJobStream, type EventStream } from '@/lib/api';
import type { JobEvent } from '@ekoa/shared';
import {
  useOrchestrationStore,
  type OutputEntry,
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
// TYPES
// ============================================

export interface StreamedOutput {
  id: string;
  type: 'text' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  timestamp: Date;
}

export interface UseJobStreamState {
  status: string | null;
  phase: string | null;
  outputs: StreamedOutput[];
  progress: {
    phase: string;
    percentage: number;
    message: string;
  } | null;
  result: {
    success: boolean;
    summary: string;
    artifacts?: Record<string, unknown>;
  } | null;
  error: { code: string; message: string } | null;
  isComplete: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  duration: number | null;
}

export interface UseJobStreamActions {
  connect: (overrideJobId?: string) => void;
  disconnect: () => void;
  clearOutputs: () => void;
}

export type UseJobStreamReturn = [UseJobStreamState, UseJobStreamActions];

// ============================================
// CONSTANTS
// ============================================

/** Minimum interval (ms) between activity message updates to avoid flickering */
const ACTIVITY_THROTTLE_MS = 2000;

/** Strip the server-side sandbox root (…/sandboxes/<user>/<artifact>/) — or any absolute home
 *  prefix — so the user only ever sees project-relative paths (white-label, ch12). */
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

// ============================================
// HOOK
// ============================================

export function useJobStream(
  jobId: string | null,
  sessionId?: string | null
): UseJobStreamReturn {
  const [state, setState] = useState<UseJobStreamState>({
    status: null,
    phase: null,
    outputs: [],
    progress: null,
    result: null,
    error: null,
    isComplete: false,
    isConnecting: false,
    isConnected: false,
    duration: null,
  });

  const outputIdRef = useRef(0);
  const isCompleteRef = useRef(false);
  const unsubRef = useRef<(() => void) | null>(null);
  const streamRef = useRef<EventStream<JobEvent> | null>(null);
  /** Count of `ready` events seen for the current job; >1 means a manual reconnect,
   *  which loses ring-buffer position, so we re-sync via GET /jobs/:id (FC-026). */
  const readyCountRef = useRef(0);

  // Filler timer refs
  const lastActivityUpdateRef = useRef(0);
  const fillerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fillerIndexRef = useRef(0);
  const lastPhaseRef = useRef<string | null>(null);

  // Streaming chat buffer (rAF-batched)
  const chatStreamBufferRef = useRef('');
  const chatStreamRafRef = useRef<number | null>(null);

  // Thinking window (per run): first thinking_chunk opens it, first answer chunk closes it —
  // the duration rides the final message's metadata (mirrors the chat page's handling).
  const thinkingStartedAtRef = useRef<number | null>(null);
  const thinkingEndedAtRef = useRef<number | null>(null);

  // -- Helpers --

  const addOutputToStore = useCallback(
    (entry: OutputEntry) => {
      // Fall back to the store's activeSessionId if the prop closed over a
      // stale value during a chat→build mode transition.
      const store = useOrchestrationStore.getState();
      const targetSessionId = sessionId || store.activeSessionId;
      if (!targetSessionId) {
        if (typeof console !== 'undefined') {
          console.warn('[useJobStream] addOutputToStore dropped — no targetSessionId', { propSessionId: sessionId, entryType: entry.type, entryId: entry.id });
        }
        return;
      }
      const before = store.sessionJobs[targetSessionId]?.output.length ?? 0;
      const collision = store.sessionJobs[targetSessionId]?.output.some((o) => o.id === entry.id) ?? false;
      store.addSessionJobOutput(targetSessionId, entry);
      const after = useOrchestrationStore.getState().sessionJobs[targetSessionId]?.output.length ?? 0;
      if (collision || after === before) {
        console.warn('[useJobStream] addOutputToStore: entry dropped by dedup', {
          sessionId: targetSessionId,
          entryId: entry.id,
          entryType: entry.type,
          beforeLen: before,
          afterLen: after,
          collision,
        });
      }
    },
    [sessionId]
  );

  const extractFileOps = useCallback(
    (data: { type: string; toolName?: string; toolInput?: Record<string, unknown>; content?: string }) => {
      if (!sessionId) return;
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
      else if (data.content) {
        const match = data.content.match(/(?:file_path|path)["']?\s*[:=]\s*["']([^"']+)["']/i);
        if (match) filePath = match[1];
      }

      if (filePath) {
        // Project-relative: the file endpoints are path-confined server-side (P-15), and the
        // user must never see the host's absolute sandbox root (white-label, ch12).
        useOrchestrationStore.getState().addFileOperation(sessionId, relativizeSandboxPath(filePath), action);
      }
    },
    [sessionId]
  );

  const startFillerTimer = useCallback(
    (phase: string | null) => {
      if (!sessionId) return;
      if (fillerTimerRef.current) clearInterval(fillerTimerRef.current);
      fillerIndexRef.current = 0;
      fillerTimerRef.current = setInterval(() => {
        const locale = getLocale();
        const msg = getRotatingFillerMessage(phase, fillerIndexRef.current, locale);
        fillerIndexRef.current++;
        useOrchestrationStore.getState().setActivityMessage(sessionId, msg);
      }, 4000);
    },
    [sessionId]
  );

  const stopFillerTimer = useCallback(() => {
    if (fillerTimerRef.current) {
      clearInterval(fillerTimerRef.current);
      fillerTimerRef.current = null;
    }
  }, []);

  /** Push buffered stream text to the store (called via rAF) */
  const flushChatStreamBuffer = useCallback(() => {
    if (!sessionId) return;
    const buffered = chatStreamBufferRef.current;
    if (buffered) {
      chatStreamBufferRef.current = '';
      useOrchestrationStore.getState().appendStreamingChat(sessionId, buffered);
    }
    chatStreamRafRef.current = null;
  }, [sessionId]);

  // -- SSE Event Handler --

  const handleJobEvent = useCallback(
    (event: JobEvent) => {
      // The stream is already scoped to a single job (openJobStream), so there is
      // no client-side trace filtering to do (FC-010).
      switch (event.type) {
        case 'ready': {
          // Connection (re)established. On a manual reconnect (2nd+ ready) the
          // ring-buffer position is lost, so re-sync job status via GET /jobs/:id
          // (FC-026). Native replay reconnects still keep Last-Event-ID.
          readyCountRef.current += 1;
          setState(prev => ({ ...prev, isConnecting: false, isConnected: true }));
          if (readyCountRef.current > 1 && !isCompleteRef.current) {
            void api.jobs
              .get({ id: event.jobId })
              .then((job) => {
                if (!sessionId) return;
                if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
                  useOrchestrationStore.getState().setSessionJob(sessionId, {
                    status: job.status as 'completed' | 'failed' | 'cancelled',
                  });
                }
              })
              .catch(() => {});
          }
          break;
        }

        case 'routing': {
          // Internal routing decision: drives hook state only. It is NEVER surfaced to the end
          // user — "Routing: EXPERT - first build" in the activity feed was a white-label leak
          // (operator report 2026-07-11).
          setState(prev => ({ ...prev, status: 'routing', phase: event.tier || prev.phase }));
          break;
        }

        case 'text_chunk': {
          const content = event.text;
          if (thinkingStartedAtRef.current !== null && thinkingEndedAtRef.current === null) {
            thinkingEndedAtRef.current = Date.now();
          }
          // Accumulate text into the last output entry instead of creating one per token
          setState(prev => {
            const outputs = [...prev.outputs];
            const last = outputs[outputs.length - 1];
            if (last && last.type === 'text') {
              outputs[outputs.length - 1] = { ...last, content: last.content + content };
            } else {
              const outputId = sessionId ? `${sessionId}-out-${outputIdRef.current++}` : `out-${outputIdRef.current++}`;
              outputs.push({ id: outputId, type: 'text', content, timestamp: new Date() });
            }
            return { ...prev, outputs };
          });
          if (sessionId) {
            useOrchestrationStore.getState().appendToLastOutput(sessionId, content);
            // Buffer for chat streaming bubble (batched via rAF)
            chatStreamBufferRef.current += content;
            if (!chatStreamRafRef.current) {
              chatStreamRafRef.current = requestAnimationFrame(flushChatStreamBuffer);
            }
          }
          break;
        }

        case 'thinking_chunk': {
          // Working commentary (server-side marker-filtered + identity-redacted). Renders in the
          // live collapsible thinking UI — NEVER as transcript messages (the old behavior flushed
          // commentary fragments into "Agente EKOA" bubbles split mid-word; operator report
          // 2026-07-11). Flushed into the final message's metadata on complete.
          if (sessionId && event.text) {
            thinkingStartedAtRef.current ??= Date.now();
            useOrchestrationStore.getState().appendStreamingThinking(sessionId, event.text);
          }
          break;
        }

        case 'tool_event': {
          // WHITE-LABEL (ch12, operator report 2026-07-11): the end user NEVER sees raw tool
          // traffic — no tool names as-is, no commands, no absolute sandbox paths, no raw
          // results/errors (the agent self-corrects; its internal misses are not user news).
          // The activity feed gets a friendly one-liner per tool start (with the touched file
          // relativized to the project); results are dropped entirely.
          const toolName = event.tool;
          const args = event.args;

          if (event.phase === 'started') {
            const locale = getLocale();
            const friendly = describeToolForUser(toolName, args, locale);
            if (friendly) {
              const outputId = sessionId ? `${sessionId}-tool-${outputIdRef.current++}` : `tool-${outputIdRef.current++}`;
              addOutputToStore({
                id: outputId,
                timestamp: new Date().toISOString(),
                type: 'status',
                content: friendly,
                phase: lastPhaseRef.current || undefined,
              });
            }
            extractFileOps({ type: 'tool_use', toolName, toolInput: args });

            // Activity message
            if (sessionId) {
              const now = Date.now();
              if (now - lastActivityUpdateRef.current >= ACTIVITY_THROTTLE_MS) {
                const activity = getFriendlyToolActivity(toolName, args || {}, locale);
                if (activity) {
                  lastActivityUpdateRef.current = now;
                  useOrchestrationStore.getState().setActivityMessage(sessionId, activity);
                  startFillerTimer(lastPhaseRef.current);
                }
              }
            }
          }
          break;
        }

        case 'context_event': {
          // FC-201: agent-context activity (loaded/used), rendered as a generic
          // activity line. The subagent/skill event branches are dropped from the
          // v1 contract (FC-027/007).
          if (sessionId) {
            const now = Date.now();
            if (now - lastActivityUpdateRef.current >= ACTIVITY_THROTTLE_MS) {
              lastActivityUpdateRef.current = now;
              useOrchestrationStore.getState().setActivityMessage(sessionId, event.name);
              startFillerTimer(lastPhaseRef.current);
            }
          }
          break;
        }

        case 'plan_step': {
          const phase = event.status as string;
          const detail = event.detail as string | undefined;
          const stepDescription = event.description as string | undefined;
          setState(prev => ({ ...prev, phase }));
          // Mirror the phase into the store's sessionJob so phase-gated UI (the FC-505
          // verification banner) actually sees it — hook state alone never reached the store.
          if (sessionId) useOrchestrationStore.getState().setSessionJob(sessionId, { phase });

          if (sessionId && phase !== lastPhaseRef.current) {
            lastPhaseRef.current = phase;
            const locale = getLocale();
            const phaseLabel = getFriendlyPhaseMessage(phase, locale);
            if (phaseLabel) {
              useOrchestrationStore.getState().addMessage(sessionId, {
                role: 'assistant',
                content: detail || phaseLabel,
                metadata: { isEssential: true, type: 'status', phase },
              });
            }

            // Also add a status entry to the output panel
            const outputId = sessionId ? `${sessionId}-phase-${outputIdRef.current++}` : `phase-${outputIdRef.current++}`;
            addOutputToStore({
              id: outputId,
              timestamp: new Date().toISOString(),
              type: 'status',
              content: stepDescription || detail || phaseLabel || phase,
              phase,
            });

            useOrchestrationStore.getState().setActivityMessage(sessionId, null);
            startFillerTimer(phase);
          } else if (sessionId && (stepDescription || detail)) {
            // Same-status repeat carrying a description: live progress narration (the verify
            // stage's per-action lines, "A clicar em ..."). Updates the spinner label and logs
            // to the Output tab — NEVER a chat message and never persisted (only status
            // CHANGES become transcript entries above).
            const narration = (stepDescription || detail) as string;
            useOrchestrationStore.getState().setActivityMessage(sessionId, narration);
            startFillerTimer(phase); // restart so the 4s filler rotation doesn't clobber it
            const outputId = `${sessionId}-phase-${outputIdRef.current++}`;
            addOutputToStore({
              id: outputId,
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
          // preview and fetch the real file tree from second zero (the scaffold/template files),
          // instead of waiting minutes for `complete`. Watcher rebuilds then stream
          // `preview_reload` so the iframe follows the agent's writes.
          if (sessionId) {
            const store = useOrchestrationStore.getState();
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
          }
          break;
        }

        case 'preview_reload': {
          // Hot-reload: esbuild watcher rebuilt the app — refresh the preview. The
          // event is payload-free (§3.6.2); reuse the session's known artifact.
          if (sessionId) {
            const store = useOrchestrationStore.getState();
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
          }
          break;
        }

        case 'complete': {
          // Clear the pending stream buffer without persisting it as a separate message.
          // The full agent response is captured in event.result and added below as the
          // result message — flushing would add the same text twice. The thinking buffer is
          // flushed FIRST so the collapsed commentary survives on the final message metadata.
          if (chatStreamRafRef.current) {
            cancelAnimationFrame(chatStreamRafRef.current);
            chatStreamRafRef.current = null;
          }
          chatStreamBufferRef.current = '';
          let completedThinking = '';
          if (sessionId) {
            const store = useOrchestrationStore.getState();
            completedThinking = store.flushStreamingThinking(sessionId);
            store.clearStreamingChat(sessionId);
          }
          if (thinkingStartedAtRef.current !== null && thinkingEndedAtRef.current === null) {
            thinkingEndedAtRef.current = Date.now();
          }
          isCompleteRef.current = true;
          const duration = event.durationMs;
          const result = typeof event.result === 'string' ? event.result : '';
          const artifactInstanceId = event.artifactId;
          const slug = event.slug;
          const appUrlFromEvent = event.appUrl;

          setState(prev => ({
            ...prev,
            isComplete: true,
            isConnected: false,
            duration,
            result: { success: true, summary: result },
          }));

          if (sessionId) {
            const store = useOrchestrationStore.getState();
            store.setSessionJob(sessionId, { status: 'completed' });
            store.setSessionJob(sessionId, {
              result: { success: true, summary: result },
              slug: slug || null,
            });

            // Refresh preview when build completes -- prefer the event's appUrl, else slug URL
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
                      ...(thinkingStartedAtRef.current !== null && thinkingEndedAtRef.current !== null
                        ? { thinkingDurationMs: thinkingEndedAtRef.current - thinkingStartedAtRef.current }
                        : {}),
                    }
                  : {}),
              },
            });
            store.setActivityMessage(sessionId, null);
            stopFillerTimer();
          }
          break;
        }

        case 'error': {
          // Clear the live buffers — the sanitized error message below is what the user sees.
          if (chatStreamRafRef.current) {
            cancelAnimationFrame(chatStreamRafRef.current);
            chatStreamRafRef.current = null;
          }
          chatStreamBufferRef.current = '';
          if (sessionId) {
            useOrchestrationStore.getState().clearStreamingChat(sessionId);
          }
          isCompleteRef.current = true;
          // Strip any provider/engine leak before it reaches the user (backend
          // already sanitizes the wire; this guards replays / any bypass).
          const error = sanitizeUserFacingError(event.message, getLocale());
          setState(prev => ({
            ...prev,
            isComplete: true,
            isConnected: false,
            error: { code: event.code || 'STREAM_ERROR', message: error },
          }));

          if (sessionId) {
            const store = useOrchestrationStore.getState();
            store.setSessionJob(sessionId, { status: 'failed' });
            store.addMessage(sessionId, {
              role: 'assistant',
              content: error,
              metadata: { isEssential: true, type: 'error' },
            });
            store.setActivityMessage(sessionId, null);
            stopFillerTimer();
          }
          break;
        }
      }
    },
    [sessionId, addOutputToStore, extractFileOps, startFillerTimer, stopFillerTimer, flushChatStreamBuffer]
  );

  // -- Connection Management --

  const disconnect = useCallback(() => {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
    readyCountRef.current = 0;
    setState(prev => ({
      ...prev,
      isConnecting: false,
      isConnected: false,
    }));
  }, []);

  const connect = useCallback(
    (overrideJobId?: string) => {
      const targetJobId = overrideJobId || jobId;
      if (!targetJobId) return;

      // Clean up existing subscription
      disconnect();
      isCompleteRef.current = false;

      setState(prev => ({
        ...prev,
        isConnecting: true,
        isComplete: false,
        error: null,
      }));

      // Open the scoped job stream (FC-026). It is already isolated to this job,
      // so there is no client-side trace filtering.
      const stream = openJobStream(targetJobId);
      streamRef.current = stream;

      const eventTypes = [
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
      const unsubs = eventTypes.map((type) => stream.on(type, handleJobEvent));
      unsubs.push(
        stream.onStatusChange((status) => {
          setState(prev => ({
            ...prev,
            isConnecting: status === 'connecting',
            isConnected: status === 'connected',
          }));
        }),
      );

      unsubRef.current = () => {
        for (const u of unsubs) u();
      };

      setState(prev => ({
        ...prev,
        isConnecting: stream.status === 'connecting',
        isConnected: stream.status === 'connected',
      }));
    },
    [jobId, disconnect, handleJobEvent]
  );

  const clearOutputs = useCallback(() => {
    outputIdRef.current = 0;
    isCompleteRef.current = false;
    setState(prev => ({
      ...prev,
      outputs: [],
      progress: null,
      result: null,
      error: null,
      isComplete: false,
    }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current();
      stopFillerTimer();
      if (chatStreamRafRef.current) cancelAnimationFrame(chatStreamRafRef.current);
    };
  }, [stopFillerTimer]);

  // Reset on jobId change
  useEffect(() => {
    if (jobId) {
      setState({
        status: null,
        phase: null,
        outputs: [],
        progress: null,
        result: null,
        error: null,
        isComplete: false,
        isConnecting: false,
        isConnected: false,
        duration: null,
      });
      outputIdRef.current = 0;
      isCompleteRef.current = false;
      lastPhaseRef.current = null;
    }
  }, [jobId]);

  // Reset on sessionId change
  useEffect(() => {
    disconnect();
    stopFillerTimer();
    setState({
      status: null,
      phase: null,
      outputs: [],
      progress: null,
      result: null,
      error: null,
      isComplete: false,
      isConnecting: false,
      isConnected: false,
      duration: null,
    });
    outputIdRef.current = 0;
    isCompleteRef.current = false;
    lastPhaseRef.current = null;
    chatStreamBufferRef.current = '';
    if (chatStreamRafRef.current) {
      cancelAnimationFrame(chatStreamRafRef.current);
      chatStreamRafRef.current = null;
    }
  }, [sessionId, disconnect, stopFillerTimer]);

  return [
    state,
    { connect, disconnect, clearOutputs },
  ];
}

export default useJobStream;
