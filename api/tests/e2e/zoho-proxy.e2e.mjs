#!/usr/bin/env node
/**
 * Zoho Sign served-app PROXY — committed, re-runnable driver (2B-S2).
 *
 * Exercises the REAL proxy code in `api/src/integrations/zoho-sign.ts` against a
 * self-launched capturing mock Zoho double. The proxy resolves OWNER credentials
 * from a saved config and drives Zoho's two-step flow, so the genuine assertion —
 * that the SUBMIT body carries a Signature field on the LAST page (0-based), abs-box
 * only — needs a mock that captures what our code sends. We therefore:
 *
 *   1. start a capturing mock Zoho (oauth token + sign API) on an ephemeral port,
 *   2. point the token core at it via ZOHO_*_BASE_OVERRIDE,
 *   3. esbuild-bundle zoho-sign.ts under plain node (every external dep of the proxy
 *      is INJECTED — HTML→PDF, the owner→org lookup, config custody — so the module
 *      pulls in nothing heavy; `express` is marked external and loaded from
 *      node_modules for the Router import the bundle carries),
 *   4. build the backend with test-double deps + assert: create→submit→status happy
 *      path, last-page signature field, embedded-URL minting, not-connected, and
 *      error sanitization (no token/secret ever appears in a thrown message).
 *
 * Fully hermetic — no running api, no mongo, no browser. Run standalone:
 *   node api/tests/e2e/zoho-proxy.e2e.mjs
 * Exit 0 = pass, 1 = fail. (The per-PR-lane hermetic proof of the same surface is the
 * vitest contract test api/tests/contract/zoho-sign.test.ts; this driver is the
 * committed re-runnable operator-run artifact.)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_TS = join(HERE, '..', '..', 'src', 'integrations', 'zoho-sign.ts');

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

// ---------------------------------------------------------------------------
// Capturing mock Zoho double (accounts token + sign API), one process.
// ---------------------------------------------------------------------------

const CLIENT_ID = '1000.MOCKCLIENTID';
const CLIENT_SECRET = 'mocksecret';
const SEED_REFRESH = '1000.rt-seed';

const captured = { create: [], submit: [], embedtoken: [] };
const requests = new Map();
let reqSeq = 90000;
const accessTokens = new Set();

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

/** Minimal multipart/form-data parser: returns { name: utf8-string-value }. */
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = m && (m[1] || m[2]);
  if (!boundary) return {};
  const raw = buf.toString('latin1');
  const parts = {};
  for (const seg of raw.split(`--${boundary}`).slice(1, -1)) {
    const headerEnd = seg.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = seg.slice(0, headerEnd);
    let content = seg.slice(headerEnd + 4);
    if (content.endsWith('\r\n')) content = content.slice(0, -2);
    const nameMatch = /name="([^"]+)"/.exec(headers);
    if (!nameMatch) continue;
    // Recover real UTF-8 from the latin1 read (accents in PT-PT names/notes).
    parts[nameMatch[1]] = Buffer.from(content, 'latin1').toString('utf8');
  }
  return parts;
}

function startMock() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const body = await readBody(req);
    const auth = req.headers.authorization || '';

    // OAuth token endpoint (accounts host).
    if (req.method === 'POST' && url.pathname === '/oauth/v2/token') {
      const p = new URLSearchParams(body.toString());
      if (p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== CLIENT_SECRET)
        return json(res, 200, { error: 'invalid_client' }); // Zoho returns 200 + error body
      if (p.get('grant_type') === 'authorization_code') {
        if (!String(p.get('code') || '').startsWith('1000.mockgrant')) return json(res, 200, { error: 'invalid_code' });
        const at = `1000.at-${crypto.randomBytes(6).toString('hex')}`;
        accessTokens.add(at);
        return json(res, 200, { access_token: at, refresh_token: SEED_REFRESH, expires_in: 3600 });
      }
      if (p.get('grant_type') === 'refresh_token') {
        if (!String(p.get('refresh_token') || '').startsWith('1000.rt')) return json(res, 200, { error: 'invalid_code' });
        const at = `1000.at-${crypto.randomBytes(6).toString('hex')}`;
        accessTokens.add(at);
        return json(res, 200, { access_token: at, expires_in: 3600 });
      }
      return json(res, 200, { error: 'unsupported_grant_type' });
    }

    // Sign API: require a valid Zoho-oauthtoken.
    if (!auth.startsWith('Zoho-oauthtoken ') || !accessTokens.has(auth.slice('Zoho-oauthtoken '.length)))
      return json(res, 401, { code: 4003, message: 'Invalid OAuth token', status: 'failure' });

    // Create draft.
    if (req.method === 'POST' && url.pathname === '/api/v1/requests') {
      const parts = parseMultipart(body, req.headers['content-type']);
      let data = {};
      try { data = JSON.parse(parts.data || '{}'); } catch { /* leave {} */ }
      captured.create.push({ hasFile: Object.prototype.hasOwnProperty.call(parts, 'file'), data });
      const id = String(++reqSeq);
      const inActions = Array.isArray(data?.requests?.actions) ? data.requests.actions : [];
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
      return json(res, 200, { code: 0, status: 'success', requests: record });
    }

    const m = url.pathname.match(/^\/api\/v1\/requests\/([^/]+)(?:\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?)?$/);
    if (m) {
      const r = requests.get(m[1]);
      if (!r) return json(res, 400, { code: 4066, message: 'Invalid request id', status: 'failure' });
      // submit
      if (req.method === 'POST' && m[2] === 'submit') {
        const parts = parseMultipart(body, req.headers['content-type']);
        let data = {};
        try { data = JSON.parse(parts.data || '{}'); } catch { /* leave {} */ }
        captured.submit.push({ id: m[1], data });
        r.request_status = 'inprogress';
        return json(res, 200, { code: 0, status: 'success', requests: r });
      }
      // embedtoken: /api/v1/requests/:id/actions/:actionId/embedtoken
      if (req.method === 'POST' && m[2] === 'actions' && m[4] === 'embedtoken') {
        captured.embedtoken.push({ id: m[1], actionId: m[3] });
        return json(res, 200, { code: 0, status: 'success', sign_url: `https://sign.zoho.eu/portal/${m[1]}/${m[3]}` });
      }
      // signed pdf
      if (req.method === 'GET' && m[2] === 'pdf')
        return (res.writeHead(200, { 'Content-Type': 'application/pdf' }), res.end(Buffer.from('%PDF-1.4 mock signed')));
      // get request
      if (req.method === 'GET' && !m[2]) return json(res, 200, { code: 0, status: 'success', requests: r });
    }

    return json(res, 404, { code: 404, message: `no mock for ${req.method} ${url.pathname}`, status: 'failure' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    const desired = process.env.MOCK_PORT ? Number(process.env.MOCK_PORT) : 0;
    server.listen(desired, '127.0.0.1', () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Bundle the module under plain node (every external dep is INJECTED, so the only
// non-builtin import is express — marked external, loaded from node_modules).
// ---------------------------------------------------------------------------

async function bundleService() {
  const esbuild = await import('esbuild');
  const out = await esbuild.build({
    entryPoints: [SERVICE_TS],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: ['express'],
  });
  // Write the bundle INSIDE the repo tree (not os.tmpdir) so Node resolves the
  // external `express` import from the workspace node_modules. The name is not
  // *.e2e.mjs, so the suite-ledger census never counts this transient file.
  const tmp = join(HERE, `.zoho-sign-bundle-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(tmp, out.outputFiles[0].text);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function messageLeaksSecret(msg, fields) {
  const hay = String(msg || '');
  const needles = [fields.client_secret, fields.refresh_token, fields.grant_code, 'Zoho-oauthtoken', '1000.at-'].filter(Boolean);
  return needles.some((n) => hay.includes(n));
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const server = await startMock();
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
process.env.ZOHO_API_BASE_OVERRIDE = baseUrl;
process.env.ZOHO_ACCOUNTS_BASE_OVERRIDE = baseUrl;
console.log(`[test] capturing mock Zoho on ${baseUrl}`);

let zoho;
try {
  zoho = await bundleService();
  check('module bundles + imports under plain node', !!zoho && typeof zoho.makeZohoSignBackend === 'function');
} catch (err) {
  check('module bundles + imports under plain node', false, err.message);
  server.close();
  process.exit(1);
}

// Test-double deps: identity-decrypt (ciphertext IS the bundle JSON) so the test
// controls the fields; owner 'admin' is connected, any other owner is not; a stub
// HTML→PDF (the real one needs a browser, out of a hermetic driver's scope).
let currentFields = null;
const persisted = [];
const backend = zoho.makeZohoSignBackend({
  getOwnerOrgId: async (ownerUserId) => (ownerUserId === 'admin' ? 'org-1' : null),
  findConfigForOwner: async (_orgId, ownerUserId) =>
    ownerUserId === 'admin' && currentFields
      ? { _id: 'cfg-admin', enabled: true, credentialsCiphertext: JSON.stringify(currentFields) }
      : null,
  decrypt: async (c) => c,
  renderHtmlToPdf: async () => Buffer.from('%PDF-1.4 stub rendered'),
  persistOwnerCredentialUpdates: async (configId, _cur, updates) => { persisted.push({ configId, updates }); },
});

const GOOD_FIELDS = { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: SEED_REFRESH, dc: 'com' };

// --- Case 1: not connected ---------------------------------------------------
currentFields = GOOD_FIELDS;
check('isConnected(owner with config) === true', (await backend.isConnected('admin')) === true);
check('isConnected(unknown owner) === false', (await backend.isConnected('nobody')) === false);
let notConnErr = null;
try {
  await backend.sendForSignature({ ownerUserId: 'nobody', documentName: 'X', pdfBase64: Buffer.from('%PDF-1.4').toString('base64'), recipients: [{ email: 'a@b.pt' }] });
} catch (e) { notConnErr = e; }
check('send for owner with no config throws not_connected', notConnErr?.code === 'not_connected', notConnErr?.message || '');

// --- Case 2: happy path create → submit → status ----------------------------
zoho.__resetZohoTokenCache();
currentFields = GOOD_FIELDS;
const PORTAL_URL = 'https://api.ekoa.io/apps/legal-case-manager-3/#/portal?t=tok123';
// redirect_pages must NOT contain a bare '#' (Zoho error 3007); the hash portal URL
// is wrapped in a fragment-free bounce through /api/zoho-sign/return?to=<encoded>.
const EXPECTED_REDIRECT = 'https://api.ekoa.io/api/zoho-sign/return?to=' + encodeURIComponent(PORTAL_URL);
const sendRes = await backend.sendForSignature({
  ownerUserId: 'admin',
  documentName: 'Proposta de Honorários',
  pdfBase64: Buffer.from('%PDF-1.4 the-proposal').toString('base64'),
  message: 'Assine, por favor.',
  redirectUrl: PORTAL_URL,
  recipients: [
    { email: 'cliente@example.com', name: 'José Cliente', embedded: true },
    { email: 'socio@bsm.pt', name: 'Sócio BSM' },
  ],
});
check('send returns success', sendRes?.success === true);
check('send returns a requestId', !!sendRes?.requestId, `id=${sendRes?.requestId}`);
check('send returns status inprogress', sendRes?.status === 'inprogress', `status=${sendRes?.status}`);
check('signingUrls covers all recipients', Array.isArray(sendRes?.signingUrls) && sendRes.signingUrls.length === 2);
const embedded = sendRes?.signingUrls?.find((u) => u.email === 'cliente@example.com');
const emailed = sendRes?.signingUrls?.find((u) => u.email === 'socio@bsm.pt');
check('embedded recipient gets a signUrl', typeof embedded?.signUrl === 'string' && embedded.signUrl.length > 0, embedded?.signUrl || '');
check('embedded signUrl forces PT locale', /locale=pt/.test(embedded?.signUrl || ''), embedded?.signUrl || '');
check('non-embedded recipient gets null signUrl (Zoho emails)', emailed?.signUrl === null);

// Create body: multipart carried a file + data with actions.
const lastCreate = captured.create.at(-1);
check('create sent a file part (real PDF bytes)', lastCreate?.hasFile === true);
check('create data has request_name + 2 actions', lastCreate?.data?.requests?.request_name === 'Proposta de Honorários' && lastCreate?.data?.requests?.actions?.length === 2);
check('create data sets is_sequential boolean', typeof lastCreate?.data?.requests?.is_sequential === 'boolean');
// Signed-PDF delivery: each signer is emailed the completed PDF. Safe because
// redirect_pages returns the signer to the ERP portal instead of Zoho's download page.
check(
  'create actions all set send_completed_document:true',
  (lastCreate?.data?.requests?.actions || []).length === 2 &&
    (lastCreate?.data?.requests?.actions || []).every((a) => a.send_completed_document === true),
  JSON.stringify((lastCreate?.data?.requests?.actions || []).map((a) => a.send_completed_document)),
);
// Post-sign redirect back to the ERP portal via the fragment-free bounce (no bare '#').
const createRp = lastCreate?.data?.requests?.redirect_pages;
check(
  'create requests carries redirect_pages -> the fragment-free bounce URL',
  createRp?.sign_success === EXPECTED_REDIRECT &&
    createRp?.sign_completed === EXPECTED_REDIRECT &&
    !/#/.test(createRp?.sign_success || ''),
  JSON.stringify(createRp),
);

// Submit body: signature field on the LAST page for each signer.
const lastSubmit = captured.submit.at(-1);
const subActions = lastSubmit?.data?.requests?.actions || [];
const sig = subActions[0]?.fields?.[0];
check('submit carries actions with fields', Array.isArray(subActions) && subActions.length === 2 && Array.isArray(subActions[0]?.fields));
check('submit field is a Signature, mandatory', sig?.field_type_name === 'Signature' && sig?.is_mandatory === true);
// Zoho page_no is 0-BASED: the last page of a 2-page doc is index 1. page_no=2 would be
// one past the end — silently "placed but not viewable", signer stuck.
check('submit signature is on the LAST page (0-based page_no === total_pages-1)', sig?.page_no === 1, `page_no=${sig?.page_no}`);
check('submit sends only the abs box (width/height are percent units in Zoho)', sig?.abs_width === 300 && sig?.abs_height === 44 && sig?.width === undefined && sig?.height === undefined, `w=${sig?.width} h=${sig?.height}`);
check('submit field carries field_label + image category', sig?.field_label === 'Assinatura 1' && sig?.field_category === 'image');
check('submit signature references the document id', typeof sig?.document_id === 'string' && sig.document_id.startsWith('D-'));
check('submit action carries the created action_id', typeof subActions[0]?.action_id === 'string' && subActions[0].action_id.startsWith('A-'));
check(
  'submit actions all re-assert send_completed_document:true',
  subActions.length === 2 && subActions.every((a) => a.send_completed_document === true),
  JSON.stringify(subActions.map((a) => a.send_completed_document)),
);
check(
  'submit requests carries redirect_pages -> the fragment-free bounce URL',
  lastSubmit?.data?.requests?.redirect_pages?.sign_completed === EXPECTED_REDIRECT &&
    !/#/.test(lastSubmit?.data?.requests?.redirect_pages?.sign_completed || ''),
  JSON.stringify(lastSubmit?.data?.requests?.redirect_pages),
);

// --- Case 3: status + document reads ----------------------------------------
const gotReq = await backend.getRequest('admin', sendRes.requestId);
check('getRequest returns the request with status', gotReq?.request_status === 'inprogress', `status=${gotReq?.request_status}`);
const signUrlNow = await backend.getSignUrl('admin', sendRes.requestId, 'cliente@example.com');
check('getSignUrl mints a fresh embedded URL at click time', typeof signUrlNow === 'string' && signUrlNow.length > 0, signUrlNow || '');
const doc = await backend.getDocument('admin', sendRes.requestId);
check('getDocument returns PDF bytes', Buffer.isBuffer(doc?.bytes) && doc.bytes.toString('latin1').startsWith('%PDF'), `ct=${doc?.contentType}`);

// --- Case 4: error sanitization ---------------------------------------------
// 4a. Wrong client secret → token endpoint rejects; message leaks no secret.
zoho.__resetZohoTokenCache();
const BAD_FIELDS = { ...GOOD_FIELDS, client_secret: 'WRONGSECRET', refresh_token: '1000.rt-bad' };
currentFields = BAD_FIELDS;
let badTokenErr = null;
try {
  await backend.sendForSignature({ ownerUserId: 'admin', documentName: 'X', pdfBase64: Buffer.from('%PDF-1.4').toString('base64'), recipients: [{ email: 'a@b.pt' }] });
} catch (e) { badTokenErr = e; }
check('bad-secret send throws', !!badTokenErr, badTokenErr?.message || '');
check('bad-secret error message leaks no secret/token', !!badTokenErr && !messageLeaksSecret(badTokenErr.message, BAD_FIELDS), badTokenErr?.message || '');

// 4b. Valid token but Sign API error (unknown request id) → clean, sanitized message.
zoho.__resetZohoTokenCache();
currentFields = GOOD_FIELDS;
let apiErr = null;
try { await backend.getRequest('admin', 'no-such-id'); } catch (e) { apiErr = e; }
check('unknown request id throws a sanitized ZohoSignError', !!apiErr && !messageLeaksSecret(apiErr.message, GOOD_FIELDS), apiErr?.message || '');
check('sanitized API error surfaces Zoho code, not raw body', /4066/.test(apiErr?.message || '') || /Invalid request id/i.test(apiErr?.message || ''), apiErr?.message || '');

server.close();
console.log(fails.length ? `\n${fails.length} check(s) failed` : `\nall checks passed`);
process.exit(fails.length ? 1 : 0);
