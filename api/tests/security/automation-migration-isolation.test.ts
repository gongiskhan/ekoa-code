import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { automations } from '../../src/data/stores.js';
import { buildMigrationReport } from '../../src/automation/migration-report.js';

/**
 * Slice S7 - the migration report's TENANCY, in the class of `automation-visibility.test.ts`.
 *
 * The report is a READ over every automation row there is, which makes it exactly the shape of
 * surface that leaks a tenant: one filter forgotten and an operator's convenience becomes a list of
 * another org's automation names. The rule it must obey is not a new one - it is the automation
 * service's own, and this suite pins that the report cannot answer anything `listAutomations` would
 * refuse the same caller:
 *
 *   - ANOTHER ORG'S rows are never scanned, at any visibility.
 *   - A SAME-ORG PEER'S `private` row is invisible, with no org-admin and no super-admin exception -
 *     the report takes a reader id and applies the predicate, it does not take a role.
 *   - ABSENT visibility is NOT private: a legacy row stays org-visible, byte for byte with today.
 *   - THE ESTATE PASS (boot) is the one caller with no reader, and it is also the one caller whose
 *     output is counts.
 *
 * WHAT THIS SUITE DOES NOT PIN, corrected in the review round. Every case here calls
 * `buildMigrationReport` directly, so what it proves is the MODULE'S FILTER ARITHMETIC - that the
 * two scope terms mean what they say. It does NOT prove the route passes them: the first cut's
 * header claimed "a future edit that gave the endpoint the estate scope would still pass every
 * contract test" as if naming the hazard closed it, and it did not - that exact edit stayed green
 * across all 46 tests. The route's argument passing is pinned where it lives, through HTTP, in
 * `api/tests/contract/integrations-migration-report.test.ts`'s "tenancy AT THE ROUTE" describe,
 * which seeds a second org and a same-org peer and shows the rows exist at estate scope before
 * asserting the response omits them. The two suites are two layers of one gate, not one layer twice.
 */
let mem: MongoMemoryServer;

async function seed(id: string, orgId: string, ownerUserId: string, visibility?: 'private' | 'org') {
  await automations.insert({
    _id: id,
    id,
    orgId,
    ownerUserId,
    name: `A ${id}`,
    description: 'goal',
    steps: [{ id: 's1', description: 'call', type: 'api_call', apiRequest: { method: 'GET', url: 'https://api.example.test/v1/x' } }],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...(visibility !== undefined ? { visibility } : {}),
  } as never);
}

const idsFor = async (orgId: string, readerUserId: string) =>
  (await buildMigrationReport({ orgId, readerUserId })).entries.map((e) => e.automationId).sort();

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_migration_isolation');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await automations.deleteMany({});
  await seed('A-own-org', 'orgA', 'ownerA');
  await seed('A-own-private', 'orgA', 'ownerA', 'private');
  await seed('A-peer-org', 'orgA', 'peerA', 'org');
  await seed('A-peer-private', 'orgA', 'peerA', 'private');
  await seed('B-org', 'orgB', 'ownerB', 'org');
  await seed('B-private', 'orgB', 'ownerB', 'private');
});

describe('S7 tenancy - the report can never name a row its caller could not open', () => {
  it('another org is not in the answer, at any visibility', async () => {
    const ids = await idsFor('orgA', 'ownerA');
    expect(ids).not.toContain('B-org');
    expect(ids).not.toContain('B-private');
  });

  it('a same-org peer\'s private row is invisible; their org-shared row is not', async () => {
    const ids = await idsFor('orgA', 'ownerA');
    expect(ids).not.toContain('A-peer-private');
    expect(ids).toContain('A-peer-org');
  });

  it('the caller\'s OWN private row is theirs to see', async () => {
    expect(await idsFor('orgA', 'ownerA')).toContain('A-own-private');
    expect(await idsFor('orgA', 'peerA')).toContain('A-peer-private');
  });

  it('an absent visibility is org-visible, exactly as the automation service reads it', async () => {
    expect(await idsFor('orgA', 'peerA')).toContain('A-own-org');
  });

  it('the two readers of one org get different answers, which is the whole point of the predicate', async () => {
    expect(await idsFor('orgA', 'ownerA')).toEqual(['A-own-org', 'A-own-private', 'A-peer-org']);
    expect(await idsFor('orgA', 'peerA')).toEqual(['A-own-org', 'A-peer-org', 'A-peer-private']);
  });

  it('a reader id that owns nothing sees only what the org shares', async () => {
    expect(await idsFor('orgA', 'strangerA')).toEqual(['A-own-org', 'A-peer-org']);
  });
});

describe('S7 tenancy - the estate pass is a different caller, and it is the one with no names to give out', () => {
  it('the boot scope crosses orgs by design, and the route never asks for it', async () => {
    const estate = await buildMigrationReport();
    expect(estate.entries.map((e) => e.automationId).sort()).toEqual([
      'A-own-org',
      'A-own-private',
      'A-peer-org',
      'A-peer-private',
      'B-org',
      'B-private',
    ]);
    expect(estate.scanned).toBe(6);
  });

  it('an org scope with no reader still refuses the other org: the two filters are independent', async () => {
    const orgOnly = await buildMigrationReport({ orgId: 'orgA' });
    expect(orgOnly.entries.map((e) => e.automationId).sort()).toEqual([
      'A-own-org',
      'A-own-private',
      'A-peer-org',
      'A-peer-private',
    ]);
  });
});
