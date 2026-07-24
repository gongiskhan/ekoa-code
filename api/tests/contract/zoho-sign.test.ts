/**
 * Zoho Sign served-app proxy (integrations/zoho-sign.ts, 2B-S2) — router contract.
 *
 * Mounts the REAL `zohoSignRouter` over a LIVE backend built from test-double deps
 * (getOwnerOrgId / findConfigForOwner / identity-decrypt / a stub renderHtmlToPdf),
 * with the part-1 token core pointed at an inline capturing Zoho mock via the
 * ZOHO_*_BASE_OVERRIDE seams. Proves:
 *   - the X-Ekoa-App-Id gate (missing → 400, unknown → 404, bad charset → 400),
 *   - the owner-scoped create→submit happy path + status/sign-url/document reads,
 *     with every 2xx body validated against the shared `shared/` schemas,
 *   - the not-connected owner → 409 { error:'not_connected' },
 *   - the public webhook echo (GET/POST → { ok:true }, POST dispatches onWebhook),
 *   - the /return bounce guard (ekoa.io + OAUTH_REDIRECT_BASE_URL origin only).
 *
 * Hermetic: no real Zoho, no mongo, no browser. Mirrors the legal-plane contract
 * harness (mount the router over an in-process app) + the token-test inline mock.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Buffer } from 'node:buffer';
import express from 'express';
import type { Server } from 'node:http';
import {
  zohoSignRouter,
  makeZohoSignBackend,
  notConnectedZohoBackend,
  __resetZohoTokenCache,
  type ZohoSignConfigRow,
} from '../../src/integrations/zoho-sign.js';
import {
  ZohoSendResponse,
  ZohoStatusResponse,
  ZohoSignUrlResponse,
  ZohoRequestResponse,
  servedAppEndpoints,
} from '@ekoa/shared';

// ----------------------------------------------------------------------------
// Inline capturing Zoho mock (accounts token host + sign API host on one server)
// ----------------------------------------------------------------------------
const CID = '1000.MOCKCID';
const SECRET = 'mocksecret';
const captured = { create: [] as unknown[], submit: [] as unknown[], embedtoken: [] as unknown[] };
const requests = new Map<string, Record<string, unknown>>();
let reqSeq = 90000;
const accessTokens = new Set<string>();

let mock: http.Server;
let mockUrl: string;
let server: Server;
let port: number;
const webhookSeen: unknown[] = [];

function j(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
/** Minimal multipart parser: { name: utf8-string }. */
function parseMultipart(buf: Buffer, contentType: string | undefined): Record<string, string> {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = m && (m[1] || m[2]);
  if (!boundary) return {};
  const raw = buf.toString('latin1');
  const parts: Record<string, string> = {};
  for (const seg of raw.split(`--${boundary}`).slice(1, -1)) {
    const headerEnd = seg.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = seg.slice(0, headerEnd);
    let content = seg.slice(headerEnd + 4);
    if (content.endsWith('\r\n')) content = content.slice(0, -2);
    const nameMatch = /name="([^"]+)"/.exec(headers);
    if (!nameMatch) continue;
    parts[nameMatch[1] as string] = Buffer.from(content, 'latin1').toString('utf8');
  }
  return parts;
}

beforeAll(async () => {
  mock = http.createServer(async (req, res) => {
    const url = new URL(req.url || '', 'http://localhost');
    const body = await readBody(req);
    const auth = req.headers.authorization || '';

    if (req.method === 'POST' && url.pathname === '/oauth/v2/token') {
      const p = new URLSearchParams(body.toString());
      if (p.get('client_id') !== CID || p.get('client_secret') !== SECRET) return j(res, 200, { error: 'invalid_client' });
      if (p.get('grant_type') === 'refresh_token') {
        const at = `1000.at-${Math.random().toString(36).slice(2)}`;
        accessTokens.add(at);
        return j(res, 200, { access_token: at, expires_in: 3600 });
      }
      return j(res, 200, { error: 'unsupported_grant_type' });
    }

    // Sign API: require a valid Zoho-oauthtoken.
    if (!auth.startsWith('Zoho-oauthtoken ') || !accessTokens.has(auth.slice('Zoho-oauthtoken '.length)))
      return j(res, 401, { code: 4003, message: 'Invalid OAuth token', status: 'failure' });

    if (req.method === 'POST' && url.pathname === '/api/v1/requests') {
      const parts = parseMultipart(body, req.headers['content-type']);
      let data: { requests?: { request_name?: string; actions?: Array<Record<string, unknown>> } } = {};
      try {
        data = JSON.parse(parts.data || '{}');
      } catch {
        /* leave {} */
      }
      captured.create.push({ hasFile: Object.prototype.hasOwnProperty.call(parts, 'file'), data });
      const id = String(++reqSeq);
      const inActions = Array.isArray(data?.requests?.actions) ? data.requests!.actions! : [];
      const actions = inActions.map((a, i) => ({
        action_id: `A-${id}-${i}`,
        recipient_email: a.recipient_email,
        recipient_name: a.recipient_name,
        action_type: a.action_type || 'SIGN',
        action_status: 'NOACTION',
      }));
      const record = {
        request_id: id,
        request_name: data?.requests?.request_name || 'Sem nome',
        request_status: 'draft',
        document_ids: [{ document_id: `D-${id}`, total_pages: 2, document_name: `${id}.pdf` }],
        actions,
      };
      requests.set(id, record);
      return j(res, 200, { code: 0, status: 'success', requests: record });
    }

    const mm = url.pathname.match(/^\/api\/v1\/requests\/([^/]+)(?:\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?)?$/);
    if (mm) {
      const r = requests.get(mm[1] as string);
      if (!r) return j(res, 400, { code: 4066, message: 'Invalid request id', status: 'failure' });
      if (req.method === 'POST' && mm[2] === 'submit') {
        const parts = parseMultipart(body, req.headers['content-type']);
        let data = {};
        try {
          data = JSON.parse(parts.data || '{}');
        } catch {
          /* leave {} */
        }
        captured.submit.push({ id: mm[1], data });
        r.request_status = 'inprogress';
        return j(res, 200, { code: 0, status: 'success', requests: r });
      }
      if (req.method === 'POST' && mm[2] === 'actions' && mm[4] === 'embedtoken') {
        captured.embedtoken.push({ id: mm[1], actionId: mm[3] });
        return j(res, 200, { code: 0, status: 'success', sign_url: `https://sign.zoho.eu/portal/${mm[1]}/${mm[3]}` });
      }
      if (req.method === 'GET' && mm[2] === 'pdf') {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end(Buffer.from('%PDF-1.4 mock signed'));
        return;
      }
      if (req.method === 'GET' && !mm[2]) return j(res, 200, { code: 0, status: 'success', requests: r });
    }
    return j(res, 404, { code: 404, message: 'no mock', status: 'failure' });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  process.env.ZOHO_ACCOUNTS_BASE_OVERRIDE = mockUrl;
  process.env.ZOHO_API_BASE_OVERRIDE = mockUrl;

  const app = express();
  app.use(express.json());
  app.use(
    zohoSignRouter({
      resolveApp: async (h) => {
        if (h === 'app-conn') return { appId: 'app-conn', ownerUserId: 'owner-conn' };
        if (h === 'app-noconn') return { appId: 'app-noconn', ownerUserId: 'owner-noconn' };
        return null;
      },
      onWebhook: async (p) => {
        webhookSeen.push(p);
      },
      backend: makeZohoSignBackend({
        getOwnerOrgId: async () => 'org-1',
        // Only owner-conn has a connected config; identity-decrypt so ciphertext IS the bundle.
        findConfigForOwner: async (_orgId, ownerUserId): Promise<ZohoSignConfigRow | null> =>
          ownerUserId === 'owner-conn'
            ? {
                _id: 'cfg-1',
                enabled: true,
                credentialsCiphertext: JSON.stringify({ client_id: CID, client_secret: SECRET, refresh_token: 'rt-1', dc: 'com' }),
              }
            : null,
        decrypt: (c) => c,
        renderHtmlToPdf: async () => Buffer.from('%PDF-1.4 rendered'),
      }),
    }),
  );
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  delete process.env.ZOHO_ACCOUNTS_BASE_OVERRIDE;
  delete process.env.ZOHO_API_BASE_OVERRIDE;
  server.close();
  await new Promise<void>((r) => mock.close(() => r()));
});

beforeEach(() => {
  captured.create = [];
  captured.submit = [];
  captured.embedtoken = [];
  webhookSeen.length = 0;
  __resetZohoTokenCache();
});

const api = (p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const appApi = (p: string, appId: string, init: RequestInit = {}) =>
  api(p, { ...init, headers: { 'x-ekoa-app-id': appId, ...(init.headers ?? {}) } });

describe('zoho-sign proxy — X-Ekoa-App-Id gate (byte-compat with adobe-sign)', () => {
  it('missing header -> 400; unknown app -> 404; bad charset -> 400', async () => {
    const noHeader = await api('/api/zoho-sign/status');
    expect(noHeader.status).toBe(400);
    expect(await noHeader.json()).toEqual({ error: 'Missing X-Ekoa-App-Id header' });

    const unknown = await appApi('/api/zoho-sign/status', 'no-such-app');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'Unknown app' });

    const bad = await appApi('/api/zoho-sign/status', 'has spaces!');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Invalid X-Ekoa-App-Id header' });
  });
});

describe('zoho-sign proxy — connection status', () => {
  it('connected owner -> { connected:true }; unconnected owner -> { connected:false }', async () => {
    const conn = await appApi('/api/zoho-sign/status', 'app-conn');
    expect(conn.status).toBe(200);
    const connBody = await conn.json();
    expect(connBody).toEqual({ connected: true });
    expect(ZohoStatusResponse.safeParse(connBody).success).toBe(true);

    const noconn = await appApi('/api/zoho-sign/status', 'app-noconn');
    expect(noconn.status).toBe(200);
    expect(await noconn.json()).toEqual({ connected: false });
  });
});

describe('zoho-sign proxy — send/status/sign-url/document (owner-scoped, validated vs shared/)', () => {
  it('create -> submit happy path; body validates against ZohoSendResponse + carries the S2 quirks', async () => {
    const send = await appApi('/api/zoho-sign/send', 'app-conn', {
      method: 'POST',
      body: JSON.stringify({
        documentName: 'Proposta de Honorários',
        html: '<html><body>Assine.</body></html>',
        message: 'Assine, por favor.',
        redirectUrl: 'https://api.ekoa.io/apps/legal-case/#/portal?t=tok123',
        recipients: [
          { email: 'cliente@example.com', name: 'José Cliente', embedded: true },
          { email: 'socio@bsm.pt', name: 'Sócio BSM' },
        ],
      }),
    });
    expect(send.status).toBe(200);
    const body = (await send.json()) as { success: boolean; requestId: string; status: string; signingUrls: Array<{ email: string; signUrl: string | null }> };
    expect(ZohoSendResponse.safeParse(body).success).toBe(true);
    expect(body.success).toBe(true);
    expect(body.status).toBe('inprogress');
    expect(body.signingUrls).toHaveLength(2);
    expect(body.signingUrls.find((u) => u.email === 'cliente@example.com')?.signUrl).toMatch(/locale=pt/);
    expect(body.signingUrls.find((u) => u.email === 'socio@bsm.pt')?.signUrl).toBeNull();

    // The submit body carries a mandatory Signature field on the LAST (0-based) page,
    // abs-box only (no percent width/height). These are the hard-won S2 quirks.
    const submit = captured.submit.at(-1) as { data: { requests: { actions: Array<{ fields: Array<Record<string, unknown>> }> } } };
    const sig = submit.data.requests.actions[0]!.fields[0]!;
    expect(sig.field_type_name).toBe('Signature');
    expect(sig.is_mandatory).toBe(true);
    expect(sig.page_no).toBe(1); // total_pages 2 -> last index 1
    expect(sig.abs_width).toBe(300);
    expect(sig.abs_height).toBe(44);
    expect(sig.width).toBeUndefined();
    expect(sig.height).toBeUndefined();
    // The redirect_pages target is the fragment-free /return bounce (no bare '#').
    const rp = (captured.create.at(-1) as { data: { requests: { redirect_pages?: { sign_completed?: string } } } }).data.requests.redirect_pages;
    expect(rp?.sign_completed).toBe(`https://api.ekoa.io/api/zoho-sign/return?to=${encodeURIComponent('https://api.ekoa.io/apps/legal-case/#/portal?t=tok123')}`);
    expect(rp?.sign_completed).not.toContain('#');
  });

  it('status/sign-url/document reads validate against their shared schemas', async () => {
    const send = await appApi('/api/zoho-sign/send', 'app-conn', {
      method: 'POST',
      body: JSON.stringify({ documentName: 'Doc', pdfBase64: Buffer.from('%PDF-1.4 x').toString('base64'), recipients: [{ email: 'cliente@example.com', embedded: true }] }),
    });
    const { requestId } = (await send.json()) as { requestId: string };

    const req = await appApi(`/api/zoho-sign/requests/${requestId}`, 'app-conn');
    expect(req.status).toBe(200);
    expect(ZohoRequestResponse.safeParse(await req.json()).success).toBe(true);

    const signUrl = await appApi(`/api/zoho-sign/requests/${requestId}/sign-url?email=cliente@example.com`, 'app-conn');
    expect(signUrl.status).toBe(200);
    expect(ZohoSignUrlResponse.safeParse(await signUrl.json()).success).toBe(true);

    const noEmail = await appApi(`/api/zoho-sign/requests/${requestId}/sign-url`, 'app-conn');
    expect(noEmail.status).toBe(400);

    const doc = await appApi(`/api/zoho-sign/requests/${requestId}/document`, 'app-conn');
    expect(doc.status).toBe(200);
    expect(doc.headers.get('content-type')).toContain('application/pdf');
    expect(Buffer.from(await doc.arrayBuffer()).toString('latin1').startsWith('%PDF')).toBe(true);
  });

  it('an unconnected owner -> 409 { error:"not_connected" } on every privileged route', async () => {
    for (const [path, init] of [
      ['/api/zoho-sign/send', { method: 'POST', body: JSON.stringify({ recipients: [{ email: 'a@b.pt' }], pdfBase64: 'eA==' }) }],
      ['/api/zoho-sign/requests/x', {}],
      ['/api/zoho-sign/requests/x/document', {}],
    ] as Array<[string, RequestInit]>) {
      const res = await appApi(path, 'app-noconn', init);
      expect(res.status, path).toBe(409);
      expect(((await res.json()) as { error: string }).error, path).toBe('not_connected');
    }
  });
});

describe('zoho-sign proxy — public webhook + return bounce', () => {
  it('GET/POST webhook -> { ok:true } (validated vs the shared descriptor); POST dispatches onWebhook', async () => {
    const get = await api('/api/zoho-sign/webhook');
    expect(get.status).toBe(200);
    const getBody = await get.json();
    expect(getBody).toEqual({ ok: true });
    expect(servedAppEndpoints.zohoSignWebhookGet!.response!.safeParse(getBody).success).toBe(true);

    const post = await api('/api/zoho-sign/webhook', { method: 'POST', body: JSON.stringify({ requests: { request_id: '90001', request_status: 'completed' } }) });
    expect(post.status).toBe(200);
    const postBody = await post.json();
    expect(postBody).toEqual({ ok: true });
    expect(servedAppEndpoints.zohoSignWebhookPost!.response!.safeParse(postBody).success).toBe(true);
    // async dispatch fires after the ack.
    await new Promise((r) => setTimeout(r, 20));
    expect(webhookSeen).toHaveLength(1);
  });

  it('/return only bounces to ekoa.io (https) or the configured origin; else 400', async () => {
    const ok = await api('/api/zoho-sign/return?to=' + encodeURIComponent('https://api.ekoa.io/apps/x/#/portal'), { redirect: 'manual' });
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toBe('https://api.ekoa.io/apps/x/#/portal');

    const sub = await api('/api/zoho-sign/return?to=' + encodeURIComponent('https://sign.ekoa.io/x'), { redirect: 'manual' });
    expect(sub.status).toBe(302);

    for (const bad of ['https://evil.com/x', 'http://api.ekoa.io/x', 'not-a-url', '']) {
      const res = await api('/api/zoho-sign/return?to=' + encodeURIComponent(bad), { redirect: 'manual' });
      expect(res.status, bad).toBe(400);
      expect(await res.text()).toBe('invalid redirect target');
    }

    // OAUTH_REDIRECT_BASE_URL extends the allowlist to the deployment's own origin.
    process.env.OAUTH_REDIRECT_BASE_URL = 'http://localhost:4111';
    try {
      const dev = await api('/api/zoho-sign/return?to=' + encodeURIComponent('http://localhost:4111/apps/x/#/portal'), { redirect: 'manual' });
      expect(dev.status).toBe(302);
    } finally {
      delete process.env.OAUTH_REDIRECT_BASE_URL;
    }
  });
});

describe('notConnectedZohoBackend — the default (facade) backend', () => {
  it('isConnected is false and every privileged call raises not_connected', async () => {
    expect(await notConnectedZohoBackend.isConnected('u')).toBe(false);
    await expect(notConnectedZohoBackend.sendForSignature({ documentName: 'x', recipients: [] })).rejects.toMatchObject({ code: 'not_connected' });
    await expect(notConnectedZohoBackend.getRequest('u', 'r')).rejects.toMatchObject({ code: 'not_connected' });
    await expect(notConnectedZohoBackend.getSignUrl('u', 'r', 'a@b.pt')).rejects.toMatchObject({ code: 'not_connected' });
    await expect(notConnectedZohoBackend.getDocument('u', 'r')).rejects.toMatchObject({ code: 'not_connected' });
  });
});
