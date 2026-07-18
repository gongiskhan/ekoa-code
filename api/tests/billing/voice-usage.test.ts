import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { usageEvents, tokenEvents, billingAccounts } from '../../src/data/stores.js';
import type { Doc } from '../../src/data/store.js';
import {
  recordUsageCounters,
  recordTokenEvent,
  __resetUsageNotifierForTests,
  type UsageCountersInput,
  type BillingAccountDoc,
} from '../../src/billing/tracker.js';
import { __resetBillingConfigForTests } from '../../src/billing/constants.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * Mega-run C2 - the billing-truth sibling of arithmetic.test.ts for the NON-TOKEN usage
 * ledger (BRIEF §5, decided): voice_stt_ms + voice_tts_chars per org per session as SEPARATE
 * counters through the single metering writer (billing/tracker.ts), with NO token conversion -
 * voice usage must never move the token meter, the credit balance, or token_events, and must
 * land attributed to the right org + user. The schema is the shared surface Part D's
 * assistant-turn metering extends (one coherent schema: new counter = new key, same writer).
 */
let mem: MongoMemoryServer;
const T0 = 1_700_000_000_000;

const voice = (over: Partial<UsageCountersInput> = {}): UsageCountersInput => ({
  orgId: 'orgA',
  billeeUserId: 'u1',
  sessionId: 'sess-1',
  source: 'voice',
  counters: { voice_stt_ms: 61_500, voice_tts_chars: 87 },
  now: T0,
  ...over,
});

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_bill_voice');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetBillingConfigForTests();
  __resetConfigForTests(); loadConfig();
  loadConfig().llm.tiers.FAST.weight = 1; // metered == raw input in the mixed-workload test
  __resetUsageNotifierForTests();
  await usageEvents.deleteMany({});
  await tokenEvents.deleteMany({});
  await billingAccounts.deleteMany({});
});

describe('recordUsageCounters: separate voice counters, attributed, keyed org+session', () => {
  it('records both counters SEPARATELY on one org+session record with org+user attribution', async () => {
    const res = await recordUsageCounters(voice());
    expect(res.recorded).toBe(true);
    const rows = await usageEvents.find({ orgId: 'orgA' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: 'voice:orgA:sess-1',
      orgId: 'orgA',
      billeeUserId: 'u1',
      sessionId: 'sess-1',
      source: 'voice',
      counters: { voice_stt_ms: 61_500, voice_tts_chars: 87 },
      timestamp: T0,
    });
  });

  it('counters land on the RIGHT org: two orgs, two sessions, no cross-attribution', async () => {
    await recordUsageCounters(voice());
    await recordUsageCounters(voice({
      orgId: 'orgB', billeeUserId: 'u2', sessionId: 'sess-2',
      counters: { voice_stt_ms: 1000, voice_tts_chars: 5 },
    }));
    const a = await usageEvents.find({ orgId: 'orgA' });
    const b = await usageEvents.find({ orgId: 'orgB' });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.counters).toEqual({ voice_stt_ms: 61_500, voice_tts_chars: 87 });
    expect(b[0]!.counters).toEqual({ voice_stt_ms: 1000, voice_tts_chars: 5 });
    expect(b[0]!.billeeUserId).toBe('u2');
  });

  it('re-recording the same session upserts (idempotent close), never duplicates', async () => {
    await recordUsageCounters(voice({ counters: { voice_stt_ms: 500 } }));
    await recordUsageCounters(voice({ counters: { voice_stt_ms: 800, voice_tts_chars: 3 } }));
    const rows = await usageEvents.find({ sessionId: 'sess-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.counters).toEqual({ voice_stt_ms: 800, voice_tts_chars: 3 });
  });

  it('sanitises: non-finite and non-positive amounts are dropped; a zero-usage session writes NOTHING', async () => {
    const res = await recordUsageCounters(voice({
      counters: { voice_stt_ms: 0, voice_tts_chars: -5, bogus: Number.NaN, worse: Infinity },
    }));
    expect(res.recorded).toBe(false);
    expect(await usageEvents.find({})).toHaveLength(0);
    // fractional ms are rounded, not truncated away
    await recordUsageCounters(voice({ counters: { voice_stt_ms: 1000.4 } }));
    expect((await usageEvents.find({}))[0]!.counters).toEqual({ voice_stt_ms: 1000 });
  });
});

describe('billing truth: voice counters NEVER convert into token math (BRIEF §5, decided)', () => {
  it('voice usage writes no token_events row and never touches the token meter or credit', async () => {
    await billingAccounts.insert({
      _id: 'u1', monthlyBaseTokensUsed: 250, creditBalanceUsd: 1, overageEnabled: true,
      currentPeriodStart: T0, tokenLimit: null,
    } as unknown as Doc);
    await recordUsageCounters(voice());
    expect(await tokenEvents.find({})).toHaveLength(0);
    const acct = (await billingAccounts.get('u1')) as unknown as BillingAccountDoc;
    expect(acct.monthlyBaseTokensUsed).toBe(250); // untouched
    expect(acct.creditBalanceUsd).toBe(1); // untouched
  });

  it('mixed workload: token arithmetic is IDENTICAL with voice usage recorded alongside it', async () => {
    await recordTokenEvent({
      billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'FAST',
      raw: { input: 100, output: 0, cacheCreate: 0, cacheRead: 0 }, now: T0,
    });
    await recordUsageCounters(voice());
    await recordTokenEvent({
      billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'FAST',
      raw: { input: 250, output: 0, cacheCreate: 0, cacheRead: 0 }, now: T0 + 1,
    });
    const acct = (await billingAccounts.get('u1')) as unknown as BillingAccountDoc;
    expect(acct.monthlyBaseTokensUsed).toBe(350); // exactly the token events, no voice bleed
    expect(await tokenEvents.find({})).toHaveLength(2);
    // and the voice record sits in its own ledger, both counters intact
    const usage = await usageEvents.find({ billeeUserId: 'u1' });
    expect(usage).toHaveLength(1);
    expect(usage[0]!.counters).toEqual({ voice_stt_ms: 61_500, voice_tts_chars: 87 });
  });
});
