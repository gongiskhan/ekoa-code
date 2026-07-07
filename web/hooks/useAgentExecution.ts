'use client';

/**
 * Agent Execution Hook
 *
 * Manages the full lifecycle: execute -> stream -> complete
 * Uses WS actions for execution and WS stream events for output.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  executeAgent,
  cancelJob,
  getJob,
  getAppUrl,
  type ExecuteRequest,
  type JobInfo,
} from '@/lib/api/client';
import { useOrchestrationStore } from '@/stores/orchestration';
import { useI18nStore } from '@/stores/i18n';
import { useJobStream } from './useJobStream';
import { sanitizeUserFacingError } from '@/lib/sanitize-error';

/** Resolve the user's language preference, preferring an explicit per-call value.
 *  Falls back to the i18n store (the header/agent language), NOT the settings
 *  store — settings.general.language defaults to 'en' and is not kept in sync. */
function resolveLanguage(explicit?: string): 'en' | 'pt' {
  if (explicit === 'pt' || explicit === 'en') return explicit;
  return useI18nStore.getState().language === 'pt' ? 'pt' : 'en';
}

// ============================================
// TYPES
// ============================================

export interface ExecutionState {
  isExecuting: boolean;
  jobId: string | null;
  jobInfo: JobInfo | null;
  error: { code: string; message: string } | null;
}

interface ExecuteOptions {
  agent?: string;
  project?: string;
  templateId?: string;
  integrationKeys?: string[];
  artifactFieldValues?: Record<string, unknown>;
  configValues?: Record<string, unknown>;
  integrations?: string[];
  attachments?: Array<{ attachmentId: string; displayName: string; path: string; type: 'file' | 'folder' | 'url'; size?: number }>;
  sessionId?: string;
  language?: 'en' | 'pt';
  /** Existing artifact ID for follow-up builds (reuses project instead of creating new) */
  artifactInstanceId?: string;
  /** Existing project path for follow-up builds */
  projectPath?: string;
  /** Internal: skip adding the user message (used by retry to avoid duplicates) */
  _skipUserMessage?: boolean;
}

// ============================================
// HOOK
// ============================================

export function useAgentExecution(sessionId: string | null) {
  const [execState, setExecState] = useState<ExecutionState>({
    isExecuting: false,
    jobId: null,
    jobInfo: null,
    error: null,
  });

  const jobIdRef = useRef<string | null>(null);
  const previewStartedRef = useRef(false);
  /** trace_id of the in-flight execute run (sent to the backend in config).
   *  Lets the UI cancel the in-build classifier window — which runs server-side
   *  before any jobId exists, so cancel-job has nothing to abort — and correlate
   *  the resulting chat_answer for client-side suppression after a Stop. */
  const execTraceRef = useRef<string | null>(null);

  const [streamState, streamActions] = useJobStream(execState.jobId, sessionId);

  const store = useOrchestrationStore;

  // Monitor stream state for completion / preview triggers
  useEffect(() => {
    if (!sessionId) return;

    if (streamState.isComplete || streamState.result) {
      setExecState((prev) => ({ ...prev, isExecuting: false }));
      store.getState().setIsExecuting(false);

      // Note: retryContext is intentionally NOT cleared on success — it stays set so the
      // Resend button on the latest user message can re-run the same prompt with the same
      // options. It's overwritten by the next execute() call.

      // Set app URL on completion (static serving, no process to start) -- prefer slug
      const sessionJob = store.getState().sessionJobs[sessionId];
      if (sessionJob?.artifactInstanceId && !previewStartedRef.current) {
        previewStartedRef.current = true;
        const appIdentifier = sessionJob.slug || sessionJob.artifactInstanceId;
        store.getState().setSessionPreview(sessionId, {
          previewId: appIdentifier,
          appUrl: getAppUrl(appIdentifier),
          status: 'running',
        });
      }
    }

    if (streamState.error) {
      setExecState((prev) => ({
        ...prev,
        isExecuting: false,
        error: streamState.error,
      }));
      store.getState().setIsExecuting(false);
    }
  }, [sessionId, streamState.isComplete, streamState.result, streamState.error, store]);

  // Execute agent via WS action
  const execute = useCallback(
    async (message: string, options: ExecuteOptions = {}) => {
      if (!sessionId) return;

      setExecState({
        isExecuting: true,
        jobId: null,
        jobInfo: null,
        error: null,
      });
      store.getState().setIsExecuting(true);
      previewStartedRef.current = false;

      // Capture retry context BEFORE clearing — kept on failure so a Retry
      // button can re-fire the exact same call.
      store.getState().setRetryContext(sessionId, { message, options });

      // Clear previous outputs
      store.getState().clearSessionJobOutput(sessionId);
      streamActions.clearOutputs();

      // Client-generated trace id: lets Stop cancel the in-build classifier
      // window server-side and lets the chat_answer handler suppress a late
      // answer after a Stop.
      const execTraceId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      execTraceRef.current = execTraceId;

      // Build execution request. URL-type attachments don't go to the backend
      // (they're prepended to the message text by the caller); only file/folder
      // attachments are real on-disk paths the agent can read.
      const isFollowUp = !!(options.artifactInstanceId && options.projectPath);
      const backendAttachments = (options.attachments || []).filter((a) => a.type !== 'url');
      const request: ExecuteRequest = {
        agent: options.agent || 'coding-agent',
        project: options.project || `session-${sessionId}`,
        config: {
          description: message,
          templateId: options.templateId || undefined,
          integrationKeys: options.integrationKeys || undefined,
          traceId: execTraceId,
          ...(options.artifactFieldValues || {}),
          ...(options.configValues ? { configValues: options.configValues } : {}),
          attachments: backendAttachments,
          // Follow-up build: reuse existing artifact instead of creating new
          ...(isFollowUp ? {
            artifactInstanceId: options.artifactInstanceId,
            projectDir: options.projectPath,
          } : {}),
        },
        sessionId,
        language: options.language || 'en',
      };

      // Add user message to chat (include attachment info for display).
      // Skipped during retry so we don't duplicate the user's prompt.
      if (!options._skipUserMessage) {
        const msgAttachments = options.attachments && options.attachments.length > 0
          ? options.attachments.map(a => ({ displayName: a.displayName, type: a.type }))
          : undefined;
        store.getState().addMessage(sessionId, {
          role: 'user',
          content: message,
          metadata: { isEssential: true, attachments: msgAttachments },
        });
      }

      try {
        const response = await executeAgent(request);

        if (!response.success || !response.data) {
          const error = response.error || { code: 'EXECUTE_ERROR', message: 'Failed to start agent' };
          setExecState((prev) => ({
            ...prev,
            isExecuting: false,
            error,
          }));
          store.getState().setIsExecuting(false);
          // Never surface raw provider/engine error text to the user.
          store.getState().addMessage(sessionId, {
            role: 'system',
            content: sanitizeUserFacingError(error.message, useI18nStore.getState().language),
            metadata: { isEssential: true, type: 'error' },
          });
          return;
        }

        // R2: in-build classifier skip path. When the orchestrator decides the
        // follow-up message is a question / ambiguous / meta-action, the
        // backend returns { skipped: true, reason, ... } instead of starting
        // a job. The chat_answer SSE event carries the actual text; we also
        // ensure visible feedback here in case the SSE is delayed.
        const responseData = response.data as { skipped?: boolean; reason?: string };
        if (responseData.skipped) {
          // Mark execution as no-op; the chat_answer SSE handler in the
          // cortex provider will append the assistant turn.
          setExecState((prev) => ({ ...prev, isExecuting: false }));
          store.getState().setIsExecuting(false);
          return;
        }

        const jobInfo = response.data;
        const jobId = jobInfo.jobId;
        jobIdRef.current = jobId;

        setExecState((prev) => ({
          ...prev,
          jobId,
          jobInfo,
        }));

        // Update store with job info
        store.getState().setSessionJob(sessionId, {
          jobId,
          status: 'queued',
          phase: 'preparing',
          artifactInstanceId: jobInfo.artifactInstanceId || null,
          projectPath: jobInfo.projectPath || null,
        });

        // Add build started message (localized — must match the user's language
        // so it doesn't sit in English next to PT status text).
        store.getState().addMessage(sessionId, {
          role: 'assistant',
          content: resolveLanguage(options.language) === 'pt' ? 'Construção iniciada.' : 'Build started.',
          metadata: { isEssential: true, type: 'status', jobId },
        });

        // Process template files as file operations
        if (jobInfo.templateFiles && jobInfo.templateFiles.length > 0) {
          for (const file of jobInfo.templateFiles) {
            store.getState().addFileOperation(sessionId, file, 'created');
          }
        }

        // Set up app URL (static serving).
        // - First builds with templateFiles: scaffoldApp + initial esbuild already
        //   ran, preview is immediately servable.
        // - Follow-up builds: the app from the previous build is still served at
        //   the same /apps/{id}/ URL; esbuild hot-reload refreshes it as files
        //   change. Do NOT flip back to 'building' — that would hide the running
        //   iframe and flash the loading screen between messages.
        // - First builds without templateFiles (rare): fall through to 'building'.
        if (jobInfo.artifactInstanceId) {
          const hasTemplateFiles = jobInfo.templateFiles && jobInfo.templateFiles.length > 0;
          const previewReady = isFollowUp || hasTemplateFiles;
          store.getState().setSessionPreview(sessionId, {
            previewId: jobInfo.artifactInstanceId,
            appUrl: getAppUrl(jobInfo.artifactInstanceId),
            status: previewReady ? 'running' : 'building',
          });
          if (previewReady) {
            store.getState().setSidePanelTab('preview');
          }
        }

        // Guard: if the user switched sessions while the API call was in-flight,
        // abort here so we don't subscribe the wrong session's handler.
        if (store.getState().activeSessionId !== sessionId) {
          return;
        }

        // Subscribe to WS stream events using the trace_id from the execute response
        const streamTraceId = jobInfo.traceId || jobId;
        streamActions.connect(streamTraceId);
      } catch (err) {
        const error = {
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : 'Failed to start agent',
        };
        setExecState((prev) => ({
          ...prev,
          isExecuting: false,
          error,
        }));
        store.getState().setIsExecuting(false);
        store.getState().addMessage(sessionId, {
          role: 'system',
          content: `Error: ${error.message}`,
          metadata: { isEssential: true, type: 'error' },
        });
      }
    },
    [sessionId, store, streamActions]
  );

  // Cancel running job via WS action.
  // `silent` skips the "Build cancelled." + flushed-text messages — used when the
  // caller is about to remove the last turn anyway (Stop → edit-and-resend), so
  // we don't add messages that would immediately be trimmed.
  const cancel = useCallback(async (opts?: { silent?: boolean }) => {
    const currentJobId = jobIdRef.current || execState.jobId;
    if (!currentJobId) return;
    const silent = opts?.silent === true;

    try {
      await cancelJob(currentJobId);
      streamActions.disconnect();

      setExecState((prev) => ({
        ...prev,
        isExecuting: false,
      }));
      store.getState().setIsExecuting(false);

      if (sessionId) {
        if (silent) {
          // Drop any partial streamed text without surfacing it as a message.
          store.getState().clearStreamingChat(sessionId);
        } else {
          // Flush any pending streaming chat text before the cancel message
          const pendingText = store.getState().flushStreamingChat(sessionId);
          if (pendingText && pendingText.trim().length >= 20) {
            store.getState().addMessage(sessionId, {
              role: 'assistant',
              content: pendingText.trim(),
              metadata: { isEssential: true, type: 'agent_text' },
            });
          }
        }
        store.getState().setSessionJob(sessionId, { status: 'cancelled' });
        if (!silent) {
          store.getState().addMessage(sessionId, {
            role: 'system',
            content: resolveLanguage() === 'pt' ? 'Construção cancelada.' : 'Build cancelled.',
            metadata: { isEssential: true, type: 'status' },
          });
        }
      }
    } catch {
      streamActions.disconnect();
      setExecState((prev) => ({ ...prev, isExecuting: false }));
      store.getState().setIsExecuting(false);
      if (silent && sessionId) store.getState().clearStreamingChat(sessionId);
    }
  }, [execState.jobId, sessionId, store, streamActions]);

  // Reset state
  const reset = useCallback(() => {
    streamActions.disconnect();
    streamActions.clearOutputs();
    setExecState({
      isExecuting: false,
      jobId: null,
      jobInfo: null,
      error: null,
    });
    jobIdRef.current = null;
    previewStartedRef.current = false;
  }, [streamActions]);

  // Reset execution state when session changes
  useEffect(() => {
    setExecState({
      isExecuting: false,
      jobId: null,
      jobInfo: null,
      error: null,
    });
    jobIdRef.current = null;
    previewStartedRef.current = false;
  }, [sessionId]);

  // Auto-reconnect on mount if session has an active job
  useEffect(() => {
    if (!sessionId) return;

    const sessionJob = store.getState().sessionJobs[sessionId];
    if (!sessionJob?.jobId || sessionJob.status === 'idle') return;

    if (sessionJob.status === 'running' || sessionJob.status === 'queued') {
      getJob(sessionJob.jobId).then((res) => {
        if (res.success && res.data) {
          const job = res.data;
          if (job.status === 'running' || job.status === 'queued') {
            setExecState({
              isExecuting: true,
              jobId: sessionJob.jobId,
              jobInfo: job,
              error: null,
            });
            jobIdRef.current = sessionJob.jobId;
            store.getState().setIsExecuting(true);
            streamActions.connect(sessionJob.jobId!);
          } else {
            store.getState().setSessionJob(sessionId, {
              status: job.status as 'completed' | 'failed' | 'cancelled',
            });
          }
        } else {
          // Job not found on backend (server restarted, job expired) -- mark as failed
          store.getState().setSessionJob(sessionId, { status: 'failed' });
        }
      }).catch(() => {
        // Backend unreachable -- mark as failed so UI doesn't stay stuck
        store.getState().setSessionJob(sessionId, { status: 'failed' });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Resend the latest user message. Trims trailing non-user messages so the new
  // response replaces the prior one. Overlays the current session's artifact context
  // so resending the first prompt still targets the existing built artifact.
  const retry = useCallback(async () => {
    if (!sessionId) return;

    const messages = store.getState().messages[sessionId] || [];

    // Find latest user message — that's what we're resending
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;

    // Prefer the captured retryContext (has full attachment paths/IDs). If it's
    // gone (older session or cross-tab edit), fall back to the user message text
    // alone — works for plain prompts without attachments.
    const ctx = store.getState().getRetryContext(sessionId);
    const message = ctx?.message ?? messages[lastUserIdx].content;
    const baseOptions = ctx?.options ?? {};

    // Strip trailing non-user messages so the retry attaches a fresh response.
    const trimAt = lastUserIdx + 1;
    if (trimAt < messages.length) {
      useOrchestrationStore.setState((state) => ({
        messages: { ...state.messages, [sessionId]: messages.slice(0, trimAt) },
      }));
    }

    // Preserve the already-built artifact across resends (don't redo the wizard / scaffold).
    const sessionJob = store.getState().sessionJobs[sessionId];
    const optionsWithArtifact = { ...baseOptions, _skipUserMessage: true };
    if (sessionJob?.artifactInstanceId) {
      optionsWithArtifact.artifactInstanceId = sessionJob.artifactInstanceId;
    }
    if (sessionJob?.projectPath) {
      optionsWithArtifact.projectPath = sessionJob.projectPath;
    }

    await execute(message, optionsWithArtifact);
  }, [sessionId, store, execute]);

  return {
    state: {
      ...execState,
      streamState,
    },
    execute,
    cancel,
    reset,
    retry,
    /** Ref to the in-flight execute run's trace_id (for Stop → server cancel). */
    execTraceRef,
  };
}

export default useAgentExecution;
