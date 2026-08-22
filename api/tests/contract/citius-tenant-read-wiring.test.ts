import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  users,
  activityLogs,
  integrationConfigs,
  integrationDefinitions,
  approvedIntegrationActions,
  schedules,
  scheduleRuns,
} from '../../src/data/stores.js';
import { Store, type Doc } from '../../src/data/store.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { getScheduleSupervisor } from '../../src/schedules/supervisor.js';
import type { ScheduleDoc, ScheduleRunDoc } from '../../src/schedules/store.js';
import { syncCitiusNotifications, type CitiusSyncDeps } from '../../src/legal/citius-sync.js';
import type { CitiusInboxEnumeration } from '../../src/legal/citius-mandatarios-http.js';
import type { CitiusNotificacaoMeta } from '../../src/legal/citius-mandatarios.js';
import type { EnsureSessionResult } from '../../src/automation/session-establishment.js';
import { CITIUS_PROCESSOS_DATASET, CITIUS_PROCESSOS_ORIGEM } from '../../src/legal/citius-processos.js';
import { ExecuteIntegrationActionResponse, IntegrationCapability } from '@ekoa/shared';

/**
 * SLICE S9, REVIEW ROUND - THE TWO COMPOSITION-ROOT BINDINGS, PINNED WHERE THEY LIVE.
 *
 * ================================ WHY THIS FILE EXISTS ==========================================
 *
 * The first round of S9 shipped two suites that each RE-DECLARED a production binding instead of
 * driving it, under comments claiming they were "byte for byte" what `server.ts` does. A copy of a
 * binding proves nothing about the binding: the review demonstrated both, by mutation, with the
 * whole lane green.
 *
 *   1. `server.ts` binds the supervisor's `runIntegrationAction` with `.then(mapIntegrationOutcome)`.
 *      Replace that with an inline mapping that records every non-success as `failed` and NOTHING
 *      reddens - while in production a consent-blocked schedule stops being reported as blocked, so
 *      `notifyBlocked` never fires (it gates on `status === 'blocked'`) and the owner is never told
 *      their schedule is waiting on them. That is P4.1's entire point, silently gone.
 *   2. `server.ts` binds `readTenantDataset` TWICE - into `executorDeps` (automation, listener,
 *      schedule rails) and separately into `integrationsRouter` (the capability and `achieve` rails,
 *      i.e. the surface an outside consumer with a user-scoped key actually uses, Rule 4's surface).
 *      Only the first was pinned. Delete the second and the shipped `citius processos` action
 *      answers `unsupported_backing_type` for every interactive and API-key caller while schedules
 *      and automations keep working - one rail quietly dead, which is exactly the class
 *      `composition-root-action-seam.test.ts`'s own docblock lectures about.
 *
 * Both are pinned here the way that suite pins its one: BOOT THE REAL `buildApp` and assert an
 * OBSERVABLE CONSEQUENCE, never "a function is installed".
 *
 * ================================ AND THE WIRE SHAPE ============================================
 *
 * The first round added no contract test, so the tenant-read action's public capability row was
 * produced by production code and validated by nothing - which is how it came to report
 * `transport: 'http'` for an action whose own doctrine is that it has no wire, and
 * `target: 'destino indeterminado'`, the string reserved for a package whose backing cannot be
 * resolved at all. Both are asserted below against the shared schemas, on the real wire.
 *
 * ================================ WHAT IS FAKED =================================================
 *
 * ONE thing: CS4's `enumerate`, the Citius portal transport, while LANDING the rows this action
 * later reads - because a real Citius session cannot exist in CI. Nothing on the read path, the
 * HTTP path, or the schedule path is stubbed: the routers, the admission, the capability core, the
 * gated executor, the tenant-read dispatch, the real reader, the real supervisor and the real
 * bindings are all production code.
 */
const CITIUS = 'citius';
const ORG = 'orgWiring';
const OWNER = 'adv-wiring';
const PROCESSOS = 'processos';
const SUBMETER = 'submeter_peca';

let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const citiusNotifications = new Store<Doc>('citius_notifications');

const call = (p: string, auth: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(init.headers ?? {}) },
  });

const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

async function mkUser(id: string, orgId: string): Promise<void> {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'user', orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
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

/** One real sync, landing through the real writer. Only CS4's transport is faked. */
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
  const out = await syncCitiusNotifications(
    { actor: { userId: OWNER, orgId: ORG, role: 'user' }, runId: 'run-wiring', baseUrl: 'https://portal.example' },
    syncDeps,
  );
  expect(out.status).toBe('ran');
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => Promise<boolean>, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await pred())) {
    if (Date.now() > deadline) throw new Error(`waitFor timed out: ${what}`);
    await sleep(10);
  }
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s9_wiring');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeMongo();
  await mem.stop();
  __resetActivationForTests();
});

beforeEach(async () => {
  seq = 0;
  for (const s of [users, activityLogs, integrationConfigs, integrationDefinitions, approvedIntegrationActions, schedules, scheduleRuns]) {
    await s.deleteMany({});
  }
  await citiusNotifications.deleteMany({});
  await new Store<Doc>('sync_state').deleteMany({});
  await new Store<Doc>('sync_reports').deleteMany({});
  await mkUser(OWNER, ORG);
});

// ---------------------------------------------------------------------------------------------
// 1. The capability + achieve rail's binding (server.ts integrationsRouter readTenantDataset)
// ---------------------------------------------------------------------------------------------

describe('the tenant-read action answers on the REAL capability rail', () => {
  it('executes through the HTTP route and returns the reader\'s own answer', async () => {
    const token = await tokenFor(OWNER);
    await call('/api/v1/integrations/configs', token, {
      method: 'POST',
      body: JSON.stringify({ integrationKey: CITIUS, configValues: { cedula_profissional: '12345' } }),
    });
    await landNotifications([meta(1), meta(2)]);

    const res = await call(`/api/v1/integrations/${CITIUS}/actions/${PROCESSOS}/execute`, token, {
      method: 'POST',
      body: JSON.stringify({ args: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // THE WIRE SHAPE, against the shared schema rather than against a reading of it.
    expect(ExecuteIntegrationActionResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);

    // THE MUTANT THIS KILLS: delete `readTenantDataset` from the integrationsRouter mount in
    // server.ts and this answers success:false / unsupported_backing_type instead - the shipped
    // action dead on the primary consumer rail while schedules and automations keep working.
    expect(body.success, JSON.stringify(body)).toBe(true);
    const data = body.data as { processos: Array<{ processo: string }>; origem: string };
    // `origem` is a constant only the REAL handler produces, so a reader bound to something else
    // does not satisfy this either.
    expect(data.origem).toBe(CITIUS_PROCESSOS_ORIGEM);
    expect(data.processos.map((r) => r.processo)).toEqual(['1002/26.0T8LSB', '1001/26.0T8LSB']);
  });

  it('the capability row tells the truth about a no-wire action', async () => {
    const token = await tokenFor(OWNER);
    await call('/api/v1/integrations/configs', token, {
      method: 'POST',
      body: JSON.stringify({ integrationKey: CITIUS, configValues: { cedula_profissional: '12345' } }),
    });

    const res = await call(`/api/v1/integrations/${CITIUS}`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(IntegrationCapability.safeParse(body).success, JSON.stringify(body)).toBe(true);

    const row = (body.actions as Array<Record<string, unknown>>).find((a) => a.actionName === PROCESSOS);
    expect(row, 'the shipped processos action is on the capability surface').toBeTruthy();
    expect(row!.backingType).toBe('tenant-read');
    // NOT 'http'. The wire contract documents `transport` as "the wire protocol the action needs",
    // and D-S9-3 argues that naming one for a tenant read is a lie of the same class as the
    // http://127.0.0.1:0 placeholder. Before this round the public surface stated that lie.
    expect(row!.transport).toBe('none');
    // NOT 'destino indeterminado' - the string reserved for a backing that cannot be RESOLVED. This
    // action resolves cleanly; its destination is the dataset, and there is nowhere else it goes.
    expect(row!.target).toContain(CITIUS_PROCESSOS_DATASET);
    expect(row!.target).not.toContain('indeterminado');
    expect(row!.requiresApproval).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. The schedule rail's outcome binding (server.ts .then(mapIntegrationOutcome))
// ---------------------------------------------------------------------------------------------

describe('the SUPERVISOR buildApp configured maps a consent block to BLOCKED', () => {
  it('a fired integration_action schedule that hits the write gate records blocked, not failed', async () => {
    const token = await tokenFor(OWNER);
    await call('/api/v1/integrations/configs', token, {
      method: 'POST',
      body: JSON.stringify({ integrationKey: CITIUS, configValues: { cedula_profissional: '12345' } }),
    });

    // THE SUPERVISOR IS THE ONE buildApp BUILT. Nothing here constructs a ScheduleSupervisor or
    // re-declares its deps - which is the whole difference between this case and the first round's.
    const sup = getScheduleSupervisor();
    expect(sup, 'buildApp configures the schedule supervisor').toBeTruthy();

    // `nextRunAt` is far in the future so no background tick can claim this occurrence; the fire is
    // out of band, through the run-now path.
    const schedule: ScheduleDoc = {
      _id: 'sch-wiring-1',
      orgId: ORG,
      ownerUserId: OWNER,
      name: 'Citius - submeter',
      target: { kind: 'integration_action', integrationKey: CITIUS, actionName: SUBMETER, args: { numeroProcesso: '1001/26.0T8LSB', tipoPeca: 'Requerimento', ficheiroBase64: 'AAAA' } },
      spec: { kind: 'recurring', rule: { every: 'hour', interval: 1, timezone: 'Europe/Lisbon' } },
      enabled: true,
      nextRunAt: '2099-01-01T00:00:00.000Z',
      consecutiveFailures: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    await schedules.insert(schedule as never);

    const run = await sup!.fireNow(schedule);
    await waitFor(async () => {
      const doc = (await scheduleRuns.get(run._id)) as unknown as ScheduleRunDoc | null;
      return !!doc?.finishedAt;
    }, 'the fired run to finalize');

    const finished = (await scheduleRuns.get(run._id)) as unknown as ScheduleRunDoc;
    // THE MUTANT THIS KILLS: replace `.then(mapIntegrationOutcome)` at the supervisor binding in
    // server.ts with an inline mapping that answers `failed` for every non-success, and this reads
    // 'failed'. In production that silently disables the owner notification (`notifyBlocked` gates
    // on `status === 'blocked'`) and records a schedule that is merely WAITING as one that is
    // FAILING - the P4.1 property the reference suite claimed to prove and only re-declared.
    expect(finished.status).toBe('blocked');
    expect(finished.detail?.code).toBe('awaiting_consent');
  }, 30_000);

  it('…and a READ target on the same rail records ok, so `blocked` discriminates', async () => {
    // The control. Without it the case above is satisfied by a binding that answers `blocked` for
    // everything.
    const token = await tokenFor(OWNER);
    await call('/api/v1/integrations/configs', token, {
      method: 'POST',
      body: JSON.stringify({ integrationKey: CITIUS, configValues: { cedula_profissional: '12345' } }),
    });
    await landNotifications([meta(1)]);

    const sup = getScheduleSupervisor()!;
    const schedule: ScheduleDoc = {
      _id: 'sch-wiring-2',
      orgId: ORG,
      ownerUserId: OWNER,
      name: 'Citius - processos',
      target: { kind: 'integration_action', integrationKey: CITIUS, actionName: PROCESSOS, args: {} },
      spec: { kind: 'recurring', rule: { every: 'hour', interval: 1, timezone: 'Europe/Lisbon' } },
      enabled: true,
      nextRunAt: '2099-01-01T00:00:00.000Z',
      consecutiveFailures: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    await schedules.insert(schedule as never);

    const run = await sup.fireNow(schedule);
    await waitFor(async () => {
      const doc = (await scheduleRuns.get(run._id)) as unknown as ScheduleRunDoc | null;
      return !!doc?.finishedAt;
    }, 'the fired read to finalize');

    const finished = (await scheduleRuns.get(run._id)) as unknown as ScheduleRunDoc;
    expect(finished.status).toBe('ok');
    // This ALSO covers the executorDeps-site tenant-read binding on the schedule rail: without it
    // the read would answer `unsupported_backing_type` and this row would read 'failed'.
    expect(finished.detail?.code).toBeUndefined();
  }, 30_000);
});
