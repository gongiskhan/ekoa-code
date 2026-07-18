"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
  Send,
  Square,
  Paperclip,
  Loader2,
  Copy,
  Check,
  File,
  FolderOpen,
  X,
  History,
  PanelRight,
  Camera,
  Link as LinkIcon,
} from "lucide-react";
import SessionsPanel from "@/components/builder/sessions-panel";
import ChatPanel from "@/components/builder/chat-panel";
import SidePanel from "@/components/builder/side-panel";
import { PromptSuggestionsStrip, ChatLoadingScreen } from "@/components/chat/empty-state";
import { ChatStripes } from "@/components/chat/chat-stripes";
import { OnboardingCard } from "@/components/chat/onboarding-card";
import { OnboardingWelcome } from "@/components/chat/onboarding-welcome";
import MobileSessionsDrawer from "@/components/chat/mobile-sessions-drawer";
import MobileSidePanelDrawer from "@/components/chat/mobile-side-panel-drawer";
import { ShortcutsModal } from "@/components/chat/shortcuts-modal";
import { AnimatedTagline } from "@/components/chat/animated-tagline";
import { ComposerAttachMenu } from "@/components/privacy/composer-attach-menu";
import { LegalOnboardingCard } from "@/components/privacy/legal-onboarding-card";
import { useChatRuntime } from "@/components/chat/chat-runtime";
import { useOrchestrationStore } from "@/stores/orchestration";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSettingsStore } from "@/stores/settings";
import { api, tryCall } from "@/lib/api";
import { PRIVACY_COPY } from "@/lib/privacy-claims";
import type { PendingReference } from "@/lib/bridge-local";
import { ReferenceTokenChips } from "@/components/privacy/reference-token-chips";
import { copyToClipboard } from "@/lib/clipboard";
import { useTranslation, useI18nStore } from "@/stores/i18n";

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
// The chat CONTROLLER (send router, streams, notification subscriptions,
// cancel/retry/edit) lives in the shell-mounted ChatRuntimeProvider
// (components/chat/chat-runtime.tsx). This route wrapper owns everything
// URL-shaped - session activation from the route param, ?continue/?featured/
// ?reinterview recovery links, store->URL replaceState - plus the /chat page
// composition (sessions rail, empty state, ChatPanel + SidePanel columns).

export default function UnifiedChatPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSessionsExpanded, setIsSessionsExpanded] = useState(false);
  const hasHandledReinterview = useRef(false);
  const isMobile = useIsMobile();

  const runtime = useChatRuntime();
  const {
    initialized: runtimeInitialized,
    isBuildSession,
    sessionHasJob,
    isOnboardingSession,
  } = runtime;

  // Mobile drawer states
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [mobileSidePanelOpen, setMobileSidePanelOpen] = useState(false);

  // Desktop side-panel override. null = follow the auto signal (showSidePanel);
  // true/false = force open/closed via the floating toggle. This is the mitigation
  // for build sessions where the side panel fails to auto-show after loading a
  // session: the user can always force it open. Reset per session below.
  const [forceSidePanelOpen, setForceSidePanelOpen] = useState<boolean | null>(null);

  // A new build re-arms auto-open: the runtime signals every build kick so any
  // stale manual-close from earlier in this session is cleared.
  useEffect(
    () => runtime.onBuildKick(() => setForceSidePanelOpen(null)),
    [runtime.onBuildKick]
  );

  // Extract sessionId from optional catch-all route: [[...sessionId]]
  const urlSessionId = Array.isArray(params.sessionId)
    ? params.sessionId[0]
    : undefined;

  // -- Orchestration store --
  const activeSessionId = useOrchestrationStore((s) => s.activeSessionId);
  const sessions = useOrchestrationStore((s) => s.sessions);
  const pendingAttachments = useOrchestrationStore((s) => s.pendingAttachments);
  const messages = useOrchestrationStore((s) =>
    activeSessionId ? s.messages[activeSessionId] : undefined
  );

  const sidePanelState = useOrchestrationStore((s) => s.sidePanelState);
  const addMessage = useOrchestrationStore((s) => s.addMessage);
  const activeIntegrationBuilds = useOrchestrationStore((s) => s.activeIntegrationBuilds);

  const showExampleCards = useSettingsStore((s) => s.settings.chat.showExampleCards);
  // Language source = the i18n store (the language shown in the header and used by
  // the chat-agent via connection.getCurrentLanguage). The settings store's
  // general.language defaults to 'en' and is NOT kept in sync, so reading it here
  // made status text + build language render English while the agent replied in PT.
  const language = useI18nStore((s) => s.language);
  // FC-412: the one-time privacy onboarding card is Ekoa Legal only.
  const isLegalOrg = useSettingsStore((s) =>
    s.isLoaded ? s.settings.general.vertical === "legal" : false,
  );
  const { chatPanel, emptyState, language: uiLanguage } = useTranslation();
  const sessionJobs = useOrchestrationStore((s) => s.sessionJobs);
  const sessionPreviews = useOrchestrationStore((s) => s.sessionPreviews);

  const isExecuting = useOrchestrationStore((s) => s.isExecuting);
  const setComposerDraft = useOrchestrationStore((s) => s.setComposerDraft);
  const composerDraftForSession = useOrchestrationStore((s) =>
    activeSessionId ? s.composerDraft[activeSessionId] : undefined
  );

  // -- Input state (purely local) --
  const [chatInput, setChatInput] = useState("");
  const [promptStripCollapsed, setPromptStripCollapsed] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  // FC-400 (run s6): reference tokens attached to the NEXT outgoing message (D4).
  const [referenceTokens, setReferenceTokens] = useState<PendingReference[]>([]);
  const [referenceMintError, setReferenceMintError] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const urlPopoverRef = useRef<HTMLDivElement>(null);

  const addAttachment = useOrchestrationStore((s) => s.addAttachment);
  const removeAttachment = useOrchestrationStore((s) => s.removeAttachment);

  // ========================================
  // INITIALIZATION + URL SYNC
  // ========================================

  // The runtime owns initializeBuilderSession; the page only paces its loading
  // screen (600ms minimum so the transition doesn't flash).
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  // Tracks the urlSessionId we last activated/handled. Keyed by value (not a
  // one-shot boolean) so client-side navigation between sessions — e.g. tapping
  // a different "Continua onde paraste" card without a full reload — re-runs the
  // activation. A boolean guard here previously stuck after the first nav, so
  // subsequent card taps "did nothing until refresh".
  const lastActivatedSessionRef = useRef<string | null>(null);
  const loadingStartTimeRef = useRef(Date.now());

  useEffect(() => {
    if (!runtimeInitialized) return;
    const elapsed = Date.now() - loadingStartTimeRef.current;
    const remaining = Math.max(0, 600 - elapsed);
    const timer = setTimeout(() => setShowLoadingScreen(false), remaining);
    return () => clearTimeout(timer);
  }, [runtimeInitialized]);

  // URL -> Store: activate session from URL after sessions are loaded. Keyed by
  // the urlSessionId VALUE (not a one-shot boolean) so client-side navigation
  // between sessions — tapping a different "Continua onde paraste" card, a deep
  // link — re-runs activation. The previous one-shot boolean guard stuck after
  // the first nav, so later card taps "did nothing until refresh". The session
  // list activates via setActiveSession + replaceState (no Next route change),
  // so it never alters urlSessionId and is unaffected by this effect.
  useEffect(() => {
    if (!runtimeInitialized || !urlSessionId) return;
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
  }, [runtimeInitialized, urlSessionId, router]);

  // ?continue=<artifactInstanceId> — single-link recovery entry for "Continue
  // Working" without going through the artifacts page. Used to hand someone a
  // URL that restores their build context after they lost the session in the UI.
  const hasHandledContinueParam = useRef(false);
  useEffect(() => {
    if (hasHandledContinueParam.current) return;
    if (!runtimeInitialized) return;
    const artifactId = searchParams.get("continue");
    if (!artifactId) return;
    hasHandledContinueParam.current = true;

    (async () => {
      const store = useOrchestrationStore.getState();
      try {
        const res = await tryCall(() => api.artifacts.get({ id: artifactId }));
        if (!res.ok) {
          router.replace("/chat");
          return;
        }
        const artifact = res.data as unknown as {
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
          await api.artifacts.patch({
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
        await store.loadSessionMessages(targetSessionId);
        router.replace(`/chat/${targetSessionId}`);
      } catch {
        router.replace("/chat");
      }
    })();
  }, [runtimeInitialized, searchParams, router]);

  // ?featured=<featuredArtifactId> — pre-seeds the orchestrator with the
  // featured artifact's base, so the user lands in an empty chat ready to
  // describe customisations. The orchestrator's `seed-featured` intent reads
  // the artifact's typeId (which is the base id, per the migration) and
  // stores it on the session.
  const hasHandledFeaturedParam = useRef(false);
  useEffect(() => {
    if (hasHandledFeaturedParam.current) return;
    if (!runtimeInitialized) return;
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
        await api.sessions.seedFeatured({ id: sid, artifactId: featuredId }).catch(() => {});
        store.setSidePanelState("build");
        router.replace(`/chat/${sid}`);
      } catch {
        router.replace("/chat");
      }
    })();
  }, [runtimeInitialized, searchParams, router]);

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
    // handlers that need to read them after runtimeInitialized flips.
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

  // Reset prompt strip collapse state when switching sessions so new sessions start expanded
  useEffect(() => {
    setPromptStripCollapsed(false);
    // Each session starts following the auto side-panel signal again; the user's
    // manual force-open/closed shouldn't leak across navigation.
    setForceSidePanelOpen(null);
  }, [activeSessionId]);

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
    !hasMessages && messagesReady && !isExecuting && !hasArtifactContext;

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
  // SEND (via the shell-mounted chat runtime)
  // ========================================

  // The empty-state composer's send path. Reference tokens (FC-400) ride along
  // and are consumed/cleared only when the chat path actually captures them
  // (a queued or build-routed message leaves the chips pending, as before).
  const sendFromComposer = useCallback(
    (textArg?: string) => {
      const raw = (textArg ?? chatInput).trim();
      if (!raw) return;
      setReferenceMintError(false);
      runtime.sendMessage(raw, {
        references: referenceTokens,
        onReferencesConsumed: () => setReferenceTokens([]),
        onReferenceMintError: () => setReferenceMintError(true),
      });
      setChatInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    },
    [chatInput, referenceTokens, runtime]
  );

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
        runtime.kickBuildFirst(prompt);
      }
    },
    [runtime]
  );

  // Focus the empty-state composer without sending - used by the onboarding
  // welcome's "in my own words" chip.
  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // ========================================
  // SIDE PANEL VISIBILITY
  // ========================================

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

  function handleChatKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendFromComposer();
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
                    onSend={sendFromComposer}
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
                      <AnimatedTagline className="font-display text-3xl md:text-4xl font-semibold tracking-tight text-neutral-900 leading-tight" />
                    </header>

                    <OnboardingCard />

                    {isLegalOrg && <LegalOnboardingCard />}

                    <ChatStripes />
                  </>
                )}
              </div>
            </div>

            {/* Compose, pills, shortcut footer. */}
            <div className="p-3 md:p-4 border-t border-neutral-100 bg-white">
              <div className="max-w-3xl mx-auto space-y-3">
                <AttachmentChips attachments={pendingAttachments} onRemove={removeAttachment} />
                <ReferenceTokenChips
                  tokens={referenceTokens}
                  onRemove={(path) => setReferenceTokens((prev) => prev.filter((t) => t.path !== path))}
                />
                {referenceMintError && (
                  <p className="mb-2 text-[11px] leading-relaxed text-amber-700" data-testid="reference-mint-error">
                    {PRIVACY_COPY.referenceMintError}
                  </p>
                )}

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
                        <ComposerAttachMenu
                          open={showAttachMenu}
                          onClose={() => setShowAttachMenu(false)}
                          onUploadFile={handleAttachFile}
                          onUploadFolder={handleAttachFolder}
                          onReferencePicked={(ref) =>
                            setReferenceTokens((prev) =>
                              prev.some((t) => t.path === ref.path) ? prev : [...prev, ref],
                            )
                          }
                        />
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
                          onClick={runtime.cancelActive}
                          className="p-1.5 rounded-lg transition-all text-white bg-red-500 hover:bg-red-600 cursor-pointer"
                          title={chatPanel.stop}
                        >
                          <Square size={14} />
                        </button>
                      ) : (
                        <button
                          onClick={() => sendFromComposer()}
                          disabled={!chatInput.trim()}
                          title={chatPanel.sendMessage}
                          aria-label={chatPanel.sendMessage}
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
                onSendMessage={runtime.sendMessage}
                onCancel={runtime.cancelActive}
                onFirstMessage={runtime.sendMessage}
                onResend={runtime.retryActive}
                onEdit={runtime.editLastUserMessage}
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
