import { describe, it, expect, beforeAll } from 'vitest';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { signToken, verifyToken } from '../../src/auth/jwt.js';
import {
  mintBridgeToken,
  verifyBridgeToken,
  readBridgeToken,
  BridgeAuthError,
  BRIDGE_AUDIENCE,
  BRIDGE_TOKEN_TTL_SECONDS,
} from '../../src/bridge/token.js';

/**
 * Token-class separation (ch18 §18.3.6, §18.8 criterion 6; ch09 §9.2). Platform JWTs and bridge
 * tokens are two classes over ONE secret, never interchangeable — the platform verifier rejects a
 * bridge token AND the bridge verifier rejects a platform token. Both directions are asserted here.
 */
beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-bridge';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  __resetConfigForTests();
  loadConfig();
});

function platformToken(): string {
  return signToken({ sub: 'u-1', role: 'user', scope: 'auth:read agent:execute agent:read', orgId: 'org-1', username: 'ana' }).token;
}

describe('bridge token mint + verify', () => {
  it('mints a bridge-class token bound to a pairing with the 600s TTL', () => {
    const { token, expiresIn } = mintBridgeToken({ sub: 'u-1' }, 'pair-a');
    expect(expiresIn).toBe(BRIDGE_TOKEN_TTL_SECONDS);
    const claims = verifyBridgeToken(token, 'pair-a');
    expect(claims.sub).toBe('u-1');
    expect(claims.pairingId).toBe('pair-a');
    expect(claims.connectionId).toBe('pair-a');
    expect(claims.aud).toBe(BRIDGE_AUDIENCE);
  });

  it('rejects a bridge token whose pairing claim does not match the path (connection-mismatch)', () => {
    const { token } = mintBridgeToken({ sub: 'u-1' }, 'pair-a');
    expect(() => verifyBridgeToken(token, 'pair-b')).toThrow(BridgeAuthError);
    try {
      verifyBridgeToken(token, 'pair-b');
    } catch (e) {
      expect((e as BridgeAuthError).reason).toBe('connection-mismatch');
    }
  });
});

describe('token-class separation (§18.3.6)', () => {
  it('the PLATFORM verifier positively rejects a bridge token', () => {
    const { token } = mintBridgeToken({ sub: 'u-1' }, 'pair-a');
    expect(() => verifyToken(token)).toThrow();
  });

  it('the BRIDGE verifier positively rejects a platform token', () => {
    const token = platformToken();
    expect(() => verifyBridgeToken(token, 'pair-a')).toThrow();
    expect(() => readBridgeToken(token)).toThrow();
  });

  it('a valid platform token still verifies on the platform verifier (guard is not over-broad)', () => {
    const token = platformToken();
    const claims = verifyToken(token);
    expect(claims.sub).toBe('u-1');
    expect(claims.orgId).toBe('org-1');
  });
});
