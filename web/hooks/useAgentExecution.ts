'use client';

/**
 * Agent Execution Hook
 *
 * Manages the build job lifecycle: execute -> stream -> complete. Job START/CANCEL and the
 * transcript side effects (messages, retry context, refusal feed) live here; the SSE stream
 * itself is owned by the liveness-based job-stream manager (lib/job-stream-manager.ts), so a
 * backgrounded build keeps ingesting events instead of being torn down on session switch.
 *
 * This hook is bound to the ACTIVE session. It keeps the global `isExecuting` flag in sync
 * with that session's per-session build status (running|queued) - a compatibility bridge; the
 * flag itself is removed in a later slice once the UI reads sessionBusy() directly.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { api, tryCall } from '@/lib/api';
import type { Job } from '@ekoa/shared';
import { useOrchestrationStore, type SessionJobState } from '@/stores/orchestration';
import { useI18nStore } from '@/stores/i18n';
import { trackJob, untrackJob, ensureTracked } from '@/lib/job-stream-manager';
import { sanitizeUserFacingError } from '@/lib/sanitize-error';

/** Resolve the user's language preference, preferring an explicit per-call value.
 *  Falls back to the i18n store (the header/agent language), NOT the settings
 *  store - settings.general.language defaults to 'en' and is not kept in sync. */
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
  jobInfo: Job | null;
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

  const store = useOrchestrationStore;

  // The active session's per-session build status (manager-written). Drives the global
  // isExecuting flag below without a stream hook of its own.
  const buildStatus = useOrchestrationStore((s) =>
    sessionId ? s.sessionJobs[sessionId]?.status : undefined,
  );

  // Edge-trigger the global isExecuting flag off the active session's build liveness. Only
  // reacts to a build's running<->terminal transition, so it never fights the chat runtime's
  // own isExecuting writes (a pure chat turn leaves the build status idle). Tracks the last
  // (session,status) pair so a session switch starts the new session fresh instead of comparing
  // across sessions.
  const lastSeenRef = useRef<{ sessionId: string | null; status: SessionJobState['status'] | undefined }>(
    { sessionId: null, status: undefined },
  );
  useEffect(() => {
    const last = lastSeenRef.current;
    const prev = last.sessionId === sessionId ? last.status : undefined;
    lastSeenRef.current = { sessionId, status: buildStatus };
    if (!sessionId) return;
    const isLive = buildStatus === 'running' || buildStatus === 'queued';
    const wasLive = prev === 'running' || prev === 'queued';
    if (isLive && !wasLive) {
      store.getState().setIsExecuting(true);
      setExecState((s) => ({ ...s, isExecuting: true }));
    } else if (!isLive && wasLive) {
      store.getState().setIsExecuting(false);
      setExecState((s) => ({ ...s, isExecuting: false }));
    }
  }, [sessionId, buildStatus, store]);

  // Revisit reconcile (review #3): whenever this session becomes active with a non-terminal
  // build on record, make sure its stream is actually attached - the liveness-owned manager
  // has no per-mount lifecycle, so a stream lost to a failed cancel, a logout, or a transient
  // rehydrate error is recovered here (ensureTracked no-ops when the stream is healthy).
  useEffect(() => {
    if (!sessionId) return;
    const job = store.getState().sessionJobs[sessionId];
    if (!job?.jobId) return;
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return;
    void ensureTracked(job.jobId, sessionId);
  }, [sessionId, store]);

  // Execute agent via the jobs REST surface.
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

      // Capture retry context BEFORE clearing - kept on failure so a Retry
      // button can re-fire the exact same call.
      store.getState().setRetryContext(sessionId, { message, options });

      // Clear previous outputs
      store.getState().clearSessionJobOutput(sessionId);

      // Build the job-create request (FC-045). URL-type attachments don't go to the
      // backend (they're prepended to the message text by the caller); file/folder
      // attachments ride as uploadId references (never absolute server paths, §3.4).
      // A follow-up build is keyed by the existing artifact id; the server resolves
      // its project dir, so no client-side path is sent.
      const isFollowUp = !!options.artifactInstanceId;
      const backendAttachments = (options.attachments || [])
        .filter((a) => a.type !== 'url')
        .map((a) => ({ uploadId: a.attachmentId, displayName: a.displayName }));
      const fieldValues = options.artifactFieldValues;
      const request = {
        kind: 'build' as const,
        description: message,
        sessionId,
        ...(options.templateId ? { templateId: options.templateId } : {}),
        ...(options.integrationKeys ? { integrationKeys: options.integrationKeys } : {}),
        ...(options.artifactInstanceId ? { artifactId: options.artifactInstanceId } : {}),
        ...(backendAttachments.length > 0 ? { attachments: backendAttachments } : {}),
        ...(fieldValues ? { fieldValues } : {}),
        ...(options.configValues ? { configValues: options.configValues } : {}),
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
        const result = await tryCall(() => api.jobs.create(request));

        if (!result.ok) {
          const error = { code: result.error.code, message: result.error.message };
          setExecState((prev) => ({
            ...prev,
            isExecuting: false,
            error,
          }));
          store.getState().setIsExecuting(false);
          // Refused-build feed (BRIEF 9a): a capability refusal is never a dead end. Carry
          // the pre-drafted request on the error message so the bubble offers to file it to
          // the org-admin queue (change-requests fileFromRefusal). Only the two app-change
          // capabilities route there; anything else is a plain error.
          const details = result.error.details as { capability?: unknown } | undefined;
          const capability = result.error.status === 403 && typeof details?.capability === 'string'
            ? details.capability
            : null;
          const refusal = capability === 'canBuildApps' || capability === 'canEditApps'
            ? { text: message, ...(options.artifactInstanceId ? { appId: options.artifactInstanceId } : {}) }
            : undefined;
          // Never surface raw provider/engine error text to the user.
          store.getState().addMessage(sessionId, {
            role: 'system',
            content: sanitizeUserFacingError(error.message, useI18nStore.getState().language),
            metadata: { isEssential: true, type: 'error', ...(refusal ? { refusal } : {}) },
          });
          return;
        }

        // R2: in-build classifier answered path. When the orchestrator decides the
        // follow-up message is a question / ambiguous / meta-action, the endpoint
        // returns { status: 'answered', reason } instead of starting a job. The
        // chat_answer notification carries the actual text.
        if (result.data.status === 'answered') {
          setExecState((prev) => ({ ...prev, isExecuting: false }));
          store.getState().setIsExecuting(false);
          return;
        }

        const job = result.data.job;
        const jobId = job.id;

        setExecState((prev) => ({
          ...prev,
          jobId,
          jobInfo: job,
        }));

        // Update store with job info. The server resolves the project dir from the
        // artifact id, so no client-side path is tracked (FC-045). A capped build comes
        // back queued (job.status:'queued') - its stream opens and sits silent until
        // dispatch; anything else is executing, so mark it running.
        store.getState().setSessionJob(sessionId, {
          jobId,
          status: job.status === 'queued' ? 'queued' : 'running',
          phase: 'preparing',
          artifactInstanceId: job.artifactId || null,
        });

        // Add build started message (localized - must match the user's language
        // so it doesn't sit in English next to PT status text).
        store.getState().addMessage(sessionId, {
          role: 'assistant',
          content: resolveLanguage(options.language) === 'pt' ? 'Construção iniciada.' : 'Build started.',
          metadata: { isEssential: true, type: 'status', jobId },
        });

        // Set up app URL (static serving).
        // - Follow-up builds: the app from the previous build is still served at the
        //   same /apps/{id}/ URL; esbuild hot-reload refreshes it as files change.
        //   Do NOT flip back to 'building' - that would hide the running iframe.
        // - First builds: fall through to 'building' until the stream reports ready.
        if (job.artifactId) {
          const previewReady = isFollowUp;
          store.getState().setSessionPreview(sessionId, {
            previewId: job.artifactId,
            appUrl: api.appUrl(job.artifactId),
            status: previewReady ? 'running' : 'building',
          });
          if (previewReady) {
            store.getState().setSidePanelTab('preview');
          }
        }

        // Track the job's stream by its OWNING session regardless of focus - the manager
        // routes every event to this sessionId's buckets even if the user has since
        // switched away (or the build is queued and silent until dispatch).
        trackJob(jobId, sessionId);
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
    [sessionId, store]
  );

  // Cancel running job via the jobs REST surface.
  // `silent` skips the "Build cancelled." + flushed-text messages - used when the
  // caller is about to remove the last turn anyway (Stop → edit-and-resend), so
  // we don't add messages that would immediately be trimmed.
  const cancel = useCallback(async (opts?: { silent?: boolean }) => {
    const currentJobId =
      (sessionId ? store.getState().sessionJobs[sessionId]?.jobId : null) || execState.jobId;
    if (!currentJobId) return;
    const silent = opts?.silent === true;

    try {
      await api.jobs.cancel({ id: currentJobId });
      untrackJob(currentJobId);

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
      // Cancel FAILED (transient network/5xx): the build is still running server-side, so the
      // stream must stay attached and the session status stays 'running' - untracking here
      // permanently froze the session (review #3). The user can hit Stop again.
      setExecState((prev) => ({ ...prev, isExecuting: false }));
      store.getState().setIsExecuting(false);
      if (silent && sessionId) store.getState().clearStreamingChat(sessionId);
    }
  }, [execState.jobId, sessionId, store]);

  // Reset state
  const reset = useCallback(() => {
    const currentJobId = sessionId ? store.getState().sessionJobs[sessionId]?.jobId : null;
    if (currentJobId) untrackJob(currentJobId);
    setExecState({
      isExecuting: false,
      jobId: null,
      jobInfo: null,
      error: null,
    });
  }, [sessionId, store]);

  // Reset execution state when session changes
  useEffect(() => {
    setExecState({
      isExecuting: false,
      jobId: null,
      jobInfo: null,
      error: null,
    });
  }, [sessionId]);

  // Resend the latest user message. Trims trailing non-user messages so the new
  // response replaces the prior one. Overlays the current session's artifact context
  // so resending the first prompt still targets the existing built artifact.
  const retry = useCallback(async () => {
    if (!sessionId) return;

    const messages = store.getState().messages[sessionId] || [];

    // Find latest user message - that's what we're resending
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
    // alone - works for plain prompts without attachments.
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
    state: execState,
    execute,
    cancel,
    reset,
    retry,
  };
}

export default useAgentExecution;
