/**
 * automation/self-heal.ts - a drifted recipe re-learns itself (slice P2.4).
 *
 * ── WHY DRIFT IS ITS OWN CLASSIFICATION, AND WHY IT DOES NOT GO TO THE FIXER ─────────────────
 *
 * The rehearsal fixer repairs ONE STEP of a plan: the locator missed, the page had an overlay, the
 * button moved. Every verb it has is a local edit at an index. A drifted recipe is not that. The
 * recipe replayed a call the site's UI used to make and the site answered 404, or answered 200 with
 * a body that no longer carries what the recipe reads. There is no step to patch - the private API
 * changed, and the only repair is to go and learn the new one.
 *
 * ── WHERE THE NEW RECIPE COMES FROM ──────────────────────────────────────────────────────────
 *
 * From THE AUTOMATION, run again with the network recorder armed - the same instrumented pass that
 * compiled the recipe in the first place (`service.ts`, `runAutomationForAction`). This module is
 * handed the resulting draft and decides what may become live.
 *
 * It is deliberately NOT a second, goal-driven exploration loop. The action already carries an
 * authored step list, the engine already adapts that list when a step fails (`rehearsal.ts`), and
 * a drift signal says the site's private API moved - not that its UI did. Re-driving the authored
 * steps and re-capturing underneath them re-learns the moved endpoint at the cost of the run that
 * was going to happen anyway; a parallel goal loop would be a second mechanism doing the fixer's
 * job worse, and - as the first attempt at this slice demonstrated - one no production path
 * reaches.
 *
 * ── THE SUPERSEDE IS TENANT-SCOPED, AND IT IS NOT `publishSnapshot` (trap T1) ─────────────────
 *
 * `publishSnapshot` looks like the right function and is emphatically not: its gate is super-admin
 * AND it flips the definition row to `global` visibility. A tenant-private heal that used it would
 * either be refused (no super-admin is present at a scheduled run) or would PUBLISH one tenant's
 * learning to every org on the platform. `recipe-store.supersedeRecipe` is the sibling written for
 * this caller - it bumps `version`, stamps the one-hop `supersedes` lineage, and touches
 * `visibility`, `publishedSnapshot` and `publishRequest` not at all.
 *
 * ── READS HEAL SILENTLY; WRITES ASK (the self-extension guardrail shape) ─────────────────────
 *
 * A heal is the system rewriting its own instructions without being asked. For a read-only recipe
 * that is exactly what should happen and nobody needs to be interrupted. For a recipe containing a
 * NON-IDEMPOTENT call, or a scripted DOM step that changes the page, it is not: the system would be
 * authoring, unattended, a new way to write to somebody's account. That heal is compiled and HELD,
 * and the supersede happens only once a human has assented - the same closed-default-opens-on-assent
 * shape as the authored-action guardrail and the `api_call` write gate.
 */
import type { SecretRegistry } from '../security/redaction.js';
import type { RecipeDraft, RecipeSupersedeInput, RecipeWriteResult } from '../integrations/recipe-store.js';
import { scriptedStepWrites } from './executors/injected-call.js';
import { isIdempotentMethod } from './recipe.js';
import type { ApiCallMethod } from './types.js';

/** What the engine decided a replay failure WAS. `recipe_drift` is the only one this module acts
 *  on; the others are named so a caller cannot pass "something went wrong" and get a heal. */
export type ReplayFailureClass = 'recipe_drift' | 'needs_human' | 'transport' | 'refused';

/** The subset of a `ReplayResult` this classifier reads. Structural rather than an import of the
 *  union, so `injected-call.ts` and this module do not have to import each other. */
export interface ReplayFailureSignal {
  outcome: string;
  reason?: string;
}

/**
 * Classify what a replay came back with.
 *
 * `drift` and `unavailable` look similar and are opposites: drift means the SITE changed (re-learn
 * it), unavailable means the ROUTE is missing (find a machine, or a credential - re-learning would
 * fail the same way and burn a pass to find out). `write-gate` is a refusal that a heal must never
 * route around, so it classifies as `refused` and this module does nothing with it.
 */
export function classifyReplayDrift(signal: ReplayFailureSignal): ReplayFailureClass {
  switch (signal.outcome) {
    case 'drift': return 'recipe_drift';
    case 'write-gate': return 'refused';
    // A recipe that does not cover its action's declared write is not a site that changed, and a
    // heal would re-learn the same read-only call set from the same pass. It is a refusal.
    case 'does-not-cover': return 'refused';
    // Nor is a recipe too NARROW for this run's arguments. The site is fine; the stored recipe was
    // learned from a smaller argument set. A supersede would need a recipe to supersede, and the
    // caller drops this one instead (see the outcome's own note) so the next pass can learn a wider
    // one from scratch - which is a first compile, not a heal.
    case 'arguments-uncovered': return 'refused';
    case 'unavailable': return 'needs_human';
    default: return 'transport';
  }
}

export type HealResult =
  /** The recipe was re-learned and the store now holds the new version. */
  | { outcome: 'healed'; version: number; supersededVersion: number }
  /**
   * The heal SUCCEEDED and is deliberately not live: the new recipe contains a write. `draft` is
   * held for the assent path to supersede with, once a human has said yes.
   */
  | { outcome: 'needs_assent'; draft: RecipeDraft; reason: string; writes: string[] }
  /** There was nothing to supersede, or the store refused. */
  | { outcome: 'refused'; reason: string };

export interface HealInput {
  orgId: string;
  integrationKey: string;
  actionName: string;
  /** Why the old recipe stopped working. Becomes the `supersedes.reason` on the lineage. */
  reason: string;
  secrets?: SecretRegistry;
  /** A human has assented to this action re-authoring a recipe that WRITES. Never defaulted true. */
  writeAssent?: boolean;
}

export interface HealDeps {
  supersedeRecipe: (
    orgId: string,
    key: string,
    actionName: string,
    next: RecipeSupersedeInput,
    opts?: { secrets?: SecretRegistry },
  ) => Promise<RecipeWriteResult>;
}

/**
 * Make a re-learned recipe live, unless it writes.
 *
 * NOTE WHAT IS NOT HERE: `publishSnapshot`. See the module header - it is a super-admin,
 * flips-to-global function and cannot serve a tenant-private heal.
 */
export async function healDriftedRecipe(
  input: HealInput,
  draft: RecipeDraft,
  deps: HealDeps,
): Promise<HealResult> {
  const writes = writesIn(draft);
  if (writes.length > 0 && !input.writeAssent) {
    // HELD, not discarded. The pass succeeded; throwing the draft away would mean paying for it
    // again the moment a human says yes. It is simply not live.
    return {
      outcome: 'needs_assent',
      draft,
      writes,
      reason:
        `the re-learned recipe for ${input.integrationKey}/${input.actionName} contains ${writes.length} ` +
        'step(s) that write. A recipe that writes does not become live without a human saying so.',
    };
  }
  return applyHealedRecipe(input, draft, deps);
}

/**
 * Make a held draft live. The assent path calls this after a human has answered, with exactly the
 * draft `healDriftedRecipe` held - so the recipe that goes live is the one that was reviewed, not a
 * fresh pass that might have learned something else.
 */
export async function applyHealedRecipe(
  input: Pick<HealInput, 'orgId' | 'integrationKey' | 'actionName' | 'reason' | 'secrets'>,
  draft: RecipeDraft,
  deps: HealDeps,
): Promise<HealResult> {
  const written = await deps.supersedeRecipe(
    input.orgId,
    input.integrationKey,
    input.actionName,
    { ...draft, reason: input.reason },
    input.secrets ? { secrets: input.secrets } : {},
  );
  switch (written.verdict) {
    case 'ok':
      return {
        outcome: 'healed',
        version: written.recipe.version,
        // The store read the prior version INSIDE its CAS, so this is the version actually
        // replaced - not whichever one this process happened to read first.
        supersededVersion: written.recipe.supersedes?.version ?? written.recipe.version - 1,
      };
    case 'notfound':
      return { outcome: 'refused', reason: 'there is no recipe on that action to supersede' };
    case 'exists':
      // `supersedeRecipe` never answers this; handled so the switch stays exhaustive rather than
      // falling through to a lie about what happened.
      return { outcome: 'refused', reason: 'the store refused the supersede' };
  }
}

/**
 * Everything in a draft that is not safe to repeat.
 *
 * BOTH HALVES. The calls are read through `isIdempotentMethod` - the same predicate that stamped
 * `idempotent` at compile time, so the gate and the compile cannot drift - and the scripted steps
 * through `scriptedStepWrites`, the same predicate the replay executor's own gate uses. A heal that
 * checked only the calls would let a re-learned `click` on a Submit button go live unattended,
 * which is the write the whole guardrail is about.
 */
export function writesIn(draft: RecipeDraft): string[] {
  const calls = draft.injectedCalls
    .filter((call) => !isIdempotentMethod(call.method as ApiCallMethod))
    .map((call) => `${call.method} ${call.urlTemplate}`);
  const steps = draft.scriptedSteps
    .filter((step) => scriptedStepWrites({ action: step.action }))
    .map((step) => `the scripted step "${step.action}"`);
  return [...calls, ...steps];
}
