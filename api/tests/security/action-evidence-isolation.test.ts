import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationActionEvidence } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import {
  ActionEvidenceStore,
  ActionEvidenceStoreError,
  actionEvidenceIdFor,
  evidenceSecretsFromValues,
  MAX_EVIDENCE_EXCERPT_CHARS,
  MAX_EVIDENCE_STEPS,
  type ActionEvidence,
} from '../../src/integrations/action-evidence-store.js';

/**
 * `integration_action_evidence` ISOLATION suite (slice S1) - the Rule 5 suite every tenant-scoped
 * store ships, of the class of `memvault-isolation.test.ts`.
 *
 * WHAT IT ATTACKS. Evidence is one PERSON's REAL request and REAL response body - client names,
 * processo numbers, invoice totals - captured from a live call against THEIR third-party account.
 * Bleed here is a data breach, not an inconvenience, so both terms of the tenancy are attacked
 * directly rather than assumed:
 *
 *   - two orgs holding evidence for the SAME (integration, action) never see each other's, on the
 *     point read OR the list read;
 *   - TWO USERS OF ONE ORG likewise. This is the leg the first cut did not have: the key was
 *     (org, integration, action) while the credential (`findConfigForOwner`) and the approval
 *     (`action-consent.ts`'s `idFor`) are both keyed per owner, so a peer's run overwrote the
 *     owner's sample with the peer's own private data - and `trustAuthoredAction`, which reads this
 *     collection, would then let one user promote an action to `trusted` on another user's run;
 *   - a row whose stored `orgId` / `ownerUserId` disagrees with the id it lives under fails CLOSED
 *     (the migrated / hand-written document case the deterministic id alone does not cover) -
 *     including the SHAPE A MIGRATED PRE-OWNER ROW HAS, which carries no `ownerUserId` at all;
 *   - an empty-string org or owner - the "actor with no tenant" and system-actor shapes - reads
 *     nothing and writes nothing, and every leg of that case is proved against a planted row so
 *     none of them is unfailable;
 *   - the LAST GATE refuses a row that still carries a live credential value after redaction, and
 *     refuses it by NOT WRITING it;
 *   - the TWO deliberately cross-tenant readers hand back IDENTIFIERS and nothing else:
 *     `pinnedRunIdsForRetention` (run ids, for the boot sweeper) and, since verification round
 *     three, `listOwnerRefsForKey` (org + owner + action name, for the reconciler that must judge a
 *     row in the org that RAN the action from a write made in the org that AUTHORED it).
 *
 * THE TENANCY FILTERS ARE PROVED REMOVABLE, and where they are NOT individually provable this
 * suite says so instead of implying otherwise. Every count below is MEASURED by reverting the named
 * filter in `action-evidence-store.ts` and re-running THIS file - see the ledger entry.
 *
 * A NOTE ON WHAT "1 case red" USED TO HIDE. The first cut's empty-org case ran five assertions and
 * only ONE of them could ever fail: with no row stored under `orgId: ''`, `getEvidence`, the list
 * read and `discardEvidence` all answer empty whether or not the guard exists, so deleting
 * `isTenantScoped` from three of the four methods was invisible. The case now PLANTS a row under
 * the empty org and the empty owner first, so each leg fails on its own filter.
 */
let mem: MongoMemoryServer;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s1_evidence_isolation');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  __resetConfigForTests();
});

beforeEach(async () => {
  await integrationActionEvidence.deleteMany({});
});

const store = new ActionEvidenceStore();

const KEY = 'probe-integration';
const ACTION = 'consultar_processos';
/** The owner in orgA, and their SAME-ORG PEER - two people, two credentials, one shared definition. */
const OWNER = 'u-owner';
const PEER = 'u-peer';

function apiCall(marker: string): ActionEvidence {
  return {
    kind: 'api-call',
    request: { method: 'GET', url: `https://probe.example/processos?ref=${marker}`, headers: { accept: 'application/json' } },
    response: { status: 200, body: `{"tenant":"${marker}"}`, bodyIsJson: true },
  };
}

async function seed(orgId: string, marker: string, actionName = ACTION, ownerUserId = OWNER): Promise<void> {
  await store.recordEvidence(
    { orgId, ownerUserId, integrationKey: KEY, actionName },
    { backingType: 'api-call', shape: `shape-${marker}`, evidence: apiCall(marker) },
  );
}

describe('tenancy: two orgs, the same integration and the same action', () => {
  beforeEach(async () => {
    await seed('orgA', 'A');
    await seed('orgB', 'B');
  });

  it('the deterministic id puts the two tenants in different documents', () => {
    expect(actionEvidenceIdFor({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION }))
      .not.toBe(actionEvidenceIdFor({ orgId: 'orgB', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION }));
  });

  it('each org reads its OWN evidence and never the other\'s', async () => {
    const a = await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION });
    const b = await store.getEvidence({ orgId: 'orgB', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION });
    expect(a?.evidence).toMatchObject({ kind: 'api-call', response: { body: '{"tenant":"A"}' } });
    expect(b?.evidence).toMatchObject({ kind: 'api-call', response: { body: '{"tenant":"B"}' } });
    expect(a?.orgId).toBe('orgA');
    expect(b?.orgId).toBe('orgB');
  });

  it('the LIST read is scoped too - one integration, one tenant\'s rows only', async () => {
    await seed('orgA', 'A2', 'arquivar_processo');
    await seed('orgB', 'B2', 'arquivar_processo');

    const rowsA = await store.listForIntegration('orgA', OWNER, KEY);
    expect(rowsA).toHaveLength(2);
    expect(rowsA.every((r) => r.orgId === 'orgA')).toBe(true);
    // Named explicitly rather than asserted by count alone: a filter that returned everything would
    // also return two rows for a tenant that happens to hold two.
    expect(rowsA.map((r) => (r.evidence as { response: { body: string } }).response.body).sort())
      .toEqual(['{"tenant":"A"}', '{"tenant":"A2"}']);
  });

  it('a third org that has recorded nothing reads nothing (not somebody else\'s)', async () => {
    expect(await store.getEvidence({ orgId: 'orgC', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).toBeNull();
    expect(await store.listForIntegration('orgC', OWNER, KEY)).toEqual([]);
  });

  it('a discard removes ONE tenant\'s row and leaves the other standing', async () => {
    expect(await store.discardEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).toBe(true);
    expect(await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).toBeNull();
    expect(await store.getEvidence({ orgId: 'orgB', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).not.toBeNull();
  });
});

/**
 * TENANCY WITHIN ONE ORG - the leg the first cut did not have.
 *
 * An `org`-visible definition is one package; the CREDENTIAL behind it is not. `findConfigForOwner`
 * resolves per (orgId, ownerUserId) and `action-consent.ts` keys an approval on (orgId, userId, …),
 * so two colleagues running the same action are two different third-party accounts and two
 * different people's client data.
 */
describe('tenancy: two users of ONE org, the same integration and the same action', () => {
  beforeEach(async () => {
    await seed('orgA', 'OWNER-PRIVATE', ACTION, OWNER);
    await seed('orgA', 'PEER-PRIVATE', ACTION, PEER);
  });

  it('the peer\'s run does not DESTROY the owner\'s sample - two documents, not one', async () => {
    // Counted at the collection: with the org-only key both writes derived the same `_id`, so the
    // peer's run superseded the owner's and the org row then held the peer's private data.
    expect(await integrationActionEvidence.find({})).toHaveLength(2);
    const owner = await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION });
    const peer = await store.getEvidence({ orgId: 'orgA', ownerUserId: PEER, integrationKey: KEY, actionName: ACTION });
    expect(owner!.evidence).toMatchObject({ response: { body: '{"tenant":"OWNER-PRIVATE"}' } });
    expect(peer!.evidence).toMatchObject({ response: { body: '{"tenant":"PEER-PRIVATE"}' } });
  });

  it('neither user can READ the other\'s sample, on the point read or the list read', async () => {
    // The point read is by deterministic id, so asking for the peer's row as the owner cannot
    // produce it; the list read is filtered on the stored owner.
    const ownerRows = await store.listForIntegration('orgA', OWNER, KEY);
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]!.ownerUserId).toBe(OWNER);
    expect((ownerRows[0]!.evidence as { response: { body: string } }).response.body).toBe('{"tenant":"OWNER-PRIVATE"}');

    const peerRows = await store.listForIntegration('orgA', PEER, KEY);
    expect(peerRows.map((r) => (r.evidence as { response: { body: string } }).response.body))
      .toEqual(['{"tenant":"PEER-PRIVATE"}']);
  });

  it('a third member of the same org who has run nothing reads nothing', async () => {
    expect(await store.getEvidence({ orgId: 'orgA', ownerUserId: 'u-stranger', integrationKey: KEY, actionName: ACTION })).toBeNull();
    expect(await store.listForIntegration('orgA', 'u-stranger', KEY)).toEqual([]);
  });

  it('one user\'s discard leaves the other\'s row standing', async () => {
    expect(await store.discardEvidence({ orgId: 'orgA', ownerUserId: PEER, integrationKey: KEY, actionName: ACTION })).toBe(true);
    expect(await store.getEvidence({ orgId: 'orgA', ownerUserId: PEER, integrationKey: KEY, actionName: ACTION })).toBeNull();
    expect(await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).not.toBeNull();
  });
});

describe('tenancy: rows the deterministic id alone does not protect', () => {
  it('a row whose stored orgId disagrees with its id fails CLOSED on the point read', async () => {
    // The migrated / hand-written document. The id says orgA; the row says orgB. Reading it as orgA
    // - which the id lookup alone would do - hands one tenant a document belonging to another.
    await integrationActionEvidence.put({
      _id: actionEvidenceIdFor({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION }),
      orgId: 'orgB',
      ownerUserId: OWNER,
      integrationKey: KEY,
      actionName: ACTION,
      backingType: 'api-call',
      validatedAt: '2026-08-17T00:00:00.000Z',
      evidence: apiCall('SMUGGLED'),
    } as never);

    expect(await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).toBeNull();
  });

  it('a row whose stored ownerUserId disagrees with its id fails CLOSED on the point read', async () => {
    // The same attack one field over: the id says OWNER, the row says PEER. Both stored terms are
    // re-checked because both are in the id, so neither alone can be trusted.
    await integrationActionEvidence.put({
      _id: actionEvidenceIdFor({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION }),
      orgId: 'orgA',
      ownerUserId: PEER,
      integrationKey: KEY,
      actionName: ACTION,
      backingType: 'api-call',
      validatedAt: '2026-08-17T00:00:00.000Z',
      evidence: apiCall('PEER-PRIVATE'),
    } as never);

    expect(await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).toBeNull();
  });

  it('a PRE-OWNER migrated row - stored with no ownerUserId at all - is served to nobody', async () => {
    // The exact document the first cut of this collection wrote. It has an `orgId` and no owner, so
    // the only thing standing between it and whichever member of the org asks first is the stored
    // re-check. `undefined !== ''` and `undefined !== OWNER`, so it fails closed on both.
    await integrationActionEvidence.put({
      _id: actionEvidenceIdFor({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION }),
      orgId: 'orgA',
      integrationKey: KEY,
      actionName: ACTION,
      backingType: 'api-call',
      validatedAt: '2026-08-17T00:00:00.000Z',
      evidence: apiCall('LEGACY-ORG-WIDE'),
    } as never);

    expect(await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).toBeNull();
    expect(await store.listForIntegration('orgA', OWNER, KEY)).toEqual([]);
  });

  it('a LIST row whose stored orgId or ownerUserId disagrees with the filter is dropped', async () => {
    await integrationActionEvidence.put({
      _id: 'hand-written-row-foreign-org',
      orgId: 'orgB',
      ownerUserId: OWNER,
      integrationKey: KEY,
      actionName: 'smuggled-org',
      backingType: 'api-call',
      validatedAt: '2026-08-17T00:00:00.000Z',
      evidence: apiCall('SMUGGLED'),
    } as never);
    await integrationActionEvidence.put({
      _id: 'hand-written-row-foreign-owner',
      orgId: 'orgA',
      ownerUserId: PEER,
      integrationKey: KEY,
      actionName: 'smuggled-owner',
      backingType: 'api-call',
      validatedAt: '2026-08-17T00:00:00.000Z',
      evidence: apiCall('SMUGGLED'),
    } as never);
    await seed('orgA', 'A');

    const rows = await store.listForIntegration('orgA', OWNER, KEY);
    expect(rows.map((r) => r.actionName)).toEqual([ACTION]);
  });

  /**
   * THE EMPTY-TENANT CASE, MADE FAILABLE.
   *
   * The first cut of this case seeded only a REAL tenant's row and then asserted that an empty org
   * read nothing - which is true whether or not any guard exists, because no row was stored under
   * the empty org to read. Three of its four legs could not fail. Each leg here is aimed at a row
   * PLANTED under exactly the key it asks for.
   *
   * WITH ONE MEASURED EXCEPTION, STATED RATHER THAN IMPLIED. Deleting `isTenantScoped` from
   * `getEvidence`, from `listForIntegration` or from `recordEvidence` reddens that method's own leg.
   * Deleting it from `discardEvidence` ALONE does NOT: that method calls `getEvidence`, whose guard
   * enforces the same predicate first, so the two mask each other exactly as the list read's two
   * `orgId` terms do. Removing BOTH reddens the discard leg. No case below claims to prove
   * `discardEvidence`'s guard on its own.
   */
  describe('an EMPTY org or owner reads nothing and writes nothing - the no-tenant actor shape', () => {
    const EMPTY_ORG_ID = actionEvidenceIdFor({ orgId: '', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION });
    const EMPTY_OWNER_ID = actionEvidenceIdFor({ orgId: 'orgA', ownerUserId: '', integrationKey: KEY, actionName: ACTION });

    beforeEach(async () => {
      await seed('orgA', 'A');
      // The rows the guard exists to refuse to serve. `put` goes straight at the collection, which
      // is the only way to create them at all now that `recordEvidence` refuses to.
      for (const [_id, orgId, ownerUserId] of [[EMPTY_ORG_ID, '', OWNER], [EMPTY_OWNER_ID, 'orgA', '']] as const) {
        await integrationActionEvidence.put({
          _id, orgId, ownerUserId, integrationKey: KEY, actionName: ACTION,
          backingType: 'api-call', validatedAt: '2026-08-17T00:00:00.000Z', evidence: apiCall('UNSCOPED'),
        } as never);
      }
    });

    it('the POINT READ refuses both shapes, though a matching document exists', async () => {
      expect(await store.getEvidence({ orgId: '', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).toBeNull();
      expect(await store.getEvidence({ orgId: 'orgA', ownerUserId: '', integrationKey: KEY, actionName: ACTION })).toBeNull();
    });

    it('the LIST READ refuses both shapes, though a matching document exists', async () => {
      expect(await store.listForIntegration('', OWNER, KEY)).toEqual([]);
      expect(await store.listForIntegration('orgA', '', KEY)).toEqual([]);
    });

    it('the DISCARD refuses both shapes, and the planted rows are still there afterwards', async () => {
      expect(await store.discardEvidence({ orgId: '', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).toBe(false);
      expect(await store.discardEvidence({ orgId: 'orgA', ownerUserId: '', integrationKey: KEY, actionName: ACTION })).toBe(false);
      // Asserted at the collection: "answered false" and "deleted nothing" are different claims, and
      // it is the second one that matters for a method whose job is to delete.
      expect(await integrationActionEvidence.get(EMPTY_ORG_ID)).not.toBeNull();
      expect(await integrationActionEvidence.get(EMPTY_OWNER_ID)).not.toBeNull();
    });

    it('the WRITE refuses both shapes', async () => {
      for (const key of [
        { orgId: '', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION },
        { orgId: 'orgA', ownerUserId: '', integrationKey: KEY, actionName: ACTION },
      ]) {
        await expect(store.recordEvidence(key, { backingType: 'api-call', evidence: apiCall('X') }))
          .rejects.toBeInstanceOf(ActionEvidenceStoreError);
      }
    });

    it('…and nothing an empty tenant did disturbed the real one\'s row', async () => {
      expect(await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).not.toBeNull();
    });
  });
});

describe('one live row per action: superseded wholesale, never accumulated', () => {
  it('a second validated run REPLACES the first rather than adding to it', async () => {
    await seed('orgA', 'first');
    await seed('orgA', 'second');
    const rows = await store.listForIntegration('orgA', OWNER, KEY);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.evidence as { response: { body: string } }).response.body).toBe('{"tenant":"second"}');
  });

  it('superseding does not touch the OTHER tenant\'s row for the same action', async () => {
    await seed('orgA', 'A');
    await seed('orgB', 'B');
    await seed('orgA', 'A-again');
    const b = await store.getEvidence({ orgId: 'orgB', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION });
    expect((b!.evidence as { response: { body: string } }).response.body).toBe('{"tenant":"B"}');
  });

  it('superseding does not touch the SAME-ORG PEER\'s row for the same action', async () => {
    await seed('orgA', 'OWNER-1', ACTION, OWNER);
    await seed('orgA', 'PEER-1', ACTION, PEER);
    await seed('orgA', 'OWNER-2', ACTION, OWNER);
    const peer = await store.getEvidence({ orgId: 'orgA', ownerUserId: PEER, integrationKey: KEY, actionName: ACTION });
    expect((peer!.evidence as { response: { body: string } }).response.body).toBe('{"tenant":"PEER-1"}');
  });
});

describe('the last gate: a live credential value is never written', () => {
  /** COMPOSED AT RUN TIME, never a literal - the rule `integration-write-gate.test.ts` states in
   *  its own header. A credential-shaped constant in a committed file is a secret-scanner finding
   *  that someone then has to allowlist, and an allowlisted pattern is one the scanner stops
   *  catching for real. (Caught by the gitleaks pre-commit hook on this very file.) */
  const SECRET = ['sk', 'live', '9f3ac1d8e77b40'].join('_');

  it('refuses a row that still carries a live value after redaction, and writes NOTHING', async () => {
    const leaky: ActionEvidence = {
      kind: 'api-call',
      request: { method: 'POST', url: 'https://probe.example/send', headers: {} },
      // The failure this models: a later slice adds a field, forgets to redact it, and the sample
      // carries the caller's key. The gate walks the WHOLE assembled document, so it catches a
      // field the redaction pass never knew about.
      response: { status: 200, body: `{"echoed":"${SECRET}"}`, bodyIsJson: true },
    };

    await expect(
      store.recordEvidence(
        { orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION },
        { backingType: 'api-call', evidence: leaky, secrets: evidenceSecretsFromValues([SECRET]) },
      ),
    ).rejects.toBeInstanceOf(ActionEvidenceStoreError);

    // Refused means NOT WRITTEN: evidence is worth less than a credential.
    expect(await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).toBeNull();
  });

  it('a refused supersede leaves the PREVIOUS row intact rather than half-replacing it', async () => {
    await seed('orgA', 'clean');
    await expect(
      store.recordEvidence(
        { orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION },
        {
          backingType: 'api-call',
          evidence: { kind: 'api-call', request: { method: 'GET', url: `https://probe.example/?t=${SECRET}`, headers: {} }, response: { status: 200 } },
          secrets: evidenceSecretsFromValues([SECRET]),
        },
      ),
    ).rejects.toBeInstanceOf(ActionEvidenceStoreError);
    const still = await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION });
    expect((still!.evidence as { response: { body: string } }).response.body).toBe('{"tenant":"clean"}');
  });

  it('the same row WITHOUT the value present writes fine - so the refusal is about the value', async () => {
    await store.recordEvidence(
      { orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION },
      {
        backingType: 'api-call',
        evidence: { kind: 'api-call', request: { method: 'POST', url: 'https://probe.example/send', headers: {} }, response: { status: 200, body: '{"echoed":"••••"}' } },
        secrets: evidenceSecretsFromValues([SECRET]),
      },
    );
    expect(await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION })).not.toBeNull();
  });
});

describe('bounds: a row cannot grow without limit', () => {
  it('caps an over-long response body and says so', async () => {
    await store.recordEvidence(
      { orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION },
      {
        backingType: 'api-call',
        evidence: { kind: 'api-call', request: { method: 'GET', url: 'https://probe.example/big', headers: {} }, response: { status: 200, body: 'x'.repeat(MAX_EVIDENCE_EXCERPT_CHARS + 500) } },
      },
    );
    const row = await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION });
    const response = (row!.evidence as { response: { body: string; truncated?: boolean } }).response;
    expect(response.body).toHaveLength(MAX_EVIDENCE_EXCERPT_CHARS);
    expect(response.truncated).toBe(true);
  });

  it('caps the number of pinned steps and says so', async () => {
    await store.recordEvidence(
      { orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION },
      {
        backingType: 'browser-steps',
        evidence: {
          kind: 'automation',
          runId: 'run-1',
          steps: Array.from({ length: MAX_EVIDENCE_STEPS + 10 }, (_, i) => ({ stepIndex: i })),
        },
      },
    );
    const row = await store.getEvidence({ orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION });
    const ev = row!.evidence as { steps: unknown[]; truncated?: boolean };
    expect(ev.steps).toHaveLength(MAX_EVIDENCE_STEPS);
    expect(ev.truncated).toBe(true);
  });
});

describe('the retention pins cross tenants, and carry identifiers only', () => {
  it('returns every tenant\'s pinned run ids and NOTHING else about them', async () => {
    await store.recordEvidence(
      { orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION },
      { backingType: 'browser-steps', evidence: { kind: 'automation', runId: 'run-A', steps: [{ stepIndex: 0, excerpt: 'orgA private text' }] } },
    );
    await store.recordEvidence(
      { orgId: 'orgB', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION },
      { backingType: 'bash-cli', evidence: { kind: 'automation', runId: 'run-B', steps: [{ stepIndex: 0, excerpt: 'orgB private text' }] } },
    );
    // An api-call row pins nothing: there are no screenshots to spare.
    await seed('orgA', 'A', 'http_action');

    const pins = await store.pinnedRunIdsForRetention();

    // Cross-tenant BY NECESSITY (the sweep walks a filesystem tree that has no org in it)…
    expect([...pins].sort()).toEqual(['run-A', 'run-B']);
    // …and what crosses is a Set of strings, so there is no org, no action and no excerpt to leak.
    expect([...pins].every((p) => typeof p === 'string')).toBe(true);
  });

  it('a superseded run RELEASES its pin in the same write', async () => {
    await store.recordEvidence(
      { orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION },
      { backingType: 'browser-steps', evidence: { kind: 'automation', runId: 'run-old', steps: [] } },
    );
    await store.recordEvidence(
      { orgId: 'orgA', ownerUserId: OWNER, integrationKey: KEY, actionName: ACTION },
      { backingType: 'browser-steps', evidence: { kind: 'automation', runId: 'run-new', steps: [] } },
    );
    // This is what bounds the retention extension: pins do not accumulate with run volume.
    expect([...await store.pinnedRunIdsForRetention()]).toEqual(['run-new']);
  });
});

/**
 * THE LAST MULTI-ROW DELETE IN THE MODULE (verification round five).
 *
 * Two describes used to sit here, one per collector: `listOwnerRefsInOrg` (the write-time
 * reconciler's org-scoped listing, itself a narrowing of round three's cross-tenant
 * `listOwnerRefsForKey`) and `discardOwnerEvidence` (the reader's own collection). BOTH METHODS ARE
 * DELETED with the collectors they served - the question those collectors asked, "is this action
 * gone?", is not answerable at one instant for a row whose lifetime is durable, and four rounds of
 * asking it produced five defects. Nothing in this codebase enumerates who holds a row any more.
 *
 * `discardEvidenceForDisconnectedConfig` is what is left that can touch more than one document, and
 * it is a DURABLE OWNER SIGNAL rather than a reachability guess: `deleteConfig` removed the
 * credential whose third-party account the samples hold, and the person who connected it removed it.
 * Being the widest remaining delete, it gets the Rule 5 treatment - both of its arms, both tenancy
 * terms, with a control so "reached nothing" cannot be satisfied by a primitive that stopped
 * deleting.
 */
describe('the credential erasure reaches ONE tenant\'s rows, on either arm', () => {
  const seedRow = (orgId: string, ownerUserId: string, body: string, integrationKey = KEY) =>
    store.recordEvidence(
      { orgId, ownerUserId, integrationKey, actionName: ACTION },
      { backingType: 'api-call', evidence: { kind: 'api-call', request: { method: 'GET', url: 'https://x/y', headers: {} }, response: { status: 200, body } } },
    );

  beforeEach(async () => {
    await seedRow('orgA', OWNER, 'orgA owner private text');
    await seedRow('orgA', PEER, 'orgA peer private text');
    await seedRow('orgB', OWNER, 'orgB private text');
    await seedRow('orgA', OWNER, 'another integration', 'outra-integracao');
  });

  it('the OWNER-STAMPED arm reaches one org, one owner, one integration - and no other tenant', async () => {
    // The same owner id exists in orgB, and the same org holds a peer and a second integration.
    // Only the named triple goes.
    expect(await store.discardEvidenceForDisconnectedConfig({
      orgId: 'orgA', integrationKey: KEY, owner: { userId: OWNER },
    })).toBe(1);

    const left = (await integrationActionEvidence.find({})) as unknown as { orgId: string; ownerUserId: string; integrationKey: string }[];
    expect(left.map((r) => `${r.orgId}/${r.ownerUserId}/${r.integrationKey}`).sort())
      .toEqual([`orgA/${OWNER}/outra-integracao`, `orgA/${PEER}/${KEY}`, `orgB/${OWNER}/${KEY}`].sort());
    expect(JSON.stringify(await integrationActionEvidence.find({}))).not.toContain('orgA owner private text');
    expect(JSON.stringify(await integrationActionEvidence.find({}))).toContain('orgB private text');
  });

  it('the ORG-SHARED arm is an EXCLUSION list and still never leaves its org', async () => {
    // `$nin` is the widest filter in this module. Its org and integration terms are what confine it:
    // orgB's row is held by the very owner named in the exclusion list and must be untouched anyway,
    // because it is not this org's.
    expect(await store.discardEvidenceForDisconnectedConfig({
      orgId: 'orgA', integrationKey: KEY, owner: { everyOwnerExcept: [OWNER] },
    })).toBe(1);

    const left = (await integrationActionEvidence.find({})) as unknown as { orgId: string; ownerUserId: string; integrationKey: string }[];
    expect(left.map((r) => `${r.orgId}/${r.ownerUserId}/${r.integrationKey}`).sort())
      .toEqual([`orgA/${OWNER}/${KEY}`, `orgA/${OWNER}/outra-integracao`, `orgB/${OWNER}/${KEY}`].sort());
    expect(JSON.stringify(await integrationActionEvidence.find({}))).not.toContain('orgA peer private text');
  });

  /**
   * THE EMPTY-TERM CASE, MADE FAILABLE THE SAME WAY THE POINT-READ ONE WAS.
   *
   * Asserting that `orgId: ''` erases nothing is UNFAILABLE against ordinary rows: no row carries an
   * empty org, so the query matches nothing whether or not the guard exists, and deleting the guard
   * leaves this green (measured). Each leg is therefore aimed at a row PLANTED under exactly the
   * term it names - the migrated / hand-written shapes `recordEvidence` refuses to create - so the
   * guard is the only thing standing between the call and a deletion.
   */
  it('an empty org, key or owner erases NOTHING - asserted against rows planted under those keys', async () => {
    const planted = [
      { _id: 'plant-empty-org', orgId: '', ownerUserId: OWNER, integrationKey: KEY },
      { _id: 'plant-empty-key', orgId: 'orgA', ownerUserId: OWNER, integrationKey: '' },
      { _id: 'plant-empty-owner', orgId: 'orgA', ownerUserId: '', integrationKey: KEY },
    ];
    for (const row of planted) {
      await integrationActionEvidence.put({
        ...row, actionName: ACTION, backingType: 'api-call',
        validatedAt: '2026-08-17T00:00:00.000Z',
        evidence: { kind: 'api-call', request: { method: 'GET', url: 'https://x/y', headers: {} }, response: { status: 200, body: 'UNSCOPED' } },
      } as never);
    }

    // The widest filter in the module with a narrowing term removed is "every row in the
    // installation". Each of these names a term that a planted row would match.
    expect(await store.discardEvidenceForDisconnectedConfig({ orgId: '', integrationKey: KEY, owner: { everyOwnerExcept: [] } })).toBe(0);
    expect(await store.discardEvidenceForDisconnectedConfig({ orgId: 'orgA', integrationKey: '', owner: { everyOwnerExcept: [] } })).toBe(0);
    expect(await store.discardEvidenceForDisconnectedConfig({ orgId: 'orgA', integrationKey: KEY, owner: { userId: '' } })).toBe(0);
    // Asserted at the collection: "answered 0" and "deleted nothing" are different claims.
    for (const row of planted) expect(await integrationActionEvidence.get(row._id)).not.toBeNull();
    expect(await integrationActionEvidence.find({})).toHaveLength(7);

    // THE CONTROL: the same call with real terms does erase, so the three refusals above are the
    // guards and not a primitive that had stopped deleting. The planted empty-OWNER row goes too -
    // `$nin` matches a row carrying no owner, which the method's own comment records as deliberate.
    expect(await store.discardEvidenceForDisconnectedConfig({
      orgId: 'orgA', integrationKey: KEY, owner: { everyOwnerExcept: [] },
    })).toBe(3);
    expect(await integrationActionEvidence.find({})).toHaveLength(4);
  });
});
