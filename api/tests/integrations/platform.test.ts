import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, activityLogs } from '../../src/data/stores.js';
import { decrypt } from '../../src/data/crypto.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import {
  connectPlatform,
  completeCallback,
  platformStatus,
  disconnectPlatform,
  listPlatform,
  getValidPlatformTokens,
  renderCallbackPage,
  PlatformNotConnectedError,
  type PlatformHttp,
  type PlatformOAuthEnv,
  type OAuthDeps,
} from '../../src/integrations/platform-oauth.js';
import { callPlatformIntegration } from '../../src/integrations/platform-call.js';
import type { IntegrationConfigDoc } from '../../src/integrations/service.js';

/**
 * G8: platform OAuth (ch03 §3.8.15) — the connect→callback state machine (CSRF state matched with
 * a TTL; a tampered/expired state refused), tokens encrypted at rest, refresh-on-expiry token
 * custody, and the platform API caller against the shipped google-workspace definition. All
 * provider HTTP is injected; nothing touches a live provider.
 */
let mem: MongoMemoryServer;
let seq = 0;
let clock = 1_700_000_000_000;

const env: PlatformOAuthEnv = {
  google: { clientId: 'gid', clientSecret: 'gsecret', redirectBaseUrl: 'https://app.example' },
  microsoft: { clientId: 'mid', clientSecret: 'msecret', redirectBaseUrl: 'https://app.example', tenantId: 'common' },
};
const admin = { userId: 'admin1', orgId: 'orgA', username: 'admin1' };
const member = { userId: 'u2', orgId: 'orgA', role: 'builder' } as const;

interface FakeRes {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  headers: { forEach: (cb: (v: string, k: string) => void) => void };
  statusText?: string;
}
function jsonRes(status: number, obj: unknown): FakeRes {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj), headers: { forEach: () => undefined }, statusText: '' };
}

/** URL-routed fake provider transport. Records calls; canned token/userinfo/API responses. */
function makeHttp(overrides: Partial<Record<string, () => FakeRes>> = {}): { http: PlatformHttp; calls: string[] } {
  const calls: string[] = [];
  const http: PlatformHttp = async (url) => {
    calls.push(url);
    for (const [needle, fn] of Object.entries(overrides)) if (fn && url.includes(needle)) return fn() as unknown as Response;
    if (url.includes('oauth2.googleapis.com/token') || url.includes('login.microsoftonline.com')) {
      return jsonRes(200, { access_token: 'atk-1', refresh_token: 'rtk-1', token_type: 'Bearer', expires_in: 3600, scope: 'openid email' }) as unknown as Response;
    }
    if (url.includes('googleapis.com/oauth2/v2/userinfo')) return jsonRes(200, { email: 'user@acme.pt' }) as unknown as Response;
    if (url.includes('graph.microsoft.com/v1.0/me') && url.endsWith('/me')) return jsonRes(200, { mail: 'user@acme.pt' }) as unknown as Response;
    return jsonRes(200, { ok: true }) as unknown as Response;
  };
  return { http, calls };
}

function depsWith(http: PlatformHttp): OAuthDeps {
  return { now: () => clock, genId: () => `id_${seq++}`, http, env };
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  delete process.env.EKOA_INTEGRATIONS_DIR;
  refreshDefinitions(); // load the shipped packages (google-workspace) for the caller test
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_platform');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  clock = 1_700_000_000_000;
  await integrationConfigs.deleteMany({});
  await activityLogs.deleteMany({});
});

async function rawRow(orgId: string, provider: string): Promise<IntegrationConfigDoc | null> {
  return (await integrationConfigs.get(`platform-${orgId}-${provider}`)) as IntegrationConfigDoc | null;
}

describe('platform OAuth connect (ch03 §3.8.15)', () => {
  it('builds a provider authorize URL and stores a pending state', async () => {
    const { http } = makeHttp();
    const res = await connectPlatform(admin, 'google', depsWith(http));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.authUrl).toContain('accounts.google.com');
    expect(res.authUrl).toContain('client_id=gid');
    expect(res.authUrl).toContain(`state=${res.state}`);
    expect(res.authUrl).toContain(encodeURIComponent('https://app.example/api/v1/oauth/google/callback'));
    const row = await rawRow('orgA', 'google');
    expect(row?.oauthState).toBe(res.state);
    expect(row?.enabled).toBe(false);
    expect(row?.credentialsCiphertext).toBeUndefined();
  });

  it('rejects an unknown provider', async () => {
    const res = await connectPlatform(admin, 'dropbox', depsWith(makeHttp().http));
    expect(res).toEqual({ ok: false, code: 'invalid_provider' });
  });

  it('reports not_configured when client credentials are absent', async () => {
    const bare: PlatformOAuthEnv = { ...env, google: { clientId: '', clientSecret: '', redirectBaseUrl: '' } };
    const res = await connectPlatform(admin, 'google', { now: () => clock, genId: () => 'x', http: makeHttp().http, env: bare });
    expect(res).toEqual({ ok: false, code: 'not_configured' });
  });
});

describe('platform OAuth callback (state machine)', () => {
  it('exchanges the code, stores tokens ENCRYPTED, enables the connection, clears the state', async () => {
    const { http } = makeHttp();
    const connect = await connectPlatform(admin, 'google', depsWith(http));
    if (!connect.ok) throw new Error('connect failed');
    const outcome = await completeCallback('google', { code: 'auth-code', state: connect.state }, depsWith(http));
    expect(outcome).toEqual({ ok: true, provider: 'google', email: 'user@acme.pt' });

    const row = await rawRow('orgA', 'google');
    expect(row?.enabled).toBe(true);
    expect(row?.oauthState).toBeFalsy(); // consumed (stored as null/undefined by the driver)
    expect(row?.credentialsCiphertext).toBeTruthy();
    // Stored at rest as ciphertext, not plaintext; decrypts to the token bundle.
    expect(row!.credentialsCiphertext).not.toContain('atk-1');
    const tokens = JSON.parse(decrypt(row!.credentialsCiphertext!)) as { access_token: string; email: string };
    expect(tokens.access_token).toBe('atk-1');
    expect(tokens.email).toBe('user@acme.pt');
  });

  it('refuses a tampered state and writes no credentials', async () => {
    const { http } = makeHttp();
    const connect = await connectPlatform(admin, 'google', depsWith(http));
    if (!connect.ok) throw new Error('connect failed');
    const outcome = await completeCallback('google', { code: 'auth-code', state: 'not-the-state' }, depsWith(http));
    expect(outcome).toEqual({ ok: false, provider: 'google', reason: 'invalid_state' });
    const row = await rawRow('orgA', 'google');
    expect(row?.enabled).toBe(false);
    expect(row?.credentialsCiphertext).toBeUndefined();
  });

  it('refuses an expired state', async () => {
    const { http } = makeHttp();
    const connect = await connectPlatform(admin, 'google', depsWith(http));
    if (!connect.ok) throw new Error('connect failed');
    clock += 11 * 60 * 1000; // past the 10-minute TTL
    const outcome = await completeCallback('google', { code: 'auth-code', state: connect.state }, depsWith(http));
    expect(outcome).toEqual({ ok: false, provider: 'google', reason: 'invalid_state' });
  });

  it('reports exchange_failed and stays disconnected when the provider rejects the code', async () => {
    const { http } = makeHttp({ 'oauth2.googleapis.com/token': () => jsonRes(400, { error: 'invalid_grant' }) });
    const connect = await connectPlatform(admin, 'google', depsWith(makeHttp().http));
    if (!connect.ok) throw new Error('connect failed');
    const outcome = await completeCallback('google', { code: 'bad', state: connect.state }, depsWith(http));
    expect(outcome).toEqual({ ok: false, provider: 'google', reason: 'exchange_failed' });
    expect((await rawRow('orgA', 'google'))?.enabled).toBe(false);
  });

  it('treats a provider error param (user denied) as denied', async () => {
    const outcome = await completeCallback('google', { error: 'access_denied' }, depsWith(makeHttp().http));
    expect(outcome).toEqual({ ok: false, provider: 'google', reason: 'denied' });
  });
});

describe('platform status / list / disconnect', () => {
  it('status and list reflect the connection; disconnect clears it', async () => {
    const { http } = makeHttp();
    const connect = await connectPlatform(admin, 'google', depsWith(http));
    if (!connect.ok) throw new Error('connect failed');
    await completeCallback('google', { code: 'auth-code', state: connect.state }, depsWith(http));

    const status = await platformStatus(member, 'google');
    expect(status.connected).toBe(true);
    expect(status.email).toBe('user@acme.pt');
    expect(typeof status.expiresAt).toBe('string');

    const list = await listPlatform(member);
    expect(list.find((p) => p.provider === 'google')).toEqual({ provider: 'google', connected: true, email: 'user@acme.pt' });
    expect(list.find((p) => p.provider === 'microsoft')).toEqual({ provider: 'microsoft', connected: false });

    await disconnectPlatform(admin, 'google', depsWith(http));
    expect((await platformStatus(member, 'google')).connected).toBe(false);
  });
});

describe('token custody — getValidPlatformTokens', () => {
  it('returns the stored token while valid, then refreshes + re-persists once expired', async () => {
    const { http } = makeHttp();
    const connect = await connectPlatform(admin, 'google', depsWith(http));
    if (!connect.ok) throw new Error('connect failed');
    await completeCallback('google', { code: 'auth-code', state: connect.state }, depsWith(http));
    const before = (await rawRow('orgA', 'google'))!.credentialsCiphertext;

    const still = await getValidPlatformTokens('orgA', 'google', depsWith(http));
    expect(still.access_token).toBe('atk-1');

    clock += 3_600_001; // past expiry
    const refreshHttp = makeHttp({ 'oauth2.googleapis.com/token': () => jsonRes(200, { access_token: 'atk-2', refresh_token: 'rtk-2', token_type: 'Bearer', expires_in: 3600, scope: 'openid email' }) });
    const refreshed = await getValidPlatformTokens('orgA', 'google', depsWith(refreshHttp.http));
    expect(refreshed.access_token).toBe('atk-2');
    expect(refreshed.email).toBe('user@acme.pt'); // email carried across refresh
    const after = (await rawRow('orgA', 'google'))!.credentialsCiphertext;
    expect(after).not.toBe(before); // re-persisted
  });

  it('throws PlatformNotConnectedError when not connected', async () => {
    await expect(getValidPlatformTokens('orgA', 'microsoft', depsWith(makeHttp().http))).rejects.toBeInstanceOf(PlatformNotConnectedError);
  });
});

describe('platform API caller — callPlatformIntegration', () => {
  it('calls the google-workspace action with a Bearer token from custody', async () => {
    const { http } = makeHttp();
    const connect = await connectPlatform(admin, 'google', depsWith(http));
    if (!connect.ok) throw new Error('connect failed');
    await completeCallback('google', { code: 'auth-code', state: connect.state }, depsWith(http));

    const apiHttp = makeHttp({ 'gmail.googleapis.com': () => jsonRes(200, { messages: [{ id: 'm1' }] }) });
    const res = await callPlatformIntegration({ orgId: 'orgA', integrationKey: 'google-workspace', actionName: 'list_emails', args: {} }, depsWith(apiHttp.http));
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ messages: [{ id: 'm1' }] });
    expect(apiHttp.calls.some((u) => u.includes('gmail.googleapis.com'))).toBe(true);
  });

  it('returns not_connected (engine → awaiting_integration) when the org has no connection', async () => {
    const res = await callPlatformIntegration({ orgId: 'orgB', integrationKey: 'google-workspace', actionName: 'list_emails', args: {} }, depsWith(makeHttp().http));
    expect(res.success).toBe(false);
    expect(res.code).toBe('not_connected');
    expect(res.error).toMatch(/not connected/i);
  });

  it('rejects an unknown platform integration key', async () => {
    const res = await callPlatformIntegration({ orgId: 'orgA', integrationKey: 'dropbox', actionName: 'x', args: {} }, depsWith(makeHttp().http));
    expect(res.code).toBe('unknown_integration');
  });
});

describe('callback page rendering', () => {
  it('renders an HTML page that postMessages the result and leaks no token/email', () => {
    const html = renderCallbackPage('google', true);
    expect(html).toContain('oauth-callback');
    expect(html).toContain('"provider":"google"');
    expect(html).toContain('"success":true');
    expect(html).not.toContain('atk-1');
    // A non-alphanumeric provider is sanitised.
    expect(renderCallbackPage('<script>', false)).toContain('"provider":"unknown"');
  });
});
