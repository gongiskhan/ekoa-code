"use client";

/**
 * Sheet feed - the chat-mode content of the unified side panel (Part B, slice B4).
 *
 * The real desk surface replacing the B3 placeholder internals; the SidePanel host and
 * this file's props contract are unchanged. What it renders (BRIEF locked decisions
 * 4, 5, 10):
 *   - Sheets pile as a scrollable feed, newest at the BOTTOM, with standard chat-feed
 *     auto-follow: engaged at the bottom, disengaged when the user scrolls up.
 *   - Each sheet is a paper card on a subtle desk surface, its latest (or navigated)
 *     revision rendered as markdown via the repo's markdown renderer (react-markdown +
 *     remark-gfm with a per-surface Components map - the chat-panel/output-panel/
 *     empty-state convention). Typography scales with CONTENT LENGTH via a pure class
 *     switch (sheet-scale-display / -article / -dense in globals.css); the markdown
 *     elements size in em so the class's base font-size is the single scaling knob.
 *   - A consistent footer: provenance (memoriesUsed / traceId from the source message's
 *     metadata - the B1 writers), an EXTENSIBLE actions array (editar / copiar /
 *     promover-stub; Part C appends ouvir), and 2-3 heuristic follow-up suggestions
 *     that draft into the composer AND set the composer chip to target THIS sheet
 *     (the pill's intent is an edit of the sheet it sits under - locked 6's manual SET).
 *   - editar posts to the B1 revisions endpoint (who/when/what recorded server-side)
 *     and renders the new revision; prev/next navigation walks revisions[].
 *   - Revise-in-place (locked 5): when a sheet gains a revision - a local edit or a
 *     refetch after a run - the feed scrolls to that sheet and flashes it.
 *
 * Feed updates arrive two ways: fetch-on-settle (isExecuting flipping false) and the
 * B2 `reply_summary` notification (per-user channel, routed by sessionId).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Pencil,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Sheet } from "@ekoa/shared";
import { api, tryCall } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { useApi } from "@/components/providers/api-provider";
import { useOrchestrationStore } from "@/stores/orchestration";
import { useTranslation } from "@/stores/i18n";

interface SheetFeedPanelProps {
  sessionId: string | null;
  /** Collapse the panel (desktop) - same contract as the build variant's chevron. */
  onClose?: () => void;
}

// ============================================
// TYPOGRAPHY SCALE (locked decision 10)
// ============================================

type SheetScale = "display" | "article" | "dense";

/** Length-scaled typography: short reply = display, medium = article, long = dense
 *  document. Thresholds on content length, applied as a class switch only. */
function sheetScaleFor(content: string): SheetScale {
  const len = content.trim().length;
  if (len < 240) return "display";
  if (len <= 1600) return "article";
  return "dense";
}

// ============================================
// MARKDOWN COMPONENTS (em-sized; the scale class sets the base font-size)
// ============================================

const SHEET_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="text-[1.3em] font-semibold text-neutral-900 mt-[1.1em] mb-[0.45em] first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[1.15em] font-semibold text-neutral-900 mt-[1em] mb-[0.4em] first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[1.05em] font-semibold text-neutral-800 mt-[0.9em] mb-[0.35em] first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-[1em] font-semibold text-neutral-800 mt-[0.8em] mb-[0.3em] first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="mb-[0.75em] last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc pl-5 mb-[0.75em] last:mb-0 space-y-[0.3em]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 mb-[0.75em] last:mb-0 space-y-[0.3em]">{children}</ol>
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
      return <code className="block text-[0.85em] leading-snug">{children}</code>;
    }
    return (
      <code className="bg-neutral-100 text-neutral-800 rounded px-1 py-0.5 text-[0.85em] font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-neutral-800 text-neutral-100 rounded-lg p-3 my-[0.75em] overflow-x-auto text-[0.85em] font-mono leading-snug">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-neutral-300 pl-3 my-[0.75em] italic text-neutral-500">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-[0.75em]">
      <table className="min-w-full text-[0.9em] border border-neutral-200 rounded">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-neutral-100">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-neutral-200">{children}</tbody>,
  tr: ({ children }) => <tr className="even:bg-neutral-50">{children}</tr>,
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-semibold text-neutral-700 border-b border-neutral-200">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-2 py-1 text-neutral-600">{children}</td>,
  hr: () => <hr className="my-[1em] border-neutral-200" />,
  strong: ({ children }) => <strong className="font-semibold text-neutral-900">{children}</strong>,
};

// ============================================
// FOOTER ACTIONS (extensible list - Part C appends `ouvir` here)
// ============================================

interface SheetAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect?: () => void;
  /** A not-yet-available stub: rendered disabled-style with this tooltip. */
  soonTitle?: string;
}

function SheetCardSkeleton() {
  return (
    <div
      data-testid="sheet-skeleton"
      className="bg-white border border-neutral-200 rounded-xl p-4 shadow-card animate-pulse"
    >
      <div className="h-3.5 w-2/3 bg-neutral-200 rounded mb-3" />
      <div className="h-3 w-full bg-neutral-100 rounded mb-2" />
      <div className="h-3 w-4/5 bg-neutral-100 rounded" />
    </div>
  );
}

// How close to the bottom (px) still counts as "at the bottom" for auto-follow.
const FOLLOW_THRESHOLD_PX = 48;
const HIGHLIGHT_MS = 1600;
const COPIED_MS = 1500;

interface EditingState {
  sheetId: string;
  draft: string;
  saving: boolean;
  error: boolean;
}

export default function SheetFeedPanel({ sessionId, onClose }: SheetFeedPanelProps) {
  const { sheetFeed, common } = useTranslation();
  const { notifications } = useApi();
  const isExecuting = useOrchestrationStore((s) => s.isExecuting);
  const setComposerDraft = useOrchestrationStore((s) => s.setComposerDraft);
  const setEditTarget = useOrchestrationStore((s) => s.setEditTarget);
  const setSessionLatestSheet = useOrchestrationStore((s) => s.setSessionLatestSheet);
  const setSheetLinks = useOrchestrationStore((s) => s.setSheetLinks);
  // B5 focus seam: the transcript's summary cards request a scroll-to + flash through the
  // store (never this component's DOM). seq-keyed so repeat clicks re-fire.
  const sheetFocus = useOrchestrationStore((s) => (sessionId ? s.sheetFocus[sessionId] : undefined));
  const messages = useOrchestrationStore((s) => (sessionId ? s.messages[sessionId] : undefined));

  // The loaded feed is keyed by the session it belongs to, so a session switch simply
  // stops matching (no reset effect, no lingering cards from the previous session).
  const [feed, setFeed] = useState<{ forSession: string; items: Sheet[] } | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  // Per-sheet displayed revision INDEX (absent = latest). Clamped at render time.
  const [viewIndex, setViewIndex] = useState<Record<string, number>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);
  const feedRef = useRef<typeof feed>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The session this mount is CURRENTLY showing (stale-response guard target). */
  const liveSessionRef = useRef(sessionId);
  /** Monotonic fetch sequence: only the LATEST in-flight load may commit (ordering guard). */
  const feedReqSeq = useRef(0);
  useEffect(() => {
    liveSessionRef.current = sessionId;
    // A session switch abandons any in-flight edit UI: the edit belonged to the
    // previous session's sheet, and a stale save continuation must find nothing
    // to resurrect (closes the stuck 'saving:true' recheck finding).
    setEditing(null);
  }, [sessionId]);
  useEffect(() => {
    feedRef.current = feed;
  }, [feed]);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  // The "Copiado" feedback resets itself; an effect owns the timer so the copy
  // handler stays ref-free (the actions array is built during render).
  useEffect(() => {
    if (!copiedId) return;
    const timer = setTimeout(() => setCopiedId(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copiedId]);

  /** Scroll-to + brief highlight (locked 5's revise-in-place behavior). `force` scrolls
   *  even when auto-follow is disengaged - an EXPLICIT card click is user intent, unlike a
   *  background revision arriving while the reader scrolled up. */
  const flashSheet = useCallback((sheetId: string, opts?: { force?: boolean }) => {
    setHighlightId(sheetId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    // After the re-render commits the revised content, bring the card into view. The
    // card is resolved by its data attribute (no per-card element refs needed).
    requestAnimationFrame(() => {
      // Highlight always; scroll only while auto-follow is engaged - a reader who
      // scrolled up is never yanked to the revised sheet (codex B4 finding 1).
      if (!opts?.force && !autoFollowRef.current) return;
      scrollRef.current
        ?.querySelector(`[data-sheet-id="${CSS.escape(sheetId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  const clearViewIndex = useCallback((sheetId: string) => {
    setViewIndex((v) => {
      if (!(sheetId in v)) return v;
      const next = { ...v };
      delete next[sheetId];
      return next;
    });
  }, []);

  /** Fetch the feed from the live B1 endpoint. Diffs against the previous load: a sheet
   *  whose revision count grew is revised-in-place - snap its view to latest + flash. */
  const loadFeed = useCallback(async () => {
    if (!sessionId) return;
    const seq = ++feedReqSeq.current;
    const res = await tryCall(() => api.sheets.list({ id: sessionId }));
    // Stale-response guards: a slower response for a previous session, or an older
    // same-session request resolving after a newer one, must never commit
    // (B4 review finding 1 + codex finding 2).
    if (liveSessionRef.current !== sessionId || seq !== feedReqSeq.current) return;
    if (!res.ok) {
      // Keep whatever is already rendered for this session; only seed loaded-but-empty
      // when nothing was loaded yet (so the loading skeleton settles).
      setFeed((cur) =>
        cur && cur.forSession === sessionId ? cur : { forSession: sessionId, items: [] },
      );
      return;
    }
    const next = res.data.items;
    const prev = feedRef.current;
    let revisedId: string | null = null;
    if (prev && prev.forSession === sessionId) {
      const prevById = new Map(prev.items.map((s) => [s.sheetId, s]));
      for (const s of next) {
        const p = prevById.get(s.sheetId);
        if (p && s.revisions.length > p.revisions.length) revisedId = s.sheetId;
      }
    }
    setFeed({ forSession: sessionId, items: next });
    if (revisedId) {
      clearViewIndex(revisedId);
      flashSheet(revisedId);
    }
  }, [sessionId, clearViewIndex, flashSheet]);

  // Load when the session is known and no run is in flight; a run settling (isExecuting
  // flipping false) refetches so the reply's sheet appears (item-5 lowest tier).
  useEffect(() => {
    if (!sessionId || isExecuting) return;
    void (async () => {
      await loadFeed();
    })();
  }, [sessionId, isExecuting, loadFeed]);

  // The B2 reply_summary notification (per-user channel, sessionId-routed) also refreshes
  // the feed - it survives the user having navigated away mid-run and carries the
  // revised-sheet case the settle refetch would only catch by diff anyway.
  useEffect(() => {
    if (!notifications || !sessionId) return;
    return notifications.on("reply_summary", (event) => {
      if (event.sessionId === sessionId) void loadFeed();
    });
  }, [notifications, sessionId, loadFeed]);

  // B5 chip target: publish the most recently TOUCHED sheet (latest revision createdAt;
  // transcript order breaks ties) - the heuristic's "most recent sheet". Rides every feed
  // commit (initial load, settle refetch, local edit), so the chip always names server truth.
  // Alongside it (codex fix 2): the createdFromMessageId back-references, the transcript
  // cards' by-message-id card->sheet resolution source when no summary/stamp exists.
  useEffect(() => {
    if (!feed) return;
    let pick: Sheet | null = null;
    let pickAt = "";
    const links: Record<string, string> = {};
    for (const s of feed.items) {
      links[s.createdFromMessageId] = s.sheetId;
      const at = s.revisions[s.revisions.length - 1]?.createdAt ?? "";
      if (!pick || at >= pickAt) {
        pick = s;
        pickAt = at;
      }
    }
    setSessionLatestSheet(feed.forSession, pick ? { sheetId: pick.sheetId, title: pick.title } : null);
    setSheetLinks(feed.forSession, links);
  }, [feed, setSessionLatestSheet, setSheetLinks]);

  // B5 focus seam consumption: a summary-card click lands here as a seq-bumped request.
  // The baseline effect adopts whatever seq existed BEFORE this mount so a remount never
  // replays a stale request (effects run in declaration order).
  const lastFocusSeq = useRef(0);
  useEffect(() => {
    lastFocusSeq.current = sessionId
      ? (useOrchestrationStore.getState().sheetFocus[sessionId]?.seq ?? 0)
      : 0;
  }, [sessionId]);
  useEffect(() => {
    if (!sheetFocus || sheetFocus.seq <= lastFocusSeq.current) return;
    lastFocusSeq.current = sheetFocus.seq;
    const items = feedRef.current?.forSession === sessionId ? feedRef.current.items : null;
    if (!items || items.length === 0) return;
    const targetId = sheetFocus.sheetId ?? items[items.length - 1]!.sheetId;
    // An id the feed does not hold (e.g. a local-only mirror turn whose summary never
    // arrived) must not flash a misleading card - do nothing.
    if (!items.some((s) => s.sheetId === targetId)) return;
    flashSheet(targetId, { force: true });
  }, [sheetFocus, sessionId, flashSheet]);

  // null = not loaded yet (skeleton); [] = loaded, session has no sheets.
  const sheets: Sheet[] | null = !sessionId
    ? []
    : feed && feed.forSession === sessionId
      ? feed.items
      : null;
  const loading = sheets === null;

  // Auto-follow (locked 4): newest at the bottom; follow new content while the user is
  // at the bottom, disengage when they scroll up, re-engage when they return.
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    autoFollowRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
  }, []);

  const lastSheet = sheets && sheets.length > 0 ? sheets[sheets.length - 1] : null;
  const followKey = lastSheet
    ? `${lastSheet.sheetId}:${lastSheet.revisions.length}`
    : String(sheets?.length ?? -1);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoFollowRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [followKey, loading, isExecuting]);

  // -- Footer actions ---------------------------------------------------------------

  const copySheet = useCallback(async (sheet: Sheet) => {
    const latest = sheet.revisions[sheet.revisions.length - 1];
    if (!latest) return;
    const ok = await copyToClipboard(latest.content);
    if (ok) setCopiedId(sheet.sheetId);
  }, []);

  const saveEdit = useCallback(async () => {
    const cur = editing;
    if (!cur || !sessionId || cur.saving) return;
    const content = cur.draft.trim();
    if (!content) return;
    setEditing({ ...cur, saving: true, error: false });
    const forSession = sessionId;
    const res = await tryCall(() =>
      api.sheets.createRevision({ id: sessionId, sheetId: cur.sheetId, content }),
    );
    // A stale continuation after a session switch must not mutate the new
    // session's editing/feed/scroll state (codex B4 finding 3).
    if (liveSessionRef.current !== forSession) return;
    if (!res.ok) {
      setEditing((state) => (state ? { ...state, saving: false, error: true } : state));
      return;
    }
    const updated = res.data;
    setFeed((state) =>
      state && state.forSession === sessionId
        ? {
            ...state,
            items: state.items.map((s) => (s.sheetId === updated.sheetId ? updated : s)),
          }
        : state,
    );
    clearViewIndex(updated.sheetId);
    setEditing(null);
    flashSheet(updated.sheetId);
  }, [editing, sessionId, clearViewIndex, flashSheet]);

  /** 2-3 static heuristic follow-ups (v1): derived from the sheet's length scale and
   *  title shape - no model call. Selecting one drafts it into the composer. */
  const followUpsFor = useCallback(
    (scale: SheetScale, title: string): string[] => {
      const out: string[] = [];
      if (scale === "display") out.push(sheetFeed.followUpElaborate, sheetFeed.followUpExample);
      else if (scale === "article") out.push(sheetFeed.followUpConcise, sheetFeed.followUpExample);
      else out.push(sheetFeed.followUpSummarize, sheetFeed.followUpSimplify);
      // A question-shaped title suggests grounding the answer with an example.
      if (/\?\s*$/.test(title) && !out.includes(sheetFeed.followUpExample)) {
        out.unshift(sheetFeed.followUpExample);
      }
      out.push(sheetFeed.followUpFormal);
      return out.slice(0, 3);
    },
    [sheetFeed],
  );

  return (
    <div className="flex-1 bg-neutral-50 flex flex-col min-w-0" data-testid="sheet-feed">
      {/* Header - mirrors the build variant's tab bar height + close affordance. */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-800">
          <FileText size={15} className="text-teal-600" />
          {sheetFeed.title}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors"
            title={sheetFeed.hidePanel}
            aria-label={sheetFeed.hidePanel}
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>

      {/* The desk: a slightly darker surface the paper sheets sit on. Newest at the
          bottom (locked 4), auto-follow via the scroll handler above. */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-neutral-100 px-4 py-5 space-y-4 scrollbar-light"
      >
        {(sheets ?? []).map((sheet) => {
          const lastIdx = sheet.revisions.length - 1;
          const shownIdx = Math.min(viewIndex[sheet.sheetId] ?? lastIdx, lastIdx);
          const revision = sheet.revisions[shownIdx];
          if (!revision) return null;
          const scale = sheetScaleFor(revision.content);
          const isEditing = editing?.sheetId === sheet.sheetId;
          const sourceMeta = messages?.find((m) => m.id === sheet.createdFromMessageId)?.metadata;
          const memoriesUsed = sourceMeta?.memoriesUsed ?? 0;
          const traceId = sourceMeta?.traceId;
          const copied = copiedId === sheet.sheetId;

          const actions: SheetAction[] = [
            {
              id: "edit",
              label: sheetFeed.actionEdit,
              icon: Pencil,
              onSelect: () =>
                setEditing({
                  sheetId: sheet.sheetId,
                  draft: revision.content,
                  saving: false,
                  error: false,
                }),
            },
            {
              id: "copy",
              label: copied ? sheetFeed.actionCopied : sheetFeed.actionCopy,
              icon: copied ? Check : Copy,
              onSelect: () => void copySheet(sheet),
            },
            {
              id: "promote",
              label: sheetFeed.actionPromote,
              icon: ArrowUpRight,
              soonTitle: sheetFeed.promoteSoon,
            },
          ];

          return (
            <article
              key={sheet.sheetId}
              data-sheet-id={sheet.sheetId}
              data-testid="sheet-card"
              className={`bg-white border border-neutral-200 rounded-xl shadow-card overflow-hidden ${
                highlightId === sheet.sheetId ? "sheet-flash" : ""
              }`}
            >
              {isEditing && editing ? (
                <div className="p-4 space-y-2">
                  <textarea
                    data-testid="sheet-edit-area"
                    aria-label={sheetFeed.editAreaLabel}
                    value={editing.draft}
                    onChange={(e) =>
                      setEditing((state) =>
                        state ? { ...state, draft: e.target.value, error: false } : state,
                      )
                    }
                    rows={Math.min(16, Math.max(6, editing.draft.split("\n").length + 1))}
                    className="w-full text-sm font-mono text-neutral-800 leading-relaxed border border-neutral-200 rounded-lg p-3 resize-y focus-ring bg-neutral-50"
                  />
                  {editing.error && (
                    <p className="text-xs text-red-600">{sheetFeed.editError}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      data-testid="sheet-edit-save"
                      onClick={() => void saveEdit()}
                      disabled={editing.saving || !editing.draft.trim()}
                      className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {common.save}
                    </button>
                    <button
                      data-testid="sheet-edit-cancel"
                      onClick={() => setEditing(null)}
                      className="px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-600 text-xs font-medium hover:bg-neutral-100 transition-colors"
                    >
                      {common.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  data-testid="sheet-body"
                  className={`sheet-markdown sheet-scale-${scale} text-neutral-800 px-5 py-4`}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={SHEET_MARKDOWN_COMPONENTS}>
                    {revision.content}
                  </ReactMarkdown>
                </div>
              )}

              {/* Consistent sheet footer (locked 10): provenance, actions, follow-ups. */}
              <footer className="border-t border-neutral-100 px-4 py-2.5 space-y-2">
                {(memoriesUsed > 0 || traceId) && (
                  <div
                    data-testid="sheet-provenance"
                    className="flex items-center gap-2 text-[10px] text-neutral-400 min-w-0"
                  >
                    {memoriesUsed > 0 && (
                      <span className="shrink-0">{sheetFeed.provenanceMemories(memoriesUsed)}</span>
                    )}
                    {traceId && (
                      <span className="font-mono truncate" title={traceId}>
                        {traceId}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1">
                  {actions.map((action) => {
                    const Icon = action.icon;
                    const button = (
                      <button
                        key={action.id}
                        data-testid={`sheet-action-${action.id}`}
                        onClick={action.onSelect}
                        disabled={!!action.soonTitle}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                          action.soonTitle
                            ? "text-neutral-300 cursor-not-allowed"
                            : "text-neutral-500 hover:text-teal-700 hover:bg-teal-50"
                        }`}
                      >
                        <Icon size={12} />
                        {action.label}
                      </button>
                    );
                    // Tooltips do not fire on disabled buttons in every browser, so
                    // the soon-stub tooltip rides a wrapping span.
                    return action.soonTitle ? (
                      <span key={action.id} title={action.soonTitle}>
                        {button}
                      </span>
                    ) : (
                      button
                    );
                  })}

                  {sheet.revisions.length > 1 && (
                    <div className="ml-auto flex items-center gap-0.5 text-[10px] text-neutral-400">
                      <button
                        data-testid="sheet-rev-prev"
                        onClick={() =>
                          setViewIndex((v) => ({
                            ...v,
                            [sheet.sheetId]: Math.max(0, shownIdx - 1),
                          }))
                        }
                        disabled={shownIdx === 0}
                        title={sheetFeed.prevRevision}
                        aria-label={sheetFeed.prevRevision}
                        className="p-0.5 rounded text-neutral-400 hover:text-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <span data-testid="sheet-rev-label" className="tabular-nums">
                        {sheetFeed.revisionOf(shownIdx + 1, sheet.revisions.length)}
                      </span>
                      <button
                        data-testid="sheet-rev-next"
                        onClick={() =>
                          setViewIndex((v) => ({
                            ...v,
                            [sheet.sheetId]: Math.min(lastIdx, shownIdx + 1),
                          }))
                        }
                        disabled={shownIdx === lastIdx}
                        title={sheetFeed.nextRevision}
                        aria-label={sheetFeed.nextRevision}
                        className="p-0.5 rounded text-neutral-400 hover:text-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {followUpsFor(scale, sheet.title).map((suggestion) => (
                    <button
                      key={suggestion}
                      data-testid="sheet-follow-up"
                      onClick={() => {
                        if (!sessionId) return;
                        setComposerDraft(sessionId, suggestion);
                        // The pill lives in THIS sheet's footer - its intent is an edit of
                        // this sheet, so it also sets the composer chip to target it (the
                        // manual-SET affordance locked 6 needs; the X remains the dismiss).
                        setEditTarget(sessionId, { sheetId: sheet.sheetId, title: sheet.title });
                      }}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-neutral-200 text-neutral-600 hover:border-teal-300 hover:text-teal-700 hover:bg-teal-50 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </footer>
            </article>
          );
        })}

        {(loading || isExecuting) && <SheetCardSkeleton />}

        {!loading && !isExecuting && (sheets?.length ?? 0) === 0 && (
          <p className="text-xs text-neutral-400 text-center pt-8 px-4 leading-relaxed">
            {sheetFeed.empty}
          </p>
        )}
      </div>
    </div>
  );
}
