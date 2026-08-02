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
import { resolveDefinition, resolveSkillMd } from '../../src/integrations/definition-registry.js';

/**
 * Boot import of the frozen legacy runtime tier (slice A3 — RUN_SPEC assumption 3, Rule 10).
 *
 * Proven here, non-tautologically:
 *   - a legacy package IS imported as `visibility:'global'` + `origin:'legacy-runtime'` and stays
 *     resolvable by BOTH orgs' actors (their exact effective visibility before A3 — zero
 *     regression), while a BASELINE key is NOT imported (assumption 2 + the F1 collision hijack);
 *   - the importer is IDEMPOTENT (second boot: skip, no duplicate, no touch);
 *   - the hash comparator reports DRIFT for a disk file changed after import and NEVER overwrites
 *     the Mongo row (Mongo wins — it may have been edited/republished);
 *   - the imported rows are manageable only through the super-admin review surface (closing the
 *     legacy leak later is E1's reviewed action, not a silent break).
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
  process.env.EKOA_INTEGRATIONS_DIR = baselineDir;
  process.env.EKOA_DATA_DIR = join(tmp, 'data');
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

  it('closing the legacy leak is the reviewed super-admin action: demote global → org retires the row', async () => {
    writeRuntimePkg('legacy-crm');
    await importLegacyRuntimePackages(store);
    const id = definitionIdFor(LEGACY_RUNTIME_ORG, 'legacy-crm');

    // A tenant user cannot touch the imported row (it is not their org's; global rows are
    // super-admin-gated in both directions).
    expect((await store.setVisibility(id, userA, 'org')).verdict).toBe('forbidden');
    expect((await resolveDefinition(userA, 'legacy-crm', store))).toBeTruthy();

    // The super-admin demotes it to `org` — confined to the sentinel org, i.e. visible to NO real
    // actor: the leak is closed by review, exactly as assumption 3 planned.
    expect((await store.setVisibility(id, superAdmin, 'org')).verdict).toBe('ok');
    expect(await resolveDefinition(userA, 'legacy-crm', store)).toBeNull();
    expect(await resolveDefinition(userB, 'legacy-crm', store)).toBeNull();
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
    expect(report).toEqual({ imported: [], skipped: [], drift: [], errors: [] });
  });
});
