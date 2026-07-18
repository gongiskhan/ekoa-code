// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DEFAULT_GRACE_BOUNDS, eotFromInterim, graceWindowMs } from '@/lib/voice/grace-window';

/**
 * C3 (mega-run 20260717-190134): the adaptive endpointing function, BRIEF §5 decided
 * parameters. Boundary cases pinned exactly: finished-sounding -> minMs (1.5 s), mid-thought
 * -> maxMs (6 s), unknown -> the midpoint. Pure, zero mocks.
 */
describe('graceWindowMs boundaries', () => {
  it('finished-sounding (eot = 1) sends after minMs', () => {
    expect(graceWindowMs(1)).toBe(1500);
  });

  it('mid-thought (eot = 0) waits the full maxMs', () => {
    expect(graceWindowMs(0)).toBe(6000);
  });

  it('unknown (null/undefined/NaN) uses the midpoint', () => {
    expect(graceWindowMs(null)).toBe(3750);
    expect(graceWindowMs(undefined)).toBe(3750);
    expect(graceWindowMs(Number.NaN)).toBe(3750);
  });

  it('interpolates linearly between the bounds', () => {
    expect(graceWindowMs(0.5)).toBe(3750);
    expect(graceWindowMs(0.75)).toBe(2625);
    expect(graceWindowMs(0.25)).toBe(4875);
  });

  it('clamps out-of-range confidence into [0, 1]', () => {
    expect(graceWindowMs(1.7)).toBe(1500);
    expect(graceWindowMs(-3)).toBe(6000);
    expect(graceWindowMs(Number.POSITIVE_INFINITY)).toBe(1500);
    expect(graceWindowMs(Number.NEGATIVE_INFINITY)).toBe(6000);
  });

  it('honors custom bounds and rounds to whole ms', () => {
    expect(graceWindowMs(1, { minMs: 1000, maxMs: 4000 })).toBe(1000);
    expect(graceWindowMs(0, { minMs: 1000, maxMs: 4000 })).toBe(4000);
    expect(graceWindowMs(null, { minMs: 1000, maxMs: 4001 })).toBe(2501);
    expect(graceWindowMs(1 / 3, { minMs: 0, maxMs: 1000 })).toBe(667);
  });

  it('repairs degenerate bounds instead of returning garbage', () => {
    // maxMs below minMs collapses to minMs; negative minMs floors at 0.
    expect(graceWindowMs(0.5, { minMs: 2000, maxMs: 1000 })).toBe(2000);
    expect(graceWindowMs(1, { minMs: -500, maxMs: 1000 })).toBe(0);
  });

  it('never returns NaN when a bound is non-finite (C3 review)', () => {
    // A NaN/Infinity bound falls back to the decided default for that bound.
    expect(graceWindowMs(null, { minMs: Number.NaN, maxMs: 6000 })).toBe(Math.round((1500 + 6000) / 2));
    expect(Number.isNaN(graceWindowMs(0.5, { minMs: Number.NaN, maxMs: Number.NaN }))).toBe(false);
    expect(graceWindowMs(1, { minMs: 1500, maxMs: Number.POSITIVE_INFINITY })).toBe(1500);
  });

  it('exports the BRIEF defaults', () => {
    expect(DEFAULT_GRACE_BOUNDS).toEqual({ minMs: 1500, maxMs: 6000 });
  });
});

describe('eotFromInterim (v1 punctuation heuristic)', () => {
  it('terminal punctuation reads as finished', () => {
    expect(eotFromInterim('Já terminei a análise.')).toBe(1);
    expect(eotFromInterim('Qual é o prazo?')).toBe(1);
    expect(eotFromInterim('Perfeito!')).toBe(1);
    expect(eotFromInterim('"Está fechado."')).toBe(1);
  });

  it('clause punctuation and ellipsis read as mid-thought', () => {
    expect(eotFromInterim('primeiro o contrato,')).toBe(0);
    expect(eotFromInterim('há três pontos:')).toBe(0);
    expect(eotFromInterim('deixa-me pensar…')).toBe(0);
    expect(eotFromInterim('deixa-me pensar...')).toBe(0);
  });

  it('a dangling connective reads as mid-thought (PT and EN)', () => {
    expect(eotFromInterim('verifica o prazo e')).toBe(0);
    expect(eotFromInterim('quero que')).toBe(0);
    expect(eotFromInterim('send the draft to')).toBe(0);
    expect(eotFromInterim('check the deadline and')).toBe(0);
  });

  it('anything else is unknown', () => {
    expect(eotFromInterim('verifica o prazo do processo')).toBeNull();
    expect(eotFromInterim('okay')).toBeNull();
    expect(eotFromInterim('prazo dia 16')).toBeNull();
  });

  it('empty or whitespace input is unknown', () => {
    expect(eotFromInterim('')).toBeNull();
    expect(eotFromInterim('   ')).toBeNull();
  });
});
