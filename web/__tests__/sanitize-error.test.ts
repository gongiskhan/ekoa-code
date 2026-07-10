import { describe, it, expect } from 'vitest';
import { sanitizeUserFacingError, redactProviderIdentity, looksLikeProviderLeak } from '@/lib/sanitize-error';

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
    expect(out).not.toMatch(/claude|anthropic|sonnet|opus|haiku/i);
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
