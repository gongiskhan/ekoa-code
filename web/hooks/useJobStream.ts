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

  // Tool duration tracking
  const toolStartTimesRef = useRef<Map<string, number>>(new Map());

  // Streaming chat buffer (rAF-batched)
  const chatStreamBufferRef = useRef('');
  const chatStreamRafRef = useRef<number | null>(null);

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
        useOrchestrationStore.getState().addFileOperation(sessionId, filePath, action);
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

  /** Flush streaming chat buffer → permanent chat message (if substantive) */
  const flushStreamingChatToMessage = useCallback(() => {
    if (!sessionId) return;
    // Cancel pending rAF and flush buffer synchronously
    if (chatStreamRafRef.current) {
      cancelAnimationFrame(chatStreamRafRef.current);
      chatStreamRafRef.current = null;
    }
    const buffered = chatStreamBufferRef.current;
    chatStreamBufferRef.current = '';
    // Flush any text already in the store + the local buffer
    const store = useOrchestrationStore.getState();
    const storeText = store.flushStreamingChat(sessionId);
    const fullText = (storeText + buffered).trim();
    if (fullText.length >= 20) {
      store.addMessage(sessionId, {
        role: 'assistant',
        content: fullText,
        metadata: { isEssential: true, type: 'agent_text' },
      });
    }
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
          setState(prev => ({ ...prev, status: 'routing', phase: event.tier || prev.phase }));

          // Add routing decision as a system output entry (FC-203).
          if (sessionId) {
            const outputId = `${sessionId}-routing-${outputIdRef.current++}`;
            addOutputToStore({
              id: outputId,
              timestamp: new Date().toISOString(),
              type: 'system',
              content: `Routing: ${event.tier}${event.reason ? ' - ' + event.reason : ''}`,
            });
          }
          break;
        }

        case 'text_chunk': {
          const content = event.text;
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

        case 'tool_event': {
          const toolName = event.tool;
          const args = event.args;

          // Flush streaming chat text as a permanent message before tool activity
          if (event.phase === 'started') {
            flushStreamingChatToMessage();
          }
          const outputId = sessionId ? `${sessionId}-tool-${outputIdRef.current++}` : `tool-${outputIdRef.current++}`;

          if (event.phase === 'started') {
            // Track tool start time for duration calculation
            if (toolName) {
              toolStartTimesRef.current.set(toolName + '-' + outputIdRef.current, Date.now());
            }

            const output: StreamedOutput = {
              id: outputId,
              type: 'tool_use',
              content: `Tool: ${toolName}`,
              toolName,
              toolInput: args,
              timestamp: new Date(),
            };
            setState(prev => ({ ...prev, outputs: [...prev.outputs, output] }));
            addOutputToStore({
              id: outputId,
              timestamp: new Date().toISOString(),
              type: 'tool_use',
              content: `Tool: ${toolName}`,
              toolName,
              toolInput: args,
              phase: lastPhaseRef.current || undefined,
            });
            extractFileOps({ type: 'tool_use', toolName, toolInput: args });

            // Activity message
            if (sessionId) {
              const now = Date.now();
              if (now - lastActivityUpdateRef.current >= ACTIVITY_THROTTLE_MS) {
                const locale = getLocale();
                const activity = getFriendlyToolActivity(toolName, args || {}, locale);
                if (activity) {
                  lastActivityUpdateRef.current = now;
                  useOrchestrationStore.getState().setActivityMessage(sessionId, activity);
                  startFillerTimer(lastPhaseRef.current);
                }
              }
            }
          } else if (event.phase === 'finished') {
            const result = event.result;
            const isError = event.isError === true;
            const resultContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

            addOutputToStore({
              id: outputId,
              timestamp: new Date().toISOString(),
              type: 'tool_result',
              content: resultContent,
              toolName,
              phase: lastPhaseRef.current || undefined,
              toolDuration: event.durationMs,
              isSuccess: !isError,
            });
          } else if (event.phase === 'failed') {
            const result = event.result;
            const errorContent = typeof result === 'string'
              ? result
              : result
                ? JSON.stringify(result)
                : 'Tool execution failed';
            addOutputToStore({
              id: outputId,
              timestamp: new Date().toISOString(),
              type: 'tool_result',
              content: errorContent,
              toolName,
              phase: lastPhaseRef.current || undefined,
              isSuccess: false,
            });
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
          flushStreamingChatToMessage();
          const phase = event.status as string;
          const detail = event.detail as string | undefined;
          const stepDescription = event.description as string | undefined;
          setState(prev => ({ ...prev, phase }));

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
          // result message — flushing would add the same text twice.
          if (chatStreamRafRef.current) {
            cancelAnimationFrame(chatStreamRafRef.current);
            chatStreamRafRef.current = null;
          }
          chatStreamBufferRef.current = '';
          if (sessionId) {
            useOrchestrationStore.getState().clearStreamingChat(sessionId);
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
            }

            const locale = getLocale();
            store.addMessage(sessionId, {
              role: 'assistant',
              content: getFriendlySummary({ success: true, summary: result }, locale),
              metadata: { isEssential: true, type: 'result' },
            });
            store.setActivityMessage(sessionId, null);
            stopFillerTimer();
          }
          break;
        }

        case 'error': {
          flushStreamingChatToMessage();
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
    [sessionId, addOutputToStore, extractFileOps, startFillerTimer, stopFillerTimer, flushChatStreamBuffer, flushStreamingChatToMessage]
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
        'tool_event',
        'context_event',
        'plan_step',
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
