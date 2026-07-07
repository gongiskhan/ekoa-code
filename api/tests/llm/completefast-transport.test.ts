import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { tokenEvents } from '../../src/data/stores.js';
import {
  completeFast,
  LlmTransportError,
  __setTransportForTests,
  __resetTransportForTests,
  __resetOrgResolverForTests,
  type ChokepointTransport,
} from '../../src/llm/client.js';
import { __resetAttributionCountersForTests, type LlmAttribution } from '../../src/llm/attribution.js';
import { setCredential, __resetCredentialsForTests, __setNowForTests } from '../../src/llm/credentials.js';
import { __resetRateCapsForTests } from '../../src/billing/rate-caps.js';
import { __resetPlatformBilleeForTests } from '../../src/billing/tracker.js';

/**
 * Finding 4 (§6.5.4 meter-only-on-2xx): completeFast must NOT meter a non-2xx response — a 4xx/5xx
 * carries no billable usage. It throws LlmTransportError WITHOUT writing a ledger row; only a
 * successful, usage-bearing 2xx response meters. The 401 refresh-and-retry-once still runs first.
 */
let mem: MongoMemoryServer;
const T0 = 1_800_000_000_000;

function fakeTransport(over: Partial<ChokepointTransport>): ChokepointTransport {
  const base: ChokepointTransport = {
    async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
    async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
    async messages() { return { status: 200, headers: {}, body: '{}' }; },
  };
  return { ...base, ...over };
}

const bodyWithUsage = (input: number, output: number) =>
  JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });

const attr: LlmAttribution = { kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: 'u1' };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_completefast_transport');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetAttributionCountersForTests();
  __resetTransportForTests();
  __resetCredentialsForTests();
  __resetRateCapsForTests();
  __resetOrgResolverForTests();
  __resetPlatformBilleeForTests();
  __setNowForTests(() => T0);
  for (const c of ['token_events', 'billing_accounts', 'credentials', 'settings', 'users']) {
    await getDb().collection(c).deleteMany({});
  }
  await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: T0 + 60 * 60 * 1000 });
});
afterEach(() => vi.restoreAllMocks());

describe('completeFast meters only a successful 2xx (Finding 4, §6.5.4)', () => {
  it('a 500 throws LlmTransportError and writes NO ledger row (no meter on non-2xx)', async () => {
    __setTransportForTests(fakeTransport({
      async messages() { return { status: 500, headers: {}, body: 'upstream boom' }; },
    }));
    await expect(completeFast({ messages: [{ role: 'user', content: 'x' }] }, attr)).rejects.toBeInstanceOf(LlmTransportError);
    expect(await tokenEvents.find({ billeeUserId: 'u1' })).toHaveLength(0);
  });

  it('a 400 (client error, no 401-refresh path) throws without metering', async () => {
    __setTransportForTests(fakeTransport({
      async messages() { return { status: 400, headers: {}, body: JSON.stringify({ error: 'bad request' }) }; },
    }));
    await expect(completeFast({ messages: [{ role: 'user', content: 'x' }] }, attr)).rejects.toBeInstanceOf(LlmTransportError);
    expect(await tokenEvents.find({ billeeUserId: 'u1' })).toHaveLength(0);
  });

  it('a successful 2xx still meters exactly one row (regression guard on the happy path)', async () => {
    __setTransportForTests(fakeTransport({
      async messages() { return { status: 200, headers: {}, body: bodyWithUsage(100, 50) }; },
    }));
    const res = await completeFast({ messages: [{ role: 'user', content: 'x' }] }, attr);
    expect(res.status).toBe(200);
    const rows = await tokenEvents.find({ billeeUserId: 'u1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tier: 'FAST', metered: 3 }); // round(0.02*(100+50))
  });
});
