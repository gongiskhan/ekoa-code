import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { orgs, settings } from '../../src/data/stores.js';
import { patchOrgSettings, mergedSettings } from '../../src/services/platform-crud.js';
import { getPipedreamStatus, runPipedreamAction } from '../../src/integrations/pipedream.js';

/**
 * SECURITY SUITE — the Pipedream master switch actually switches.
 *
 * THE BUG. `PATCH /api/v1/settings` persists through `patchOrgSettings`, which writes the ORG
 * document (`orgs[orgId].settings`). The enforcement read — `isPipedreamEnabled()` — went to
 * `settings.get('default')`: a different collection, and a document nothing ever writes. It
 * therefore always read null, and on null it returned `undefined !== false` → TRUE.
 *
 * Both halves matter. The wrong store alone would have made the switch unreliable; the FAIL-OPEN
 * default made it inert in exactly one direction — an admin could never turn Pipedream OFF. They
 * got a 200, the API reported `pipedreamEnabled: false`, the UI toggle snapped back, and
 * `runPipedreamAction`'s `disabled` guard never fired once. A third-party egress integration that
 * cannot be disabled is the failure mode worth having a test for.
 *
 * The default is now FALSE, matching `mergedSettings` (what the API and UI report): a config read
 * that fails must not enable an outbound path nobody asked for.
 */
let mem: MongoMemoryServer;
const ORG = 'org-pd';
const actor = { userId: 'u1', orgId: ORG, role: 'org-admin' } as Actor;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_pd');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await orgs.deleteMany({});
  await settings.deleteMany({});
  await orgs.insert({ _id: ORG, name: 'Org' } as never);
});

describe('the switch reads the store the write lands in', () => {
  it('DEFAULT DENY: an org that never enabled Pipedream reports disabled', async () => {
    // The old read defaulted to TRUE here, so a brand-new org had a third-party egress path live
    // without anyone turning it on.
    expect((await getPipedreamStatus(actor)).enabled).toBe(false);
  });

  it('enabling through the settings write makes it enabled', async () => {
    await patchOrgSettings(ORG, { integration: { pipedreamEnabled: true } });
    expect((await getPipedreamStatus(actor)).enabled).toBe(true);
  });

  it('THE BUG: disabling it actually disables it', async () => {
    await patchOrgSettings(ORG, { integration: { pipedreamEnabled: true } });
    expect((await getPipedreamStatus(actor)).enabled).toBe(true);

    await patchOrgSettings(ORG, { integration: { pipedreamEnabled: false } });
    expect((await getPipedreamStatus(actor)).enabled).toBe(false);
  });

  it('status agrees with what the API reports to the UI — one source of truth', async () => {
    // The divergence was invisible from either side alone: mergedSettings said false while the
    // enforcement said true, so the toggle rendered from one and wrote to the other.
    for (const value of [true, false]) {
      await patchOrgSettings(ORG, { integration: { pipedreamEnabled: value } });
      const reported = (await mergedSettings('u1', ORG)) as { integration?: { pipedreamEnabled?: boolean } };
      expect(reported.integration?.pipedreamEnabled).toBe(value);
      expect((await getPipedreamStatus(actor)).enabled).toBe(value);
    }
  });

  it('a legacy platform-wide settings doc does NOT re-enable it', async () => {
    // The old read's home. A stale row there must not override the org's decision.
    await settings.insert({ _id: 'default', integration: { pipedreamEnabled: true } } as never);
    await patchOrgSettings(ORG, { integration: { pipedreamEnabled: false } });
    expect((await getPipedreamStatus(actor)).enabled).toBe(false);
  });

  it('one org enabling it does not enable it for another', async () => {
    await orgs.insert({ _id: 'other-org', name: 'Other' } as never);
    await patchOrgSettings('other-org', { integration: { pipedreamEnabled: true } });
    expect((await getPipedreamStatus(actor)).enabled).toBe(false);
  });
});

describe('the disabled guard on the action path fires', () => {
  it('runPipedreamAction refuses when the org has it off', async () => {
    await patchOrgSettings(ORG, { integration: { pipedreamEnabled: false } });
    const res = await runPipedreamAction({ actor, app: 'slack', actionKey: 'send', args: {} });
    expect(res.success).toBe(false);
    expect(res.code).toBe('disabled');
  });

  it('and refuses by DEFAULT, before anyone has touched the setting', async () => {
    const res = await runPipedreamAction({ actor, app: 'slack', actionKey: 'send', args: {} });
    expect(res.success).toBe(false);
    expect(res.code).toBe('disabled');
  });
});
