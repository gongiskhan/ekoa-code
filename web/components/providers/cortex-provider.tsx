'use client';

import { useEffect, useRef } from 'react';
import { initConnection, getConnection, reconnectWithToken } from '@/lib/cortex/connection';
import { useI18nStore } from '@/stores/i18n';

export function CortexProvider({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);
  const language = useI18nStore(state => state.language);

  // Sync HTML lang attribute with i18n language
  useEffect(() => {
    document.documentElement.lang = language === 'pt' ? 'pt-PT' : 'en';
  }, [language]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Parse NEXT_PUBLIC_API_URL to get the port only. Host is intentionally
    // left undefined so initConnection() derives it from window.location.hostname
    // — using the literal env hostname breaks cross-origin access (e.g. via a
    // Tailscale/LAN IP), because "localhost" then resolves to the client device
    // instead of the dev machine.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    let port: number | undefined;
    if (apiUrl) {
      try {
        const url = new URL(apiUrl);
        port = url.port ? parseInt(url.port, 10) : undefined;
      } catch { /* use defaults */ }
    }

    initConnection(undefined, port);

    // Watch for token changes from other tabs
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'ekoa_token') {
        if (e.newValue) {
          reconnectWithToken(e.newValue);
        } else {
          getConnection().disconnect();
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return <>{children}</>;
}
