import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { gatewayRouter, gatewayUnmeteredCount, __resetGatewayCountersForTests } from '../../src/llm/gateway.js';
import { __setTransportForTests, __resetTransportForTests, type ChokepointTransport } from '../../src/llm/client.js';
import { setCredential, buildSubprocessEnv, __resetCredentialsForTests } from '../../src/llm/credentials.js';

/**
 * F2 (b): the DEFAULT chokepoint topology (LLM_CHOKEPOINT_BASE_URL unset → local gateway)
 * must self-authenticate. The SDK subprocess presents the env this process builds for it
 * (`buildSubprocessEnv`); the gateway must admit that principal — the 2026-07-08 hardening
 * run showed it 401s instead because no boot path provisions LLM_GATEWAY_API_KEY and the
 * subprocess presents the MODEL secret to a gateway that only accepts the gateway key/JWT.
 * The model secret itself must NOT enter the subprocess env in this topology — the gateway
 * re-injects it upstream (client.proxyGatewayMessages).
 */
let mem: MongoMemoryServer; let server: Server; let port: number;

const verifyToken = (_token: string): { sub: string } => { throw new Error('no JWT principals in this test'); };

const providerBody = JSON.stringify({
  content: [{ type: 'text', text: 'ok' }],
  usage: { input_tokens: 3, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});

const stub: ChokepointTransport = {
  async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
  async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
  async messages() { return { status: 200, headers: { 'content-type': 'application/json' }, body: providerBody }; },
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  delete process.env.LLM_GATEWAY_API_KEY;   // nothing provisioned by the operator
  delete process.env.LLM_CHOKEPOINT_BASE_URL; // DEFAULT topology: the local gateway
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_gateway_boot_auth');
  const app = express();
  app.use('/api/v1/llm', gatewayRouter({ verifyToken }));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

beforeEach(() => {
  __resetGatewayCountersForTests();
  __resetCredentialsForTests();
  __setTransportForTests(stub);
});

describe('default topology self-authentication (F2 b)', () => {
  it('the subprocess env principal is admitted by the gateway (no 401) and the call is metered', async () => {
    await setCredential({ mode: 'oauth', secret: 'oauth-model-secret', refreshToken: 'r1' });
    const env = await buildSubprocessEnv();

    // The env points the subprocess at the local gateway…
    expect(env.ANTHROPIC_BASE_URL).toContain('127.0.0.1');
    // …and the MODEL secret must not ride along: the gateway injects it upstream itself.
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeTruthy();
    expect(env.ANTHROPIC_API_KEY).not.toBe('oauth-model-secret');

    // The SDK authenticates with x-api-key = $ANTHROPIC_API_KEY against ANTHROPIC_BASE_URL.
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY ?? '' },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    expect(gatewayUnmeteredCount()).toBe(0);
    __resetTransportForTests();
  });

  it('a wrong key is still rejected (provisioning must not weaken gateway auth)', async () => {
    await setCredential({ mode: 'api-key', secret: 'sk-model' });
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'not-the-key' },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(401);
  });
});
