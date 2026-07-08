'use client';

import { useState } from 'react';
import { File, FolderOpen } from 'lucide-react';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import { ReferenceAttachAction } from './reference-attach-action';
import { FirstGrantDialog } from './first-grant-dialog';

/**
 * FC-400 attach affordance - two actions where the composer offered one:
 *  - Enviar (Upload): the existing upload pipeline (FC-060). Stored at rest, hosted.
 *  - Referenciar ficheiro/pasta local (Reference): opens the daemon picker; the path
 *    becomes a session grant, never an upload/copy (FC-401 states below).
 *
 * The Upload-vs-Reference micro-copy is a UX distinction, not a legal claim, so it
 * ships enabled and needs no citation (§12.6.1).
 *
 * The component is mounted permanently by each composer (the panel shows only when
 * `open`); it owns the first-time grant dialog (FC-411) so the dialog survives the
 * menu closing. `firstGrantSeen` is tracked per session in memory - the dialog is
 * shown the first time a Reference grant is created.
 */
export function ComposerAttachMenu({
  open,
  onClose,
  onUploadFile,
  onUploadFolder,
  onReferenceCreated,
  panelClassName,
}: {
  open: boolean;
  onClose: () => void;
  onUploadFile: () => void;
  onUploadFolder: () => void;
  /** Fired once a Reference grant is confirmed (dormant in the hosted build). */
  onReferenceCreated?: (target: string) => void;
  /** Popover positioning for the panel. Defaults to bottom-left of the trigger. */
  panelClassName?: string;
}) {
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [firstGrantSeen, setFirstGrantSeen] = useState(false);

  function handlePicked(target: string) {
    // First Reference grant shows the consent dialog (FC-411); later grants are
    // created directly (they were consented to once for the session).
    if (!firstGrantSeen) {
      setPendingTarget(target);
    } else {
      onReferenceCreated?.(target);
    }
  }

  function confirmFirstGrant() {
    if (pendingTarget) onReferenceCreated?.(pendingTarget);
    setFirstGrantSeen(true);
    setPendingTarget(null);
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

          {/* Enviar (Upload) - existing pipeline */}
          <div className="py-1">
            <p className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              {PRIVACY_COPY.uploadGroupLabel}
            </p>
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
          </div>

          {/* Referenciar (local) - never uploads */}
          <div className="border-t border-neutral-100 py-1">
            <p className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              {PRIVACY_COPY.referenceGroupLabel}
            </p>
            <ReferenceAttachAction onPicked={handlePicked} onClose={onClose} />
          </div>
        </div>
      )}

      <FirstGrantDialog
        open={pendingTarget !== null}
        target={pendingTarget ?? ''}
        onConfirm={confirmFirstGrant}
        onCancel={() => setPendingTarget(null)}
      />
    </>
  );
}
