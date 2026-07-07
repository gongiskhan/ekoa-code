/**
 * Locale helper -- reads the current language from the i18n store.
 * Provides lightweight access to translations for non-React code.
 */

import type { Translations } from '@/locales/types';
import { en } from '@/locales/en';
import { pt } from '@/locales/pt';

type Language = 'en' | 'pt';

const translations: Record<Language, Translations> = { en, pt };

/**
 * Returns the current locale string, defaulting to 'pt'.
 */
export function getLocale(): string {
  if (typeof window === 'undefined') return 'pt';
  try {
    const stored = localStorage.getItem('ekoa_language');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed?.state?.language || 'pt';
    }
  } catch { /* ignore */ }
  return 'pt';
}

/**
 * Returns the full translations object for the current locale.
 */
export function getTranslations(): Translations {
  const locale = getLocale() as Language;
  return translations[locale] || translations.pt;
}

/**
 * Translates a backend error key to the current locale string.
 * Falls back to the raw key if no translation is found.
 */
export function translateBackendError(key: string): string {
  const t = getTranslations();
  const errorKey = key as keyof Translations['backendErrors'];
  return t.backendErrors[errorKey] || key;
}
