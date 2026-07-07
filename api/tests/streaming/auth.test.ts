import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { signStreamToken, verifyStreamToken } from '../../src/streaming/auth.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * Remote-display test 1/4 (spec §13.3): canvas token auth — accept/reject + TTL. Ported from
 * cortex/tests/streaming/auth.test.ts with assertions intact; the only harness change is the
 * config bootstrap (the new repo exposes loadConfig() rather than a `config` singleton).
 */
beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-key';
  process.env.JWT_SECRET = 'test-secret';
  __resetConfigForTests();
  loadConfig();
});

describe('streaming auth', () => {
  it('round-trips a valid token', () => {
    const token = signStreamToken({ userId: 'u-1', traceId: 't-1' });
    const result = verifyStreamToken(token, 't-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe('u-1');
      expect(result.claims.traceId).toBe('t-1');
    }
  });

  it('rejects missing token', () => {
    const result = verifyStreamToken(undefined, 't-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('jwt-missing');
  });

  it('rejects garbage token', () => {
    const result = verifyStreamToken('not-a-jwt', 't-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('jwt-invalid');
  });

  it('rejects token with mismatched trace id', () => {
    const token = signStreamToken({ userId: 'u-1', traceId: 't-1' });
    const result = verifyStreamToken(token, 't-OTHER');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('trace-mismatch');
  });

  it('rejects expired token', () => {
    const expired = jwt.sign(
      { sub: 'u-1', traceId: 't-1' },
      loadConfig().jwtSecret,
      { expiresIn: -10 },
    );
    const result = verifyStreamToken(expired, 't-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('jwt-invalid');
  });

  it('rejects token signed with a different secret', () => {
    const token = jwt.sign({ sub: 'u-1', traceId: 't-1' }, 'wrong-secret', { expiresIn: '1m' });
    const result = verifyStreamToken(token, 't-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('jwt-invalid');
  });

  it('rejects token missing the trace claim', () => {
    const token = jwt.sign({ sub: 'u-1' }, loadConfig().jwtSecret, { expiresIn: '1m' });
    const result = verifyStreamToken(token, 't-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('jwt-invalid');
  });
});
