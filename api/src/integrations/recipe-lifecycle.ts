/**
 * integrations/recipe-lifecycle.ts - the ONE way a compiled recipe is REMOVED.
 *
 * ── THE INVARIANT ────────────────────────────────────────────────────────────────────────────
 *
 * NOTHING DURABLE OUTLIVES THE THING IT IS EVIDENCE FOR. A recipe carries `capturedCallsRef` into
 * `integration_captured_calls` - a pile of full redacted request AND response bodies, the most
 * sensitive thing this pipeline touches. That collection has no TTL, and the recipe's pointer is
 * the ONLY index back into it: `automation/service.ts` finds a superseded pass's evidence through
 * `priorCaptureRef`, which reads the CURRENT recipe. Remove the recipe without dropping its
 * evidence and the pile is unreachable to every collector there is, permanently.
 *
 * The spine closed that leak twice - the evidence behind a REPLACED recipe, and the evidence behind
 * a recipe that never LANDED. Clearing is the third way a recipe can go and had no collector at all:
 * `IntegrationRecipeStore.clearRecipe` did return the dropped recipe, and its one caller narrowed it
 * to a boolean. It is routinely reachable (`arguments-uncovered` is the ordinary listener shape),
 * and two callers of one action using different argument sets repeat the learn/clear cycle, so the
 * orphaned piles accumulated without bound.
 *
 * ── WHY IT IS A MODULE AND NOT A METHOD ──────────────────────────────────────────────────────
 *
 * It spans two stores with deliberately separate lifecycles (`recipe-store.ts` is "the ONE writer of
 * a compiled recipe"; `captured-calls-store.ts` owns evidence that is unbounded and short-lived),
 * and it has more than one caller: the run loop's refusal path and the owner's own escape hatch on
 * `routes/integrations.ts`. Capability Contract rule 1 - one implementation, and both callers reach
 * the invariant through it rather than each remembering to.
 *
 * ── FAILURE POSTURE ──────────────────────────────────────────────────────────────────────────
 *
 * The CLEAR is the operation; the discard is best-effort and LOUD. A leaked capture is untidy; a
 * failed clear that reported success would leave the action replaying a recipe its owner believes is
 * gone. So a discard that throws is logged and the clear still stands.
 */
import type { Actor } from '@ekoa/shared';
import { integrationRecipeStore } from './recipe-store.js';
import { capturedCallsStore, type CaptureKey } from './captured-calls-store.js';

/** Which action's recipe, and on whose behalf. `visibleTo` is present for a PRINCIPAL caller (the
 *  route) and absent for a machine caller that already holds the verified owning org (the run loop). */
export interface ForgetRecipeScope {
  orgId: string;
  integrationKey: string;
  actionName: string;
  visibleTo?: Actor;
}

/** Injected so the unit lane needs neither store. Defaults are the real ones. */
export interface ForgetRecipeDeps {
  clearRecipe?: (
    orgId: string,
    key: string,
    actionName: string,
    opts: { visibleTo?: Actor },
  ) => Promise<{ version?: number; capturedCallsRef?: string } | null>;
  discardCapture?: (key: CaptureKey) => Promise<number>;
}

export interface ForgetRecipeResult {
  /** The recipe that was removed, or `null` when the action had none - the ordinary idempotent case. */
  dropped: { version?: number; capturedCallsRef?: string } | null;
  /** How many evidence documents went with it. `0` covers both "it named none" and "it was already gone". */
  evidenceDiscarded: number;
}

/**
 * Drop one action's compiled recipe AND the raw evidence it was distilled from.
 *
 * Ordered clear-then-discard, which is the only safe order: the recipe is what NAMES the evidence,
 * so discarding first would (on a clear that then fails) leave a live recipe pointing at documents
 * that no longer exist - a recipe whose provenance a human can no longer inspect.
 */
export async function forgetRecipe(
  scope: ForgetRecipeScope,
  deps: ForgetRecipeDeps = {},
): Promise<ForgetRecipeResult> {
  const clearRecipe = deps.clearRecipe
    ?? ((orgId, key, actionName, opts) => integrationRecipeStore.clearRecipe(orgId, key, actionName, opts));
  const dropped = await clearRecipe(
    scope.orgId,
    scope.integrationKey,
    scope.actionName,
    scope.visibleTo === undefined ? {} : { visibleTo: scope.visibleTo },
  );
  if (!dropped?.capturedCallsRef) return { dropped: dropped ?? null, evidenceDiscarded: 0 };

  const discardCapture = deps.discardCapture ?? ((key: CaptureKey) => capturedCallsStore.discardCapture(key));
  try {
    const evidenceDiscarded = await discardCapture({
      orgId: scope.orgId,
      integrationKey: scope.integrationKey,
      actionName: scope.actionName,
      captureId: dropped.capturedCallsRef,
    });
    return { dropped, evidenceDiscarded };
  } catch (err) {
    console.warn(
      `[integrations] the evidence ${dropped.capturedCallsRef} of ${scope.integrationKey}/${scope.actionName} `
        + `outlived the recipe that named it: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { dropped, evidenceDiscarded: 0 };
  }
}
