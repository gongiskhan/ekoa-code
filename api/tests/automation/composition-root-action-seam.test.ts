import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, automations, automationRuns, integrationDefinitions, approvedIntegrationActions } from '../../src/data/stores.js';
import { IntegrationDefinitionStore, type IntegrationDefinitionCreate } from '../../src/integrations/definition-store.js';
import { IntegrationRecipeStore } from '../../src/integrations/recipe-store.js';
import { approveAction, describeAction } from '../../src/integrations/action-consent.js';
import {
  executeIntegrationAction,
  setDaemonConnectionResolver,
  __resetAutomationSeamsForTests,
  type DaemonConnection,
} from '../../src/automation/seams.js';
import { automationRunStore } from '../../src/automation/persistence.js';
import { actionEvidenceStore } from '../../src/integrations/action-evidence-store.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';

/**
 * THE COMPOSITION ROOT'S P2 BINDING, under test.
 *
 * WHY THIS FILE EXISTS. `server.ts` has exactly ONE line pointing production at the discovery
 * spine:
 *
 *     const runAutomationBackedAction: AutomationBackedHandler = automationBackedActionHandler();
 *
 * Replace it with the pre-P2 inline mapping - which type-checks, and simply drops `integrationKey`,
 * `actionName`, `writeAssent` and `mutates` on the way across the seam - and the whole slice is
 * DEAD in production: `named` is false on every call, so nothing is ever replayed and nothing is
 * ever learned. The entire test lane stayed green through that mutation, because the acceptance
 * suite constructs `automationBackedActionHandler` ITSELF: it pins the MAPPING, not the BINDING.
 * The only other guard read `server.ts` as TEXT and asserted the identifier appears in it, which a
 * rebinding of that identifier satisfies.
 *
 * So this boots the REAL `buildApp` after resetting the seams, and asserts what is actually bound -
 * the approach `composition-root-locality.test.ts` established for P4's two seams. It enters at
 * `executeIntegrationAction`, the automation seam `buildApp` installs, which is what the engine's
 * `integration` step calls; the assertions are about OBSERVABLE CONSEQUENCES of the fields crossing
 * (a replay happened at all; a write gate opened) rather than about "a function is installed".
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. `mutates` cannot be observed here: this seam normalises an
 * absent value fail-closed to "this action writes" (`runAutomationForAction`), which is the same
 * answer the field carries for the only production caller that sets it, so a binding that dropped
 * it would behave identically. That reading is pinned where it IS observable - at the handler's own
 * seam, in `replay-mount.test.ts` - and named as a contract rather than a live production path.
 */
let mem: MongoMemoryServer;
const ORG = 'org-root';
const OWNER = 'u-root';
const KEY = 'portal';
const READ_ACTION = 'list_cases';
const WRITE_ACTION = 'submit_case';
const AUTOMATION_ID = 'auto-never-runs';
const ORIGIN = 'https://portal.example';
const actor: Actor = { userId: OWNER, orgId: ORG, role: 'user' };

const cfg: Config = {
  port: 0,
  jwtSecret: 's',
  encryptionKey: 'k',
  nodeEnv: 'test',
  llmChokepointBaseUrl: 'http://127.0.0.1:0/api/v1/llm',
  llm: defaultLlmConfig(),
};

let clock = 0;
const definitions = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const recipes = new IntegrationRecipeStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));

/** Every injected call this machine was asked to make, in order. */
let injected: Array<{ method: string; url: string }> = [];

/**
 * A paired machine at the frame boundary, answering the ONE frame a replay sends.
 *
 * It stands in for the daemon exactly as the acceptance suite's does and for the same structural
 * reason (`api/**` may not import `clients/**`). Nothing here stands in for the composition root -
 * that is the subject - and the daemon resolver is re-bound AFTER `buildApp` deliberately: this
 * file is about the action seam, and a real daemon connection is not something a test can have.
 */
function machine(): DaemonConnection {
  return {
    runStep: async (frame: { input?: unknown }) => {
      const input = (frame.input ?? {}) as Record<string, unknown>;
      if (input.leaseOp || input.captureOp) return { ok: true as const };
      const call = input.injectedCall as { method: string; url: string } | undefined;
      if (!call) return { ok: true as const, observation: { data: {} } };
      injected.push({ method: call.method, url: call.url });
      return {
        ok: true as const,
        observation: {
          data: {
            url: `${ORIGIN}/cases`,
            injectedCall: {
              status: 200,
              ok: true,
              bodyText: '{"items":[{"id":41}],"total":1}',
              contentType: 'application/json',
              responseHeaderNames: ['content-type'],
            },
          },
        },
      };
    },
  } as unknown as DaemonConnection;
}

function definitionRow(): IntegrationDefinitionCreate {
  return {
    orgId: ORG,
    userId: OWNER,
    key: KEY,
    visibility: 'org',
    authType: 'none',
    configSchema: [],
    actions: [
      {
        actionName: READ_ACTION,
        description: 'lista os processos',
        mutates: false,
        // NO `httpConfig` and NO declared posture. The origin is unclassified, which is the CLOSED
        // answer - and the replay still takes the in-page rung, because that is the rung an
        // adversarial origin requires and the machine below is what carries it. An `httpConfig`
        // beside an `automationBinding` is dead weight this repo refuses when it is declared
        // (`resolveBackingType`), so a fixture carrying one would be modelling a package defect.
        automationBinding: { automationId: AUTOMATION_ID },
      },
      {
        actionName: WRITE_ACTION,
        description: 'submete a peça',
        mutates: true,
        automationBinding: { automationId: AUTOMATION_ID },
      },
    ],
    skillMd: `# ${KEY}\n`,
  };
}

/** A recipe that replays cleanly, and NAMES its one call as the answer-bearing one. */
const READ_RECIPE = {
  goal: 'read the cases',
  injectedCalls: [{
    method: 'GET',
    urlTemplate: `${ORIGIN}/api/cases?ref={{input.ref}}`,
    headerNames: ['x-csrf-token'],
    idempotent: true,
  }],
  scriptedSteps: [],
  answersWith: { callIndex: 0, matchedBy: 'run-output-identity' as const },
  lessons: [],
};

/** The same, but the call WRITES - so it replays only if the owner's assent crossed the seam. */
const WRITE_RECIPE = {
  ...READ_RECIPE,
  injectedCalls: [{
    method: 'POST',
    urlTemplate: `${ORIGIN}/api/cases?ref={{input.ref}}`,
    headerNames: ['x-csrf-token'],
    idempotent: false,
  }],
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'k';
  process.env.JWT_SECRET ??= 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_composition_root_p2');
  // The seams start at their DEFAULTS. Everything the assertions see is what `buildApp` did to
  // them, except the daemon resolver, which is re-bound below for the reason in `machine()`.
  __resetAutomationSeamsForTests();
  buildApp(cfg, { now: () => 1_700_000_000_000 + clock++, genId: () => `id_${clock++}` });
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  injected = [];
  clock = 0;
  await users.deleteMany({});
  await automations.deleteMany({});
  await automationRuns.deleteMany({});
  await integrationDefinitions.deleteMany({});
  await approvedIntegrationActions.deleteMany({});
  await users.insert({ _id: OWNER, username: OWNER, orgId: ORG, role: 'user', active: true } as never);
  await definitions.create(definitionRow(), { actor });
  setDaemonConnectionResolver(() => machine());
});

describe('the integration-action executor bound by buildApp carries the discovery spine', () => {
  it('REPLAYS a learned recipe - which the pre-P2 mapping, dropping the action\'s identity, cannot', async () => {
    expect((await recipes.putRecipe(ORG, KEY, READ_ACTION, READ_RECIPE, {})).verdict).toBe('ok');

    const result = await executeIntegrationAction({
      integrationKey: KEY,
      actionName: READ_ACTION,
      args: { ref: '2024-1' },
      ownerUserId: OWNER,
    });

    expect(result.success).toBe(true);
    // THE REPLAY HAPPENED, which is only possible if `integrationKey` and `actionName` crossed the
    // seam: without them `named` is false and this seam goes straight to the automation. Note the
    // automation named by the binding DOES NOT EXIST, so the pre-P2 mapping fails here with
    // `unknown_automation` - the two behaviours are not merely different, they are opposite.
    expect(result.data).toMatchObject({ replayed: true, recipeVersion: 1 });
    expect(injected).toEqual([{ method: 'GET', url: `${ORIGIN}/api/cases?ref=2024-1` }]);
    // …and the answer is the replayed call's body, in the envelope every consumer reads.
    expect((result.data as { output: unknown }).output).toEqual({ items: [{ id: 41 }], total: 1 });
    // NO AUTOMATION RAN. The short-circuit is the whole point of the slice.
    expect(await automationRuns.find({})).toEqual([]);
  }, 30_000);

  /**
   * SLICE S1 - THE EVIDENCE SEAMS ARE BOUND, not merely declared.
   *
   * `server.ts` builds ONE `executorDeps` bundle carrying `recordActionEvidence` (the real
   * `integration_action_evidence` store) and `collectRunEvidence` (the real `automation/` collector),
   * and hands the SAME bundle to all four executor call sites. Delete either member and nothing
   * fails: actions keep running and simply stop leaving evidence - the exact silent-loss failure
   * this file was created for, one seam over.
   *
   * WHAT IS REAL HERE AND WHAT IS STUBBED. The chain under test is entirely real: the bundle
   * `buildApp` built, the executor's capture call, the bound collector, the bound store. The ONE
   * stub is `automationRunStore.findByRunId`, and it is stubbed for a structural reason rather than
   * for convenience - a REPLAY answers with a `replay-…` id that by construction has no
   * `automationRuns` document behind it (`replay-action.ts`), so the collector correctly finds
   * nothing and there is no evidence to record. Giving it a run to find is what makes the rest of
   * the real chain observable.
   */
  describe('the EVIDENCE seams (slice S1)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('consults the bound run-evidence collector, and records what it collects', async () => {
      expect((await recipes.putRecipe(ORG, KEY, READ_ACTION, READ_RECIPE, {})).verdict).toBe('ok');

      const findByRunId = vi.spyOn(automationRunStore, 'findByRunId').mockResolvedValue({
        id: 'r-1',
        automationId: AUTOMATION_ID,
        startedAt: '2026-08-17T00:00:00.000Z',
        // FIXTURE HONESTY: `completed` and `cache` are members of `RunStatus` / `StepStatus` /
        // `StepTier`. The first cut used `succeeded` and `deterministic`, neither of which the engine
        // ever writes, which the `as never` cast hid.
        status: 'completed',
        inputs: {},
        triggeredBy: 'user',
        steps: [
          { stepId: 's0', index: 0, status: 'completed', tier: 'cache', durationMs: 1, screenshotPath: `automation-runs/${AUTOMATION_ID}/r-1/step-0.png` },
          { stepId: 's1', index: 1, status: 'completed', tier: 'cache', durationMs: 1, output: { kind: 'local_command', stdout: 'listed 1 case', stderr: '', exitCode: 0, durationMs: 1, truncated: false, timedOut: false } },
        ],
      } as never);
      const record = vi.spyOn(actionEvidenceStore, 'recordEvidence');

      const result = await executeIntegrationAction({
        integrationKey: KEY,
        actionName: READ_ACTION,
        args: { ref: '2024-1' },
        ownerUserId: OWNER,
      });
      expect(result.success).toBe(true);

      // `findByRunId` has exactly ONE caller in api/src - the evidence collector - so its being
      // called at all proves `collectRunEvidence` crossed from the composition root.
      expect(findByRunId).toHaveBeenCalledTimes(1);
      expect(findByRunId.mock.calls[0]![0]).toMatch(/^replay-/);

      // …and the collected pointers reached the REAL store under the caller's own tenant.
      expect(record).toHaveBeenCalledTimes(1);
      const [key, input] = record.mock.calls[0]!;
      expect(key).toEqual({ orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: READ_ACTION });
      expect(input.backingType).toBe('browser-steps');
      expect(input.evidence).toMatchObject({
        kind: 'automation',
        status: 'completed',
        steps: [
          // A POINTER into the authenticated screenshot plane, never the PNG bytes. `status` is the
          // STEP's own outcome - the field the first cut mis-named `title` and filled with it.
          { stepIndex: 0, status: 'completed', screenshotUrl: `/automation-screenshots/${AUTOMATION_ID}/r-1/step-0.png` },
          { stepIndex: 1, status: 'completed', excerpt: 'listed 1 case' },
        ],
      });
      // The bytes the run exercised, so a promotion can be bound to them.
      expect(input.shape).toBeTypeOf('string');

      // And it really landed - the store write is not merely attempted.
      const stored = await actionEvidenceStore.getEvidence({ orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: READ_ACTION });
      expect(stored?.evidence).toMatchObject({ kind: 'automation', runId: findByRunId.mock.calls[0]![0] });
    }, 30_000);

    it('records NOTHING when the collector cannot resolve the run (the ordinary replay case)', async () => {
      // The control: without the stub above, a replay's id resolves to no run and the previous
      // evidence must be left standing rather than replaced by an empty row.
      expect((await recipes.putRecipe(ORG, KEY, READ_ACTION, READ_RECIPE, {})).verdict).toBe('ok');
      const record = vi.spyOn(actionEvidenceStore, 'recordEvidence');

      const result = await executeIntegrationAction({
        integrationKey: KEY,
        actionName: READ_ACTION,
        args: { ref: '2024-1' },
        ownerUserId: OWNER,
      });

      expect(result.success).toBe(true);
      expect(record).not.toHaveBeenCalled();
    }, 30_000);
  });

  it('carries the owner\'s WRITE ASSENT, so an approved write replays instead of hitting the gate', async () => {
    expect((await recipes.putRecipe(ORG, KEY, WRITE_ACTION, WRITE_RECIPE, {})).verdict).toBe('ok');
    const row = await definitions.getForActor(actor, KEY);
    const action = row!.actions.find((a) => a.actionName === WRITE_ACTION)!;
    await approveAction({ orgId: ORG, userId: OWNER }, describeAction(KEY, action), 'always');

    const result = await executeIntegrationAction({
      integrationKey: KEY,
      actionName: WRITE_ACTION,
      args: { ref: '2024-1' },
      ownerUserId: OWNER,
    });

    // THE GATE OPENED, which is only possible if `writeAssent` crossed. A binding that dropped it
    // would leave the gate permanently shut - and, worse, would read to a reviewer as protection.
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ replayed: true });
    expect(injected).toEqual([{ method: 'POST', url: `${ORIGIN}/api/cases?ref=2024-1` }]);
  }, 30_000);

  it('and the gate is a GATE: the same write, unapproved, is refused and its recipe dropped', async () => {
    // The CONTROL for the case above, so "the write replayed" cannot be read as "the gate is
    // decorative". Nothing is approved here, so the executor refuses before the seam is even
    // reached - the recipe is never run and the machine is never asked.
    expect((await recipes.putRecipe(ORG, KEY, WRITE_ACTION, WRITE_RECIPE, {})).verdict).toBe('ok');

    const result = await executeIntegrationAction({
      integrationKey: KEY,
      actionName: WRITE_ACTION,
      args: { ref: '2024-1' },
      ownerUserId: OWNER,
    });

    expect(result.success).toBe(false);
    expect(result.details).toBe('awaiting_consent');
    expect(injected).toEqual([]);
  }, 30_000);
});
