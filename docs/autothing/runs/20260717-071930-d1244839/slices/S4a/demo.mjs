#!/usr/bin/env node
// S4a per-user gateway keys live demo (autothing run 20260717-071930-d1244839): the REAL
// service + REAL gatewayRouter end-to-end - mint, authenticate on both channels, owner-billed
// gateway-client metering + Registo row, revoke -> 401, locked owner -> 402, per-key cap -> 429.
// Run from repo root after `npm run build`.
process.env.ENCRYPTION_KEY = 'demo-key';
process.env.JWT_SECRET = 'demo-secret';
process.env.LLM_GATEWAY_API_KEY = 'demo-gateway-key';

import express from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';

const api = (p) => import(new URL(`../../../../../../api/dist/${p}`, import.meta.url).href);
const { connectMongo, closeMongo } = await api('data/mongo.js');
const { tokenEvents, activityLogs } = await api('data/stores.js');
const { loadActivation } = await api('data/activation.js');
const { gatewayRouter } = await api('llm/gateway.js');
const { __setTransportForTests } = await api('llm/client.js');
const { setCredential } = await api('llm/credentials.js');
const svc = await api('auth/gateway-keys-service.js');

const mem = await MongoMemoryServer.create();
await connectMongo(mem.getUri(), 'ekoa_s4a_demo');
await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 });
loadActivation([{ userId: 'ana', active: true }]);

__setTransportForTests({
  async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
  async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
  async messages() {
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 200, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) };
  },
});

const app = express();
app.use('/api/v1/llm', gatewayRouter({
  verifyToken: () => { throw new Error('demo uses keys'); },
  verifyGatewayKey: svc.verifyGatewayKey,
}));
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const port = server.address().port;
const deps = { now: () => Date.now() };
const send = (headers) => fetch(`http://127.0.0.1:${port}/api/v1/llm/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'ola' }] }),
});

console.log('=== 1. mint (secret shown ONCE; at rest: sha256 id + 4-char tail) ===');
const minted = await svc.mintGatewayKey({ userId: 'ana', username: 'ana', orgId: 'orgA' }, 'portatil da Ana', deps);
console.log(`key   : ${minted.key.slice(0, 12)}...${minted.secretHint} (shown once)`);
console.log(`id    : ${minted.id.slice(0, 16)}... (the sha256 - the stored identity)`);

console.log('\n=== 2. the key works on BOTH channels and bills the OWNER ===');
for (const [label, headers] of [['Bearer (ANTHROPIC_AUTH_TOKEN)', { authorization: `Bearer ${minted.key}` }], ['x-api-key (ANTHROPIC_API_KEY)', { 'x-api-key': minted.key }]]) {
  const res = await send(headers);
  console.log(`${label}: HTTP ${res.status}`);
}
const rows = await tokenEvents.find({ agentType: 'gateway-client' });
console.log(`billing ledger: ${rows.length} gateway-client rows, billee=${rows[0].billeeUserId}, tier=${rows[0].tier}, metered=${rows[0].metered}`);
await new Promise((r) => setTimeout(r, 50));
const registo = await activityLogs.find({ type: 'gateway_turn' });
console.log(`Registo: ${registo.length} gateway_turn rows (metadata-only: keyId/tier/model/metered)`);

console.log('\n=== 3. revoke -> next call 401 ===');
await svc.revokeGatewayKey({ userId: 'ana', username: 'ana', orgId: 'orgA' }, minted.id, deps);
console.log(`after revoke: HTTP ${(await send({ authorization: `Bearer ${minted.key}` })).status}`);

console.log('\n=== 4. billing-locked owner -> 402 ===');
const m2 = await svc.mintGatewayKey({ userId: 'ana', username: 'ana', orgId: 'orgA' }, 'segunda', deps);
loadActivation([{ userId: 'ana', active: true, billingLocked: true }]);
const locked = await send({ authorization: `Bearer ${m2.key}` });
console.log(`locked owner: HTTP ${locked.status} ${JSON.stringify((await locked.json()).error.code)}`);
loadActivation([{ userId: 'ana', active: true }]);

console.log('\n=== 5. per-key cap window (doc override 1 call/window) -> 429 ===');
const { gatewayKeys } = await api('data/stores.js');
await gatewayKeys.update(m2.id, (d) => ({ ...d, caps: { maxCallsPerWindow: 1 } }));
console.log(`call 1: HTTP ${(await send({ authorization: `Bearer ${m2.key}` })).status}`);
const capped = await send({ authorization: `Bearer ${m2.key}` });
console.log(`call 2: HTTP ${capped.status} ${JSON.stringify((await capped.json()).error.type)}`);

server.close();
await closeMongo();
await mem.stop();
console.log('\nS4a demo complete.');
process.exit(0);
