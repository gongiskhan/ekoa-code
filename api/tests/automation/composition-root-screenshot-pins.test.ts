/**
 * THE COMPOSITION ROOT'S SCREENSHOT-RETENTION BINDING, under test.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
 *
 * Slice S1 landed two halves and nothing that joined them:
 *
 *   - `pinnedRunIdsForRetention` (the evidence store) was pinned by the isolation suite;
 *   - the sweeper's pin guard (`screenshot-plane.ts`) was pinned by `screenshot-plane.test.ts`;
 *   - the ONE production line that puts them together lived inside `bootState`, which was entered
 *     by NO test at all.
 *
 * Deleting `pinnedRunIds` from that call left 46/46 green. The consequence of that mutant shipping
 * is not a missing feature: every automation-backed evidence row would keep pointing at directories
 * the sweep had removed, so the detail page renders broken images and the "last validated run" a
 * promotion to `trusted` rests on stops being inspectable - silently, seven days later.
 *
 * ── WHAT CLOSES IT ───────────────────────────────────────────────────────────────────────────
 *
 * Two things, because neither alone is enough.
 *
 *   1. STRUCTURAL. `sweepExpiredScreenshots`'s `pinnedRunIds` option is REQUIRED, so dropping it or
 *      renaming it stops compiling. That kills the literal mutant measured above.
 *   2. THIS FILE, because the compiler cannot tell `pinnedRunIds: new Set()` from the real pin set.
 *      It enters at the REAL `bootState` - the production line itself, not a re-composition of it -
 *      against the real `integration_action_evidence` collection and a real screenshot tree, and
 *      asserts by CONSEQUENCE: after boot, a pinned run's directory is still on disk and an
 *      equally-expired unpinned one is gone.
 *
 * This is the approach `composition-root-action-seam.test.ts` and `composition-root-locality.test.ts`
 * established for the other seams this repo binds once and can silently lose.
 *
 * ── WHAT THIS FILE DOES *NOT* PIN, STATED SO NOBODY BUILDS ON THE WRONG CLAIM ────────────────
 *
 * NOT THE `await`. `bootState` awaits the sweep, and the round-two notes here, in `server.ts` and in
 * the decisions entry all presented that await as what makes the sweep observable. It is not: boot
 * goes on to await slower things afterwards, so `void sweep(...)` still finishes before any case
 * here looks at the tree. The mutation left 5/5 green - the pass was a race that happened to win,
 * not an assertion. The await is correct and it is now pinned where it CAN be pinned, structurally:
 * `bootState` READS the returned counts, so `void` has no `.removed` and the mutant stops compiling.
 * What this file pins is the ARGUMENT and its consequence, which is a smaller and true claim.
 *
 * ── THE FIXTURE IS BUILT SO ONLY THE PIN CAN PRODUCE THE RESULT ──────────────────────────────
 *
 * Both run directories carry the SAME long-ago mtime, so both are equally expired and any rule other
 * than the pin removes both (or neither). The unpinned one is asserted REMOVED in the same case, so
 * a sweeper that had simply stopped deleting cannot pass.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationActionEvidence } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import { actionEvidenceStore } from '../../src/integrations/action-evidence-store.js';
import { bootState, sweepScreenshotsSparingPinnedEvidence } from '../../src/server.js';

let mem: MongoMemoryServer;
let dataDir: string;

const AUTOMATION = 'aut-1';
const PINNED_RUN = 'run-pinned-by-evidence';
const LOOSE_RUN = 'run-nobody-points-at';
const LONG_AGO = new Date('2020-01-01T00:00:00Z');

const ORG = 'orgA';
const OWNER = 'u-owner';
const KEY = 'portal-probe';
const ACTION = 'consultar_processo';

const runDir = (runId: string) => join(dataDir, 'automation-runs', AUTOMATION, runId);

/** Two equally-expired runs on disk. Only one of them will be named by an evidence row. */
function seedTree(): void {
  for (const runId of [PINNED_RUN, LOOSE_RUN]) {
    mkdirSync(runDir(runId), { recursive: true });
    writeFileSync(join(runDir(runId), 'step-0.png'), Buffer.from('PNGDATA'));
    utimesSync(runDir(runId), LONG_AGO, LONG_AGO);
  }
}

/** The row that does the pinning: an automation-backed sample, which stores POINTERS into a run. */
async function seedPinningEvidence(runId = PINNED_RUN): Promise<void> {
  await actionEvidenceStore.recordEvidence(
    { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION },
    {
      backingType: 'browser-steps',
      shape: 'shape-1',
      evidence: {
        kind: 'automation',
        runId,
        status: 'completed',
        steps: [{ stepIndex: 0, screenshotUrl: `/automation-screenshots/${AUTOMATION}/${runId}/step-0.png` }],
      },
    },
  );
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'k';
  process.env.JWT_SECRET ??= 's';
  dataDir = mkdtempSync(join(tmpdir(), 'ekoa-pins-'));
  // BOTH roots, and they are different settings: `EKOA_DATA_DIR` is the platform's, and
  // `EKOA_AUTOMATION_DATA_DIR` is the one `automationRunsRoot()` reads. Pointing them at a temp dir
  // is what keeps a real `bootState` from touching the developer's own ~/.ekoa tree.
  process.env.EKOA_DATA_DIR = dataDir;
  process.env.EKOA_AUTOMATION_DATA_DIR = dataDir;
  __resetConfigForTests();
  __resetAutomationConfigForTests();
  loadConfig();
  mem = await createMem();
  // `bootState` calls `connectMongo()` with NO arguments, so it resolves the target from the
  // environment exactly as production does. Connecting here first under the same uri + database
  // means the rows seeded below are the rows boot then reads.
  process.env.MONGODB_URI = mem.getUri();
  await connectMongo(mem.getUri(), 'ekoa');
}, 120_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  rmSync(dataDir, { recursive: true, force: true });
  __resetConfigForTests();
  __resetAutomationConfigForTests();
});

beforeEach(async () => {
  await integrationActionEvidence.deleteMany({});
  rmSync(join(dataDir, 'automation-runs'), { recursive: true, force: true });
  seedTree();
});

describe('bootState sweeps expired screenshots WITH the evidence pins', () => {
  it('spares the run an evidence row points at, and removes the equally-expired one it does not', async () => {
    await seedPinningEvidence();

    await bootState();

    // THE BINDING, asserted by consequence. Without the `pinnedRunIds` argument crossing from the
    // evidence store into the sweeper, both directories are equally expired and both go.
    expect(existsSync(runDir(PINNED_RUN))).toBe(true);
    expect(existsSync(runDir(LOOSE_RUN))).toBe(false);
  }, 180_000);

  it('with NO evidence at all, boot sweeps both - so "spared" is the pin and not a dead sweeper', async () => {
    // The CONTROL. The same tree, the same boot, no rows: everything expired is removed, which is
    // what makes the case above a statement about the pin rather than about the sweep being off.
    await bootState();

    expect(existsSync(runDir(PINNED_RUN))).toBe(false);
    expect(existsSync(runDir(LOOSE_RUN))).toBe(false);
  }, 180_000);
});

/**
 * The same composition, entered directly.
 *
 * `bootState` above proves the production LINE. These cases prove the function's own decisions
 * without paying for a full boot, and one of them is a decision only reachable here: a pin read that
 * FAILS must degrade to "pin nothing" and never to an exception that takes down boot - and the sweep
 * must still be safe to run in that state.
 */
describe('sweepScreenshotsSparingPinnedEvidence - the composition itself', () => {
  it('reports what it spared and what it removed', async () => {
    await seedPinningEvidence();

    const result = await sweepScreenshotsSparingPinnedEvidence(() => Date.now());

    expect(result).toEqual({ removed: 1, scanned: 2, pinned: 1, evidenceRemoved: 0 });
    expect(existsSync(runDir(PINNED_RUN))).toBe(true);
  });

  it('a SUPERSEDED evidence row releases its pin, and the old run is swept on the next boot', async () => {
    // This is what bounds the retention extension. The pin follows the LIVE row, so a newly
    // validated run releases the previous one in the same write - it does not accumulate with run
    // volume, and a run stops being exempt the moment nothing points at it.
    await seedPinningEvidence(PINNED_RUN);
    await seedPinningEvidence(LOOSE_RUN);

    const result = await sweepScreenshotsSparingPinnedEvidence(() => Date.now());

    expect(result).toEqual({ removed: 1, scanned: 2, pinned: 1, evidenceRemoved: 0 });
    expect(existsSync(runDir(LOOSE_RUN))).toBe(true);
    expect(existsSync(runDir(PINNED_RUN))).toBe(false);
  });

  /**
   * ROUND FOUR - THE RETENTION SWEEP RUNS FIRST, AND THE ORDER IS THE CLAIM.
   *
   * An evidence row that ages out releases its screenshot pin. Reading the pins BEFORE sweeping the
   * evidence would spare that run for one more boot, so the retention rule would be a little bit
   * longer than it says it is - the sort of drift nobody notices because it only ever shows up as
   * one extra day of a client-portal session on disk. The composition therefore sweeps evidence,
   * THEN reads the pins, THEN sweeps the tree, and this case is what distinguishes the two orders:
   * the pinning row is expired, so the run it pins survives only if the pin was read first.
   */
  it('an EXPIRED evidence row releases its pin on the SAME boot, not the next one', async () => {
    await seedPinningEvidence();
    const [row] = await integrationActionEvidence.find({});
    await integrationActionEvidence.update(row!._id, (cur) => ({ ...cur, validatedAt: '2020-01-01T00:00:00.000Z' }));

    const result = await sweepScreenshotsSparingPinnedEvidence(() => Date.parse('2026-08-20T00:00:00.000Z'));

    expect(result).toEqual({ removed: 2, scanned: 2, pinned: 0, evidenceRemoved: 1 });
    expect(existsSync(runDir(PINNED_RUN))).toBe(false);
    expect(await integrationActionEvidence.find({})).toEqual([]);
  });

  it('a retention sweep that THROWS never becomes a throw of its own, and the screenshot sweep still runs', async () => {
    // Same posture as the pin read below: a mongo blip at boot must not fail boot, and must not
    // turn into the one failure mode that destroys data (an UNPINNED sweep).
    await seedPinningEvidence();
    const original = actionEvidenceStore.sweepExpiredEvidence.bind(actionEvidenceStore);
    actionEvidenceStore.sweepExpiredEvidence = async () => { throw new Error('mongo is unhappy'); };
    try {
      await expect(sweepScreenshotsSparingPinnedEvidence(() => Date.now()))
        .resolves.toEqual({ removed: 1, scanned: 2, pinned: 1, evidenceRemoved: 0 });
      expect(existsSync(runDir(PINNED_RUN))).toBe(true);
    } finally {
      actionEvidenceStore.sweepExpiredEvidence = original;
    }
  });

  it('a pin read that THROWS degrades to pinning nothing, and never to a throw of its own', async () => {
    // A mongo blip at boot must not fail boot. It must also not be the one failure mode that
    // destroys data quietly - which is why the degrade is asserted here rather than assumed: the
    // sweep still runs, and everything expired still goes.
    const original = actionEvidenceStore.pinnedRunIdsForRetention.bind(actionEvidenceStore);
    actionEvidenceStore.pinnedRunIdsForRetention = async () => { throw new Error('mongo is unhappy'); };
    try {
      await expect(sweepScreenshotsSparingPinnedEvidence(() => Date.now()))
        .resolves.toEqual({ removed: 2, scanned: 2, pinned: 0, evidenceRemoved: 0 });
    } finally {
      actionEvidenceStore.pinnedRunIdsForRetention = original;
    }
  });
});
