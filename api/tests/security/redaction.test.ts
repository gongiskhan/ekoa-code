import { describe, it, expect } from 'vitest';
import {
  SecretRegistry,
  secretRegistryFromFields,
  secretRegistryFromValues,
  maskUnknownSecret,
  redactHeadersByName,
  redactBodyByName,
  redactUrlByName,
  redactStream,
  MIN_MASKABLE_LENGTH,
} from '../../src/security/redaction.js';

/**
 * SECURITY SUITE — value-keyed redaction (Cofre R-6; invariant I2).
 *
 * The two implementations this module replaces each leaked in a different way, and both silently
 * skipped short values. Every case below pins one of those regressions.
 */
describe('SecretRegistry', () => {
  const SECRET = 'sk-live-SUPER-SECRET-key-1234';

  it('substitutes the raw value with an opaque handle carrying no plaintext fragment', () => {
    const r = new SecretRegistry();
    const handle = r.register(SECRET);
    const out = r.redact(`Authorization: Bearer ${SECRET} done`);
    expect(out).toBe(`Authorization: Bearer [REDACTED:${handle}] done`);
    expect(out).not.toContain(SECRET);
  });

  it('leaks NO suffix of the secret (the http-template regression)', () => {
    // The old maskValue emitted `***…1234` — a persisted plaintext suffix of every credential.
    const r = new SecretRegistry();
    r.register(SECRET);
    const out = r.redact(SECRET);
    expect(out).not.toContain('1234');
    expect(out).not.toMatch(/…/);
    expect(out).toBe('[REDACTED:s1]');
  });

  it('leaks no length information', () => {
    const r = new SecretRegistry();
    r.register('a'.repeat(8));
    r.register('b'.repeat(64));
    expect(r.redact('a'.repeat(8))).toBe('[REDACTED:s1]');
    expect(r.redact('b'.repeat(64))).toBe('[REDACTED:s2]');
  });

  it('catches the URL-encoded form (the api-call regression)', () => {
    const withSpecials = 'p@ss/word+value=xyz';
    const r = new SecretRegistry();
    r.register(withSpecials);
    const out = r.redact(`https://x.test/cb?token=${encodeURIComponent(withSpecials)}`);
    expect(out).not.toContain(encodeURIComponent(withSpecials));
    expect(out).toContain('[REDACTED:s1]');
  });

  it('catches the base64 and base64url forms', () => {
    const r = new SecretRegistry();
    r.register(SECRET);
    const b64 = Buffer.from(SECRET, 'utf8').toString('base64');
    const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(r.redact(`Basic ${b64}`)).not.toContain(b64);
    expect(r.redact(`tok=${b64url}`)).not.toContain(b64url);
  });

  it('catches the JSON-escaped form', () => {
    const withQuotes = 'secret"with\\slash';
    const r = new SecretRegistry();
    r.register(withQuotes);
    const escaped = JSON.stringify(withQuotes).slice(1, -1);
    const out = r.redact(`{"k":"${escaped}"}`);
    expect(out).not.toContain(escaped);
  });

  it('matches case-insensitively for values long enough to be collision-free', () => {
    const r = new SecretRegistry();
    r.register('AbCdEfGhIjKl');
    expect(r.redact('value=abcdefghijkl')).toContain('[REDACTED:s1]');
  });

  it('does NOT case-fold short values (collision risk outweighs the gain)', () => {
    const r = new SecretRegistry();
    r.register('abcd'); // 4 chars: maskable, but under the case-insensitive floor
    expect(r.redact('ABCD')).toBe('ABCD');
    expect(r.redact('abcd')).toBe('[REDACTED:s1]');
  });

  it('masks a longer secret before a shorter one it contains', () => {
    const r = new SecretRegistry();
    r.register('secret-value-long');
    r.register('secret-value');
    const out = r.redact('secret-value-long');
    // The long value wins outright; no fragment of it survives as a separate match.
    expect(out).toBe('[REDACTED:s1]');
  });

  it('surfaces values too short to mask instead of skipping them silently', () => {
    // The old collectSecretValues dropped anything under 4 chars with no signal at all.
    const r = new SecretRegistry();
    expect(r.register('ab')).toBeNull();
    expect(r.unmaskable).toEqual(['ab']);
    expect(r.size).toBe(0);
  });

  it('masks a 3-char value — the old floor was 4 and skipped it', () => {
    const r = new SecretRegistry();
    expect(MIN_MASKABLE_LENGTH).toBe(3);
    expect(r.register('abc')).toBe('s1');
    expect(r.redact('x=abc')).toBe('x=[REDACTED:s1]');
  });

  it('returns a stable handle for a repeated value', () => {
    const r = new SecretRegistry();
    expect(r.register(SECRET)).toBe(r.register(SECRET));
    expect(r.size).toBe(1);
  });

  it('redacts object keys as well as values', () => {
    const r = new SecretRegistry();
    r.register('keysecret');
    const out = r.redactDeep({ keysecret: { nested: 'keysecret' } }) as Record<string, Record<string, string>>;
    expect(JSON.stringify(out)).not.toContain('keysecret');
  });

  it('leaves non-string leaves untouched', () => {
    const r = new SecretRegistry();
    r.register('abcdef');
    expect(r.redactDeep({ n: 1, b: true, z: null, s: 'abcdef' })).toEqual({
      n: 1,
      b: true,
      z: null,
      s: '[REDACTED:s1]',
    });
  });

  it('is a no-op when nothing is registered', () => {
    expect(new SecretRegistry().redact('nothing to do')).toBe('nothing to do');
  });

  it('builds from a resolved credential field bag', () => {
    const r = secretRegistryFromFields({ stripe: { api_key: 'sk_test_abcdef', mode: 'live' } });
    expect(r.redact('using sk_test_abcdef in live')).toContain('[REDACTED:');
    expect(r.redact('using sk_test_abcdef in live')).not.toContain('sk_test_abcdef');
  });

  it('builds from a flat value list', () => {
    const r = secretRegistryFromValues(['alpha-secret', 42, null, 'beta-secret']);
    expect(r.size).toBe(2);
  });
});

describe('name-pattern redaction (values we do not hold)', () => {
  it('preserves the auth scheme but no part of the credential', () => {
    expect(maskUnknownSecret('Bearer abcdef123456')).toBe('Bearer [REDACTED]');
    expect(maskUnknownSecret('abcdef123456')).toBe('[REDACTED]');
  });

  it('leaks no suffix (the historical …1234 behaviour is gone)', () => {
    expect(maskUnknownSecret('Bearer supersecrettoken9999')).not.toContain('9999');
  });

  it('masks credential-shaped header names', () => {
    const out = redactHeadersByName({ authorization: 'Bearer xyz', 'x-api-key': 'k', accept: 'application/json' });
    expect(out.authorization).toBe('Bearer [REDACTED]');
    expect(out['x-api-key']).toBe('[REDACTED]');
    expect(out.accept).toBe('application/json');
  });

  it('masks credential-shaped JSON fields and form fields', () => {
    expect(redactBodyByName('{"access_token":"abc","name":"ok"}')).toContain('[REDACTED]');
    expect(redactBodyByName('{"access_token":"abc","name":"ok"}')).toContain('ok');
    expect(redactBodyByName('client_secret=abc&page=2')).toBe('client_secret=[REDACTED]&page=2');
  });

  it('masks credential-shaped query parameters', () => {
    expect(redactUrlByName('https://x.test/a?token=abc&page=2')).toBe('https://x.test/a?token=[REDACTED]&page=2');
  });
});

describe('redactStream — both legs together', () => {
  it('applies the value-keyed leg first, then the name-pattern leg', () => {
    const r = new SecretRegistry();
    r.register('known-secret-value');
    const out = redactStream('{"a":"known-secret-value","access_token":"one-we-never-held"}', r);
    expect(out).not.toContain('known-secret-value');
    expect(out).not.toContain('one-we-never-held');
  });

  it('still applies the name-pattern leg with no registry', () => {
    expect(redactStream('{"access_token":"abc"}', undefined)).toContain('[REDACTED]');
  });
});
