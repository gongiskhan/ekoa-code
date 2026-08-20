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
 * WHAT IT ATTACKS. Evidence is one tenant's REAL request and REAL response body - client names,
 * processo numbers, invoice totals - captured from a live third-party call. Cross-tenant bleed here
 * is a data breach, not an inconvenience, so tenancy is attacked directly rather than assumed:
 *
 *   - two orgs holding evidence for the SAME (integration, action) never see each other's, on the
 *     point read OR the list read;
 *   - a row whose stored `orgId` disagrees with the id it lives under fails CLOSED (the migrated /
 *     hand-written document case, which the deterministic id alone does not cover);
 *   - an empty-string org - the "actor with no tenant" shape - reads nothing and writes nothing;
 *   - the LAST GATE refuses a row that still carries a live credential value after redaction, and
 *     refuses it by NOT WRITING it;
 *   - the one deliberately cross-tenant reader (`pinnedRunIdsForRetention`) hands back run
 *     IDENTIFIERS and nothing else.
 *
 * THE TENANCY FILTERS ARE PROVED REMOVABLE, and where they are NOT individually provable this
 * suite says so instead of implying otherwise. Measured by reverting each in turn:
 *
 *   - `getEvidence`'s stored-`orgId` re-check          -> 1 case red
 *   - the empty-org guard (`isTenantScoped`)           -> 1 case red
 *   - the `orgId` term of the deterministic `_id`      -> 6 cases red
 *   - the last gate (`assertNoLiveSecret`)             -> 2 cases red
 *   - `listForIntegration`'s query term, ALONE         -> GREEN (survives)
 *   - `listForIntegration`'s post-filter, ALONE        -> GREEN (survives)
 *   - both list terms together                         -> 3 cases red
 *
 * The two list terms enforce the SAME predicate on the SAME field, so each masks the other and
 * neither is individually observable - they are equivalent mutants, not an untested filter. The
 * store's own docblock records why both are kept. No test below claims to prove one of them alone.
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

function apiCall(marker: string): ActionEvidence {
  return {
    kind: 'api-call',
    request: { method: 'GET', url: `https://probe.example/processos?ref=${marker}`, headers: { accept: 'application/json' } },
    response: { status: 200, body: `{"tenant":"${marker}"}`, bodyIsJson: true },
  };
}

async function seed(orgId: string, marker: string, actionName = ACTION): Promise<void> {
  await store.recordEvidence(
    { orgId, integrationKey: KEY, actionName },
    { backingType: 'api-call', shape: `shape-${marker}`, evidence: apiCall(marker) },
  );
}

describe('tenancy: two orgs, the same integration and the same action', () => {
  beforeEach(async () => {
    await seed('orgA', 'A');
    await seed('orgB', 'B');
  });

  it('the deterministic id puts the two tenants in different documents', () => {
    expect(actionEvidenceIdFor({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION }))
      .not.toBe(actionEvidenceIdFor({ orgId: 'orgB', integrationKey: KEY, actionName: ACTION }));
  });

  it('each org reads its OWN evidence and never the other\'s', async () => {
    const a = await store.getEvidence({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION });
    const b = await store.getEvidence({ orgId: 'orgB', integrationKey: KEY, actionName: ACTION });
    expect(a?.evidence).toMatchObject({ kind: 'api-call', response: { body: '{"tenant":"A"}' } });
    expect(b?.evidence).toMatchObject({ kind: 'api-call', response: { body: '{"tenant":"B"}' } });
    expect(a?.orgId).toBe('orgA');
    expect(b?.orgId).toBe('orgB');
  });

  it('the LIST read is scoped too - one integration, one tenant\'s rows only', async () => {
    await seed('orgA', 'A2', 'arquivar_processo');
    await seed('orgB', 'B2', 'arquivar_processo');

    const rowsA = await store.listForIntegration('orgA', KEY);
    expect(rowsA).toHaveLength(2);
    expect(rowsA.every((r) => r.orgId === 'orgA')).toBe(true);
    // Named explicitly rather than asserted by count alone: a filter that returned everything would
    // also return two rows for a tenant that happens to hold two.
    expect(rowsA.map((r) => (r.evidence as { response: { body: string } }).response.body).sort())
      .toEqual(['{"tenant":"A"}', '{"tenant":"A2"}']);
  });

  it('a third org that has recorded nothing reads nothing (not somebody else\'s)', async () => {
    expect(await store.getEvidence({ orgId: 'orgC', integrationKey: KEY, actionName: ACTION })).toBeNull();
    expect(await store.listForIntegration('orgC', KEY)).toEqual([]);
  });

  it('a discard removes ONE tenant\'s row and leaves the other standing', async () => {
    expect(await store.discardEvidence({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION })).toBe(true);
    expect(await store.getEvidence({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION })).toBeNull();
    expect(await store.getEvidence({ orgId: 'orgB', integrationKey: KEY, actionName: ACTION })).not.toBeNull();
  });
});

describe('tenancy: rows the deterministic id alone does not protect', () => {
  it('a row whose stored orgId disagrees with its id fails CLOSED on the point read', async () => {
    // The migrated / hand-written document. The id says orgA; the row says orgB. Reading it as orgA
    // - which the id lookup alone would do - hands one tenant a document belonging to another.
    await integrationActionEvidence.put({
      _id: actionEvidenceIdFor({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION }),
      orgId: 'orgB',
      integrationKey: KEY,
      actionName: ACTION,
      backingType: 'api-call',
      validatedAt: '2026-08-17T00:00:00.000Z',
      evidence: apiCall('SMUGGLED'),
    } as never);

    expect(await store.getEvidence({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION })).toBeNull();
  });

  it('a LIST row whose stored orgId disagrees with the filter is dropped', async () => {
    await integrationActionEvidence.put({
      _id: 'hand-written-row',
      orgId: 'orgB',
      integrationKey: KEY,
      actionName: 'smuggled',
      backingType: 'api-call',
      validatedAt: '2026-08-17T00:00:00.000Z',
      evidence: apiCall('SMUGGLED'),
    } as never);
    await seed('orgA', 'A');

    const rows = await store.listForIntegration('orgA', KEY);
    expect(rows.map((r) => r.actionName)).toEqual([ACTION]);
  });

  it('an EMPTY org reads nothing and writes nothing - the no-tenant actor shape', async () => {
    await seed('orgA', 'A');
    expect(await store.getEvidence({ orgId: '', integrationKey: KEY, actionName: ACTION })).toBeNull();
    expect(await store.listForIntegration('', KEY)).toEqual([]);
    expect(await store.discardEvidence({ orgId: '', integrationKey: KEY, actionName: ACTION })).toBe(false);
    await expect(
      store.recordEvidence({ orgId: '', integrationKey: KEY, actionName: ACTION }, { backingType: 'api-call', evidence: apiCall('X') }),
    ).rejects.toBeInstanceOf(ActionEvidenceStoreError);
    // …and nothing an empty org did disturbed the real tenant's row.
    expect(await store.getEvidence({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION })).not.toBeNull();
  });
});

describe('one live row per action: superseded wholesale, never accumulated', () => {
  it('a second validated run REPLACES the first rather than adding to it', async () => {
    await seed('orgA', 'first');
    await seed('orgA', 'second');
    const rows = await store.listForIntegration('orgA', KEY);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.evidence as { response: { body: string } }).response.body).toBe('{"tenant":"second"}');
  });

  it('superseding does not touch the OTHER tenant\'s row for the same action', async () => {
    await seed('orgA', 'A');
    await seed('orgB', 'B');
    await seed('orgA', 'A-again');
    const b = await store.getEvidence({ orgId: 'orgB', integrationKey: KEY, actionName: ACTION });
    expect((b!.evidence as { response: { body: string } }).response.body).toBe('{"tenant":"B"}');
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
        { orgId: 'orgA', integrationKey: KEY, actionName: ACTION },
        { backingType: 'api-call', evidence: leaky, secrets: evidenceSecretsFromValues([SECRET]) },
      ),
    ).rejects.toBeInstanceOf(ActionEvidenceStoreError);

    // Refused means NOT WRITTEN: evidence is worth less than a credential.
    expect(await store.getEvidence({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION })).toBeNull();
  });

  it('a refused supersede leaves the PREVIOUS row intact rather than half-replacing it', async () => {
    await seed('orgA', 'clean');
    await expect(
      store.recordEvidence(
        { orgId: 'orgA', integrationKey: KEY, actionName: ACTION },
        {
          backingType: 'api-call',
          evidence: { kind: 'api-call', request: { method: 'GET', url: `https://probe.example/?t=${SECRET}`, headers: {} }, response: { status: 200 } },
          secrets: evidenceSecretsFromValues([SECRET]),
        },
      ),
    ).rejects.toBeInstanceOf(ActionEvidenceStoreError);
    const still = await store.getEvidence({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION });
    expect((still!.evidence as { response: { body: string } }).response.body).toBe('{"tenant":"clean"}');
  });

  it('the same row WITHOUT the value present writes fine - so the refusal is about the value', async () => {
    await store.recordEvidence(
      { orgId: 'orgA', integrationKey: KEY, actionName: ACTION },
      {
        backingType: 'api-call',
        evidence: { kind: 'api-call', request: { method: 'POST', url: 'https://probe.example/send', headers: {} }, response: { status: 200, body: '{"echoed":"••••"}' } },
        secrets: evidenceSecretsFromValues([SECRET]),
      },
    );
    expect(await store.getEvidence({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION })).not.toBeNull();
  });
});

describe('bounds: a row cannot grow without limit', () => {
  it('caps an over-long response body and says so', async () => {
    await store.recordEvidence(
      { orgId: 'orgA', integrationKey: KEY, actionName: ACTION },
      {
        backingType: 'api-call',
        evidence: { kind: 'api-call', request: { method: 'GET', url: 'https://probe.example/big', headers: {} }, response: { status: 200, body: 'x'.repeat(MAX_EVIDENCE_EXCERPT_CHARS + 500) } },
      },
    );
    const row = await store.getEvidence({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION });
    const response = (row!.evidence as { response: { body: string; truncated?: boolean } }).response;
    expect(response.body).toHaveLength(MAX_EVIDENCE_EXCERPT_CHARS);
    expect(response.truncated).toBe(true);
  });

  it('caps the number of pinned steps and says so', async () => {
    await store.recordEvidence(
      { orgId: 'orgA', integrationKey: KEY, actionName: ACTION },
      {
        backingType: 'browser-steps',
        evidence: {
          kind: 'automation',
          runId: 'run-1',
          steps: Array.from({ length: MAX_EVIDENCE_STEPS + 10 }, (_, i) => ({ stepIndex: i })),
        },
      },
    );
    const row = await store.getEvidence({ orgId: 'orgA', integrationKey: KEY, actionName: ACTION });
    const ev = row!.evidence as { steps: unknown[]; truncated?: boolean };
    expect(ev.steps).toHaveLength(MAX_EVIDENCE_STEPS);
    expect(ev.truncated).toBe(true);
  });
});

describe('the retention pins cross tenants, and carry identifiers only', () => {
  it('returns every tenant\'s pinned run ids and NOTHING else about them', async () => {
    await store.recordEvidence(
      { orgId: 'orgA', integrationKey: KEY, actionName: ACTION },
      { backingType: 'browser-steps', evidence: { kind: 'automation', runId: 'run-A', steps: [{ stepIndex: 0, excerpt: 'orgA private text' }] } },
    );
    await store.recordEvidence(
      { orgId: 'orgB', integrationKey: KEY, actionName: ACTION },
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
      { orgId: 'orgA', integrationKey: KEY, actionName: ACTION },
      { backingType: 'browser-steps', evidence: { kind: 'automation', runId: 'run-old', steps: [] } },
    );
    await store.recordEvidence(
      { orgId: 'orgA', integrationKey: KEY, actionName: ACTION },
      { backingType: 'browser-steps', evidence: { kind: 'automation', runId: 'run-new', steps: [] } },
    );
    // This is what bounds the retention extension: pins do not accumulate with run volume.
    expect([...await store.pinnedRunIdsForRetention()]).toEqual(['run-new']);
  });
});
