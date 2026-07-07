'use client';

/**
 * ApiProvider (ch12 §12.1, §12.3). The client boot that replaces `cortex-provider.tsx`
 * (FC-025). Created here but NOT wired into `app/layout` - W3 (transport replacement)
 * swaps the provider in the layout. It does NOT edit or delete `cortex-provider.tsx`.
 *
 * Responsibilities:
 *  - Wire the single language source for the transport's language interceptor (§12.2.3):
 *    the i18n store's persisted value, read lazily so the egress core stays store-agnostic.
 *  - Own the notifications-stream lifecycle: open `openNotificationsStream()` once the
 *    session is authenticated, close it on logout. Driven by the token accessor, so
 *    login/logout in this tab AND cross-tab (token.ts `storage` listener) both flow through.
 *  - Expose the typed client via context (`useApi`).
 *
 * The dev host override lives in the base-URL resolver (§12.2.5) and the cross-tab token
 * sync lives in the token accessor (§12.2.4); this provider delegates to both rather than
 * re-implementing them.
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  api,
  setLanguageSource,
  getToken,
  subscribeToken,
  openNotificationsStream,
  type Api,
  type EventStream,
} from '@/lib/api';
import type { NotificationEvent } from '@ekoa/shared';
import { useI18nStore } from '@/stores/i18n';

interface ApiContextValue {
  api: Api;
  /** The single long-lived notifications stream (null until authenticated). */
  notifications: EventStream<NotificationEvent> | null;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi must be used within <ApiProvider>');
  return ctx;
}

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);
  const notificationsRef = useRef<EventStream<NotificationEvent> | null>(null);
  const [notifications, setNotifications] = useState<EventStream<NotificationEvent> | null>(null);
  const language = useI18nStore((state) => state.language);

  // Single language source for the transport (§12.2.3). Read lazily via getState() so the
  // core never imports the store and no field is injected during SSR.
  useEffect(() => {
    setLanguageSource(() => useI18nStore.getState().language);
  }, []);

  // Carry the html lang sync from the old provider.
  useEffect(() => {
    document.documentElement.lang = language === 'pt' ? 'pt-PT' : 'en';
  }, [language]);

  // Notifications-stream lifecycle, driven by the token accessor.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const sync = () => {
      const authed = Boolean(getToken());
      if (authed && !notificationsRef.current) {
        const stream = openNotificationsStream();
        notificationsRef.current = stream;
        setNotifications(stream);
      } else if (!authed && notificationsRef.current) {
        notificationsRef.current.close();
        notificationsRef.current = null;
        setNotifications(null);
      }
    };

    // Rehydrate: open immediately if a token is already persisted, then react to changes
    // (login/logout this tab, and cross-tab via the token accessor's storage listener).
    sync();
    const unsubscribe = subscribeToken(sync);

    return () => {
      unsubscribe();
      notificationsRef.current?.close();
      notificationsRef.current = null;
    };
  }, []);

  return <ApiContext.Provider value={{ api, notifications }}>{children}</ApiContext.Provider>;
}
