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
  COMPOSE_MAX_COLLECTION_ROWS,
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
 *   Decision D1 is ONE predicate, `mayBeModelFilled`, shared by the rung's pre-filter and the
 *   `targeting` check so the two cannot drift, and it is an ALLOWLIST: fillable iff the action
 *   cannot write, or the argument lands in the BODY. The allowlist is what reaches an
 *   automation-backed action, whose request this platform cannot read at all - every argument of
 *   one reads `unknown`, never `body`, so a write offers nothing.
 *
 *   COMPOSE - a trusted READ is run and its rows narrowed against ONE of the CALLER'S OWN
 *   collections with a `SimpleQuery`-class predicate. The model names the collection, the field,
 *   the comparison and the join; every row that moves is moved by TypeScript. Section 4 is the
 *   canonical case end to end, and section 5 is what compose refuses - starting with the fact that
 *   a WRITE never enters the rung, so nothing a model says can refuse a call that used to run.
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

/** In-memory collections seam. The REAL owner-scoped binding lives in `server.ts` and is exercised
 *  (and mutated) by `api/tests/security/achieve-compose-isolation.test.ts`; what this one supplies
 *  is the ROWS, so this suite is about the stage rather than about the scoping.
 *
 *  It answers ONLY the two variants the real binding can produce. An earlier version could also
 *  return `ambiguous_collection`, which the real binding never returns - the store has one scope
 *  per owner - so the test that asserted the ambiguity was asserting a value invented here. */
function collectionsOf(byName: Record<string, Record<string, unknown>[]>): {
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
        return rows === undefined ? { kind: 'unknown_collection' } : { kind: 'rows', rows };
      },
    },
  };
}

interface CtxOpts {
  planner?: PlanDrafter;
  collections?: AppCollections;
  /** What the automation seam answers - this is how a matched action produces rows. */
  data?: unknown;
  /** A FAILED execute, in the shape the executor really returns one (`action-executor.ts`: a
   *  non-2xx is `success: false` + `status` + `code` + `error`, and NO `data`). */
  failure?: { status?: number; code?: string; error: string };
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
      if (opts.failure) return { success: false, ...opts.failure } as never;
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

/**
 * AN AUTOMATION-BACKED WRITE - the fixture D1 used to have no answer for.
 *
 * It declares arguments and has NO `httpConfig`, so this platform cannot see where any of them
 * lands. Under the old blocklist ("fill anything that is not `targeting`") every argument read
 * `unused` and a model was free to choose which processo an `arquivar` acted on. There is no
 * `mutates: false` here and there is no request to inspect: the only safe answer is to offer
 * nothing.
 */
const arquivarProcesso: IntegrationAction = {
  actionName: 'arquivar_processo',
  description: 'Arquiva um processo',
  mutates: true,
  automationBinding: { automationId: 'citius-1', automationTemplate: 'arquivar' },
  argsSchema: { type: 'object', properties: { numero: { type: 'string' }, motivo: { type: 'string' } } },
};

/**
 * A READ ON A BARE-TEMPLATED BASE URL - the `unbound` egress class named in `credential-cofre.ts`.
 * `originFromBaseUrl` cannot parse a host out of `{{api_base}}`, so the definition declares no
 * literal origin, `resolveCredentialEgressBinding` answers `unbound`, and the render probe has no
 * pre-image to check a filled argument against.
 */
const consultarRegional: IntegrationAction = {
  actionName: 'consultar_regional',
  description: 'Consulta regional',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: '{{api_base}}', path: '/processos/{{numero}}' },
  argsSchema: { type: 'object', properties: { numero: { type: 'string' } } },
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

  it('…and that refusal is WHY the merge order in the rung is unobservable: the two are disjoint', () => {
    // `runMatchedAction` spreads `callerArgs` last over `verdict.args`. That order can never matter,
    // because a passing verdict's args share no key with what the caller sent - which is the fact
    // worth pinning. (Reversing the spread is an equivalent mutant; this is the assertion that
    // makes it one, rather than a test pretending to catch it.)
    const v = verdictOn(submeterPeca, { args: { titulo: 'model' } }, { numero: 'human' });
    expect(v.passed).toBe(true);
    expect(v.args).not.toBeNull();
    const shared = Object.keys(v.args ?? {}).filter((k) => k === 'numero');
    expect(shared).toEqual([]);
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

  it('D1: TARGETING WINS when one name lands in BOTH the path and the body', () => {
    // A SURVIVING MUTANT until this existed (`slots[n] === undefined` -> unconditional `body` left
    // every suite green). The body occurrence must not LAUNDER the path occurrence: a template that
    // happens to echo `{{numero}}` into its body does not stop `{{numero}}` selecting which
    // processo is written to, and the consent dialog still only ever showed `{{numero}}`.
    const both: IntegrationAction = {
      ...submeterPeca,
      httpConfig: {
        method: 'POST',
        baseUrl: HOST,
        path: '/processos/{{numero}}/pecas',
        bodyTemplate: { titulo: '{{titulo}}', referencia: '{{numero}}' },
      },
    };
    expect(argSlotsOf(both.httpConfig).numero).toBe('targeting');
    const v = verdictOn(both, { args: { numero: '999/24.0T8LSB' } });
    expect(v.passed).toBe(false);
    expect(failed(v, 'targeting')).toBe(true);
    // …and the argument that really is body-only is still fillable on the same action.
    expect(verdictOn(both, { args: { titulo: 'Contestação' } }).passed).toBe(true);
  });

  it('a header argument counts as targeting (the consent dialog never showed it either)', () => {
    const hdr: IntegrationAction = {
      ...submeterPeca,
      httpConfig: { ...submeterPeca.httpConfig!, path: '/pecas', headers: { 'x-account': '{{numero}}' } },
    };
    expect(argSlotsOf(hdr.httpConfig).numero).toBe('targeting');
  });

  it('a QUERY argument counts as targeting too - D1 names path AND query, and only one had a case', () => {
    // A SURVIVING MUTANT until this existed: deleting `queryParams` from the targeting set left the
    // whole estate green. The path slot has several fixtures and the header slot has the test above;
    // the QUERY slot - which D1's own text names first, beside the path - had none where the slot
    // was observable, because the only fixture carrying a query template is a READ (`mutates:
    // false`), and on a read `mayBeModelFilled` answers true whatever the slot says.
    //
    // It is not a live escape today - the allowlist refuses `unused` on a write as firmly as it
    // refuses `targeting` - but it is D1's stated rule going unasserted, and it is what the prompt's
    // own slot table tells a model about where its value will land.
    const q: IntegrationAction = {
      ...submeterPeca,
      httpConfig: { ...submeterPeca.httpConfig!, path: '/pecas', queryParams: { processo: '{{numero}}' } },
    };
    expect(argSlotsOf(q.httpConfig).numero).toBe('targeting');
    const v = verdictOn(q, { args: { numero: '999/24.0T8LSB' } });
    expect(v.passed).toBe(false);
    expect(failed(v, 'targeting')).toBe(true);
    // …and it is refused as an argument this platform WATCHED land in the URL, not as one whose
    // destination it could not see - the two messages exist because the two causes differ.
    expect(v.checks.find((c) => c.name === 'targeting')?.detail).toContain('do not land in the request body');
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

  it('D1 REACHES an automation-backed WRITE: no argument is offered, and a model picks nothing', async () => {
    // THE HOLE THIS PINS. `arquivar_processo` writes and has no request this module can read, so
    // every argument used to classify `unused` - "goes nowhere" - and sail past a rule that only
    // refused `targeting`. A model then chose which processo got archived.
    await seed([arquivarProcesso]);
    await approveAction({ orgId: 'orgA', userId: 'ownerA' }, describeAction(PROBE_INTEGRATION, arquivarProcesso), 'always');
    const { planner, turns } = plannerEmitting([argsBlock({ numero: 'model-picked', motivo: 'model-picked' })]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar processo antigo do cliente'));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    // The model was never asked, and the request carries NOTHING it chose.
    expect(turns()).toBe(0);
    expect(res.filledArgs).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual({});
    expect(res.ladder?.find((s) => s.rung === 'parametrize')?.detail).toContain('numero');
  });

  it('D1 BACKSTOP: the suite refuses those same arguments even when handed them directly', async () => {
    // The pre-filter and the suite are one predicate (`mayBeModelFilled`); this asserts the suite
    // half on its own, so a caller that forgot to filter is still refused rather than obeyed.
    const v = verifyPlannedArgs({
      action: arquivarProcesso,
      definition: { configSchema: [] },
      planned: { args: { numero: 'model-picked' } },
      callerArgs: {},
      allowedOrigins: [],
    });
    expect(v.passed).toBe(false);
    expect(v.args).toBeNull();
    const targeting = v.checks.find((c) => c.name === 'targeting');
    expect(targeting?.ok).toBe(false);
    expect(targeting?.detail).toContain('unknown');
  });

  /**
   * THE RUNG SUBTRACTED AN ANSWER, and this is the test that stops it.
   *
   * The rung used to `return refused('parametrize_refused')` when its suite rejected the model's
   * plan - so an `achieve` that EXECUTED before this slice (the caller's own arguments, an action a
   * human trusted, a standing approval behind any write) stopped executing because a model wrote a
   * bad argument. A ladder may add cheaper ways to answer; it may never take away an answer the
   * product already gave.
   *
   * The fixture is the AUTOMATION-BACKED read on purpose: its execution lands on the seam in this
   * file, so "the call still ran" and "not one model-chosen value reached the request" are both
   * observable here without a network.
   */
  it('a plan that breaks the guardrails is DISCARDED - the call still runs, on the caller\'s own arguments', async () => {
    await seed([{ ...processos, argsSchema: { type: 'object', properties: { tribunal: {} } } }]);
    // `extra` is not declared by the action, so `declared_args` rejects the whole plan.
    const { planner } = plannerEmitting([argsBlock({ tribunal: 'Coimbra', extra: 'x' })]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'processos do tribunal indicado'));

    // IT RAN. Before the fix this was `refused` / `parametrize_refused` and nothing was sent.
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(calls).toHaveLength(1);
    // …and NOT ONE value the model proposed reached the request: the whole plan was thrown away,
    // including the argument that would have passed on its own.
    expect(calls[0]?.args).toEqual({});
    expect(res.filledArgs).toBeUndefined();
    // The verdict travels BESIDE the answer instead of replacing it, and says why.
    const step = res.ladder?.find((s) => s.rung === 'parametrize');
    expect(step?.verdict).toBe('refused');
    expect(step?.violations?.join(' ')).toContain('extra');
    expect(res.ladder?.find((s) => s.rung === 'reuse')?.verdict).toBe('taken');
  });

  // The same rule on a WRITE a human has standing-approved - where cancelling the call is worst -
  // needs a real request to be observable, so it lives in the contract suite, where the transport
  // is the mocked edge: `api/tests/contract/integrations-reuse-ladder.test.ts`, "a discarded plan
  // does not cancel an APPROVED write".

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

  /**
   * EACH SIDE'S NULL GUARD IS ASSERTED ON ITS OWN, and the fixtures are built so that it has to be.
   *
   * An earlier single case gave EVERY collection row an absent-or-null key, which emptied the key
   * set outright - so `items` was `[]` whatever the ACTION side did, and deleting the action-side
   * guard changed nothing. The absent key has to collide with a REAL one to be load-bearing, and
   * the collision is exact: `String(undefined)` is `'undefined'` and `String(null)` is `'null'`,
   * so a collection row genuinely keyed on those strings is what an unguarded absent key joins to.
   */
  it('an ABSENT key on the ACTION side matches nothing - not even a row keyed "null"/"undefined"', () => {
    const out = composeRows({
      plan: CANONICAL_PLAN as never,
      actionRows: [{ numeroProcesso: 'x' }, { numeroProcesso: 'y', clienteId: null }],
      // Real, present keys - the set is NOT empty, so only the action-side guard can exclude these.
      collectionRows: [{ id: 'undefined', idade: 20 }, { id: 'null', idade: 20 }],
    });
    expect(out.summary.matchedCollectionRows).toBe(2);
    expect(out.items).toEqual([]);
  });

  it('an ABSENT key on the COLLECTION side keys nothing - not even a row keyed "null"/"undefined"', () => {
    const out = composeRows({
      plan: CANONICAL_PLAN as never,
      // Real, present keys on the action side, spelled as the strings an unguarded null becomes.
      actionRows: [{ numeroProcesso: 'x', clienteId: 'undefined' }, { numeroProcesso: 'y', clienteId: 'null' }],
      collectionRows: [{ idade: 20 }, { id: null, idade: 20 }],
    });
    expect(out.summary.matchedCollectionRows).toBe(2);
    expect(out.items).toEqual([]);
  });

  it('keys are compared as strings, so a numeric id from EITHER side still joins', () => {
    // A number on the ACTION side against a string in the collection.
    const numericAction = composeRows({
      plan: CANONICAL_PLAN as never,
      actionRows: [{ numeroProcesso: 'p', clienteId: 7 }],
      collectionRows: [{ id: '7', idade: 20 }],
    });
    expect(numericAction.items).toHaveLength(1);

    // …AND THE MIRROR IMAGE, which is the half that was missing. With only the case above, the
    // collection side's own `String(k)` was a SURVIVING MUTANT: its key was already a string, so
    // dropping the coercion changed nothing. This is the direction that catches it - a Mongo row
    // whose id really is a number, joined against an API that returns ids as strings.
    const numericCollection = composeRows({
      plan: CANONICAL_PLAN as never,
      actionRows: [{ numeroProcesso: 'p', clienteId: '7' }],
      collectionRows: [{ id: 7, idade: 20 }],
    });
    expect(numericCollection.items).toHaveLength(1);
  });

  it('caps what it emits and says so', () => {
    // A PIN, IN A LITERAL, and it was a SURVIVING MUTANT until this line existed: every assertion
    // below is written in terms of the constant, so `COMPOSE_MAX_ITEMS` could be moved to any value
    // at all and the whole estate stayed green. That is precisely the defect round three closed for
    // `COMPOSE_MAX_COLLECTION_ROWS` two tests down, on the SIBLING constant, and did not close here.
    // A cap is a promise about how much of an answer a caller silently does not receive, so moving
    // it is a decision somebody takes in this file rather than a number that drifts.
    expect(COMPOSE_MAX_ITEMS).toBe(200);

    const many = Array.from({ length: COMPOSE_MAX_ITEMS + 5 }, (_, i) => ({ numeroProcesso: `p${i}`, clienteId: 'c1' }));
    const out = composeRows({ plan: CANONICAL_PLAN as never, actionRows: many, collectionRows: CLIENT_ROWS });
    expect(out.items).toHaveLength(COMPOSE_MAX_ITEMS);
    expect(out.summary.matched).toBe(COMPOSE_MAX_ITEMS + 5);
    expect(out.summary.truncated).toBe(true);
    // The OTHER cap did not fire: four collection rows is four collection rows.
    expect(out.summary.collectionScanned).toBe(4);
    expect(out.summary.collectionTruncated).toBe(false);
  });

  /**
   * THE COLLECTION CAP IS A CAP ON THE QUESTION, not on the answer, and until this pair existed it
   * was neither pinned nor visible: deleting `COMPOSE_MAX_COLLECTION_ROWS` left the whole suite
   * green, and a join built from a PREFIX of the collection returned a subset presented as the
   * whole - a silent wrong answer, with nothing on the wire to say so.
   *
   * The two cases differ by ONE ROW and are written as a pair on purpose. The boundary row is the
   * only row keyed to the action row under test, so the cap - not the predicate, not the join - is
   * the only thing that can decide the outcome, in either direction.
   */
  const capRows = (n: number): Record<string, unknown>[] =>
    // Every row satisfies the predicate; only the LAST one keys to the action row below.
    Array.from({ length: n }, (_, i) => ({ id: i === n - 1 ? 'target' : `filler${i}`, idade: 20 }));
  const capAction = [{ numeroProcesso: 'p-target', clienteId: 'target' }];

  it('the collection cap is exactly COMPOSE_MAX_COLLECTION_ROWS, and the last row inside it counts', () => {
    // A PIN, in a literal. The cap is a promise about how big an answer can quietly be wrong, so
    // changing it is a decision somebody takes here rather than a number that drifts.
    expect(COMPOSE_MAX_COLLECTION_ROWS).toBe(5_000);

    const out = composeRows({
      plan: CANONICAL_PLAN as never,
      actionRows: capAction,
      collectionRows: capRows(COMPOSE_MAX_COLLECTION_ROWS),
    });
    expect(out.items.map((r) => r.numeroProcesso)).toEqual(['p-target']);
    expect(out.summary.collectionScanned).toBe(COMPOSE_MAX_COLLECTION_ROWS);
    expect(out.summary.collectionTruncated).toBe(false);
  });

  it('one row PAST the cap is not considered, and the answer SAYS it was narrowed against a prefix', () => {
    const out = composeRows({
      plan: CANONICAL_PLAN as never,
      actionRows: capAction,
      collectionRows: capRows(COMPOSE_MAX_COLLECTION_ROWS + 1),
    });
    // The row that would have kept `p-target` sits at index 5000 and was never read.
    expect(out.items).toEqual([]);
    expect(out.summary.collectionScanned).toBe(COMPOSE_MAX_COLLECTION_ROWS);
    // THE WIRE SIGNAL. Without it the caller reads `[]` as "no client under 40 has a process",
    // which is a different and untrue statement about their own data.
    expect(out.summary.collectionTruncated).toBe(true);
    expect(out.summary.matchedCollectionRows).toBe(COMPOSE_MAX_COLLECTION_ROWS);
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
      planned: { ...CANONICAL_PLAN, where: { field: 'idade', op: 'regex', value: '^4' } },
    });
    expect(v.passed).toBe(false);
    expect(v.checks.some((c) => c.name === 'predicate' && !c.ok)).toBe(true);
  });

  it('verifyComposePlan refuses a reserved or malformed collection name', () => {
    for (const bad of ['usr.someone', '__system', 'has spaces', '']) {
      const v = verifyComposePlan({ planned: { ...CANONICAL_PLAN, collection: bad } });
      expect(v.passed).toBe(false);
    }
  });

  it('nothing below `shape` is judged on a malformed plan - the suite does not guess at a repair', () => {
    // A SURVIVING MUTANT until this existed: deleting the shape check for a MISSING `collection`
    // changed no verdict, because `collection_name` refuses `undefined` too. Both statements are
    // real, only one can fire, and what distinguishes them is the CHECK LIST - which is the rule
    // itself (`verifyPlannedArgs` is asserted the same way, in section 1): a suite that keeps
    // judging a plan it has already found malformed is a suite inventing the artifact it judges.
    const noCollection = verifyComposePlan({ planned: { compose: true, where: CANONICAL_PLAN.where, join: CANONICAL_PLAN.join } });
    expect(noCollection.passed).toBe(false);
    expect(noCollection.checks.map((c) => c.name)).toEqual(['shape']);
    expect(noCollection.plan).toBeNull();
    // A WELL-FORMED plan is judged all the way down, so the assertion above is about the
    // short-circuit rather than about this suite only ever running one check.
    expect(verifyComposePlan({ planned: CANONICAL_PLAN }).checks.map((c) => c.name))
      .toEqual(['shape', 'collection_name', 'predicate']);
  });

  it('`{ "compose": false }` is a well-formed answer that yields no plan', () => {
    const v = verifyComposePlan({ planned: { compose: false } });
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
    // The join saw the WHOLE collection, and says so - the caller is owed that either way.
    expect(res.composition.collectionScanned).toBe(4);
    expect(res.composition.collectionTruncated).toBe(false);
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

  it('a TRUNCATED join says so on the answer, on the ladder and on the audit row', async () => {
    // The same canonical call over a collection larger than the cap. The client that keys the one
    // surviving process sits PAST the cap, so the honest answer is "here is what I found, and I
    // only looked at the first 5000 rows" - never a silent `[]`.
    await seed([processos]);
    const { planner } = plannerEmitting([composeBlock(CANONICAL_PLAN)]);
    const overCap = [
      ...Array.from({ length: COMPOSE_MAX_COLLECTION_ROWS }, (_, i) => ({ id: `filler${i}`, idade: 20 })),
      { id: 'c1', idade: 31 },
    ];
    const { seam } = collectionsOf({ clients: overCap });
    const { ctx } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));
    if (res.outcome !== 'composed') throw new Error(`expected composed, got ${JSON.stringify(res)}`);
    // `c1`'s process is missing because the cap hid `c1`, and the answer does not pretend otherwise.
    expect(res.items).toEqual([]);
    expect(res.composition.collectionTruncated).toBe(true);
    expect(res.composition.collectionScanned).toBe(COMPOSE_MAX_COLLECTION_ROWS);
    expect(res.ladder?.find((s) => s.rung === 'compose')?.detail).toContain('first 5000 rows');

    const rows = await activityLogs.find({ type: 'capability_achieve_compose' });
    expect((rows[0] as { metadata?: Record<string, unknown> }).metadata?.collectionTruncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. What COMPOSE does INSTEAD of refusing
// ---------------------------------------------------------------------------------------------

/**
 * THE LADDER MAY ONLY ADD AN ANSWER, AND THE COMPOSE RUNG IS WHERE THAT WAS STILL FALSE.
 *
 * Three paths ended in `outcome: 'refused'`, and TWO OF THEM DID SO AFTER THE REMOTE CALL HAD
 * ALREADY BEEN MADE AND HAD SUCCEEDED: the product performed the caller's work, got a good answer
 * back, and then discarded it because a later stage could not run. Spending the side effect and
 * throwing away the result is worse than refusing up front. The third (`compose_refused`) did not
 * spend the side effect, but it ended a call that executed before this slice existed.
 *
 * All three now return the EXECUTED arm's answer unchanged, with the `compose` step on the ladder
 * saying the composition did not apply and why. The load-bearing assertion in each case is not the
 * outcome word - it is that THE ROWS THE PRODUCT HAD IN HAND REACHED THE CALLER.
 */
describe('the compose rung stands down; it never takes an answer away', () => {
  it('a WRITE never ENTERS the compose rung: it executes as it always did, and no model is asked', async () => {
    // THE REGRESSION THIS PINS. `submeter_peca` is matched lexically by this goal and the goal has
    // residue, so the old shape asked a model for a plan and then refused the whole call when one
    // came back - turning a call that ran under a standing human approval into something that
    // depended on a model's judgement to run at all. The rung must only ever ADD an answer.
    // An automation-backed write, so the execution is real and observable here without a network:
    // it lands on the automation seam. The caller supplies every declared argument, so PARAMETRIZE
    // skips for a reason of its own and this test is about COMPOSE alone.
    await seed([arquivarProcesso]);
    await approveAction({ orgId: 'orgA', userId: 'ownerA' }, describeAction(PROBE_INTEGRATION, arquivarProcesso), 'always');
    const { planner, turns } = plannerEmitting([composeBlock({ ...CANONICAL_PLAN, collection: 'clients' })]);
    const { seam, reads } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner, collections: seam });

    // The goal HAS residue (`clientes`, `menos`, `40`, `anos`), which is what used to enter the rung.
    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar processo de clientes com menos de 40 anos', { numero: '1', motivo: 'x' }));
    // It RAN - the approved write went out exactly as the caller shaped it.
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toMatchObject({ numero: '1', motivo: 'x' });
    // …and the rung cost nothing on the way past: no planning turn, no collection read.
    expect(turns()).toBe(0);
    expect(reads).toHaveLength(0);
    expect(res.ladder?.find((s) => s.rung === 'compose')).toMatchObject({ verdict: 'skipped' });
    expect(res.ladder?.find((s) => s.rung === 'compose')?.detail).toContain('can change data');
  });

  it('an UNKNOWN COLLECTION does not discard the answer the remote already gave', async () => {
    await seed([processos]);
    const { planner } = plannerEmitting([composeBlock({ ...CANONICAL_PLAN, collection: 'clientes' })]);
    const { seam } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));

    // Before the fix: `refused` / `compose_unknown_collection` - decided AFTER the line below had
    // already run and answered 200, so the rows were fetched and then thrown away.
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(calls).toHaveLength(1);
    // THE LOAD-BEARING ASSERTION: what the action returned reached the caller, whole.
    expect(res.result.success).toBe(true);
    expect(res.result.data).toEqual({ processos: PROCESS_ROWS });
    // Nothing was narrowed, so nothing claims to have been.
    expect((res as { items?: unknown }).items).toBeUndefined();
    expect((res as { composition?: unknown }).composition).toBeUndefined();
    const step = res.ladder?.find((s) => s.rung === 'compose');
    expect(step?.verdict).toBe('refused');
    expect(step?.detail).toContain('clientes');
    expect(res.ladder?.find((s) => s.rung === 'reuse')?.verdict).toBe('taken');
    // No join happened, so no audit row claims one did.
    expect(await activityLogs.find({ type: 'capability_achieve_compose' })).toHaveLength(0);
  });

  it('an UNSHAPED result is neither reshaped NOR substituted for the result itself', async () => {
    await seed([processos]);
    const { planner } = plannerEmitting([composeBlock(CANONICAL_PLAN)]);
    const { seam } = collectionsOf({ clients: CLIENT_ROWS });
    const two = { processos: PROCESS_ROWS, arquivados: [] };
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: two });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));

    // Before the fix: `refused` / `compose_unshaped_result`, again after a successful execute.
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(calls).toHaveLength(1);
    // THE LOAD-BEARING ASSERTION: BOTH lists reached the caller. This rung would not guess which
    // one the goal meant, and "I will not guess" is not a reason to hand back neither.
    expect(res.result.data).toEqual(two);
    expect((res as { items?: unknown }).items).toBeUndefined();
    const step = res.ladder?.find((s) => s.rung === 'compose');
    expect(step?.verdict).toBe('refused');
    expect(step?.detail).toContain('several lists');
    expect(await activityLogs.find({ type: 'capability_achieve_compose' })).toHaveLength(0);
  });

  /**
   * THE COMPOSITION IS A POST-STAGE, NOT AN ERROR BOUNDARY.
   *
   * A failed execute is an ANSWER ABOUT THE REMOTE SYSTEM, and `POST …/execute` has always returned
   * it whole. The compose wrapper LOST it: with no `data`, `rowsOf` read `unshaped` and the caller
   * was told "the action returned no list to compose over" - a different, less accurate story than
   * the same call gave before this rung existed, and one that blames the wrong system.
   */
  it('an upstream FAILURE passes through verbatim - the compose wrapper is not an error boundary', async () => {
    await seed([processos]);
    const { planner } = plannerEmitting([composeBlock(CANONICAL_PLAN)]);
    const { seam, reads } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx } = ctxWith('ownerA', 'orgA', {
      planner,
      collections: seam,
      failure: { status: 500, code: 'server_error', error: 'Citius respondeu 500: manutencao programada' },
    });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));

    // Before the fix this was `refused` / `compose_unshaped_result` and the 500 was gone.
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(res.result.success).toBe(false);
    expect(res.result.status).toBe(500);
    expect(res.result.code).toBe('server_error');
    expect(res.result.error).toContain('manutencao programada');
    // …and the rung says why it stood down, instead of claiming the action answered badly.
    const step = res.ladder?.find((s) => s.rung === 'compose');
    expect(step?.verdict).toBe('skipped');
    expect(step?.detail).toContain('did not succeed');
    // The ladder still names the rung that ANSWERED - the same step a plain execute records.
    expect(res.ladder?.find((s) => s.rung === 'reuse')?.verdict).toBe('taken');
    // Nobody's collection was read to decorate a failure.
    expect(reads).toHaveLength(0);
    const audits = await activityLogs.find({ type: 'capability_achieve_compose' });
    expect(audits).toHaveLength(0);
  });

  it('a plan the GUARDRAILS reject is discarded, and the read the caller asked for still runs', async () => {
    await seed([processos]);
    // No `where` and no `join`: `verifyComposePlan`'s shape check rejects the whole plan.
    const { planner } = plannerEmitting([composeBlock({ compose: true, collection: 'clients' })]);
    const { seam, reads } = collectionsOf({ clients: CLIENT_ROWS });
    const { ctx, calls } = ctxWith('ownerA', 'orgA', { planner, collections: seam, data: { processos: PROCESS_ROWS } });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, CANONICAL_GOAL));

    // Before the fix this was `refused` / `compose_refused` and `calls` was EMPTY: an `achieve` on
    // a trusted READ that had been executing since long before this slice stopped executing
    // because a model wrote a malformed join.
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(calls).toHaveLength(1);
    expect(res.result.data).toEqual({ processos: PROCESS_ROWS });
    // Not one thing the model named survived the discard: no collection was ever read.
    expect(reads).toHaveLength(0);
    const step = res.ladder?.find((s) => s.rung === 'compose');
    expect(step?.verdict).toBe('refused');
    // BOTH shape violations are reported, so a suite that stopped checking either one reds here.
    expect(step?.violations?.join(' ')).toContain('"where" is missing');
    expect(step?.violations?.join(' ')).toContain('"join" is missing');
    expect(res.ladder?.find((s) => s.rung === 'reuse')?.verdict).toBe('taken');
  });

  /**
   * THE COUNT IS THE INVARIANT. Three previous rounds asserted "a rung may only ADD an answer" in
   * prose while the code carried three refusal codes that subtracted one. A sentence cannot be
   * mutated; a union member can, so this asserts the union.
   *
   * `AchieveRefusalCode` is a TYPE, so the assertion is on the SOURCE - the same technique the
   * static-guard section below uses, and for the same reason: a refusal code that exists is a
   * refusal code somebody will reach for.
   */
  it('the ladder introduces NO refusal code: none of the three that subtracted an answer exists', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'integrations', 'integration-achieve.ts'), 'utf-8');
    const union = src.slice(src.indexOf('export type AchieveRefusalCode ='));
    const members = (union.slice(0, union.indexOf(';')).match(/'[a-z_]+'/g) ?? []).map((m) => m.replace(/'/g, ''));
    // Exactly the thirteen AUTHOR-arm codes that pre-date the ladder, and nothing else.
    expect(members).toEqual([
      'ambiguous_goal', 'provisional_match', 'not_custodian', 'published_row', 'baseline_package',
      'not_writable', 'origin_refused', 'origin_unbound', 'authoring_unavailable', 'billing_blocked',
      'authoring_failed', 'verification_failed', 'persist_failed',
    ]);
    // …and nothing in the module can construct one of the removed codes either.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    for (const gone of ['compose_refused', 'compose_unknown_collection', 'compose_unshaped_result', 'parametrize_refused', 'composed_write_refused']) {
      expect(code, `${gone} is still reachable`).not.toContain(gone);
    }
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

  it('an UNBOUND credential skips the parametrize rung outright, and pays for no turn', async () => {
    // The render probe needs a pre-image and this credential has none, so the rung stands down
    // BEFORE the model is asked rather than after. Asserting `turns()` is what makes the guard real:
    // remove the binding check and the plan is still discarded (an empty allow-list fails closed in
    // `assertOriginAllowed`), but the caller has paid for a model call to learn nothing.
    await seed([consultarRegional]);
    const { planner, turns } = plannerEmitting([argsBlock({ numero: '111/24.0T8LSB' })]);
    const { ctx } = ctxWith('ownerA', 'orgA', { planner });

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'consultar regional do cliente'));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${JSON.stringify(res)}`);
    expect(turns()).toBe(0);
    const step = res.ladder?.find((s) => s.rung === 'parametrize');
    expect(step?.verdict).toBe('skipped');
    expect(step?.detail).toContain('unbound');
    // Nothing reached a network: the executor refuses an unbound origin before it fetches.
    expect(res.result.success).toBe(false);
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

  it('the compose stage reaches no store of its own - one NAME from the engine, never the engine', () => {
    // THE OLD FORM OF THIS GUARD COULD NOT FAIL. It searched for the literal
    // `collections-engine.js').CollectionsEngine` - a CommonJS `require(...)` shape that an ESM file
    // cannot produce - while the hazard it exists to catch, `import { CollectionsEngine } from
    // '../data/collections-engine.js'`, sailed through it. A SURVIVING MUTANT proved exactly that:
    // adding that import to the module left all four slice suites green.
    //
    // So the guard now reads the IMPORT LIST. `action-compose.ts` legitimately imports one thing
    // from the store module - `collectionName`, the name validator, so the plan is judged by the
    // store's own rule rather than by a second one written in the rung - and nothing else.
    const imported = [...compose.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)]
      .filter(([, , from]) => (from as string).includes('collections-engine'))
      .flatMap(([, names]) => (names as string).split(',').map((n) => n.trim().replace(/^type\s+/, '')).filter(Boolean));
    expect(imported).toEqual(['collectionName']);
    expect(compose).not.toContain('getDb');
    expect(compose).not.toContain('stores.js');
    // …and no reach around the import list either.
    expect(compose).not.toContain('require(');
    expect(compose).not.toContain('await import(');
  });

  it('the product modules never import the authoring core directly (tier 3 -> tier 5 runs one way)', () => {
    for (const src of [achieve, parametrize, compose]) expect(src).not.toContain('agents/');
  });

  it('the collection reader cannot carry a fact about anybody else: not-found has NO payload', () => {
    // WHY THIS IS A SOURCE ASSERTION AND NOT A BEHAVIOURAL ONE, stated so the isolation suite's
    // equality check is not read as more than it is. `achieve-compose-isolation.test.ts` test 2
    // compares the WHOLE response body for a collection name another org holds against the body for
    // a name nobody holds anywhere, and they are equal - but no mutation of this module can break
    // that equality, because `applyComposition` cannot reach another tenant's scope and therefore
    // has no fact about one to leak. That test is a regression guard against a future that CAN.
    //
    // What IS mutation-killable is the SHAPE that makes the oracle impossible: the reader's
    // not-found answer is a bare tag. A `candidates`, a count of other holders, a "did you mean" -
    // each would be a place for such a fact to travel, and each reds this.
    // Up to the terminating `;` - the one followed by a newline, not the one inside a member.
    const union = (compose.match(/export type AppCollectionRead =[\s\S]*?;[ \t]*\n/) ?? [''])[0].replace(/\s+/g, ' ');
    expect(union).toContain("| { kind: 'rows'; rows: Record<string, unknown>[] }");
    expect(union).toContain("| { kind: 'unknown_collection' }");
    // EXACTLY two members - a third would be a third thing the caller could be told.
    expect(union.match(/kind: '/g) ?? []).toHaveLength(2);
  });
});
