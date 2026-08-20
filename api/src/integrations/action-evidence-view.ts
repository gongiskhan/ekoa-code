/**
 * integrations/action-evidence-view.ts - the READ side of S1's evidence collection (slice S2).
 *
 * ── WHAT THIS IS ──────────────────────────────────────────────────────────────────────────────
 *
 * S1 stores exactly one evidence row per `(orgId, ownerUserId, integrationKey, actionName)` and
 * gave the store a `listForIntegration` scoped to one owner's rows. This module is the detail
 * page's read over it, and it is a SEPARATE FILE from `integration-capability.ts` on purpose -
 * that file is the `user-or-key` capability core, and evidence is deliberately NOT on the key
 * surface (see the `listActionEvidence` descriptor). Keeping the two apart means the capability
 * core cannot grow a key-reachable path into this collection by someone adding a field to a view
 * it already returns.
 *
 * ── THE READ IS OWNER-SCOPED, AND THAT IS THE FIRST SCOPE ─────────────────────────────────────
 *
 * 1. THE ORG AND THE OWNER. `listForIntegration(orgId, ownerUserId, integrationKey)` takes both
 *    terms, and this module passes the CALLER'S OWN `actor.orgId` and `actor.userId` - never a
 *    user id read off a request. The row `_id` is derived from both, so neither another tenant's
 *    row nor a colleague's row is addressable at all. That is S1's guarantee (`round eight`, the
 *    re-key recorded in docs/decisions.md: "the sample belongs to the owner") and this module does
 *    not restate it.
 *
 *    THE CONSEQUENCE IS DELIBERATE AND IS SAID PLAINLY: this endpoint answers a caller their OWN
 *    samples and nobody else's, so two members of one org open the same detail page and see
 *    different evidence - each the record of the account THEY ran the action with. A row holds one
 *    real request and one real response body of a third-party portal session, so the alternative -
 *    an org-wide read filtered by what the reader can see - would hand one member a colleague's
 *    actual portal data. Narrow is the direction that stays reversible.
 *
 * ── AND THE DEFINITION READ PREDICATE IS THE SECOND ───────────────────────────────────────────
 *
 * 2. THE ACTION MUST BE ON THE DEFINITION THIS CALLER RESOLVES, which the store's key alone does
 *    not give, and which is the reason this module is not a one-line route body. The two keys move
 *    INDEPENDENTLY: a row is addressed by an action NAME, and the package that names the action is
 *    a separate document with its own lifecycle. So the caller's own rows outlive the definition
 *    that produced them, in two ordinary ways:
 *
 *      - the action is RE-AUTHORED OUT of the package (a definition is edited, an action renamed
 *        or dropped). The row stays until it is superseded, discarded, or aged out at 90 days;
 *      - the caller's RESOLUTION CHANGES under them. `resolveDefinition` answers a reader their own
 *        `private` row before any `org`/`global`/baseline one, so gaining a private package, or
 *        having an org one replaced by a narrower revision, silently narrows what they resolve
 *        while their older rows stay exactly where they were.
 *
 *    In both cases a straight collection read renders a sample - one real request, one real
 *    response body - beside an action the caller can no longer see, cannot run and cannot name.
 *    So the definition is resolved FIRST, under the caller's own actor, through the same
 *    `resolveCapabilityDefinition` the capability read and `achieve` use (imported, never
 *    re-derived); an integration that does not resolve answers `not_found`, byte-identical for
 *    "does not exist" and "not visible to you". Then the rows are kept only where `actionName` is
 *    on THAT definition. `recipe-store.listRecipesForActor` re-filters by the same predicate for
 *    the same reason; this is that rule applied to the sibling collection.
 *
 * ── WHAT THE PROJECTION DROPS ─────────────────────────────────────────────────────────────────
 *
 * The storage envelope: `_id`, `orgId`, `ownerUserId`, `integrationKey`. The first three are the
 * tenancy substrate and never travel (the same rule `definitionFromDoc` follows); the fourth is
 * the path segment the caller just supplied. Nothing is ADDED here - every field on the wire is a
 * field S1 wrote through the executor's own redaction and the store's whole-document last gate.
 */
import type { Actor } from '@ekoa/shared';
import { actionEvidenceStore, type ActionEvidenceDoc, type ActionEvidenceStore } from './action-evidence-store.js';
import { resolveCapabilityDefinition } from './integration-capability.js';
import type { CapabilityOutcome } from './integration-capability.js';

/** One action's evidence as the wire carries it (`shared/src/integrations.ts` `IntegrationActionEvidence`). */
export interface ActionEvidenceView {
  actionName: string;
  backingType: string;
  shape?: string;
  validatedAt: string;
  evidence: ActionEvidenceDoc['evidence'];
}

/** The store slice this module needs - the ONE list read, which is scoped to a single owner within
 *  a single org. Injectable so the unit lane drives the filtering without standing up Mongo;
 *  defaults to the process-wide store. */
export type ActionEvidenceReader = Pick<ActionEvidenceStore, 'listForIntegration'>;

/**
 * Every evidence row this caller may see for one integration: their OWN rows, narrowed to the
 * actions their own resolved definition carries.
 *
 * Refuses exactly as the capability read refuses (`no_tenant` / `not_found`), because it refuses
 * through the very same resolution - a caller whose principal names no org is turned away before a
 * single row is read, and a key the caller cannot see is a 404 rather than an empty list, so this
 * endpoint is not an existence oracle the capability read is not.
 */
export async function listActionEvidenceFor(
  actor: Actor,
  integrationKey: string,
  store: ActionEvidenceReader = actionEvidenceStore,
): Promise<CapabilityOutcome<ActionEvidenceView[]>> {
  const resolved = await resolveCapabilityDefinition(actor, integrationKey);
  if (!resolved.ok) return resolved;
  // The action names of the definition THIS actor resolved - see scope 2 in the header. Built from
  // the resolved definition and never from the rows, so a row for an action the caller can no
  // longer see has nothing to match against.
  const visible = new Set((resolved.value.definition.actions ?? []).map((a) => a.actionName));
  // The caller's OWN org and the caller's OWN user id. Both come off the verified actor; neither
  // is ever read from the request, so there is no shape of call that asks for somebody else's rows.
  const rows = await store.listForIntegration(actor.orgId, actor.userId, integrationKey);
  return {
    ok: true,
    value: rows.filter((row) => visible.has(row.actionName)).map(evidenceView),
  };
}

function evidenceView(row: ActionEvidenceDoc): ActionEvidenceView {
  return {
    actionName: row.actionName,
    backingType: row.backingType,
    ...(row.shape !== undefined ? { shape: row.shape } : {}),
    validatedAt: row.validatedAt,
    evidence: row.evidence,
  };
}
