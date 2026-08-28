import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '@ekoa/shared';

/**
 * MINT-ON-PLAN WIRING (D-CORNERSTONE-MINT-SHAPE): `service.planFromGoal` persists the automation,
 * mints the per-site integration through `definition-mint.ts`, stamps `source.{integrationKey,
 * templateKey: 'plan:<id>'}` provenance onto the automation row, and answers the minted identity on
 * the wire. This suite drives the REAL service with the chokepoint mocked (the planner test's own
 * pattern) - the mint path inside is fully live: real definition store, real automations store.
 */
const hoisted = vi.hoisted(() => ({
  responses: [] as string[],
  classifierReplies: [] as string[],
}));

vi.mock('../../src/llm/index.js', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    runOneShot: vi.fn(async () => ({ text: hoisted.responses.shift() ?? '', usage: {} })),
    decideForTier: vi.fn((tier: string) => ({ tier, model: 'm', effort: 'high', weight: 1 })),
    completeFast: vi.fn(async () => ({ text: hoisted.classifierReplies.shift() ?? '{"read": false}', usage: {} })),
  };
});

import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { automations, integrationDefinitions, automationRuns } from '../../src/data/stores.js';
import { planFromGoal } from '../../src/automation/service.js';
import { definitionIdFor } from '../../src/integrations/definition-store.js';
import type { IntegrationDefinitionDoc } from '../../src/integrations/definition-store.js';

let mem: MongoMemoryServer;
let tmp: string;
const savedDataDir = process.env.EKOA_DATA_DIR;

const admin: Actor = { userId: 'u1', orgId: 'org1', role: 'org-admin' };

const plannerPlan = (name: string) =>
  JSON.stringify({
    status: 'ok',
    name,
    description: 'Lista os pedidos pendentes',
    steps: [
      { id: 'open', description: 'Abrir o portal', type: 'navigate', url: 'https://portal.acme.example/entrada' },
      { id: 'read', description: 'Extrair a lista de pedidos', type: 'browser' },
    ],
    reasoning: 'two-step read',
  });

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-planmint-'));
  process.env.EKOA_DATA_DIR = join(tmp, 'data');
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_planmint');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  process.env.EKOA_DATA_DIR = savedDataDir;
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  hoisted.responses = [];
  hoisted.classifierReplies = [];
  await automations.deleteMany({});
  await automationRuns.deleteMany({});
  await integrationDefinitions.deleteMany({});
});

describe('planFromGoal - mint-on-plan wiring', () => {
  it('a fresh plan mints the per-site integration, stamps provenance, and answers it on the wire', async () => {
    hoisted.responses.push(plannerPlan('Pedidos pendentes'));
    hoisted.classifierReplies.push('{"read": true}');

    const res = await planFromGoal(admin, { goal: 'listar pedidos pendentes no portal acme' });

    expect(res.plan.status).toBe('ok');
    expect(res.integration).toBeDefined();
    expect(res.integration?.key).toBe('portal-acme-example');

    // The wrapper action landed on the tenant's own PRIVATE row, bound to the persisted automation.
    const doc = (await integrationDefinitions.get(
      definitionIdFor('org1', 'portal-acme-example'),
    )) as IntegrationDefinitionDoc | null;
    expect(doc?.visibility).toBe('private');
    expect(doc?.actions).toHaveLength(1);
    expect(doc?.actions[0]?.actionName).toBe(res.integration?.actionName);
    expect(doc?.actions[0]?.mutates).toBe(false);
    expect(doc?.actions[0]?.automationBinding?.automationId).toBe(res.automation?.id);

    // The automation row carries the provenance stamp the /automations/[id] redirect resolves.
    const auto = (await automations.get(res.automation!.id)) as { source?: { integrationKey: string; templateKey: string } } | null;
    expect(auto?.source).toEqual({ integrationKey: 'portal-acme-example', templateKey: `plan:${res.automation!.id}` });
  });

  it('a RE-plan of the minted automation refreshes the SAME wrapper action (no duplicate)', async () => {
    hoisted.responses.push(plannerPlan('Pedidos pendentes'));
    hoisted.classifierReplies.push('{"read": true}');
    const first = await planFromGoal(admin, { goal: 'listar pedidos pendentes no portal acme' });
    const automationId = first.automation!.id;

    hoisted.responses.push(plannerPlan('Pedidos pendentes v2'));
    hoisted.classifierReplies.push('{"read": true}');
    const second = await planFromGoal(admin, {
      goal: 'listar pedidos pendentes no portal acme com filtros',
      automationId,
    });

    expect(second.integration?.key).toBe('portal-acme-example');
    expect(second.integration?.actionName).toBe(first.integration?.actionName);
    const doc = (await integrationDefinitions.get(
      definitionIdFor('org1', 'portal-acme-example'),
    )) as IntegrationDefinitionDoc | null;
    expect(doc?.actions).toHaveLength(1);
  });

  it('a mint refusal names its REASON on the wire, so the surface can say which (live-run fix)', async () => {
    // A live run hit "Sequência criada ... não foi possível associá-la a um site" and read it as
    // "nothing happened": the plan succeeded, the mint declined, and the only way to tell WHICH
    // reason was a server log. One of the reasons (no site address in the goal) is actionable by
    // the user, so it has to reach them.
    hoisted.responses.push(
      JSON.stringify({
        status: 'ok',
        name: 'Sem navegação',
        description: 'd',
        steps: [{ id: 'b', description: 'faz algo na página atual', type: 'browser' }],
        reasoning: 'r',
      }),
    );
    const res = await planFromGoal(admin, { goal: 'fazer algo sem indicar o site' });
    expect(res.plan.status).toBe('ok');
    expect(res.integration).toBeUndefined();
    expect(res.integrationSkipped).toBe('no-origin');
  });

  it('a mint refusal never fails the plan (no navigate step -> plan ok, no integration field)', async () => {
    hoisted.responses.push(
      JSON.stringify({
        status: 'ok',
        name: 'Só browser',
        description: 'd',
        steps: [{ id: 'b', description: 'faz algo na página atual', type: 'browser' }],
        reasoning: 'r',
      }),
    );
    const res = await planFromGoal(admin, { goal: 'fazer algo na página' });
    expect(res.plan.status).toBe('ok');
    expect(res.integration).toBeUndefined();
    expect(res.automation).toBeDefined();
  });

  it('the classifier failing closed still mints, as a WRITE (mutates true)', async () => {
    hoisted.responses.push(plannerPlan('Pedidos'));
    hoisted.classifierReplies.push('nonsense that is not JSON');
    const res = await planFromGoal(admin, { goal: 'listar pedidos pendentes no portal acme' });
    expect(res.integration).toBeDefined();
    const doc = (await integrationDefinitions.get(
      definitionIdFor('org1', 'portal-acme-example'),
    )) as IntegrationDefinitionDoc | null;
    expect(doc?.actions[0]?.mutates).toBe(true);
  });
});
