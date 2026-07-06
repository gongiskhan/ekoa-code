#!/usr/bin/env node
/**
 * InvoiceXpress integration — committed, re-runnable E2E.
 *
 * Proves the PB1 InvoiceXpress slice against a RUNNING dev cortex + a local mock
 * InvoiceXpress API (no real account exists):
 *
 *   1. The invoicexpress skill is loaded with the six actions, the api_key/
 *      account_name/api_base schema, and NO webhookConfig (outbound-only).
 *   2. A config is saved with api_base → the local mock; the `ekoa.integrations
 *      execute` intent round-trips it and returns the DECRYPTED config (the
 *      platform exposes no server-side HTTP action intent — execute hands the
 *      decrypted config to the agent layer, which performs the call).
 *   3. Driving the actions exactly as the agent layer would (using the decrypted
 *      api_base + api_key), the certified-invoicing lifecycle carries the ATCUD:
 *      create (draft) → finalize (ATCUD CSDF7T5H-50) → get (reads ATCUD back), and
 *      get_invoice_pdf returns 202 while generating then 200 with the URL.
 *
 * Auth: login admin/tmp12345 via the ekoa.auth action API for a JWT.
 * Cleanup: the integration config is deleted (best-effort) before and after.
 * Requires a running dev cortex. Run: node cortex/tests/e2e/invoicexpress.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { start as startIxMock, stop as stopIxMock } from '../helpers/mock-invoicexpress-server.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;
const API_KEY = `ix-e2e-${randomUUID().slice(0, 8)}`;

function fail(m) { console.error(`E2E FAIL: ${m}`); process.exitCode = 1; throw new Error('__ASSERT__'); }
function assert(c, m) { if (!c) fail(m); }
function ok(m) { console.log(`  PASS: ${m}`); }
function note(m) { console.log(`  NOTE: ${m}`); }

let TOKEN = null;
async function action(app, intent, params = {}) {
  const r = await fetch(`${BASE}/api/v1/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify({ app, intent, params, request_id: randomUUID() }),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t, _status: r.status }; }
}

/** POST/PUT/GET a JSON action against the mock, exactly as the agent layer would from the decrypted config. */
async function ix(base, apiKey, method, path, body) {
  const url = `${base}${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data };
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: cortex not reachable at ${BASE}/health — start the dev cortex first.`);
    process.exit(0);
  }

  const mockBase = await startIxMock();
  let configId = null;

  try {
    const login = await action('ekoa.auth', 'login', { username: 'admin', password: 'tmp12345', rememberMe: true });
    TOKEN = login?.data?.token;
    assert(TOKEN, `login failed: ${JSON.stringify(login).slice(0, 200)}`);
    ok('logged in (JWT acquired)');

    // ---- The invoicexpress skill must be loaded --------------------------
    const skills = await action('ekoa.integrations', 'list-skills', {});
    const ix0 = (skills?.data || []).find((s) => s.integrationKey === 'invoicexpress');
    assert(ix0, 'invoicexpress integration skill not loaded (ekoa-data/integrations/invoicexpress missing? restart cortex)');
    const actionNames = (ix0.actions || []).map((a) => a.actionName);
    for (const a of ['create_invoice', 'finalize_invoice', 'get_invoice', 'get_invoice_pdf', 'email_invoice', 'export_saft']) {
      assert(actionNames.includes(a), `invoicexpress skill missing action ${a} (has: ${actionNames.join(', ')})`);
    }
    const fieldKeys = (ix0.configSchema || []).map((f) => f.key);
    for (const k of ['account_name', 'api_key', 'api_base']) {
      assert(fieldKeys.includes(k), `invoicexpress skill missing config field ${k}`);
    }
    assert(!ix0.webhookConfig, 'invoicexpress must not declare a webhookConfig (outbound-only)');
    ok('invoicexpress skill loaded (6 actions, api_key/account_name/api_base, no webhook)');

    // ---- Save a config with api_base → the local mock --------------------
    const created = await action('ekoa.integrations', 'create-config', {
      integrationKey: 'invoicexpress',
      configValues: { account_name: 'acme', api_key: API_KEY, api_base: mockBase },
    });
    configId = created?.data?.id;
    assert(configId, `create-config failed: ${JSON.stringify(created).slice(0, 300)}`);
    ok(`invoicexpress config saved (${configId})`);

    // ---- execute round-trips + decrypts the config -----------------------
    const exec = await action('ekoa.integrations', 'execute', {
      id: configId,
      action: 'create_invoice',
      args: { date: '01/07/2026', client: { name: 'Cliente E2E' }, items: [{ name: 'Consulta', unit_price: 100, quantity: 1 }] },
    });
    assert(exec?.data?.integration?.type === 'invoicexpress', `execute integration.type mismatch: ${JSON.stringify(exec?.data?.integration)}`);
    assert(exec?.data?.action === 'create_invoice', 'execute did not echo the action');
    assert(Array.isArray(exec?.data?.args?.items) && exec.data.args.items.length === 1, 'execute did not round-trip the items arg');
    const creds = JSON.parse(exec.data.credentials);
    assert(creds.api_base === mockBase, `decrypted api_base mismatch: ${creds.api_base} != ${mockBase}`);
    assert(creds.api_key === API_KEY, 'decrypted api_key mismatch');
    ok('execute intent round-trips the stored config + decrypts api_base/api_key');

    // ---- Drive the lifecycle against the mock (as the agent layer would) --
    const createResp = await ix(creds.api_base, creds.api_key, 'POST', '/invoices.json', {
      invoice: { date: '01/07/2026', client: { name: 'Cliente E2E' }, items: [{ name: 'Consulta', unit_price: 100, quantity: 1 }] },
    });
    assert(createResp.status === 201 && createResp.data?.invoice?.id, `create_invoice failed: ${JSON.stringify(createResp).slice(0, 200)}`);
    const invoiceId = createResp.data.invoice.id;
    assert(createResp.data.invoice.status === 'draft', `expected draft, got ${createResp.data.invoice.status}`);
    ok(`create_invoice → draft invoice id=${invoiceId}`);

    const finalizeResp = await ix(creds.api_base, creds.api_key, 'PUT', `/invoices/${invoiceId}/change-state.json`, { invoice: { state: 'finalized' } });
    assert(finalizeResp.status === 200, `finalize failed: ${finalizeResp.status}`);
    assert(finalizeResp.data?.invoice?.atcud === 'CSDF7T5H-50', `finalize did not assign ATCUD: ${JSON.stringify(finalizeResp.data).slice(0, 160)}`);
    ok(`finalize_invoice → status finalized + ATCUD ${finalizeResp.data.invoice.atcud} + serie ${finalizeResp.data.invoice.sequence_number}`);

    const getResp = await ix(creds.api_base, creds.api_key, 'GET', `/invoices/${invoiceId}.json`);
    assert(getResp.status === 200 && getResp.data?.invoice?.atcud === 'CSDF7T5H-50', `get_invoice did not carry ATCUD: ${JSON.stringify(getResp.data).slice(0, 160)}`);
    ok('get_invoice → carries the ATCUD assigned at finalize');

    // pdf: 202 while generating, then 200 with the URL (documented poll).
    const pdf1 = await ix(creds.api_base, creds.api_key, 'GET', `/api/pdf/${invoiceId}.json`);
    const pdf2 = await ix(creds.api_base, creds.api_key, 'GET', `/api/pdf/${invoiceId}.json`);
    const pdf3 = await ix(creds.api_base, creds.api_key, 'GET', `/api/pdf/${invoiceId}.json`);
    assert(pdf1.status === 202 && pdf2.status === 202, `expected 202 while generating, got ${pdf1.status}/${pdf2.status}`);
    assert(pdf3.status === 200 && pdf3.data?.output?.pdfUrl, `expected 200 + pdfUrl, got ${pdf3.status}`);
    ok('get_invoice_pdf → 202 (generating) x2 then 200 with output.pdfUrl');
  } finally {
    if (configId) {
      const d = await action('ekoa.integrations', 'delete-config', { id: configId });
      if (d?.data?.deleted) note(`cleaned up integration config ${configId}`);
    }
    await stopIxMock();
  }
}

main().then(
  () => {
    if (process.exitCode) { console.error('\nE2E: FAILURES above.'); process.exit(process.exitCode); }
    console.log('\nE2E PASS: InvoiceXpress skill load + config execute round-trip + create/finalize/get(ATCUD) + pdf poll verified.');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
