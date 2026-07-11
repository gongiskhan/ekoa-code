'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { FolderSearch, Download, WifiOff, RotateCw } from 'lucide-react';
import { PRIVACY_COPY, PRIVACY_SETTINGS_HREF } from '@/lib/privacy-claims';
import { useBridgePresence } from '@/hooks/use-bridge-presence';
import { openDaemonPicker, type ReferencePick } from '@/lib/bridge-local';

/**
 * FC-401 Reference action - three states driven by the bridge presence heartbeat
 * (§12.6.1). Reference NEVER uploads or copies; when the bridge is absent or
 * offline the action stays disabled and offers install / retry, never a silent
 * degrade to upload. Connected (run s6): the daemon's native OS picker (C4) mints a
 * session grant and returns {grantRef, label}; against a daemon that predates C4
 * the menu falls back to the typed-reference input (the brief's pre-authorized
 * fallback, docs/bridge-counterpart-changes.md) — flagged, never silent.
 */
export function ReferenceAttachAction({
  onPicked,
  onPickerUnavailable,
  onClose,
}: {
  /** Reports the minted grant up to the menu, which drives the first-grant dialog. */
  onPicked: (pick: ReferencePick) => void;
  /** The daemon predates the C4 picker: the menu opens the typed-reference fallback. */
  onPickerUnavailable: () => void;
  onClose: () => void;
}) {
  const { status } = useBridgePresence();

  const handlePick = useCallback(async () => {
    onClose();
    const pick = await openDaemonPicker();
    if (pick === 'cancelled') return;
    if (pick === 'unavailable') onPickerUnavailable();
    else onPicked(pick);
  }, [onClose, onPicked, onPickerUnavailable]);

  // State 1 - no bridge installed: disabled action, short explanation, install CTA.
  if (status === 'not-installed') {
    return (
      <div className="px-3 py-2" data-testid="reference-state-not-installed">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-neutral-400">
            {PRIVACY_COPY.referenceAction}
          </span>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
            {PRIVACY_COPY.bridgeNotInstalledBadge}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
          {PRIVACY_COPY.installCtaPrimary}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Link
            href={PRIVACY_SETTINGS_HREF}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-teal-700"
            data-testid="reference-install-cta"
          >
            <Download size={12} aria-hidden />
            {PRIVACY_COPY.installCtaButton}
          </Link>
          <Link
            href={PRIVACY_SETTINGS_HREF}
            onClick={onClose}
            className="text-[11px] font-medium text-teal-700 hover:text-teal-800"
          >
            {PRIVACY_COPY.saibaMais}
          </Link>
        </div>
      </div>
    );
  }

  // State 2 - installed but offline: retry, never degrade to upload.
  if (status === 'offline') {
    return (
      <div className="px-3 py-2" data-testid="reference-state-offline">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-neutral-400">
            {PRIVACY_COPY.referenceAction}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            <WifiOff size={10} aria-hidden />
            {PRIVACY_COPY.bridgeOfflineBadge}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
          {PRIVACY_COPY.bridgeOfflineHint}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
          data-testid="reference-retry"
        >
          <RotateCw size={12} aria-hidden />
          {PRIVACY_COPY.bridgeOfflineRetry}
        </button>
      </div>
    );
  }

  // State 3 - connected: open the native picker; the path becomes a session grant.
  return (
    <button
      type="button"
      onClick={handlePick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-neutral-700 transition-colors hover:bg-neutral-50"
      data-testid="reference-state-connected"
    >
      <FolderSearch size={14} className="text-teal-600" aria-hidden />
      {PRIVACY_COPY.referenceChoose}
    </button>
  );
}
