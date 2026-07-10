import { describe, it, expect } from 'vitest';
import { redactEngineIdentity, StreamingIdentityRedactor } from '../../src/agents/branding.js';

/**
 * White-label redaction for the thinking channel (ch12). The persona governs answers, not
 * thinking — commentary self-identifies as the engine, so branding.ts is the wire defence.
 * Kept in sync with web/lib/sanitize-error.ts `redactProviderIdentity` (the client-side net).
 */
const LEAK = /claude|anthropic|sonnet|opus|haiku/i;

describe('redactEngineIdentity', () => {
  it('redacts model + vendor names to the EKOA brand, keeping the sentence intact', () => {
    const out = redactEngineIdentity('Sou o Claude Sonnet, um modelo da Anthropic, a responder como Opus.');
    expect(out).not.toMatch(LEAK);
    expect(out).toContain('Agente EKOA');
    expect(out).toContain('um modelo da EKOA');
  });

  it('handles versioned and bare-family forms', () => {
    expect(redactEngineIdentity('Claude 4.6 aqui.')).not.toMatch(LEAK);
    expect(redactEngineIdentity('Powered by Haiku')).not.toMatch(LEAK);
    expect(redactEngineIdentity('')).toBe('');
  });

  it('leaves unrelated prose untouched', () => {
    const s = 'A referência do processo é RX-417 e o prazo é sexta-feira.';
    expect(redactEngineIdentity(s)).toBe(s);
  });
});

describe('StreamingIdentityRedactor (straddle-safe chunked redaction)', () => {
  it('no engine term survives ANY chunk split point (the hold-back invariant)', () => {
    const text = 'Bom, o utilizador pergunta que modelo sou. Sou o Claude Sonnet 4.6, da Anthropic, mas devo apresentar-me como Agente EKOA e nunca revelar o motor.';
    for (let i = 0; i <= text.length; i++) {
      const r = new StreamingIdentityRedactor();
      const out = r.push(text.slice(0, i)) + r.push(text.slice(i)) + r.end();
      expect(out, `split at ${i}`).not.toMatch(LEAK);
    }
  });

  it('reassembles to the same result as the one-shot redaction for term-free text', () => {
    const text = 'Uma resposta longa sem nomes de motor, com pontuação, números 12.3 e quebras.\nSegunda linha.';
    const r = new StreamingIdentityRedactor();
    let out = '';
    for (const piece of text.match(/.{1,7}/gs) ?? []) out += r.push(piece);
    out += r.end();
    expect(out).toBe(text);
  });
});
