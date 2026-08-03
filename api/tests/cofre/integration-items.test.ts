import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  mintCofreItem,
  mintIntegrationCredentialItem,
  updateIntegrationCredentialValue,
  findIntegrationCredentialItem,
  integrationOriginScope,
  unwrapForIntegration,
  discardIntegrationCredentialItem,
  listCofreItems,
  lockItem,
  lockAll,
  issueGrant,
  CofreLockedError,
  CofreNotFoundError,
  CredentialOriginError,
  type IntegrationItemLink,
} from '../../src/cofre/index.js';

/**
 * The INTEGRATION -> COFRE-ITEM JOIN (slice B2, WS-C) at the Cofre's own surface.
 *
 * Three properties this file exists to pin, each of which a plausible future edit would break:
 *   1. THE AUTO-GRANT IS SCOPED TO ONE ITEM. Connecting an integration issues exactly one
 *      `until_locked` grant, on the item that connect minted — never on anything else the user owns,
 *      and never on an item a HUMAN minted through the ordinary Cofre surface. The manual path
 *      staying locked-by-default is the whole consent model; the auto-grant is the one narrowly
 *      argued exception (RUN_SPEC assumption 5) and it must stay narrow.
 *   2. THE ID IS NOT AUTHORITY. Every read re-checks the item's own stamped `integrationLink`, so a
 *      config row pointing at another integration's — or another config's — item is refused, with
 *      the same uniform not-found an unknown id gets.
 *   3. A REFRESH DOES NOT RE-GRANT. Rotating credentials must never silently undo a lock.
 */
let mem: MongoMemoryServer;

const alice: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' };
const bob: Actor = { userId: 'bob', orgId: 'orgA', role: 'user' };
const carolOtherOrg: Actor = { userId: 'carol', orgId: 'orgB', role: 'org-admin' };

// Credential-shaped literals are COMPOSED AT RUNTIME, never written as a literal: the repo's
// secret-scanning gate must stay sharp, and a fixture-shaped "false positive" is exactly where a
// gate gets quietly weakened by an allowlist entry (RUN_LOG 2026-08-01, CS5).
const API_KEY = ['sk', 'live', 'B2JOIN', '0001'].join('-');
const OTHER_KEY = ['sk', 'live', 'B2JOIN', '0002'].join('-');

const linkA: IntegrationItemLink = { integrationKey: 'crm', configId: 'cfg-crm' };
const linkB: IntegrationItemLink = { integrationKey: 'billing', configId: 'cfg-billing' };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_cofre_join');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
});

const connectCrm = (actor: Actor = alice, values: Record<string, unknown> = { api_key: API_KEY }) =>
  mintIntegrationCredentialItem(actor, {
    link: linkA,
    label: 'CRM',
    values,
    boundOrigins: ['api.crm.example'],
  });

describe('connect-time mint + the until_locked auto-grant', () => {
  it('mints an item joined to the integration and arms it with ONE until_locked grant', async () => {
    const item = await connectCrm();
    expect(item.integrationLink).toEqual(linkA);

    const view = await listCofreItems(alice);
    expect(view).toHaveLength(1);
    expect(view[0]!.state).toBe('unlocked_until_locked');
    // The indefinite state carries no countdown, and the join is projected so the user can see
    // WHICH integration unlocked it — an unattributable standing unlock is not consent.
    expect(view[0]!.unlockedUntil).toBeUndefined();
    expect(view[0]!.integrationKey).toBe('crm');

    const { cofreGrants } = await import('../../src/cofre/store.js');
    const grants = await cofreGrants.listVisible(alice);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.scope).toBe('until_locked');
    expect(grants[0]!.itemId).toBe(item._id);
  });

  it('the auto-grant reaches ONLY the item it minted — a second item stays locked', async () => {
    const manual = await mintCofreItem(alice, {
      type: 'password',
      label: 'Citius',
      value: OTHER_KEY,
      boundOrigins: ['citius.tribunaisnet.mj.pt'],
    });
    await connectCrm();

    // The connect ceremony did not spill onto the hand-minted credential.
    await expect(
      unwrapForIntegration(alice, manual._id, linkA, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
    const manualView = (await listCofreItems(alice)).find((i) => i.id === manual._id)!;
    expect(manualView.state).toBe('locked');
  });

  it('unwraps through the join once connected', async () => {
    const item = await connectCrm();
    const out = await unwrapForIntegration(alice, item._id, linkA, { kind: 'http', origin: 'api.crm.example' });
    expect(out.fields).toEqual({ api_key: API_KEY });
  });

  it('stores ciphertext only — the row never holds the bundle in plaintext', async () => {
    const item = await connectCrm();
    const { cofreItems } = await import('../../src/cofre/store.js');
    const row = (await cofreItems.raw.get(item._id)) as unknown as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain(API_KEY);
  });
});

describe('a HAND-minted item never auto-grants (the consent model, unchanged)', () => {
  it('mintCofreItem issues no grant, so the value stays locked', async () => {
    const item = await mintCofreItem(alice, {
      type: 'api_key',
      label: 'Manual',
      value: API_KEY,
      boundOrigins: ['api.crm.example'],
    });
    const { cofreGrants } = await import('../../src/cofre/store.js');
    expect(await cofreGrants.listVisible(alice)).toHaveLength(0);
    expect((await listCofreItems(alice))[0]!.state).toBe('locked');
    await expect(
      unwrapForIntegration(alice, item._id, linkA, { kind: 'http', origin: 'api.crm.example' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
  });

  it('carries no integration link, so it can never be reached through the join', async () => {
    const item = await mintCofreItem(alice, {
      type: 'api_key',
      label: 'Manual',
      value: API_KEY,
      boundOrigins: ['api.crm.example'],
    });
    expect(item.integrationLink).toBeUndefined();
    expect(await findIntegrationCredentialItem(alice, item._id, linkA)).toBeNull();
    // Even fully granted by hand, the link check refuses it for an integration read.
    await issueGrant(alice, item._id, 'until_locked');
    await expect(
      unwrapForIntegration(alice, item._id, linkA, { kind: 'http', origin: 'api.crm.example' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
  });
});

describe('the link is checked on every read — an id alone is not authority', () => {
  it('refuses an item minted for a DIFFERENT integration', async () => {
    const billing = await mintIntegrationCredentialItem(alice, {
      link: linkB,
      label: 'Billing',
      values: { api_key: OTHER_KEY },
      boundOrigins: ['api.billing.example'],
    });
    // An action authored under `crm` naming billing's item: refused before anything decrypts.
    await expect(
      unwrapForIntegration(alice, billing._id, linkA, { kind: 'http', origin: 'api.billing.example' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
    expect(await findIntegrationCredentialItem(alice, billing._id, linkA)).toBeNull();
    expect(await integrationOriginScope(alice, billing._id, linkA)).toEqual({ kind: 'unreachable' });
  });

  it('refuses the same integration key under a DIFFERENT config id', async () => {
    const item = await connectCrm();
    const otherConfig: IntegrationItemLink = { integrationKey: 'crm', configId: 'cfg-crm-2' };
    await expect(
      unwrapForIntegration(alice, item._id, otherConfig, { kind: 'http', origin: 'api.crm.example' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
  });

  it('answers the SAME error for an unknown id and a foreign item (no existence oracle)', async () => {
    const item = await connectCrm();
    const unknown = unwrapForIntegration(alice, 'itm_nope', linkA, { kind: 'http', origin: 'api.crm.example' });
    const foreign = unwrapForIntegration(bob, item._id, linkA, { kind: 'http', origin: 'api.crm.example' });
    await expect(unknown).rejects.toBeInstanceOf(CofreNotFoundError);
    await expect(foreign).rejects.toBeInstanceOf(CofreNotFoundError);
  });
});

describe('the four unwrap grounds still apply to an integration credential', () => {
  it('REFUSES an off-origin destination even with the auto-grant live', async () => {
    const item = await connectCrm();
    await expect(
      unwrapForIntegration(alice, item._id, linkA, { kind: 'http', origin: 'attacker.example' }),
    ).rejects.toBeInstanceOf(CredentialOriginError);
  });

  it('REFUSES once the user locks it — lock = revoke', async () => {
    const item = await connectCrm();
    expect(await lockItem(alice, item._id)).toBe(1);
    await expect(
      unwrapForIntegration(alice, item._id, linkA, { kind: 'http', origin: 'api.crm.example' }),
    ).rejects.toBeInstanceOf(CofreLockedError);
    expect(await integrationOriginScope(alice, item._id, linkA)).toEqual({ kind: 'locked' });
  });

  it('lock-all reaches the integration item too', async () => {
    const item = await connectCrm();
    expect(await lockAll(alice)).toBe(1);
    expect(await integrationOriginScope(alice, item._id, linkA)).toEqual({ kind: 'locked' });
  });

  it('REFUSES a cross-tenant read (uniform not-found)', async () => {
    const item = await connectCrm();
    await expect(
      unwrapForIntegration(carolOtherOrg, item._id, linkA, { kind: 'http', origin: 'api.crm.example' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
  });
});

describe('the granted scope, as the egress rail asks for it', () => {
  it('reports the item bound origins while granted', async () => {
    const item = await connectCrm();
    expect(await integrationOriginScope(alice, item._id, linkA)).toEqual({
      kind: 'granted',
      origins: ['api.crm.example'],
    });
  });

  it('distinguishes LOCKED (refuse) from UNREACHABLE (not this reader\'s credential)', async () => {
    const item = await connectCrm();
    // Not the owner: unreachable, so the caller keeps whatever binding it had before WS-C.
    expect(await integrationOriginScope(bob, item._id, linkA)).toEqual({ kind: 'unreachable' });
    await lockItem(alice, item._id);
    // The owner, after locking: an explicit refusal that must NOT fall back to anything wider.
    expect(await integrationOriginScope(alice, item._id, linkA)).toEqual({ kind: 'locked' });
  });
});

describe('rotating credentials', () => {
  it('re-encrypts in place, keeps the item id, and re-binds the origins', async () => {
    const item = await connectCrm();
    const rotated = ['sk', 'live', 'B2JOIN', 'ROTATED'].join('-');
    expect(
      await updateIntegrationCredentialValue(alice, item._id, linkA, { api_key: rotated }, ['api2.crm.example']),
    ).toBe('updated');
    const out = await unwrapForIntegration(alice, item._id, linkA, { kind: 'http', origin: 'api2.crm.example' });
    expect(out.fields).toEqual({ api_key: rotated });
    expect(out.itemId).toBe(item._id);
  });

  it('does NOT re-grant a LOCKED item — a rotation cannot undo the kill switch', async () => {
    const item = await connectCrm();
    await lockItem(alice, item._id);
    const rotated = ['sk', 'live', 'B2JOIN', 'ROTATED2'].join('-');
    expect(
      await updateIntegrationCredentialValue(alice, item._id, linkA, { api_key: rotated }, ['api.crm.example']),
    ).toBe('updated');
    await expect(
      unwrapForIntegration(alice, item._id, linkA, { kind: 'http', origin: 'api.crm.example' }),
    ).rejects.toBeInstanceOf(CofreLockedError);
  });

  it('refuses to rotate an item that is not the actor\'s or whose link disagrees', async () => {
    const item = await connectCrm();
    // ANOTHER USER'S item: `foreign`. The caller must NOT mint a replacement — that would strand
    // this still-granted item with nothing joined to it (the org-shared two-admins case).
    expect(await updateIntegrationCredentialValue(bob, item._id, linkA, { api_key: OTHER_KEY }, ['x.test'])).toBe(
      'foreign',
    );
    // The actor's OWN item under a different link: `stale`, so a fresh mint orphans nobody.
    expect(await updateIntegrationCredentialValue(alice, item._id, linkB, { api_key: OTHER_KEY }, ['x.test'])).toBe(
      'stale',
    );
    // …and the stored value is untouched by either refusal.
    const out = await unwrapForIntegration(alice, item._id, linkA, { kind: 'http', origin: 'api.crm.example' });
    expect(out.fields).toEqual({ api_key: API_KEY });
  });

  it('an id naming NOTHING is `stale`, not `foreign` — a deleted item must not stick the config', async () => {
    const item = await connectCrm();
    await discardIntegrationCredentialItem(alice, item._id, linkA);
    expect(await updateIntegrationCredentialValue(alice, item._id, linkA, { api_key: OTHER_KEY }, ['x.test'])).toBe(
      'stale',
    );
  });
});

describe('disconnecting', () => {
  it('destroys the item AND its grants, leaving no orphan standing unlock', async () => {
    const item = await connectCrm();
    expect(await discardIntegrationCredentialItem(alice, item._id, linkA)).toBe(true);
    const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
    expect(await cofreItems.raw.get(item._id)).toBeNull();
    expect(await cofreGrants.listVisible(alice)).toHaveLength(0);
  });

  it('refuses to discard through a mismatched link or a foreign actor', async () => {
    const item = await connectCrm();
    expect(await discardIntegrationCredentialItem(alice, item._id, linkB)).toBe(false);
    expect(await discardIntegrationCredentialItem(bob, item._id, linkA)).toBe(false);
    expect(await findIntegrationCredentialItem(alice, item._id, linkA)).not.toBeNull();
  });
});

/**
 * THE ORG-SHARED CONFIG REACH (B2 review C1 + H1 + H2), at the Cofre's own surface.
 *
 * An org-shared config is used by the whole org and deletable by any org-admin, but its item belongs
 * to the one admin who typed the credentials. The `sharedConfig` flag is what lets the config's other
 * legitimate holders reach that item — and the asymmetry it encodes is the thing to pin: RESTRICTION
 * and DESTRUCTION cross the owner boundary, DISCLOSURE never does.
 *
 * Every case below is also run WITHOUT the flag, because a widening that turns out to be
 * unconditional would pass every assertion about what the flag enables.
 */
describe('the org-shared config reach', () => {
  it('a PEER reads the owner\'s granted scope — but only when the config declares itself shared', async () => {
    const item = await connectCrm();
    expect(await integrationOriginScope(bob, item._id, linkA)).toEqual({ kind: 'unreachable' });
    expect(await integrationOriginScope(bob, item._id, linkA, { sharedConfig: true })).toEqual({
      kind: 'granted',
      origins: ['api.crm.example'],
    });
  });

  it('the OWNER\'s lock is the org\'s lock: a peer of a shared config is refused too', async () => {
    const item = await connectCrm();
    await lockItem(alice, item._id);
    // Grants are owner-scoped rows, so reading them as the PEER would answer the empty list and
    // call every live credential "locked". The scope reads the ITEM OWNER's grants, which is why
    // this says `locked` because alice locked it, not because bob cannot see it.
    expect(await integrationOriginScope(bob, item._id, linkA, { sharedConfig: true })).toEqual({ kind: 'locked' });
  });

  it('the reach is bounded by the JOIN and by the ORG — never by the id alone', async () => {
    const item = await connectCrm();
    // Another config's link: the item does not agree that it belongs to what is being asked for.
    expect(await integrationOriginScope(bob, item._id, linkB, { sharedConfig: true })).toEqual({ kind: 'unreachable' });
    // Another TENANT, with the flag set and the link correct: tenancy is not a flag away.
    expect(await integrationOriginScope(carolOtherOrg, item._id, linkA, { sharedConfig: true })).toEqual({
      kind: 'unreachable',
    });
    // A hand-minted item carries no link at all, so nothing reaches it through this door.
    const manual = await mintCofreItem(alice, {
      type: 'api_key',
      label: 'Manual',
      value: OTHER_KEY,
      boundOrigins: ['api.crm.example'],
    });
    expect(await integrationOriginScope(bob, manual._id, linkA, { sharedConfig: true })).toEqual({
      kind: 'unreachable',
    });
  });

  it('DISCLOSURE stays owner-scoped: there is no shared-config path to the value', async () => {
    const item = await connectCrm();
    // The peer can be restricted by this item and can destroy it with the config, and still cannot
    // read it: `unwrapForIntegration` takes no access flag, deliberately.
    await expect(
      unwrapForIntegration(bob, item._id, linkA, { kind: 'http', origin: 'api.crm.example' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
    expect(await findIntegrationCredentialItem(bob, item._id, linkA)).toBeNull();
    expect(await listCofreItems(bob)).toHaveLength(0);
  });

  it('a PEER\'s rotation rewrites the OWNER\'s item in place — custody never moves', async () => {
    const item = await connectCrm();
    expect(await updateIntegrationCredentialValue(bob, item._id, linkA, { api_key: OTHER_KEY }, [])).toBe('foreign');
    expect(
      await updateIntegrationCredentialValue(bob, item._id, linkA, { api_key: OTHER_KEY }, [], { sharedConfig: true }),
    ).toBe('updated');

    const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
    const stored = await cofreItems.raw.get(item._id);
    expect(stored!.userId).toBe('alice'); // 46df997's property: a rotation never re-points custody
    // The owner reads the rotated value back, so the shadow stayed in step instead of drifting.
    const out = await unwrapForIntegration(alice, item._id, linkA, { kind: 'http', origin: 'api.crm.example' });
    expect(out.fields).toEqual({ api_key: OTHER_KEY });
    // …and the grant is untouched: a rotation must never silently undo a lock, whoever wrote it.
    expect(await cofreGrants.listVisible(alice)).toHaveLength(1);
  });

  it('a PEER-ADMIN\'s discard destroys the owner\'s item AND its grants (no orphan standing unlock)', async () => {
    const item = await connectCrm();
    expect(await discardIntegrationCredentialItem(bob, item._id, linkA)).toBe(false);
    expect(await discardIntegrationCredentialItem(bob, item._id, linkA, { sharedConfig: true })).toBe(true);

    const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
    expect(await cofreItems.raw.get(item._id)).toBeNull();
    // The grants are the half that matters: an item deleted with its `until_locked` grant left
    // behind is the standing unlock, and the sweep runs for the ITEM's owner, not the deleter.
    expect(await cofreGrants.raw.find({ itemId: item._id })).toHaveLength(0);
    expect(await listCofreItems(alice)).toHaveLength(0);
  });

  it('a FOREIGN-TENANT discard destroys nothing, flag or no flag', async () => {
    const item = await connectCrm();
    expect(await discardIntegrationCredentialItem(carolOtherOrg, item._id, linkA, { sharedConfig: true })).toBe(false);
    expect(await findIntegrationCredentialItem(alice, item._id, linkA)).not.toBeNull();
  });
});
