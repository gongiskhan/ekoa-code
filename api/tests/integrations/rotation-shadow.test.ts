import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, integrationDefinitions } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { createConfig, persistRotatedCredentials, type IntegrationConfigDoc } from '../../src/integrations/service.js';
import { executeUserIntegrationAction, type FetchLike } from '../../src/integrations/action-executor.js';
import {
  compareCredentialShadow,
  __resetCredentialShadowReportingForTests,
} from '../../src/integrations/credential-cofre.js';
import { envelopeDecrypt } from '../../src/data/crypto.js';

/**
 * WS-C ROTATION REGRESSION (slice C2, closing B2's fresh-context review HIGH).
 *
 * THE BUG. A provider credential resolver (Zoho Sign's grant-code → refresh_token exchange) rotates
 * a credential on the EXECUTION rail and hands the new values back through `onCredentialUpdate`.
 * That write went straight to `integrationConfigs` — the legacy `credentialsCiphertext` column —
 * and nowhere else. Zoho-shaped rows are NOT in RUN_SPEC assumption 4's carve-out
 * (`isReservedIntegrationRow` excludes only platform-OAuth and pipedream rows), so they ARE
 * shadowed into a Cofre item at connect. Consequences, both silent:
 *
 *   - every subsequent read reports Rule-10 `drift` forever, so the one measurement the 2026-08-15
 *     cutover decision rests on is permanently wrong for exactly the integrations that rotate;
 *   - at cutover, the Cofre becomes the only read and hands back the CONNECT-TIME bundle — a
 *     `grant_code` that has already been spent and a `refresh_token` that was never written. The
 *     integration breaks, and it breaks at the moment the legacy column is dropped.
 *
 * THE PIN. `compareCredentialShadow` is B2's own comparator: it reads the credential back through
 * the Cofre — tenancy, link, grant and origin binding included — and says whether a cutover today
 * would return the same values. After a rotation it must say `match`. Remove the shadow write from
 * `persistRotatedCredentials` and this suite reports `drift`, naming the rotated field.
 *
 * ONE IMPLEMENTATION. C2's execution rail (`action-executor.ts`, whose `onCredentialUpdate` is the
 * caller under test) briefly carried a sibling body for this job while B2's review was in flight.
 * They differed in a security-relevant way, not a cosmetic one — the C2 version MINTED an item for
 * an org-shared config that had none, which lands custody and the lock switch with whoever happened
 * to be running rather than with the human who typed the credential. `service.persistRotatedCredentials`
 * is the survivor precisely because it refuses that, and the last test here pins the refusal.
 */
const ORG = 'orgRot';
const OWNER = 'u-rot';
const HOST = 'https://api.rotating.example';

/** Composed at run time, never a literal (the run's gitleaks rule). */
const mkSecret = (tag: string) => ['rot', tag, Math.random().toString(36).slice(2, 10)].join('-');

let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const actor = { userId: OWNER, orgId: ORG, role: 'user' as const };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_rotation_shadow');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  __resetCredentialShadowReportingForTests();
  for (const s of [integrationConfigs, integrationDefinitions]) await s.deleteMany({});
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
  await integrationDefinitionStore.create(
    {
      orgId: ORG, userId: OWNER, visibility: 'private', key: 'rotating',
      displayName: 'Rotating', configSchema: [], skillMd: '# r', authType: 'api_key',
      actions: [{
        actionName: 'list_things', description: 'l', mutates: false,
        httpConfig: { method: 'GET', baseUrl: HOST, path: '/things' },
      }],
    },
    { actor, onConflict: 'replace' },
  );
});

async function connect(values: Record<string, unknown>): Promise<IntegrationConfigDoc> {
  const cfg = await createConfig(actor, { integrationKey: 'rotating', configValues: values }, deps);
  const row = (await integrationConfigs.get(cfg._id)) as IntegrationConfigDoc;
  expect(row.cofreItemId, 'B2 must shadow a user-defined config at connect').toBeTruthy();
  return row;
}

/** Write ONLY the legacy column - i.e. reproduce the pre-C2 bug on purpose, to create drift. */
async function persistLegacyOnly(row: IntegrationConfigDoc, updates: Record<string, string>): Promise<void> {
  const { envelopeEncrypt } = await import('../../src/data/crypto.js');
  const merged = { ...(await liveFields(row)), ...updates };
  const ciphertext = await envelopeEncrypt(JSON.stringify(merged), row.orgId);
  await integrationConfigs.update(row._id, (cur) => ({ ...cur, credentialsCiphertext: ciphertext }));
}

const liveFields = async (row: IntegrationConfigDoc) =>
  JSON.parse(await envelopeDecrypt(row.credentialsCiphertext!, row.orgId)) as Record<string, string>;

describe('a provider rotation keeps BOTH credential stores in step', () => {
  it('the shadow reports `match` after the rotation, not `drift`', async () => {
    const grant = mkSecret('grant');
    const refreshed = mkSecret('refresh');
    const row = await connect({ api_key: mkSecret('key'), grant_code: grant });

    // Sanity: connect-time state is already consistent, so a `drift` below can only be the rotation.
    expect((await compareCredentialShadow(actor, row, await liveFields(row))).status).toBe('match');

    // The provider hands back the exchanged credential — exactly what `onCredentialUpdate` carries.
    await persistRotatedCredentials(row._id, OWNER, await liveFields(row), {
      refresh_token: refreshed,
      grant_code: '',
    });

    const after = (await integrationConfigs.get(row._id)) as IntegrationConfigDoc;
    const fields = await liveFields(after);
    expect(fields.refresh_token, 'the legacy column must carry the rotated value').toBe(refreshed);
    expect(fields.grant_code, 'the spent grant code must be cleared').toBe('');

    const report = await compareCredentialShadow(actor, after, fields);
    expect(report.status, `shadow must agree after a rotation (driftKeys=${report.driftKeys?.join(',')})`).toBe('match');
  });

  it('the rotation does NOT re-grant a locked credential — lock survives an update', async () => {
    const row = await connect({ api_key: mkSecret('key') });
    const { lockItem } = await import('../../src/cofre/index.js');
    await lockItem(actor, row.cofreItemId!);

    await persistRotatedCredentials(row._id, OWNER, await liveFields(row), { api_key: mkSecret('key2') });

    const after = (await integrationConfigs.get(row._id)) as IntegrationConfigDoc;
    // Still locked: the comparator's `shadow_locked` is the honest report, and it is what proves
    // the refresh took the "keep the grant state" path rather than silently re-minting.
    expect((await compareCredentialShadow(actor, after, await liveFields(after))).status).toBe('shadow_locked');
  });

  it('a shadow failure never loses the rotated credential (the legacy column is written first)', async () => {
    const row = await connect({ api_key: mkSecret('key') });
    const rotated = mkSecret('key3');
    // Break the join so the shadow refresh cannot resolve an item to write to.
    await integrationConfigs.update(row._id, (cur) => ({ ...cur, cofreItemId: 'gone' }));
    const broken = (await integrationConfigs.get(row._id)) as IntegrationConfigDoc;

    await persistRotatedCredentials(row._id, OWNER, await liveFields(broken), { api_key: rotated });

    const after = (await integrationConfigs.get(row._id)) as IntegrationConfigDoc;
    expect((await liveFields(after)).api_key).toBe(rotated);
  });
});

describe('a rotation refreshes a shadow; it does not perform the connect ceremony', () => {
  it('an ORG-SHARED config with no item is NOT given one by whoever happens to be rotating', async () => {
    // An org-admin authors an org-shared row (ownerUserId undefined). Strip its item so the row is
    // in the "shadowed at connect, item since gone" state a pre-B2 config is also in.
    const admin = { userId: 'u-admin', orgId: ORG, role: 'org-admin' as const };
    const cfg = await createConfig(admin, { integrationKey: 'rotating', configValues: { api_key: mkSecret('key') } }, deps);
    await integrationConfigs.update(cfg._id, (cur) => {
      const next = { ...cur };
      delete (next as Record<string, unknown>).cofreItemId;
      return next;
    });
    const shared = (await integrationConfigs.get(cfg._id)) as IntegrationConfigDoc;
    expect(shared.ownerUserId ?? null, 'an org-admin authors an ORG-SHARED row').toBeNull();
    const { cofreItems } = await import('../../src/cofre/store.js');
    const before = (await cofreItems.raw.find({})).length;

    // A DIFFERENT user's run rotates the credential. Minting here would put the item — and with it
    // custody and the lock switch — in the Cofre of someone who never typed this credential.
    const rotated = mkSecret('key4');
    expect(await persistRotatedCredentials(cfg._id, OWNER, await liveFields(shared), { api_key: rotated })).toBe('updated');

    expect((await cofreItems.raw.find({})).length, 'no item may be minted by a rotation').toBe(before);
    const after = (await integrationConfigs.get(cfg._id)) as IntegrationConfigDoc;
    expect(after.cofreItemId ?? null, 'and no join may be stamped').toBeNull();
    // The rotated value still lands in the live column: refusing to mint is not refusing to save.
    expect((await liveFields(after)).api_key).toBe(rotated);
  });

  it('a config that no longer exists is reported, never silently swallowed', async () => {
    expect(await persistRotatedCredentials('no-such-config', OWNER, {}, { api_key: mkSecret('key5') })).toBe('notfound');
  });
});

describe('the Rule-10 shadow comparator SEES the user-defined action rail', () => {
  it('a drifted shadow is reported when the action executor reads the credential', async () => {
    // B2's review MEDIUM-1: this rail decrypts the config itself instead of going through the
    // composition root's credential loader, so the comparator never ran on it — and the LISTENER
    // poll runs through here, so listener ticks were absent from the sample the 2026-08-15 cutover
    // decision will be read from. A census claiming "every credential read" while measuring two
    // rails out of three is worse than a census that names its gaps.
    const row = await connect({ api_key: mkSecret('key') });
    // Drift the LIVE column only, leaving the Cofre item on the connect-time value.
    await persistLegacyOnly(row, { api_key: mkSecret('key-drifted') });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const fetchImpl: FetchLike = async () =>
        ({ ok: true, status: 200, statusText: '', headers: { forEach: () => undefined }, text: async () => '{}' }) as unknown as Response;
      const res = await executeUserIntegrationAction(
        { orgId: ORG, ownerUserId: OWNER, integrationKey: 'rotating', actionName: 'list_things', args: {} },
        { fetchImpl },
      );
      expect(res.success, 'the measurement must not change what the rail returns').toBe(true);
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(
        lines.some((l) => l.includes('WS-C shadow drift') && l.includes('rotating')),
        `expected a shadow verdict from this rail; saw: ${lines.join(' | ')}`,
      ).toBe(true);
      // The verdict names FIELDS, never values — the comparator's own invariant, re-checked at the
      // one place a new caller could have handed it something else.
      expect(lines.join(' ')).toContain('fields=[api_key]');
    } finally {
      warn.mockRestore();
    }
  });
});
