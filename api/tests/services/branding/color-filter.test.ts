import { describe, it, expect } from 'vitest';
import { isGrayscale, sanitizeBrandColors } from '../../../src/services/branding/color-filter.js';

/**
 * Grayscale guard (ch05 §5.6.4 safety net) - a hallucinated gray primary must never be persisted
 * as the org's brand colour.
 */
describe('isGrayscale', () => {
  it('flags black/white/low-saturation and passes saturated brand colours', () => {
    expect(isGrayscale('#000000')).toBe(true);
    expect(isGrayscale('#ffffff')).toBe(true);
    expect(isGrayscale('#4a4f57')).toBe(true); // dark slate-ish, low chroma
    expect(isGrayscale('#0d9488')).toBe(false);
    expect(isGrayscale('#f0b11a')).toBe(false);
    expect(isGrayscale('not-a-hex')).toBe(false);
  });
});

describe('sanitizeBrandColors', () => {
  it('promotes a non-gray accent when the primary is gray - and the demoted gray is dropped, not parked in the accent slot', () => {
    const out = sanitizeBrandColors({ primaryColor: '#111111', accentColor: '#0d9488' });
    expect(out.primaryColor).toBe('#0d9488');
    // No slot ever persists a neutral: the gray swapped into accent is nulled by the accent rule.
    expect(out.accentColor).toBeNull();
  });

  it('nulls a gray primary with no coloured alternative (so the merge skips it, never a fake default)', () => {
    const out = sanitizeBrandColors({ primaryColor: '#222222', secondaryColor: '#333333' });
    expect(out.primaryColor).toBeNull();
    expect(out.secondaryColor).toBeNull();
  });

  it('nulls a gray accent (live 2026-07-12: #9d9d9d persisted as the org accent while primary/secondary were dropped)', () => {
    const out = sanitizeBrandColors({ primaryColor: '#0d9488', secondaryColor: '#1032cf', accentColor: '#9d9d9d' });
    expect(out.primaryColor).toBe('#0d9488');
    expect(out.secondaryColor).toBe('#1032cf');
    expect(out.accentColor).toBeNull();
  });

  it('an all-grayscale result ends with every color slot null - nothing neutral ever merges', () => {
    const out = sanitizeBrandColors({ primaryColor: '#ffffff', secondaryColor: '#000000', accentColor: '#9d9d9d' });
    expect(out.primaryColor).toBeNull();
    expect(out.secondaryColor).toBeNull();
    expect(out.accentColor).toBeNull();
  });

  it('leaves a valid palette untouched', () => {
    const out = sanitizeBrandColors({ primaryColor: '#0d9488', secondaryColor: '#1032cf', accentColor: '#f0b11a' });
    expect(out).toEqual({ primaryColor: '#0d9488', secondaryColor: '#1032cf', accentColor: '#f0b11a' });
  });
});
