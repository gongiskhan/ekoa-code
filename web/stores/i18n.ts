'use client';

/**
 * i18n Store (Zustand)
 *
 * Manages language selection and translation access with localStorage persistence.
 * Provides both raw store access and convenience hooks.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Translations } from '@/locales/types';
import { en, pt } from '@/locales';

export type Language = 'en' | 'pt';

interface I18nState {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: <K extends keyof Translations>(section: K) => Translations[K];
}

const translations: Record<Language, Translations> = { en, pt };

export const useI18nStore = create<I18nState>()(
  persist(
    (set, get) => ({
      language: 'pt',

      setLanguage: (lang: Language) => {
        set({ language: lang });
      },

      t: <K extends keyof Translations>(section: K): Translations[K] => {
        const { language } = get();
        return translations[language][section];
      },
    }),
    {
      name: 'ekoa_language',
      partialize: (state) => ({ language: state.language }),
    }
  )
);

/**
 * useTranslation - Convenience hook with shortcuts
 *
 * Usage:
 *   const { language, setLanguage, t, common, pages } = useTranslation();
 *   <button>{common.save}</button>
 *   <h1>{pages.builder.whatToBuild}</h1>
 */
export function useTranslation() {
  const { language, setLanguage, t } = useI18nStore();

  return {
    language,
    setLanguage,
    t,
    common: t('common'),
    pages: t('pages'),
    quickActions: t('quickActions'),
    messages: t('messages'),
    sidePanel: t('sidePanel'),
    sheetFeed: t('sheetFeed'),
    voice: t('voice'),
    chatPanel: t('chatPanel'),
    attachments: t('attachments'),
    status: t('status'),
    placeholder: t('placeholder'),
    header: t('header'),
    outputPanel: t('outputPanel'),
    sessionsPanel: t('sessionsPanel'),
    pages_platform: t('pages_platform'),
    pages_artifacts: t('pages_artifacts'),
    pages_memory: t('pages_memory'),
    pages_billing: t('pages_billing'),
    pages_gatewayKeys: t('pages_gatewayKeys'),
    sidebar: t('sidebar'),
    emptyState: t('emptyState'),
    onboarding: t('onboarding'),
    backendErrors: t('backendErrors'),
    notFound: t('notFound'),
    friendlyMessages: t('friendlyMessages'),
    versions: t('versions'),
    automations: t('automations'),
  };
}
