/**
 * THE ONE RESOLUTION (slice S1, verification round four) - `integrations/action-resolution.ts`.
 *
 * ── WHY THIS MODULE HAS A SUITE OF ITS OWN ────────────────────────────────────────────────────
 *
 * Because three consecutive rounds of S1 answered "which actions can this owner still reach" with a
 * RE-DERIVATION of it, and each re-derivation was wrong on a different axis - and being wrong there
 * deleted tenants' data. The module exists so the question has exactly one answer, shared with
 * `action-executor.ts` itself. This file pins the three axes a re-derivation got wrong, each as a
 * CONTRAST against the thing the wrong answer would have used:
 *
 *   1. LIVE ROW vs FROZEN SNAPSHOT - a consumer of a published definition resolves the snapshot, so
 *      an action org A dropped from its live row is still reachable for org B. `getForActor`'s own
 *      answer is asserted alongside, differing, in the same case.
 *   2. RUNNER vs CUSTODIAN - an org-shared credential resolves the definition as the credential's
 *      custodian and "never as the reader". The reader's own view is asserted EMPTY in the same
 *      case, so "resolves it" cannot be satisfied by the reader seeing it themselves.
 *   3. "COULD NOT FIND OUT" vs "RESOLVES NOTHING" - `null` and the empty set are different answers
 *      and collapsing them is how a Mongo blip becomes silent deletion.
 *
 * Every fixture is built by the PRODUCTION writer: the published row goes through
 * `requestPublish` -> `publishDefinition`, never `create({ visibility: 'global' })`, because a row
 * created straight at `global` has no snapshot and `publishedViewOf` silently falls back to live
 * content - which is precisely the substitution that hid the round-three blocker.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitions, integrationConfigs } from '../../src/data/stores.js';
import {
  integrationDefinitionStore,
  definitionIdFor,
  type IntegrationDefinitionCreate,
} from '../../src/integrations/definition-store.js';
import { saveAuthoredDefinition } from '../../src/integrations/definition-save.js';
import { publishDefinition } from '../../src/integrations/publish-scrub.js';
import { createConfig } from '../../src/integrations/service.js';
import {
  resolvableActionNamesForOwner,
  resolveOwnerActionSurface,
} from '../../src/integrations/action-resolution.js';
import type { IntegrationPackageConfig } from '../../src/integrations/definitions.js';

let mem: MongoMemoryServer;
let seq = 0;
const cfgDeps = { now: () => 1_700_000_000_000, genId: () => `cfg-${++seq}` };

const ORG = 'orgA';
const OTHER_ORG = 'orgB';
const OWNER = 'u-owner';
const PEER = 'u-peer';
const CONSUMER = 'u-consumer';
const KEY = 'portal-probe';
const DOOMED = 'consultar_processo';
const SURVIVOR = 'arquivar_processo';
const author: Actor = { userId: OWNER, orgId: ORG, role: 'user' };
const admin: Actor = { userId: 'u-admin', orgId: ORG, role: 'org-admin' };
const superAdmin: Actor = { userId: 'u-super', orgId: 'org-platform', role: 'super-admin' };
const consumer: Actor = { userId: CONSUMER, orgId: OTHER_ORG, role: 'user' };

const actions = (names: string[]) => names.map((actionName) => ({
  actionName,
  description: `acao ${actionName}`,
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: 'https://portal.example', path: `/${actionName}` },
}));

const definitionRow = (
  names: string[],
  opts: { userId?: string; visibility?: 'private' | 'org' | 'global' } = {},
): IntegrationDefinitionCreate => ({
  orgId: ORG,
  userId: opts.userId ?? OWNER,
  key: KEY,
  visibility: opts.visibility ?? 'org',
  authType: 'api_key',
  configSchema: [],
  actions: actions(names) as IntegrationDefinitionCreate['actions'],
  skillMd: `# ${KEY}\n`,
});

const packageConfig = (names: string[]): IntegrationPackageConfig => ({
  integrationKey: KEY,
  displayName: KEY,
  authType: 'api_key',
  configSchema: [],
  actions: actions(names),
} as unknown as IntegrationPackageConfig);

/** The production publish flow: the author submits, a super-admin publishes, a snapshot is frozen. */
async function publish(): Promise<void> {
  const id = definitionIdFor(ORG, KEY);
  expect((await integrationDefinitionStore.requestPublish(id, author, 'please')).verdict).toBe('ok');
  expect((await publishDefinition(superAdmin, id, { modelPass: null }, integrationDefinitionStore)).verdict).toBe('ok');
}

const names = (owner: { orgId: string; userId: string }) =>
  resolvableActionNamesForOwner(owner.orgId, owner.userId, KEY);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 'test-jwt-secret';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s1_action_resolution');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  __resetConfigForTests();
});

beforeEach(async () => {
  await integrationDefinitions.deleteMany({});
  await integrationConfigs.deleteMany({});
});

describe('axis 1: a consumer resolves the FROZEN SNAPSHOT, not the author\'s live row', () => {
  it('an action dropped from the live row is still reachable for the consuming org', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await publish();

    // The real production sequence for editing a published definition: un-publish, edit, re-promote
    // through the visibility route - which deliberately does NOT re-scrub, so consumers keep reading
    // the artifact a super-admin reviewed.
    const id = definitionIdFor(ORG, KEY);
    expect((await integrationDefinitionStore.setVisibility(id, superAdmin, 'org')).verdict).toBe('ok');
    expect((await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore)).ok).toBe(true);
    expect((await integrationDefinitionStore.setVisibility(id, superAdmin, 'global')).verdict).toBe('ok');

    // THE CONTRAST, in one case. `getForActor` - what three rounds of collector asked - hands back
    // the LIVE row, which no longer names the action…
    const live = await integrationDefinitionStore.getForActor(consumer, KEY);
    expect(live?.actions.map((a) => a.actionName)).toEqual([SURVIVOR]);
    // …while what the consumer actually RESOLVES still does. A retention decision taken on the first
    // answer destroys the evidence of an action the second answer says still runs.
    expect([...(await names(consumer))!].sort()).toEqual([DOOMED, SURVIVOR].sort());
  }, 30_000);

  it('the author\'s OWN org reads its live row, so the two answers differ by tenant and not by luck', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await publish();
    const id = definitionIdFor(ORG, KEY);
    await integrationDefinitionStore.setVisibility(id, superAdmin, 'org');
    await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore);
    await integrationDefinitionStore.setVisibility(id, superAdmin, 'global');

    // Same row, same moment: the owner sees live (`crossOrgView` is a no-op inside the org), the
    // consumer sees the snapshot. That is why the answer cannot be a property of the definition.
    expect([...(await names(author))!]).toEqual([SURVIVOR]);
    expect([...(await names(consumer))!].sort()).toEqual([DOOMED, SURVIVOR].sort());
  }, 30_000);
});

describe('axis 2: an org-shared credential resolves as the CUSTODIAN, never as the reader', () => {
  beforeEach(async () => {
    await integrationDefinitionStore.create(
      definitionRow([DOOMED, SURVIVOR], { userId: admin.userId, visibility: 'private' }),
      { actor: admin },
    );
    // `createConfig` stamps `ownerUserId: undefined` + `custodianUserId` for an org-admin: the legacy
    // ORG-SHARED credential every member with no row of their own resolves.
    await createConfig(admin, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);
  });

  it('the peer resolves the custodian\'s PRIVATE row, which they cannot see for themselves', async () => {
    const peer = { orgId: ORG, userId: PEER };
    // THE CONTRAST: the peer's own view is empty…
    expect(await integrationDefinitionStore.getForActor({ ...peer, userId: PEER, role: 'user' }, KEY)).toBeNull();
    // …and what they resolve is the custodian's, which is what a run of theirs will actually use.
    expect([...(await names(peer))!].sort()).toEqual([DOOMED, SURVIVOR].sort());
    const surface = await resolveOwnerActionSurface(ORG, PEER, KEY);
    expect(surface?.definitionActor).toEqual({ userId: admin.userId, orgId: ORG, role: 'user' });
  });

  it('a peer holding their OWN credential resolves as themselves again', async () => {
    // The control: the custodian branch is the CONFIG's shape talking, not a blanket rule. With a
    // row of their own, `findConfigForOwner` answers it first and the reader is the actor again -
    // and they still cannot see the custodian's private definition.
    await createConfig({ userId: PEER, orgId: ORG, role: 'user' }, { integrationKey: KEY, configValues: { api_key: 'mine' }, secretKeys: ['api_key'] }, cfgDeps);

    const surface = await resolveOwnerActionSurface(ORG, PEER, KEY);
    expect(surface?.definitionActor).toEqual({ userId: PEER, orgId: ORG, role: 'user' });
    expect([...(await names({ orgId: ORG, userId: PEER }))!]).toEqual([]);
  });
});

describe('axis 3: "could not find out" is NEVER "resolves nothing"', () => {
  it('a key that resolves and names no such action answers the EMPTY SET', async () => {
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author });
    const answer = await names(author);
    expect(answer).not.toBeNull();
    expect([...answer!]).toEqual([SURVIVOR]);
  });

  it('an INCOHERENT custodian answers null - a refusal, not an empty reach', async () => {
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author });
    // An org-less reader matches every `global` row (A2 review F4), so "we could not determine the
    // custodian" must never collapse into "resolve as somebody" - or, here, into "reaches nothing".
    expect(await resolvableActionNamesForOwner('', OWNER, KEY)).toBeNull();
    expect(await resolvableActionNamesForOwner(ORG, '', KEY)).toBeNull();
    expect(await resolvableActionNamesForOwner(ORG, OWNER, '')).toBeNull();
    expect(await resolveOwnerActionSurface('', OWNER, KEY)).toBeNull();
  });

  it('a resolver that THROWS answers null, so a mongo blip keeps every row', async () => {
    const answer = await resolvableActionNamesForOwner(ORG, OWNER, KEY, {
      resolve: async () => { throw new Error('mongo is unhappy'); },
    });
    expect(answer).toBeNull();
  });

  it('a CONFIG READ that throws answers null too - the refusal covers both reads', async () => {
    const answer = await resolvableActionNamesForOwner(ORG, OWNER, KEY, {
      findConfig: async () => { throw new Error('mongo is unhappy'); },
    });
    expect(answer).toBeNull();
  });
});
