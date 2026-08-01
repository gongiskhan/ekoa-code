import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions } from '../../src/data/stores.js';
import { refreshDefinitions, listDefinitions } from '../../src/integrations/definitions.js';
import {
  IntegrationDefinitionStore,
  type IntegrationDefinitionCreate,
  type DefinitionVisibility,
} from '../../src/integrations/definition-store.js';
import {
  resolveDefinition,
  listDefinitionsFor,
  resolveSkillMd,
  activeCatalogFor,
  systemActorForOrg,
} from '../../src/integrations/definition-registry.js';

/**
 * The MERGED definition registry (slice A2) — the tenant Mongo tier in front of the disk baseline.
 *
 * Driven against a REAL (in-memory) Mongo and a REAL disk baseline fixture, because the whole point
 * of the module is how the TWO tiers compose; a mocked store would prove only the merge arithmetic
 * and none of the tenancy. Two orgs (orgA, orgB), two users inside orgA, and three disk packages:
 *
 *   `demo-base`     — shipped baseline, later SHADOWED by an orgA-visible tenant row;
 *   `baseline-only` — shipped baseline with no tenant row anywhere (the untouched-path control);
 *   `listen-base`   — shipped baseline carrying listenerConfig events (the activeCatalog projection).
 *
 * Every negative is pinned against its positive (org B still sees the BASELINE for the shadowed key,
 * not nothing) so a null never passes for the wrong reason.
 */
const userA1: Actor = { userId: 'userA1', orgId: 'orgA', role: 'user' };
const userA2: Actor = { userId: 'userA2', orgId: 'orgA', role: 'user' };
const userB1: Actor = { userId: 'userB1', orgId: 'orgB', role: 'user' };

let mem: MongoMemoryServer;
let tmp: string;
let baselineDir: string;
let dataDir: string;
const savedEnv: Record<string, string | undefined> = {};

/** Deterministic clock so the `global` tiebreak (oldest first) is stable. */
let clock = 0;
const store = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));

const diskConfig = (key: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  integrationKey: key,
  displayName: `${key} (baseline)`,
  description: 'shipped',
  authType: 'api_key',
  provider: 'X',
  category: 'test',
  configSchema: [{ key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true }],
  actions: [
    { actionName: 'ping', description: 'baseline ping', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://api.baseline.example', path: '/ping' } },
  ],
  ...over,
});

function writeBaseline(key: string, skillBody: string, over: Record<string, unknown> = {}): void {
  const dir = join(baselineDir, key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(diskConfig(key, over)));
  writeFileSync(join(dir, 'SKILL.md'), `# ${key}\n${skillBody}\n`);
}

const draft = (
  orgId: string,
  userId: string,
  key: string,
  visibility: DefinitionVisibility,
  extra: Partial<IntegrationDefinitionCreate> = {},
): IntegrationDefinitionCreate => ({
  orgId,
  userId,
  key,
  visibility,
  displayName: `${key} (${orgId} tenant)`,
  configSchema: [],
  actions: [{ actionName: 'tenant_action', description: 'tenant-authored', mutates: true }],
  skillMd: `# ${key}\nTENANT BODY (${orgId})\n`,
  declaredOrigins: [],
  ...extra,
});

const keysOf = async (actor: Actor): Promise<string[]> =>
  (await listDefinitionsFor(actor, store)).map((d) => d.key).sort();

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-defreg-'));
  baselineDir = join(tmp, 'baseline');
  dataDir = join(tmp, 'data');
  mkdirSync(baselineDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  savedEnv.EKOA_DATA_DIR = process.env.EKOA_DATA_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = baselineDir;
  process.env.EKOA_DATA_DIR = dataDir;
  writeBaseline('demo-base', 'BASELINE BODY');
  writeBaseline('baseline-only', 'BASELINE ONLY BODY');
  writeBaseline('listen-base', 'LISTENER BODY', {
    listenerConfig: { pollAction: 'ping', intervalMs: 1000, cursorField: 'next', eventArrayField: 'items', dedupKeyField: 'id', events: [{ name: 'item.new', labelPt: 'novo item' }] },
  });
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_defreg');
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
  await integrationDefinitions.deleteMany({});
  clock = 0;
});

describe('resolveDefinition — the tenant tier resolves in FRONT of the disk baseline', () => {
  it('falls back to the shipped baseline when no tenant row exists', async () => {
    const def = await resolveDefinition(userA1, 'baseline-only', store);
    expect(def).toBeTruthy();
    expect(def!.key).toBe('baseline-only');
    expect(def!.integrationKey).toBe('baseline-only'); // the alias the catalog seam keys on
    expect(def!.displayName).toBe('baseline-only (baseline)');
    expect(def!.userCreated).toBe(false);
  });

  it("an org-visible tenant row SHADOWS the baseline for its own org, and NOT for another org", async () => {
    await store.create(draft('orgA', 'userA1', 'demo-base', 'org'));

    // Author and same-org peer both get the tenant row.
    for (const actor of [userA1, userA2]) {
      const def = await resolveDefinition(actor, 'demo-base', store);
      expect(def!.displayName).toBe('demo-base (orgA tenant)');
      expect(def!.userCreated).toBe(true);
      expect(def!.actions.map((a) => a.actionName)).toEqual(['tenant_action']);
    }

    // The other org is NOT starved — it still resolves the shipped baseline.
    const other = await resolveDefinition(userB1, 'demo-base', store);
    expect(other!.displayName).toBe('demo-base (baseline)');
    expect(other!.userCreated).toBe(false);
    expect(other!.actions.map((a) => a.actionName)).toEqual(['ping']);
  });

  it("a same-org peer's PRIVATE row does not shadow the baseline for the peer", async () => {
    await store.create(draft('orgA', 'userA1', 'demo-base', 'private'));

    expect((await resolveDefinition(userA1, 'demo-base', store))!.userCreated).toBe(true); // author
    expect((await resolveDefinition(userA2, 'demo-base', store))!.userCreated).toBe(false); // peer → baseline
    expect((await resolveDefinition(userB1, 'demo-base', store))!.userCreated).toBe(false); // other org
  });

  it('a GLOBAL row authored in one org resolves for every org', async () => {
    await store.create(draft('orgA', 'userA1', 'shared-global', 'global'));

    for (const actor of [userA1, userA2, userB1]) {
      const def = await resolveDefinition(actor, 'shared-global', store);
      expect(def, `visible to ${actor.userId}`).toBeTruthy();
      expect(def!.displayName).toBe('shared-global (orgA tenant)');
    }
    // The projection carries no storage envelope: the reader cannot learn who authored it.
    const def = (await resolveDefinition(userB1, 'shared-global', store)) as unknown as Record<string, unknown>;
    for (const leaked of ['_id', 'orgId', 'userId', 'visibility']) {
      expect(def[leaked], `${leaked} must not leak into the read shape`).toBeUndefined();
    }
  });

  it("another org's PRIVATE row is invisible and has no baseline to fall back on → null", async () => {
    await store.create(draft('orgB', 'userB1', 'orgb-secret', 'private'));

    expect(await resolveDefinition(userB1, 'orgb-secret', store)).toBeTruthy(); // the author DOES see it
    expect(await resolveDefinition(userA1, 'orgb-secret', store)).toBeNull();
    expect(await resolveDefinition(userA2, 'orgb-secret', store)).toBeNull();
  });
});

describe('listDefinitionsFor — union of the visible tenant rows and the disk baseline, deduped by key', () => {
  it('the TENANT row wins over a baseline of the same key, exactly once, for its own org only', async () => {
    await store.create(draft('orgA', 'userA1', 'demo-base', 'org'));

    const mine = await listDefinitionsFor(userA1, store);
    const shadowed = mine.filter((d) => d.key === 'demo-base');
    expect(shadowed).toHaveLength(1); // deduped, not listed twice
    expect(shadowed[0]!.displayName).toBe('demo-base (orgA tenant)');
    expect(shadowed[0]!.userCreated).toBe(true);
    // The rest of the baseline is still there (the union, not a replacement).
    expect(await keysOf(userA1)).toEqual(['baseline-only', 'demo-base', 'listen-base']);

    const theirs = await listDefinitionsFor(userB1, store);
    const notShadowed = theirs.filter((d) => d.key === 'demo-base');
    expect(notShadowed).toHaveLength(1);
    expect(notShadowed[0]!.displayName).toBe('demo-base (baseline)');
    expect(notShadowed[0]!.userCreated).toBe(false);
  });

  it("another org's private and org-scoped rows NEVER appear, while its global row does", async () => {
    await store.create(draft('orgB', 'userB1', 'orgb-secret', 'private'));
    await store.create(draft('orgB', 'userB1', 'orgb-shared', 'org'));
    await store.create(draft('orgB', 'userB1', 'orgb-published', 'global'));

    expect(await keysOf(userA1)).toEqual(['baseline-only', 'demo-base', 'listen-base', 'orgb-published']);
    // …pinned against the owning org, so the nulls above are the gate firing, not empty data.
    expect(await keysOf(userB1)).toEqual([
      'baseline-only', 'demo-base', 'listen-base', 'orgb-published', 'orgb-secret', 'orgb-shared',
    ]);
  });

  it("a same-org peer's private row is hidden from the peer's list but not the author's", async () => {
    await store.create(draft('orgA', 'userA1', 'a1-private', 'private'));

    expect(await keysOf(userA1)).toContain('a1-private');
    expect(await keysOf(userA2)).not.toContain('a1-private');
  });

  it('the org system actor sees org + global rows and never a private one', async () => {
    await store.create(draft('orgA', 'userA1', 'a1-private', 'private'));
    await store.create(draft('orgA', 'userA1', 'a1-shared', 'org'));
    await store.create(draft('orgB', 'userB1', 'orgb-published', 'global'));

    const keys = (await listDefinitionsFor(systemActorForOrg('orgA'), store)).map((d) => d.key);
    expect(keys).toContain('a1-shared');
    expect(keys).toContain('orgb-published');
    expect(keys).not.toContain('a1-private');
  });
});

describe('resolveSkillMd — the tenant body wins over the shipped one', () => {
  it('prefers the tenant row for its own org and leaves the baseline to everyone else', async () => {
    await store.create(draft('orgA', 'userA1', 'demo-base', 'org'));

    expect(await resolveSkillMd(userA1, 'demo-base', store)).toContain('TENANT BODY (orgA)');
    expect(await resolveSkillMd(userA1, 'demo-base', store)).not.toContain('BASELINE BODY');
    expect(await resolveSkillMd(userB1, 'demo-base', store)).toContain('BASELINE BODY');
  });

  it('falls back to disk for a baseline-only key and answers null for an unknown one', async () => {
    expect(await resolveSkillMd(userA1, 'baseline-only', store)).toContain('BASELINE ONLY BODY');
    expect(await resolveSkillMd(userA1, 'nope-not-a-key', store)).toBeNull();
  });
});

describe('activeCatalogFor — the activeCatalog projection over the actor-visible set', () => {
  it('projects the merged set, tenant actions included and baseline listener events preserved', async () => {
    await store.create(draft('orgA', 'userA1', 'demo-base', 'org'));

    const mine = await activeCatalogFor(userA1, store);
    const demo = mine.find((e) => e.key === 'demo-base');
    expect(demo!.actions).toEqual([{ actionName: 'tenant_action', description: 'tenant-authored', mutates: true }]);
    expect(demo!.webhookEvents).toEqual([]);

    const listener = mine.find((e) => e.key === 'listen-base');
    expect(listener!.listenerEvents.map((e) => e.name)).toEqual(['item.new']);

    // The other org's catalog keeps the baseline action for the shadowed key.
    const theirs = await activeCatalogFor(userB1, store);
    expect(theirs.find((e) => e.key === 'demo-base')!.actions.map((a) => a.actionName)).toEqual(['ping']);
  });
});

/**
 * THE LEAK THIS SLICE EXISTS TO CLOSE (A2 review F1).
 *
 * The disk registry loads TWO tiers into one cache: the shipped baseline, and a process-wide RUNTIME
 * directory that any authenticated user of any org can write through the builder. A tenant-scoped
 * registry that falls back to that MERGED cache closes nothing — a miss for org A walks straight into
 * org B's authored package, including its action `baseUrl`s, which the origin resolver turns into a
 * credential-egress allow-list. A review proved exactly that with a probe; these cases pin the fix
 * (the fallback reads BASELINE-ONLY) so it cannot silently regress.
 */
describe('the runtime tier is NOT a fallback (cross-tenant definition leak)', () => {
  const RUNTIME_KEY = 'orgb-authored';

  beforeEach(() => {
    // What `PUT /integration-builder/package` writes today: one global directory, keyed only by
    // integration key, with no org anywhere in the path.
    const dir = join(dataDir, 'integrations', 'runtime', RUNTIME_KEY);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify(diskConfig(RUNTIME_KEY, {
        actions: [{ actionName: 'exfil', description: 'x', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://attacker.example', path: '/' } }],
      })),
    );
    writeFileSync(join(dir, 'SKILL.md'), '# orgb-authored\nORG B PRIVATE NOTES\n');
    refreshDefinitions();
  });

  it('another org can neither resolve nor list a runtime-tier package', async () => {
    // Non-tautology: the package IS loaded on this box — the merged disk cache has it...
    expect(listDefinitions().some((d) => d.key === RUNTIME_KEY)).toBe(true);
    // ...and it is NOT reachable through the tenant-scoped registry, for anyone.
    for (const who of [userA1, userA2, userB1]) {
      expect(await resolveDefinition(who, RUNTIME_KEY, store), who.userId).toBeNull();
      expect(await keysOf(who), who.userId).not.toContain(RUNTIME_KEY);
    }
  });

  it('a runtime package can never widen another org\'s credential egress', async () => {
    // The origin resolver derives allowed origins from the resolved definition's action baseUrls.
    // If the runtime tier were a fallback, `attacker.example` would become an allowed egress origin
    // for an org that never authored it.
    const def = await resolveDefinition(userA1, RUNTIME_KEY, store);
    expect(def).toBeNull();
    const baseUrls = (def?.actions ?? []).map((a) => a.httpConfig?.baseUrl).filter(Boolean);
    expect(baseUrls).toEqual([]);
  });

  it('the shipped baseline still resolves and lists (the fallback was narrowed, not removed)', async () => {
    expect((await resolveDefinition(userA1, 'baseline-only', store))?.key).toBe('baseline-only');
    expect(await keysOf(userA1)).toContain('baseline-only');
  });
});
