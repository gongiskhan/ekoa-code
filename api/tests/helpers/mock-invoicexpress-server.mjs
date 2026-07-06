/**
 * Mock InvoiceXpress API (node:http).
 *
 * Stands in for https://<account>.app.invoicexpress.com so the invoicexpress
 * integration actions can be exercised over a real socket. Point the integration
 * config's `api_base` at the URL returned by `start()`.
 *
 * Models the certified-invoicing lifecycle the skill depends on:
 *   - POST /invoices.json                     → draft invoice with an id
 *   - PUT  /invoices/:id/change-state.json     → finalize: assigns ATCUD + sequence
 *   - GET  /invoices/:id.json                  → read (carries ATCUD once finalized)
 *   - GET  /api/pdf/:id.json                   → 202 twice, then 200 { output: { pdfUrl } }
 *   - PUT  /invoices/:id/email-invoice.json    → 200 sent
 *   - GET  /api/export_saft.json               → 202 once, then 200 { output: { saftUrl } }
 *
 * `start()` resets all in-memory state so each run is deterministic.
 *
 * Usage:
 *   import { start, stop } from './helpers/mock-invoicexpress-server.mjs';
 *   const baseUrl = await start();
 *   ...
 *   await stop();
 */

import { createServer } from 'node:http';

let server = null;
let nextInvoiceId = 1;
const invoices = new Map();     // id -> invoice object
const pdfPolls = new Map();     // id -> times get_invoice_pdf has been called
let saftPolls = 0;

const ATCUD = 'CSDF7T5H-50';

function reset() {
  nextInvoiceId = 1;
  invoices.clear();
  pdfPolls.clear();
  saftPolls = 0;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({ _raw: data }); }
    });
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  // POST /invoices.json — create draft.
  if (req.method === 'POST' && path === '/invoices.json') {
    const body = await readBody(req);
    const inner = (body && body.invoice) || {};
    const id = String(nextInvoiceId++);
    const invoice = {
      id: Number(id),
      status: 'draft',
      date: inner.date ?? null,
      due_date: inner.due_date ?? null,
      observations: inner.observations ?? null,
      client: inner.client ?? null,
      items: inner.items ?? [],
      atcud: null,
      sequence_number: null,
    };
    invoices.set(id, invoice);
    send(res, 201, { invoice });
    return;
  }

  // PUT /invoices/:id/change-state.json — finalize.
  let m = path.match(/^\/invoices\/([^/]+)\/change-state\.json$/);
  if (req.method === 'PUT' && m) {
    const id = m[1];
    const invoice = invoices.get(id);
    if (!invoice) { send(res, 404, { errors: ['invoice not found'] }); return; }
    const body = await readBody(req);
    const state = body?.invoice?.state ?? 'finalized';
    invoice.status = state;
    if (state === 'finalized') {
      invoice.atcud = ATCUD;
      invoice.sequence_number = `2026/${id}`;
      invoice.permalink = `https://mock.invoicexpress/invoices/${id}`;
      invoice.qr_code_url = `https://mock.invoicexpress/qr/${id}.png`;
    }
    send(res, 200, { invoice });
    return;
  }

  // PUT /invoices/:id/email-invoice.json — send by email.
  m = path.match(/^\/invoices\/([^/]+)\/email-invoice\.json$/);
  if (req.method === 'PUT' && m) {
    const id = m[1];
    if (!invoices.has(id)) { send(res, 404, { errors: ['invoice not found'] }); return; }
    send(res, 200, { invoice: { id: Number(id), status: 'sent' } });
    return;
  }

  // GET /api/pdf/:id.json — 202 twice, then 200 with the URL.
  m = path.match(/^\/api\/pdf\/([^/]+)\.json$/);
  if (req.method === 'GET' && m) {
    const id = m[1];
    const n = (pdfPolls.get(id) ?? 0) + 1;
    pdfPolls.set(id, n);
    if (n <= 2) { send(res, 202, { output: { state: 'pending' } }); return; }
    send(res, 200, { output: { pdfUrl: `https://mock.invoicexpress/pdf/${id}.pdf` } });
    return;
  }

  // GET /api/export_saft.json — 202 once, then 200 with the URL.
  if (req.method === 'GET' && path === '/api/export_saft.json') {
    saftPolls += 1;
    if (saftPolls <= 1) { send(res, 202, { output: { state: 'pending' } }); return; }
    send(res, 200, { output: { saftUrl: 'https://mock.invoicexpress/saft/2026-06.xml' } });
    return;
  }

  // GET /invoices/:id.json — read.
  m = path.match(/^\/invoices\/([^/]+)\.json$/);
  if (req.method === 'GET' && m) {
    const id = m[1];
    const invoice = invoices.get(id);
    if (!invoice) { send(res, 404, { errors: ['invoice not found'] }); return; }
    send(res, 200, { invoice });
    return;
  }

  send(res, 404, { error: 'not found', method: req.method, path });
}

/** Start the mock; resolves to its base URL (no trailing slash). Resets state. */
export function start(port = 0) {
  reset();
  return new Promise((resolve) => {
    server = createServer((req, res) => { void handler(req, res); });
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve(`http://127.0.0.1:${p}`);
    });
  });
}

/** Stop the mock. Safe to call when not started. */
export function stop() {
  return new Promise((resolve) => {
    if (!server) { resolve(); return; }
    const s = server;
    server = null;
    s.close(() => resolve());
  });
}
