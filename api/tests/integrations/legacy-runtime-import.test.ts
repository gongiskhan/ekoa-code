import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions } from '../../src/data/stores.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import {
  importLegacyRuntimePackages,
  LEGACY_RUNTIME_ORG,
} from '../../src/integrations/legacy-runtime-import.js';
import {
  IntegrationDefinitionStore,
  definitionIdFor,
  type IntegrationDefinitionDoc,
} from '../../src/integrations/definition-store.js';
import { resolveDefinition, resolveSkillMd, listDefinitionsFor } from '../../src/integrations/definition-registry.js';

/**
 * Boot scan/import of the frozen legacy runtime tier (slice A3 — Rule 10; REPORT-ONLY default and
 * reversible retirement per the A3 fresh-context review, F1/F2/L1/L2/L3).
 *
 * Proven here, non-tautologically:
 *   - the DEFAULT is REPORT-ONLY: without EKOA_IMPORT_LEGACY_RUNTIME=1 nothing is persisted and
 *     the report names what WOULD be imported (review F2 — a silent boot-time global publish of
 *     author-less packages re-widened what A2 narrowed);
 *   - behind the opt-in, a legacy package IS imported as `visibility:'global'` +
 *     `origin:'legacy-runtime'` and resolvable by BOTH orgs' actors, while a BASELINE key is NOT
 *     imported (assumption 2 + the F1 collision hijack);
 *   - the importer is IDEMPOTENT (second boot: skip, no duplicate, no touch);
 *   - the hash comparator reports DRIFT for a disk file changed after import and NEVER overwrites
 *     the Mongo row (Mongo wins — it may have been edited/republished);
 *   - RETIREMENT IS EXACTLY REVERSIBLE (review F1): after the super-admin demotes an imported row
 *     off `global`, no tenant sees it, but the super-admin STILL reads and writes it — and the
 *     restore (`org` → `global`) puts it back for every org. The pre-review suite stopped BEFORE
 *     the reversibility assertion and thereby pinned the trapdoor as intended behaviour;
 *   - a broken runtime directory lands in the report, never a throw (review L1), a duplicate key
 *     across two directories gets its own distinct reason (review L3), and the importer is NOT on
 *     the integrations barrel (review L2 — its ambient super-admin actor stays boot-only).
 */
let mem: MongoMemoryServer;
let tmp: string;
let runtimeRoot: string;
const savedEnv: Record<string, string | undefined> = {};

const userA: Actor = { userId: 'userA1', orgId: 'orgA', role: 'user' };
const userB: Actor = { userId: 'userB1', orgId: 'orgB', role: 'user' };
const superAdmin: Actor = { userId: 'root', orgId: 'orgA', role: 'super-admin' };

let clock = 0;
const store = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));

const config = (key: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  integrationKey: key,
  displayName: `${key} legacy`,
  description: 'legacy runtime package',
  authType: 'api_key',
  provider: 'X',
  category: 'test',
  configSchema: [],
  actions: [{ actionName: 'ping', description: 'd', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://api.legacy.example', path: '/ping' } }],
  ...over,
});

function writeRuntimePkg(key: string, over: Record<string, unknown> = {}, skillBody = 'LEGACY BODY'): void {
  const dir = join(runtimeRoot, key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config(key, over)));
  writeFileSync(join(dir, 'SKILL.md'), `# ${key}\n${skillBody}\n`);
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-legacyimp-'));
  const baselineDir = join(tmp, 'baseline');
  mkdirSync(join(baselineDir, 'demo-base'), { recursive: true });
  writeFileSync(join(baselineDir, 'demo-base', 'config.json'), JSON.stringify(config('demo-base', { displayName: 'demo-base shipped' })));
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  savedEnv.EKOA_DATA_DIR = process.env.EKOA_DATA_DIR;
  savedEnv.EKOA_IMPORT_LEGACY_RUNTIME = process.env.EKOA_IMPORT_LEGACY_RUNTIME;
  process.env.EKOA_INTEGRATIONS_DIR = baselineDir;
  process.env.EKOA_DATA_DIR = join(tmp, 'data');
  // Most cases exercise the PERSISTING path, which since the F2 fix is the operator opt-in; the
  // report-only DEFAULT has its own cases below (which unset this).
  process.env.EKOA_IMPORT_LEGACY_RUNTIME = '1';
  runtimeRoot = join(tmp, 'data', 'integrations', 'runtime');
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_legacy_import');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  process.env.EKOA_INTEGRATIONS_DIR = savedEnv.EKOA_INTEGRATIONS_DIR;
  process.env.EKOA_DATA_DIR = savedEnv.EKOA_DATA_DIR;
  if (savedEnv.EKOA_IMPORT_LEGACY_RUNTIME === undefined) delete process.env.EKOA_IMPORT_LEGACY_RUNTIME;
  else process.env.EKOA_IMPORT_LEGACY_RUNTIME = savedEnv.EKOA_IMPORT_LEGACY_RUNTIME;
  refreshDefinitions();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  clock = 0;
  await integrationDefinitions.deleteMany({});
  rmSync(runtimeRoot, { recursive: true, force: true });
});

describe('importLegacyRuntimePackages', () => {
  it('imports a legacy package as GLOBAL + legacy-runtime origin, resolvable by every org (zero regression)', async () => {
    writeRuntimePkg('legacy-crm');
    const report = await importLegacyRuntimePackages(store);
    expect(report.imported).toEqual(['legacy-crm']);
    expect(report.errors).toEqual([]);

    const row = (await integrationDefinitions.get(definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm'))) as IntegrationDefinitionDoc | null;
    expect(row).toBeTruthy();
    expect(row!.visibility).toBe('global');
    expect(row!.orgId).toBe(LEGACY_RUNTIME_ORG);
    expect(row!.origin?.kind).toBe('legacy-runtime');
    expect(typeof row!.origin?.importHash).toBe('string');

    // Both orgs resolve it through the registry — exactly the pre-A3 effective visibility —
    // including its knowledge body, which used to be served off the runtime dir.
    for (const who of [userA, userB]) {
      const def = await resolveDefinition(who, 'legacy-crm', store);
      expect(def, who.userId).toBeTruthy();
      expect(def!.displayName).toBe('legacy-crm legacy');
      expect(await resolveSkillMd(who, 'legacy-crm', store), who.userId).toContain('LEGACY BODY');
    }
  });

  it('NEVER imports a package whose key collides with a shipped baseline key (reported, not silent)', async () => {
    writeRuntimePkg('demo-base', { displayName: 'HIJACK ATTEMPT' });
    const report = await importLegacyRuntimePackages(store);
    expect(report.imported).toEqual([]);
    expect(report.drift).toEqual([{ key: 'demo-base', reason: 'baseline-collision' }]);
    expect(await integrationDefinitions.get(definitionIdFor(LEGACY_RUNTIME_ORG, 'demo-base'))).toBeNull();
    // Everyone keeps resolving the SHIPPED package.
    expect((await resolveDefinition(userA, 'demo-base', store))?.displayName).toBe('demo-base shipped');
  });

  it('is IDEMPOTENT: a second boot skips an unchanged package and touches nothing', async () => {
    writeRuntimePkg('legacy-crm');
    await importLegacyRuntimePackages(store);
    const before = (await integrationDefinitions.get(definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm'))) as IntegrationDefinitionDoc;

    const again = await importLegacyRuntimePackages(store);
    expect(again.imported).toEqual([]);
    expect(again.skipped).toEqual(['legacy-crm']);
    expect(again.drift).toEqual([]);

    const after = (await integrationDefinitions.get(definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm'))) as IntegrationDefinitionDoc;
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after).toEqual(before);
  });

  it('a disk file CHANGED after import is reported as drift and the Mongo row is NEVER overwritten', async () => {
    writeRuntimePkg('legacy-crm');
    await importLegacyRuntimePackages(store);

    // The frozen tier changes on disk (someone or something wrote it after the freeze)…
    writeRuntimePkg('legacy-crm', { displayName: 'DISK EDIT AFTER FREEZE' });
    const report = await importLegacyRuntimePackages(store);
    expect(report.drift).toEqual([{ key: 'legacy-crm', reason: 'disk-changed-after-import' }]);
    expect(report.imported).toEqual([]);

    // …and Mongo still holds the ORIGINAL import (the comparator reports, never overwrites).
    const row = (await integrationDefinitions.get(definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm'))) as IntegrationDefinitionDoc;
    expect(row.displayName).toBe('legacy-crm legacy');
  });

  it('MONGO WINS: an imported row edited in Mongo is not clobbered by a later boot', async () => {
    writeRuntimePkg('legacy-crm');
    await importLegacyRuntimePackages(store);
    // A super-admin (the only writer with reach over the sentinel org) edits the row's content.
    await integrationDefinitions.update(definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm'), (cur) => ({
      ...cur,
      displayName: 'edited in Mongo',
    }));

    const report = await importLegacyRuntimePackages(store); // disk unchanged → hash matches → skip
    expect(report.skipped).toEqual(['legacy-crm']);
    const row = (await integrationDefinitions.get(definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm'))) as IntegrationDefinitionDoc;
    expect(row.displayName).toBe('edited in Mongo');
  });

  it('retire ↔ restore is EXACTLY reversible: the retired row stays super-admin-addressable (review F1)', async () => {
    writeRuntimePkg('legacy-crm');
    await importLegacyRuntimePackages(store);
    const id = definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm');

    // A tenant user cannot touch the imported row (it is not their org's; global rows are
    // super-admin-gated in both directions).
    expect((await store.setVisibility(id, userA, 'org')).verdict).toBe('forbidden');
    expect((await resolveDefinition(userA, 'legacy-crm', store))).toBeTruthy();

    // RETIRE: the super-admin demotes it to `org` — confined to the sentinel org, so NO tenant
    // resolves or lists it any more.
    expect((await store.setVisibility(id, superAdmin, 'org')).verdict).toBe('ok');
    expect(await resolveDefinition(userA, 'legacy-crm', store)).toBeNull();
    expect(await resolveDefinition(userB, 'legacy-crm', store)).toBeNull();
    expect((await store.listForActor(userA)).some((d) => d.key === 'legacy-crm')).toBe(false);

    // …but the SUPER-ADMIN still sees it — resolve, store list, AND the registry list (with id +
    // visibility projected, so the E1 sharing surface can address it). The pre-review suite
    // stopped before these assertions: retirement was a one-way trapdoor (list(super)=[],
    // setVisibility → notfound for EVERY actor) recoverable only by DB surgery.
    const retired = await store.getForActor(superAdmin, 'legacy-crm');
    expect(retired?._id).toBe(id);
    expect(retired?.visibility).toBe('org');
    expect((await store.listForActor(superAdmin)).some((d) => d._id === id)).toBe(true);
    const listed = (await listDefinitionsFor(superAdmin, store)).find((d) => d.key === 'legacy-crm');
    expect(listed?.id).toBe(id);
    expect(listed?.visibility).toBe('org');

    // RESTORE: `org` → `global` through the same reviewed surface puts it back for every org.
    expect((await store.setVisibility(id, superAdmin, 'global')).verdict).toBe('ok');
    expect((await resolveDefinition(userA, 'legacy-crm', store))?.displayName).toBe('legacy-crm legacy');
    expect((await resolveDefinition(userB, 'legacy-crm', store))?.displayName).toBe('legacy-crm legacy');
  });

  it('a RETIRED sentinel row never reaches ordinary tenants and never displaces a live resolution', async () => {
    writeRuntimePkg('legacy-crm');
    await importLegacyRuntimePackages(store);
    const id = definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm');
    expect((await store.setVisibility(id, superAdmin, 'org')).verdict).toBe('ok');

    // Ordinary tenants: not resolvable, not listed — the sentinel exception is super-admin only.
    for (const who of [userA, userB]) {
      expect(await resolveDefinition(who, 'legacy-crm', store)).toBeNull();
      expect((await listDefinitionsFor(who, store)).some((d) => d.key === 'legacy-crm')).toBe(false);
    }

    // A LIVE row of the same key wins over the retired one for the super-admin too: the retired
    // row is discoverable, never preferred.
    await store.create(
      {
        orgId: 'orgA', userId: 'root', visibility: 'org', key: 'legacy-crm',
        displayName: 'live orgA row', configSchema: [], actions: [], skillMd: '',
      },
      { actor: superAdmin },
    );
    expect((await store.getForActor(superAdmin, 'legacy-crm'))?.displayName).toBe('live orgA row');
    const listed = (await listDefinitionsFor(superAdmin, store)).filter((d) => d.key === 'legacy-crm');
    expect(listed.length).toBe(1);
    expect(listed[0]!.displayName).toBe('live orgA row');
  });

  it('bad packages land in the report, never throw: keyless config, invalid key, unreadable JSON', async () => {
    const keyless = join(runtimeRoot, 'keyless');
    mkdirSync(keyless, { recursive: true });
    writeFileSync(join(keyless, 'config.json'), JSON.stringify({ displayName: 'no key' }));
    const badkey = join(runtimeRoot, 'badkey');
    mkdirSync(badkey, { recursive: true });
    writeFileSync(join(badkey, 'config.json'), JSON.stringify(config('Bad Key!')));
    const broken = join(runtimeRoot, 'broken');
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, 'config.json'), '{not json');
    writeRuntimePkg('good-one');

    const report = await importLegacyRuntimePackages(store);
    expect(report.imported).toEqual(['good-one']);
    // Problem packages are reported under their DIRECTORY name (the only reliable identity).
    expect(report.errors.map((e) => e.key).sort()).toEqual(['badkey', 'broken', 'keyless']);
  });

  it('a fresh box (no runtime directory) imports nothing and does not fail', async () => {
    const report = await importLegacyRuntimePackages(store);
    expect(report).toEqual({ mode: 'import', imported: [], wouldImport: [], skipped: [], drift: [], errors: [] });
  });

  it('TWO directories declaring the same integrationKey: first wins, second is a DISTINCT duplicate-key report (review L3)', async () => {
    writeRuntimePkg('legacy-crm');
    const second = join(runtimeRoot, 'zz-other-dir');
    mkdirSync(second, { recursive: true });
    writeFileSync(join(second, 'config.json'), JSON.stringify(config('legacy-crm', { displayName: 'SECOND DIR SAME KEY' })));

    const report = await importLegacyRuntimePackages(store);
    expect(report.imported).toEqual(['legacy-crm']);
    // NOT reported as 'disk-changed-after-import' — that reason means the FROZEN tier drifted
    // after an earlier boot's import, and reporting an in-boot duplicate under it sent the
    // operator hunting a freeze violation that never happened.
    expect(report.drift).toEqual([{ key: 'legacy-crm', reason: 'duplicate-key' }]);
    const row = (await integrationDefinitions.get(definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm'))) as IntegrationDefinitionDoc;
    expect(row.displayName).toBe('legacy-crm legacy'); // the first directory's content
  });

  it('an UNREADABLE runtime root lands in the report and never throws — a broken directory must not stop boot (review L1)', async () => {
    // A FILE squatting on the runtime path: existsSync answers true, readdirSync throws ENOTDIR —
    // deterministic on every platform, no permission games.
    mkdirSync(join(tmp, 'data', 'integrations'), { recursive: true });
    writeFileSync(runtimeRoot, 'not a directory');
    try {
      const report = await importLegacyRuntimePackages(store);
      expect(report.imported).toEqual([]);
      expect(report.errors.length).toBe(1);
      expect(report.errors[0]!.key).toBe('<runtime-root>');
      expect(report.errors[0]!.error).toContain('unreadable legacy runtime directory');
    } finally {
      rmSync(runtimeRoot, { force: true });
    }
  });
});

describe('report-only default (review F2 — the boot import must not silently re-widen what A2 narrowed)', () => {
  it('without the operator opt-in NOTHING is persisted; the report names what WOULD be imported', async () => {
    delete process.env.EKOA_IMPORT_LEGACY_RUNTIME;
    try {
      writeRuntimePkg('legacy-crm');
      const report = await importLegacyRuntimePackages(store);
      expect(report.mode).toBe('report-only');
      expect(report.wouldImport).toEqual(['legacy-crm']);
      expect(report.imported).toEqual([]);

      // Nothing landed in Mongo, and NO org resolves the package — the availability cost is taken
      // over the silent global publish (deviation journaled in docs/decisions.md 2026-08-03).
      expect(await integrationDefinitions.get(definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm'))).toBeNull();
      expect(await resolveDefinition(userA, 'legacy-crm', store)).toBeNull();
      expect(await resolveDefinition(userB, 'legacy-crm', store)).toBeNull();
    } finally {
      process.env.EKOA_IMPORT_LEGACY_RUNTIME = '1';
    }
  });

  it('report-only still runs the comparator over ALREADY-imported rows (skip/drift), persisting nothing', async () => {
    writeRuntimePkg('legacy-crm');
    await importLegacyRuntimePackages(store); // opted-in import (env set in beforeAll)
    delete process.env.EKOA_IMPORT_LEGACY_RUNTIME;
    try {
      writeRuntimePkg('legacy-crm', { displayName: 'DISK EDIT AFTER FREEZE' });
      writeRuntimePkg('legacy-new');
      const report = await importLegacyRuntimePackages(store);
      expect(report.mode).toBe('report-only');
      expect(report.drift).toEqual([{ key: 'legacy-crm', reason: 'disk-changed-after-import' }]);
      expect(report.wouldImport).toEqual(['legacy-new']);
      // The drifted row is untouched and the new package was not persisted.
      const row = (await integrationDefinitions.get(definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm'))) as IntegrationDefinitionDoc;
      expect(row.displayName).toBe('legacy-crm legacy');
      expect(await integrationDefinitions.get(definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-new'))).toBeNull();
    } finally {
      process.env.EKOA_IMPORT_LEGACY_RUNTIME = '1';
    }
  });
});

describe('export surface (review L2 — the ambient-authority importer stays boot-only)', () => {
  it('the integrations barrel does NOT re-export importLegacyRuntimePackages', async () => {
    const barrel = await import('../../src/integrations/index.js');
    expect('importLegacyRuntimePackages' in barrel).toBe(false);
  });
});
