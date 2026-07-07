import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { CollectionsEngine, appScope } from '../../src/data/collections-engine.js';
import { appSsoRouter } from '../../src/integrations/app-sso.js';
import { m365ProxyRouter } from '../../src/integrations/m365-proxy.js';
import { appCloudFilesRouter, type CloudFilesStatus } from '../../src/integrations/app-cloud-files.js';
import {
  pendingAppAuth,
  consumePendingAppAuth,
  PENDING_AUTH_TTL_MS,
} from '../../src/integrations/app-sso-sessions.js';
import type { ResolvedAppScope } from '../../src/integrations/app-scope.js';

/**
 * G6 S5: the served-app AUTH + CLOUD planes (ch03 §3.9, FIXED-9). The routers take injected
 * seams (integrations/ may not import apps/ or auth/), so we mount them on a bare express app
 * with stub resolveAppScope / token / status providers - the app RESOLUTION, workspace token,
 * and cloud status are exactly what server.ts wires. Microsoft's external IdP call cannot run
 * here, so the SSO redirect/state issuance + single-use consumption are exercised at the store
 * boundary; the m365 upstream is intercepted.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
// Real wall-clock time: session + pending-auth expiry are checked against Date.now() in the
// store, so a frozen past clock would mint records that are already expired.
const deps = { now: () => Date.now(), genId: () => `id_${seq++}` };

// Injected app resolution: canonical id + owner + served/opt-in facts.
const APPS: Record<string, ResolvedAppScope> = {
  app1: { appId: 'app1', ownerUserId: 'owner1', isServed: true, m365Proxy: true },
  slug1: { appId: 'app1', ownerUserId: 'owner1', isServed: true, m365Proxy: true },
  served0: { appId: 'served0', ownerUserId: 'owner1', isServed: true, m365Proxy: false },
  unserved: { appId: 'unserved', ownerUserId: 'owner1', isServed: false, m365Proxy: true },
  dead: { appId: 'dead', ownerUserId: 'ownerDead', isServed: true, m365Proxy: true },
};
const resolveAppScope = async (idOrSlug: string): Promise<ResolvedAppScope | null> => APPS[idOrSlug] ?? null;

let cloudStatus: CloudFilesStatus = {
  google: { connected: false, needsReauth: false },
  microsoft: { connected: false, needsReauth: false },
};
let workspaceToken: string | null = 'workspace-tok';

const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, init);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_appsso');

  const app = express();
  app.use('/api/app-sso', appSsoRouter({ ...deps, resolveAppScope, crossSite: false }));
  app.use('/api/m365', m365ProxyRouter({
    resolveAppScope,
    getWorkspaceGraphToken: async () => {
      if (!workspaceToken) throw new Error('microsoft integration not connected');
      return workspaceToken;
    },
    verifyToken: (t: string) => {
      if (t === 'good') return { sub: 'owner1' };
      throw new Error('bad token');
    },
  }));
  app.use('/api/app-cloud-files', appCloudFilesRouter({
    resolveAppScope,
    getStatus: async () => cloudStatus,
    getAccessToken: async () => { throw new Error('microsoft not connected'); },
  }));

  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  setActivation('owner1', { active: true, billingLocked: false });
  setActivation('ownerDead', { active: false, billingLocked: false });
  await getDb().collection('app_data').deleteMany({});
  await getDb().collection('app_sessions').deleteMany({});
  await getDb().collection('app_sso_pending').deleteMany({});
});

/** Seed a user row into the app's own app-data collection (the password auth surface). */
async function seedUser(appId: string, u: { email: string; password: string; name?: string; role?: string }) {
  const engine = new CollectionsEngine(deps);
  const hash = await bcrypt.hash(u.password, 12);
  await engine.create(appScope(appId), 'utilizadores', { email: u.email, passwordHash: hash, name: u.name, role: u.role });
}

const loginBody = (identity: string, password: string) =>
  JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity, password });

async function login(appId: string, identity: string, password: string) {
  return api('/api/app-sso/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ekoa-app-id': appId },
    body: loginBody(identity, password),
  });
}
function cookieFrom(res: Response): string {
  const sc = res.headers.get('set-cookie') || '';
  return sc.split(';')[0] as string;
}

describe('app-sso password auth: cookie mint, whoami, wrong password', () => {
  beforeEach(async () => { await seedUser('app1', { email: 'ana@lex.pt', password: 'segredo123', name: 'Ana', role: 'master' }); });

  it('login mints the per-app HttpOnly cookie (name, Path, HttpOnly) and returns the identity', async () => {
    const res = await login('app1', 'ana@lex.pt', 'segredo123');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { email: 'ana@lex.pt', name: 'Ana' } });
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('ekoa_app_sso_app1=');
    expect(setCookie).toContain('Path=/api/app-sso');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax'); // crossSite:false in this harness
  });

  it('whoami returns the session identity with the cookie, and 401 without it', async () => {
    const res = await login('app1', 'ana@lex.pt', 'segredo123');
    const cookie = cookieFrom(res);
    const me = await api('/api/app-sso/me', { headers: { 'x-ekoa-app-id': 'app1', cookie } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { success: boolean; data: { email: string; canSendMail: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('ana@lex.pt');
    expect(body.data.canSendMail).toBe(false);

    const signedOut = await api('/api/app-sso/me', { headers: { 'x-ekoa-app-id': 'app1' } });
    expect(signedOut.status).toBe(401);
  });

  it('wrong password → 401 invalid_credentials (and no cookie)', async () => {
    const res = await login('app1', 'ana@lex.pt', 'errado');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'invalid_credentials' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('logout deletes the session + clears the cookie (Max-Age=0); whoami then 401', async () => {
    const cookie = cookieFrom(await login('app1', 'ana@lex.pt', 'segredo123'));
    const out = await api('/api/app-sso/logout', { method: 'POST', headers: { 'x-ekoa-app-id': 'app1', cookie } });
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie') || '').toContain('Max-Age=0');
    const me = await api('/api/app-sso/me', { headers: { 'x-ekoa-app-id': 'app1', cookie } });
    expect(me.status).toBe(401);
  });

  it('deactivated owner → 403 ACCOUNT_DISABLED on login (Amendment 2)', async () => {
    setActivation('owner1', { active: false, billingLocked: false });
    const res = await login('app1', 'ana@lex.pt', 'segredo123');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('app-sso set-password privilege rule (session-bound auth collection)', () => {
  beforeEach(async () => {
    await seedUser('app1', { email: 'chefe@lex.pt', password: 'chefe123', name: 'Chefe', role: 'master' });
    await seedUser('app1', { email: 'ze@lex.pt', password: 'ze123456', name: 'Zé', role: 'user' });
  });

  const setPw = (cookie: string, identity: string, password: string) =>
    api('/api/app-sso/set-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ekoa-app-id': 'app1', cookie },
      body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity, password }),
    });

  it('a user may set their OWN password', async () => {
    const cookie = cookieFrom(await login('app1', 'ze@lex.pt', 'ze123456'));
    const res = await setPw(cookie, 'ze@lex.pt', 'novapass1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // the new password now logs in
    expect((await login('app1', 'ze@lex.pt', 'novapass1')).status).toBe(200);
  });

  it("a privileged (master) caller may set ANOTHER user's password", async () => {
    const cookie = cookieFrom(await login('app1', 'chefe@lex.pt', 'chefe123'));
    expect((await setPw(cookie, 'ze@lex.pt', 'resetpass')).status).toBe(200);
  });

  it("a non-privileged caller may NOT set another user's password → 403", async () => {
    const cookie = cookieFrom(await login('app1', 'ze@lex.pt', 'ze123456'));
    const res = await setPw(cookie, 'chefe@lex.pt', 'hijack01');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('forbidden');
  });

  it('set-password without a session → 401 not_authenticated', async () => {
    const res = api('/api/app-sso/set-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ekoa-app-id': 'app1' },
      body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity: 'ze@lex.pt', password: 'x1234567' }),
    });
    expect((await res).status).toBe(401);
  });
});

describe('app-sso microsoft flow: config gate + single-use state', () => {
  it('start with SSO unconfigured → 503 (clear error, never a crash)', async () => {
    const res = await api('/api/app-sso/microsoft/start?appId=app1', { redirect: 'manual' });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('not configured');
  });

  it('a pending-auth state is single-use: the second consumption is refused', async () => {
    const now = deps.now();
    await pendingAppAuth.insert({
      _id: 'state-xyz',
      appId: 'app1',
      nonce: 'n',
      pkceVerifier: 'v',
      returnUrl: '/apps/app1/',
      redirectUri: 'https://x/callback',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PENDING_AUTH_TTL_MS).toISOString(),
    });
    const first = await consumePendingAppAuth('state-xyz');
    expect(first?.appId).toBe('app1');
    const second = await consumePendingAppAuth('state-xyz');
    expect(second).toBeNull();
  });
});

describe('m365 workspace Graph proxy (Q-10 gate + verbatim forward)', () => {
  it('refuses without the header (400), for an unserved app (403), and when not opted in (403)', async () => {
    expect((await api('/api/m365/v1.0/me')).status).toBe(400);
    expect((await api('/api/m365/v1.0/me', { headers: { 'x-ekoa-app-id': 'unserved' } })).status).toBe(403);
    expect((await api('/api/m365/v1.0/me', { headers: { 'x-ekoa-app-id': 'served0' } })).status).toBe(403);
  });

  it('deactivated owner → 403 ACCOUNT_DISABLED', async () => {
    const res = await api('/api/m365/v1.0/me', { headers: { 'x-ekoa-app-id': 'dead' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  });

  it('with header + served + opt-in + active owner → forwards verbatim, injecting the workspace token', async () => {
    const realFetch = globalThis.fetch;
    let seenAuth: string | undefined;
    let seenUrl: string | undefined;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://graph.microsoft.com/')) {
        seenUrl = url;
        seenAuth = (init?.headers as Record<string, string> | undefined)?.Authorization;
        return Promise.resolve(new Response(JSON.stringify({ displayName: 'Ana' }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return realFetch(input, init);
    });
    try {
      const res = await api('/api/m365/v1.0/me', { headers: { 'x-ekoa-app-id': 'app1' } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ displayName: 'Ana' });
      expect(seenUrl).toBe('https://graph.microsoft.com/v1.0/me');
      expect(seenAuth).toBe('Bearer workspace-tok');
    } finally {
      spy.mockRestore();
    }
  });

  it('a supplied but invalid JWT → 401 (optional-JWT is still validated when present)', async () => {
    const res = await api('/api/m365/v1.0/me', { headers: { 'x-ekoa-app-id': 'app1', authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('workspace integration not connected → 502', async () => {
    workspaceToken = null;
    try {
      const res = await api('/api/m365/v1.0/me', { headers: { 'x-ekoa-app-id': 'app1' } });
      expect(res.status).toBe(502);
    } finally {
      workspaceToken = 'workspace-tok';
    }
  });
});

describe('cloud-files status (workspace credential never reaches the page)', () => {
  it('status returns the per-provider connected/needsReauth shape with no connection', async () => {
    const res = await api('/api/app-cloud-files/status', { headers: { 'x-ekoa-app-id': 'app1' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { google: { connected: false, needsReauth: false }, microsoft: { connected: false, needsReauth: false } },
    });
  });

  it('reflects a connected provider', async () => {
    cloudStatus = { google: { connected: true, needsReauth: false }, microsoft: { connected: false, needsReauth: true } };
    try {
      const res = await api('/api/app-cloud-files/status', { headers: { 'x-ekoa-app-id': 'app1' } });
      const body = (await res.json()) as { data: CloudFilesStatus };
      expect(body.data.google.connected).toBe(true);
      expect(body.data.microsoft.needsReauth).toBe(true);
    } finally {
      cloudStatus = { google: { connected: false, needsReauth: false }, microsoft: { connected: false, needsReauth: false } };
    }
  });

  it('missing header → 400; deactivated owner → 403 ACCOUNT_DISABLED', async () => {
    expect((await api('/api/app-cloud-files/status')).status).toBe(400);
    const dead = await api('/api/app-cloud-files/status', { headers: { 'x-ekoa-app-id': 'dead' } });
    expect(dead.status).toBe(403);
    expect(((await dead.json()) as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  });
});
