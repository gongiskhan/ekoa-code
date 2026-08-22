/**
 * integrations/action-feedback.ts - THE TWO VIEWS of a person's notes (slice S3).
 *
 * ── THE ONE RULE THIS MODULE EXISTS TO HONOUR: RAW TO THE AUTHOR, SCRUBBED TO THE PROMPT ──────
 *
 * A note is free text a human writes and it reaches a model prompt, which makes it exactly the
 * surface the A2 review's F7 finding was about. `definition-lessons.ts` closed that for the
 * per-integration body by SPLITTING the two views rather than choosing one, and the split applies
 * here unchanged:
 *
 *   - the PROMPT view is `scrubSecretText`'d - the deterministic egress floor;
 *   - the AUTHOR view is BYTE-EXACT - because the scrub is lossy, and an editor seeded from a
 *     scrubbed body writes the redaction back on the next ordinary save, permanently destroying
 *     what the person actually wrote (A3 review F3).
 *
 * The scrub is UNCONDITIONAL on the prompt side, deliberately not "scrub only somebody else's
 * text": the author's own pasted credential is precisely the one that would otherwise ride into
 * their own prompts, which is where it would actually be spent.
 *
 * ── AND THERE IS EXACTLY ONE PLACE A ROW BECOMES PROMPT TEXT ──────────────────────────────────
 *
 * `feedbackPromptSection` below. All three consuming seams - `load_context` (through
 * `composeIntegrationContext`), the automation planner and rehearsal fixer (through the
 * `integrationFeedback` seam), and `achieve`'s drafting turn - call it or call something that calls
 * it, and none of them touches `ActionFeedbackStore` directly. That is a Rule 1 choice with a
 * safety consequence: THREE copies of `scrubSecretText(row.note)` would be three chances for the
 * fourth seam to forget, and a floor you can forget is not a floor. The suites therefore assert the
 * property AT EACH SEAM (a planted secret does not reach that seam's prompt) rather than asserting
 * that each seam contains a call, so removing the one scrub reddens all three.
 *
 * ── THE UNIT OF CONSUMPTION IS THE CALLING USER, NEVER THE ORGANISATION ───────────────────────
 *
 * Every read below takes the whole `Actor` and passes `actor.orgId` AND `actor.userId` to the
 * store; none of them takes a user id as data. That is the defect class this module is written
 * against: an org-wide read here would make one member's free text an instruction in another
 * member's model turn, with the platform as the carrier and no gate anywhere on the path. The store
 * enforces it too (both terms are in the deterministic `_id`), but the store cannot tell whether
 * the caller handed it the verified actor's own id or something else - which is exactly what
 * `api/tests/security/action-feedback-isolation.test.ts` attacks.
 *
 * ── THE DEFINITION PREDICATE: LOAD-BEARING ON THE WRITE, DELIBERATELY ABSENT ON THE PROMPT READ ─
 *
 * The dashboard reads and the write resolve the integration under the caller's own actor
 * (`resolveCapabilityDefinition`, the same resolution the capability read and `achieve` use), and
 * the WRITE additionally refuses an action that is not on that definition. Without it the write is
 * an unbounded store of arbitrary text under arbitrary names, reachable by any authenticated user -
 * a free per-user blob store wearing an integration's path.
 *
 * The owner-scoped PROMPT read (`feedbackSectionsForOwner`) does NOT re-resolve every row's
 * definition, and that is a decision rather than an oversight. It runs on the hot path of every
 * automation plan, one resolution per row would be one database round trip per note, and what the
 * filter buys elsewhere does not apply: the row is the CALLER'S OWN text going back into the
 * CALLER'S OWN prompt, so a note that outlived its action's visibility is stale guidance rather than
 * a disclosure. Recorded as a bounded staleness in docs/findings.md
 * (`a-note-outlives-the-action-it-was-written-about`), not claimed as closed.
 */
import type { Actor, IntegrationActionFeedback } from '@ekoa/shared';
import { ACTION_FEEDBACK_MAX_CHARS, ACTION_FEEDBACK_MAX_NOTES_PER_ACTION } from '@ekoa/shared';
import { scrubSecretText } from './definitions.js';
import { resolveCapabilityDefinition, type CapabilityOutcome } from './integration-capability.js';
import {
  actionFeedbackStore,
  ActionFeedbackStore,
  ActionFeedbackStoreError,
  FEEDBACK_PROMPT_MAX_NOTES,
  type ActionFeedbackDoc,
} from './action-feedback-store.js';

export { ACTION_FEEDBACK_MAX_CHARS, ACTION_FEEDBACK_MAX_NOTES_PER_ACTION, FEEDBACK_PROMPT_MAX_NOTES };

/**
 * The heading a person's notes are joined under for a prompt. English, matching the SKILL.md and
 * lessons bodies it is concatenated with (the dashboard renders its own PT-PT label - this string
 * is prompt content, not UI copy).
 *
 * IT NAMES THE AUTHOR AS THE READER ("you"), and that is not decoration. The text under it is
 * user-authored free text arriving in a system prompt, so the heading is the one place that can say
 * what it IS: guidance the person who is asking wrote for themselves. A heading reading "Notes"
 * invites a model to treat the block as instructions from the platform.
 */
export const FEEDBACK_PROMPT_HEADING = '## Notes you recorded about these actions (your own, not the platform\'s)';

/**
 * The total prompt budget for one person's notes, across however many rows survive
 * `FEEDBACK_PROMPT_MAX_NOTES`.
 *
 * TWO BOUNDS AND NOT ONE, because they bound different things and either alone is insufficient:
 * the row cap bounds the number of database documents read, and this bounds the CHARACTERS that
 * reach a turn. Twenty notes at `ACTION_FEEDBACK_MAX_CHARS` each is 40,000 characters - roughly ten
 * thousand tokens paid on every automation plan - so the row cap alone is not a prompt budget.
 *
 * WHOLE NOTES ONLY. A note is cut at its own boundary or not carried at all, never truncated
 * mid-sentence: half a sentence of somebody's operational guidance is worse than its absence,
 * because the model acts on it as if it were complete. The section says how many were left out.
 */
export const FEEDBACK_PROMPT_MAX_CHARS = 4_000;

/** The store slice this module needs. Injectable so the unit lane drives the rules without Mongo. */
export type ActionFeedbackReader = Pick<
  ActionFeedbackStore,
  'listForIntegration' | 'listNewestForIntegration' | 'listForOwner'
>;
export type ActionFeedbackWriter = Pick<ActionFeedbackStore, 'putFeedback' | 'discardFeedback'>;

/** What the author's own surface may do that fails for a reason worth telling them apart. */
export type FeedbackWriteOutcome =
  | { ok: true; value: IntegrationActionFeedback }
  /** No such integration for this caller, or no such action on the definition they resolve. */
  | { ok: false; refusal: 'no_tenant' | 'not_found' }
  /**
   * The caller already holds `ACTION_FEEDBACK_MAX_NOTES_PER_ACTION` notes for this action.
   *
   * A DISTINCT ARM rather than a thrown store error, so the route answers a 400 naming the ceiling
   * instead of a 500 naming nothing: the caller can act on "you hold too many notes here" and
   * cannot act on an opaque failure.
   */
  | { ok: false; refusal: 'too_many'; limit: number };

// ---------------------------------------------------------------------------------------------
// THE AUTHOR'S VIEWS - byte-exact, and only ever their own rows
// ---------------------------------------------------------------------------------------------

/**
 * Every note this caller holds for one integration, BYTE-EXACT.
 *
 * Byte-exact and not scrubbed because every row here is the caller's OWN and the surface it feeds
 * is an editor: there is no other reader to protect, and handing back a scrubbed body would make
 * the next ordinary save write the redaction into the person's own sentence. See the module header.
 *
 * Refuses exactly as the capability read refuses, through the very same resolution, so an
 * integration the caller cannot see answers `not_found` rather than an empty list - the endpoint is
 * not an existence oracle the capability read is not.
 *
 * NO DEFINITION FILTER OVER THE ROWS, and the contrast with `listActionEvidenceFor` is deliberate
 * rather than an inconsistency. That module drops rows whose action left the package because the
 * row holds a THIRD PARTY's request and response and would render beside an action the caller
 * cannot see. A note holds the caller's own sentence; hiding it would silently strand the only copy
 * of something they wrote, with no way to reach the delete control for it.
 *
 * THE SURFACE RENDERS SUCH A NOTE WITH ITS ERASURE CONTROL ATTACHED - and this sentence was a
 * PROMISE rather than a description until the review round. `web/components/integrations/
 * action-detail.tsx` looked rows up by slot only, so a note whose step or action had gone rendered
 * nowhere and could not be deleted while this read kept feeding it to prompts. `orphanedSteps` and
 * `DepartedActionNotes` now do it, pinned by
 * `web/__tests__/components/integration-detail-page.test.tsx` and by the third e2e leg.
 */
export async function listFeedbackFor(
  actor: Actor,
  integrationKey: string,
  store: ActionFeedbackReader = actionFeedbackStore,
): Promise<CapabilityOutcome<IntegrationActionFeedback[]>> {
  const resolved = await resolveCapabilityDefinition(actor, integrationKey);
  if (!resolved.ok) return resolved;
  const rows = await store.listForIntegration(actor.orgId, actor.userId, integrationKey);
  return { ok: true, value: rows.map(feedbackView) };
}

/**
 * Write the caller's own note about one action, or one step of its plan.
 *
 * THE ACTION MUST BE ON THE DEFINITION THIS CALLER RESOLVES. That check is the write's only
 * bound, and without it this route is a general-purpose per-user text store addressable at any
 * `(key, actionName)` string a client cares to invent - every one of which then rides into that
 * person's own prompts. The refusal is the house `not_found` for both "no such integration" and
 * "no such action", byte-identical, so the endpoint cannot be walked to learn which action names a
 * package carries.
 *
 * THE STEP REF IS NOT VALIDATED AGAINST A PLAN, and that is stated rather than left to be found.
 * The plan lives on the bound AUTOMATION, which `integrations/` does not resolve (the tier rule),
 * and a note is durable while a plan is edited - so a `stepRef` that names no current step is a
 * legitimate state a moment after any plan edit, not a bad request. Refusing unknown refs would
 * therefore refuse valid writes and still not stop an invented one, since a client can read a real
 * `stepId` off the automation it can already fetch. What bounds this instead is the SHAPE: the ref
 * is capped and non-empty at the schema, and the only thing an invented one buys is one more of the
 * caller's own notes inside their own capped prompt budget.
 */
export async function writeFeedbackFor(
  actor: Actor,
  integrationKey: string,
  actionName: string,
  input: { note: string; stepRef?: string },
  store: ActionFeedbackWriter = actionFeedbackStore,
): Promise<FeedbackWriteOutcome> {
  const resolved = await resolveCapabilityDefinition(actor, integrationKey);
  if (!resolved.ok) return resolved;
  const known = (resolved.value.definition.actions ?? []).some((a) => a.actionName === actionName);
  if (!known) return { ok: false, refusal: 'not_found' };
  try {
    const doc = await store.putFeedback(
      {
        orgId: actor.orgId,
        userId: actor.userId,
        integrationKey,
        actionName,
        ...(input.stepRef !== undefined ? { stepRef: input.stepRef } : {}),
      },
      input.note,
    );
    return { ok: true, value: feedbackView(doc) };
  } catch (err) {
    // ONLY the ceiling is translated. Everything else keeps throwing, because a store failure this
    // layer does not understand must not be reported to a caller as a tidy refusal it can retry.
    if (err instanceof ActionFeedbackStoreError && err.code === 'TOO_MANY') {
      return { ok: false, refusal: 'too_many', limit: ACTION_FEEDBACK_MAX_NOTES_PER_ACTION };
    }
    throw err;
  }
}

/**
 * Erase one of the caller's own notes.
 *
 * THE RESOLUTION GATE IS STILL HERE even though the row is addressed by the verified actor and
 * therefore cannot be a colleague's. It is what keeps the DELETE from answering differently for an
 * integration the caller cannot see - `not_found` for a hidden key rather than `discarded: false`,
 * which would tell an outsider that the key exists and simply holds no note of theirs.
 *
 * NO ACTION-EXISTENCE CHECK, unlike the write, and the asymmetry is the point: a note whose action
 * has since left the package is exactly the one its author most needs to be able to remove, and
 * refusing the delete would strand it until nothing but a database operator could reach it.
 */
export async function discardFeedbackFor(
  actor: Actor,
  integrationKey: string,
  actionName: string,
  stepRef: string | undefined,
  store: ActionFeedbackWriter = actionFeedbackStore,
): Promise<CapabilityOutcome<boolean>> {
  const resolved = await resolveCapabilityDefinition(actor, integrationKey);
  if (!resolved.ok) return resolved;
  const discarded = await store.discardFeedback({
    orgId: actor.orgId,
    userId: actor.userId,
    integrationKey,
    actionName,
    ...(stepRef !== undefined ? { stepRef } : {}),
  });
  return { ok: true, value: discarded };
}

// ---------------------------------------------------------------------------------------------
// THE PROMPT VIEWS - scrubbed, capped, and never anybody else's
// ---------------------------------------------------------------------------------------------

/**
 * The ONE place a stored row becomes prompt text: scrubbed, capped, ordered, and labelled.
 *
 * Exported so the composition can be pinned directly, without a store, in both directions - which
 * is what makes "the floor is unconditional" a testable claim rather than a sentence in a header.
 *
 * Returns `null` when there is nothing to say, so a caller with no notes composes exactly the
 * prompt it composed before this slice existed. An empty section with a heading is not nothing: it
 * spends tokens and tells a model that a channel exists.
 */
export function feedbackPromptSection(rows: readonly ActionFeedbackDoc[]): string | null {
  const lines: string[] = [];
  let budget = FEEDBACK_PROMPT_MAX_CHARS;
  let omitted = 0;
  for (const row of rows) {
    if (row.note.trim() === '') continue;
    const where = row.stepRef !== undefined ? `${row.actionName} / step ${row.stepRef}` : row.actionName;
    // THE FLOOR, APPLIED TO THE WHOLE COMPOSED LINE, and that is the review's correction. It used
    // to scrub `row.note` alone, which made the header's claim ("the floor, applied once, to every
    // row") narrower than it read: `stepRef` is caller-supplied free text that is deliberately
    // never validated against a plan, so an ANCHORED credential written as a step ref -
    // `api_key: sk_live_...` fits inside the ref's own ceiling - rode into all three model seams
    // unredacted, while the identical bytes in the note body were redacted.
    //
    // Scrubbing the line covers every field on it (the key, the action name, the ref and the note)
    // in one pass, and costs nothing in over-redaction: `SECRET_LINE_RE` anchors on a
    // credential-named key and then scans TOKENS, so only a token that `looksLikePastedSecret`
    // is touched and ordinary prose survives exactly as before.
    const line = scrubSecretText(`- ${row.integrationKey}.${where}: ${row.note.trim()}`);
    // WHOLE NOTES ONLY, and the loop does NOT break here: a long note early in the list must not
    // hide every short one after it, so an over-budget row is skipped and counted while the rest
    // keep being offered.
    if (line.length > budget) {
      omitted += 1;
      continue;
    }
    budget -= line.length;
    lines.push(line);
  }
  if (lines.length === 0) return null;
  // The omission is DECLARED rather than silent, for the reason the truncation flags on an evidence
  // row are: a model told it has the whole picture reasons as if it does.
  const tail = omitted > 0 ? [`- (${omitted} further note(s) omitted for length)`] : [];
  return [FEEDBACK_PROMPT_HEADING, '', ...lines, ...tail].join('\n');
}

/**
 * The caller's own notes about ONE integration, as a prompt section - the `load_context` and
 * `achieve` read.
 *
 * Ordered newest-first so the cap in `feedbackPromptSection` drops the stalest guidance rather than
 * an arbitrary slice. The list read itself is bounded by the integration, which is a natural bound;
 * the character budget is what makes it a prompt-safe one.
 */
export async function feedbackForPrompt(
  actor: Actor,
  integrationKey: string,
  store: ActionFeedbackReader = actionFeedbackStore,
): Promise<string | null> {
  if (actor.orgId === '' || actor.userId === '') return null;
  // BOUNDED IN THE QUERY, newest first - not the page's unbounded, action-sorted read. This runs on
  // every `load_context` integration resolution and every `achieve` draft, so fetching every row a
  // person holds for the integration and then discarding most of them against the character budget
  // was a bounded answer over an unbounded read (the review's finding). The query does the sorting
  // now, so the in-process re-sort that used to be here is gone.
  const rows = await store.listNewestForIntegration(actor.orgId, actor.userId, integrationKey);
  return feedbackPromptSection(rows);
}

/**
 * The caller's own notes across EVERY integration, as prompt sections - the automation planner's
 * and the rehearsal fixer's read, where no integration key is in hand.
 *
 * WHY THE KEY WIDENS AND THE IDENTITY DOES NOT. A planner turn plans for one person against
 * whatever they may reach, and it has a goal rather than an integration; a fixer turn is repairing
 * one person's run. So "every integration" is the honest scope of the KEY and "this person" stays
 * the scope of the IDENTITY. `listForOwner` bounds the read in the query
 * (`FEEDBACK_PROMPT_MAX_NOTES`, newest first) so the widening costs the same for everybody.
 *
 * A LIST OF SECTIONS rather than a string, because that is the shape both callers take
 * (`contentSections`), and an empty array is the honest "nothing to say".
 */
export async function feedbackSectionsForOwner(
  actor: Actor,
  store: ActionFeedbackReader = actionFeedbackStore,
): Promise<string[]> {
  if (actor.orgId === '' || actor.userId === '') return [];
  const rows = await store.listForOwner(actor.orgId, actor.userId, FEEDBACK_PROMPT_MAX_NOTES);
  const section = feedbackPromptSection(rows);
  return section === null ? [] : [section];
}

// ---------------------------------------------------------------------------------------------

/** The stored row, projected onto the wire shape. The tenancy substrate stops here. */
function feedbackView(row: ActionFeedbackDoc): IntegrationActionFeedback {
  return {
    actionName: row.actionName,
    ...(row.stepRef !== undefined ? { stepRef: row.stepRef } : {}),
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
