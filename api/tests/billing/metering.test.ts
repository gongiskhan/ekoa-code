import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { tokenEvents, billingAccounts } from '../../src/data/stores.js';
import {
  computeMetered,
  recordTokenEvent,
  __resetUsageNotifierForTests,
  type TokenEventInput,
} from '../../src/billing/tracker.js';
import { __resetBillingConfigForTests } from '../../src/billing/constants.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * ch06 §6.5.2 metering formula + §6.5.3 ledger shape. The metered total is a single round over
 * the weighted sum; `tierWeight` is snapshotted onto the event so historical events re-total
 * identically forever even if the weight config changes (§6.5.2).
 */
let mem: MongoMemoryServer;
const T0 = 1_700_000_000_000;
const base = (over: Partial<TokenEventInput> = {}): TokenEventInput => ({
  billeeUserId: 'u1',
  attributionKind: 'user_work',
  agentType: 'build',
  model: 'claude-opus-4-8[1m]',
  tier: 'EXPERT',
  raw: { input: 200_000, output: 30_000, cacheCreate: 0, cacheRead: 800_000 },
  now: T0,
  ...over,
});

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_bill_met');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetBillingConfigForTests();
  __resetConfigForTests(); loadConfig(); // fresh weights (config.llm) each test
  __resetUsageNotifierForTests();
  await tokenEvents.deleteMany({});
  await billingAccounts.deleteMany({});
});

describe('metering formula (§6.5.2)', () => {
  it('the normative worked example: EXPERT 200k in / 30k out / 800k cacheRead → 172000', () => {
    expect(computeMetered('EXPERT', { input: 200_000, output: 30_000, cacheCreate: 0, cacheRead: 800_000 })).toBe(172_000);
  });

  it('weights and cache factor: FAST 0.02, WORKHORSE 0.1, cacheRead at 0.25× the weight', () => {
    // FAST: 0.02 * (1000+0+0) + 0.02*0.25*0 = 20
    expect(computeMetered('FAST', { input: 1000, output: 0, cacheCreate: 0, cacheRead: 0 })).toBe(20);
    // WORKHORSE cacheCreate billed at full weight, cacheRead at quarter: 0.1*(0+0+1000) + 0.1*0.25*1000 = 100 + 25 = 125
    expect(computeMetered('WORKHORSE', { input: 0, output: 0, cacheCreate: 1000, cacheRead: 1000 })).toBe(125);
  });

  it('rounds the whole weighted sum once (not per-component)', () => {
    // FAST 0.02 * (7) = 0.14 → rounds to 0; add cacheRead 0.02*0.25*300 = 1.5 → total 1.64 → 2
    expect(computeMetered('FAST', { input: 7, output: 0, cacheCreate: 0, cacheRead: 300 })).toBe(2);
  });

  it('unknown tier throws (no default-weight bucket — conflict 12 deleted)', () => {
    expect(() => computeMetered('BOGUS' as never, { input: 1, output: 1, cacheCreate: 0, cacheRead: 0 })).toThrow();
  });
});

describe('ledger event (§6.5.3) + tierWeight snapshot', () => {
  it('writes exactly one token_events doc with the §6.5.3 shape and returns { metered }', async () => {
    const { metered } = await recordTokenEvent(base({ sessionId: 's1', runId: 'r1', artifactId: 'a1' }));
    expect(metered).toBe(172_000);
    const rows = await tokenEvents.find({ billeeUserId: 'u1' });
    expect(rows).toHaveLength(1);
    const e = rows[0] as Record<string, unknown>;
    expect(e).toMatchObject({
      billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'build',
      artifactId: 'a1', sessionId: 's1', runId: 'r1',
      model: 'claude-opus-4-8[1m]', tier: 'EXPERT', tierWeight: 0.4, metered: 172_000, timestamp: T0,
    });
    expect(e.raw).toEqual({ input: 200_000, output: 30_000, cacheCreate: 0, cacheRead: 800_000 });
  });

  it('the snapshot is load-bearing: a weight change does not re-total an already-written event', async () => {
    await recordTokenEvent(base()); // EXPERT @ 0.4 → 172000
    loadConfig().llm.tiers.EXPERT.weight = 0.8; // operator re-prices mid-period
    await recordTokenEvent(base({ now: T0 + 1 })); // EXPERT @ 0.8 → 344000
    const rows = (await tokenEvents.find({ billeeUserId: 'u1' }, { timestamp: 1 })) as unknown as Array<{ tierWeight: number; metered: number }>;
    expect(rows[0]!.tierWeight).toBe(0.4);
    expect(rows[0]!.metered).toBe(172_000);
    expect(rows[1]!.tierWeight).toBe(0.8);
    expect(rows[1]!.metered).toBe(344_000);
  });
});
