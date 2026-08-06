import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getZohoAuthUrl,
  zohoRedirectUri,
  exchangeZohoCode,
  dcFromCallbackLocation,
  isZohoPlatformClientConfigured,
  completeZohoCallback,
  startZohoConnect,
  renderZohoCallbackPage,
  type ZohoHttp,
  type ZohoOAuthRow,
} from '../../src/integrations/zoho-oauth.js';
import { CLEAR_CREDENTIAL } from '../../src/integrations/service.js';

/**
 * ZOHO SIGN OAUTH POPUP CONNECT (ported from ekoa-dev 09a29bb7 / e620e740 / d8e4538e).
 *
 * The upstream suite covers the authorize URL and the code exchange. It does NOT cover the
 * callback route, and that is exactly where its one customer-visible regression lived: a connect
 * that reported success, wrote a refresh_token, flipped the row to enabled - and could never mint
 * an access token, because a previously pasted client_id/client_secret survived the merge and the
 * platform-minted refresh_token was then refreshed against the wrong client. So the callback gets
 * first-class coverage here, and the three deletions are asserted by name.
 */
const ENV_KEYS = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_DC', 'ZOHO_OAUTH_REDIRECT_BASE_URL', 'OAUTH_REDIRECT_BASE_URL', 'ZOHO_ACCOUNTS_BASE_OVERRIDE'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.ZOHO_CLIENT_ID = 'env-client-id';
  process.env.ZOHO_CLIENT_SECRET = 'env-client-secret';
  process.env.ZOHO_DC = 'eu';
  // Deliberately DIFFERENT from the Zoho-specific one, to prove which wins.
  process.env.OAUTH_REDIRECT_BASE_URL = 'https://tunnel.example.com';
  process.env.ZOHO_OAUTH_REDIRECT_BASE_URL = 'http://localhost:5903';
  delete process.env.ZOHO_ACCOUNTS_BASE_OVERRIDE;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Records every request; answers with whatever the test queued. */
function makeHttp(body: unknown, status = 200): { http: ZohoHttp; calls: Array<{ url: string; body: string }> } {
  const calls: Array<{ url: string; body: string }> = [];
  const http: ZohoHttp = async (url, init) => {
    calls.push({ url, body: init.body });
    return { ok: status >= 200 && status < 400, status, text: async () => JSON.stringify(body) };
  };
  return { http, calls };
}

describe('the authorize URL', () => {
  it('is built on the platform client’s DC with offline access, forced consent and the state', () => {
    const url = new URL(getZohoAuthUrl('state-123'));
    expect(url.origin).toBe('https://accounts.zoho.eu');
    expect(url.pathname).toBe('/oauth/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('env-client-id');
    // Comma-separated: Zoho does not take a space-separated scope list.
    expect(url.searchParams.get('scope')).toBe('ZohoSign.documents.ALL,ZohoSign.account.READ');
    // offline+consent make Zoho reissue a refresh_token on EVERY connect, so reconnecting REPAIRS
    // a lost or revoked token instead of silently doing nothing.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-123');
  });

  it('uses the Zoho-specific redirect base over the shared one', () => {
    // Zoho accepts http://localhost redirects, so local dev needs no tunnel while the shared base
    // may point at one. A port that got this backwards would send users to the wrong callback.
    expect(zohoRedirectUri()).toBe('http://localhost:5903/api/v1/oauth/zoho/callback');
    expect(new URL(getZohoAuthUrl('s')).searchParams.get('redirect_uri')).toBe('http://localhost:5903/api/v1/oauth/zoho/callback');
  });

  it('falls back to the shared redirect base when no Zoho-specific one is set', () => {
    delete process.env.ZOHO_OAUTH_REDIRECT_BASE_URL;
    expect(zohoRedirectUri()).toBe('https://tunnel.example.com/api/v1/oauth/zoho/callback');
  });

  it('reports the platform client as unconfigured when either half is missing', () => {
    expect(isZohoPlatformClientConfigured()).toBe(true);
    process.env.ZOHO_CLIENT_SECRET = '';
    expect(isZohoPlatformClientConfigured()).toBe(false);
  });
});

describe('the data centre from Zoho’s callback `location`', () => {
  it('accepts the real data centres and maps Zoho’s "us" onto "com"', () => {
    expect(dcFromCallbackLocation('eu')).toBe('eu');
    expect(dcFromCallbackLocation('in')).toBe('in');
    expect(dcFromCallbackLocation('us')).toBe('com');
    expect(dcFromCallbackLocation('.CA ')).toBe('ca');
  });

  it('NEVER builds a host from a hostile value — it falls back to the platform client’s DC', async () => {
    // `location` arrives on an unauthenticated redirect an attacker can craft, and the
    // client_secret is POSTed to the host derived from it. This is the security assertion.
    expect(dcFromCallbackLocation('evil.com/pwn?x=')).toBe('eu');
    expect(dcFromCallbackLocation('')).toBe('eu');
    const { http, calls } = makeHttp({ refresh_token: 'rt-1' });
    await exchangeZohoCode('code-1', 'evil.com/pwn?x=', http);
    expect(calls[0]!.url).toBe('https://accounts.zoho.eu/oauth/v2/token');
    expect(calls[0]!.url).not.toContain('evil.com');
  });
});

describe('the code exchange', () => {
  it('redeems on the account’s DC and returns only the durable bundle', async () => {
    const { http, calls } = makeHttp({ refresh_token: 'rt-1', access_token: 'at-discarded' });
    const bundle = await exchangeZohoCode('code-1', 'us', http);
    expect(bundle).toEqual({ refresh_token: 'rt-1', dc: 'com', auth_type: 'oauth2' });
    expect(calls[0]!.url).toBe('https://accounts.zoho.com/oauth/v2/token');
    const body = new URLSearchParams(calls[0]!.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('client_id')).toBe('env-client-id');
    expect(body.get('client_secret')).toBe('env-client-secret');
    expect(body.get('redirect_uri')).toBe('http://localhost:5903/api/v1/oauth/zoho/callback');
  });

  it('throws on Zoho’s HTTP-200-with-{error} failure shape', async () => {
    // Zoho answers 200 with `{error:"invalid_code"}` rather than a 4xx; reading only the status
    // would treat a hard failure as a successful connect.
    const { http } = makeHttp({ error: 'invalid_code' }, 200);
    await expect(exchangeZohoCode('bad', 'eu', http)).rejects.toThrow(/invalid_code/);
  });

  it('throws when consent was granted without offline access (no refresh_token)', async () => {
    const { http } = makeHttp({ access_token: 'at-only' });
    await expect(exchangeZohoCode('code', 'eu', http)).rejects.toThrow(/no refresh_token/);
  });

  it('honours the accounts-base test seam', async () => {
    process.env.ZOHO_ACCOUNTS_BASE_OVERRIDE = 'http://127.0.0.1:9999/';
    const { http, calls } = makeHttp({ refresh_token: 'rt' });
    await exchangeZohoCode('c', 'eu', http);
    expect(calls[0]!.url).toBe('http://127.0.0.1:9999/oauth/v2/token');
  });
});

// ----------------------------------------------------------------------------
// The callback — the half upstream never covered
// ----------------------------------------------------------------------------

function makeDeps(over: Partial<Parameters<typeof completeZohoCallback>[1]> = {}) {
  const row: ZohoOAuthRow = { _id: 'cfg-1', orgId: 'orgA', ownerUserId: 'u1' };
  const persisted: Array<{ row: ZohoOAuthRow; patch: Record<string, unknown> }> = [];
  const begun: Array<{ state: string; expiresAt: number }> = [];
  const deps = {
    now: () => 1_700_000_000_000,
    genState: () => 'state-abc',
    beginConnect: async (_a: unknown, state: string, expiresAt: number) => { begun.push({ state, expiresAt }); return row; },
    findByState: async (state: string) => (state === 'state-abc' ? row : null),
    persistGrant: async (r: ZohoOAuthRow, patch: Record<string, unknown>) => { persisted.push({ row: r, patch }); },
    http: makeHttp({ refresh_token: 'rt-new' }).http,
    ...over,
  };
  return { deps, persisted, begun, row };
}

describe('the callback persists a grant that can actually mint a token', () => {
  it('writes refresh_token + dc + auth_type, and DELETES the three fields that would break it', async () => {
    const { deps, persisted } = makeDeps();
    const outcome = await completeZohoCallback({ code: 'c', state: 'state-abc', location: 'eu' }, deps);
    expect(outcome).toEqual({ ok: true });
    expect(persisted).toHaveLength(1);
    const patch = persisted[0]!.patch;
    expect(patch.refresh_token).toBe('rt-new');
    expect(patch.dc).toBe('eu');
    expect(patch.auth_type).toBe('oauth2');
    // THE REGRESSION THIS EXISTS FOR. `getZohoAccessToken` prefers a stored client_id/secret over
    // the platform client, so leaving a pasted pair behind refreshes a platform-minted token
    // against the wrong client and Zoho answers `invalid_code` — a connect that "succeeds" and
    // then cannot mint a single access token.
    expect(patch.client_id).toBe(CLEAR_CREDENTIAL);
    expect(patch.client_secret).toBe(CLEAR_CREDENTIAL);
    // The one-time grant code is burnt for the same reason: this consent supersedes it.
    expect(patch.grant_code).toBe(CLEAR_CREDENTIAL);
  });

  it('clears with the SENTINEL, never an empty string', async () => {
    // An empty string reads as "field untouched" under the credential-merge rule, so the stale
    // values would survive and the bug would be back with the code looking correct.
    const { deps, persisted } = makeDeps();
    await completeZohoCallback({ code: 'c', state: 'state-abc' }, deps);
    for (const k of ['client_id', 'client_secret', 'grant_code']) {
      expect(persisted[0]!.patch[k]).not.toBe('');
    }
  });
});

describe('the callback refuses safely', () => {
  it('an unknown or expired state never reaches the exchange', async () => {
    const { deps, persisted } = makeDeps();
    const outcome = await completeZohoCallback({ code: 'c', state: 'not-mine' }, deps);
    expect(outcome).toEqual({ ok: false, reason: 'Invalid or expired OAuth state' });
    expect(persisted).toHaveLength(0);
  });

  it('a denied consent (no code) is reported with Zoho’s own error, and writes nothing', async () => {
    const { deps, persisted } = makeDeps();
    const outcome = await completeZohoCallback({ state: 'state-abc', error: 'access_denied' }, deps);
    expect(outcome.ok).toBe(false);
    expect((outcome as { reason: string }).reason).toMatch(/access_denied/);
    expect(persisted).toHaveLength(0);
  });

  it('a failed exchange leaves the stored bundle untouched', async () => {
    const { deps, persisted } = makeDeps({ http: makeHttp({ error: 'invalid_code' }).http });
    const outcome = await completeZohoCallback({ code: 'c', state: 'state-abc' }, deps);
    expect(outcome.ok).toBe(false);
    expect(persisted).toHaveLength(0);
  });
});

describe('starting a connect', () => {
  it('stamps a state with a bounded lifetime and returns the matching authorize URL', async () => {
    const { deps, begun } = makeDeps();
    const out = await startZohoConnect({ userId: 'u1', orgId: 'orgA', isAdmin: true }, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state).toBe('state-abc');
    expect(new URL(out.authUrl).searchParams.get('state')).toBe('state-abc');
    expect(begun[0]!.expiresAt).toBeGreaterThan(deps.now());
    expect(begun[0]!.expiresAt - deps.now()).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it('refuses when this deployment holds no Zoho client, without touching the store', async () => {
    process.env.ZOHO_CLIENT_ID = '';
    const { deps, begun } = makeDeps();
    expect(await startZohoConnect({ userId: 'u1', orgId: 'orgA', isAdmin: true }, deps)).toEqual({ ok: false, code: 'not_configured' });
    expect(begun).toHaveLength(0);
  });
});

describe('the result page', () => {
  it('cannot be broken out of by a provider error string (upstream is vulnerable here)', () => {
    // `error` is reflected from Zoho's own query params on an UNAUTHENTICATED route, so a crafted
    // link reaches this string with no state and no login. JSON.stringify alone does not escape
    // `/`, so a literal `</script>` would close the inline script and the rest would parse as
    // markup — reflected XSS on the API origin. Nothing markup-significant may survive.
    const html = renderZohoCallbackPage(false, '', '</script><img src=x onerror=alert(1)>');
    // The property that matters: NO markup construct can form from the injected value. The words
    // survive as inert text inside a quoted JS string, which is harmless — what must not survive
    // is a `<` or `>` that the HTML parser would act on.
    expect(html).not.toContain('</script><img');
    expect(html).not.toContain('<img');
    expect(html).toContain('\\u003c/script\\u003e'); // delivered, escaped, not dropped
    // Exactly the page's own two script tags — the injected one did not split the element.
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain('postMessage');
    expect(html).toContain('provider');
    expect(html).toContain('href="/integrations"'); // relative when no origin is configured
  });

  it('escapes the same way in the human-readable message, not just the payload', () => {
    const html = renderZohoCallbackPage(false, '', '</script>oops');
    // Exactly one script element opens and one closes: the injected one must not have split it.
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('reports success without an error field', () => {
    const html = renderZohoCallbackPage(true, 'https://app.example');
    expect(html).toContain('success');
    expect(html).not.toContain('error');
    expect(html).toContain('href="https://app.example/integrations"');
  });
});
