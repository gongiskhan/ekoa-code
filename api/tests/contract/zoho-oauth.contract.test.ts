import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs } from '../../src/data/stores.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { signToken } from '../../src/auth/jwt.js';
import { ZohoOAuthConnectResponse, ErrorEnvelope } from '@ekoa/shared';
import { envelopeDecrypt } from '../../src/data/crypto.js';
import type { IntegrationConfigDoc } from '../../src/integrations/service.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';

/**
 * CONTRACT: `POST /api/v1/integrations/zoho-sign/oauth/connect` + the public callback it pairs
 * with. Drives the REAL app, so the mount, the admin gate, the response schema and the callback's
 * effect on the stored bundle are all asserted end to end - upstream has no test of either route,
 * which is how its credential-clearing regression reached a customer.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
const deps = { now: () => 1_700_000_000_000, genId: () => `id_${++seq}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const tokenFor = (role: 'user' | 'org-admin') =>
  signToken({ sub: role === 'org-admin' ? 'admin1' : 'user1', role, scope: '', orgId: 'orgA', username: role }).token;

const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, init);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  process.env.ZOHO_CLIENT_ID = 'env-client-id';
  process.env.ZOHO_CLIENT_SECRET = 'env-client-secret';
  process.env.ZOHO_DC = 'eu';
  process.env.ZOHO_OAUTH_REDIRECT_BASE_URL = 'http://localhost:5903';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_zoho_oauth');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
  for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_DC', 'ZOHO_OAUTH_REDIRECT_BASE_URL']) delete process.env[k];
});

beforeEach(async () => {
  await integrationConfigs.deleteMany({});
  // requireAuth admits only subjects present in the activation map.
  __resetActivationForTests();
  setActivation('admin1', { active: true, billingLocked: false });
  setActivation('user1', { active: true, billingLocked: false });
});

describe('POST /api/v1/integrations/zoho-sign/oauth/connect', () => {
  it('an org-admin gets a schema-valid authorize URL, and a pending state is stamped on a row', async () => {
    const res = await api('/api/v1/integrations/zoho-sign/oauth/connect', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenFor('org-admin')}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ZohoOAuthConnectResponse.safeParse(body).success).toBe(true);

    const url = new URL((body as { authUrl: string }).authUrl);
    expect(url.origin).toBe('https://accounts.zoho.eu');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5903/api/v1/oauth/zoho/callback');
    expect(url.searchParams.get('state')).toBe((body as { state: string }).state);

    const rows = (await integrationConfigs.find({ integrationKey: 'zoho-sign' })) as IntegrationConfigDoc[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.oauthState).toBe((body as { state: string }).state);
    // A row created by a connect is NOT yet usable: only a completed callback turns it on, so an
    // abandoned popup never leaves an integration looking connected.
    expect(rows[0]!.enabled).toBe(false);
    expect(rows[0]!.credentialsCiphertext).toBeUndefined();
    // The state must expire; a pending consent is not a permanent key to the row.
    expect(typeof rows[0]!.oauthStateExpiresAt).toBe('number');
  });

  it('refuses a plain user (org-admin only) and writes nothing', async () => {
    const res = await api('/api/v1/integrations/zoho-sign/oauth/connect', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenFor('user')}` },
    });
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    expect(await integrationConfigs.find({ integrationKey: 'zoho-sign' })).toHaveLength(0);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await api('/api/v1/integrations/zoho-sign/oauth/connect', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it('reuses the same row on a second connect rather than forking one per click', async () => {
    const first = await (await api('/api/v1/integrations/zoho-sign/oauth/connect', { method: 'POST', headers: { authorization: `Bearer ${tokenFor('org-admin')}` } })).json();
    const second = await (await api('/api/v1/integrations/zoho-sign/oauth/connect', { method: 'POST', headers: { authorization: `Bearer ${tokenFor('org-admin')}` } })).json();
    const rows = (await integrationConfigs.find({ integrationKey: 'zoho-sign' })) as IntegrationConfigDoc[];
    expect(rows).toHaveLength(1);
    // The newest click wins; the superseded state must no longer be accepted.
    expect(rows[0]!.oauthState).toBe((second as { state: string }).state);
    expect(rows[0]!.oauthState).not.toBe((first as { state: string }).state);
  });
});

describe('GET /api/v1/oauth/zoho/callback (public provider redirect)', () => {
  it('an unknown state renders the failure page and writes no credentials', async () => {
    const res = await api('/api/v1/oauth/zoho/callback?code=c&state=nope');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('oauth-callback');
    expect(html).toContain('false');
    const rows = (await integrationConfigs.find({ integrationKey: 'zoho-sign' })) as IntegrationConfigDoc[];
    expect(rows.every((r) => !r.credentialsCiphertext)).toBe(true);
  });

  it('a provider error string cannot inject markup into the result page', async () => {
    // `error` is reflected from an UNAUTHENTICATED redirect, so this is the reachable XSS surface.
    const res = await api(`/api/v1/oauth/zoho/callback?error=${encodeURIComponent('</script><img src=x onerror=alert(1)>')}`);
    const html = await res.text();
    expect(html).not.toContain('<img');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('never 500s: it always answers a page a human can read', async () => {
    const res = await api('/api/v1/oauth/zoho/callback');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Voltar às integrações');
  });
});

describe('the connected bundle (what makes the token mintable)', () => {
  it('a completed grant stores refresh_token + dc and REMOVES the pasted client credentials', async () => {
    // Seed the state of a workspace that previously pasted Self Client credentials - the exact
    // situation that produced a connect which "succeeded" and could never mint a token.
    const connect = await (await api('/api/v1/integrations/zoho-sign/oauth/connect', {
      method: 'POST', headers: { authorization: `Bearer ${tokenFor('org-admin')}` },
    })).json() as { state: string };
    const row = ((await integrationConfigs.find({ integrationKey: 'zoho-sign' })) as IntegrationConfigDoc[])[0]!;
    const { envelopeEncrypt } = await import('../../src/data/crypto.js');
    const seeded = await envelopeEncrypt(JSON.stringify({ client_id: 'pasted-id', client_secret: 'pasted-secret', grant_code: 'gc-old', dc: 'com' }), 'orgA');
    await integrationConfigs.update(row._id, (cur) => ({ ...cur, credentialsCiphertext: seeded }));

    // Drive the callback with a stubbed Zoho token endpoint.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('accounts.zoho.')) {
        return new Response(JSON.stringify({ refresh_token: 'rt-fresh' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return realFetch(input as never, init);
    }) as typeof fetch;
    try {
      const res = await api(`/api/v1/oauth/zoho/callback?code=c&state=${encodeURIComponent(connect.state)}&location=eu`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('true');
    } finally {
      globalThis.fetch = realFetch;
    }

    const after = (await integrationConfigs.get(row._id)) as IntegrationConfigDoc;
    expect(after.enabled).toBe(true);
    expect(after.oauthState).toBeFalsy();
    expect(after.needsReauth).toBe(false);
    const bundle = JSON.parse(await envelopeDecrypt(after.credentialsCiphertext!, 'orgA')) as Record<string, unknown>;
    expect(bundle.refresh_token).toBe('rt-fresh');
    expect(bundle.dc).toBe('eu');
    expect(bundle.auth_type).toBe('oauth2');
    // THE REGRESSION: a surviving pasted pair would shadow the platform client and every refresh
    // of this platform-minted token would come back `invalid_code`.
    expect('client_id' in bundle).toBe(false);
    expect('client_secret' in bundle).toBe(false);
    expect('grant_code' in bundle).toBe(false);
  });
});
