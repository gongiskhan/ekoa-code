'use client';

/**
 * Orchestration Store for Builder Page
 *
 * Manages sessions, messages, job state, preview state,
 * and file tree.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, tryCall } from '@/lib/api';
import type { FileAttachment } from '@/types/attachment';
import type { LocalFileActivity } from '@/lib/privacy-claims';
import { getSandboxDisplayPath } from '@/lib/file-utils';

// ============================================
// TYPES
// ============================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: {
    jobId?: string;
    traceId?: string;
    phase?: string;
    isEssential?: boolean;
    type?: 'text' | 'tool_use' | 'tool_result' | 'status' | 'progress' | 'error' | 'result' | 'skill' | 'activity' | 'agent_text';
    toolName?: string;
    toolInput?: Record<string, unknown>;
    memoriesUsed?: number;
    attachments?: Array<{ displayName: string; type: 'file' | 'folder' | 'url' }>;
    /** The agent's working commentary for this turn (server-redacted). Rendered as the
     *  collapsed, re-expandable thinking section above the answer. */
    thinking?: string;
    thinkingDurationMs?: number;
    /** FC-402: local-file activity for this turn (daemon egress ledger + hosted
     *  anonymisation audit, joined by correlation id). Absent on turns that never
     *  touched local files; drives the per-turn trust chip when present. */
    localFileActivity?: LocalFileActivity;
    /** Refused-build feed (BRIEF 9a): set on the capability-refusal error message
     *  (POST /jobs 403 canBuildApps/canEditApps) so the bubble can offer to file the
     *  pre-drafted request to the org-admin queue - a refusal is never a dead end.
     *  `text` is the user's original request; `appId` the refused follow-up's artifact. */
    refusal?: { text: string; appId?: string };
    /** B5 (decision B.B back-reference): set on an assistant turn that REVISED an existing
     *  sheet - the revised sheet's ids, written server-side on persist. Presence = the reply
     *  is a revision (renders the revision card framing and focuses the SAME sheet). */
    sheetId?: string;
    revisionId?: string;
    /** 1-based ordinal of the appended revision (revision turns only). */
    revisionNumber?: number;
    /** B7 finding 1: the post-run reply summary, persisted server-side onto the turn after a
     *  successful `reply_summary` emit. loadSessionMessages hydrates these back into
     *  `replySummaries` so the upgraded card survives a reload; absent exactly when the
     *  summary never emitted (decision B.E's degradation keeps the placeholder). */
    summaryTitle?: string;
    summarySummary?: string;
    summaryRevision?: number;
  };
}

/** The B2 `reply_summary` payload attached to a transcript assistant turn (B5 summary cards).
 *  Delivered live on the notifications channel AND persisted server-side onto the turn's
 *  metadata (B7 finding 1), so a reload rebuilds the same entry via loadSessionMessages;
 *  only a turn whose summary never emitted degrades to the first-line placeholder (B.E). */
export interface ReplySummaryEntry {
  sheetId: string;
  revisionId: string;
  title: string;
  summary: string;
  /** Present on revision turns: the 1-based ordinal of the appended revision. */
  revision?: number;
}

export interface SessionState {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** Session kind persisted server-side (default 'builder'). 'onboarding'
   *  drives the guided welcome flow; carried through create + list mapping. */
  type?: string;
}

export interface OutputEntry {
  id: string;
  timestamp: string;
  type: 'text' | 'tool_use' | 'tool_result' | 'status' | 'progress' | 'error' | 'system' | 'terminal' | 'skill';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  phase?: string;
  toolDuration?: number;
  isSuccess?: boolean;
  skillName?: string;
  summary?: string;
}

export interface SessionJobState {
  jobId: string | null;
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  phase: string | null;
  progress: number;
  progressMessage: string | null;
  output: OutputEntry[];
  artifactInstanceId: string | null;
  slug: string | null;
  /** Cached from the artifact instance. When true, the preview iframe URL
   *  skips the ?token= append because the artifact is publicly served. */
  shareable: boolean;
  projectPath: string | null;
  /** ISO timestamp of the artifact's last update on the server. Set by
   *  hydrateSessionFromArtifact so the Output panel can show a "last build:"
   *  status block when the in-memory transcript is empty after reload. */
  lastBuildAt: string | null;
  result?: {
    success: boolean;
    summary?: string;
    artifacts?: Record<string, unknown>;
    appUrl?: string;
  };
}

export interface SessionPreviewState {
  previewId: string | null;
  appUrl: string | null;
  status: 'idle' | 'building' | 'starting' | 'running' | 'failed' | 'stopped';
  error: string | null;
  /** Incremented on each hot-reload rebuild to trigger iframe refresh */
  reloadCount?: number;
  /**
   * Template id this session was started from (via /chat?template=<id>).
   * Lets the side panel restore the template preview after the user presses
   * Stop, and lets the welcome message become context-aware.
   */
  templateId?: string | null;
}

export interface FileNode {
  name: string;
  path: string;
  /** Full filesystem path used for file read/write operations (file nodes only) */
  fullPath?: string;
  type: 'file' | 'folder';
  action?: 'created' | 'modified' | 'deleted';
  children?: FileNode[];
}

/**
 * Canonical side-panel state. The frontend renders a single uniform chat
 * layout; side panels open/close in response to backend signals
 * (phase_changed / integration_build_intent / integration_ready SSE
 * events from cortex).
 *
 *   'none'       — no side panel (empty state, pure chat Q&A)
 *   'build'      — builder side panel: Files / Output / Preview / Versions
 *   'integrate'  — integration builder panel (mutex with 'build')
 */
export type SidePanelState = 'none' | 'build' | 'integrate';

/**
 * Active integration-builder session pinned to a chat session. Set when the
 * chat-agent emits <ekoa-integration-build-redirect/>; cleared when the user
 * dismisses the integration panel or wires the integration back into the app.
 */
export interface ActiveIntegrationBuild {
  /** Integration key (e.g. "trello", "notion") */
  key: string;
  /** Optional display label (e.g. "Trello") */
  label?: string;
  /** Integration-builder session id (separate from chat sessionId) */
  builderSessionId?: string;
  /** True after the integration was saved and is ready to wire into the app. */
  ready?: boolean;
}

/**
 * Panel-host content (Part B bound decision B.A, run 20260717-190134): ONE layout for every
 * mode. Once a conversation has content the right panel is always present; a mode change
 * swaps WHICH content the host renders, never the page structure. The union is DERIVED from
 * the existing per-session state (sidePanelState restored per session, sessionJobs /
 * sessionPreviews / activeIntegrationBuilds) via `panelContentFor` below - no new store, no
 * registry, and the build/integrate keying keeps working untouched. 'sheet-feed' is the
 * chat-mode variant (B3 hosts a placeholder; B4 renders the real desk surface). A future
 * content type adds one member here plus one branch in the SidePanel host.
 */
export type PanelContent =
  | { kind: 'sheet-feed' }
  | { kind: 'build' }
  | { kind: 'integrate'; build: ActiveIntegrationBuild };

/**
 * Derive the panel content for `sessionId` from current state. Pure so components can
 * select `panelContentFor(s, id).kind` (a stable primitive) without re-render churn.
 * The build/integrate conditions mirror the page's previous `showSidePanel` expression
 * exactly - per-session gating so a stale global `sidePanelState` never renders a dead
 * build panel for a session that has no build.
 */
export function panelContentFor(
  s: Pick<
    OrchestrationState,
    'sidePanelState' | 'sessionJobs' | 'sessionPreviews' | 'activeIntegrationBuilds' | 'isExecuting'
  >,
  sessionId: string | null,
): PanelContent {
  if (sessionId) {
    const integrationBuild = s.activeIntegrationBuilds[sessionId];
    if (s.sidePanelState === 'integrate' && integrationBuild) {
      return { kind: 'integrate', build: integrationBuild };
    }
    const job = s.sessionJobs[sessionId];
    const preview = s.sessionPreviews[sessionId];
    const isBuildSession =
      job?.artifactInstanceId != null || preview?.templateId != null || !!preview?.appUrl;
    const hasJob = job?.jobId != null;
    // `isExecuting` keeps the build panel up the instant a delegated build starts
    // (before the jobId lands) - but only for a build INITIATED this lifecycle:
    // every build-initiation handler stamps the session job (status 'queued')
    // alongside its setSidePanelState('build'), and persist sanitizes
    // queued/running back to 'idle' on reload. So the build variant renders for
    // real content OR an initiated-this-lifecycle build. A session with a stale
    // restored sidePanelState==='build' and only an idle seed entry (e.g.
    // createSession's default) is a plain chat session: a normal chat send flips
    // the global isExecuting and must not swap its panel to a dead build
    // variant - it falls through to sheet-feed.
    const buildInitiated = job != null && job.status !== 'idle';
    if (
      s.sidePanelState === 'build' &&
      (isBuildSession || hasJob || (s.isExecuting && buildInitiated))
    ) {
      return { kind: 'build' };
    }
  }
  return { kind: 'sheet-feed' };
}

// Per-session retry payload — set when an agent execution starts, cleared on success,
// kept on failure so a Retry button can re-fire the exact same execute() call.
export interface RetryContext {
  message: string;
  options: {
    agent?: string;
    project?: string;
    templateId?: string;
    integrationKeys?: string[];
    artifactFieldValues?: Record<string, unknown>;
    configValues?: Record<string, unknown>;
    integrations?: string[];
    attachments?: Array<{
      attachmentId: string;
      displayName: string;
      path: string;
      type: 'file' | 'folder' | 'url';
      size?: number;
    }>;
    sessionId?: string;
    language?: 'en' | 'pt';
    artifactInstanceId?: string;
    projectPath?: string;
  };
}

// ============================================
// STORE INTERFACE
// ============================================

interface OrchestrationState {
  // Sessions
  sessions: SessionState[];
  activeSessionId: string | null;

  // Messages per session
  messages: Record<string, ChatMessage[]>;

  // Per-session job state
  sessionJobs: Record<string, SessionJobState>;

  // Per-session preview state
  sessionPreviews: Record<string, SessionPreviewState>;

  // Per-session file tree
  sessionFiles: Record<string, FileNode[]>;

  // UI state
  /** Canonical side-panel state, driven by cortex SSE events. */
  sidePanelState: SidePanelState;
  /** Per-session persisted side-panel state. */
  sessionSidePanelStates: Record<string, SidePanelState>;
  sidePanelTab: 'files' | 'output' | 'preview' | 'versions';
  isExecuting: boolean;

  // Active integration build per chat session (set when sidePanelState === 'integrate')
  activeIntegrationBuilds: Record<string, ActiveIntegrationBuild | null>;

  // Transient activity messages per session (not persisted)
  activityMessages: Record<string, string | null>;

  // Retry payload per session (set on execute start, cleared on success, kept on failure)
  retryContexts: Record<string, RetryContext | null>;

  // Streaming chat buffer per session (not persisted)
  streamingChat: Record<string, string>;

  // Streaming thinking buffer per session (not persisted). Fed by `thinking_chunk` events —
  // the agent's working commentary, rendered as the collapsible thinking section while the
  // run executes and flushed into the assistant message metadata on complete.
  streamingThinking: Record<string, string>;

  // Per-session messages queued while a run is executing (not persisted).
  // Sent (FIFO) when the active run finishes, instead of being rejected.
  queuedMessages: Record<string, string[]>;

  // Per-session draft text to restore into the composer (e.g. after Stop puts the
  // cancelled message back for editing). Consumed + cleared by whichever composer
  // is mounted. Not persisted.
  composerDraft: Record<string, string | undefined>;

  // B5 summary cards: reply_summary payloads keyed session -> transcript message id. Fed by
  // the live event AND rehydrated from the persisted turn metadata on loadSessionMessages
  // (B7 finding 1) - only never-summarised turns keep the first-line placeholder (B.E).
  replySummaries: Record<string, Record<string, ReplySummaryEntry>>;

  // B5 (codex fix 1): reply_summary events whose ID-matching turn has not landed yet, per
  // session, oldest-first. Capped at MAX_PENDING_REPLY_SUMMARIES (oldest dropped); drained by
  // addMessage / stampTurnSheetLink / loadSessionMessages when a matching turn appears.
  pendingReplySummaries: Record<string, ReplySummaryEntry[]>;

  // B5 (codex fix 2): the sheet feed's back-references, createdFromMessageId -> sheetId,
  // published on every feed commit (server truth). The card click's by-message-id resolution
  // source when no summary entry / stamped metadata exists. Not persisted.
  sheetLinks: Record<string, Record<string, string>>;

  // B5 chip: the most recently touched sheet per session, published by the sheet feed after
  // each load (server truth). The chip's auto-set target. Not persisted.
  sessionLatestSheet: Record<string, { sheetId: string; title: string } | null>;

  // B5 chip state per session: undefined = auto (the heuristic may set it), null = dismissed
  // (forces a new sheet for the next send; auto-set suppressed), object = active target.
  editTargets: Record<string, { sheetId: string; title: string } | null | undefined>;

  // B5 card click -> sheet focus signal: the store seam between the transcript and the feed
  // (locked: no cross-component DOM reach). `seq` re-fires repeat clicks on the same sheet;
  // sheetId null = focus the newest sheet. Not persisted.
  sheetFocus: Record<string, { sheetId: string | null; seq: number } | undefined>;

  // Pending attachments
  pendingAttachments: FileAttachment[];

  // Pending delegation from chat page (triggers builder execution)
  pendingDelegation: {
    description: string;
    templateId: string | null;
  } | null;

  // Actions
  createSession: (params?: { name?: string; type?: string }) => Promise<string>;
  /** Find-or-create the single persistent onboarding session. Unlike
   *  createSession, a server failure returns { persisted: false } WITHOUT
   *  minting a local phantom session, so the caller can surface an error. */
  openOnboardingSession: (name: string) => Promise<{ id: string; persisted: boolean }>;
  setActiveSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, name: string) => Promise<void>;
  loadSessions: () => Promise<void>;

  addMessage: (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>, opts?: { persist?: boolean }) => string;
  loadSessionMessages: (sessionId: string) => Promise<void>;

  // Job state management
  setSessionJob: (sessionId: string, job: Partial<SessionJobState>) => void;
  addSessionJobOutput: (sessionId: string, entry: OutputEntry) => void;
  appendToLastOutput: (sessionId: string, content: string) => void;
  /** Retraction mirror (B7): drop the last accumulated live text entry (server text_reset). */
  dropLastTextOutput: (sessionId: string) => void;
  clearSessionJobOutput: (sessionId: string) => void;

  // Preview state
  setSessionPreview: (sessionId: string, preview: Partial<SessionPreviewState>) => void;

  // File tree
  addFileOperation: (sessionId: string, path: string, action: 'created' | 'modified' | 'deleted') => void;
  /** Fetch the artifact's REAL file tree (GET /artifacts/:id/files) into the Files tab —
   *  the server list is the source of truth; live tool-event badges are preserved. */
  loadSessionFiles: (sessionId: string, artifactId: string) => Promise<void>;

  // UI state
  /** Set the canonical side-panel state. Persists per active session. */
  setSidePanelState: (state: SidePanelState) => void;
  setSidePanelTab: (tab: 'files' | 'output' | 'preview' | 'versions') => void;
  setIsExecuting: (executing: boolean) => void;

  // Active integration build management
  setActiveIntegrationBuild: (sessionId: string, build: ActiveIntegrationBuild | null) => void;
  markIntegrationBuildReady: (sessionId: string) => void;

  // Activity messages
  setActivityMessage: (sessionId: string, message: string | null) => void;

  // Retry context
  setRetryContext: (sessionId: string, ctx: RetryContext | null) => void;
  getRetryContext: (sessionId: string) => RetryContext | null;

  // Streaming chat buffer
  appendStreamingChat: (sessionId: string, delta: string) => void;
  flushStreamingChat: (sessionId: string) => string;
  /** Clears BOTH live buffers (answer + thinking) — every abandon path wants both gone. */
  clearStreamingChat: (sessionId: string) => void;

  // Streaming thinking buffer
  appendStreamingThinking: (sessionId: string, delta: string) => void;
  flushStreamingThinking: (sessionId: string) => string;

  // Message queue (queue-while-building instead of rejecting)
  enqueueMessage: (sessionId: string, text: string) => void;
  /** Remove and return ALL queued messages at once (for merge-on-flush). */
  drainQueue: (sessionId: string) => string[];
  removeQueuedMessage: (sessionId: string, index: number) => void;
  clearQueue: (sessionId: string) => void;

  // Composer draft restore (Stop puts the cancelled message back for editing)
  setComposerDraft: (sessionId: string, text: string | undefined) => void;

  // B5 summary cards + composer chip + focus seam
  /** ID-ROUTED attach (codex B5 fix 1 - no recency heuristic): the reply_summary event
   *  carries the sheet/revision ids and attaches ONLY to the turn whose ids match (a stamped
   *  or server-persisted back-reference, or a reloaded fresh turn's deterministic
   *  `sheet-<messageId>`). No matching turn yet (fast summary, unstamped mirror, transcript
   *  not loaded) -> the event is BUFFERED per session and consumed when the turn lands. */
  attachReplySummary: (sessionId: string, entry: ReplySummaryEntry) => void;
  /** Settle-time server-truth stamp (codex B5 fix 2): write the persisted reply's sheet ids
   *  onto its local mirror turn, then drain any buffered summary waiting for those ids. */
  stampTurnSheetLink: (sessionId: string, messageId: string, link: { sheetId: string; revisionId: string; revisionNumber?: number }) => void;
  /** Published by the sheet feed on every commit: createdFromMessageId -> sheetId. */
  setSheetLinks: (sessionId: string, links: Record<string, string>) => void;
  setSessionLatestSheet: (sessionId: string, sheet: { sheetId: string; title: string } | null) => void;
  setEditTarget: (sessionId: string, target: { sheetId: string; title: string } | null | undefined) => void;
  /** Ask the sheet feed to scroll-to + flash a sheet (null = the newest one). */
  requestSheetFocus: (sessionId: string, sheetId: string | null) => void;

  // Remove the last user message and everything after it; returns its text
  // (or null when there's no user message). Used by Stop to hand the message
  // back to the composer for editing/resending.
  popLastUserTurn: (sessionId: string) => string | null;

  // Attachments
  addAttachment: (attachment: FileAttachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;

  // Delegation
  setPendingDelegation: (delegation: { description: string; templateId: string | null } | null) => void;

  // Initialization
  initializeBuilderSession: () => Promise<void>;

  // Navigation helpers
  activateMostRecentSession: () => void;
  activateOrCreateEmptySession: () => Promise<void>;

  // Recovery: rehydrate sessionJobs/sessionPreviews for `sessionId` from a backend
  // artifact instance. Used when arriving via a direct URL on a fresh browser
  // (no localStorage), where the side panel would otherwise show no preview/files
  // because the artifact link only lived in client state.
  hydrateSessionFromArtifact: (sessionId: string, artifacts?: ArtifactRef[]) => Promise<boolean>;
}

// Shape returned by ekoa.templates list-instances, only the fields we use here.
export interface ArtifactRef {
  id: string;
  slug?: string;
  status?: string;
  shareable?: boolean;
  updatedAt?: string;
  createdAt?: string;
  data?: {
    sessionId?: string;
    projectDir?: string;
    appUrl?: string;
  };
}

// ============================================
// HELPERS
// ============================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// B5 (codex fix 1) - ID-routed reply_summary attachment. A turn matches an event by ids
// ONLY, never by recency: a turn stamped with a revisionId matches on that revisionId (the
// discriminator - several revision turns can share one sheetId); a turn stamped with a
// sheetId alone matches on it; an unstamped turn matches when the event's sheet is the
// server's deterministic derived view of the turn itself (`sheet-<messageId>` - true only
// for server-id turns, a local mirror id can never collide). Scanned newest-first so a
// revision turn shadows the fresh turn whose derived sheet it revised.
const MAX_PENDING_REPLY_SUMMARIES = 8;

function summaryTurnFor(
  msgs: ChatMessage[],
  summaries: Record<string, ReplySummaryEntry>,
  entry: ReplySummaryEntry,
): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.role !== 'assistant' || summaries[m.id]) continue;
    const meta = m.metadata;
    const matches = meta?.revisionId
      ? meta.revisionId === entry.revisionId
      : meta?.sheetId
        ? meta.sheetId === entry.sheetId
        : `sheet-${m.id}` === entry.sheetId;
    if (matches) return m.id;
  }
  return null;
}

/**
 * B7 finding 1 (reload restores everything): rebuild ReplySummaryEntry values from the summary
 * metadata the server persists on each assistant turn after a successful emit (summaryTitle /
 * summarySummary / summaryRevision) - the same shape the live event attached, so the card
 * renders identically. Fresh turns carry no sheet back-reference; their ids are the server's
 * deterministic derived vocabulary (`sheet-<id>` / `rev-<id>`, data/session-sheets.ts) - true
 * only for server-id rows, which is exactly what loadSessionMessages maps. Entries already
 * attached (live event) win. Returns null when nothing new hydrated.
 */
function hydratePersistedSummaries(
  msgs: ChatMessage[],
  existing: Record<string, ReplySummaryEntry> | undefined,
): Record<string, ReplySummaryEntry> | null {
  let out: Record<string, ReplySummaryEntry> | null = null;
  for (const m of msgs) {
    if (m.role !== 'assistant' || existing?.[m.id]) continue;
    const meta = m.metadata;
    if (!meta?.summaryTitle || !meta.summarySummary) continue;
    const revision = meta.summaryRevision ?? meta.revisionNumber;
    out = out ?? { ...(existing ?? {}) };
    out[m.id] = {
      sheetId: meta.sheetId ?? `sheet-${m.id}`,
      revisionId: meta.revisionId ?? `rev-${m.id}`,
      title: meta.summaryTitle,
      summary: meta.summarySummary,
      ...(revision !== undefined ? { revision } : {}),
    };
  }
  return out;
}

/** Attach every buffered reply_summary whose matching turn now exists in `msgs`. Returns the
 *  state slice to spread into a set() result, or null when nothing drained. */
function drainPendingSummaries(
  state: Pick<OrchestrationState, 'replySummaries' | 'pendingReplySummaries'>,
  sessionId: string,
  msgs: ChatMessage[],
): Pick<OrchestrationState, 'replySummaries' | 'pendingReplySummaries'> | null {
  const pending = state.pendingReplySummaries[sessionId];
  if (!pending || pending.length === 0) return null;
  let summaries = state.replySummaries[sessionId] ?? {};
  const left: ReplySummaryEntry[] = [];
  let changed = false;
  for (const entry of pending) {
    const target = summaryTurnFor(msgs, summaries, entry);
    if (target) {
      summaries = { ...summaries, [target]: entry };
      changed = true;
    } else {
      left.push(entry);
    }
  }
  if (!changed) return null;
  return {
    replySummaries: { ...state.replySummaries, [sessionId]: summaries },
    pendingReplySummaries: { ...state.pendingReplySummaries, [sessionId]: left },
  };
}

function getDefaultSessionJob(): SessionJobState {
  return {
    jobId: null,
    status: 'idle',
    phase: null,
    progress: 0,
    progressMessage: null,
    output: [],
    artifactInstanceId: null,
    slug: null,
    shareable: false,
    projectPath: null,
    lastBuildAt: null,
  };
}

function getDefaultSessionPreview(): SessionPreviewState {
  return {
    previewId: null,
    appUrl: null,
    status: 'idle',
    error: null,
  };
}

/**
 * Add or update a file in a tree structure.
 * Creates intermediate folders as needed.
 */
function addFileToTree(
  tree: FileNode[],
  filePath: string,
  action: 'created' | 'modified' | 'deleted',
  fullPath?: string
): FileNode[] {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length === 0) return tree;

  const newTree = [...tree];

  // Walk down the path, creating folders as needed
  let currentLevel = newTree;
  for (let i = 0; i < parts.length - 1; i++) {
    const folderName = parts[i];
    let folder = currentLevel.find(
      (n) => n.name === folderName && n.type === 'folder'
    );
    if (!folder) {
      folder = {
        name: folderName,
        path: parts.slice(0, i + 1).join('/'),
        type: 'folder',
        children: [],
      };
      currentLevel.push(folder);
    }
    if (!folder.children) folder.children = [];
    currentLevel = folder.children;
  }

  // Add or update the file node
  const fileName = parts[parts.length - 1];
  const existing = currentLevel.findIndex(
    (n) => n.name === fileName && n.type === 'file'
  );
  const fileNode: FileNode = {
    name: fileName,
    path: filePath,
    fullPath: fullPath ?? filePath,
    type: 'file',
    action,
  };

  if (existing >= 0) {
    currentLevel[existing] = fileNode;
  } else {
    currentLevel.push(fileNode);
  }

  return newTree;
}

/**
 * Build a FileNode tree from the server's project-relative file list (GET /artifacts/:id/files),
 * folding in any action badges (+/M/D) the live stream already recorded. Folders first, then
 * files, both alphabetical. The server list is the SOURCE OF TRUTH for the Files tab — the
 * per-tool-event additions only decorate it between fetches.
 */
function buildFileTree(
  paths: string[],
  actions: Map<string, 'created' | 'modified' | 'deleted'>,
): FileNode[] {
  const root: FileNode[] = [];
  for (const filePath of paths) {
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let level = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i] as string;
      let folder = level.find((n) => n.name === folderName && n.type === 'folder');
      if (!folder) {
        folder = { name: folderName, path: parts.slice(0, i + 1).join('/'), type: 'folder', children: [] };
        level.push(folder);
      }
      if (!folder.children) folder.children = [];
      level = folder.children;
    }
    const name = parts[parts.length - 1] as string;
    const action = actions.get(filePath);
    level.push({ name, path: filePath, fullPath: filePath, type: 'file', ...(action ? { action } : {}) });
  }
  const sortLevel = (nodes: FileNode[]): FileNode[] => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
    for (const n of nodes) if (n.children) sortLevel(n.children);
    return nodes;
  };
  return sortLevel(root);
}

/** Collect path→action from an existing tree (so a server refresh keeps the +/M/D badges). */
function collectFileActions(nodes: FileNode[], into = new Map<string, 'created' | 'modified' | 'deleted'>()): Map<string, 'created' | 'modified' | 'deleted'> {
  for (const n of nodes) {
    if (n.type === 'file' && n.action) into.set(n.path, n.action);
    if (n.children) collectFileActions(n.children, into);
  }
  return into;
}

/**
 * Delete empty sessions in the background (fire-and-forget).
 * Skips the session identified by `keepId`.
 */
function cleanupEmptySessions(
  get: () => OrchestrationState,
  sessions: SessionState[],
  sessionJobs: Record<string, SessionJobState>,
  keepId: string,
): void {
  const empties = sessions.filter((s) => {
    if (s.id === keepId) return false;
    // The persistent onboarding session is never surplus - it must survive so a
    // second visit resumes it (its welcome + chips are content at zero messages).
    if (s.type === 'onboarding') return false;
    const job = sessionJobs[s.id];
    return s.messageCount === 0 && (!job?.jobId);
  });
  for (const s of empties) {
    api.sessions.delete({ id: s.id }).catch(() => {});
  }
  if (empties.length > 0) {
    const deleteIds = new Set(empties.map((s) => s.id));
    const state = get();
    const newJobs = { ...state.sessionJobs };
    const newPreviews = { ...state.sessionPreviews };
    const newFiles = { ...state.sessionFiles };
    const newMessages = { ...state.messages };
    for (const id of deleteIds) {
      delete newJobs[id];
      delete newPreviews[id];
      delete newFiles[id];
      delete newMessages[id];
    }
    // We can't call set() from outside the store, so we use the store's setState
    useOrchestrationStore.setState({
      sessions: state.sessions.filter((s) => !deleteIds.has(s.id)),
      sessionJobs: newJobs,
      sessionPreviews: newPreviews,
      sessionFiles: newFiles,
      messages: newMessages,
    });
  }
}

// ============================================
// STORE
// ============================================

/** Guard against concurrent empty-session creation from rapid clicks */
let _creatingEmptySession = false;

export const useOrchestrationStore = create<OrchestrationState>()(
  persist(
    (set, get) => ({
      // Initial state
      sessions: [],
      activeSessionId: null,
      messages: {},
      sessionJobs: {},
      sessionPreviews: {},
      sessionFiles: {},

      sidePanelState: 'none' as SidePanelState,
      sessionSidePanelStates: {},
      sidePanelTab: 'preview',
      isExecuting: false,
      activityMessages: {},
      streamingChat: {},
      streamingThinking: {},
      queuedMessages: {},
      composerDraft: {},
      replySummaries: {},
      pendingReplySummaries: {},
      sheetLinks: {},
      sessionLatestSheet: {},
      editTargets: {},
      sheetFocus: {},
      retryContexts: {},
      activeIntegrationBuilds: {},

      pendingAttachments: [],
      pendingDelegation: null,

      // ========================================
      // SESSION ACTIONS
      // ========================================

      createSession: async (params) => {
        const result = await tryCall(() => api.sessions.create(params ?? {}));
        if (result.ok) {
          const session = result.data;
          const sessionState: SessionState = {
            id: session.id,
            name: session.name || 'New Session',
            createdAt: session.createdAt || new Date().toISOString(),
            updatedAt: session.updatedAt || new Date().toISOString(),
            messageCount: 0,
            type: session.type ?? params?.type,
          };
          set((state) => ({
            sessions: [sessionState, ...state.sessions],
            activeSessionId: session.id,
            messages: { ...state.messages, [session.id]: [] },
            sessionJobs: { ...state.sessionJobs, [session.id]: getDefaultSessionJob() },
            sessionPreviews: { ...state.sessionPreviews, [session.id]: getDefaultSessionPreview() },
            sessionFiles: { ...state.sessionFiles, [session.id]: [] },
          }));
          return session.id;
        }
        // Fallback: create local-only session
        const localId = generateId();
        const localSession: SessionState = {
          id: localId,
          name: params?.name || 'New Session',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 0,
          type: params?.type,
        };
        set((state) => ({
          sessions: [localSession, ...state.sessions],
          activeSessionId: localId,
          messages: { ...state.messages, [localId]: [] },
          sessionJobs: { ...state.sessionJobs, [localId]: getDefaultSessionJob() },
          sessionPreviews: { ...state.sessionPreviews, [localId]: getDefaultSessionPreview() },
          sessionFiles: { ...state.sessionFiles, [localId]: [] },
        }));
        return localId;
      },

      openOnboardingSession: async (name) => {
        // Reuse the most-recently-updated onboarding session so a second visit
        // lands on the SAME conversation instead of spawning a duplicate.
        const existing = [...get().sessions]
          .filter((s) => s.type === 'onboarding')
          .sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          )[0];
        if (existing) return { id: existing.id, persisted: true };

        // Create server-side. Deliberately NOT the createSession action: its
        // soft fallback mints a local-only session on failure, which would
        // strand an onboarding session that never reached the server. Here a
        // failure returns persisted:false and seeds no state.
        const result = await tryCall(() => api.sessions.create({ type: 'onboarding', name }));
        if (result.ok) {
          const session = result.data;
          // The server create is idempotent for onboarding and may return a
          // session minted by another tab/device: never double-add it or reset
          // state the store already tracks for that id.
          const alreadyKnown = get().sessions.some((s) => s.id === session.id);
          if (!alreadyKnown) {
            const sessionState: SessionState = {
              id: session.id,
              name: session.name || name,
              createdAt: session.createdAt || new Date().toISOString(),
              updatedAt: session.updatedAt || new Date().toISOString(),
              messageCount: session.messages?.length ?? 0,
              type: session.type ?? 'onboarding',
            };
            set((state) => ({
              sessions: [sessionState, ...state.sessions],
              messages: { ...state.messages, [session.id]: state.messages[session.id] ?? [] },
              sessionJobs: { ...state.sessionJobs, [session.id]: getDefaultSessionJob() },
              sessionPreviews: { ...state.sessionPreviews, [session.id]: getDefaultSessionPreview() },
              sessionFiles: { ...state.sessionFiles, [session.id]: [] },
            }));
          }
          return { id: session.id, persisted: true };
        }
        return { id: '', persisted: false };
      },

      setActiveSession: (sessionId: string) => {
        // Restore per-session side-panel state if one was saved; default to
        // 'none' for fresh sessions. The cortex phase_changed listener will
        // promote it to 'build' if the session has an active or completed job.
        const { sessionSidePanelStates, sessionJobs, activeSessionId, sidePanelState } = get();
        const restoredPanel = sessionSidePanelStates[sessionId] ?? 'none';
        // Sessions that have a built artifact always show the build panel on
        // activation, even if the user closed it in a previous visit. The
        // artifact (preview + files + output) is the primary surface for those
        // sessions, so re-opening should always re-present it.
        const hasArtifact = !!sessionJobs[sessionId]?.artifactInstanceId;
        const effectivePanel = hasArtifact ? 'build' : restoredPanel;

        // Save the current side-panel state for the session we're leaving.
        const leavingId = activeSessionId;
        const updatedPanels = leavingId
          ? { ...sessionSidePanelStates, [leavingId]: sidePanelState, [sessionId]: effectivePanel }
          : { ...sessionSidePanelStates, [sessionId]: effectivePanel };

        // Reset executing flag on session switch; useAgentExecution will re-set
        // it to true if the new session's job is genuinely still running
        set({
          activeSessionId: sessionId,
          isExecuting: false,
          sessionSidePanelStates: updatedPanels,
          sidePanelState: effectivePanel,
        });

        // Always reload messages from server for the new session.
        // We don't use a cached empty-array as evidence of "no messages" because
        // createSession() pre-populates messages[id]=[] before the session has
        // been used — that empty array must not suppress the fetch.
        get().loadSessionMessages(sessionId);
      },

      deleteSession: async (sessionId: string) => {
        await api.sessions.delete({ id: sessionId });
        set((state) => {
          const sessions = state.sessions.filter((s) => s.id !== sessionId);
          const newMessages = { ...state.messages };
          delete newMessages[sessionId];
          const newJobs = { ...state.sessionJobs };
          delete newJobs[sessionId];
          const newPreviews = { ...state.sessionPreviews };
          delete newPreviews[sessionId];
          const newFiles = { ...state.sessionFiles };
          delete newFiles[sessionId];

          return {
            sessions,
            messages: newMessages,
            sessionJobs: newJobs,
            sessionPreviews: newPreviews,
            sessionFiles: newFiles,
            activeSessionId:
              state.activeSessionId === sessionId
                ? sessions[0]?.id || null
                : state.activeSessionId,
          };
        });
      },

      renameSession: async (sessionId: string, name: string) => {
        await api.sessions.update({ id: sessionId, name });
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, name, updatedAt: new Date().toISOString() } : s
          ),
        }));
      },

      loadSessions: async () => {
        const result = await tryCall(() => api.sessions.list());
        if (result.ok) {
          const sessions: SessionState[] = result.data.items.map((s) => ({
            id: s.id,
            name: s.name || 'Session',
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            messageCount: (s as { messageCount?: number }).messageCount || 0,
            type: s.type,
          }));

          // If activeSessionId no longer exists in the fetched sessions
          // (e.g., server restarted), reset it to the first session or null
          const { activeSessionId } = get();
          const stillExists = activeSessionId && sessions.some((s) => s.id === activeSessionId);
          set({
            sessions,
            ...(stillExists ? {} : { activeSessionId: sessions[0]?.id || null }),
          });
        }
      },

      // ========================================
      // MESSAGE ACTIONS
      // ========================================

      addMessage: (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>, opts?: { persist?: boolean }): string => {
        const fullMessage: ChatMessage = {
          ...message,
          id: generateId(),
          timestamp: new Date().toISOString(),
        };

        // Check if this is the first user message (for auto-rename)
        const currentSession = get().sessions.find((s) => s.id === sessionId);
        const isFirstUserMessage = currentSession && currentSession.messageCount === 0 && message.role === 'user';
        const autoName = isFirstUserMessage
          ? message.content.substring(0, 50).trim() + (message.content.length > 50 ? '...' : '')
          : undefined;

        set((state) => {
          const nextMsgs = [...(state.messages[sessionId] || []), fullMessage];
          return {
            messages: {
              ...state.messages,
              [sessionId]: nextMsgs,
            },
            // B5 (codex fix 1): a landing assistant turn may be the one a buffered
            // reply_summary was waiting for.
            ...(fullMessage.role === 'assistant' ? (drainPendingSummaries(state, sessionId, nextMsgs) ?? {}) : {}),
            sessions: state.sessions.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    messageCount: s.messageCount + 1,
                    updatedAt: new Date().toISOString(),
                    ...(autoName ? { name: autoName } : {}),
                  }
                : s
            ),
          };
        });

        // Persist to server (fire and forget). Callers mirroring a chat-run
        // turn pass persist:false - the run pipeline already persists those
        // server-side (ch05 §5.6.1 steps 1 and 7); a second POST here doubled
        // every run message in the stored transcript.
        if (opts?.persist !== false) {
          api.sessions.addMessage({
            id: sessionId,
            role: fullMessage.role,
            content: fullMessage.content,
            metadata: fullMessage.metadata,
          }).catch(() => {
            // Silent fail - local state is source of truth during session
          });
        }

        // Persist auto-rename to server (fire and forget)
        if (autoName) {
          api.sessions.update({ id: sessionId, name: autoName }).catch(() => {});
        }

        return fullMessage.id;
      },

      loadSessionMessages: async (sessionId: string) => {
        try {
          const result = await tryCall(() => api.sessions.getMessages({ id: sessionId }));
          if (result.ok) {
            const messages: ChatMessage[] = result.data.items.map((m) => ({
              id: String(m.id),
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content,
              timestamp: m.createdAt,
              metadata: m.metadata as ChatMessage['metadata'],
            }));
            set((state) => {
              // B7 finding 1: persisted summary metadata rebuilds the upgraded cards on
              // reload; live-attached entries win (same content when both exist).
              const hydrated = hydratePersistedSummaries(messages, state.replySummaries[sessionId]);
              const withHydrated = hydrated
                ? { ...state, replySummaries: { ...state.replySummaries, [sessionId]: hydrated } }
                : state;
              return {
                messages: { ...state.messages, [sessionId]: messages },
                ...(hydrated ? { replySummaries: withHydrated.replySummaries } : {}),
                // B5 (codex fix 1): server rows carry server ids + persisted back-references -
                // a buffered summary can now find its turn (derived `sheet-<id>` included).
                ...(drainPendingSummaries(withHydrated, sessionId, messages) ?? {}),
              };
            });
          } else {
            // API returned an error or no data -- mark as loaded-but-empty so
            // the loading guard in the UI doesn't spin forever.
            set((state) => ({
              messages: { ...state.messages, [sessionId]: state.messages[sessionId] ?? [] },
            }));
          }
        } catch {
          set((state) => ({
            messages: { ...state.messages, [sessionId]: state.messages[sessionId] ?? [] },
          }));
        }
      },

      // ========================================
      // JOB STATE ACTIONS
      // ========================================

      setSessionJob: (sessionId: string, job: Partial<SessionJobState>) => {
        set((state) => ({
          sessionJobs: {
            ...state.sessionJobs,
            [sessionId]: {
              ...(state.sessionJobs[sessionId] || getDefaultSessionJob()),
              ...job,
            },
          },
        }));
      },

      addSessionJobOutput: (sessionId: string, entry: OutputEntry) => {
        set((state) => {
          const current = state.sessionJobs[sessionId] || getDefaultSessionJob();
          // Prevent duplicates
          if (current.output.some((o) => o.id === entry.id)) return state;
          return {
            sessionJobs: {
              ...state.sessionJobs,
              [sessionId]: {
                ...current,
                output: [...current.output, entry],
              },
            },
          };
        });
      },

      dropLastTextOutput: (sessionId: string) => {
        set((state) => {
          const current = state.sessionJobs[sessionId];
          if (!current) return state;
          const output = [...current.output];
          const last = output[output.length - 1];
          if (!last || last.type !== 'text') return state;
          output.pop();
          return {
            sessionJobs: { ...state.sessionJobs, [sessionId]: { ...current, output } },
          };
        });
      },
      appendToLastOutput: (sessionId: string, content: string) => {
        set((state) => {
          const current = state.sessionJobs[sessionId] || getDefaultSessionJob();
          const output = [...current.output];
          const last = output[output.length - 1];
          if (last && last.type === 'text') {
            output[output.length - 1] = { ...last, content: last.content + content };
          } else {
            // No existing text entry to append to — create one
            output.push({
              id: `${sessionId}-out-append-${Date.now()}`,
              timestamp: new Date().toISOString(),
              type: 'text',
              content,
            });
          }
          return {
            sessionJobs: {
              ...state.sessionJobs,
              [sessionId]: { ...current, output },
            },
          };
        });
      },

      clearSessionJobOutput: (sessionId: string) => {
        set((state) => {
          const current = state.sessionJobs[sessionId];
          if (!current) return state;
          return {
            sessionJobs: {
              ...state.sessionJobs,
              [sessionId]: { ...current, output: [] },
            },
          };
        });
      },

      // ========================================
      // PREVIEW STATE ACTIONS
      // ========================================

      setSessionPreview: (sessionId: string, preview: Partial<SessionPreviewState>) => {
        set((state) => ({
          sessionPreviews: {
            ...state.sessionPreviews,
            [sessionId]: {
              ...(state.sessionPreviews[sessionId] || getDefaultSessionPreview()),
              ...preview,
            },
          },
        }));
      },

      // ========================================
      // FILE TREE ACTIONS
      // ========================================

      addFileOperation: (
        sessionId: string,
        path: string,
        action: 'created' | 'modified' | 'deleted'
      ) => {
        const displayPath = getSandboxDisplayPath(path);
        set((state) => ({
          sessionFiles: {
            ...state.sessionFiles,
            [sessionId]: addFileToTree(
              state.sessionFiles[sessionId] || [],
              displayPath,
              action,
              path
            ),
          },
        }));
      },

      loadSessionFiles: async (sessionId: string, artifactId: string) => {
        const result = await tryCall(() => api.artifacts.filesList({ id: artifactId }));
        if (!result.ok) return; // non-fatal: the live tool-event tree keeps working
        const paths = (result.data.files ?? [])
          .map((f) => f.path)
          .filter((p): p is string => typeof p === 'string' && p.length > 0);
        set((state) => {
          const actions = collectFileActions(state.sessionFiles[sessionId] || []);
          return {
            sessionFiles: {
              ...state.sessionFiles,
              [sessionId]: buildFileTree(paths, actions),
            },
          };
        });
      },

      // ========================================
      // UI STATE ACTIONS
      // ========================================

      setSidePanelState: (state: SidePanelState) => {
        const { activeSessionId, sessionSidePanelStates } = get();
        set({
          sidePanelState: state,
          ...(activeSessionId
            ? {
                sessionSidePanelStates: {
                  ...sessionSidePanelStates,
                  [activeSessionId]: state,
                },
              }
            : {}),
        });
      },
      setSidePanelTab: (tab: 'files' | 'output' | 'preview' | 'versions') => set({ sidePanelTab: tab }),
      setIsExecuting: (executing: boolean) => set({ isExecuting: executing }),

      setActiveIntegrationBuild: (sessionId: string, build: ActiveIntegrationBuild | null) => {
        set((state) => ({
          activeIntegrationBuilds: { ...state.activeIntegrationBuilds, [sessionId]: build },
        }));
      },
      markIntegrationBuildReady: (sessionId: string) => {
        set((state) => {
          const current = state.activeIntegrationBuilds[sessionId];
          if (!current) return state;
          return {
            activeIntegrationBuilds: {
              ...state.activeIntegrationBuilds,
              [sessionId]: { ...current, ready: true },
            },
          };
        });
      },

      setActivityMessage: (sessionId: string, message: string | null) => {
        set((state) => ({
          activityMessages: { ...state.activityMessages, [sessionId]: message },
        }));
      },

      setRetryContext: (sessionId: string, ctx: RetryContext | null) => {
        set((state) => ({
          retryContexts: { ...state.retryContexts, [sessionId]: ctx },
        }));
      },

      getRetryContext: (sessionId: string) => {
        return get().retryContexts[sessionId] || null;
      },

      appendStreamingChat: (sessionId: string, delta: string) => {
        set((state) => ({
          streamingChat: {
            ...state.streamingChat,
            [sessionId]: (state.streamingChat[sessionId] || '') + delta,
          },
        }));
      },

      flushStreamingChat: (sessionId: string): string => {
        const text = get().streamingChat[sessionId] || '';
        set((state) => ({
          streamingChat: { ...state.streamingChat, [sessionId]: '' },
        }));
        return text;
      },

      clearStreamingChat: (sessionId: string) => {
        set((state) => {
          if (!state.streamingChat[sessionId] && !state.streamingThinking[sessionId]) return state;
          return {
            streamingChat: { ...state.streamingChat, [sessionId]: '' },
            streamingThinking: { ...state.streamingThinking, [sessionId]: '' },
          };
        });
      },

      appendStreamingThinking: (sessionId: string, delta: string) => {
        set((state) => ({
          streamingThinking: {
            ...state.streamingThinking,
            [sessionId]: (state.streamingThinking[sessionId] || '') + delta,
          },
        }));
      },

      flushStreamingThinking: (sessionId: string): string => {
        const text = get().streamingThinking[sessionId] || '';
        set((state) => ({
          streamingThinking: { ...state.streamingThinking, [sessionId]: '' },
        }));
        return text;
      },

      // ========================================
      // MESSAGE QUEUE (queue-while-building)
      // ========================================

      enqueueMessage: (sessionId: string, text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        set((state) => ({
          queuedMessages: {
            ...state.queuedMessages,
            [sessionId]: [...(state.queuedMessages[sessionId] || []), trimmed],
          },
        }));
      },

      drainQueue: (sessionId: string): string[] => {
        const queue = get().queuedMessages[sessionId] || [];
        if (queue.length === 0) return [];
        set((state) => ({
          queuedMessages: { ...state.queuedMessages, [sessionId]: [] },
        }));
        return queue;
      },

      removeQueuedMessage: (sessionId: string, index: number) => {
        set((state) => {
          const queue = state.queuedMessages[sessionId] || [];
          if (index < 0 || index >= queue.length) return state;
          return {
            queuedMessages: {
              ...state.queuedMessages,
              [sessionId]: queue.filter((_, i) => i !== index),
            },
          };
        });
      },

      clearQueue: (sessionId: string) => {
        set((state) => {
          if (!state.queuedMessages[sessionId]?.length) return state;
          return { queuedMessages: { ...state.queuedMessages, [sessionId]: [] } };
        });
      },

      // ========================================
      // COMPOSER DRAFT RESTORE
      // ========================================

      setComposerDraft: (sessionId: string, text: string | undefined) => {
        set((state) => ({
          composerDraft: { ...state.composerDraft, [sessionId]: text },
        }));
      },

      // ========================================
      // B5: SUMMARY CARDS + COMPOSER CHIP + FOCUS SEAM
      // ========================================

      attachReplySummary: (sessionId: string, entry: ReplySummaryEntry) => {
        set((state) => {
          const existing = state.replySummaries[sessionId] ?? {};
          // Exact duplicate (this sheet+revision already attached somewhere): drop the event -
          // a re-delivered summary must never migrate to a second turn.
          if (Object.values(existing).some((e) => e.sheetId === entry.sheetId && e.revisionId === entry.revisionId)) {
            return state;
          }
          const target = summaryTurnFor(state.messages[sessionId] ?? [], existing, entry);
          if (target) {
            return {
              replySummaries: {
                ...state.replySummaries,
                [sessionId]: { ...existing, [target]: entry },
              },
            };
          }
          // No ID-matching turn yet (the summary outran the turn / the mirror is not stamped
          // yet / the transcript is not loaded): buffer it, keyed sheetId:revisionId (newest
          // replaces same-key), capped - oldest dropped first.
          const pending = (state.pendingReplySummaries[sessionId] ?? []).filter(
            (e) => !(e.sheetId === entry.sheetId && e.revisionId === entry.revisionId),
          );
          pending.push(entry);
          while (pending.length > MAX_PENDING_REPLY_SUMMARIES) pending.shift();
          return {
            pendingReplySummaries: { ...state.pendingReplySummaries, [sessionId]: pending },
          };
        });
      },

      stampTurnSheetLink: (sessionId: string, messageId: string, link: { sheetId: string; revisionId: string; revisionNumber?: number }) => {
        set((state) => {
          const msgs = state.messages[sessionId];
          if (!msgs) return state;
          const idx = msgs.findIndex((m) => m.id === messageId);
          if (idx < 0) return state;
          const stamped: ChatMessage = { ...msgs[idx]!, metadata: { ...msgs[idx]!.metadata, ...link } };
          const nextMsgs = [...msgs.slice(0, idx), stamped, ...msgs.slice(idx + 1)];
          return {
            messages: { ...state.messages, [sessionId]: nextMsgs },
            // The stamp may be exactly what a buffered summary was waiting for.
            ...(drainPendingSummaries(state, sessionId, nextMsgs) ?? {}),
          };
        });
      },

      setSheetLinks: (sessionId: string, links: Record<string, string>) => {
        set((state) => {
          const cur = state.sheetLinks[sessionId];
          if (
            cur &&
            Object.keys(cur).length === Object.keys(links).length &&
            Object.entries(links).every(([k, v]) => cur[k] === v)
          ) {
            return state;
          }
          return { sheetLinks: { ...state.sheetLinks, [sessionId]: links } };
        });
      },

      setSessionLatestSheet: (sessionId: string, sheet: { sheetId: string; title: string } | null) => {
        set((state) => {
          const cur = state.sessionLatestSheet[sessionId];
          if (cur?.sheetId === sheet?.sheetId && cur?.title === sheet?.title) return state;
          return { sessionLatestSheet: { ...state.sessionLatestSheet, [sessionId]: sheet } };
        });
      },

      setEditTarget: (sessionId: string, target: { sheetId: string; title: string } | null | undefined) => {
        set((state) => ({
          editTargets: { ...state.editTargets, [sessionId]: target },
        }));
      },

      requestSheetFocus: (sessionId: string, sheetId: string | null) => {
        set((state) => ({
          sheetFocus: {
            ...state.sheetFocus,
            [sessionId]: { sheetId, seq: (state.sheetFocus[sessionId]?.seq ?? 0) + 1 },
          },
        }));
      },

      popLastUserTurn: (sessionId: string): string | null => {
        const messages = get().messages[sessionId] || [];
        let lastUserIdx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') { lastUserIdx = i; break; }
        }
        if (lastUserIdx < 0) return null;
        const content = messages[lastUserIdx].content;
        // Drop the user message and everything after it (the partial run output),
        // mirroring the local-only trim used by retry(). The server copy is left
        // as-is; the user is editing + resending immediately.
        const trimmed = messages.slice(0, lastUserIdx);
        set((state) => ({
          messages: { ...state.messages, [sessionId]: trimmed },
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? { ...s, messageCount: trimmed.length, updatedAt: new Date().toISOString() }
              : s
          ),
        }));
        return content;
      },

      // ========================================
      // ATTACHMENT ACTIONS
      // ========================================

      addAttachment: (attachment: FileAttachment) => {
        set((state) => ({
          pendingAttachments: [...state.pendingAttachments, attachment],
        }));
      },

      removeAttachment: (id: string) => {
        set((state) => ({
          pendingAttachments: state.pendingAttachments.filter((a) => a.attachmentId !== id),
        }));
      },

      clearAttachments: () => set({ pendingAttachments: [] }),

      // ========================================
      // RESET
      // ========================================

      setPendingDelegation: (delegation) => set({ pendingDelegation: delegation }),

      initializeBuilderSession: async () => {
        // Reset global executing flag on init (stale from previous page load).
        // Reset sidePanelState to its default — per-session panel state is
        // restored by setActiveSession via sessionSidePanelStates after
        // sessions load.
        set({
          isExecuting: false,
          sidePanelState: 'none',
        });

        // 1. Refresh sessions from server, plus artifact instances in parallel.
        // The artifact list lets us (a) protect artifact-linked sessions from
        // the empty-cleanup below, and (b) rehydrate `sessionJobs` / `sessionPreviews`
        // for any active session whose state was lost (cleared localStorage,
        // different browser). Without this the side panel renders empty even
        // though the artifact and its files are still on the backend.
        const [sessionsRes, artifactsRes] = await Promise.all([
          tryCall(() => api.sessions.list()),
          tryCall(() => api.artifacts.list()),
        ]);
        if (!sessionsRes.ok) return;

        const artifacts = (artifactsRes.ok ? artifactsRes.data.items : []) as unknown as ArtifactRef[];
        const artifactBySessionId = new Map<string, ArtifactRef>();
        const artifactById = new Map<string, ArtifactRef>();
        for (const a of artifacts) {
          if (a?.id) artifactById.set(a.id, a);
          const sid = a?.data?.sessionId;
          // First-writer-wins keeps shared-session resolution deterministic
          // across reloads (vs. last-writer, which flips with list order).
          if (sid && !artifactBySessionId.has(sid)) artifactBySessionId.set(sid, a);
        }

        const sessions: SessionState[] = sessionsRes.data.items.map((s) => ({
          id: s.id,
          name: s.name || 'Session',
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount: (s as { messageCount?: number }).messageCount || 0,
          type: s.type,
        }));

        set({ sessions });

        // Rehydrate sessionJobs / sessionPreviews from artifacts so the side
        // panel can render preview + files even without prior localStorage state.
        // Only fill in fields that are missing — we don't overwrite a running job.
        set((state) => {
          const newJobs = { ...state.sessionJobs };
          const newPreviews = { ...state.sessionPreviews };
          const newPanels = { ...state.sessionSidePanelStates };
          for (const session of sessions) {
            const existingJob = newJobs[session.id] || getDefaultSessionJob();
            // Prefer the artifact already pinned to this session (handles
            // sessions shared by several artifacts); else resolve by sessionId.
            const a =
              (existingJob.artifactInstanceId && artifactById.get(existingJob.artifactInstanceId)) ||
              artifactBySessionId.get(session.id);
            if (!a) continue;
            // Don't touch a build that's mid-flight (its live state wins until
            // it completes). Persist sanitizes running/queued -> idle on reload,
            // so this only matters for an in-tab init re-run.
            const building = existingJob.status === 'running' || existingJob.status === 'queued';
            if (!building) {
              // Reconcile identity to the artifact's CURRENT values — id, slug,
              // shareable, projectDir — regardless of whether a (possibly stale)
              // job was already persisted. Slugs/appUrls drift server-side, so a
              // stale slug-based preview URL can resolve to a DIFFERENT artifact.
              newJobs[session.id] = {
                ...existingJob,
                artifactInstanceId: a.id,
                slug: a.slug ?? null,
                shareable: a.shareable === true,
                projectPath: a.data?.projectDir ?? existingJob.projectPath ?? null,
                status: existingJob.status === 'idle' ? 'completed' : existingJob.status,
              };
              const existingPreview = newPreviews[session.id] || getDefaultSessionPreview();
              // Pin the preview to the artifact's id-based canonical URL
              // (/apps/<id>/), which never drifts, and drop any stale slug-based
              // previewId so the side panel can't fall back to it.
              newPreviews[session.id] = {
                ...existingPreview,
                appUrl: a.data?.appUrl ?? `/apps/${a.id}/`,
                previewId: null,
                status: existingPreview.status === 'idle' ? 'running' : existingPreview.status,
              };
            } else {
              // Mid-build: leave job/preview alone but still refresh `shareable`
              // so a cross-tab toggle doesn't leak the token into the iframe URL.
              newJobs[session.id] = { ...existingJob, shareable: a.shareable === true };
            }
            // Artifact-linked sessions get the builder side panel on activation.
            if (!newPanels[session.id]) newPanels[session.id] = 'build';
          }
          return {
            sessionJobs: newJobs,
            sessionPreviews: newPreviews,
            sessionSidePanelStates: newPanels,
          };
        });

        const { sessionJobs } = get();

        // 2. Sync job statuses with backend (don't force-activate running sessions)
        for (const session of sessions) {
          const job = sessionJobs[session.id];
          if (job?.jobId && (job.status === 'running' || job.status === 'queued')) {
            const res = await tryCall(() => api.jobs.get({ id: job.jobId! }));
            if (res.ok) {
              const actual = res.data;
              if (actual.status !== 'running' && actual.status !== 'queued') {
                // Job finished since last page load -- update local state
                set((state) => ({
                  sessionJobs: {
                    ...state.sessionJobs,
                    [session.id]: { ...(state.sessionJobs[session.id] || getDefaultSessionJob()), status: actual.status as SessionJobState['status'] },
                  },
                }));
              }
            } else {
              // Job not found (server restarted, job expired) or backend unreachable -- mark failed.
              set((state) => ({
                sessionJobs: {
                  ...state.sessionJobs,
                  [session.id]: { ...(state.sessionJobs[session.id] || getDefaultSessionJob()), status: 'failed' },
                },
              }));
            }
          }
        }

        // 3. Clean up surplus empties, preserve active session if it still exists.
        // Sessions referenced by an artifact instance are never "empty" — they hold
        // a built app whose conversation history is gone (cascade-deleted with a
        // prior session) but whose project/files/preview are intact. Deleting them
        // here would orphan the artifact from any UI path.
        // The single persistent onboarding session is likewise never "empty": its
        // guided welcome + chips are the content even at zero messages, and it must
        // survive so a second visit resumes it. Never delete a type==='onboarding'.
        const updatedJobs = get().sessionJobs;
        const prevActiveId = get().activeSessionId;
        const emptySessions = sessions.filter((s) => {
          if (artifactBySessionId.has(s.id)) return false;
          if (s.type === 'onboarding') return false;
          const job = updatedJobs[s.id];
          return s.messageCount === 0 && (!job?.jobId);
        });
        const nonEmptySessions = sessions.filter((s) => !emptySessions.some((e) => e.id === s.id));

        if (emptySessions.length > 0) {
          // Keep one empty session, preferring the previously active one
          const freshSession = emptySessions.find((s) => s.id === prevActiveId) || emptySessions[0];
          const toDelete = emptySessions.filter((s) => s.id !== freshSession.id);

          // Delete surplus empties (fire-and-forget). Guard against the
          // cross-page race: the runtime now initializes on EVERY shell mount,
          // and a fast navigation can re-list a session whose delete from the
          // previous mount is still in flight - re-deleting it 404s in the
          // browser console (the zero-console-error QA bar catches it). Track
          // swept ids per tab so each id is only ever deleted once.
          const SWEPT_KEY = 'ekoa_swept_sessions';
          let swept = new Set<string>();
          try {
            swept = new Set(JSON.parse(sessionStorage.getItem(SWEPT_KEY) || '[]') as string[]);
          } catch {
            // Corrupt/absent entry - start clean.
          }
          for (const s of toDelete) {
            if (swept.has(s.id)) continue;
            swept.add(s.id);
            api.sessions.delete({ id: s.id }).catch(() => {});
          }
          try {
            sessionStorage.setItem(SWEPT_KEY, JSON.stringify([...swept]));
          } catch {
            // Storage full/unavailable - the guard degrades to the old behavior.
          }

          // Remove deleted session state
          const deleteIds = new Set(toDelete.map((s) => s.id));
          set((state) => {
            const newJobs = { ...state.sessionJobs };
            const newPreviews = { ...state.sessionPreviews };
            const newFiles = { ...state.sessionFiles };
            const newMessages = { ...state.messages };
            for (const id of deleteIds) {
              delete newJobs[id];
              delete newPreviews[id];
              delete newFiles[id];
              delete newMessages[id];
            }
            // Keep active session if it survived cleanup
            const remainingSessions = [freshSession, ...nonEmptySessions];
            const prevSurvived = prevActiveId && remainingSessions.some((s) => s.id === prevActiveId);
            return {
              sessions: remainingSessions,
              activeSessionId: prevSurvived ? prevActiveId! : freshSession.id,
              sessionJobs: newJobs,
              sessionPreviews: newPreviews,
              sessionFiles: newFiles,
              messages: newMessages,
            };
          });
        } else {
          // All sessions have history, or no sessions at all
          const prevInSessions = prevActiveId && sessions.some((s) => s.id === prevActiveId);
          if (!prevInSessions) {
            // Previous active session gone -- create a fresh one
            await get().createSession();
          }
        }
      },

      activateMostRecentSession: () => {
        const { sessions } = get();
        if (sessions.length === 0) return;
        const sorted = [...sessions].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        set({ activeSessionId: sorted[0].id });
      },

      activateOrCreateEmptySession: async () => {
        // Guard against concurrent creation from rapid clicks
        if (_creatingEmptySession) return;

        const { sessions, sessionJobs } = get();
        // Find an existing empty session (no messages, no active job, and no
        // attached artifact). A session with an artifactInstanceId is not
        // "empty" — it holds a built app whose chat history may have been
        // cascade-deleted, but the artifact must not be reused as a fresh chat.
        // A type==='onboarding' session is likewise off-limits here: it is the
        // dedicated guided-onboarding conversation, not a generic scratch chat,
        // and reusing it would hijack the onboarding flow / lose its identity.
        const empty = sessions.find((s) => {
          const job = sessionJobs[s.id];
          if (job?.artifactInstanceId) return false;
          if (s.type === 'onboarding') return false;
          return s.messageCount === 0 && (!job?.jobId);
        });
        if (empty) {
          // Bump updatedAt locally so the reused session jumps to the top
          // of the recency-sorted sidebar; persist to the backend so the
          // position survives reload (otherwise loadSessions overwrites it).
          const now = new Date().toISOString();
          set((state) => ({
            activeSessionId: empty.id,
            sessions: state.sessions.map((s) =>
              s.id === empty.id ? { ...s, updatedAt: now } : s
            ),
          }));
          void api.sessions.update({ id: empty.id });
        } else {
          _creatingEmptySession = true;
          try {
            await get().createSession();
          } finally {
            _creatingEmptySession = false;
          }
        }
      },

      hydrateSessionFromArtifact: async (sessionId, artifacts) => {
        // Files panel hydration runs unconditionally — it's idempotent and
        // needed every load because `sessionFiles` is not persisted across
        // reload (only the live SSE `tool_use` stream populates it). The
        // helper bails out cheaply if the tree is already populated.
        const hydrateFiles = (artifactId: string) => {
          void (async () => {
            const res = await tryCall(() => api.artifacts.filesList({ id: artifactId }));
            if (!res.ok) return;
            const files = res.data.files || [];
            set((state) => {
              const patch: Partial<OrchestrationState> = {};
              // Files panel — only seed if SSE hasn't populated it.
              if ((state.sessionFiles[sessionId] || []).length === 0 && files.length > 0) {
                let tree: FileNode[] = [];
                for (const f of files) {
                  const displayPath = getSandboxDisplayPath(f.path);
                  tree = addFileToTree(tree, displayPath, 'created', f.path);
                }
                patch.sessionFiles = { ...state.sessionFiles, [sessionId]: tree };
              }
              return Object.keys(patch).length > 0 ? patch : {};
            });
          })();
        };

        // Set (or refresh, respecting explicit closes) the side panel to
        // 'build' for an artifact-linked session.
        const openBuildPanel = () => {
          set((state) => {
            const isActive = state.activeSessionId === sessionId;
            const currentPanel = state.sessionSidePanelStates[sessionId];
            if (currentPanel !== undefined) return {};
            return {
              sessionSidePanelStates: { ...state.sessionSidePanelStates, [sessionId]: 'build' },
              ...(isActive ? { sidePanelState: 'build' as SidePanelState } : {}),
            };
          });
        };

        // Resolve the authoritative artifact for this session. We must do this
        // EVEN when a (possibly stale) job is already persisted: slug + appUrl
        // drift server-side — build-completion handlers persist a slug-based
        // preview URL (/apps/<slug>/), but slugs get renamed (unindexed), the
        // index is rebuilt from an unordered readAll() on every deploy, and
        // forks/imports can collide. A stale slug-based URL then resolves to a
        // DIFFERENT artifact's app (the "wrong preview" bug). The artifact
        // record's id-based `data.appUrl` (/apps/<id>/) never drifts, so we
        // reconcile identity to it on every load.
        let list = artifacts;
        if (!list) {
          const res = await tryCall(() => api.artifacts.list());
          if (res.ok) {
            list = res.data.items as unknown as ArtifactRef[];
          }
        }

        const existing = get().sessionJobs[sessionId];
        // Prefer the artifact ALREADY PINNED to this session (an explicit user
        // choice — e.g. clicking a specific "Continua onde paraste" card, which
        // primes the job before navigating). This is essential because a single
        // session can be shared by several artifacts (legacy forks/copies all
        // carried the source's sessionId): resolving purely by sessionId would
        // return whichever artifact happens to be first in list order, which is
        // non-deterministic across deploys — the "wrong artifact" symptom. Fall
        // back to the first artifact whose data.sessionId matches only when no
        // artifact is pinned yet (e.g. a cold URL hit on a fresh browser).
        const match =
          (existing?.artifactInstanceId
            ? list?.find((a) => a?.id === existing.artifactInstanceId)
            : undefined) ?? list?.find((a) => a?.data?.sessionId === sessionId);

        // No artifact resolved for this session. If the list fetch failed but we
        // already have a linked job, keep it and hydrate files; otherwise there
        // is nothing to show.
        if (!match) {
          if (existing?.artifactInstanceId) {
            hydrateFiles(existing.artifactInstanceId);
            openBuildPanel();
            return true;
          }
          return false;
        }

        // Don't clobber a build that is actively running/queued for this session:
        // its live job + preview state is authoritative until it completes. Just
        // refresh files + panel.
        const building =
          existing?.status === 'running' ||
          existing?.status === 'queued';
        if (building) {
          hydrateFiles(match.id);
          openBuildPanel();
          return true;
        }

        set((state) => {
          const job = state.sessionJobs[sessionId] || getDefaultSessionJob();
          const preview = state.sessionPreviews[sessionId] || getDefaultSessionPreview();
          const isActive = state.activeSessionId === sessionId;
          const currentPanel = state.sessionSidePanelStates[sessionId];
          // Prefer the artifact's own id-based canonical URL (slug-drift-immune).
          const canonicalAppUrl = match.data?.appUrl ?? `/apps/${match.id}/`;
          return {
            sessionJobs: {
              ...state.sessionJobs,
              [sessionId]: {
                ...job,
                artifactInstanceId: match.id,
                slug: match.slug ?? null,
                shareable: match.shareable === true,
                projectPath: match.data?.projectDir ?? job.projectPath ?? null,
                status: job.status === 'idle' ? 'completed' : job.status,
                lastBuildAt: match.updatedAt ?? match.createdAt ?? job.lastBuildAt,
              },
            },
            sessionPreviews: {
              ...state.sessionPreviews,
              [sessionId]: {
                ...preview,
                // Reconcile to the artifact's canonical URL and drop any stale
                // slug-based previewId so the side panel can't fall back to it.
                appUrl: canonicalAppUrl,
                previewId: null,
                status: preview.status === 'idle' ? 'running' : preview.status,
              },
            },
            sessionSidePanelStates:
              currentPanel !== undefined
                ? state.sessionSidePanelStates
                : { ...state.sessionSidePanelStates, [sessionId]: 'build' },
            ...(isActive && currentPanel === undefined ? { sidePanelState: 'build' as SidePanelState } : {}),
          };
        });

        hydrateFiles(match.id);

        return true;
      },
    }),
    {
      name: 'ekoa_orchestration',
      version: 4,
      partialize: (state) => ({
        sessionSidePanelStates: state.sessionSidePanelStates,
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        // Strip output arrays from sessionJobs -- they can be massive (SSE streaming)
        // and would exceed localStorage's ~5MB quota.
        // Also sanitize running/queued status to idle -- these transient states cannot
        // survive a page reload and must be re-verified with the backend on next init.
        sessionJobs: Object.fromEntries(
          Object.entries(state.sessionJobs).map(([id, job]) => [
            id,
            {
              ...job,
              output: [],
              status: (job.status === 'running' || job.status === 'queued') ? 'idle' : job.status,
            },
          ])
        ),
        sessionPreviews: state.sessionPreviews,
        sessionFiles: state.sessionFiles,
        sidePanelTab: state.sidePanelTab,
        // Persist so the Resend button on the latest user message survives reloads / cross-tab.
        retryContexts: state.retryContexts,
      }),
    }
  )
);
