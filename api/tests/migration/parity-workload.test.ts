import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { tokenEvents, billingAccounts } from '../../src/data/stores.js';
import { __resetUsageNotifierForTests } from '../../src/billing/tracker.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { __resetBillingConfigForTests } from '../../src/billing/constants.js';
import {
  runWorkload,
  checkComposition,
  checkBands,
  EXPECTED_COMPOSITION,
  type Workload,
  type StructuralReport,
} from '../../scripts/parity-workload/workload.js';

/**
 * ch10 §10.4 Part B - scripted parity workload in STRUCTURAL-assertion mode (the phase-10 gate).
 * The fixed workload is driven through the real tracker against memory-mongo with stubbed token
 * counts; the harness asserts the structural invariants (one event per call, correct attribution
 * class + tier-weight snapshot, zero platform-attributed calls, cached replay = zero calls) and
 * the ledger-event census. A platform-mis-attribution variant proves the zero-platform check bites.
 */
const DIR = join(__dirname, '..', '..', 'scripts', 'parity-workload', 'fixtures');
const workload = JSON.parse(readFileSync(join(DIR, 'workload.json'), 'utf8')) as Workload;
const badWorkload = JSON.parse(readFileSync(join(DIR, 'workload-bad-platform.json'), 'utf8')) as Workload;

let mem: MongoMemoryServer;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_parity_workload_test');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetBillingConfigForTests();
  __resetConfigForTests();
  loadConfig(); // default tier weights
  __resetUsageNotifierForTests();
  await tokenEvents.deleteMany({});
  await billingAccounts.deleteMany({});
});

describe('workload composition (§10.4 table)', () => {
  it('is the fixed 10 chat / 4 build / 4 automation / 2 integration-builder / 4 gateway suite', () => {
    expect(checkComposition(workload).ok).toBe(true);
    const counts: Record<string, number> = {};
    for (const op of workload.operations) counts[op.class] = (counts[op.class] ?? 0) + 1;
    expect(counts).toEqual(EXPECTED_COMPOSITION);
  });
});

describe('structural invariants (the gate)', () => {
  let report: StructuralReport;

  beforeEach(async () => {
    report = await runWorkload(workload);
  });

  it('every structural invariant holds', () => {
    for (const inv of report.invariants) expect(inv.ok, `${inv.name}: ${inv.detail}`).toBe(true);
    expect(report.ok).toBe(true);
  });

  it('exactly one ledger event per model call (census)', () => {
    expect(report.totalEvents).toBe(report.totalCalls);
    expect(report.totalEvents).toBe(33);
    for (const op of workload.operations) {
      expect(report.perOperationEvents[op.id] ?? 0, `op ${op.id}`).toBe(op.calls.length);
    }
  });

  it('ZERO platform-attributed calls in these user-facing flows (ch06 call-site fates)', () => {
    expect(report.attributionCensus.platform).toBe(0);
    expect(report.attributionCensus.classifier).toBe(10);
    expect(report.attributionCensus.user_work).toBe(23);
  });

  it('a cached automation replay produces zero model calls', () => {
    expect(report.perOperationEvents['auto-cached-1'] ?? 0).toBe(0);
    const cachedInv = report.invariants.find((i) => i.name === 'cached-replay-zero-model-calls')!;
    expect(cachedInv.ok).toBe(true);
  });

  it('the correct tier weight is snapshotted onto every event', () => {
    const inv = report.invariants.find((i) => i.name === 'correct-tier-weight-snapshot')!;
    expect(inv.ok).toBe(true);
  });
});

describe('the structural checks bite', () => {
  it('flags a platform-mis-attributed call (zero-platform invariant fails)', async () => {
    const report = await runWorkload(badWorkload);
    expect(report.ok).toBe(false);
    const zeroPlatform = report.invariants.find((i) => i.name === 'zero-platform-attribution')!;
    expect(zeroPlatform.ok).toBe(false);
    expect(report.attributionCensus.platform).toBe(1);
  });
});

describe('the documented ±25% live band (not the structural gate)', () => {
  it('checkBands accepts new totals within ±25% of the old stack and rejects gross drift', async () => {
    const report = await runWorkload(workload);
    const near = Object.fromEntries(report.perClass.map((pc) => [pc.class, pc.userWorkTokens]));
    const withinBands = checkBands(report, near);
    expect(withinBands.every((b) => b.withinBand)).toBe(true);

    // A build class total off by 2x is outside the band (catches double-billing).
    const drift = { ...near, build: (near.build as number) * 2 };
    const driftBands = checkBands(report, drift);
    expect(driftBands.find((b) => b.class === 'build')!.withinBand).toBe(false);
  });
});
