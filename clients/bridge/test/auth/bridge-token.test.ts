import { describe, it, expect } from 'vitest';
import {
  BridgeTokenError,
  createBridgeTokenProvider,
  mintBridgeToken,
  type FetchLike,
  type PlatformCredentials,
} from '../../src/auth/index.js';

/**
 * Bridge-token mint + platform-token refresh against a FAKE fetch. We assert which endpoint is hit,
 * with which Bearer token, and that a refresh is persisted. All tokens are synthetic.
 */

interface Call {
  url: string;
  // `| undefined` is required, not decorative: this package compiles with
  // exactOptionalPropertyTypes, so an absent Authorization header (the unauthenticated mint) can
  // only be recorded as an explicit undefined if the property admits it.
  authorization?: string | undefined;
  body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function recorder(handler: (call: Call) => Response): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const bodyStr = init?.body === undefined || init.body === null ? undefined : String(init.body);
    const call: Call = {
      url: String(input),
      authorization: headers.authorization,
      body: bodyStr ? JSON.parse(bodyStr) : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

const validCred: PlatformCredentials = {
  access: 'platform-jwt-1',
  refresh: 'platform-jwt-1',
  expires: 4_000_000_000_000, // far future
  user: { id: 'u1', username: 'ana', role: 'user' },
};

describe('bridge token — mint with a valid platform credential', () => {
  it('mints via /bridge/token with the platform Bearer and does NOT refresh', async () => {
    const { fetchImpl, calls } = recorder((call) => {
      if (call.url.endsWith('/api/v1/bridge/token')) return jsonResponse({ token: 'bridge-tok', expiresIn: 600 });
      throw new Error(`unexpected ${call.url}`);
    });
    const provider = createBridgeTokenProvider({
      cortexBaseUrl: 'https://cortex.example',
      pairingId: 'p-test',
      getCredentials: () => validCred,
      setCredentials: () => { throw new Error('should not persist when not refreshing'); },
      fetchImpl,
      now: () => 1_000_000,
    });

    const mint = await provider.getToken();
    expect(mint.token).toBe('bridge-tok');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://cortex.example/api/v1/bridge/token');
    expect(calls[0]!.authorization).toBe('Bearer platform-jwt-1');
    expect(calls[0]!.body).toEqual({ pairingId: 'p-test' });
  });

  it('carries the TASK BINDING back with the token: signingSecret + org', async () => {
    const { fetchImpl } = recorder(() => jsonResponse({ token: 'bridge-tok', expiresIn: 600, signingSecret: 'per-pairing-hmac', org: 'orgA' }));
    const provider = createBridgeTokenProvider({
      cortexBaseUrl: 'https://cortex.example',
      pairingId: 'p-test',
      getCredentials: () => validCred,
      setCredentials: () => {},
      fetchImpl,
    });
    // The regression: the daemon used to parse ONLY `token`, so its verifier ran against an empty
    // secret and an empty org, and every real delegated task was denied.
    await expect(provider.getToken()).resolves.toEqual({ token: 'bridge-tok', signingSecret: 'per-pairing-hmac', org: 'orgA' });
  });
});

describe('bridge token — refresh the platform credential when expired, then mint', () => {
  it('calls /auth/refresh with the old token, persists the fresh one, mints with the fresh token', async () => {
    const NOW = 10_000_000;
    const expiredCred: PlatformCredentials = { access: 'old-jwt', refresh: 'old-jwt', expires: 0, user: validCred.user };
    let persisted: PlatformCredentials | undefined;
    const { fetchImpl, calls } = recorder((call) => {
      if (call.url.endsWith('/api/v1/auth/refresh')) return jsonResponse({ token: 'fresh-jwt', expiresIn: 3600 });
      if (call.url.endsWith('/api/v1/bridge/token')) return jsonResponse({ token: 'bridge-tok-2', expiresIn: 600 });
      throw new Error(`unexpected ${call.url}`);
    });

    let current = expiredCred;
    const provider = createBridgeTokenProvider({
      cortexBaseUrl: 'https://cortex.example',
      pairingId: 'p-test',
      getCredentials: () => current,
      setCredentials: (c) => { persisted = c; current = c; },
      fetchImpl,
      now: () => NOW,
    });

    const mint = await provider.getToken();
    expect(mint.token).toBe('bridge-tok-2');

    // refresh happened first (old bearer), then mint with the fresh bearer.
    expect(calls.map((c) => c.url)).toEqual([
      'https://cortex.example/api/v1/auth/refresh',
      'https://cortex.example/api/v1/bridge/token',
    ]);
    expect(calls[0]!.authorization).toBe('Bearer old-jwt');
    expect(calls[1]!.authorization).toBe('Bearer fresh-jwt');

    // the refreshed credential was persisted, with a recomputed expiry and the identity carried forward.
    expect(persisted).toEqual({
      access: 'fresh-jwt',
      refresh: 'fresh-jwt',
      expires: NOW + 3600 * 1000,
      user: validCred.user,
    });
  });
});

describe('bridge token — failures surface as BridgeTokenError', () => {
  it('no credentials → reason "no-credentials"', async () => {
    const provider = createBridgeTokenProvider({
      cortexBaseUrl: 'https://cortex.example',
      pairingId: 'p-test',
      getCredentials: () => undefined,
      setCredentials: () => {},
      fetchImpl: async () => jsonResponse({}),
    });
    await expect(provider.getToken()).rejects.toMatchObject({ name: 'BridgeTokenError', reason: 'no-credentials' });
  });

  it('a 500 from /bridge/token → reason "mint-failed"', async () => {
    const provider = createBridgeTokenProvider({
      cortexBaseUrl: 'https://cortex.example',
      pairingId: 'p-test',
      getCredentials: () => validCred,
      setCredentials: () => {},
      fetchImpl: async () => jsonResponse({ error: 'boom' }, 500),
    });
    await expect(provider.getToken()).rejects.toMatchObject({ name: 'BridgeTokenError', reason: 'mint-failed' });
  });

  it('a 401 from /auth/refresh (token already truly expired) → reason "refresh-failed"', async () => {
    const provider = createBridgeTokenProvider({
      cortexBaseUrl: 'https://cortex.example',
      pairingId: 'p-test',
      getCredentials: () => ({ access: 'old', expires: 0 }),
      setCredentials: () => {},
      fetchImpl: async (input) =>
        String(input).endsWith('/api/v1/auth/refresh') ? jsonResponse({ error: 'expired' }, 401) : jsonResponse({ token: 'x' }),
    });
    await expect(provider.getToken()).rejects.toMatchObject({ name: 'BridgeTokenError', reason: 'refresh-failed' });
  });
});

describe('mintBridgeToken (standalone)', () => {
  it('returns the token on success and rejects a token-less response', async () => {
    const ok: FetchLike = async () => jsonResponse({ token: 'bt', expiresIn: 600 });
    await expect(mintBridgeToken(ok, 'https://c.example', 'jwt', 'p-1')).resolves.toEqual({ token: 'bt' });

    const empty: FetchLike = async () => jsonResponse({ expiresIn: 600 });
    await expect(mintBridgeToken(empty, 'https://c.example', 'jwt', 'p-1')).rejects.toBeInstanceOf(BridgeTokenError);
  });

  it('omits a binding half that is absent, empty, or the wrong type - never a bogus one', async () => {
    // An empty secret verifies NOTHING, and a non-string is a Cortex that changed shape underneath
    // us. Both must read as "Cortex said nothing", so the daemon keeps the binding it already holds
    // instead of overwriting a working one with garbage.
    const cases: unknown[] = [
      { token: 'bt', expiresIn: 600 },
      { token: 'bt', expiresIn: 600, signingSecret: '', org: '' },
      { token: 'bt', expiresIn: 600, signingSecret: 42, org: { orgId: 'orgA' } },
      { token: 'bt', expiresIn: 600, signingSecret: null, org: null },
    ];
    for (const body of cases) {
      const f: FetchLike = async () => jsonResponse(body);
      await expect(mintBridgeToken(f, 'https://c.example', 'jwt', 'p-1')).resolves.toEqual({ token: 'bt' });
    }
  });

  it('takes each half independently: an org with no secret still comes through', async () => {
    const f: FetchLike = async () => jsonResponse({ token: 'bt', expiresIn: 600, org: 'orgA' });
    await expect(mintBridgeToken(f, 'https://c.example', 'jwt', 'p-1')).resolves.toEqual({ token: 'bt', org: 'orgA' });
  });
});
