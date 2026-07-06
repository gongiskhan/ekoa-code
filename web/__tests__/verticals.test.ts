/**
 * Vertical presentation profiles — the pure, side-effect-free core.
 *
 * Covers the stable starting-points partition and the profile ?? locale merge
 * (generic returns locale values; legal overrides only what it declares).
 * The reactive hooks (useVerticalProfile) are exercised end-to-end by
 * e2e/vertical-profile.spec.ts against the running app.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveVerticalName,
  getVerticalProfile,
  partitionStartingPoints,
  mergeVerticalProfile,
  getVerticalMetadataDescription,
  type VerticalLocaleFallback,
} from '@/lib/verticals';

const LOCALE: VerticalLocaleFallback = {
  welcomeMessage: 'LOCALE_WELCOME',
  examplePrompts: { build: ['LOCALE_BUILD'], chat: ['LOCALE_CHAT'] },
  onboardingChips: ['LOCALE_CHIP_A', 'LOCALE_CHIP_B'],
  modeTaglines: {
    build: 'LOCALE_BUILD_TAGLINE',
    chat: 'LOCALE_CHAT_TAGLINE',
    integrate: 'LOCALE_INTEGRATE_TAGLINE',
    branding: 'LOCALE_BRANDING_TAGLINE',
  },
  loginTagline: 'LOCALE_LOGIN',
};

describe('resolveVerticalName — precedence + normalization', () => {
  it('prefers the store value, then cache, then env, then generic', () => {
    expect(resolveVerticalName({ store: 'legal', cached: null, env: 'generic' })).toBe('legal');
    expect(resolveVerticalName({ store: null, cached: 'legal', env: 'generic' })).toBe('legal');
    expect(resolveVerticalName({ store: null, cached: null, env: 'legal' })).toBe('legal');
    expect(resolveVerticalName({})).toBe('generic');
  });

  it('normalizes any non-legal value to generic', () => {
    expect(resolveVerticalName({ store: 'medical' })).toBe('generic');
    expect(resolveVerticalName({ store: '' })).toBe('generic');
  });
});

describe('getVerticalProfile', () => {
  it('generic profile is empty (every field falls through to locale)', () => {
    expect(getVerticalProfile('generic')).toEqual({});
  });

  it('legal profile carries the vertical copy + predicate', () => {
    const p = getVerticalProfile('legal');
    expect(p.welcomeMessage).toContain('escritório');
    expect(p.loginTagline).toBe('Ekoa · O espaço de trabalho com IA para escritórios de advogados');
    expect(p.startingPointsFirst?.('legal-nucleo')).toBe(true);
    expect(p.startingPointsFirst?.('sales-crm')).toBe(false);
    // Two of the spec prompts must be present across build+chat.
    const prompts = [...(p.examplePrompts?.build ?? []), ...(p.examplePrompts?.chat ?? [])];
    expect(prompts.some((t) => t.includes('prazos processuais'))).toBe(true);
    expect(prompts.some((t) => t.includes('Citius'))).toBe(true);
  });
});

describe('partitionStartingPoints — stable partition', () => {
  const items = [
    { slug: 'sales-crm' },
    { slug: 'legal-nucleo' },
    { slug: 'lume-cafe' },
    { slug: 'legal-prazos' },
    { slug: undefined },
  ];

  it('returns the input unchanged when there is no predicate (generic)', () => {
    const out = partitionStartingPoints(items);
    expect(out).toBe(items); // same reference — order untouched
  });

  it('floats matching slugs ahead, preserving relative order within each partition', () => {
    const out = partitionStartingPoints(items, (s) => s.startsWith('legal-'));
    expect(out.map((i) => i.slug)).toEqual([
      'legal-nucleo',
      'legal-prazos',
      'sales-crm',
      'lume-cafe',
      undefined,
    ]);
  });

  it('is a pure copy — does not mutate the input array', () => {
    const before = items.map((i) => i.slug);
    partitionStartingPoints(items, (s) => s.startsWith('legal-'));
    expect(items.map((i) => i.slug)).toEqual(before);
  });
});

describe('mergeVerticalProfile — profile ?? locale', () => {
  it('generic profile returns the locale values for every field', () => {
    const merged = mergeVerticalProfile(getVerticalProfile('generic'), LOCALE);
    expect(merged.welcomeMessage).toBe('LOCALE_WELCOME');
    expect(merged.examplePrompts).toEqual(LOCALE.examplePrompts);
    expect(merged.onboardingChips).toEqual(LOCALE.onboardingChips);
    expect(merged.modeTaglines).toEqual(LOCALE.modeTaglines);
    expect(merged.loginTagline).toBe('LOCALE_LOGIN');
    expect(merged.startingPointsFirst).toBeUndefined();
  });

  it('legal profile overrides only what it declares, locale fills the rest', () => {
    const merged = mergeVerticalProfile(getVerticalProfile('legal'), LOCALE);
    // overridden by legal
    expect(merged.welcomeMessage).toContain('escritório');
    expect(merged.loginTagline).toContain('escritórios de advogados');
    expect(merged.modeTaglines.build).toBe('O que pretende preparar hoje?');
    expect(merged.startingPointsFirst?.('legal-x')).toBe(true);
    // legal supplies its own onboarding chips (the "advogado" identity)
    expect(merged.onboardingChips.some((c) => c.includes('advogado'))).toBe(true);
    expect(merged.onboardingChips).not.toEqual(LOCALE.onboardingChips);
    // NOT overridden by legal → locale fallback
    expect(merged.modeTaglines.chat).toBe('LOCALE_CHAT_TAGLINE');
    expect(merged.modeTaglines.integrate).toBe('LOCALE_INTEGRATE_TAGLINE');
    expect(merged.modeTaglines.branding).toBe('LOCALE_BRANDING_TAGLINE');
  });
});

describe('getVerticalMetadataDescription — server-safe env lookup', () => {
  it('returns the legal description for legal', () => {
    expect(getVerticalMetadataDescription('legal')).toBe(
      'Ekoa — plataforma de trabalho com IA para escritórios de advogados',
    );
  });

  it('returns undefined for generic / unset (caller keeps its own default)', () => {
    expect(getVerticalMetadataDescription('generic')).toBeUndefined();
    expect(getVerticalMetadataDescription(undefined)).toBeUndefined();
    expect(getVerticalMetadataDescription(null)).toBeUndefined();
  });
});
