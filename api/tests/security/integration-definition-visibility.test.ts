import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions } from '../../src/data/stores.js';
import {
  IntegrationDefinitionStore,
  IntegrationDefinitionStoreError,
  definitionIdFor,
  type DefinitionVisibility,
  type IntegrationDefinitionCreate,
} from '../../src/integrations/definition-store.js';

/**
 * integration DEFINITION isolation suite (slice A1) — a memvault-class tenant-isolation net.
 *
 * The definition store is the private-by-default home A2 will rewire the file-based registry onto, so
 * its whole point is that a definition never leaks past the tenant/visibility boundary it declares.
 * This suite attacks that directly against a REAL (in-memory) Mongo, through the store's own
 * actor-scoped surface (`getForActor` / `listForActor` / `setVisibility`), with two orgs (orgA, orgB)
 * and two users inside orgA — the same shape as `automation-visibility` (private | org) extended with
 * the cross-org `global` tier:
 *
 *   - a `private` definition is visible ONLY to its author: not a same-org peer, not the org-admin,
 *     not another org (mirrors `OwnerVisibilityScoped` / the automation private gate, no admin reach);
 *   - an `org` definition is visible to every member of its org, but is confined to that org;
 *   - a `global` definition is visible to every org;
 *   - `getForActor` NEVER returns another org's private (or org-confined) row;
 *   - two orgs may each own the SAME `key` with no collision, while a second row for the same
 *     (org, key) is refused — org-scoped uniqueness via the deterministic `_id`;
 *   - `setVisibility` is owner-or-admin gated, and flipping the field flips resolution (the gate is
 *     the field, not a one-way door), with a hidden row indistinguishable from a missing one.
 *
 * The assertions are made non-tautological by pinning the OWNER-visible / cross-org-visible side of
 * every negative: the nulls are the visibility gate firing, not a row that simply is not there.
 */
let mem: MongoMemoryServer;

/** Two orgs; two users inside orgA (plus its admin); one user in orgB. */
const userA1: Actor = { userId: 'userA1', orgId: 'orgA', role: 'user' };
const userA2: Actor = { userId: 'userA2', orgId: 'orgA', role: 'user' };
const adminA: Actor = { userId: 'adminA', orgId: 'orgA', role: 'org-admin' };
const userB1: Actor = { userId: 'userB1', orgId: 'orgB', role: 'user' };
/** A platform super-admin (the only role that may toggle the cross-org `global` tier). */
const superAdmin: Actor = { userId: 'root', orgId: 'orgA', role: 'super-admin' };

/** A deterministic clock so `createdAt` ordering (the global-pick tiebreak) is stable. */
let clock = 0;
const store = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));

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
  displayName: `${key} (${orgId})`,
  configSchema: [],
  actions: [],
  skillMd: `# ${key}\n`,
  ...extra,
});

/** Create as the row's own author (A3: the actor is mandatory at the store seam; a `global` draft
 *  carries the super-admin bar the store now enforces on the create path too). */
const createRow = (input: IntegrationDefinitionCreate, onConflict?: 'reject' | 'replace') =>
  store.create(input, {
    actor: { userId: input.userId, orgId: input.orgId, role: input.visibility === 'global' ? 'super-admin' : 'user' },
    ...(onConflict ? { onConflict } : {}),
  });

const keysVisibleTo = async (actor: Actor): Promise<string[]> =>
  (await store.listForActor(actor)).map((d) => d.key).sort();

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_security_integration_definition_visibility');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  clock = 0;
  await integrationDefinitions.deleteMany({});
});

describe('integration definition visibility: private is author-only', () => {
  it('a PRIVATE definition is invisible to a same-org peer, the org-admin, and another org', async () => {
    const created = await createRow(draft('orgA', 'userA1', 'crm', 'private'));
    // Structural: the id is derived from (orgId, key), not random.
    expect(created._id).toBe(definitionIdFor('orgA', 'crm'));

    // The author resolves and lists it...
    const forOwner = await store.getForActor(userA1, 'crm');
    expect(forOwner?._id).toBe(created._id);
    expect(forOwner?.visibility).toBe('private');
    expect(await keysVisibleTo(userA1)).toContain('crm');

    // ...and NOBODY else does: not the same-org peer, not the org-admin, not the other org.
    for (const other of [userA2, adminA, userB1]) {
      expect(await store.getForActor(other, 'crm'), other.userId).toBeNull();
      expect(await keysVisibleTo(other), other.userId).not.toContain('crm');
    }

    // Non-tautology: the row DOES exist (the raw fetch finds it), so the nulls above are the
    // visibility gate firing, not a missing row.
    expect((await store.getById(created._id))?.key).toBe('crm');
  });

  it('an ORG definition is visible to every member of its org but confined to that org', async () => {
    const created = await createRow(draft('orgA', 'userA1', 'erp', 'org'));

    for (const member of [userA1, userA2, adminA]) {
      expect((await store.getForActor(member, 'erp'))?._id, member.userId).toBe(created._id);
      expect(await keysVisibleTo(member), member.userId).toContain('erp');
    }
    // The other org cannot see an org-confined definition.
    expect(await store.getForActor(userB1, 'erp')).toBeNull();
    expect(await keysVisibleTo(userB1)).not.toContain('erp');
  });

  it('a GLOBAL definition is visible across orgs', async () => {
    const created = await createRow(draft('orgA', 'userA1', 'weather', 'global'));

    for (const anyone of [userA1, userA2, adminA, userB1]) {
      expect((await store.getForActor(anyone, 'weather'))?._id, anyone.userId).toBe(created._id);
      expect(await keysVisibleTo(anyone), anyone.userId).toContain('weather');
    }
  });
});

describe('integration definition visibility: cross-org isolation', () => {
  it('getForActor NEVER returns another org\'s private (or org-confined) row', async () => {
    const bPrivate = await createRow(draft('orgB', 'userB1', 'billing', 'private'));
    const bOrg = await createRow(draft('orgB', 'userB1', 'ledger', 'org'));

    // orgB's own user resolves both...
    expect((await store.getForActor(userB1, 'billing'))?._id).toBe(bPrivate._id);
    expect((await store.getForActor(userB1, 'ledger'))?._id).toBe(bOrg._id);

    // ...while orgA's actors resolve NEITHER, and never see them in a listing.
    for (const outsider of [userA1, userA2, adminA]) {
      expect(await store.getForActor(outsider, 'billing'), outsider.userId).toBeNull();
      expect(await store.getForActor(outsider, 'ledger'), outsider.userId).toBeNull();
    }
    expect(await keysVisibleTo(userA1)).toEqual([]);
  });

  it('a same-org peer\'s PRIVATE row does not shadow a cross-org GLOBAL of the same key', async () => {
    // orgA member userA1 authors a PRIVATE 'maps'; orgB publishes a GLOBAL 'maps'.
    await createRow(draft('orgA', 'userA1', 'maps', 'private', { displayName: 'A private maps' }));
    const global = await createRow(draft('orgB', 'userB1', 'maps', 'global', { displayName: 'B global maps' }));

    // userA1 (the author) still gets their OWN private row for 'maps'.
    expect((await store.getForActor(userA1, 'maps'))?.displayName).toBe('A private maps');
    // userA2 cannot see userA1's private row, so resolution falls THROUGH to the cross-org global.
    expect((await store.getForActor(userA2, 'maps'))?._id).toBe(global._id);
    expect((await store.getForActor(userA2, 'maps'))?.displayName).toBe('B global maps');
  });
});

describe('integration definition visibility: org-scoped uniqueness', () => {
  it('two orgs may each own the SAME key; a second row for the same (org, key) is refused', async () => {
    const aCrm = await createRow(draft('orgA', 'userA1', 'crm', 'org', { displayName: 'A CRM' }));
    // A second org creating the SAME key does not collide.
    const bCrm = await createRow(draft('orgB', 'userB1', 'crm', 'org', { displayName: 'B CRM' }));

    expect(aCrm._id).not.toBe(bCrm._id);
    expect(aCrm._id).toBe(definitionIdFor('orgA', 'crm'));
    expect(bCrm._id).toBe(definitionIdFor('orgB', 'crm'));

    // Each org resolves its OWN row, never the other's.
    expect((await store.getForActor(userA1, 'crm'))?.displayName).toBe('A CRM');
    expect((await store.getForActor(userB1, 'crm'))?.displayName).toBe('B CRM');

    // A SECOND definition for (orgA, 'crm') collides and is refused (default onConflict).
    let err: unknown;
    try {
      await createRow(draft('orgA', 'userA2', 'crm', 'private'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(IntegrationDefinitionStoreError);
    expect((err as IntegrationDefinitionStoreError).code).toBe('DUPLICATE');
    // ...and the original orgA row is untouched by the refused create.
    expect((await store.getById(definitionIdFor('orgA', 'crm')))?.displayName).toBe('A CRM');

    // `replace` is the explicit opt-in, and keeps the stable (org, key) id.
    const replaced = await createRow(
      draft('orgA', 'userA1', 'crm', 'org', { displayName: 'A CRM v2' }),
      'replace',
    );
    expect(replaced._id).toBe(aCrm._id);
    expect(replaced.displayName).toBe('A CRM v2');
    expect((await store.getForActor(userA1, 'crm'))?.displayName).toBe('A CRM v2');
  });
});

describe('integration definition visibility: setVisibility is owner-or-admin gated', () => {
  it('flipping visibility flips resolution, and a hidden row is indistinguishable from a missing one', async () => {
    const priv = await createRow(draft('orgA', 'userA1', 'reports', 'private'));

    // A same-org peer cannot even distinguish the private row from a missing one, so cannot flip it.
    expect((await store.setVisibility(priv._id, userA2, 'org')).verdict).toBe('notfound');

    // The author flips it to 'org'; now the peer resolves it (the gate is the field, not a wall).
    const flipped = await store.setVisibility(priv._id, userA1, 'org');
    expect(flipped.verdict).toBe('ok');
    expect((await store.getForActor(userA2, 'reports'))?._id).toBe(priv._id);

    // Now that it is org-visible, the peer SEES it but still may not rewrite it → forbidden,
    // distinct from the earlier notfound.
    expect((await store.setVisibility(priv._id, userA2, 'private')).verdict).toBe('forbidden');

    // The org-admin has write reach over an org-visible row: flip it back to private.
    expect((await store.setVisibility(priv._id, adminA, 'private')).verdict).toBe('ok');
    expect(await store.getForActor(userA2, 'reports')).toBeNull();

    // Another org's actor can neither see nor touch it.
    expect((await store.setVisibility(priv._id, userB1, 'global')).verdict).toBe('notfound');
    // The author still holds it throughout.
    expect((await store.getForActor(userA1, 'reports'))?.visibility).toBe('private');
  });
});

describe('integration definition visibility: the global tier is super-admin only (brief lock)', () => {
  it('a base owner and an org-admin CANNOT promote a row to global; only super-admin can', async () => {
    const own = await createRow(draft('orgA', 'userA1', 'gcal', 'org'));

    // The owner (role user) may flip private<->org freely, but NOT to global.
    expect((await store.setVisibility(own._id, userA1, 'global')).verdict).toBe('forbidden');
    // Even the org-admin cannot self-publish across every tenant.
    expect((await store.setVisibility(own._id, adminA, 'global')).verdict).toBe('forbidden');
    // It stayed org-confined — no cross-org exposure leaked through.
    expect(await store.getForActor(userB1, 'gcal')).toBeNull();
    expect((await store.getById(own._id))?.visibility).toBe('org');

    // The super-admin IS the review gate: it may promote to global, and then every org resolves it.
    expect((await store.setVisibility(own._id, superAdmin, 'global')).verdict).toBe('ok');
    expect((await store.getForActor(userB1, 'gcal'))?._id).toBe(own._id);

    // And demotion FROM global is likewise super-admin only (a base owner cannot silently unpublish).
    expect((await store.setVisibility(own._id, userA1, 'org')).verdict).toBe('forbidden');
    expect((await store.setVisibility(own._id, superAdmin, 'org')).verdict).toBe('ok');
    expect(await store.getForActor(userB1, 'gcal')).toBeNull();
  });

  it('super-admin write reach spans orgs, but only over rows it can see (a global)', async () => {
    // orgB owns a global 'x'; the super-admin (in orgA) can see and re-gate it.
    const bGlobal = await createRow(draft('orgB', 'userB1', 'x', 'global'));
    expect((await store.getForActor(userA1, 'x'))?._id).toBe(bGlobal._id); // cross-org visible

    // super-admin demotes orgB's global to org-confined; the demotion is honored cross-org.
    expect((await store.setVisibility(bGlobal._id, superAdmin, 'org')).verdict).toBe('ok');
    expect(await store.getForActor(userA1, 'x')).toBeNull(); // no longer cross-org visible

    // But a foreign org's PRIVATE row remains invisible even to super-admin's write (no oracle):
    const bPriv = await createRow(draft('orgB', 'userB1', 'secret', 'private'));
    // super-admin is in orgA; a private orgB row is not visible to it → notfound, not a write.
    expect((await store.setVisibility(bPriv._id, superAdmin, 'org')).verdict).toBe('notfound');
    expect((await store.getById(bPriv._id))?.visibility).toBe('private'); // untouched
  });
});

describe('integration definition uniqueness: the composite id is injective', () => {
  it('org/key pairs that a naive separator-join would collide stay distinct', () => {
    // The classic separator collision: 'a:b' + 'c' vs 'a' + 'b:c'. JSON-encoding the tuple avoids it.
    expect(definitionIdFor('a', 'b:c')).not.toBe(definitionIdFor('a:b', 'c'));
    // Keys/orgs carrying the JSON structural characters themselves do not collide either.
    const pairs: Array<[string, string]> = [
      ['a', 'b'],
      ['a"', 'b'],
      ['a', '"b'],
      ['a', 'b","c'],
      ['a', 'b]'],
      ['a],[', 'b'],
      ['', 'b'],
      ['a', ''],
    ];
    const ids = pairs.map(([o, k]) => definitionIdFor(o, k));
    expect(new Set(ids).size).toBe(pairs.length); // all distinct
    // ...and it is stable for the same input (deterministic).
    expect(definitionIdFor('a', 'b]')).toBe(definitionIdFor('a', 'b]'));
  });
});
