'use client';

import { useState } from 'react';
import { File, FolderOpen } from 'lucide-react';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import type { ReferencePick } from '@/lib/bridge-local';
import { ReferenceAttachAction } from './reference-attach-action';
import { FirstGrantDialog } from './first-grant-dialog';
import { TypedReferenceDialog } from './typed-reference-dialog';

/**
 * FC-400 attach affordance - two actions where the composer offered one:
 *  - Enviar (Upload): the existing upload pipeline (FC-060). Stored at rest, hosted.
 *  - Referenciar ficheiro/pasta local (Reference): the daemon picker (or, against a
 *    pre-C4 daemon, the typed-reference fallback) mints a session grant; the grant
 *    becomes a composer reference token, never an upload/copy (FC-401 states).
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
  /** Fired once a Reference grant is confirmed: the token joins the outgoing message. */
  onReferenceCreated?: (pick: ReferencePick) => void;
  /** Popover positioning for the panel. Defaults to bottom-left of the trigger. */
  panelClassName?: string;
}) {
  const [pendingPick, setPendingPick] = useState<ReferencePick | null>(null);
  const [typedOpen, setTypedOpen] = useState(false);
  const [firstGrantSeen, setFirstGrantSeen] = useState(false);

  function handlePicked(pick: ReferencePick) {
    // First Reference grant shows the consent dialog (FC-411); later grants are
    // created directly (they were consented to once for the session).
    if (!firstGrantSeen) {
      setPendingPick(pick);
    } else {
      onReferenceCreated?.(pick);
    }
  }

  function confirmFirstGrant() {
    if (pendingPick) onReferenceCreated?.(pendingPick);
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
            <ReferenceAttachAction
              onPicked={handlePicked}
              onPickerUnavailable={() => setTypedOpen(true)}
              onClose={onClose}
            />
          </div>
        </div>
      )}

      <FirstGrantDialog
        open={pendingPick !== null}
        target={pendingPick?.label ?? ''}
        onConfirm={confirmFirstGrant}
        onCancel={() => setPendingPick(null)}
      />

      <TypedReferenceDialog
        open={typedOpen}
        onConfirm={(pick) => {
          setTypedOpen(false);
          handlePicked(pick);
        }}
        onCancel={() => setTypedOpen(false)}
      />
    </>
  );
}
