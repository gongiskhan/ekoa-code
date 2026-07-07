'use client';

import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
  duration: number;
  action?: ToastAction;
  testId?: string;
}

interface ToastState {
  toasts: ToastItem[];
  add: (toast: Omit<ToastItem, 'id'>) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export interface ToastOptions {
  duration?: number;
  action?: ToastAction;
  /** Optional stable test hook rendered as data-testid on the toast element. */
  testId?: string;
}

function push(tone: ToastTone, message: string, defaultDuration: number, opts?: ToastOptions): string {
  const duration = opts?.duration ?? defaultDuration;
  const id = useToastStore.getState().add({ tone, message, duration, action: opts?.action, testId: opts?.testId });
  if (duration > 0 && typeof globalThis.setTimeout === 'function') {
    setTimeout(() => useToastStore.getState().dismiss(id), duration);
  }
  return id;
}

/**
 * Fire a toast from anywhere (React or not). Durations: success 2.5s,
 * info 4s, error 6s - override via opts.duration (0 = sticky).
 */
export const toast = {
  success: (message: string, opts?: ToastOptions) => push('success', message, 2500, opts),
  error: (message: string, opts?: ToastOptions) => push('error', message, 6000, opts),
  info: (message: string, opts?: ToastOptions) => push('info', message, 4000, opts),
};
