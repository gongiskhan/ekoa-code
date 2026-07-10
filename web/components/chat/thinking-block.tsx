'use client';

/**
 * The collapsible thinking section: the agent's working commentary, streamed on the chat run's
 * `thinking_chunk` channel (server-redacted; ch12 white-label). Live it renders auto-expanded
 * with a shimmering label and a bounded viewport pinned to the newest line; the moment the
 * answer starts it collapses fluidly (grid-rows animation) into a "Thought for Ns" row that
 * stays re-expandable. A manual toggle always wins over the automatic behavior. The same
 * component renders the persisted variant (message metadata) collapsed by default.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { useTranslation } from '@/stores/i18n';
import { redactProviderIdentity } from '@/lib/sanitize-error';

interface ThinkingBlockProps {
  text: string;
  /** True while the run is still thinking (no answer text yet). */
  live?: boolean;
  /** Persisted duration (metadata); the live block measures its own. */
  durationMs?: number;
}

export function ThinkingBlock({ text, live = false, durationMs }: ThinkingBlockProps) {
  const { chatPanel: t } = useTranslation();
  // null = automatic (expanded while live, collapsed once done); a click takes over.
  const [userChoice, setUserChoice] = useState<boolean | null>(null);
  const expanded = userChoice ?? live;

  // The live block measures its own thinking window (mount -> live flips false).
  const startedAtRef = useRef<number | null>(null);
  const [measuredMs, setMeasuredMs] = useState<number | null>(null);
  useEffect(() => {
    if (live && startedAtRef.current === null) startedAtRef.current = Date.now();
    if (!live && startedAtRef.current !== null && measuredMs === null) {
      setMeasuredMs(Date.now() - startedAtRef.current);
    }
  }, [live, measuredMs]);

  // Keep the live viewport pinned to the newest thinking line.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text, live, expanded]);

  // Belt-and-braces: the wire is already redacted server-side; never render an engine name
  // even for events cached/replayed from before that fix.
  const clean = redactProviderIdentity(text).trim();
  if (!clean) return null;

  const ms = durationMs ?? measuredMs ?? undefined;
  const seconds = ms !== undefined ? Math.max(1, Math.round(ms / 1000)) : undefined;
  const label = live ? t.thinkingLive : seconds !== undefined ? t.thoughtForSeconds(seconds) : t.thinking;

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setUserChoice(!expanded)}
        aria-expanded={expanded}
        title={expanded ? t.hideThinking : t.showThinking}
        className="group/thinking flex items-center gap-1.5 py-0.5 text-[11px] font-medium text-neutral-400 hover:text-neutral-600 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neutral-400 rounded"
      >
        <Sparkles
          size={11}
          className={
            live
              ? 'text-teal-500'
              : 'text-neutral-300 group-hover/thinking:text-neutral-500 transition-colors'
          }
        />
        <span className={live ? 'thinking-shimmer' : ''}>{label}</span>
        <ChevronDown
          size={11}
          className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr', opacity: expanded ? 1 : 0 }}
        aria-hidden={!expanded}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="relative mt-0.5 mb-1">
            <div
              ref={scrollRef}
              className={`text-[11px] leading-relaxed text-neutral-400 whitespace-pre-wrap break-words border-l-2 border-neutral-200 pl-2.5 ${
                live ? 'max-h-36 overflow-y-auto scrollbar-light' : ''
              }`}
            >
              {clean}
            </div>
            {live && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-white to-transparent" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
