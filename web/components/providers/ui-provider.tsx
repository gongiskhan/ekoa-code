'use client';
import React from 'react';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { Toaster } from '@/components/ui/toaster';

/**
 * App-wide UI shell: confirm() host + toast host. Mounted above the router
 * in the root layout so every route (including /login) can call useConfirm()
 * and the toast helpers.
 */
export function UiProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      {children}
      <Toaster />
    </ConfirmProvider>
  );
}
