"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Terminal,
  Play,
  ExternalLink,
  StopCircle,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Monitor,
  Tablet,
  Smartphone,
  Loader2,
  AlertCircle,
  RefreshCw,
  History,
} from "lucide-react";
import { VersionsPanel } from "@/components/artifacts/versions-panel";
import { useOrchestrationStore, type FileNode } from "@/stores/orchestration";
import { useSettingsStore } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/lib/api";
import { probePreviewDocument } from "@/lib/preview-probe";
import { useTranslation } from "@/stores/i18n";
import { isTextFile } from "@/lib/file-utils";
import OutputPanel from "./output-panel";
import FileEditorDialog from "./file-editor-dialog";
import IntegrationBuildPanel from "./integration-build-panel";

// ============================================
// TYPES
// ============================================

type ViewportSize = "desktop" | "tablet" | "mobile";

const VIEWPORT_WIDTHS: Record<ViewportSize, number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 375,
};

/** Maximum number of auto-retries on iframe error. */
const IFRAME_MAX_AUTO_RETRIES = 3;
/** Delay (ms) between auto-retries on error. */
const IFRAME_RETRY_BASE_DELAY_MS = 1500;
/** Preview poll timeout (ms) before giving up. */
const PREVIEW_POLL_TIMEOUT_MS = 30_000;
/** Preview poll interval (ms) between health checks. */
const PREVIEW_POLL_INTERVAL_MS = 500;

// ============================================
// PROPS
// ============================================

interface SidePanelProps {
  sessionId: string | null;
  /** Collapse the panel (desktop). When provided, a chevron in the tab bar
   *  hides the panel — the floating open-button reappears in the chat column. */
  onClose?: () => void;
}

const EMPTY_FILE_TREE: FileNode[] = [];

const BUILD_PHASE_KEYS = [
  'buildPhase1',
  'buildPhase2',
  'buildPhase3',
  'buildPhase4',
  'buildPhase5',
] as const;
const BUILD_PHASE_DURATION_MS = 4000;

// ============================================
// COMPONENT
// ============================================

export default function SidePanel({ sessionId, onClose }: SidePanelProps) {
  const { sidePanel: sp, versions: vt } = useTranslation();
  const [viewport, setViewport] = useState<ViewportSize>("desktop");
  const [isRestarting, setIsRestarting] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Iframe loading state
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const iframeLoadStartRef = useRef<number>(0);
  const autoRetryCountRef = useRef(0);
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  // File editor state
  const [editingFile, setEditingFile] = useState<string | null>(null);

  const tabConfig = useMemo(() => [
    { name: sp.files, storeTab: "files" as const, icon: <FileText size={14} /> },
    { name: sp.output, storeTab: "output" as const, icon: <Terminal size={14} /> },
    { name: sp.preview, storeTab: "preview" as const, icon: <Play size={14} /> },
    { name: vt.tab, storeTab: "versions" as const, icon: <History size={14} /> },
  ], [sp.files, sp.output, sp.preview, vt.tab]);

  const activeTab = useOrchestrationStore((s) => s.sidePanelTab);
  const setSidePanelTab = useOrchestrationStore((s) => s.setSidePanelTab);
  const sidePanelState = useOrchestrationStore((s) => s.sidePanelState);
  const preview = useOrchestrationStore((s) =>
    sessionId ? s.sessionPreviews[sessionId] : null
  );
  const fileTree = useOrchestrationStore((s) =>
    sessionId ? s.sessionFiles[sessionId] || EMPTY_FILE_TREE : EMPTY_FILE_TREE
  );
  const setSessionPreview = useOrchestrationStore((s) => s.setSessionPreview);
  const artifactInstanceId = useOrchestrationStore((s) =>
    sessionId ? s.sessionJobs[sessionId]?.artifactInstanceId : null
  );
  const artifactSlug = useOrchestrationStore((s) =>
    sessionId ? s.sessionJobs[sessionId]?.slug : null
  );
  const artifactShareable = useOrchestrationStore((s) =>
    sessionId ? s.sessionJobs[sessionId]?.shareable === true : false
  );

  // Derive the preview URL from multiple sources -- prefer slug over ID. Persisted
  // appUrls are stored as relative paths ("/apps/foo/"); resolve them against the
  // cortex API base so the iframe doesn't try to load them from the Next.js host.
  const rawPreviewUrl = preview?.appUrl
    ? api.resolveUrl(preview.appUrl)
    : preview?.previewId
      ? api.appUrl(preview.previewId)
      : null;
  const appIdentifier = artifactSlug || artifactInstanceId;
  const artifactUrl = appIdentifier ? api.appUrl(appIdentifier) : null;
  const previewUrl = rawPreviewUrl || artifactUrl;

  // Append the auth token via ?token= so cortex can verify ownership when
  // serving a non-shareable artifact preview. Required for cross-origin dev
  // (frontend and cortex on different ports cannot share the session-token
  // cookie). Subscribe to auth store so the URL updates on login/logout.
  // Shareable artifacts skip the token — the server serves them publicly,
  // and leaking a JWT in the iframe URL (browser history, referrer headers,
  // server logs) is needless exposure.
  const authToken = useAuthStore((s) => s.token);
  const previewUrlWithToken = artifactShareable || !previewUrl
    ? previewUrl
    : authToken
      ? api.withPreviewToken(previewUrl)
      : previewUrl;

  // Derive effective preview status: if we have a URL and the job completed,
  // treat the preview as "running" regardless of what the SSE event chain set.
  // Static files are always available immediately after the build.
  const jobStatus = useOrchestrationStore((s) =>
    sessionId ? s.sessionJobs[sessionId]?.status : null
  );
  const rawPreviewStatus = preview?.status || "idle";
  const previewStatus = (rawPreviewStatus !== "running" && previewUrl && jobStatus === "completed")
    ? "running"
    : rawPreviewStatus;

  // Apply "show file tree by default" setting on mount
  const showFileTreeByDefault = useSettingsStore((s) => s.settings.build.showFileTreeByDefault);
  const hasAppliedFileTreeDefault = useRef(false);
  useEffect(() => {
    if (showFileTreeByDefault && !hasAppliedFileTreeDefault.current) {
      hasAppliedFileTreeDefault.current = true;
      setSidePanelTab("files");
    }
  }, [showFileTreeByDefault, setSidePanelTab]);

  // Auto-switch to Preview tab when preview becomes running.
  // Small delay ensures other state updates (job completion, preview URL)
  // have settled before triggering the tab switch and AnimatePresence transition.
  const prevPreviewStatusRef = useRef(previewStatus);
  useEffect(() => {
    if (previewStatus === "running" && prevPreviewStatusRef.current !== "running") {
      const timer = setTimeout(() => setSidePanelTab("preview"), 100);
      prevPreviewStatusRef.current = previewStatus;
      return () => clearTimeout(timer);
    }
    prevPreviewStatusRef.current = previewStatus;
  }, [previewStatus, setSidePanelTab]);

  // Build phase animation state -- AnimatePresence handles the crossfade.
  const [buildPhase, setBuildPhase] = useState(0);

  useEffect(() => {
    if (previewStatus !== "building") {
      setBuildPhase(0);
      return;
    }
    const interval = setInterval(() => {
      setBuildPhase((p) => (p + 1) % BUILD_PHASE_KEYS.length);
    }, BUILD_PHASE_DURATION_MS);
    return () => clearInterval(interval);
  }, [previewStatus]);

  function handleTabClick(tab: "files" | "output" | "preview" | "versions") {
    setSidePanelTab(tab);
  }

  // Static files are available immediately after build, but verify the document
  // plane answers before pointing the iframe at it: an HTTP error body rendered
  // into an iframe never fires the error event, so a transient 5xx (proxy/edge
  // blip) would stick until a manual refresh (F-2026-07-12-preview-502). A
  // 'hard' answer (401/404/410) is a deliberate server page — render it as-is.
  useEffect(() => {
    if (!previewUrlWithToken) {
      setPreviewReady(false);
      return;
    }
    setPreviewReady(false);
    setIframeLoading(true);
    setIframeError(false);
    autoRetryCountRef.current = 0;
    pollAbortRef.current?.abort();
    const abortController = new AbortController();
    pollAbortRef.current = abortController;
    const startTime = Date.now();
    const probeLoop = async () => {
      while (!abortController.signal.aborted) {
        const verdict = await probePreviewDocument(previewUrlWithToken, abortController.signal);
        if (abortController.signal.aborted) return;
        if (verdict !== "transient") {
          setPreviewReady(true);
          return;
        }
        if (Date.now() - startTime > PREVIEW_POLL_TIMEOUT_MS) {
          setIframeLoading(false);
          setIframeError(true);
          return;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, PREVIEW_POLL_INTERVAL_MS);
          abortController.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    };
    probeLoop();
    return () => abortController.abort();
  }, [previewUrlWithToken]);

  // Hot-reload: when reloadCount changes, force-reload the iframe
  const reloadCount = preview?.reloadCount || 0;
  const lastReloadCount = useRef(reloadCount);
  useEffect(() => {
    if (reloadCount > lastReloadCount.current && iframeRef.current && previewUrlWithToken) {
      lastReloadCount.current = reloadCount;
      setIframeLoading(true);
      // Force reload by setting src to empty then back to the URL
      iframeRef.current.src = 'about:blank';
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = previewUrlWithToken + (previewUrlWithToken.includes('?') ? '&' : '?') + '_r=' + reloadCount;
        }
      }, 100);
    }
  }, [reloadCount, previewUrlWithToken]);

  const handleIframeError = useCallback(() => {
    // On error, auto-retry a few times (the server might still be starting)
    if (
      autoRetryCountRef.current < IFRAME_MAX_AUTO_RETRIES &&
      iframeRef.current &&
      previewUrlWithToken
    ) {
      autoRetryCountRef.current++;
      const delay = IFRAME_RETRY_BASE_DELAY_MS * autoRetryCountRef.current;
      autoRetryTimerRef.current = setTimeout(() => {
        if (iframeRef.current && previewUrlWithToken) {
          iframeLoadStartRef.current = Date.now();
          setIframeLoading(true);
          iframeRef.current.src = previewUrlWithToken;
        }
      }, delay);
      return;
    }

    setIframeLoading(false);
    setIframeError(true);
  }, [previewUrlWithToken]);

  const handleIframeLoad = useCallback(() => {
    // `load` fires even when the document is an HTTP error body (an iframe never
    // fires its error event for HTTP failures), so verify the document plane
    // out-of-band and push a transient failure through the retry machinery
    // (F-2026-07-12-preview-502). A verified-ok load restores the retry budget.
    if (!previewUrlWithToken) {
      setIframeLoading(false);
      setIframeError(false);
      return;
    }
    probePreviewDocument(previewUrlWithToken).then((verdict) => {
      if (verdict === "transient") {
        handleIframeError();
        return;
      }
      autoRetryCountRef.current = 0;
      setIframeLoading(false);
      setIframeError(false);
    });
  }, [previewUrlWithToken, handleIframeError]);

  function handleRefreshPreview() {
    if (previewUrl) {
      autoRetryCountRef.current = 0;
      setIframeLoading(true);
      setIframeError(false);

      if (previewReady && iframeRef.current) {
        // Server was already ready -- just reload the iframe
        iframeLoadStartRef.current = Date.now();
        iframeRef.current.src = previewUrlWithToken || previewUrl;
      } else {
        // Server not confirmed ready yet -- re-trigger poll by toggling previewReady
        setPreviewReady(false);
        // Abort existing poll and start a new one
        pollAbortRef.current?.abort();
        const abortController = new AbortController();
        pollAbortRef.current = abortController;
        const startTime = Date.now();

        const poll = async () => {
          while (!abortController.signal.aborted) {
            const verdict = await probePreviewDocument(previewUrlWithToken || previewUrl, abortController.signal);
            if (abortController.signal.aborted) return;
            if (verdict !== "transient") {
              setPreviewReady(true);
              iframeLoadStartRef.current = Date.now();
              return;
            }
            if (Date.now() - startTime > PREVIEW_POLL_TIMEOUT_MS) {
              setIframeLoading(false);
              setIframeError(true);
              return;
            }
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, PREVIEW_POLL_INTERVAL_MS);
              abortController.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
            });
          }
        };
        poll();
      }
    }
  }

  function handleOpenInTab() {
    // Prefer the slug-based artifact URL over the raw preview URL (which is
    // keyed by instance id) so the opened tab shows the clean, shareable URL.
    const base = artifactUrl || previewUrl;
    if (!base) return;
    const url = artifactShareable ? base : api.withPreviewToken(base);
    window.open(url ?? base, "_blank");
  }

  function handleStopPreview() {
    if (!sessionId) return;
    setSessionPreview(sessionId, { status: "stopped", appUrl: null });
  }

  function handleRestartPreview() {
    if (!sessionId) return;
    // Prefer artifact slug/id; fall back to the template binding for sessions
    // that came from /chat?template=<id> and never produced an artifact yet.
    const restartAppId = appIdentifier;
    const restartUrl = restartAppId
      ? api.appUrl(restartAppId)
      : preview?.templateId
        ? `/apps/template-${preview.templateId}/`
        : null;
    if (!restartUrl) return;
    setIsRestarting(true);
    setSessionPreview(sessionId, {
      previewId: restartAppId ?? null,
      appUrl: restartUrl,
      status: "running",
      error: null,
    });
    // Reload iframe with token (skipped for shareable artifacts — public URL
    // doesn't need owner verification, and we avoid leaking the JWT).
    if (iframeRef.current) {
      const absolute = restartAppId ? restartUrl : api.resolveUrl(restartUrl);
      const token = useAuthStore.getState().token;
      iframeRef.current.src = !artifactShareable && token
        ? `${absolute}${absolute.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
        : absolute;
    }
    setIsRestarting(false);
  }

  function handleFileClick(filePath: string) {
    if (isTextFile(filePath)) {
      setEditingFile(filePath);
    }
  }

  const viewportWidth = VIEWPORT_WIDTHS[viewport];

  // When the side panel is in 'integrate' state, host the integration
  // builder instead of the Files/Output/Preview/Versions tabs.
  if (sidePanelState === "integrate") {
    return (
      <div className="flex-1 bg-neutral-50 flex flex-col min-w-0">
        <IntegrationBuildPanel sessionId={sessionId} />
      </div>
    );
  }

  return (
    <div className="flex-1 bg-neutral-50 flex flex-col min-w-0">
      {/* Tab bar */}
      <div className="flex border-b border-neutral-200 bg-white px-2 pt-2 justify-between items-center">
        <div className="flex">
          {tabConfig.map((tab) => (
            <PanelTab
              key={tab.name}
              name={tab.name}
              icon={tab.icon}
              isActive={activeTab === tab.storeTab}
              onClick={() => handleTabClick(tab.storeTab)}
            />
          ))}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="hidden md:flex items-center justify-center w-8 h-8 mr-1 mb-1 rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors"
            title="Hide files & preview"
            aria-label="Close side panel"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>

      {/* Tab content */}
      <>
        {activeTab === "preview" && (
          <div
            className="flex-1 flex flex-col min-h-0"
          >
            {/* Status bar */}
            <div className="h-10 bg-white border-b border-neutral-200 flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center text-xs font-medium">
                <PreviewStatusBadge status={previewStatus} translations={sp} />
              </div>
              <div className="flex items-center space-x-1">
                {/* Viewport switches */}
                <ViewportButton
                  icon={<Monitor size={13} />}
                  active={viewport === "desktop"}
                  onClick={() => setViewport("desktop")}
                  title={sp.desktop}
                />
                <ViewportButton
                  icon={<Tablet size={13} />}
                  active={viewport === "tablet"}
                  onClick={() => setViewport("tablet")}
                  title={`${sp.tablet} (768px)`}
                />
                <ViewportButton
                  icon={<Smartphone size={13} />}
                  active={viewport === "mobile"}
                  onClick={() => setViewport("mobile")}
                  title={`${sp.mobile} (375px)`}
                />
                <div className="w-px h-4 bg-neutral-200 mx-1" />
                <button
                  onClick={handleRefreshPreview}
                  disabled={!previewUrl}
                  className="text-neutral-500 hover:text-neutral-800 disabled:opacity-30 p-1 rounded transition-colors"
                  title={sp.refreshPreview}
                >
                  <RefreshCw size={14} className={iframeLoading ? "animate-spin" : ""} />
                </button>
                <button
                  onClick={handleOpenInTab}
                  disabled={!previewUrl}
                  className="text-neutral-500 hover:text-neutral-800 disabled:opacity-30 p-1 rounded transition-colors"
                  title={sp.openInNewTab}
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  onClick={handleStopPreview}
                  disabled={previewStatus !== "running"}
                  className="text-amber-600 hover:text-amber-700 disabled:opacity-30 p-1 rounded transition-colors"
                  title={sp.stopApp}
                >
                  <StopCircle size={14} />
                </button>
              </div>
            </div>

            {/* Preview content */}
            <div className="flex-1 bg-neutral-200 flex items-center justify-center overflow-hidden">
              {previewStatus === "running" && previewUrl ? (
                <div
                  className="h-full bg-white relative"
                  style={{
                    width: viewportWidth ? `${viewportWidth}px` : "100%",
                    maxWidth: "100%",
                    transition: "width 0.3s ease",
                  }}
                >
                  {/* Loading overlay */}
                  {iframeLoading && (
                    <div className="absolute inset-0 z-10 bg-white flex flex-col items-center justify-center">
                      <Loader2 size={24} className="mb-2 animate-spin text-teal-600" />
                      <p className="text-sm font-medium text-neutral-600">
                        {sp.loadingPreview || "Loading preview..."}
                      </p>
                      <p className="text-xs text-neutral-400 mt-1">
                        {sp.thisMayTakeAMoment}
                      </p>
                    </div>
                  )}
                  {/* Error overlay with retry */}
                  {iframeError && !iframeLoading && (
                    <div className="absolute inset-0 z-10 bg-white flex flex-col items-center justify-center">
                      <AlertCircle size={24} className="mb-2 text-amber-500" />
                      <p className="text-sm font-medium text-neutral-600 mb-1">
                        {sp.previewNotReady || "Preview not ready"}
                      </p>
                      <p className="text-xs text-neutral-400 mb-3 max-w-xs text-center">
                        {sp.previewNotReadyMessage || "The app may still be starting up."}
                      </p>
                      <button
                        onClick={handleRefreshPreview}
                        className="flex items-center px-4 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded transition-colors"
                      >
                        <RefreshCw size={12} className="mr-1.5" />
                        {sp.refreshPreview}
                      </button>
                    </div>
                  )}
                  {/* Deliberately NO sandbox attribute (decision 2026-07-14): with both
                      allow-scripts and allow-same-origin the sandbox is escapable (Chrome
                      warned on every load, incl. each about:blank hot-reload), and dropping
                      allow-same-origin breaks the injected __ekoa runtime (same-origin data
                      fetches, the CHIPS SSO cookie, storage). Real isolation is the ORIGIN
                      SPLIT (apps on the api origin, :4111 in dev / api.<domain> in prod) +
                      the /apps frame-ancestors allowlist (api/src/security-headers.ts).
                      Matches the other two preview surfaces (DemoTourProvider,
                      artifact-preview-overlay), which never carried a sandbox. */}
                  <iframe
                    ref={iframeRef}
                    src={previewReady ? (previewUrlWithToken || previewUrl) : undefined}
                    className="w-full h-full border-0"
                    title="App Preview"
                    onLoad={handleIframeLoad}
                    onError={handleIframeError}
                  />
                </div>
              ) : previewStatus === "building" || previewStatus === "starting" ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="relative w-full h-full flex flex-col items-center justify-center px-8 bg-white overflow-hidden"
                >
                  {/* Faint dot grid — matches preview-hero pattern */}
                  <div
                    className="absolute inset-0 pointer-events-none opacity-[0.04]"
                    style={{
                      backgroundImage: "radial-gradient(circle, #0d9488 1px, transparent 1px)",
                      backgroundSize: "20px 20px",
                    }}
                  />

                  {/* Kicker */}
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.05, ease: "easeOut" }}
                    className="relative flex items-center gap-2 mb-7 text-[10px] font-semibold tracking-[0.22em] uppercase text-teal-700"
                  >
                    <motion.span
                      className="block w-1 h-1 rounded-full bg-teal-500"
                      animate={{ opacity: [0.35, 1, 0.35], scale: [0.9, 1.15, 0.9] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                    />
                    {previewStatus === "starting" ? sp.startingApp : sp.buildingApp}
                  </motion.div>

                  {/* Phase title — AnimatePresence crossfade with blur + slide */}
                  <div className="relative h-10 w-full max-w-sm flex items-center justify-center mb-7 overflow-hidden">
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.h2
                        key={previewStatus === "starting" ? "starting" : `phase-${buildPhase}`}
                        initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, y: -18, filter: "blur(6px)" }}
                        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-0 flex items-center justify-center text-xl font-medium tracking-tight text-neutral-900 text-center"
                      >
                        {previewStatus === "starting"
                          ? sp.buildPhase5
                          : sp[BUILD_PHASE_KEYS[buildPhase]]}
                      </motion.h2>
                    </AnimatePresence>
                  </div>

                  {/* Segmented progress — spring width, breathing opacity on active */}
                  {previewStatus === "building" && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
                      className="flex items-center gap-1.5"
                    >
                      {BUILD_PHASE_KEYS.map((_, i) => {
                        const isPast = i < buildPhase;
                        const isActive = i === buildPhase;
                        return (
                          <motion.span
                            key={i}
                            className="block h-[2px] rounded-full"
                            animate={
                              isActive
                                ? {
                                    width: 32,
                                    backgroundColor: "rgb(13, 148, 136)",
                                    opacity: [1, 0.4, 1],
                                  }
                                : {
                                    width: 18,
                                    backgroundColor: isPast
                                      ? "rgb(13, 148, 136)"
                                      : "rgba(10, 10, 10, 0.12)",
                                    opacity: 1,
                                  }
                            }
                            transition={
                              isActive
                                ? {
                                    width: { type: "spring", stiffness: 220, damping: 22 },
                                    backgroundColor: { duration: 0.35, ease: "easeOut" },
                                    opacity: { duration: 1.6, repeat: Infinity, ease: "easeInOut" },
                                  }
                                : {
                                    width: { type: "spring", stiffness: 220, damping: 22 },
                                    backgroundColor: { duration: 0.35, ease: "easeOut" },
                                  }
                            }
                          />
                        );
                      })}
                    </motion.div>
                  )}

                  {/* Subtitle */}
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.45, delay: 0.2 }}
                    className="relative text-xs text-neutral-400 mt-7"
                  >
                    {sp.thisMayTakeAMoment}
                  </motion.p>
                </motion.div>
              ) : previewStatus === "failed" ? (
                <div className="text-center text-red-500">
                  <AlertCircle size={24} className="mx-auto mb-2" />
                  <p className="text-sm font-medium">{sp.previewFailed}</p>
                  {preview?.error && (
                    <p className="text-xs text-red-400 mt-1 max-w-xs">
                      {preview.error}
                    </p>
                  )}
                  {artifactInstanceId && (
                    <button
                      onClick={handleRestartPreview}
                      disabled={isRestarting}
                      className="mt-3 px-4 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded transition-colors"
                    >
                      {isRestarting ? sp.restartingPreview : sp.restartPreview}
                    </button>
                  )}
                </div>
              ) : previewStatus === "stopped" ? (
                <div className="text-center text-neutral-500 max-w-[280px]">
                  <AlertCircle size={24} className="text-amber-500 mx-auto mb-3" />
                  <p className="text-sm font-medium text-neutral-600 mb-1">
                    {sp.appStopped}
                  </p>
                  {(artifactInstanceId || preview?.templateId) && (
                    <button
                      onClick={handleRestartPreview}
                      disabled={isRestarting}
                      className="px-4 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded transition-colors"
                    >
                      {isRestarting ? sp.restartingPreview : sp.restartPreview}
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-center text-neutral-400 max-w-[280px]">
                  <Play size={24} className="text-neutral-400 mx-auto mb-3" />
                  <p className="text-sm font-medium text-neutral-500 mb-1">{sp.previewUnavailable}</p>
                  <p className="text-xs text-neutral-400 leading-relaxed">{sp.previewWillAppear}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "files" && (
          <div className="flex-1 p-4 bg-white overflow-y-auto scrollbar-light">
            {fileTree.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-neutral-400 text-sm">
                {sp.noFiles}
              </div>
            ) : (
              <FileTreeView nodes={fileTree} onFileClick={handleFileClick} />
            )}
          </div>
        )}

        {activeTab === "output" && (
          <div className="flex-1 flex flex-col min-h-0">
            <OutputPanel sessionId={sessionId} />
          </div>
        )}

        {activeTab === "versions" && (
          <div className="flex-1 flex flex-col min-h-0 bg-white">
            {artifactInstanceId ? (
              <VersionsPanel
                artifactId={artifactInstanceId}
                onAfterRestore={() => {
                  if (iframeRef.current && previewUrl) {
                    iframeLoadStartRef.current = Date.now();
                    autoRetryCountRef.current = 0;
                    setIframeLoading(true);
                    setIframeError(false);
                    iframeRef.current.src = previewUrlWithToken || previewUrl;
                  }
                }}
                hideHeader
                className="flex-1"
              />
            ) : (
              <div className="flex items-center justify-center h-32 text-neutral-400 text-sm p-4 text-center">
                {vt.appearAfterBuild}
              </div>
            )}
          </div>
        )}
      </>

      {/* File editor dialog */}
      {editingFile && artifactInstanceId && (
        <FileEditorDialog
          open={!!editingFile}
          onOpenChange={(open) => { if (!open) setEditingFile(null); }}
          artifactId={artifactInstanceId}
          filePath={editingFile}
          onSave={() => {
            if (iframeRef.current && previewUrl) {
              iframeLoadStartRef.current = Date.now();
              autoRetryCountRef.current = 0;
              setIframeLoading(true);
              setIframeError(false);
              iframeRef.current.src = previewUrlWithToken || previewUrl;
            }
          }}
        />
      )}
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

function PanelTab({
  name,
  icon,
  isActive,
  onClick,
}: {
  name: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-inset ${
        isActive
          ? "border-teal-600 text-teal-700"
          : "border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300"
      }`}
    >
      <span className="mr-2">{icon}</span>
      {name}
    </button>
  );
}

function ViewportButton({
  icon,
  active,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-1 rounded transition-colors ${
        active
          ? "text-white bg-teal-800"
          : "text-neutral-400 hover:text-neutral-600"
      }`}
      title={title}
    >
      {icon}
    </button>
  );
}

function PreviewStatusBadge({
  status,
  translations: sp,
}: {
  status: string;
  translations: ReturnType<typeof useTranslation>["sidePanel"];
}) {
  switch (status) {
    case "running":
      return (
        <span className="flex items-center text-teal-700">
          <span className="w-2 h-2 rounded-full bg-teal-600 mr-2 animate-pulse" />
          {sp.appRunning}
        </span>
      );
    case "building":
      return (
        <span className="flex items-center text-amber-600">
          <Loader2 size={12} className="mr-2 animate-spin" />
          {sp.buildingApp}
        </span>
      );
    case "starting":
      return (
        <span className="flex items-center text-amber-600">
          <Loader2 size={12} className="mr-2 animate-spin" />
          {sp.startingApp}
        </span>
      );
    case "failed":
      return (
        <span className="flex items-center text-red-500">
          <AlertCircle size={12} className="mr-2" />
          {sp.previewFailed}
        </span>
      );
    case "stopped":
      return (
        <span className="flex items-center text-neutral-400">
          <StopCircle size={12} className="mr-2" />
          {sp.appStopped}
        </span>
      );
    default:
      return (
        <span className="text-neutral-400">{sp.previewUnavailable}</span>
      );
  }
}

// ============================================
// FILE TREE
// ============================================

function FileTreeView({ nodes, onFileClick }: { nodes: FileNode[]; onFileClick?: (path: string) => void }) {
  // Collect all folder paths from nodes
  const allFolderPaths = useMemo(() => {
    const paths = new Set<string>();
    function collect(items: FileNode[]) {
      for (const n of items) {
        if (n.type === "folder") {
          paths.add(n.path);
          if (n.children) collect(n.children);
        }
      }
    }
    collect(nodes);
    return paths;
  }, [nodes]);

  // Track manually closed folders (everything is open by default)
  const [closedFolders, setClosedFolders] = useState<Set<string>>(() => new Set());

  // Open folders = all folder paths minus manually closed ones
  const openFolders = useMemo(() => {
    const open = new Set(allFolderPaths);
    closedFolders.forEach((p) => open.delete(p));
    return open;
  }, [allFolderPaths, closedFolders]);

  function toggleFolder(path: string) {
    setClosedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="space-y-0">
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          level={0}
          openFolders={openFolders}
          toggleFolder={toggleFolder}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}

function TreeNode({
  node,
  level,
  openFolders,
  toggleFolder,
  onFileClick,
}: {
  node: FileNode;
  level: number;
  openFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onFileClick?: (path: string) => void;
}) {
  const paddingLeft = level * 16 + 8;

  if (node.type === "folder") {
    const isOpen = openFolders.has(node.path);

    return (
      <div>
        <div
          className="flex items-center py-1.5 pr-2 hover:bg-neutral-50 rounded cursor-pointer text-sm font-medium text-neutral-800 transition-colors"
          style={{ paddingLeft: `${paddingLeft}px` }}
          onClick={() => toggleFolder(node.path)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFolder(node.path); } }}
        >
          {isOpen ? (
            <ChevronDown size={14} className="text-neutral-400 mr-1 flex-shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-neutral-400 mr-1 flex-shrink-0" />
          )}
          {isOpen ? (
            <FolderOpen size={14} className="mr-2 text-amber-600 flex-shrink-0" />
          ) : (
            <Folder size={14} className="mr-2 text-neutral-500 flex-shrink-0" />
          )}
          {node.name}
        </div>
        {isOpen &&
          node.children?.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              level={level + 1}
              openFolders={openFolders}
              toggleFolder={toggleFolder}
              onFileClick={onFileClick}
            />
          ))}
      </div>
    );
  }

  const actionColor =
    node.action === "created"
      ? "text-green-600"
      : node.action === "modified"
      ? "text-amber-600"
      : node.action === "deleted"
      ? "text-red-500"
      : "text-neutral-400";

  const actionLabel =
    node.action === "created"
      ? "+"
      : node.action === "modified"
      ? "M"
      : node.action === "deleted"
      ? "D"
      : "";

  // Add 15px offset to align with folder content (past the chevron)
  const filePaddingLeft = paddingLeft + 15;
  const canEdit = node.action !== "deleted" && onFileClick && isTextFile(node.name);

  return (
    <div
      className={`flex items-center py-1.5 pr-2 hover:bg-neutral-50 rounded text-sm text-neutral-700 transition-colors ${
        canEdit ? "cursor-pointer hover:text-teal-700" : ""
      }`}
      style={{ paddingLeft: `${filePaddingLeft}px` }}
      onClick={canEdit ? () => onFileClick(node.fullPath ?? node.path) : undefined}
      role={canEdit ? "button" : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onKeyDown={canEdit ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFileClick(node.fullPath ?? node.path); } } : undefined}
    >
      {actionLabel ? (
        <span
          className={`text-[11px] font-bold mr-2 flex-shrink-0 w-4 text-center ${actionColor}`}
        >
          {actionLabel}
        </span>
      ) : (
        <FileText size={14} className="mr-2 text-neutral-400 flex-shrink-0" />
      )}
      <span className={`truncate ${node.action === "deleted" ? "line-through opacity-50" : ""}`}>
        {node.name}
      </span>
    </div>
  );
}
