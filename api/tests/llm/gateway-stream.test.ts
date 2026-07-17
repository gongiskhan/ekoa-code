import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { tokenEvents, billingAccounts } from '../../src/data/stores.js';
import { gatewayRouter, __resetGatewayCountersForTests } from '../../src/llm/gateway.js';
import { __setTransportForTests, __resetTransportForTests, type ChokepointTransport } from '../../src/llm/client.js';
import { setCredential, __resetCredentialsForTests, __setNowForTests } from '../../src/llm/credentials.js';
import { __resetRateCapsForTests } from '../../src/billing/rate-caps.js';

/**
 * S1 heartbeat-and-replay (run 20260717-071930-d1244839): a stream:true gateway client gets an
 * immediate SSE 200 with ping frames while the BUFFERED upstream call runs, then the verbatim
 * detokenized SSE body in one write. Auth/allowance failures stay clean HTTP; post-commitment
 * failures arrive as in-stream `error` events. The non-stream path is pinned byte-identical.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
const T0 = 1_800_000_000_000;
const GATEWAY_KEY = 'gw-secret';
const PING_MS = 25;

const verifyToken = (token: string) => {
  const m = /^good:([^:]+):([^:]*)$/.exec(token);
  if (!m) throw new Error('bad token');
  return { sub: m[1]!, orgId: m[2]! };
};

const api = (p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });

function stubTransport(over: Partial<ChokepointTransport>): ChokepointTransport {
  const base: ChokepointTransport = {
    async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
    async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
    async messages() { return { status: 200, headers: {}, body: '{}' }; },
  };
  return { ...base, ...over };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A realistic buffered upstream SSE body: message_start usage + message_delta + message_stop. */
const SSE_UPSTREAM_BODY = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_s1","usage":{"input_tokens":200,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","usage":{"output_tokens":40}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n');

const providerJsonBody = (input: number, output: number) =>
  JSON.stringify({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });

interface SseFrame { event?: string; data?: string }

/** Read the whole SSE response and split it into frames (getReader + '\n\n' split — the
 *  journeys/_lib.mjs sseCollect pattern, re-implemented in TS for vitest). */
async function readSse(res: Response): Promise<{ raw: string; frames: SseFrame[] }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let raw = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += dec.decode(value, { stream: true });
  }
  const frames: SseFrame[] = [];
  for (const block of raw.split('\n\n')) {
    if (!block.trim()) continue;
    const frame: SseFrame = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) frame.event = line.slice(7);
      else if (line.startsWith('data: ')) frame.data = (frame.data ? frame.data + '\n' : '') + line.slice(6);
    }
    frames.push(frame);
  }
  return { raw, frames };
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  process.env.LLM_GATEWAY_API_KEY = GATEWAY_KEY;
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_llm_gateway_stream');
  const app = express();
  app.use('/api/v1/llm', gatewayRouter({ verifyToken, pingIntervalMs: PING_MS }));
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
  __resetGatewayCountersForTests();
  __resetTransportForTests();
  __resetCredentialsForTests();
  __resetRateCapsForTests();
  __setNowForTests(() => T0);
  for (const c of ['token_events', 'billing_accounts', 'credentials', 'settings']) {
    await getDb().collection(c).deleteMany({});
  }
  await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: T0 + 60 * 60 * 1000 });
});
afterEach(() => {
  delete process.env.EKOA_RATECAP_CALLS_PER_USER;
  __resetRateCapsForTests();
  vi.restoreAllMocks();
});

describe('stream:true — heartbeat-and-replay', () => {
  it('commits SSE immediately, pings while the upstream runs, then replays the body verbatim and meters', async () => {
    __setTransportForTests(stubTransport({
      async messages() {
        await sleep(120); // slow upstream: several PING_MS intervals elapse before the reply
        return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: SSE_UPSTREAM_BODY };
      },
    }));
    const res = await api('/api/v1/llm/messages', {
      method: 'POST',
      headers: { 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'claude-opus-4-8[1m]', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const { raw, frames } = await readSse(res);
    const pings = frames.filter((f) => f.event === 'ping');
    expect(pings.length).toBeGreaterThanOrEqual(2); // the immediate commit ping + interval pings
    expect(pings[0]!.data).toBe('{"type": "ping"}');
    // The upstream SSE text replays VERBATIM as the tail of the wire bytes (raw write).
    expect(raw.endsWith(SSE_UPSTREAM_BODY)).toBe(true);
    // The first ping precedes the replayed body on the wire.
    expect(raw.indexOf('event: ping')).toBeLessThan(raw.indexOf('event: message_start'));

    // Streamed usage still meters (message_start input + last message_delta output = 240 tokens).
    const rows = await tokenEvents.find({ agentType: 'pi-fast-loop' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tier: 'EXPERT', billeeUserId: '', metered: 96 }); // round(0.4*240)
  });

  it('bad auth with stream:true stays a clean HTTP 401 JSON (no SSE commitment)', async () => {
    const res = await api('/api/v1/llm/messages', {
      method: 'POST',
      body: JSON.stringify({ stream: true, messages: [] }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('authentication_error');
  });

  it('billing-blocked JWT with stream:true stays a clean HTTP 402 envelope (no SSE commitment)', async () => {
    await billingAccounts.insert({ _id: 'brokeUser', monthlyBaseTokensUsed: 0, creditBalanceUsd: 0, overageEnabled: false, currentPeriodStart: T0, tokenLimit: 0 } as never);
    const res = await api('/api/v1/llm/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer good:brokeUser:orgA' },
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BILLING_BLOCKED');
  });

  it('upstream non-2xx after commitment becomes ONE in-stream error event carrying the upstream JSON; nothing metered', async () => {
    const upstreamError = { type: 'error', error: { type: 'rate_limit_error', message: 'overloaded upstream' } };
    __setTransportForTests(stubTransport({
      async messages() {
        await sleep(60);
        return { status: 429, headers: { 'content-type': 'application/json' }, body: JSON.stringify(upstreamError) };
      },
    }));
    const res = await api('/api/v1/llm/messages', {
      method: 'POST',
      headers: { 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200); // committed before the upstream failed
    const { frames } = await readSse(res);
    const errors = frames.filter((f) => f.event === 'error');
    expect(errors).toHaveLength(1);
    expect(JSON.parse(errors[0]!.data!)).toEqual(upstreamError);
    expect(await tokenEvents.find({})).toHaveLength(0);
  });

  it('rate-cap trip lands in-stream as rate_limit_error under stream:true; the non-stream sibling keeps HTTP 429', async () => {
    process.env.EKOA_RATECAP_CALLS_PER_USER = '0';
    __resetRateCapsForTests(); // rebuild the limiter from the tightened env
    __setTransportForTests(stubTransport({
      async messages() { return { status: 200, headers: {}, body: providerJsonBody(1, 1) }; },
    }));

    const streamed = await api('/api/v1/llm/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer good:capUser:orgA' },
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(streamed.status).toBe(200);
    const { frames } = await readSse(streamed);
    const errors = frames.filter((f) => f.event === 'error');
    expect(errors).toHaveLength(1);
    const parsed = JSON.parse(errors[0]!.data!) as { error: { type: string } };
    expect(parsed.error.type).toBe('rate_limit_error');

    const plain = await api('/api/v1/llm/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer good:capUser:orgA' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(plain.status).toBe(429);
    const plainBody = (await plain.json()) as { error: { type: string } };
    expect(plainBody.error.type).toBe('rate_limit_error');
    expect(await tokenEvents.find({})).toHaveLength(0);
  });

  it('client abort after the first ping leaves no unhandled rejection and metering still lands', async () => {
    __setTransportForTests(stubTransport({
      async messages() {
        await sleep(150);
        return { status: 200, headers: {}, body: SSE_UPSTREAM_BODY };
      },
    }));
    const ac = new AbortController();
    const resPromise = api('/api/v1/llm/messages', {
      method: 'POST',
      headers: { 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }),
      signal: ac.signal,
    });
    const res = await resPromise;
    const reader = res.body!.getReader();
    await reader.read(); // first ping arrives
    ac.abort();
    await expect(reader.read()).rejects.toThrow();

    // The upstream call was NOT aborted: give it time to complete and meter.
    await sleep(300);
    const rows = await tokenEvents.find({ agentType: 'pi-fast-loop' });
    expect(rows).toHaveLength(1);
  });
});

describe('non-stream path — pinned byte-identical', () => {
  it('forwards the provider body and headers exactly as before (hop-by-hop + content-encoding stripped)', async () => {
    const body = providerJsonBody(200, 40);
    __setTransportForTests(stubTransport({
      async messages() {
        return {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req_s1_pin', 'content-encoding': 'gzip' },
          body,
        };
      },
    }));
    const res = await api('/api/v1/llm/messages', {
      method: 'POST',
      headers: { 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('req_s1_pin');
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.text()).toBe(body);
    expect(await tokenEvents.find({})).toHaveLength(1);
  });
});
