/**
 * integrations/recipe-lifecycle.ts - the CLEAR, paired with its evidence, and the map of every
 * other way a compiled recipe can go.
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
 * ── THE REMOVAL PATHS, ENUMERATED FROM THE CODE ──────────────────────────────────────────────
 *
 * An earlier revision of this header said "clearing is the THIRD way a recipe can go" and that
 * `forgetRecipe` was reached by BOTH removal paths "so a future third cannot forget". Both counts
 * were wrong, and the way they were wrong is the point: they were counted from what the author had
 * in mind rather than from what removes a recipe. Grep `recipe` across `integrations/` and there
 * are FOUR, each with the collector that closes it named:
 *
 *   1. THE CLEAR - `IntegrationRecipeStore.clearRecipe`, reached by the owner's DELETE route
 *      (`routes/integrations.ts`) and by the run loop's refusal path
 *      (`automation/service.ts` `clearRefusedRecipe`). Collector: `forgetRecipe` below, which is
 *      why both callers go through it instead of each remembering to.
 *   2. THE SUPERSEDE - `IntegrationRecipeStore.supersedeRecipe`, the self-heal write, which
 *      REPLACES the recipe (and therefore its pointer). Collector: `learnFromRun`'s
 *      `priorCaptureRef`, read BEFORE the write and discarded after it lands.
 *   3. THE WRITE THAT NEVER LANDS - `learnFromRun` writes the evidence FIRST (the recipe carries
 *      the pointer INTO it), so a write that answers `exists`/`notfound`, or THROWS at the store's
 *      persistence-boundary proof, leaves a pile nothing names. Collector: that function's
 *      `finally`, which is a `finally` precisely because the throw is a real exit.
 *   4. THE ACTION SET REWRITTEN - `IntegrationDefinitionStore.create(..., onConflict: 'replace')`,
 *      the ordinary builder save and `achieve`'s in-place write. `carryRecipesForward` re-attaches
 *      each stored recipe BY ACTION NAME, so an action the incoming set no longer names (renamed,
 *      removed - an ordinary edit, and what an agent re-authoring an integration does routinely)
 *      loses its recipe. Collector: `discardEvidenceOfRemovedRecipes`, called there.
 *
 * Paths 2 and 4 remove a recipe as a SIDE EFFECT of a write that rewrote something else, and only
 * the writer knows what it dropped - which is why the pairing itself is one function in
 * `captured-calls-store.ts` (see its note) that all four reach, rather than one function here that
 * two of them structurally could not call.
 *
 * ── WHY THE CLEAR IS A MODULE AND NOT A METHOD ───────────────────────────────────────────────
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
import { discardEvidenceOfRemovedRecipes, type CaptureKey } from './captured-calls-store.js';

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
  if (!dropped) return { dropped: null, evidenceDiscarded: 0 };

  // THE SHARED PAIRING, not a second copy of it: the same function paths 2 and 4 reach, so the
  // failure posture and the key a discard is asked for cannot drift between the four.
  const evidenceDiscarded = await discardEvidenceOfRemovedRecipes(
    { orgId: scope.orgId, integrationKey: scope.integrationKey },
    [{
      actionName: scope.actionName,
      ...(dropped.capturedCallsRef !== undefined ? { capturedCallsRef: dropped.capturedCallsRef } : {}),
    }],
    deps.discardCapture ? { discardCapture: deps.discardCapture } : {},
  );
  return { dropped, evidenceDiscarded };
}
