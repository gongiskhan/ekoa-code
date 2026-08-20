/**
 * integrations/action-evidence-store.ts - the ONE LIVE PROOF that an action actually ran (slice S1).
 *
 * ── WHAT THIS IS, AND WHY IT IS NOT `integration_captured_calls` ──────────────────────────────
 *
 * P2.0 already built a collection for evidence, and this is deliberately not it. The two answer
 * different questions and have opposite lifecycles:
 *
 *   `integration_captured_calls`   - the RAW network trace of a discovery pass. Hundreds of rows
 *                                    per pass, append-only, keyed by (…, captureId, seq), MACHINE
 *                                    facing: it exists so `automation/recipe.ts` can distil a
 *                                    replayable recipe out of it, and `discardCapture` throws the
 *                                    whole pile away the moment the recipe is compiled. Nobody
 *                                    reads it after that; nothing renders it.
 *
 *   `integration_action_evidence`  - THIS. Exactly ONE row per (org, integration, action), HUMAN
 *                                    facing, superseded wholesale by each validated run. It is the
 *                                    answer to "what did this action do the last time it worked",
 *                                    which is the question the detail page asks and the question a
 *                                    promotion to `trusted` now has to be able to answer.
 *
 * Both exist because "the trace a compiler consumes" and "the sample a person is shown" are not the
 * same artefact: the first is unbounded, transient and discarded on success, the second is bounded,
 * durable and only ever replaced. Collapsing them would mean either keeping hundreds of raw rows
 * alive forever to render one sample, or deleting the sample the moment a recipe compiled.
 *
 * ── WHY THIS IS A COLLECTION AND NOT A FIELD ON THE DEFINITION ────────────────────────────────
 *
 * Two independent reasons, and either alone is decisive:
 *
 *   1. IT WOULD RIDE `publishedSnapshot` INTO OTHER ORGS. `definition-store.ts` copies the
 *      definition document when an integration is promoted. An evidence sample is one tenant's
 *      real request and one tenant's real response body - client names, processo numbers, invoice
 *      totals. On the definition it is inside the published bytes by construction, and the only
 *      thing standing between it and every other org would be a scrubber remembering to strip it.
 *      In its own collection there is nothing to remember: no publish path reads this module. That
 *      structural exclusion IS the sanitisation (CONVERGENCE_PLAN D5).
 *   2. IT WOULD RACE THE 16MB DOCUMENT LIMIT, and be re-serialised on every compare-and-swap of a
 *      document every reader of every action already touches - the Trap T2 argument
 *      `captured-calls-store.ts` makes at length, which applies here unchanged.
 *
 * ── WHAT MAY BE STORED ────────────────────────────────────────────────────────────────────────
 *
 * NO NEW REDACTION MACHINERY EXISTS IN THIS FILE, and that is the safety argument rather than an
 * economy. The api-call sample is the executor's OWN `requestSummary` - the object it already
 * builds on every call through `redactSecretsDeep` + `redactHeaders` + `redactUrl`, and already
 * persists verbatim on the failure path - plus a response body through the same `redactSecretsDeep`
 * and the same `truncateForDisplay` cap the failure path uses. If the redaction on this row were
 * ever wrong, the failure path would have been leaking the identical bytes since C2.
 *
 * The last gate is `captured-calls-store.ts`'s, for the same reason it has one: the whole document
 * is re-checked against the run's live registry after it is assembled, so a field a later slice
 * adds and forgets to filter cannot carry a secret out. A row that fails is NOT WRITTEN - evidence
 * is worth less than a credential.
 *
 * ── TENANCY (Capability Contract rule 5): ORG **AND OWNER**, BECAUSE THE SAMPLE IS THE OWNER'S ───
 *
 * The first cut of this module keyed a row on (orgId, integrationKey, actionName) and argued only
 * that a sample must not cross ORGS. That argument was right and incomplete, and the gap was
 * measurable: `findConfigForOwner` resolves a credential per (orgId, ownerUserId), and
 * `action-consent.ts`'s `idFor` keys an approval on (orgId, scope.userId, …). So WITHIN one org, an
 * org-visible definition run by two users is two different people's third-party accounts, and the
 * evidence is one tenant's real request and real response body - client names, processo numbers,
 * invoice totals - belonging to whichever of them ran it.
 *
 * With an org-only key that had two live consequences, both reproduced before this was changed:
 *   - the PEER'S RUN DESTROYED THE OWNER'S SAMPLE, because both wrote the same `_id`, and the org
 *     row then held the peer's private data where the owner's had been;
 *   - `trustAuthoredAction` reads this collection, so user A could promote an action to `trusted` -
 *     and therefore auto-runnable by `achieve` - on the strength of a run user B made against B's
 *     OWN third-party account.
 *
 * The screenshot POINTER was never the hole (the plane re-checks org + owner on every byte); the
 * EXCERPT copied into the row beside it was. The key is therefore the credential's key and the
 * consent's key: (orgId, ownerUserId, integrationKey, actionName). Both terms are in the
 * deterministic `_id`, both are stored on the row, both are terms of every query filter and both are
 * re-checked on every fetched document. Suite:
 * `api/tests/security/action-evidence-isolation.test.ts`.
 *
 * The ONE cross-tenant reader left in this module is `pinnedRunIdsForRetention`, and it is not a
 * tenancy hole: see its own docblock. It is reachable from the boot sweeper alone and returns run
 * IDENTIFIERS ONLY. Round three had a SECOND one - `listOwnerRefsForKey`, which handed the write-time
 * reconciler every tenant's rows for a key - and it is deleted rather than narrowed: a listing that
 * crosses tenants is what made a cross-tenant DELETE expressible in the first place.
 *
 * ── THE REMOVAL RULE: A WRITE BY ONE ORG NEVER DELETES ANOTHER ORG'S DATA ─────────────────────
 *
 * `recipe-lifecycle.ts` states the invariant this collection inherits: NOTHING DURABLE OUTLIVES THE
 * THING IT IS EVIDENCE FOR. An evidence row is durable and PINS its run's screenshots out of the
 * 7-day sweep for as long as it lives, so a row whose action no longer resolves converts a bounded
 * retention into an unbounded one. THREE CONSECUTIVE ROUNDS tried to close that at WRITE TIME and
 * each one was wrong in a different direction, so the shape changed rather than the parameter:
 *
 *   round two  - a diff of action sets scoped to `input.orgId`, the org that WROTE the definition.
 *                Every row is keyed by the org that RAN the action, which the `global` tier makes a
 *                different org, so a consumer org's rows were ORPHANED - never collected at all.
 *   round three - the same collector widened to reconcile ACROSS TENANTS by asking `getForActor`
 *                per row owner. That deleted across an org boundary, twice over: the reconciler
 *                asked for the LIVE row while a consumer resolves the FROZEN `publishedSnapshot`
 *                (deliberately carried forward by the replace branch), so org A's ordinary re-save
 *                destroyed org B's only copy of an action org B COULD STILL RUN; and it asked as
 *                the RUNNER while an org-shared credential resolves the definition as the CUSTODIAN
 *                (`definitionActorForCredential`: "never as the reader"), so a peer's rows were
 *                wiped by a save that dropped nothing at all.
 *
 * The lesson is not "use a better actor". "Who can still resolve this action" has a genuinely
 * different answer per reader - live row vs frozen snapshot, runner vs custodian, own credential vs
 * shared, own org's row vs a global one vs the shipped baseline - so a reconciler that answers it at
 * WRITE TIME on behalf of readers it cannot see will keep being wrong, and being wrong here destroys
 * a tenant's only copy of its own data. THE COSTS ARE NOT COMPARABLE: an orphaned row is a BOUNDED
 * retention and privacy gap, and a deleted row is unrecoverable. So:
 *
 *   1. THE READER COLLECTS ITS OWN. `action-executor.ts` resolves through the one production path
 *      (`action-resolution.ts`), so it KNOWS - for this org, this owner, this credential, this
 *      document - whether the integration or the action is still reachable. When it is not, the
 *      run's refusal drops that owner's rows through `discardOwnerEvidence` below. Own rows only,
 *      both tenancy terms required by the type.
 *   2. THE WRITE COLLECTS ONLY INSIDE ITS OWN TENANT. `evidence-reconcile.ts` reconciles the rows
 *      of the WRITING ORG and no other, asking the SAME production resolution per owner. The blast
 *      radius of the worst possible bug in it is one org: the org whose member just wrote.
 *   3. EVERYTHING ELSE FAILS TOWARDS RETAINING, and the gap is bounded rather than argued away:
 *      `sweepExpiredEvidence` (a retention sweep at boot, `EVIDENCE_RETENTION_DAYS`) ends every row
 *      that has not been re-validated, orphan or not; `discardEvidence` is the OWNER'S control,
 *      reachable at `DELETE /api/v1/integrations/:key/actions/:actionName/evidence`; and
 *      `discardEvidenceForDisconnectedConfig` erases what a credential produced when the credential
 *      goes. docs/findings.md carries the residual window as an open entry, not as a closed one.
 *
 * WHAT THIS MEANS FOR THE WRITES THAT NARROW REACH, stated as what the CONSUMER RESOLVES rather
 * than as what the definition says - which is the reading every previous revision of this header got
 * wrong. `create(..., 'replace')` (the builder save and `achieve`'s in-place write), `setVisibility`
 * in either narrowing direction, AND `publishSnapshot` on a re-publish (a fresh snapshot with fewer
 * actions narrows every consumer at once, which the round-three header dismissed as "widening
 * only") all end an action for SOMEBODY. For the writing org's own rows, (2) collects. For every
 * other org's rows, (1) collects on their next run and (3) bounds the window until then. No write
 * anywhere in this codebase deletes a row outside its own tenant.
 *
 * THE SCREENSHOT TREE still has no subject-erasure path of its own (`screenshot-plane.ts`); that
 * remains recorded as an open gap in docs/findings.md rather than implied to be closed here.
 */
import { createHash } from 'node:crypto';
import { Store, type Doc } from '../data/store.js';
import { integrationActionEvidence } from '../data/stores.js';
import { secretRegistryFromValues, type SecretRegistry } from '../security/redaction.js';

/**
 * Per-excerpt cap. The SAME ceiling the executor's failure path applies to a response body
 * (`MAX_BODY_DISPLAY_BYTES` in `action-executor.ts`), stated once here so the success sample and
 * the failure dump cannot drift into showing a person two different amounts of the same body.
 */
export const MAX_EVIDENCE_EXCERPT_CHARS = 8_000;

/** How many step rows one automation-backed evidence row may pin. A trace is evidence, not an
 *  archive; a 400-step run teaches nothing the first 50 steps do not, and the row must stay far
 *  clear of the document limit however long a run gets. */
export const MAX_EVIDENCE_STEPS = 50;

/**
 * Names ONE owner's evidence for one action. Every read and write states it in full - there is no
 * ambient "current tenant" and no ambient "current user" in this module.
 *
 * `ownerUserId` is the same identity `findConfigForOwner` resolves the credential under, so the
 * sample is keyed by whose third-party account actually produced it. See the module header.
 */
export interface ActionEvidenceKey {
  orgId: string;
  ownerUserId: string;
  integrationKey: string;
  actionName: string;
}

/**
 * WHO produced a row - the unit a removal decision is scoped by. Exactly the pair
 * `findConfigForOwner` resolves a credential under, so "which actions can this owner still resolve"
 * is a question about a real principal rather than about whoever happened to write the definition.
 */
export interface ActionEvidenceOwner {
  orgId: string;
  ownerUserId: string;
}

/**
 * ONE row, as the writing org's reconciler sees it: WHOSE it is and WHICH action it names, and
 * nothing else. There is no sample in this shape - a retention decision has no business holding a
 * byte of anyone's request or response body.
 */
export interface ActionEvidenceOwnerRef extends ActionEvidenceOwner {
  actionName: string;
}

/**
 * One OWNER'S rows for one integration, optionally narrowed to one action. The scope of every
 * reader-side collection, and the reason it can never reach past the caller: both tenancy terms are
 * REQUIRED by the type, and `actionName` - the only optional one - narrows rather than widens.
 */
export interface OwnerEvidenceScope extends ActionEvidenceOwner {
  integrationKey: string;
  actionName?: string;
}

/**
 * The scope of the credential-disconnection erasure (`deleteConfig`).
 *
 * A DISCRIMINATED `owner`, NOT AN OPTIONAL `ownerUserId`, because the two cases are genuinely
 * different and an optional term is one a caller can forget: a config row stamped with a custodian
 * (`ownerUserId`) is that one person's credential, while a legacy org-shared row carries none and is
 * the fallback `findConfigForOwner` hands to every member of the org that has no row of their own.
 *
 * `everyOwnerExcept` IS THAT SECOND ARM, AND ITS SHAPE IS THE ROUND-FOUR CORRECTION. It used to read
 * `'every-owner-in-org'`, which erased the samples of peers whose OWN credential was never the
 * deleted row: `findConfigForOwner` returns `rows.find(c => c.ownerUserId === owner)` BEFORE it
 * falls back to the shared row, so a member holding their own config for the key never resolved the
 * deleted one and their sample is a sample of a credential they still have. The correct scope is
 * "every owner for whom `findConfigForOwner` would have resolved THIS row", i.e. every owner in the
 * org except those still holding a config of their own - which is what the caller passes.
 */
export type DisconnectedConfigScope = {
  orgId: string;
  integrationKey: string;
  owner: { userId: string } | { everyOwnerExcept: readonly string[] };
};

/**
 * How long a validated run stays evidence. The RETENTION BOUND that makes an orphaned row a bounded
 * gap rather than an unbounded one, and the reason "fail towards retaining" is an acceptable posture
 * at all: a row not re-validated within this window goes at the next boot whether or not anything
 * ever noticed its action stopped resolving.
 *
 * 90 DAYS, AND THE NUMBER IS A TRADE RATHER THAN A ROUND FIGURE. Shorter than the screenshot sweep's
 * 7 days is wrong (an automation row's pointers would outlive nothing, but the graduation
 * prerequisite would evaporate between a run and the human who confirms it); much longer stops
 * bounding anything. Every successful run rewrites `validatedAt`, so an integration in real use
 * never ages out - only one nobody has run for a quarter of a year.
 */
export const EVIDENCE_RETENTION_DAYS = 90;

/** The api-call sample: the executor's own redacted request summary plus a capped response body. */
export interface ApiCallEvidence {
  kind: 'api-call';
  /** `truncated` is the REQUEST body's own flag. It exists for the same reason the response's does:
   *  the module promises truncation is recorded and never silent, and an oversized request body is
   *  stored with the "… [truncated, N more bytes]" marker sliced off by the cap below. */
  request: { method: string; url: string; headers: Record<string, string>; body?: string; truncated?: boolean };
  response: { status: number; body?: string; bodyIsJson?: boolean; truncated?: boolean };
}

/**
 * ONE step of an automation-backed run, as evidence POINTS at it.
 *
 * `screenshotUrl` is the path the authenticated screenshot plane already serves
 * (`GET /automation-screenshots/:automationId/:runId/:file`), so a reader still has to present a
 * token and still has to pass that plane's org+owner check to see a single byte. Copying the PNG
 * into this row would have created a second copy of an authenticated portal session under a
 * different access rule; a pointer inherits the rule that already exists.
 */
export interface RunStepEvidence {
  stepIndex: number;
  stepType?: string;
  /**
   * The step's own outcome (`StepRecord.status` - 'succeeded' | 'failed' | …).
   *
   * NAMED `status` BECAUSE THAT IS WHAT IT HOLDS. The first cut called this field `title` and
   * populated it from `step.status`, which is not a title of anything: `StepRecord` has no title,
   * so every step of every automation-backed sample would have rendered as "succeeded".
   */
  status?: string;
  /** Pointer into the authenticated screenshot plane. Never bytes. */
  screenshotUrl?: string;
  /** Capped, redacted excerpt of the step's own output (a `local_command`'s stdout/stderr). */
  excerpt?: string;
  truncated?: boolean;
}

/** The browser-steps / bash-cli sample: pointers into a run the engine already recorded. */
export interface AutomationEvidence {
  kind: 'automation';
  /** The run these pointers address. Also the retention PIN - see `pinnedRunIdsForRetention`. */
  runId: string;
  status?: string;
  steps: RunStepEvidence[];
  /** True when the run had more steps than `MAX_EVIDENCE_STEPS`. Recorded, never silent. */
  truncated?: boolean;
}

export type ActionEvidence = ApiCallEvidence | AutomationEvidence;

export interface ActionEvidenceDoc extends Doc, ActionEvidenceKey {
  /** `api-call` | `browser-steps` | `bash-cli` - how the action ran when it produced this. */
  backingType: string;
  /**
   * The action SHAPE (`action-consent.ts`'s `actionShape`) this run actually exercised.
   *
   * Stamped so the graduation prerequisite can be bound to BYTES rather than to a name: an action
   * that was authored, run once, then re-authored into something else must not graduate on the old
   * run's evidence. `promoteToTrusted` refuses evidence whose shape does not match, and refuses
   * evidence carrying no shape at all.
   */
  shape?: string;
  /** When the validated run happened. THE graduation prerequisite reads this. */
  validatedAt: string;
  evidence: ActionEvidence;
}

export type ActionEvidenceErrorCode = 'UNSAFE' | 'INVALID';

export class ActionEvidenceStoreError extends Error {
  constructor(public readonly code: ActionEvidenceErrorCode, message: string) {
    super(message);
    this.name = 'ActionEvidenceStoreError';
  }
}

/**
 * The deterministic `_id`, JSON-encoded so the encoding is injective for any strings (the argument
 * `capturedCallIdFor` and `definitionIdFor` both make; a `::` join is not injective when any term
 * may contain the separator).
 *
 * There is no run id, no timestamp and no sequence in it, and that is the whole design: the id IS
 * the (org, integration, action) tuple, so a `put` of a new validated run REPLACES the previous
 * row rather than accumulating beside it. One live evidence row per action, by construction -
 * nothing has to remember to delete the old one.
 */
export function actionEvidenceIdFor(key: ActionEvidenceKey): string {
  return createHash('sha256')
    .update(JSON.stringify([key.orgId, key.ownerUserId, key.integrationKey, key.actionName]))
    .digest('hex');
}

/** What a caller offers. `secrets` is the run's live registry; when present, a row that still
 *  contains a live value after redaction is REFUSED rather than written. */
export interface RecordEvidenceInput {
  backingType: string;
  /** The action shape this run exercised - see `ActionEvidenceDoc.shape`. */
  shape?: string;
  evidence: ActionEvidence;
  secrets?: SecretRegistry;
}

export class ActionEvidenceStore {
  private readonly store: Store<ActionEvidenceDoc>;

  constructor(
    store: Store<Doc> = integrationActionEvidence,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = store as unknown as Store<ActionEvidenceDoc>;
  }

  /**
   * Record the evidence of a VALIDATED run, superseding whatever was there.
   *
   * `put` and not `insert`: superseding IS the operation. A retried record of the same run writes
   * the same bytes to the same id, so this is idempotent without a claim protocol.
   */
  async recordEvidence(key: ActionEvidenceKey, input: RecordEvidenceInput): Promise<ActionEvidenceDoc> {
    assertKey(key);
    const doc: ActionEvidenceDoc = {
      _id: actionEvidenceIdFor(key),
      orgId: key.orgId,
      ownerUserId: key.ownerUserId,
      integrationKey: key.integrationKey,
      actionName: key.actionName,
      backingType: input.backingType,
      ...(input.shape !== undefined ? { shape: input.shape } : {}),
      validatedAt: this.now().toISOString(),
      evidence: capEvidence(input.evidence),
    };
    // THE LAST GATE, over the WHOLE document rather than the fields a redaction pass knew about.
    // `captured-calls-store.ts` makes the argument; it holds identically here.
    assertNoLiveSecret(doc, input.secrets);
    return this.store.put(doc);
  }

  /** The one live evidence row for one owner's use of one action, or null. */
  async getEvidence(key: ActionEvidenceKey): Promise<ActionEvidenceDoc | null> {
    if (!isTenantScoped(key)) return null;
    const doc = await this.store.get(actionEvidenceIdFor(key));
    // The id already binds the row to the tenant AND the owner; this re-check covers a document
    // whose stored `orgId`/`ownerUserId` disagrees with the id it lives under (hand-written or
    // migrated), and it fails closed. Both terms are checked because both are in the id: a row
    // migrated from the org-only key of the first cut carries NO `ownerUserId`, and must not be
    // handed to whichever member of the org asks for it first.
    if (!doc) return null;
    return doc.orgId === key.orgId && doc.ownerUserId === key.ownerUserId ? doc : null;
  }

  /**
   * Every evidence row ONE OWNER holds for one integration - the detail page's read.
   *
   * THE POST-FILTER IS REDUNDANT BY CONSTRUCTION, and is recorded as such rather than left to look
   * load-bearing. An exact-match query on `orgId`/`ownerUserId` cannot return a document whose
   * stored values differ, so the two terms enforce the same predicate on the same fields and each
   * MASKS the other under mutation: removing either alone leaves the isolation suite green, and
   * only removing BOTH turns it red (measured). It is kept because `CapturedCallsStore.listCapture`
   * keeps its own for the same belt-and-braces reason, and because a later change to the query
   * shape (a projection, an `$in`, a re-sort) would otherwise silently remove the only tenancy term.
   *
   * CONTRAST `getEvidence`, WHERE THE RE-CHECK IS NOT REDUNDANT: that lookup is by deterministic
   * `_id` and never consults the stored fields at all, so a hand-written or migrated row whose
   * stored org/owner disagrees with the id it lives under WOULD be returned without it. That mutant
   * dies.
   */
  async listForIntegration(orgId: string, ownerUserId: string, integrationKey: string): Promise<ActionEvidenceDoc[]> {
    if (orgId === '' || ownerUserId === '' || integrationKey === '') return [];
    const rows = await this.store.find({ orgId, ownerUserId, integrationKey }, { actionName: 1 });
    return rows.filter((row) => row.orgId === orgId && row.ownerUserId === ownerUserId);
  }

  /**
   * Drop ONE owner's evidence for one action. THE removal primitive: every path that removes a row
   * goes through it, so there is one place where "which row, and whose" is decided.
   *
   * ITS OWN `isTenantScoped` CHECK IS BELT-AND-BRACES, AND IS RECORDED AS SUCH RATHER THAN LEFT TO
   * LOOK LOAD-BEARING. `getEvidence` below applies the same predicate first, so the two mask each
   * other under mutation exactly as `listForIntegration`'s two tenancy terms do: removing this one
   * ALONE leaves the isolation suite green (measured), and only removing both turns the discard leg
   * red. Kept because a later change to how this method finds its row - a direct `_id` delete, say -
   * would otherwise silently remove the only guard there is.
   */
  async discardEvidence(key: ActionEvidenceKey): Promise<boolean> {
    if (!isTenantScoped(key)) return false;
    const doc = await this.getEvidence(key);
    if (!doc) return false;
    return this.store.delete(doc._id);
  }

  /**
   * Drop ONE owner's rows for one integration, or one of them - THE READER'S OWN COLLECTION.
   *
   * The seam `action-executor.ts` calls when a run has just proved, through the one production
   * resolution, that this caller can no longer reach the integration or the action. Both tenancy
   * terms are exact-match query terms AND required by `OwnerEvidenceScope`, so this cannot be
   * pointed at anybody else's rows: there is no org-wide arm and no all-owners arm on it at all.
   * Answers how many rows went.
   */
  async discardOwnerEvidence(scope: OwnerEvidenceScope): Promise<number> {
    if (scope.orgId === '' || scope.ownerUserId === '' || scope.integrationKey === '') return 0;
    if (scope.actionName !== undefined && scope.actionName === '') return 0;
    return this.store.deleteMany({
      orgId: scope.orgId,
      ownerUserId: scope.ownerUserId,
      integrationKey: scope.integrationKey,
      ...(scope.actionName !== undefined ? { actionName: scope.actionName } : {}),
    });
  }

  /**
   * Drop the samples a DISCONNECTED credential produced.
   *
   * Scoped to the config that went. `orgId` and `integrationKey` are exact-match terms in BOTH arms,
   * so nothing outside the tenant whose config was deleted is reachable; the arms differ only in
   * WHICH members of that tenant were connected THROUGH the deleted row - see
   * `DisconnectedConfigScope` for why the shared-config arm is an exclusion list and not "everyone".
   * Answers how many rows went.
   */
  async discardEvidenceForDisconnectedConfig(scope: DisconnectedConfigScope): Promise<number> {
    if (scope.orgId === '' || scope.integrationKey === '') return 0;
    if ('userId' in scope.owner && scope.owner.userId === '') return 0;
    return this.store.deleteMany({
      orgId: scope.orgId,
      integrationKey: scope.integrationKey,
      ...('userId' in scope.owner
        ? { ownerUserId: scope.owner.userId }
        // `$nin` also matches a row carrying NO `ownerUserId` at all (a hand-written or pre-owner
        // migrated one). That is the right side to err on here: such a row names an account inside
        // this org for this integration and can never be superseded, since no writer produces that
        // shape any more.
        : { ownerUserId: { $nin: [...scope.owner.everyOwnerExcept] } }),
    });
  }

  /**
   * WHO holds a row for this integration key INSIDE ONE ORG, and WHICH action it names.
   *
   * ORG-SCOPED, AND THAT IS THE ROUND-FOUR CORRECTION RATHER THAN AN OPTIMISATION. Its predecessor
   * (`listOwnerRefsForKey`) took a key alone and answered across every tenant, because the write-time
   * reconciler it fed believed it could decide a foreign org's rows. It could not - the answer
   * depends on the reader's credential and on a frozen snapshot the writer never sees - and a
   * cross-tenant LISTING is precisely what made a cross-tenant DELETE expressible. The only caller
   * is `evidence-reconcile.ts`, which passes the WRITING org's own id.
   *
   * HELD TO IDENTIFIERS BY THE PROJECTION RATHER THAN BY A PROMISE: three short strings per row, no
   * sample, no request, no response body, no run id. The projection is also the SIZE bound - see
   * `Store.find`'s note - because rows are hundreds of KB and grow as owners x actions.
   */
  async listOwnerRefsInOrg(orgId: string, integrationKey: string): Promise<ActionEvidenceOwnerRef[]> {
    if (orgId === '' || integrationKey === '') return [];
    const rows = await this.store.find(
      { orgId, integrationKey },
      { ownerUserId: 1, actionName: 1 },
      { projection: { orgId: 1, ownerUserId: 1, actionName: 1 } },
    );
    return rows
      // The post-filter is the same belt-and-braces `listForIntegration` keeps and is recorded as
      // such: the exact-match query cannot return another org's row, so this masks it. It is here so
      // a later change to the query shape cannot silently be the removal of the only tenancy term.
      .filter((row) => row.orgId === orgId)
      .map((row) => ({
        orgId: row.orgId ?? '',
        ownerUserId: row.ownerUserId ?? '',
        actionName: row.actionName ?? '',
      }));
  }

  /**
   * THE RETENTION SWEEP - every row not re-validated inside the window goes, orphan or not.
   *
   * THIS IS WHAT MAKES "FAIL TOWARDS RETAINING" AN ACCEPTABLE POSTURE. Everywhere else in this
   * module a doubt keeps the row, because deleting somebody's only copy is unrecoverable while
   * keeping it is a bounded gap - and this method is what bounds it. A row whose action stopped
   * resolving for a reader who never runs it again is collected by nothing else; here it ages out,
   * releasing its screenshot pin with it.
   *
   * CROSS-TENANT BY NECESSITY AND NOT A TENANCY HOLE, for the reason `pinnedRunIdsForRetention` is
   * not one: retention belongs to no tenant, this runs on a boot job that has no actor and cannot be
   * reached by a request, and it returns a COUNT - it never reads, projects or hands back a row.
   *
   * ONE `deleteMany` AND NO MATERIALISATION: `validatedAt` is an ISO-8601 stamp, which orders
   * lexicographically, so the cutoff is a plain string comparison in the query rather than a scan of
   * documents that hold hundreds of KB each.
   */
  async sweepExpiredEvidence(opts: { now: number; retentionDays?: number }): Promise<number> {
    const days = opts.retentionDays ?? EVIDENCE_RETENTION_DAYS;
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(opts.now - days * 24 * 60 * 60 * 1000).toISOString();
    return this.store.deleteMany({ validatedAt: { $lt: cutoff } });
  }

  /**
   * THE RETENTION PINS - every run id any tenant's live evidence points at.
   *
   * CROSS-TENANT BY NECESSITY, AND NOT A TENANCY HOLE. `sweepExpiredScreenshots` walks a FILESYSTEM
   * tree that has no org in it (`<root>/<automationId>/<runId>`), on a boot job that belongs to no
   * tenant. Asking "which runs must this sweep spare" cannot be scoped to an org, because the sweep
   * is not scoped to an org.
   *
   * What crosses the boundary is therefore held to identifiers ONLY: a set of run id strings, with
   * no org, no action, no integration key and no sample attached. A caller learns that some run is
   * pinned, never whose it is or what it did. The one production caller is the boot sweeper
   * (`server.ts`), which does not have an actor and cannot be reached by a request.
   *
   * ── THE READ IS BOUNDED, WHICH IS A DIFFERENT CLAIM FROM "THE PIN COUNT IS BOUNDED" ──────────
   *
   * The paragraph above bounds the ANSWER: one pin per live row, released on every supersede. It
   * says nothing about the READ, and the first cut's `find({})` walked whole documents - rows that
   * hold a capped request plus a capped response sample (hundreds of KB) and accumulate as
   * orgs x owners x integrations x actions with no TTL. At 10k rows that is a multi-gigabyte
   * materialisation to build a set of short strings, AT BOOT. The `.catch` on the one caller cannot
   * degrade it either: an OOM abort is not a rejection, so the real failure mode was a boot crash
   * loop rather than the documented "degrades to pin nothing".
   *
   * So the query names the only two fields this needs, and pre-filters to the only `kind` that can
   * contribute one. WHICH OF THE TWO `kind` TESTS IS LOAD-BEARING IS RECORDED RATHER THAN IMPLIED,
   * because they are not the pair they look like: the QUERY term is the one that narrows (dropping
   * it reddens the bounded-read case, measured), while the loop's `ev.kind === 'automation'` is a
   * TYPE DISCRIMINATION - deleting it does not compile, and casting it away instead SURVIVES,
   * because an api-call row carries no `runId` for the loop to read. It is kept for the reason
   * `listForIntegration` keeps its redundant pair: a later change to the query shape must not
   * silently be the removal of the only rule there is.
   */
  async pinnedRunIdsForRetention(): Promise<Set<string>> {
    const rows = await this.store.find(
      { 'evidence.kind': 'automation' },
      undefined,
      { projection: { 'evidence.kind': 1, 'evidence.runId': 1 } },
    );
    const pins = new Set<string>();
    for (const row of rows) {
      const ev = row.evidence;
      if (ev && ev.kind === 'automation' && typeof ev.runId === 'string' && ev.runId !== '') pins.add(ev.runId);
    }
    return pins;
  }
}

function isTenantScoped(key: ActionEvidenceKey): boolean {
  return key.orgId !== '' && key.ownerUserId !== '' && key.integrationKey !== '' && key.actionName !== '';
}

function assertKey(key: ActionEvidenceKey): void {
  if (!isTenantScoped(key)) {
    throw new ActionEvidenceStoreError('INVALID', 'evidence must name an org, an owner, an integration and an action');
  }
}

/** Bound what was offered. Callers already cap what they build; this is the module's own ceiling,
 *  so a caller that forgets cannot grow the document past what the collection promises. */
function capEvidence(evidence: ActionEvidence): ActionEvidence {
  if (evidence.kind === 'api-call') {
    const body = capText(evidence.response.body);
    // THE REQUEST BODY'S FLAG IS KEPT, not discarded. The first cut called `capText` on it and threw
    // the `truncated` half away, so an oversized request body was cut SILENTLY - and cut in the one
    // place it is least visible, because the executor's own `truncateForDisplay` appends a
    // "… [truncated, N more bytes]" marker at the END, which this cap then slices off.
    const requestBody = capText(evidence.request.body);
    return {
      kind: 'api-call',
      request: {
        method: evidence.request.method,
        url: evidence.request.url,
        headers: evidence.request.headers,
        ...(requestBody.text !== undefined ? { body: requestBody.text } : {}),
        ...(requestBody.truncated || evidence.request.truncated ? { truncated: true } : {}),
      },
      response: {
        status: evidence.response.status,
        ...(body.text !== undefined ? { body: body.text } : {}),
        ...(evidence.response.bodyIsJson !== undefined ? { bodyIsJson: evidence.response.bodyIsJson } : {}),
        ...(body.truncated || evidence.response.truncated ? { truncated: true } : {}),
      },
    };
  }
  const steps = evidence.steps.slice(0, MAX_EVIDENCE_STEPS).map((step) => {
    const excerpt = capText(step.excerpt);
    return {
      ...step,
      ...(excerpt.text !== undefined ? { excerpt: excerpt.text } : {}),
      ...(excerpt.truncated || step.truncated ? { truncated: true } : {}),
    };
  });
  return {
    kind: 'automation',
    runId: evidence.runId,
    ...(evidence.status !== undefined ? { status: evidence.status } : {}),
    steps,
    ...(evidence.steps.length > MAX_EVIDENCE_STEPS || evidence.truncated ? { truncated: true } : {}),
  };
}

function capText(raw: string | undefined): { text?: string; truncated: boolean } {
  if (raw === undefined) return { truncated: false };
  if (raw.length <= MAX_EVIDENCE_EXCERPT_CHARS) return { text: raw, truncated: false };
  return { text: raw.slice(0, MAX_EVIDENCE_EXCERPT_CHARS), truncated: true };
}

/** Prove no registered value survives anywhere in the document. Cheap (one serialisation of an
 *  already-bounded document) and it is what makes the redaction claim testable rather than believed. */
function assertNoLiveSecret(doc: ActionEvidenceDoc, secrets?: SecretRegistry): void {
  if (!secrets) return;
  const serialised = JSON.stringify(doc);
  if (secrets.redact(serialised) !== serialised) {
    throw new ActionEvidenceStoreError('UNSAFE', 'action evidence still contained a live credential value after redaction');
  }
}

/** Build the registry the last gate checks against, from the values a run actually resolved. Here
 *  so a caller holding a `string[]` of secret values does not have to import the redaction module
 *  to get the guarantee. */
export function evidenceSecretsFromValues(values: Iterable<unknown>): SecretRegistry {
  return secretRegistryFromValues(values);
}

/** The process-wide store over the real `integration_action_evidence` collection. */
export const actionEvidenceStore = new ActionEvidenceStore();

/**
 * THE CREDENTIAL-DISCONNECTION ERASURE - the samples a credential produced go when the credential
 * does.
 *
 * ITS OWN FUNCTION BECAUSE IT ANSWERS A DIFFERENT QUESTION FROM EVERY OTHER REMOVAL HERE. The
 * others ask "can this reader still REACH the action", and a disconnected credential does not change
 * that answer: the definition still resolves. What changed is that the third-party account whose
 * request and response the sample holds is no longer connected, and the person who connected it has
 * just asked for it to go.
 *
 * BEST EFFORT AND LOUD: `deleteConfig` has already removed the credential by the time this runs, and
 * an undeletable config would be a worse failure than a reported leftover.
 */
export async function discardEvidenceOfDisconnectedConfig(
  scope: DisconnectedConfigScope,
  deps: { discardEvidenceForDisconnectedConfig?: (scope: DisconnectedConfigScope) => Promise<number> } = {},
): Promise<number> {
  const discard = deps.discardEvidenceForDisconnectedConfig
    ?? ((s: DisconnectedConfigScope) => actionEvidenceStore.discardEvidenceForDisconnectedConfig(s));
  try {
    return await discard(scope);
  } catch (err) {
    console.warn(
      `[integrations] the evidence of '${scope.integrationKey}' in org ${scope.orgId} outlived the `
        + `credential that produced it: ${messageOf(err)}`,
    );
    return 0;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
