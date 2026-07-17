#!/usr/bin/env node
// S2 family-mapping live demo (autothing run 20260717-071930-d1244839): three requests through
// the REAL gatewayRouter show tier resolution on the wire - dated sonnet id family-matches
// (thinking FORWARDED, wire model = configured WORKHORSE), dated opus id -> EXPERT, alien id ->
// FAST clamp with thinking STRIPPED. Run from repo root after `npm run build`.
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

const mem = await MongoMemoryServer.create();
await connectMongo(mem.getUri(), 'ekoa_s2_demo');
await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 });

let lastPayload;
__setTransportForTests({
  async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
  async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
  async messages(p) {
    lastPayload = p.payload;
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 200, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) };
  },
});

const app = express();
app.use('/api/v1/llm', gatewayRouter({ verifyToken: () => { throw new Error('demo uses the static key'); } }));
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const port = server.address().port;

async function send(label, model) {
  await fetch(`http://127.0.0.1:${port}/api/v1/llm/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'demo-gateway-key' },
    body: JSON.stringify({ model, thinking: { type: 'enabled', budget_tokens: 1024 }, messages: [{ role: 'user', content: 'ola' }] }),
  });
  const row = (await tokenEvents.find({})).at(-1);
  console.log(`\n=== ${label} ===`);
  console.log(`requested model : ${model}`);
  console.log(`wire model      : ${lastPayload.model}`);
  console.log(`thinking on wire: ${lastPayload.thinking ? JSON.stringify(lastPayload.thinking) : 'STRIPPED'}`);
  console.log(`metered         : tier=${row.tier} weight-metered=${row.metered}`);
}

await send('1. dated sonnet id - FAMILY match, thinking travels', 'claude-3-7-sonnet-20250219');
await send('2. dated opus id - FAMILY match to EXPERT', 'claude-opus-4-5-20260115');
await send('3. alien id - FAST clamp, thinking stripped', 'some-alien-model');
await send('4. within-word substring is NOT a family (token-boundary fix)', 'opusculum-1');

console.log('\n=== GET /models lists all three tiers ===');
const models = await (await fetch(`http://127.0.0.1:${port}/api/v1/llm/models`, { headers: { 'x-api-key': 'demo-gateway-key' } })).json();
console.log(models.data.map((m) => m.id).join('\n'));

server.close();
await closeMongo();
await mem.stop();
console.log('\nS2 demo complete.');
process.exit(0);
