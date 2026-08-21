import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  integrationConfigs,
  integrationDefinitions,
  approvedIntegrationActions,
  integrationActionEvidence,
  automations,
  automationRuns,
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
  type AutomationEvidence,
} from '../../src/integrations/action-evidence-store.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';
import { automationBackedActionHandler } from '../../src/automation/service.js';
import { automationRunStore } from '../../src/automation/persistence.js';
import { collectRunEvidence } from '../../src/automation/action-evidence.js';
import type { RunAutomationOptions, RunAutomationResult, RunContext } from '../../src/automation/engine.js';
import type { RunStatus, StepRecord } from '../../src/automation/types.js';

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

// ---------------------------------------------------------------------------------------------
// THE AUTOMATION HALF of the same property (round eight). Everything below `deps.run` is real: the
// executor, the production seam mapping, the real run store, the real collector, the real evidence
// store, real Mongo.
// ---------------------------------------------------------------------------------------------

const AUTOMATION_ID = 'auto-probe';

/**
 * A browser-steps action on the SAME integration, so the definition still declares `HOST` through
 * `readAction` and the egress binding this rail resolves is a non-empty allow-list rather than the
 * `origin_refused` a definition with no declared host would produce. A READ, for the same reason
 * `readAction` is one: no approval is needed, so the case is about the capture alone.
 */
const browserAction: IntegrationAction = {
  actionName: 'abrir_processo',
  description: 'Abre o processo no portal',
  mutates: false,
  automationBinding: { automationId: AUTOMATION_ID },
};

/** The automation the binding names, owned by the caller - `runAutomationForAction` refuses
 *  `unknown_automation` without it and `forbidden` if somebody else owns it. */
async function seedAutomation(): Promise<void> {
  await automations.insert({
    _id: AUTOMATION_ID,
    id: AUTOMATION_ID,
    name: 'abrir o processo',
    description: 'abre o portal e abre o processo',
    ownerUserId: OWNER,
    orgId: ORG,
    steps: [{ id: 's1', description: 'abrir o processo', type: 'browser' }],
    createdAt: '2026-08-21T08:00:00.000Z',
    updatedAt: '2026-08-21T08:00:00.000Z',
  } as never);
}

/** One real `StepRecord`. `completed`/`failed` are members of `StepStatus` and `cache` of
 *  `StepTier`; a browser step carries a `screenshotPath` and no `output`. */
const step = (index: number, status: StepRecord['status'], file: string): StepRecord => ({
  stepId: `s${index}`,
  index,
  status,
  tier: 'cache',
  durationMs: 1,
  screenshotPath: `automation-runs/${AUTOMATION_ID}/${file}`,
  ...(status === 'failed'
    ? { error: { message: 'o portal respondeu com um ecrã de sessão expirada', recoverable: false } }
    : {}),
});

/**
 * THE ENGINE, STOOD IN FOR AT ITS OWN INJECTED SEAM (`ActionRunDeps.run`) - and writing its run
 * record through the PRODUCTION WRITER.
 *
 * FIXTURE HONESTY, WHICH IS THE WHOLE REASON THIS IS SHAPED LIKE THIS. The `automationRuns`
 * document is not hand-inserted: it is created at `running` and then patched to its terminal status
 * through `automationRunStore`, which is the exact pair of calls `runOrRehearse` makes
 * (`automation/engine.ts`, "Run records persist at EVERY status transition"). So what
 * `collectRunEvidence` reads afterwards is a document of the shape the engine really leaves behind,
 * and the run id is the one the SERVICE minted and handed in - the same id that rides out on
 * `ActionRunEnvelope.runId` and inside `automation_failed`'s `data`.
 *
 * The engine itself cannot be driven here: a real run needs a paired machine, a browser and the
 * vision resolver. What is being tested is not the engine but what the EXECUTOR does with the two
 * answers it can get back, so the seam is filled and everything downstream of it is production.
 */
function engineEnding(status: RunStatus, steps: StepRecord[]): { run: (a: string, c: RunContext, o?: RunAutomationOptions) => Promise<RunAutomationResult>; minted: string[] } {
  const minted: string[] = [];
  return {
    minted,
    run: async (automationId, ctx, options = {}) => {
      if (!options.runId) {
        // The service mints the id and passes it in; a stand-in that minted its own would be
        // testing a wiring production does not have.
        throw new Error('expected the service to mint the run id and hand it to the engine');
      }
      const runId = options.runId;
      minted.push(runId);
      await automationRunStore.create({
        id: runId,
        automationId,
        startedAt: '2026-08-21T09:00:00.000Z',
        status: 'running',
        inputs: {},
        steps: [],
        triggeredBy: ctx.triggeredBy,
        ownerUserId: ctx.ownerUserId,
        orgId: ctx.orgId,
      });
      await automationRunStore.update(automationId, runId, { status, steps, endedAt: '2026-08-21T09:00:05.000Z' });
      return {
        runId,
        status,
        durationMs: 5_000,
        summary: status === 'completed' ? 'abriu o processo' : 'o passo 0 falhou',
        lastStepIndex: steps.length - 1,
        ...(status === 'completed' ? {} : { error: 'a automação não completou' }),
      };
    },
  };
}

/** The action, entered where production enters it, with the production seam mapping and BOTH real
 *  evidence seams bound exactly as `server.ts` binds them. */
const runBrowserAction = (engine: { run: (a: string, c: RunContext, o?: RunAutomationOptions) => Promise<RunAutomationResult> }) =>
  executeUserIntegrationAction(
    { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: browserAction.actionName, args: {} },
    {
      ...evidenceDeps,
      collectRunEvidence: (runId) => collectRunEvidence(runId),
      runAutomationBackedAction: automationBackedActionHandler({ run: engine.run }),
    },
  );

const automationEvidenceOf = async (): Promise<AutomationEvidence | undefined> => {
  const row = await actionEvidenceStore.getEvidence({
    orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: browserAction.actionName,
  });
  return row?.evidence as AutomationEvidence | undefined;
};

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
  for (const s of [integrationConfigs, integrationDefinitions, approvedIntegrationActions, integrationActionEvidence, automations, automationRuns]) {
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

  /**
   * ONE BODY, TWO PATHS, THE SAME CUT (round nine).
   *
   * `MAX_EVIDENCE_EXCERPT_CHARS`'s docblock promised the success sample and the failure dump "cannot
   * drift into showing a person two different amounts of the same body", and under that sentence sat
   * TWO INDEPENDENT `8_000` LITERALS in two files with nothing tying them. Mutating either one alone
   * left the whole estate green - the caps case above only ever compares the stored body against the
   * STORE's own constant, so it can never see the executor's. A docblock claiming a consequence the
   * code cannot have is the thing this branch keeps finding, so the claim was made true
   * (`const MAX_BODY_DISPLAY_BYTES = MAX_EVIDENCE_EXCERPT_CHARS`) and then pinned here.
   *
   * PINNED BEHAVIOURALLY, THROUGH THE REAL EXECUTOR, IN BOTH DIRECTIONS - not by comparing the two
   * constants to each other, which would be a tautology over any pair of equal numbers. The same
   * oversized body goes through twice, once 2xx and once 5xx, and what each path SHOWS is compared:
   *
   *   - if the executor's cap were the SMALLER, `truncateForDisplay`'s marker would fit inside the
   *     evidence cap and ride into the stored sample, making it longer than the dump's body;
   *   - if the evidence cap were the SMALLER, the store would slice the sample shorter than the dump.
   *
   * MEASURED, INCLUDING THE MUTANT THAT PROVES THE TIE IS NOT AN EQUIVALENT ONE.
   * `MAX_EVIDENCE_EXCERPT_CHARS + 1_000` reddens and `111` reddens, so both directions of a drift
   * die. Re-splitting `MAX_BODY_DISPLAY_BYTES` back to a bare `8_000` stays GREEN - correctly, since
   * that is not a drift, it is the same number written twice. What shows the tie is load-bearing
   * rather than cosmetic is the pair: re-split to `8_000` AND move the store's constant to `111`,
   * which reddens. With the tie, the same single-literal change moves BOTH caps and this case stays
   * green - the VALUE is pinned separately, as a literal, in `action-evidence.test.ts`.
   */
  it('the failure dump and the success sample cut the same body at the same point', async () => {
    await seed([readAction]);
    // Deliberately NOT valid JSON, so neither path canonicalises it: both store the raw text and the
    // comparison is about the CUT rather than about `safeStringify`.
    const RAW = 'y'.repeat(MAX_EVIDENCE_EXCERPT_CHARS + 5_000);

    await run(fetchReturning(200, RAW));
    const shownOnSuccess = ((await evidenceOf())!.evidence as ApiCallEvidence).response.body!;

    const failed = await run(fetchReturning(500, RAW));
    expect(failed.success).toBe(false);
    const shownOnFailure = failed.details!.response!.body;

    // The one difference the two presentations are ALLOWED to have: `truncateForDisplay` appends its
    // own marker, and the evidence cap then slices that marker back off the stored sample.
    const marker = shownOnFailure.match(/\n… \[truncated, (\d+) more bytes\]$/);
    expect(marker).not.toBeNull();
    const bodyBytesOnFailure = shownOnFailure.slice(0, -marker![0].length);

    expect(bodyBytesOnFailure).toBe(shownOnSuccess);
    expect(Number(marker![1])).toBe(RAW.length - bodyBytesOnFailure.length);
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

/**
 * …AND THE SAME PROPERTY ON THE AUTOMATION RAIL (round eight), where it was pinned ZERO ways.
 *
 * THE THREE CASES ABOVE ARE ALL `api-call`. The automation rail reaches the identical write through
 * a different door, and its guard - `if (!automationResult.success) return null;` in the executor's
 * evidence closure - could be DELETED with the entire fourteen-file S1 estate staying green
 * (258/258, measured twice). It is load-bearing in production and only in production:
 * `runAutomationForAction` answers a failed ENGINE run with
 * `{success: false, code: 'automation_failed', data: {runId, status}}`, and that run id names a REAL
 * `automationRuns` document. Without the guard `runIdOf` resolves it, the collector returns the
 * FAILED trace, and `recordEvidence` PUTs it at the same deterministic `_id` - superseding the last
 * successful sample with `validatedAt: now` and pinning the failed run's screenshots out of the
 * 7-day sweep.
 *
 * WHY NOTHING NOTICED. The only other suite binding these seams for real
 * (`tests/automation/composition-root-action-seam.test.ts`) points its binding at `auto-never-runs`,
 * an automation that does not exist. That refusal is `unknown_automation`, it carries no `data`,
 * `runIdOf` answers `undefined`, and the mutant is a no-op there. So the case below insists on the
 * one thing that suite cannot have: a REAL automation, owned by the caller, whose ENGINE run fails.
 */
describe('the same property on the AUTOMATION rail: a failed run is not a validated run', () => {
  it('a SUCCESSFUL automation run records the trace, and pins its screenshots', async () => {
    // THE CONTROL, and the row every case below is about. Without it "the good sample survived"
    // would also be satisfied by a chain that never records anything at all.
    await seed([readAction, browserAction]);
    await seedAutomation();
    const engine = engineEnding('completed', [step(0, 'completed', 'step-0.png')]);

    const res = await runBrowserAction(engine);

    expect(res.success).toBe(true);
    const ev = await automationEvidenceOf();
    expect(ev).toMatchObject({
      kind: 'automation',
      runId: engine.minted[0],
      status: 'completed',
      steps: [{ stepIndex: 0, status: 'completed', screenshotUrl: `/automation-screenshots/${AUTOMATION_ID}/step-0.png` }],
    });
    expect(await actionEvidenceStore.pinnedRunIdsForRetention()).toEqual(new Set([engine.minted[0]]));
  }, 30_000);

  it('a FAILED automation run does NOT replace the evidence of the last successful one', async () => {
    await seed([readAction, browserAction]);
    await seedAutomation();
    const good = engineEnding('completed', [step(0, 'completed', 'step-0.png')]);
    expect((await runBrowserAction(good)).success).toBe(true);
    const before = await actionEvidenceStore.getEvidence({
      orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: browserAction.actionName,
    });
    expect(before).not.toBeNull();

    // The SAME action, the SAME automation, and this time the engine ends `failed` - a real run,
    // with a real run record and real failed steps behind a real run id.
    const bad = engineEnding('failed', [step(0, 'failed', 'step-0.png')]);
    const res = await runBrowserAction(bad);

    // The executor answers the failure honestly…
    expect(res.success).toBe(false);
    expect(res.code).toBe('automation_failed');
    // …and the run it names really is a different, resolvable run, so the mutant has something to
    // find. Without this the case would also pass if the failed leg had answered no run id at all,
    // which is the exact reason the existing seam suite could not see the defect.
    expect(bad.minted[0]).not.toBe(good.minted[0]);
    expect(await automationRunStore.findByRunId(bad.minted[0]!)).toMatchObject({ status: 'failed' });

    // THE ASSERTION THE CASE EXISTS FOR: the row is byte-for-byte the one the successful run wrote.
    // Deep equality rather than a field-by-field check, because "survives untouched" includes
    // `validatedAt` (a supersede re-stamps it to now) and `outcome`.
    const after = await actionEvidenceStore.getEvidence({
      orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: browserAction.actionName,
    });
    expect(after).toEqual(before);
    // …and the failed run's screenshots were never pinned out of the 7-day sweep. A supersede
    // releases the old pin and takes a new one in the same write, so this is the retention half of
    // the same defect and it is not recoverable by any gate downstream.
    expect(await actionEvidenceStore.pinnedRunIdsForRetention()).toEqual(new Set([good.minted[0]]));
  }, 30_000);

  it('a FAILED first run records nothing at all - there is no sample to fall back to', async () => {
    // The automation mirror of "a 4xx records nothing at all". With no previous row, the supersede
    // argument does not apply and what is at stake is whether a failure can BECOME the sample.
    await seed([readAction, browserAction]);
    await seedAutomation();
    const bad = engineEnding('failed', [step(0, 'failed', 'step-0.png')]);

    const res = await runBrowserAction(bad);

    expect(res.success).toBe(false);
    expect(await automationEvidenceOf()).toBeUndefined();
    expect(await actionEvidenceStore.pinnedRunIdsForRetention()).toEqual(new Set());
  }, 30_000);
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
