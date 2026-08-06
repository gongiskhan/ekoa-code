import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, activityLogs } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import {
  connectPlatform,
  completeCallback,
  type PlatformHttp,
  type PlatformOAuthEnv,
  type OAuthDeps,
} from '../../src/integrations/platform-oauth.js';
import { createWorkspaceCredentials } from '../../src/integrations/workspace-credential.js';

/**
 * The WORKSPACE of a served app is the ORG OF ITS OWNER — never an ambient process-wide
 * connection. These are the tenancy facts the served-app workspace planes rest on
 * (Capability Contract rules 4 + 5): an app reaches its own owner's org connection, an app
 * owned by a different org gets that org's, an org-less or unknown owner gets nothing, and
 * every unavailable case degrades HONESTLY (`not connected`) rather than silently.
 */
let mem: MongoMemoryServer;
let seq = 0;
let clock = 1_700_000_000_000;

const env: PlatformOAuthEnv = {
  google: { clientId: 'gid', clientSecret: 'gsecret', redirectBaseUrl: 'https://app.example' },
  microsoft: { clientId: 'mid', clientSecret: 'msecret', redirectBaseUrl: 'https://app.example', tenantId: 'common' },
};

/** userId → orgId, the injected users lookup. `orphan` exists with no org; `ghost` is absent. */
const ORGS: Record<string, string> = { ownerA: 'orgA', ownerB: 'orgB' };
const resolveOwnerOrgId = async (userId: string) => ORGS[userId] ?? null;

interface FakeRes { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string>; headers: { forEach: () => void } }
function jsonRes(status: number, obj: unknown): FakeRes {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj), headers: { forEach: () => undefined } };
}

/** Provider transport. `token` is the access token minted by an exchange; refreshes mint
 *  `<token>-refreshed` so a refresh is observable. `refreshFails` drives the dead-token path. */
function makeHttp(opts: { token?: string; refreshFails?: boolean } = {}): { http: PlatformHttp; calls: string[] } {
  const calls: string[] = [];
  const token = opts.token ?? 'atk-1';
  const http: PlatformHttp = async (url, init) => {
    calls.push(url);
    if (url.includes('login.microsoftonline.com') || url.includes('oauth2.googleapis.com/token')) {
      const isRefresh = (init?.body ?? '').includes('grant_type=refresh_token');
      if (isRefresh && opts.refreshFails) return jsonRes(400, { error: 'invalid_grant' }) as unknown as Response;
      return jsonRes(200, {
        access_token: isRefresh ? `${token}-refreshed` : token,
        refresh_token: 'rtk-1',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid email',
      }) as unknown as Response;
    }
    if (url.includes('googleapis.com/oauth2/v2/userinfo')) return jsonRes(200, { email: 'user@acme.pt' }) as unknown as Response;
    if (url.endsWith('graph.microsoft.com/v1.0/me')) return jsonRes(200, { mail: 'user@acme.pt' }) as unknown as Response;
    return jsonRes(200, { ok: true }) as unknown as Response;
  };
  return { http, calls };
}

function depsWith(http: PlatformHttp): OAuthDeps {
  return { now: () => clock, genId: () => `id_${seq++}`, http, env };
}

function credentialsWith(http: PlatformHttp) {
  return createWorkspaceCredentials({ resolveOwnerOrgId, oauth: depsWith(http) });
}

/** Complete a real connect→callback so the row under test is the one production reads. */
async function connect(orgId: string, provider: 'google' | 'microsoft', http: PlatformHttp): Promise<void> {
  const actor = { userId: `admin-${orgId}`, orgId, username: `admin-${orgId}` };
  const started = await connectPlatform(actor, provider, depsWith(http));
  if (!started.ok) throw new Error(`connect failed: ${started.code}`);
  const outcome = await completeCallback(provider, { code: 'auth-code', state: started.state }, depsWith(http));
  if (!outcome.ok) throw new Error(`callback failed: ${outcome.reason}`);
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_workspace_cred');
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

describe('workspace credential — the owner’s org is the workspace', () => {
  it('hands the owner org’s Graph token to an app owned by that org', async () => {
    const { http } = makeHttp({ token: 'graph-A' });
    await connect('orgA', 'microsoft', http);
    expect(await credentialsWith(http).graphToken('ownerA')).toBe('graph-A');
  });

  it('two owners in different orgs get their OWN token, never each other’s', async () => {
    const a = makeHttp({ token: 'graph-A' });
    await connect('orgA', 'microsoft', a.http);
    const b = makeHttp({ token: 'graph-B' });
    await connect('orgB', 'microsoft', b.http);
    // Same transport for both reads: only the resolved org may decide which row is read.
    const creds = credentialsWith(a.http);
    expect(await creds.graphToken('ownerA')).toBe('graph-A');
    expect(await creds.graphToken('ownerB')).toBe('graph-B');
  });

  it('refreshes an expired token behind the seam and returns the fresh one', async () => {
    const { http } = makeHttp({ token: 'graph-A' });
    await connect('orgA', 'microsoft', http);
    clock += 2 * 60 * 60 * 1000; // past the 1h expiry
    expect(await credentialsWith(http).graphToken('ownerA')).toBe('graph-A-refreshed');
  });
});

describe('workspace credential — fails closed, and honestly', () => {
  it('an owner whose org has no connection → “not connected”', async () => {
    const { http } = makeHttp();
    await expect(credentialsWith(http).graphToken('ownerA')).rejects.toThrow(/not connected/);
  });

  it('an org-less / unknown owner never reaches a lookup → “not connected”', async () => {
    const { http, calls } = makeHttp({ token: 'graph-A' });
    await connect('orgA', 'microsoft', http);
    const before = calls.length;
    await expect(credentialsWith(http).graphToken('ghost')).rejects.toThrow(/not connected/);
    expect(calls.length).toBe(before); // no provider traffic on behalf of a non-tenant
  });

  it('an EMPTY ownerUserId (an unregistered served app) resolves nobody', async () => {
    const { http } = makeHttp({ token: 'graph-A' });
    await connect('orgA', 'microsoft', http);
    await expect(credentialsWith(http).graphToken('')).rejects.toThrow(/not connected/);
  });

  it('a dead refresh token surfaces as needing a reconnect, and status says so', async () => {
    const live = makeHttp({ token: 'graph-A' });
    await connect('orgA', 'microsoft', live.http);
    clock += 2 * 60 * 60 * 1000;
    const dead = makeHttp({ refreshFails: true });
    const creds = credentialsWith(dead.http);
    await expect(creds.graphToken('ownerA')).rejects.toThrow(/reconnect required/);
    expect((await creds.status('ownerA')).microsoft).toEqual({ connected: false, needsReauth: true });
  });

  it('never leaks a token through the error message', async () => {
    const { http } = makeHttp({ token: 'super-secret-token' });
    await connect('orgA', 'microsoft', http);
    clock += 2 * 60 * 60 * 1000;
    const dead = makeHttp({ refreshFails: true });
    await credentialsWith(dead.http).graphToken('ownerA').catch((err: Error) => {
      expect(err.message).not.toContain('super-secret-token');
      expect(err.message).not.toContain('rtk-1');
    });
  });
});

describe('workspace credential — status is per provider and never throws', () => {
  it('reports each provider independently for the owner’s org', async () => {
    const { http } = makeHttp({ token: 'graph-A' });
    await connect('orgA', 'google', http);
    const status = await credentialsWith(http).status('ownerA');
    expect(status.google).toEqual({ connected: true, needsReauth: false });
    expect(status.microsoft).toEqual({ connected: false, needsReauth: false });
  });

  it('an unknown owner gets a not-connected status rather than an exception', async () => {
    const { http } = makeHttp();
    await expect(credentialsWith(http).status('ghost')).resolves.toEqual({
      google: { connected: false, needsReauth: false },
      microsoft: { connected: false, needsReauth: false },
    });
  });

  it('accessToken serves the cloud-files plane for both providers', async () => {
    const { http } = makeHttp({ token: 'drive-A' });
    await connect('orgA', 'google', http);
    const creds = credentialsWith(http);
    expect(await creds.accessToken('google', 'ownerA')).toBe('drive-A');
    await expect(creds.accessToken('microsoft', 'ownerA')).rejects.toThrow(/not connected/);
  });
});
