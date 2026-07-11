'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import type { ReferencePick } from '@/lib/bridge-local';

/**
 * FC-400 connected-state FALLBACK (run s6): the daemon predates the C4 native picker
 * (docs/bridge-counterpart-changes.md), so the user types the grantRef the bridge CLI
 * minted plus a display label. Pre-authorized by the run brief — flagged, not silent;
 * the native picker replaces this path when C4 lands.
 */
export function TypedReferenceDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: (pick: ReferencePick) => void;
  onCancel: () => void;
}) {
  const [grantRef, setGrantRef] = useState('');
  const [label, setLabel] = useState('');
  const valid = grantRef.trim().length > 1 && label.trim().length > 0;

  function confirm() {
    if (!valid) return;
    onConfirm({ grantRef: grantRef.trim(), label: label.trim() });
    setGrantRef('');
    setLabel('');
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={PRIVACY_COPY.referenceTypedTitle}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {PRIVACY_COPY.firstGrantCancel}
          </Button>
          <Button variant="primary" onClick={confirm} disabled={!valid} data-testid="typed-reference-confirm">
            {PRIVACY_COPY.referenceTypedConfirm}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-neutral-600">{PRIVACY_COPY.referenceTypedIntro}</p>
      <div className="mt-3 space-y-3">
        <Input
          label={PRIVACY_COPY.referenceTypedRefLabel}
          hint={PRIVACY_COPY.referenceTypedRefHint}
          placeholder="g-..."
          autoComplete="off"
          spellCheck={false}
          value={grantRef}
          onChange={(e) => setGrantRef(e.target.value)}
          className="font-mono"
          data-testid="typed-reference-ref"
        />
        <Input
          label={PRIVACY_COPY.referenceTypedNameLabel}
          hint={PRIVACY_COPY.referenceTypedNameHint}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          data-testid="typed-reference-label"
        />
      </div>
    </Dialog>
  );
}
