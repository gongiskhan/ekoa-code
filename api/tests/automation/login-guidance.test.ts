/**
 * The Google-SSO warning on a login pause (findings,
 * `google-sso-refuses-the-automated-ceremony-browser`).
 *
 * WHAT THIS PINS AND WHY IT IS NOT COSMETIC. Google refuses OAuth from the browser this product
 * drives, and that refusal is not ours to fix - so the only thing left is telling the person the
 * one moment they can still act on it, which is the pause where they are at the keyboard choosing
 * how to sign in. The guidance is APPENDED by the engine rather than requested in the vision
 * prompt, precisely so it can be asserted; if it moves back into a prompt, these tests should be
 * deleted rather than quietly weakened to match.
 *
 * The kind gate is asserted as hard as the append. A sentence about Google on every CAPTCHA and
 * every 3-D Secure screen would be noise, and noise on a Post-it is how people stop reading the
 * Post-it - which costs more than this sentence buys on the one pause where it counts.
 */
import { describe, it, expect, vi } from 'vitest';

// rehearsal.ts reaches the LLM chokepoint at import time; this test only needs its regex fast path.
vi.mock('../../src/llm/index.js', () => ({
  runOneShot: vi.fn(async () => ({ text: '', usage: {} })),
  decideForTier: vi.fn((tier: string) => ({ tier, model: 'm', effort: 'high', weight: 1 })),
}));

import {
  withGoogleSsoGuidance,
  GOOGLE_SSO_PAUSE_GUIDANCE_PT,
  GOOGLE_SSO_PAUSE_GUIDANCE_EN,
} from '../../src/automation/login-guidance.js';
import { detectHumanActionable } from '../../src/automation/rehearsal.js';

describe('a login pause warns about Google sign-in', () => {
  it('appends the guidance to a login pause', () => {
    const out = withGoogleSsoGuidance('Inicie sessão na janela aberta e depois clique em Continuar.', 'login');
    expect(out).toContain('Inicie sessão na janela aberta');
    expect(out).toContain(GOOGLE_SSO_PAUSE_GUIDANCE_PT);
  });

  it('says both halves: which button not to press, and what to use instead', () => {
    for (const text of [GOOGLE_SSO_PAUSE_GUIDANCE_PT, GOOGLE_SSO_PAUSE_GUIDANCE_EN]) {
      expect(text).toContain('Google');
      expect(text).toMatch(/email/i);
      // A warning with no alternative just tells somebody their run is doomed.
      expect(text).toMatch(/telemóvel|phone/i);
    }
  });

  it('leaves every OTHER kind of pause alone', () => {
    const captcha = 'Resolva o CAPTCHA na janela aberta e depois clique em Continuar.';
    for (const kind of ['captcha', 'mfa', 'payment', 'identity', 'signature', 'other', null, undefined]) {
      expect(withGoogleSsoGuidance(captcha, kind)).toBe(captcha);
    }
  });

  it('is idempotent - a resumed run re-enters the same pause path', () => {
    const once = withGoogleSsoGuidance('Inicie sessão.', 'login');
    const twice = withGoogleSsoGuidance(once, 'login');
    expect(twice).toBe(once);
    expect(twice.match(/bloqueia navegadores automatizados/g)).toHaveLength(1);
  });

  it('does not leave a login pause with the guidance dangling off an empty instruction', () => {
    expect(withGoogleSsoGuidance('', 'login')).toBe(GOOGLE_SSO_PAUSE_GUIDANCE_PT);
    expect(withGoogleSsoGuidance('  ', 'login')).toBe(GOOGLE_SSO_PAUSE_GUIDANCE_PT);
  });

  it('rides on the regex fast path too - the layer that pauses BEFORE any model is asked', () => {
    const login = detectHumanActionable('the page says please sign in to continue');
    expect(login?.userInstructions).toContain(GOOGLE_SSO_PAUSE_GUIDANCE_EN);

    // ...and on that rule only.
    const captcha = detectHumanActionable('a reCAPTCHA is blocking the page');
    expect(captcha?.userInstructions).toBeTruthy();
    expect(captcha?.userInstructions).not.toContain('Google blocks automated browsers');
  });
});
