/**
 * Vertical presentation profiles.
 *
 * A "vertical" is a purely cosmetic skin over the generic Ekoa core: welcome
 * copy, example prompts, mode taglines, the login tagline, the page metadata
 * description, and the ordering of the /artifacts "Pontos de Partida" strip.
 * There is NO vertical business logic here — the legal capabilities are
 * artifacts (the `legal-*` apps), not platform code.
 *
 * Resolution order for the active vertical (see `resolveVerticalName`):
 *   1. the persisted platform setting (`settings.general.vertical`), once the
 *      settings store has hydrated — this is authoritative;
 *   2. a client-side mirror in localStorage (`ekoa_vertical`), written by the
 *      settings store on load, so the choice survives to PRE-AUTH surfaces such
 *      as /login where the settings store never fetches;
 *   3. the build-time `NEXT_PUBLIC_EKOA_VERTICAL` env default;
 *   4. 'generic'.
 *
 * The pure functions (types, profiles, `resolveVerticalName`,
 * `partitionStartingPoints`, `getVerticalMetadataDescription`) are server-safe
 * and unit-tested. `getVertical`/`useVerticalProfile` touch the client stores.
 */

import React from 'react';
import { generic } from './generic';
import { legal } from './legal';
import { readCachedVertical } from './storage';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from '@/stores/i18n';

export { cacheVertical } from './storage';

export type VerticalName = 'generic' | 'legal';

export interface VerticalProfile {
  welcomeMessage?: string;
  examplePrompts?: {
    build?: string[];
    chat?: string[];
  };
  /** Send chips for the onboarding welcome. Vertical-flavoured identities
   *  (e.g. legal supplies the "advogado" chip); omit to use the generic
   *  locale default. The freeform chip stays locale-only. */
  onboardingChips?: string[];
  modeTaglines?: {
    build?: string;
    chat?: string;
    integrate?: string;
    branding?: string;
  };
  loginTagline?: string;
  metadataDescription?: string;
  /** Predicate: given an artifact slug, should it sort ahead of generic ones? */
  startingPointsFirst?: (slug: string) => boolean;
}

/** Locale values the merge falls back to when a profile omits a field. */
export interface VerticalLocaleFallback {
  welcomeMessage: string;
  examplePrompts: { build: string[]; chat: string[] };
  onboardingChips: string[];
  modeTaglines: { build: string; chat: string; integrate: string; branding: string };
  loginTagline: string;
}

/** Fully-resolved (profile ?? locale) values consumed by the UI. */
export interface ResolvedVerticalProfile {
  welcomeMessage: string;
  examplePrompts: { build: string[]; chat: string[] };
  onboardingChips: string[];
  modeTaglines: { build: string; chat: string; integrate: string; branding: string };
  loginTagline: string;
  startingPointsFirst?: (slug: string) => boolean;
}

const PROFILES: Record<VerticalName, VerticalProfile> = { generic, legal };

export function normalizeVertical(value: unknown): VerticalName {
  return value === 'legal' ? 'legal' : 'generic';
}

export function getVerticalProfile(name: VerticalName): VerticalProfile {
  return PROFILES[name];
}

/**
 * Pure resolver — first defined source wins, then normalized. Kept side-effect
 * free so it can be unit-tested and reused by both the hook and `getVertical`.
 */
export function resolveVerticalName(sources: {
  store?: string | null;
  cached?: string | null;
  env?: string | null;
}): VerticalName {
  const first = sources.store ?? sources.cached ?? sources.env ?? null;
  return normalizeVertical(first);
}

/**
 * Stable partition: items whose slug matches `predicate` keep their relative
 * order but move ahead of the rest (also order-preserved). Without a predicate
 * the input order is returned unchanged (generic behaviour). Items without a
 * slug never match and stay in the trailing partition.
 */
export function partitionStartingPoints<T extends { slug?: string }>(
  items: T[],
  predicate?: (slug: string) => boolean,
): T[] {
  if (!predicate) return items;
  const first: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (item.slug && predicate(item.slug)) first.push(item);
    else rest.push(item);
  }
  return [...first, ...rest];
}

/** Merge a profile over its locale fallbacks (profile value ?? locale value). */
export function mergeVerticalProfile(
  profile: VerticalProfile,
  locale: VerticalLocaleFallback,
): ResolvedVerticalProfile {
  return {
    welcomeMessage: profile.welcomeMessage ?? locale.welcomeMessage,
    examplePrompts: {
      build: profile.examplePrompts?.build ?? locale.examplePrompts.build,
      chat: profile.examplePrompts?.chat ?? locale.examplePrompts.chat,
    },
    onboardingChips: profile.onboardingChips ?? locale.onboardingChips,
    modeTaglines: {
      build: profile.modeTaglines?.build ?? locale.modeTaglines.build,
      chat: profile.modeTaglines?.chat ?? locale.modeTaglines.chat,
      integrate: profile.modeTaglines?.integrate ?? locale.modeTaglines.integrate,
      branding: profile.modeTaglines?.branding ?? locale.modeTaglines.branding,
    },
    loginTagline: profile.loginTagline ?? locale.loginTagline,
    startingPointsFirst: profile.startingPointsFirst,
  };
}

/**
 * Server-safe metadata description for the active vertical. Called from the RSC
 * root layout with `process.env.NEXT_PUBLIC_EKOA_VERTICAL`; returns undefined
 * for generic so the caller keeps its own default.
 */
export function getVerticalMetadataDescription(env?: string | null): string | undefined {
  return getVerticalProfile(normalizeVertical(env)).metadataDescription;
}

/**
 * Non-reactive read of the active vertical name. Safe to call outside React
 * (uses `getState()`), including on the server (store is unhydrated there).
 */
export function getVertical(): VerticalName {
  let store: string | undefined;
  try {
    const state = useSettingsStore.getState();
    store = state.isLoaded ? state.settings.general.vertical : undefined;
  } catch {
    store = undefined;
  }
  return resolveVerticalName({
    store,
    cached: readCachedVertical(),
    env: process.env.NEXT_PUBLIC_EKOA_VERTICAL,
  });
}

/**
 * Reactive vertical profile with locale fallbacks merged in. Re-renders when
 * the settings store hydrates (the store selector) or the language changes.
 */
export function useVerticalProfile(): ResolvedVerticalProfile {
  const { emptyState, pages, onboarding } = useTranslation();
  const storeVertical = useSettingsStore((s) =>
    s.isLoaded ? s.settings.general.vertical : undefined,
  );
  // The localStorage mirror may only be consulted AFTER hydration: the server
  // render can't see it, so reading it during the first client render would
  // produce mismatched markup on SSR'd pre-auth pages (/login).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const name = resolveVerticalName({
    store: storeVertical,
    cached: mounted ? readCachedVertical() : null,
    env: process.env.NEXT_PUBLIC_EKOA_VERTICAL,
  });
  return mergeVerticalProfile(getVerticalProfile(name), {
    welcomeMessage: emptyState.welcomeMessage,
    examplePrompts: {
      build: emptyState.examplePrompts.build,
      chat: emptyState.examplePrompts.chat,
    },
    onboardingChips: onboarding.welcome.chips,
    modeTaglines: emptyState.modeTaglines,
    loginTagline: pages.login.version,
  });
}
