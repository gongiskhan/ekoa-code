import { describe, it, expect } from 'vitest';
import { normalizeCandidates } from '../../../src/services/branding/rendered-candidates.js';

/**
 * Rendered-candidate normalization (ch05 §5.6.4). `fetchRenderedCandidates` needs a live browser,
 * but the area-weighting + neutral-drop + ranking transform is pure and is exercised here with
 * hand-built (color, area) tuples.
 */
describe('normalizeCandidates', () => {
  it('area-weights, drops neutrals/transparent, and ranks by brandFit x sqrt(area)', () => {
    const raw: Array<[string, number]> = [
      ['rgb(13, 148, 136)', 500_000], // teal brand, big area
      ['rgb(37, 211, 102)', 4_000], // WhatsApp green, tiny area
      ['rgb(255, 255, 255)', 2_000_000], // white wrapper - neutral, dropped
      ['transparent', 9_000_000], // dropped
      ['#0d9488', 100_000], // same teal via hex - merges by hex
    ];
    const out = normalizeCandidates(raw);
    const hexes = out.map((c) => c.hex);
    expect(hexes).not.toContain('#ffffff');
    // Teal dominates and merges the rgb + hex spellings into one accumulated-area candidate.
    expect(out[0]!.hex).toBe('#0d9488');
    expect(out[0]!.count).toBe(600_000);
    expect(out[0]!.source).toBe('rendered-area');
  });

  it('drops a tiny saturated one-off far below the top score', () => {
    const raw: Array<[string, number]> = [
      ['rgb(16, 50, 207)', 900_000], // dominant blue
      ['rgb(37, 211, 102)', 300], // a lone tiny badge
    ];
    const out = normalizeCandidates(raw);
    expect(out.map((c) => c.hex)).toEqual(['#1032cf']);
  });

  it('keeps a muted-palette site rather than emptying it (brandFit-floor fallback)', () => {
    // Every candidate is below the 0.30 brandFit floor; the fallback preserves them.
    const raw: Array<[string, number]> = [
      ['rgb(124, 104, 83)', 400_000], // muted taupe
      ['rgb(150, 140, 120)', 200_000], // muted sand
    ];
    const out = normalizeCandidates(raw);
    expect(out.length).toBeGreaterThan(0);
  });
});
