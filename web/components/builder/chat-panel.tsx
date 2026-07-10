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
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { ComposerAttachMenu } from "@/components/privacy/composer-attach-menu";
import { TrustChip } from "@/components/privacy/trust-chip";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { redactProviderIdentity } from "@/lib/sanitize-error";
import { useOrchestrationStore, type ChatMessage, type OutputEntry } from "@/stores/orchestration";
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
  const { quickActions: quickActionsTranslations, chatPanel: chatPanelT, pages } = useTranslation();
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

  // Restore a draft into the composer (e.g. after Stop hands the cancelled
  // message back for editing). Consumed + cleared so it applies once.
  useEffect(() => {
    if (!sessionId || composerDraft == null) return;
    setInputText(composerDraft);
    setComposerDraft(sessionId, undefined);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 128) + "px";
      }
    });
  }, [sessionId, composerDraft, setComposerDraft]);

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
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
              />
            ))}

            {/* Live streaming agent text */}
            {isExecuting && sessionId && (
              <StreamingChatSection sessionId={sessionId} />
            )}

            {/* Progress indicator during execution */}
            {isExecuting && sessionJob && (
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
                  title="Remove from queue"
                  aria-label="Remove queued message"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <span className="pl-0.5 text-[10px] text-neutral-400">
              {language === "pt"
                ? "Em fila — enviado quando a execução atual terminar"
                : "Queued — sends when the current run finishes"}
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
            placeholder={
              isExecuting
                ? language === "pt"
                  ? "Escreva para pôr em fila…"
                  : "Type to queue a message…"
                : chatPanelT.describeYourApp
            }
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
                    title={language === "pt" ? "Pôr mensagem em fila" : "Queue message"}
                    aria-label="Queue message"
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
// MESSAGE BUBBLE
// ============================================

function MessageBubble({
  message,
  isPulsing = false,
  onEdit,
  onRetry,
}: {
  message: ChatMessage;
  isPulsing?: boolean;
  onEdit?: () => void;
  onRetry?: () => void;
}) {
  const { chatPanel: chatPanelT } = useTranslation();
  const language = useI18nStore((s) => s.language);
  const [isDetailExpanded, setIsDetailExpanded] = useState(false);

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
          </div>
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
        title="Helpful response"
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
        title="Not helpful"
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
      title={copied ? "Copied" : "Copy"}
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
 *  flash on screen (the historical "sonnet" leak). */
function StreamingChatSection({ sessionId }: { sessionId: string }) {
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
        {stripped && (
          <div className="text-xs leading-relaxed break-words text-neutral-700 chat-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {stripped}
            </ReactMarkdown>
            <span className="inline-block w-0.5 h-3.5 bg-teal-600 ml-0.5 -mb-0.5 animate-pulse" />
          </div>
        )}
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
