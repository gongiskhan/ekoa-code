import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { Store, type Doc } from '../../src/data/store.js';
import {
  schedules,
  scheduleRuns,
  integrationConfigs,
  integrationDefinitions,
  approvedIntegrationActions,
  integrationActionEvidence,
} from '../../src/data/stores.js';
import {
  ScheduleSupervisor,
  mapIntegrationOutcome,
  type ScheduleSupervisorDeps,
} from '../../src/schedules/supervisor.js';
import type { ScheduleDoc, ScheduleRunDoc } from '../../src/schedules/store.js';
import { createConfig } from '../../src/integrations/service.js';
import { resolveDefinition } from '../../src/integrations/definition-registry.js';
import { approveAction, describeAction } from '../../src/integrations/action-consent.js';
import { actionEvidenceStore } from '../../src/integrations/action-evidence-store.js';
import {
  executeUserIntegrationAction,
  type AutomationBackedHandler,
  type ExecuteIntegrationActionResult,
  type ExecutorDeps,
  type RunEvidenceCollector,
} from '../../src/integrations/action-executor.js';
import { legalTenantReadHandler } from '../../src/legal/citius-processos.js';
import { syncCitiusNotifications, type CitiusSyncDeps } from '../../src/legal/citius-sync.js';
import type { CitiusInboxEnumeration } from '../../src/legal/citius-mandatarios-http.js';
import type { CitiusNotificacaoMeta } from '../../src/legal/citius-mandatarios.js';
import type { EnsureSessionResult } from '../../src/automation/session-establishment.js';

/**
 * SLICE S9 - THE REFERENCE SCHEDULE, over the converged stack.
 *
 * ================================ WHAT MAKES THIS A REFERENCE ===================================
 *
 * `api/tests/schedules/supervisor.test.ts` proves the supervisor's own logic with FAKE executor
 * seams - the right posture for a suite about claiming, advancing, staleness and shutdown. It
 * therefore says nothing about what happens when the seam is bound to the real thing, and the
 * failure it cannot see is a WIRING failure: `mapIntegrationOutcome` handing `blocked` to a
 * supervisor that treats it as a failure, an evidence bundle that never reaches the schedule rail,
 * an action whose backing the schedule rail alone cannot run.
 *
 * This file binds `runIntegrationAction` EXACTLY AS `server.ts` BINDS IT:
 *
 *     runIntegrationAction: (s, t) => executeUserIntegrationAction({...}, executorDeps).then(mapIntegrationOutcome)
 *
 * and points it at the SHIPPED citius package with a real encrypted config row, the real consent
 * store, and the real `integration_action_evidence` collection. Four converged pieces meet on one
 * schedule-fired run:
 *
 *   the SUPERVISOR (the fire, the claim, the run row)
 *   x P4's BLOCKED OUTCOME (an unapproved write surfaces consent, and the owner is told)
 *   x S1's EVIDENCE COLLECTION (a validated run leaves the sample a promotion would read)
 *   x S9's TENANT-READ BACKING (the new `processos` action runs on this rail like any other)
 *
 * ================================ WHAT IS FAKED, COUNTED HONESTLY ===============================
 *
 * THREE doubles on the schedule-fire legs, not one - the first cut's header said "THE ONE FAKE" and
 * that was only ever true of `landNotifications`:
 *
 *   1. `runAutomationBackedAction` - the portal transport, and the one CI genuinely cannot have:
 *      `consultar_notificacoes` drives the authenticated mandatários portal, whose login is an
 *      Ordem dos Advogados certificate or Chave Móvel Digital, interactively, with two factors
 *      (CS5). Note it sits ABOVE recipe lookup, the automation engine and run persistence, so those
 *      are bypassed here rather than exercised.
 *   2. `collectRunEvidence` - the automation-tier collector. Its WRITER half is real (the binding
 *      is `server.ts`'s own, landing in the real collection); what is stood in for is the trace it
 *      reads, and since this round the fixture emits the shape the real collector really emits.
 *   3. `notifyBlocked` - recorded rather than pushed, so the owner notification is assertable.
 *
 * `executeUserIntegrationAction`, the gates, the consent store, the evidence store, the supervisor
 * and CS4's landing path are all production code. And the binding this file used to only DECLARE is
 * now driven for real one suite over: `api/tests/contract/citius-tenant-read-wiring.test.ts` boots
 * `buildApp` and fires an `integration_action` schedule through the supervisor `buildApp` built.
 *
 * ================================ WHAT ONLY AN ACCEPTANCE RUN CAN PROVE =========================
 *
 * That the automation itself drives the real portal - i.e. that `citius-notificacoes-template`'s
 * natural-language steps actually find the inbox, the pager and the prazo cells on the live site.
 * Nothing below claims that. What is proved here is that the SCHEDULE reaches the action, that the
 * gates answer correctly on the way, and that the outcome is recorded - which is exactly the part a
 * live run cannot be relied upon to check, because a live run that works tells you nothing about
 * what the gates would have done.
 */
const CITIUS = 'citius';
const ORG = 'orgRef';
const OWNER = 'adv-ref';
const NOTIFICACOES = 'consultar_notificacoes';
const SUBMETER = 'submeter_peca';
const PROCESSOS = 'processos';

let mem: MongoMemoryServer;
let seq = 0;
let clock = new Date('2026-08-17T09:00:00.000Z').getTime();
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const actor = (userId = OWNER, orgId = ORG): Actor => ({ userId, orgId, role: 'user' });

const citiusNotifications = new Store<Doc>('citius_notifications');

interface BlockedNotice { ownerUserId: string; scheduleId: string; runId: string; code?: string }

/** The automation seam, recording. Answers with a REAL-shaped run envelope so the evidence capture
 *  downstream has a `runId` to resolve, which is what a genuine engine run hands back. */
function portalSeam(): { fn: AutomationBackedHandler; calls: Array<{ actionName?: string; args: Record<string, unknown> }> } {
  const calls: Array<{ actionName?: string; args: Record<string, unknown> }> = [];
  const fn: AutomationBackedHandler = async ({ actionName, args }) => {
    calls.push({ actionName, args });
    return { success: true, data: { runId: 'arun-ref-1', status: 'completed', output: { notificacoes: [{ id: 'n1', processo: '1001/26.0T8LSB' }] } } };
  };
  return { fn, calls };
}

/**
 * S1's run-evidence collector, standing in for the automation-tier one.
 *
 * FIXTURE HONESTY (review round). The first cut returned steps in `StepRecord` shape - the
 * collector's INPUT - {stepId, index, tier, durationMs, screenshotPath}, behind an `as never` that
 * silenced the type error. The real collector's OUTPUT is `RunStepEvidence`: it maps `index` to
 * `stepIndex` and `screenshotPath` to a plane `screenshotUrl`, and drops the rest
 * (`automation/action-evidence.ts#stepEvidence`). So the row this leg stored in the REAL
 * `integration_action_evidence` collection held step bytes no production writer can produce, and no
 * assertion read them, so nothing could redden - the exact defect the sibling suite named and fixed
 * one file over. The cast is gone, which is what makes the shape checkable at all.
 */
const collectRunEvidence: RunEvidenceCollector = async (runId) => ({
  status: 'completed',
  steps: [
    { stepIndex: 0, status: 'succeeded', screenshotUrl: `/api/v1/automation-screenshots/citius/${runId}/step-0.png` },
  ],
});

/**
 * The executor deps the composition root builds, reproduced here member for member. The evidence
 * members are the REAL store binding; only the two automation-tier seams are stood in for.
 */
function executorDepsWith(seam: AutomationBackedHandler): ExecutorDeps {
  return {
    runAutomationBackedAction: seam,
    readTenantDataset: legalTenantReadHandler,
    recordActionEvidence: (key, evidence) => actionEvidenceStore.recordEvidence(key, evidence),
    collectRunEvidence,
  };
}

function supervisorDeps(executorDeps: ExecutorDeps): ScheduleSupervisorDeps & {
  blockedNotices: BlockedNotice[];
  answers: ExecuteIntegrationActionResult[];
} {
  const blockedNotices: BlockedNotice[] = [];
  // THE ANSWER, CAPTURED BEFORE THE MAPPER DISCARDS IT (review round). `mapIntegrationOutcome`
  // returns {status, code?, message?} and `ScheduleRunDoc` has no output field, so the executor's
  // `data` is gone by the time anything durable exists. That made the "answers from the rows the
  // sync landed" case below unable to fail on its data claim: it passed identically with zero rows
  // landed. Recording the result here is the smallest change that makes the claim observable AT
  // THIS SEAM without altering what the supervisor receives.
  const answers: ExecuteIntegrationActionResult[] = [];
  return {
    blockedNotices,
    answers,
    notifyBlocked: (n) => { blockedNotices.push(n); },
    runAutomation: async () => ({ status: 'ok' }),
    // THE SHAPE OF THE COMPOSITION ROOT'S BINDING, and no longer a claim to BE it. The first cut
    // called this "byte for byte" the production binding and rested the file's whole
    // proves-the-wiring premise on a copy; the review showed a semantic drift in `server.ts` ships
    // green against it. The production binding is now driven for real in
    // `api/tests/contract/citius-tenant-read-wiring.test.ts` (buildApp + the configured supervisor
    // + a fired integration_action target), and what THIS file proves is the behaviour of the rail
    // given that binding: the gates, the outcomes, the notification and the evidence row.
    runIntegrationAction: async (s, t) => {
      const result = await executeUserIntegrationAction(
        {
          orgId: s.orgId,
          ownerUserId: s.ownerUserId,
          integrationKey: t.integrationKey,
          actionName: t.actionName,
          args: t.args ?? {},
        },
        executorDeps,
      );
      answers.push(result);
      return mapIntegrationOutcome(result);
    },
    now: () => new Date(clock).toISOString(),
    genId: () => `gid_${seq++}`,
  };
}

async function seedSchedule(actionName: string, args: Record<string, unknown> = {}): Promise<ScheduleDoc> {
  const doc: ScheduleDoc = {
    _id: `sch_${seq++}`,
    orgId: ORG,
    ownerUserId: OWNER,
    name: `Citius - ${actionName}`,
    target: { kind: 'integration_action', integrationKey: CITIUS, actionName, args },
    spec: { kind: 'recurring', rule: { every: 'hour', interval: 1, timezone: 'Europe/Lisbon' } },
    enabled: true,
    nextRunAt: new Date(clock).toISOString(),
    consecutiveFailures: 0,
    createdAt: new Date(clock - 3_600_000).toISOString(),
    updatedAt: new Date(clock - 3_600_000).toISOString(),
  };
  await schedules.insert(doc as never);
  return doc;
}

async function runsOf(scheduleId: string): Promise<ScheduleRunDoc[]> {
  return (await scheduleRuns.find({ scheduleId })) as unknown as ScheduleRunDoc[];
}

function meta(n: number): CitiusNotificacaoMeta {
  return {
    ref: `ref-${n}`,
    processo: `${1000 + n}/26.0T8LSB`,
    data: `2026-06-${String(10 + n).padStart(2, '0')}`,
    tribunal: 'Comarca de Lisboa',
    ato: 'Citação',
    temDocumento: false,
  };
}

/** One real sync, landing through the real writer; only CS4's transport is faked. */
async function landNotifications(rows: CitiusNotificacaoMeta[]): Promise<void> {
  const walk: CitiusInboxEnumeration = {
    status: 'complete', rows, pagesWalked: 1, pages: [{ page: 1, outcome: 'ok', rows: rows.length }],
  };
  const syncDeps: CitiusSyncDeps = {
    establishSession: async (): Promise<EnsureSessionResult> => ({ status: 'reused', itemId: 'item-1', storageState: { cookies: [] } }),
    markSessionUnhealthy: async () => true,
    enumerate: async () => walk,
    clock: () => new Date('2026-07-01T00:00:00.000Z'),
    recordLesson: async () => [],
  };
  const out = await syncCitiusNotifications({ actor: actor(), runId: 'run-ref', baseUrl: 'https://portal.example' }, syncDeps);
  expect(out.status).toBe('ran');
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = ['test', 'encryption', 'key', '32', 'characters'].join('-');
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s9_reference_schedule');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  seq = 0;
  clock = new Date('2026-08-17T09:00:00.000Z').getTime();
  for (const s of [schedules, scheduleRuns, integrationConfigs, integrationDefinitions, approvedIntegrationActions, integrationActionEvidence]) {
    await s.deleteMany({});
  }
  await citiusNotifications.deleteMany({});
  await new Store<Doc>('sync_state').deleteMany({});
  await new Store<Doc>('sync_reports').deleteMany({});
  await createConfig(actor(), { integrationKey: CITIUS, configValues: { cedula_profissional: '12345' } }, deps);
});

// ---------------------------------------------------------------------------------------------
// 1. The schedule fires the action through the supervisor seam
// ---------------------------------------------------------------------------------------------

describe('the reference schedule fires a Citius notifications fetch', () => {
  it('reaches the real action through the real executor, and records an OK run', async () => {
    const seam = portalSeam();
    const d = supervisorDeps(executorDepsWith(seam.fn));
    const sup = new ScheduleSupervisor(d);
    const s = await seedSchedule(NOTIFICACOES, { desde: '2026-08-01' });

    await sup.tick();
    await sup.stop();

    // THE ACTION RAN, and it ran as the action the SHIPPED package declares: the automation seam was
    // reached carrying the action's identity and the schedule's own fixed args.
    expect(seam.calls).toHaveLength(1);
    expect(seam.calls[0]?.actionName).toBe(NOTIFICACOES);
    expect(seam.calls[0]?.args).toEqual({ desde: '2026-08-01' });

    const runs = await runsOf(s._id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('ok');
    expect(runs[0]!.trigger).toBe('auto');
    // A successful fire tells nobody: `notifyBlocked` is for a run waiting on its owner.
    expect(d.blockedNotices).toEqual([]);
  });

  // -------------------------------------------------------------------------------------------
  // 2. S1's EVIDENCE lands against the SCHEDULE-FIRED run
  // -------------------------------------------------------------------------------------------

  it('and the validated run leaves an evidence row - keyed to the org AND the owner', async () => {
    const seam = portalSeam();
    const sup = new ScheduleSupervisor(supervisorDeps(executorDepsWith(seam.fn)));
    const s = await seedSchedule(NOTIFICACOES);

    await sup.tick();
    await sup.stop();
    expect((await runsOf(s._id))[0]!.status).toBe('ok');

    const row = await actionEvidenceStore.getEvidence({ orgId: ORG, ownerUserId: OWNER, integrationKey: CITIUS, actionName: NOTIFICACOES });
    expect(row, 'a schedule-fired validated run records evidence like any other rail').toBeTruthy();
    expect(row!.outcome).toBe('succeeded');
    expect(row!.backingType).toBe('browser-steps');
    // The sample points at the run the seam reported, so a person reading it can find the trace.
    expect((row!.evidence as { runId?: string }).runId).toBe('arun-ref-1');
    // Rule 5: the row belongs to the mandatário whose credential the fire ran under, not to the org.
    expect(row!.ownerUserId).toBe(OWNER);
    // A PEER of the same org reaches nothing under this key.
    const peer = await actionEvidenceStore.getEvidence({ orgId: ORG, ownerUserId: 'adv-outro', integrationKey: CITIUS, actionName: NOTIFICACOES });
    expect(peer).toBeNull();
  });

  it('a FAILED fire records no evidence - a failure is not a validated run', async () => {
    const calls: string[] = [];
    const failing: AutomationBackedHandler = async ({ actionName }) => {
      calls.push(actionName ?? '');
      return { success: false, code: 'automation_failed', error: 'o portal não respondeu', data: { runId: 'arun-ref-2', status: 'failed' } };
    };
    const sup = new ScheduleSupervisor(supervisorDeps(executorDepsWith(failing)));
    const s = await seedSchedule(NOTIFICACOES);

    await sup.tick();
    await sup.stop();

    expect(calls).toHaveLength(1);
    const runs = await runsOf(s._id);
    // FAILED, not blocked: nothing is waiting on the owner, and the ceiling should drive.
    expect(runs[0]!.status).toBe('failed');
    expect(runs[0]!.detail?.code).toBe('automation_failed');
    // The row a person reads before granting `trusted` must not be superseded by a failure.
    const row = await actionEvidenceStore.getEvidence({ orgId: ORG, ownerUserId: OWNER, integrationKey: CITIUS, actionName: NOTIFICACOES });
    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 3. P4's BLOCKED outcome: an unapproved WRITE surfaces consent, it does not fail
// ---------------------------------------------------------------------------------------------

describe('a scheduled fire that hits the write gate surfaces consent', () => {
  it('records BLOCKED with awaiting_consent, tells the owner, and CONTACTS NOTHING', async () => {
    const seam = portalSeam();
    const d = supervisorDeps(executorDepsWith(seam.fn));
    const sup = new ScheduleSupervisor(d);
    // `submeter_peca` submits a peça processual: it MUTATES, at a court.
    const s = await seedSchedule(SUBMETER, { numeroProcesso: '1001/26.0T8LSB', tipoPeca: 'Requerimento', ficheiroBase64: 'AAAA' });

    await sup.tick();
    await sup.stop();

    const runs = await runsOf(s._id);
    expect(runs).toHaveLength(1);
    // THE DISTINCTION THIS CASE EXISTS FOR. `blocked` is "waiting on a person"; `failed` is "it went
    // wrong". Recording this as failed would drive the failure ceiling and eventually auto-pause a
    // schedule whose only problem is that nobody has said yes yet.
    expect(runs[0]!.status).toBe('blocked');
    expect(runs[0]!.detail?.code).toBe('awaiting_consent');
    // WHAT `blocked` ACTUALLY BUYS, corrected in the review round. The first cut asserted
    // `autoPausedAt === undefined` and `enabled === true` under the claim that "the schedule is NOT
    // driven toward the failure ceiling by a run that is merely waiting". BOTH HALVES WERE WRONG:
    // the assertions cannot fail (FAILURE_CEILING is 20, so after ONE fire they hold under any
    // counting), and the claim is false of production - `NEUTRAL_BLOCKED_CODES` holds only
    // `awaiting_daemon`, so an `awaiting_consent` block increments `consecutiveFailures` exactly as
    // a failure does, deliberately, as the unbounded-retry cap `supervisor.ts` defends at length.
    //
    // So the honest assertion is the counter itself. `blocked` differs from `failed` in the RUN
    // STATUS a person sees and in the OWNER NOTIFICATION below - not in ceiling treatment.
    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(after.consecutiveFailures).toBe(1);

    // THE OWNER IS TOLD. Without this a schedule sits waiting in silence; the code travels so the
    // client can derive its own words for it (engine prose is not a user-facing vocabulary).
    expect(d.blockedNotices).toHaveLength(1);
    expect(d.blockedNotices[0]).toMatchObject({ ownerUserId: OWNER, scheduleId: s._id, code: 'awaiting_consent' });

    // AND NOTHING WAS SUBMITTED. The gate is before the credential and before the seam, so an
    // unapproved write never reaches the portal at all.
    expect(seam.calls).toHaveLength(0);
    // No evidence either: nothing ran, so there is nothing to have been validated.
    expect(await actionEvidenceStore.getEvidence({ orgId: ORG, ownerUserId: OWNER, integrationKey: CITIUS, actionName: SUBMETER })).toBeNull();
  });

  it('and once the owner approves that exact shape, the SAME schedule goes through', async () => {
    const definition = await resolveDefinition(actor(), CITIUS);
    const action = (definition!.actions ?? []).find((a) => a.actionName === SUBMETER)!;
    // The human half, through the real approval store and the real shape the dialog shows.
    await approveAction({ orgId: ORG, userId: OWNER }, describeAction(CITIUS, action), 'always');

    const seam = portalSeam();
    const d = supervisorDeps(executorDepsWith(seam.fn));
    const sup = new ScheduleSupervisor(d);
    const s = await seedSchedule(SUBMETER, { numeroProcesso: '1001/26.0T8LSB', tipoPeca: 'Requerimento', ficheiroBase64: 'AAAA' });

    await sup.tick();
    await sup.stop();

    const runs = await runsOf(s._id);
    expect(runs[0]!.status).toBe('ok');
    expect(d.blockedNotices).toEqual([]);
    expect(seam.calls).toHaveLength(1);
    expect(seam.calls[0]?.actionName).toBe(SUBMETER);
    // The consent surfaced by the previous case was answerable, and answering it is what unblocked
    // the schedule - not a retry, and not anything the schedule rail did to itself.
  });
});

// ---------------------------------------------------------------------------------------------
// 4. S9's own action on the same rail
// ---------------------------------------------------------------------------------------------

describe('the new tenant-read action runs on the schedule rail like any other', () => {
  it('a scheduled `processos` fire answers from the rows the sync landed, contacting nothing', async () => {
    await landNotifications([meta(1), meta(2)]);
    const seam = portalSeam();
    const d = supervisorDeps(executorDepsWith(seam.fn));
    const sup = new ScheduleSupervisor(d);
    const s = await seedSchedule(PROCESSOS);

    await sup.tick();
    await sup.stop();

    const runs = await runsOf(s._id);
    expect(runs[0]!.status).toBe('ok');
    // THE DATA CLAIM, now observable. `status: 'ok'` alone cannot carry it: an EMPTY read is an
    // equally successful run, so before this round removing the `landNotifications` setup left every
    // assertion in this case passing and the title claiming something no assertion could see.
    expect(d.answers).toHaveLength(1);
    const answer = d.answers[0]!.data as { processos: Array<{ processo: string }>; origem: string };
    expect(answer.processos.map((r) => r.processo)).toEqual(['1002/26.0T8LSB', '1001/26.0T8LSB']);
    expect(answer.origem).toBe('citius-notificacoes-sincronizadas');
    // The tenant-read rail reaches neither the portal nor the automation engine.
    expect(seam.calls).toHaveLength(0);
    expect(d.blockedNotices).toEqual([]);
    // No evidence row, and that is the DELIBERATE answer rather than a gap: an evidence sample is a
    // record of what an action did against a THIRD PARTY, and this action contacted none. Storing
    // the rows it returned would copy the tenant's own data into a second collection to prove it had
    // been read out of the first.
    expect(await actionEvidenceStore.getEvidence({ orgId: ORG, ownerUserId: OWNER, integrationKey: CITIUS, actionName: PROCESSOS })).toBeNull();
  });

  it('and is refused honestly on a deployment that binds no readers - never a silent empty run', async () => {
    await landNotifications([meta(1)]);
    const seam = portalSeam();
    // The composition root's binding removed: everything else identical.
    const unbound: ExecutorDeps = { ...executorDepsWith(seam.fn) };
    delete unbound.readTenantDataset;
    const d = supervisorDeps(unbound);
    const sup = new ScheduleSupervisor(d);
    const s = await seedSchedule(PROCESSOS);

    await sup.tick();
    await sup.stop();

    const runs = await runsOf(s._id);
    // FAILED and coded, so the schedules surface shows a broken deployment rather than a schedule
    // that quietly succeeds every hour having read nothing.
    expect(runs[0]!.status).toBe('failed');
    expect(runs[0]!.detail?.code).toBe('unsupported_backing_type');
  });
});
