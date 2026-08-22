import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { automations } from '../../src/data/stores.js';
import { buildMigrationReport } from '../../src/automation/migration-report.js';

/**
 * Slice S7, review round - the two mechanisms the classifier suite CANNOT drive, because both are
 * properties of the walk over a real store rather than of one row's classification.
 *
 *  1. THE SCAN BOUND (review round F12/F19/F24). The first cut fetched the whole collection and
 *     sliced in JS, and the only "capped" test hand-built a report object and asserted the log
 *     format - so deleting the cap entirely reddened nothing, and after such a deletion production
 *     could never emit the fixture that test fed the formatter. The bound now lives in the query
 *     (`limit: cap + 1`), and these cases drive it: the `cap` seam exists precisely so the mechanism
 *     is reachable without seeding a thousand rows.
 *
 *  2. THE CONTESTED DESTINATION (review round F10, divergence b). A definition row is one per
 *     (org, key) with a single author, so two owners resolving to one destination key cannot both
 *     land on it. That is a fact about the SET of entries, invisible to a per-row classifier.
 *
 * Kept out of `migration-report.test.ts` on purpose: that suite is pure and fast by construction,
 * and adding a database to it to reach two behaviours would slow every case in it.
 */
let mem: MongoMemoryServer;

/** A wrap-tier row (browser step) with a resolvable, non-reserved destination. */
async function seedOne(id: string, ownerUserId: string, destination: string, orgId = 'orgA') {
  await automations.insert({
    _id: id,
    id,
    orgId,
    ownerUserId,
    name: `A ${id}`,
    description: 'goal',
    visibility: 'org',
    source: { integrationKey: destination, templateKey: 't' },
    steps: [{ id: 's1', description: 'click', type: 'browser' }],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: `2026-08-01T00:00:0${id.length % 10}.000Z`,
  } as never);
}

async function seedRows(count: number) {
  await automations.deleteMany({});
  for (let i = 0; i < count; i += 1) await seedOne(`auto-${i}`, 'ownerA', `dest-${i}`);
}

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_migration_scan');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await automations.deleteMany({});
});

describe('S7 review round - the cap bounds the read, and the flag reports what was read', () => {
  it('more rows than the cap: truncated, and exactly cap entries come back', async () => {
    await seedRows(4);
    const report = await buildMigrationReport({}, { cap: 2 });
    expect(report.truncated).toBe(true);
    expect(report.entries).toHaveLength(2);
    expect(report.scanned).toBe(2);
  });

  it('fewer rows than the cap: not truncated, every row classified', async () => {
    await seedRows(2);
    const report = await buildMigrationReport({}, { cap: 5 });
    expect(report.truncated).toBe(false);
    expect(report.entries).toHaveLength(2);
  });

  it('EXACTLY the cap is not truncated, one more is - which is what the cap + 1 read exists to tell apart', async () => {
    await seedRows(3);
    expect((await buildMigrationReport({}, { cap: 3 })).truncated).toBe(false);
    expect((await buildMigrationReport({}, { cap: 2 })).truncated).toBe(true);
  });

  it('an empty estate is not truncated', async () => {
    const report = await buildMigrationReport({}, { cap: 2 });
    expect(report.truncated).toBe(false);
    expect(report.entries).toEqual([]);
  });
});

describe('S7 review round - the bound is IN THE QUERY, which is the only place it bounds anything', () => {
  it('the store honours a limit, so pushing one into the query is a real bound and not a hope', async () => {
    await seedRows(5);
    expect(await automations.find({}, { updatedAt: -1 }, { limit: 2 })).toHaveLength(2);
    expect(await automations.find({}, { updatedAt: -1 })).toHaveLength(5);
  });

  it('the scan asks the DATABASE for at most cap + 1 rows, rather than slicing after the fact', async () => {
    await seedRows(5);
    const find = vi.spyOn(automations, 'find');
    try {
      await buildMigrationReport({}, { cap: 2 });
      expect(find).toHaveBeenCalledTimes(1);
      const opts = find.mock.calls[0]?.[2] as { limit?: number } | undefined;
      // THE CONTROL ITSELF. Truncation bookkeeping stays correct even with an unbounded read, so
      // asserting `truncated` cannot see this regression - only the call shape can. Removing the
      // limit is the mutation this case exists to redden.
      expect(opts?.limit).toBe(3);
    } finally {
      find.mockRestore();
    }
  });

  it('the org filter travels with the limit, so a bounded read is still a scoped one', async () => {
    await seedOne('mine', 'ownerA', 'd1', 'orgA');
    await seedOne('theirs', 'ownerB', 'd2', 'orgB');
    const find = vi.spyOn(automations, 'find');
    try {
      await buildMigrationReport({ orgId: 'orgA' }, { cap: 10 });
      expect(find.mock.calls[0]?.[0]).toEqual({ orgId: 'orgA' });
      expect((find.mock.calls[0]?.[2] as { limit?: number } | undefined)?.limit).toBe(11);
    } finally {
      find.mockRestore();
    }
  });
});

describe('S7 review round - a destination two owners would both land on', () => {
  it('two owners on one destination key: both entries record the contest', async () => {
    await seedOne('a1', 'ownerA', 'shared-dest');
    await seedOne('a2', 'ownerB', 'shared-dest');
    await seedOne('a3', 'ownerA', 'lonely-dest');

    const byId = new Map((await buildMigrationReport({})).entries.map((e) => [e.automationId, e]));
    expect(byId.get('a1')?.degradations).toContain('destination-key-contested');
    expect(byId.get('a2')?.degradations).toContain('destination-key-contested');
    expect(byId.get('a3')?.degradations).not.toContain('destination-key-contested');
  });

  it('ONE owner with two automations on one destination is not contesting it with themselves', async () => {
    await seedOne('a1', 'ownerA', 'shared-dest');
    await seedOne('a2', 'ownerA', 'shared-dest');

    for (const entry of (await buildMigrationReport({})).entries) {
      expect(entry.degradations).not.toContain('destination-key-contested');
    }
  });

  it('a destination that cannot narrow at all is not contested: two owners on a SHIPPED key both land org-wide', async () => {
    // `citius` is a shipped baseline key, so `reservedIntegrationKeys()` covers it and neither row
    // is flagged as narrowing - which is the precondition for contesting.
    await seedOne('a1', 'ownerA', 'citius');
    await seedOne('a2', 'ownerB', 'citius');

    for (const entry of (await buildMigrationReport({})).entries) {
      expect(entry.degradations).not.toContain('org-visible-narrows-to-owner');
      expect(entry.degradations).not.toContain('destination-key-contested');
    }
  });
});
