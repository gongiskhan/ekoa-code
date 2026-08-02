import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions } from '../../src/data/stores.js';
import { refreshDefinitions, type IntegrationPackageConfig } from '../../src/integrations/definitions.js';
import { saveAuthoredDefinition } from '../../src/integrations/definition-save.js';
import {
  IntegrationDefinitionStore,
  definitionIdFor,
} from '../../src/integrations/definition-store.js';

/**
 * The builder SAVE path (slice A3) — Mongo, private-by-default, actor-stamped.
 *
 * The suite is the isolation net for the WRITE half of the
 * `runtime-integration-packages-are-global` finding (A2 closed the read path): a save must land as
 * the ACTING user's own private row, never a shared tier, never another user's row, and never a
 * shipped key. Every case asserts the ACTOR-derived fields on the persisted document — the A2
 * review's TEST-GAP was that every seam fake ignored the actor, so a wrong actor compiled and
 * passed; here the actor IS the assertion.
 */
let mem: MongoMemoryServer;
let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

const userA1: Actor = { userId: 'userA1', orgId: 'orgA', role: 'user' };
const userA2: Actor = { userId: 'userA2', orgId: 'orgA', role: 'user' };
const adminA: Actor = { userId: 'adminA', orgId: 'orgA', role: 'org-admin' };
const superAdmin: Actor = { userId: 'root', orgId: 'orgA', role: 'super-admin' };

let clock = 0;
const store = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));

const pkg = (key: string, over: Partial<IntegrationPackageConfig> = {}): IntegrationPackageConfig => ({
  integrationKey: key,
  displayName: `${key} display`,
  description: 'd',
  authType: 'api_key',
  provider: 'X',
  category: 'test',
  configSchema: [{ key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true }],
  actions: [{ actionName: 'ping', description: 'd', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://api.x.example', path: '/ping' } }],
  credentialGuide: '1. x',
  ...over,
});

beforeAll(async () => {
  // A baseline fixture so the reserved-key set is deterministic ('demo-base' + 'pipedream').
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-defsave-'));
  const baselineDir = join(tmp, 'baseline');
  mkdirSync(join(baselineDir, 'demo-base'), { recursive: true });
  writeFileSync(join(baselineDir, 'demo-base', 'config.json'), JSON.stringify(pkg('demo-base')));
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  savedEnv.EKOA_DATA_DIR = process.env.EKOA_DATA_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = baselineDir;
  process.env.EKOA_DATA_DIR = join(tmp, 'data');
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_defsave');
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
});

describe('saveAuthoredDefinition — private by default, stamped from the actor', () => {
  it('a first save creates the ACTOR\'s own PRIVATE row with authored provenance', async () => {
    const r = await saveAuthoredDefinition(userA1, pkg('my-crm'), '# My CRM\nbody\n', store);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    // The tenant stamp comes from the VERIFIED actor — there is no body field that could name
    // another org/user, and the store seam would refuse one (see the forgery case below).
    expect(r.doc.orgId).toBe('orgA');
    expect(r.doc.userId).toBe('userA1');
    expect(r.doc.visibility).toBe('private');
    expect(r.doc.origin?.kind).toBe('authored');
    expect(r.doc._id).toBe(definitionIdFor('orgA', 'my-crm'));
    expect(r.doc.skillMd).toContain('# My CRM');

    // Private means PRIVATE: the same-org peer and admin resolve nothing for the key.
    expect(await store.getForActor(userA2, 'my-crm')).toBeNull();
    expect(await store.getForActor(adminA, 'my-crm')).toBeNull();
    expect((await store.getForActor(userA1, 'my-crm'))?._id).toBe(r.doc._id);
  });

  it('a re-save updates content and PRESERVES the shared tier + provenance (no silent un-share, no share)', async () => {
    const first = await saveAuthoredDefinition(userA1, pkg('team-tool'), '# v1', store);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // The owner shares it with the org (E1's explicit surface)…
    expect((await store.setVisibility(first.doc._id, userA1, 'org')).verdict).toBe('ok');

    // …then edits + re-saves. The content changes; the tier does NOT flip back to private.
    const second = await saveAuthoredDefinition(userA1, pkg('team-tool', { displayName: 'v2' }), '# v2', store);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.doc.visibility).toBe('org');
    expect(second.doc.displayName).toBe('v2');
    expect(second.doc.createdAt).toBe(first.doc.createdAt); // provenance preserved
    // The peer still sees the (updated) shared row — the edit did not un-share it.
    expect((await store.getForActor(userA2, 'team-tool'))?.displayName).toBe('v2');
  });

  it('a RESERVED (shipped) key is refused — no loadedKey exemption, nothing written (A2-residual 4)', async () => {
    for (const key of ['demo-base', 'pipedream']) {
      const r = await saveAuthoredDefinition(userA1, pkg(key), '# x', store);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe('reserved_key');
      expect(await integrationDefinitions.get(definitionIdFor('orgA', key))).toBeNull();
    }
  });

  it('a key held by a PEER\'s row is refused and the peer\'s row is untouched', async () => {
    const peers = await saveAuthoredDefinition(userA2, pkg('shared-key', { displayName: 'peer original' }), '# peer', store);
    expect(peers.ok).toBe(true);

    const r = await saveAuthoredDefinition(userA1, pkg('shared-key', { displayName: 'CLOBBER' }), '# mine', store);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('key_taken');
    const row = await integrationDefinitions.get(definitionIdFor('orgA', 'shared-key'));
    expect((row as { displayName?: string } | null)?.displayName).toBe('peer original');
    expect((row as { userId?: string } | null)?.userId).toBe('userA2');
  });

  it('the ORG-ADMIN may edit a peer\'s org-shared row, preserving its authorship', async () => {
    const owned = await saveAuthoredDefinition(userA1, pkg('org-tool'), '# v1', store);
    expect(owned.ok).toBe(true);
    if (!owned.ok) return;
    await store.setVisibility(owned.doc._id, userA1, 'org');

    const r = await saveAuthoredDefinition(adminA, pkg('org-tool', { displayName: 'admin edit' }), '# v2', store);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.displayName).toBe('admin edit');
    expect(r.doc.userId).toBe('userA1'); // authorship preserved, not stolen
    expect(r.doc.visibility).toBe('org');
  });

  it('a GLOBAL (published) row refuses the builder save — for everyone, super-admin included', async () => {
    const owned = await saveAuthoredDefinition(userA1, pkg('published'), '# v1', store);
    expect(owned.ok).toBe(true);
    if (!owned.ok) return;
    await store.setVisibility(owned.doc._id, userA1, 'org');
    expect((await store.setVisibility(owned.doc._id, superAdmin, 'global')).verdict).toBe('ok');

    for (const actor of [userA1, superAdmin]) {
      const r = await saveAuthoredDefinition(actor, pkg('published', { displayName: 'sneaky edit' }), '# v2', store);
      expect(r.ok, actor.userId).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe('published_row');
    }
    expect(((await integrationDefinitions.get(definitionIdFor('orgA', 'published'))) as { displayName?: string } | null)?.displayName)
      .toBe('published display');
  });
});

describe('the store seam itself refuses a forged owner (A2-residual 5: the actor is mandatory)', () => {
  it('a non-super-admin cannot create a row in another org, and a plain user cannot author as a peer', async () => {
    const base = {
      key: 'forged', visibility: 'private' as const, configSchema: [], actions: [], skillMd: '# f',
    };
    // Cross-org forgery.
    await expect(
      store.create({ ...base, orgId: 'orgB', userId: 'userA1' }, { actor: userA1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Same-org, forged author.
    await expect(
      store.create({ ...base, orgId: 'orgA', userId: 'userA2' }, { actor: userA1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Nothing was written by either attempt.
    expect(await integrationDefinitions.find({ key: 'forged' })).toHaveLength(0);
    // And the honest create with the same content succeeds (the refusals were the gate, not the data).
    const ok = await store.create({ ...base, orgId: 'orgA', userId: 'userA1' }, { actor: userA1 });
    expect(ok.userId).toBe('userA1');
  });

  it('a replace cannot smuggle a row into or out of the GLOBAL tier (the setVisibility rule, same door)', async () => {
    const owned = await saveAuthoredDefinition(userA1, pkg('tiered'), '# v1', store);
    expect(owned.ok).toBe(true);
    if (!owned.ok) return;
    await store.setVisibility(owned.doc._id, userA1, 'org');

    // The owner tries to PUBLISH via the replace door — refused (global is super-admin-only).
    const publishAttempt = store.create(
      { key: 'tiered', orgId: 'orgA', userId: 'userA1', visibility: 'global', configSchema: [], actions: [], skillMd: '# v2' },
      { actor: userA1, onConflict: 'replace' },
    );
    await expect(publishAttempt).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(((await integrationDefinitions.get(definitionIdFor('orgA', 'tiered'))) as { visibility?: string } | null)?.visibility)
      .toBe('org');

    // Published for real, the owner then tries to UN-publish via replace — likewise refused.
    expect((await store.setVisibility(owned.doc._id, superAdmin, 'global')).verdict).toBe('ok');
    const unpublishAttempt = store.create(
      { key: 'tiered', orgId: 'orgA', userId: 'userA1', visibility: 'org', configSchema: [], actions: [], skillMd: '# v3' },
      { actor: userA1, onConflict: 'replace' },
    );
    await expect(unpublishAttempt).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(((await integrationDefinitions.get(definitionIdFor('orgA', 'tiered'))) as { visibility?: string } | null)?.visibility)
      .toBe('global');
  });
});
