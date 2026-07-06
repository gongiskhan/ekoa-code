/**
 * Mock Ifthenpay payment API (node:http).
 *
 * Stands in for https://api.ifthenpay.com so the ifthenpay integration actions
 * (generate_multibanco_reference, mbway_payment, mbway_status) can be exercised
 * over a real socket without touching the live provider. Point the integration
 * config's `api_base` at the URL returned by `start()`.
 *
 * NOTE: this mock is the OUTBOUND payment API. The INBOUND payment callback
 * (GET /hooks/:id?chave=...) is delivered TO cortex, not to this server, and is
 * exercised directly against the running cortex by ifthenpay.e2e.mjs.
 *
 * Usage:
 *   import { start, stop } from './helpers/mock-ifthenpay-server.mjs';
 *   const baseUrl = await start();   // e.g. http://127.0.0.1:54123
 *   ...
 *   await stop();
 */

import { createServer } from 'node:http';

let server = null;

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

  // POST /multibanco/reference/init — create a Multibanco reference.
  if (req.method === 'POST' && path === '/multibanco/reference/init') {
    const body = await readBody(req);
    send(res, 200, {
      Entidade: '11249',
      Referencia: '123 456 789',
      OrderId: body.orderId ?? null,
      Amount: body.amount ?? null,
      RequestId: 'REQ-MB-1',
      Message: 'Success',
      Status: '0',
    });
    return;
  }

  // POST /spg/payment/mbway — start an MB WAY payment.
  if (req.method === 'POST' && path === '/spg/payment/mbway') {
    const body = await readBody(req);
    send(res, 200, {
      RequestId: 'REQ-MBWAY-1',
      OrderId: body.orderId ?? null,
      Amount: body.amount ?? null,
      Status: '000',
      Message: 'Pending',
    });
    return;
  }

  // GET /spg/payment/mbway/status — poll an MB WAY payment state.
  if (req.method === 'GET' && path === '/spg/payment/mbway/status') {
    const requestId = url.searchParams.get('requestId');
    send(res, 200, {
      RequestId: requestId,
      Status: '000',
      Message: 'Success',
    });
    return;
  }

  send(res, 404, { error: 'not found', method: req.method, path });
}

/** Start the mock; resolves to its base URL (no trailing slash). */
export function start(port = 0) {
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
