"use client";

/**
 * Sheet feed - the chat-mode content of the unified side panel (Part B, slice B3).
 *
 * PLACEHOLDER SCOPE (deliberate): lists the session's sheets (GET /sessions/:id/sheets,
 * the B1 endpoint) as plain cards - title + the latest revision's first line - plus a
 * skeleton card while the first reply is in flight (bound decision B.F: the panel enters
 * on first send with a skeleton). B4 replaces the INTERNALS of this file with the real
 * desk surface, length-scaled typography and footer; the SidePanel host and this file's
 * props contract stay untouched.
 */

import { useEffect, useState } from "react";
import { ChevronRight, FileText } from "lucide-react";
import type { Sheet } from "@ekoa/shared";
import { api, tryCall } from "@/lib/api";
import { useOrchestrationStore } from "@/stores/orchestration";
import { useTranslation } from "@/stores/i18n";

interface SheetFeedPanelProps {
  sessionId: string | null;
  /** Collapse the panel (desktop) - same contract as the build variant's chevron. */
  onClose?: () => void;
}

/** First non-empty line of a revision's markdown, heading markers stripped. */
function firstLineOf(content: string): string {
  return (
    content
      .split("\n")
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 0) ?? ""
  );
}

function SheetCardSkeleton() {
  return (
    <div
      data-testid="sheet-skeleton"
      className="bg-white border border-neutral-200 rounded-lg p-4 shadow-sm animate-pulse"
    >
      <div className="h-3.5 w-2/3 bg-neutral-200 rounded mb-3" />
      <div className="h-3 w-full bg-neutral-100 rounded mb-2" />
      <div className="h-3 w-4/5 bg-neutral-100 rounded" />
    </div>
  );
}

export default function SheetFeedPanel({ sessionId, onClose }: SheetFeedPanelProps) {
  const { sheetFeed } = useTranslation();
  const isExecuting = useOrchestrationStore((s) => s.isExecuting);
  // The loaded feed is keyed by the session it belongs to, so a session switch simply
  // stops matching (no reset effect, no lingering cards from the previous session).
  const [feed, setFeed] = useState<{ forSession: string; items: Sheet[] } | null>(null);

  // Load the feed when the session is known and no run is in flight; a run settling
  // (isExecuting flipping false) refetches so the reply's sheet appears. B4 replaces
  // this fetch-on-settle with the reply_summary notification (B2).
  useEffect(() => {
    if (!sessionId || isExecuting) return;
    let cancelled = false;
    void (async () => {
      const res = await tryCall(() => api.sheets.list({ id: sessionId }));
      if (!cancelled) setFeed({ forSession: sessionId, items: res.ok ? res.data.items : [] });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, isExecuting]);

  // null = not loaded yet (skeleton); [] = loaded, session has no sheets.
  const sheets: Sheet[] | null = !sessionId
    ? []
    : feed && feed.forSession === sessionId
      ? feed.items
      : null;
  const loading = sheets === null;

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

      {/* Feed - newest at the bottom (locked decision 4; auto-follow lands in B4). */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-light">
        {(sheets ?? []).map((sheet) => {
          const latest = sheet.revisions[sheet.revisions.length - 1];
          return (
            <div
              key={sheet.sheetId}
              data-testid="sheet-card"
              className="bg-white border border-neutral-200 rounded-lg p-4 shadow-sm"
            >
              <h3 className="text-sm font-semibold text-neutral-900 mb-1 truncate">
                {sheet.title}
              </h3>
              {latest && (
                <p className="text-xs text-neutral-500 leading-relaxed line-clamp-2">
                  {firstLineOf(latest.content)}
                </p>
              )}
            </div>
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
