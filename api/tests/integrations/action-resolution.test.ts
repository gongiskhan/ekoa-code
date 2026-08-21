/**
 * THE ONE RESOLUTION (slice S1) - `integrations/action-resolution.ts`.
 *
 * ── WHAT THIS MODULE ANSWERS, AND WHAT IT NO LONGER ANSWERS ───────────────────────────────────
 *
 * It answers, for ONE call at ONE instant: which package does this run execute against, and as
 * whom. That question is genuinely subtle - three rounds of re-deriving it inside other modules got
 * it wrong on a different axis each time - so it has one implementation, shared with
 * `action-executor.ts` itself, and this file pins the three axes as CONTRASTS against the thing a
 * re-derivation would have used:
 *
 *   1. LIVE ROW vs FROZEN SNAPSHOT - a consumer of a published definition resolves the snapshot, so
 *      an action org A dropped from its live row is still reachable for org B. `getForActor`'s own
 *      answer is asserted alongside, differing, in the same case.
 *   2. RUNNER vs CUSTODIAN - an org-shared credential resolves the definition as the credential's
 *      custodian and "never as the reader". The reader's own view is asserted EMPTY in the same
 *      case, so "resolves it" cannot be satisfied by the reader seeing it themselves.
 *   3. A REFUSAL IS NOT AN EMPTY REACH - `null` means the (reader, config) pair is INCOHERENT and
 *      there is no principal to resolve as. It is a thing the CALLER IS TOLD, and this file pins
 *      that consequence at the executor rather than at the type.
 *
 * ── WHAT ROUND FIVE DELETED FROM THIS FILE, STATED RATHER THAN QUIETLY DROPPED ────────────────
 *
 * The module also exported `resolvableActionNamesForOwner`: the same resolution projected onto the
 * set of action names, answering three ways (`null` = could not find out, empty set = resolves
 * nothing) so a retention decision could not read a Mongo blip as "reaches nothing". Its arm
 * `if (!surface) return null` was an EQUIVALENT MUTANT - substituting `new Set()` there, which would
 * have deleted every row of that owner, left the whole suite green.
 *
 * It is not pinned. It is GONE, with both of its callers: the write-time reconciler and the
 * reader-side collector. The question they asked it - "is this action gone, so may I delete the
 * evidence of it?" - is not answerable synchronously at all, because a correct answer about an
 * instant still governs a row that outlives the instant. Retention is now decided by TTL, by the
 * owner's own DELETE, and by a newer validated run; see `action-evidence-removal.test.ts`.
 *
 * WHAT SURVIVES OF THAT ARM IS ONE TIER DOWN - `resolveOwnerActionSurface`'s own `null`, which the
 * executor turns into a `credential_invalid` REFUSAL. That is pinned below, at the production
 * consequence, because a refusal is something a caller is told and never something that deletes
 * their data.
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
import { resolveOwnerActionSurface } from '../../src/integrations/action-resolution.js';
import { executeUserIntegrationAction } from '../../src/integrations/action-executor.js';
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
/**
 * THE IN-ORG SUPER-ADMIN, and why the bare tier flip below needs one (S6 review round five).
 *
 * `publishSnapshot` now CONSUMES `publishRequest`: the stamp is what opens the cross-org review
 * window (`isDefinitionVisibleTo`), and leaving it standing meant an un-publish silently handed the
 * row back to every platform super-admin on a consent the tenant gave for a publication that had
 * already happened. A consequence, and the right one: after `publish()` + un-publish, `u-super` -
 * who is in `org-platform` - can no longer SEE this org's `org`-tier row, so a bare
 * `setVisibility(..., 'global')` by them answers the uniform `notfound`.
 *
 * The re-promotion below cannot switch to the publish DOOR, because the door re-scrubs and these
 * cases exist to prove the consumer keeps reading the artifact frozen BEFORE the author's edit. So
 * the arrangement uses an actor who can see the row without a standing request - the authoring org's
 * own super-admin - which is also the more honest reading of a bare tier flip that deliberately does
 * not re-scrub: an in-org operation, not a cross-tenant platform act. `integration-publish-scrub.ts`
 * already uses an `inOrgAdmin` for the same reason. NOTHING ASSERTED HERE CHANGED; only who performs
 * the arrangement.
 */
const inOrgSuperAdmin: Actor = { userId: 'u-root', orgId: ORG, role: 'super-admin' };
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

/**
 * What this owner's RUN would execute against, as action names - read off the surface itself rather
 * than through a helper of its own, so no projection sits between the assertion and what the
 * executor reads. `null` is "no coherent principal", which is a different thing from `[]`.
 */
const names = async (owner: { orgId: string; userId: string }): Promise<string[] | null> => {
  const surface = await resolveOwnerActionSurface(owner.orgId, owner.userId, KEY);
  if (!surface) return null;
  return (surface.definition?.actions ?? []).map((a) => a.actionName);
};

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
    expect((await integrationDefinitionStore.setVisibility(id, inOrgSuperAdmin, 'global')).verdict).toBe('ok');

    // THE CONTRAST, in one case. `getForActor` - what three rounds of collector asked - hands back
    // the LIVE row, which no longer names the action…
    const live = await integrationDefinitionStore.getForActor(consumer, KEY);
    expect(live?.actions.map((a) => a.actionName)).toEqual([SURVIVOR]);
    // …while what the consumer actually RESOLVES, and therefore RUNS, still does.
    expect((await names(consumer))!.sort()).toEqual([DOOMED, SURVIVOR].sort());
  }, 30_000);

  it('the author\'s OWN org reads its live row, so the two answers differ by tenant and not by luck', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await publish();
    const id = definitionIdFor(ORG, KEY);
    await integrationDefinitionStore.setVisibility(id, superAdmin, 'org');
    await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore);
    await integrationDefinitionStore.setVisibility(id, inOrgSuperAdmin, 'global');

    // Same row, same moment: the owner sees live (`crossOrgView` is a no-op inside the org), the
    // consumer sees the snapshot. That is why the answer cannot be a property of the definition.
    expect(await names(author)).toEqual([SURVIVOR]);
    expect((await names(consumer))!.sort()).toEqual([DOOMED, SURVIVOR].sort());
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
    expect((await names(peer))!.sort()).toEqual([DOOMED, SURVIVOR].sort());
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
    expect(await names({ orgId: ORG, userId: PEER })).toEqual([]);
  });
});

/**
 * AXIS 3 - `null` IS A REFUSAL, AND THE REFUSAL IS THE ONLY THING IT DECIDES.
 *
 * Round four had a second `null` one tier up, in `resolvableActionNamesForOwner`, whose whole job
 * was to stop a retention decision reading "could not find out" as "reaches nothing". Nobody covered
 * its arm and substituting `new Set()` for it - a mutant that deletes every row of that owner - left
 * 240/240 green. That function is deleted (see this file's header), so the arm below is the one that
 * remains, and it is pinned WHERE IT ACTS: at the executor, where it becomes a coded refusal handed
 * to the caller.
 */
describe('axis 3: an INCOHERENT (reader, config) pair is a refusal, not an empty reach', () => {
  it('a key that resolves and names no such action answers a real, EMPTY list', async () => {
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author });
    const surface = await resolveOwnerActionSurface(ORG, OWNER, KEY);
    // The surface EXISTS - a coherent principal, a resolved package - and simply has one action.
    expect(surface).not.toBeNull();
    expect(surface!.definition?.actions.map((a) => a.actionName)).toEqual([SURVIVOR]);
  });

  it('an org-less reader answers null - there is no principal to resolve AS', async () => {
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author });
    // An org-less reader matches every `global` row (A2 review F4), so "we could not determine the
    // custodian" must never collapse into "resolve as somebody".
    expect(await resolveOwnerActionSurface('', OWNER, KEY)).toBeNull();
  });

  it('THE PRODUCTION CONSEQUENCE: the executor refuses the call with `credential_invalid`', async () => {
    // What the `null` arm is FOR, asserted at the only place it is read. Delete
    // `if (!definitionActor) return null` and this call resolves a package as an org-less actor -
    // which matches every `global` row in the installation - instead of being refused.
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author });

    const refused = await executeUserIntegrationAction({
      orgId: '', ownerUserId: OWNER, integrationKey: KEY, actionName: SURVIVOR, args: {},
    });

    expect(refused.success).toBe(false);
    expect(refused.code).toBe('credential_invalid');
    // …and the refusal is a MESSAGE, never a deletion. Round four's version of this branch collected
    // the caller's evidence rows on the way past; round five's tells them and touches nothing.
    expect(refused.error).toContain(KEY);
  }, 30_000);

  it('a resolver that THROWS is not caught here - it is a real failure and it propagates', async () => {
    // STATED RATHER THAN IMPLIED. Round four caught this into `null`, because a retention decision
    // was about to read the answer and a swallowed blip would have deleted rows. Nothing reads it
    // that way any more, so a broken resolve surfaces as the failure it is instead of being
    // laundered into "this owner reaches nothing".
    await expect(resolveOwnerActionSurface(ORG, OWNER, KEY, {
      resolve: async () => { throw new Error('mongo is unhappy'); },
    })).rejects.toThrow('mongo is unhappy');
  });
});
