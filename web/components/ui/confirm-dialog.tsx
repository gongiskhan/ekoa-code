'use client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from './dialog';
import { Button } from './button';
import { useTranslation } from '@/stores/i18n';

type ConfirmTone = 'default' | 'danger';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  loading = false,
}: ConfirmDialogProps) {
  const { common } = useTranslation();
  const confirmText = confirmLabel ?? common?.confirm ?? 'Confirmar';
  const cancelText = cancelLabel ?? common?.cancel ?? 'Cancelar';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmText}
          </Button>
        </>
      }
    />
  );
}

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: ConfirmTone;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ open: boolean; opts: ConfirmOptions }>({
    open: false,
    opts: { title: '' },
  });
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    // A new confirm() while one is still pending: resolve the previous
    // promise with false so its awaiter unblocks instead of hanging forever.
    resolverRef.current?.(false);
    setState({ open: true, opts });
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  // If the provider unmounts with a confirm still pending, resolve it with
  // false so the awaiting promise never dangles.
  useEffect(() => {
    return () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    };
  }, []);

  const contextValue = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
      <ConfirmDialog
        open={state.open}
        onClose={() => settle(false)}
        onConfirm={() => settle(true)}
        title={state.opts.title}
        description={state.opts.description}
        confirmLabel={state.opts.confirmLabel}
        tone={state.opts.tone}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return ctx.confirm;
}
