import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { __setTransportForTests, __resetTransportForTests, type ChokepointTransport } from '../../src/llm/client.js';
import { setCredential, __resetCredentialsForTests } from '../../src/llm/credentials.js';
import { LlmCountTokensResponse } from '@ekoa/shared';

/**
 * Contract test for ekoaLocal.llmCountTokens + llmCountTokensAlias (S3, run
 * 20260717-071930-d1244839): both mounted paths answer through the REAL app (buildApp) and the
 * 2xx body validates against the shared LlmCountTokensResponse schema. Upstream stubbed at the
 * transport seam.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
const GATEWAY_KEY = 'gw-contract-key';
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };

const fakeTransport: ChokepointTransport = {
  async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
  async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
  async messages() { return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"input_tokens": 1234}' }; },
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  process.env.LLM_GATEWAY_API_KEY = GATEWAY_KEY;
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_contract_count_tokens');
  const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
  delete process.env.LLM_GATEWAY_API_KEY;
});

beforeEach(async () => {
  __resetTransportForTests();
  __resetCredentialsForTests();
  await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 });
  __setTransportForTests(fakeTransport);
});

describe('count_tokens contract (both mounted paths)', () => {
  for (const path of ['/api/v1/llm/v1/messages/count_tokens', '/api/v1/llm/messages/count_tokens']) {
    it(`POST ${path} -> 200 validating LlmCountTokensResponse`, async () => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
        body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(res.status).toBe(200);
      const body: unknown = await res.json();
      const parsed = LlmCountTokensResponse.safeParse(body);
      expect(parsed.success, JSON.stringify(body)).toBe(true);
      expect((body as { input_tokens: number }).input_tokens).toBe(1234);
    });
  }
});
