"use client";

import { Hand, Play, Square } from 'lucide-react';
import { useEffect } from 'react';
import { useAutomationsStore } from '@/stores/automations';
import { api } from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTranslation } from '@/stores/i18n';
import PauseForUserCanvas from './pause-for-user-canvas';
import type { StreamingConnectionStatus } from '@/types/automation';

/**
 * Full-screen modal overlay that pops the moment ANY run on this app
 * pauses for user action (CAPTCHA, MFA, payment confirm, …). Mounted
 * once at the dashboard layout so it appears regardless of which page
 * the user happens to be on. The user demanded "super clear" — this
 * blocks the entire UI behind a backdrop so it cannot be missed.
 *
 * Closes itself the instant the run resumes / cancels / finishes.
 */
export default function PauseForUserOverlay() {
  const status = useAutomationsStore((s) => s.activeRun.status);
  const automationId = useAutomationsStore((s) => s.activeRun.automationId);
  const pauseRequest = useAutomationsStore((s) => s.activeRun.pauseRequest);
  const streamingSession = useAutomationsStore((s) => s.activeRun.streamingSession);
  const resume = useAutomationsStore((s) => s.resume);
  const cancel = useAutomationsStore((s) => s.cancel);
  const confirm = useConfirm();
  const { automations } = useTranslation();
  const t = automations.pauseOverlay;

  const open = status === 'paused_for_user' && !!pauseRequest;

  // Lock body scroll while the overlay is up so background content
  // doesn't peek through user-initiated scrolling.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  // Keyboard shortcuts: Enter resumes, Escape cancels (with confirm).
  // Skip Enter capture while the user is interacting with the streaming
  // canvas — the canvas owns its own keystrokes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        if (target && target.tagName === 'CANVAS') return;
        e.preventDefault();
        resume();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, resume]);

  if (!open || !pauseRequest) return null;

  const screenshotSrc = pauseRequest.screenshotUrl
    ? api.resolveUrl(pauseRequest.screenshotUrl)
    : null;

  const streamingActive = !!streamingSession && streamingSession.status !== 'failed';
  const streamingStatus = streamingSession?.status;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-overlay-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-950/70 backdrop-blur-sm p-4"
    >
      <div className="relative w-full max-w-3xl rounded-2xl border-4 border-cyan-500 bg-white shadow-2xl ring-8 ring-cyan-200/50 overflow-hidden max-h-[95vh] flex flex-col">
        {/* Pulse ribbon — animates so the user notices even if the
            cyan + ring don't catch the eye. */}
        <div className="h-1.5 bg-cyan-500 animate-pulse shrink-0" />

        <div className="p-6 sm:p-8 overflow-y-auto">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-cyan-100 p-3 shrink-0 ring-2 ring-cyan-500/40">
              <Hand size={28} className="text-cyan-700" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wider text-cyan-700 font-semibold">
                {t.needsYou}
              </div>
              <h2
                id="pause-overlay-title"
                className="mt-1 text-xl sm:text-2xl font-bold text-neutral-900 leading-tight"
              >
                {t.stepTitle(pauseRequest.stepIndex + 1)}
              </h2>
            </div>
            {streamingSession && (
              <ConnectionBadge status={streamingSession.status} label={t.badge} />
            )}
          </div>

          <div className="mt-5 rounded-xl bg-cyan-50 border border-cyan-200 p-4">
            <div className="text-base text-cyan-950 leading-snug whitespace-pre-line">
              {pauseRequest.userInstructions}
            </div>
            {pauseRequest.reasoning && (
              <div className="mt-2 text-sm text-cyan-800/80 italic line-clamp-3">
                {pauseRequest.reasoning}
              </div>
            )}
          </div>

          {streamingActive ? (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1.5">
                {t.livePageLabel}
              </div>
              <PauseForUserCanvas session={streamingSession!} />
            </div>
          ) : screenshotSrc ? (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1.5">
                {t.screenshotLabel}
              </div>
              <a
                href={screenshotSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshotSrc}
                  alt={t.screenshotAlt}
                  className="w-full max-h-72 object-contain rounded-lg border border-neutral-200 bg-neutral-50 hover:border-neutral-400 transition-colors"
                  loading="eager"
                />
              </a>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
            <button
              type="button"
              onClick={async () => {
                if (await confirm({ title: t.stopConfirm, tone: 'danger' })) {
                  cancel();
                }
              }}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 font-medium"
            >
              <Square size={14} />
              {t.stopRun}
            </button>
            <button
              type="button"
              onClick={() => resume()}
              autoFocus
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 font-semibold shadow-md text-base"
            >
              <Play size={16} />
              {t.continue}
              <span className="text-cyan-200 text-xs ml-1">{t.enterHint}</span>
            </button>
          </div>

          <div className="mt-4 text-center text-xs text-neutral-500">
            {t.runOnAutomationPrefix}<span className="font-mono">{automationId?.slice(0, 8) ?? '-'}</span>.
            {' '}
            <FootnoteCopy streamingStatus={streamingStatus} hasScreenshot={!!screenshotSrc} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectionBadge({
  status,
  label,
}: {
  status: StreamingConnectionStatus;
  label: { live: string; connecting: string; reconnecting: string; offline: string; idle: string };
}) {
  const palette = badgePalette(status, label);
  return (
    <div
      className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${palette.classes}`}
      role="status"
      aria-live="polite"
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${palette.dot}`} />
      {palette.label}
    </div>
  );
}

function badgePalette(
  status: StreamingConnectionStatus,
  label: { live: string; connecting: string; reconnecting: string; offline: string; idle: string },
): { label: string; classes: string; dot: string } {
  switch (status) {
    case 'connected':
      return {
        label: label.live,
        classes: 'border-emerald-300 bg-emerald-50 text-emerald-800',
        dot: 'bg-emerald-500',
      };
    case 'connecting':
      return {
        label: label.connecting,
        classes: 'border-amber-300 bg-amber-50 text-amber-800',
        dot: 'bg-amber-500 animate-pulse',
      };
    case 'disconnected':
      return {
        label: label.reconnecting,
        classes: 'border-amber-300 bg-amber-50 text-amber-800',
        dot: 'bg-amber-500 animate-pulse',
      };
    case 'failed':
      return {
        label: label.offline,
        classes: 'border-red-300 bg-red-50 text-red-700',
        dot: 'bg-red-500',
      };
    case 'idle':
    default:
      return {
        label: label.idle,
        classes: 'border-neutral-300 bg-neutral-50 text-neutral-600',
        dot: 'bg-neutral-400',
      };
  }
}

function FootnoteCopy({
  streamingStatus,
  hasScreenshot,
}: {
  streamingStatus?: StreamingConnectionStatus;
  hasScreenshot: boolean;
}) {
  const { automations } = useTranslation();
  const t = automations.pauseOverlay.footnote;
  if (streamingStatus === 'connected') {
    return <>{t.connected}</>;
  }
  if (streamingStatus === 'connecting') {
    return <>{t.connecting}</>;
  }
  if (streamingStatus === 'disconnected') {
    return <>{t.disconnected}</>;
  }
  if (streamingStatus === 'failed') {
    return <>{t.failed}</>;
  }
  if (hasScreenshot) {
    return <>{t.screenshot}</>;
  }
  return <>{t.waiting}</>;
}
