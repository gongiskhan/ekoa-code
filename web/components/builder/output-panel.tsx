"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  Copy,
  ArrowDown,
  Terminal,
  Pencil,
  Eye,
  Play,
  FileText,
  FolderOpen,
  Search,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Info,
  Zap,
  Clock,
  BookOpen,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useOrchestrationStore, type OutputEntry } from "@/stores/orchestration";
import { useTranslation } from "@/stores/i18n";
import { copyToClipboard } from "@/lib/clipboard";

// ============================================
// CONSTANTS
// ============================================

const TOOL_RESULT_COLLAPSE_THRESHOLD = 300;

// ============================================
// MARKDOWN COMPONENTS (dark theme)
// ============================================

const darkMarkdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-sm font-bold text-neutral-100 mt-2 mb-1">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xs font-bold text-neutral-100 mt-1.5 mb-1">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-xs font-semibold text-neutral-200 mt-1 mb-0.5">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-1 last:mb-0 text-neutral-300 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-4 mb-1 space-y-0.5 text-neutral-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-4 mb-1 space-y-0.5 text-neutral-300">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-[11px] leading-relaxed">{children}</li>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-teal-400 hover:underline"
    >
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className="block text-[11px] leading-snug text-emerald-300">{children}</code>
      );
    }
    return (
      <code className="bg-neutral-700 text-amber-300 rounded px-1 py-0.5 text-[11px] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-neutral-800/80 text-neutral-200 rounded p-2 my-1 overflow-x-auto text-[11px] font-mono leading-snug border border-neutral-700/50">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-neutral-600 pl-2 my-1 italic text-neutral-400">
      {children}
    </blockquote>
  ),
  strong: ({ children }) => (
    <strong className="text-neutral-100 font-semibold">{children}</strong>
  ),
};

// ============================================
// HELPERS
// ============================================

/** Get left border color class for entry type */
function getEntryBorderColor(type: OutputEntry["type"]): string {
  switch (type) {
    case "tool_use":
      return "border-l-cyan-500";
    case "tool_result":
      return "border-l-emerald-600/50";
    case "text":
      return "border-l-neutral-700";
    case "status":
      return "border-l-green-500";
    case "progress":
      return "border-l-amber-500";
    case "error":
      return "border-l-red-500";
    case "system":
      return "border-l-blue-500";
    case "terminal":
      return "border-l-neutral-500";
    case "skill":
      return "border-l-amber-500";
    default:
      return "border-l-neutral-700";
  }
}

/** Get background highlight for certain entry types */
function getEntryBgColor(type: OutputEntry["type"]): string {
  switch (type) {
    case "status":
      return "bg-green-950/30";
    case "error":
      return "bg-red-950/30";
    case "system":
      return "bg-blue-950/20";
    default:
      return "";
  }
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Calculate relative timestamp from a reference time */
function formatRelativeTime(ts: string, referenceTs: string): string {
  try {
    const current = new Date(ts).getTime();
    const reference = new Date(referenceTs).getTime();
    const diffMs = current - reference;
    if (diffMs < 0 || isNaN(diffMs)) return "";
    if (diffMs < 1000) return "+0.0s";
    const seconds = diffMs / 1000;
    if (seconds < 60) return `+${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSecs = seconds % 60;
    return `+${minutes}m${remainingSecs.toFixed(0)}s`;
  } catch {
    return "";
  }
}

/** Get tool icon based on tool name */
function getToolIcon(toolName: string) {
  const name = toolName.toLowerCase();
  if (name.includes("write") || name.includes("create")) return Pencil;
  if (name.includes("edit") || name.includes("replace") || name.includes("patch")) return Pencil;
  if (name.includes("read") || name.includes("view") || name.includes("cat")) return Eye;
  if (name.includes("bash") || name.includes("exec") || name.includes("run") || name.includes("command") || name.includes("shell")) return Play;
  if (name.includes("search") || name.includes("grep") || name.includes("find") || name.includes("glob")) return Search;
  if (name.includes("list") || name.includes("ls") || name.includes("dir")) return FolderOpen;
  return FileText;
}

/** Get a human-readable description of what the tool does */
function getToolAction(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.includes("write") || name === "write_file") return "Writing file";
  if (name.includes("edit") || name === "edit_file" || name.includes("replace")) return "Editing file";
  if (name.includes("read") || name === "read_file" || name === "view") return "Reading file";
  if (name.includes("bash") || name.includes("exec") || name.includes("command") || name.includes("shell")) return "Running command";
  if (name.includes("search") || name.includes("grep")) return "Searching";
  if (name.includes("glob") || name.includes("find")) return "Finding files";
  if (name.includes("list") || name.includes("ls")) return "Listing directory";
  if (name.includes("delete") || name.includes("remove")) return "Deleting";
  if (name.includes("create")) return "Creating";
  if (name.includes("patch")) return "Patching file";
  return "Using tool";
}

/** Extract the primary target from tool input (file path, command, etc.) */
function getToolTarget(toolInput?: Record<string, unknown>): string | null {
  if (!toolInput) return null;
  const path = toolInput.file_path || toolInput.path || toolInput.filename;
  if (typeof path === "string") return path;
  const command = toolInput.command || toolInput.cmd;
  if (typeof command === "string") return command;
  const pattern = toolInput.pattern || toolInput.query || toolInput.search;
  if (typeof pattern === "string") return pattern;
  return null;
}

/** Format duration in a human-readable way */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m${seconds}s`;
}

// ============================================
// SUB-COMPONENTS
// ============================================

/** Collapsible content block for tool results */
function CollapsibleResult({
  content,
  isSuccess,
  toolName,
  toolDuration,
}: {
  content: string;
  isSuccess?: boolean;
  toolName?: string;
  toolDuration?: number;
}) {
  const isLong = content.length > TOOL_RESULT_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);

  const successIndicator = isSuccess !== undefined ? (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${isSuccess ? "text-emerald-400" : "text-red-400"}`}>
      {isSuccess ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
      {isSuccess ? "OK" : "Failed"}
    </span>
  ) : null;

  return (
    <div className="mt-0.5">
      {/* Result header bar */}
      <div className="flex items-center gap-2 text-[10px]">
        {successIndicator}
        {toolName && (
          <span className="text-neutral-600">{toolName}</span>
        )}
        {toolDuration !== undefined && (
          <span className="text-neutral-600 flex items-center gap-0.5">
            <Clock size={9} />
            {formatDuration(toolDuration)}
          </span>
        )}
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-0.5 text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            {expanded ? "collapse" : `expand (${content.length} chars)`}
          </button>
        )}
      </div>

      {/* Result content */}
      {(expanded || !isLong) && content.trim().length > 0 && (
        <div className="mt-1 bg-neutral-800/50 rounded border border-neutral-700/30 p-2 overflow-x-auto">
          <pre className="text-[11px] leading-relaxed text-neutral-400 font-mono whitespace-pre-wrap break-all">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Tool use entry with icon, action label, tool name, and target */
function ToolUseEntry({ entry }: { entry: OutputEntry }) {
  const ToolIcon = getToolIcon(entry.toolName || "");
  const action = getToolAction(entry.toolName || "");
  const target = getToolTarget(entry.toolInput);

  return (
    <div className="flex items-start gap-2">
      <span className="text-cyan-400 mt-0.5 flex-shrink-0">
        <ToolIcon size={12} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-cyan-300 font-bold text-xs">
            {entry.toolName || "tool"}
          </span>
          <span className="text-neutral-500 text-[10px]">
            {action}
          </span>
        </div>
        {target && (
          <div className="text-teal-400/80 text-[11px] font-mono mt-0.5 truncate" title={target}>
            {target}
          </div>
        )}
      </div>
    </div>
  );
}

/** Status entry with highlighted bar */
function StatusEntry({ entry }: { entry: OutputEntry }) {
  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded bg-green-950/30 border border-green-900/30">
      <Zap size={12} className="text-green-400 flex-shrink-0" />
      <span className="text-green-300 font-semibold text-xs">
        {entry.content}
      </span>
    </div>
  );
}

/** Error entry with red background */
function ErrorEntry({ entry }: { entry: OutputEntry }) {
  return (
    <div className="flex items-start gap-2 py-1 px-2 rounded bg-red-950/30 border border-red-900/30">
      <XCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
      <div className="text-red-300 text-xs whitespace-pre-wrap break-all">
        {entry.content}
      </div>
    </div>
  );
}

/** System entry with blue tint */
function SystemEntry({ entry }: { entry: OutputEntry }) {
  return (
    <div className="flex items-start gap-2">
      <Info size={12} className="text-blue-400 flex-shrink-0 mt-0.5" />
      <span className="text-blue-300 text-xs">
        {entry.content}
      </span>
    </div>
  );
}

/** Skill entry with amber accent */
function SkillEntry({ entry }: { entry: OutputEntry }) {
  return (
    <div className="flex items-center gap-2">
      <BookOpen size={12} className="text-amber-400 flex-shrink-0" />
      <span className="text-amber-300 text-xs">{entry.content}</span>
    </div>
  );
}

/** Resumed-session status block shown in the Output tab when the live SSE
 *  transcript is empty but the session has a built artifact attached (i.e.
 *  the user reloaded or opened the artifact from /artifacts). Matches the
 *  light-status-block layout decided in the plan. */
function ResumedBuildStatus({
  lastBuildAt,
  status,
  appUrl,
}: {
  lastBuildAt: string | null;
  status: string;
  appUrl: string | null;
}) {
  const isError = status === 'failed' || status === 'cancelled';
  const statusLabel = isError ? `error (${status})` : 'success';
  let lastBuildLabel = '—';
  if (lastBuildAt) {
    try {
      const d = new Date(lastBuildAt);
      lastBuildLabel = d.toLocaleString();
    } catch {
      lastBuildLabel = lastBuildAt;
    }
  }
  return (
    <div className="w-full max-w-md text-left font-mono text-xs text-neutral-400 px-4">
      <div className="flex items-center gap-2 mb-3">
        <Terminal size={14} className="text-neutral-500" />
        <span className="text-neutral-300">No live output for this session.</span>
      </div>
      <div className="bg-neutral-800/50 border border-neutral-700/40 rounded p-3 space-y-1.5">
        <div className="flex">
          <span className="w-20 shrink-0 text-neutral-500">Last build:</span>
          <span className="text-neutral-200">{lastBuildLabel}</span>
        </div>
        <div className="flex">
          <span className="w-20 shrink-0 text-neutral-500">Status:</span>
          <span className={isError ? 'text-red-300' : 'text-emerald-300'}>{statusLabel}</span>
        </div>
        {appUrl && (
          <div className="flex">
            <span className="w-20 shrink-0 text-neutral-500">Bundle:</span>
            <span className="text-teal-300 truncate">{appUrl}</span>
          </div>
        )}
      </div>
      <p className="mt-3 text-neutral-500 text-[11px] leading-relaxed">
        Run a follow-up to stream new output.
      </p>
    </div>
  );
}

/** Collapsible text block for long text entries */
const TEXT_COLLAPSE_THRESHOLD = 500;

function CollapsibleText({ content }: { content: string }) {
  const isLong = content.length > TEXT_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);

  return (
    <div className="text-xs text-neutral-200 prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={darkMarkdownComponents}
      >
        {expanded ? content : content.slice(0, TEXT_COLLAPSE_THRESHOLD)}
      </ReactMarkdown>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-0.5 mt-1 text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {expanded ? "collapse" : `show more (${content.length} chars)`}
        </button>
      )}
    </div>
  );
}

// ============================================
// PROPS
// ============================================

interface OutputPanelProps {
  sessionId: string | null;
}

const EMPTY_OUTPUT: OutputEntry[] = [];

// ============================================
// COMPONENT
// ============================================

export default function OutputPanel({ sessionId }: OutputPanelProps) {
  const { outputPanel: op } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  const isExecuting = useOrchestrationStore((s) => s.isExecuting);
  const output = useOrchestrationStore((s) =>
    sessionId ? s.sessionJobs[sessionId]?.output || EMPTY_OUTPUT : EMPTY_OUTPUT
  );
  const job = useOrchestrationStore((s) =>
    sessionId ? s.sessionJobs[sessionId] : null,
  );
  const previewAppUrl = useOrchestrationStore((s) =>
    sessionId ? s.sessionPreviews[sessionId]?.appUrl ?? null : null,
  );

  // Get the first entry timestamp for relative time calculation
  const firstTimestamp = output.length > 0 ? output[0].timestamp : null;

  // Auto-scroll logic
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output.length, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  const copyOutput = useCallback(() => {
    const text = output
      .map((e) => {
        const ts = formatTimestamp(e.timestamp);
        const prefix = ts ? `[${ts}] ` : "";
        if (e.type === "tool_use") {
          const action = getToolAction(e.toolName || "");
          const target = getToolTarget(e.toolInput);
          return `${prefix}[${e.toolName}] ${action}${target ? " " + target : ""}`;
        }
        return `${prefix}${e.content}`;
      })
      .join("\n");

    void copyToClipboard(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [output]);

  // Memoize rendered output entries
  const renderedEntries = useMemo(() => {
    const elements: React.ReactNode[] = [];
    let currentPhase: string | null = null;

    for (let i = 0; i < output.length; i++) {
      const entry = output[i];

      // Insert phase separator when phase changes
      if (entry.phase && entry.phase !== currentPhase) {
        currentPhase = entry.phase;
        const phaseTs = formatTimestamp(entry.timestamp);
        elements.push(
          <div key={`phase-${i}`} className="flex items-center my-3 first:mt-1">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-600/60 to-transparent" />
            <div className="mx-3 flex items-center gap-2 px-3 py-1 bg-neutral-800 rounded-full border border-neutral-700/50">
              <span className="text-[10px] font-bold text-teal-300 uppercase tracking-widest">
                {entry.phase}
              </span>
              {phaseTs && (
                <span className="text-[9px] text-neutral-500 font-mono">
                  {phaseTs}
                </span>
              )}
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-600/60 to-transparent" />
          </div>
        );
      }

      const borderColor = getEntryBorderColor(entry.type);
      const bgColor = getEntryBgColor(entry.type);
      const relativeTime = firstTimestamp
        ? formatRelativeTime(entry.timestamp, firstTimestamp)
        : "";

      elements.push(
        <div
          key={entry.id || i}
          className={`flex items-start group border-l-2 ${borderColor} ${bgColor} pl-2.5 py-0.5 hover:bg-neutral-800/30 transition-colors`}
        >
          {/* Relative timestamp */}
          <span className="text-neutral-600 text-[10px] w-14 flex-shrink-0 font-mono select-none mt-0.5 text-right pr-2">
            {relativeTime}
          </span>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {entry.type === "tool_use" ? (
              <ToolUseEntry entry={entry} />
            ) : entry.type === "tool_result" ? (
              <CollapsibleResult
                content={entry.content}
                isSuccess={entry.isSuccess}
                toolName={entry.toolName}
                toolDuration={entry.toolDuration}
              />
            ) : entry.type === "status" ? (
              <StatusEntry entry={entry} />
            ) : entry.type === "error" ? (
              <ErrorEntry entry={entry} />
            ) : entry.type === "system" ? (
              <SystemEntry entry={entry} />
            ) : entry.type === "skill" ? (
              <SkillEntry entry={entry} />
            ) : entry.type === "progress" ? (
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                <span className="text-amber-300 text-xs">{entry.content}</span>
              </div>
            ) : entry.type === "text" ? (
              <CollapsibleText content={entry.content} />
            ) : (
              <div className="whitespace-pre-wrap break-all text-xs text-neutral-300">
                {entry.content}
              </div>
            )}
          </div>
        </div>
      );
    }

    return elements;
  }, [output, firstTimestamp]);

  const isEmpty = output.length === 0;

  return (
    <div className="flex-1 flex flex-col bg-neutral-900 min-h-0 relative">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-800/50 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          {!isEmpty && (
            <span className="text-[10px] text-neutral-500 font-mono">
              {output.length} {output.length === 1 ? "entry" : "entries"}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={copyOutput}
            disabled={isEmpty}
            className="text-neutral-500 hover:text-neutral-300 disabled:opacity-30 p-1 rounded transition-colors"
            title={op.copyOutput}
          >
            <Copy size={14} />
          </button>
          {copied && (
            <span className="text-[10px] text-green-400">{op.copied}</span>
          )}
        </div>
      </div>

      {/* Output area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5 scrollbar-dark"
      >
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500">
            {isExecuting ? (
              <div className="flex items-center space-x-2.5">
                <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse" />
                <span className="text-sm">{op.waitingForOutput}</span>
              </div>
            ) : job?.artifactInstanceId ? (
              // Session is resumed and has a built artifact, but the live
              // SSE transcript wasn't retained. Render a structured status
              // block instead of the generic "no output" empty state.
              <ResumedBuildStatus
                lastBuildAt={job.lastBuildAt}
                status={job.status}
                appUrl={previewAppUrl}
              />
            ) : (
              <div className="text-center">
                <Terminal size={20} className="mx-auto mb-2 text-neutral-600" />
                <span className="text-sm">{op.noOutputYet}</span>
              </div>
            )}
          </div>
        ) : (
          renderedEntries
        )}
      </div>

      {/* Scroll to bottom button */}
      {!autoScroll && output.length > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 bg-neutral-700 text-neutral-300 p-2 rounded-full shadow-lg hover:bg-neutral-600 transition-colors"
          title={op.scrollToBottom}
        >
          <ArrowDown size={14} />
        </button>
      )}
    </div>
  );
}
