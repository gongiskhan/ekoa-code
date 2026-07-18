'use client';

/**
 * Headless chat runtime (surface contract 5). The chat CONTROLLER extracted
 * verbatim from the /chat page so the conversation can render anywhere - the
 * /chat route, the classic global dock, the OS-mode docked panel - while the
 * route wrapper keeps every piece of URL coupling (router.replace /
 * history.replaceState fire only on /chat).
 *
 * Mounted ONCE per shell ((dashboard) layout and (os) layout). Owns: the
 * send router, the chat-agent SSE run stream, the coding-agent execution hook,
 * the four notification subscriptions, cancel/retry/edit, and the one-shot
 * initializeBuilderSession. Views stay dumb and read the orchestration store.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useOrchestrationStore } from '@/stores/orchestration';
import { useAgentExecution } from '@/hooks/useAgentExecution';
import { api, openChatRunStream } from '@/lib/api';
import { useApi } from '@/components/providers/api-provider';
import { getFriendlyToolActivityBrief } from '@/lib/friendly-messages';
import type { LocalFileActivity } from '@/lib/privacy-claims';
import { createDaemonGrant, type PendingReference } from '@/lib/bridge-local';
import { sanitizeUserFacingError, redactProviderIdentity } from '@/lib/sanitize-error';
import { useTranslation, useI18nStore } from '@/stores/i18n';

// A wedged backend worker (no more events on an otherwise-open SSE connection)
// must not leave the composer stuck on "A pensar..." forever - bound the
// thinking window and surface a retryable error if nothing settles it. Chosen
// between the plain-request DEFAULT_TIMEOUT_MS (2min, too tight for a
// multi-tool agent turn) and the long-poll SESSION_POLL_MAX_MS (7min) already
// used elsewhere in this app for a bounded "long but not forever" wait.
const CHAT_RUN_STUCK_TIMEOUT_MS = 5 * 60_000;

export interface SendMessageOptions {
  /** FC-400: reference tokens attached to this outgoing message (chat path only). */
  references?: PendingReference[];
  /** Called when the chat path captured the references (the view clears its chips). */
  onReferencesConsumed?: () => void;
  /** Called when minting a reference grant failed (the view surfaces the error). */
  onReferenceMintError?: () => void;
}

export interface ChatRuntime {
  /** initializeBuilderSession completed (sessions + artifacts listed). */
  initialized: boolean;
  /** Unified send router: queue-while-building, then chat vs build by session data. */
  sendMessage: (text: string, opts?: SendMessageOptions) => void;
  /** Kick a first build directly (empty-state build-category prompts). */
  kickBuildFirst: (message: string, overrides?: { templateId?: string; skipUserMessage?: boolean }) => void;
  /** Stop the active run and hand the last message back for editing. */
  cancelActive: () => void;
  /** Resend the latest user turn (build-aware). */
  retryActive: () => void;
  /** Pop the last user turn into the composer draft without resending. */
  editLastUserMessage: () => void;
  isBuildSession: boolean;
  sessionHasJob: boolean;
  isOnboardingSession: boolean;
  /**
   * Subscribe to "a build was kicked" (the /chat page resets its manual
   * side-panel override so the panel re-opens). Returns the unsubscribe.
   */
  onBuildKick: (cb: () => void) => () => void;
}

const ChatRuntimeContext = createContext<ChatRuntime | null>(null);

export function useChatRuntime(): ChatRuntime {
  const ctx = useContext(ChatRuntimeContext);
  if (!ctx) throw new Error('useChatRuntime must be used inside ChatRuntimeProvider');
  return ctx;
}

export function ChatRuntimeProvider({ children }: { children: React.ReactNode }) {
  // -- Orchestration store --
  const activeSessionId = useOrchestrationStore((s) => s.activeSessionId);
  const sessions = useOrchestrationStore((s) => s.sessions);
  const pendingAttachments = useOrchestrationStore((s) => s.pendingAttachments);
  const messages = useOrchestrationStore((s) =>
    activeSessionId ? s.messages[activeSessionId] : undefined
  );
  const setSidePanelState = useOrchestrationStore((s) => s.setSidePanelState);
  const createSession = useOrchestrationStore((s) => s.createSession);
  const initializeBuilderSession = useOrchestrationStore((s) => s.initializeBuilderSession);
  const clearAttachments = useOrchestrationStore((s) => s.clearAttachments);
  const setSidePanelTab = useOrchestrationStore((s) => s.setSidePanelTab);
  const pendingDelegation = useOrchestrationStore((s) => s.pendingDelegation);
  const setPendingDelegation = useOrchestrationStore((s) => s.setPendingDelegation);
  const addMessage = useOrchestrationStore((s) => s.addMessage);
  const setActiveIntegrationBuild = useOrchestrationStore((s) => s.setActiveIntegrationBuild);
  const markIntegrationBuildReady = useOrchestrationStore((s) => s.markIntegrationBuildReady);
  const sessionJobs = useOrchestrationStore((s) => s.sessionJobs);
  const sessionPreviews = useOrchestrationStore((s) => s.sessionPreviews);
  const isExecuting = useOrchestrationStore((s) => s.isExecuting);
  const setIsExecutingStore = useOrchestrationStore((s) => s.setIsExecuting);
  const appendStreamingChat = useOrchestrationStore((s) => s.appendStreamingChat);
  const flushStreamingChat = useOrchestrationStore((s) => s.flushStreamingChat);
  const clearStreamingChat = useOrchestrationStore((s) => s.clearStreamingChat);
  const appendStreamingThinking = useOrchestrationStore((s) => s.appendStreamingThinking);
  const flushStreamingThinking = useOrchestrationStore((s) => s.flushStreamingThinking);
  const setActivityMessage = useOrchestrationStore((s) => s.setActivityMessage);
  const enqueueMessage = useOrchestrationStore((s) => s.enqueueMessage);
  const drainQueue = useOrchestrationStore((s) => s.drainQueue);
  const clearQueue = useOrchestrationStore((s) => s.clearQueue);
  const popLastUserTurn = useOrchestrationStore((s) => s.popLastUserTurn);
  const setComposerDraft = useOrchestrationStore((s) => s.setComposerDraft);

  const language = useI18nStore((s) => s.language);
  const { onboarding } = useTranslation();

  const { execute, cancel, retry: retryBuild } = useAgentExecution(activeSessionId);
  const { notifications } = useApi();

  const chatActivityThrottleRef = useRef(0);
  /** Cleanup closure for the chat-agent SSE subscription (stop button calls this). */
  const chatStreamCleanupRef = useRef<(() => void) | null>(null);
  /** trace_id of the in-flight chat-agent request, so Stop can abort it
   *  server-side (not just unsubscribe the client SSE — the server kept running). */
  const chatTraceIdRef = useRef<string | null>(null);
  /** trace_ids the user explicitly Stopped. The chat_answer handler drops any
   *  answer whose trace was cancelled — the client-side guarantee that an
   *  in-build classifier reply never appears after Stop, even if the server's
   *  abort lost the race and finished the classifier. */
  const cancelledTracesRef = useRef<Set<string>>(new Set());

  // "Build kicked" listeners (the /chat page re-arms its side-panel auto-open).
  const buildKickListenersRef = useRef<Set<() => void>>(new Set());
  const onBuildKick = useCallback((cb: () => void) => {
    buildKickListenersRef.current.add(cb);
    return () => {
      buildKickListenersRef.current.delete(cb);
    };
  }, []);
  const emitBuildKick = useCallback(() => {
    for (const cb of buildKickListenersRef.current) cb();
  }, []);

  // ========================================
  // INITIALIZATION
  // ========================================

  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    initializeBuilderSession().then(() => setInitialized(true));
  }, [initializeBuilderSession]);

  // Safety net: load messages for the active session whenever they are undefined.
  // initializeBuilderSession sets activeSessionId directly (via set()) without going
  // through setActiveSession, so the load must also be triggered here.
  useEffect(() => {
    if (!initialized || !activeSessionId || messages !== undefined) return;
    useOrchestrationStore.getState().loadSessionMessages(activeSessionId);
  }, [initialized, activeSessionId, messages]);

  // Clean up any in-flight chat stream subscription when the session changes.
  // The subscription created in handleChatSend is only self-removed on
  // complete/error; without this, a response that arrives after a session
  // switch would still write into the previous session's streaming buffer.
  useEffect(() => {
    return () => {
      if (chatStreamCleanupRef.current) {
        chatStreamCleanupRef.current();
      }
    };
  }, [activeSessionId]);

  // ========================================
  // SESSION-DATA DERIVATIONS
  // ========================================

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isOnboardingSession = activeSession?.type === 'onboarding';
  const sessionJob = activeSessionId ? sessionJobs[activeSessionId] : null;
  const sessionPreview = activeSessionId ? sessionPreviews[activeSessionId] : null;
  const sessionArtifactId = sessionJob?.artifactInstanceId ?? null;
  const isBuildSession =
    sessionArtifactId !== null ||
    sessionPreview?.templateId != null ||
    !!sessionPreview?.appUrl;
  const sessionHasJob = sessionJob?.jobId != null;

  // ========================================
  // BUILD MODE HANDLERS
  // ========================================

  const handleBuildFirstMessage = useCallback(
    async (message: string, overrides?: { templateId?: string; skipUserMessage?: boolean }) => {
      let sessionId = activeSessionId;
      if (!sessionId) {
        sessionId = await createSession();
        if (!sessionId) return;
      }

      // Phase 4: skip the wizard. The chat-agent has already gathered the goal
      // and resolved integrations server-side; the build resolver picks the
      // base (or extends from a chosen template) at scaffold time. The
      // build_intent SSE event carries the chat-agent's template choice via
      // `overrides`.
      //
      // We set sidePanelState='build' explicitly here: the orchestrator
      // phase_changed signal only fires for paths that call setOrchestratorState
      // (gather intent, in-build classifier), but the chat-agent → build_intent
      // → execute() path doesn't transition the orchestrator state, so without
      // this the side panel stays hidden for the entire first build.
      setSidePanelState('build');
      setSidePanelTab('preview');
      // A new build re-arms auto-open: the /chat page listens and clears any
      // stale manual-close so the panel reveals for this build.
      emitBuildKick();
      // Drop URL attachments here — they were already prepended to the message
      // text by sendMessage. Only file/folder atts go through execute().
      const attachments = pendingAttachments.filter((a) => a.type !== 'url');
      const templateId = overrides?.templateId || undefined;
      execute(message, {
        templateId,
        attachments: attachments.length > 0 ? attachments : undefined,
        language,
        // When the chat-agent delegated to a build (build_intent / delegate),
        // the user's message is already in the thread — don't let execute()
        // re-add it (that was the duplicated "sim" bug).
        _skipUserMessage: overrides?.skipUserMessage,
      });
      clearAttachments();
    },
    [
      activeSessionId,
      createSession,
      execute,
      pendingAttachments,
      setSidePanelState,
      setSidePanelTab,
      clearAttachments,
      language,
      emitBuildKick,
    ]
  );

  // Follow-up messages in Build mode -- reuse existing artifact. Declared above
  // the build_intent listener so that listener can route follow-up edits here.
  const handleBuildSendMessage = useCallback(
    (message: string, opts?: { skipUserMessage?: boolean }) => {
      if (!activeSessionId) return;

      setSidePanelState('build');
      setSidePanelTab('preview');
      emitBuildKick();

      // Pass existing artifact context so the backend modifies it instead of creating new
      const currentJob = sessionJobs[activeSessionId];
      const artifactInstanceId = currentJob?.artifactInstanceId || undefined;
      const projectPath = currentJob?.projectPath || undefined;

      // URL atts were already prepended to the message text by sendMessage.
      const fileAtts = pendingAttachments.filter((a) => a.type !== 'url');

      execute(message, {
        attachments: fileAtts.length > 0 ? fileAtts : undefined,
        language,
        artifactInstanceId: artifactInstanceId ?? undefined,
        projectPath: projectPath ?? undefined,
        // When a build_intent redirect drives this (the user's message is
        // already in the onboarding thread), don't let execute() re-add it.
        _skipUserMessage: opts?.skipUserMessage,
      });

      clearAttachments();
    },
    [activeSessionId, pendingAttachments, execute, setSidePanelState, setSidePanelTab, clearAttachments, sessionJobs, language, emitBuildKick]
  );

  // ========================================
  // DELEGATION HANDLER
  // ========================================

  useEffect(() => {
    if (!pendingDelegation || !activeSessionId || isExecuting) return;

    const { description, templateId } = pendingDelegation;
    setPendingDelegation(null);
    setSidePanelState('build');
    setSidePanelTab('files');

    execute(description, {
      templateId: templateId || undefined,
      // The user's message is already in the thread (handleChatSend added it
      // before setting pendingDelegation). `description` here is the chat-agent's
      // synthesized build brief, not the user's text — don't surface it as a
      // second user bubble.
      _skipUserMessage: true,
    });
  }, [
    pendingDelegation,
    activeSessionId,
    isExecuting,
    execute,
    setPendingDelegation,
    setSidePanelState,
    setSidePanelTab,
  ]);

  // ========================================
  // NOTIFICATION SUBSCRIPTIONS
  // ========================================

  // Server-side build intent safety net: listen for build_intent SSE events.
  // When the chat agent detects build intent that the local classifier missed,
  // it emits <ekoa-build-redirect/> which the server converts to a build_intent event.
  // Prior conversation already lives in the orchestration store (unified) - no
  // message migration needed; we just stop the chat-agent stream and kick the
  // build pipeline with the original message.
  const buildIntentHandledRef = useRef(false);
  useEffect(() => {
    buildIntentHandledRef.current = false;
    if (!notifications) return;

    return notifications.on('build_intent', (event) => {
      const originalMessage = event.request.description || '';
      if (!originalMessage || buildIntentHandledRef.current) return;
      // Origin filter: the notifications stream is per-user (every tab). Only the
      // tab whose chat run triggered the delegation may kick the build — without
      // this, each open tab fired its own build for one message.
      if (!event.sourceRunId || event.sourceRunId !== chatTraceIdRef.current) return;
      buildIntentHandledRef.current = true;

      if (chatStreamCleanupRef.current) {
        chatStreamCleanupRef.current();
      }

      // Drop any partial streamed text so the build-started state is clean.
      const sid = useOrchestrationStore.getState().activeSessionId;
      if (sid) clearStreamingChat(sid);

      if (sid) {
        addMessage(sid, {
          role: 'system',
          content: language === 'pt'
            ? 'A iniciar a construção...'
            : 'Starting the build…',
          metadata: { type: 'status', isEssential: true },
        });
      }

      // A redirect that names an artifact (or a session already bound to one) is a
      // follow-up EDIT — route it to the edit path so we don't mint a new artifact.
      // Otherwise scaffold fresh; the server resolves the base (client-side template
      // choice retired, FC-107).
      const boundArtifact = sid
        ? useOrchestrationStore.getState().sessionJobs[sid]?.artifactInstanceId
        : null;
      if (event.request.artifactId || boundArtifact) {
        handleBuildSendMessage(originalMessage, { skipUserMessage: true });
      } else {
        handleBuildFirstMessage(originalMessage, { skipUserMessage: true });
      }
    });
  }, [notifications, handleBuildFirstMessage, handleBuildSendMessage, addMessage, clearStreamingChat, language]);

  // R2 — chat_answer subscription. The in-build classifier emits this event
  // when the user's mid-build message is a question, ambiguous, or a meta
  // action that the orchestrator handled inline. We append the answer to the
  // active session's chat thread without flipping into building state.
  useEffect(() => {
    if (!notifications) return;
    return notifications.on('chat_answer', (event) => {
      const sid = event.sessionId || useOrchestrationStore.getState().activeSessionId;
      if (!sid) return;
      // Drop answers for runs the user Stopped — the run may have finished
      // server-side before the cancel landed; this is the guarantee that a
      // clarification never appears after Stop.
      if (event.sourceRunId && cancelledTracesRef.current.has(event.sourceRunId)) {
        cancelledTracesRef.current.delete(event.sourceRunId);
        return;
      }
      const text = event.text || '';
      if (!text) return;
      const store = useOrchestrationStore.getState();
      store.addMessage(sid, {
        role: 'assistant',
        content: text,
        metadata: {
          isEssential: true,
          type: 'text',
        },
      });
    });
  }, [notifications]);

  // Integration build intent — chat-agent emits <ekoa-integration-build-redirect/>,
  // server converts to integration_build_intent SSE. Switch the side panel to
  // the integration builder for this chat session.
  useEffect(() => {
    if (!notifications) return;
    return notifications.on('integration_build_intent', (event) => {
      const sid = event.sessionId || useOrchestrationStore.getState().activeSessionId;
      if (!sid) return;

      // The concrete integration key is not known at intent time (server-side
      // marker parsing, FC-205); the hint labels the in-progress build until
      // `integration_ready` delivers the key.
      const hint = event.hint;
      setActiveIntegrationBuild(sid, { key: hint ?? '', label: hint });
      setSidePanelState('integrate');
      addMessage(sid, {
        role: 'system',
        content: language === 'pt'
          ? `A construir a integração${hint ? ` ${hint}` : ''}...`
          : `Building the ${hint ? `${hint} ` : ''}integration...`,
        metadata: { isEssential: true, type: 'status' },
      });
    });
  }, [notifications, setActiveIntegrationBuild, setSidePanelState, addMessage, language]);

  // Integration ready — the integration-builder backend emits this on save.
  // Ask the user whether to wire the integration into the app. The user's
  // reply (yes) triggers the chat-agent to continue with the integration in
  // its catalog (next coding-agent invocation picks it up via the registry).
  useEffect(() => {
    if (!notifications) return;
    return notifications.on('integration_ready', (event) => {
      const sid = useOrchestrationStore.getState().activeSessionId;
      if (!sid) return;
      const integrationKey = event.integrationKey || '';
      if (!integrationKey) return;

      markIntegrationBuildReady(sid);
      // Flip the side panel back to the builder tabs (Files/Output/Preview)
      // now that the integration build completed.
      setSidePanelState('build');
      setSidePanelTab('preview');
      // Clear the active integration build now that the side-panel has switched.
      setActiveIntegrationBuild(sid, null);

      addMessage(sid, {
        role: 'assistant',
        content: language === 'pt'
          ? `A integração ${integrationKey} está pronta. Queres que a adicione à tua app agora?`
          : `The ${integrationKey} integration is ready. Want me to add it to your app now?`,
        metadata: { isEssential: true, type: 'text' },
      });
    });
  }, [
    notifications,
    markIntegrationBuildReady,
    setSidePanelState,
    setSidePanelTab,
    setActiveIntegrationBuild,
    addMessage,
    language,
  ]);

  // ========================================
  // CHAT-AGENT STREAM HANDLER
  // ========================================
  // Free-form messages (no artifact attached yet) go through the chat-agent via
  // the chat runs resource (create run, then consume its scoped event stream).
  // Streams responses into the orchestration store (same path the coding-agent
  // uses for builds), so the unified ChatPanel renders them without knowing or
  // caring which agent is talking.

  const handleChatSend = useCallback(async (textArg: string, sendOpts?: SendMessageOptions) => {
    const text = textArg.trim();
    if (!text || isExecuting) return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        sessionId = await createSession();
        if (!sessionId) return;
      } catch {
        return;
      }
    }

    const attachmentsForMessage = pendingAttachments.length > 0
      ? pendingAttachments.map((a) => ({ displayName: a.displayName, type: a.type }))
      : undefined;

    // 1. User message → orchestration store, local mirror only: the run
    // pipeline persists it server-side (ch05 §5.6.1 step 1).
    addMessage(sessionId, {
      role: 'user',
      content: text,
      metadata: attachmentsForMessage ? { attachments: attachmentsForMessage } : undefined,
    }, { persist: false });
    setIsExecutingStore(true);

    // Reset any prior streaming buffer for this session.
    clearStreamingChat(sessionId);

    try {
      // Map file/folder attachments to upload references (FC-013/060); URL
      // attachments are already prepended to the message text by the caller.
      const uploadRefs = pendingAttachments
        .filter((a) => a.type !== 'url')
        .map((a) => ({ uploadId: a.attachmentId, displayName: a.displayName }));
      if (pendingAttachments.length > 0) clearAttachments();

      // FC-400/D3 (run 20260711-111952 s5): pending references are minted into session
      // grants HERE, bound to the real chat session id (which a brand-new chat only has
      // now). Selection was the authorization (D2); the daemon grants a file pick's parent
      // folder. A mint failure is honest — the message still sends, without that reference,
      // and the composer surfaces the error — never a silent upload or a fabricated grant.
      const pendingRefs = sendOpts?.references ?? [];
      if (pendingRefs.length > 0) sendOpts?.onReferencesConsumed?.();
      const references: Array<{ grantRef: string; label: string }> = [];
      for (const ref of pendingRefs) {
        try {
          const grant = await createDaemonGrant({ path: ref.path, session: sessionId, label: ref.label });
          references.push({ grantRef: grant.grantRef, label: grant.label ?? ref.label });
        } catch {
          sendOpts?.onReferenceMintError?.();
        }
      }

      // FC-013: create the run, await the server-minted runId, THEN subscribe to
      // its scoped event stream. `language` is injected by the transport (§12.2.3).
      const { runId } = await api.chat.createRun({
        sessionId,
        message: text,
        ...(uploadRefs.length > 0 ? { attachments: uploadRefs } : {}),
        ...(references.length > 0 ? { references } : {}),
      });
      chatTraceIdRef.current = runId;

      const stream = openChatRunStream(runId);
      // A terminal state must settle the UI exactly once, whether it arrives as a
      // live SSE event or via the `ready` re-sync below.
      let settled = false;
      // Thinking window (per run): first thinking_chunk opens it, first answer chunk closes
      // it — the duration rides the local mirror's metadata (the server persists its own).
      let thinkingStartedAt: number | null = null;
      let thinkingEndedAt: number | null = null;
      // FC-402 (run s5): the turn's local-file activity, streamed as `local_activity` when a
      // delegation read local excerpts. Transient display metadata — it rides the in-memory
      // message mirror only (persist:false below); the server never persists it (§18.2).
      let localActivity: LocalFileActivity | null = null;

      const finishStream = () => {
        stream.close();
        clearTimeout(stuckTimer);
        setIsExecutingStore(false);
        setActivityMessage(sessionId!, null);
        chatStreamCleanupRef.current = null;
        chatTraceIdRef.current = null;
      };

      const handleComplete = (event: { result?: unknown; delegate?: { request: Record<string, unknown> } }) => {
        if (settled) return;
        settled = true;
        finishStream();

        // Handle delegation BEFORE flushing — if the chat-agent delegated to a
        // build, the build_intent notification migrates the prior conversation;
        // we skip the assistant message append.
        if (event.delegate) {
          clearStreamingChat(sessionId!);
          const request = event.delegate.request as { description?: unknown };
          setPendingDelegation({
            description: typeof request.description === 'string' ? request.description : '',
            templateId: null,
          });
          return;
        }

        // Flush streaming buffers + persist the final assistant turn. The thinking buffer
        // becomes message metadata so the collapsed thinking section survives the live bubble.
        const thinkingText = flushStreamingThinking(sessionId!);
        if (thinkingStartedAt !== null && thinkingEndedAt === null) thinkingEndedAt = Date.now();
        const buffered = flushStreamingChat(sessionId!);
        const resultText = typeof event.result === 'string' ? event.result : '';
        // A SUCCESSFUL reply is content, never an error — render it. Do NOT run it through the
        // provider-leak guard (which would replace the whole answer with "temporarily unavailable"
        // just because it mentions the engine); instead REDACT any engine-identifying terms to the
        // EKOA brand, so the user keeps their answer and the white-label holds. The persona in
        // api/src/agents/context.ts is the primary enforcement; this is the client safety net. The
        // leak guard (whole-message replace) stays on the ERROR path below, where it belongs.
        const finalContent = redactProviderIdentity(
          resultText || buffered || 'No response received.'
        );
        // Local mirror only: the run pipeline persists the assistant turn
        // server-side (ch05 §5.6.1 step 7).
        addMessage(sessionId!, {
          role: 'assistant',
          content: finalContent,
          metadata: {
            isEssential: true,
            type: 'text',
            ...(thinkingText
              ? {
                  thinking: thinkingText,
                  ...(thinkingStartedAt !== null && thinkingEndedAt !== null
                    ? { thinkingDurationMs: thinkingEndedAt - thinkingStartedAt }
                    : {}),
                }
              : {}),
            // FC-402: the trust chip's per-turn data (transient; never server-persisted).
            ...(localActivity ? { localFileActivity: localActivity } : {}),
          },
        }, { persist: false });
      };

      const handleError = (event: { message?: string }) => {
        if (settled) return;
        settled = true;
        finishStream();
        clearStreamingChat(sessionId!);
        // Strip any provider/engine leak; fall back to a generic branded message.
        const errorText = event.message
          ? sanitizeUserFacingError(event.message, language)
          : language === 'pt'
            ? 'Algo correu mal. Por favor tente novamente.'
            : 'Something went wrong. Please try again.';
        addMessage(sessionId!, {
          role: 'system',
          content: errorText,
          metadata: { isEssential: true, type: 'status' },
        });
      };

      // A wedged worker can leave the SSE connection open with no further
      // events ever arriving - the spinner and "A pensar..." would otherwise
      // run forever with no error, no timeout, no retry. Bound the wait and
      // settle it as a retryable error (cleared in finishStream on any real
      // settlement, and on manual Stop below).
      const stuckTimer = setTimeout(() => {
        handleError({
          message: language === 'pt'
            ? 'A resposta demorou demasiado tempo. Tente novamente.'
            : 'The response took too long. Please try again.',
        });
      }, CHAT_RUN_STUCK_TIMEOUT_MS);

      stream.on('text_chunk', (event) => {
        if (event.text) {
          if (thinkingStartedAt !== null && thinkingEndedAt === null) thinkingEndedAt = Date.now();
          appendStreamingChat(sessionId!, event.text);
        }
      });

      stream.on('thinking_chunk', (event) => {
        if (event.text) {
          thinkingStartedAt ??= Date.now();
          appendStreamingThinking(sessionId!, event.text);
        }
      });

      stream.on('local_activity', (event) => {
        localActivity = {
          files: event.files,
          ...(event.bytesOut !== undefined ? { bytesOut: event.bytesOut } : {}),
          ...(event.maskedCounts !== undefined ? { maskedCounts: event.maskedCounts } : {}),
          ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
        };
      });

      stream.on('tool_event', (event) => {
        if (event.phase === 'started') {
          const now = Date.now();
          if (now - chatActivityThrottleRef.current >= 2000) {
            chatActivityThrottleRef.current = now;
            setActivityMessage(sessionId!, getFriendlyToolActivityBrief(event.tool, event.args ?? {}));
          }
        }
      });

      stream.on('complete', handleComplete);

      stream.on('error', handleError);

      // A run that settles BEFORE the EventSource attaches never reaches this
      // client as a live event, and the ring replays only on Last-Event-ID
      // resume (ch03 §3.6) — a fast-failing run left the spinner up forever.
      // On every `ready` (first attach and reconnects, which lose the ring
      // position), re-sync the terminal state via GET /chat/runs/:id
      // (mirrors the FC-026 re-sync in useAutomationRun).
      stream.on('ready', () => {
        void api.chat
          .getRun({ id: runId })
          .then((run) => {
            if (settled) return;
            if (run.status === 'error') {
              handleError({ message: run.error?.message });
            } else if (run.status === 'complete') {
              handleComplete({ result: run.result });
            } else if (run.status === 'cancelled') {
              settled = true;
              finishStream();
              clearStreamingChat(sessionId!);
            }
          })
          .catch(() => {
            /* transient — live events remain the primary path */
          });
      });

      // Register the stop handle immediately so the Stop button works even before
      // the first event arrives (during routing/pre-stream).
      chatStreamCleanupRef.current = () => {
        stream.close();
        clearTimeout(stuckTimer);
        setIsExecutingStore(false);
        setActivityMessage(sessionId!, null);
        clearStreamingChat(sessionId!);
        chatStreamCleanupRef.current = null;
        chatTraceIdRef.current = null;
      };
    } catch {
      setIsExecutingStore(false);
      clearStreamingChat(sessionId!);
      addMessage(sessionId!, {
        role: 'system',
        content: language === 'pt'
          ? 'Algo correu mal. Por favor tente novamente.'
          : 'Something went wrong. Please try again.',
        metadata: { isEssential: true, type: 'status' },
      });
    }
  }, [
    isExecuting,
    activeSessionId,
    createSession,
    setPendingDelegation,
    pendingAttachments,
    clearAttachments,
    addMessage,
    appendStreamingChat,
    flushStreamingChat,
    clearStreamingChat,
    appendStreamingThinking,
    flushStreamingThinking,
    setActivityMessage,
    setIsExecutingStore,
    language,
  ]);

  // ========================================
  // UNIFIED SEND ROUTER + CANCEL DISPATCH
  // ========================================
  // Routing decision is a function of session DATA, not a UI mode flag:
  //
  //   isBuildSession + has active job → handleBuildSendMessage (follow-up)
  //   isBuildSession + no job yet     → handleBuildFirstMessage (kick build)
  //   no artifact bound to session    → handleChatSend (chat-agent decides)

  const sendMessage = useCallback(
    (textArg: string, sendOpts?: SendMessageOptions) => {
      const rawText = textArg.trim();
      if (!rawText) return;

      // Queue-while-building: don't reject messages sent during an active run.
      // Queue them and flush (FIFO) when the run finishes. The flush effect calls
      // this same function once isExecuting is false, so this guard won't loop.
      if (isExecuting) {
        if (activeSessionId) {
          enqueueMessage(activeSessionId, rawText);
        }
        return;
      }

      // URL attachments are not real files — append them to the message body so
      // the agent's WebFetch tool can reach them. File/folder attachments
      // continue through the regular attachments pipeline.
      const urlAtts = pendingAttachments.filter((a) => a.type === 'url');
      const refsLabel = language === 'pt' ? 'Referências' : 'References';
      const text = urlAtts.length > 0
        ? `${rawText}\n\n${refsLabel}:\n${urlAtts.map((a) => `- ${a.path}`).join('\n')}`
        : rawText;

      // Onboarding sessions ALWAYS stay on the chat path, even after the first
      // build binds an artifact to the session. The chat agent carries the
      // server-side onboarding injection and proposes the next build via the
      // <ekoa-build-redirect/> marker; routing to the build path here would make
      // the onboarding agent unreachable and break second-visit suggestions.
      if (isOnboardingSession) {
        // First turn: persist the welcome greeting + question as the opening
        // assistant message so a resumed transcript reads correctly (the agent
        // skill already knows the UI greeted). Only once, while empty.
        if (activeSessionId) {
          const existing = useOrchestrationStore.getState().messages[activeSessionId];
          if (!existing || existing.length === 0) {
            addMessage(activeSessionId, {
              role: 'assistant',
              content: `${onboarding.welcome.greeting}\n\n${onboarding.welcome.question}`,
              metadata: { isEssential: true },
            });
          }
        }
        void handleChatSend(text, sendOpts);
      } else if (isBuildSession && (sessionHasJob || sessionArtifactId)) {
        // Follow-up edit of an existing artifact. `sessionArtifactId` (without a
        // jobId) is the "Continue working"/?continue= case: the session was
        // hydrated from a built/imported artifact but hasn't run a job in THIS
        // session yet. Routing it to the first-build path would scaffold a brand
        // new artifact instead of editing the existing one.
        handleBuildSendMessage(text);
      } else if (isBuildSession) {
        void handleBuildFirstMessage(text);
      } else {
        void handleChatSend(text, sendOpts);
      }
    },
    [
      isExecuting,
      isOnboardingSession,
      isBuildSession,
      sessionHasJob,
      sessionArtifactId,
      pendingAttachments,
      language,
      onboarding,
      addMessage,
      handleBuildSendMessage,
      handleBuildFirstMessage,
      handleChatSend,
      activeSessionId,
      enqueueMessage,
    ],
  );

  // Flush queued messages (FIFO) when the active run finishes. isExecuting is a
  // GLOBAL flag that also flips false on session switch, so we track which session
  // was actually executing and only flush that one while it's still active —
  // otherwise a session switch would drain the wrong session's queue.
  const executingSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (isExecuting) {
      executingSessionRef.current = activeSessionId;
      return;
    }
    const sid = executingSessionRef.current;
    executingSessionRef.current = null;
    if (!sid || sid !== activeSessionId) return;
    // Merge ALL messages queued during the run into a single follow-up turn so
    // the agent reasons about them together (and asks at most one clarifying
    // question) instead of processing them one-by-one and re-prompting per item.
    const drained = drainQueue(sid);
    if (drained.length > 0) sendMessage(drained.join('\n\n'));
  }, [isExecuting, activeSessionId, drainQueue, sendMessage]);

  /**
   * Stop the active run and hand the last message back to the composer for editing.
   * Robust across all states:
   *  - build with a job   → cancel() aborts it server-side (silent: no "cancelled" message)
   *  - chat / pre-job     → tear down the SSE subscription
   *  - either way         → force isExecuting false so the UI never sticks,
   *    drop the queue, remove the last user turn, and restore its text to edit.
   */
  const cancelActive = useCallback(() => {
    const sid = activeSessionId;
    if (sessionJob?.jobId) {
      void cancel({ silent: true });
    }
    // Tell the server to abort the in-flight chat run (FC-014). Tearing down the
    // client SSE subscription alone leaves the server run going. Mark the run id
    // cancelled BEFORE the cleanup closure nulls it, so a chat_answer that races
    // through after Stop is suppressed client-side.
    const chatRunId = chatTraceIdRef.current;
    if (chatRunId) {
      cancelledTracesRef.current.add(chatRunId);
      void api.chat.cancelRun({ id: chatRunId }).catch(() => {});
    }
    // Chat cleanup is a no-op for builds; calling both is safe and covers the
    // build "preparing" phase where no jobId exists yet.
    chatStreamCleanupRef.current?.();
    setIsExecutingStore(false);
    if (!sid) return;
    setActivityMessage(sid, null);
    clearStreamingChat(sid);
    clearQueue(sid);
    const removed = popLastUserTurn(sid);
    if (removed != null) setComposerDraft(sid, removed);
  }, [
    activeSessionId,
    sessionJob?.jobId,
    cancel,
    setIsExecutingStore,
    setActivityMessage,
    clearStreamingChat,
    clearQueue,
    popLastUserTurn,
    setComposerDraft,
  ]);

  // Resend the latest user message in chat (non-build) sessions — the chat-mode
  // counterpart to retryBuild, used by both Resend (user bubble) and Retry
  // (assistant bubble) since both trigger the identical pop-and-resubmit action.
  const retryChat = useCallback(() => {
    const sid = activeSessionId;
    if (!sid) return;
    const removed = popLastUserTurn(sid);
    if (removed != null) void handleChatSend(removed);
  }, [activeSessionId, popLastUserTurn, handleChatSend]);

  const retryActive = useCallback(() => {
    if (isBuildSession) void retryBuild();
    else retryChat();
  }, [isBuildSession, retryBuild, retryChat]);

  // Pop the last user turn back into the composer for editing, without
  // resending it — reuses the same mechanism the Stop button uses (cancelActive).
  const editLastUserMessage = useCallback(() => {
    const sid = activeSessionId;
    if (!sid) return;
    const removed = popLastUserTurn(sid);
    if (removed != null) setComposerDraft(sid, removed);
  }, [activeSessionId, popLastUserTurn, setComposerDraft]);

  const kickBuildFirst = useCallback(
    (message: string, overrides?: { templateId?: string; skipUserMessage?: boolean }) => {
      void handleBuildFirstMessage(message, overrides);
    },
    [handleBuildFirstMessage],
  );

  const value = useMemo<ChatRuntime>(
    () => ({
      initialized,
      sendMessage,
      kickBuildFirst,
      cancelActive,
      retryActive,
      editLastUserMessage,
      isBuildSession,
      sessionHasJob,
      isOnboardingSession,
      onBuildKick,
    }),
    [
      initialized,
      sendMessage,
      kickBuildFirst,
      cancelActive,
      retryActive,
      editLastUserMessage,
      isBuildSession,
      sessionHasJob,
      isOnboardingSession,
      onBuildKick,
    ],
  );

  return <ChatRuntimeContext.Provider value={value}>{children}</ChatRuntimeContext.Provider>;
}
