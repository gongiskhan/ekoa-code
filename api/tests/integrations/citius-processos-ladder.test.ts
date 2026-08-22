import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { Store, type Doc } from '../../src/data/store.js';
import {
  activityLogs,
  billingAccounts,
  integrationConfigs,
  integrationDefinitions,
  approvedIntegrationActions,
} from '../../src/data/stores.js';
import { createConfig } from '../../src/integrations/service.js';
import { resolveDefinition } from '../../src/integrations/definition-registry.js';
import { isTrustedAction } from '../../src/integrations/authored-action.js';
import {
  achieveIntegrationGoal,
  matchActionForGoal,
  type AchieveContext,
  type AchieveLadderStep,
  type PlanDrafter,
  type PlanDraftTurn,
} from '../../src/integrations/integration-achieve.js';
import type { CapabilityOutcome } from '../../src/integrations/integration-capability.js';
import type { AppCollections, ComposeCollection } from '../../src/integrations/action-compose.js';
import { legalTenantReadHandler } from '../../src/legal/citius-processos.js';
import { syncCitiusNotifications, type CitiusSyncDeps } from '../../src/legal/citius-sync.js';
import type { CitiusInboxEnumeration } from '../../src/legal/citius-mandatarios-http.js';
import type { CitiusNotificacaoMeta } from '../../src/legal/citius-mandatarios.js';
import type { EnsureSessionResult } from '../../src/automation/session-establishment.js';

/**
 * SLICE S9 - THE CANONICAL GOAL, END TO END, THROUGH THE REAL REGISTERED ACTION.
 *
 * ================================ WHAT THIS FILE IS FOR =========================================
 *
 * `api/tests/integrations/achieve-reuse-ladder.test.ts` proves the reuse ladder's BEHAVIOUR, over a
 * local fixture whose header has said so since S5. It could not do more, because the canonical
 * action did not exist: the finding
 * `the-canonical-ongoing-processes-action-is-unreachable-from-the-canonical-goal` recorded both
 * halves of why - the action was absent, AND the plan's name for it (`get-ongoing-processes`) is
 * unreachable from a Portuguese goal under the matcher's coverage rule.
 *
 * THIS file is the other half. Nothing here is a stand-in for a product surface:
 *
 *   - the ACTION is the one the shipped `citius` package declares, resolved through
 *     `resolveDefinition` off the real `api/assets/integrations/citius/config.json`;
 *   - the ROWS it answers from are landed by the REAL `syncCitiusNotifications`, through the real
 *     deterministic-id insert, into the real `citius_notifications` collection;
 *   - the EXECUTION is the real `executeUserIntegrationAction` behind the real capability core,
 *     against a real encrypted config row;
 *   - the LADDER is the real `achieveIntegrationGoal`, and the compose rung's guardrail suite
 *     judges the plan exactly as it judges a production one.
 *
 * ================================ WHAT IS FAKED, COUNTED HONESTLY ===============================
 *
 * THREE doubles, not one - the first cut's header said "THE ONE FAKE, AND WHY IT IS THE ONLY ONE"
 * and undercounted:
 *
 *   1. CS4's `enumerate` - the portal transport, and the only one CI genuinely cannot have: the
 *      mandatários portal authenticates with an Ordem dos Advogados certificate or Chave Móvel
 *      Digital through autenticacao.gov.pt, interactively, with two factors (the CS5 seam, the
 *      credential ceremony's business and not a test's). It is placed as LOW as it can go, so
 *      everything downstream of the HTTP walk is production code and the rows read back are not a
 *      fixture SHAPED LIKE what the sync produces - they ARE what the sync produces. A shape drift
 *      in the writer reddens this file.
 *   2. The PLANNING turn (`plannerEmitting`) - the model call, faked at the seam so the rung's own
 *      prompt, parser and guardrail suite are all real.
 *   3. The CALLER'S COLLECTIONS (`collectionsOf`) - an in-memory `AppCollections`. The rows are
 *      stamped as the engine stamps them (see `CLIENT_ROWS`), but this is NOT the production
 *      binding: `server.ts` maps a present-but-EMPTY collection to `unknown_collection`, a value
 *      this seam cannot return. That divergence is unexercised here (every case seeds rows) and the
 *      real binding is covered by `security/achieve-compose-isolation.test.ts`, which drives
 *      `CollectionsEngine` through the composition root.
 *
 * ================================ WHAT ONLY AN ACCEPTANCE RUN CAN PROVE =========================
 *
 * Two things, and neither is claimed anywhere below.
 *
 *   1. THAT THE PORTAL'S INBOX PARSES. Every fixture in the Citius workstream is speculative: the
 *      authenticated inbox HTML has never been observed (CS1's own note, and the mock server's).
 *      This suite feeds the sync rows that ALREADY parsed, so it says nothing about the parse.
 *   2. THE SIZE OF THE COVERAGE GAP. The action answers "processes with notifications", which is a
 *      subset of "processes". How large a subset is a question about one real caseload, and only a
 *      run against a real account can measure it.
 */
const CANONICAL_GOAL = 'todos os processos de clientes com menos de 40 anos';
const CITIUS = 'citius';
const ORG = 'orgS9';
const OWNER = 'adv-s9';

let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const fixedNow = () => 1_700_000_000_000;
const actor = (userId = OWNER, orgId = ORG): Actor => ({ userId, orgId, role: 'user' });

const citiusNotifications = new Store<Doc>('citius_notifications');

function valueOf<T>(out: CapabilityOutcome<T>): T {
  if (!out.ok) throw new Error(`expected an admitted outcome, got refusal: ${out.refusal}`);
  return out.value;
}

/**
 * THE TENANT'S OWN CLIENT RECORDS, and the join key is the point.
 *
 * Citius knows nothing about a firm's clients - a notification carries a process number, a date, a
 * court and an act type, and no client identity of any kind. So the join runs the other way from
 * the S5 fixture's: the CALLER'S collection carries the case number, and the compose rung filters
 * the collection (`idade lt 40`), builds the key set from `numeroProcesso`, and keeps the action
 * rows whose `processo` is in it. That is how a law firm's records actually relate to the portal's,
 * and it is why the action's row field is named `processo` - the portal's own word.
 *
 * `Eva` is under 40 and keys a process the sync never landed: her row exercises the direction of
 * the join that a symmetric fixture cannot distinguish - a collection key with no action row must
 * add nothing, rather than fabricating a process from a client record.
 */
// STAMPED LIKE THE ENGINE STAMPS (review round). Every `CollectionsEngine` write path writes
// {id, createdAt, updatedAt, ...fields}, and its own docblock says a fixture without them proves
// nothing about production; the sibling S5 suite shapes its rows WITH the stamps under a comment
// saying exactly that, and the first cut of this file regressed that discipline. Nothing in the
// plan reads them - which is the point: the join must be indifferent to the columns production
// really carries, and a fixture that omits them cannot demonstrate that.
const STAMP = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const CLIENT_ROWS = [
  { id: 'c1', ...STAMP, nome: 'Ana', idade: 31, numeroProcesso: '1001/26.0T8LSB' },
  { id: 'c2', ...STAMP, nome: 'Bruno', idade: 52, numeroProcesso: '1002/26.0T8LSB' },
  { id: 'c3', ...STAMP, nome: 'Carla', idade: 39, numeroProcesso: '1003/26.0T8LSB' },
  { id: 'c4', ...STAMP, nome: 'Duarte', idade: 40, numeroProcesso: '1004/26.0T8LSB' },
  { id: 'c5', ...STAMP, nome: 'Eva', idade: 25, numeroProcesso: '9999/26.0T8LSB' },
];
const CLIENT_FIELDS = ['id', 'idade', 'nome', 'numeroProcesso'];

/** The plan the compose turn returns. Judged by the REAL `verifyComposePlan` against the REAL field
 *  sets the REAL rows and collections produce - so a wrong field name here fails as it would live. */
const COMPOSE_PLAN = {
  compose: true,
  collection: 'clientes',
  where: { field: 'idade', op: 'lt', value: 40 },
  join: { resultField: 'processo', collectionField: 'numeroProcesso' },
};

function composeBlock(plan: Record<string, unknown>): string {
  return `Aqui está.\n\n\`\`\`compose-json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`;
}

/**
 * A planner that drives the caller's own `userText` and `parse`, so the rung's prompt wording and
 * its parser are exercised rather than stubbed around. Only the chokepoint turn is absent.
 *
 * It returns a REAL `PlanDraftTurn` and is typed as one. The first cut returned an invented
 * `{ status: 'ok' }` behind an `as never`, which happened to work only because the rung tests for
 * `'unavailable'` and treats everything else as an answer - so a stub that had drifted from the
 * union would have gone on passing while proving nothing about the shape the real core emits.
 */
function plannerEmitting(reply: string): { planner: PlanDrafter; turns: () => number } {
  let turns = 0;
  const planner: PlanDrafter = async (input) => {
    turns++;
    input.userText(null);
    const parsed = input.parse(reply);
    const turn: PlanDraftTurn = {
      status: 'authored',
      text: reply,
      draft: parsed.draft,
      violations: parsed.violations,
      attempts: turns,
    };
    return turn;
  };
  return { planner, turns: () => turns };
}

/** The caller's own collections, as the composition root's owner-scoped seam answers them. */
function collectionsOf(byName: Record<string, Record<string, unknown>[]>): { seam: AppCollections; reads: string[] } {
  const reads: string[] = [];
  const seam: AppCollections = {
    list: async (): Promise<ComposeCollection[]> =>
      Object.keys(byName).sort().map((name) => ({
        name,
        fields: [...new Set((byName[name] ?? []).flatMap((r) => Object.keys(r)))].sort(),
      })),
    read: async (_a, collection) => {
      reads.push(collection);
      const rows = byName[collection];
      return rows === undefined ? { kind: 'unknown_collection' } : { kind: 'rows', rows };
    },
  };
  return { seam, reads };
}

interface CtxOpts {
  planner?: PlanDrafter;
  collections?: AppCollections;
  /** Omitted ⇒ the real handler. Present ⇒ this suite is asking what happens without the seam. */
  reader?: AchieveContext['readTenantDataset'] | null;
}

function ctxWith(opts: CtxOpts = {}): AchieveContext {
  return {
    actor: actor(),
    deps,
    username: OWNER,
    now: fixedNow,
    // THE REAL HANDLER, by default. The whole point of this file is that nothing between the goal
    // and the landed rows is a stand-in.
    ...(opts.reader === null ? {} : { readTenantDataset: opts.reader ?? legalTenantReadHandler }),
    ...(opts.planner ? { planStep: opts.planner } : {}),
    ...(opts.collections ? { appCollections: opts.collections } : {}),
  };
}

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

/** One real sync, landing through the real writer. Only CS4's transport is faked. */
async function landNotifications(rows: CitiusNotificacaoMeta[], userId = OWNER): Promise<void> {
  const walk: CitiusInboxEnumeration = {
    status: 'complete',
    rows,
    pagesWalked: 1,
    pages: [{ page: 1, outcome: 'ok', rows: rows.length }],
  };
  const syncDeps: CitiusSyncDeps = {
    establishSession: async (): Promise<EnsureSessionResult> => ({ status: 'reused', itemId: 'item-1', storageState: { cookies: [] } }),
    markSessionUnhealthy: async () => true,
    enumerate: async () => walk,
    clock: () => new Date('2026-07-01T00:00:00.000Z'),
    recordLesson: async () => [],
  };
  const out = await syncCitiusNotifications(
    { actor: actor(userId), runId: `run-${userId}`, baseUrl: 'https://portal.example' },
    syncDeps,
  );
  expect(out.status).toBe('ran');
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = ['test', 'encryption', 'key', '32', 'characters'].join('-');
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s9_ladder');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  seq = 0;
  for (const s of [integrationConfigs, integrationDefinitions, approvedIntegrationActions, activityLogs, billingAccounts]) {
    await s.deleteMany({});
  }
  await citiusNotifications.deleteMany({});
  await new Store<Doc>('sync_state').deleteMany({});
  await new Store<Doc>('sync_reports').deleteMany({});
  // The tenant has connected Citius. `cedula_profissional` is configuration, not a secret - this
  // package stores no password at all (the session is captured), which is why the read below can be
  // honest about needing no credential.
  await createConfig(actor(), { integrationKey: CITIUS, configValues: { cedula_profissional: '12345' } }, deps);
});

// ---------------------------------------------------------------------------------------------
// 1. The action exists, is reachable, and is trusted - all three off the SHIPPED package
// ---------------------------------------------------------------------------------------------

describe('the shipped citius package answers the canonical goal', () => {
  it('the canonical goal reaches `processos`, and reaches NOTHING ELSE in the package', async () => {
    const definition = await resolveDefinition(actor(), CITIUS);
    expect(definition, 'the shipped citius package resolves').toBeTruthy();
    const actions = definition!.actions ?? [];
    // The whole package is offered to the matcher, exactly as `achieve` offers it.
    const match = matchActionForGoal(CANONICAL_GOAL, actions);
    expect(match.kind).toBe('one');
    if (match.kind !== 'one') return;
    expect(match.action.actionName).toBe('processos');

    // WHY NO OTHER ACTION IS REACHABLE, as a fact rather than a hope. The coverage rule is the
    // safety property: a goal that omits an action's verb omits the action, so `consultar_processo`
    // and - the one that matters - the MUTATING `submeter_peca` cannot be picked by this sentence.
    for (const other of actions.filter((a) => a.actionName !== 'processos')) {
      expect(matchActionForGoal(CANONICAL_GOAL, [other]), other.actionName).toEqual({ kind: 'none' });
    }
  });

  it('the plan\'s own name for it is STILL unreachable - the finding, against the real package', async () => {
    const definition = await resolveDefinition(actor(), CITIUS);
    const real = (definition!.actions ?? []).find((a) => a.actionName === 'processos')!;
    // Rename the shipped action to the name the convergence plan used and the goal stops reaching it.
    // This is why S9 named it `processos`: the naming constraint is a property of the matcher, and no
    // amount of Citius plumbing would have made the plan's name work.
    expect(matchActionForGoal(CANONICAL_GOAL, [{ ...real, actionName: 'get-ongoing-processes' }])).toEqual({ kind: 'none' });
  });

  /**
   * THE DESTRUCTIVE-GOAL DIRECTION (slice S9 review round).
   *
   * The coverage rule's safety property is "a goal that omits the verb omits the action", and it is
   * VACUOUS for a name that carries no verb: `processos` tokenises to one bare noun, so every goal
   * naming processes covers it - including goals asking to destroy them. Before this round `achieve`
   * answered `outcome: 'executed'` for "apagar todos os processos antigos", i.e. it told an agent
   * chain the destructive goal had been ACHIEVED when all it had done was list.
   *
   * The first round recorded only the safe direction (submeter_peca unreachable). Both are pinned
   * now, and the sibling case below pins that a CONGRUENT destructive goal is untouched.
   */
  it('a DESTRUCTIVE goal is refused rather than answered with a listing', async () => {
    await landNotifications([meta(1), meta(2)]);
    for (const goal of [
      'apagar todos os processos antigos',
      'cancelar os processos do cliente',
      'arquivar os processos encerrados',
      'eliminar processos',
    ]) {
      const res = valueOf(await achieveIntegrationGoal(ctxWith(), CITIUS, goal));
      if (res.outcome !== 'refused') throw new Error(`expected refused for "${goal}", got ${res.outcome}`);
      expect(res.code, goal).toBe('read_only_match');
      // The read is NAMED, so a caller who did mean it can ask for it directly - the same courtesy
      // `ambiguous_goal` extends. A refusal that hid the candidate would just be a dead end.
      expect(res.candidates, goal).toEqual(['processos']);
      expect(res.message, goal).toContain('processos');
    }
  });

  it('…and NAMING THE ACTION EXACTLY is the way through, as the refusal says it is', async () => {
    // The refusal tells the caller to "name the action directly if you meant to read". If that were
    // also refused the sentence would be a lie and the refusal a dead end - which is exactly what
    // the first cut of this check did, caught by the pre-existing achieve suite calling `achieve`
    // with the literal name of a read whose own name carries a mutating verb.
    await landNotifications([meta(1)]);
    const res = valueOf(await achieveIntegrationGoal(ctxWith(), CITIUS, 'processos'));
    expect(res.outcome).toBe('executed');
  });

  it('…and the READ goal is untouched: the canonical goal still executes', async () => {
    // The control. Without it the case above is satisfied by refusing everything.
    await landNotifications([meta(1)]);
    const res = valueOf(await achieveIntegrationGoal(ctxWith(), CITIUS, CANONICAL_GOAL));
    expect(res.outcome).toBe('executed');
  });

  it('is TRUSTED by construction, so `achieve` runs it instead of refusing provisional_match', async () => {
    const definition = await resolveDefinition(actor(), CITIUS);
    const real = (definition!.actions ?? []).find((a) => a.actionName === 'processos')!;
    // A human wrote it (it ships in the package), so it carries no `authoring` record at all.
    expect(real.authoring).toBeUndefined();
    expect(isTrustedAction(CITIUS, real)).toBe(true);
  });

  it('leaves the compose rung REACHABLE - the goal still has residue the action is not named for', async () => {
    // The rung is skipped when the action's NAME + DESCRIPTION already account for every goal token.
    // A future edit that put "clientes" and "idade" into the description would silently disable the
    // narrowing and answer the whole caseload for a goal that asked for part of it - green
    // everywhere, wrong for the caller. This pins the residue that keeps the rung live.
    const definition = await resolveDefinition(actor(), CITIUS);
    const real = (definition!.actions ?? []).find((a) => a.actionName === 'processos')!;
    const tokens = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
    const accounted = new Set([...tokens(real.actionName), ...tokens(real.description)]);
    expect(accounted.has('clientes')).toBe(false);
    expect(accounted.has('anos')).toBe(false);
    expect(accounted.has('40')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. THE CANONICAL CASE, end to end
// ---------------------------------------------------------------------------------------------

describe('CANONICAL: "todos os processos de clientes com menos de 40 anos", for real', () => {
  it('lands rows through the sync, reads them through the action, and narrows them by the tenant\'s clients', async () => {
    // Four processes have notifications. `1005` belongs to nobody in the collection; `9999` is in
    // the collection and has no notification.
    await landNotifications([meta(1), meta(2), meta(3), meta(4), meta(5)]);
    const { planner, turns } = plannerEmitting(composeBlock(COMPOSE_PLAN));
    const { seam, reads } = collectionsOf({ clientes: CLIENT_ROWS });

    const res = valueOf(await achieveIntegrationGoal(ctxWith({ planner, collections: seam }), CITIUS, CANONICAL_GOAL));

    if (res.outcome !== 'composed') throw new Error(`expected composed, got ${JSON.stringify(res)}`);
    expect(res.actionName).toBe('processos');
    expect(turns()).toBe(1);

    // ONLY the under-40 clients' processes survive.
    expect(res.items.map((r) => r.processo)).toEqual(['1003/26.0T8LSB', '1001/26.0T8LSB']);
    // `c4` is exactly 40: `lt`, not `lte`.
    expect(res.items.map((r) => r.processo)).not.toContain('1004/26.0T8LSB');
    // `c2` (Bruno, 52) is over 40.
    expect(res.items.map((r) => r.processo)).not.toContain('1002/26.0T8LSB');
    // `1005` has notifications and no client record: the join drops it rather than passing it through.
    expect(res.items.map((r) => r.processo)).not.toContain('1005/26.0T8LSB');
    // `9999` is Eva's, under 40, and has no notification: a collection key with no action row adds
    // NOTHING. A join that ran the wrong way round would invent this process out of a client record.
    expect(res.items.map((r) => r.processo)).not.toContain('9999/26.0T8LSB');

    // The narrowing is reported in full, and the four counts are four different numbers.
    expect(res.composition.collection).toBe('clientes');
    expect(res.composition.where).toEqual({ field: 'idade', op: 'lt', value: 40 });
    expect(res.composition.join).toEqual({ resultField: 'processo', collectionField: 'numeroProcesso' });
    expect(res.composition.scanned).toBe(5);
    expect(res.composition.collectionScanned).toBe(5);
    expect(res.composition.matchedCollectionRows).toBe(3);
    expect(res.composition.matched).toBe(2);
    expect(reads).toEqual(['clientes']);

    // The action's OWN answer travels beside the narrowing, envelope and all - including `origem`,
    // which is the only thing telling a consumer this list is notification-derived.
    expect(res.result.success).toBe(true);
    expect((res.result.data as { origem: string }).origem).toBe('citius-notificacoes-sincronizadas');
    expect((res.result.data as { processos: unknown[] }).processos).toHaveLength(5);
  });

  it('the ladder reports the rungs it considered and the one it took', async () => {
    await landNotifications([meta(1), meta(2), meta(3), meta(4), meta(5)]);
    const { planner } = plannerEmitting(composeBlock(COMPOSE_PLAN));
    const { seam } = collectionsOf({ clientes: CLIENT_ROWS });

    const res = valueOf(await achieveIntegrationGoal(ctxWith({ planner, collections: seam }), CITIUS, CANONICAL_GOAL));
    if (res.outcome !== 'composed') throw new Error(`expected composed, got ${res.outcome}`);
    const ladder = res.ladder as AchieveLadderStep[];
    // PARAMETRIZE IS SKIPPED, and it is skipped because the action declares no arguments (D-S9-2).
    // Every argument a `mutates:false` action declares is one a model may fill; a list whose whole
    // purpose is to be narrowed downstream must not be narrowed upstream by a guess.
    expect(ladder.find((s) => s.rung === 'parametrize')?.verdict).toBe('skipped');
    expect(ladder.find((s) => s.rung === 'compose')?.verdict).toBe('taken');
    expect(ladder.find((s) => s.rung === 'compose')?.detail).toContain('2 of 5');
    // COMPOSE is the rung that answered, so it is the one marked `taken` - `reuse` is stamped
    // `taken` on the EXECUTED exit instead, which is the exit the degradation case below takes.
    // Exactly one rung answers, and the ladder never claims two did.
    expect(ladder.filter((s) => s.verdict === 'taken').map((s) => s.rung)).toEqual(['compose']);
    expect(ladder.find((s) => s.rung === 'mint')).toBeUndefined();
  });

  it('DEGRADES to the whole list when the compose seams are not wired, rather than refusing', async () => {
    await landNotifications([meta(1), meta(2)]);
    // No planner and no collections: the deployment has not wired the upper rungs.
    const res = valueOf(await achieveIntegrationGoal(ctxWith(), CITIUS, CANONICAL_GOAL));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(res.actionName).toBe('processos');
    expect((res.result.data as { processos: unknown[] }).processos).toHaveLength(2);
    expect(res.ladder.find((s) => s.rung === 'compose')?.verdict).toBe('skipped');
    // REUSE answered, and says so: an `executed` outcome with no rung marked `taken` would leave a
    // client unable to read which rung produced the answer.
    expect(res.ladder.find((s) => s.rung === 'reuse')?.verdict).toBe('taken');
  });

  it('answers an EMPTY list when the sync has never run, and mints nothing for it', async () => {
    // The honest answer for a tenant whose sync has not landed anything: an empty list, from the
    // matched action - never an authored action invented to satisfy the goal.
    const res = valueOf(await achieveIntegrationGoal(ctxWith(), CITIUS, CANONICAL_GOAL));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect((res.result.data as { processos: unknown[] }).processos).toEqual([]);
    // NOTHING WAS MINTED into the tenant's own row - `achieve` never reached the author arm.
    expect(await integrationDefinitions.find({ orgId: ORG })).toEqual([]);
  });

  it('never crosses mandatários: another lawyer\'s processes are not in this answer', async () => {
    await landNotifications([meta(1)], OWNER);
    await landNotifications([meta(8)], 'adv-outro');
    const res = valueOf(await achieveIntegrationGoal(ctxWith(), CITIUS, CANONICAL_GOAL));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${res.outcome}`);
    const rows = (res.result.data as { processos: Array<{ processo: string }> }).processos;
    expect(rows.map((r) => r.processo)).toEqual(['1001/26.0T8LSB']);
    expect(rows.map((r) => r.processo)).not.toContain('1008/26.0T8LSB');
  });

  it('refuses honestly when the deployment binds no readers - never an empty list', async () => {
    await landNotifications([meta(1)]);
    // `reader: null` is a deployment that has not wired `legalTenantReadHandler`. The answer a
    // lawyer must NOT get here is "you have no processes".
    const out = await achieveIntegrationGoal(ctxWith({ reader: null }), CITIUS, CANONICAL_GOAL);
    const res = valueOf(out);
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(res.result.success).toBe(false);
    expect(res.result.code).toBe('unsupported_backing_type');
    expect(res.result.data).toBeUndefined();
  });
});
