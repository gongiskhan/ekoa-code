import { describe, it, expect, vi } from 'vitest';
import { forgetRecipe, type ForgetRecipeDeps } from '../../src/integrations/recipe-lifecycle.js';

/**
 * THE ONE WAY A COMPILED RECIPE IS REMOVED, and the invariant it exists to hold: nothing durable
 * outlives the thing it is evidence for.
 *
 * WHAT THIS FILE IS AND IS NOT. It pins the module's own DECISIONS - which clear leads to which
 * discard, the key the discard is asked for, and the failure posture when the discard throws. That
 * the two REAL callers reach it, against REAL stores, is proved where those callers live:
 *   - the run loop's refusal path: `tests/automation/replay-mount.test.ts` (the seam) and
 *     `tests/automation/discovery-replay-acceptance.test.ts` (the real store, the real default
 *     `clearRecipe`, the real captures collection asserted empty after the clear);
 *   - the owner's route: `tests/contract/integrations-recipes.test.ts`.
 * A module test that stood alone here would prove the pairing works and say nothing about whether
 * anything performs it, which is the exact shape this defect had.
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
