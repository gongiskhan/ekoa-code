/**
 * Zoho Sign OAuth token service (integrations/zoho-sign.ts) + the executor's
 * provider resolver wiring (integrations/action-executor.ts).
 *
 * Hermetic: an in-process node http server stands in for both the Zoho accounts
 * (token) host and the Zoho Sign API host, wired in via the ZOHO_*_BASE_OVERRIDE
 * test seams — no real Zoho traffic. Covers:
 *   (a) grant-code exchange happens once, persists refresh_token + clears
 *       grant_code via ctx.onCredentialUpdate;
 *   (b) subsequent calls refresh + serve from the in-memory cache (no 2nd HTTP);
 *   (c) singleflight: N concurrent getAccessToken → 1 token HTTP call;
 *   (d) the resolved access token drops into a `Zoho-oauthtoken <token>` header;
 *   (e) dc → host mapping (com / eu);
 *   (f) the executor's resolveProviderCredentials('zoho-sign', …) injects
 *       api_base + access_token so the shipped config.json httpConfig resolves.
 *
 * Ported from cortex/tests/zoho/zoho-sign-token.test.ts (import paths + the
 * versioned-package path adapted to ekoa-code's api/assets layout).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  getZohoAccessToken,
  resolveZohoCredentials,
  zohoApiBase,
  zohoAccountsBase,
  __resetZohoTokenCache,
} from '../../src/integrations/zoho-sign.js';
import { resolveProviderCredentials } from '../../src/integrations/action-executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------------------
// In-process Zoho mock (token host + API host on one server)
// ----------------------------------------------------------------------------

interface TokenCall {
  grant_type: string;
  client_id: string;
  client_secret: string;
  code?: string;
  refresh_token?: string;
}

let server: http.Server;
let baseUrl: string;
let tokenCalls: TokenCall[] = [];
let requestsAuthHeaders: string[] = [];
let refreshCounter = 0;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => res(buf));
  });
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = req.url || '';
    if (req.method === 'POST' && url === '/oauth/v2/token') {
      const body = await readBody(req);
      const p = new URLSearchParams(body);
      const call: TokenCall = {
        grant_type: p.get('grant_type') || '',
        client_id: p.get('client_id') || '',
        client_secret: p.get('client_secret') || '',
        code: p.get('code') || undefined,
        refresh_token: p.get('refresh_token') || undefined,
      };
      tokenCalls.push(call);
      res.setHeader('Content-Type', 'application/json');
      if (call.grant_type === 'authorization_code') {
        // A bad/expired grant code surfaces as HTTP 200 { error }.
        if (call.code === 'BAD') {
          res.end(JSON.stringify({ error: 'invalid_code' }));
          return;
        }
        res.end(JSON.stringify({ access_token: 'acc-grant', refresh_token: 'refresh-permanent', expires_in: 3600 }));
        return;
      }
      if (call.grant_type === 'refresh_token') {
        refreshCounter += 1;
        res.end(JSON.stringify({ access_token: `acc-refresh-${refreshCounter}`, expires_in: 3600 }));
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
      return;
    }
    if (req.method === 'GET' && url.startsWith('/api/v1/requests')) {
      requestsAuthHeaders.push(String(req.headers['authorization'] || ''));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ requests: [] }));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  process.env.ZOHO_ACCOUNTS_BASE_OVERRIDE = baseUrl;
  process.env.ZOHO_API_BASE_OVERRIDE = baseUrl;
});

afterAll(async () => {
  delete process.env.ZOHO_ACCOUNTS_BASE_OVERRIDE;
  delete process.env.ZOHO_API_BASE_OVERRIDE;
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  tokenCalls = [];
  requestsAuthHeaders = [];
  refreshCounter = 0;
  __resetZohoTokenCache();
});

const CID = 'cid-123';
const SECRET = 'secret-xyz';

// ----------------------------------------------------------------------------
// (a) grant-code exchange
// ----------------------------------------------------------------------------

describe('getZohoAccessToken — grant-code exchange', () => {
  it('exchanges the grant code once, persisting refresh_token and clearing grant_code', async () => {
    const updates: Record<string, string>[] = [];
    const token = await getZohoAccessToken(
      { client_id: CID, client_secret: SECRET, grant_code: 'grant-1', dc: 'com' },
      { onCredentialUpdate: (u) => { updates.push(u); } },
    );

    expect(token).toBe('acc-grant');
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.grant_type).toBe('authorization_code');
    expect(tokenCalls[0]!.code).toBe('grant-1');
    // The permanent refresh token is reported back, and the one-time code is burned.
    expect(updates).toEqual([{ refresh_token: 'refresh-permanent', grant_code: '' }]);
  });

  it('throws a sanitized error when the grant code is rejected', async () => {
    await expect(
      getZohoAccessToken({ client_id: CID, client_secret: SECRET, grant_code: 'BAD', dc: 'com' }),
    ).rejects.toThrow(/Zoho token request failed \(invalid_code\)/);
  });
});

// ----------------------------------------------------------------------------
// (b) refresh flow + cache
// ----------------------------------------------------------------------------

describe('getZohoAccessToken — refresh + cache', () => {
  it('refreshes from the refresh token, then serves subsequent calls from cache', async () => {
    const fields = { client_id: CID, client_secret: SECRET, refresh_token: 'refresh-permanent', dc: 'com' };

    const t1 = await getZohoAccessToken(fields);
    expect(t1).toBe('acc-refresh-1');
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.grant_type).toBe('refresh_token');
    expect(tokenCalls[0]!.refresh_token).toBe('refresh-permanent');

    // Within TTL: cache hit, no second token call.
    const t2 = await getZohoAccessToken(fields);
    expect(t2).toBe('acc-refresh-1');
    expect(tokenCalls).toHaveLength(1);
  });

  it('errors when neither a grant code nor a refresh token is present', async () => {
    await expect(
      getZohoAccessToken({ client_id: CID, client_secret: SECRET, dc: 'com' }),
    ).rejects.toThrow(/not connected/i);
    expect(tokenCalls).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// (c) singleflight
// ----------------------------------------------------------------------------

describe('getZohoAccessToken — singleflight', () => {
  it('collapses N concurrent refreshes into a single token HTTP call', async () => {
    const fields = { client_id: CID, client_secret: SECRET, refresh_token: 'refresh-permanent', dc: 'com' };
    const [a, b, c, d] = await Promise.all([
      getZohoAccessToken(fields),
      getZohoAccessToken(fields),
      getZohoAccessToken(fields),
      getZohoAccessToken(fields),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(c).toBe(d);
    expect(tokenCalls).toHaveLength(1);
  });
});

// ----------------------------------------------------------------------------
// (d) header format + (e) dc mapping
// ----------------------------------------------------------------------------

describe('resolveZohoCredentials + dc mapping', () => {
  it('resolves api_base + access_token, forming a Zoho-oauthtoken header', async () => {
    const resolved = await resolveZohoCredentials({
      client_id: CID,
      client_secret: SECRET,
      refresh_token: 'refresh-permanent',
      dc: 'com',
    });
    expect(resolved.access_token).toBe('acc-refresh-1');
    expect(resolved.api_base).toBe(baseUrl); // ZOHO_API_BASE_OVERRIDE seam
    const header = `Zoho-oauthtoken ${resolved.access_token}`;
    expect(header).toBe('Zoho-oauthtoken acc-refresh-1');
  });

  it('maps the data center to the correct real hosts (no override)', () => {
    expect(zohoApiBase('com')).toBe('https://sign.zoho.com');
    expect(zohoApiBase('eu')).toBe('https://sign.zoho.eu');
    expect(zohoApiBase('EU ')).toBe('https://sign.zoho.eu'); // trimmed + lowered
    expect(zohoApiBase('bogus')).toBe('https://sign.zoho.com'); // unknown → com
    expect(zohoAccountsBase('com')).toBe('https://accounts.zoho.com');
    expect(zohoAccountsBase('eu')).toBe('https://accounts.zoho.eu');
  });
});

// ----------------------------------------------------------------------------
// (f) executor resolver wiring + config.json template resolution
// ----------------------------------------------------------------------------

/** Minimal mirror of the executor's `{{key}}` interpolation for the assertion. */
function interpolate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

describe('resolveProviderCredentials — zoho-sign', () => {
  it('injects api_base + access_token so the config.json httpConfig template resolves', async () => {
    const computed = await resolveProviderCredentials(
      'zoho-sign',
      { client_id: CID, client_secret: SECRET, refresh_token: 'refresh-permanent', dc: 'com' },
      { ownerUserId: 'user-1', superAdmin: false },
    );
    expect(computed.api_base).toBe(baseUrl);
    expect(computed.access_token).toBe('acc-refresh-1');

    // Load the SHIPPED versioned config and resolve its test_connection template.
    const configPath = resolve(__dirname, '..', '..', 'assets', 'integrations', 'zoho-sign', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      actions: Array<{ actionName: string; httpConfig: { baseUrl: string; path: string; headers: Record<string, string> } }>;
    };
    const action = config.actions.find((a) => a.actionName === 'test_connection')!;
    const vars = computed as Record<string, string>;

    expect(interpolate(action.httpConfig.baseUrl, vars)).toBe(baseUrl);
    expect(interpolate(action.httpConfig.path, vars)).toBe('/api/v1/requests');
    expect(interpolate(action.httpConfig.headers.Authorization!, vars)).toBe('Zoho-oauthtoken acc-refresh-1');
  });

  it('returns {} for an integration key with no registered resolver', async () => {
    const computed = await resolveProviderCredentials('some-random-integration', { foo: 'bar' }, {});
    expect(computed).toEqual({});
  });
});
