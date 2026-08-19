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
import { runAutomationForAction, automationBackedActionHandler, type ActionRunDeps } from '../../src/automation/service.js';
import type { replayIntegrationAction } from '../../src/automation/replay-action.js';
import type { runAutomation } from '../../src/automation/engine.js';
import type { RecipeDraft } from '../../src/integrations/recipe-store.js';
import { automations } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState } from '../agents/_setup.js';
import { __resetAutomationSeamsForTests } from '../../src/automation/seams.js';

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
  const appendCapturedCall = vi.fn(async () => ({ verdict: 'ok' as const }));
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
    expect(result.data).toEqual({ replayed: true, recipeVersion: 7, output: { items: [{ id: 41 }] } });
    expect(run).not.toHaveBeenCalled();
    expect(replay).toHaveBeenCalledOnce();
    expect(replay.mock.calls[0]![0]).toMatchObject({ orgId: 'o1', integrationKey: 'portal', actionName: 'list_cases', args: { ref: '2024-1' } });
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
    const clearRecipe = vi.fn(async () => true);
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
   * capture -> learn -> compile -> DISCARD. `discardCapture` had no production caller at all, so
   * every learn wrote a new captureId and none was ever removed: a recurring action accumulated
   * full request/response bodies - the most sensitive data this pipeline touches - forever.
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

  it('does NOT discard when the new recipe did not go live - that would destroy the only record', async () => {
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
    expect(discardCapture).not.toHaveBeenCalled();
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
