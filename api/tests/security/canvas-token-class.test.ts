import { describe, it, expect, beforeAll } from 'vitest';
import { signStreamToken, verifyStreamToken, CANVAS_AUDIENCE } from '../../src/streaming/auth.js';
import jwt from 'jsonwebtoken';
import { verifyToken, signToken } from '../../src/auth/jwt.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * SECURITY SUITE — canvas/platform token-class separation (Cofre F-1).
 *
 * FOUND BY the F-1 streaming security pass, and verified empirically before it was written up.
 *
 * The canvas (screencast) token is signed with the SAME secret as platform session tokens. It
 * carried `sub` and `jti` and no `aud`, and `auth/jwt.ts`'s class guard only knew about
 * `ekoa-bridge` — so `verifyToken` ACCEPTED it, returning claims with a valid `sub`/`jti` and
 * `role`/`orgId` undefined. `requireAuth` then passed it: the jti exists, it is not revoked,
 * `getActivation(sub)` resolves for a real user, and `iat` is fresh.
 *
 * The consequence is not theoretical. Routes that authorize on `req.user.sub` ALONE — gateway-key
 * mint (which returns a long-lived API key), the bridge token endpoint, and the Cofre item routes —
 * never read `role` or `orgId`, so a leaked 600-second canvas token was a platform bearer token
 * for all of them.
 */
beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
});

describe('a canvas token is NOT a platform token', () => {
  it('the platform verifier REFUSES a canvas token', () => {
    const t = signStreamToken({ userId: 'u1', traceId: 'trace-1' });
    expect(() => verifyToken(t)).toThrow(/token-class separation/);
  });

  it('refuses it specifically — not by expiry or signature, which would mask the class bug', () => {
    const t = signStreamToken({ userId: 'u1', traceId: 'trace-1' });
    let message = '';
    try {
      verifyToken(t);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('canvas token');
    expect(message).not.toMatch(/expired|signature/i);
  });

  it('carries an explicit audience so the class is a claim, not an inference', () => {
    const t = signStreamToken({ userId: 'u1', traceId: 'trace-1' });
    const [, payloadB64] = t.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8')) as { aud?: string };
    expect(payload.aud).toBe(CANVAS_AUDIENCE);
  });

  it('a token minted BEFORE the audience existed is still refused, via its traceId marker', () => {
    // No grandfathered window. This is a VALIDLY SIGNED token in exactly the shape a canvas token
    // had before the audience landed — sub + jti + traceId, no aud — so it exercises the traceId
    // branch of the guard rather than merely failing a signature check.
    const legacy = jwt.sign(
      { sub: 'u1', traceId: 'trace-1', jti: 'legacy-jti' },
      loadConfig().jwtSecret,
      { expiresIn: 600 },
    );
    expect(() => verifyToken(legacy)).toThrow(/token-class separation/);
  });

  it('an ordinary platform token is unaffected by the new guard', () => {
    const { token } = signToken({ sub: 'u1', role: 'user', orgId: 'orgA' } as never);
    const claims = verifyToken(token);
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('user');
  });
});

describe('the canvas verifier is the mirror of that refusal', () => {
  it('accepts its own token for the right trace', () => {
    const t = signStreamToken({ userId: 'u1', traceId: 'trace-1' });
    const r = verifyStreamToken(t, 'trace-1');
    expect(r.ok).toBe(true);
  });

  it('REFUSES a platform session token on the media channel', () => {
    const { token: platform } = signToken({ sub: 'u1', role: 'user', orgId: 'orgA' } as never);
    const r = verifyStreamToken(platform, 'trace-1');
    expect(r.ok).toBe(false);
  });

  it('still binds to the trace — a canvas token for one run cannot drive another', () => {
    const t = signStreamToken({ userId: 'u1', traceId: 'trace-1' });
    const r = verifyStreamToken(t, 'trace-2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('trace-mismatch');
  });
});
