import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { billingAccounts } from '../../src/data/stores.js';
import type { Doc } from '../../src/data/store.js';
import { checkAllowance } from '../../src/billing/allowance.js';
import type { BillingAccountDoc } from '../../src/billing/tracker.js';
import { BLOCKED_MESSAGE, BILLING_PAGE_URL, __resetBillingConfigForTests, __setBillingConfigForTests } from '../../src/billing/constants.js';

/** ch06 §6.6.3 pre-run allowance gate. Period-budget admission only; the activation checks are
 *  owned elsewhere and NOT duplicated here. */
let mem: MongoMemoryServer;
const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

async function seed(over: Partial<BillingAccountDoc>): Promise<void> {
  await billingAccounts.insert({
    _id: 'u1', monthlyBaseTokensUsed: 0, creditBalanceUsd: 0, overageEnabled: false,
    currentPeriodStart: T0, tokenLimit: null, ...over,
  } as unknown as Doc);
}

beforeAll(async () => { mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_bill_allow'); }, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetBillingConfigForTests();
  __setBillingConfigForTests({ platformDefaultBase: 1000 });
  await billingAccounts.deleteMany({});
});

describe('checkAllowance verdict (§6.6.3)', () => {
  it('under base → ok (no message)', async () => {
    await seed({ tokenLimit: 1000, monthlyBaseTokensUsed: 500 });
    expect(await checkAllowance('u1', T0)).toEqual({ ok: true });
  });

  it('a brand-new user (no account) → ok, base available', async () => {
    expect((await checkAllowance('newbie', T0)).ok).toBe(true);
  });

  it('base exhausted + hard-limit ON → blocked with the PT-PT message and billingUrl', async () => {
    __setBillingConfigForTests({ hardLimit: true });
    await seed({ tokenLimit: 1000, monthlyBaseTokensUsed: 1000, overageEnabled: true, creditBalanceUsd: 100 });
    const v = await checkAllowance('u1', T0);
    expect(v).toEqual({ ok: false, message: BLOCKED_MESSAGE, billingUrl: BILLING_PAGE_URL });
  });

  it('base exhausted + overage permitted + credits → ok', async () => {
    __setBillingConfigForTests({ hardLimit: false, creditTokensPerUsd: 100_000 });
    await seed({ tokenLimit: 1000, monthlyBaseTokensUsed: 1000, overageEnabled: true, creditBalanceUsd: 1 });
    expect((await checkAllowance('u1', T0)).ok).toBe(true);
  });

  it('base exhausted + overage permitted but NO credits → blocked', async () => {
    __setBillingConfigForTests({ hardLimit: false, creditTokensPerUsd: 100_000 });
    await seed({ tokenLimit: 1000, monthlyBaseTokensUsed: 1000, overageEnabled: true, creditBalanceUsd: 0 });
    expect((await checkAllowance('u1', T0)).ok).toBe(false);
  });

  it('a read at a period boundary resets the meter (persisted) → previously-blocked user is admitted', async () => {
    __setBillingConfigForTests({ hardLimit: true });
    await seed({ tokenLimit: 1000, monthlyBaseTokensUsed: 1000 });
    const v = await checkAllowance('u1', T0 + 30 * DAY);
    expect(v.ok).toBe(true);
    const a = (await billingAccounts.get('u1')) as unknown as BillingAccountDoc;
    expect(a.monthlyBaseTokensUsed).toBe(0);
    expect(a.currentPeriodStart).toBe(T0 + 30 * DAY);
  });
});
