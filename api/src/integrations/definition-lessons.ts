/**
 * PER-INTEGRATION LESSONS (slice C3) — the operational knowledge an integration accumulates.
 *
 * An integration is not only a schema and a set of actions; it is also everything its operators
 * learned the hard way ("this portal rejects requests without a Referer", "the sandbox key expires
 * weekly"). Today that knowledge lives in someone's head or in a ticket. This module makes it a
 * field ON the integration, editable by the people who may already save the integration, and read
 * back into the agent that uses it through the `load_context` seam.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THIS MODULE EXISTS TO HONOUR: RAW TO THE EDITOR, SCRUBBED TO THE PROMPT.
 *
 * `lessons` is free text a human writes and it reaches a model prompt, which makes it exactly the
 * surface the A2 review's F7 finding was about (`resolveSkillMd` handed a tenant-authored body
 * verbatim into every future prompt, so a credential pasted into the documentation rode along).
 * A3 then found the mirror-image defect and fixed it by SPLITTING the two views rather than
 * choosing one:
 *
 *   - the PROMPT view is `scrubSecretText`'d — the deterministic egress floor (A2 review F7);
 *   - the EDITOR view is BYTE-EXACT — because the scrub is lossy, and a builder session seeded
 *     from a scrubbed body writes the redaction back on the next ordinary save, permanently
 *     destroying legitimate tenant documentation (A3 review F3).
 *
 * This module does not re-implement either half. `scrubSecretText` (definitions.ts) is the same
 * floor `resolveSkillMd` applies, and `canEditDefinitionRaw` (definition-registry.ts) is the same
 * admission set `resolveSkillMdRaw` and the builder's `editablePackageFor` use — the SAVE PATH's
 * own set, which is what makes the byte-exact view worth exactly as much as the save that follows
 * it (D2 re-review HIGH-1). A principal who cannot save gets the scrubbed view and `editable:
 * false`; they never see raw bytes, because there is no edit round trip of theirs to protect.
 *
 * CROSS-ORG READS go through `crossOrgView` — the registry's one rule that another organisation
 * reads the FROZEN PUBLISHED SNAPSHOT (slice E2), never the author's live fields. E2 already
 * treats `lessons` as first-class publishable content (`publishableContentOf`,
 * `FREE_TEXT_PATHS`), so a published integration's lessons are scrubbed by the strict publish
 * floor before any other tenant can read them, and this module inherits that for free.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * LENGTH. `LESSONS_MAX_CHARS` is a REFUSAL, never a truncation. Silently dropping the tail of what
 * someone typed is the worst of the three options (refuse / truncate / accept unbounded): the
 * author believes it was recorded. The cap exists because this text rides into every prompt that
 * loads the integration's context, so its size is a per-call cost, not just storage.
 *
 * SCOPE, STATED AS A LIMITATION RATHER THAN LEFT TO BE DISCOVERED. Lessons attach to a STORED
 * definition row. A SHIPPED baseline package (api/assets/integrations) has none, so it has no
 * lessons surface: both the read and the write answer `notfound`, and the dashboard renders
 * nothing rather than an editable box whose save would be refused. That is not a choice made here
 * — writing lessons onto a shipped key would have to mint a tenant row shadowing it, and A3's save
 * path refuses exactly that ("the tenant either keeps the shipped package or forks it under a
 * distinct key of their own"). An operator who needs lessons on a shipped integration forks it
 * first, which is the same ceremony every other edit to a shipped package already requires.
 *
 * LOST UPDATES. The write is compare-and-swap against the row's `updatedAt`, which the read hands
 * back as the concurrency token. A caller that echoes a stale token is REFUSED (`stale`) and given
 * the current text, never silently overwritten; a caller that omits the token is explicitly asking
 * to overwrite. The comparison is re-run INSIDE the store's CAS mutator (the E1 review F4b
 * re-assert), so a write that lands between the read and the swap is caught too — not just a
 * stale browser tab.
 */
import type { Actor, IntegrationLessonsView } from '@ekoa/shared';
import { INTEGRATION_LESSONS_MAX_CHARS } from '@ekoa/shared';
import { scrubSecretText } from './definitions.js';
import { canEditDefinitionRaw, crossOrgView } from './definition-registry.js';
import {
  integrationDefinitionStore,
  IntegrationDefinitionStore,
  type IntegrationDefinitionDoc,
} from './definition-store.js';

/**
 * The ceiling on a lessons body lives in `shared/` — ONE constant behind the zod `.max()` that
 * makes an over-length body a 400 at the wire contract, this seam's own refusal, and the
 * dashboard's character counter. Two numbers would eventually disagree, and the surface where
 * they disagreed would be the one that truncates.
 */
export { INTEGRATION_LESSONS_MAX_CHARS };

/**
 * The heading under which lessons are joined to the integration's SKILL.md for a prompt. English,
 * matching the SKILL.md bodies it is concatenated with (the dashboard renders its own PT-PT label
 * — this string is prompt content, not UI copy).
 */
export const LESSONS_PROMPT_HEADING = '## Operational lessons (recorded by this organisation)';

/**
 * The wire shape is `shared/`'s `IntegrationLessonsView` and this module builds it directly, so
 * the projection and the contract cannot drift. Two of its fields carry the whole design:
 *
 * `editable` is the honest statement of WHICH of the two views the caller was handed: TRUE means
 * these are the stored bytes and a write will be accepted; FALSE means the text has been through
 * the egress scrub and a write would be refused. The dashboard renders a genuinely read-only
 * textarea rather than offering an edit that cannot land.
 *
 * `updatedAt` is the ROW's, not the field's: the concurrency token means "the definition I read",
 * so an unrelated write to the same row (a builder save, a visibility flip) also invalidates it.
 * That is deliberate — the row you were editing is not the row you loaded.
 */
export type ReadLessonsResult =
  | { verdict: 'ok'; view: IntegrationLessonsView }
  | { verdict: 'notfound' };

export type WriteLessonsResult =
  | { verdict: 'ok'; view: IntegrationLessonsView }
  /** No row of that key resolves for this actor — indistinguishable from one that does not exist. */
  | { verdict: 'notfound' }
  /** Visible, but not theirs to rewrite (a peer's row, a published row, another org's). */
  | { verdict: 'forbidden' }
  /** Over `INTEGRATION_LESSONS_MAX_CHARS`. Nothing is written and nothing is trimmed. */
  | { verdict: 'too_long'; limit: number; length: number }
  /** The row moved since `expectedUpdatedAt` was read. The CURRENT view comes back with it. */
  | { verdict: 'stale'; view: IntegrationLessonsView };

/** The reads this module needs from the definition store — deliberately the actor-scoped one. */
export interface LessonsStoreReader {
  getForActor(actor: Actor, key: string): Promise<IntegrationDefinitionDoc | null>;
}

/**
 * Project a stored row onto the lessons view for `actor`, applying the raw-vs-scrubbed split.
 *
 * Pure and exported so the rule can be pinned directly (both signs, both branches) without a
 * store: the two calls below are the only ways to reach it, and they differ only in where the
 * document came from.
 */
export function lessonsViewOf(doc: IntegrationDefinitionDoc, actor: Actor): IntegrationLessonsView {
  if (canEditDefinitionRaw(doc, actor)) {
    // BYTE-EXACT. `canEditDefinitionRaw` already refuses every `global` row and every row outside
    // the actor's org, so this branch can only ever hand back the actor's own tenant's live text.
    return { key: doc.key, lessons: doc.lessons ?? '', editable: true, updatedAt: doc.updatedAt };
  }
  // The scrubbed view — through the SAME cross-org rule the knowledge body uses, so publishing can
  // never become a new way to read another org's raw content.
  const view = crossOrgView(doc, actor);
  return {
    key: doc.key,
    lessons: view.lessons == null ? '' : scrubSecretText(view.lessons),
    editable: false,
    updatedAt: doc.updatedAt,
  };
}

/**
 * The lessons of one integration, for `actor`. A key with no stored row answers `notfound` — the
 * SHIPPED baseline packages (api/assets/integrations) carry no lessons, and inventing an empty
 * editable view for them would offer an edit the write path then refuses.
 */
export async function readLessons(
  actor: Actor,
  key: string,
  store: LessonsStoreReader = integrationDefinitionStore,
): Promise<ReadLessonsResult> {
  const doc = await store.getForActor(actor, key);
  if (!doc) return { verdict: 'notfound' };
  return { verdict: 'ok', view: lessonsViewOf(doc, actor) };
}

/**
 * The PROMPT view of an integration's lessons: scrubbed, cross-org-safe, or `null` when the key
 * has no stored row (or its lessons are empty).
 *
 * NEVER returns the byte-exact text, for any actor: this is the model-egress side of the split,
 * and the raw view exists solely to protect an edit round trip. The A2-review F7 floor is
 * therefore unconditional here — deliberately NOT `if (!canEditDefinitionRaw) scrub`, which would
 * hand an author's own pasted credential straight into their prompts.
 */
export async function lessonsForPrompt(
  actor: Actor,
  key: string,
  store: LessonsStoreReader = integrationDefinitionStore,
): Promise<string | null> {
  const doc = await store.getForActor(actor, key);
  if (!doc) return null;
  const view = crossOrgView(doc, actor);
  if (view.lessons == null || view.lessons.trim() === '') return null;
  return scrubSecretText(view.lessons);
}

/**
 * Join an integration's knowledge body, its lessons and the CALLER'S OWN notes into the ONE string
 * `load_context` returns.
 *
 * Every half arrives already scrubbed (`resolveSkillMd` / `lessonsForPrompt` /
 * `action-feedback.ts`'s `feedbackForPrompt`); this function only decides the shape. It is separate
 * from the resolutions so the composition can be pinned without a store, and so the frontmatter
 * strip stays where it belongs (the composition root).
 *
 * `feedback` IS OPTIONAL, and additive on purpose (Rule 7): every existing caller keeps its meaning
 * unchanged, and a deployment that never resolves notes composes byte-identically to before S3.
 *
 * THE ORDER IS NOT COSMETIC. The knowledge body is what the package IS, the lessons are what the
 * ORGANISATION learned, and the notes are what THIS PERSON learned - widest provenance first,
 * narrowest last, so the most specific guidance is the closest thing to the turn. It is also the
 * order of decreasing review: a shipped body was written by whoever ships packages, lessons by
 * whoever may save the integration, and a note by one person with no reviewer at all. The three
 * headings say which is which, so a model reading the composed body can tell the platform's words
 * from a colleague's from the caller's own.
 *
 * Returns `null` when there is nothing to say - an integration with no body, no lessons and no
 * notes must leave `load_context` answering `null` exactly as it did before these slices.
 */
export function composeIntegrationContext(
  skillMd: string | null,
  lessons: string | null,
  feedback: string | null = null,
): string | null {
  const body = skillMd?.trim() ? skillMd.replace(/\s+$/, '') : null;
  const learned = lessons?.trim() ? lessons.trim() : null;
  // Already carries its own heading (`FEEDBACK_PROMPT_HEADING`), because the section is built where
  // the rows are scrubbed and capped - the one place a note becomes prompt text.
  const notes = feedback?.trim() ? feedback.trim() : null;
  const sections = [
    ...(body === null ? [] : [body]),
    ...(learned === null ? [] : [`${LESSONS_PROMPT_HEADING}\n\n${learned}\n`]),
    ...(notes === null ? [] : [`${notes}\n`]),
  ];
  return sections.length === 0 ? null : sections.join('\n\n');
}

/**
 * Replace an integration's lessons. See the module header for the two guarantees this write makes
 * (refuse rather than truncate; refuse rather than clobber).
 *
 * The admission gate is `canEditDefinitionRaw` — the save path's own set — passed INTO the store's
 * CAS so the identical predicate is judged again against the row actually being written. The
 * store's `setLessons` adds the visibility check and the swap; it does not carry a second copy of
 * the rule (definition-store.ts cannot import the registry without a cycle, which is precisely why
 * the predicate is injected rather than duplicated).
 */
export async function writeLessons(
  actor: Actor,
  key: string,
  lessons: string,
  opts: { expectedUpdatedAt?: string } = {},
  store: IntegrationDefinitionStore = integrationDefinitionStore,
): Promise<WriteLessonsResult> {
  if (lessons.length > INTEGRATION_LESSONS_MAX_CHARS) {
    // Checked BEFORE the row is resolved: an over-length body is refused for the same reason
    // whether or not the caller may write that integration, and refusing early keeps the limit
    // from becoming an existence oracle.
    return { verdict: 'too_long', limit: INTEGRATION_LESSONS_MAX_CHARS, length: lessons.length };
  }
  const doc = await store.getForActor(actor, key);
  if (!doc) return { verdict: 'notfound' };
  if (!canEditDefinitionRaw(doc, actor)) return { verdict: 'forbidden' };

  const result = await store.setLessons(doc._id, actor, lessons, {
    admit: (row) => canEditDefinitionRaw(row, actor),
    ...(opts.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: opts.expectedUpdatedAt } : {}),
  });
  if (result.verdict === 'ok') return { verdict: 'ok', view: lessonsViewOf(result.doc, actor) };
  if (result.verdict === 'stale') return { verdict: 'stale', view: lessonsViewOf(result.doc, actor) };
  if (result.verdict === 'forbidden') return { verdict: 'forbidden' };
  return { verdict: 'notfound' };
}
