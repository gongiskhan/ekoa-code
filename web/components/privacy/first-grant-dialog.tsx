'use client';

import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PRIVACY_COPY, firstGrantDialogBody } from '@/lib/privacy-claims';

/**
 * FC-411 first-time grant dialog. Shown at the point of consent when a Reference
 * grant is first created for a chosen target (§12.6.4). The body is the verbatim
 * v2 A7.2 line with the target filled in; it is operational consent copy, not a
 * custody claim, so it ships enabled.
 */
export function FirstGrantDialog({
  open,
  target,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** The chosen folder/file, filled into the verbatim body. */
  target: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={PRIVACY_COPY.firstGrantTitle}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {PRIVACY_COPY.firstGrantCancel}
          </Button>
          <Button variant="primary" onClick={onConfirm} data-testid="first-grant-confirm">
            {PRIVACY_COPY.firstGrantConfirm}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-neutral-600" data-testid="first-grant-body">
        {firstGrantDialogBody(target)}
      </p>
    </Dialog>
  );
}
