/**
 * automation/action-evidence.ts - the automation half of integration action EVIDENCE (slice S1).
 *
 * ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────────────────────────
 *
 * `integrations/action-evidence-store.ts` owns the collection and the redaction gate. It cannot own
 * THIS, because reading a run means reading `RunRecord`, `StepRecord.output` and the screenshot
 * layout - all of which live in `automation/`, a tier `integrations/` must not import (FIXED-1 and
 * the module-direction table in docs/architecture.md). So the executor declares a
 * `RunEvidenceCollector` seam and `server.ts` binds it to the function below, exactly as it already
 * binds `runAutomationBackedAction`.
 *
 * ── POINTERS, NOT COPIES ──────────────────────────────────────────────────────────────────────
 *
 * The engine has ALREADY recorded everything this needs: a per-step PNG behind the authenticated
 * screenshot plane, and `local_command` stdout/stderr on `StepRecord.output`. Evidence therefore
 * stores `{runId, stepIndex}` plus the screenshot's own plane URL and a capped text excerpt.
 *
 * Copying the PNG bytes into the evidence row would have created a SECOND copy of an authenticated
 * client-portal session under a DIFFERENT access rule - the exact failure `screenshot-plane.ts`
 * exists to have fixed. A pointer inherits the rule that already exists: a reader still needs a
 * token, and still has to pass that plane's org + owner check, to see a single byte.
 *
 * ── AND THE POINTER CREATES AN OBLIGATION ─────────────────────────────────────────────────────
 *
 * Screenshots are swept at 7 days (`sweepExpiredScreenshots`). A pointer into a swept run is a
 * broken image on the detail page, so evidence PINS its run - see `pinnedRunIdsForRetention` and
 * the sweeper's `pinnedRunIds` option. Pinning is a retention EXTENSION, which is a privacy
 * decision and not a free one: it is bounded to the ONE run each action's live evidence names, and
 * it ends the moment that evidence is superseded or discarded.
 */
import { automationRunStore } from './persistence.js';
import { screenshotUrlFromPath } from './persistence.js';
import type { RunRecord, StepRecord } from './types.js';

/** Per-excerpt cap applied HERE as well as in the store. Two ceilings on purpose: the store's is
 *  the collection's promise, this one keeps a 5MB `local_command` stdout from being carried across
 *  the seam in memory just to be trimmed on the other side. */
const MAX_EXCERPT_CHARS = 8_000;

/** How many steps are pointed at. Mirrors `MAX_EVIDENCE_STEPS`; the store re-applies its own. */
const MAX_STEPS = 50;

/** One step, as evidence points at it. Structurally identical to `RunStepEvidence` in
 *  `integrations/action-evidence-store.ts` - declared here rather than imported so this module
 *  keeps no edge to the integrations tier either. `server.ts` is where the two meet. */
export interface CollectedStepEvidence {
  stepIndex: number;
  stepType?: string;
  /** `StepRecord.status`. Named for what it holds - see `RunStepEvidence.status`, which this must
   *  stay structurally assignable to (`server.ts` is where the two meet). */
  status?: string;
  screenshotUrl?: string;
  excerpt?: string;
  truncated?: boolean;
}

export interface CollectedRunEvidence {
  status?: string;
  steps: CollectedStepEvidence[];
  /**
   * THE STEP-COUNT FLAG - true when the run had MORE steps than `MAX_STEPS`, so the trace below is a
   * PREFIX of the run rather than the run.
   *
   * NOT `CollectedStepEvidence.truncated`, WHICH IS THE EXCERPT FLAG, and the two being spelled the
   * same is why this field did not exist for six rounds. The cut happens HERE - `run.steps.slice`
   * below - and the count that proves it happened is `run.steps.length`, which nothing downstream
   * can see: the store's `capEvidence` re-applies its own identical cap and tests
   * `evidence.steps.length > MAX_EVIDENCE_STEPS`, but what it receives is ALREADY sliced to exactly
   * 50, so that disjunct is unreachable from the only path production takes. A 50-step prefix of a
   * 200-step run was byte-indistinguishable from a complete 50-step run, and the row is durable for
   * 90 days plus one retention-sweep interval and is the record the graduation gate reads before an
   * action becomes auto-runnable by `achieve`. The signal therefore has to travel with the slice, not
   * be re-derived after it.
   *
   * "THE HUMAN'S BASIS FOR GRANTING `trusted`" IS WHAT THIS USED TO SAY, AND IT IS NOT TRUE ON THIS
   * BRANCH (round nine). Nothing renders these steps to anybody: the promotion path reads the stored
   * row's `outcome` and `shape` and nothing else, and the person promoting echoes back a shape
   * string. The detail page that would show a trace is S2/S3. The flag is correct and worth carrying
   * for the reader who is coming - see the module header of
   * `integrations/action-evidence-store.ts` - but it is not currently un-misleading anyone.
   *
   * `AutomationEvidence.truncated` in `integrations/action-evidence-store.ts` is the field this ends
   * up in; `action-executor.ts` forwards it across the seam.
   */
  truncated?: boolean;
}

/**
 * Collect the evidence of one run.
 *
 * Answers `null` for anything it cannot resolve, and the two cases that matters for are both
 * ordinary rather than exceptional:
 *   - a REPLAY (`replay-…`), which by construction has no `automationRuns` document behind it,
 *     because no engine run happened;
 *   - a run already swept or otherwise gone.
 * The caller treats `null` as "no evidence this time" and leaves the previous row standing, which
 * is the right answer: a replay proves the recipe still works, not what the steps looked like.
 */
export async function collectRunEvidence(
  runId: string,
  deps: { findRun?: (runId: string) => Promise<RunRecord | null> } = {},
): Promise<CollectedRunEvidence | null> {
  if (runId === '') return null;
  const findRun = deps.findRun ?? ((id: string) => automationRunStore.findByRunId(id));
  const run = await findRun(runId);
  if (!run || !Array.isArray(run.steps)) return null;
  // THE CUT AND ITS RECORD ARE TAKEN TOGETHER, from the one place that can still see the run's real
  // length. Downstream sees exactly `MAX_STEPS` items and cannot tell a prefix from a whole trace.
  const truncated = run.steps.length > MAX_STEPS;
  const steps = run.steps.slice(0, MAX_STEPS).map(stepEvidence);
  return { status: run.status, steps, ...(truncated ? { truncated: true } : {}) };
}

function stepEvidence(step: StepRecord): CollectedStepEvidence {
  const screenshotUrl = screenshotUrlFromPath(step.screenshotPath);
  const raw = excerptOf(step);
  const truncated = raw !== undefined && raw.length > MAX_EXCERPT_CHARS;
  return {
    stepIndex: step.index,
    ...(step.resolvedAction?.kind !== undefined ? { stepType: step.resolvedAction.kind } : {}),
    ...(step.status !== undefined ? { status: step.status } : {}),
    ...(screenshotUrl !== undefined ? { screenshotUrl } : {}),
    ...(raw !== undefined ? { excerpt: truncated ? raw.slice(0, MAX_EXCERPT_CHARS) : raw } : {}),
    ...(truncated ? { truncated: true } : {}),
  };
}

/**
 * The step's own text, per output kind.
 *
 * `local_command` is the one the brief names, and its stdout/stderr is the whole point of a
 * bash-cli action's evidence. `api_call` and `ekoa_action` carry their own already-bounded text and
 * are included because a browser-steps automation routinely mixes them in; a step whose output is
 * none of the three contributes a pointer with no excerpt, which is still evidence that the step
 * ran and still carries its screenshot.
 *
 * NOTE WHAT IS NOT READ: `StepRecord.error.details` (an arbitrary debug payload with no redaction
 * contract) and `logTail`. A successful run's evidence has no business carrying a failure dump, and
 * the store's last gate would refuse the row anyway if one carried a live value.
 */
function excerptOf(step: StepRecord): string | undefined {
  const out = step.output;
  if (!out) return undefined;
  if (out.kind === 'local_command') {
    const parts: string[] = [];
    if (out.stdout) parts.push(out.stdout);
    if (out.stderr) parts.push(out.stderr);
    return parts.length > 0 ? parts.join('\n') : undefined;
  }
  if (out.kind === 'api_call') return out.responseBody || undefined;
  if (out.kind === 'ekoa_action') return out.result || undefined;
  return undefined;
}
