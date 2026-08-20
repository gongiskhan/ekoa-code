import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  activityLogs,
  billingAccounts,
  integrationConfigs,
  integrationDefinitions,
  approvedIntegrationActions,
} from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { approveAction, describeAction } from '../../src/integrations/action-consent.js';
import {
  achieveIntegrationGoal,
  matchActionForGoal,
  type AchieveContext,
  type AchieveLadderStep,
  type PlanDrafter,
} from '../../src/integrations/integration-achieve.js';
import {
  argSlotsOf,
  missingDeclaredArgs,
  parseArgsPlan,
  verifyPlannedArgs,
} from '../../src/integrations/action-parametrize.js';
import {
  composeRows,
  parseComposePlan,
  rowsOf,
  verifyComposePlan,
  type AppCollections,
  COMPOSE_MAX_ITEMS,
} from '../../src/integrations/action-compose.js';
import { matchesSimpleQuery } from '../../src/data/simple-query.js';
import type { CapabilityOutcome } from '../../src/integrations/integration-capability.js';
import type { IntegrationAction, IntegrationDefinition } from '../../src/integrations/definitions.js';
// The tier direction runs integrations/ -> (a seam) -> agents/, so the product module may not
// import the authoring core. A TEST may, and this one does on purpose: the PLANNING seam is only
// useful if the REAL core satisfies it, and that is a compile-time fact nothing else here proves.
import { authorWithRepair } from '../../src/agents/authoring-core.js';

/**
 * Slices S4 + S5 - THE REUSE LADDER, at the module level.
 *
 * `achieve` used to be a two-rung lexical fork: reuse an action exactly as it stands, or mint a
 * new one. Two rungs are added BETWEEN them, and the whole safety argument is what stayed put:
 *
 *   THE PICK IS STILL DETERMINISTIC. `matchActionForGoal` is untouched - the last describe pins
 *   that as a source fact, and the first one pins its behaviour on the canonical goal. No model
 *   picks the action, so "the model thought you meant delete_invoice" remains unsayable.
 *
 * What each rung is allowed to do, and the tests that hold it there:
 *
 *   PARAMETRIZE - a model proposes VALUES for arguments the action itself declares and the caller
 *   left out. `argsSchema` is documentation everywhere else in this repo (the executor never reads
 *   it), so `verifyPlannedArgs` is the ONLY thing standing between a model-invented key and the
 *   `{{name}}` namespace `buildVars` interpolates from - section 2 is written accordingly.
 *   Decision D1 lives in the `targeting` check: body arguments always, resource-selecting ones
 *   only on an action that cannot write.
 *
 *   COMPOSE - a trusted READ is run and its rows narrowed against ONE of the tenant's own
 *   collections with a `SimpleQuery`-class predicate. The model names the collection, the field,
 *   the comparison and the join; every row that moves is moved by TypeScript. Section 4 is the
 *   canonical case end to end, and section 5 is what compose refuses.
 *
 * EVERY RUNG DEGRADES TO THE ONE BELOW IT. Section 6 pins that: an absent seam, an outage, a
 * refused allowance and a goal with no residue all leave `achieve` behaving exactly as it did
 * before the ladder existed. That is the Rule-7 half, and it is what makes the rungs safe to add
 * to a live capability endpoint.
 */
let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const fixedNow = () => 1_700_000_000_000;

const PROBE_INTEGRATION = 's4s5-ladder-probe';
const HOST = 'https://ladder.example';

function valueOf<T>(out: CapabilityOutcome<T>): T {
  if (!out.ok) throw new Error(`expected an admitted outcome, got refusal: ${out.refusal}`);
  return out.value;
}

/**
 * A faithful miniature of `authorWithRepair`: it drives the caller's own `userText`, `parse` and
 * repair budget, so each rung's prompt wording, parser and repair request are exercised rather
 * than stubbed around. Only the chokepoint turn is absent. `replies` is consumed one per attempt;
 * the last one repeats.
 */
function plannerEmitting(replies: string[]): { planner: PlanDrafter; prompts: string[]; turns: () => number } {
  const prompts: string[] = [];
  let turns = 0;
  const planner: PlanDrafter = async (input) => {
    let violations: string[] = [];
    const repairs = input.repairs ?? 0;
    for (let attempt = 0; attempt <= repairs; attempt++) {
      turns++;
      prompts.push([...input.contentSections, input.outputContract, input.userText(attempt === 0 ? null : violations)].join('\n\n'));
      const text = replies[Math.min(attempt, replies.length - 1)] ?? '';
      const parsed = input.parse(text);
      if (parsed.violations.length === 0 || attempt === repairs) {
        return { status: 'authored', text, draft: parsed.draft, violations: parsed.violations, attempts: attempt + 1 };
      }
      violations = parsed.violations;
    }
    /* c8 ignore next */
    throw new Error('unreachable');
  };
  return { planner, prompts, turns: () => turns };
}

const unavailablePlanner: PlanDrafter = async () => ({
  status: 'unavailable',
  reason: 'transport',
  detail: 'no route to the provider',
  attempts: 1,
});

function argsBlock(args: Record<string, unknown>): string {
  return `Sure.\n\n\`\`\`args-json\n${JSON.stringify({ args }, null, 2)}\n\`\`\`\n`;
}
function composeBlock(plan: Record<string, unknown>): string {
  return `Here.\n\n\`\`\`compose-json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`;
}

/** In-memory collections seam. The REAL org-scoped binding lives in `server.ts` and is exercised
 *  (and mutated) by `api/tests/security/achieve-compose-isolation.test.ts`; what this one supplies
 *  is the ROWS, so this suite is about the stage rather than about the scoping. */
function collectionsOf(byName: Record<string, Record<string, unknown>[] | 'ambiguous'>): {
  seam: AppCollections;
  reads: string[];
} {
  const reads: string[] = [];
  return {
    reads,
    seam: {
      list: async () => Object.keys(byName).sort(),
      read: async (_actor, collection) => {
        reads.push(collection);
        const rows = byName[collection];
        if (rows === undefined) return { kind: 'unknown_collection' };
        if (rows === 'ambiguous') return { kind: 'ambiguous_collection', sources: ['app-a', 'app-b'] };
        return { kind: 'rows', rows };
      },
    },
  };
}

interface CtxOpts {
  planner?: PlanDrafter;
  collections?: AppCollections;
  /** What the automation seam answers - this is how a matched action produces rows. */
  data?: unknown;
}

function ctxWith(userId: string, orgId: string, opts: CtxOpts = {}): { ctx: AchieveContext; calls: Array<{ args: Record<string, unknown> }> } {
  const calls: Array<{ args: Record<string, unknown> }> = [];
  const ctx: AchieveContext = {
    actor: { userId, orgId, role: 'user' },
    deps,
    username: userId,
    now: fixedNow,
    runAutomationBackedAction: async (input) => {
      calls.push({ args: input.args });
      return { success: true, data: opts.data ?? { ran: true } };
    },
    ...(opts.planner ? { planStep: opts.planner } : {}),
    ...(opts.collections ? { appCollections: opts.collections } : {}),
  };
  return { ctx, calls };
}

/**
 * THE CANONICAL FIXTURE, and an honest note about its name.
 *
 * The plan this slice implements names the canonical action `get-ongoing-processes`. That action
 * DOES NOT EXIST in this repo (`grep -ri 'ongoing.process\|processos em curso' api/ shared/ web/`
 * returns nothing), which VERIFICATION.md already recorded as net-new work needing a real Citius
 * session - so the canonical case is built here against a deterministic local fixture of the same
 * shape, and the Citius path is NOT claimed as proven.
 *
 * There is a SECOND reason the name could not be used, and it is a property of the code rather
 * than of the missing session: `matchActionForGoal` requires the goal to name EVERY token of the
 * action's name, and the canonical Portuguese goal names neither `ongoing` nor `curso`. An action
 * called `get-ongoing-processes` is therefore UNREACHABLE from "todos os processos de clientes com
 * menos de 40 anos", with or without a Citius session. Section 1 pins exactly that, so the finding
 * survives in the suite rather than only in a report.
 */
const processos: IntegrationAction = {
  actionName: 'processos',
  description: 'Processos do mandatário',
  mutates: false,
  automationBinding: { automationId: 'citius-1', automationTemplate: 'processos' },
};

const consultarProcesso: IntegrationAction = {
  actionName: 'consultar_processo',
  description: 'Consulta um processo pelo número',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/processos/{{numero}}' },
  argsSchema: { type: 'object', properties: { numero: { type: 'string' } } },
};

const submeterPeca: IntegrationAction = {
  actionName: 'submeter_peca',
  description: 'Submete uma peça',
  mutates: true,
  httpConfig: {
    method: 'POST',
    baseUrl: HOST,
    path: '/processos/{{numero}}/pecas',
    bodyTemplate: { titulo: '{{titulo}}' },
  },
  argsSchema: { type: 'object', properties: { numero: { type: 'string' }, titulo: { type: 'string' } } },
};

const CANONICAL_GOAL = 'todos os processos de clientes com menos de 40 anos';

/** Rows in the shape the executor really produces for this action: the automation seam's
 *  `{ success, data }`, with `data` the answer body. */
const PROCESS_ROWS = [
  { numeroProcesso: '111/24.0T8LSB', clienteId: 'c1', tribunal: 'Lisboa' },
  { numeroProcesso: '222/24.0T8PRT', clienteId: 'c2', tribunal: 'Porto' },
  { numeroProcesso: '333/24.0T8CBR', clienteId: 'c3', tribunal: 'Coimbra' },
  { numeroProcesso: '444/24.0T8FAR', clienteId: 'c4', tribunal: 'Faro' },
];

/**
 * Rows in the shape `CollectionsEngine.create` really writes: `id` + `createdAt`/`updatedAt`
 * stamps + the app's own fields.
 *
 * `c4` SITS EXACTLY ON THE BOUNDARY and must be excluded. Without it, `lt` and `lte` select the
 * same set over this fixture and the canonical assertion could not tell the two apart - an
 * off-by-one in the one predicate every recipe in the product also runs on would have gone
 * unnoticed here (it did, until the shared predicate was mutated to prove otherwise).
 */
const CLIENT_ROWS = [
  { id: 'c1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', nome: 'Ana', idade: 31 },
  { id: 'c2', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', nome: 'Bruno', idade: 52 },
  { id: 'c3', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', nome: 'Carla', idade: 39 },
  { id: 'c4', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', nome: 'Duarte', idade: 40 },
];

const CANONICAL_PLAN = {
  compose: true,
  collection: 'clients',
  where: { field: 'idade', op: 'lt', value: 40 },
  join: { resultField: 'clienteId', collectionField: 'id' },
};

async function seed(actions: IntegrationAction[], opts: { orgId?: string; userId?: string } = {}): Promise<void> {
  const orgId = opts.orgId ?? 'orgA';
  const userId = opts.userId ?? 'ownerA';
  await integrationDefinitionStore.create(
    {
      orgId,
      userId,
      visibility: 'private',
      key: PROBE_INTEGRATION,
      displayName: 'Ladder Probe',
      configSchema: [{ key: 'api_key', label: 'API key', type: 'password', required: true, secret: true }],
      actions,
      skillMd: '# probe',
      authType: 'none',
    },
    { actor: { userId, orgId, role: 'user' }, onConflict: 'replace' },
  );
}

const DEF: Pick<IntegrationDefinition, 'configSchema'> = {
  configSchema: [{ key: 'api_key', label: 'API key', type: 'password', required: true, secret: true }],
};

function verdictOn(action: IntegrationAction, planned: unknown, callerArgs: Record<string, unknown> = {}) {
  return verifyPlannedArgs({ action, definition: DEF, planned, callerArgs, allowedOrigins: ['ladder.example'] });
}
function failed(v: ReturnType<typeof verifyPlannedArgs>, name: string): boolean {
  return v.checks.some((c) => c.name === name && !c.ok);
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s4s5_ladder');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  for (const s of [integrationDefinitions, integrationConfigs, approvedIntegrationActions, activityLogs, billingAccounts]) {
    await s.deleteMany({});
  }
});

// ---------------------------------------------------------------------------------------------
// 0. The seams are real, and the PICK is still the lexical one
// ---------------------------------------------------------------------------------------------

describe('the planning seam is the shared authoring core, and the pick never became a model call', () => {
  it('the REAL authorWithRepair satisfies the PlanDrafter seam', () => {
    // A TYPE assertion that happens to run: if the core's signature drifts from the seam,
    // `npm run typecheck` fails here - the only place the wiring in server.ts is proved possible
    // without booting the composition root.
    const wired: PlanDrafter = (input) => authorWithRepair({ ...input, emptyReply: 'unavailable' });
    expect(typeof wired).toBe('function');
  });

  it('the canonical goal matches the action the GOAL names, and cannot reach an English-named one', () => {
    // The rule is COVERAGE: the goal must name every token of the action's name. This is the
    // finding the plan's own canonical name runs into, pinned so it cannot be quietly forgotten.
    const ptNamed = matchActionForGoal(CANONICAL_GOAL, [processos]);
    expect(ptNamed).toEqual({ kind: 'one', action: processos });

    const enNamed: IntegrationAction = { ...processos, actionName: 'get-ongoing-processes' };
    expect(matchActionForGoal(CANONICAL_GOAL, [enNamed])).toEqual({ kind: 'none' });
    // …and not because the goal is Portuguese: the same action is unreachable from the English
    // sentence too unless the sentence names `ongoing`.
    expect(matchActionForGoal('all the processes of clients under 40', [enNamed])).toEqual({ kind: 'none' });
    expect(matchActionForGoal('list ongoing processes', [enNamed])).toEqual({ kind: 'one', action: enNamed });
  });
});

// ---------------------------------------------------------------------------------------------
// 1. PARAMETRIZE - the deterministic verdict on model-filled arguments
// ---------------------------------------------------------------------------------------------

describe('verifyPlannedArgs is the only check argsSchema ever gets', () => {
  it('accepts values for exactly the arguments the action declares', () => {
    const v = verdictOn(consultarProcesso, { args: { numero: '111/24.0T8LSB' } });
    expect(v.passed).toBe(true);
    expect(v.args).toEqual({ numero: '111/24.0T8LSB' });
  });

  it('REFUSES an argument the action does not declare - the executor would interpolate it anyway', () => {
    // `buildVars` merges every key of `args` into the one `{{name}}` namespace, so an undeclared
    // key is how a model-filled value reaches a placeholder nobody declared for it.
    const v = verdictOn(consultarProcesso, { args: { numero: '1', api_base: 'https://elsewhere.example' } });
    expect(v.passed).toBe(false);
    expect(failed(v, 'declared_args')).toBe(true);
    expect(v.args).toBeNull();
  });

  it('REFUSES an argument that names a credential field of the integration', () => {
    const withCredArg: IntegrationAction = {
      ...consultarProcesso,
      argsSchema: { type: 'object', properties: { numero: {}, api_key: {} } },
    };
    const v = verdictOn(withCredArg, { args: { api_key: 'anything' } });
    expect(v.passed).toBe(false);
    expect(failed(v, 'declared_args')).toBe(true);
  });

  it('REFUSES overwriting an argument the caller supplied', () => {
    const v = verdictOn(consultarProcesso, { args: { numero: 'model-chose-this' } }, { numero: 'human-chose-this' });
    expect(v.passed).toBe(false);
    expect(failed(v, 'declared_args')).toBe(true);
  });

  it('REFUSES a non-scalar value (a bare {{name}} body template passes objects through raw)', () => {
    const v = verdictOn(consultarProcesso, { args: { numero: { $ne: null } } });
    expect(v.passed).toBe(false);
    expect(failed(v, 'shape')).toBe(true);
    // Nothing below `shape` is judged on a malformed plan.
    expect(v.checks.map((c) => c.name)).toEqual(['shape']);
  });

  it('D1: a BODY argument is fillable on a WRITE - the shape is what the human approved', () => {
    const v = verdictOn(submeterPeca, { args: { titulo: 'Contestação' } }, { numero: '111/24.0T8LSB' });
    expect(v.passed).toBe(true);
    expect(argSlotsOf(submeterPeca.httpConfig).titulo).toBe('body');
  });

  it('D1: a TARGETING argument is refused on a WRITE and allowed on a READ', () => {
    expect(argSlotsOf(submeterPeca.httpConfig).numero).toBe('targeting');
    const onWrite = verdictOn(submeterPeca, { args: { numero: '999/24.0T8LSB' } });
    expect(onWrite.passed).toBe(false);
    expect(failed(onWrite, 'targeting')).toBe(true);

    // The identical argument in the identical slot, on an action whose `mutates` is a literal
    // false, passes. Only `mutates` differs between these two assertions.
    const onRead = verdictOn(consultarProcesso, { args: { numero: '999/24.0T8LSB' } });
    expect(onRead.passed).toBe(true);
  });

  it('D1 reads mutates FAIL-CLOSED: an absent mutates is a write', () => {
    const undeclared = { ...consultarProcesso } as unknown as IntegrationAction;
    delete (undeclared as { mutates?: boolean }).mutates;
    expect(verdictOn(undeclared, { args: { numero: '1' } }).passed).toBe(false);
  });

  it('a header argument counts as targeting (the consent dialog never showed it either)', () => {
    const hdr: IntegrationAction = {
      ...submeterPeca,
      httpConfig: { ...submeterPeca.httpConfig!, path: '/pecas', headers: { 'x-account': '{{numero}}' } },
    };
    expect(argSlotsOf(hdr.httpConfig).numero).toBe('targeting');
  });

  it('REFUSES a value that looks like a pasted credential', () => {
    const v = verdictOn(consultarProcesso, { args: { numero: 'Bearer sk-live-4f9a2b7c1d8e6f0a3b5c' } });
    expect(v.passed).toBe(false);
    expect(failed(v, 'no_pasted_secret')).toBe(true);
  });

  it('RENDER: a path value that re-authorities the URL is refused, and named', () => {
    // `new URL('https://ladder.example' + '/@evil.example')` keeps the authority, but a path
    // template with no leading slash does not: this is the escape the probe exists for.
    const bare: IntegrationAction = {
      ...consultarProcesso,
      httpConfig: { method: 'GET', baseUrl: HOST, path: '{{numero}}' },
    };
    const v = verifyPlannedArgs({
      action: bare,
      definition: DEF,
      planned: { args: { numero: '@evil.example/processos' } },
      callerArgs: {},
      allowedOrigins: ['ladder.example'],
    });
    expect(v.passed).toBe(false);
    expect(failed(v, 'render')).toBe(true);
    expect(v.checks.find((c) => c.name === 'render')?.detail).toContain('evil.example');
  });

  it('missingDeclaredArgs asks only about what the caller left out', () => {
    expect(missingDeclaredArgs(submeterPeca, {})).toEqual(['numero', 'titulo']);
    expect(missingDeclaredArgs(submeterPeca, { numero: '1' })).toEqual(['titulo']);
    expect(missingDeclaredArgs(submeterPeca, { numero: '1', titulo: 't' })).toEqual([]);
    // An explicit `undefined` is still an answer the caller gave.
    expect(missingDeclaredArgs(submeterPeca, { numero: undefined, titulo: undefined })).toEqual([]);
  });

  it('parseArgsPlan wants exactly one fenced block and reports what is wrong with the rest', () => {
    expect(parseArgsPlan(argsBlock({ a: 1 })).draft).toEqual({ args: { a: 1 } });
    expect(parseArgsPlan('no block at all').violations).toHaveLength(1);
    expect(parseArgsPlan('```args-json\n{oops\n```').violations[0]).toContain('not valid JSON');
    expect(parseArgsPlan('```args-json\n[1,2]\n```').violations[0]).toContain('single JSON object');
  });
});

// ---------------------------------------------------------------------------------------------
// 2. PARAMETRIZE through achieve - the write gate is still the executor's
// ---------------------------------------------------------------------------------------------

describe('the parametrize rung fills arguments and then meets the same gate', () => {
  it('fills a declared argument the caller omitted and reports which', async () => {
    await seed([consultarProcesso]);
    const { planner } = plannerEmitting([argsBlock({ numero: '111/24.0T8LSB' })]);
    const { ctx } = ctxWith('ownerA', 'orgA', { planner });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'consultar processo 111/24.0T8LSB'));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(res.filledArgs).toEqual(['numero']);
    expect(res.ladder?.find((s) => s.rung === 'parametrize')?.verdict).toBe('taken');
  });

  it('a filled BODY argument on an unapproved WRITE still answers awaiting_consent - nothing runs', async () => {
    await seed([submeterPeca]);
    const { planner } = plannerEmitting([argsBlock({ titulo: 'Contestação' })]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'submeter peça de contestação', { numero: '111/24.0T8LSB' }));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    // THE LOAD-BEARING ASSERTION: the rung filled an argument and the gate still refused.
    expect(res.result.code).toBe('awaiting_consent');
    expect(calls).toHaveLength(0);
  });

  it('a WRITE whose only missing argument is TARGETING is never even offered to the model', async () => {
    await seed([submeterPeca]);
    const { planner, turns } = plannerEmitting([argsBlock({ numero: 'model-picked' })]);
    const { ctx } = ctxWith('ownerA', 'orgA', { planner });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'submeter peca', { titulo: 't' }));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(turns()).toBe(0);
    expect(res.ladder?.find((s) => s.rung === 'parametrize')?.detail).toContain('numero');
  });

  it('an AUTOMATION-BACKED action is parametrized too - it has no URL, not no arguments', async () => {
    // The render probe needs a bound host and an automation-backed action addresses none, so an
    // earlier shape of this rung skipped the whole backing type on a check that does not apply
    // to it. The citius-shaped fixture is exactly that backing.
    await seed([{ ...processos, argsSchema: { type: 'object', properties: { tribunal: {} } } }]);
    const { planner } = plannerEmitting([argsBlock({ tribunal: 'Coimbra' })]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'processos do tribunal indicado'));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(res.filledArgs).toEqual(['tribunal']);
    // …and the value reached the automation seam, which is where an automation-backed action's
    // arguments actually go.
    expect(calls[0]?.args).toMatchObject({ tribunal: 'Coimbra' });
  });

  it('a plan that breaks the guardrails REFUSES the whole call and sends nothing', async () => {
    await seed([consultarProcesso]);
    // Two identical bad replies so the repair turn is exercised and still fails.
    const { planner } = plannerEmitting([argsBlock({ numero: '1', extra: 'x' })]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'consultar processo urgente do cliente'));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${JSON.stringify(res)}`);
    expect(res.code).toBe('parametrize_refused');
    expect(res.violations?.join(' ')).toContain('extra');
    expect(calls).toHaveLength(0);
  });

  it('the prompt names the arguments to supply and never a credential VALUE', async () => {
    await seed([submeterPeca]);
    await approveAction({ orgId: 'orgA', userId: 'ownerA' }, describeAction(PROBE_INTEGRATION, submeterPeca), 'always');
    const { planner, prompts } = plannerEmitting([argsBlock({ titulo: 'x' })]);
    const { ctx } = ctxWith('ownerA', 'orgA', { planner });
    await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'submeter peça');

    const prompt = prompts.join('\n');
    expect(prompt).toContain('titulo');
    // The withheld targeting argument is named as withheld, not offered.
    expect(prompt).toContain('Arguments only a person may supply');
    expect(prompt).toContain('You are not choosing the action');
    // An HTTP action HAS a request, so the slot table is stated.
    expect(prompt).toContain('Where each argument lands in the request');
  });

  it('an automation-backed action is told nothing about slots, rather than told "unused"', async () => {
    // Every name would read `unused` for a backing whose destination this module cannot see, and
    // "goes nowhere" is not what that means.
    await seed([{ ...processos, argsSchema: { type: 'object', properties: { tribunal: {} } } }]);
    const { planner, prompts } = plannerEmitting([argsBlock({ tribunal: 'Faro' })]);
    const { ctx } = ctxWith('ownerA', 'orgA', { planner, data: { processos: PROCESS_ROWS } });
    await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'processos do tribunal indicado');

    const prompt = prompts.join('\n');
    expect(prompt).toContain('tribunal');
    expect(prompt).not.toContain('Where each argument lands in the request');
    expect(prompt).not.toContain('unused');
  });
});

// ---------------------------------------------------------------------------------------------
// 3. COMPOSE - the deterministic stage, as pure functions
// ---------------------------------------------------------------------------------------------

describe('the compose stage is TypeScript, and its vocabulary is the recipe DSL\'s', () => {
  it('joins the action rows against the collection rows that satisfy the predicate', () => {
    const out = composeRows({
      plan: CANONICAL_PLAN as never,
      actionRows: PROCESS_ROWS,
      collectionRows: CLIENT_ROWS,
    });
    // `c4` is exactly 40 and is NOT under 40.
    expect(out.items.map((r) => r.numeroProcesso)).toEqual(['111/24.0T8LSB', '333/24.0T8CBR']);
    expect(out.summary.scanned).toBe(4);
    expect(out.summary.matchedCollectionRows).toBe(2);
    expect(out.summary.matched).toBe(2);
    expect(out.summary.truncated).toBe(false);
  });

  it('uses the SAME predicate `store.query` uses - not a second copy of it', () => {
    // If these ever disagree, one recipe DSL comparison and one compose comparison have drifted.
    for (const row of CLIENT_ROWS) {
      const direct = matchesSimpleQuery(row, { field: 'idade', op: 'lt', value: 40 });
      const viaStage = composeRows({
        plan: { ...CANONICAL_PLAN, join: { resultField: 'id', collectionField: 'id' } } as never,
        actionRows: [row],
        collectionRows: [row],
      }).items.length === 1;
      expect(viaStage).toBe(direct);
    }
  });

  it('a key absent on either side matches nothing (it does not match every other absent key)', () => {
    const out = composeRows({
      plan: CANONICAL_PLAN as never,
      actionRows: [{ numeroProcesso: 'x' }, { numeroProcesso: 'y', clienteId: null }],
      collectionRows: [{ id: null, idade: 20 }, { idade: 20 }],
    });
    expect(out.items).toEqual([]);
  });

  it('keys are compared as strings, so a numeric id from one side still joins', () => {
    const out = composeRows({
      plan: CANONICAL_PLAN as never,
      actionRows: [{ numeroProcesso: 'p', clienteId: 7 }],
      collectionRows: [{ id: '7', idade: 20 }],
    });
    expect(out.items).toHaveLength(1);
  });

  it('caps what it emits and says so', () => {
    const many = Array.from({ length: COMPOSE_MAX_ITEMS + 5 }, (_, i) => ({ numeroProcesso: `p${i}`, clienteId: 'c1' }));
    const out = composeRows({ plan: CANONICAL_PLAN as never, actionRows: many, collectionRows: CLIENT_ROWS });
    expect(out.items).toHaveLength(COMPOSE_MAX_ITEMS);
    expect(out.summary.matched).toBe(COMPOSE_MAX_ITEMS + 5);
    expect(out.summary.truncated).toBe(true);
  });

  it('rowsOf finds the one list, and REFUSES to guess between two', () => {
    expect(rowsOf(PROCESS_ROWS)).toEqual({ kind: 'rows', rows: PROCESS_ROWS });
    expect(rowsOf({ processos: PROCESS_ROWS })).toEqual({ kind: 'rows', rows: PROCESS_ROWS });
    expect(rowsOf({ processos: PROCESS_ROWS, arquivados: [] }).kind).toBe('unshaped');
    expect(rowsOf({ ok: true }).kind).toBe('unshaped');
    expect(rowsOf('not a list').kind).toBe('unshaped');
    expect(rowsOf([1, 2, 3]).kind).toBe('unshaped');
  });

  it('verifyComposePlan refuses a comparison this platform does not perform', () => {
    const v = verifyComposePlan({
      action: processos,
      planned: { ...CANONICAL_PLAN, where: { field: 'idade', op: 'regex', value: '^4' } },
    });
    expect(v.passed).toBe(false);
    expect(v.checks.some((c) => c.name === 'predicate' && !c.ok)).toBe(true);
  });

  it('verifyComposePlan refuses a reserved or malformed collection name', () => {
    for (const bad of ['usr.someone', '__system', 'has spaces', '']) {
      const v = verifyComposePlan({ action: processos, planned: { ...CANONICAL_PLAN, collection: bad } });
      expect(v.passed).toBe(false);
    }
  });

  it('`{ "compose": false }` is a well-formed answer that yields no plan', () => {
    const v = verifyComposePlan({ action: processos, planned: { compose: false } });
    expect(v.passed).toBe(true);
    expect(v.plan).toBeNull();
  });

  it('parseComposePlan wants exactly one fenced block', () => {
    expect(parseComposePlan(composeBlock({ compose: false })).draft).toEqual({ compose: false });
    expect(parseComposePlan('nothing here').violations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. THE CANONICAL TEST
// ---------------------------------------------------------------------------------------------

describe('CANONICAL: "todos os processos de clientes com menos de 40 anos"', () => {
  it('resolves as a trusted READ plus a join against the tenant\'s clients collection, and MINTS NOTHING', async () => {
    await seed([processos]);
    const { planner } = plannerEmitting([composeBlock(CANONICAL_PLAN)]);
    const { seam, reads } = collectionsOf({ clients: CLIENT_ROWS, invoices: [] });
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));

    if (res.outcome !== 'composed') throw new Error(`expected composed, got ${JSON.stringify(res)}`);
    // The action the LEXICAL matcher picked ran, once, through the gated executor.
    expect(res.actionName).toBe('processos');
    expect(calls).toHaveLength(1);
    // Only the under-40 clients' processes survive.
    expect(res.items.map((r) => r.numeroProcesso)).toEqual(['111/24.0T8LSB', '333/24.0T8CBR']);
    // The boundary row (`c4`, exactly 40) is excluded - `lt`, not `lte`.
    expect(res.items.map((r) => r.numeroProcesso)).not.toContain('444/24.0T8FAR');
    // The narrowing is reported in full.
    expect(res.composition.collection).toBe('clients');
    expect(res.composition.where).toEqual({ field: 'idade', op: 'lt', value: 40 });
    expect(res.composition.join).toEqual({ resultField: 'clienteId', collectionField: 'id' });
    expect(res.composition.scanned).toBe(4);
    expect(res.composition.matched).toBe(2);
    expect(reads).toEqual(['clients']);

    // NOTHING WAS MINTED: the definition still carries exactly the action it was seeded with.
    const doc = await integrationDefinitionStore.getForActor({ userId: 'ownerA', orgId: 'orgA', role: 'user' }, PROBE_INTEGRATION);
    expect((doc?.actions ?? []).map((a) => a.actionName)).toEqual(['processos']);
  });

  it('the run record shows the planner\'s decision - the rungs considered and the one taken', async () => {
    await seed([processos]);
    const { planner } = plannerEmitting([composeBlock(CANONICAL_PLAN)]);
    const { seam } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));
    if (res.outcome !== 'composed') throw new Error(`expected composed, got ${res.outcome}`);
    const ladder = res.ladder as AchieveLadderStep[];
    expect(ladder.find((s) => s.rung === 'parametrize')?.verdict).toBe('skipped');
    expect(ladder.find((s) => s.rung === 'compose')?.verdict).toBe('taken');
    expect(ladder.find((s) => s.rung === 'compose')?.detail).toContain('2 of 4');

    // …and it is on the AUDIT TRAIL too: a second data source was read to narrow somebody's answer.
    const rows = await activityLogs.find({ type: 'capability_achieve_compose' });
    expect(rows).toHaveLength(1);
    const meta = (rows[0] as { metadata?: Record<string, unknown> }).metadata ?? {};
    expect(meta.collection).toBe('clients');
    expect(meta.field).toBe('idade');
    expect(meta.matched).toBe(2);
    // The goal text and the rows are NOT on the audit row.
    expect(JSON.stringify(meta)).not.toContain('menos de 40');
    expect(JSON.stringify(meta)).not.toContain('111/24.0T8LSB');
  });
});

// ---------------------------------------------------------------------------------------------
// 5. What COMPOSE refuses
// ---------------------------------------------------------------------------------------------

describe('compose refuses rather than guesses', () => {
  it('a composed WRITE is refused with its own code, and the action never runs', async () => {
    // `submeter_peca` is matched lexically by this goal, and the goal has residue, so the rung is
    // entered - which is what makes the refusal reachable rather than decorative.
    await seed([submeterPeca]);
    await approveAction({ orgId: 'orgA', userId: 'ownerA' }, describeAction(PROBE_INTEGRATION, submeterPeca), 'always');
    const { planner } = plannerEmitting([composeBlock({ ...CANONICAL_PLAN, collection: 'clients' })]);
    const { seam } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner, collections: seam });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'submeter peca para clientes com menos de 40 anos', { numero: '1', titulo: 't' }));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${JSON.stringify(res)}`);
    expect(res.code).toBe('composed_write_refused');
    expect(calls).toHaveLength(0);
  });

  it('an unknown collection is refused by name', async () => {
    await seed([processos]);
    const { planner } = plannerEmitting([composeBlock({ ...CANONICAL_PLAN, collection: 'clientes' })]);
    const { seam } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('compose_unknown_collection');
  });

  it('a collection the org holds in two places is AMBIGUOUS, not a coin flip', async () => {
    await seed([processos]);
    const { planner } = plannerEmitting([composeBlock(CANONICAL_PLAN)]);
    const { seam } = collectionsOf({ clients: 'ambiguous' });
    const { ctx } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('compose_ambiguous_collection');
    expect(res.candidates).toEqual(['app-a', 'app-b']);
  });

  it('an action result with no single list is refused rather than reshaped', async () => {
    await seed([processos]);
    const { planner } = plannerEmitting([composeBlock(CANONICAL_PLAN)]);
    const { seam } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS, arquivados: [] } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('compose_unshaped_result');
  });

  it('a malformed plan refuses with compose_refused, distinct from the write refusal', async () => {
    await seed([processos]);
    const { planner } = plannerEmitting([composeBlock({ compose: true, collection: 'clients' })]);
    const { seam } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('compose_refused');
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. DEGRADATION - every rung falls back to the one below it (the Rule-7 half)
// ---------------------------------------------------------------------------------------------

describe('an unwired, unavailable or inapplicable rung leaves achieve exactly as it was', () => {
  it('no seams at all: the matched read just runs, as it did before the ladder', async () => {
    await seed([processos]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { data: { processos: PROCESS_ROWS } });
    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${res.outcome}`);
    expect(calls).toHaveLength(1);
    expect(res.ladder?.find((s) => s.rung === 'compose')?.verdict).toBe('skipped');
    expect(res.ladder?.find((s) => s.rung === 'reuse')?.verdict).toBe('taken');
  });

  it('a model OUTAGE is not a refusal - the call proceeds with the caller\'s own arguments', async () => {
    await seed([consultarProcesso]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner: unavailablePlanner });
    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'consultar processo urgente do cliente novo'));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(res.ladder?.find((s) => s.rung === 'parametrize')?.detail).toContain('unavailable');
    expect(calls).toHaveLength(0); // an http action; the automation seam is untouched
  });

  it('a goal with no residue never pays for a compose turn', async () => {
    await seed([processos]);
    const { planner, turns } = plannerEmitting([composeBlock(CANONICAL_PLAN)]);
    const { seam } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'processos do mandatario'));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${res.outcome}`);
    expect(turns()).toBe(0);
  });

  it('a tenant with no collections never pays for a compose turn either', async () => {
    await seed([processos]);
    const { planner, turns } = plannerEmitting([composeBlock(CANONICAL_PLAN)]);
    const { seam } = collectionsOf({});
    const { ctx } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${res.outcome}`);
    expect(turns()).toBe(0);
  });

  it('a model that declines to compose leaves an ordinary executed answer', async () => {
    await seed([processos]);
    const { planner } = plannerEmitting([composeBlock({ compose: false })]);
    const { seam } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${res.outcome}`);
    expect(calls).toHaveLength(1);
    expect(res.ladder?.find((s) => s.rung === 'compose')?.verdict).toBe('skipped');
  });

  it('a PROVISIONAL match is still refused before any rung is entered', async () => {
    await seed([{ ...processos, authoring: { state: 'provisional', authoredBy: 'x', authoredAt: '2026-01-01T00:00:00.000Z', goal: 'g', declaredMutates: false, shape: 'stale', verification: { verifiedAt: '2026-01-01T00:00:00.000Z', passed: true, checks: [] } } }]);
    const { planner, turns } = plannerEmitting([composeBlock(CANONICAL_PLAN)]);
    const { seam } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner, collections: seam });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('provisional_match');
    expect(turns()).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 7. The static guards - the ladder cannot grow a second executor or a model-driven pick
// ---------------------------------------------------------------------------------------------

describe('static: the ladder routes through the ONE gated executor and never picks an action', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  /** CODE, not prose. Every one of these files DISCUSSES its guardrails at length, and a guard a
   *  comment can satisfy is not a guard. */
  const codeOnly = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const read = (...p: string[]) => codeOnly(readFileSync(join(here, '..', '..', 'src', ...p), 'utf-8'));
  const achieve = read('integrations', 'integration-achieve.ts');
  const parametrize = read('integrations', 'action-parametrize.ts');
  const compose = read('integrations', 'action-compose.ts');

  it('there is still exactly ONE call to the gated executor, however many rungs were added', () => {
    expect(achieve.split('executeIntegrationCapabilityAction(').length - 1).toBe(1);
    expect(achieve).not.toContain('executeUserIntegrationAction');
    expect(achieve).not.toContain('checkActionConsent');
  });

  it('neither rung module can execute or approve anything at all', () => {
    for (const src of [parametrize, compose]) {
      expect(src).not.toContain('executeIntegrationCapabilityAction');
      expect(src).not.toContain('executeUserIntegrationAction');
      expect(src).not.toContain('checkActionConsent');
      expect(src).not.toContain('approveAction');
    }
  });

  it('the model is never given the action list - the PICK stays lexical', () => {
    // `matchActionForGoal` is the one producer of a match, and neither rung's prompt builder is
    // handed `definition.actions`. A section that listed them would be the first step towards a
    // model choosing between them.
    // One DECLARATION plus exactly one CALL SITE. A second call site would be a second pick.
    expect(achieve.split('matchActionForGoal(').length - 1).toBe(2);
    expect(achieve.split('= matchActionForGoal(').length - 1).toBe(1);
    expect(parametrize).not.toContain('.actions');
    expect(compose).not.toContain('.actions');
  });

  it('the compose stage reaches no store of its own', () => {
    expect(compose).not.toContain('collections-engine.js\').CollectionsEngine');
    expect(compose).not.toContain('getDb');
    expect(compose).not.toContain('stores.js');
  });

  it('the product modules never import the authoring core directly (tier 3 -> tier 5 runs one way)', () => {
    for (const src of [achieve, parametrize, compose]) expect(src).not.toContain('agents/');
  });
});
