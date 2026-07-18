'use client';
import React, { useEffect, useRef, useState } from 'react';
import { api, tryCall } from '@/lib/api';
import { toast } from '@/stores/toast';
import { useTranslation } from '@/stores/i18n';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Rename an artifact from its item action menu (surface contract 3.3) -
 * shared by the classic artifacts surface and the OS-mode desktop icons.
 * PATCH { name } on the existing artifacts endpoint.
 */
export function RenameArtifactDialog({
  artifactId,
  initialName,
  onClose,
  onRenamed,
}: {
  artifactId: string;
  initialName: string;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const { pages_artifacts: a, common } = useTranslation();
  const [name, setName] = useState(initialName);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Claim focus AFTER the shared Dialog's focus trap runs its initial focus
  // (parent effects fire after child effects, so plain autoFocus loses).
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.select(), 80);
    return () => clearTimeout(timer);
  }, []);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || isSaving) return;
    setIsSaving(true);
    const result = await tryCall(() => api.artifacts.patch({ id: artifactId, name: trimmed }));
    setIsSaving(false);
    if (result.ok) {
      toast.success(a.cardMenu.renamed);
      onRenamed();
      onClose();
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={a.cardMenu.rename}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            {common.cancel}
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={isSaving} disabled={!name.trim()}>
            {common.save}
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
        }}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-800 outline-none transition-colors focus:border-teal-600 focus:ring-1 focus:ring-teal-600/20"
      />
    </Dialog>
  );
}
