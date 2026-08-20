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
 * The ONE cross-tenant reader is `pinnedRunIdsForRetention`, and it is not a tenancy hole: see its
 * own docblock. It is reachable from the boot sweeper alone and returns run IDENTIFIERS ONLY.
 *
 * ── THE REMOVAL PATHS, ENUMERATED FROM THE CODE ───────────────────────────────────────────────
 *
 * `recipe-lifecycle.ts` states the invariant this collection inherits: NOTHING DURABLE OUTLIVES THE
 * THING IT IS EVIDENCE FOR. An evidence row is durable, has no TTL, and PINS its run's screenshots
 * out of the 7-day sweep for as long as it lives, so a row whose action no longer exists converts a
 * bounded retention into an unbounded one.
 *
 * An earlier revision of `discardEvidence` claimed two removal paths ("the action itself is gone (a
 * definition write that dropped it), and … the erasure path") and HAD NEITHER - it had no production
 * caller at all. Counted from the code this time rather than from what the author had in mind:
 * `git grep` for the writers of the definition document finds `IntegrationDefinitionStore.create`
 * and `IntegrationRecipeStore` and nothing else; the recipe store only ever `map`s the existing
 * `actions` array (it rewrites one element's `recipe` field), so it can never drop an action. There
 * is exactly ONE path, and no definition-delete path exists at all:
 *
 *   1. THE ACTION SET REWRITTEN - `IntegrationDefinitionStore.create(..., onConflict: 'replace')`,
 *      the ordinary builder save (`definition-save.ts`) and `achieve`'s in-place write
 *      (`integration-achieve.ts`, twice). An action the incoming set no longer names - removed or
 *      renamed, an ordinary edit and exactly what an agent re-authoring an integration does - is
 *      gone. Collector: `discardEvidenceOfRemovedActions` below, called there, beside the sibling
 *      collection's `discardEvidenceOfRemovedRecipes` on the same line of the same branch.
 *
 * THE COLLECTOR IS PER-ACTION AND CROSSES OWNERS, and that asymmetry with the key is deliberate: an
 * action is a property of the DEFINITION, so when it is dropped it is dropped for every member of
 * the org at once, and every owner's row for it must go. It is scoped to the one org that wrote.
 *
 * NOT A REMOVAL PATH, and named so the next reader does not have to re-derive it: retiring a legacy
 * row (`setVisibility` global -> org) hides a definition without dropping any action, and `DELETE
 * /api/v1/integrations/:key` deletes a CONFIG (a credential), not a definition. There is no
 * subject-erasure path over this collection, exactly as there is none over the screenshot tree
 * (`screenshot-plane.ts`); that is recorded as a gap in docs/findings.md, not implied to be closed.
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
 * Names ONE ACTION of one org, across every owner - the REMOVAL key.
 *
 * Deliberately a different type from `ActionEvidenceKey` rather than that type with an optional
 * `ownerUserId`: an optional term is one a caller can forget, and forgetting it here would silently
 * turn "drop every owner's row for a deleted action" into "drop nobody's".
 */
export interface ActionEvidenceActionKey {
  orgId: string;
  integrationKey: string;
  actionName: string;
}

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
   * Drop ONE owner's evidence for one action. The narrow discard - a superseding write already
   * replaces a row in place, so this exists for the case where a specific owner's sample must go
   * and the action itself survives.
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
   * Drop EVERY owner's evidence for one action of one org - the removal-path discard.
   *
   * CROSSES OWNERS ON PURPOSE, AND IS STILL ORG-SCOPED. An action belongs to the DEFINITION, so a
   * write that drops it drops it for every member of the org at once; leaving one peer's row behind
   * would leave a durable sample - and its screenshot pin - naming an action that no longer exists.
   * `orgId` remains an exact-match term of the query, so no other tenant's row is reachable from
   * here however the action is named. Answers how many rows went.
   */
  async discardEvidenceForAction(key: ActionEvidenceActionKey): Promise<number> {
    if (key.orgId === '' || key.integrationKey === '' || key.actionName === '') return 0;
    return this.store.deleteMany({
      orgId: key.orgId,
      integrationKey: key.integrationKey,
      actionName: key.actionName,
    });
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
   */
  async pinnedRunIdsForRetention(): Promise<Set<string>> {
    const rows = await this.store.find({});
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
 * THE PAIRING - the ONE implementation of "an action that has been REMOVED takes its evidence with
 * it", reached by the one removal path there is (enumerated in the module header).
 *
 * WHY A FREE FUNCTION AND NOT JUST THE STORE METHOD. Exactly the argument
 * `discardEvidenceOfRemovedRecipes` makes one file over, and it is the reason that function is
 * shaped this way too: the removal happens inside `definition-store.ts`, which only the WRITER can
 * see (it alone knows which actions the incoming set stopped naming), and the failure posture of
 * the pairing must be stated ONCE rather than re-decided at each call site. It is also what makes
 * the collector injectable, so a caller's suite can prove the pairing without a store.
 *
 * BEST EFFORT AND LOUD, per action. The removal is the operation and it has already happened by the
 * time this runs; a throw here must not undo it or be reported as a failed save. A leaked sample is
 * untidy - a save that reported failure after actually rewriting the definition is worse. One
 * action that throws does not abandon the rest of the batch.
 */
export async function discardEvidenceOfRemovedActions(
  scope: { orgId: string; integrationKey: string },
  removedActionNames: readonly string[],
  deps: { discardEvidenceForAction?: (key: ActionEvidenceActionKey) => Promise<number> } = {},
): Promise<number> {
  const discard = deps.discardEvidenceForAction
    ?? ((key: ActionEvidenceActionKey) => actionEvidenceStore.discardEvidenceForAction(key));
  let discarded = 0;
  for (const actionName of removedActionNames) {
    if (actionName === '') continue;
    try {
      discarded += await discard({ orgId: scope.orgId, integrationKey: scope.integrationKey, actionName });
    } catch (err) {
      console.warn(
        `[integrations] the evidence of ${scope.integrationKey}/${actionName} outlived the action it `
          + `was evidence for: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return discarded;
}
