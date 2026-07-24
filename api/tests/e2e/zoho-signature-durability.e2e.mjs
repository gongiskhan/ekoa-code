#!/usr/bin/env node
/**
 * Zoho signature-chain + webhook-durability probe — committed, re-runnable driver (2B-S6).
 *
 * The CONSOLIDATED hermetic proof that the Zoho e-signature chain holds end-to-end AND
 * that the public, credential-free inbound webhook is durable under replay / forgery /
 * genuine concurrency. It exercises the REAL code in api/src/integrations/zoho-sign.ts
 * (makeZohoSignBackend + zohoSignRouter + handleZohoWebhook) against ONE self-launched
 * capturing mock Zoho double — the mock is the single source of truth for signature
 * state, exactly as production Zoho is. No running api, no mongo, no browser.
 *
 * It proves, in one wired flow:
 *   A. SEND CHAIN — HTML→PDF render, a mandatory Signature field on the LAST page
 *      (0-based page_no === total_pages-1, abs box only), an embedded signing URL minted
 *      with PT (pt) locale, and the post-sign redirect_pages pointed at the fragment-free
 *      /api/zoho-sign/return bounce (Zoho rejects a bare '#').
 *   B. /return BOUNCE HOST GUARD — the exact bounce `to` the send chain minted is 302'd
 *      back to the ekoa.io portal URL; a non-ekoa host, a non-https ekoa host, and a
 *      malformed target are all refused 400 (never an open redirector).
 *   C. WEBHOOK IDEMPOTENCE — a genuine completion (the mock says the client SIGNED) delivered
 *      twice advances the proposta to 'Assinada' EXACTLY ONCE; the replay is a no-op.
 *   D. WEBHOOK FORGERY-PROOF — a forged 'completed' payload whose owner-scoped re-fetch does
 *      NOT confirm the client signed does NOT advance; an unknown requestId is never
 *      re-fetched and never advances.
 *   E. CONCURRENT DOUBLE-DELIVERY (the TOCTOU carry-forward from 2B-S3) — two genuinely
 *      concurrent completion deliveries for the SAME request (forced worst-case interleave:
 *      both read the pre-advance proposta before either writes) leave the proposta in the
 *      correct terminal state ('Assinada' + conversionPending + eSignature SIGNED) with NO
 *      corruption. The advance is convergent-idempotent (a full terminal overwrite), so the
 *      worst-case interleave may write twice but never corrupts; the count is asserted
 *      bounded (1..2) and reported.
 *
 * Run standalone:  node api/tests/e2e/zoho-signature-durability.e2e.mjs
 * Exit 0 = pass, 1 = fail. Registered in SUITE_LEDGER at operator-run (hermetic, needs no
 * live api — the per-PR-lane deterministic counterparts are the vitest tests
 * api/tests/integrations/sign-webhooks.test.ts + api/tests/contract/zoho-sign.test.ts;
 * the send-chain proxy sibling is api/tests/e2e/zoho-proxy.e2e.mjs).
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
// Capturing mock Zoho double (accounts token + sign API), one process. The test
// mutates the in-memory request records to simulate a client SIGNING (exactly what
// real Zoho does), so the webhook re-fetch reads genuine signature state.
// ---------------------------------------------------------------------------

const CLIENT_ID = '1000.MOCKCLIENTID';
const CLIENT_SECRET = 'mocksecret';
const SEED_REFRESH = '1000.rt-seed';
const CLIENT = 'cliente@example.com';

function startMock() {
  const requests = new Map();
  const accessTokens = new Set();
  const captured = { create: [], submit: [], embedtoken: [] };
  let reqSeq = 90000;

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
  const parseMultipart = (buf, contentType) => {
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
      parts[nameMatch[1]] = Buffer.from(content, 'latin1').toString('utf8');
    }
    return parts;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const body = await readBody(req);
    const auth = req.headers.authorization || '';

    if (req.method === 'POST' && url.pathname === '/oauth/v2/token') {
      const p = new URLSearchParams(body.toString());
      if (p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== CLIENT_SECRET)
        return json(res, 200, { error: 'invalid_client' });
      if (p.get('grant_type') === 'refresh_token') {
        if (!String(p.get('refresh_token') || '').startsWith('1000.rt')) return json(res, 200, { error: 'invalid_code' });
        const at = `1000.at-${crypto.randomBytes(6).toString('hex')}`;
        accessTokens.add(at);
        return json(res, 200, { access_token: at, expires_in: 3600 });
      }
      return json(res, 200, { error: 'unsupported_grant_type' });
    }

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
      if (req.method === 'POST' && m[2] === 'submit') {
        const parts = parseMultipart(body, req.headers['content-type']);
        let data = {};
        try { data = JSON.parse(parts.data || '{}'); } catch { /* leave {} */ }
        captured.submit.push({ id: m[1], data });
        r.request_status = 'inprogress';
        return json(res, 200, { code: 0, status: 'success', requests: r });
      }
      if (req.method === 'POST' && m[2] === 'actions' && m[4] === 'embedtoken') {
        captured.embedtoken.push({ id: m[1], actionId: m[3] });
        return json(res, 200, { code: 0, status: 'success', sign_url: `https://sign.zoho.eu/portal/${m[1]}/${m[3]}` });
      }
      if (req.method === 'GET' && m[2] === 'pdf')
        return (res.writeHead(200, { 'Content-Type': 'application/pdf' }), res.end(Buffer.from('%PDF-1.4 mock signed')));
      if (req.method === 'GET' && !m[2]) return json(res, 200, { code: 0, status: 'success', requests: r });
    }

    return json(res, 404, { code: 404, message: `no mock for ${req.method} ${url.pathname}`, status: 'failure' });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, captured }));
  });
}

/** Simulate the named signer completing their signature on the mock's live record. */
function markClientSigned(requests, requestId, email) {
  const r = requests.get(requestId);
  if (!r) return false;
  r.request_status = 'completed';
  for (const a of r.actions || []) {
    if (String(a.recipient_email).toLowerCase() === email.toLowerCase()) a.action_status = 'SIGNED';
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bundle the module under plain node (every external dep INJECTED; express external).
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
  const tmp = join(HERE, `.zoho-sign-durability-bundle-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(tmp, out.outputFiles[0].text);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// An in-memory proposta store with the idempotency guard baked into getProposta/
// updateProposta (updateProposta merges the patch, so a later read sees the advance).
// `updateCalls` records how many durable advances the handler drove.
// ---------------------------------------------------------------------------

function makePropostaStore(initialStage) {
  const proposta = { id: 'prop-x', stage: initialStage, client: 'José Cliente' };
  const state = { proposta, updateCalls: 0 };
  state.getProposta = async () => ({ ...proposta });
  state.updateProposta = async (_appId, _id, patch) => {
    Object.assign(proposta, patch);
    state.updateCalls += 1;
  };
  return state;
}

// ===========================================================================
// Run
// ===========================================================================

const { server, requests, captured } = await startMock();
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
process.env.ZOHO_API_BASE_OVERRIDE = baseUrl;
process.env.ZOHO_ACCOUNTS_BASE_OVERRIDE = baseUrl;
console.log(`[test] capturing mock Zoho on ${baseUrl}`);

let zoho;
let rtServer;
try {
  zoho = await bundleService();
  check('module bundles + imports under plain node', !!zoho && typeof zoho.makeZohoSignBackend === 'function');
  check('exports handleZohoWebhook + zohoSignRouter', typeof zoho.handleZohoWebhook === 'function' && typeof zoho.zohoSignRouter === 'function');

  // Backend with test-double deps; the agreement reverse-index is captured in memory.
  let currentFields = { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: SEED_REFRESH, dc: 'com' };
  let htmlRendered = 0;
  const agreements = [];
  const backend = zoho.makeZohoSignBackend({
    getOwnerOrgId: async (ownerUserId) => (ownerUserId === 'admin' ? 'org-1' : null),
    findConfigForOwner: async (_orgId, ownerUserId) =>
      ownerUserId === 'admin' && currentFields
        ? { _id: 'cfg-admin', enabled: true, credentialsCiphertext: JSON.stringify(currentFields) }
        : null,
    decrypt: (c) => c,
    renderHtmlToPdf: async (html) => {
      htmlRendered += 1;
      return Buffer.from(`%PDF-1.4 rendered(${(html || '').length} chars)`);
    },
    persistOwnerCredentialUpdates: async () => {},
    recordAgreement: async (ref) => { agreements.push(ref); },
  });

  const APP_ID = 'app-legal-case-manager-3';
  const PORTAL_URL = 'https://api.ekoa.io/apps/legal-case-manager-3/#/portal?t=tok123';

  // Shared webhook collaborators: the reverse index + the owner-scoped re-fetch (the ONLY
  // source of signature truth — it reads the live mock via the real backend).
  const findAgreement = async (rid) => agreements.find((a) => a.id === rid) || null;
  const getRequest = (owner, rid) => backend.getRequest(owner, rid);

  // --- A. SEND CHAIN (HTML→PDF) ------------------------------------------------
  zoho.__resetZohoTokenCache();
  const sendRes = await backend.sendForSignature({
    ownerUserId: 'admin',
    documentName: 'Proposta de Honorários',
    html: '<!doctype html><html><body><h1>Proposta</h1><p>Assine, por favor.</p></body></html>',
    message: 'Assine, por favor.',
    redirectUrl: PORTAL_URL,
    externalRef: { appId: APP_ID, propostaId: 'prop-1', clientEmail: CLIENT },
    recipients: [
      { email: CLIENT, name: 'José Cliente', embedded: true },
      { email: 'socio@bsm.pt', name: 'Sócio BSM' },
    ],
  });
  check('send returns success + requestId + inprogress', sendRes?.success === true && !!sendRes?.requestId && sendRes?.status === 'inprogress', `id=${sendRes?.requestId} status=${sendRes?.status}`);
  check('HTML→PDF render path was exercised (renderHtmlToPdf invoked)', htmlRendered === 1, `rendered=${htmlRendered}`);
  const lastCreate = captured.create.at(-1);
  check('create sent a real PDF file part (rendered bytes)', lastCreate?.hasFile === true);
  const embedded = sendRes?.signingUrls?.find((u) => u.email === CLIENT);
  const emailed = sendRes?.signingUrls?.find((u) => u.email === 'socio@bsm.pt');
  check('embedded recipient gets a signUrl forcing PT locale', typeof embedded?.signUrl === 'string' && /locale=pt/.test(embedded.signUrl), embedded?.signUrl || '');
  check('non-embedded recipient carries null signUrl (Zoho emails)', emailed?.signUrl === null);

  const lastSubmit = captured.submit.at(-1);
  const sig = lastSubmit?.data?.requests?.actions?.[0]?.fields?.[0];
  check('submit field is a mandatory Signature', sig?.field_type_name === 'Signature' && sig?.is_mandatory === true);
  check('submit signature is on the LAST page (0-based page_no === total_pages-1)', sig?.page_no === 1, `page_no=${sig?.page_no}`);
  check('submit sends only the abs box (percent width/height omitted)', sig?.abs_width === 300 && sig?.abs_height === 44 && sig?.width === undefined && sig?.height === undefined);
  const bounce = lastSubmit?.data?.requests?.redirect_pages?.sign_completed;
  check('submit redirect_pages is the fragment-free /return bounce (no bare #)', typeof bounce === 'string' && /\/api\/zoho-sign\/return\?to=/.test(bounce) && !/#/.test(bounce), bounce || '');
  const bounceTo = (() => { try { return new URL(bounce).searchParams.get('to'); } catch { return null; } })();
  check('the bounce `to` decodes back to the ERP portal (hash) URL', bounceTo === PORTAL_URL, bounceTo || '');
  check('agreement reverse-index row was recorded at send time', agreements.length === 1 && agreements[0].id === sendRes.requestId && agreements[0].clientEmail === CLIENT && agreements[0].propostaId === 'prop-1');

  // --- B. /return BOUNCE HOST GUARD -------------------------------------------
  const express = (await import('express')).default;
  const app = express();
  app.use(zoho.zohoSignRouter({ resolveApp: async () => ({ appId: APP_ID, ownerUserId: 'admin' }), backend, onWebhook: async () => {} }));
  rtServer = app.listen(0, '127.0.0.1');
  await new Promise((r) => rtServer.once('listening', r));
  const rtBase = `http://127.0.0.1:${rtServer.address().port}`;
  const ret = (to) => fetch(`${rtBase}/api/zoho-sign/return?to=${encodeURIComponent(to)}`, { redirect: 'manual' });

  const good = await ret(bounceTo || PORTAL_URL);
  const loc = good.headers.get('location') || '';
  check('return bounce 302s the minted ekoa.io portal URL', good.status === 302 && loc.startsWith('https://api.ekoa.io/apps/legal-case-manager-3/'), `${good.status} ${loc}`);
  const evilHost = await ret('https://evil.example.com/steal');
  check('return bounce refuses a non-ekoa.io host (400, no open redirect)', evilHost.status === 400, String(evilHost.status));
  const insecure = await ret('http://app.ekoa.io/x');
  check('return bounce refuses non-https ekoa.io (400)', insecure.status === 400, String(insecure.status));
  const malformed = await fetch(`${rtBase}/api/zoho-sign/return?to=not-a-url`, { redirect: 'manual' });
  check('return bounce refuses a malformed target (400)', malformed.status === 400, String(malformed.status));

  // --- C. WEBHOOK IDEMPOTENCE (genuine completion, replayed) ------------------
  markClientSigned(requests, sendRes.requestId, CLIENT);
  const storeC = makePropostaStore('Enviada');
  const depsC = { findAgreement, getRequest, getProposta: storeC.getProposta, updateProposta: storeC.updateProposta };
  const payload = { requests: { request_id: sendRes.requestId, request_status: 'completed' } };

  const first = await zoho.handleZohoWebhook(payload, depsC);
  check('genuine completion advances the proposta (first delivery)', /advanced proposta prop-1/.test(first), first);
  check('advance sets stage Assinada + conversionPending + eSignature SIGNED', storeC.proposta.stage === 'Assinada' && storeC.proposta.conversionPending === true && storeC.proposta.eSignature?.status === 'SIGNED');
  const second = await zoho.handleZohoWebhook(payload, depsC);
  check('replay of the same completion is a no-op (already Assinada)', /already Assinada/.test(second), second);
  check('idempotence: advanced EXACTLY once across the two deliveries', storeC.updateCalls === 1, `updateCalls=${storeC.updateCalls}`);

  // --- D. WEBHOOK FORGERY-PROOF -----------------------------------------------
  // A fresh request that the client has NOT signed; a forged "completed" payload must not advance.
  zoho.__resetZohoTokenCache();
  const forgeSend = await backend.sendForSignature({
    ownerUserId: 'admin',
    documentName: 'Proposta Forjada',
    html: '<!doctype html><html><body><p>x</p></body></html>',
    redirectUrl: PORTAL_URL,
    externalRef: { appId: APP_ID, propostaId: 'prop-forge', clientEmail: CLIENT },
    recipients: [{ email: CLIENT, name: 'José Cliente', embedded: true }],
  });
  // NOTE: deliberately NOT markClientSigned — the mock re-fetch will show NOACTION.
  const storeD = makePropostaStore('Enviada');
  const depsD = { findAgreement, getRequest, getProposta: storeD.getProposta, updateProposta: storeD.updateProposta };
  const forged = await zoho.handleZohoWebhook({ requests: { request_id: forgeSend.requestId, request_status: 'completed' } }, depsD);
  check('forged completion whose re-fetch shows unsigned does NOT advance', /not signed yet/.test(forged), forged);
  check('forgery: proposta stays Enviada, zero durable advances', storeD.proposta.stage === 'Enviada' && storeD.updateCalls === 0);
  const unknown = await zoho.handleZohoWebhook({ requests: { request_id: 'zr-does-not-exist', request_status: 'completed' } }, depsD);
  check('unknown requestId is a silent no-op (never re-fetched, never advanced)', /unknown request_id/.test(unknown) && storeD.updateCalls === 0, unknown);

  // --- E. CONCURRENT DOUBLE-DELIVERY (TOCTOU worst case) ----------------------
  zoho.__resetZohoTokenCache();
  const concSend = await backend.sendForSignature({
    ownerUserId: 'admin',
    documentName: 'Proposta Concorrente',
    html: '<!doctype html><html><body><p>c</p></body></html>',
    redirectUrl: PORTAL_URL,
    externalRef: { appId: APP_ID, propostaId: 'prop-conc', clientEmail: CLIENT },
    recipients: [{ email: CLIENT, name: 'José Cliente', embedded: true }],
  });
  markClientSigned(requests, concSend.requestId, CLIENT); // a genuine completion

  const storeE = makePropostaStore('Enviada');
  // Force the worst-case interleave: BOTH deliveries read the pre-advance proposta before
  // EITHER writes. A 2-party barrier on getProposta holds each read until both have read.
  let entered = 0;
  let releaseBarrier;
  const barrier = new Promise((r) => { releaseBarrier = r; });
  const gatedGetProposta = async (appId, id) => {
    const snap = await storeE.getProposta(appId, id);
    entered += 1;
    if (entered >= 2) releaseBarrier();
    await barrier;
    return snap;
  };
  const depsE = { findAgreement, getRequest, getProposta: gatedGetProposta, updateProposta: storeE.updateProposta };
  const concPayload = { requests: { request_id: concSend.requestId, request_status: 'completed' } };

  const [r1, r2] = await Promise.all([zoho.handleZohoWebhook(concPayload, depsE), zoho.handleZohoWebhook(concPayload, depsE)]);
  check('concurrent: both deliveries genuinely interleaved (both read pre-advance)', entered === 2);
  check('concurrent: terminal stage is Assinada (no corruption)', storeE.proposta.stage === 'Assinada', `stage=${storeE.proposta.stage}`);
  check('concurrent: conversionPending true + eSignature SIGNED (clean terminal state)', storeE.proposta.conversionPending === true && storeE.proposta.eSignature?.status === 'SIGNED');
  check('concurrent: advance count bounded (1..2, never corrupting/runaway)', storeE.updateCalls >= 1 && storeE.updateCalls <= 2, `updateCalls=${storeE.updateCalls}`);
  console.log(`[concurrent] handler returns: r1="${r1}" | r2="${r2}" | updateCalls=${storeE.updateCalls}`);
} catch (err) {
  check('driver ran without throwing', false, err?.stack || String(err));
} finally {
  try { rtServer?.close(); } catch { /* ignore */ }
  try { server.close(); } catch { /* ignore */ }
}

console.log(fails.length ? `\n${fails.length} check(s) failed` : `\nall checks passed`);
process.exit(fails.length ? 1 : 0);
