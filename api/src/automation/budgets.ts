/**
 * The automation engine's named knobs, in ONE place.
 *
 * Before this module the only budget was `REHEARSAL_BUDGET`, declared halfway down `rehearsal.ts`
 * and read from `engine.ts` - which meant a rehearsal-shaped constant was quietly governing normal
 * runs too (the pause cap), and the limits that a normal run actually needed (a wall-clock ceiling,
 * a bounded step retry) simply did not exist: a normal run could loop for hours, and the one retry
 * the engine did perform - the cache-then-vision fallthrough - was an untracked side effect of a
 * `catch` block rather than a budgeted step.
 *
 * The rule this module exists to enforce: every retry, cap and ceiling the engine honours is a
 * NAMED field here, with the reason for its value written next to it. A limit that lives inline is
 * a limit nobody can find, review, or change deliberately.
 *
 * `REHEARSAL_BUDGET` moved here verbatim; `rehearsal.ts` re-exports it so no call site churned, and
 * `tests/automation/budgets.test.ts` pins every value so a future edit has to be intentional.
 */

/**
 * The rehearsal loop's ceilings (moved from `rehearsal.ts`, values unchanged).
 *
 * Rehearsal is the expensive mode: it may call the Opus fixer to re-plan a failing step, and each
 * call costs seconds and tokens. These four numbers are what stops a doomed rehearsal from burning
 * both.
 */
export const REHEARSAL_BUDGET = {
  maxFixerCalls: 25,
  maxWallClockMs: 4 * 60 * 1000, // 4 minutes
  maxPatchesPerIndex: 5,
  /**
   * Cap on fast-path or fixer-driven pauses during a NORMAL (non-rehearsal)
   * run. CAPTCHA + MFA + one fallback covers the common case; more than
   * that on a single run usually means the page is broken or the user
   * has walked away.
   */
  maxNormalPauses: 5,
} as const;

/**
 * What the engine may spend recovering ONE step before it escalates.
 *
 * `deterministicRetries` buys the cheapest possible recovery first: a cached locator that missed
 * because the page had not finished settling costs one more `act()` to re-attempt, versus a vision
 * round-trip (seconds, tokens, and a fresh chance to resolve to something subtly different). The
 * re-attempt is of the SAME resolved action - it is a retry, not a re-decision - so it can only
 * ever succeed at doing what the run already decided to do.
 *
 * `visionRegroundsPerStep` makes the cache-then-vision fallthrough a COUNTED step. Before this it
 * was an invisible `catch`: a step index revisited by the rehearsal fixer could re-ground with
 * vision on every pass, and nothing in the run record said so. One re-ground per step index is the
 * budget - a second one on the same index means the cache entry is not the problem, and burning
 * another vision call to learn that again is waste.
 */
export const STEP_RETRY_BUDGET = {
  deterministicRetries: 1,
  visionRegroundsPerStep: 1,
} as const;

/**
 * What a NORMAL (non-rehearsal) run may spend.
 *
 * A normal run had no wall-clock ceiling at all: only rehearsal was capped. A run whose page never
 * settles, or that pauses and resumes in a loop, would sit in the engine holding a browser session
 * indefinitely, and the only way out was a human cancelling it.
 *
 * 8 minutes is twice the rehearsal budget on purpose. Rehearsal is capped tightly because the fixer
 * is what makes it slow and expensive; a normal run is capped loosely because its length is mostly
 * the SITE's - navigation, uploads, a slow report - and cutting a legitimate ceremony short is a
 * worse failure than letting a stuck one run for another few minutes.
 *
 * The clock deliberately excludes human-pause time (the engine subtracts `pausedTotalMs`, exactly
 * as the rehearsal guard does): a CAPTCHA the user takes six minutes to solve is not the run being
 * slow, and a cap that punished it would make the pause feature useless.
 */
export const NORMAL_RUN_BUDGET = {
  maxWallClockMs: 8 * 60 * 1000,
  /**
   * Pinned to the rehearsal value rather than restated: the cap has always been the same number in
   * both modes, and the field on `REHEARSAL_BUDGET` was always documented as the NORMAL-run cap.
   * Each mode now reads its own knob, so the two can diverge later without either changing today.
   */
  maxNormalPauses: REHEARSAL_BUDGET.maxNormalPauses,
} as const;

/**
 * What ONE discovery pass may spend.
 *
 * NO CONSUMER YET - discovery does not exist (it is P2 of the execution-plane plan). Declared here
 * from day one so the phase that builds it consumes a reviewed budget instead of inventing three
 * inline literals, and so the knob is visible to review before the code that spends it lands.
 *
 * `maxRePlans` is the one genuinely new limit: discovery drives from a GOAL rather than a step
 * list, so its failure mode is not "a step is stuck" but "the whole approach was wrong". Three full
 * re-plans is the point past which a fourth is not going to be the one that works.
 */
export const DISCOVERY_BUDGET = {
  maxRePlans: 3,
  maxWallClockMs: 6 * 60 * 1000,
  /** Discovery composes the same fixer for local step recovery, so it inherits the same ceiling. */
  maxFixerCalls: REHEARSAL_BUDGET.maxFixerCalls,
} as const;

/**
 * What the drift-heal loop may spend before it gives up on a recipe (cornerstone K6, closing the
 * ledgered finding `recipe-drift-heal-cycles-are-unbounded`).
 *
 * A heal is a full authored run at model cost plus a supersede, and nothing bounded how often one
 * action could go around that loop: a scheduled action against a site that drifts on every visit
 * (rotating shapes, per-session URLs, an A/B test) paid a doomed replay attempt AND a full
 * vision-priced re-learn AND a version bump per tick, forever - and the schedules supervisor
 * cannot see it, because every thrash tick SUCCEEDS.
 *
 * `maxConsecutiveDriftHeals` counts SUPERSEDES WITH NO SUCCESSFUL REPLAY BETWEEN THEM: the streak
 * lives on the recipe's own stats (`driftStreak`, bumped by `supersedeRecipe`, zeroed by
 * `recordReplay`), so a recipe that drifts once a month and replays daily never approaches it.
 * Three consecutive heals that never replayed once means the site does not hold still long enough
 * for a recipe to be worth compiling - the loop CLEARS the recipe instead of superseding again,
 * and the action goes back to its authored steps at full cost, correctly, until a later pass
 * learns a recipe that sticks.
 */
export const HEAL_BUDGET = {
  maxConsecutiveDriftHeals: 3,
} as const;

/**
 * What ONE replay attempt may spend (K6). The replay is a pre-flight optimisation on the hot path
 * of every automation-backed action; its per-call transport timeouts bound each call, but nothing
 * bounded the ATTEMPT - a recipe of several calls against a slow site could hold the action longer
 * than the authored run it was supposed to beat. On the ceiling the attempt is abandoned and the
 * run falls through to the authored steps, exactly as any other non-ok replay outcome does.
 */
export const REPLAY_BUDGET = {
  maxWallClockMs: 60 * 1000,
} as const;

/**
 * Per-run ledger of what `STEP_RETRY_BUDGET` has already been spent on, keyed by step INDEX.
 *
 * Indexed by position rather than step id because the rehearsal fixer can replace the step at an
 * index outright (`replace_current` mints a new id): the budget belongs to "the engine's Nth
 * attempt at getting past position N", not to a particular step object that may not survive it.
 *
 * Created once per run in the engine loop and threaded down into the per-step executors. It is
 * deliberately NOT persisted: it bounds one run's recovery, and a resumed-from-scratch run gets a
 * fresh one.
 */
export interface StepRetryLedger {
  /** How many cache-then-vision re-grounds this index has already spent. */
  visionRegrounds(index: number): number;
  /** Record one, and answer whether it was within budget (false ⇒ the caller must not re-ground). */
  claimVisionReground(index: number): boolean;
}

export function createStepRetryLedger(): StepRetryLedger {
  const regrounds = new Map<number, number>();
  return {
    visionRegrounds: (index) => regrounds.get(index) ?? 0,
    claimVisionReground: (index) => {
      const spent = regrounds.get(index) ?? 0;
      if (spent >= STEP_RETRY_BUDGET.visionRegroundsPerStep) return false;
      regrounds.set(index, spent + 1);
      return true;
    },
  };
}
