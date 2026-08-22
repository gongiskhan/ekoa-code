/**
 * integrations/integration-achieve.ts — `achieve`: EXECUTE-OR-AUTHOR (slice D3, the last one).
 *
 * ================================ WHAT THIS IS ==============================================
 * RUN_SPEC criterion 7's third capability: a caller states a GOAL. If an action already satisfies
 * it, execute it. If none does, AUTHOR one, VERIFY it, and persist it — behind locked guardrails.
 * This is the slice where the platform extends itself, so the module is written as guardrails with
 * a flow between them rather than a flow with guardrails attached.
 *
 * ================================ THE SIX LOCKS =============================================
 *
 * 1. THE WRITE GATE IS INHERITED, NEVER REACHED PAST. The execute arm calls
 *    `executeIntegrationCapabilityAction` — which calls `executeUserIntegrationAction`, which is
 *    where C2 put `checkActionConsent`, before any credential is read. `achieve` therefore meets
 *    the gate on exactly the terms every other rail meets it. This module imports neither
 *    `checkActionConsent` nor `approveAction`, and does not execute anything itself; the static
 *    guard in `api/tests/integrations/integration-achieve.test.ts` pins that, because a future
 *    "optimisation" that inlined the check here would make this rail's behaviour independent of
 *    the executor's — the exact drift C2's own guard exists to prevent one file over.
 *
 * 2. IT NEVER RUNS WHAT IT JUST AUTHORED. The author arm returns; it does not fall through to the
 *    execute arm. And the execute arm only ever runs a TRUSTED action (`isTrustedAction`), so a
 *    provisional action cannot be reached by a second `achieve` call either. An authored
 *    `mutates` action needs a human twice over: once to promote it out of provisional, and once at
 *    C2's gate — and the authored action is stored `mutates: true` whatever it claimed, so the
 *    second one is unavoidable even if the first were somehow granted (`authored-action.ts`).
 *
 * 3. IT NEVER SELF-APPROVES. `achieve` is `user-or-key`; `POST …/approval` (C2) and
 *    `POST …/trust` (this slice) are both `auth: 'user'`. An agent refused at either gate cannot
 *    hand itself the exemption it was just quoted. Nothing in this module writes an approval or a
 *    trusted state.
 *
 * 4. COPY-ON-AUTHOR FORK. An authored action on a `global` integration lands in the ACTING
 *    TENANT'S OWN copy — never in the global row, which is edited only through the publish flow
 *    (`published_row`), including by its author. See `resolveAuthoringTarget`.
 *
 * 5. AN AUTHORED ACTION CANNOT WIDEN AN ORIGIN. The credential's granted egress scope is resolved
 *    BEFORE the draft exists, through the one custodian rule (`resolveCredentialEgressBinding`),
 *    and the draft's host must already be in it. A `refused` or `unbound` binding refuses the
 *    authoring outright rather than authoring into the branch the executor cannot enforce.
 *
 * 6. ONLY THE CUSTODIAN AUTHORS. For an org-shared config the definition governing the credential
 *    is resolved as its CUSTODIAN, not as the reader — so a peer's authored action would be BOTH
 *    the exfiltration shape that rule closed AND, since execution resolves as the custodian,
 *    unreachable. `achieve` refuses to author for anyone who is not the principal the definition
 *    resolves as.
 *
 * ================================ THE MODEL CALL ============================================
 * The drafting turn goes through D2's shared authoring core (`agents/authoring-core.ts`) — Rule 1,
 * no third authoring path. `integrations/` is tier 3 and `agents/` is tier 5, so the core arrives
 * as an INJECTED SEAM (`ActionDrafter`) bound once by the composition root, exactly as the
 * automation seam reaches `action-executor.ts`. Absent that seam, `achieve` still EXECUTES and
 * refuses to author with a coded `authoring_unavailable` — an honest default, never a silent
 * degradation into some other authoring path. Everything below the seam (the prompt, the parse,
 * the verification, the persistence) is ordinary testable code in this module, so nothing that
 * decides what gets STORED lives in a lambda in `server.ts`.
 *
 * The draft is UNTRUSTED. The prompt states every constraint, and then `verifyAuthoredAction`
 * re-checks every one of them deterministically; the prompt is a hint, the suite is the control.
 */
import type { Actor } from '@ekoa/shared';
import { checkAllowance } from '../billing/index.js';
import { decideForTask, type LlmAttribution, type RouterDecision } from '../llm/index.js';
import {
  type IntegrationAction,
  type IntegrationConfigField,
  type IntegrationDefinition,
} from './definitions.js';
import {
  canEditDefinitionRaw,
  definitionFromDoc,
  resolveSkillMd,
} from './definition-registry.js';
import {
  definitionIdFor,
  integrationDefinitionStore,
  IntegrationDefinitionStore,
  IntegrationDefinitionStoreError,
  type IntegrationDefinitionDoc,
} from './definition-store.js';
import { resolveCredentialEgressBinding } from './credential-cofre.js';
import { actionShape } from './action-consent.js';
import {
  authoringStateOf,
  isTrustedAction,
  promoteToTrusted,
  provisionalActionFrom,
  verifyAuthoredAction,
  type AuthoredActionDraft,
  type AuthoredActionVerification,
} from './authored-action.js';
// SLICE S1 (branch `feat/s1-s3-integration-surface`) - the evidence row the graduation prerequisite
// reads. See the call-site comment in `trustAuthoredAction`; this import and that call are the whole
// of S1's footprint in this file.
import { actionEvidenceStore } from './action-evidence-store.js';
import {
  argsOutputContractFor,
  mayBeModelFilled,
  missingDeclaredArgs,
  parseArgsPlan,
  verifyPlannedArgs,
  type PlannedArgValue,
} from './action-parametrize.js';
import {
  composeOutputContract,
  composeRows,
  fieldsOf,
  parseComposePlan,
  promptSafeFields,
  rowsOf,
  verifyComposePlan,
  type AppCollections,
  type ComposeCollection,
  type ComposeSummary,
} from './action-compose.js';
import {
  executeIntegrationCapabilityAction,
  resolveCapabilityDefinition,
  type CapabilityContext,
  type CapabilityOutcome,
} from './integration-capability.js';
import type { ExecuteIntegrationActionResult } from './action-executor.js';
// S3: the PROMPT view of the caller's own recorded notes - scrubbed and capped by that module, and
// the only shape of it this file may reach (the byte-exact view exists for the editor alone).
import { feedbackForPrompt } from './action-feedback.js';
import { logActivity } from '../data/activity.js';

// ---------------------------------------------------------------------------
// The drafting seam
// ---------------------------------------------------------------------------

/**
 * One drafting turn, as `agents/authoring-core.ts` performs it — a NON-GENERIC projection of
 * `authorWithRepair` specialised to this module's draft. Declared structurally (no import from
 * `agents/`) so the tier-3 -> tier-5 direction is never reversed: `server.ts` binds it with
 * `(input) => authorWithRepair({ ...input, emptyReply: 'unavailable' })`.
 */
export type ActionDrafter = (input: {
  contentSections: readonly string[];
  outputContract: string;
  userText: (violations: readonly string[] | null) => string;
  decision: RouterDecision;
  attribution: LlmAttribution;
  parse: (text: string) => { draft: AuthoredActionDraft | null; violations: string[] };
  repairs?: number;
}) => Promise<ActionDraftTurn>;

export type ActionDraftTurn =
  | { status: 'authored'; text: string; draft: AuthoredActionDraft | null; violations: string[]; attempts: number }
  | { status: 'unavailable'; reason: 'transport' | 'empty' | 'aborted'; detail: string; cause?: unknown; attempts: number };

/**
 * THE PLANNING SEAM (the reuse ladder's two upper rungs) - the THIRD `authorWithRepair`
 * specialisation, beside `ActionDrafter` and the automation planner's own. Deliberately ONE seam
 * serving both rungs rather than two: the rungs differ only in the output contract and the parser,
 * which are exactly the two things the authoring core already takes as arguments, so a second
 * binding would be a second thing to forget to wire and nothing else.
 *
 * `draft` is `unknown` on purpose. The core hands back whatever the caller's own `parse` produced,
 * and each rung's DETERMINISTIC suite (`verifyPlannedArgs`, `verifyComposePlan`) is what turns it
 * into something typed - model output is never made trustworthy by being received.
 */
export type PlanDrafter = (input: {
  contentSections: readonly string[];
  outputContract: string;
  userText: (violations: readonly string[] | null) => string;
  decision: RouterDecision;
  attribution: LlmAttribution;
  parse: (text: string) => { draft: unknown; violations: string[] };
  repairs?: number;
}) => Promise<PlanDraftTurn>;

export type PlanDraftTurn =
  | { status: 'authored'; text: string; draft: unknown; violations: string[]; attempts: number }
  | { status: 'unavailable'; reason: 'transport' | 'empty' | 'aborted'; detail: string; cause?: unknown; attempts: number };

export interface AchieveContext extends CapabilityContext {
  /** The authoring seam. Absent ⇒ `achieve` executes but cannot author (see the module header). */
  draftAction?: ActionDrafter;
  /** The planning seam. Absent ⇒ BOTH upper rungs are skipped and `achieve` behaves exactly as it
   *  did before they existed - an honest default, never a silent degradation. */
  planStep?: PlanDrafter;
  /** The CALLER'S OWN collections (the compose rung's data side). Absent ⇒ that rung is skipped.
   *  Bound to the acting user's owner-shared scope by the composition root - the only unit `app_data`
   *  has for shared rows; this module never reaches a store itself. */
  appCollections?: AppCollections;
  /** Injected clock, so the persisted timestamps are deterministic under test. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// The wire result
// ---------------------------------------------------------------------------

/**
 * Why a goal could not be executed or authored. Every one of these is a REFUSAL of the whole call,
 * distinct from an executor result (a remote 500 is an answer, not a refusal).
 *
 *   `ambiguous_goal`        several actions fit and none fits best. Naming the candidates is the
 *                           honest answer; picking one would be a coin flip that might be a write.
 *   `provisional_match`     the best fit is an action the platform authored and no human has
 *                           promoted. `achieve` does not run those (lock 2).
 *   `not_custodian`         lock 6.
 *   `published_row`         the definition is `global` — edited through the publish flow only.
 *   `baseline_package`      a shipped package. A tenant forks it under a key of their own (A3's
 *                           reserved-key rule); `achieve` does not create a second policy for it.
 *   `not_writable`          a peer's row the caller may read but not write.
 *   `origin_refused`        the credential is locked, revoked or unresolvable — nothing may be
 *                           authored against it, exactly as nothing may be sent with it.
 *   `origin_unbound`        no bound host to check a draft against (the templated-baseUrl class).
 *   `authoring_unavailable` the drafting seam is not wired in this process.
 *   `billing_blocked`       the caller's allowance refuses a model call.
 *   `authoring_failed`      the chokepoint could not produce a draft (outage, abort, empty).
 *   `verification_failed`   a draft arrived and did NOT pass the guardrail suite. Nothing stored.
 *   `persist_failed`        the verified action could not be written (a concurrent write, a store
 *                           gate). Never silent — an unpersisted action is not an authored one.
 *
 * THE REUSE LADDER ADDS NOT ONE CODE TO THIS LIST, and the COUNT is the invariant rather than a
 * restatement of it: A RUNG THAT CAN ONLY ADD AN ANSWER MUST NEVER BE ABLE TO SUBTRACT ONE. Every
 * code above refuses a call that could not have run in the first place - no action fits the goal,
 * nothing may be authored against this credential, the store would not take the write. Not one of
 * them is a rung's verdict on a call that would otherwise have answered.
 *
 *   - the compose rung is not ENTERED for an action that can write, so a write cannot be refused by
 *     it. An earlier shape asked a model first and refused afterwards, which took a call that ran
 *     under a standing human approval and made it depend on a model's judgement to run at all.
 *   - the parametrize rung DISCARDS a plan its suite rejects and lets the call proceed on the
 *     caller's own arguments. An earlier shape refused the whole call, which is the same defect one
 *     rung up: a request that executed before this slice - the caller's arguments, the caller's
 *     action, a human's standing approval - stopped executing because a model wrote a bad argument.
 *   - THE COMPOSE RUNG NOW DOES THE SAME, on every path where its work cannot be done.
 *     `compose_refused`, `compose_unknown_collection` and `compose_unshaped_result` are GONE, and
 *     the last two were the worst members of this family the slice ever produced: they were decided
 *     AFTER the remote call had already been made AND HAD SUCCEEDED. The product performed the
 *     caller's work, got a good answer back, and then threw that answer away because a later stage
 *     could not run - spending the side effect and discarding the result, which is worse than
 *     refusing up front. `compose_refused` did not spend the side effect, but it still ended a call
 *     that EXECUTED before this slice existed, and the defence this comment used to carry for it
 *     ("refusing costs the caller a call they have not yet made") was simply untrue: the caller HAS
 *     made the call; only the request had not gone out yet.
 *
 * In all three cases the EXECUTED arm's answer is now returned UNCHANGED and the `compose` ladder
 * step says the composition did not apply, and why. The verdict travels BESIDE the answer, never
 * instead of it - which is exactly what the parametrize rung above already did.
 */
export type AchieveRefusalCode =
  | 'ambiguous_goal'
  | 'read_only_match'
  | 'provisional_match'
  | 'not_custodian'
  | 'published_row'
  | 'baseline_package'
  | 'not_writable'
  | 'origin_refused'
  | 'origin_unbound'
  | 'authoring_unavailable'
  | 'billing_blocked'
  | 'authoring_failed'
  | 'verification_failed'
  | 'persist_failed';

/**
 * THE LADDER, as a value. `achieve` is four rungs (reuse -> parametrize -> compose -> mint) and a
 * caller reading only `outcome` cannot tell which of them answered, nor what the ones above it
 * decided. "Why did it not parametrize" is the first question anyone asks of a rung that silently
 * did not fire.
 *
 * `mint` IS ON THIS LIST BECAUSE IT IS NOW PRODUCED. It was published for two rounds and pushed by
 * nothing: the author arm - the rung that writes a new action when no existing one fits - recorded
 * no step at all, so an `authored` answer carried a `ladder` field that was declared and always
 * absent, and the word `mint` named a rung no reader could ever observe. Publishing a vocabulary
 * nothing emits is the same defect as a doc describing a contract the code does not have. It is
 * emitted by `achieveIntegrationGoal`'s author arm, which is the only place that mints.
 *
 * WHERE THE LADDER APPEARS, exactly: on the three outcomes that CARRY AN ANSWER - `executed`,
 * `composed` and `authored`. NOT on `refused`, and that is a property of the shape below rather
 * than a convention: the refused variant has nowhere to put one. A refusal is the answer that no
 * rung produced anything, so "which rung answered" has no answer to report; what went wrong is the
 * refusal's own `code`, `message` and `violations`, which is one vocabulary rather than two.
 */
export type AchieveRung = 'reuse' | 'parametrize' | 'compose' | 'mint';

export interface AchieveLadderStep {
  rung: AchieveRung;
  /**
   * `taken` - this rung produced the answer.
   *
   * THE OTHER THREE ARE THREE DIFFERENT FACTS, and separating them is what this word is for:
   *
   *   `skipped`     - the rung DID NOT APPLY. Nothing was missing, no seam is wired, the goal asked
   *                   for nothing extra, D1 leaves this action nothing to offer. Nothing failed.
   *   `refused`     - "WE WOULD NOT." It applied, it ran, and its DETERMINISTIC SUITE threw the
   *                   answer away. `violations` says exactly what was wrong with it.
   *   `unavailable` - "WE COULD NOT RIGHT NOW." Its own work could not be done at all: the caller's
   *                   allowance does not cover a planning turn, the model was unreachable, the
   *                   credential would not resolve to a host, a store it reads rejected. NOTHING
   *                   WAS JUDGED, so there is nothing to report as a violation - and a caller who
   *                   retries later may get the rung's answer.
   *
   * A caller cannot act on those three the same way, and until this split they could not tell them
   * apart: the compose post-stage recorded A REJECTED MONGO QUERY as `refused` - the platform saying
   * it had considered the goal and declined it - and a billing-locked tenant was handed the bare
   * word "billing" on a rung that had judged nothing about them at all.
   *
   * NONE OF THE THREE IS A REFUSED CALL. On `parametrize` each of them means the request went out
   * as the caller shaped it; on `compose`, that the action answered unnarrowed.
   */
  verdict: 'taken' | 'skipped' | 'refused' | 'unavailable';
  /** ONE SENTENCE, ALWAYS THIS PLATFORM'S OWN WORDS - never a store's, a driver's or a provider's
   *  own message. See `applyComposition` for the rule and its reason. */
  detail?: string;
  /** `refused` - what the discarded answer got wrong, in the same words the top-level `violations`
   *  uses. An `unavailable` rung judged nothing and carries none. */
  violations?: string[];
}

export type AchieveResult =
  /**
   * An existing TRUSTED action satisfied the goal and was run through the gated executor.
   *
   * `filledValues` IS NOT ON THE 200 AND MUST NOT BE PUT THERE. It exists for the ONE answer where
   * a model's chosen values have to be READ by a person rather than acted on: the `awaiting_consent`
   * 403, where nothing has run and a human is being asked to authorise a write whose arguments a
   * model filled. The 200 carries NAMES only, deliberately and unchanged (see
   * `AchieveIntegrationGoalResponse.filledArgs`); the durable copy of the values is the
   * `capability_achieve_parametrize` audit row, which is written whether the gate opened or not.
   */
  | {
      outcome: 'executed';
      actionName: string;
      result: ExecuteIntegrationActionResult;
      /** REQUIRED, like `authored`'s: `runMatchedAction` records a step for every rung it ran, on
       *  every path, so "present on exactly the outcomes that carry an answer" is a fact about
       *  these types rather than a convention four return statements have to keep. */
      ladder: AchieveLadderStep[];
      filledArgs?: string[];
      filledValues?: Record<string, PlannedArgValue>;
    }
  /**
   * A trusted READ was run and its rows JOINED against one of the CALLER'S OWN collections. NOTHING
   * WAS MINTED and nothing was written: `items` is a subset of what the action itself returned.
   *
   * `result` IS THE ARM'S OWN ANSWER, VERBATIM, and it rides this outcome for the same reason it
   * rides `executed`: the composition is a POST-STAGE, and a post-stage that hands back its
   * narrowing INSTEAD of the answer it narrowed has destroyed one. What it destroyed was the
   * ENVELOPE - the upstream status, and every field standing BESIDE the list inside `data`
   * (`nextPage`, `total`, `hasMore`). Neither is recoverable from `items` or from `composition`, so
   * ONE PAGE of somebody's processes came back indistinguishable from all of them.
   *
   * The rows travel WHOLE rather than substituted: putting the narrowed list back under the third
   * party's own key would hand the caller a document that third party never emitted, under its
   * name. `items` is the narrowing; `result` is what was narrowed.
   */
  | {
      outcome: 'composed';
      actionName: string;
      result: ExecuteIntegrationActionResult;
      items: Record<string, unknown>[];
      composition: ComposeSummary;
      ladder: AchieveLadderStep[];
      filledArgs?: string[];
    }
  /**
   * No action satisfied it; one was authored, verified and persisted as PROVISIONAL.
   *
   * `ladder` IS REQUIRED HERE, and that is the fix for a field that was declared optional and then
   * populated by nothing. This is the MINT rung's own answer - the arm reached only when
   * `matchActionForGoal` finds nothing to reuse - so it always has exactly the two steps to report
   * that a reader needs: reuse could not (there was no action), and mint did.
   */
  | {
      outcome: 'authored';
      actionName: string;
      state: 'provisional';
      /** True when the action landed in a fresh COPY of a `global` integration (criterion 7). */
      forked: boolean;
      verification: AuthoredActionVerification;
      /** Always true: a provisional action is stored `mutates: true`, so it is gated. */
      requiresApproval: true;
      ladder: AchieveLadderStep[];
    }
  /**
   * Addressed, admitted, declined. NO `ladder`, BY CONSTRUCTION rather than by convention: this
   * variant has nowhere to put one, so the "present on exactly the outcomes that carry an answer"
   * rule is a fact about the type instead of a sentence somebody has to keep true. It was declared
   * optional for two rounds and passed by no call site - a published field nothing could populate.
   * What went wrong belongs to `code`/`message`/`violations`, which every client already reads.
   */
  | { outcome: 'refused'; code: AchieveRefusalCode; message: string; violations?: string[]; candidates?: string[] };

function refused(
  code: AchieveRefusalCode,
  message: string,
  extra: { violations?: string[]; candidates?: string[] } = {},
): CapabilityOutcome<AchieveResult> {
  return { ok: true, value: { outcome: 'refused', code, message, ...extra } };
}

// ---------------------------------------------------------------------------
// Goal matching
// ---------------------------------------------------------------------------

/**
 * Stopwords, PT + EN. Small on purpose: this is a tokeniser for short action names and one-line
 * descriptions, not an NLP pipeline, and every word removed here is a word that can no longer
 * distinguish two actions from each other.
 */
const GOAL_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'you', 'your', 'our', 'get', 'set',
  'please', 'want', 'need', 'can', 'could', 'would', 'should', 'about', 'via',
  'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'uma', 'um', 'que', 'por', 'como', 'meu', 'minha',
  'quero', 'preciso', 'pode', 'podes', 'sobre', 'este', 'esta', 'isso', 'todos', 'todas',
]);

function goalTokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !GOAL_STOPWORDS.has(t));
}

export type GoalMatch =
  | { kind: 'none' }
  | { kind: 'one'; action: IntegrationAction }
  | { kind: 'ambiguous'; candidates: string[] };

/**
 * Verbs that ask for a CHANGE. Portuguese and English, stemless and deliberately small.
 *
 * ── WHY THIS EXISTS: THE COVERAGE RULE IS VACUOUS FOR A NAME WITH NO VERB ─────────────────────
 *
 * `matchActionForGoal`'s safety property is "a goal that omits the verb omits the action". It is a
 * real property and it is not being weakened here. But it is a property of NAMES THAT CARRY A VERB:
 * an action whose name tokenises to a bare noun has no verb to omit, so EVERY goal mentioning that
 * noun covers it - including goals asking to destroy the thing.
 *
 * THIS IS NOT A CITIUS PROBLEM AND IT DID NOT ARRIVE WITH `processos`. `get` is a stopword
 * (GOAL_STOPWORDS), so `get_file`, `get_profile`, `get_agreement`, `get_invoice` and `get_request`
 * all tokenise to ONE token today, on google-workspace, microsoft-365, invoicexpress,
 * adobe-acrobat-sign and zoho-sign. Verified against this very function: "delete the file from the
 * drive" matches `get_file` as `one`, "cancel the agreement" matches `get_agreement`. The platform
 * has been answering `outcome: 'executed'` - a claim that the goal was ACHIEVED - to destructive
 * intents that produced a listing, on five shipped packages against real third-party accounts.
 * `processos` is the sixth instance, which is how the class was found; it is not the origin.
 *
 * ── WHAT IS SUBTRACTED, AND WHY IT IS NOT AN ANSWER ───────────────────────────────────────────
 *
 * D-S5-3's invariant is that a RUNG may only ADD an answer, never SUBTRACT one, and it is intact:
 * this is not a rung. It sits on the MATCH arm beside `ambiguous_goal`, decides BEFORE any request
 * leaves the building, spends no side effect, and names the action it declined to run so a caller
 * who did mean the read can ask for it by name. What it removes is not an answer the product had -
 * the product could never delete anything here - but a FALSE CLAIM that it had done so.
 *
 * ── THE LIST IS SMALL ON PURPOSE ──────────────────────────────────────────────────────────────
 *
 * Every word here costs a refusal when it appears in a goal whose only match reads, so the list
 * holds verbs that are unambiguously about changing state and leaves out anything that reads as
 * either ("ver", "rever", "fechar" as in closing a view). A false positive is a refusal that NAMES
 * the read and invites the caller to ask for it directly; a false negative is the false success
 * above. The asymmetry is why the list errs small rather than empty.
 */
const MUTATING_GOAL_VERBS: ReadonlySet<string> = new Set([
  // Portuguese
  'apagar', 'apague', 'eliminar', 'elimine', 'remover', 'remova', 'arquivar', 'arquive',
  'cancelar', 'cancele', 'anular', 'anule', 'revogar', 'revogue', 'extinguir',
  'submeter', 'submeta', 'enviar', 'envie', 'criar', 'crie', 'alterar', 'altere',
  'atualizar', 'atualize', 'apagando', 'eliminando',
  // English
  'delete', 'remove', 'archive', 'cancel', 'revoke', 'destroy', 'purge', 'erase',
  'submit', 'send', 'create', 'update', 'modify', 'overwrite',
]);

/**
 * Does this goal ask for a CHANGE that the matched action cannot make?
 *
 * TRUE only when BOTH halves hold: the goal names a mutating verb, and the action the deterministic
 * matcher picked declares `mutates: false`. A goal naming a destructive verb that matches a WRITE is
 * congruent and passes straight through to the write gate, which is where that decision belongs.
 *
 * `mutates === false` is the LITERAL reading `action-consent.ts` uses everywhere: an absent or
 * non-boolean `mutates` is a write, so an unvalidated `config.json` cannot earn a pass here by
 * omitting the field.
 */
export function mutatingGoalAgainstRead(
  goal: string,
  action: Pick<IntegrationAction, 'mutates' | 'actionName'>,
): string | null {
  if (action.mutates !== false) return null;
  // AN EXACT NAMING IS NOT A GOAL, IT IS AN INSTRUCTION - and this clause is what makes the refusal
  // honest rather than a dead end. The message the caller gets says "name the action directly if you
  // meant to read"; if naming it directly were ALSO refused, that sentence would be a lie and there
  // would be no way through at all. It is the same escape the original finding anticipated ("or
  // callers must name it exactly"), and the same equality `matchActionForGoal` already treats as
  // winning outright, so the two cannot disagree about what "exact" means.
  //
  // FOUND BY THE ESTATE, not by inspection: `integration-achieve.test.ts` calls `achieve` with the
  // literal action name `arquivar_processo` - a read whose own name carries a mutating verb - and
  // the first cut of this check refused it.
  if (goalTokens(goal).join('_') === goalTokens(action.actionName).join('_')) return null;
  for (const token of goalTokens(goal)) {
    if (MUTATING_GOAL_VERBS.has(token)) return token;
  }
  return null;
}

/**
 * Does an existing action satisfy the goal? DETERMINISTIC, and deliberately so.
 *
 * A model could pick more cleverly, but the thing being picked may be a WRITE against a third
 * party's account under the caller's own credential, and "the model thought you meant
 * `delete_invoice`" is not a sentence this product should be able to say.
 *
 * THE RULE IS COVERAGE, NOT OVERLAP, and the difference is the whole safety argument. An overlap
 * score matched `consultar_processo` against "arquivar um processo antigo" on the shared word
 * "processo" — i.e. it would have picked CONSULT for a goal that says ARCHIVE, and on another pair
 * of actions the same near-miss picks a write. So an action is a candidate only when the goal names
 * EVERY token of the action's own name; a goal that omits the verb omits the action.
 *
 *   1. An exact naming wins outright (`"submeter_peca"`, `"Submeter Peça"`).
 *   2. Otherwise: candidates are the actions whose name is FULLY covered by the goal. Among them,
 *      the longer name wins (it is the more specific reading), with description overlap as the
 *      tiebreak — a description can only ever separate two candidates, never create one.
 *   3. A TIE at the top is `ambiguous`, not a pick, and not a licence to author a duplicate: the
 *      caller is told which actions fit and asked to name one.
 *
 * Everything else is `none`, which routes to the author arm — where the guardrail suite, not this
 * function, decides whether anything is stored.
 */
export function matchActionForGoal(goal: string, actions: readonly IntegrationAction[]): GoalMatch {
  const goalSet = new Set(goalTokens(goal));
  if (goalSet.size === 0 || actions.length === 0) return { kind: 'none' };

  const canonicalGoal = [...goalTokens(goal)].join('_');
  const named = actions.filter((a) => goalTokens(a.actionName).join('_') === canonicalGoal);
  if (named.length === 1) return { kind: 'one', action: named[0] as IntegrationAction };
  if (named.length > 1) return { kind: 'ambiguous', candidates: named.map((a) => a.actionName).sort() };

  const scored = actions
    .map((action) => {
      const nameTokens = goalTokens(action.actionName);
      const covered = nameTokens.length > 0 && nameTokens.every((t) => goalSet.has(t));
      const descHits = goalTokens(action.description ?? '').filter((t) => goalSet.has(t)).length;
      return { action, covered, score: nameTokens.length * 2 + descHits };
    })
    .filter((s) => s.covered);
  if (scored.length === 0) return { kind: 'none' };
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best);
  if (top.length > 1) return { kind: 'ambiguous', candidates: top.map((s) => s.action.actionName).sort() };
  return { kind: 'one', action: (top[0] as { action: IntegrationAction }).action };
}

// ---------------------------------------------------------------------------
// Where an authored action may land
// ---------------------------------------------------------------------------

export type AuthoringTarget =
  /** The actor's own-org row, writable by them: the action is appended to it in place. */
  | { kind: 'in_place'; doc: IntegrationDefinitionDoc }
  /** A `global` row authored in ANOTHER org: COPY-ON-AUTHOR (criterion 7). */
  | { kind: 'fork'; sourceId: string; source: IntegrationDefinition }
  | { kind: 'refused'; code: 'published_row' | 'baseline_package' | 'not_writable' };

/**
 * THE COPY-ON-AUTHOR FORK, and the three cases that are NOT one.
 *
 *   - No stored row at all -> the shipped disk BASELINE. Refused. A tenant row shadowing a shipped
 *     key is exactly what A3's save path refuses ("the tenant either keeps the shipped package or
 *     forks it under a distinct key of their own"), and `achieve` must not become a second policy
 *     for the same question (Rule 1). Forking here would ALSO be the only fork in this function
 *     that reuses a RESERVED key.
 *   - A row of ANOTHER org -> by the A1 visibility gate that can only be a `global`, i.e. PUBLISHED
 *     row. FORK: a fresh `private` row in the acting tenant's org, seeded from the CROSS-ORG view
 *     (the frozen published snapshot, scrubbed — E2's rule for what another org may read), with the
 *     authored action appended. The global row is not read for a write, not opened for a write, and
 *     not written: it is a different document with a different `_id`, in a different org.
 *   - The actor's OWN-ORG row that is `global` -> refused `published_row`. It cannot be forked
 *     either, because a fork's `_id` is `definitionIdFor(orgId, key)` — the very row being
 *     published. A published definition is edited through the publish flow, including by its
 *     author (`definition-save.ts`, `canEditDefinitionRaw`); this is the same rule, not a new one.
 *   - The actor's own-org row they may not write -> `not_writable`. `canEditDefinitionRaw` is the
 *     SAME predicate the builder save admits, so `achieve` grants no write reach a builder save
 *     would not.
 */
export async function resolveAuthoringTarget(
  actor: Actor,
  integrationKey: string,
  store: Pick<IntegrationDefinitionStore, 'getForActor'> = integrationDefinitionStore,
): Promise<AuthoringTarget> {
  const doc = await store.getForActor(actor, integrationKey);
  if (!doc) return { kind: 'refused', code: 'baseline_package' };
  if (doc.orgId !== actor.orgId) {
    return { kind: 'fork', sourceId: doc._id, source: definitionFromDoc(doc, actor) };
  }
  if (doc.visibility === 'global') return { kind: 'refused', code: 'published_row' };
  if (!canEditDefinitionRaw(doc, actor)) return { kind: 'refused', code: 'not_writable' };
  return { kind: 'in_place', doc };
}

/** Content fields carried from a FORK SOURCE. Absent optionals are OMITTED rather than written as
 *  `undefined` — the Mongo driver serialises that as `null`, which the shared read schemas reject
 *  (definition-save.ts's `fieldsFromPackageConfig` documents the same hazard). */
function forkContentFrom(source: IntegrationDefinition): Record<string, unknown> {
  return {
    ...(source.displayName !== undefined ? { displayName: source.displayName } : {}),
    ...(source.description !== undefined ? { description: source.description } : {}),
    ...(source.version !== undefined ? { version: source.version } : {}),
    ...(source.authType !== undefined ? { authType: source.authType } : {}),
    ...(source.provider !== undefined ? { provider: source.provider } : {}),
    ...(source.category !== undefined ? { category: source.category } : {}),
    ...(source.credentialGuide !== undefined ? { credentialGuide: source.credentialGuide } : {}),
    ...(source.sessionConnect !== undefined ? { sessionConnect: source.sessionConnect } : {}),
    ...(source.webhookConfig !== undefined ? { webhookConfig: source.webhookConfig } : {}),
    ...(source.listenerConfig !== undefined ? { listenerConfig: source.listenerConfig } : {}),
  };
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/** Config-field NAMES, never values — the same facts `GET /api/v1/integrations` already publishes
 *  in `configSchema`. The definition holds no credential VALUE to leak here in the first place. */
function credentialFieldLines(fields: readonly IntegrationConfigField[]): string {
  if (fields.length === 0) return '(this integration declares no credential fields)';
  return fields.map((f) => `- {{${f.key}}} — ${f.label}${f.required ? ' (required)' : ''}`).join('\n');
}

function existingActionLines(actions: readonly IntegrationAction[]): string {
  if (actions.length === 0) return '(no actions yet)';
  return actions
    .map((a) => {
      const where = a.httpConfig ? ` [${a.httpConfig.method} ${a.httpConfig.baseUrl}${a.httpConfig.path}]` : '';
      return `- ${a.actionName} — ${a.description}${where}`;
    })
    .join('\n');
}

/**
 * The output contract, ALWAYS the last system section (the authoring core's one prompt rule).
 *
 * Every constraint stated here is ALSO enforced deterministically by `verifyAuthoredAction`. The
 * prompt exists so the first turn is usually right; the suite exists because the prompt is not a
 * control. Where the two could disagree, the suite wins and the draft is refused.
 */
function outputContractFor(allowedOrigins: readonly string[]): string {
  return [
    '# Output contract',
    'Reply with EXACTLY ONE fenced ```action-json block and no other fenced block. Inside it, a',
    'single JSON object describing ONE new HTTP action:',
    '',
    '```action-json',
    '{',
    '  "actionName": "snake_case_name",',
    '  "description": "one line, in the language of the goal",',
    '  "mutates": true,',
    '  "httpConfig": {',
    '    "method": "GET|POST|PUT|PATCH|DELETE",',
    '    "baseUrl": "https://<one of the allowed hosts>",',
    '    "path": "/resource/{{arg_name}}",',
    '    "headers": { "authorization": "Bearer {{credential_field}}" },',
    '    "queryParams": { "limit": "{{limit}}" },',
    '    "bodyTemplate": { "field": "{{arg_name}}" }',
    '  },',
    '  "argsSchema": { "type": "object", "properties": { "arg_name": { "type": "string" } } }',
    '}',
    '```',
    '',
    '# Hard rules (a draft that breaks any of these is refused and nothing is stored)',
    `1. baseUrl MUST be a literal https URL on one of these hosts: ${allowedOrigins.join(', ')}.`,
    '   It may NOT contain a {{placeholder}}.',
    '2. Every {{placeholder}} must name a credential field listed above or a property you declare',
    '   in argsSchema. No other name is permitted.',
    '3. Never paste a literal credential. A credential is always a {{placeholder}}.',
    '4. actionName must be new (not one of the existing actions), lowercase letters, digits and',
    '   underscores, starting with a letter.',
    '5. Set "mutates" honestly: true if the call creates, changes, sends or deletes anything.',
    '   It is recorded, and a human confirms it before the action can ever run.',
    '6. Declare no automationBinding, no backingType and no transport: this is an HTTP action.',
  ].join('\n');
}

/** Extract the single ```action-json block and parse it. No JSON repair pass: a malformed block is
 *  a VIOLATION the core's repair turn feeds back, which fixes it with the model's own eyes rather
 *  than with a second copy of `agents/`'s repair heuristics (Rule 1). */
export function parseActionDraft(text: string): { draft: AuthoredActionDraft | null; violations: string[] } {
  const block = text.match(/```action-json\s*\n([\s\S]*?)```/);
  if (!block) return { draft: null, violations: ['no ```action-json block in the reply'] };
  let parsed: unknown;
  try {
    parsed = JSON.parse((block[1] as string).trim());
  } catch (err) {
    return { draft: null, violations: [`the action-json block is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { draft: null, violations: ['the action-json block must contain a single JSON object'] };
  }
  return { draft: parsed as AuthoredActionDraft, violations: [] };
}

// ---------------------------------------------------------------------------
// achieve
// ---------------------------------------------------------------------------

/**
 * EXECUTE-OR-AUTHOR. See the module header for the six locks; the body below is deliberately
 * linear so the ORDER of the refusals is readable, and the order is load-bearing:
 *
 *   tenant -> definition (resolved AS THE CUSTODIAN, exactly as execution does) -> match ->
 *   [execute] | custodian check -> writable target -> egress binding -> allowance -> draft ->
 *   verify -> persist.
 *
 * Everything that can refuse WITHOUT paying for a model call is checked before the model call.
 */
export async function achieveIntegrationGoal(
  ctx: AchieveContext,
  integrationKey: string,
  goal: string,
  args: Record<string, unknown> = {},
  store: IntegrationDefinitionStore = integrationDefinitionStore,
): Promise<CapabilityOutcome<AchieveResult>> {
  const resolved = await resolveCapabilityDefinition(ctx.actor, integrationKey);
  if (!resolved.ok) return resolved;
  const { definition, config, definitionActor } = resolved.value;

  // --- MATCH -------------------------------------------------------------------------------
  const match = matchActionForGoal(goal, definition.actions ?? []);
  if (match.kind === 'ambiguous') {
    return refused(
      'ambiguous_goal',
      'several actions fit this goal equally well — name the one you want',
      { candidates: match.candidates },
    );
  }
  if (match.kind === 'one') {
    // THE GOAL ASKS TO CHANGE SOMETHING AND THE ONLY ACTION THAT FITS ONLY READS.
    //
    // Placed HERE, above every other decision on this arm, because the cheapest honest answer is
    // the one that costs nothing: no trust lookup, no credential, no request, no model turn. See
    // `mutatingGoalAgainstRead` for why the coverage rule alone cannot catch this, and for the five
    // shipped packages that have had the same exposure since long before this action existed.
    //
    // The candidate is NAMED rather than hidden: a caller who did mean the read asks for it by
    // name, exactly as `ambiguous_goal` expects them to.
    const mutatingVerb = mutatingGoalAgainstRead(goal, match.action);
    if (mutatingVerb) {
      return refused(
        'read_only_match',
        `this goal asks to ${mutatingVerb}, and the only action that fits it - "${match.action.actionName}" - can only read. `
          + 'Nothing here can carry out that change; name the action directly if you meant to read.',
        { candidates: [match.action.actionName] },
      );
    }
    if (!isTrustedAction(integrationKey, match.action)) {
      return refused(
        'provisional_match',
        `action "${match.action.actionName}" was authored by the platform and has not been confirmed by a person yet — confirm it before it can be run`,
        { candidates: [match.action.actionName] },
      );
    }
    return runMatchedAction(ctx, integrationKey, goal, match.action, args, definition, config);
  }

  // --- AUTHOR - THE MINT RUNG ---------------------------------------------------------------
  //
  // THE ONE PLACE THAT MINTS, and now the one place that says so. `AchieveRung` has published the
  // word `mint` since the ladder shipped and nothing ever pushed it, so a client reading `ladder`
  // on an `authored` answer found the field absent and the vocabulary unreachable.
  //
  // The rung ABOVE it is recorded too, with the reason this arm was reached at all: `match.kind`
  // is `none` here, which is the deterministic matcher saying there is nothing to reuse. Neither
  // parametrize nor compose appears, and their absence is honest rather than an omission - both act
  // on a MATCHED action's arguments and rows, and there is no matched action on this arm. A step
  // for them would be reporting a decision nothing took.
  //
  // Nothing below this line records a step: every exit between here and the answer is a REFUSAL,
  // and a refusal carries no ladder by construction (see `AchieveResult`).
  const ladder: AchieveLadderStep[] = [
    { rung: 'reuse', verdict: 'skipped', detail: 'no existing action fits this goal, so one was written' },
  ];

  // LOCK 6. The definition governing this credential resolves as its CUSTODIAN; if that is not the
  // acting user, an authored action would be both the exfiltration shape the custodian rule closed
  // (a peer choosing the hosts an admin's credential is spent against) and unreachable, since the
  // executor would never resolve the peer's row. Refuse rather than mint a trap.
  if (definitionActor.userId !== ctx.actor.userId) {
    return refused(
      'not_custodian',
      'this integration\'s credentials were set up by somebody else in your organisation — ask them to extend it',
    );
  }

  const target = await resolveAuthoringTarget(definitionActor, integrationKey, store);
  if (target.kind === 'refused') {
    return refused(target.code, AUTHORING_TARGET_MESSAGES[target.code]);
  }

  // LOCK 5. The granted egress scope, resolved BEFORE the draft exists and through the ONE rule
  // both executor rails project (`resolveCredentialEgressBinding`). `granted` is the pre-image the
  // draft's host must already be inside; the other two answers refuse authoring outright.
  const binding = await resolveCredentialEgressBinding(ctx.actor, config, integrationKey);
  if (binding.kind === 'refused') {
    return refused('origin_refused', 'this integration\'s credential is locked or unreachable — nothing can be authored against it');
  }
  if (binding.kind === 'unbound') {
    return refused(
      'origin_unbound',
      'this integration declares no fixed host, so there is nothing to bind a new action to — add the first action in the integration builder',
    );
  }

  if (!ctx.draftAction) {
    return refused('authoring_unavailable', 'authoring new actions is not available in this deployment');
  }
  const allowance = await checkAllowance(ctx.actor.userId);
  if (!allowance.ok) {
    return refused('billing_blocked', allowance.message ?? 'Faturação bloqueada.');
  }

  const skillMd = await resolveSkillMd(definitionActor, integrationKey);
  // S3: what the AUTHOR themselves recorded about this integration's existing actions - a hint for
  // the draft, and the last content section before the output contract.
  //
  // `ctx.actor` AND NOT `definitionActor`, said here because the two are provably equal on this arm
  // and the choice would otherwise read as arbitrary. LOCK 6 above has already refused unless
  // `definitionActor.userId === ctx.actor.userId`, so the same rows come back either way today. The
  // ACTING user is still the right term: a note is guidance the caller wrote for themselves, and
  // reading it under the credential's CUSTODIAN would make "whose notes reach this prompt" depend
  // on a rule about credentials rather than on who is asking. If LOCK 6 is ever relaxed, this line
  // is already correct instead of needing to be found.
  const feedback = await feedbackForPrompt(ctx.actor, integrationKey);
  const contentSections = [
    [
      '# The integration you are extending',
      `key: ${definition.key}`,
      `name: ${definition.displayName ?? definition.key}`,
      `description: ${definition.description ?? '(none)'}`,
      `auth type: ${definition.authType ?? 'none'}`,
    ].join('\n'),
    `# Credential fields you may reference (names only — you never see a value)\n${credentialFieldLines(definition.configSchema ?? [])}`,
    `# Actions that already exist (do not duplicate one)\n${existingActionLines(definition.actions ?? [])}`,
    `# Hosts this integration's credential is bound to\n${binding.origins.map((o) => `- ${o}`).join('\n')}`,
    ...(skillMd ? [`# What is known about this integration\n${skillMd}`] : []),
    // Already carries its own heading, because the section is built where the rows are scrubbed and
    // capped - the one place a note becomes prompt text (`action-feedback.ts`).
    ...(feedback ? [feedback] : []),
  ];

  const turn = await ctx.draftAction({
    contentSections,
    outputContract: outputContractFor(binding.origins),
    userText: (violations) =>
      violations && violations.length > 0
        ? [
          'Your previous draft was refused. Fix exactly these problems and re-emit the whole action-json block:',
          ...violations.map((v) => `- ${v}`),
          '',
          `The goal is still: ${goal}`,
        ].join('\n')
        : `Write ONE new action that achieves this goal:\n\n${goal}`,
    decision: decideForTask(goal, undefined, 'WORKHORSE'),
    attribution: authoringAttribution(ctx.actor),
    parse: parseActionDraft,
    // ONE repair turn. A generic retry produces identical garbage; the violations are what make a
    // retry fix anything (the authoring core's own rule). More than one turn of feedback on a
    // deterministic suite is paying twice for the same answer.
    repairs: 1,
  });

  if (turn.status === 'unavailable') {
    return refused('authoring_failed', `the authoring model was unavailable (${turn.reason})`);
  }

  // THE SUITE IS RE-RUN OVER THE PARSED DRAFT, whatever the turn reported. `turn.violations` is
  // the PARSER's verdict (was there a well-formed block); the guardrails are this module's.
  const { verification, draft } = verifyAuthoredAction({
    integrationKey,
    draft: turn.draft,
    definition,
    allowedOrigins: binding.origins,
    ...(ctx.now ? { now: ctx.now } : {}),
  });
  if (!verification.passed || !draft) {
    const violations = [
      ...turn.violations,
      ...verification.checks.filter((c) => !c.ok).map((c) => c.detail ?? `${c.name} failed`),
    ];
    return refused('verification_failed', 'the authored action did not pass the guardrails and was not stored', { violations });
  }

  const action = provisionalActionFrom({
    integrationKey,
    draft,
    actor: ctx.actor,
    goal,
    verification,
    ...(ctx.now ? { now: ctx.now } : {}),
  });

  try {
    await persistAuthoredAction(ctx.actor, integrationKey, target, action, skillMd ?? '', store);
  } catch (err) {
    const detail = err instanceof IntegrationDefinitionStoreError ? err.message : 'the authored action could not be stored';
    return refused('persist_failed', detail);
  }

  await auditAuthored(ctx, integrationKey, action, target.kind === 'fork');
  // THE RUNG THAT ANSWERED. `taken` has one meaning across all four rungs - "this rung produced the
  // answer" - and on this arm the answer is a PROVISIONAL action that has not run, which the
  // outcome's own `state` and `requiresApproval` already say. The step reports which rung produced
  // it, not that anything was executed.
  ladder.push({ rung: 'mint', verdict: 'taken', detail: `wrote "${action.actionName}" as provisional` });
  return {
    ok: true,
    value: {
      outcome: 'authored',
      actionName: action.actionName,
      state: 'provisional',
      forked: target.kind === 'fork',
      verification,
      requiresApproval: true,
      ladder,
    },
  };
}

// ---------------------------------------------------------------------------
// The reuse ladder - reuse -> parametrize -> compose
// ---------------------------------------------------------------------------

/**
 * WHAT HAPPENS TO A MATCHED, TRUSTED ACTION. Three rungs, in one linear body, ending in the ONE
 * call this module makes to the gated executor.
 *
 * THE PICK IS NOT ON THIS LADDER. `matchActionForGoal` chose the action, deterministically and
 * lexically, before any of this ran - and nothing below can change that choice, widen it, or reach
 * a second action. Every model turn here is downstream of a pick a human already trusted.
 *
 * THE ORDER IS LOAD-BEARING:
 *   1. PARAMETRIZE fills arguments the action DECLARES and the caller LEFT OUT. Its output changes
 *      what the one request carries, so it must be settled before the request exists.
 *   2. COMPOSE decides whether the answer needs a join, and ONLY for an action that cannot write.
 *      Its output changes nothing about the request - it decides what happens to the ROWS
 *      afterwards - but it is planned BEFORE the execute so that a plan which cannot be honoured
 *      costs no model turn to discover.
 *   3. EXECUTE, once, through `executeIntegrationCapabilityAction`. C2's write gate sits inside it,
 *      before any credential is read, exactly as on every other rail. Neither rung reaches past it,
 *      neither rung re-implements it, and a `mutates` action still answers `awaiting_consent` here
 *      no matter which rung filled its arguments.
 *
 * EVERY RUNG DEGRADES TO THE ONE BELOW IT, and that is the Rule-7 promise: an absent seam, a
 * refused allowance, a model outage, a goal with nothing extra in it - each of those SKIPS a rung
 * and leaves the call behaving exactly as it did before the ladder existed.
 *
 * AND SO DOES A REJECTED PLAN, ON BOTH RUNGS. This is the sentence three previous rounds asserted
 * and the code did not honour, so it is now stated as a claim about the SHAPE of the body below
 * rather than as an aspiration: **there is exactly one `return` here for an admitted call that was
 * not composed, and it always carries `out.value`.**
 *
 *   - parametrize discards the model's arguments and the request goes out as the CALLER shaped it;
 *   - compose discards the model's plan and the action answers unnarrowed;
 *   - every way the compose POST-STAGE can fail to apply - a failed execute, a collection name the
 *     caller does not hold, an answer with no single list in it - falls through to that same exit
 *     rather than to a refusal. Two of those three used to refuse AFTER the request had gone out
 *     and come back 200, which spent the side effect and then discarded the result;
 *   - AND SO DOES A THROW, ON BOTH RUNGS. `parametrizeArgs`, `planComposition` and
 *     `applyComposition` each convert a rejection out of their seams into a ladder step and a
 *     nothing-answer, because a refusal, a swallowed answer and an exception are three exits from
 *     the same wrong idea.
 *
 *     THE PARAMETRIZE RUNG WAS THE LAST ONE WITHOUT THAT SPLIT, and its position made it the worse
 *     of the two. `checkAllowance` is three store operations (`ensureAccount`, a lazy-reset write,
 *     the global overage read) and `ctx.planStep` reaches the LLM chokepoint over a socket; both
 *     reject on an ordinary bad day, and neither was caught. The rejection left `runMatchedAction`
 *     BEFORE the one gated execute, so `achieveIntegrationGoal` never called the action at all: a
 *     trusted action, the caller's own arguments and a human's standing approval came back as a 500
 *     error envelope because a billing account read blipped. The compose rung throws AFTER the
 *     answer exists and destroys it; this one threw BEFORE it exists and prevents it. Both are the
 *     rung taking the call away.
 *
 *     `resolveCredentialEgressBinding` is NOT in that list, and the difference is a fact about that
 *     function rather than an oversight: it wraps its own body in a `try` and answers `refused` on
 *     any failure, deliberately, so that a resolver error can never WIDEN a binding. It therefore
 *     cannot reject - and the price is that a LOCKED credential and a FAILED RESOLVER reach this
 *     rung as the same value. The rung says so in one sentence for both rather than inventing a
 *     distinction it does not have (see `draftParametrizedArgs`).
 *
 * The stood-down rung is recorded on the ladder - with its `violations` where it JUDGED something,
 * and with `unavailable` where it judged nothing and simply could not run - BESIDE the answer it
 * did not prevent. Nothing on this ladder may take away an answer the product already has or is
 * about to get: not by returning one, not by refusing one, and not by throwing.
 */
async function runMatchedAction(
  ctx: AchieveContext,
  integrationKey: string,
  goal: string,
  action: IntegrationAction,
  callerArgs: Record<string, unknown>,
  definition: IntegrationDefinition,
  config: Parameters<typeof resolveCredentialEgressBinding>[1],
): Promise<CapabilityOutcome<AchieveResult>> {
  const ladder: AchieveLadderStep[] = [];

  // --- RUNG 2: PARAMETRIZE ------------------------------------------------------------------
  //
  // `parametrizeArgs` returns ARGUMENTS. It has no way to return a refusal, and it cannot throw -
  // the worker/recorder split below says both - so this statement can only ever leave `args` equal
  // to what the caller sent or to what the caller sent plus values a deterministic suite admitted.
  const { args, filled } = await parametrizeArgs(
    ctx,
    integrationKey,
    goal,
    action,
    callerArgs,
    definition,
    config,
    ladder,
  );
  // The NAMES, derived from the values rather than carried beside them: two fields for one fact is
  // two fields that can disagree.
  const filledArgs = Object.keys(filled).sort();

  // --- RUNG 1: REUSE - the ONE gated execute, whatever the rung above decided ----------------
  //
  // NOTHING IS RECORDED HERE ANY MORE, and that is the point. The durable copy of what a model chose
  // is written by `parametrizeArgs` BEFORE this line, because a record written afterwards is a
  // record that can be absent exactly when the write it describes succeeded - see
  // `recordParametrization`.
  const out = await executeIntegrationCapabilityAction(ctx, integrationKey, action.actionName, args);
  if (!out.ok) return out;

  // --- RUNG 3: COMPOSE (planned and applied over the rows the execute returned) --------------
  //
  // AFTER THE EXECUTE, NOT BEFORE, AND THAT ORDER IS THE FIX FOR THIS RUNG'S SHARPEST DEFECT. While
  // the planning turn ran first, the only things it could be shown were the action's NAME, its
  // description and the caller's collection NAMES - not one field name from either side - while its
  // output contract demanded three of them. The model could only invent identifiers, and an invented
  // field name does not fail loudly: it produces a SHORTER LIST, delivered confidently. Running here
  // means the rows are in hand, so both field sets are real and every name the model returns is
  // checked against the set it was offered (`action-compose.ts`, D-S5-5).
  //
  // `composeOver` cannot refuse and cannot throw. Its worst answer is null, recorded on the ladder,
  // and the answer the product is already holding falls through to the one exit below unchanged.
  const composed = await composeOver(ctx, integrationKey, goal, action, out.value, ladder);
  if (composed) {
    return {
      ok: true,
      value: {
        outcome: 'composed',
        actionName: action.actionName,
        // THE ARM'S ANSWER, ON THE ARM THAT NARROWED IT. This exit used to carry `items` and nothing
        // of what produced them, so the upstream status and every sibling of the list inside `data`
        // - a `nextPage` cursor above all - were destroyed by a stage that only ever meant to ADD a
        // narrowing. It is the single-exit rule of this function applied to the one return that was
        // exempt from it: every exit for an admitted call now carries `out.value`.
        result: out.value,
        items: composed.items,
        composition: composed.summary,
        ladder,
        // Reported here for the same reason it is reported on `executed`: an answer that was BOTH
        // model-parametrized and model-narrowed is the one an auditor most needs to see whole.
        ...(filledArgs.length > 0 ? { filledArgs } : {}),
      },
    };
  }

  // THE EXIT FOR AN ADMITTED CALL THAT WAS NOT COMPOSED. BOTH exits carry `out.value` now, which is
  // the property this structure was built for and the one the composed branch above was quietly
  // exempt from: while the compose branches each returned for themselves, three of them returned a
  // REFUSAL and the executor's answer was dropped on the floor - twice AFTER the request had gone
  // out and come back 200. There is no return left in this function that answers an admitted call
  // without the answer the executor produced, and "the answer survives" is therefore a property of
  // the shape of the function rather than of a reader checking each branch.
  //
  // The REUSE rung is what answered, and it says so: without this step a client reading the ladder
  // finds no rung `taken` at all beside an `executed` outcome, and "which rung answered" is the one
  // question the ladder exists to answer.
  ladder.push({ rung: 'reuse', verdict: 'taken' });
  return {
    ok: true,
    value: {
      outcome: 'executed',
      actionName: action.actionName,
      result: out.value,
      ladder,
      ...(filledArgs.length > 0 ? { filledArgs } : {}),
      // NOT PUT ON THE 200 BY THE ROUTE - see `AchieveResult`. The write gate's 403 is projected off
      // this same value, and it is the one answer where a human has to read what a model chose.
      ...(filledArgs.length > 0 ? { filledValues: filled } : {}),
    },
  };
}

/**
 * ONE REPAIR TURN, for both new rungs, and it is a NUMBER rather than two literals.
 *
 * A generic retry produces identical garbage - the violations are what make a retry fix anything -
 * so one turn of feedback on a deterministic suite is the whole budget the author arm allows itself
 * and the whole budget these two get. The bound is stated once because it is a bound in BOTH
 * directions and the two are different failures:
 *
 *   HIGHER - every extra turn is another metered chokepoint call on somebody's allowance, and
 *            another chance for a model to talk itself out of a plan the suite had already
 *            accepted. The rung exists to add an answer, not to keep buying attempts at one.
 *   LOWER  - zero repairs means a reply the PARSER rejected (a missing fence, malformed JSON) ends
 *            the rung. The model never learns what was wrong with a mistake it would usually fix on
 *            being told, so the caller pays for a turn and gets nothing for it.
 *
 * It is a budget for PARSE violations only. A plan that parses and then fails the deterministic
 * suite is NOT re-prompted: it lands on the ladder, beside the answer, naming what it got wrong.
 */
const PLAN_REPAIR_BUDGET = 1;

/**
 * WHAT THE PARAMETRIZE RUNG PRODUCED. Two members, and the absence of a third is the same point the
 * compose rung's two attempt types make: a stage that fills in blanks the caller left has no way to
 * say "and therefore there is no call".
 *
 * `none` carries the LADDER WORDING rather than pushing it, so every step this rung records is
 * written at ONE place - see `parametrizeArgs`. That is not tidiness: it is what makes "a throw
 * cannot leave a half-written ladder behind" true by construction rather than by reading every
 * branch and checking that each push is followed by a return.
 */
type ParametrizeAttempt =
  | { kind: 'filled'; args: Record<string, PlannedArgValue>; filled: string[] }
  | {
      kind: 'none';
      verdict: 'skipped' | 'refused' | 'unavailable';
      detail: string;
      /** `refused` only: the deterministic guardrails the discarded plan did not meet. */
      violations?: string[];
    };

/**
 * THE PARAMETRIZE RUNG, whole: decide what the one request will carry, before that request exists.
 *
 * IT RETURNS ARGUMENTS. Never a refusal - the return type has nowhere to put one - and never an
 * exception, which the type alone did not buy and which is the defect this split closes.
 *
 * WHAT COULD THROW HERE, IN THE CODE RATHER THAN IN PRINCIPLE. `checkAllowance` is three store
 * operations (`ensureAccount`, the lazy-reset write, the global overage read) and `ctx.planStep`
 * reaches the LLM chokepoint over a socket. Either rejects on a dropped connection, a timeout, a
 * replica-set election. Neither was caught, and this rung sits ABOVE the one gated execute - so the
 * rejection left `runMatchedAction` before the action was ever called, out of `achieveIntegrationGoal`
 * and into the route's error handler as a 500. A trusted action, the caller's own arguments and a
 * human's standing approval, answered with an error envelope because a billing account read blipped.
 *
 * That is the compose rung's defect one rung up and one step worse. The compose post-stage throws
 * AFTER the answer exists and destroys it; this threw BEFORE it exists and prevented it. "A rung
 * that can only ADD an answer must never be able to SUBTRACT one" was true of everything this rung
 * RETURNS and false of what it could throw.
 *
 * SO THE WORK IS IN `draftParametrizedArgs`, which touches the seams and MAY throw, and this
 * function converts every one of its outcomes - a rejection included - into ONE ladder step plus
 * the caller's own arguments. There is no expression in this body that can escape.
 *
 * THERE ARE NOW TWO GUARDED AWAITS, NOT ONE, AND THE SECOND IS THE RUNG'S PRICE OF ADMISSION.
 * `recordParametrization` writes the durable copy of what the model chose, and it is awaited HERE -
 * before the one gated execute - rather than after it, deliberately not catching its own failure.
 * A record written after the call and swallowing its own rejection is a record that can be absent
 * exactly when the irreversible write it describes succeeded. Its rejection lands on the same
 * degradation path everything else in this function lands on: the plan is dropped, the request goes
 * out as the CALLER shaped it, one ladder step says `unavailable`. The rung still cannot subtract
 * an answer, and a model-chosen value can no longer reach a third party unrecorded.
 *
 * WHAT A THROW PUTS ON THE WIRE IS FIXED TEXT, `applyComposition`'s rule for `applyComposition`'s
 * reason: a store rejection's message names a namespace, a host and a query shape, and the ladder
 * is a caller-facing field. The error's own message goes to the process log for an operator.
 */
async function parametrizeArgs(
  ctx: AchieveContext,
  integrationKey: string,
  goal: string,
  action: IntegrationAction,
  callerArgs: Record<string, unknown>,
  definition: IntegrationDefinition,
  config: Parameters<typeof resolveCredentialEgressBinding>[1],
  ladder: AchieveLadderStep[],
): Promise<{ args: Record<string, unknown>; filled: Record<string, PlannedArgValue> }> {
  let attempt: ParametrizeAttempt;
  try {
    attempt = await draftParametrizedArgs(ctx, integrationKey, goal, action, callerArgs, definition, config);
  } catch (err) {
    console.warn(
      `[integration-achieve] parametrize rung failed for ${integrationKey}.${action.actionName}: ${err instanceof Error ? err.message : String(err)}`,
    );
    attempt = {
      kind: 'none',
      // `unavailable`, NOT `refused`: nothing was judged. No plan was seen, no guardrail fired, and
      // nothing at all was decided about the caller's goal - so the one word that would tell them
      // otherwise is the one word this branch may not use.
      verdict: 'unavailable',
      detail: 'the arguments for this action could not be planned, so the call runs with the arguments you supplied',
    };
  }
  if (attempt.kind === 'none') {
    ladder.push({
      rung: 'parametrize',
      verdict: attempt.verdict,
      detail: attempt.detail,
      ...(attempt.violations ? { violations: attempt.violations } : {}),
    });
    // `callerArgs` BY IDENTITY, not a copy of it: the request that goes out is byte-for-byte the
    // request the caller asked for, on every one of these paths.
    return { args: callerArgs, filled: {} };
  }

  // THE RECORD OF THE CHOICE IS A PRECONDITION OF THE CHOICE.
  //
  // This write used to sit AFTER the one gated execute, wrapped in a `catch` that logged and moved
  // on, and that ordering is what made the audit trail deniable: the only durable copy of "a model,
  // not the person holding the key, decided what this call would act on" could be silently absent
  // exactly when the third-party write it describes had SUCCEEDED. A trail that is missing precisely
  // on the runs that mattered is not a trail.
  //
  // Written here, nothing has been spent yet - so the failure has somewhere to go that is not
  // silence and is not a destroyed answer. The rung STANDS DOWN: the model's arguments are dropped,
  // the request goes out carrying exactly what the caller sent, and the ladder says so. That is the
  // rung's own degradation path, reached for the one new reason. It keeps the invariant this branch
  // was built around - a rung may only ADD an answer, never subtract one - while making the missing
  // row impossible rather than tolerable: if the choice is not recorded, the choice is not made.
  //
  // REFUSING THE CALL INSTEAD WOULD BE THE DEFECT. `achieve` refusing because an activity insert
  // blipped is the parametrize rung taking away a call that a trusted action, the caller's own
  // arguments and a human's standing approval had already earned (D-S4-3/D-S5-6).
  try {
    await recordParametrization(ctx, integrationKey, action, attempt.args);
  } catch (err) {
    console.warn(
      `[integration-achieve] parametrize record failed for ${integrationKey}.${action.actionName}: ${err instanceof Error ? err.message : String(err)}`,
    );
    ladder.push({
      rung: 'parametrize',
      // `unavailable`: nothing was judged here either. The plan passed every guardrail; what could
      // not be done was keeping the record of it.
      verdict: 'unavailable',
      // No `err` in this string - a store rejection's message names a namespace, a host and a query
      // shape, and this is a caller-facing field.
      detail: 'what a model chose for this call could not be recorded, so the call runs with the arguments you supplied',
    });
    return { args: callerArgs, filled: {} };
  }

  ladder.push({ rung: 'parametrize', verdict: 'taken', detail: `filled: ${attempt.filled.join(', ')}` });
  // THE CALLER'S OWN ARGUMENTS WIN, spread last.
  //
  // HONEST NOTE: this order is UNOBSERVABLE, and saying so is better than implying a second enforced
  // rule. `verifyPlannedArgs`'s `declared_args` check refuses any plan naming a key the caller
  // supplied, so `attempt.args` and `callerArgs` are disjoint by the time we get here and either
  // spread order produces the same object. Reversing it is an equivalent mutant - no test can
  // distinguish it, and none pretends to. What IS asserted is the invariant that makes it
  // unobservable (see the `declared_args` overwrite case, and the disjointness assertion beside it);
  // the order below is kept because it is the one that stays correct if that check is ever weakened.
  return { args: { ...attempt.args, ...callerArgs }, filled: attempt.args };
}

/**
 * The parametrize rung's WORK. Touches both seams, MAY throw, and writes nothing - no ladder step,
 * no state at all. See `attemptComposition` and `draftCompositionPlan` for the same division and
 * its reason.
 *
 * D1 IS APPLIED BEFORE THE MODEL IS ASKED rather than after: an argument a model may not fill on
 * this action is never OFFERED to it. Not asking is cheaper than refusing, and it keeps a write
 * whose targeting the caller omitted behaving exactly as it does today - the request goes out as
 * the caller shaped it - instead of turning into a new refusal. `mayBeModelFilled` is the ONE
 * statement of D1, shared with `verifyPlannedArgs` so the filter and the suite cannot drift. It is
 * an ALLOWLIST - a write offers only its BODY arguments - which is what makes it correct for an
 * automation-backed action, whose request this module cannot read at all and whose arguments
 * therefore used to slip through a "not targeting" test.
 */
async function draftParametrizedArgs(
  ctx: AchieveContext,
  integrationKey: string,
  goal: string,
  action: IntegrationAction,
  callerArgs: Record<string, unknown>,
  definition: IntegrationDefinition,
  config: Parameters<typeof resolveCredentialEgressBinding>[1],
): Promise<ParametrizeAttempt> {
  const missing = missingDeclaredArgs(action, callerArgs);
  if (missing.length === 0) {
    return { kind: 'none', verdict: 'skipped', detail: 'the caller supplied every argument the action declares' };
  }
  const fillable = missing.filter((name) => mayBeModelFilled(action, name));
  const withheld = missing.filter((name) => !mayBeModelFilled(action, name));
  if (fillable.length === 0) {
    return {
      kind: 'none',
      verdict: 'skipped',
      detail: `"${action.actionName}" can write, so only a person supplies arguments that do not land in its request body: ${withheld.sort().join(', ')}`,
    };
  }
  if (!ctx.planStep) {
    // A DEPLOYMENT FACT, not a failure: this process was built without the seam, retrying changes
    // nothing, and the call behaves exactly as it did before the ladder existed.
    return { kind: 'none', verdict: 'skipped', detail: 'the planning seam is not wired in this deployment' };
  }

  // THE RENDER PROBE NEEDS A PRE-IMAGE, AND ONLY AN HTTP ACTION HAS ONE. An automation-backed action
  // addresses no URL from this module, so `assertOriginAllowed` has nothing to say about it either
  // way, and requiring a granted binding would disable the rung for a whole backing type on the
  // strength of a check that does not apply to it.
  const binding = action.httpConfig ? await resolveCredentialEgressBinding(ctx.actor, config, integrationKey) : null;
  if (binding !== null && binding.kind === 'unbound') {
    // The executor's own `unbound` class: a templated base URL this platform cannot read a host out
    // of. There is no pre-image to probe a filled argument against and there never will be for this
    // definition, so this is `skipped` - nothing failed, and nothing is going to.
    return {
      kind: 'none',
      verdict: 'skipped',
      detail: 'this integration declares no fixed host, so there is no bound origin to check a filled argument against',
    };
  }
  if (binding !== null && binding.kind !== 'granted') {
    // `refused`, WHICH IS TWO FACTS THIS RUNG CANNOT TELL APART, and the sentence says only what is
    // true of both. `resolveCredentialEgressBinding` wraps its whole body in a `try` and answers
    // `refused` on any failure - deliberately, so a resolver error can never WIDEN a binding - so a
    // credential that is genuinely locked or revoked and a resolver that simply fell over arrive
    // here as the same value. Naming either one would be this rung asserting a distinction it does
    // not have; `unavailable` is the honest verdict for the pair, and it is also the actionable one
    // (both are fixed by the caller or by time, neither is a judgement on their goal).
    return {
      kind: 'none',
      verdict: 'unavailable',
      detail: "this integration's credential could not be resolved to a host, so the call runs with the arguments you supplied",
    };
  }

  const allowance = await checkAllowance(ctx.actor.userId);
  if (!allowance.ok) {
    // NOT `refused`, AND NOT THE BARE WORD "billing". A tenant out of allowance has had nothing
    // judged about their goal - the rung never ran - and telling them it was refused says the
    // platform considered what they asked for and declined it. What is true is that an optional
    // extra could not be bought right now, and that the call they made ran anyway.
    return {
      kind: 'none',
      verdict: 'unavailable',
      detail: 'your plan allowance does not currently cover a planning turn, so the call runs with the arguments you supplied',
    };
  }

  const turn = await ctx.planStep({
    contentSections: parametrizeSections(definition, action, fillable, withheld, callerArgs),
    outputContract: argsOutputContractFor(action, fillable),
    userText: repairableUserText(`Supply the arguments this action needs for the goal:\n\n${goal}`),
    decision: decideForTask(goal, undefined, 'WORKHORSE'),
    attribution: authoringAttribution(ctx.actor),
    parse: parseArgsPlan,
    repairs: PLAN_REPAIR_BUDGET,
  });
  if (turn.status === 'unavailable') {
    // An outage is not a refusal, and now it does not read like one either. The call proceeds with
    // the caller's own arguments, which is precisely what it did before this rung existed.
    return { kind: 'none', verdict: 'unavailable', detail: `the planning model was unavailable (${turn.reason})` };
  }

  const verdict = verifyPlannedArgs({
    action,
    definition,
    planned: turn.draft,
    callerArgs,
    allowedOrigins: binding?.kind === 'granted' ? binding.origins : [],
  });
  if (!verdict.passed || !verdict.args) {
    // THE PLAN IS THROWN AWAY, THE CALL IS NOT.
    //
    // This used to `return refused('parametrize_refused', …)`, and that was the same defect the
    // compose rung had one rung down: an `achieve` that EXECUTED before this slice - the caller's
    // own arguments, an action a human trusted, a standing approval behind any write - stopped
    // executing because a model proposed a bad argument. The rung was added to give MORE answers; a
    // rung that can subtract one is a regression however good its reason.
    //
    // Nothing unsafe survives the discard: `verdict.args` is null, so not one model-supplied value
    // reaches the request, which goes out byte-for-byte as the caller asked for it. What the
    // guardrails caught is REPORTED rather than acted on - the ladder step carries the violations,
    // so a client sees "your arguments were not filled, here is why" BESIDE the answer.
    //
    // AND THIS ONE REALLY IS `refused`: a deterministic suite looked at a real plan and rejected it.
    // Retrying the same goal is expected to be rejected again, which is exactly what distinguishes
    // it from the three `unavailable` branches above.
    return {
      kind: 'none',
      verdict: 'refused',
      detail: 'the arguments proposed for this action did not pass the guardrails and were discarded; the call ran with the arguments you supplied',
      violations: [
        ...turn.violations,
        ...verdict.checks.filter((c) => !c.ok).map((c) => c.detail ?? `${c.name} failed`),
      ],
    };
  }
  const filled = Object.keys(verdict.args).sort();
  if (filled.length === 0) {
    return { kind: 'none', verdict: 'skipped', detail: 'the model determined no argument from the goal' };
  }
  return { kind: 'filled', args: verdict.args, filled };
}

/**
 * WHAT THE POST-STAGE PRODUCED. Two members, and the absence of a third is the point: a stage that
 * post-processes an answer has no way to say "and therefore the answer is gone".
 *
 * `not_applied` carries the LADDER WORDING rather than pushing it, so that every step this rung
 * records is written at ONE place - see `applyComposition`. That is not tidiness: it is what makes
 * "a throw cannot leave a half-written ladder behind" true by construction rather than by reading
 * every branch and checking that each push is followed by a return.
 */
type CompositionAttempt =
  | { kind: 'composed'; items: Record<string, unknown>[]; summary: ComposeSummary }
  | { kind: 'not_applied'; verdict: 'skipped' | 'refused' | 'unavailable'; detail: string };

/**
 * THE WHOLE COMPOSE RUNG, in the one place `runMatchedAction` calls it: PLAN, then APPLY, over the
 * answer the execute already produced. Three lines, and they are three lines rather than an inlined
 * pair because the guarantee is about the SHAPE - each half writes its own ladder step and neither
 * can return a refusal or escape by throwing, so this function's return type ("the narrowed answer,
 * or nothing") is the strongest thing the rung can say about itself.
 *
 * The plan carries its `actionRows` forward instead of the stage re-deriving them: the suite judged
 * `join.resultField` against exactly that array, and a second `rowsOf` here would be a second
 * reading of the same answer that could disagree with the first.
 */
async function composeOver(
  ctx: AchieveContext,
  integrationKey: string,
  goal: string,
  action: IntegrationAction,
  result: ExecuteIntegrationActionResult,
  ladder: AchieveLadderStep[],
): Promise<{ items: Record<string, unknown>[]; summary: ComposeSummary } | null> {
  const planned = await planComposition(ctx, goal, action, result, ladder);
  if (planned.kind === 'none') return null;
  return applyComposition(ctx, integrationKey, action, planned.plan, planned.actionRows, ladder);
}

/**
 * THE COMPOSITION POST-STAGE. Returns the narrowed answer, or NULL when it could not be built -
 * NEVER a refusal, NEVER a throw, and it can construct neither: the type says the first and the
 * shape below says the second.
 *
 * THIS IS WHERE THE LADDER KEPT SUBTRACTING AN ANSWER, over three rounds, and every version of the
 * defect happened AFTER the request had gone out and come back 200 - the side effect spent, the
 * rows in hand:
 *
 *   - a FAILED execute carries no `data` (`action-executor.ts` returns `{ success: false, status,
 *     code, error, details }` for a non-2xx), so `rowsOf` read `unshaped` and the caller was told
 *     "the action returned no list to compose over" instead of the remote's own 500 - a less
 *     accurate story that named the WRONG SYSTEM as the one that failed;
 *   - an UNKNOWN COLLECTION returned `compose_unknown_collection`, discarding a successful result
 *     the product had already paid for and already had in hand;
 *   - an UNSHAPED RESULT returned `compose_unshaped_result`, discarding the same;
 *   - and then, with all three of those turned into `return null`, THE STAGE COULD STILL THROW.
 *     `ctx.appCollections.read` is bound in `server.ts` to `CollectionsEngine.list`, which is a
 *     Mongo query: it REJECTS on a dropped connection, a timeout, a replica-set election. That
 *     rejection propagated out of here, out of `runMatchedAction`, out of `achieveIntegrationGoal`
 *     and into the route's error handler as a 500 - so the caller's processos were fetched from a
 *     third party, returned 200, and then thrown away because THIS platform's database hiccuped.
 *     A refusal, a swallowed answer and an exception are three exits from the same wrong idea: a
 *     post-stage does not get to decide the answer no longer exists.
 *
 * A composition is an ADDITION to an answer. When the addition cannot be made, what is left is the
 * answer - not nothing, and not a stack trace. So the work happens in `attemptComposition`, which
 * touches the seam and MAY throw, and this function converts every one of its outcomes - including
 * a rejection - into a ladder step plus a null. There is no expression in this body that can
 * escape: the only `await` outside the `try` is `auditComposed`, which catches its own.
 *
 * WHAT A THROW PUTS ON THE WIRE IS FIXED TEXT. The error's own message is logged for an operator
 * and never travels: a store rejection's message is this platform's internals (a namespace, a
 * host, a query shape), and the ladder is a caller-facing field.
 *
 * NO AUDIT ROW IS WRITTEN unless a join really happened, which is the truth of what occurred: the
 * `capability_achieve_compose` row exists to record that a SECOND data source was read to narrow
 * somebody's answer, and on these paths none was.
 *
 * AND THE ONE `await` OUTSIDE THE `try` IS NOW PINNED RATHER THAN ASSERTED. "auditComposed catches
 * its own" was the entire argument for this function's shape and was a claim about code no test
 * exercised: remove that catch and a rejecting `activityLogs.insert` becomes a 500 that destroys a
 * narrowed answer already computed and correct - the same defect one step later than the throw
 * above. A rejection is now injected into the compose row's write specifically, and the suite
 * requires the composed answer whole.
 */
async function applyComposition(
  ctx: AchieveContext,
  integrationKey: string,
  action: IntegrationAction,
  plan: NonNullable<ReturnType<typeof verifyComposePlan>['plan']>,
  actionRows: readonly Record<string, unknown>[],
  ladder: AchieveLadderStep[],
): Promise<{ items: Record<string, unknown>[]; summary: ComposeSummary } | null> {
  let attempt: CompositionAttempt;
  try {
    attempt = await attemptComposition(ctx, action, plan, actionRows);
  } catch (err) {
    console.warn(
      `[integration-achieve] compose post-stage failed for ${integrationKey}.${action.actionName}: ${err instanceof Error ? err.message : String(err)}`,
    );
    attempt = {
      kind: 'not_applied',
      // `unavailable`, and it used to say `refused` - the exact conflation this rung's own header
      // warns about elsewhere. A rejected Mongo query is not the platform having considered the
      // caller's goal and declined it: NOTHING WAS JUDGED. The plan passed every guardrail; a
      // database blipped. Telling the caller "refused" invites them to change their goal, when the
      // only useful thing they can do is ask again.
      verdict: 'unavailable',
      // No `err` in this string, deliberately - see the header.
      detail: `the data this goal would have been narrowed by could not be read, so "${action.actionName}" answers unnarrowed`,
    };
  }
  if (attempt.kind === 'not_applied') {
    ladder.push({ rung: 'compose', verdict: attempt.verdict, detail: attempt.detail });
    return null;
  }
  ladder.push({
    rung: 'compose',
    verdict: 'taken',
    detail: `${attempt.summary.matched} of ${attempt.summary.scanned} rows kept`
      // The caller is told in words as well as in the summary: an answer narrowed against a
      // PREFIX of the collection is a subset of the answer they asked for.
      + (attempt.summary.collectionTruncated
        ? `, matched against the first ${attempt.summary.collectionScanned} rows of "${attempt.summary.collection}" only`
        : ''),
  });
  await auditComposed(ctx, integrationKey, action.actionName, attempt.summary);
  return { items: attempt.items, summary: attempt.summary };
}

/**
 * The post-stage's WORK, and the only part of it that touches a seam. It may throw - the store read
 * below is a real database query - and it writes NOTHING: no ladder step, no audit row, no state at
 * all. That is what lets `applyComposition` treat a rejection exactly like any other "did not
 * apply" answer instead of having to reason about what a half-finished attempt left behind.
 */
async function attemptComposition(
  ctx: AchieveContext,
  action: IntegrationAction,
  plan: NonNullable<ReturnType<typeof verifyComposePlan>['plan']>,
  actionRows: readonly Record<string, unknown>[],
): Promise<CompositionAttempt> {
  const collection = await (ctx.appCollections as AppCollections).read(ctx.actor, plan.collection);
  if (collection.kind === 'unknown_collection') {
    // NO EXISTENCE ORACLE, and the reason is structural rather than careful wording: this function
    // has read exactly one scope - the caller's own - so it holds NO fact about another tenant to
    // disclose, whatever it says. The isolation suite compares the whole response for a name another
    // org holds against the response for a name nobody holds and requires them equal, which is a
    // REGRESSION guard on that structure (no mutation here can break it) rather than a test of this
    // string. What keeps the structure true is `AppCollectionRead`: its not-found answer is a bare
    // tag with nowhere for such a fact to travel, and the module suite pins that shape.
    return {
      kind: 'not_applied',
      verdict: 'refused',
      detail: `you hold no "${plan.collection}" collection to narrow this by, so "${action.actionName}" answers unnarrowed`,
    };
  }
  const composed = composeRows({ plan, actionRows, collectionRows: collection.rows });
  if (composed.kind === 'not_applicable') {
    // THE FLOOR UNDER THE RUNG. The plan was judged against what the LISTER said this collection
    // holds; these are the rows the READER actually returned, one query later, and they do not carry
    // a field the plan names. Narrowing by a field nobody has is not a stricter filter - it is a
    // filter that never ran, and it hands back a shorter list that reads exactly like a correct one.
    // So the composition does not apply and the executed arm's whole answer goes back instead.
    return {
      kind: 'not_applied',
      verdict: 'refused',
      detail: `"${plan.collection}" has no ${composed.missing.map((f) => `"${f}"`).join(' and no ')} on the rows read, so "${action.actionName}" answers unnarrowed`,
    };
  }
  return { kind: 'composed', items: composed.items, summary: composed.summary };
}

/**
 * WHAT THE PLANNING STAGE PRODUCED. Same two-member discipline as `CompositionAttempt`, and for the
 * same reason: the worker returns a VALUE and `planComposition` writes the one ladder step, so a
 * throw out of the model seam or the collection lister cannot leave a step behind.
 */
type CompositionPlanAttempt =
  | {
      kind: 'plan';
      plan: NonNullable<ReturnType<typeof verifyComposePlan>['plan']>;
      /** The rows the plan was JUDGED against, carried forward so the stage below joins exactly the
       *  array `verifyComposePlan` checked `join.resultField` on. Re-deriving them there would be a
       *  second reading of the same answer, and the two could drift. */
      actionRows: Record<string, unknown>[];
    }
  | { kind: 'none'; verdict: 'skipped' | 'refused' | 'unavailable'; detail: string; violations?: string[] };

/**
 * PLAN THE JOIN, or decline to. Runs with the executed answer already in hand.
 *
 * READS ONLY, AND THE GATE IS STILL FIRST. v1 composes over reads; an action that can write leaves
 * this function before the residue is computed, before the collections are listed, before the
 * allowance is checked and above all before a model is asked. That ORDER is the fix for a
 * regression, not a micro-optimisation: while the gate sat downstream of the model turn, a `mutates`
 * action with a wordy goal could be refused outright on the strength of a plan a model volunteered -
 * so a call that had been executing for months under a standing human approval started depending on
 * a model's judgement to run at all. A rung that only ever ADDS an answer must never SUBTRACT one,
 * and for a WRITE the only way to guarantee that is to not enter the rung at all. Moving the stage
 * after the execute did not move that gate: it is still the first statement in the body.
 *
 * WHY IT RUNS AFTER THE EXECUTE AT ALL. The planning turn has to name FIELDS - of the collection and
 * of the action's own rows - and until this move the second set did not exist anywhere the platform
 * could see it. `returnSchema` is unvalidated documentation lifted off a `config.json`, absent on
 * almost every action and describing the ENVELOPE rather than the row when present, so the rung was
 * asking a model to invent an identifier and then silently narrowing somebody's answer by whatever
 * it invented. With the rows in hand the set is exact, `fieldsOf` states it, and `verifyComposePlan`
 * refuses outside it (D-S5-5).
 *
 * FOUR DISQUALIFICATIONS NOW COST NOTHING that used to cost a model call: a failed execute, an
 * answer with no single list in it, an answer with no rows, and a goal with no residue all leave
 * here before `ctx.planStep` is reached.
 *
 * FOR A READ, THE GUARANTEE IS THE RETURN TYPE. This function used to be able to answer `refused`
 * when the deterministic suite rejected the model's plan, which ended the whole call - the same
 * subtraction, one step earlier in the body, on the rung the entry gate had just been moved to
 * protect. It cannot now: the type below has two members and neither of them is a refusal.
 *
 * AND IT CANNOT THROW EITHER, which the return type alone did not buy. `ctx.appCollections.list` is
 * `CollectionsEngine.listCollectionFields` - a Mongo aggregation - and `ctx.planStep` reaches the
 * LLM chokepoint; either can reject. A rejection here happens with a spent side effect and the rows
 * already in hand, so letting it out would destroy an answer the product has already paid for and
 * already holds - the same subtraction the post-stage below was fixed for, wearing an exception
 * instead of a refusal. "The database was busy" is not a reason to withhold an answer that arrived.
 *
 * `mutates === false` as a LITERAL is `action-consent.ts`'s fail-closed reading: an absent or
 * malformed `mutates` is a write, and a write is not composed over. That reading is OBSERVABLE at
 * this seam and not merely at `mayBeModelFilled`'s: `definitions.ts` builds a package definition's
 * actions as `config.actions ?? []` - straight off an unvalidated `config.json`, no schema, no
 * coercion - and `definition-store.ts` writes an agent-authored action through `withoutRecipes`,
 * which returns it verbatim. So an action reaching here with NO `mutates` at all is a production
 * shape, not a hypothetical, and the suite drives one through the real store to prove that reading
 * this `!== false` as `=== true` would enter the rung on it.
 *
 * THE PRE-FILTER IS DETERMINISTIC AND FREE. The model is consulted only when the goal carries
 * tokens the action's own name and description do not account for - i.e. when the caller asked for
 * something more than the action is named for. "processos" against an action called `processos`
 * has no residue and costs nothing; "todos os processos de clientes com menos de 40 anos" has
 * `clientes`, `menos`, `40`, `anos` left over, and that residue is the whole question.
 */
async function planComposition(
  ctx: AchieveContext,
  goal: string,
  action: IntegrationAction,
  result: ExecuteIntegrationActionResult,
  ladder: AchieveLadderStep[],
): Promise<
  // TWO ANSWERS, and the absence of a third is the point: THERE IS NO REFUSAL IN THIS TYPE. This
  // function used to be able to return one, and a caller reading the signature could not tell that
  // asking a model a question might end the whole call. Now it cannot: whatever a model says, the
  // worst outcome expressible here is "no plan", and the call proceeds to the rung below.
  | { kind: 'none' }
  | {
      kind: 'plan';
      plan: NonNullable<ReturnType<typeof verifyComposePlan>['plan']>;
      actionRows: Record<string, unknown>[];
    }
> {
  let attempt: CompositionPlanAttempt;
  try {
    attempt = await draftCompositionPlan(ctx, goal, action, result);
  } catch (err) {
    console.warn(
      `[integration-achieve] compose planning failed for "${action.actionName}": ${err instanceof Error ? err.message : String(err)}`,
    );
    attempt = {
      kind: 'none',
      // `unavailable` rather than `skipped`, for the reason `applyComposition`'s catch is not
      // `refused`: a rejected store query or a dropped chokepoint socket is neither "this did not
      // apply" nor "we looked and said no". It is "we could not, right now", and it is the one of
      // the three a caller can usefully retry.
      verdict: 'unavailable',
      // Fixed text; the error's own message is an operator's fact, not a caller's - see
      // `applyComposition`'s header for the same rule on the post-stage.
      detail: 'the composition could not be planned, so the action runs and answers as it always did',
    };
  }
  if (attempt.kind === 'none') {
    ladder.push({
      rung: 'compose',
      verdict: attempt.verdict,
      detail: attempt.detail,
      ...(attempt.violations ? { violations: attempt.violations } : {}),
    });
    return { kind: 'none' };
  }
  return { kind: 'plan', plan: attempt.plan, actionRows: attempt.actionRows };
}

/**
 * The planning stage's WORK. Touches both seams, MAY throw, and writes nothing - see
 * `attemptComposition` for the same division and its reason.
 */
async function draftCompositionPlan(
  ctx: AchieveContext,
  goal: string,
  action: IntegrationAction,
  result: ExecuteIntegrationActionResult,
): Promise<CompositionPlanAttempt> {
  if (action.mutates !== false) {
    return {
      kind: 'none',
      verdict: 'skipped',
      detail: `"${action.actionName}" can change data, and a composed answer is only ever built from a read`,
    };
  }
  // A FAILED EXECUTE IS AN ANSWER ABOUT THE REMOTE SYSTEM, and it is returned whole. Judged here,
  // before a planning turn is bought, because there is nothing to narrow and nothing to narrow it
  // by: a non-2xx carries no `data` at all (`action-executor.ts`).
  if (!result.success) {
    return {
      kind: 'none',
      verdict: 'skipped',
      detail: `"${action.actionName}" did not succeed, so its own answer is returned unchanged rather than narrowed`,
    };
  }
  const accounted = new Set([...goalTokens(action.actionName), ...goalTokens(action.description ?? '')]);
  const residue = goalTokens(goal).filter((t) => !accounted.has(t));
  if (residue.length === 0) {
    return { kind: 'none', verdict: 'skipped', detail: 'the goal asks for nothing the action is not already named for' };
  }
  if (!ctx.planStep || !ctx.appCollections) {
    return { kind: 'none', verdict: 'skipped', detail: 'the compose seams are not wired in this deployment' };
  }
  // THE ROWS ARE FOUND BEFORE ANYTHING IS SPENT ON THEM. `rowsOf` refuses to guess between two lists
  // rather than picking one, and a result it cannot read is a result there is no honest way to
  // narrow - so both leave here without a store read and without a model turn.
  const rows = rowsOf(result.data);
  if (rows.kind === 'unshaped') {
    return { kind: 'none', verdict: 'refused', detail: `${rows.detail}, so "${action.actionName}" answers unnarrowed` };
  }
  if (rows.rows.length === 0) {
    return {
      kind: 'none',
      verdict: 'skipped',
      detail: `"${action.actionName}" returned no rows, so there is nothing to narrow`,
    };
  }
  // THE ACTION-SIDE FIELD SET, exact and from the rows themselves. This is the half the rung never
  // had: without it `join.resultField` was accepted as any non-empty string, and a wrong one emptied
  // the join silently.
  //
  // BOTH SETS GO THROUGH `promptSafeFields` HERE, AT THE ONE PLACE THEY ARE PRODUCED, and that
  // position is the whole guarantee rather than a convenience. These names are third-party writable
  // - the action side is a remote API's own JSON keys, the collection side is whatever a served app
  // wrote into `app_data`, where field names pass no guard at any write path - and they are
  // interpolated into a system prompt. Bounding them where they are BORN means the value the prompt
  // renders and the value `verifyComposePlan` enforces are the same array, so a name that is not
  // offered is not accepted either; bounding them at the prompt alone would leave a cosmetic guard,
  // and at the suite alone would refuse names the model was shown. See `action-compose.ts`.
  const resultFields = promptSafeFields(fieldsOf(rows.rows));
  const collections = (await ctx.appCollections.list(ctx.actor)).map((c) => ({
    name: c.name,
    fields: promptSafeFields(c.fields),
  }));
  if (collections.length === 0) {
    return { kind: 'none', verdict: 'skipped', detail: 'your organisation holds no collections to narrow a result by' };
  }
  const allowance = await checkAllowance(ctx.actor.userId);
  if (!allowance.ok) {
    // THE SIBLING RUNG'S WORDING, and for its reason: a tenant out of allowance has had nothing
    // judged about their goal, so they are not told it was refused - and "billing" on its own was
    // never a sentence anybody could act on.
    return {
      kind: 'none',
      verdict: 'unavailable',
      detail: 'your plan allowance does not currently cover a planning turn, so the action answers unnarrowed',
    };
  }

  const turn = await ctx.planStep({
    contentSections: composeSections(action, collections, resultFields),
    outputContract: composeOutputContract(),
    userText: repairableUserText(`Decide whether this goal needs one of those collections:\n\n${goal}`),
    decision: decideForTask(goal, undefined, 'WORKHORSE'),
    attribution: authoringAttribution(ctx.actor),
    parse: parseComposePlan,
    repairs: PLAN_REPAIR_BUDGET,
  });
  if (turn.status === 'unavailable') {
    return { kind: 'none', verdict: 'unavailable', detail: `the planning model was unavailable (${turn.reason})` };
  }

  // JUDGED AGAINST THE VERY SETS THE TURN WAS SHOWN. Passing anything else here - a re-listed
  // collection set, a re-derived row set - would mean the suite checking a plan against facts the
  // model never saw, which is how a fair refusal turns into an arbitrary one.
  const verdict = verifyComposePlan({ planned: turn.draft, collections, resultFields });
  if (!verdict.passed) {
    // THE PLAN IS THROWN AWAY, THE CALL IS NOT - the parametrize rung's rule, one rung down, and it
    // took a round to be carried here. This used to `return refused('compose_refused', …)` and
    // NOTHING RAN: an `achieve` on a trusted READ that had been executing since long before this
    // slice stopped executing because a model wrote a malformed join. The old defence for it was
    // that the refusal "costs the caller a call they have not yet made"; the caller had made the
    // call, and what they got back for it was nothing.
    //
    // Nothing unsafe survives the discard: `verdict.plan` is null on a failed verdict, so no
    // model-named collection, field or comparison reaches the stage, and the answer that goes back
    // is byte-for-byte the answer the action produced.
    return {
      kind: 'none',
      verdict: 'refused',
      detail: 'the way this goal would have been narrowed did not pass the guardrails and was discarded; the action answers unnarrowed',
      violations: [
        ...turn.violations,
        ...verdict.checks.filter((c) => !c.ok).map((c) => c.detail ?? `${c.name} failed`),
      ],
    };
  }
  if (!verdict.plan) {
    return { kind: 'none', verdict: 'skipped', detail: 'no collection narrows this goal' };
  }
  return { kind: 'plan', plan: verdict.plan, actionRows: rows.rows };
}

/** The repair wording both rungs use. Identical in shape to the author arm's, and for its reason:
 *  the violations are what make a retry fix anything; a generic retry produces identical garbage. */
function repairableUserText(base: string): (violations: readonly string[] | null) => string {
  return (violations) =>
    violations && violations.length > 0
      ? ['Your previous answer was refused. Fix exactly these problems and re-emit the whole block:', ...violations.map((v) => `- ${v}`), '', base].join('\n')
      : base;
}

/** Facts the parametrize turn is given. NAMES ONLY - no credential value exists in this module to
 *  leak, and the argument values the CALLER supplied are named, never quoted, because they are the
 *  caller's data and the model is being asked about the ones they did NOT supply. */
function parametrizeSections(
  definition: IntegrationDefinition,
  action: IntegrationAction,
  fillable: readonly string[],
  withheld: readonly string[],
  callerArgs: Record<string, unknown>,
): string[] {
  const where = action.httpConfig ? `${action.httpConfig.method} ${action.httpConfig.baseUrl}${action.httpConfig.path}` : '(not an HTTP action)';
  const supplied = Object.keys(callerArgs).sort();
  return [
    [
      '# The action a person already confirmed, and that you are NOT choosing',
      `integration: ${definition.displayName ?? definition.key}`,
      `action: ${action.actionName}`,
      `what it does: ${action.description}`,
      `request: ${where}`,
      `changes data: ${action.mutates === false ? 'no' : 'yes'}`,
    ].join('\n'),
    `# Arguments it declares\n${JSON.stringify(action.argsSchema ?? {}, null, 2)}`,
    `# Arguments you are asked to supply\n${fillable.map((n) => `- ${n}`).join('\n')}`,
    ...(supplied.length > 0 ? [`# Arguments the person already supplied (do not restate them)\n${supplied.map((n) => `- ${n}`).join('\n')}`] : []),
    ...(withheld.length > 0
      ? [`# Arguments only a person may supply for this action (do not supply them)\n${withheld.map((n) => `- ${n}`).join('\n')}`]
      : []),
  ];
}

/**
 * Facts the compose turn is given: the action, THE FIELD NAMES ON THE ROWS IT RETURNED, and the
 * caller's own collections WITH THEIR FIELD NAMES.
 *
 * THE TWO FIELD LISTS ARE THE POINT OF THIS FUNCTION, and their absence was the rung's sharpest
 * defect. This used to render the action's name, its one-line description, `changes data` and a
 * bare list of collection names - not one field name anywhere - while the output contract demanded
 * three field names back. There was no set to choose from, so the model invented identifiers, and
 * `matchesSimpleQuery` reads an invented field as `undefined` on every row: the caller got a
 * SHORTER LIST of their own cases, with nothing to distinguish it from a correct narrowing.
 *
 * NAMES ONLY, STILL. No row and no VALUE from either side is put in a prompt to decide whether to
 * look at that data - `fieldsOf` and the store's lister both answer keys. The action-side keys are
 * the caller's own answer to their own call; the collection-side keys are the caller's own data,
 * scoped by the composition root to the acting user and nobody else (the isolation suite pins that
 * a peer's collection is neither named nor described here).
 */
function composeSections(
  action: IntegrationAction,
  collections: readonly ComposeCollection[],
  resultFields: readonly string[],
): string[] {
  return [
    [
      '# The action that already ran (chosen and confirmed by a person, never by you)',
      `action: ${action.actionName}`,
      `what it does: ${action.description}`,
      // Not a ternary: this rung is entered only for `mutates === false`, so a branch printing
      // "yes" would be a line no caller can ever reach, restating a gate that has already fired.
      'changes data: no',
    ].join('\n'),
    `# Fields on the rows it returned - the ONLY names "join.resultField" may take\n${resultFields.map((f) => `- ${f}`).join('\n')}`,
    [
      '# Collections this organisation holds, and the fields on their rows',
      '# "collection" must be one of these names; "where.field" and "join.collectionField" must be',
      '# fields listed for the collection you choose.',
      // `(no fields)` is the same unreachable-through-the-product default as
      // `verifyComposePlan`'s `'none'`: every row the engine writes carries `id`/`createdAt`/
      // `updatedAt` (see `listCollectionFields`), so no honest fixture renders this branch.
      ...collections.map((c) => `- ${c.name}: ${c.fields.length > 0 ? c.fields.join(', ') : '(no fields)'}`),
    ].join('\n'),
  ];
}

/**
 * ONE activity row per COMPOSE. An execute already logs itself inside the executor; what is new
 * here is that a SECOND data source was read and used to narrow somebody's answer, and "which
 * collection, filtered how" is exactly what an audit has to be able to answer afterwards.
 * NOT recorded: the goal text, the rows, or any value the join keyed on.
 */
async function auditComposed(
  ctx: AchieveContext,
  integrationKey: string,
  actionName: string,
  summary: ComposeSummary,
): Promise<void> {
  try {
    await logActivity(
      { userId: ctx.actor.userId, username: ctx.username ?? ctx.actor.userId, orgId: ctx.actor.orgId },
      'integrations',
      'capability_achieve_compose',
      ctx.deps,
      {
        integrationKey,
        actionName,
        collection: summary.collection,
        field: summary.where.field,
        op: summary.where.op,
        scanned: summary.scanned,
        collectionScanned: summary.collectionScanned,
        // On the audit row for the same reason it is on the wire: "the join saw part of the
        // collection" is a fact about how somebody's answer was built, and an auditor asked later
        // why a row is missing cannot reconstruct it from anything else here.
        collectionTruncated: summary.collectionTruncated,
        matched: summary.matched,
        ...(ctx.principal ? { keyId: ctx.principal.keyId } : {}),
        ...(ctx.principal?.xClient ? { xClient: ctx.principal.xClient } : {}),
      },
    );
  } catch (err) {
    console.warn(`[integration-achieve] compose audit write failed for ${integrationKey}.${actionName}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * ONE activity row per PARAMETRIZED CALL, AND IT CARRIES THE VALUES - WRITTEN BEFORE THE CALL.
 *
 * This is the only durable record that a MODEL, rather than the person or the script holding the
 * key, decided what a call would act on. Nothing else in the estate holds it: `capability_execute`
 * records the integration, the action, a verdict, a status and a duration and no arguments at all;
 * the 200 carries `filledArgs` as NAMES; the request itself is a socket write to a third party that
 * this platform keeps no copy of. So "the model chose the `titulo` this peça was filed under" was
 * reconstructable from nothing, which is the difference between an audit trail and a shrug.
 *
 * IT DOES NOT CATCH, AND IT RUNS BEFORE THE EXECUTE. Both halves are one decision, and the second
 * is what makes the first affordable. Written after the call and swallowing its own failure - which
 * is how this row shipped - the record of a model's choice could be silently absent EXACTLY when the
 * irreversible write it describes had succeeded, and there is no worse moment for an audit row to go
 * missing. `parametrizeArgs` owns the rejection now, before anything has been spent: it drops the
 * model's arguments, the call goes out as the CALLER shaped it, and the ladder says `unavailable`.
 * If the choice cannot be recorded, the choice is not made.
 *
 * THE OUTCOME IS NOT ON THIS ROW, and its absence is deliberate rather than lost. `verdict`/`code`
 * used to be copied here off the executor's result, which is the same fact `capability_execute`
 * already records for the same call one row later - two rows carrying one fact, and the ONLY reason
 * this row had to wait for the call. An auditor reads the pair: this row says what a model chose,
 * that row says what happened when it was spent. Both are written for a gate refusal too, so
 * "a model chose these values and the gate held" is still answerable.
 *
 * VALUES, DELIBERATELY, and the reason they are safe to hold is a property of where they come from:
 * every one was produced by the planning turn, which is shown the caller's goal, the action's
 * argument names and no credential value at all (`parametrizeSections`), and every one passed
 * `verifyPlannedArgs` - a scalar, on an argument the action declares, that the caller did not
 * supply. The caller's OWN arguments are NOT recorded: they are the caller's to know, they can be
 * anything at all, and they are not the fact this row exists to preserve.
 *
 * `mayWrite` is the same fail-closed reading of `mutates` the compose rung's entry uses (`!== false`),
 * so an action whose definition omits the key counts as a write here too.
 *
 * NO ROW AT ALL WHEN NO ARGUMENT WAS MODEL-FILLED - not an empty one. This function is only reached
 * with a non-empty plan (the rung's other exits return before it), and the rung skipping is the
 * ordinary case: a row per call for it would bury the ones that matter under the ones that do not.
 */
async function recordParametrization(
  ctx: AchieveContext,
  integrationKey: string,
  action: IntegrationAction,
  filled: Record<string, PlannedArgValue>,
): Promise<void> {
  await logActivity(
    { userId: ctx.actor.userId, username: ctx.username ?? ctx.actor.userId, orgId: ctx.actor.orgId },
    'integrations',
    'capability_achieve_parametrize',
    ctx.deps,
    {
      integrationKey,
      actionName: action.actionName,
      mayWrite: action.mutates !== false,
      filledArgs: filled,
      ...(ctx.principal ? { keyId: ctx.principal.keyId } : {}),
      ...(ctx.principal?.xClient ? { xClient: ctx.principal.xClient } : {}),
    },
  );
}

const AUTHORING_TARGET_MESSAGES: Record<'published_row' | 'baseline_package' | 'not_writable', string> = {
  published_row: 'this integration is published to every organisation — a published definition is changed through the publish flow, not by authoring',
  baseline_package: 'this is a platform integration — copy it under a key of your own in the integration builder before extending it',
  not_writable: 'this integration belongs to somebody else in your organisation — ask them to extend it',
};

/**
 * Persist the verified action. TWO WRITES, ONE STORE GATE: both go through
 * `IntegrationDefinitionStore.create`, the same gated write path the builder save uses — never the
 * raw collection, so the actor/row congruence checks, the super-admin-only `global` tier and the
 * replace gate all still run underneath.
 *
 * THE FORK IS `onConflict: 'reject'`. `resolveAuthoringTarget` established there is no own-org row;
 * if one appeared in between, refusing is right — a fork must never overwrite a row it did not read.
 *
 * THE IN-PLACE WRITE IS `onConflict: 'replace'` and carries every field of the row forward, which
 * is exactly `definition-save.ts`'s re-save semantics. The known window is stated rather than
 * implied: a concurrent edit of the SAME row between the read above and this write is last-writer-
 * wins, as it already is for a builder re-save. It is not made narrower here because doing so would
 * mean a second write path into this collection, and two write paths is the problem this repo keeps
 * paying for.
 */
async function persistAuthoredAction(
  actor: Actor,
  integrationKey: string,
  target: Exclude<AuthoringTarget, { kind: 'refused' }>,
  action: IntegrationAction,
  /** The knowledge body as THIS reader is entitled to it — the same scrubbed cross-org view the
   *  prompt was given, so a fork copies exactly what its author could already read. */
  skillMd: string,
  store: IntegrationDefinitionStore,
): Promise<void> {
  if (target.kind === 'fork') {
    await store.create(
      {
        orgId: actor.orgId,
        userId: actor.userId,
        // PRIVATE BY DEFAULT (A1/A3). A fork is a copy for the acting tenant, not a publication;
        // sharing it is E1's explicit act.
        visibility: 'private',
        key: integrationKey,
        ...forkContentFrom(target.source),
        configSchema: target.source.configSchema ?? [],
        actions: [...(target.source.actions ?? []), action],
        skillMd,
        origin: {
          kind: 'forked',
          // The source ROW id only. `sourceOrgId` is deliberately NOT recorded: a cross-org
          // `global` row must not tell the reader which org authored it (definition-registry's
          // projection rule), and a fork is not a reason to write that fact down inside the
          // reader's own tenant.
          sourceDefinitionId: target.sourceId,
          forkedAt: action.authoring?.authoredAt ?? new Date().toISOString(),
        },
      },
      { actor, onConflict: 'reject' },
    );
    return;
  }

  const doc = target.doc;
  await store.create(
    {
      orgId: doc.orgId,
      userId: doc.userId,
      visibility: doc.visibility,
      key: doc.key,
      ...(doc.displayName !== undefined ? { displayName: doc.displayName } : {}),
      ...(doc.description !== undefined ? { description: doc.description } : {}),
      ...(doc.version !== undefined ? { version: doc.version } : {}),
      ...(doc.authType !== undefined ? { authType: doc.authType } : {}),
      ...(doc.provider !== undefined ? { provider: doc.provider } : {}),
      ...(doc.category !== undefined ? { category: doc.category } : {}),
      configSchema: doc.configSchema ?? [],
      actions: [...(doc.actions ?? []), action],
      ...(doc.credentialGuide !== undefined ? { credentialGuide: doc.credentialGuide } : {}),
      skillMd: doc.skillMd,
      ...(doc.lessons !== undefined ? { lessons: doc.lessons } : {}),
      ...(doc.sessionConnect !== undefined ? { sessionConnect: doc.sessionConnect } : {}),
      ...(doc.webhookConfig !== undefined ? { webhookConfig: doc.webhookConfig } : {}),
      ...(doc.listenerConfig !== undefined ? { listenerConfig: doc.listenerConfig } : {}),
      ...(doc.origin !== undefined ? { origin: doc.origin } : {}),
      ...(doc.publishedSnapshot !== undefined ? { publishedSnapshot: doc.publishedSnapshot } : {}),
      createdAt: doc.createdAt,
    },
    { actor, onConflict: 'replace' },
  );
}

/**
 * Attribution for the drafting turn. `user_work`, billed to the CALLING USER — the platform is not
 * paying to extend a tenant's integration, and Rule 4 means there is always a user to bill.
 *
 * `agentType` is `integration-builder`, which is the truth rather than a convenience: this is the
 * same authoring core, on the same content kind, producing the same artifact class as the builder
 * chat. A new tag would have meant editing `llm/attribution.ts`, i.e. the chokepoint, for a call
 * that is not a new kind of work.
 */
function authoringAttribution(actor: Actor): LlmAttribution {
  return { kind: 'user_work', agentType: 'integration-builder', billeeUserId: actor.userId };
}

/**
 * ONE activity row per AUTHOR. "The platform wrote code for this tenant" is exactly the event an
 * audit trail has to be able to answer afterwards, and unlike an execute it leaves a durable
 * artifact behind. Recorded: which integration, which action, whether it forked, and the key
 * principal when a gateway key drove it. NOT recorded: the goal text or the action's templates —
 * caller free text and executable content belong on the row, not duplicated into an audit log.
 *
 * Fire-and-forget in the sense that matters: an audit failure must not undo a stored action.
 */
async function auditAuthored(
  ctx: AchieveContext,
  integrationKey: string,
  action: IntegrationAction,
  forked: boolean,
): Promise<void> {
  try {
    await logActivity(
      { userId: ctx.actor.userId, username: ctx.username ?? ctx.actor.userId, orgId: ctx.actor.orgId },
      'integrations',
      'capability_achieve_author',
      ctx.deps,
      {
        integrationKey,
        actionName: action.actionName,
        state: 'provisional',
        forked,
        ...(ctx.principal ? { keyId: ctx.principal.keyId } : {}),
        ...(ctx.principal?.xClient ? { xClient: ctx.principal.xClient } : {}),
      },
    );
  } catch (err) {
    console.warn(`[integration-achieve] audit write failed for ${integrationKey}.${action.actionName}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// provisional -> trusted
// ---------------------------------------------------------------------------

export type TrustAuthoredActionResult =
  | { verdict: 'ok'; actionName: string; state: 'trusted'; mutates: boolean; alreadyTrusted: boolean }
  /** The integration, or the action on it, does not resolve for this actor. No existence oracle. */
  | { verdict: 'notfound' }
  /** Visible, not writable — including every `global` row (the publish flow owns those). */
  | { verdict: 'forbidden' }
  /** The echoed shape is not this action's current shape: it changed since it was shown. */
  | { verdict: 'shape_mismatch' }
  /** The action was written by a human; there is nothing to promote. */
  | { verdict: 'not_authored' }
  /** Re-authored since it was verified, or its frozen verification did not pass. */
  | { verdict: 'unverified' }
  /**
   * SLICE S1 (branch `feat/s1-s3-integration-surface`) - the action has never had a validated run,
   * or its last one exercised different bytes.
   *
   * Distinct from `unverified` deliberately: that one means "the DRAFT no longer checks out", this
   * one means "the draft checks out and has never actually run". Collapsing them would tell a user
   * to re-author an action whose only problem is that nobody has tried it yet.
   */
  | { verdict: 'unvalidated' };

/**
 * PROMOTE an authored action to trusted — the human half of this slice.
 *
 * Its descriptor is `auth: 'user'`, deliberately not `user-or-key`, for the reason C2 gave for the
 * three consent descriptors and C3 gave for lessons: a gate that grants its own exemption is not a
 * gate, and `achieve` itself is key-reachable.
 *
 * Four gates, all of which already exist elsewhere and none of which is re-derived here:
 *   1. `canEditDefinitionRaw` — the SAME admission set the builder save accepts (and it refuses
 *      every `global` row, so a published action is not promoted through this door either).
 *   2. The echoed SHAPE must be the action's current shape — `approveAction`'s anti-TOCTOU rule,
 *      for the same reason: the human answered about the action they were shown.
 *   3. The record's own fingerprint must still match — otherwise the action was re-authored since
 *      it was verified, and the verification describes bytes that are gone.
 *   4. The frozen verification must have PASSED.
 *
 * Not-found and not-visible are the same answer, as everywhere else in this domain.
 */
export async function trustAuthoredAction(
  actor: Actor,
  integrationKey: string,
  actionName: string,
  shape: string,
  store: IntegrationDefinitionStore = integrationDefinitionStore,
  now: () => number = Date.now,
): Promise<TrustAuthoredActionResult> {
  const doc = await store.getForActor(actor, integrationKey);
  // A row of another org (necessarily `global`) is not promotable here, and answering `notfound`
  // rather than `forbidden` keeps this door from reporting anything about another tenant's rows.
  if (!doc || doc.orgId !== actor.orgId) return { verdict: 'notfound' };
  if (!canEditDefinitionRaw(doc, actor)) return { verdict: 'forbidden' };

  const index = (doc.actions ?? []).findIndex((a) => a.actionName === actionName);
  const action = index >= 0 ? (doc.actions[index] as IntegrationAction) : null;
  if (!action) return { verdict: 'notfound' };
  if (!action.authoring) return { verdict: 'not_authored' };
  if (actionShape(integrationKey, action) !== shape) return { verdict: 'shape_mismatch' };

  // ── SLICE S1 CALL-SITE CHANGE (branch `feat/s1-s3-integration-surface`) ────────────────────────
  // This is the ONLY edit that slice makes to this file, and it is here because there is nowhere
  // else it can be: `promoteToTrusted` is the one producer of `state: 'trusted'` and this is its one
  // production caller, so a graduation prerequisite wired anywhere else would be a gate in a
  // consumer that any future caller bypasses.
  //
  // Promotion used to prove SHAPE and never BEHAVIOUR - an action could graduate to `trusted`, and
  // so become auto-runnable by `achieve`, having never run once. The LAST VALIDATED RUN is now the
  // prerequisite: `integration_action_evidence` holds one live row per (org, OWNER, integration,
  // action), written by the executor on a successful run and stamped with the action shape that run
  // exercised. `promoteToTrusted` refuses when it is missing or names different bytes.
  //
  // THE EVIDENCE READ IS THE PROMOTING ACTOR'S OWN, and the owner term is what makes that true. A
  // definition shared at `org` visibility is run by different people under DIFFERENT credentials
  // (`findConfigForOwner` resolves per owner) against different third-party accounts, so with an
  // org-only key user A could promote an action to `trusted` - and thereby make it auto-runnable by
  // `achieve` - on the strength of a run user B made against B's OWN account. The gate now asks
  // whether the person granting the trust has themselves seen this action work.
  const evidence = await actionEvidenceStore.getEvidence({
    orgId: actor.orgId,
    ownerUserId: actor.userId,
    integrationKey,
    actionName,
  });
  const promoted = promoteToTrusted(integrationKey, action, actor, evidence, now);
  if (!promoted.ok) {
    if (promoted.reason === 'not_authored') return { verdict: 'not_authored' };
    return { verdict: promoted.reason === 'unvalidated' ? 'unvalidated' : 'unverified' };
  }

  if (!promoted.alreadyTrusted) {
    const actions = [...doc.actions];
    actions[index] = promoted.action;
    await store.create(
      {
        ...doc,
        actions,
        // Re-stated rather than spread-and-hoped: `create` derives the `_id` from (orgId, key), and
        // the replace gate re-judges the write against the row as it stands.
        orgId: doc.orgId,
        userId: doc.userId,
        visibility: doc.visibility,
        key: doc.key,
        createdAt: doc.createdAt,
      },
      { actor, onConflict: 'replace' },
    );
  }
  return {
    verdict: 'ok',
    actionName,
    state: 'trusted',
    mutates: promoted.action.mutates,
    alreadyTrusted: promoted.alreadyTrusted,
  };
}

/** Re-exported so a caller that only imports this module can read an action's state without
 *  reaching for the guardrail module directly. */
export { authoringStateOf, isTrustedAction, definitionIdFor };
