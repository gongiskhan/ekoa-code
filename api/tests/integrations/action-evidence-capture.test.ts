import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  integrationConfigs,
  integrationDefinitions,
  approvedIntegrationActions,
  integrationActionEvidence,
} from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { createConfig } from '../../src/integrations/service.js';
import { executeUserIntegrationAction, type FetchLike, type ExecutorDeps } from '../../src/integrations/action-executor.js';
import { actionShape } from '../../src/integrations/action-consent.js';
import {
  actionEvidenceStore,
  MAX_EVIDENCE_EXCERPT_CHARS,
  type ApiCallEvidence,
} from '../../src/integrations/action-evidence-store.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';

/**
 * SLICE S1 - EVIDENCE CAPTURE, through the REAL executor.
 *
 * The claim this suite has to make good is narrow and load-bearing: the redacted `requestSummary`
 * the executor already builds on every call, and already persists on the FAILURE path, is now also
 * kept on SUCCESS - and nothing about what may be stored changed on the way.
 *
 * SO THE ENTRY POINT IS `executeUserIntegrationAction` ITSELF, not a hand-assembled evidence row.
 * A test that built the sample itself would prove the store works and prove nothing about whether
 * production ever reaches it. Only the TRANSPORT is faked (the executor's own injectable seam);
 * the definition, the config, the credential decryption, the interpolation, the redaction and the
 * store are all real.
 *
 * THE CREDENTIAL IS NEVER A LITERAL HERE - composed at run time, like the write-gate suite's, so
 * nothing in this file is a credential-shaped string a scanner has to be told to ignore.
 */
const ORG = 'orgEv';
const OTHER_ORG = 'orgEvB';
const OWNER = 'u-ev-owner';
const KEY = 'probe';

/** Composed at run time - never a literal. */
const PROBE_SECRET = ['sk', 'live', 'EV', Math.random().toString(36).slice(2, 12)].join('-');

let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const HOST = 'https://api.probe.example';

const mkResponse = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Bad Request',
  headers: { forEach: () => undefined },
  text: async () => body,
});

function fetchReturning(status: number, body: string): FetchLike {
  return async () => mkResponse(status, body) as unknown as Response;
}

/** The real evidence store, bound exactly as `server.ts` binds it. */
const evidenceDeps: Pick<ExecutorDeps, 'recordActionEvidence'> = {
  recordActionEvidence: (key, input) => actionEvidenceStore.recordEvidence(key, input),
};

/** A READ action, so no approval is needed and the case is about the capture alone. The credential
 *  rides in BOTH a header and a query parameter - the two places a naive capture leaks it. */
const readAction: IntegrationAction = {
  actionName: 'listar_processos',
  description: 'Lista os processos',
  mutates: false,
  httpConfig: {
    method: 'GET',
    baseUrl: HOST,
    path: '/processos',
    headers: { Authorization: 'Bearer {{api_key}}' },
    queryParams: { token: '{{api_key}}' },
  },
};

async function seed(actions: IntegrationAction[], orgId = ORG, userId = OWNER): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId, visibility: 'private', key: KEY,
      displayName: KEY, configSchema: [], actions, skillMd: `# ${KEY}`, authType: 'api_key',
    },
    { actor: { userId, orgId, role: 'user' }, onConflict: 'replace' },
  );
  await createConfig(
    { userId, orgId, role: 'user' },
    { integrationKey: KEY, configValues: { api_key: PROBE_SECRET } },
    deps,
  );
}

const run = (fetchImpl: FetchLike, actionName = readAction.actionName, orgId = ORG, userId = OWNER) =>
  executeUserIntegrationAction(
    { orgId, ownerUserId: userId, integrationKey: KEY, actionName, args: {} },
    { fetchImpl, ...evidenceDeps },
  );

const evidenceOf = async (orgId = ORG, actionName = readAction.actionName, ownerUserId = OWNER) =>
  actionEvidenceStore.getEvidence({ orgId, ownerUserId, integrationKey: KEY, actionName });

/**
 * The stored body, parsed.
 *
 * A JSON body is stored CANONICALISED (`safeStringify` of the parsed value), not as the raw wire
 * text - which is not an accident of this slice but the reuse it claims: the executor's FAILURE
 * dump has always done exactly this, and the whole safety argument for the success sample is that
 * it goes through the same two calls. Asserting on parsed values keeps these cases about WHAT was
 * captured rather than about whitespace.
 */
const bodyJson = (ev: ApiCallEvidence): unknown => JSON.parse(ev.response.body!);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s1_evidence_capture');
}, 60_000);

afterAll(async () => { await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  for (const s of [integrationConfigs, integrationDefinitions, approvedIntegrationActions, integrationActionEvidence]) {
    await s.deleteMany({});
  }
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
});

describe('a 2xx api-call leaves evidence the executor used to discard', () => {
  it('records the request summary and a response sample under the caller\'s tenant', async () => {
    await seed([readAction]);
    const res = await run(fetchReturning(200, '{"items":[{"id":41}]}'));
    expect(res.success).toBe(true);

    const row = await evidenceOf();
    expect(row).not.toBeNull();
    expect(row!.orgId).toBe(ORG);
    expect(row!.backingType).toBe('api-call');
    const ev = row!.evidence as ApiCallEvidence;
    expect(ev.kind).toBe('api-call');
    expect(ev.request.method).toBe('GET');
    expect(ev.response.status).toBe(200);
    expect(bodyJson(ev)).toEqual({ items: [{ id: 41 }] });
    expect(ev.response.bodyIsJson).toBe(true);
  });

  it('stamps the SHAPE the run exercised, which is what a promotion is bound to', async () => {
    await seed([readAction]);
    await run(fetchReturning(200, '{}'));
    const row = await evidenceOf();
    // Equal to the action's own fingerprint - the same value `promoteToTrusted` compares against.
    expect(row!.shape).toBe(actionShape(KEY, readAction));
  });

  it('the sample carries NO live credential, in the URL or in the headers', async () => {
    await seed([readAction]);
    await run(fetchReturning(200, '{"ok":true}'));

    const ev = (await evidenceOf())!.evidence as ApiCallEvidence;
    // The credential rode in a header AND a query parameter on the real request. Neither survives.
    expect(JSON.stringify(ev)).not.toContain(PROBE_SECRET);
    expect(ev.request.url).not.toContain(PROBE_SECRET);
    expect(JSON.stringify(ev.request.headers)).not.toContain(PROBE_SECRET);
  });

  it('a response body that ECHOES the caller\'s own credential is redacted before it is stored', async () => {
    // The upstream that reflects your key back at you. This is the case the store's last gate
    // exists for, reached through the real executor rather than by handing the store a bad row.
    await seed([readAction]);
    const res = await run(fetchReturning(200, `{"echo":"${PROBE_SECRET}"}`));
    expect(res.success).toBe(true);

    const row = await evidenceOf();
    // The row was written - so the redaction happened BEFORE the gate, rather than the gate simply
    // refusing everything that mentions a secret.
    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(PROBE_SECRET);
  });

  it('caps an enormous response body and says it did', async () => {
    await seed([readAction]);
    await run(fetchReturning(200, 'y'.repeat(MAX_EVIDENCE_EXCERPT_CHARS + 5_000)));
    const ev = (await evidenceOf())!.evidence as ApiCallEvidence;
    expect(ev.response.body!.length).toBeLessThanOrEqual(MAX_EVIDENCE_EXCERPT_CHARS);
    expect(ev.response.truncated).toBe(true);
  });
});

describe('evidence is the LAST VALIDATED run, so a failure is not one', () => {
  it('a 4xx records nothing at all', async () => {
    await seed([readAction]);
    const res = await run(fetchReturning(400, '{"error":"nope"}'));
    expect(res.success).toBe(false);
    expect(await evidenceOf()).toBeNull();
  });

  it('a failing run does NOT replace the evidence of the last successful one', async () => {
    await seed([readAction]);
    await run(fetchReturning(200, '{"good":true}'));
    await run(fetchReturning(500, 'upstream is down'));

    const ev = (await evidenceOf())!.evidence as ApiCallEvidence;
    // The point of the property: a user looking at the detail page after an outage still sees what
    // the action does when it works, rather than an empty panel.
    expect(bodyJson(ev)).toEqual({ good: true });
    expect(ev.response.status).toBe(200);
  });

  it('a transport error records nothing', async () => {
    await seed([readAction]);
    const res = await run(async () => { throw new Error('connect ECONNREFUSED'); });
    expect(res.success).toBe(false);
    expect(await evidenceOf()).toBeNull();
  });
});

describe('one live row per action, superseded wholesale', () => {
  it('a second success replaces the first', async () => {
    await seed([readAction]);
    await run(fetchReturning(200, '{"n":1}'));
    await run(fetchReturning(200, '{"n":2}'));

    const rows = await actionEvidenceStore.listForIntegration(ORG, OWNER, KEY);
    expect(rows).toHaveLength(1);
    expect(bodyJson(rows[0]!.evidence as ApiCallEvidence)).toEqual({ n: 2 });
  });

  it('another tenant running the same action gets its OWN row, not this one', async () => {
    await seed([readAction]);
    await seed([readAction], OTHER_ORG, OWNER);
    await run(fetchReturning(200, '{"tenant":"A"}'));
    await run(fetchReturning(200, '{"tenant":"B"}'), readAction.actionName, OTHER_ORG);

    expect(bodyJson((await evidenceOf(ORG))!.evidence as ApiCallEvidence)).toEqual({ tenant: 'A' });
    expect(bodyJson((await evidenceOf(OTHER_ORG))!.evidence as ApiCallEvidence)).toEqual({ tenant: 'B' });
  });
});

describe('capture is best-effort: it can never turn a successful call into a failed one', () => {
  it('a store that throws is logged, not raised - the action still reports success', async () => {
    await seed([readAction]);
    const res = await executeUserIntegrationAction(
      { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: readAction.actionName, args: {} },
      {
        fetchImpl: fetchReturning(200, '{"ok":true}'),
        recordActionEvidence: async () => { throw new Error('mongo is unhappy'); },
      },
    );
    // The call ALREADY happened against the third party by the time evidence is written. Reporting
    // it as failed would tell a user their write did not land when it did.
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ ok: true });
  });

  it('with NO evidence seam bound at all, execution is byte-for-byte the pre-S1 behaviour', async () => {
    await seed([readAction]);
    const res = await executeUserIntegrationAction(
      { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: readAction.actionName, args: {} },
      { fetchImpl: fetchReturning(200, '{"ok":true}') },
    );
    expect(res.success).toBe(true);
    expect(await evidenceOf()).toBeNull();
  });
});
