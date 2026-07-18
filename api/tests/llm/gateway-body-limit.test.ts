import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { __setTransportForTests, __resetTransportForTests, type ChokepointTransport } from '../../src/llm/client.js';
import { setCredential, __resetCredentialsForTests } from '../../src/llm/credentials.js';
import { ErrorEnvelope } from '@ekoa/shared';

/**
 * S3 body-limit fix (run 20260717-071930-d1244839; surfaced by the S1 fresh review): the global
 * 1 MB json parser in server.ts pre-parsed /api/v1/llm bodies, so the gateway router's own 50 MB
 * largeJson was dead code and every stock-Claude-Code body >1 MB (long transcripts, base64
 * screenshots) 413'd before reaching the gateway. The composition root now skips the global
 * parser for /api/v1/llm; the gateway parses its own bodies and answers parse failures in the
 * ANTHROPIC error shape (never CONV-2, never HTML). Non-gateway routes keep the 1 MB limit and
 * the CONV-2 envelope (regression-pinned here).
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
const GATEWAY_KEY = 'gw-limit-key';
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };

const fakeTransport: ChokepointTransport = {
  async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
  async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
  async messages() {
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) };
  },
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  process.env.LLM_GATEWAY_API_KEY = GATEWAY_KEY;
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_gateway_body_limit');
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

describe('gateway bodies larger than the old global 1 MB limit', () => {
  it('a ~2 MB gateway body reaches the gateway and succeeds (the 50 MB router limit is live)', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: big }] }),
    });
    expect(res.status).toBe(200);
  });

  it('malformed gateway JSON answers in the ANTHROPIC error shape, never HTML, never CONV-2', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: '{"broken":',
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain('<!DOCTYPE html>');
    const body = JSON.parse(text) as { type: string; error: { type: string } };
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('invalid_request_error');
  });

  it('a body over the gateway 50 MB limit answers 413 in the ANTHROPIC shape (the too-large branch)', async () => {
    const huge = 'x'.repeat(51 * 1024 * 1024);
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: huge }] }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { type: string; error: { type: string } };
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('invalid_request_error');
  }, 60_000);

  it('a CASE-VARIANT gateway path is also exempt from the global parser (Express matches routes case-insensitively)', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    const res = await fetch(`http://127.0.0.1:${port}/API/v1/llm/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: big }] }),
    });
    expect(res.status).toBe(200);
  });

  it('an UNAUTHENTICATED large body is refused 401 BEFORE the 50 MB parser buffers it (security-review MEDIUM: pre-auth DoS)', async () => {
    // A 2 MB body with NO credential: the authGate rejects from the headers before largeJson runs,
    // so nothing is buffered. (Sending the full 50 MB here would prove it too but is slow; the
    // point is the 401 comes from auth, not from the body parser - a parse-first path would 413 a
    // >50MB body and 200-attempt a <50MB one, never 401 an unauthenticated one.)
    const big = 'x'.repeat(2 * 1024 * 1024);
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }, // no x-api-key, no Authorization
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: big }] }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { type: string; error: { type: string } };
    expect(body.error.type).toBe('authentication_error');
  });

  it('/classify also authenticates BEFORE the 50 MB parser (codex checkpoint: same pre-auth gate)', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/classify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: big }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe('authentication_error');
  });

  it('non-gateway routes KEEP the global 1 MB limit and the CONV-2 envelope (regression pin)', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: big, password: 'x' }),
    });
    expect(res.status).toBe(413);
    const body: unknown = await res.json();
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
  });
});
