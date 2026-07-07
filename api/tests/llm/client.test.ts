import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { tokenEvents } from '../../src/data/stores.js';
import {
  runOneShot,
  completeFast,
  LlmAbortedError,
  __setTransportForTests,
  __resetTransportForTests,
  type ChokepointTransport,
  type RawUsage,
} from '../../src/llm/client.js';
import { decideForTier } from '../../src/llm/router.js';
import { meteringAnomalyCount, __resetAttributionCountersForTests, type LlmAttribution } from '../../src/llm/attribution.js';
import { setCredential, __resetCredentialsForTests, __setRefreshFnForTests, __setNowForTests } from '../../src/llm/credentials.js';
import { LlmRateCapError, setOrgResolver, __resetOrgResolverForTests } from '../../src/llm/client.js';
import { __resetRateCapsForTests } from '../../src/billing/rate-caps.js';
import { setPlatformBilleeResolver, __resetPlatformBilleeForTests } from '../../src/billing/tracker.js';

/**
 * Chokepoint entries + the single metering point (ch06 §6.5.1), exercised end-to-end against
 * the REAL in-memory billing seam (recordTokenEvent writes a token_events row). The transport
 * is stubbed so no live model is hit. Covers: metering fires with the right tier/attribution,
 * attribution is required, the platform-call alarm, typed abort (+ P-19 reported-usage
 * billing), and refresh-and-retry-once on 401.
 */
let mem: MongoMemoryServer;
const T0 = 1_800_000_000_000;

/** A fake transport whose behaviour each test sets. */
function fakeTransport(over: Partial<ChokepointTransport>): ChokepointTransport {
  const base: ChokepointTransport = {
    async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
    async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
    async messages() { return { status: 200, headers: {}, body: '{}' }; },
  };
  return { ...base, ...over };
}

const bodyWithUsage = (u: Partial<{ input: number; output: number; cacheCreate: number; cacheRead: number }>, text = 'ok') =>
  JSON.stringify({
    content: [{ type: 'text', text }],
    usage: {
      input_tokens: u.input ?? 0,
      output_tokens: u.output ?? 0,
      cache_creation_input_tokens: u.cacheCreate ?? 0,
      cache_read_input_tokens: u.cacheRead ?? 0,
    },
  });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_llm_client');
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
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EKOA_RATECAP_CALLS_PER_USER;
  __resetRateCapsForTests();
});

describe('rate/spend caps are ENFORCED at the chokepoint (§6.6.4) - not inert', () => {
  it('trips the per-user call cap: the (cap+1)th call throws LlmRateCapError and is NOT recorded', async () => {
    process.env.EKOA_RATECAP_CALLS_PER_USER = '2';
    __resetRateCapsForTests();
    __setTransportForTests(fakeTransport({
      async messages() { return { status: 200, headers: {}, body: bodyWithUsage({ input: 10, output: 5 }) }; },
    }));
    const attr: LlmAttribution = { kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: 'capped' };
    await completeFast({ messages: [{ role: 'user', content: 'a' }] }, attr);
    await completeFast({ messages: [{ role: 'user', content: 'b' }] }, attr);
    // The third exceeds the per-user cap of 2 -> blocked before the call, no ledger row.
    await expect(completeFast({ messages: [{ role: 'user', content: 'c' }] }, attr)).rejects.toBeInstanceOf(LlmRateCapError);
    expect(await tokenEvents.find({ billeeUserId: 'capped' })).toHaveLength(2);
  });

  it('a blocked call does not accrue spend (the block itself never extends the window)', async () => {
    process.env.EKOA_RATECAP_CALLS_PER_USER = '1';
    __resetRateCapsForTests();
    __setTransportForTests(fakeTransport({
      async messages() { return { status: 200, headers: {}, body: bodyWithUsage({ input: 10, output: 5 }) }; },
    }));
    const attr: LlmAttribution = { kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: 'once' };
    await completeFast({ messages: [{ role: 'user', content: 'a' }] }, attr);
    await expect(completeFast({ messages: [{ role: 'user', content: 'b' }] }, attr)).rejects.toBeInstanceOf(LlmRateCapError);
    await expect(completeFast({ messages: [{ role: 'user', content: 'c' }] }, attr)).rejects.toBeInstanceOf(LlmRateCapError);
    // Exactly one admitted call was ever metered.
    expect(await tokenEvents.find({ billeeUserId: 'once' })).toHaveLength(1);
  });
});

describe('platform / empty billee ledgers against the platform admin, never "" (§6.3 rule 3)', () => {
  it('resolves an empty billee to the injected platform-admin id', async () => {
    setPlatformBilleeResolver(async () => 'admin-1');
    __setTransportForTests(fakeTransport({
      async oneShot() { return { text: 'x', usage: { input: 20, output: 10, cacheCreate: 0, cacheRead: 0 } }; },
    }));
    // A classifier call with an empty billee stands in for gateway-key / platform traffic.
    await runOneShot({ prompt: 'p', decision: decideForTier('FAST') }, { kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: '' });
    expect(await tokenEvents.find({ billeeUserId: '' })).toHaveLength(0);
    expect(await tokenEvents.find({ billeeUserId: 'admin-1' })).toHaveLength(1);
  });
});

describe('single metering point fires with the right tier + attribution', () => {
  it('completeFast (FAST) records one token_events row billed to the user', async () => {
    __setTransportForTests(fakeTransport({
      async messages() { return { status: 200, headers: {}, body: bodyWithUsage({ input: 100, output: 50 }) }; },
    }));
    const attribution: LlmAttribution = { kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: 'u1' };
    const res = await completeFast({ messages: [{ role: 'user', content: 'hi' }] }, attribution);
    expect(res.text).toBe('ok');

    const rows = await tokenEvents.find({ billeeUserId: 'u1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attributionKind: 'classifier',
      agentType: 'classify-tui-turn',
      tier: 'FAST',
      model: 'claude-haiku-4-5-20251001',
      metered: 3, // round(0.02 * (100+50)) = 3
    });
    expect((rows[0]!.raw as RawUsage)).toEqual({ input: 100, output: 50, cacheCreate: 0, cacheRead: 0 });
  });

  it('runOneShot (EXPERT) meters at the decision tier and stamps user_work correlation ids', async () => {
    __setTransportForTests(fakeTransport({
      async oneShot() { return { text: 'done', usage: { input: 1000, output: 200, cacheCreate: 0, cacheRead: 0 } }; },
    }));
    const attribution: LlmAttribution = { kind: 'user_work', agentType: 'automation-plan', billeeUserId: 'u2', runId: 'run9', sessionId: 'sess9' };
    const res = await runOneShot({ prompt: 'plan', decision: decideForTier('EXPERT') }, attribution);
    expect(res.text).toBe('done');

    const rows = await tokenEvents.find({ billeeUserId: 'u2' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tier: 'EXPERT', agentType: 'automation-plan', runId: 'run9', sessionId: 'sess9', metered: 480 }); // round(0.4*1200)
  });
});

describe('attribution is required (§6.10 rule 3)', () => {
  it('rejects a call constructed without attribution (runtime guard)', async () => {
    __setTransportForTests(fakeTransport({}));
    // @ts-expect-error — attribution is a required positional parameter; omitting it is a compile error.
    await expect(completeFast({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/required attribution/);
  });
});

describe('platform-call alarm at the chokepoint (§6.3 rule 3)', () => {
  it('increments the metering-anomaly counter on a platform-attributed call (never dropped)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    __setTransportForTests(fakeTransport({
      async messages() { return { status: 200, headers: {}, body: bodyWithUsage({ input: 10, output: 5 }) }; },
    }));
    expect(meteringAnomalyCount()).toBe(0);
    await completeFast({ messages: [{ role: 'user', content: 'x' }] }, { kind: 'platform', agentType: 'overhead', justification: 'defect probe' });
    expect(meteringAnomalyCount()).toBe(1);
    // Not dropped: an event is still ledgered (against the platform admin, empty billee).
    expect(await tokenEvents.find({ attributionKind: 'platform' })).toHaveLength(1);
  });
});

describe('abort is fixed by construction (§6.2.1, P-19)', () => {
  it('completeFast rejects LlmAbortedError on abort and bills nothing when no usage was reported', async () => {
    __setTransportForTests(fakeTransport({
      async messages(p) {
        if (p.signal?.aborted) throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
        return { status: 200, headers: {}, body: bodyWithUsage({ input: 1, output: 1 }) };
      },
    }));
    const ac = new AbortController();
    ac.abort();
    await expect(
      completeFast({ messages: [{ role: 'user', content: 'x' }], signal: ac.signal }, { kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: 'u3' }),
    ).rejects.toBeInstanceOf(LlmAbortedError);
    expect(await tokenEvents.find({ billeeUserId: 'u3' })).toHaveLength(0);
  });

  it('runOneShot bills the reported usage up to the abort, THEN rejects LlmAbortedError (P-19)', async () => {
    __setTransportForTests(fakeTransport({
      async oneShot() { return { text: '', usage: { input: 30, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: true }; },
    }));
    await expect(
      runOneShot({ prompt: 'x', decision: decideForTier('WORKHORSE') }, { kind: 'user_work', agentType: 'chat', billeeUserId: 'u4' }),
    ).rejects.toBeInstanceOf(LlmAbortedError);
    const rows = await tokenEvents.find({ billeeUserId: 'u4' });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.raw as RawUsage).input).toBe(30); // reported usage billed
  });
});

describe('refresh-and-retry-once on 401 (§6.2.1 completeFast)', () => {
  it('forces one refresh on a 401 and retries with the new secret', async () => {
    const refresh = vi.fn(async () => ({ secret: 'fresh', expiresAt: T0 + 60 * 60 * 1000 }));
    __setRefreshFnForTests(refresh);
    const secrets: string[] = [];
    __setTransportForTests(fakeTransport({
      async messages(p) {
        secrets.push(p.secret);
        if (secrets.length === 1) return { status: 401, headers: {}, body: '' };
        return { status: 200, headers: {}, body: bodyWithUsage({ input: 5, output: 2 }) };
      },
    }));
    const res = await completeFast({ messages: [{ role: 'user', content: 'x' }] }, { kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: 'u5' });
    expect(res.status).toBe(200);
    expect(secrets).toEqual(['tok', 'fresh']); // first stale, retry with refreshed secret
    expect(refresh).toHaveBeenCalledOnce();
    expect(await tokenEvents.find({ billeeUserId: 'u5' })).toHaveLength(1);
  });
});
