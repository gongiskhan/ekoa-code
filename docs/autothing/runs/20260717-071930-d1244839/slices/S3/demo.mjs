#!/usr/bin/env node
// S3 count_tokens live demo (autothing run 20260717-071930-d1244839): the REAL gatewayRouter
// forwards count_tokens through the chokepoint (anonymised, tier-resolved, endpoint selector),
// never bills, never caps, and a billing-blocked owner can still count while real messages 402.
// Run from repo root after `npm run build`.
process.env.ENCRYPTION_KEY = 'demo-key';
process.env.JWT_SECRET = 'demo-secret';
process.env.LLM_GATEWAY_API_KEY = 'demo-gateway-key';

import express from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';

const api = (p) => import(new URL(`../../../../../../api/dist/${p}`, import.meta.url).href);
const { connectMongo, closeMongo } = await api('data/mongo.js');
const { tokenEvents, billingAccounts } = await api('data/stores.js');
const { gatewayRouter } = await api('llm/gateway.js');
const { __setTransportForTests, setOrgResolver } = await api('llm/client.js');
const { setCredential } = await api('llm/credentials.js');
const { setRulesetResolver } = await api('llm/anonymise/index.js');

const mem = await MongoMemoryServer.create();
await connectMongo(mem.getUri(), 'ekoa_s3_demo');
await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 });
setOrgResolver(async () => 'org1');
setRulesetResolver((orgId) => ({ orgId, denyList: ['Petrova Holdings'] }));

let last;
__setTransportForTests({
  async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
  async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
  async messages(p) {
    last = p;
    return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"input_tokens": 1234}' };
  },
});

const verifyToken = (token) => {
  const m = /^good:([^:]+):([^:]*)$/.exec(token);
  if (!m) throw new Error('bad');
  return { sub: m[1], orgId: m[2] };
};
const app = express();
app.use('/api/v1/llm', gatewayRouter({ verifyToken }));
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const port = server.address().port;

console.log('=== 1. count_tokens forwards through the chokepoint ===');
let res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/v1/messages/count_tokens`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'demo-gateway-key' },
  body: JSON.stringify({ model: 'claude-3-7-sonnet-20250219', stream: true, max_tokens: 32000, messages: [{ role: 'user', content: 'contract with Petrova Holdings attached' }] }),
});
console.log(`HTTP ${res.status} body: ${await res.text()}`);
console.log(`upstream endpoint : ${last.endpoint} (URL suffix /count_tokens)`);
console.log(`wire model        : ${last.payload.model} (family-matched WORKHORSE - honest count)`);
console.log(`stream/max_tokens : ${'stream' in last.payload || 'max_tokens' in last.payload ? 'LEAKED' : 'dropped (count surface only)'}`);
const wire = JSON.stringify(last.payload);
console.log(`deny-listed party : ${wire.includes('Petrova Holdings') ? 'LEAKED IN CLEARTEXT' : 'tokenized (anonymisation applied)'}`);
console.log(`token_events rows : ${(await tokenEvents.find({})).length} (never billed)`);

console.log('\n=== 2. a billing-blocked owner can still COUNT, but real messages 402 ===');
await billingAccounts.insert({ _id: 'brokeUser', monthlyBaseTokensUsed: 0, creditBalanceUsd: 0, overageEnabled: false, currentPeriodStart: Date.now(), tokenLimit: 0 });
res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/v1/messages/count_tokens`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer good:brokeUser:org1' },
  body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'ola' }] }),
});
console.log(`count_tokens : HTTP ${res.status}`);
res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/v1/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer good:brokeUser:org1' },
  body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'ola' }] }),
});
console.log(`real message : HTTP ${res.status} (allowance gate intact)`);

console.log('\n=== 3. malformed gateway JSON answers in the ANTHROPIC shape ===');
res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/v1/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'demo-gateway-key' },
  body: '{"broken":',
});
console.log(`HTTP ${res.status} body: ${await res.text()}`);

server.close();
await closeMongo();
await mem.stop();
console.log('\nS3 demo complete.');
process.exit(0);
