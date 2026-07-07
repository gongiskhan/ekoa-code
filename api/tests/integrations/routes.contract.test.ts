import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
// @ts-expect-error - JS mock helper, no d.ts
import { startMockPipedream } from '../helpers/mock-pipedream-server.mjs';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, integrationConfigs, settings, billingAccounts, tokenEvents } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { platformIntegrationsRouter, oauthCallbackRouter } from '../../src/routes/platform-integrations.js';
import { pipedreamRouter } from '../../src/routes/pipedream.js';
import type { PlatformHttp, PlatformOAuthEnv } from '../../src/integrations/platform-oauth.js';
import {
  PlatformIntegrationListResponse,
  PlatformIntegrationStatusResponse,
  PlatformIntegrationConnectResponse,
  PlatformIntegrationDisconnectResponse,
  PipedreamStatus,
  PipedreamAccountsResponse,
  PipedreamConfigResponse,
  PipedreamConnectTokenResponse,
  OkResponse,
  ErrorEnvelope,
} from '@ekoa/shared';

/**
 * G8 route contract: the platform-integrations + oauth-callback + pipedream routers, mounted on a
 * bare app (the lead mounts them in server.ts), with every JSON response validated against the
 * shared zod schemas and every non-2xx against the error envelope. Provider + Pipedream external
 * HTTP is injected via the routers' seams.
 */
let mem: MongoMemoryServer;
let mock: Awaited<ReturnType<typeof startMockPipedream>>;
let server: Server;
let port: number;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };

const env: PlatformOAuthEnv = {
  google: { clientId: 'gid', clientSecret: 'gsecret', redirectBaseUrl: 'https://app.example' },
  microsoft: { clientId: 'mid', clientSecret: 'msecret', redirectBaseUrl: 'https://app.example', tenantId: 'common' },
};
const fakeOAuthHttp: PlatformHttp = async (url) => {
  const body = url.includes('/token')
    ? { access_token: 'atk', refresh_token: 'rtk', token_type: 'Bearer', expires_in: 3600, scope: 'openid email' }
    : { email: 'user@acme.pt' };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { forEach: () => undefined } } as unknown as Response;
};

async function mkUser(id: string, username: string, orgId: string, role: 'super-admin' | 'org-admin' | 'builder') {
  await users.insert({ _id: id, username, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_introutes');
  mock = await startMockPipedream();

  const app = express();
  app.use(express.json());
  const routerDeps = { ...deps, oauth: { http: fakeOAuthHttp, env }, pipedream: { baseUrl: mock.url, fetchImpl: (u: string, i: { method?: string; headers?: Record<string, string>; body?: string }) => fetch(u, i as RequestInit) } };
  app.use('/api/v1/platform-integrations', platformIntegrationsRouter(routerDeps));
  app.use('/api/v1/oauth', oauthCallbackRouter(routerDeps));
  app.use('/api/v1/pipedream', pipedreamRouter(routerDeps));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await mock.close();
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  mock.reset();
  for (const s of [users, integrationConfigs, settings, billingAccounts, tokenEvents]) await s.deleteMany({});
});

describe('platform-integrations routes (ch03 §3.8.15)', () => {
  it('GET /platform-integrations lists providers (user)', async () => {
    await mkUser('u1', 'u1', 'orgA', 'builder');
    const res = await api('/api/v1/platform-integrations', await tokenFor('u1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(PlatformIntegrationListResponse.safeParse(body).success).toBe(true);
    expect((body as { items: unknown[] }).items).toHaveLength(2);
  });

  it('POST /:provider/connect is org-admin only', async () => {
    await mkUser('adm', 'adm', 'orgA', 'org-admin');
    await mkUser('bld', 'bld', 'orgA', 'builder');

    const forb = await api('/api/v1/platform-integrations/google/connect', await tokenFor('bld'), { method: 'POST' });
    expect(forb.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await forb.json()).success).toBe(true);

    const ok = await api('/api/v1/platform-integrations/google/connect', await tokenFor('adm'), { method: 'POST' });
    expect(ok.status).toBe(200);
    expect(PlatformIntegrationConnectResponse.safeParse(await ok.json()).success).toBe(true);
  });

  it('GET /:provider status validates; an unknown provider is a 400 envelope', async () => {
    await mkUser('u1', 'u1', 'orgA', 'builder');
    const t = await tokenFor('u1');
    const ok = await api('/api/v1/platform-integrations/google', t);
    expect(ok.status).toBe(200);
    expect(PlatformIntegrationStatusResponse.safeParse(await ok.json()).success).toBe(true);

    const bad = await api('/api/v1/platform-integrations/dropbox', t);
    expect(bad.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await bad.json()).success).toBe(true);
  });

  it('full flow: connect → GET /oauth/:provider/callback (HTML) → status connected → disconnect', async () => {
    await mkUser('adm', 'adm', 'orgA', 'org-admin');
    const t = await tokenFor('adm');
    const connect = (await (await api('/api/v1/platform-integrations/google/connect', t, { method: 'POST' })).json()) as { state: string };

    // Public callback — no auth header — returns an HTML page.
    const cb = await fetch(`http://127.0.0.1:${port}/api/v1/oauth/google/callback?code=abc&state=${connect.state}`);
    expect(cb.status).toBe(200);
    expect(cb.headers.get('content-type')).toMatch(/text\/html/);
    expect(await cb.text()).toContain('oauth-callback');

    const status = (await (await api('/api/v1/platform-integrations/google', t)).json()) as { connected: boolean; email?: string };
    expect(status.connected).toBe(true);
    expect(status.email).toBe('user@acme.pt');

    const del = await api('/api/v1/platform-integrations/google', t, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(PlatformIntegrationDisconnectResponse.safeParse(await del.json()).success).toBe(true);
  });
});

describe('pipedream routes (ch03 §3.8.16)', () => {
  it('GET /pipedream status (user)', async () => {
    await mkUser('u1', 'u1', 'orgA', 'builder');
    const res = await api('/api/v1/pipedream', await tokenFor('u1'));
    expect(res.status).toBe(200);
    expect(PipedreamStatus.safeParse(await res.json()).success).toBe(true);
  });

  it('PUT /pipedream/config is org-admin only; then accounts + connect-token + disconnect + remove', async () => {
    await mkUser('adm', 'adm', 'orgA', 'org-admin');
    await mkUser('bld', 'bld', 'orgA', 'builder');
    const admT = await tokenFor('adm');

    const forb = await api('/api/v1/pipedream/config', await tokenFor('bld'), { method: 'PUT', body: JSON.stringify({ clientId: 'c', clientSecret: 's', projectId: 'p', environment: 'production' }) });
    expect(forb.status).toBe(403);

    const bad = await api('/api/v1/pipedream/config', admT, { method: 'PUT', body: JSON.stringify({ clientId: 'c' }) });
    expect(bad.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await bad.json()).success).toBe(true);

    const cfg = await api('/api/v1/pipedream/config', admT, { method: 'PUT', body: JSON.stringify({ clientId: 'cid', clientSecret: 'csecret', projectId: 'proj_1', environment: 'production' }) });
    expect(cfg.status).toBe(200);
    expect(PipedreamConfigResponse.safeParse(await cfg.json()).success).toBe(true);

    const bldT = await tokenFor('bld');
    const accounts = await api('/api/v1/pipedream/accounts', bldT);
    expect(accounts.status).toBe(200);
    expect(PipedreamAccountsResponse.safeParse(await accounts.json()).success).toBe(true);

    const tok = await api('/api/v1/pipedream/connect-token', bldT, { method: 'POST' });
    expect(tok.status).toBe(200);
    expect(PipedreamConnectTokenResponse.safeParse(await tok.json()).success).toBe(true);

    const disc = await api('/api/v1/pipedream/accounts/apn_mock1', bldT, { method: 'DELETE' });
    expect(disc.status).toBe(200);
    expect(OkResponse.safeParse(await disc.json()).success).toBe(true);

    const rem = await api('/api/v1/pipedream/config', admT, { method: 'DELETE' });
    expect(rem.status).toBe(200);
    expect(OkResponse.safeParse(await rem.json()).success).toBe(true);
  });
});
