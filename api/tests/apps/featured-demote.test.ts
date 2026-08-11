import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, artifacts, slugs } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { seedFeaturedArtifacts } from '../../src/apps/featured-seeder.js';
import { appRegistry } from '../../src/apps/app-registry.js';
import { __resetSlugIndexForTests } from '../../src/apps/slug-index.js';
import {
  demoteFeaturedArtifact,
  planDemotion,
  ArtifactNotFoundError,
  NotAFeaturedSeedError,
  NoLiveSuperAdminError,
} from '../../src/apps/featured-demote.js';

/**
 * WS10 Stage B: featured-artifact demotion (mechanism only - which ids to demote is a
 * Stage A ledger concern, not this suite's). Verifies the full round trip against a real
 * (fixture-rooted) catalog dir + in-memory mongo: materialise -> flip the row -> register/
 * build -> remove the asset dir - and, critically, that the demotion actually SURVIVES a
 * reboot of the featured seeder (the two bugs the module's header comment documents:
 * re-seed resurrecting `featured`, and the orphan sweep deleting a half-demoted row).
 */
let mem: MongoMemoryServer;
let fixtureRoot: string;
let sandboxRootDir: string;
let buildsRoot: string;

async function mkFeaturedFixture(id: string, opts: { featuredRank?: number } = {}) {
  const dir = join(fixtureRoot, id);
  await mkdir(join(dir, 'scaffold', 'frontend', 'src'), { recursive: true });
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({ id, name: `App ${id}`, featuredRank: opts.featuredRank ?? 3, version: '1.0.0' }),
  );
  await writeFile(
    join(dir, 'scaffold', 'manifest.json'),
    JSON.stringify({
      id,
      name: `App ${id}`,
      version: '1.0.0',
      type: 'jsx-app',
      entryPoint: 'frontend/src/index.jsx',
      outputDir: 'dist/',
    }),
  );
  await writeFile(
    join(dir, 'scaffold', 'frontend', 'src', 'index.jsx'),
    `document.getElementById('root').textContent = '${id}';`,
  );
  return dir;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  process.env.EKOA_SCREENSHOTS_DISABLED = '1';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_featured_demote');
  fixtureRoot = await mkdtemp(join(tmpdir(), 'ekoa-featured-demote-'));
  sandboxRootDir = await mkdtemp(join(tmpdir(), 'ekoa-sandbox-'));
  buildsRoot = await mkdtemp(join(tmpdir(), 'ekoa-featured-builds-'));
  process.env.SANDBOX_ROOT = sandboxRootDir;
  process.env.EKOA_FEATURED_BUILDS_DIR = buildsRoot;
  // featuredArtifactDir()/featuredArtifactsDir() (featured-seeder.ts) - which
  // featured-demote.ts reuses as-is, same as every other apps/ sibling module - have no
  // override PARAMETER, only this env var. seedFeaturedArtifacts(fixtureRoot) below takes
  // an explicit override for its own dir-scan loop, but demoteFeaturedArtifact/planDemotion
  // resolve the asset dir the same way production does: unconditionally through this env
  // var (or the real repo path when unset). Point it at the fixture root for the whole file.
  process.env.EKOA_FEATURED_ARTIFACTS_DIR = fixtureRoot;
}, 120_000);

afterAll(async () => {
  await appRegistry.stop();
  await closeMongo();
  await mem.stop();
  for (const d of [fixtureRoot, sandboxRootDir, buildsRoot]) await rm(d, { recursive: true, force: true });
  delete process.env.SANDBOX_ROOT;
  delete process.env.EKOA_FEATURED_BUILDS_DIR;
  delete process.env.EKOA_FEATURED_ARTIFACTS_DIR;
  delete process.env.EKOA_SCREENSHOTS_DISABLED;
});

beforeEach(async () => {
  __resetSlugIndexForTests();
  await appRegistry.stop();
  for (const s of [users, artifacts, slugs]) await s.deleteMany({});
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(fixtureRoot, { recursive: true });
  await rm(sandboxRootDir, { recursive: true, force: true });
  await mkdir(sandboxRootDir, { recursive: true });
});

describe('featured-artifact demotion (WS10 Stage B)', () => {
  it('refuses without a live super-admin', async () => {
    await mkFeaturedFixture('feat-noadmin');
    await seedFeaturedArtifacts(fixtureRoot);
    await expect(demoteFeaturedArtifact('feat-noadmin')).rejects.toBeInstanceOf(NoLiveSuperAdminError);
    await expect(planDemotion('feat-noadmin')).rejects.toBeInstanceOf(NoLiveSuperAdminError);
  });

  it('refuses an unknown id, and a non-featured/already-demoted id', async () => {
    await users.insert({ _id: 'sa1', username: 'admin', passwordHash: 'x', role: 'super-admin', orgId: 'org0', active: true });
    await expect(demoteFeaturedArtifact('does-not-exist')).rejects.toBeInstanceOf(ArtifactNotFoundError);

    await artifacts.insert({
      _id: 'ordinary',
      name: 'Ordinary',
      userId: 'u1',
      orgId: 'org0',
      visibility: 'private',
      featured: false,
    } as never);
    await expect(demoteFeaturedArtifact('ordinary')).rejects.toBeInstanceOf(NotAFeaturedSeedError);
  });

  it('plan is read-only: no fs writes, no db writes', async () => {
    await users.insert({ _id: 'sa1', username: 'admin', passwordHash: 'x', role: 'super-admin', orgId: 'org0', active: true });
    await mkFeaturedFixture('feat-plan');
    await seedFeaturedArtifacts(fixtureRoot);

    const plan = await planDemotion('feat-plan');
    expect(plan.currentOwner.userId).toBe('sa1');
    expect(plan.newOwner.userId).toBe('sa1');
    expect(plan.targetDirAlreadyExists).toBe(false);
    expect(existsSync(join(fixtureRoot, 'feat-plan'))).toBe(true); // asset dir untouched
    expect(existsSync(plan.targetDir)).toBe(false); // nothing copied
    const row = await artifacts.get('feat-plan');
    expect(row!.featured).toBe(true); // row untouched
  });

  it('demotes: materialises the scaffold, flips the row, registers+builds, removes the asset dir', async () => {
    await users.insert({ _id: 'sa1', username: 'admin', passwordHash: 'x', role: 'super-admin', orgId: 'org0', active: true });
    await mkFeaturedFixture('feat-demote', { featuredRank: 9 });
    await seedFeaturedArtifacts(fixtureRoot);

    const result = await demoteFeaturedArtifact('feat-demote');
    expect(result.built).toBe(true);
    expect(result.assetDirRemoved).toBe(true);
    expect(result.newOwner.userId).toBe('sa1');

    // Row: ordinary artifact now - featured off, no rank, no seed markers, owned by the admin.
    const row = await artifacts.get('feat-demote');
    expect(row!.featured).toBe(false);
    expect(row!.featuredRank).toBeUndefined();
    expect('featuredRank' in row!).toBe(false); // truly dropped, not just undefined
    expect(row!.userId).toBe('sa1');
    expect(row!.orgId).toBe('org0');
    const data = row!.data as Record<string, unknown>;
    expect(data.seededFrom).toBeUndefined();
    expect('seededFrom' in data).toBe(false);
    expect(data.seededVersion).toBeUndefined();
    expect(data.projectDir).toBe(result.targetDir);

    // Files actually landed in the sandbox, byte-identical to the scaffold source.
    expect(existsSync(join(result.targetDir, 'frontend', 'src', 'index.jsx'))).toBe(true);
    const copied = await readFile(join(result.targetDir, 'frontend', 'src', 'index.jsx'), 'utf-8');
    expect(copied).toContain('feat-demote');

    // Asset dir gone from disk (both the scaffold and its parent manifest).
    expect(existsSync(join(fixtureRoot, 'feat-demote'))).toBe(false);

    // Registered + servable from the new sandbox dir.
    const app = appRegistry.getApp('feat-demote');
    expect(app).toBeTruthy();
    expect(app!.projectDir).toBe(result.targetDir);
    expect(app!.userId).toBe('sa1');

    // Slug untouched (same id, same slug - never re-slugged).
    expect((await slugs.get('feat-demote'))!.artifactId).toBe('feat-demote');
  }, 30_000);

  it('SURVIVES a reboot of the featured seeder: featured does not get re-flipped, and the row is not swept as an orphan', async () => {
    await users.insert({ _id: 'sa1', username: 'admin', passwordHash: 'x', role: 'super-admin', orgId: 'org0', active: true });
    await mkFeaturedFixture('feat-survive');
    await seedFeaturedArtifacts(fixtureRoot);
    await demoteFeaturedArtifact('feat-survive');

    // Re-run the exact boot-time seeder against the (now demoted-id-missing) fixture root.
    const reboot = await seedFeaturedArtifacts(fixtureRoot);
    expect(reboot.orphansRemoved).toBe(0); // not swept - it no longer carries the marker

    const row = await artifacts.get('feat-survive');
    expect(row).toBeTruthy(); // still exists
    expect(row!.featured).toBe(false); // NOT resurrected as featured
  }, 30_000);

  it('orphan-sweep contrast: a still-featured seeded row IS swept when its asset dir vanishes; a demoted row is NOT', async () => {
    await users.insert({ _id: 'sa1', username: 'admin', passwordHash: 'x', role: 'super-admin', orgId: 'org0', active: true });
    await mkFeaturedFixture('feat-still-featured');
    await mkFeaturedFixture('feat-demoted-then-gone');
    await seedFeaturedArtifacts(fixtureRoot);
    await demoteFeaturedArtifact('feat-demoted-then-gone'); // already removes ITS OWN asset dir

    // Manually vanish the OTHER (still-featured, untouched) artifact's asset dir - simulating
    // whatever external reason a featured artifact's source might disappear, unrelated to demotion.
    await rm(join(fixtureRoot, 'feat-still-featured'), { recursive: true, force: true });

    const reboot = await seedFeaturedArtifacts(fixtureRoot);
    expect(reboot.orphansRemoved).toBe(1); // the still-featured one, and ONLY that one
    expect(await artifacts.get('feat-still-featured')).toBeNull(); // swept - it carried the marker
    expect(await artifacts.get('feat-demoted-then-gone')).toBeTruthy(); // NOT swept - already demoted
  }, 30_000);

  it('a second demotion attempt on an already-demoted id is refused, not silently re-applied', async () => {
    await users.insert({ _id: 'sa1', username: 'admin', passwordHash: 'x', role: 'super-admin', orgId: 'org0', active: true });
    await mkFeaturedFixture('feat-twice');
    await seedFeaturedArtifacts(fixtureRoot);
    await demoteFeaturedArtifact('feat-twice');

    await expect(demoteFeaturedArtifact('feat-twice')).rejects.toBeInstanceOf(NotAFeaturedSeedError);
  }, 30_000);

  it('reassigns ownership when the row is currently owned by the seeder\'s "system" placeholder', async () => {
    // No live super-admin at seed time -> the seeder falls back to userId/orgId "system".
    await mkFeaturedFixture('feat-system-owned');
    await seedFeaturedArtifacts(fixtureRoot);
    let row = await artifacts.get('feat-system-owned');
    expect(row!.userId).toBe('system');

    // An admin shows up later.
    await users.insert({ _id: 'sa1', username: 'admin', passwordHash: 'x', role: 'super-admin', orgId: 'org0', active: true });
    const result = await demoteFeaturedArtifact('feat-system-owned');
    expect(result.newOwner.userId).toBe('sa1');
    row = await artifacts.get('feat-system-owned');
    expect(row!.userId).toBe('sa1');
    expect(row!.orgId).toBe('org0');
  }, 30_000);
});
