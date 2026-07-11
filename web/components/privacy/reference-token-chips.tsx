'use client';

import { FolderKey, X } from 'lucide-react';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import type { ReferencePick } from '@/lib/bridge-local';

/**
 * FC-400 (run s6): the composer's visible reference tokens — session grants attached to
 * the OUTGOING message. Display-only labels (never full paths); removing a token only
 * drops it from the message, the grant itself is revoked in the settings surface (FC-406).
 */
export function ReferenceTokenChips({
  tokens,
  onRemove,
}: {
  tokens: ReferencePick[];
  onRemove: (grantRef: string) => void;
}) {
  if (tokens.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2" aria-label={PRIVACY_COPY.referenceTokensLabel} data-testid="reference-token-chips">
      {tokens.map((t) => (
        <div
          key={t.grantRef}
          className="flex items-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs text-teal-800"
          data-testid={`reference-token-${t.grantRef}`}
        >
          <FolderKey size={12} className="mr-1 text-teal-600" aria-hidden />
          <span className="max-w-[160px] truncate">{t.label}</span>
          <button
            type="button"
            onClick={() => onRemove(t.grantRef)}
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
