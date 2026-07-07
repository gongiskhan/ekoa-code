import { describe, it, expect, beforeAll } from 'vitest';
import { classify, decideForTier, decideForTask } from '../../src/llm/router.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';

/**
 * Ported tier-classifier assertions (carryover-audit A11; old __tests__/llm-router.test.ts),
 * adapted to the three-tier rebuild (FAST/WORKHORSE/EXPERT — REASONING_LIGHT retired, §6.4.3
 * site 22) and the string-union tier type. classify() is pure code, no model call.
 */
beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
});

describe('classify() — keyword tiering (ported)', () => {
  it('keeps ambiguous single-file verbs at WORKHORSE, not EXPERT', () => {
    expect(classify('optimize this loop')).toBe('WORKHORSE');
    expect(classify('create a button')).toBe('WORKHORSE');
    expect(classify('write a function')).toBe('WORKHORSE');
  });

  it('escalates a genuine multi-signal build to EXPERT', () => {
    expect(classify('build a dashboard application')).toBe('EXPERT');
    expect(classify('build and deploy a complex dashboard application')).toBe('EXPERT');
  });

  it('requires >=2 Tier-4 hits for EXPERT; a lone Tier-4 verb floors at WORKHORSE', () => {
    expect(classify('build something')).toBe('WORKHORSE');
    expect(classify('refactor it')).toBe('WORKHORSE');
  });

  it('demotion words cap even a strong build at WORKHORSE', () => {
    expect(classify('just build a dashboard application')).toBe('WORKHORSE');
    expect(classify('a simple dashboard application build')).toBe('WORKHORSE');
  });

  it('does NOT demote on context-blind words ("only"/"one"/"single"/"basic")', () => {
    expect(classify('implement a complex dashboard feature, chat only')).toBe('EXPERT');
    expect(classify('build a complex single sign-on integration')).toBe('EXPERT');
    expect(classify('build and deploy one complex dashboard application')).toBe('EXPERT');
    expect(classify('build a basic auth integration')).toBe('EXPERT');
  });

  it('routes lookups to FAST and small single-file fixes to WORKHORSE', () => {
    expect(classify('list the files')).toBe('FAST');
    expect(classify('fix the typo')).toBe('WORKHORSE');
  });

  it('defaults an unmatched description to FAST', () => {
    expect(classify('hello there')).toBe('FAST');
  });
});

describe('complexity hints + file-count heuristics', () => {
  it('honours explicit complexity hints (low collapses onto FAST)', () => {
    expect(classify('anything', { complexityHint: 'trivial' })).toBe('FAST');
    expect(classify('anything', { complexityHint: 'low' })).toBe('FAST');
    expect(classify('anything', { complexityHint: 'medium' })).toBe('WORKHORSE');
    expect(classify('anything', { complexityHint: 'high' })).toBe('EXPERT');
    expect(classify('anything', { complexityHint: 'critical' })).toBe('EXPERT');
  });

  it('escalates by estimated file count', () => {
    expect(classify('x', { estimatedFileCount: 6 })).toBe('EXPERT');
    expect(classify('x', { estimatedFileCount: 3 })).toBe('WORKHORSE');
    expect(classify('x', { estimatedFileCount: 1 })).toBe('FAST');
  });
});

describe('RouterDecision resolution (config-driven models + weights)', () => {
  it('decisionForTier reads model/effort/weight from config', () => {
    expect(decideForTier('FAST')).toEqual({ tier: 'FAST', model: 'claude-haiku-4-5-20251001', effort: 'low', weight: 0.02 });
    expect(decideForTier('WORKHORSE')).toEqual({ tier: 'WORKHORSE', model: 'claude-sonnet-4-6', effort: 'medium', weight: 0.1 });
    expect(decideForTier('EXPERT')).toEqual({ tier: 'EXPERT', model: 'claude-opus-4-8[1m]', effort: 'high', weight: 0.4 });
  });

  it('decideForTask applies a minimum-tier floor (only raises, never lowers)', () => {
    // "list the files" classifies FAST; a WORKHORSE floor raises it.
    expect(decideForTask('list the files', undefined, 'WORKHORSE').tier).toBe('WORKHORSE');
    // a build already EXPERT is not lowered by a WORKHORSE floor.
    expect(decideForTask('build a complex dashboard application', undefined, 'WORKHORSE').tier).toBe('EXPERT');
  });
});
