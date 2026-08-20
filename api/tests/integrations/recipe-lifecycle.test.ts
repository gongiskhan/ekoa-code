import { describe, it, expect, vi } from 'vitest';
import { forgetRecipe, type ForgetRecipeDeps } from '../../src/integrations/recipe-lifecycle.js';
import { discardEvidenceOfRemovedRecipes, type CaptureKey } from '../../src/integrations/captured-calls-store.js';

/**
 * THE CLEAR AND ITS EVIDENCE, and the shared pairing every removal path reaches. The invariant is
 * one sentence: nothing durable outlives the thing it is evidence for.
 *
 * WHAT THIS FILE IS AND IS NOT. It pins the DECISIONS - which clear leads to which discard, the key
 * the discard is asked for, and the failure posture when a discard throws. That the REAL callers
 * reach them, against REAL stores, is proved where those callers live. The four removal paths are
 * enumerated in `src/integrations/recipe-lifecycle.ts`'s header; each is proved here:
 *   1. the clear - the run loop's refusal path: `tests/automation/replay-mount.test.ts` (the seam)
 *      and `tests/automation/discovery-replay-acceptance.test.ts` (the real store, the real default
 *      `clearRecipe`, the real captures collection asserted empty after the clear); the owner's
 *      route: `tests/contract/integrations-recipes.test.ts`;
 *   2. the supersede, and 3. the write that never lands (INCLUDING a throw):
 *      `tests/automation/replay-mount.test.ts` at the seam, and the acceptance against real stores
 *      with a real store refusal;
 *   4. the action set rewritten by `create(onConflict: 'replace')`:
 *      `tests/integrations/recipe-store.test.ts` (removal and rename, real collections) and the
 *      acceptance through `saveAuthoredDefinition`.
 * A module test that stood alone here would prove the pairing works and say nothing about whether
 * anything performs it, which is the exact shape this defect had - twice.
 */
const SCOPE = { orgId: 'o1', integrationKey: 'portal', actionName: 'list_cases' };

describe('forgetRecipe - the clear and its evidence travel together', () => {
  it('discards exactly the capture the dropped recipe named, under the same tenant key', async () => {
    // Typed by the module's OWN dep signature, so a fixture that drifts from what `forgetRecipe`
    // actually calls is a compile error rather than a quietly green test.
    const discardCapture = vi.fn<NonNullable<ForgetRecipeDeps['discardCapture']>>(async () => 3);
    const out = await forgetRecipe(SCOPE, {
      clearRecipe: async () => ({ version: 4, capturedCallsRef: 'cap-4' }),
      discardCapture,
    });
    expect(out).toEqual({ dropped: { version: 4, capturedCallsRef: 'cap-4' }, evidenceDiscarded: 3 });
    expect(discardCapture).toHaveBeenCalledOnce();
    expect(discardCapture.mock.calls[0]![0]).toEqual({ ...SCOPE, captureId: 'cap-4' });
  });

  it('discards NOTHING when the recipe named no evidence, or when there was no recipe', async () => {
    // A recipe compiled before `capturedCallsRef` existed names no pile, and an action that never
    // learned has nothing at all. Deleting on either would be a delete this module cannot justify.
    const noRef = vi.fn<NonNullable<ForgetRecipeDeps['discardCapture']>>(async () => 0);
    expect(await forgetRecipe(SCOPE, { clearRecipe: async () => ({ version: 4 }), discardCapture: noRef }))
      .toEqual({ dropped: { version: 4 }, evidenceDiscarded: 0 });
    expect(noRef).not.toHaveBeenCalled();

    const none = vi.fn<NonNullable<ForgetRecipeDeps['discardCapture']>>(async () => 0);
    expect(await forgetRecipe(SCOPE, { clearRecipe: async () => null, discardCapture: none }))
      .toEqual({ dropped: null, evidenceDiscarded: 0 });
    expect(none).not.toHaveBeenCalled();
  });

  it('a discard that THROWS does not undo the clear - the clear is the operation', async () => {
    // The posture is deliberate and asymmetric. A leaked capture is untidy; a clear that reported
    // failure (or threw) after actually removing the recipe would leave the owner believing their
    // veto did not take, on the one control they have over a recipe that answers wrongly.
    const out = await forgetRecipe(SCOPE, {
      clearRecipe: async () => ({ version: 4, capturedCallsRef: 'cap-4' }),
      discardCapture: async () => { throw new Error('store unavailable'); },
    });
    expect(out).toEqual({ dropped: { version: 4, capturedCallsRef: 'cap-4' }, evidenceDiscarded: 0 });
  });

  it('a clear that throws is NOT swallowed - the caller must know its veto did not take', async () => {
    // The mirror of the case above, and the reason the try/catch is around the discard alone.
    await expect(forgetRecipe(SCOPE, { clearRecipe: async () => { throw new Error('store unavailable'); } }))
      .rejects.toThrow('store unavailable');
  });

  it('passes the ACTOR through only when the caller supplied one', async () => {
    // The run loop holds the run owner's verified org and needs no visibility predicate; the route
    // acts for a principal and must. Passing `{ visibleTo: undefined }` from the machine path would
    // be indistinguishable at the store from an actor-scoped call with a missing actor.
    const clearRecipe = vi.fn<NonNullable<ForgetRecipeDeps['clearRecipe']>>(async () => null);
    await forgetRecipe(SCOPE, { clearRecipe });
    expect(clearRecipe.mock.calls[0]![3]).toEqual({});

    const actor = { userId: 'u1', orgId: 'o1', role: 'user' as const };
    await forgetRecipe({ ...SCOPE, visibleTo: actor }, { clearRecipe });
    expect(clearRecipe.mock.calls[1]![3]).toEqual({ visibleTo: actor });
  });
});

/**
 * THE SHARED PAIRING, which `forgetRecipe` above delegates to and which removal path 4 calls
 * directly. It exists as ONE function because paths 2 and 4 remove a recipe as a side effect of a
 * write that rewrote something ELSE - only the writer knows what it dropped - so they structurally
 * cannot go through `forgetRecipe`, which does the removing itself.
 *
 * Its own decision that the single-recipe callers cannot exercise: ONE failure is not the batch's.
 */
describe('discardEvidenceOfRemovedRecipes - the pairing every removal path reaches', () => {
  it('asks per removed recipe, under that recipe\'s OWN action name', async () => {
    // Typed by the seam's OWN signature, so a fixture that drifts from what the pairing actually
    // calls is a compile error rather than a quietly green test.
    const discardCapture = vi.fn<(key: CaptureKey) => Promise<number>>(async () => 2);
    const discarded = await discardEvidenceOfRemovedRecipes(
      { orgId: 'o1', integrationKey: 'portal' },
      [{ actionName: 'list_cases', capturedCallsRef: 'cap-a' }, { actionName: 'open_case', capturedCallsRef: 'cap-b' }],
      { discardCapture },
    );
    // The captures collection is keyed by (org, integration, ACTION, capture) - a batch that asked
    // under one action's name would delete nothing for the others and report success.
    expect(discardCapture.mock.calls.map((c) => c[0])).toEqual([
      { orgId: 'o1', integrationKey: 'portal', actionName: 'list_cases', captureId: 'cap-a' },
      { orgId: 'o1', integrationKey: 'portal', actionName: 'open_case', captureId: 'cap-b' },
    ]);
    expect(discarded).toBe(4);
  });

  it('skips a recipe that named no evidence, rather than asking for an empty capture', async () => {
    // A recipe compiled before `capturedCallsRef` existed. `discardCapture` with an empty captureId
    // is refused by the store's own tenant-scope check, but asking at all would be a delete nobody
    // requested.
    const discardCapture = vi.fn<(key: CaptureKey) => Promise<number>>(async () => 0);
    expect(await discardEvidenceOfRemovedRecipes(
      { orgId: 'o1', integrationKey: 'portal' },
      [{ actionName: 'list_cases' }, { actionName: 'open_case', capturedCallsRef: '' }],
      { discardCapture },
    )).toBe(0);
    expect(discardCapture).not.toHaveBeenCalled();
  });

  it('one discard that THROWS does not abandon the rest, and never fails the removal', async () => {
    // The removal has ALREADY happened by the time this runs - `create`'s replace has been written,
    // the clear has been committed - so a throw here must neither propagate nor stop the batch. A
    // single-recipe caller cannot tell the difference; a save that renames two actions can.
    const discardCapture = vi.fn<(key: CaptureKey) => Promise<number>>(async (key) => {
      if (key.captureId === 'cap-a') throw new Error('store unavailable');
      return 3;
    });
    expect(await discardEvidenceOfRemovedRecipes(
      { orgId: 'o1', integrationKey: 'portal' },
      [{ actionName: 'list_cases', capturedCallsRef: 'cap-a' }, { actionName: 'open_case', capturedCallsRef: 'cap-b' }],
      { discardCapture },
    )).toBe(3);
    expect(discardCapture).toHaveBeenCalledTimes(2);
  });
});
