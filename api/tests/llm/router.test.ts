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
    // GENIUS (frontier tier): reachable via the explicit `critical` hint or a floor — never
    // keyword scoring (asserted below).
    expect(classify('anything', { complexityHint: 'critical' })).toBe('GENIUS');
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
    expect(decideForTier('WORKHORSE')).toEqual({ tier: 'WORKHORSE', model: 'claude-sonnet-5', effort: 'medium', weight: 0.1 });
    expect(decideForTier('EXPERT')).toEqual({ tier: 'EXPERT', model: 'claude-opus-5', effort: 'high', weight: 0.4 });
    expect(decideForTier('GENIUS')).toEqual({ tier: 'GENIUS', model: 'claude-fable-5', effort: 'high', weight: 0.8 });
  });

  it('decideForTask applies a minimum-tier floor (only raises, never lowers)', () => {
    // "list the files" classifies FAST; a WORKHORSE floor raises it.
    expect(decideForTask('list the files', undefined, 'WORKHORSE').tier).toBe('WORKHORSE');
    // a build already EXPERT is not lowered by a WORKHORSE floor.
    expect(decideForTask('build a complex dashboard application', undefined, 'WORKHORSE').tier).toBe('EXPERT');
    // the GENIUS floor (first builds) raises anything to the frontier tier.
    expect(decideForTask('list the files', undefined, 'GENIUS').tier).toBe('GENIUS');
  });

  it('keyword scoring never escalates past EXPERT on its own (GENIUS is floor/hint-only)', () => {
    expect(classify('build and deploy one complex dashboard application')).toBe('EXPERT');
    expect(classify('architect a novel multi-file security audit refactor')).toBe('EXPERT');
  });
});

/**
 * Follow-up build routing (token-economics port). Follow-ups floor at WORKHORSE, not EXPERT — a
 * routine edit is a Sonnet task; a genuine rebuild still self-escalates via 2+ Tier-4 hits. The
 * PT-PT product needed its own big-change verbs and triviality markers in the keyword sets.
 */
describe('follow-up routing floor + PT-PT keywords (token-economics port)', () => {
  it('a WORKHORSE floor leaves a routine follow-up on Sonnet, not Opus', () => {
    expect(decideForTask('tweak the header', undefined, 'WORKHORSE').model).toBe('claude-sonnet-5');
    expect(decideForTask('muda o texto do botão', undefined, 'WORKHORSE').model).toBe('claude-sonnet-5');
    expect(decideForTask('adiciona uma coluna', undefined, 'WORKHORSE').model).toBe('claude-sonnet-5');
  });

  it('a big rebuild still escalates a follow-up to Opus despite the WORKHORSE floor', () => {
    // 2+ Tier-4 hits ("refactor" + "dashboard" + "feature") clear EXPERT before the floor applies.
    expect(decideForTask('refactor the dashboard: rebuild the whole feature', undefined, 'WORKHORSE').model).toBe('claude-opus-5');
  });

  it('PT-PT big-change verbs escalate: a lone phrase (double-scored) reaches EXPERT', () => {
    // "do zero" is a space-containing pattern → +2, past the >=2 EXPERT gate on its own.
    expect(classify('reconstruir a aplicação do zero')).toBe('EXPERT');
    expect(classify('refazer tudo de raiz')).toBe('EXPERT');
    // A single PT big-change verb alone floors at WORKHORSE, exactly like its EN counterpart.
    expect(classify('reconstruir isto')).toBe('WORKHORSE');
  });

  it('PT-PT triviality markers cap a would-be EXPERT follow-up at WORKHORSE', () => {
    expect(classify('reconstruir a aplicação do zero, apenas o cabeçalho')).toBe('WORKHORSE');
    expect(classify('refazer tudo de raiz, mas simples')).toBe('WORKHORSE');
    // The floor + demotion compose: a demoted classify still respects a WORKHORSE floor (no lower).
    expect(decideForTask('só um ajuste rápido', undefined, 'WORKHORSE').tier).toBe('WORKHORSE');
  });
});
