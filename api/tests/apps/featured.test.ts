import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, artifacts, slugs } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { seedFeaturedArtifacts, featuredArtifactsDir } from '../../src/apps/featured-seeder.js';
import { buildAndRegisterFeaturedArtifacts } from '../../src/apps/featured-builder.js';
import { appRegistry } from '../../src/apps/app-registry.js';
import { getAppIdBySlug, __resetSlugIndexForTests } from '../../src/apps/slug-index.js';

/**
 * G6 featured pipeline (ch07 §7.13): seeder (idempotent, U1 version
 * reconciliation, orphan sweep) + prebuilder (mirror, bare-import gate,
 * register-even-on-failure). Fixture-rooted; one census test runs against the
 * real in-repo catalog the 37-spec suite serves from.
 */
let mem: MongoMemoryServer;
let fixtureRoot: string;
let buildsRoot: string;
let dataDir: string;

async function mkFeaturedFixture(id: string, opts: { version?: string; entry?: string; extraSource?: string } = {}) {
  const dir = join(fixtureRoot, id);
  await mkdir(join(dir, 'scaffold', 'frontend', 'src'), { recursive: true });
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({ id, name: `App ${id}`, featuredRank: 7, version: opts.version ?? '1.0.0' }),
  );
  await writeFile(
    join(dir, 'scaffold', 'manifest.json'),
    JSON.stringify({ id, name: `App ${id}`, version: '1.0.0', type: 'jsx-app', entryPoint: 'frontend/src/index.jsx', outputDir: 'dist/', sharedData: true }),
  );
  await writeFile(
    join(dir, 'scaffold', 'frontend', 'src', 'index.jsx'),
    opts.extraSource ?? `document.getElementById('root').textContent = '${id}';`,
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
  await connectMongo(mem.getUri(), 'ekoa_featured');
  fixtureRoot = await mkdtemp(join(tmpdir(), 'ekoa-featured-'));
  buildsRoot = await mkdtemp(join(tmpdir(), 'ekoa-featured-builds-'));
  dataDir = await mkdtemp(join(tmpdir(), 'ekoa-data-'));
  process.env.EKOA_FEATURED_BUILDS_DIR = buildsRoot;
  process.env.EKOA_DATA_DIR = dataDir;
}, 120_000);

afterAll(async () => {
  await appRegistry.stop();
  await closeMongo();
  await mem.stop();
  for (const d of [fixtureRoot, buildsRoot, dataDir]) await rm(d, { recursive: true, force: true });
  delete process.env.EKOA_FEATURED_BUILDS_DIR;
  delete process.env.EKOA_DATA_DIR;
  delete process.env.EKOA_SCREENSHOTS_DISABLED;
});

beforeEach(async () => {
  __resetSlugIndexForTests();
  await appRegistry.stop();
  for (const s of [users, artifacts, slugs]) await s.deleteMany({});
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(fixtureRoot, { recursive: true });
});

describe('featured seeder (ch07 §7.13)', () => {
  it('seeds a record per catalog dir (featured, shareable, org-visible, sharedData from the scaffold), idempotently', async () => {
    await users.insert({ _id: 'sa1', username: 'admin', passwordHash: 'x', role: 'super-admin', orgId: 'org0', active: true });
    await mkFeaturedFixture('feat-a');

    const first = await seedFeaturedArtifacts(fixtureRoot);
    expect(first.seeded).toBe(1);
    const row = await artifacts.get('feat-a');
    expect(row).toMatchObject({
      featured: true,
      shareable: true,
      visibility: 'org',
      userId: 'sa1',
      orgId: 'org0',
      slug: 'feat-a',
      sharedData: true,
      featuredRank: 7,
    });
    expect((row!.data as { seededVersion: string }).seededVersion).toBe('1.0.0');
    expect((await slugs.get('feat-a'))!.artifactId).toBe('feat-a');
    expect(getAppIdBySlug('feat-a')).toBe('feat-a');

    const second = await seedFeaturedArtifacts(fixtureRoot);
    expect(second.seeded).toBe(0);
    expect((await artifacts.find({ featured: true })).length).toBe(1);
  });

  it('U1: a customized instance gets updateAvailable on a version bump, never an overwrite; ignoredVersion respected', async () => {
    await mkFeaturedFixture('feat-u1', { version: '1.0.0' });
    await seedFeaturedArtifacts(fixtureRoot);

    // the user customizes it
    await artifacts.update('feat-u1', (a) => ({
      ...a,
      data: { ...(a.data as object), customized: true, seededVersion: '1.0.0' },
    }));

    // a newer manifest ships
    await writeFile(
      join(fixtureRoot, 'feat-u1', 'manifest.json'),
      JSON.stringify({ id: 'feat-u1', name: 'App feat-u1', featuredRank: 7, version: '2.0.0' }),
    );
    await seedFeaturedArtifacts(fixtureRoot);
    let row = await artifacts.get('feat-u1');
    expect((row!.data as { updateAvailable: { version: string } }).updateAvailable).toEqual({ version: '2.0.0' });
    expect((row!.data as { customized: boolean }).customized).toBe(true); // never cleared

    // user ignores it -> the flag is not re-raised for the same version
    await artifacts.update('feat-u1', (a) => ({
      ...a,
      data: { ...(a.data as object), updateAvailable: null, ignoredVersion: '2.0.0' },
    }));
    await seedFeaturedArtifacts(fixtureRoot);
    row = await artifacts.get('feat-u1');
    expect((row!.data as { updateAvailable: unknown }).updateAvailable ?? null).toBeNull();
  });

  it('sweeps orphans it seeded whose source dir disappeared; leaves foreign featured rows alone', async () => {
    await mkFeaturedFixture('feat-gone');
    await artifacts.insert({ _id: 'foreign', name: 'F', userId: 'u', orgId: 'o', visibility: 'org', featured: true } as never);
    await seedFeaturedArtifacts(fixtureRoot);
    expect(await artifacts.get('feat-gone')).toBeTruthy();

    await rm(join(fixtureRoot, 'feat-gone'), { recursive: true, force: true });
    const sweep = await seedFeaturedArtifacts(fixtureRoot);
    expect(sweep.orphansRemoved).toBe(1);
    expect(await artifacts.get('feat-gone')).toBeNull();
    expect(await artifacts.get('foreign')).toBeTruthy(); // not ours - untouched
    expect(await slugs.get('feat-gone')).toBeNull();
  });

  it('census against the real in-repo catalog: the 37-spec legal vertical is present', async () => {
    const real = await seedFeaturedArtifacts();
    expect(real.seeded).toBeGreaterThanOrEqual(40); // 41 catalog apps
    const nucleo = await artifacts.get('legal-nucleo');
    expect(nucleo).toBeTruthy();
    expect(nucleo!.sharedData).toBe(true); // the shared spine opt-in rides the record
    expect(nucleo!.featured).toBe(true);
    expect(existsSync(join(featuredArtifactsDir(), 'legal-nucleo', 'scaffold'))).toBe(true);
  }, 60_000);
});

describe('featured prebuilder (ch07 §7.13)', () => {
  it('mirrors, builds, registers; a second run skips-if-fresh; register survives a build failure', async () => {
    await mkFeaturedFixture('feat-build');
    await seedFeaturedArtifacts(fixtureRoot);

    const first = await buildAndRegisterFeaturedArtifacts(fixtureRoot);
    expect(first.registered).toBe(1);
    expect(first.built).toBe(1);
    const app = appRegistry.getApp('feat-build');
    expect(app).toBeTruthy();
    expect(app!.userId).toBe('system');
    expect(existsSync(join(buildsRoot, 'feat-build', 'dist', 'index.html'))).toBe(true);
    expect(existsSync(join(buildsRoot, 'feat-build', 'dist', 'bundle.js'))).toBe(true);

    const second = await buildAndRegisterFeaturedArtifacts(fixtureRoot);
    expect(second.skipped).toBe(1);
    expect(second.built).toBe(0);
  }, 60_000);

  it('MANDATORY bare-import gate: an unresolvable import is skipped cleanly and the process survives', async () => {
    await mkFeaturedFixture('feat-bare', { extraSource: "import nope from 'definitely-not-a-real-package-xyz';\nnope();" });
    await seedFeaturedArtifacts(fixtureRoot);

    const result = await buildAndRegisterFeaturedArtifacts(fixtureRoot);
    expect(result.failed).toBe(1);
    expect(result.registered).toBe(0);
    expect(appRegistry.getApp('feat-bare')).toBeUndefined();
  }, 60_000);

  it('backend scaffolds get data.projectDir patched to the mirror dir', async () => {
    const dir = await mkFeaturedFixture('feat-be');
    await mkdir(join(dir, 'scaffold', 'backend'), { recursive: true });
    await writeFile(join(dir, 'scaffold', 'backend', 'index.js'), 'export function onMessage() { return 1; }');
    await writeFile(
      join(dir, 'scaffold', 'manifest.json'),
      JSON.stringify({
        id: 'feat-be', name: 'App feat-be', version: '1.0.0', type: 'jsx-app', entryPoint: 'frontend/src/index.jsx', outputDir: 'dist/',
        backend: { entryPoint: 'backend/index.js', handlers: ['onMessage'] },
      }),
    );
    await seedFeaturedArtifacts(fixtureRoot);
    await buildAndRegisterFeaturedArtifacts(fixtureRoot);
    const row = await artifacts.get('feat-be');
    expect((row!.data as { projectDir: string }).projectDir).toBe(join(buildsRoot, 'feat-be'));
    expect(existsSync(join(buildsRoot, 'feat-be', 'dist-backend', 'backend.mjs'))).toBe(true);
  }, 60_000);
});
