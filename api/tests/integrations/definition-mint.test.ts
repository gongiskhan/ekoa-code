import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions } from '../../src/data/stores.js';
import { refreshDefinitions, type IntegrationPackageConfig } from '../../src/integrations/definitions.js';
import {
  IntegrationDefinitionStore,
  definitionIdFor,
} from '../../src/integrations/definition-store.js';
import {
  siteIntegrationKeyForOrigin,
  primaryOriginOfSteps,
  mintedActionNameForGoal,
  mutatesFloor,
  mintSiteIntegrationForAutomation,
  type MintStep,
} from '../../src/integrations/definition-mint.js';
import { matchActionForGoal } from '../../src/integrations/integration-achieve.js';
import type { Step } from '../../src/automation/types.js';

/**
 * MINT-ON-PLAN (D-CORNERSTONE-MINT-SHAPE). The mint is the automation->integration auto-create
 * the cornerstone rests on, so this suite pins its four load-bearing properties:
 *   1. the per-site key is STABLE (same site -> same integration, forever) and never a reserved key;
 *   2. the minted action's name is what the creating goal tokenises to, so `matchActionForGoal`
 *      finds it again (the reuse ladder's exact-naming arm);
 *   3. `mutates` fails CLOSED - floor first, one model confirmation, any doubt = true;
 *   4. the write lands as the acting user's own PRIVATE tenant row through the ONE gated store
 *      path, isolated per org (Rule 5).
 */
let mem: MongoMemoryServer;
let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

const userA: Actor = { userId: 'userA', orgId: 'orgA', role: 'user' };
const userB: Actor = { userId: 'userB', orgId: 'orgB', role: 'user' };

let clock = 0;
const store = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));

const pkg = (key: string): IntegrationPackageConfig => ({
  integrationKey: key,
  displayName: `${key} display`,
  description: 'd',
  authType: 'api_key',
  provider: 'X',
  category: 'test',
  configSchema: [],
  actions: [{ actionName: 'ping', description: 'd', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://api.x.example', path: '/ping' } }],
  credentialGuide: '1. x',
});

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-defmint-'));
  const baselineDir = join(tmp, 'baseline');
  mkdirSync(join(baselineDir, 'demo-base'), { recursive: true });
  writeFileSync(join(baselineDir, 'demo-base', 'config.json'), JSON.stringify(pkg('demo-base')));
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  savedEnv.EKOA_DATA_DIR = process.env.EKOA_DATA_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = baselineDir;
  process.env.EKOA_DATA_DIR = join(tmp, 'data');
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_defmint');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  process.env.EKOA_INTEGRATIONS_DIR = savedEnv.EKOA_INTEGRATIONS_DIR;
  process.env.EKOA_DATA_DIR = savedEnv.EKOA_DATA_DIR;
  refreshDefinitions();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  clock = 0;
  await integrationDefinitions.deleteMany({});
});

// ---------------------------------------------------------------------------
// Type pin: MintStep stays a structural SUBSET of the engine Step (the tier-direction restatement).
// A field rename in automation/types.ts fails THIS FILE's compile, not a runtime mystery.
// ---------------------------------------------------------------------------
const _stepPin: MintStep = undefined as unknown as Step;
void _stepPin;

const nav = (url: string): MintStep => ({ type: 'navigate', description: `abre ${url}`, url });
const browser = (d: string): MintStep => ({ type: 'browser', description: d });

describe('siteIntegrationKeyForOrigin - stable per-site keys', () => {
  it('derives a slug from the host, www-stripped, case-folded', () => {
    expect(siteIntegrationKeyForOrigin('https://www.Portal.Example.com')).toBe('portal-example-com');
    expect(siteIntegrationKeyForOrigin('https://portal.example.com')).toBe('portal-example-com');
  });
  it('keeps the port (a different port is a different deployment, not the same site)', () => {
    expect(siteIntegrationKeyForOrigin('https://example.com:8443')).toBe('example-com-8443');
  });
  it('answers null for garbage rather than inventing a mergeable key', () => {
    expect(siteIntegrationKeyForOrigin('not a url')).toBeNull();
    expect(siteIntegrationKeyForOrigin('')).toBeNull();
  });
  it('suffixes a host that collides with a reserved integration key', () => {
    // 'demo-base' is a baseline package key (fixture above); a site named demo-base must not shadow it.
    expect(siteIntegrationKeyForOrigin('https://demo-base')).toBe('demo-base-site');
    expect(siteIntegrationKeyForOrigin('https://pipedream')).toBe('pipedream-site');
  });
});

describe('primaryOriginOfSteps - the first outside origin the plan navigates to', () => {
  it('picks the FIRST navigate origin and ignores prose steps', () => {
    const steps = [browser('faz login'), nav('https://a.example/x?q=1'), nav('https://b.example/')];
    expect(primaryOriginOfSteps(steps)).toBe('https://a.example');
  });
  it('skips unparseable and non-http navigate URLs', () => {
    expect(primaryOriginOfSteps([nav('nope'), nav('ftp://x.example/f'), nav('https://ok.example/p')])).toBe('https://ok.example');
  });
  it('answers null when the plan never navigates', () => {
    expect(primaryOriginOfSteps([browser('so texto')])).toBeNull();
  });
});

describe('mintedActionNameForGoal - the matcher round-trip', () => {
  it('names the action so the creating goal matches it EXACTLY (reuse, not duplication)', () => {
    const goal = 'verificar novas notificações no portal';
    const name = mintedActionNameForGoal(goal, new Set());
    const match = matchActionForGoal(goal, [
      { actionName: name, description: goal, mutates: false },
    ]);
    expect(match.kind).toBe('one');
  });
  it('dedupes against existing names with a numeric suffix', () => {
    const goal = 'listar processos';
    const first = mintedActionNameForGoal(goal, new Set());
    const second = mintedActionNameForGoal(goal, new Set([first]));
    expect(second).toBe(`${first}_2`);
    expect(second).not.toBe(first);
  });
  it('falls back to a fixed PT name for an all-stopword goal', () => {
    expect(mintedActionNameForGoal('para com de', new Set())).toBe('sequencia_de_passos');
  });
});

describe('mutatesFloor - deterministic write signals force mutating', () => {
  const table: Array<[string, string, MintStep[], Array<boolean | undefined>, string | null]> = [
    ['PT goal verb', 'criar um relatório novo', [nav('https://x.example')], [], 'floor:goal-verb:criar'],
    ['EN goal verb', 'submit the weekly form', [nav('https://x.example')], [], 'floor:goal-verb:submit'],
    ['local_command', 'listar ficheiros', [{ type: 'local_command', description: 'ls' }], [], 'floor:local-command'],
    ['sub_automation', 'listar dados', [{ type: 'sub_automation', description: 'x' }], [], 'floor:sub-automation'],
    ['ekoa_action', 'listar dados', [{ type: 'ekoa_action', description: 'x' }], [], 'floor:ekoa-action'],
    ['api_call POST', 'listar dados', [{ type: 'api_call', description: 'x', apiRequest: { method: 'POST' } }], [], 'floor:api-call:POST'],
    ['integration step not literal-false', 'listar dados', [{ type: 'integration', description: 'x', integrationKey: 'k', integrationAction: 'a' }], [undefined], 'floor:integration-step-not-read'],
    ['silent floor: browser+navigate read goal', 'listar notificações do portal', [nav('https://x.example'), browser('extrai a lista')], [], null],
    ['silent floor: api_call GET', 'listar dados', [{ type: 'api_call', description: 'x', apiRequest: { method: 'GET' } }], [], null],
    ['integration step literal-false read', 'listar dados', [{ type: 'integration', description: 'x', integrationKey: 'k', integrationAction: 'a' }], [false], null],
  ];
  for (const [label, goal, steps, integrationMutates, expected] of table) {
    it(label, () => {
      const v = mutatesFloor(goal, steps, integrationMutates);
      if (expected === null) expect(v).toBeNull();
      else {
        expect(v?.mutates).toBe(true);
        expect(v?.basis).toBe(expected);
      }
    });
  }
});

describe('mintSiteIntegrationForAutomation - the write', () => {
  const readSteps = [nav('https://portal.acme.example/login'), browser('extrai a lista de pedidos')];
  const goal = 'listar pedidos pendentes no portal acme';

  it('creates the acting user\'s own PRIVATE per-site row with the wrapper action (confirmed read)', async () => {
    const confirmRead = vi.fn(async () => true);
    const r = await mintSiteIntegrationForAutomation(userA, {
      automationId: 'auto-1', goal, name: 'n', steps: readSteps,
    }, { store, confirmRead });
    expect(r).toMatchObject({ minted: true, integrationKey: 'portal-acme-example', createdDefinition: true, mutates: false, basis: 'model:read' });
    if (!r.minted) return;
    const doc = await store.getById(definitionIdFor('orgA', 'portal-acme-example'));
    expect(doc?.visibility).toBe('private');
    expect(doc?.userId).toBe('userA');
    expect(doc?.origin?.kind).toBe('authored');
    expect(doc?.actions).toHaveLength(1);
    expect(doc?.actions[0]).toMatchObject({
      actionName: r.actionName,
      mutates: false,
      automationBinding: { automationId: 'auto-1' },
    });
    // No authoring record: the wrapper is the builder-save trust class (module header).
    expect(doc?.actions[0]?.authoring).toBeUndefined();
  });

  it('accumulates a SECOND automation against the same site onto the SAME row', async () => {
    const confirmRead = vi.fn(async () => true);
    await mintSiteIntegrationForAutomation(userA, { automationId: 'auto-1', goal, name: 'n', steps: readSteps }, { store, confirmRead });
    const r2 = await mintSiteIntegrationForAutomation(userA, {
      automationId: 'auto-2', goal: 'consultar faturas emitidas no portal acme', name: 'n2', steps: readSteps,
    }, { store, confirmRead });
    expect(r2).toMatchObject({ minted: true, integrationKey: 'portal-acme-example', createdDefinition: false });
    const doc = await store.getById(definitionIdFor('orgA', 'portal-acme-example'));
    expect(doc?.actions).toHaveLength(2);
    expect(new Set(doc?.actions.map((a) => a.automationBinding?.automationId))).toEqual(new Set(['auto-1', 'auto-2']));
  });

  it('a RE-plan of the same automation UPDATES its wrapper in place (no duplicate action)', async () => {
    const confirmRead = vi.fn(async () => true);
    const r1 = await mintSiteIntegrationForAutomation(userA, { automationId: 'auto-1', goal, name: 'n', steps: readSteps }, { store, confirmRead });
    expect(r1.minted).toBe(true);
    if (!r1.minted) return;
    const r2 = await mintSiteIntegrationForAutomation(userA, {
      automationId: 'auto-1', goal: 'listar pedidos pendentes e exportar', name: 'n', steps: readSteps,
      existingSource: { integrationKey: r1.integrationKey, templateKey: 'plan:auto-1' },
    }, { store, confirmRead });
    expect(r2).toMatchObject({ minted: true, integrationKey: r1.integrationKey });
    const doc = await store.getById(definitionIdFor('orgA', r1.integrationKey));
    expect(doc?.actions).toHaveLength(1);
    // Same action name kept (the binding identity wins over the re-tokenised goal).
    expect(doc?.actions[0]?.actionName).toBe(r1.actionName);
    expect(doc?.actions[0]?.description).toBe('listar pedidos pendentes e exportar');
  });

  it('a RE-plan DROPS the stale learned recipe (review fix): the old flow must not keep answering', async () => {
    const confirmRead = vi.fn(async () => true);
    const r1 = await mintSiteIntegrationForAutomation(userA, { automationId: 'auto-1', goal, name: 'n', steps: readSteps }, { store, confirmRead });
    expect(r1.minted).toBe(true);
    if (!r1.minted) return;
    // A recipe learned from the OLD steps, seeded through the one legitimate writer.
    const recipes = new (await import('../../src/integrations/recipe-store.js')).IntegrationRecipeStore(integrationDefinitions);
    const put = await recipes.putRecipe('orgA', r1.integrationKey, r1.actionName, {
      goal: 'old flow',
      injectedCalls: [{ method: 'GET', urlTemplate: 'https://portal.acme.example/api/old', headerNames: [], idempotent: true } as never],
      scriptedSteps: [],
      lessons: [],
    });
    expect(put.verdict).toBe('ok');

    // The re-plan rewrites the steps; the mint refresh must take the recipe with them - the
    // store's own replace path deliberately carries recipes forward per action name, so leaving
    // it would replay the OLD flow's calls forever with no drift to catch it.
    const r2 = await mintSiteIntegrationForAutomation(userA, {
      automationId: 'auto-1', goal: 'listar pedidos pendentes com filtros novos', name: 'n', steps: readSteps,
      existingSource: { integrationKey: r1.integrationKey, templateKey: 'plan:auto-1' },
    }, { store, confirmRead });
    expect(r2.minted).toBe(true);
    expect(await recipes.getRecipe('orgA', r1.integrationKey, r1.actionName)).toBeNull();
  });

  it('same goal against the same site from a DIFFERENT automation gets a suffixed action name', async () => {
    const confirmRead = vi.fn(async () => true);
    const r1 = await mintSiteIntegrationForAutomation(userA, { automationId: 'auto-1', goal, name: 'n', steps: readSteps }, { store, confirmRead });
    const r2 = await mintSiteIntegrationForAutomation(userA, { automationId: 'auto-2', goal, name: 'n', steps: readSteps }, { store, confirmRead });
    expect(r1.minted && r2.minted).toBe(true);
    if (!r1.minted || !r2.minted) return;
    expect(r2.actionName).toBe(`${r1.actionName}_2`);
  });

  it('fails CLOSED when the confirmer throws (mutates true, still minted)', async () => {
    const confirmRead = vi.fn(async () => { throw new Error('model down'); });
    const r = await mintSiteIntegrationForAutomation(userA, { automationId: 'auto-1', goal, name: 'n', steps: readSteps }, { store, confirmRead });
    expect(r).toMatchObject({ minted: true, mutates: true, basis: 'model:fail-closed' });
  });

  it('the FLOOR pre-empts the model - a write-verb goal never calls the confirmer', async () => {
    const confirmRead = vi.fn(async () => true);
    const r = await mintSiteIntegrationForAutomation(userA, {
      automationId: 'auto-1', goal: 'criar um pedido novo no portal acme', name: 'n', steps: readSteps,
    }, { store, confirmRead });
    expect(r).toMatchObject({ minted: true, mutates: true, basis: 'floor:goal-verb:criar' });
    expect(confirmRead).not.toHaveBeenCalled();
  });

  it('refuses to mint when the plan never navigates (no outside origin)', async () => {
    const r = await mintSiteIntegrationForAutomation(userA, {
      automationId: 'auto-1', goal, name: 'n', steps: [browser('só texto')],
    }, { store, confirmRead: vi.fn(async () => true) });
    expect(r).toEqual({ minted: false, reason: 'no-origin' });
  });

  it('Rule 5: org B never sees org A\'s minted row, and mints its OWN row for the same site', async () => {
    const confirmRead = vi.fn(async () => true);
    await mintSiteIntegrationForAutomation(userA, { automationId: 'auto-1', goal, name: 'n', steps: readSteps }, { store, confirmRead });
    // org B's actor-scoped read finds nothing for the key...
    expect(await store.getForActor(userB, 'portal-acme-example')).toBeNull();
    // ...and org B's own mint lands in org B's row, untouched by org A's.
    const rB = await mintSiteIntegrationForAutomation(userB, { automationId: 'auto-9', goal, name: 'n', steps: readSteps }, { store, confirmRead });
    expect(rB).toMatchObject({ minted: true, createdDefinition: true });
    const a = await store.getById(definitionIdFor('orgA', 'portal-acme-example'));
    const b = await store.getById(definitionIdFor('orgB', 'portal-acme-example'));
    expect(a?.orgId).toBe('orgA');
    expect(b?.orgId).toBe('orgB');
    expect(a?.actions[0]?.automationBinding?.automationId).toBe('auto-1');
    expect(b?.actions[0]?.automationBinding?.automationId).toBe('auto-9');
  });

  it('refuses a published (global) own-org row rather than editing it outside the publish flow', async () => {
    const confirmRead = vi.fn(async () => true);
    await mintSiteIntegrationForAutomation(userA, { automationId: 'auto-1', goal, name: 'n', steps: readSteps }, { store, confirmRead });
    await integrationDefinitions.update(definitionIdFor('orgA', 'portal-acme-example'), (d) => ({ ...d, visibility: 'global' } as never));
    const r = await mintSiteIntegrationForAutomation(userA, { automationId: 'auto-2', goal: 'outra coisa listar', name: 'n', steps: readSteps }, { store, confirmRead });
    expect(r).toEqual({ minted: false, reason: 'published-row' });
  });
});
