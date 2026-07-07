import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { billingAccounts, tokenEvents } from '../../src/data/stores.js';
import type { Doc } from '../../src/data/store.js';
import {
  recordTokenEvent,
  overagePermitted,
  __resetUsageNotifierForTests,
  type BillingAccountDoc,
  type TokenEventInput,
} from '../../src/billing/tracker.js';
import { __resetBillingConfigForTests, __setBillingConfigForTests } from '../../src/billing/constants.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/** ch06 §6.6.2 bill arithmetic: lazy 30-day reset, credit deduction, the three-switch overage
 *  gate, the hard-limit flag, and CAS no-double-apply under concurrent records. */
let mem: MongoMemoryServer;
const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

async function seedAccount(over: Partial<BillingAccountDoc> = {}): Promise<void> {
  await billingAccounts.insert({
    _id: 'u1', monthlyBaseTokensUsed: 0, creditBalanceUsd: 0, overageEnabled: false,
    currentPeriodStart: T0, tokenLimit: null, ...over,
  } as unknown as Doc);
}
async function acct(): Promise<BillingAccountDoc> {
  return (await billingAccounts.get('u1')) as unknown as BillingAccountDoc;
}
// weight 1 so metered == input (deterministic arithmetic)
const ev = (over: Partial<TokenEventInput> = {}): TokenEventInput => ({
  billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'FAST',
  raw: { input: 100, output: 0, cacheCreate: 0, cacheRead: 0 }, now: T0, ...over,
});

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_bill_arith');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetBillingConfigForTests();
  __resetConfigForTests(); loadConfig();
  loadConfig().llm.tiers.FAST.weight = 1; // weight 1 → metered == raw input (deterministic arithmetic)
  __resetUsageNotifierForTests();
  await billingAccounts.deleteMany({});
  await tokenEvents.deleteMany({});
});

describe('meter accumulation + lazy period reset (§6.6.2)', () => {
  it('accumulates metered into monthlyBaseTokensUsed', async () => {
    await seedAccount();
    await recordTokenEvent(ev({ raw: { input: 100, output: 0, cacheCreate: 0, cacheRead: 0 } }));
    await recordTokenEvent(ev({ raw: { input: 250, output: 0, cacheCreate: 0, cacheRead: 0 }, now: T0 + 1 }));
    expect((await acct()).monthlyBaseTokensUsed).toBe(350);
  });

  it('a record at ≥30d zeroes the meter and advances the period start before adding', async () => {
    await seedAccount({ monthlyBaseTokensUsed: 9999 });
    const now = T0 + 30 * DAY;
    await recordTokenEvent(ev({ raw: { input: 100, output: 0, cacheCreate: 0, cacheRead: 0 }, now }));
    const a = await acct();
    expect(a.monthlyBaseTokensUsed).toBe(100); // reset to 0, then +100
    expect(a.currentPeriodStart).toBe(now);
  });

  it('within the period there is no reset', async () => {
    await seedAccount({ monthlyBaseTokensUsed: 500 });
    await recordTokenEvent(ev({ now: T0 + 29 * DAY }));
    const a = await acct();
    expect(a.monthlyBaseTokensUsed).toBe(600);
    expect(a.currentPeriodStart).toBe(T0);
  });
});

describe('the three-switch overage gate (§6.6.2)', () => {
  it('overagePermitted needs all three: user overage AND global AND NOT hard-limit', () => {
    __setBillingConfigForTests({ hardLimit: true });
    expect(overagePermitted(true, true)).toBe(false); // hard-limit ON blocks everything
    __setBillingConfigForTests({ hardLimit: false });
    expect(overagePermitted(true, true)).toBe(true);
    expect(overagePermitted(false, true)).toBe(false); // user switch off
    expect(overagePermitted(true, false)).toBe(false); // global kill-switch off
  });
});

describe('credit deduction past base (§6.6.2)', () => {
  it('deducts credit only for tokens beyond base when overage is permitted', async () => {
    __setBillingConfigForTests({ hardLimit: false, platformDefaultBase: 1000, creditTokensPerUsd: 100_000 });
    await seedAccount({ tokenLimit: 1000, overageEnabled: true, creditBalanceUsd: 1 });
    // 1500 metered: 500 over base → cost 500/100000 = $0.005 → balance 0.995
    await recordTokenEvent(ev({ raw: { input: 1500, output: 0, cacheCreate: 0, cacheRead: 0 } }));
    const a = await acct();
    expect(a.monthlyBaseTokensUsed).toBe(1500);
    expect(a.creditBalanceUsd).toBeCloseTo(0.995, 6);
  });

  it('hard-limit ON: past-base usage never draws down credit (P-20)', async () => {
    __setBillingConfigForTests({ hardLimit: true, platformDefaultBase: 1000, creditTokensPerUsd: 100_000 });
    await seedAccount({ tokenLimit: 1000, overageEnabled: true, creditBalanceUsd: 1 });
    await recordTokenEvent(ev({ raw: { input: 1500, output: 0, cacheCreate: 0, cacheRead: 0 } }));
    expect((await acct()).creditBalanceUsd).toBe(1); // untouched
  });

  it('within base: no credit deduction even with overage enabled', async () => {
    __setBillingConfigForTests({ hardLimit: false, platformDefaultBase: 10_000, creditTokensPerUsd: 100_000 });
    await seedAccount({ tokenLimit: 10_000, overageEnabled: true, creditBalanceUsd: 1 });
    await recordTokenEvent(ev({ raw: { input: 500, output: 0, cacheCreate: 0, cacheRead: 0 } }));
    expect((await acct()).creditBalanceUsd).toBe(1);
  });
});

describe('CAS no-double-apply under concurrent records', () => {
  it('20 concurrent records each of 100 metered → used lands at exactly 2000', async () => {
    await seedAccount();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        recordTokenEvent(ev({ raw: { input: 100, output: 0, cacheCreate: 0, cacheRead: 0 }, now: T0 + i })),
      ),
    );
    expect((await acct()).monthlyBaseTokensUsed).toBe(2000);
    expect(await tokenEvents.find({ billeeUserId: 'u1' })).toHaveLength(20);
  });
});
