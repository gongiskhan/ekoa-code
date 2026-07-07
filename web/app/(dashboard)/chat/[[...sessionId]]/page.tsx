"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import {
  Send,
  Square,
  Paperclip,
  Loader2,
  Copy,
  Check,
  FileCode2,
  File,
  FolderOpen,
  X,
  History,
  PanelRight,
  RefreshCw,
  AlertCircle,
  Camera,
  Link as LinkIcon,
} from "lucide-react";
import SessionsPanel from "@/components/builder/sessions-panel";
import ChatPanel from "@/components/builder/chat-panel";
import SidePanel from "@/components/builder/side-panel";
import { WelcomeMessageBubble, PromptSuggestionsStrip, ChatLoadingScreen } from "@/components/chat/empty-state";
import { ChatStripes } from "@/components/chat/chat-stripes";
import { OnboardingCard } from "@/components/chat/onboarding-card";
import { OnboardingWelcome } from "@/components/chat/onboarding-welcome";
import MobileSessionsDrawer from "@/components/chat/mobile-sessions-drawer";
import MobileSidePanelDrawer from "@/components/chat/mobile-side-panel-drawer";
import { ShortcutsModal } from "@/components/chat/shortcuts-modal";
import { AnimatedTagline } from "@/components/chat/animated-tagline";
import { useOrchestrationStore } from "@/stores/orchestration";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSettingsStore } from "@/stores/settings";
import { useAgentExecution } from "@/hooks/useAgentExecution";
import * as api from "@/lib/api/client";
import { getConnection } from "@/lib/cortex/connection";
import {
  getFriendlyToolActivityBrief,
  getFriendlySubagentMessage,
  getFriendlySkillMessage,
} from "@/lib/friendly-messages";
import { copyToClipboard } from "@/lib/clipboard";
import { sanitizeUserFacingError } from "@/lib/sanitize-error";
import { useTranslation, useI18nStore } from "@/stores/i18n";

// ============================================
// MARKDOWN COMPONENTS
// ============================================

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-lg font-bold text-neutral-900 mt-3 mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-bold text-neutral-900 mt-3 mb-1.5">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-bold text-neutral-800 mt-2.5 mb-1">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold text-neutral-800 mt-2 mb-1">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="mb-2 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-sm leading-relaxed">{children}</li>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-teal-700 hover:underline"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return <code className="block text-xs leading-snug">{children}</code>;
    }
    return (
      <code className="bg-neutral-200 text-neutral-800 rounded px-1 py-0.5 text-xs font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-neutral-800 text-neutral-100 rounded-md p-3 my-2 overflow-x-auto text-xs font-mono leading-snug">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-neutral-300 pl-3 my-2 italic text-neutral-500">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full text-xs border border-neutral-200 rounded">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-neutral-100">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-neutral-200">{children}</tbody>
  ),
  tr: ({ children }) => <tr className="even:bg-neutral-50">{children}</tr>,
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-semibold text-neutral-700 border-b border-neutral-200">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 text-neutral-600">{children}</td>
  ),
  hr: () => <hr className="my-3 border-neutral-200" />,
  strong: ({ children }) => (
    <strong className="font-semibold text-neutral-800">{children}</strong>
  ),
};

// ============================================
// HELPERS
// ============================================

interface CodeBlock {
  language: string;
  code: string;
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================

export default function UnifiedChatPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSessionsExpanded, setIsSessionsExpanded] = useState(false);
  const hasHandledReinterview = useRef(false);
  const isMobile = useIsMobile();

  // Mobile drawer states
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [mobileSidePanelOpen, setMobileSidePanelOpen] = useState(false);

  // Desktop side-panel override. null = follow the auto signal (showSidePanel);
  // true/false = force open/closed via the floating toggle. This is the mitigation
  // for build sessions where the side panel fails to auto-show after loading a
  // session: the user can always force it open. Reset per session below.
  const [forceSidePanelOpen, setForceSidePanelOpen] = useState<boolean | null>(null);

  // Extract sessionId from optional catch-all route: [[...sessionId]]
  const urlSessionId = Array.isArray(params.sessionId)
    ? params.sessionId[0]
    : undefined;

  // -- Orchestration store --
  const activeSessionId = useOrchestrationStore((s) => s.activeSessionId);
  const sessions = useOrchestrationStore((s) => s.sessions);
  const showWizard = useOrchestrationStore((s) => s.showWizard);
  const executionOptions = useOrchestrationStore((s) => s.executionOptions);
  const pendingAttachments = useOrchestrationStore((s) => s.pendingAttachments);
  const messages = useOrchestrationStore((s) =>
    activeSessionId ? s.messages[activeSessionId] : undefined
  );

  const sidePanelState = useOrchestrationStore((s) => s.sidePanelState);
  const setSidePanelState = useOrchestrationStore((s) => s.setSidePanelState);
  const createSession = useOrchestrationStore((s) => s.createSession);
  const initializeBuilderSession = useOrchestrationStore((s) => s.initializeBuilderSession);
  const clearAttachments = useOrchestrationStore((s) => s.clearAttachments);
  const setSidePanelTab = useOrchestrationStore((s) => s.setSidePanelTab);

  const pendingDelegation = useOrchestrationStore((s) => s.pendingDelegation);
  const setPendingDelegation = useOrchestrationStore((s) => s.setPendingDelegation);
  const addMessage = useOrchestrationStore((s) => s.addMessage);
  const setActiveIntegrationBuild = useOrchestrationStore((s) => s.setActiveIntegrationBuild);
  const activeIntegrationBuilds = useOrchestrationStore((s) => s.activeIntegrationBuilds);
  const markIntegrationBuildReady = useOrchestrationStore((s) => s.markIntegrationBuildReady);

  const showExampleCards = useSettingsStore((s) => s.settings.chat.showExampleCards);
  // Language source = the i18n store (the language shown in the header and used by
  // the chat-agent via connection.getCurrentLanguage). The settings store's
  // general.language defaults to 'en' and is NOT kept in sync, so reading it here
  // made status text + build language render English while the agent replied in PT.
  const language = useI18nStore((s) => s.language);
  const guidedMode = useSettingsStore((s) => s.settings.chat.guidedMode ?? true);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const { common, chatPanel, emptyState, onboarding, language: uiLanguage } = useTranslation();
  const sessionJobs = useOrchestrationStore((s) => s.sessionJobs);
  const sessionPreviews = useOrchestrationStore((s) => s.sessionPreviews);

  const { execute, cancel, retry: retryBuild, execTraceRef } = useAgentExecution(activeSessionId);
  const isExecuting = useOrchestrationStore((s) => s.isExecuting);
  const setIsExecutingStore = useOrchestrationStore((s) => s.setIsExecuting);
  const appendStreamingChat = useOrchestrationStore((s) => s.appendStreamingChat);
  const flushStreamingChat = useOrchestrationStore((s) => s.flushStreamingChat);
  const clearStreamingChat = useOrchestrationStore((s) => s.clearStreamingChat);
  const setActivityMessage = useOrchestrationStore((s) => s.setActivityMessage);
  const enqueueMessage = useOrchestrationStore((s) => s.enqueueMessage);
  const drainQueue = useOrchestrationStore((s) => s.drainQueue);
  const clearQueue = useOrchestrationStore((s) => s.clearQueue);
  const popLastUserTurn = useOrchestrationStore((s) => s.popLastUserTurn);
  const setComposerDraft = useOrchestrationStore((s) => s.setComposerDraft);
  const composerDraftForSession = useOrchestrationStore((s) =>
    activeSessionId ? s.composerDraft[activeSessionId] : undefined
  );

  // -- Input state (purely local) --
  const [chatInput, setChatInput] = useState("");
  const [promptStripCollapsed, setPromptStripCollapsed] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const chatActivityThrottleRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const urlPopoverRef = useRef<HTMLDivElement>(null);
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

  const addAttachment = useOrchestrationStore((s) => s.addAttachment);
  const removeAttachment = useOrchestrationStore((s) => s.removeAttachment);

  // -- Integration mode removed (Phase 4) --

  // ========================================
  // INITIALIZATION + URL SYNC
  // ========================================

  const [sessionsInitialized, setSessionsInitialized] = useState(false);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Tracks the urlSessionId we last activated/handled. Keyed by value (not a
  // one-shot boolean) so client-side navigation between sessions — e.g. tapping
  // a different "Continua onde paraste" card without a full reload — re-runs the
  // activation. A boolean guard here previously stuck after the first nav, so
  // subsequent card taps "did nothing until refresh".
  const lastActivatedSessionRef = useRef<string | null>(null);
  const loadingStartTimeRef = useRef(Date.now());

  useEffect(() => {
    loadingStartTimeRef.current = Date.now();
    initializeBuilderSession().then(() => {
      const elapsed = Date.now() - loadingStartTimeRef.current;
      const remaining = Math.max(0, 600 - elapsed);
      setTimeout(() => {
        setSessionsInitialized(true);
        setShowLoadingScreen(false);
      }, remaining);
    });
  }, [initializeBuilderSession]);

  // Safety net: load messages for the active session whenever they are undefined.
  // initializeBuilderSession sets activeSessionId directly (via set()) without going
  // through setActiveSession, so the load must also be triggered here.
  useEffect(() => {
    if (!sessionsInitialized || !activeSessionId || messages !== undefined) return;
    useOrchestrationStore.getState().loadSessionMessages(activeSessionId);
  }, [sessionsInitialized, activeSessionId, messages]);

  // URL -> Store: activate session from URL after sessions are loaded. Keyed by
  // the urlSessionId VALUE (not a one-shot boolean) so client-side navigation
  // between sessions — tapping a different "Continua onde paraste" card, a deep
  // link — re-runs activation. The previous one-shot boolean guard stuck after
  // the first nav, so later card taps "did nothing until refresh". The session
  // list activates via setActiveSession + replaceState (no Next route change),
  // so it never alters urlSessionId and is unaffected by this effect.
  useEffect(() => {
    if (!sessionsInitialized || !urlSessionId) return;
    if (lastActivatedSessionRef.current === urlSessionId) return;

    const store = useOrchestrationStore.getState();
    const sessionExists = store.sessions.some((s) => s.id === urlSessionId);
    lastActivatedSessionRef.current = urlSessionId;
    if (sessionExists) {
      // setActiveSession also promotes the global side-panel state to 'build'
      // for artifact-linked sessions, so we call it even when the URL already
      // matches the active session (a deep link) — else the panel stays collapsed.
      store.setActiveSession(urlSessionId);
      // Ensure side panel can show preview + files when activating via URL on
      // a fresh browser. initializeBuilderSession already seeds sessionJobs
      // from artifacts during its sweep, but a direct URL hit can race that
      // for a session not yet in the cleanup pass — fall back here.
      store.hydrateSessionFromArtifact(urlSessionId).then((hydrated) => {
        if (hydrated) store.setSidePanelTab("preview");
      });
    } else {
      router.replace("/chat");
    }
  }, [sessionsInitialized, urlSessionId, router]);

  // ?continue=<artifactInstanceId> — single-link recovery entry for "Continue
  // Working" without going through the artifacts page. Used to hand someone a
  // URL that restores their build context after they lost the session in the UI.
  const hasHandledContinueParam = useRef(false);
  useEffect(() => {
    if (hasHandledContinueParam.current) return;
    if (!sessionsInitialized) return;
    const artifactId = searchParams.get("continue");
    if (!artifactId) return;
    hasHandledContinueParam.current = true;

    (async () => {
      const store = useOrchestrationStore.getState();
      try {
        const resp = await api.getArtifactInstance(artifactId);
        if (!resp.success || !resp.data) {
          router.replace("/chat");
          return;
        }
        const artifact = resp.data as {
          id: string;
          slug?: string;
          data?: { sessionId?: string; projectDir?: string; appUrl?: string };
        };
        const artifactSessionId = artifact.data?.sessionId;

        // Pick (or create) the target session: prefer the artifact's recorded
        // sessionId if it still exists on backend, otherwise create a fresh one
        // and re-link the artifact so future loads find it.
        let targetSessionId: string | null = null;
        const sessionExists = artifactSessionId
          && store.sessions.some((s) => s.id === artifactSessionId);
        if (sessionExists) {
          targetSessionId = artifactSessionId!;
        } else {
          const newId = await store.createSession();
          targetSessionId = newId;
          await api.wsAction("ekoa.templates", "update-instance", {
            id: artifact.id,
            data: {
              sessionId: newId,
              projectDir: artifact.data?.projectDir,
              appUrl: artifact.data?.appUrl,
            },
          }).catch(() => {});
        }

        if (!targetSessionId) {
          router.replace("/chat");
          return;
        }

        store.setActiveSession(targetSessionId);
        store.setSessionJob(targetSessionId, {
          artifactInstanceId: artifact.id,
          projectPath: artifact.data?.projectDir ?? null,
          slug: artifact.slug ?? null,
          status: "completed",
        });
        if (artifact.data?.appUrl) {
          store.setSessionPreview(targetSessionId, {
            appUrl: artifact.data.appUrl,
            status: "running",
          });
        }
        store.setSidePanelState("build");
        store.resetWizard();
        await store.loadSessionMessages(targetSessionId);
        router.replace(`/chat/${targetSessionId}`);
      } catch {
        router.replace("/chat");
      }
    })();
  }, [sessionsInitialized, searchParams, router]);

  // ?featured=<featuredArtifactId> — pre-seeds the orchestrator with the
  // featured artifact's base, so the user lands in an empty chat ready to
  // describe customisations. The orchestrator's `seed-featured` intent reads
  // the artifact's typeId (which is the base id, per the migration) and
  // stores it on the session.
  const hasHandledFeaturedParam = useRef(false);
  useEffect(() => {
    if (hasHandledFeaturedParam.current) return;
    if (!sessionsInitialized) return;
    const featuredId = searchParams.get("featured");
    if (!featuredId) return;
    hasHandledFeaturedParam.current = true;

    (async () => {
      const store = useOrchestrationStore.getState();
      try {
        let sid = store.activeSessionId;
        if (!sid) sid = await store.createSession();
        if (!sid) {
          router.replace("/chat");
          return;
        }
        store.setActiveSession(sid);
        await api.wsAction("ekoa.orchestrator", "seed-featured", {
          sessionId: sid,
          featuredArtifactId: featuredId,
        }).catch(() => {});
        store.setSidePanelState("build");
        router.replace(`/chat/${sid}`);
      } catch {
        router.replace("/chat");
      }
    })();
  }, [sessionsInitialized, searchParams, router]);

  // Store -> URL: sync activeSessionId to URL bar (shallow, no Next.js navigation)
  // Only show session ID in URL when the session has content. "Content" is
  // either chat messages OR an attached artifact (artifact-linked sessions
  // hold a built app whose preview + files are the content, even when the
  // message log is empty — e.g. forks created from "Continua onde paraste").
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeJob = activeSessionId ? sessionJobs[activeSessionId] : null;
  const activePreview = activeSessionId ? sessionPreviews[activeSessionId] : null;
  // Onboarding sessions render a guided welcome even before the first message,
  // so an empty one is still "content" - keep its id in the URL (the welcome +
  // chips ARE the surface, like an artifact-linked session).
  const isOnboardingSession = activeSession?.type === "onboarding";
  const keepsSessionUrl = !!activeSession && (
    activeSession.messageCount > 0 ||
    !!activeJob?.artifactInstanceId ||
    !!activePreview?.appUrl ||
    isOnboardingSession
  );

  useEffect(() => {
    if (!activeSessionId) return;
    // Skip the URL normalization while a single-shot recovery flow is mid-flight
    // (?continue= or ?featured=). Stripping those params here would race the
    // handlers that need to read them after sessionsInitialized flips.
    if (searchParams.has("reinterview") || searchParams.has("continue") || searchParams.has("featured")) return;

    if (keepsSessionUrl) {
      const target = `/chat/${activeSessionId}`;
      if (window.location.pathname !== target) {
        window.history.replaceState(null, "", target);
      }
    } else {
      // Empty session: URL should be /chat
      if (window.location.pathname !== "/chat") {
        window.history.replaceState(null, "", "/chat");
      }
    }
  }, [activeSessionId, keepsSessionUrl, searchParams]);

  // Handle re-interview context from artifacts Change button
  useEffect(() => {
    if (hasHandledReinterview.current) return;
    const reinterviewParam = searchParams.get("reinterview");
    const artifactName = searchParams.get("artifactName");
    if (!reinterviewParam || !activeSessionId) return;

    hasHandledReinterview.current = true;
    const items = reinterviewParam.split(",").filter(Boolean);

    // Add a context divider message
    const itemWord = language === "pt"
      ? (items.length === 1 ? "item" : "itens")
      : (items.length === 1 ? "item" : "items");
    addMessage(activeSessionId, {
      role: "system",
      content: language === "pt"
        ? `A atualizar: ${artifactName || "artefacto"} -- a rever ${items.length} ${itemWord} de configuração: ${items.join(", ")}`
        : `Updating: ${artifactName || "artifact"} -- re-answering ${items.length} configuration ${itemWord}: ${items.join(", ")}`,
      metadata: {
        type: "status",
        isEssential: true,
      },
    });

    // Clean URL params, preserving session ID
    const cleanPath = activeSessionId ? `/chat/${activeSessionId}` : "/chat";
    window.history.replaceState({}, "", cleanPath);
  }, [searchParams, activeSessionId, addMessage, language]);

  // ?mode=integrate removed in Phase 4 — integrate mode no longer exists.

  // Note: the templates page now orchestrates the session + template binding
  // before navigating here, so there's no ?template=<id> param to consume.

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

  // Reset prompt strip collapse state when switching sessions so new sessions start expanded
  useEffect(() => {
    setPromptStripCollapsed(false);
    // Each session starts following the auto side-panel signal again; the user's
    // manual force-open/closed shouldn't leak across navigation.
    setForceSidePanelOpen(null);
  }, [activeSessionId]);

  // Note: orchestration store messages are loaded by loadSessionMessages
  // (see effect above), and ChatPanel auto-scrolls on its own.

  // ========================================
  // DELEGATION HANDLER (from old builder page)
  // ========================================

  useEffect(() => {
    if (!pendingDelegation || !activeSessionId || isExecuting) return;

    const { description, templateId } = pendingDelegation;
    setPendingDelegation(null);
    setSidePanelState("build");
    setSidePanelTab("files");
    // Note: forceSidePanelOpen is already null here (a delegate only fires on the
    // first chat→build hand-off, before the panel ever showed). handleBuildFirstMessage
    // / handleBuildSendMessage re-arm auto-open for the paths where it can be stale.

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
  // EMPTY STATE DETECTION
  // ========================================

  const hasMessages = (() => {
    // Unified: every session reads from orchestration store messages.
    const essentialMessages = (messages || []).filter((msg) => {
      if (msg.role === "user") return true;
      if (!msg.metadata) return true;
      return msg.metadata.isEssential === true;
    });
    return essentialMessages.length > 0;
  })();

  // messages[sessionId] starts as undefined (not persisted) and is populated
  // asynchronously by loadSessionMessages. Treat undefined as "still loading"
  // so we don't flash the empty state before the fetch completes.
  const messagesReady = messages !== undefined;
  // Artifact-linked sessions never show the "Continua onde paraste" empty
  // state — even with zero chat messages, the attached app + preview ARE the
  // content the user came to see. Fall through to the active-conversation
  // branch which renders ChatPanel + SidePanel.
  const hasArtifactContext = !!(
    activeSessionId &&
    (sessionJobs[activeSessionId]?.artifactInstanceId ||
      sessionPreviews[activeSessionId]?.appUrl)
  );
  const showEmptyState =
    !hasMessages && messagesReady && !showWizard && !isExecuting && !hasArtifactContext;

  // ========================================
  // ATTACH FILE / FOLDER HANDLERS
  // ========================================

  // Close attach menu on outside click
  useEffect(() => {
    if (!showAttachMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAttachMenu]);

  const handleAttachFile = useCallback(async () => {
    setShowAttachMenu(false);
    const { pickFiles } = await import("@/lib/file-picker");
    const files = await pickFiles();
    for (const f of files) addAttachment(f);
  }, [addAttachment]);

  const handleAttachFolder = useCallback(async () => {
    setShowAttachMenu(false);
    const { pickFolder } = await import("@/lib/file-picker");
    const folder = await pickFolder();
    if (folder) addAttachment(folder);
  }, [addAttachment]);

  const handleCaptureScreen = useCallback(async () => {
    const { captureScreen } = await import("@/lib/file-picker");
    const att = await captureScreen();
    if (att) addAttachment(att);
  }, [addAttachment]);

  const handleSubmitUrl = useCallback(async () => {
    const raw = urlInputValue.trim();
    if (!raw) return;
    // Tolerate input without scheme — assume https.
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const { makeUrlAttachment } = await import("@/lib/file-picker");
    addAttachment(makeUrlAttachment(url));
    setUrlInputValue("");
    setShowUrlInput(false);
  }, [urlInputValue, addAttachment]);

  // ========================================
  // HANDLE PROMPT SELECTION FROM EMPTY STATE
  // ========================================

  // ========================================
  // BUILD MODE HANDLERS (from old builder page)
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
      // `overrides`; fall back to executionOptions when called from a
      // template-card click that pre-populated the store.
      //
      // We set sidePanelState='build' explicitly here: the orchestrator
      // phase_changed signal only fires for paths that call setOrchestratorState
      // (gather intent, in-build classifier), but the chat-agent → build_intent
      // → execute() path doesn't transition the orchestrator state, so without
      // this the side panel stays hidden for the entire first build.
      setSidePanelState("build");
      setSidePanelTab("preview");
      // A new build re-arms auto-open: clear any stale manual-close from earlier
      // in this session so the panel reveals for this build.
      setForceSidePanelOpen(null);
      // Drop URL attachments here — they were already prepended to the message
      // text by handleSendMessage. Only file/folder atts go through execute().
      const attachments = pendingAttachments.filter((a) => a.type !== "url");
      const templateId = overrides?.templateId || executionOptions.selectedTemplateId || undefined;
      const integrationKeys = executionOptions.selectedIntegrationKeys.length > 0
        ? executionOptions.selectedIntegrationKeys
        : undefined;
      execute(message, {
        templateId,
        integrationKeys,
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
      executionOptions.selectedTemplateId,
      executionOptions.selectedIntegrationKeys,
      setSidePanelState,
      setSidePanelTab,
      clearAttachments,
      language,
    ]
  );

  // Follow-up messages in Build mode -- reuse existing artifact. Declared above
  // the build_intent listener so that listener can route follow-up edits here.
  const handleBuildSendMessage = useCallback(
    (message: string, opts?: { skipUserMessage?: boolean }) => {
      if (!activeSessionId) return;

      setSidePanelState("build");
      setSidePanelTab("preview");
      setForceSidePanelOpen(null);

      // Pass existing artifact context so the backend modifies it instead of creating new
      const currentJob = sessionJobs[activeSessionId];
      const artifactInstanceId = currentJob?.artifactInstanceId || undefined;
      const projectPath = currentJob?.projectPath || undefined;

      // URL atts were already prepended to the message text by handleSendMessage.
      const fileAtts = pendingAttachments.filter((a) => a.type !== "url");

      execute(message, {
        attachments:
          fileAtts.length > 0 ? fileAtts : undefined,
        language,
        artifactInstanceId: artifactInstanceId ?? undefined,
        projectPath: projectPath ?? undefined,
        // When a build_intent redirect drives this (the user's message is
        // already in the onboarding thread), don't let execute() re-add it.
        _skipUserMessage: opts?.skipUserMessage,
      });

      clearAttachments();
    },
    [activeSessionId, pendingAttachments, execute, setSidePanelState, setSidePanelTab, clearAttachments, sessionJobs, language]
  );

  // Server-side build intent safety net: listen for build_intent SSE events.
  // When the chat agent detects build intent that the local classifier missed,
  // it emits <ekoa-build-redirect/> which the server converts to a build_intent event.
  // Prior conversation already lives in the orchestration store (unified) - no
  // message migration needed; we just stop the chat-agent stream and kick the
  // build pipeline with the original message.
  const buildIntentHandledRef = useRef(false);
  useEffect(() => {
    buildIntentHandledRef.current = false;

    const conn = getConnection();
    const unsub = conn.on("build_intent", (event) => {
      const originalMessage = (event.original_message as string) || "";
      if (!originalMessage || buildIntentHandledRef.current) return;
      // Origin filter: build_intent is broadcast to EVERY connected client of
      // the user (other tabs, other browsers). Only the tab that sent the
      // chat turn may kick the build — without this, each open tab fired its
      // own execute-job (observed: three identical concurrent builds, all
      // writing the same project directory, for one message).
      const originTraceId = String((event as Record<string, unknown>).trace_id || "");
      if (!originTraceId || originTraceId !== chatTraceIdRef.current) return;
      buildIntentHandledRef.current = true;

      if (chatStreamCleanupRef.current) {
        chatStreamCleanupRef.current();
      }

      // Drop any partial streamed text so the build-started state is clean.
      const sid = useOrchestrationStore.getState().activeSessionId;
      if (sid) clearStreamingChat(sid);

      // Forward the chat-agent's template choice to the build pipeline.
      const templateId = (event.template_id as string | undefined) || undefined;

      if (sid) {
        addMessage(sid, {
          role: "system",
          content: language === "pt"
            ? "A iniciar a construção..."
            : "Starting the build…",
          metadata: { type: "status", isEssential: true },
        });
      }

      // From inside a conversation that already has a bound artifact (e.g. an
      // onboarding session mid-flow), a redirect with NO template_id is a
      // follow-up EDIT of that artifact - route it to the edit path so we don't
      // mint a brand-new artifact. A redirect WITH a template_id is the agent
      // proposing a NEW catalog build, so scaffold fresh.
      const boundArtifact = sid
        ? useOrchestrationStore.getState().sessionJobs[sid]?.artifactInstanceId
        : null;
      if (!templateId && boundArtifact) {
        handleBuildSendMessage(originalMessage, { skipUserMessage: true });
      } else {
        handleBuildFirstMessage(originalMessage, { templateId, skipUserMessage: true });
      }
    });

    return unsub;
  }, [handleBuildFirstMessage, handleBuildSendMessage, addMessage, clearStreamingChat, language]);

  // R2 — chat_answer subscription. The in-build classifier emits this event
  // when the user's mid-build message is a question, ambiguous, or a meta
  // action that the orchestrator handled inline. We append the answer to the
  // active session's chat thread without flipping into building state.
  useEffect(() => {
    const conn = getConnection();
    const unsub = conn.on("chat_answer", (event) => {
      const sid = useOrchestrationStore.getState().activeSessionId;
      if (!sid) return;
      // Drop answers for runs the user Stopped — the in-build classifier may have
      // finished server-side before the cancel landed; this is the guarantee that
      // a clarification never appears after Stop (Image #9).
      const tid = String((event as Record<string, unknown>).trace_id || "");
      if (tid && cancelledTracesRef.current.has(tid)) {
        cancelledTracesRef.current.delete(tid);
        return;
      }
      const text = String((event as Record<string, unknown>).text || "");
      if (!text) return;
      const intent = (event as Record<string, unknown>).intent as string | undefined;
      const store = useOrchestrationStore.getState();
      store.addMessage(sid, {
        role: "assistant",
        content: intent ? `${text}` : text,
        metadata: {
          isEssential: true,
          type: "text",
        },
      });
    });
    return unsub;
  }, [activeSessionId]);

  // Integration build intent — chat-agent emits <ekoa-integration-build-redirect/>,
  // server converts to integration_build_intent SSE. Switch the side panel to
  // the integration builder for this chat session.
  useEffect(() => {
    const conn = getConnection();
    const unsub = conn.on("integration_build_intent", (event) => {
      const sid = useOrchestrationStore.getState().activeSessionId;
      if (!sid) return;
      const integrationKey = String((event as Record<string, unknown>).integration_key || "");
      const integrationLabel = (event as Record<string, unknown>).integration_label as string | undefined;
      if (!integrationKey) return;

      setActiveIntegrationBuild(sid, {
        key: integrationKey,
        label: integrationLabel,
      });
      setSidePanelState("integrate");
      addMessage(sid, {
        role: "system",
        content: language === "pt"
          ? `A construir a integração ${integrationLabel || integrationKey}...`
          : `Building the ${integrationLabel || integrationKey} integration...`,
        metadata: { isEssential: true, type: "status" },
      });
    });
    return unsub;
  }, [activeSessionId, setActiveIntegrationBuild, setSidePanelState, addMessage, language]);

  // Orchestrator phase transitions — canonical signal for side-panel state.
  // The backend (cortex/src/services/orchestrator.ts) broadcasts phase_changed
  // whenever the persisted phase actually transitions. Map:
  //   building / built                       → side panel 'build'
  //   gathering / resolving-integrations
  //     (no integration_build_intent active) → side panel 'none'
  // integration_build_intent / integration_ready listeners (above/below) own
  // the 'integrate' transitions independently.
  useEffect(() => {
    const conn = getConnection();
    const unsub = conn.on("phase_changed", (event) => {
      const sid = useOrchestrationStore.getState().activeSessionId;
      if (!sid) return;
      const currentPhase = String((event as Record<string, unknown>).current || "");
      const currentSidePanel = useOrchestrationStore.getState().sidePanelState;
      const executing = useOrchestrationStore.getState().isExecuting;
      if (currentPhase === "building" || currentPhase === "built") {
        if (currentSidePanel !== "build") setSidePanelState("build");
      } else if (currentPhase === "gathering" || currentPhase === "idle") {
        // Don't clobber 'integrate' — integration listeners drive that. And don't
        // close mid-build: a stale "gathering" can arrive while a delegated build
        // is already running — only honor it when nothing is executing.
        if (currentSidePanel === "build" && !executing) setSidePanelState("none");
      }
    });
    return unsub;
  }, [activeSessionId, setSidePanelState]);

  // Integration ready — the integration-builder backend emits this on save.
  // Ask the user whether to wire the integration into the app. The user's
  // reply (yes) triggers the chat-agent to continue with the integration in
  // its catalog (next coding-agent invocation picks it up via the registry).
  useEffect(() => {
    const conn = getConnection();
    const unsub = conn.on("integration_ready", (event) => {
      const sid = useOrchestrationStore.getState().activeSessionId;
      if (!sid) return;
      const integrationKey = String((event as Record<string, unknown>).integration_key || "");
      const integrationLabel = (event as Record<string, unknown>).integration_label as string | undefined;
      if (!integrationKey) return;

      markIntegrationBuildReady(sid);
      // Flip the side panel back to the builder tabs (Files/Output/Preview)
      // now that the integration build completed.
      setSidePanelState("build");
      setSidePanelTab("preview");
      // Clear the active integration build now that the side-panel has switched.
      setActiveIntegrationBuild(sid, null);

      addMessage(sid, {
        role: "assistant",
        content: language === "pt"
          ? `A integração ${integrationLabel || integrationKey} está pronta. Queres que a adicione à tua app agora?`
          : `The ${integrationLabel || integrationKey} integration is ready. Want me to add it to your app now?`,
        metadata: { isEssential: true, type: "text" },
      });
    });
    return unsub;
  }, [
    activeSessionId,
    markIntegrationBuildReady,
    setSidePanelState,
    setSidePanelTab,
    setActiveIntegrationBuild,
    addMessage,
    language,
  ]);

  // Handle prompt selection from empty state cards. The promptCategory argument
  // is informational only — the unified send router decides routing based on
  // session data, not on a mode flag. We pre-fill the input for chat-style
  // prompts so the user can review/edit before sending, and dispatch
  // immediately for build-style prompts (legacy convenience).
  const handleSelectPrompt = useCallback(
    (prompt: string, promptCategory: 'chat' | 'build' | 'integrate') => {
      if (promptCategory === "chat") {
        setChatInput(prompt);
        setTimeout(() => textareaRef.current?.focus(), 100);
      } else {
        handleBuildFirstMessage(prompt);
      }
    },
    [handleBuildFirstMessage]
  );

  // Focus the empty-state composer without sending - used by the onboarding
  // welcome's "in my own words" chip.
  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // ========================================
  // CHAT-AGENT STREAM HANDLER
  // ========================================
  // Free-form messages (no artifact attached yet) go through the chat-agent
  // via cortex's /api/v1/request endpoint. Streams responses into the
  // orchestration store (same path the coding-agent uses for builds), so the
  // unified ChatPanel renders them without knowing or caring which agent is
  // talking.

  const handleChatSend = useCallback(async (textArg?: string) => {
    const text = (textArg ?? chatInput).trim();
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

    // 1. User message → orchestration store (also persists server-side).
    addMessage(sessionId, {
      role: "user",
      content: text,
      metadata: attachmentsForMessage ? { attachments: attachmentsForMessage } : undefined,
    });
    setChatInput("");
    setIsExecutingStore(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Reset any prior streaming buffer for this session.
    clearStreamingChat(sessionId);

    try {
      const conn = getConnection();
      const metadata: Record<string, unknown> = {};
      if (pendingAttachments.length > 0) {
        metadata.attachments = pendingAttachments.map((a) => ({
          attachmentId: a.attachmentId,
          displayName: a.displayName,
          path: a.path,
          type: a.type,
        }));
        clearAttachments();
      }
      const traceId = conn.sendRequest(text, sessionId, { metadata });
      chatTraceIdRef.current = traceId;

      const finishStream = (unsub: () => void) => {
        unsub();
        setIsExecutingStore(false);
        setActivityMessage(sessionId!, null);
        chatStreamCleanupRef.current = null;
        chatTraceIdRef.current = null;
      };

      const unsubStream = conn.onStream((event) => {
        if (event.trace_id !== traceId) return;

        if (event.type === "stream") {
          const chunk = String(event.text || event.content || event.delta || "");
          if (chunk) appendStreamingChat(sessionId!, chunk);
        }

        if (event.type === "tool_event") {
          const toolEvent = (event.event || event.status) as string;
          const toolName = (event.tool || event.name) as string;
          const args = (event.args || {}) as Record<string, unknown>;
          if (toolEvent === "tool_called" || toolEvent === "tool_started") {
            const now = Date.now();
            if (now - chatActivityThrottleRef.current >= 2000) {
              chatActivityThrottleRef.current = now;
              setActivityMessage(sessionId!, getFriendlyToolActivityBrief(toolName, args));
            }
          }
        }

        if (event.type === "subagent_event") {
          const agent = ((event.agent || event.name || event.task_id || "agent") as string);
          const subEvent = ((event.event || event.status) as string);
          const description = event.description as string | undefined;
          const summary = (event.summary || event.result) as string | undefined;
          setActivityMessage(sessionId!, getFriendlySubagentMessage(agent, subEvent, description || summary));
        }

        if (event.type === "skill_event") {
          const skill = ((event.skill || event.name || "skill") as string);
          const action = ((event.action || event.event) as string);
          if (action === "invoked" || action === "used") {
            setActivityMessage(sessionId!, getFriendlySkillMessage(skill));
          }
        }

        if (event.type === "complete") {
          finishStream(unsubStream);

          // Handle delegation BEFORE flushing — if the chat-agent delegated
          // to a build, the build_intent listener has already migrated the
          // prior conversation; we skip the assistant message append.
          const delegate = (event as Record<string, unknown>).delegate as
            | {
                agent: string;
                description: string;
                templateId: string | null;
                skipWizard: boolean;
              }
            | undefined;
          if (delegate) {
            clearStreamingChat(sessionId!);
            setPendingDelegation({
              description: delegate.description,
              templateId: delegate.templateId,
            });
            return;
          }

          // Flush streaming buffer + persist the final assistant turn.
          const buffered = flushStreamingChat(sessionId!);
          // Defence-in-depth: never render raw provider/engine error text as the
          // assistant message (backend already strips this; this catches replays
          // / any bypass). Pass through normal responses unchanged.
          const finalContent = sanitizeUserFacingError(
            String(event.result || event.content || buffered || "No response received."),
            language
          );
          addMessage(sessionId!, {
            role: "assistant",
            content: finalContent,
            metadata: { isEssential: true, type: "text" },
          });
        }

        if (event.type === "error") {
          finishStream(unsubStream);
          clearStreamingChat(sessionId!);
          const rawError = (event as Record<string, unknown>).error as string | undefined;
          // Strip any provider/engine leak; fall back to a generic branded message.
          const errorText = rawError
            ? sanitizeUserFacingError(rawError, language)
            : language === "pt"
              ? "Algo correu mal. Por favor tente novamente."
              : "Something went wrong. Please try again.";
          addMessage(sessionId!, {
            role: "system",
            content: errorText,
            metadata: { isEssential: true, type: "status" },
          });
        }
      });

      // Register the stop handle immediately — not inside the stream callback —
      // so the Stop button works even before the first event arrives (during
      // routing/pre-stream). Previously this was assigned in the callback, so
      // stopping early was a silent no-op (the "stopping not working" bug).
      chatStreamCleanupRef.current = () => {
        unsubStream();
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
        role: "system",
        content: language === "pt"
          ? "Algo correu mal. Por favor tente novamente."
          : "Something went wrong. Please try again.",
        metadata: { isEssential: true, type: "status" },
      });
    }
  }, [
    chatInput,
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

  const sessionJob = activeSessionId ? sessionJobs[activeSessionId] : null;
  const sessionPreview = activeSessionId ? sessionPreviews[activeSessionId] : null;
  const sessionArtifactId =
    sessionJob?.artifactInstanceId ?? null;
  const isBuildSession =
    sessionArtifactId !== null ||
    sessionPreview?.templateId != null ||
    !!sessionPreview?.appUrl;
  const sessionHasJob = sessionJob?.jobId != null;
  const activeIntegrationBuild = activeSessionId
    ? activeIntegrationBuilds[activeSessionId]
    : null;
  // sidePanelState is global; gate visibility on what the current session
  // actually has so it doesn't leak across navigation. Build needs a job or
  // artifact; integrate needs an active integration build for this session.
  // `isExecuting` is included so the panel auto-opens the instant a delegated
  // build starts (before the jobId lands) — gated on sidePanelState==='build'
  // so a chat-only stream doesn't render a dead empty panel.
  const showSidePanel =
    (sidePanelState === "build" && (isBuildSession || sessionHasJob || isExecuting)) ||
    (sidePanelState === "integrate" && activeIntegrationBuild != null);

  // The desktop side panel honors the user's manual override when set, otherwise
  // follows the auto signal. forceSidePanelOpen===false (user closed it) wins over
  // the auto signal; a NEW build resets it to null so the panel re-opens.
  const sidePanelVisible = forceSidePanelOpen ?? showSidePanel;

  const handleSendMessage = useCallback(
    (textArg?: string) => {
      const rawText = (textArg ?? chatInput).trim();
      if (!rawText) return;

      // Queue-while-building: don't reject messages sent during an active run.
      // Queue them and flush (FIFO) when the run finishes. The flush effect calls
      // this same function once isExecuting is false, so this guard won't loop.
      if (isExecuting) {
        if (activeSessionId) {
          enqueueMessage(activeSessionId, rawText);
          setChatInput("");
        }
        return;
      }

      // URL attachments are not real files — append them to the message body so
      // the agent's WebFetch tool can reach them. File/folder attachments
      // continue through the regular attachments pipeline.
      const urlAtts = pendingAttachments.filter((a) => a.type === "url");
      const refsLabel = language === "pt" ? "Referências" : "References";
      const text = urlAtts.length > 0
        ? `${rawText}\n\n${refsLabel}:\n${urlAtts.map((a) => `- ${a.path}`).join("\n")}`
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
              role: "assistant",
              content: `${onboarding.welcome.greeting}\n\n${onboarding.welcome.question}`,
              metadata: { isEssential: true },
            });
          }
        }
        // setChatInput("") happens inside handleChatSend after it captures the value.
        handleChatSend(text);
      } else if (isBuildSession && (sessionHasJob || sessionArtifactId)) {
        // Follow-up edit of an existing artifact. `sessionArtifactId` (without a
        // jobId) is the "Continue working"/?continue= case: the session was
        // hydrated from a built/imported artifact but hasn't run a job in THIS
        // session yet. Routing it to the first-build path would scaffold a brand
        // new artifact instead of editing the existing one.
        setChatInput("");
        handleBuildSendMessage(text);
      } else if (isBuildSession) {
        setChatInput("");
        handleBuildFirstMessage(text);
      } else {
        // setChatInput("") happens inside handleChatSend after it captures the value.
        handleChatSend(text);
      }
    },
    [
      chatInput,
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
    if (drained.length > 0) handleSendMessage(drained.join("\n\n"));
  }, [isExecuting, activeSessionId, drainQueue, handleSendMessage]);

  // Restore a draft into the empty-state composer (e.g. after Stop). Only the
  // empty-state input lives here; ChatPanel consumes the draft for active
  // conversations. Gate on showEmptyState so only the mounted composer consumes.
  useEffect(() => {
    if (!activeSessionId || composerDraftForSession == null || !showEmptyState) return;
    setChatInput(composerDraftForSession);
    setComposerDraft(activeSessionId, undefined);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [activeSessionId, composerDraftForSession, showEmptyState, setComposerDraft]);

  // Auto-focus the URL input when its popover opens.
  useEffect(() => {
    if (showUrlInput) {
      // Wait for the input to mount before focusing.
      requestAnimationFrame(() => urlInputRef.current?.focus());
    }
  }, [showUrlInput]);

  // Close the URL popover on outside click (Escape is handled by the input itself).
  useEffect(() => {
    if (!showUrlInput) return;
    function onMouseDown(e: MouseEvent) {
      if (urlPopoverRef.current && !urlPopoverRef.current.contains(e.target as Node)) {
        setShowUrlInput(false);
        setUrlInputValue("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showUrlInput]);

  // Localized date strip ("SEXTA · 9 DE MAIO" / "FRIDAY · MAY 9") for the empty-state header.
  // Use the UI language from the i18n store (not the settings store, which can lag behind).
  const dateStrip = useMemo(() => {
    const intlLocale = uiLanguage === "pt" ? "pt-PT" : "en-US";
    try {
      const parts = new Intl.DateTimeFormat(intlLocale, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).formatToParts(new Date());
      const weekdayLong = parts.find((p) => p.type === "weekday")?.value ?? "";
      const day = parts.find((p) => p.type === "day")?.value ?? "";
      const month = parts.find((p) => p.type === "month")?.value ?? "";
      // pt-PT emits "sexta-feira" — keep only the first segment for "SEXTA".
      const weekday = weekdayLong.split("-")[0];
      const sep = uiLanguage === "pt" ? "de" : "";
      const date = sep ? `${day} ${sep} ${month}` : `${month} ${day}`;
      return `${weekday} · ${date}`.toUpperCase();
    } catch {
      return "";
    }
  }, [uiLanguage]);

  // Global keyboard shortcuts (scoped to this page via mount/unmount):
  //   Esc  → clear the compose textarea (when no modal/drawer is open)
  //   ⌘K   → toggle the sessions history drawer
  //   ⌘/   → toggle the shortcuts cheat-sheet modal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMobileSessionsOpen((o) => !o);
        return;
      }
      if (mod && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && !shortcutsOpen && !mobileSessionsOpen && !mobileSidePanelOpen) {
        // Don't interfere with the URL popover's own Escape handling.
        if (showUrlInput) return;
        if (chatInput.length > 0) {
          e.preventDefault();
          setChatInput("");
          textareaRef.current?.blur();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatInput, shortcutsOpen, mobileSessionsOpen, mobileSidePanelOpen, showUrlInput]);

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
    // Tell the server to abort the in-flight chat-agent request. Tearing down
    // the client SSE subscription alone left the server's SDK query running
    // (the "stopped but still processed / asks again" bug). Capture the trace
    // id BEFORE the cleanup closure nulls it.
    const chatTraceId = chatTraceIdRef.current;
    if (chatTraceId) {
      void getConnection().cancelRequest(chatTraceId);
    }
    // Abort the in-build classifier window too: it runs server-side BEFORE any
    // jobId exists, so cancel-job can't reach it. Cancel by the execute trace id
    // AND mark it cancelled so a chat_answer that races through is suppressed
    // client-side (Image #9: "stopped but still asked to confirm dates").
    const execTraceId = execTraceRef?.current;
    if (execTraceId) {
      cancelledTracesRef.current.add(execTraceId);
      void getConnection().cancelRequest(execTraceId);
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
    execTraceRef,
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
    if (removed != null) handleChatSend(removed);
  }, [activeSessionId, popLastUserTurn, handleChatSend]);

  // Pop the last user turn back into the composer for editing, without
  // resending it — reuses the same mechanism the Stop button uses (cancelActive).
  const handleEditLastUserMessage = useCallback(() => {
    const sid = activeSessionId;
    if (!sid) return;
    const removed = popLastUserTurn(sid);
    if (removed != null) setComposerDraft(sid, removed);
  }, [activeSessionId, popLastUserTurn, setComposerDraft]);

  function handleChatKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }

  function handleChatTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setChatInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  // ========================================
  // RENDER
  // ========================================

  if (showLoadingScreen) {
    return (
      <div className="relative flex flex-1 overflow-hidden">
        <ChatLoadingScreen visible={true} />
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:contents">
        <SessionsPanel
          isExpanded={isSessionsExpanded}
          onToggle={() => setIsSessionsExpanded(!isSessionsExpanded)}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {!messagesReady ? (
          /* Messages still loading from the store. */
          <div className="flex flex-1 items-center justify-center bg-white">
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 size={16} className="animate-spin" />
              {chatPanel.loadingMessages}
            </div>
          </div>
        ) : showEmptyState ? (
          /* ======================== EMPTY STATE (no messages yet) ========================
              Date strip + tagline header, single artifact stripe, compose box with
              Anexar/Captura/Cola URL, suggestion pills, and shortcuts footer.
              See mockups/Tela em branco.png.

              Empty state always takes the full width — sidePanelState may still
              be set from a prior build session, but with no messages there's
              nothing to preview, so we ignore it here. */
          <>
          <div className="flex flex-1 flex-col bg-white min-w-0">
            {/* Header + artifact stripe — centered single column. */}
            <div className="flex-1 overflow-y-auto px-4 md:px-8 py-10 md:py-14 scrollbar-light min-w-0">
              <div className="max-w-3xl mx-auto space-y-10">
                {isOnboardingSession ? (
                  /* Active onboarding session, no messages yet: guided welcome
                      bubble + quick-reply chips instead of the generic empty
                      state. Chips send through the same composer path below. */
                  <OnboardingWelcome
                    onSend={handleSendMessage}
                    onFocusComposer={focusComposer}
                  />
                ) : (
                  <>
                    <header className="text-center space-y-2">
                      {dateStrip && (
                        <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
                          {dateStrip}
                        </div>
                      )}
                      <AnimatedTagline className="text-2xl md:text-[28px] font-semibold text-neutral-900 leading-tight" />
                    </header>

                    <OnboardingCard />

                    <ChatStripes />
                  </>
                )}
              </div>
            </div>

            {/* Compose, pills, shortcut footer. */}
            <div className="p-3 md:p-4 border-t border-neutral-100 bg-white">
              <div className="max-w-3xl mx-auto space-y-3">
                <AttachmentChips attachments={pendingAttachments} onRemove={removeAttachment} />

                <div className="relative flex flex-col bg-white border border-neutral-300 rounded-2xl focus-within:border-teal-600 focus-within:ring-1 focus-within:ring-teal-600/20 transition-shadow shadow-sm">
                  <textarea
                    ref={textareaRef}
                    value={chatInput}
                    onChange={handleChatTextareaChange}
                    onKeyDown={handleChatKeyDown}
                    placeholder={chatPanel.placeholderBuild}
                    rows={1}
                    className="w-full max-h-40 min-h-[52px] py-3.5 px-4 bg-transparent resize-none outline-none text-sm text-neutral-800 placeholder-neutral-400 leading-relaxed rounded-t-2xl"
                  />
                  <div className="flex justify-between items-center px-3 py-2 border-t border-neutral-100">
                    <div className="flex items-center gap-1">
                      {/* Anexar (file/folder) */}
                      <div className="relative" ref={attachMenuRef}>
                        <button
                          onClick={() => setShowAttachMenu(!showAttachMenu)}
                          className="flex items-center gap-1.5 px-2 py-1 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 rounded-md transition-colors cursor-pointer"
                          title={emptyState.composeControls.attach}
                        >
                          <Paperclip size={14} />
                          <span className="hidden sm:inline">{emptyState.composeControls.attach}</span>
                        </button>
                        {showAttachMenu && (
                          <div className="absolute bottom-full left-0 mb-1 bg-white border border-neutral-200 rounded-lg shadow-lg py-1 min-w-[160px] z-50">
                            <button
                              onClick={handleAttachFile}
                              className="flex items-center w-full px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 transition-colors"
                            >
                              <File size={14} className="mr-2 text-neutral-400" />
                              {emptyState.composeControls.file}
                            </button>
                            <button
                              onClick={handleAttachFolder}
                              className="flex items-center w-full px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 transition-colors"
                            >
                              <FolderOpen size={14} className="mr-2 text-neutral-400" />
                              {emptyState.composeControls.folder}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Captura (screen capture) */}
                      <button
                        onClick={handleCaptureScreen}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 rounded-md transition-colors cursor-pointer"
                        title={emptyState.composeControls.capture}
                      >
                        <Camera size={14} />
                        <span className="hidden sm:inline">{emptyState.composeControls.capture}</span>
                      </button>

                      {/* Cola URL */}
                      <div className="relative" ref={urlPopoverRef}>
                        <button
                          onClick={() => setShowUrlInput((v) => !v)}
                          className="flex items-center gap-1.5 px-2 py-1 text-xs text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 rounded-md transition-colors cursor-pointer"
                          title={emptyState.composeControls.pasteUrl}
                        >
                          <LinkIcon size={14} />
                          <span className="hidden sm:inline">{emptyState.composeControls.pasteUrl}</span>
                        </button>
                        {showUrlInput && (
                          <div className="absolute bottom-full left-0 mb-1 bg-white border border-neutral-200 rounded-lg shadow-lg p-2 z-50 flex items-center gap-1.5 w-[280px]">
                            <input
                              ref={urlInputRef}
                              type="url"
                              value={urlInputValue}
                              onChange={(e) => setUrlInputValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void handleSubmitUrl();
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setShowUrlInput(false);
                                  setUrlInputValue("");
                                }
                              }}
                              placeholder={emptyState.composeControls.pasteUrlPlaceholder}
                              className="flex-1 min-w-0 px-2 py-1 text-xs border border-neutral-200 rounded outline-none focus:border-neutral-400"
                            />
                            <button
                              onClick={() => void handleSubmitUrl()}
                              disabled={!urlInputValue.trim()}
                              className="px-2 py-1 text-xs text-white bg-teal-600 hover:bg-teal-700 rounded disabled:bg-neutral-200 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                            >
                              {emptyState.composeControls.pasteUrlConfirm}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] text-neutral-300 hidden md:inline">
                        {chatPanel.shiftEnterHint}
                      </span>
                      {isExecuting ? (
                        <button
                          onClick={cancelActive}
                          className="p-1.5 rounded-lg transition-all text-white bg-red-500 hover:bg-red-600 cursor-pointer"
                          title={chatPanel.stop}
                        >
                          <Square size={14} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSendMessage()}
                          disabled={!chatInput.trim()}
                          className="p-1.5 transition-all disabled:text-neutral-300 disabled:cursor-not-allowed text-teal-600 hover:text-teal-700 cursor-pointer"
                        >
                          <Send size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {showExampleCards && (
                  <PromptSuggestionsStrip
                    mode="chat"
                    onSelectPrompt={handleSelectPrompt}
                    collapsed={promptStripCollapsed}
                    onToggleCollapsed={() => setPromptStripCollapsed((c) => !c)}
                  />
                )}

                {/* Keyboard hints only on devices that actually have one. */}
                <div className="hidden md:flex justify-center flex-wrap gap-x-6 gap-y-1 pt-1 text-[11px] text-neutral-400">
                  <span>{emptyState.shortcuts.close}</span>
                  <span>{emptyState.shortcuts.history}</span>
                  <span>{emptyState.shortcuts.shortcuts}</span>
                </div>
              </div>
            </div>
          </div>
          </>
        ) : (
          /* ======================== ACTIVE CONVERSATION ========================
              ChatPanel is the canonical message renderer for both chat-only Q&A
              and build sessions. It reads from orchestration store messages and
              handles streaming + activity uniformly.

              The side panel only renders for sessions that actually have a build
              attached. `sidePanelState` is shared across sessions; without this
              guard it'd leak (a chat-only session would render a dead SidePanel
              just because a prior build session left it open). */
          <>
            <div
              className={
                sidePanelVisible
                  ? "relative flex flex-col w-full md:w-[380px] md:min-w-[320px] md:max-w-[420px] shrink-0 h-full min-h-0"
                  : "relative flex flex-1 flex-col w-full h-full min-h-0"
              }
            >
              <ChatPanel
                sessionId={activeSessionId}
                isExecuting={isExecuting}
                isBuildSession={isBuildSession}
                onSendMessage={handleSendMessage}
                onCancel={cancelActive}
                onFirstMessage={handleSendMessage}
                onResend={isBuildSession ? retryBuild : retryChat}
                onEdit={handleEditLastUserMessage}
              />

              {/* Desktop side-panel OPEN button — only shown when the panel is
                  closed (when it's open the panel carries its own collapse
                  control, so this button is redundant). Anchored bottom-right,
                  ~10% up from the column bottom so it sits clear of the
                  composer's send/stop button. Only relevant for build sessions
                  (a chat-only session has nothing to show in the panel). */}
              {!isMobile && activeSessionId && !sidePanelVisible && (isBuildSession || sessionHasJob) && (
                <button
                  onClick={() => setForceSidePanelOpen(true)}
                  className="absolute bottom-[10%] right-4 z-40 w-12 h-12 bg-teal-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-teal-700 transition-colors"
                  title="Show files & preview"
                  aria-label="Open side panel"
                >
                  <PanelRight size={20} />
                </button>
              )}
            </div>

            {sidePanelVisible && activeSessionId && (
              <div className="hidden md:flex flex-1 min-w-0">
                <SidePanel sessionId={activeSessionId} onClose={() => setForceSidePanelOpen(false)} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile floating action buttons */}
      {isMobile && (
        <div className="fixed bottom-20 right-4 z-40 flex flex-col gap-2">
          {/* Side panel button — available whenever there's a conversation, not
              just build sessions. In a chat-only session it opens an empty panel,
              which is acceptable and mitigates the panel-not-showing race. */}
          {!showEmptyState && (
            <button
              onClick={() => setMobileSidePanelOpen(true)}
              className="w-12 h-12 bg-teal-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-teal-700 transition-colors"
              title="View Files & Preview"
              aria-label="Open side panel"
            >
              <PanelRight size={20} />
            </button>
          )}

          {/* Session history button */}
          <button
            onClick={() => setMobileSessionsOpen(true)}
            className="w-12 h-12 bg-neutral-800 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-neutral-900 transition-colors"
            title="Session History"
            aria-label="Session history"
          >
            <History size={20} />
          </button>
        </div>
      )}

      {/* Mobile drawers */}
      <MobileSessionsDrawer
        isOpen={mobileSessionsOpen}
        onClose={() => setMobileSessionsOpen(false)}
      />
      <MobileSidePanelDrawer
        isOpen={mobileSidePanelOpen}
        onClose={() => setMobileSidePanelOpen(false)}
        sessionId={activeSessionId}
      />
      <ShortcutsModal
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </>
  );
}

// ============================================
// ATTACHMENT CHIPS
// ============================================

interface AttachmentItem {
  attachmentId: string;
  displayName: string;
  path: string;
  type: "file" | "folder" | "url";
}

function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: AttachmentItem[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {attachments.map((att) => {
        const isScreenshot = att.type === "file" && att.displayName.startsWith("screenshot-");
        const Icon = att.type === "folder"
          ? FolderOpen
          : att.type === "url"
            ? LinkIcon
            : isScreenshot
              ? Camera
              : File;
        return (
          <div
            key={att.attachmentId}
            className="flex items-center bg-neutral-100 border border-neutral-200 rounded-full px-2.5 py-1 text-xs text-neutral-600"
            title={att.path}
          >
            <Icon size={12} className="mr-1 text-neutral-400" />
            <span className="truncate max-w-[160px]">{att.displayName}</span>
            <button
              onClick={() => onRemove(att.attachmentId)}
              className="ml-1 text-neutral-400 hover:text-neutral-700"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// CODE BLOCK VIEW (reused from old chat page)
// ============================================

function CodeBlockView({ block }: { block: CodeBlock }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void copyToClipboard(block.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-3 rounded-lg overflow-hidden border border-neutral-200">
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-100 text-xs">
        <span className="font-medium text-neutral-500">{block.language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center space-x-1 text-neutral-400 hover:text-neutral-700 transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check size={12} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 bg-neutral-900 text-neutral-200 text-xs leading-relaxed overflow-x-auto">
        <code>{block.code}</code>
      </pre>
    </div>
  );
}
