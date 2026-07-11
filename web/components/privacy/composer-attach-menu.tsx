'use client';

import { useState } from 'react';
import { File, FolderOpen, ShieldCheck, Server } from 'lucide-react';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import type { PendingReference } from '@/lib/bridge-local';
import { ReferenceAttachAction } from './reference-attach-action';
import { FirstGrantDialog } from './first-grant-dialog';
import { FileBrowserDialog } from './file-browser-dialog';

/**
 * FC-400 attach affordance - two actions where the composer offered one:
 *  - Enviar (Upload): the existing upload pipeline (FC-060). Stored at rest, hosted.
 *  - Referenciar ficheiro/pasta local (Reference): the in-app file browser (the daemon's
 *    /browse surface) lets the user pick a file/folder visually; the pick becomes a pending
 *    reference and, once consented (FC-411), a composer reference token. Never an upload/copy.
 *
 * Owner directive (2026-07-11): connected = trusted; no typed grantRefs, no typed paths — the
 * visual browser IS the picker. The grant is minted at SEND time (D3), bound to the real chat
 * session; this menu only produces a pending {path,label,kind} reference.
 *
 * The Upload-vs-Reference micro-copy is a UX distinction, not a legal claim, so it ships
 * enabled and needs no citation (§12.6.1). The component owns the first-time grant dialog
 * (FC-411) so it survives the menu closing; `firstGrantSeen` is per-session, in memory.
 */
export function ComposerAttachMenu({
  open,
  onClose,
  onUploadFile,
  onUploadFolder,
  onReferencePicked,
  panelClassName,
}: {
  open: boolean;
  onClose: () => void;
  onUploadFile: () => void;
  onUploadFolder: () => void;
  /** Fired once a Reference pick is confirmed: the composer holds it until send (D3). */
  onReferencePicked?: (ref: PendingReference) => void;
  /** Popover positioning for the panel. Defaults to bottom-left of the trigger. */
  panelClassName?: string;
}) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [pendingPick, setPendingPick] = useState<PendingReference | null>(null);
  const [firstGrantSeen, setFirstGrantSeen] = useState(false);

  function handlePicked(ref: PendingReference) {
    setBrowserOpen(false);
    // First Reference pick shows the consent dialog (FC-411); later picks are added directly
    // (consented once for the session).
    if (!firstGrantSeen) {
      setPendingPick(ref);
    } else {
      onReferencePicked?.(ref);
    }
  }

  function confirmFirstGrant() {
    if (pendingPick) onReferencePicked?.(pendingPick);
    setFirstGrantSeen(true);
    setPendingPick(null);
  }

  return (
    <>
      {open && (
        <div
          className={`absolute z-50 rounded-lg border border-neutral-200 bg-white shadow-lg ${
            panelClassName ?? 'bottom-full left-0 mb-1'
          } w-[300px] max-w-[calc(100vw-2rem)]`}
          data-testid="composer-attach-menu"
        >
          <p className="border-b border-neutral-100 px-3 py-2 text-[11px] leading-relaxed text-neutral-500">
            {PRIVACY_COPY.attachMicroCopy}
          </p>

          {/* Enviar (Upload) - existing pipeline. Kept deliberately neutral so the teal
              Reference block below reads as the recommended path for sensitive documents. */}
          <div className="py-1">
            <div className="flex items-center gap-1.5 px-3 pb-0.5 pt-1">
              <Server size={11} className="text-neutral-400" aria-hidden />
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                {PRIVACY_COPY.uploadGroupLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onUploadFile();
              }}
              className="flex w-full items-center px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-50"
              data-testid="attach-upload-file"
            >
              <File size={14} className="mr-2 text-neutral-400" aria-hidden />
              {PRIVACY_COPY.uploadFile}
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onUploadFolder();
              }}
              className="flex w-full items-center px-3 py-1.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-50"
              data-testid="attach-upload-folder"
            >
              <FolderOpen size={14} className="mr-2 text-neutral-400" aria-hidden />
              {PRIVACY_COPY.uploadFolder}
            </button>
            <p className="px-3 pb-1 pt-0.5 text-[10px] leading-snug text-amber-700">
              {PRIVACY_COPY.uploadHostedNote}
            </p>
          </div>

          {/* Referenciar (local) - never uploads. Teal "safe zone": the colour + shield +
              "recommended for sensitive documents" badge make the bridge path the obvious
              choice for confidential files (owner directive 2026-07-11). */}
          <div
            className="m-1.5 rounded-lg border border-teal-200 bg-teal-50/60 py-1"
            data-testid="attach-reference-block"
          >
            <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 pb-1 pt-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                <ShieldCheck size={12} aria-hidden />
                {PRIVACY_COPY.referenceGroupLabel}
              </span>
              <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-teal-700">
                {PRIVACY_COPY.referenceRecommendedBadge}
              </span>
            </div>
            <ReferenceAttachAction onOpenBrowser={() => setBrowserOpen(true)} onClose={onClose} />
          </div>
        </div>
      )}

      <FileBrowserDialog open={browserOpen} onCancel={() => setBrowserOpen(false)} onPick={handlePicked} />

      <FirstGrantDialog
        open={pendingPick !== null}
        target={pendingPick?.label ?? ''}
        onConfirm={confirmFirstGrant}
        onCancel={() => setPendingPick(null)}
      />
    </>
  );
}
