import { describe, it, expect } from 'vitest';
import {
  sanitizeUserFacingError,
  redactProviderIdentity,
  looksLikeProviderLeak,
  runErrorMessage,
  runErrorIsRetryable,
} from '@/lib/sanitize-error';
import { RUN_ERROR_TEXT } from '@ekoa/shared';

/**
 * Chat white-label (batch-final follow-up). A SUCCESSFUL reply that mentions the engine (the model
 * identifying itself) must be REDACTED to the EKOA brand and STILL rendered — not destroyed and
 * replaced with "temporarily unavailable" (the bug: sanitizeUserFacingError was wrongly applied to
 * successful replies). The whole-message replace stays for ERROR text only.
 */
describe('redactProviderIdentity (successful-reply white-label)', () => {
  it('redacts engine identity to the brand but KEEPS the answer', () => {
    const reply = 'Sou o Claude, um modelo criado pela Anthropic (Claude 4.6 / Sonnet).';
    const out = redactProviderIdentity(reply);
    expect(out).toContain('Agente EKOA');
    expect(out).not.toMatch(/claude|anthropic|sonnet|opus|haiku/i); // chokepoint-gate-allow (needle of an ABSENCE assertion)
    expect(out).toContain('um modelo criado pela'); // the surrounding answer is preserved, not wiped
  });

  it('leaves an ordinary reply untouched', () => {
    const reply = 'Posso ajudar-te a organizar tarefas e gerir processos jurídicos.';
    expect(redactProviderIdentity(reply)).toBe(reply);
  });

  it('the DESTRUCTIVE guard is still correct for ERROR text (whole-message replace)', () => {
    // an actual provider/auth error is replaced with the generic branded message
    expect(looksLikeProviderLeak('authentication_error: invalid oauth token')).toBe(true);
    expect(sanitizeUserFacingError('authentication_error: invalid oauth token', 'pt')).toContain('temporariamente indisponível');
    // a normal error string passes through
    expect(sanitizeUserFacingError('O ficheiro não existe.', 'pt')).toBe('O ficheiro não existe.');
  });
});

/**
 * REGRESSION for finding `run-error-text-leak` (2026-08-10). A user who asked the agent to build
 * a website was shown, as the agent's reply, the platform's internal credential diagnostic. The
 * denylist below did not — and by design cannot — match every such string, which is why terminal
 * errors are now rendered from a CODE and never from the server's text.
 */
const LEAKED =
  'credential expired and refresh failed: OAuth refresh not configured (LLM_OAUTH_REFRESH_URL + stored refresh token required)';

describe('runErrorMessage (terminal errors render from a code, never from server text)', () => {
  it('the leaked string is unreachable: the code decides the text, the message is ignored', () => {
    // Even if a server (or a replayed event, or a rogue producer) sends the leak as `message`,
    // the UI renders the code's text. This is the assertion the fix exists for.
    expect(runErrorMessage('AUTH_ERROR', 'pt')).toBe(RUN_ERROR_TEXT.pt.AUTH_ERROR);
    expect(runErrorMessage('AUTH_ERROR', 'pt')).not.toContain('LLM_OAUTH_REFRESH_URL');
    expect(runErrorMessage('AUTH_ERROR', 'pt')).not.toContain('credential');
  });

  it('fails CLOSED on an unknown code — never echoes it', () => {
    const out = runErrorMessage('SOME_FUTURE_CODE', 'pt');
    expect(out).toBe(RUN_ERROR_TEXT.pt.UNKNOWN);
    expect(out).not.toContain('SOME_FUTURE_CODE');
    // and a code-shaped leak is not a code
    expect(runErrorMessage(LEAKED, 'pt')).toBe(RUN_ERROR_TEXT.pt.UNKNOWN);
  });

  it('localizes', () => {
    expect(runErrorMessage('TIMEOUT', 'en')).toBe(RUN_ERROR_TEXT.en.TIMEOUT);
    expect(runErrorMessage('TIMEOUT', 'pt')).toBe(RUN_ERROR_TEXT.pt.TIMEOUT);
  });

  it('interpolates the billing URL as a structured param, not as prose', () => {
    const out = runErrorMessage('BILLING_BLOCKED', 'pt', { billingUrl: 'https://ekoa.io/faturacao' });
    expect(out).toContain('https://ekoa.io/faturacao');
    expect(out).not.toContain('{billingUrl}');
  });

  it('drives the retry affordance from the shared retryability table', () => {
    expect(runErrorIsRetryable('TIMEOUT')).toBe(true);
    expect(runErrorIsRetryable('AUTH_ERROR')).toBe(false); // only an operator can clear it
    expect(runErrorIsRetryable('BILLING_BLOCKED')).toBe(false);
  });

  it('the string-only fallback now also catches credential/plumbing vocabulary', () => {
    // Defence in depth for the paths that genuinely have no code. This does NOT make the
    // denylist sufficient — the code-first path above is what makes the UI safe.
    expect(looksLikeProviderLeak(LEAKED)).toBe(true);
    expect(sanitizeUserFacingError(LEAKED, 'pt')).toContain('temporariamente indisponível');
  });
});
