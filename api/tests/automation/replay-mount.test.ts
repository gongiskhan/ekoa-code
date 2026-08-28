/**
 * THE MOUNT: where a compiled recipe is tried, and where a run that has none goes and learns one
 * (slice P2).
 *
 * `runAutomationForAction` is what every automation-backed integration action goes through - the
 * citius poll, every browser-steps action, every listener tick. It is the highest-traffic code the
 * spine touches, and it is now the WHOLE spine: replay, then the instrumented run, then the
 * compile, then (on drift) the supersede.
 *
 * Properties, and the third and fourth are the ones the first attempt did not have at all:
 *
 *   1. a recipe that replays SHORT-CIRCUITS the automation entirely (that is the whole win);
 *   2. every other replay outcome FALLS THROUGH to the automation, including a thrown one - a
 *      replay is an optimisation, and an optimisation that can break an action that worked before
 *      it existed is worse than no optimisation;
 *   3. except `write-gate`, which is a refusal: falling through would run the write by the other
 *      path and make the gate decorative (trap T4);
 *   4. the run that DOES happen is instrumented, and what it observed is compiled and stored - so
 *      an ordinary production run is what makes the next one free. A `drift` routes that same
 *      compile through the SUPERSEDE instead of the first write.
 *
 * The store, the daemon and the engine are behind injected deps, so this file tests the WIRING.
 * What the replay itself does is `injected-call-replay.test.ts`; what the whole thing does against
 * a real server, entered through the real executor, is the acceptance suite.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  runAutomationForAction,
  automationBackedActionHandler,
  MAX_RUN_CAPTURED_EXCHANGES,
  MAX_PERSISTED_EVIDENCE,
  type ActionRunDeps,
} from '../../src/automation/service.js';
import type { replayIntegrationAction } from '../../src/automation/replay-action.js';
import type { runAutomation } from '../../src/automation/engine.js';
import type { RecipeDraft } from '../../src/integrations/recipe-store.js';
import { automations, automationRuns, integrationDefinitions, integrationCapturedCalls } from '../../src/data/stores.js';
import type { StepOutput } from '../../src/automation/types.js';
import { IntegrationRecipeStore, RecipeStoreError } from '../../src/integrations/recipe-store.js';
import { CapturedCallsStore } from '../../src/integrations/captured-calls-store.js';
import { IntegrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState } from '../agents/_setup.js';
import { REPLAY_BUDGET } from '../../src/automation/budgets.js';
import { __resetAutomationSeamsForTests, setDaemonConnectionResolver } from '../../src/automation/seams.js';

type Replay = typeof replayIntegrationAction;
type Run = typeof runAutomation;

const OWNER = 'u1';
const AUTOMATION_ID = 'auto-1';

const base = {
  binding: { automationId: AUTOMATION_ID },
  args: { ref: '2024-1' },
  credentialFields: {},
  orgId: 'o1',
  ownerUserId: OWNER,
  integrationKey: 'portal',
  actionName: 'list_cases',
  // A READ, DECLARED. `mutates` is optional at this seam (Rule 7) and is read the way the rest of
  // the repo reads it - only a literal `false` is a read - so a case that leaves it out is a
  // MUTATING action, arms no recorder and learns nothing. That is deliberate and has its own cases
  // below ("a recipe may not be a SUBSET of its action"); every case that means to exercise the
  // learn has to say so here.
  mutates: false,
};

/** One captured exchange: an internal JSON API call, which is the only thing a compile keeps. */
const EXCHANGE = {
  method: 'GET',
  url: 'https://portal.example/api/cases?ref=2024-1',
  requestHeaderNames: ['accept', 'x-csrf-token'],
  responseHeaderNames: ['content-type'],
  status: 200,
  contentType: 'application/json',
  resourceType: 'xhr',
  responseBody: '{"items":[{"id":41}]}',
};

/** A run that succeeds, having observed `captures`. Stands in for the engine so the wiring under
 *  test is the SERVICE's, not the engine's - the engine's own half is pinned in `engine` suites. */
function runObserving(captures: unknown[]): ReturnType<typeof vi.fn<Run>> {
  return vi.fn<Run>(async (_id, _ctx, options) => {
    options?.observeNetwork?.(captures as never);
    return { runId: 'run-1', status: 'completed', durationMs: 1, summary: 'ok', lastStepIndex: 0 };
  });
}

/** Collect what the spine tried to write, without a Mongo round trip. */
function storeSpies() {
  const put = vi.fn(async (_o: string, _k: string, _a: string, draft: RecipeDraft) => ({ verdict: 'ok' as const, recipe: { ...draft, version: 1, compiledAt: 'now' } }));
  const supersede = vi.fn(async (_o: string, _k: string, _a: string, next: RecipeDraft & { reason: string }) => ({
    verdict: 'ok' as const,
    recipe: { ...next, version: 2, compiledAt: 'now', supersedes: { version: 1, reason: next.reason } },
  }));
  // Typed by its real parameters, so a case can assert WHAT was written and not merely how often.
  const appendCapturedCall = vi.fn(async (
    _key: { orgId: string; integrationKey: string; actionName: string; captureId: string },
    _seq: number,
    _call: { url: string },
  ) => ({ verdict: 'ok' as const }));
  const discardCapture = vi.fn(async (_key: { orgId: string; integrationKey: string; actionName: string; captureId: string }) => 1);
  const deps: ActionRunDeps = {
    putRecipe: put as never,
    supersedeRecipe: supersede as never,
    captures: { appendCapturedCall, discardCapture } as never,
    captureId: () => 'cap-1',
  };
  return { put, supersede, appendCapturedCall, discardCapture, deps };
}

describe('runAutomationForAction - the replay-first mount', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_replay_mount'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    resetAgentState({});
    __resetAutomationSeamsForTests();
    await automations.deleteMany({});
    // A real automation the fall-through can reach. It exists so a fall-through is observable as
    // "the automation ran", not as "the automation was missing". It has NO STEPS on purpose: every
    // step type worth running here would need a daemon, a browser or a network, and what is under
    // test is the DECISION to run it at all - so the automation is the cheapest thing that still
    // produces a real run record.
    await automations.insert({
      _id: AUTOMATION_ID,
      id: AUTOMATION_ID,
      name: 'listar processos',
      description: 'lista',
      steps: [],
      ownerUserId: OWNER,
      orgId: 'o1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
  });

  it('SHORT-CIRCUITS the automation when the recipe replays, and reports the version it replayed', async () => {
    const replay = vi.fn<Replay>(async () => ({
      outcome: 'ok',
      calls: [],
      data: { items: [{ id: 41 }] },
      recipeVersion: 7,
    }));
    const run = vi.fn<Run>();
    const result = await runAutomationForAction(base, { replay, run });

    expect(result.success).toBe(true);
    // THE SAME ENVELOPE THE AUTOMATION LEG ANSWERS IN, plus the two fields that say which leg ran.
    // The replay used to answer `{replayed, recipeVersion, output}` - a SECOND shape - while every
    // consumer is written against the first: `user-defined-poll.ts` unwraps `output` only when it
    // sees BOTH a string `runId` and a string `status`, so a replayed poll resolved its field paths
    // against the envelope and read `undefined` on every tick, forever. Asserted whole (`toEqual`,
    // never `toMatchObject`) because the defect was a MISSING key, which a partial match cannot see.
    const envelope = result.data as { runId: string; replayMs: number };
    expect(result.data).toEqual({
      runId: envelope.runId,
      status: 'completed',
      summary: 'replayed 0 call(s) of recipe v7',
      output: { items: [{ id: 41 }] },
      replayed: true,
      recipeVersion: 7,
      // K4: the replay's own wall-clock, measured by the mount.
      replayMs: envelope.replayMs,
    });
    expect(typeof envelope.replayMs).toBe('number');
    // …and the id names THIS replay rather than an automation run that never happened: it is the
    // same string the replay's browser lease and its daemon frames are ledgered under.
    expect(envelope.runId).toMatch(/^replay-/);
    expect(replay.mock.calls[0]![0]!.runId).toBe(envelope.runId);
    expect(run).not.toHaveBeenCalled();
    expect(replay).toHaveBeenCalledOnce();
    expect(replay.mock.calls[0]![0]).toMatchObject({ orgId: 'o1', integrationKey: 'portal', actionName: 'list_cases', args: { ref: '2024-1' } });
  });

  /**
   * K6 - THE ONE-WRITER RULE COVERS THE DESTRUCTIVE PATH TOO (finding
   * `clear-refused-recipe-is-ownership-ungated`). A same-org PEER whose replay refuses
   * (`arguments-uncovered` on an argument the recipe has no hole for is the everyday case: the
   * listener's establishing tick calls with `{}`) used to CLEAR the owner's org-wide recipe and
   * discard its evidence, restarting the lineage at v1 - a two-user clear/relearn thrash cycle.
   * The clear now runs only for the bound automation's owner; the peer still falls through to the
   * automation leg, where `forbidden` answers them exactly as before.
   */
  it('K6: a NON-OWNER peer\'s refused replay does NOT clear the recipe; the owner\'s does', async () => {
    const replay = vi.fn<Replay>(async () => ({ outcome: 'arguments-uncovered', reason: 'no hole for {q}', recipeVersion: 1 }) as never);
    const run = vi.fn<Run>(async () => ({ runId: 'r-1', status: 'completed', summary: 'ok' }) as never);
    const clearRecipe = vi.fn(async () => ({ version: 1 }));

    // The peer: same org, not the automation's owner. The replay refuses, the clear is withheld,
    // and the automation leg answers `forbidden` - so nothing the OWNER built was destroyed.
    const peer = await runAutomationForAction({ ...base, ownerUserId: 'peer' }, { replay, run, clearRecipe });
    expect(peer).toMatchObject({ success: false, code: 'forbidden' });
    expect(clearRecipe).not.toHaveBeenCalled();

    // The owner: the same refusal clears, exactly as it always did.
    const owner = await runAutomationForAction(base, { replay, run, clearRecipe });
    expect(owner.success).toBe(true);
    expect(clearRecipe).toHaveBeenCalledWith('o1', 'portal', 'list_cases');
  });

  /**
   * K6 - THE HEAL CEILING (HEAL_BUDGET, finding `recipe-drift-heal-cycles-are-unbounded`). A
   * recipe whose lineage shows N consecutive heals with no successful replay between them is not
   * healable: the site does not hold still long enough for a recipe to be worth compiling. The
   * drift branch then CLEARS instead of superseding forever - and a streak below the ceiling
   * supersedes exactly as before.
   */
  it('K6: drift at the heal ceiling CLEARS the recipe instead of superseding again', async () => {
    const { put, supersede, deps } = storeSpies();
    const clearRecipe = vi.fn(async () => ({ version: 4, capturedCallsRef: 'cap-old' }));
    const getRecipe = vi.fn(async () => ({ capturedCallsRef: 'cap-old', stats: { driftStreak: 3 } }));
    const replay = vi.fn<Replay>(async () => ({ outcome: 'drift', reason: 'shape moved', recipeVersion: 4 }) as never);
    const run = runObserving([EXCHANGE]);

    const result = await runAutomationForAction(base, { ...deps, replay, run, clearRecipe, getRecipe });
    expect(result.success).toBe(true);
    expect(clearRecipe).toHaveBeenCalledWith('o1', 'portal', 'list_cases');
    expect(supersede).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('K6: drift BELOW the ceiling still heals (supersede), and the streak is the store\'s to keep', async () => {
    const { put, supersede, deps } = storeSpies();
    const getRecipe = vi.fn(async () => ({ capturedCallsRef: 'cap-old', stats: { driftStreak: 2 } }));
    const replay = vi.fn<Replay>(async () => ({ outcome: 'drift', reason: 'shape moved', recipeVersion: 4 }) as never);
    const run = runObserving([EXCHANGE]);

    const result = await runAutomationForAction(base, { ...deps, replay, run, getRecipe });
    expect(result.success).toBe(true);
    expect(supersede).toHaveBeenCalledOnce();
    expect(put).not.toHaveBeenCalled();
  });

  it('K6: a replay attempt past REPLAY_BUDGET is abandoned - the authored run answers', async () => {
    vi.useFakeTimers();
    try {
      // A replay that never settles: the budget race is the only thing that can end the attempt.
      const replay = vi.fn<Replay>(() => new Promise(() => undefined));
      const run = vi.fn<Run>(async () => ({ runId: 'r-1', status: 'completed', summary: 'ok' }) as never);
      const pending = runAutomationForAction(base, { replay, run });
      await vi.advanceTimersByTimeAsync(REPLAY_BUDGET.maxWallClockMs + 1);
      const result = await pending;
      expect(result.success).toBe(true);
      expect(run).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('K4: a replay that answered bumps the usage stats; a fall-through does not', async () => {
    const recordReplay = vi.fn(async () => undefined);
    const replayOk = vi.fn<Replay>(async () => ({ outcome: 'ok', calls: [], data: {}, recipeVersion: 1 }));
    await runAutomationForAction(base, { replay: replayOk, run: vi.fn<Run>(), recordReplay });
    expect(recordReplay).toHaveBeenCalledOnce();
    expect(recordReplay).toHaveBeenCalledWith('o1', 'portal', 'list_cases', { ms: expect.any(Number) });

    recordReplay.mockClear();
    const replayMiss = vi.fn<Replay>(async () => ({ outcome: 'no-recipe' }) as never);
    const run = vi.fn<Run>(async () => ({ runId: 'r-1', status: 'completed', summary: 'ok' }) as never);
    await runAutomationForAction(base, { replay: replayMiss, run, recordReplay });
    expect(recordReplay).not.toHaveBeenCalled();
  });

  /**
   * WRITE-GATE: THE RECIPE IS REFUSED, THE ACTION IS NOT (trap T4).
   *
   * This used to answer `awaiting_consent`, and that answer named a consent NOBODY COULD EVER GIVE.
   * At this seam `writeAssent` is `false` only for an action declared `mutates: false` - the
   * executor refuses an unapproved write before it gets here - and a `mutates: false` action is
   * never put to a human at all. So the action was permanently dead: `putRecipe` will not overwrite
   * and `supersedeRecipe` only bumps, leaving every later run to fail on the same gate with nothing
   * its owner could do about it. A read-declared action learning a POST is ordinary (portals serve
   * searches over POST), so the RECIPE is what has to give way.
   */
  it('write-gate CLEARS the offending recipe and runs the action, instead of bricking it', async () => {
    const replay = vi.fn<Replay>(async () => ({ outcome: 'write-gate', blocked: 'POST https://portal.example/api/cases', recipeVersion: 2 }));
    const run = vi.fn<Run>(async () => ({ runId: 'r-1', status: 'completed', summary: 'ok' }) as never);
    // The store answers with the recipe it DROPPED - see `ActionRunDeps.clearRecipe`. This one
    // names no evidence, so this case is about the clear alone; the evidence pairing has its own.
    const clearRecipe = vi.fn(async () => ({ version: 2 }));
    const result = await runAutomationForAction(base, { replay, run, clearRecipe });

    // THE ACTION STILL WORKS - it runs its authored steps, which are what the owner approved,
    // exactly as it did before it ever learned anything.
    expect(result.success).toBe(true);
    expect(result.code).toBeUndefined();
    expect(run).toHaveBeenCalledOnce();
    // …and it was NOT replayed, so the gate did stop the unreviewed call set.
    expect((result.data as { replayed?: boolean }).replayed).toBeUndefined();
    // THE ESCAPE HATCH FIRED, so no later run pays for the same doomed replay.
    expect(clearRecipe).toHaveBeenCalledWith('o1', 'portal', 'list_cases');
  });

  /**
   * K2: A CREDENTIAL HALT IS PARKED, NOT FAILED. The engine persisted `needs_credentials`,
   * registered the waiter and emitted the SSE frame - this envelope must say the SAME thing to the
   * action caller. It used to flatten to `automation_failed`, which read as "the action broke"
   * while the run was actually waiting for the owner's ceremony - and on the schedules rail that
   * flattening burned the failure ceiling with no notification (the ledgered finding
   * `needs-credentials-halt-flattens-to-automation-failed-at-the-action-surface`).
   */
  it('a needs_credentials halt answers its OWN code, never automation_failed (K2)', async () => {
    // A real parked row, so the K3 identity stamp below has a document to land on.
    await automationRuns.insert({
      _id: 'r-halt', id: 'r-halt', automationId: AUTOMATION_ID, startedAt: new Date().toISOString(),
      status: 'needs_credentials', steps: [], ownerUserId: OWNER, orgId: 'o1',
    } as never);
    const replay = vi.fn<Replay>(async () => ({ outcome: 'no-recipe' }) as never);
    const run = vi.fn<Run>(async () => ({ runId: 'r-halt', status: 'needs_credentials', summary: 'paused: no usable credential for https://portal.example' }) as never);
    const result = await runAutomationForAction(base, { replay, run });

    expect(result.success).toBe(false);
    expect(result.code).toBe('needs_credentials');
    // The parked run's identity travels, so a caller (or the schedules supervisor) can follow the
    // run/SSE plane where the ceremony UX lives.
    expect(result.data).toEqual({ runId: 'r-halt', status: 'needs_credentials' });
    // And the error prose never claims failure.
    expect(result.error).not.toMatch(/did not complete/);
    // K3: the parked row carries the STORABLE action's identity, which is what lets the
    // post-ceremony resume fire the one background learn-armed re-execution.
    const row = (await automationRuns.get('r-halt')) as { actionRetry?: unknown } | null;
    expect(row?.actionRetry).toEqual({ integrationKey: 'portal', actionName: 'list_cases', args: { ref: '2024-1' } });
  });

  it('K3 (Codex fix): a secret-shaped ARG never survives verbatim in actionRetry.args', async () => {
    await automationRuns.insert({
      _id: 'r-halt-s', id: 'r-halt-s', automationId: AUTOMATION_ID, startedAt: new Date().toISOString(),
      status: 'needs_credentials', steps: [], ownerUserId: OWNER, orgId: 'o1',
    } as never);
    const replay = vi.fn<Replay>(async () => ({ outcome: 'no-recipe' }) as never);
    const run = vi.fn<Run>(async () => ({ runId: 'r-halt-s', status: 'needs_credentials' }) as never);
    // A caller passing a token as an arg, plus a live credential value in the bag: BOTH must be
    // gone from the persisted row - the secret-NAMED key dropped, and the credential VALUE redacted
    // even under an innocuous key.
    // The "secret" values are obvious non-secrets (gitleaks-safe): what is under test is that the
    // secret-NAMED KEY is dropped and the credential-VALUE is redacted, not the strings themselves.
    const credValue = 'REDACT-ME-cred';
    const result = await runAutomationForAction({
      ...base,
      args: { ref: '2024-1', apiToken: 'NOT-A-REAL-token', note: credValue },
      credentialFields: { pw: credValue },
    }, { replay, run });
    expect(result.code).toBe('needs_credentials');
    const row = (await automationRuns.get('r-halt-s')) as { actionRetry?: { args?: Record<string, unknown> } } | null;
    const args = row?.actionRetry?.args ?? {};
    expect(args.ref).toBe('2024-1');
    expect(args.apiToken).toBeUndefined(); // secret-NAMED key dropped
    expect(JSON.stringify(args)).not.toContain(credValue); // credential VALUE redacted
  });

  it('a MUTATING action\'s credential halt stamps NO retry identity (never re-executed unasked)', async () => {
    await automationRuns.insert({
      _id: 'r-halt-w', id: 'r-halt-w', automationId: AUTOMATION_ID, startedAt: new Date().toISOString(),
      status: 'needs_credentials', steps: [], ownerUserId: OWNER, orgId: 'o1',
    } as never);
    const replay = vi.fn<Replay>(async () => ({ outcome: 'no-recipe' }) as never);
    const run = vi.fn<Run>(async () => ({ runId: 'r-halt-w', status: 'needs_credentials' }) as never);
    // mutates omitted = WRITE (fail-closed reading), so storable is false and nothing is stamped.
    const { mutates: _drop, ...rest } = base;
    void _drop;
    const result = await runAutomationForAction({ ...rest, writeAssent: true }, { replay, run });
    expect(result.code).toBe('needs_credentials');
    const row = (await automationRuns.get('r-halt-w')) as { actionRetry?: unknown } | null;
    expect(row?.actionRetry).toBeUndefined();
  });

  it('write-gate does not brick the action even when the recipe cannot be cleared', async () => {
    // A store that refuses the clear must not resurrect the permanent failure by another route.
    const replay = vi.fn<Replay>(async () => ({ outcome: 'write-gate', blocked: 'POST /x', recipeVersion: 2 }));
    const run = vi.fn<Run>(async () => ({ runId: 'r-2', status: 'completed', summary: 'ok' }) as never);
    const result = await runAutomationForAction(base, {
      replay,
      run,
      clearRecipe: async () => { throw new Error('store unavailable'); },
    });
    expect(result.success).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([
    ['no-recipe', { outcome: 'no-recipe' as const, reason: 'never discovered' }],
    ['drift', { outcome: 'drift' as const, reason: 'answered 404', recipeVersion: 3, failedIndex: 0 }],
    ['unavailable', { outcome: 'unavailable' as const, reason: 'no session', recipeVersion: 3 }],
  ])('FALLS THROUGH to the automation on %s', async (_label, outcome) => {
    const replay = vi.fn<Replay>(async () => outcome);
    const result = await runAutomationForAction(base, { replay });

    expect(replay).toHaveBeenCalledOnce();
    // The automation ran: a completed run answers with its runId, which no replay outcome carries.
    expect(result.success).toBe(true);
    expect((result.data as { runId?: string }).runId).toBeTruthy();
  });

  it('FALLS THROUGH when the replay THROWS - a defect in the optimisation cannot break the action', async () => {
    const replay = vi.fn<Replay>(async () => { throw new Error('the store exploded'); });
    const result = await runAutomationForAction(base, { replay });

    expect(result.success).toBe(true);
    expect((result.data as { runId?: string }).runId).toBeTruthy();
  });

  it('does not attempt a replay at all when the caller did not name the action', async () => {
    const replay = vi.fn<Replay>();
    const run = runObserving([EXCHANGE]);
    const { deps, put } = storeSpies();
    const { integrationKey: _k, actionName: _a, ...unnamed } = base;
    const result = await runAutomationForAction(unnamed, { ...deps, replay, run });

    // Exactly the pre-P2 behaviour for a caller that predates the two fields: no replay, and no
    // learning either - there is no action to key a recipe on.
    expect(replay).not.toHaveBeenCalled();
    expect(run.mock.calls[0]![2]?.observeNetwork).toBeUndefined();
    expect(put).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe('runAutomationForAction - the run that DOES happen is the learning pass', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_replay_learn'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    resetAgentState({});
    __resetAutomationSeamsForTests();
    await automations.deleteMany({});
    await automations.insert({
      _id: AUTOMATION_ID, id: AUTOMATION_ID, name: 'listar', description: 'lista', steps: [],
      ownerUserId: OWNER, orgId: 'o1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
  });

  const noRecipe = vi.fn<Replay>(async () => ({ outcome: 'no-recipe', reason: 'never learned' }));

  it('arms the observer, compiles what the page fetched, and STORES it', async () => {
    const run = runObserving([EXCHANGE]);
    const { deps, put, appendCapturedCall } = storeSpies();
    const result = await runAutomationForAction(base, { ...deps, replay: noRecipe, run });

    expect(result.success).toBe(true);
    // The engine was ASKED to observe. Without this the whole spine is unreachable in production.
    expect(typeof run.mock.calls[0]![2]?.observeNetwork).toBe('function');

    expect(put).toHaveBeenCalledOnce();
    const draft = put.mock.calls[0]![3];
    expect(draft.injectedCalls).toHaveLength(1);
    // The run's own argument became a HOLE: that is what turns "the call this run made" into "the
    // call this action makes for any argument".
    expect(draft.injectedCalls[0]!.urlTemplate).toBe('https://portal.example/api/cases?ref={{input.ref}}');
    expect(draft.injectedCalls[0]!.headerNames).toContain('x-csrf-token');
    expect(draft.injectedCalls[0]!.idempotent).toBe(true);
    // The evidence lands too, under the same capture id the recipe points at.
    expect(appendCapturedCall).toHaveBeenCalled();
    expect(draft.capturedCallsRef).toBe('cap-1');
  });

  it('writes NOTHING when the pass captured no internal API call', async () => {
    // A DOM-only flow, or a run that never got past a login wall. Storing a zero-call recipe would
    // be storing a permanent "this action is DOM-only" that `putRecipe` then refuses to overwrite -
    // so the action could never learn again. Writing nothing keeps the next run's learning free.
    const run = runObserving([{ ...EXCHANGE, resourceType: 'document', contentType: 'text/html' }]);
    const { deps, put } = storeSpies();
    await runAutomationForAction(base, { ...deps, replay: noRecipe, run });
    expect(put).not.toHaveBeenCalled();
  });

  it('writes NOTHING when the run did not complete - the run status IS the goal gate', async () => {
    const run = vi.fn<Run>(async (_id, _ctx, options) => {
      options?.observeNetwork?.([EXCHANGE] as never);
      return { runId: 'run-2', status: 'failed', durationMs: 1, summary: 'stuck on the sign-in wall', lastStepIndex: 0 };
    });
    const { deps, put, supersede } = storeSpies();
    const result = await runAutomationForAction(base, { ...deps, replay: noRecipe, run });

    expect(result.success).toBe(false);
    expect(put).not.toHaveBeenCalled();
    expect(supersede).not.toHaveBeenCalled();
  });

  it('a store failure never turns a run that WORKED into a failure', async () => {
    const run = runObserving([EXCHANGE]);
    const { deps } = storeSpies();
    const result = await runAutomationForAction(base, {
      ...deps,
      replay: noRecipe,
      run,
      putRecipe: async () => { throw new Error('mongo said no'); },
    });
    expect(result.success).toBe(true);
    expect((result.data as { runId?: string }).runId).toBe('run-1');
  });
});

describe('runAutomationForAction - drift routes the compile through the SUPERSEDE', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_replay_heal'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    resetAgentState({});
    __resetAutomationSeamsForTests();
    await automations.deleteMany({});
    await automations.insert({
      _id: AUTOMATION_ID, id: AUTOMATION_ID, name: 'listar', description: 'lista', steps: [],
      ownerUserId: OWNER, orgId: 'o1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
  });

  const drifted = vi.fn<Replay>(async () => ({ outcome: 'drift', reason: 'replayed call 1 answered 404', recipeVersion: 1, failedIndex: 0 }));

  it('supersedes rather than putting, and carries the drift reason as the lineage payload', async () => {
    const run = runObserving([{ ...EXCHANGE, url: 'https://portal.example/api/v2/cases?ref=2024-1' }]);
    const { deps, put, supersede } = storeSpies();
    await runAutomationForAction(base, { ...deps, replay: drifted, run });

    expect(put).not.toHaveBeenCalled();
    expect(supersede).toHaveBeenCalledOnce();
    const next = supersede.mock.calls[0]![3];
    expect(next.reason).toBe('replayed call 1 answered 404');
    expect(next.injectedCalls[0]!.urlTemplate).toBe('https://portal.example/api/v2/cases?ref={{input.ref}}');
  });

  it('does NOT supersede after `unavailable` - a missing route is not a site that changed', async () => {
    const run = runObserving([EXCHANGE]);
    const { deps, put, supersede } = storeSpies();
    await runAutomationForAction(base, {
      ...deps,
      replay: async () => ({ outcome: 'unavailable', reason: 'no session', recipeVersion: 1 }),
      run,
    });
    // The recipe is still there, so the PUT will be refused by the store as `exists` - which is the
    // correct, lineage-preserving answer. What must not happen is a silent supersede.
    expect(supersede).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalledOnce();
  });

  /**
   * A RE-LEARNED WRITE NEVER GOES LIVE, AND THE ACTION'S ASSENT DOES NOT CHANGE THAT.
   *
   * The first cut passed the action-level `writeAssent` into the heal, so an owner's one answer
   * about an ACTION ("send_message may write") silently authorised whatever per-CALL set a later
   * pass happened to compile - a set no human has ever been shown. An assent has to cover what was
   * actually shown, and nothing in this slice shows a compiled call set to anybody. So the write
   * draft is refused on BOTH routes, and `writeAssent: true` is asserted here to make no difference
   * whatsoever: if it ever starts to, this test is what says so.
   */
  it('a re-learned recipe that WRITES never supersedes - the action\'s own assent does not authorise it', async () => {
    const write = { ...EXCHANGE, method: 'POST', requestBody: '{"ref":"2024-1"}' };
    const { deps, supersede } = storeSpies();
    await runAutomationForAction(base, { ...deps, replay: drifted, run: runObserving([write]) });
    expect(supersede).not.toHaveBeenCalled();

    // THE SAME, WITH THE ACTION APPROVED. An approval of the action is not an approval of this set.
    const { deps: deps2, supersede: supersede2 } = storeSpies();
    await runAutomationForAction({ ...base, writeAssent: true }, { ...deps2, replay: drifted, run: runObserving([write]) });
    expect(supersede2).not.toHaveBeenCalled();

    // …and the read half still heals, so the refusal is about the WRITE and not a dead heal path.
    const { deps: deps3, supersede: supersede3 } = storeSpies();
    await runAutomationForAction(base, { ...deps3, replay: drifted, run: runObserving([EXCHANGE]) });
    expect(supersede3).toHaveBeenCalledOnce();
  });

  /**
   * capture -> learn -> compile -> DISCARD, at BOTH ends of the lifecycle.
   *
   * Every learn writes a new captureId, so evidence that is never removed is evidence that grows
   * without bound - full request and response bodies, the most sensitive data this pipeline touches,
   * once per run of a recurring action, forever. Two things had to be collected, not one:
   *
   *   - the evidence behind the recipe a successful write REPLACED (below), and
   *   - the evidence a write that DID NOT LAND left with nothing pointing at it. That is not the
   *     rare case: `putRecipe` refuses to overwrite by design, so it is what most learns answer.
   */
  it('discards the evidence behind the recipe it REPLACED, and keeps the new one\'s', async () => {
    const { deps, supersede, discardCapture } = storeSpies();
    await runAutomationForAction(base, {
      ...deps,
      replay: drifted,
      run: runObserving([EXCHANGE]),
      // The action's CURRENT recipe points at the evidence of the pass that produced it.
      getRecipe: async () => ({ capturedCallsRef: 'cap-previous' }),
    });
    expect(supersede).toHaveBeenCalledOnce();
    // The OLD evidence goes…
    expect(discardCapture).toHaveBeenCalledOnce();
    expect(discardCapture.mock.calls[0]![0]).toEqual({
      orgId: 'o1', integrationKey: 'portal', actionName: 'list_cases', captureId: 'cap-previous',
    });
  });

  it('keeps the LIVE recipe\'s evidence when the new one did not go live, and collects the orphan it just wrote', async () => {
    const { deps, discardCapture } = storeSpies();
    await runAutomationForAction(base, {
      ...deps,
      replay: drifted,
      run: runObserving([EXCHANGE]),
      getRecipe: async () => ({ capturedCallsRef: 'cap-previous' }),
      // The store refuses the supersede: the old recipe is still the live one, so its evidence is
      // still the evidence for what is running.
      supersedeRecipe: (async () => ({ verdict: 'notfound' as const })) as never,
    });
    const discarded = discardCapture.mock.calls.map((c) => c[0].captureId);
    // THE LIVE RECIPE'S EVIDENCE SURVIVES - dropping it would destroy the only record of what is
    // actually running.
    expect(discarded).not.toContain('cap-previous');
    // …AND THE ORPHAN DOES NOT. The evidence has to be written before the recipe (the recipe points
    // INTO it), so a write that does not land otherwise leaves a whole pass's request and response
    // bodies with nothing referring to them and nothing that would ever collect them.
    expect(discarded).toEqual(['cap-1']);
  });

  it('collects the orphan on the FIRST-COMPILE route too, where a refused overwrite is the common case', async () => {
    const { deps, discardCapture } = storeSpies();
    await runAutomationForAction(base, {
      ...deps,
      replay: async () => ({ outcome: 'no-recipe', reason: 'never discovered' }),
      run: runObserving([EXCHANGE]),
      // `putRecipe` refuses to overwrite BY DESIGN, so `exists` is what every learn on an action
      // that already has a recipe and has not drifted answers - i.e. most learns this system does.
      putRecipe: (async () => ({ verdict: 'exists' as const, recipe: { version: 1 } })) as never,
      getRecipe: async () => ({}),
    });
    expect(discardCapture.mock.calls.map((c) => c[0].captureId)).toEqual(['cap-1']);
  });

  // ===========================================================================================
  // …AND ON THE EXIT THE COLLECTOR DID NOT HANDLE: A THROW.
  //
  // `putRecipe` does not merely ANSWER a verdict. Its persistence-boundary proof
  // (`assertCarriesNoValues`, `assertAnswerPointsAtACall`) THROWS - refusal rather than redaction is
  // that module's entire posture - and so does any store error. The throw propagates to the learn's
  // caller, which logs a warning and reports the run as the success it was, so an `if (!stored)`
  // collector after the write simply never ran.
  //
  // AND IT REPEATS: the refusal is decided from what the pass captured, so it is a property of the
  // pass. The recipe is never written, so `priorCaptureRef` finds nothing on the next run either,
  // and every run leaves a fresh pile. Proved end to end against the REAL store and a REAL refusal
  // in `discovery-replay-acceptance.test.ts`; pinned here at the seam, on both write routes.
  // ===========================================================================================
  it('collects the orphan when the write THROWS - the exit an `if (!stored)` cannot see', async () => {
    const { deps, discardCapture } = storeSpies();
    const result = await runAutomationForAction(base, {
      ...deps,
      replay: async () => ({ outcome: 'no-recipe', reason: 'never discovered' }),
      run: runObserving([EXCHANGE]),
      putRecipe: (async () => {
        throw new RecipeStoreError('UNSAFE', 'injectedCalls[1].urlTemplate contains a literal secret-shaped token (length 38)');
      }) as never,
      getRecipe: async () => ({}),
    });
    // The evidence WAS written, and then collected - so this is a collection and not a fixture that
    // wrote nothing.
    expect(deps.captures!.appendCapturedCall).toHaveBeenCalled();
    expect(discardCapture.mock.calls.map((c) => c[0].captureId)).toEqual(['cap-1']);
    // …and the run that WORKED is still a success. Learning is a by-product; that posture is
    // correct and is not what changed.
    expect(result.success).toBe(true);
  });

  it('…and on the SUPERSEDE route, where the same proof runs and the LIVE evidence must survive', async () => {
    const { deps, discardCapture } = storeSpies();
    await runAutomationForAction(base, {
      ...deps,
      replay: drifted,
      run: runObserving([EXCHANGE]),
      getRecipe: async () => ({ capturedCallsRef: 'cap-previous' }),
      supersedeRecipe: (async () => {
        throw new RecipeStoreError('UNSAFE', 'reason contains a live credential value from this run');
      }) as never,
    });
    const discarded = discardCapture.mock.calls.map((c) => c[0].captureId);
    // The orphan this pass wrote goes…
    expect(discarded).toEqual(['cap-1']);
    // …and the LIVE recipe's evidence stays: nothing was replaced, so `cap-previous` is still what
    // the recipe that is actually running was distilled from.
    expect(discarded).not.toContain('cap-previous');
  });

  it('does NOT discard the evidence this very pass just wrote', async () => {
    const { deps, discardCapture } = storeSpies();
    await runAutomationForAction(base, {
      ...deps,
      replay: drifted,
      run: runObserving([EXCHANGE]),
      // Same id as `captureId: () => 'cap-1'`: nothing to supersede, and dropping it would delete
      // what the recipe that just went live points at.
      getRecipe: async () => ({ capturedCallsRef: 'cap-1' }),
    });
    expect(discardCapture).not.toHaveBeenCalled();
  });

  // ===========================================================================================
  // …AND THE THIRD REMOVAL PATH: A CLEARED RECIPE.
  //
  // The two above are both WRITE paths. Clearing is the third way a recipe can go and it had no
  // collector at all: `clearRecipe` returned the dropped recipe and the mount narrowed it to a
  // boolean, so `capturedCallsRef` was never read. Nothing else can reach that pile afterwards -
  // the next learn's `priorCaptureRef` reads the CURRENT recipe, which is now absent - and the
  // collection has no TTL. It is routinely reachable: `arguments-uncovered` is the ordinary
  // listener shape, so two callers of one action with different argument sets orphan a fresh pile
  // on every cycle.
  // ===========================================================================================
  it('discards the evidence of the recipe it CLEARS, on the refusal path', async () => {
    const { deps, discardCapture } = storeSpies();
    await runAutomationForAction(base, {
      ...deps,
      // The narrow-recipe refusal: the ordinary listener shape, and the commonest way here.
      replay: async () => ({ outcome: 'arguments-uncovered', reason: 'no hole for since', recipeVersion: 3 }),
      run: runObserving([]),
      clearRecipe: async () => ({ version: 3, capturedCallsRef: 'cap-cleared' }),
    });
    expect(discardCapture).toHaveBeenCalledOnce();
    expect(discardCapture.mock.calls[0]![0]).toEqual({
      orgId: 'o1', integrationKey: 'portal', actionName: 'list_cases', captureId: 'cap-cleared',
    });
  });

  it('…and discards NOTHING when the recipe it cleared named no evidence', async () => {
    // THE CONTROL, and it is what stops the assertion above from being "the discard fires on every
    // clear". A recipe compiled by a build before `capturedCallsRef` existed names no pile, and
    // deleting a capture id that is not there would be a delete this code cannot justify.
    const { deps, discardCapture } = storeSpies();
    await runAutomationForAction(base, {
      ...deps,
      replay: async () => ({ outcome: 'arguments-uncovered', reason: 'no hole for since', recipeVersion: 3 }),
      run: runObserving([]),
      clearRecipe: async () => ({ version: 3 }),
    });
    expect(discardCapture).not.toHaveBeenCalled();
  });

  it('…and discards nothing when there was no recipe to clear at all', async () => {
    const { deps, discardCapture } = storeSpies();
    await runAutomationForAction(base, {
      ...deps,
      replay: async () => ({ outcome: 'write-gate', blocked: 'POST /x', recipeVersion: 3 }),
      run: runObserving([]),
      clearRecipe: async () => null,
    });
    expect(discardCapture).not.toHaveBeenCalled();
  });

  it('a FIRST compile that writes is not stored either - neither route may author a write', async () => {
    const write = { ...EXCHANGE, method: 'POST', requestBody: '{"ref":"2024-1"}' };
    const { deps, put, supersede } = storeSpies();
    // No drift: this is the ordinary `putRecipe` route.
    const result = await runAutomationForAction(base, {
      ...deps,
      replay: async () => ({ outcome: 'no-recipe', reason: 'never discovered' }),
      run: runObserving([write]),
    });
    expect(put).not.toHaveBeenCalled();
    expect(supersede).not.toHaveBeenCalled();
    // The RUN itself still succeeded - refusing to learn is not refusing to work.
    expect(result.success).toBe(true);
  });
});

// =============================================================================================
// THE READ-LEARNS-A-WRITE SHAPE. The worst failure this spine can have: an action that exists to
// write learns the READS the discovery pass happened to watch underneath it, and every later run
// replays those reads, answers `ok`, and reports SUCCESS while the write never happens. Nobody
// finds out until somebody looks at the far system.
//
// Both refusals are here, because either one alone is a half-measure: the LEARN must not write such
// a recipe down, and the REPLAY must not run one it finds (an older build's, or an action
// re-declared `mutates` after it was learned).
// =============================================================================================
describe('runAutomationForAction - a recipe may not be a SUBSET of its action', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_replay_coverage'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    resetAgentState({});
    __resetAutomationSeamsForTests();
    await automations.deleteMany({});
    await automations.insert({
      _id: AUTOMATION_ID, id: AUTOMATION_ID, name: 'submeter', description: 'submete', steps: [],
      ownerUserId: OWNER, orgId: 'o1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
  });

  /** The realistic capture of a WRITE action's pass: the site's own JSON reads, and no sign of the
   *  write itself - it was a form post, or answered HTML, or carried a login-shaped body the compile
   *  drops. This is the ordinary case, not a contrived one. */
  const READS_ONLY = [EXCHANGE];

  it('does NOT store a read-only recipe for an action declared as writing', async () => {
    const { deps, put, supersede } = storeSpies();
    const result = await runAutomationForAction(
      { ...base, mutates: true, writeAssent: true },
      { ...deps, replay: async () => ({ outcome: 'no-recipe', reason: 'never discovered' }), run: runObserving(READS_ONLY) },
    );
    expect(put).not.toHaveBeenCalled();
    expect(supersede).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('…and DOES store the same recipe for the same pass when the action is a READ', async () => {
    // THE CONTROL. Without it "nothing was stored" would also hold for a harness in which nothing
    // is ever stored, and the refusal above would be indistinguishable from a broken fixture.
    const { deps, put } = storeSpies();
    await runAutomationForAction(
      { ...base, mutates: false },
      { ...deps, replay: async () => ({ outcome: 'no-recipe', reason: 'never discovered' }), run: runObserving(READS_ONLY) },
    );
    expect(put).toHaveBeenCalledOnce();
  });

  it('CLEARS a read-only recipe it finds on a writing action and runs the action instead', async () => {
    const { deps } = storeSpies();
    const clearRecipe = vi.fn(async () => ({ version: 4 }));
    const run = runObserving([]);
    const result = await runAutomationForAction(
      { ...base, mutates: true, writeAssent: true },
      {
        ...deps,
        clearRecipe,
        run,
        replay: async () => ({ outcome: 'does-not-cover', reason: 'no write in it', recipeVersion: 4 }),
      },
    );
    // THE POINT: the automation - the path that actually performs the write - ran.
    expect(run).toHaveBeenCalledOnce();
    expect((result.data as { replayed?: boolean }).replayed).toBeUndefined();
    expect(result.success).toBe(true);
    // …and the recipe that can never run is gone, so it costs no doomed attempt on the next run.
    expect(clearRecipe).toHaveBeenCalledOnce();
  });

  it('does not re-learn the recipe it just cleared - the refusal settles instead of thrashing', async () => {
    const { deps, put, supersede } = storeSpies();
    await runAutomationForAction(
      { ...base, mutates: true, writeAssent: true },
      {
        ...deps,
        clearRecipe: async () => ({ version: 4 }),
        run: runObserving(READS_ONLY),
        replay: async () => ({ outcome: 'does-not-cover', reason: 'no write in it', recipeVersion: 4 }),
      },
    );
    expect(put).not.toHaveBeenCalled();
    expect(supersede).not.toHaveBeenCalled();
  });

  it('does NOT route `does-not-cover` through the heal - re-learning would produce the same recipe', async () => {
    const { deps, supersede } = storeSpies();
    await runAutomationForAction(
      { ...base, mutates: false },
      {
        ...deps,
        clearRecipe: async () => ({ version: 4 }),
        run: runObserving(READS_ONLY),
        replay: async () => ({ outcome: 'does-not-cover', reason: 'no write in it', recipeVersion: 4 }),
      },
    );
    expect(supersede).not.toHaveBeenCalled();
  });
});

// =============================================================================================
// THE THREE PLACES THIS SPINE PROVES A CREDENTIAL DID NOT SURVIVE, EACH REACHED THROUGH THE REAL
// THING IT PROTECTS.
//
// Every one of them takes the run's `SecretRegistry` as a parameter, and every one of them was
// wired by a single line that no test could kill: the suites asserted that the registry was HANDED
// OVER (a statement about a function call) and never that a value was REFUSED because of it. Delete
// the parameter at any of the three hops and every suite stayed green, which is the worst shape a
// safety check can have - it reads as covered.
//
// So the three below assert CONSEQUENCES, against real stores and a real mount:
//
//   1. the resolved URL check (`assertNoCredentialRodeIn`), two hops down from the run;
//   2. the evidence store's last gate (`assertNoLiveSecret`);
//   3. the recipe store's persistence-boundary proof (`assertCarriesNoValues`).
//
// Each has a CONTROL beside it, because "nothing was stored" is also what a broken harness says.
// =============================================================================================
describe('the run\'s live credential values reach every check that takes them', () => {
  /** Composed at run time - no credential-shaped literal exists in this file. Deliberately LOW
   *  ENTROPY: the shape rules (`looksLikeLiteralSecret`, the header-name grammar) cannot see it, so
   *  the only thing that can is the registry. That is exactly the case those legs document. */
  const LIVE = ['sessao', 'do', 'portal', String(2024)].join('-');

  let recipes: IntegrationRecipeStore;
  let captures: CapturedCallsStore;
  let definitions: IntegrationDefinitionStore;
  let clock = 0;

  beforeAll(() => bootAgentTestDb('ekoa_automation_replay_secrets'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    resetAgentState({});
    __resetAutomationSeamsForTests();
    clock = 0;
    const now = () => new Date(1_700_000_000_000 + clock++);
    recipes = new IntegrationRecipeStore(integrationDefinitions, now);
    captures = new CapturedCallsStore(integrationCapturedCalls, now);
    definitions = new IntegrationDefinitionStore(integrationDefinitions, now);
    await integrationDefinitions.deleteMany({});
    await integrationCapturedCalls.deleteMany({});
    await automations.deleteMany({});
    await automations.insert({
      _id: AUTOMATION_ID, id: AUTOMATION_ID, name: 'listar', description: 'lista', steps: [],
      ownerUserId: OWNER, orgId: 'o1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
    await definitions.create({
      orgId: 'o1',
      userId: OWNER,
      key: 'portal',
      visibility: 'org',
      authType: 'none',
      configSchema: [],
      actions: [{
        actionName: 'list_cases',
        description: 'lista os processos',
        mutates: false,
        automationBinding: { automationId: AUTOMATION_ID },
      }],
      skillMd: '# portal\n',
    }, { actor: { userId: OWNER, orgId: 'o1', role: 'user' } });
  });

  // -------------------------------------------------------------------------------------------
  // 1. THE RESOLVED URL. Two hops from `runAutomationForAction`: it builds the registry, the mount
  //    forwards it, the executor proves with it. The middle hop had no test at all.
  // -------------------------------------------------------------------------------------------
  describe('a credential that rode in on an ARGUMENT never reaches the page', () => {
    function daemon(): { frames: Array<{ url: string }>; conn: unknown } {
      const frames: Array<{ url: string }> = [];
      return {
        frames,
        conn: {
          runStep: async (frame: { input?: unknown }) => {
            const input = (frame.input ?? {}) as Record<string, unknown>;
            if (input.leaseOp === 'release') return { ok: true as const };
            const call = input.injectedCall as { url: string } | undefined;
            if (!call) return { ok: true as const, observation: { data: {} } };
            frames.push({ url: call.url });
            return {
              ok: true as const,
              observation: {
                data: {
                  url: 'https://portal.example/cases',
                  injectedCall: { status: 200, ok: true, bodyText: '{"items":[{"id":1}]}', contentType: 'application/json', responseHeaderNames: ['content-type'] },
                },
              },
            };
          },
        },
      };
    }

    async function replayThroughTheRealMount(args: Record<string, unknown>, credentialFields: Record<string, unknown>) {
      await recipes.putRecipe('o1', 'portal', 'list_cases', {
        goal: 'replay of portal/list_cases',
        injectedCalls: [{
          method: 'GET',
          urlTemplate: 'https://portal.example/api/cases?ref={{input.ref}}',
          headerNames: ['x-csrf-token'],
          idempotent: true,
        }],
        scriptedSteps: [],
        lessons: [],
      }, {});
      const machine = daemon();
      setDaemonConnectionResolver(() => machine.conn as never);
      // NO `deps.replay`: the REAL `replayIntegrationAction` runs, so the forward from the mount
      // into the executor is on the path under test rather than stubbed past.
      const result = await runAutomationForAction(
        { ...base, args, credentialFields },
        { run: runObserving([]), putRecipe: (async () => ({ verdict: 'exists' as const, recipe: { version: 1 } })) as never, captures: { appendCapturedCall: async () => ({ verdict: 'ok' as const }), discardCapture: async () => 0 } as never },
      );
      return { result, frames: machine.frames };
    }

    it('REFUSES the call and falls through to the automation', async () => {
      const { result, frames } = await replayThroughTheRealMount({ ref: LIVE }, { token: LIVE });
      // THE CONSEQUENCE: the machine was never asked to make the call, so the credential never
      // reached the site's query string (and its logs).
      expect(frames).toEqual([]);
      // …and the action still worked, by the path it worked by before it ever learned anything.
      expect(result.success).toBe(true);
      expect((result.data as { replayed?: boolean }).replayed).toBeUndefined();
      expect((result.data as { runId?: string }).runId).toBeTruthy();
    });

    it('…and sends the very same call when the argument is NOT a live credential', async () => {
      // THE CONTROL. It proves the refusal above is about the value and not about a harness that
      // cannot send a frame at all.
      const { result, frames } = await replayThroughTheRealMount({ ref: '2024-1' }, { token: LIVE });
      expect(frames.map((f) => f.url)).toEqual(['https://portal.example/api/cases?ref=2024-1']);
      expect((result.data as { replayed?: boolean }).replayed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------------------------
  // 2 + 3. THE TWO STORES. A live credential can reach a compiled recipe through a field the
  //        redaction pass does not scan: header NAMES are never redacted (they are names), and a
  //        low-entropy credential is a valid RFC 7230 token, so both shape rules pass it. That is
  //        precisely the case both stores' registry legs are documented to exist for.
  // -------------------------------------------------------------------------------------------
  describe('a live value wearing a header NAME is refused by both stores', () => {
    const poisoned = { ...EXCHANGE, requestHeaderNames: ['accept', LIVE] };

    async function learnFrom(exchange: unknown) {
      return runAutomationForAction(
        { ...base, credentialFields: { token: LIVE } },
        {
          replay: async () => ({ outcome: 'no-recipe', reason: 'never discovered' }),
          run: runObserving([exchange]),
          putRecipe: (o, k, a, draft, opts) => recipes.putRecipe(o, k, a, draft, opts),
          captures,
          captureId: () => 'cap-1',
        },
      );
    }

    it('stores NEITHER the recipe nor the evidence, and the run still succeeds', async () => {
      const result = await learnFrom(poisoned);
      expect(result.success).toBe(true);
      expect(await recipes.getRecipe('o1', 'portal', 'list_cases')).toBeNull();
      expect(await captures.listCapture({ orgId: 'o1', integrationKey: 'portal', actionName: 'list_cases', captureId: 'cap-1' })).toEqual([]);
    });

    it('…and stores BOTH for the identical pass with an ordinary header name', async () => {
      // THE CONTROL, and it is what makes the two assertions above mean anything: the same pipeline,
      // the same registry, one character of difference in what the machine reported.
      const result = await learnFrom({ ...EXCHANGE, requestHeaderNames: ['accept', 'x-csrf-token'] });
      expect(result.success).toBe(true);
      const recipe = await recipes.getRecipe('o1', 'portal', 'list_cases');
      expect(recipe!.injectedCalls[0]!.headerNames).toContain('x-csrf-token');
      expect(await captures.listCapture({ orgId: 'o1', integrationKey: 'portal', actionName: 'list_cases', captureId: 'cap-1' })).toHaveLength(1);
    });

    // -----------------------------------------------------------------------------------------
    // …AND THE OTHER WRITE ROUTE, WHICH WAS COVERED BY NOTHING.
    //
    // A recipe reaches the store two ways: `putRecipe` on a first compile (above) and
    // `supersedeRecipe` on a heal. Both take the run's registry and both refuse on it. Only the
    // first was pinned against the real store: `self-heal.test.ts` covers the heal by asserting
    // that the registry was PASSED to a fake `supersedeRecipe` that answers a canned success - so
    // the real store could ignore `opts.secrets` on the supersede path entirely and every suite in
    // this repo stayed green, with a live credential landing in a stored recipe.
    //
    // That is the difference between "the argument was handed over" and "the refusal happens", and
    // only the second is a control. Same poisoned pass, same registry, the OTHER route.
    // -----------------------------------------------------------------------------------------
    describe('…including on the SUPERSEDE route, which is the other way a recipe is written', () => {
      /** Plant a clean recipe so the heal has something to supersede - `supersedeRecipe` answers
       *  `notfound` for an action that has never learned, and a refusal for the wrong reason is no
       *  evidence at all. */
      async function plantV1(): Promise<void> {
        const written = await recipes.putRecipe('o1', 'portal', 'list_cases', {
          goal: 'replay of portal/list_cases',
          injectedCalls: [{
            method: 'GET',
            urlTemplate: 'https://portal.example/api/cases?ref={{input.ref}}',
            headerNames: ['x-csrf-token'],
            idempotent: true,
          }],
          scriptedSteps: [],
          lessons: [],
        }, {});
        expect(written.verdict).toBe('ok');
      }

      /** The DRIFT route: a `drift` outcome sets `driftReason`, which is what sends the compile
       *  through `healDriftedRecipe` -> `supersedeRecipe` instead of `putRecipe`. */
      async function healFrom(exchange: unknown) {
        return runAutomationForAction(
          { ...base, credentialFields: { token: LIVE } },
          {
            replay: async () => ({ outcome: 'drift', reason: 'replayed call 1 answered 404', recipeVersion: 1, failedIndex: 0 }),
            run: runObserving([exchange]),
            supersedeRecipe: (o, k, a, next, opts) => recipes.supersedeRecipe(o, k, a, next, opts ?? {}),
            captures,
            captureId: () => 'cap-2',
          },
        );
      }

      it('refuses the SUPERSEDE, leaving the live recipe at v1 and its evidence unwritten', async () => {
        await plantV1();
        const result = await healFrom(poisoned);
        expect(result.success).toBe(true);
        // NOT superseded: the version did not move and the poisoned header name is nowhere.
        const recipe = await recipes.getRecipe('o1', 'portal', 'list_cases');
        expect(recipe!.version).toBe(1);
        expect(JSON.stringify(recipe)).not.toContain(LIVE);
        expect(await captures.listCapture({ orgId: 'o1', integrationKey: 'portal', actionName: 'list_cases', captureId: 'cap-2' })).toEqual([]);
      });

      it('…and DOES supersede for the identical pass with an ordinary header name', async () => {
        // THE CONTROL for the route: same drift, same registry, one character different.
        await plantV1();
        const result = await healFrom({ ...EXCHANGE, requestHeaderNames: ['accept', 'x-csrf-token'] });
        expect(result.success).toBe(true);
        const recipe = await recipes.getRecipe('o1', 'portal', 'list_cases');
        expect(recipe!.version).toBe(2);
        expect(recipe!.supersedes?.version).toBe(1);
      });
    });
  });
});

describe('runAutomationForAction - the write assent is carried, never invented', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_replay_assent'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    resetAgentState({});
    __resetAutomationSeamsForTests();
    await automations.deleteMany({});
    await automations.insert({
      _id: AUTOMATION_ID, id: AUTOMATION_ID, name: 'listar', description: 'lista', steps: [],
      ownerUserId: OWNER, orgId: 'o1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
  });

  it.each([
    ['absent', undefined],
    ['false', false],
    ['true', true],
  ])('hands the replay exactly the assent it was given (%s)', async (_label, writeAssent) => {
    const replay = vi.fn<Replay>(async () => ({ outcome: 'no-recipe', reason: 'x' }));
    await runAutomationForAction(
      { ...base, ...(writeAssent !== undefined ? { writeAssent } : {}) },
      { replay, run: runObserving([]) },
    );
    expect(replay.mock.calls[0]![0].writeAssent).toBe(writeAssent);
  });

  it.each([
    ['absent', undefined],
    ['false', false],
    ['true', true],
  ])('carries it ACROSS THE SEAM `server.ts` binds, unchanged (%s)', async (_label, writeAssent) => {
    // Through `automationBackedActionHandler` - the production mapping - rather than around it.
    // The mapping is where a field silently stops crossing, and dropping `writeAssent` there would
    // leave every other test in this file green while the replay's write gate lost its key.
    const replay = vi.fn<Replay>(async () => ({ outcome: 'no-recipe', reason: 'x' }));
    const handler = automationBackedActionHandler({ replay, run: runObserving([]) });
    await handler({
      binding: base.binding,
      args: base.args,
      credentialFields: {},
      orgId: base.orgId,
      ownerUserId: base.ownerUserId,
      integrationKey: base.integrationKey,
      actionName: base.actionName,
      ...(writeAssent !== undefined ? { writeAssent } : {}),
    });
    expect(replay.mock.calls[0]![0].writeAssent).toBe(writeAssent);
  });

  it('carries the ACTION IDENTITY across the seam too - without it nothing is learned or replayed', async () => {
    const replay = vi.fn<Replay>(async () => ({ outcome: 'no-recipe', reason: 'x' }));
    const handler = automationBackedActionHandler({ replay, run: runObserving([]) });
    await handler({
      binding: base.binding,
      args: base.args,
      credentialFields: {},
      orgId: base.orgId,
      ownerUserId: base.ownerUserId,
      integrationKey: 'portal',
      actionName: 'list_cases',
    });
    expect(replay).toHaveBeenCalledOnce();
    expect(replay.mock.calls[0]![0]).toMatchObject({ integrationKey: 'portal', actionName: 'list_cases' });
  });

  /**
   * `mutates` IS READ FAIL-CLOSED AT THIS SEAM, and that reading is OBSERVABLE here or nowhere.
   *
   * `runAutomationForAction` normalises it once - `input.mutates !== false`, the repo's one reading
   * of the field (`integrations/action-consent.ts`) - and hands everything below a definite boolean.
   * Inverting that line to `=== true` left 564 tests green, because the ONLY shipped caller of this
   * seam already normalises through `actionRequiresConsent` and therefore always passes a boolean:
   * `true` and `false` read identically either way, so the mutant was equivalent.
   *
   * The one input that separates them is an ABSENT `mutates`, which the seam's own type explicitly
   * permits (Rule 7: an added field may not change an existing implementer) and documents as the
   * pre-P2 caller shape. This pins that contract:
   *
   *   - the replay is told the action WRITES, so a read-only recipe cannot answer for it;
   *   - nothing is learned, so no recorder is armed on a run whose recipe could never be stored.
   *
   * SAID PLAINLY: no shipped caller omits the field today, so this is the OPTIONAL FIELD'S CONTRACT
   * rather than a live production path. It is worth pinning precisely because the alternative -
   * "absent means not-a-write" - is the read-learns-a-write hole from the other side, and because
   * the field is optional at this seam and will stay so.
   */
  it('reads an ABSENT `mutates` as a WRITE at the seam - the fail-closed contract of the optional field', async () => {
    const replay = vi.fn<Replay>(async () => ({ outcome: 'no-recipe', reason: 'x' }));
    const run = runObserving([EXCHANGE]);
    const { deps, put } = storeSpies();
    const handler = automationBackedActionHandler({ ...deps, replay, run });

    const result = await handler({
      binding: base.binding,
      args: base.args,
      credentialFields: {},
      orgId: base.orgId,
      ownerUserId: base.ownerUserId,
      integrationKey: base.integrationKey,
      actionName: base.actionName,
      // NO `mutates`. The caller that predates the field.
    });

    expect(result.success).toBe(true);
    expect(replay.mock.calls[0]![0].mutates).toBe(true);
    // …and therefore no learning pass: `storable` is false, so the recorder is never armed and
    // nothing is written down. With `=== true` this run would arm the machine's recorder - which
    // holds the live header VALUES of an authenticated session while armed - and store a recipe.
    expect(run.mock.calls[0]![2]?.observeNetwork).toBeUndefined();
    expect(put).not.toHaveBeenCalled();
  });

  it('hands the replay a registry built from THIS run\'s credential values', async () => {
    // The proof that no credential rode into a resolved URL was inert until the mount passed one.
    const replay = vi.fn<Replay>(async () => ({ outcome: 'no-recipe', reason: 'x' }));
    await runAutomationForAction(
      { ...base, credentialFields: { token: 'live-token-value-9f2' } },
      { replay, run: runObserving([]) },
    );
    const secrets = replay.mock.calls[0]![0].secrets;
    expect(secrets).toBeDefined();
    expect(secrets!.redact('carrying live-token-value-9f2 here')).not.toContain('live-token-value-9f2');
  });
});

// =============================================================================================
// THE ANSWER. A replay must be indistinguishable from the run it replaces, and the answer is the
// half of that a caller actually consumes. Nothing correlated the compiled calls with the answer
// the run gave: the replay returned `calls[calls.length - 1].body`, where "last" is the order the
// page's own responses COMPLETED in. So one ordinary extra internal call under a flow silently
// changed what the action returned, with `success: true`.
// =============================================================================================
describe('runAutomationForAction - the recipe records WHICH call is the answer', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_replay_answer'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    resetAgentState({});
    __resetAutomationSeamsForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
    await automations.insert({
      _id: AUTOMATION_ID, id: AUTOMATION_ID, name: 'listar', description: 'lista', steps: [],
      ownerUserId: OWNER, orgId: 'o1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
  });

  const noRecipe = vi.fn<Replay>(async () => ({ outcome: 'no-recipe', reason: 'never learned' }));

  /**
   * A run that succeeded, observed `captures`, AND left a real run record whose last step carries
   * `answer` as its output - which is where `extractActionRunOutput` reads an action's answer from.
   *
   * The record's step output is typed as the engine's own `StepOutput`, so a fixture that drifts
   * from what the engine actually writes is a compile error rather than a quietly green test.
   */
  function runAnswering(captures: unknown[], answer: unknown): ReturnType<typeof vi.fn<Run>> {
    return vi.fn<Run>(async (_id, _ctx, options) => {
      options?.observeNetwork?.(captures as never);
      const output: StepOutput = {
        kind: 'api_call',
        status: 200,
        responseHeaders: {},
        responseBody: JSON.stringify(answer),
        responseBodyIsJson: true,
        truncated: false,
        durationMs: 1,
      };
      await automationRuns.insert({
        _id: 'run-answer', id: 'run-answer', automationId: AUTOMATION_ID, status: 'completed',
        steps: [{ stepId: 's1', index: 0, description: 'collect', status: 'completed', output }],
      } as never);
      return { runId: 'run-answer', status: 'completed', durationMs: 1, summary: 'ok', lastStepIndex: 0 };
    });
  }

  /** The badge: an ordinary second internal call that FINISHES LAST and is not the answer. */
  const BADGE = {
    ...EXCHANGE,
    url: 'https://portal.example/api/badge',
    responseBody: '{"unread":7}',
  };

  it('names the call whose body the RUN answered with, not the one that finished last', async () => {
    const { deps, put } = storeSpies();
    const answer = { items: [{ id: 41 }] }; // === EXCHANGE.responseBody, and NOT the badge's
    await runAutomationForAction(base, { ...deps, replay: noRecipe, run: runAnswering([EXCHANGE, BADGE], answer) });

    expect(put).toHaveBeenCalledOnce();
    const draft = put.mock.calls[0]![3];
    // BOTH calls are in the recipe - the badge is a real call the page makes and replaying it is
    // harmless. What must not happen is it becoming the ANSWER.
    expect(draft.injectedCalls.map((c) => c.urlTemplate)).toEqual([
      'https://portal.example/api/cases?ref={{input.ref}}',
      'https://portal.example/api/badge',
    ]);
    expect(draft.answersWith).toEqual({ callIndex: 0, matchedBy: 'run-output-identity' });
  });

  it('names NOTHING when the run answered nothing - and that is what the replay then answers', async () => {
    // The shipped shape: a browser-only automation has no `api_call`/`ekoa_action` step, so
    // `extractActionRunOutput` finds no answer. A recipe that named one anyway would make the
    // replayed run answer something the automation never did.
    const { deps, put } = storeSpies();
    await runAutomationForAction(base, { ...deps, replay: noRecipe, run: runObserving([EXCHANGE, BADGE]) });

    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0]![3].answersWith).toBeUndefined();
  });

  it('REFUSES to learn when no captured call produced the run\'s answer', async () => {
    // The run answered something assembled from the page (an extraction, a reshape, a join). No
    // replay of these calls can reproduce it, so a recipe would answer with SOME OTHER call's body
    // under the same `success: true` - the one failure a caller cannot see. Refusing costs the
    // optimisation forever; learning costs the answer.
    const { deps, put, appendCapturedCall } = storeSpies();
    const result = await runAutomationForAction(
      base,
      { ...deps, replay: noRecipe, run: runAnswering([EXCHANGE, BADGE], { processos: ['reshaped by the run'] }) },
    );

    expect(result.success).toBe(true); // the RUN is fine; only the learning is declined
    expect(put).not.toHaveBeenCalled();
    // …and nothing durable is left behind for a recipe that was never written.
    expect(appendCapturedCall).not.toHaveBeenCalled();
  });

  /**
   * THE SUMMARY: a constant endpoint serving the SAME document as the filtered search.
   *
   * Not contrived - a portal's dashboard/default-view endpoint, or a detail pane showing the row
   * the search just returned. Because the bodies are identical `isTheRunsAnswer` matches BOTH, and
   * last-match-wins names this one, which has no hole at all.
   */
  const CONSTANT_SUMMARY = { ...EXCHANGE, url: 'https://portal.example/api/summary' };

  it('REFUSES to learn when the ANSWER-BEARING call cannot carry this run\'s arguments', async () => {
    // `ref` IS placed - by the search - so the recipe-wide coverage rule saw nothing missing and the
    // compile stored `answersWith.callIndex = 1`. Every later caller was then handed the 2024-1
    // document as the answer to their own question, under `success: true, replayed: true`, with no
    // drift (both calls still 200 with an unchanged shape) and nothing that would ever clear it.
    const { deps, put, appendCapturedCall } = storeSpies();
    const result = await runAutomationForAction(
      base,
      { ...deps, replay: noRecipe, run: runAnswering([EXCHANGE, CONSTANT_SUMMARY], { items: [{ id: 41 }] }) },
    );

    expect(result.success).toBe(true); // the RUN is fine; only the learning is declined
    expect(put).not.toHaveBeenCalled();
    expect(appendCapturedCall).not.toHaveBeenCalled();
  });

  it('…and DOES learn the same two calls when the answer is the one carrying the argument', async () => {
    // THE CONTROL. Same pass, same arguments, same hole-free summary; the only difference is that
    // the summary now has a body of its own, so the answer is unambiguously the search.
    const { deps, put } = storeSpies();
    const distinctSummary = { ...CONSTANT_SUMMARY, responseBody: '{"open":3}' };
    await runAutomationForAction(
      base,
      { ...deps, replay: noRecipe, run: runAnswering([EXCHANGE, distinctSummary], { items: [{ id: 41 }] }) },
    );

    expect(put).toHaveBeenCalledOnce();
    const draft = put.mock.calls[0]![3];
    // The hole-free summary is still IN the recipe - this rule is about the answer, not a filter.
    expect(draft.injectedCalls).toHaveLength(2);
    expect(draft.answersWith).toEqual({ callIndex: 0, matchedBy: 'run-output-identity' });
  });
});

// =============================================================================================
// BOUNDS. The machine's recorder is bounded per lease because "an unbounded recorder attached to a
// long headed session is a memory leak on somebody's laptop" (`clients/bridge/src/browser/
// capture.ts`). The hosted mirror had no bound at any hop, and it is not somebody's laptop - it is
// the API process every tenant shares, fed once per frame for the length of a run.
// =============================================================================================
describe('runAutomationForAction - the hosted capture path is bounded at every hop', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_replay_bounds'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    resetAgentState({});
    __resetAutomationSeamsForTests();
    await automations.deleteMany({});
    await automations.insert({
      _id: AUTOMATION_ID, id: AUTOMATION_ID, name: 'listar', description: 'lista', steps: [],
      ownerUserId: OWNER, orgId: 'o1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
  });

  const noRecipe = vi.fn<Replay>(async () => ({ outcome: 'no-recipe', reason: 'never learned' }));

  /** `count` distinct internal API calls, numbered so which ones survived is observable. */
  const manyExchanges = (count: number) =>
    Array.from({ length: count }, (_, n) => ({ ...EXCHANGE, url: `https://portal.example/api/cases?ref=2024-1&n=${n}` }));

  it('keeps the NEWEST exchanges of a long pass and drops the oldest, rather than growing forever', async () => {
    const { deps, put } = storeSpies();
    const total = MAX_RUN_CAPTURED_EXCHANGES + 100;
    // Delivered in batches, the way the engine drains one frame at a time.
    const run = vi.fn<Run>(async (_id, _ctx, options) => {
      for (const x of manyExchanges(total)) options?.observeNetwork?.([x] as never);
      return { runId: 'run-1', status: 'completed', durationMs: 1, summary: 'ok', lastStepIndex: 0 };
    });
    await runAutomationForAction(base, { ...deps, replay: noRecipe, run });

    const draft = put.mock.calls[0]![3];
    // The compile takes the FIRST distinct calls of what it is handed, so which ones appear says
    // exactly which window survived: with the bound, the head is exchange #100 (the oldest 100 were
    // dropped); without it, exchange #0 - and 500 exchanges of request+response bodies were resident
    // in the shared process, which is what the bound is actually about.
    expect(draft.injectedCalls[0]!.urlTemplate).toContain(`n=${total - MAX_RUN_CAPTURED_EXCHANGES}`);
    expect(draft.injectedCalls.map((c) => c.urlTemplate).join()).not.toContain('n=0&');
  });

  it('persists only the exchanges that could matter, bounded - not one document per request', async () => {
    const { deps, appendCapturedCall } = storeSpies();
    // A heavy page: a few internal API calls buried in navigations and non-JSON responses. Only the
    // first kind can ever become a recipe call - the compile's own filter - so only that kind is
    // evidence of anything.
    const noise = Array.from({ length: 40 }, (_, n) => ({ ...EXCHANGE, resourceType: 'document', url: `https://portal.example/page/${n}` }));
    const api = manyExchanges(MAX_PERSISTED_EVIDENCE + 20);
    // ORDER MATTERS, and the obvious order makes this test unfailable. persistEvidence keeps the
    // NEWEST MAX_PERSISTED_EVIDENCE, so with the noise FIRST the surviving window is all api calls
    // whether or not the filter ran, and both assertions below hold against a deleted filter. The
    // noise goes LAST so it competes for the window and only the filter can keep it out.
    await runAutomationForAction(base, { ...deps, replay: noRecipe, run: runObserving([...api, ...noise]) });

    expect(appendCapturedCall).toHaveBeenCalledTimes(MAX_PERSISTED_EVIDENCE);
    const written = appendCapturedCall.mock.calls.map((c) => c[2].url);
    expect(written.every((u) => u.includes('/api/cases'))).toBe(true);
    expect(written.some((u) => u.includes('/page/'))).toBe(false);
  });
});
