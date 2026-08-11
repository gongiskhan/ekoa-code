import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, knowledgeSources } from '../../src/data/stores.js';
import { seedKnowledgeSources } from '../../src/knowledge/sources-seeder.js';

/**
 * WS8b: idempotent boot seeding of the default Portuguese legal crawl-source METADATA (not a
 * crawl - this build has no crawler; WS8c ports one). Mirrors the shape `featured-seeder.ts`
 * already established: read a versioned JSON asset, own it under the bootstrap super-admin, and
 * make re-seeding at every boot a no-op via a deterministic id.
 */
let mem: MongoMemoryServer;
let dir: string;

async function writeSeed(entries: unknown[]): Promise<string> {
  const path = join(dir, 'sources.seed.json');
  await writeFile(path, JSON.stringify({ version: 1, sources: entries }), 'utf8');
  return path;
}

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_knowledge_sources_seeder');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-sources-seed-'));
  await users.deleteMany({});
  await knowledgeSources.deleteMany({});
});

const FIVE = [
  { seedId: 'pgdlisboa-leis', label: 'PGDL - Legislação', url: 'https://www.pgdlisboa.pt/leis/lei_main.php', collection: 'legislacao', crawlConfig: { levels: 2, maxPages: 3000 } },
  { seedId: 'dgsi', label: 'DGSI - Jurisprudência', url: 'https://www.dgsi.pt', collection: 'jurisprudencia', crawlConfig: { levels: 3, maxPages: 4000 } },
  { seedId: 'dgert-legislacao', label: 'DGERT', url: 'https://www.dgert.gov.pt/legislacao-relevante', collection: 'legislacao-laboral' },
  { seedId: 'act-trabalho', label: 'ACT', url: 'https://portal.act.gov.pt/', collection: 'legislacao-laboral', crawlConfig: { render: true } },
  { seedId: 'diario-republica', label: 'Diário da República', url: 'https://diariodarepublica.pt/', collection: 'legislacao', crawlConfig: { render: true } },
];

describe('seedKnowledgeSources (WS8b)', () => {
  it('no super-admin yet: reads the file (total set) but seeds nothing - next boot retries', async () => {
    const path = await writeSeed(FIVE);
    const res = await seedKnowledgeSources(path);
    expect(res).toEqual({ inserted: 0, skipped: 0, total: 5, orgId: null });
    expect(await knowledgeSources.find({})).toHaveLength(0);
  });

  it('seeds all 5 sources under the bootstrap super-admin org, idempotently on re-run', async () => {
    await users.insert({ _id: 'sa1', username: 'sa1', role: 'super-admin', orgId: 'orgFounder', active: true } as never);
    const path = await writeSeed(FIVE);

    const first = await seedKnowledgeSources(path);
    expect(first).toEqual({ inserted: 5, skipped: 0, total: 5, orgId: 'orgFounder' });
    const rows = await knowledgeSources.find({});
    expect(rows).toHaveLength(5);
    const dgsi = rows.find((r) => (r as unknown as { seedId?: string }).seedId === 'dgsi') as unknown as
      { _id: string; orgId: string; url: string; collection: string; enabled: boolean; crawlConfig?: Record<string, unknown> };
    expect(dgsi._id).toBe('knowledge-seed:orgFounder:dgsi');
    expect(dgsi.orgId).toBe('orgFounder');
    expect(dgsi.url).toBe('https://www.dgsi.pt');
    expect(dgsi.collection).toBe('jurisprudencia');
    expect(dgsi.enabled).toBe(true);
    expect(dgsi.crawlConfig).toEqual({ levels: 3, maxPages: 4000 });

    // Re-run at a second boot: every row already exists (deterministic id) - none duplicated.
    const second = await seedKnowledgeSources(path);
    expect(second).toEqual({ inserted: 0, skipped: 5, total: 5, orgId: 'orgFounder' });
    expect(await knowledgeSources.find({})).toHaveLength(5);
  });

  it('a user later editing/disabling a seeded source is never reinserted or reverted on the next boot', async () => {
    await users.insert({ _id: 'sa1', username: 'sa1', role: 'super-admin', orgId: 'orgFounder', active: true } as never);
    const path = await writeSeed(FIVE);
    await seedKnowledgeSources(path);
    await knowledgeSources.update('knowledge-seed:orgFounder:dgsi', (cur) => ({ ...cur, enabled: false } as never));

    await seedKnowledgeSources(path);
    const dgsi = (await knowledgeSources.get('knowledge-seed:orgFounder:dgsi')) as unknown as { enabled: boolean };
    expect(dgsi.enabled).toBe(false); // the operator's edit survives the reseed
  });

  it('an entry with no seedId is skipped, never inserted', async () => {
    await users.insert({ _id: 'sa1', username: 'sa1', role: 'super-admin', orgId: 'orgFounder', active: true } as never);
    const path = await writeSeed([{ url: 'https://example.pt', collection: 'x' }, ...FIVE]);
    const res = await seedKnowledgeSources(path);
    expect(res).toEqual({ inserted: 5, skipped: 1, total: 6, orgId: 'orgFounder' });
  });

  it('a missing seed file is a graceful no-op, never a throw', async () => {
    await users.insert({ _id: 'sa1', username: 'sa1', role: 'super-admin', orgId: 'orgFounder', active: true } as never);
    const res = await seedKnowledgeSources(join(dir, 'does-not-exist.json'));
    expect(res).toEqual({ inserted: 0, skipped: 0, total: 0, orgId: null });
  });

  it('malformed JSON is a graceful no-op, never a throw', async () => {
    await users.insert({ _id: 'sa1', username: 'sa1', role: 'super-admin', orgId: 'orgFounder', active: true } as never);
    const path = join(dir, 'bad.json');
    await writeFile(path, '{ not valid json', 'utf8');
    const res = await seedKnowledgeSources(path);
    expect(res).toEqual({ inserted: 0, skipped: 0, total: 0, orgId: null });
  });

  it('an inactive super-admin does not count - only an active one seeds', async () => {
    await users.insert({ _id: 'sa1', username: 'sa1', role: 'super-admin', orgId: 'orgFounder', active: false } as never);
    const path = await writeSeed(FIVE);
    const res = await seedKnowledgeSources(path);
    expect(res).toEqual({ inserted: 0, skipped: 0, total: 5, orgId: null });
  });
});
