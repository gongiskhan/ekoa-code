"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import {
  Paperclip,
  Send,
  Square,
  CheckCircle2,
  PanelTop,
  LayoutDashboard,
  Presentation,
  Briefcase,
  FlaskConical,
  X,
  AlertCircle,
  ChevronDown,
  ThumbsUp,
  ThumbsDown,
  File,
  FolderOpen,
  RefreshCw,
  Link as LinkIcon,
  Camera,
  Clock,
  Copy,
  Check,
  Pencil,
  FileText,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { ComposerAttachMenu } from "@/components/privacy/composer-attach-menu";
import { TrustChip } from "@/components/privacy/trust-chip";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { redactProviderIdentity } from "@/lib/sanitize-error";
import { classifyEditIntent } from "@/lib/edit-intent";
import {
  useOrchestrationStore,
  type ChatMessage,
  type OutputEntry,
  type ReplySummaryEntry,
} from "@/stores/orchestration";
import { useChangeRequestsStore } from "@/stores/change-requests";
import { useSettingsStore } from "@/stores/settings";
import { getFriendlyPhaseMessage } from "@/lib/friendly-messages";
import { useTranslation, useI18nStore } from "@/stores/i18n";
import { api } from "@/lib/api";

// ============================================
// MARKDOWN COMPONENTS
// ============================================

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-base font-bold text-neutral-900 mt-3 mb-1.5">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-bold text-neutral-900 mt-2.5 mb-1">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-xs font-bold text-neutral-800 mt-2 mb-1">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-xs font-semibold text-neutral-800 mt-1.5 mb-0.5">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="mb-1.5 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-xs leading-relaxed">{children}</li>
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
      return (
        <code className="block text-[11px] leading-snug">{children}</code>
      );
    }
    return (
      <code className="bg-neutral-200 text-neutral-800 rounded px-1 py-0.5 text-[11px] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-neutral-800 text-neutral-100 rounded-md p-2.5 my-1.5 overflow-x-auto text-[11px] font-mono leading-snug">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-neutral-300 pl-2.5 my-1.5 italic text-neutral-500">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-1.5">
      <table className="min-w-full text-[11px] border border-neutral-200 rounded">
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
  tr: ({ children }) => (
    <tr className="even:bg-neutral-50">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-semibold text-neutral-700 border-b border-neutral-200">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 text-neutral-600">{children}</td>
  ),
  hr: () => <hr className="my-2 border-neutral-200" />,
  strong: ({ children }) => (
    <strong className="font-semibold text-neutral-800">{children}</strong>
  ),
};

// ============================================
// HELPERS
// ============================================

/**
 * Strip fenced code blocks from markdown content so the chat panel
 * only shows high-level prose. Code output belongs in the Files/Output tabs.
 */
function stripCodeBlocks(content: string): string {
  // Remove fenced code blocks (``` ... ```)
  const stripped = content.replace(/```[\s\S]*?```/g, '').trim();
  // Collapse multiple blank lines left behind
  return stripped.replace(/\n{3,}/g, '\n\n');
}

/** First non-empty line of a reply, markdown markers stripped - the summary card's
 *  PLACEHOLDER text (locked decision 8: shown while streaming and whenever the post-run
 *  summary never arrives; mirrors the sheet feed's title derivation). */
function firstLineOf(content: string): string {
  const line =
    stripCodeBlocks(content)
      .split("\n")
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 0) ?? "";
  return line.length > 180 ? `${line.slice(0, 180)}...` : line;
}

// ============================================
// TYPES
// ============================================

interface ChatPanelProps {
  sessionId: string | null;
  isExecuting: boolean;
  isBuildSession: boolean;
  onSendMessage: (message: string) => void;
  onCancel: () => void;
  onFirstMessage: (message: string) => void;
  onResend?: () => void;
  onEdit?: () => void;
}

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_QUEUE: string[] = [];

function getQuickActions(quickActions: ReturnType<typeof useTranslation>["quickActions"]) {
  return [
    {
      icon: FlaskConical,
      title: quickActions.test,
      prompt: quickActions.testDesc,
    },
    {
      icon: PanelTop,
      title: quickActions.landingPage,
      prompt: quickActions.landingPageDesc,
    },
    {
      icon: LayoutDashboard,
      title: quickActions.analyticsDashboard,
      prompt: quickActions.analyticsDashboardDesc,
    },
    {
      icon: Presentation,
      title: quickActions.presentation,
      prompt: quickActions.presentationDesc,
    },
    {
      icon: Briefcase,
      title: quickActions.portfolio,
      prompt: quickActions.portfolioDesc,
    },
  ];
}

// ============================================
// COMPONENT
// ============================================

export default function ChatPanel({
  sessionId,
  isExecuting,
  isBuildSession,
  onSendMessage,
  onCancel,
  onFirstMessage,
  onResend,
  onEdit,
}: ChatPanelProps) {
  const { quickActions: quickActionsTranslations, chatPanel: chatPanelT, pages, sheetFeed } = useTranslation();
  const language = useI18nStore((s) => s.language);
  const quickActions = getQuickActions(quickActionsTranslations);

  const showExampleCards = useSettingsStore((s) => s.settings.chat.showExampleCards);
  const [inputText, setInputText] = useState("");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  const messages = useOrchestrationStore((s) =>
    sessionId ? s.messages[sessionId] || EMPTY_MESSAGES : EMPTY_MESSAGES
  );
  const sessionJob = useOrchestrationStore((s) =>
    sessionId ? s.sessionJobs[sessionId] : null
  );
  const pendingAttachments = useOrchestrationStore((s) => s.pendingAttachments);
  const addAttachment = useOrchestrationStore((s) => s.addAttachment);
  const removeAttachment = useOrchestrationStore((s) => s.removeAttachment);
  const clearAttachments = useOrchestrationStore((s) => s.clearAttachments);
  const queuedMessages = useOrchestrationStore((s) =>
    sessionId ? s.queuedMessages[sessionId] || EMPTY_QUEUE : EMPTY_QUEUE
  );
  const removeQueuedMessage = useOrchestrationStore((s) => s.removeQueuedMessage);
  const composerDraft = useOrchestrationStore((s) =>
    sessionId ? s.composerDraft[sessionId] : undefined
  );
  const setComposerDraft = useOrchestrationStore((s) => s.setComposerDraft);
  // B5: summary-card entries + the composer chip's state + the card->sheet focus seam.
  const replySummaries = useOrchestrationStore((s) =>
    sessionId ? s.replySummaries[sessionId] : undefined
  );
  const editTarget = useOrchestrationStore((s) =>
    sessionId ? s.editTargets[sessionId] : undefined
  );
  const setEditTarget = useOrchestrationStore((s) => s.setEditTarget);
  const requestSheetFocus = useOrchestrationStore((s) => s.requestSheetFocus);

  // Summary cards + chip belong to the chat grammar only: a build session's deliverable is
  // the artifact panel, its transcript keeps the classic bubbles.
  const sheetCardsActive = !isBuildSession;

  // B5 (codex fix 2): the feed's createdFromMessageId back-references - the by-message-id
  // resolution source for cards whose summary never arrived (server-id turns after reload).
  const sheetLinks = useOrchestrationStore((s) =>
    sessionId ? s.sheetLinks[sessionId] : undefined
  );

  /** Card click -> focus ITS sheet through the store seam (locked 5: multiple cards can
   *  point at ONE sheet; a revision card focuses the SAME sheet its reply revised). The
   *  link resolves from server truth only: (a) the attached reply_summary's ids, then
   *  (b) the turn's stamped/persisted back-reference metadata, then (c) the feed's
   *  createdFromMessageId back-reference. NO resolved link -> no-op (codex fix 2):
   *  a card is never allowed to focus the wrong sheet. */
  const openSheetFor = useCallback(
    (msg: ChatMessage) => {
      if (!sessionId) return;
      const entry = replySummaries?.[msg.id];
      const sheetId = entry?.sheetId ?? msg.metadata?.sheetId ?? sheetLinks?.[msg.id];
      if (!sheetId) return;
      requestSheetFocus(sessionId, sheetId);
    },
    [sessionId, replySummaries, sheetLinks, requestSheetFocus]
  );

  // Filter to essential messages only
  const essentialMessages = messages.filter((msg) => {
    if (msg.role === "user") return true;
    if (!msg.metadata) return true;
    return msg.metadata.isEssential === true;
  });

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [essentialMessages.length, isExecuting]);

  // Elapsed time tracking
  useEffect(() => {
    if (isExecuting) {
      const now = Date.now();
      setStartTime(now);
      setElapsedTime(0);
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - now) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setStartTime(null);
    }
  }, [isExecuting]);

  function handleSendMessage() {
    const text = inputText.trim();
    if (!text) return;

    setInputText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // If no messages yet, this is the first message -> trigger wizard
    if (essentialMessages.length === 0) {
      onFirstMessage(text);
    } else {
      onSendMessage(text);
    }

    clearAttachments();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Always send: while a run is executing, the parent queues it instead of
      // rejecting it (queue-while-building).
      handleSendMessage();
    }
  }

  // B5 chip auto set/clear (bound decision B.D): the LOCAL heuristic runs at typing/draft
  // time, so the editing target is VISIBLE before the message sends (locked 6 - wrong
  // defaults are tolerable because the chip is overridable, and the send path attaches
  // reviseSheetId ONLY from this visible chip state, never by re-inferring). A manual
  // dismissal (null) suppresses auto-set until the next send; an explicit new-topic marker
  // clears back to auto; a manually SET target (e.g. a follow-up pill) stands.
  const applyEditIntentHeuristic = useCallback(
    (text: string) => {
      if (!sheetCardsActive || !sessionId) return;
      const intent = classifyEditIntent(text);
      const store = useOrchestrationStore.getState();
      const cur = store.editTargets[sessionId];
      if (intent === "new") {
        if (cur) store.setEditTarget(sessionId, undefined);
      } else if (intent === "edit" && cur === undefined) {
        const latest = store.sessionLatestSheet[sessionId];
        if (latest) store.setEditTarget(sessionId, latest);
      }
    },
    [sheetCardsActive, sessionId]
  );

  // Restore a draft into the composer (e.g. after Stop hands the cancelled
  // message back for editing, or a sheet follow-up pill). Consumed + cleared so
  // it applies once. Runs the chip heuristic too: a draft that bypassed typing
  // must surface its chip BEFORE send, exactly like typed text (locked 6).
  useEffect(() => {
    if (!sessionId || composerDraft == null) return;
    setInputText(composerDraft);
    setComposerDraft(sessionId, undefined);
    applyEditIntentHeuristic(composerDraft);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 128) + "px";
      }
    });
  }, [sessionId, composerDraft, setComposerDraft, applyEditIntentHeuristic]);

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
    applyEditIntentHeuristic(e.target.value);
  }

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

  const activityMessage = useOrchestrationStore((s) =>
    sessionId ? s.activityMessages[sessionId] : null
  );

  const isEmpty = essentialMessages.length === 0;
  const phase = sessionJob?.phase;
  const progress = sessionJob?.progress || 0;

  // Find the index of the last status message for pulse animation
  const lastStatusIdx = isExecuting
    ? essentialMessages.reduce(
        (last, msg, idx) =>
          msg.metadata?.type === 'status' ? idx : last,
        -1
      )
    : -1;

  // Last user message — that's where the Edit action lives. The retry handler
  // falls back to the message content if no retryContext is stored, so the button
  // shows even for sessions that predate this feature.
  const lastUserIdx = essentialMessages.reduce(
    (last, msg, idx) => (msg.role === 'user' ? idx : last),
    -1
  );
  const canEdit = !isExecuting && !!onEdit && lastUserIdx >= 0;

  // Last assistant message — that's where the Retry action lives.
  const lastAssistantIdx = essentialMessages.reduce(
    (last, msg, idx) => (msg.role === 'assistant' ? idx : last),
    -1
  );
  const canRetry = !isExecuting && !!onResend && lastAssistantIdx >= 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white border-r border-neutral-200 relative min-w-0">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-light">
        {isEmpty && !isExecuting ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
            <img
              src="/ekoa_logo.png"
              alt="Ekoa"
              className="w-14 h-14 object-contain mb-5"
            />
            <h2 className="text-lg font-medium text-neutral-800 mb-1.5 leading-tight">
              {pages.builder.whatToBuild}
            </h2>
            <p className="text-neutral-400 text-xs leading-relaxed max-w-[220px]">
              {pages.builder.chooseExample}
            </p>
          </div>
        ) : (
          <>
            {essentialMessages.map((msg, idx) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isPulsing={idx === lastStatusIdx}
                onEdit={canEdit && idx === lastUserIdx ? onEdit : undefined}
                onRetry={canRetry && idx === lastAssistantIdx ? onResend : undefined}
                summary={sheetCardsActive ? replySummaries?.[msg.id] : undefined}
                onOpenSheet={
                  sheetCardsActive && msg.role === "assistant" ? () => openSheetFor(msg) : undefined
                }
              />
            ))}

            {/* Live streaming agent text */}
            {isExecuting && sessionId && (
              <StreamingChatSection sessionId={sessionId} asSheetCard={sheetCardsActive} />
            )}

            {/* Progress indicator during execution. Build sessions gate on the
                job (its phase drives the message); plain chat turns have no job,
                so they must not be left indicator-less during the silent
                tool-use phase before the first streamed chunk. */}
            {isExecuting && (sessionJob || !isBuildSession) && (
              <div className="flex items-start space-x-2">
                <img
                  src="/ekoa_logo.png"
                  alt="Ekoa"
                  className="w-7 h-7 object-contain flex-shrink-0 mt-0.5"
                />
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center space-x-2">
                    <Spinner size="sm" className="text-teal-600" />
                    <span className="text-xs font-medium text-neutral-600 animate-pulse-subtle">
                      {activityMessage ||
                        (phase && getFriendlyPhaseMessage(phase, language)) ||
                        (isBuildSession
                          ? pages.builder.buildingInProgress
                          : pages.builder.thinkingInProgress)}
                    </span>
                  </div>
                  {progress > 0 && (
                    <div className="w-full bg-neutral-100 rounded-full h-1">
                      <div
                        className="bg-teal-600 h-1 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                  )}
                  {startTime !== null && (
                    <span className="text-xs text-neutral-400">
                      {elapsedTime < 60
                        ? `${elapsedTime}s`
                        : `${Math.floor(elapsedTime / 60)}m ${elapsedTime % 60}s`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-4 bg-white border-t border-neutral-100">
        {/* Quick actions */}
        {isEmpty && showExampleCards && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.title}
                  onClick={() => setInputText(action.prompt)}
                  className="flex items-center px-2.5 py-1.5 border border-neutral-200 text-neutral-500 hover:text-neutral-800 hover:border-neutral-400 hover:bg-neutral-50 rounded-lg transition-all cursor-pointer text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                >
                  <Icon size={13} className="mr-1.5 flex-shrink-0" />
                  {action.title}
                </button>
              );
            })}
          </div>
        )}

        {/* B5 composer chip (locked 6): the editing target is VISIBLE, never inferred
            silently. Sent messages default to revising this sheet; the X forces a new
            sheet for the next send. PT-PT: "A editar: <título da sheet>". */}
        {sheetCardsActive && editTarget && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            <div
              data-testid="composer-chip"
              className="flex items-center bg-teal-50 border border-teal-200 rounded-full pl-2.5 pr-1.5 py-1 text-xs text-teal-800"
              title={editTarget.title}
            >
              <Pencil size={12} className="mr-1.5 shrink-0 text-teal-600" />
              <span className="truncate max-w-[240px]">{sheetFeed.editingChip(editTarget.title)}</span>
              <button
                data-testid="composer-chip-dismiss"
                onClick={() => sessionId && setEditTarget(sessionId, null)}
                title={sheetFeed.editingChipDismiss}
                aria-label={sheetFeed.editingChipDismiss}
                className="ml-1 p-0.5 rounded-full text-teal-500 hover:text-teal-900 hover:bg-teal-100 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Attachment chips */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {pendingAttachments.map((att) => (
              <div
                key={att.attachmentId}
                className="flex items-center bg-neutral-100 border border-neutral-200 rounded-full px-2.5 py-1 text-xs text-neutral-600"
                title={att.path}
              >
                {att.type === "folder" ? (
                  <FolderOpen size={12} className="mr-1 text-neutral-400" />
                ) : (
                  <File size={12} className="mr-1 text-neutral-400" />
                )}
                <span className="truncate max-w-[120px]">{att.displayName}</span>
                <button
                  onClick={() => removeAttachment(att.attachmentId)}
                  className="ml-1 text-neutral-400 hover:text-neutral-700"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Queued messages — sent (FIFO) when the current run finishes */}
        {queuedMessages.length > 0 && (
          <div className="flex flex-col gap-1 mb-2">
            {queuedMessages.map((q, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 text-xs text-amber-800"
                title={q}
              >
                <span className="flex items-center min-w-0">
                  <Clock size={12} className="mr-1.5 flex-shrink-0 text-amber-500" />
                  <span className="truncate">{q}</span>
                </span>
                <button
                  onClick={() => sessionId && removeQueuedMessage(sessionId, i)}
                  className="ml-2 flex-shrink-0 text-amber-500 hover:text-amber-700"
                  title={chatPanelT.removeFromQueue}
                  aria-label={chatPanelT.removeFromQueue}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <span className="pl-0.5 text-[10px] text-neutral-400">
              {chatPanelT.queuedNotice}
            </span>
          </div>
        )}

        {/* Text input */}
        <div className="relative flex flex-col bg-white border border-neutral-300 rounded-xl focus-within:border-neutral-900 focus-within:ring-1 focus-within:ring-neutral-900/10 transition-shadow shadow-sm">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={isExecuting ? chatPanelT.queuePlaceholder : chatPanelT.describeYourApp}
            rows={2}
            className="w-full max-h-32 min-h-[60px] py-2 px-3 bg-transparent resize-none outline-none text-xs text-neutral-800 placeholder-neutral-400 disabled:opacity-50"
          />
          <div className="flex justify-between items-center p-1.5 border-t border-neutral-100 bg-neutral-50/50">
            <div className="relative" ref={attachMenuRef}>
              <button
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                disabled={isExecuting}
                className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                title={chatPanelT.attachFile}
              >
                <Paperclip size={16} />
              </button>
              <ComposerAttachMenu
                open={showAttachMenu}
                onClose={() => setShowAttachMenu(false)}
                onUploadFile={handleAttachFile}
                onUploadFolder={handleAttachFolder}
              />
            </div>
            {isExecuting ? (
              <div className="flex items-center gap-1">
                {/* Queue the typed message while a run is in progress */}
                {inputText.trim() && (
                  <button
                    onClick={handleSendMessage}
                    className="p-1.5 rounded transition-colors text-teal-700 hover:text-teal-900 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                    title={chatPanelT.queueMessage}
                    aria-label={chatPanelT.queueMessage}
                  >
                    <Send size={16} />
                  </button>
                )}
                <button
                  onClick={onCancel}
                  className="p-1.5 rounded transition-colors text-red-500 hover:text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  title={chatPanelT.cancelBuild}
                >
                  <Square size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={handleSendMessage}
                disabled={!inputText.trim()}
                className="p-1.5 rounded transition-colors disabled:text-neutral-300 text-teal-700 hover:text-teal-900 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                title={chatPanelT.sendMessage}
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ============================================
// SUMMARY CARD (B5, locked decisions 3 + 8)
// ============================================

/**
 * The compact transcript representation of an assistant reply (locked 3: card left, full
 * sheet right - no inline-vs-panel threshold). Placeholder shape = the reply's first line
 * (while streaming, after reload, and whenever the post-run summary never arrived - B.E
 * degradation); the B2 `reply_summary` upgrades it to title + summary. Revision turns carry
 * the "Revisão N" framing and clicking ANY card focuses ITS sheet in the panel (locked 5:
 * several cards, one sheet) through the store's focus seam - never the feed's DOM.
 */
function SummaryCard({
  message,
  summary,
  onOpen,
}: {
  message: ChatMessage;
  summary?: ReplySummaryEntry;
  onOpen: () => void;
}) {
  const { sheetFeed } = useTranslation();
  const revisionNumber = summary?.revision ?? message.metadata?.revisionNumber;
  const revisionLabel = revisionNumber !== undefined ? sheetFeed.revisionCard(revisionNumber) : null;
  return (
    <button
      data-testid="summary-card"
      onClick={onOpen}
      title={sheetFeed.summaryCardOpen}
      className="group/card w-full text-left bg-white border border-neutral-200 rounded-lg px-3 py-2 shadow-sm transition-colors hover:border-teal-300 hover:bg-teal-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 cursor-pointer"
    >
      {summary ? (
        <>
          <span className="flex items-center gap-1.5 min-w-0 text-xs font-semibold text-neutral-800">
            <FileText size={12} className="shrink-0 text-teal-600" />
            <span data-testid="summary-card-title" className="truncate">
              {revisionLabel ? `${revisionLabel} · ${summary.title}` : summary.title}
            </span>
          </span>
          <span
            data-testid="summary-card-summary"
            className="block mt-0.5 pl-[18px] text-[11px] leading-relaxed text-neutral-500"
          >
            {summary.summary}
          </span>
        </>
      ) : (
        <span className="flex items-center gap-1.5 min-w-0 text-xs text-neutral-700">
          <FileText size={12} className="shrink-0 text-neutral-400" />
          <span data-testid="summary-card-placeholder" className="truncate">
            {revisionLabel ? `${revisionLabel} · ` : ""}
            {firstLineOf(message.content)}
          </span>
        </span>
      )}
    </button>
  );
}

// ============================================
// MESSAGE BUBBLE
// ============================================

function MessageBubble({
  message,
  isPulsing = false,
  onEdit,
  onRetry,
  summary,
  onOpenSheet,
}: {
  message: ChatMessage;
  isPulsing?: boolean;
  onEdit?: () => void;
  onRetry?: () => void;
  /** B5: the reply_summary attached to this turn (chat sessions only). */
  summary?: ReplySummaryEntry;
  /** B5: present = render the assistant turn as a summary CARD whose click focuses its
   *  sheet (locked 3); absent = classic full-markdown bubble (build sessions). */
  onOpenSheet?: () => void;
}) {
  const { chatPanel: chatPanelT } = useTranslation();
  const language = useI18nStore((s) => s.language);
  const [isDetailExpanded, setIsDetailExpanded] = useState(false);
  // Refused-build feed (BRIEF 9a): file the pre-drafted request carried on a
  // capability-refusal message to the org-admin queue. Local per-bubble state only;
  // the request itself lives in the change-requests store.
  const [refusalState, setRefusalState] = useState<'idle' | 'filing' | 'filed' | 'failed'>('idle');
  const fileFromRefusal = useChangeRequestsStore((s) => s.fileFromRefusal);

  // Look up output entries for this message's job
  const sessionId = useOrchestrationStore((s) => s.activeSessionId);
  const outputEntries = useOrchestrationStore((s) => {
    if (!sessionId || !message.metadata?.jobId) return null;
    const job = s.sessionJobs[sessionId];
    if (!job || job.jobId !== message.metadata.jobId) return null;
    return job.output;
  });

  if (message.role === "user") {
    const atts = message.metadata?.attachments;
    return (
      <div className="group flex justify-end">
        <div className="max-w-[90%]">
          {atts && atts.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1 mb-1">
              {atts.map((att, i) => {
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
                    key={i}
                    className="flex items-center bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1 text-[10px] text-neutral-300"
                  >
                    <Icon size={11} className="mr-1 text-neutral-400" />
                    <span className="truncate max-w-[160px]">{att.displayName}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="bg-neutral-900 border border-neutral-900 text-white px-3 py-2 rounded-xl rounded-tr-sm text-xs whitespace-pre-wrap shadow-sm">
            {message.content}
          </div>
          <div className="flex items-center justify-end gap-2 mt-1">
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton content={message.content} />
              {onEdit && (
                <button
                  onClick={onEdit}
                  title={language === "pt" ? "Editar mensagem" : "Edit message"}
                  className="p-1 rounded text-neutral-400 hover:text-neutral-800 transition-colors"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
            <span className="text-[10px] text-neutral-400">
              {formatTimestamp(message.timestamp, language)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  const isError = message.metadata?.type === "error";
  const isStatus = message.metadata?.type === "status";
  const isSkill = message.metadata?.type === "skill";
  const isActivity = message.metadata?.type === "activity";
  const isSubtle = isStatus || isSkill || isActivity;
  const hasDetails = outputEntries && outputEntries.length > 0;

  return (
    <div className="group flex justify-start items-start space-x-2">
      <img
        src="/ekoa_logo.png"
        alt="Ekoa"
        className="w-7 h-7 object-contain flex-shrink-0 mt-0.5"
      />
      <div className="flex-1 space-y-1 min-w-0">
        <div className="text-xs font-medium text-neutral-800 flex items-center justify-between">
          <span>{chatPanelT.ekoaAgent}</span>
          <div className="flex items-center space-x-1">
            {hasDetails && (
              <button
                onClick={() => setIsDetailExpanded(!isDetailExpanded)}
                className="p-0.5 text-neutral-400 hover:text-neutral-600 rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-400"
                title={isDetailExpanded ? "Hide details" : "Show details"}
              >
                <ChevronDown
                  size={12}
                  className={`transition-transform duration-200 ${
                    isDetailExpanded ? "rotate-180" : ""
                  }`}
                />
              </button>
            )}
            <span className="text-[10px] text-neutral-400 font-normal">
              {formatTimestamp(message.timestamp, language)}
            </span>
          </div>
        </div>

        {/* Collapsed (re-expandable) thinking section for this turn */}
        {message.role === "assistant" && message.metadata?.thinking && (
          <ThinkingBlock
            text={message.metadata.thinking}
            durationMs={message.metadata.thinkingDurationMs}
          />
        )}

        {/* Message content */}
        {isError || isSubtle ? (
          <div
            className={`text-xs leading-relaxed whitespace-pre-wrap break-words ${
              isError
                ? "text-red-600"
                : "text-neutral-500 italic"
            } ${isPulsing ? "animate-pulse-subtle" : ""}`}
          >
            {isError && (
              <AlertCircle
                size={12}
                className="inline mr-1 text-red-500 -mt-0.5"
              />
            )}
            {message.content}
            {isError && onRetry && (
              <div className="mt-2">
                <button
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-neutral-300 bg-white text-neutral-700 hover:border-teal-600 hover:text-teal-700 transition-colors"
                >
                  <RefreshCw size={12} />
                  {language === "pt" ? "Tentar novamente" : "Try again"}
                </button>
              </div>
            )}
            {isError && message.metadata?.refusal && (
              <div className="mt-2 not-italic">
                {refusalState === "filed" ? (
                  <span
                    data-testid="chat-refusal-filed"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600"
                  >
                    <CheckCircle2 size={12} className="text-teal-600" />
                    {language === "pt"
                      ? "Pedido enviado ao administrador."
                      : "Request sent to the administrator."}
                  </span>
                ) : (
                  <button
                    data-testid="chat-refusal-file"
                    disabled={refusalState === "filing"}
                    onClick={async () => {
                      if (refusalState === "filing") return;
                      setRefusalState("filing");
                      const filed = await fileFromRefusal(message.metadata!.refusal!);
                      setRefusalState(filed ? "filed" : "failed");
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-neutral-300 bg-white text-neutral-700 hover:border-teal-600 hover:text-teal-700 transition-colors disabled:opacity-60"
                  >
                    <Send size={12} />
                    {refusalState === "filing"
                      ? language === "pt" ? "A enviar..." : "Sending..."
                      : refusalState === "failed"
                        ? language === "pt" ? "Tentar enviar novamente" : "Try sending again"
                        : language === "pt" ? "Pedir ao administrador" : "Ask the administrator"}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : onOpenSheet ? (
          /* B5 summary card (locked 3): the full reply lives in the sheet panel; the
             transcript carries the compact card. Redaction still applies to the
             placeholder line (it renders raw reply text). */
          <SummaryCard
            message={{ ...message, content: redactProviderIdentity(message.content) }}
            summary={summary}
            onOpen={onOpenSheet}
          />
        ) : (
          <div
            className={`text-xs leading-relaxed break-words text-neutral-700 chat-markdown ${
              isPulsing ? "animate-pulse-subtle" : ""
            }`}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {stripCodeBlocks(
                message.role === "assistant"
                  ? redactProviderIdentity(message.content)
                  : message.content
              )}
            </ReactMarkdown>
          </div>
        )}

        {/* FC-402: per-turn trust chip. Renders only on assistant turns that
            touched local files (dormant in the hosted-only build). */}
        {message.role === "assistant" && !isError && (
          <TrustChip activity={message.metadata?.localFileActivity} />
        )}

        {/* Copy/Retry/Feedback actions + memory usage (assistant messages only) */}
        {!isError && !isStatus && message.role === 'assistant' && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <CopyButton content={message.content} />
              {onRetry && (
                <button
                  onClick={onRetry}
                  title={language === "pt" ? "Tentar novamente" : "Retry"}
                  className="p-1 rounded text-neutral-300 hover:text-teal-600 transition-colors"
                >
                  <RefreshCw size={12} />
                </button>
              )}
              {message.metadata?.traceId && (
                <FeedbackButtons traceId={message.metadata.traceId} />
              )}
            </div>
            {message.metadata?.memoriesUsed != null && message.metadata.memoriesUsed > 0 && (
              <div className="text-[10px] text-neutral-400">
                Used {message.metadata.memoriesUsed} {message.metadata.memoriesUsed === 1 ? 'memory' : 'memories'}
              </div>
            )}
          </div>
        )}

        {/* Build status card */}
        {message.metadata?.type === "status" &&
          message.metadata?.jobId && (
            <div className="border-l-2 border-neutral-800 pl-3 py-1 mt-1">
              <div className="bg-white border border-neutral-200 rounded p-2">
                <div className="flex items-center space-x-1.5 text-xs font-medium text-neutral-800">
                  <CheckCircle2 size={14} className="text-neutral-800" />
                  <span>{chatPanelT.buildInitiated}</span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-0.5">
                  {chatPanelT.outputAvailable}
                </p>
              </div>
            </div>
          )}

        {/* Expandable detail section */}
        {isDetailExpanded && hasDetails && (
          <MessageDetail entries={outputEntries} />
        )}
      </div>
    </div>
  );
}

// ============================================
// FEEDBACK BUTTONS
// ============================================

function FeedbackButtons({ traceId }: { traceId: string }) {
  const { chatPanel: chatPanelT } = useTranslation();
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleFeedback(type: 'positive' | 'negative') {
    if (feedback || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await api.memories.submitSignal({ runId: traceId, signal: type });
      setFeedback(type);
    } catch {
      // Silently fail - feedback is optional
    }
    setIsSubmitting(false);
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => handleFeedback('positive')}
        disabled={!!feedback || isSubmitting}
        className={`p-1 rounded transition-colors ${
          feedback === 'positive'
            ? 'text-teal-600'
            : feedback === 'negative'
            ? 'text-neutral-200'
            : 'text-neutral-300 hover:text-teal-600'
        }`}
        title={chatPanelT.feedbackHelpful}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        onClick={() => handleFeedback('negative')}
        disabled={!!feedback || isSubmitting}
        className={`p-1 rounded transition-colors ${
          feedback === 'negative'
            ? 'text-red-500'
            : feedback === 'positive'
            ? 'text-neutral-200'
            : 'text-neutral-300 hover:text-red-500'
        }`}
        title={chatPanelT.feedbackNotHelpful}
      >
        <ThumbsDown size={12} />
      </button>
    </div>
  );
}

// ============================================
// COPY BUTTON
// ============================================

function CopyButton({ content }: { content: string }) {
  const { chatPanel: chatPanelT } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied — silently ignore
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? chatPanelT.copiedMessage : chatPanelT.copyMessage}
      className="p-1 rounded text-neutral-300 hover:text-neutral-600 transition-colors"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

// ============================================
// MESSAGE DETAIL (expandable output entries)
// ============================================

function MessageDetail({ entries }: { entries: OutputEntry[] }) {
  // Filter to interesting entries (tool calls, errors, status changes)
  const detailEntries = entries.filter(
    (e) =>
      e.type === "tool_use" ||
      e.type === "tool_result" ||
      e.type === "error" ||
      e.type === "status" ||
      e.type === "terminal" ||
      e.type === "skill"
  );

  if (detailEntries.length === 0) {
    return (
      <div className="mt-1 bg-neutral-100 border border-neutral-200 rounded-md p-2 text-[10px] text-neutral-500 font-mono">
        No tool activity recorded.
      </div>
    );
  }

  return (
    <div className="mt-1 bg-neutral-900 border border-neutral-700 rounded-md overflow-hidden">
      <div className="max-h-48 overflow-y-auto p-2 space-y-1 scrollbar-dark">
        {detailEntries.map((entry) => (
          <DetailLine key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function DetailLine({ entry }: { entry: OutputEntry }) {
  const isToolUse = entry.type === "tool_use";
  const isToolResult = entry.type === "tool_result";
  const isError = entry.type === "error";
  const isTerminal = entry.type === "terminal";

  // Extract file paths from tool input for display
  let fileInfo = "";
  if (isToolUse && entry.toolInput) {
    const path =
      (entry.toolInput.file_path as string) ||
      (entry.toolInput.path as string) ||
      (entry.toolInput.filePath as string) ||
      "";
    if (path) {
      // Show only the last 2 path segments for brevity
      const segments = path.split("/");
      fileInfo = segments.length > 2
        ? ".../" + segments.slice(-2).join("/")
        : path;
    }
  }

  return (
    <div className="text-[10px] font-mono leading-snug">
      {isToolUse && (
        <div className="text-teal-400">
          <span className="text-neutral-500 select-none">&gt; </span>
          <span className="font-semibold">{entry.toolName || "tool"}</span>
          {fileInfo && (
            <span className="text-neutral-400 ml-1">{fileInfo}</span>
          )}
        </div>
      )}
      {isToolResult && (
        <div className="text-neutral-400 truncate pl-2.5">
          {entry.content.length > 120
            ? entry.content.slice(0, 120) + "..."
            : entry.content}
        </div>
      )}
      {isError && (
        <div className="text-red-400">
          <span className="text-red-500 select-none">! </span>
          {entry.content}
        </div>
      )}
      {entry.type === "status" && (
        <div className="text-neutral-500 italic">
          {entry.content}
        </div>
      )}
      {isTerminal && (
        <div className="text-neutral-300">
          <span className="text-neutral-500 select-none">$ </span>
          {entry.content}
        </div>
      )}
      {entry.type === "skill" && (
        <div className="text-amber-400 italic">
          {entry.content}
        </div>
      )}
    </div>
  );
}

// ============================================
// STREAMING CHAT BUBBLE (live agent text)
// ============================================

/** Isolated component to avoid re-rendering the entire message list on every rAF tick.
 *  Renders the live thinking section (auto-expanded until the answer starts, then it
 *  collapses) above the streamed answer. Both surfaces render through the provider-identity
 *  redactor — applied to the ACCUMULATED buffer, so a name split across chunks can never
 *  flash on screen (the historical "sonnet" leak). In chat sessions (`asSheetCard`) the
 *  streamed answer renders as the summary card's PLACEHOLDER - the truncated first line
 *  (locked decision 8) - because the full reply's home is the sheet panel, not the rail. */
function StreamingChatSection({ sessionId, asSheetCard }: { sessionId: string; asSheetCard?: boolean }) {
  const text = useOrchestrationStore((s) => s.streamingChat[sessionId] || '');
  const thinking = useOrchestrationStore((s) => s.streamingThinking[sessionId] || '');
  const stripped = stripCodeBlocks(redactProviderIdentity(text)).trim();
  if (!stripped && !thinking.trim()) return null;
  return (
    <div className="flex justify-start items-start space-x-2">
      <img
        src="/ekoa_logo.png"
        alt="Ekoa"
        className="w-7 h-7 object-contain flex-shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0">
        {thinking.trim() && <ThinkingBlock text={thinking} live={!stripped} />}
        {stripped && asSheetCard ? (
          <div
            data-testid="summary-card-streaming"
            className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 shadow-sm"
          >
            <span className="flex items-center gap-1.5 min-w-0 text-xs text-neutral-700">
              <FileText size={12} className="shrink-0 text-neutral-400 animate-pulse" />
              <span className="truncate">{firstLineOf(stripped)}</span>
              <span className="inline-block w-0.5 h-3.5 bg-teal-600 shrink-0 animate-pulse" />
            </span>
          </div>
        ) : stripped ? (
          <div className="text-xs leading-relaxed break-words text-neutral-700 chat-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {stripped}
            </ReactMarkdown>
            <span className="inline-block w-0.5 h-3.5 bg-teal-600 ml-0.5 -mb-0.5 animate-pulse" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Absolute date + time (with seconds) so messages carry a permanent timestamp
 *  instead of a relative "N minutes ago" label that goes stale. */
function formatTimestamp(ts: string, language: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(language === "pt" ? "pt-PT" : "en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}
