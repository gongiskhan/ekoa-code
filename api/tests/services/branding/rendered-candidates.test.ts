import { describe, it, expect } from 'vitest';
import { normalizeCandidates, screenshotClustersToCandidates } from '../../../src/services/branding/rendered-candidates.js';

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

/**
 * Screenshot-pixel fallback (live 2026-07-12, mariliasantoscabral.webnode.pt): the firm's navy
 * exists ONLY inside the hero JPEG, so the computed-style walk painted nothing non-neutral and
 * research came back colorless. The in-page quantizer needs a browser; this pure transform of
 * its clusters is exercised here.
 */
describe('screenshotClustersToCandidates', () => {
  it('keeps a desaturated image-only navy the brandFit floor would have erased, in area order', () => {
    const out = screenshotClustersToCandidates(
      [
        { hex: '#8a929e', count: 12_000 }, // grayish photo tone - neutral-ish? spread 20 > 12: kept if non-neutral
        { hex: '#2a3547', count: 9_000 }, // the navy overlay (brandFit ~0.26, below the 0.30 floor)
        { hex: '#ffffff', count: 8_000 }, // page background - neutral, dropped
      ],
      32_000,
    );
    const hexes = out.map((c) => c.hex);
    expect(hexes).toContain('#2a3547');
    expect(hexes).not.toContain('#ffffff');
    const navy = out.find((c) => c.hex === '#2a3547')!;
    expect(navy.source).toBe('screenshot');
    expect(navy.brandFit).toBeLessThan(0.3); // the floor would have dropped it - proof this list must not apply it
  });

  it('drops sub-share noise clusters and caps the list', () => {
    const clusters = [
      { hex: '#2a3547', count: 10_000 },
      { hex: '#c0392b', count: 100 }, // 0.3% of samples - noise (a red car in a photo)
    ];
    const out = screenshotClustersToCandidates(clusters, 32_000);
    expect(out.map((c) => c.hex)).toEqual(['#2a3547']);
  });

  it('returns [] for a genuinely monochrome page (only neutrals) - the fail-loud path stays honest', () => {
    const out = screenshotClustersToCandidates(
      [
        { hex: '#ffffff', count: 20_000 },
        { hex: '#111111', count: 6_000 },
        { hex: '#9d9d9d', count: 4_000 },
      ],
      30_000,
    );
    expect(out).toEqual([]);
  });

  it('is defensive about malformed input (bad hex, zero total)', () => {
    expect(screenshotClustersToCandidates([{ hex: 'nope', count: 10_000 }], 10_000)).toEqual([]);
    expect(screenshotClustersToCandidates([{ hex: '#2a3547', count: 10_000 }], 0)).toEqual([]);
  });
});
