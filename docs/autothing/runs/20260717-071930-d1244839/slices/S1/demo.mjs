#!/usr/bin/env node
// S1 heartbeat-and-replay live wire demo (autothing run 20260717-071930-d1244839).
// Boots the REAL gatewayRouter (api/dist) against an in-memory Mongo + a stub upstream that
// answers after 4s, and prints SSE frames AS THEY ARRIVE so the heartbeat cadence is visible.
// Run from the repo root AFTER `npm run build`: node docs/autothing/runs/<runId>/slices/S1/demo.mjs
process.env.ENCRYPTION_KEY = 'demo-key';
process.env.JWT_SECRET = 'demo-secret';
process.env.LLM_GATEWAY_API_KEY = 'demo-gateway-key';

import express from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';

const api = (p) => import(new URL(`../../../../../../api/dist/${p}`, import.meta.url).href);
const { connectMongo, closeMongo } = await api('data/mongo.js');
const { tokenEvents } = await api('data/stores.js');
const { gatewayRouter } = await api('llm/gateway.js');
const { __setTransportForTests } = await api('llm/client.js');
const { setCredential } = await api('llm/credentials.js');

const t0 = Date.now();
const at = () => `[t+${((Date.now() - t0) / 1000).toFixed(2)}s]`;
const log = (...a) => console.log(at(), ...a);

const SSE_BODY = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_demo","usage":{"input_tokens":200,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ola"}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","usage":{"output_tokens":40}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n');

const mem = await MongoMemoryServer.create();
await connectMongo(mem.getUri(), 'ekoa_s1_demo');
await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 });

let upstreamStatus = 200;
let upstreamBody = SSE_BODY;
__setTransportForTests({
  async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
  async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
  async messages() {
    log('   (upstream call started - provider will take 4s; watch the pings)');
    await new Promise((r) => setTimeout(r, 4000));
    return { status: upstreamStatus, headers: {}, body: upstreamBody };
  },
});

const app = express();
app.use('/api/v1/llm', gatewayRouter({ verifyToken: () => { throw new Error('demo uses the static key'); }, pingIntervalMs: 1000 }));
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const port = server.address().port;
log(`gateway up on :${port} (pingIntervalMs=1000 for a visible cadence; production default is 15000)`);

async function streamOnce(label, init) {
  console.log(`\n=== ${label} ===`);
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/messages`, init);
  log(`HTTP ${res.status}  content-type: ${res.headers.get('content-type')}`);
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    log('body:', await res.text());
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = frame.split('\n').find((l) => l.startsWith('event: '))?.slice(7) ?? '(data-only)';
      log(`frame: event=${ev}`);
    }
  }
  log('stream closed');
}

const body = JSON.stringify({ model: 'claude-opus-4-8[1m]', stream: true, messages: [{ role: 'user', content: 'ola' }] });
const headers = { 'content-type': 'application/json', 'x-api-key': 'demo-gateway-key' };

await streamOnce('1. stream:true happy path - pings every 1s, then the verbatim SSE replay', { method: 'POST', headers, body });

console.log('\n=== 2. metering landed while the client watched pings ===');
const rows = await tokenEvents.find({});
log(`token_events rows: ${rows.length}; tier=${rows[0]?.tier} metered=${rows[0]?.metered} (input 200 + output 40 at EXPERT weight)`);

await streamOnce('3. bad credential + stream:true - clean HTTP 401 JSON, no SSE commitment', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'wrong' }, body,
});

upstreamStatus = 429;
upstreamBody = JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'upstream overloaded' } });
await streamOnce('4. upstream failure AFTER commitment - one in-stream event: error frame', { method: 'POST', headers, body });

server.close();
await closeMongo();
await mem.stop();
console.log('\nS1 demo complete.');
process.exit(0);
