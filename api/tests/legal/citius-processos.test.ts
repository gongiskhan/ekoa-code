import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { Store, type Doc } from '../../src/data/store.js';
import {
  syncCitiusNotifications,
  type CitiusSyncDeps,
  type CitiusLandedNotification,
} from '../../src/legal/citius-sync.js';
import type { CitiusInboxEnumeration, EnumerateInboxInput } from '../../src/legal/citius-mandatarios-http.js';
import type { CitiusNotificacaoMeta } from '../../src/legal/citius-mandatarios.js';
import type { EnsureSessionResult } from '../../src/automation/session-establishment.js';
import {
  CITIUS_INTEGRATION_PACKAGE,
  CITIUS_PROCESSOS_DATASET,
  CITIUS_PROCESSOS_ORIGEM,
  groupNotificationsByProcess,
  legalTenantReadHandler,
  readCitiusProcessos,
} from '../../src/legal/citius-processos.js';

/**
 * SLICE S9 - "OS PROCESSOS", the honest read.
 *
 * The action S9 ships answers "which processes does this mandatário have running" out of the
 * notification metadata the Citius sync rail has ALREADY LANDED, and out of nothing else. This
 * suite holds the three things that could go wrong with that, in descending order of severity:
 *
 *  1. TENANCY (Capability Contract rule 5). The landed rows are keyed PER MANDATÁRIO, not per org -
 *     hazard 4 of the sync rail's own docblock, because two lawyers in one firm have two different
 *     inboxes. A read that filtered on `orgId` alone would hand one lawyer the other's caseload with
 *     nothing failing anywhere. Section 2 drives two real syncs for two real users in ONE org and
 *     asserts each sees only their own, and it lands the rows through the REAL writer so the
 *     scoping under test is the scoping production writes.
 *  2. THE PROJECTION. Grouping, counting and ordering are pure and are tested as such (section 1),
 *     including the ordering being TOTAL - an unstable one makes `COMPOSE_MAX_ITEMS` truncation
 *     non-reproducible, so the same question would return a different 200 rows each run.
 *  3. METADATA ONLY, still. The sync's operator-locked invariant is that it never opens a document.
 *     This read is downstream of it and section 4 pins that it neither emits nor names a document
 *     reference, so nothing it returns gives a caller a handle to follow.
 *
 * WHAT THIS SUITE DOES NOT PROVE, said plainly: that the rows the sync lands are a COMPLETE picture
 * of the portal. They are not, and the action's own description says so - the coverage is
 * "processes with notifications", and a process dormant in the swept window does not appear. Only a
 * run against a real Citius account can measure the gap between the two.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(__dirname, '..', '..', 'assets', 'integrations', 'citius', 'config.json');
const MODULE_SRC = readFileSync(
  fileURLToPath(new URL('../../src/legal/citius-processos.ts', import.meta.url)),
  'utf-8',
);
/** Source with comments stripped: the docblock legitimately DISCUSSES `documentoRef`. */
const MODULE_CODE = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

let mem: MongoMemoryServer;
const citiusNotifications = new Store<Doc>('citius_notifications');

const actor = (userId: string, orgId = 'orgA') => ({ userId, orgId, role: 'user' as const });

/**
 * A landed row as `listCitiusNotificationRows` hands it over.
 *
 * `notificacao` is OMITTED from the `Partial` before being re-declared as a partial of its own:
 * `Partial<CitiusLandedNotification>` already types that field as the WHOLE `CitiusNotificacaoMeta`,
 * so intersecting a second, looser declaration onto it produces an intersection that demands both -
 * i.e. every override site would have to spell out `ref`, `data` and `temDocumento`. Vitest does not
 * typecheck, so this only surfaced under `tsconfig.test.json`.
 */
type LandedOverride =
  Omit<Partial<CitiusLandedNotification>, 'notificacao'> & { notificacao?: Partial<CitiusNotificacaoMeta> };

function landed(over: LandedOverride = {}): CitiusLandedNotification {
  const { notificacao, ...rest } = over;
  return {
    ref: 'r1',
    itemDate: '2026-06-01T00:00:00.000Z',
    landedAt: '2026-06-02T00:00:00.000Z',
    ...rest,
    notificacao: {
      ref: 'r1',
      processo: '1000/26.0T8LSB',
      data: '01-06-2026',
      tribunal: 'Comarca de Lisboa',
      ato: 'Citação',
      temDocumento: false,
      ...notificacao,
    },
  };
}

/** One portal row, as the CS1 parser produces it. */
function meta(n: number, over: Partial<CitiusNotificacaoMeta> = {}): CitiusNotificacaoMeta {
  return {
    ref: `ref-${n}`,
    processo: `${1000 + n}/26.0T8LSB`,
    data: `2026-06-${String(10 + n).padStart(2, '0')}`,
    tribunal: 'Comarca de Lisboa',
    ato: 'Citação',
    temDocumento: false,
    ...over,
  };
}

/**
 * Run ONE real sync for one actor, landing through the REAL writer into the REAL collection.
 *
 * ONLY THE PORTAL TRANSPORT IS FAKED, at CS4's `enumerate` seam - the one place a real Citius
 * session would be required and therefore the one place CI cannot go. Everything below it is
 * production code: `runVerifiedSync`'s two-pass verification, the deterministic-id insert, the
 * `(orgId, integrationKey, actionKey)` scoping with the actor folded into the action key. So the
 * rows this suite reads back are not a fixture that resembles what the sync produces - they ARE
 * what the sync produces.
 */
async function landFor(userId: string, rows: CitiusNotificacaoMeta[], orgId = 'orgA'): Promise<void> {
  const walk: CitiusInboxEnumeration = {
    status: 'complete',
    rows,
    pagesWalked: 1,
    pages: [{ page: 1, outcome: 'ok', rows: rows.length }],
  };
  const deps: CitiusSyncDeps = {
    establishSession: async (): Promise<EnsureSessionResult> => ({ status: 'reused', itemId: `item-${userId}`, storageState: { cookies: [] } }),
    markSessionUnhealthy: async () => true,
    enumerate: async (_input: EnumerateInboxInput) => walk,
    clock: () => new Date('2026-07-01T00:00:00.000Z'),
    // The lessons seam, injected to a sink: what a run learned is CS8's subject, not this one's.
    recordLesson: async () => [],
  };
  const out = await syncCitiusNotifications(
    { actor: actor(userId, orgId), runId: `run-${userId}`, baseUrl: 'https://portal.example' },
    deps,
  );
  expect(out.status, `sync for ${userId}`).toBe('ran');
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = ['test', 'encryption', 'key', '32', 'characters'].join('-');
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_citius_processos');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await citiusNotifications.deleteMany({});
  await new Store<Doc>('sync_state').deleteMany({});
  await new Store<Doc>('sync_reports').deleteMany({});
});

// ---------------------------------------------------------------------------------------------
// 1. The projection
// ---------------------------------------------------------------------------------------------

describe('groupNotificationsByProcess', () => {
  it('collapses many notifications into one row per process, counting both totals', () => {
    const out = groupNotificationsByProcess([
      landed({ ref: 'a', itemDate: '2026-06-01T00:00:00.000Z', notificacao: { processo: 'P1', temDocumento: true } }),
      landed({ ref: 'b', itemDate: '2026-06-05T00:00:00.000Z', notificacao: { processo: 'P1', temDocumento: false } }),
      landed({ ref: 'c', itemDate: '2026-06-03T00:00:00.000Z', notificacao: { processo: 'P2', temDocumento: true } }),
    ]);
    expect(out).toHaveLength(2);
    const p1 = out.find((r) => r.processo === 'P1');
    expect(p1).toMatchObject({ notificacoes: 2, comDocumento: 1 });
    expect(p1?.ultimaNotificacao).toBe('2026-06-05T00:00:00.000Z');
    expect(p1?.primeiraNotificacao).toBe('2026-06-01T00:00:00.000Z');
  });

  it('the header fields track the NEWEST notification, not the first one seen', () => {
    // A case can move between juízos. `ultimoAto` says "último" and would be a lie if the row kept
    // whichever notification the store happened to return first.
    const [row] = groupNotificationsByProcess([
      landed({ ref: 'old', itemDate: '2026-01-01T00:00:00.000Z', notificacao: { processo: 'P', tribunal: 'Comarca do Porto', ato: 'Citação' } }),
      landed({ ref: 'new', itemDate: '2026-09-01T00:00:00.000Z', notificacao: { processo: 'P', tribunal: 'Comarca de Lisboa', ato: 'Sentença' } }),
    ]);
    expect(row).toMatchObject({ tribunal: 'Comarca de Lisboa', ultimoAto: 'Sentença' });
  });

  it('orders by most recent activity, and TOTALLY - ties break on the process number', () => {
    const same = '2026-06-01T00:00:00.000Z';
    const out = groupNotificationsByProcess([
      landed({ ref: '1', itemDate: same, notificacao: { processo: 'B' } }),
      landed({ ref: '2', itemDate: '2026-08-01T00:00:00.000Z', notificacao: { processo: 'Z' } }),
      landed({ ref: '3', itemDate: same, notificacao: { processo: 'A' } }),
    ]);
    expect(out.map((r) => r.processo)).toEqual(['Z', 'A', 'B']);
    // Total, so the same input in any order produces the same output - which is what makes a
    // truncated compose answer reproducible.
    const reversed = groupNotificationsByProcess([
      landed({ ref: '3', itemDate: same, notificacao: { processo: 'A' } }),
      landed({ ref: '2', itemDate: '2026-08-01T00:00:00.000Z', notificacao: { processo: 'Z' } }),
      landed({ ref: '1', itemDate: same, notificacao: { processo: 'B' } }),
    ]);
    expect(reversed.map((r) => r.processo)).toEqual(['Z', 'A', 'B']);
  });

  it('drops a row with no process number rather than inventing one fake process for all of them', () => {
    const out = groupNotificationsByProcess([
      landed({ ref: '1', notificacao: { processo: '   ' } }),
      landed({ ref: '2', notificacao: { processo: '' } }),
      landed({ ref: '3', notificacao: { processo: 'P' } }),
    ]);
    expect(out.map((r) => r.processo)).toEqual(['P']);
  });

  it('falls back to the portal cell when the normalised date is empty, and never drops the row', () => {
    // `citiusItemDate` passes an unrecognised shape through verbatim (SPIKE A). An unparsed date
    // cannot be placed on a timeline; it must still be counted.
    const out = groupNotificationsByProcess([
      landed({ ref: '1', itemDate: '', notificacao: { processo: 'P', data: 'terça-feira' } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ processo: 'P', ultimaNotificacao: 'terça-feira', notificacoes: 1 });
  });

  it('answers an empty list for no rows - never a refusal', () => {
    expect(groupNotificationsByProcess([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. TENANCY (Capability Contract rule 5) - ONE ORG IS NOT ONE INBOX
// ---------------------------------------------------------------------------------------------

describe('the read is scoped per MANDATÁRIO, not per org', () => {
  it('two lawyers in ONE org see only their own processes', async () => {
    await landFor('adv1', [meta(1), meta(2)]);
    await landFor('adv2', [meta(7)]);

    const one = await readCitiusProcessos(actor('adv1'));
    const two = await readCitiusProcessos(actor('adv2'));

    expect(one.processos.map((r) => r.processo).sort()).toEqual(['1001/26.0T8LSB', '1002/26.0T8LSB']);
    expect(two.processos.map((r) => r.processo)).toEqual(['1007/26.0T8LSB']);
    // The assertion that matters is the ABSENCE: hazard 4 is silent, so "adv2 got a list" proves
    // nothing on its own - what proves it is that adv1's cases are not in it.
    expect(two.processos.map((r) => r.processo)).not.toContain('1001/26.0T8LSB');
    expect(one.processos.map((r) => r.processo)).not.toContain('1007/26.0T8LSB');
  });

  it('and two orgs never see each other at all', async () => {
    await landFor('adv1', [meta(1)], 'orgA');
    await landFor('adv1', [meta(9)], 'orgB');
    const a = await readCitiusProcessos(actor('adv1', 'orgA'));
    const b = await readCitiusProcessos(actor('adv1', 'orgB'));
    expect(a.processos.map((r) => r.processo)).toEqual(['1001/26.0T8LSB']);
    expect(b.processos.map((r) => r.processo)).toEqual(['1009/26.0T8LSB']);
  });

  it('a lawyer whose sync has never run reads an empty list, not somebody else\'s', async () => {
    await landFor('adv1', [meta(1)]);
    const out = await readCitiusProcessos(actor('adv-novo'));
    expect(out.processos).toEqual([]);
    expect(out.origem).toBe(CITIUS_PROCESSOS_ORIGEM);
  });

  it('FAILS CLOSED on a half-built scope rather than widening to everybody', async () => {
    await landFor('adv1', [meta(1)]);
    await expect(readCitiusProcessos(actor('', 'orgA'))).rejects.toThrow(/userId/);
    await expect(readCitiusProcessos(actor('adv1', ''))).rejects.toThrow(/orgId/);
  });

  it('reads what the REAL writer wrote, including the fields the projection depends on', async () => {
    await landFor('adv1', [meta(1, { temDocumento: true, ato: 'Sentença' })]);
    const out = await readCitiusProcessos(actor('adv1'));
    expect(out.processos).toEqual([
      {
        processo: '1001/26.0T8LSB',
        tribunal: 'Comarca de Lisboa',
        ultimoAto: 'Sentença',
        ultimaNotificacao: '2026-06-11T00:00:00.000Z',
        primeiraNotificacao: '2026-06-11T00:00:00.000Z',
        notificacoes: 1,
        comDocumento: 1,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2b. HOW FRESH THE ANSWER IS (review round)
// ---------------------------------------------------------------------------------------------

describe('the payload says how fresh it is', () => {
  it('distinguishes NEVER-SYNCED from SYNCED-AND-EMPTY - the two that used to look identical', async () => {
    // Never synced: no run stamp, no watermark, nothing held.
    const never = await readCitiusProcessos(actor('adv-novo'));
    expect(never.processos).toEqual([]);
    expect(never.sincronizacao.ultimaCorridaEm).toBeUndefined();
    expect(never.sincronizacao.marcaDagua).toBeNull();
    expect(never.sincronizacao.notificacoesGuardadas).toBe(0);

    // Synced, and the inbox really was empty. SAME empty list, DIFFERENT freshness.
    await landFor('adv-vazio', []);
    const empty = await readCitiusProcessos(actor('adv-vazio'));
    expect(empty.processos).toEqual([]);
    expect(empty.sincronizacao.ultimaCorridaEm, 'a run happened').toBeTruthy();
    expect(empty.sincronizacao.ultimoResultado).toBe('complete');
    // THE ASSERTION THAT MATTERS: the two answers are no longer the same document. Before this
    // round both were `{processos: [], origem}` and a lawyer could not tell a dead sync from a
    // genuinely quiet inbox.
    expect(empty.sincronizacao).not.toEqual(never.sincronizacao);
  });

  it('reports the run that landed the rows, under the same per-mandatário scope', async () => {
    await landFor('adv1', [meta(1), meta(2)]);
    await landFor('adv2', [meta(7)]);
    const one = await readCitiusProcessos(actor('adv1'));
    expect(one.sincronizacao.notificacoesGuardadas).toBe(2);
    expect(one.sincronizacao.ultimoResultado).toBe('complete');
    // Freshness is scoped exactly like the rows: adv2's run is not adv1's.
    const two = await readCitiusProcessos(actor('adv2'));
    expect(two.sincronizacao.notificacoesGuardadas).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. The seam, and the package that names it
// ---------------------------------------------------------------------------------------------

describe('legalTenantReadHandler', () => {
  it('answers the dataset it binds, with the scope the executor handed down', async () => {
    await landFor('adv1', [meta(1)]);
    const res = await legalTenantReadHandler({
      dataset: CITIUS_PROCESSOS_DATASET,
      args: {},
      orgId: 'orgA',
      ownerUserId: 'adv1',
      integrationKey: 'citius',
      actionName: 'processos',
    });
    expect(res.success).toBe(true);
    expect((res.data as { processos: unknown[] }).processos).toHaveLength(1);
  });

  it('REFUSES an unrecognised dataset rather than answering the nearest one', async () => {
    await landFor('adv1', [meta(1)]);
    const res = await legalTenantReadHandler({
      dataset: 'citius.processo',
      args: {},
      orgId: 'orgA',
      ownerUserId: 'adv1',
      integrationKey: 'citius',
      actionName: 'processos',
    });
    expect(res.success).toBe(false);
    expect(res.code).toBe('unknown_dataset');
    expect(res.data).toBeUndefined();
  });

  /**
   * THE DATASET IS BOUND TO ITS DECLARING INTEGRATION (review round).
   *
   * Without this the dataset name is a closed set of READERS and an open set of DECLARERS: any
   * definition in the tenant - a package another org published and this one installed included -
   * could declare `tenantRead: { dataset: 'citius.processos' }` under a name and description of the
   * publisher's choosing. No cross-tenant leak was ever possible (the reader scopes by the actor the
   * executor hands down), which is precisely why the finding is about the DESCRIPTION: an alias
   * detaches the read from the COBERTURA wording a caller decides its meaning from.
   */
  it('REFUSES the dataset for any integration but the one that declares it', async () => {
    await landFor('adv1', [meta(1)]);
    for (const key of ['portal', 'caixa-citius', 'citius-legacy', '']) {
      const res = await legalTenantReadHandler({
        dataset: CITIUS_PROCESSOS_DATASET,
        args: {},
        orgId: 'orgA',
        ownerUserId: 'adv1',
        integrationKey: key,
        actionName: 'processos',
      });
      expect(res.success, key).toBe(false);
      expect(res.code, key).toBe('unknown_dataset');
      // No rows travel with the refusal - the alias learns nothing about the caseload either.
      expect(res.data, key).toBeUndefined();
    }
  });

  it('…and the declaring integration itself still reads', async () => {
    // The control: without it the case above is satisfied by refusing everybody.
    await landFor('adv1', [meta(1)]);
    const res = await legalTenantReadHandler({
      dataset: CITIUS_PROCESSOS_DATASET,
      args: {},
      orgId: 'orgA',
      ownerUserId: 'adv1',
      integrationKey: CITIUS_INTEGRATION_PACKAGE,
      actionName: 'processos',
    });
    expect(res.success).toBe(true);
  });

  it('turns a refused scope into a coded failure, never a throw out of the executor', async () => {
    const res = await legalTenantReadHandler({
      dataset: CITIUS_PROCESSOS_DATASET,
      args: {},
      orgId: '',
      ownerUserId: 'adv1',
      integrationKey: 'citius',
      actionName: 'processos',
    });
    expect(res.success).toBe(false);
    expect(res.code).toBe('tenant_read_failed');
  });

  it('never lets `args` become a scope', async () => {
    await landFor('adv1', [meta(1)]);
    await landFor('adv2', [meta(7)]);
    // Every shape a caller might hope names somebody else. `args` reaches the handler and is inert.
    const res = await legalTenantReadHandler({
      dataset: CITIUS_PROCESSOS_DATASET,
      args: { orgId: 'orgB', ownerUserId: 'adv2', userId: 'adv2', actor: { userId: 'adv2', orgId: 'orgA' } },
      orgId: 'orgA',
      ownerUserId: 'adv1',
      integrationKey: 'citius',
      actionName: 'processos',
    });
    expect(res.success).toBe(true);
    expect((res.data as { processos: Array<{ processo: string }> }).processos.map((r) => r.processo))
      .toEqual(['1001/26.0T8LSB']);
  });
});

describe('the SHIPPED package and this module name the same dataset', () => {
  it('citius/config.json declares `processos` as a tenant-read on this exact dataset', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE, 'utf-8')) as {
      actions: Array<{ actionName: string; mutates: boolean; backingType?: string; tenantRead?: { dataset: string }; argsSchema?: { properties?: Record<string, unknown> }; description: string }>;
    };
    const action = pkg.actions.find((a) => a.actionName === 'processos');
    expect(action, 'the shipped citius package declares a `processos` action').toBeTruthy();
    // The unbinding failure this pins: rename the constant OR the package field and the action
    // resolves, gates, and then answers `unknown_dataset` in production.
    expect(action!.tenantRead?.dataset).toBe(CITIUS_PROCESSOS_DATASET);
    expect(action!.backingType).toBe('tenant-read');
    expect(action!.mutates).toBe(false);
    // NO DECLARED ARGUMENTS, and that is a decision rather than an omission (D-S9-2): every argument
    // a `mutates:false` action declares is one the parametrize rung may hand a model to fill, and a
    // model narrowing a list the caller did not ask to narrow is a silently shorter answer.
    expect(Object.keys(action!.argsSchema?.properties ?? {})).toEqual([]);
    // The coverage limit is in the action's own words, where a caller reading the catalog sees it.
    expect(action!.description).toMatch(/COBERTURA/);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. METADATA ONLY, one step further out
// ---------------------------------------------------------------------------------------------

describe('the read stays metadata-only', () => {
  it('emits no document reference, even when every landed row carries one', async () => {
    await landFor('adv1', [
      meta(1, { temDocumento: true, documentoRef: 'Documento.aspx?id=SEGREDO' }),
      meta(2, { temDocumento: true, documentoRef: 'Documento.aspx?id=OUTRO' }),
    ]);
    const out = await readCitiusProcessos(actor('adv1'));
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('SEGREDO');
    expect(serialized).not.toContain('OUTRO');
    expect(serialized).not.toContain('documentoRef');
    // What DOES survive is the count of rows that advertised one, which is the useful half.
    expect(out.processos.every((r) => r.comDocumento === 1)).toBe(true);
  });

  it('the module SOURCE never names a document reference outside its comments', () => {
    expect(MODULE_CODE).not.toMatch(/documentoRef/);
    // The structural half of the sync's own proof, applied to the new surface: there is no
    // identifier here to dereference even if a later change wanted to.
    expect(MODULE_CODE).not.toMatch(/Documento\.aspx/);
  });

  it('performs no network I/O of any kind', async () => {
    // The rail contacts nothing by construction; a global fetch spy makes that a fact rather than a
    // reading of the source.
    const spy = vi.spyOn(globalThis, 'fetch');
    await landFor('adv1', [meta(1)]);
    spy.mockClear();
    await readCitiusProcessos(actor('adv1'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
