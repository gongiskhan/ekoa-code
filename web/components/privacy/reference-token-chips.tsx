'use client';

import { FolderKey, X } from 'lucide-react';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import type { PendingReference } from '@/lib/bridge-local';

/**
 * FC-400: the composer's visible reference tokens — files/folders the OUTGOING message will
 * reference. These are PENDING references (path/label/kind, owner decision D3): the daemon
 * grant is minted at send time, when the chat session id exists. Display-only labels (never
 * full paths); removing a chip just drops it from the message.
 */
export function ReferenceTokenChips({
  tokens,
  onRemove,
}: {
  tokens: PendingReference[];
  /** Remove by path — the pending reference's stable identity before a grantRef exists. */
  onRemove: (path: string) => void;
}) {
  if (tokens.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2" aria-label={PRIVACY_COPY.referenceTokensLabel} data-testid="reference-token-chips">
      {tokens.map((t) => (
        <div
          key={t.path}
          className="flex items-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs text-teal-800"
          data-testid={`reference-token-${slug(t.path)}`}
        >
          <FolderKey size={12} className="mr-1 text-teal-600" aria-hidden />
          <span className="max-w-[160px] truncate">{t.label}</span>
          <button
            type="button"
            onClick={() => onRemove(t.path)}
            aria-label={PRIVACY_COPY.referenceTokenRemove}
            className="ml-1 text-teal-500 hover:text-teal-800"
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

/** A test-friendly slug of a path for the chip's data-testid (labels can repeat; paths are unique). */
function slug(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
