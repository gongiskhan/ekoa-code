/**
 * integrations/action-feedback-store.ts - WHAT ONE PERSON LEARNED ABOUT ONE ACTION (slice S3).
 *
 * ── WHAT THIS IS, AND WHY IT IS NOT THE RUN ENGINE'S STEP FEEDBACK ────────────────────────────
 *
 * There is already a thing in this repo called step feedback, it is reachable at
 * `POST /api/v1/automations/runs/:id/steps/:stepId/feedback`, and this is deliberately not it. The
 * two answer different questions on different lifecycles, which is why both exist:
 *
 *   `automationRuns[].steps[].feedback`  - a VERDICT ON ONE RUN. `thumbs_up` / `thumbs_down` /
 *                                          `correction`, submitted against a run id, whose effects
 *                                          are immediate and elsewhere: it evicts the cached
 *                                          action/assertion entries for that step's fingerprint and
 *                                          may write a `user-correction` MEMORY tagged
 *                                          `automation:<id>`. It dies with the run document.
 *
 *   `integration_action_feedback`        - THIS. Durable GUIDANCE ABOUT THE ACTION, written by a
 *                                          person in their own words, addressed by the action (and
 *                                          optionally one step of its plan) rather than by a run,
 *                                          and read back into the prompts that plan against that
 *                                          action. It outlives every run it was learned from.
 *
 * Collapsing them would mean either attaching durable guidance to a run document that the run
 * retention takes away, or making a thumbs-down on one run rewrite what every future prompt is
 * told. Neither is the thing either caller wants.
 *
 * ── TENANCY (Capability Contract rule 5): ORG **AND USER**, ON BOTH SIDES OF EVERY CALL ───────
 *
 * A note is the AUTHOR'S OWN. Not the organisation's, not the action's: two members of one org open
 * the same action and see their own note and nobody else's, exactly as they see their own evidence
 * sample (`action-evidence-store.ts`, round eight). The reasons are not the same, though, and it is
 * worth being precise about which one applies here, because the wrong one produces the wrong fix:
 *
 *   - evidence is org+owner scoped because the ROW HOLDS THIRD-PARTY DATA - one tenant's real
 *     request and real response body, belonging to whoever's credential produced it;
 *   - feedback is org+user scoped because the row is CONSUMED BY A PROMPT. Free text written by one
 *     person that lands in another person's model turn is a peer-to-peer injection channel with no
 *     gate on it, and the platform would be the thing that carried it. The unit of consumption is
 *     therefore the CALLING user's own notes, never the org's pooled ones - see
 *     `action-feedback.ts`, which is the only module that turns these rows into prompt text.
 *
 * Both terms are in the deterministic `_id`, both are stored on the row, both are terms of every
 * query filter, and both are re-checked on every fetched document. There is no ambient tenant and
 * no ambient user in this module: every method states them in full, and there is no method that
 * addresses "every row of this org" or "every row of this action". Suite:
 * `api/tests/security/action-feedback-isolation.test.ts`.
 *
 * D2 (CONVERGENCE_PLAN) is the auth half of the same argument and it is enforced one layer up: the
 * three routes over this store are `auth: 'user'` and never `user-or-key`, because a key-bearing
 * agent that could WRITE here would be writing its own future prompts. Agents read; only a person
 * writes.
 *
 * ── WHY THIS IS A COLLECTION AND NOT A FIELD ON THE DEFINITION ────────────────────────────────
 *
 * The same two reasons `action-evidence-store.ts` gives, and the first is decisive on its own:
 *
 *   1. IT WOULD RIDE `publishedSnapshot` INTO OTHER ORGS. `definition-store.ts` copies the
 *      definition document when an integration is promoted. A note is a person's own prose about
 *      their own work - it names portals, colleagues, case numbers and habits - and on the
 *      definition it is inside the published bytes by construction, with only a scrubber's memory
 *      between it and every other tenant. In its own collection there is nothing to remember: no
 *      publish path reads this module. That structural exclusion IS the sanitisation (D5), and it
 *      is asserted from the publish side by `api/tests/security/publish-doors-isolation.test.ts`,
 *      whose planted battery carries this store's real field names.
 *   2. IT WOULD BE A WRITE TO A SHARED DOCUMENT ON A PER-PERSON ACTION. Every reader of every
 *      action already touches the definition row; making "I typed a note" a compare-and-swap of it
 *      is the Trap T2 argument `captured-calls-store.ts` makes at length.
 *
 * ── FORKING: A NOTE FOLLOWS THE KEY, AND THE KEY ONLY ─────────────────────────────────────────
 *
 * The row is addressed by `integrationKey` + `actionName`, and nothing copies rows when a
 * definition is copied. So, stated as behaviour rather than left to be discovered:
 *
 *   - a tenant row that SHADOWS a shipped/org package under the SAME key keeps the notes, because
 *     the key did not move. That is the useful direction: what a person learned about
 *     `consultar_processo` is still true after their org extends the package it lives in.
 *   - a fork under a DISTINCT KEY starts with no notes at all, and none are copied for it. A copy
 *     would be this module inventing authorship - the new key's notes would be attributed to a
 *     person who never wrote about it - and there is no signal here that says the two keys' actions
 *     still behave the same way.
 *   - PROMOTION (publish to `global`) carries none, by construction, for the reason above.
 *
 * ── THE REMOVAL RULE, AND WHY IT IS SHORTER THAN THE EVIDENCE ONE ─────────────────────────────
 *
 * TWO durable signals end a row and nothing else does: THE AUTHOR (`discardFeedback`, reachable at
 * `DELETE …/actions/:actionName/feedback`) and A NEWER NOTE (`putFeedback` supersedes at the same
 * deterministic `_id`). There is no retention sweep and no TTL, and that is a decision rather than
 * an omission - `action-evidence-store.ts` needs one because an evidence row holds third-party
 * response bodies and PINS a run's screenshots out of a 7-day sweep, so an orphan there is an
 * unbounded privacy gap. A note holds neither: it is the author's own prose, capped at
 * `ACTION_FEEDBACK_MAX_CHARS`, pinning nothing. An orphaned note is a person's own sentence about
 * an action that stopped resolving, and deleting it on their behalf would be this module guessing
 * about durable data at one instant - the exact error that cost the evidence collection four rounds.
 *
 * NOTHING SYNCHRONOUS DECIDES A ROW IS OVER HERE EITHER: a definition edit, a re-author, a
 * visibility flip, a disconnected credential and a failed resolve all record nothing and delete
 * nothing. The residual - a note whose action nobody can reach - is recorded as OPEN in
 * docs/findings.md rather than closed by a collector.
 */
import { createHash } from 'node:crypto';
import {
  ACTION_FEEDBACK_MAX_CHARS,
  ACTION_FEEDBACK_MAX_NOTES_PER_ACTION,
  ACTION_FEEDBACK_STEP_REF_MAX_CHARS,
} from '@ekoa/shared';
import { Store, type Doc } from '../data/store.js';
import { integrationActionFeedback } from '../data/stores.js';

/**
 * The ceiling on ONE note. A REFUSAL, never a truncation, for the reason
 * `INTEGRATION_LESSONS_MAX_CHARS` is one: silently dropping the tail of what somebody typed is the
 * worst of the three options, because the author believes it was recorded.
 *
 * The number is a prompt-cost trade rather than a storage one. This text rides into the planner,
 * the rehearsal fixer and `load_context`, so its size is a PER-CALL cost paid on every turn that
 * loads it - and a person may hold one note per action per step. 2,000 characters is roughly a long
 * paragraph: enough for "this portal rejects the request unless the processo number is zero-padded",
 * far short of a pasted document.
 *
 * The constant lives in `shared/` (`ACTION_FEEDBACK_MAX_CHARS`) so the zod `.max()` at the wire, the
 * refusal here and the dashboard's character counter are ONE number. Two would eventually disagree,
 * and the surface where they disagreed would be the one that truncates.
 */
export { ACTION_FEEDBACK_MAX_CHARS, ACTION_FEEDBACK_MAX_NOTES_PER_ACTION, ACTION_FEEDBACK_STEP_REF_MAX_CHARS };

/**
 * Names ONE person's note about one action, or about one step of that action's plan.
 *
 * `stepRef` IS THE STEP'S OWN ID, NOT ITS INDEX, and that is the one design decision in this type.
 * `AutomationSteps` in the dashboard renders the bound automation's plan as it stands TODAY, while a
 * note is durable - and an index into a list somebody may reorder addresses a different step
 * tomorrow. That is precisely the misalignment `stepSampleFit` exists to detect for evidence
 * samples, and detecting it is strictly worse than not being able to express it: a note filed under
 * "step 3" that silently becomes a note about the step that moved into position 3 is a lie in the
 * author's own words, rendered with no signal at all. `PlanStep.stepId` moves with the step, so a
 * reordered plan keeps every note attached to what it was about, and a DELETED step leaves an
 * orphan the author can see and remove.
 *
 * ABSENT `stepRef` means the note is about the ACTION AS A WHOLE. That is a different row from any
 * step's - `null` is a term of the id - and it is the only shape available for an `api-call` action,
 * which has no plan to point into.
 */
export interface ActionFeedbackKey {
  orgId: string;
  userId: string;
  integrationKey: string;
  actionName: string;
  /** The `PlanStep.stepId` this note is about; absent means the whole action. */
  stepRef?: string;
}

export interface ActionFeedbackDoc extends Doc, ActionFeedbackKey {
  /** The author's own text, byte-exact. The prompt view scrubs; this is what they typed. */
  note: string;
  /** First write of THIS row. Preserved across supersedes - see `putFeedback`. */
  createdAt: string;
  /** The write that produced the current `note`. Orders the prompt read, newest first. */
  updatedAt: string;
}

export type ActionFeedbackErrorCode = 'INVALID' | 'TOO_LONG' | 'TOO_MANY';

export class ActionFeedbackStoreError extends Error {
  constructor(public readonly code: ActionFeedbackErrorCode, message: string) {
    super(message);
    this.name = 'ActionFeedbackStoreError';
  }
}

/**
 * The deterministic `_id`, JSON-encoded so the encoding is injective for any strings - the argument
 * `actionEvidenceIdFor`, `capturedCallIdFor` and `definitionIdFor` all make, and it matters more
 * here than in any of them because a note key carries TWO caller-supplied free-form segments
 * (`actionName`, `stepRef`) rather than one. A `::` join is not injective when a term may contain
 * the separator, and a collision between two different people's tuples is a note appearing under
 * somebody else's action.
 *
 * `stepRef` enters as `null` when it is absent rather than being omitted, so "the whole action" is
 * a distinct point in the space and can never coincide with a step whose id is the empty string
 * (which `assertKey` refuses anyway).
 *
 * There is no timestamp and no sequence in it: the id IS the tuple, so a second write of the same
 * note REPLACES the first rather than accumulating beside it. One live note per (person, action,
 * step) by construction - nothing has to remember to delete the old one.
 */
export function actionFeedbackIdFor(key: ActionFeedbackKey): string {
  return createHash('sha256')
    .update(JSON.stringify([key.orgId, key.userId, key.integrationKey, key.actionName, key.stepRef ?? null]))
    .digest('hex');
}

/**
 * How many of one person's notes a single prompt read may return.
 *
 * A BOUND ON THE READ, not just on the answer, for the reason `pinnedRunIdsForRetention` learned:
 * this collection grows as users x integrations x actions x steps, and the owner-scoped prompt read
 * (`listForOwner`) is on the hot path of every automation plan. The limit is applied in the QUERY,
 * so a person with two thousand notes costs the same as a person with twenty.
 *
 * Newest-first is the ordering that makes a cap honest: what a person wrote most recently is what
 * they most recently learned, so the notes that fall off the end are the stale ones.
 */
export const FEEDBACK_PROMPT_MAX_NOTES = 20;

export class ActionFeedbackStore {
  private readonly store: Store<ActionFeedbackDoc>;

  constructor(
    store: Store<Doc> = integrationActionFeedback,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = store as unknown as Store<ActionFeedbackDoc>;
  }

  /**
   * Write (or rewrite) the caller's own note, idempotently.
   *
   * INSERT-AS-CLAIM THEN CAS, which is the repo's standing pattern for a deterministic `_id`
   * (`definition-store.create`, `captured-calls-store`), and NOT a bare `put`. The difference is
   * `createdAt`: `put` would rewrite the whole document, so every edit of a note would restamp it as
   * newly created and the row would lose the one fact it holds about its own history. The insert
   * claims the id and stamps both timestamps; a losing insert means somebody (or an earlier write of
   * this same person's) already holds the row, and the CAS mutator then replaces `note` and
   * `updatedAt` while leaving `createdAt` exactly where it was.
   *
   * NO UNIQUE INDEX BACKS THIS, and none is wanted (§4.3.2): the deterministic `_id` IS the
   * uniqueness, and the duplicate-key error `Store.insert` swallows is the claim failing.
   *
   * THE CAS RE-STATES THE TENANCY TERMS on the row it writes rather than trusting the id it looked
   * up. `Store.update` re-reads the current document and hands it to the mutator, so a row whose
   * stored `orgId`/`userId` disagreed with the id it lives under would otherwise be rewritten under
   * its own wrong owner and then answered to the caller as theirs.
   */
  async putFeedback(key: ActionFeedbackKey, note: string): Promise<ActionFeedbackDoc> {
    assertKey(key);
    assertNote(note);
    const at = this.now().toISOString();
    const doc: ActionFeedbackDoc = {
      _id: actionFeedbackIdFor(key),
      orgId: key.orgId,
      userId: key.userId,
      integrationKey: key.integrationKey,
      actionName: key.actionName,
      ...(key.stepRef !== undefined ? { stepRef: key.stepRef } : {}),
      note,
      createdAt: at,
      updatedAt: at,
    };
    const swap = (cur: ActionFeedbackDoc): ActionFeedbackDoc => ({
      ...cur,
      // The tenancy terms are re-asserted from the VERIFIED key, never carried from the stored row:
      // see the docblock. Everything else the row holds is this write's.
      orgId: key.orgId,
      userId: key.userId,
      integrationKey: key.integrationKey,
      actionName: key.actionName,
      ...(key.stepRef !== undefined ? { stepRef: key.stepRef } : {}),
      note,
      // `createdAt` survives an edit, which is the whole reason this is not a `put`. A row written
      // before this field existed has none, so the current write's stamp is the honest fallback.
      createdAt: typeof cur.createdAt === 'string' && cur.createdAt !== '' ? cur.createdAt : at,
      updatedAt: at,
    });

    // THE PER-ACTION CEILING, checked only when this write would CREATE a row.
    //
    // An edit must never be refused for being one row too many - the row already exists, so the
    // count does not move - which is why this asks whether the id is taken before it counts. Without
    // the cap, `stepRef` being deliberately unvalidated against a live plan means one authenticated
    // person can mint unbounded rows for a single action, every one of which is read on the detail
    // page and on two prompt hot paths and collected by nothing (there is no retention sweep here,
    // by design). The read is itself bounded: it projects `_id` alone and stops one past the limit.
    if (!(await this.store.get(doc._id))) {
      const held = await this.store.find(
        { orgId: key.orgId, userId: key.userId, integrationKey: key.integrationKey, actionName: key.actionName },
        undefined,
        { projection: { _id: 1 }, limit: ACTION_FEEDBACK_MAX_NOTES_PER_ACTION + 1 },
      );
      if (held.length >= ACTION_FEEDBACK_MAX_NOTES_PER_ACTION) {
        throw new ActionFeedbackStoreError(
          'TOO_MANY',
          `an action may hold at most ${ACTION_FEEDBACK_MAX_NOTES_PER_ACTION} notes for one person`,
        );
      }
    }

    // CLAIM, THEN SWAP, TWICE, THEN SETTLE. Each round loses only to a genuine race: the insert
    // loses when the row already exists, and the swap then loses only if that row was DELETED
    // between the two calls - the author discarding the note from another tab is the ordinary way
    // for that to happen. A second round covers the re-created case.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (await this.store.insert(doc)) return doc;
      const updated = await this.store.update(doc._id, swap);
      if (updated) return updated;
    }
    // TWO ROUNDS BOTH LOST, so the row is being created and deleted concurrently under one person's
    // own identity. `put` ends it, and it is CORRECT here rather than a shortcut: the only thing a
    // `put` would destroy is an earlier `createdAt`, and every path to this line has just observed
    // the row absent. Settling beats answering `doc` without having written it - which is what the
    // previous shape did, reporting a note stored when the last insert may have failed too.
    return this.store.put(doc);
  }

  /**
   * ONE note, or null.
   *
   * THE RE-CHECK IS NOT REDUNDANT HERE, and the contrast with `listForIntegration` below is the
   * same one `action-evidence-store.ts` draws: this lookup is by deterministic `_id` and never
   * consults the stored fields at all, so a hand-written or restored row whose stored org/user
   * disagrees with the id it lives under WOULD be returned without it. Both terms are checked
   * because both are in the id: a row carrying no `userId` at all must not be handed to whichever
   * member of the org asks for it first.
   */
  async getFeedback(key: ActionFeedbackKey): Promise<ActionFeedbackDoc | null> {
    if (!isTenantScoped(key)) return null;
    const doc = await this.store.get(actionFeedbackIdFor(key));
    if (!doc) return null;
    return doc.orgId === key.orgId && doc.userId === key.userId ? doc : null;
  }

  /**
   * Every note ONE PERSON holds for ONE integration - the detail page's read.
   *
   * THE POST-FILTER IS REDUNDANT BY CONSTRUCTION and is recorded as such rather than left looking
   * load-bearing, exactly as `ActionEvidenceStore.listForIntegration`'s is: an exact-match query on
   * `orgId`/`userId` cannot return a document whose stored values differ, so the two terms enforce
   * the same predicate on the same fields and each MASKS the other under mutation. It is kept
   * because a later change to the query shape - a projection, an `$in`, a re-sort - would otherwise
   * silently remove the only tenancy term there is.
   *
   * Sorted by action then step so the page renders a stable order rather than Mongo's.
   */
  async listForIntegration(orgId: string, userId: string, integrationKey: string): Promise<ActionFeedbackDoc[]> {
    if (orgId === '' || userId === '' || integrationKey === '') return [];
    const rows = await this.store.find({ orgId, userId, integrationKey }, { actionName: 1, stepRef: 1 });
    return rows.filter((row) => row.orgId === orgId && row.userId === userId);
  }

  /**
   * The NEWEST notes one person holds for ONE integration - the read the `load_context` join and
   * `achieve`'s drafting turn take.
   *
   * A SEPARATE METHOD FROM `listForIntegration`, and the split is the review's correction. That one
   * answers the AUTHOR'S PAGE, where completeness is the contract and the order that helps is by
   * action; this one answers a PROMPT, where the contract is the opposite - bounded, newest first.
   * Sharing one unbounded read between them made the two hottest paths in the slice fetch and
   * materialise every row a person holds for the integration on every call, then throw most of them
   * away against a character budget: a bounded ANSWER over an unbounded READ, which is exactly the
   * distinction `Store.find`'s own `limit` docblock draws and which had been applied to
   * `listForOwner` alone.
   *
   * Sorted AND limited in the query, so the in-process re-sort the prompt view used to do is gone
   * with it.
   */
  async listNewestForIntegration(
    orgId: string,
    userId: string,
    integrationKey: string,
    limit = FEEDBACK_PROMPT_MAX_NOTES,
  ): Promise<ActionFeedbackDoc[]> {
    if (orgId === '' || userId === '' || integrationKey === '') return [];
    if (!Number.isFinite(limit) || limit <= 0) return [];
    const rows = await this.store.find({ orgId, userId, integrationKey }, { updatedAt: -1 }, { limit });
    return rows.filter((row) => row.orgId === orgId && row.userId === userId);
  }

  /**
   * The NEWEST notes one person holds, across every integration - the read the automation planner
   * and the rehearsal fixer take, where no integration key is in hand.
   *
   * CROSS-INTEGRATION AND NEVER CROSS-USER. Both tenancy terms are exact-match query terms and both
   * are re-checked; what widens is the KEY, not the identity. A planner turn is planning for one
   * person against whatever they may reach, so "their notes" is the honest unit; "their org's
   * notes" would be the peer-to-peer injection channel the module header refuses.
   *
   * BOUNDED IN THE QUERY (`FEEDBACK_PROMPT_MAX_NOTES`, newest first) rather than after it: this runs
   * on the hot path of every plan, and materialising a heavy user's whole collection to keep twenty
   * rows is the unbounded-read defect `Store.find`'s projection note describes.
   */
  async listForOwner(orgId: string, userId: string, limit = FEEDBACK_PROMPT_MAX_NOTES): Promise<ActionFeedbackDoc[]> {
    if (orgId === '' || userId === '') return [];
    if (!Number.isFinite(limit) || limit <= 0) return [];
    const rows = await this.store.find({ orgId, userId }, { updatedAt: -1 }, { limit });
    return rows.filter((row) => row.orgId === orgId && row.userId === userId);
  }

  /**
   * THE AUTHOR'S ERASURE CONTROL - drop ONE of their own notes, because they asked.
   *
   * Its production caller is `DELETE /api/v1/integrations/:key/actions/:actionName/feedback`, which
   * builds the key from the VERIFIED actor, so a request cannot name a colleague's note. Its own
   * `isTenantScoped` check masks with `getFeedback`'s under mutation and is kept for the same
   * belt-and-braces reason: a later change to how this finds its row (a direct `_id` delete, say)
   * would otherwise remove the only guard there is.
   */
  async discardFeedback(key: ActionFeedbackKey): Promise<boolean> {
    if (!isTenantScoped(key)) return false;
    const doc = await this.getFeedback(key);
    if (!doc) return false;
    return this.store.delete(doc._id);
  }
}

function isTenantScoped(key: ActionFeedbackKey): boolean {
  return key.orgId !== ''
    && key.userId !== ''
    && key.integrationKey !== ''
    && key.actionName !== ''
    // An EMPTY `stepRef` is refused rather than treated as absent: `''` and `undefined` hash to
    // different ids, so accepting both would give one note two addresses and let a client write a
    // second, unreachable row for the same step.
    && key.stepRef !== ''
    // AND A CEILING ON IT (review round). The zod schema caps it at the wire, but this store has
    // callers that are not the route, and its own `assertNote` docblock two below states the rule:
    // a ceiling enforced only at the edge is a ceiling the next caller does not have. Unbounded
    // here would put unbounded text into the `_id` hash input and into every prompt line built
    // from the row.
    && (key.stepRef === undefined || key.stepRef.length <= ACTION_FEEDBACK_STEP_REF_MAX_CHARS);
}

function assertKey(key: ActionFeedbackKey): void {
  if (!isTenantScoped(key)) {
    throw new ActionFeedbackStoreError('INVALID', 'feedback must name an org, a user, an integration and an action');
  }
}

/**
 * The ceiling, and the empty refusal.
 *
 * Both are re-checked here even though the shared zod schema refuses the same two shapes at the
 * wire, because this store has callers that are not the route (`putFeedback` is a production API of
 * this module) and a ceiling enforced only at the edge is a ceiling the next caller does not have.
 * An empty note is refused rather than silently deleting the row: "clear this" is `discardFeedback`,
 * and a write that means delete is the kind of overloading that produces an accidental erasure.
 */
function assertNote(note: string): void {
  if (note.trim() === '') {
    throw new ActionFeedbackStoreError('INVALID', 'a note must carry text; use discardFeedback to remove one');
  }
  if (note.length > ACTION_FEEDBACK_MAX_CHARS) {
    throw new ActionFeedbackStoreError('TOO_LONG', `a note may not exceed ${ACTION_FEEDBACK_MAX_CHARS} characters`);
  }
}

/** The process-wide store over the real `integration_action_feedback` collection. */
export const actionFeedbackStore = new ActionFeedbackStore();
