'use client';

/**
 * SSE Streaming Hook for Job Output
 *
 * Subscribes to SSE stream events (routing, stream, tool_event, complete, error, etc.)
 * Filters by trace_id to isolate events for a specific job
 * Dispatches to orchestration store
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getConnection } from '@/lib/cortex/connection';
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
  getFriendlySubagentMessage,
  getFriendlySkillMessage,
} from '@/lib/friendly-messages';
import { getAppUrl } from '@/lib/api/client';
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
  const activeTraceIdRef = useRef<string | null>(null);

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

  const handleStreamEvent = useCallback(
    (event: { type: string; [key: string]: unknown }) => {
      // Filter by trace_id when we're waiting for a specific job.
      // Reject events that don't match OR have no trace_id at all — stale/system
      // events without a trace_id must not bleed into the current session.
      if (activeTraceIdRef.current && event.trace_id !== activeTraceIdRef.current) {
        return;
      }

      switch (event.type) {
        case 'routing': {
          const decision = event.decision as { path: string; confidence: number; reason: string };
          setState(prev => ({ ...prev, status: 'routing', phase: decision?.path || prev.phase }));

          // Add routing decision as a system output entry
          if (sessionId && decision) {
            const outputId = `${sessionId}-routing-${outputIdRef.current++}`;
            addOutputToStore({
              id: outputId,
              timestamp: new Date().toISOString(),
              type: 'system',
              content: `Routing: ${decision.path} (${Math.round((decision.confidence || 0) * 100)}% confidence)${decision.reason ? ' - ' + decision.reason : ''}`,
            });
          }
          break;
        }

        case 'stream': {
          const content = event.content as string;
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
          const toolEvent = event.event as string;
          const toolName = event.tool as string;
          const args = event.args as Record<string, unknown> | undefined;

          // Flush streaming chat text as a permanent message before tool activity
          if (toolEvent === 'tool_called' || toolEvent === 'tool_started') {
            flushStreamingChatToMessage();
          }
          const outputId = sessionId ? `${sessionId}-tool-${outputIdRef.current++}` : `tool-${outputIdRef.current++}`;

          if (toolEvent === 'tool_called' || toolEvent === 'tool_started') {
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
          } else if (toolEvent === 'tool_finished') {
            const result = event.result as unknown;
            const isError = event.is_error === true || event.isError === true;
            const resultContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

            // Calculate duration from tracked start time
            let duration: number | undefined;
            const durationMs = event.duration_ms as number | undefined;
            if (durationMs) {
              duration = durationMs;
            }

            addOutputToStore({
              id: outputId,
              timestamp: new Date().toISOString(),
              type: 'tool_result',
              content: resultContent,
              toolName,
              phase: lastPhaseRef.current || undefined,
              toolDuration: duration,
              isSuccess: !isError,
            });
          } else if (toolEvent === 'tool_failed') {
            const error = (event.error as string) || (event.result as string) || 'Tool execution failed';
            addOutputToStore({
              id: outputId,
              timestamp: new Date().toISOString(),
              type: 'tool_result',
              content: typeof error === 'string' ? error : JSON.stringify(error),
              toolName,
              phase: lastPhaseRef.current || undefined,
              isSuccess: false,
            });
          }
          break;
        }

        case 'subagent_event': {
          flushStreamingChatToMessage();
          const agent = (event.agent || event.name || event.task_id || 'agent') as string;
          const subEvent = (event.event || event.status) as string;
          const description = event.description as string | undefined;
          const summary = (event.summary || event.result) as string | undefined;
          const outputId = sessionId ? `${sessionId}-subagent-${outputIdRef.current++}` : `subagent-${outputIdRef.current++}`;

          const friendlyMsg = getFriendlySubagentMessage(agent, subEvent, description || summary);

          addOutputToStore({
            id: outputId,
            timestamp: new Date().toISOString(),
            type: 'subagent',
            content: friendlyMsg,
            agentName: agent,
            agentEvent: subEvent,
            summary: summary,
            phase: lastPhaseRef.current || undefined,
          });

          // Add essential chat messages for started/completed so they surface in build mode chat panel
          if (sessionId) {
            const isStarted = subEvent === 'started' || subEvent === 'agent_started';
            const isCompleted = subEvent === 'completed' || subEvent === 'agent_completed';
            const isFailed = subEvent === 'failed';

            if (isStarted || isCompleted || isFailed) {
              useOrchestrationStore.getState().addMessage(sessionId, {
                role: 'assistant',
                content: friendlyMsg,
                metadata: { isEssential: true, type: 'subagent' },
              });
            }

            // Update activity message
            const now = Date.now();
            if (now - lastActivityUpdateRef.current >= ACTIVITY_THROTTLE_MS) {
              lastActivityUpdateRef.current = now;
              useOrchestrationStore.getState().setActivityMessage(sessionId, friendlyMsg);
              startFillerTimer(lastPhaseRef.current);
            }
          }
          break;
        }

        case 'skill_event': {
          const skill = (event.skill || event.name || 'skill') as string;
          const action = (event.action || event.event) as string;

          // Only show invoked events, not internal loading
          if (action !== 'invoked' && action !== 'used') break;

          const outputId = sessionId ? `${sessionId}-skill-${outputIdRef.current++}` : `skill-${outputIdRef.current++}`;
          const friendlyMsg = getFriendlySkillMessage(skill);

          addOutputToStore({
            id: outputId,
            timestamp: new Date().toISOString(),
            type: 'skill',
            content: friendlyMsg,
            skillName: skill,
            phase: lastPhaseRef.current || undefined,
          });

          // Update activity message
          if (sessionId) {
            const now = Date.now();
            if (now - lastActivityUpdateRef.current >= ACTIVITY_THROTTLE_MS) {
              lastActivityUpdateRef.current = now;
              useOrchestrationStore.getState().setActivityMessage(sessionId, friendlyMsg);
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
          // Hot-reload: esbuild watcher rebuilt the app — refresh the preview
          if (sessionId) {
            const store = useOrchestrationStore.getState();
            const artId = event.artifactInstanceId as string;
            if (artId) {
              const current = store.sessionPreviews[sessionId];
              store.setSessionPreview(sessionId, {
                previewId: artId,
                appUrl: getAppUrl(artId),
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
          const duration = event.duration_ms as number;
          const result = event.result as string;
          const artifactInstanceId = event.artifactInstanceId as string | undefined;
          const slug = event.slug as string | undefined;

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

            // Refresh preview when build completes -- prefer slug URL
            if (artifactInstanceId) {
              const appIdentifier = slug || artifactInstanceId;
              const current = store.sessionPreviews[sessionId];
              store.setSessionPreview(sessionId, {
                previewId: appIdentifier,
                appUrl: getAppUrl(appIdentifier),
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
          const error = sanitizeUserFacingError(event.error as string, getLocale());
          setState(prev => ({
            ...prev,
            isComplete: true,
            isConnected: false,
            error: { code: 'STREAM_ERROR', message: error },
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
    activeTraceIdRef.current = null;
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

      // Use the jobId as the trace_id filter
      activeTraceIdRef.current = targetJobId;

      // Subscribe to stream events from the SSE connection
      const conn = getConnection();
      const unsub = conn.onStream(handleStreamEvent);
      unsubRef.current = unsub;

      // Also listen for specific event types
      const unsubConnected = conn.on('connected', () => {
        setState(prev => ({
          ...prev,
          isConnecting: false,
          isConnected: true,
        }));
      });

      // Compose cleanup
      const originalUnsub = unsubRef.current;
      unsubRef.current = () => {
        originalUnsub();
        unsubConnected();
      };

      setState(prev => ({
        ...prev,
        isConnecting: false,
        isConnected: conn.isConnected(),
      }));
    },
    [jobId, disconnect, handleStreamEvent]
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
