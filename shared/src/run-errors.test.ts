import { describe, it, expect } from 'vitest';
import {
  RunErrorCode,
  RUN_ERROR_TEXT,
  RUN_ERROR_RETRYABLE,
  runErrorText,
  isRetryableRunError,
  normalizeRunErrorCode,
} from './run-errors.js';

/**
 * The run-error vocabulary is the fail-closed replacement for the denylist that let an internal
 * credential diagnostic reach a user's chat transcript (finding `run-error-text-leak`,
 * 2026-08-10). These tests pin the properties that make it fail closed, and — most importantly —
 * the property that the leak itself violated: NO user-facing string may contain internal
 * vocabulary, whatever the code.
 */

/** The exact string a user was shown as the agent's reply. The case this whole module exists for. */
const LEAKED =
  'credential expired and refresh failed: OAuth refresh not configured (LLM_OAUTH_REFRESH_URL + stored refresh token required)';

describe('run-error vocabulary', () => {
  it('every code has text in every locale and a retryability verdict', () => {
    for (const code of RunErrorCode.options) {
      for (const locale of ['pt', 'en'] as const) {
        const text = RUN_ERROR_TEXT[locale][code];
        expect(text, `${locale}/${code} has text`).toBeTruthy();
        expect(text.length, `${locale}/${code} is a sentence, not a token`).toBeGreaterThan(15);
      }
      expect(typeof RUN_ERROR_RETRYABLE[code], `${code} has a retryability verdict`).toBe('boolean');
    }
  });

  /**
   * THE INVARIANT THE LEAK BROKE. Every one of these needles appeared in, or is of the same
   * class as, the string that reached a user. A new code whose copy mentions the engine, the
   * plumbing, or an env var fails HERE rather than in front of a customer.
   */
  it('no user-facing string leaks engine identity, internal plumbing, or operator vocabulary', () => {
    const FORBIDDEN = [
      'claude',
      'anthropic', // chokepoint-gate-allow
      'sonnet',
      'opus',
      'haiku',
      'oauth',
      'credential',
      'credencia', // pt: credencial / credenciais
      'token',
      'refresh',
      'llm_',
      'api_key',
      'api key',
      'env',
      'http',
      'stack',
      'null',
      'undefined',
      '§',
    ];
    for (const locale of ['pt', 'en'] as const) {
      for (const code of RunErrorCode.options) {
        const lower = RUN_ERROR_TEXT[locale][code].toLowerCase();
        for (const needle of FORBIDDEN) {
          expect(lower.includes(needle), `${locale}/${code} must not contain "${needle}": ${lower}`).toBe(false);
        }
      }
    }
  });

  it('the leaked production string is not reachable from any code in any locale', () => {
    for (const locale of ['pt', 'en'] as const) {
      for (const code of RunErrorCode.options) {
        expect(RUN_ERROR_TEXT[locale][code]).not.toContain('LLM_OAUTH_REFRESH_URL');
        expect(RUN_ERROR_TEXT[locale][code]).not.toBe(LEAKED);
      }
    }
  });
});

describe('normalizeRunErrorCode — the fail-closed hinge', () => {
  it('keeps known codes', () => {
    expect(normalizeRunErrorCode('AUTH_ERROR')).toBe('AUTH_ERROR');
    expect(normalizeRunErrorCode('TIMEOUT')).toBe('TIMEOUT');
  });

  it('maps anything unknown to UNKNOWN rather than echoing it', () => {
    for (const input of ['', null, undefined, 'NOPE', 'auth_error', 'VOICE_PROVIDER_ERROR', LEAKED]) {
      expect(normalizeRunErrorCode(input), `${String(input)} -> UNKNOWN`).toBe('UNKNOWN');
    }
  });
});

describe('runErrorText', () => {
  it('renders PT by default and EN only for an English locale', () => {
    expect(runErrorText('TIMEOUT')).toBe(RUN_ERROR_TEXT.pt.TIMEOUT);
    expect(runErrorText('TIMEOUT', 'pt-PT')).toBe(RUN_ERROR_TEXT.pt.TIMEOUT);
    expect(runErrorText('TIMEOUT', 'en')).toBe(RUN_ERROR_TEXT.en.TIMEOUT);
    expect(runErrorText('TIMEOUT', 'en-GB')).toBe(RUN_ERROR_TEXT.en.TIMEOUT);
  });

  it('NEVER returns its input, however plausible the input looks', () => {
    // The whole failure mode was "server said something, client printed it".
    const out = runErrorText(LEAKED, 'pt');
    expect(out).toBe(RUN_ERROR_TEXT.pt.UNKNOWN);
    expect(out).not.toContain('LLM_OAUTH_REFRESH_URL');
  });

  it('interpolates structured params', () => {
    const out = runErrorText('BILLING_BLOCKED', 'pt', { billingUrl: 'https://ekoa.io/faturacao' });
    expect(out).toContain('https://ekoa.io/faturacao');
    expect(out).not.toContain('{billingUrl}');
  });

  it('drops an unfilled placeholder instead of printing it raw', () => {
    // A BILLING_BLOCKED event that arrives without params must still read as a clean sentence.
    const out = runErrorText('BILLING_BLOCKED', 'pt');
    expect(out).not.toContain('{');
    expect(out).not.toContain('  ');
    expect(out).not.toMatch(/\s+\./);
    expect(out.endsWith('.')).toBe(true);
  });
});

describe('isRetryableRunError', () => {
  it('does not offer retry where retrying cannot help', () => {
    expect(isRetryableRunError('BILLING_BLOCKED')).toBe(false);
    expect(isRetryableRunError('EDIT_FORBIDDEN')).toBe(false);
    // Only an operator re-arming the platform credential clears this one.
    expect(isRetryableRunError('AUTH_ERROR')).toBe(false);
  });

  it('offers retry for transient failures, and for unknown codes', () => {
    expect(isRetryableRunError('TIMEOUT')).toBe(true);
    expect(isRetryableRunError('PROVIDER_UNAVAILABLE')).toBe(true);
    expect(isRetryableRunError('SOMETHING_NEW')).toBe(true); // -> UNKNOWN -> retryable
  });
});
