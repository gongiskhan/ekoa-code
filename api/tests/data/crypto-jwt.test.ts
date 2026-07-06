import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt } from '../../src/data/crypto.js';
import { signToken, verifyToken } from '../../src/auth/jwt.js';
import { __resetConfigForTests } from '../../src/config.js';

/** Crypto (ch04 §4.7) + JWT (ch03 §3.2) carryover unit tests. */
beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  process.env.JWT_SECRET = 'test-jwt-secret';
  __resetConfigForTests();
});

describe('crypto (AES-256-GCM, one module)', () => {
  it('round-trips ciphertext', () => {
    const secret = 'sk-real-secret-value-123';
    const ct = encrypt(secret);
    expect(ct).not.toContain(secret);
    expect(ct.split('.')).toHaveLength(3); // iv.tag.data
    expect(decrypt(ct)).toBe(secret);
  });

  it('tamper detection: a mutated tag fails to decrypt', () => {
    const ct = encrypt('x');
    const [iv, , data] = ct.split('.');
    const forged = `${iv}.${Buffer.from('0'.repeat(16)).toString('base64')}.${data}`;
    expect(() => decrypt(forged)).toThrow();
  });
});

describe('jwt (claim set {sub, role, scope, orgId, username})', () => {
  it('signs and verifies with the full claim set', () => {
    const { token, expiresIn } = signToken({ sub: 'u1', role: 'builder', scope: 'user', orgId: 'o1', username: 'ana' });
    expect(expiresIn).toBe(24 * 3600);
    const claims = verifyToken(token);
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('builder');
    expect(claims.orgId).toBe('o1');
    expect(claims.username).toBe('ana');
  });

  it('rememberMe extends expiry to 30 days', () => {
    const { expiresIn } = signToken({ sub: 'u', role: 'builder', scope: 'user', orgId: 'o', username: 'x' }, true);
    expect(expiresIn).toBe(30 * 24 * 3600);
  });
});
