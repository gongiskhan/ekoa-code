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
 * ── TENANCY (Capability Contract rule 5) ──────────────────────────────────────────────────────
 *
 * `orgId` is the first term of the deterministic `_id`, is stored on the row, is a term of every
 * query filter, and is re-checked on every fetched document. Suite:
 * `api/tests/security/action-evidence-isolation.test.ts`.
 *
 * The ONE cross-tenant reader is `pinnedRunIdsForRetention`, and it is not a tenancy hole: see its
 * own docblock. It is reachable from the boot sweeper alone and returns run IDENTIFIERS ONLY.
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

/** Names one action's evidence. Every read and write states it in full - there is no ambient
 *  "current tenant" in this module. */
export interface ActionEvidenceKey {
  orgId: string;
  integrationKey: string;
  actionName: string;
}

/** The api-call sample: the executor's own redacted request summary plus a capped response body. */
export interface ApiCallEvidence {
  kind: 'api-call';
  request: { method: string; url: string; headers: Record<string, string>; body?: string };
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
  title?: string;
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
    .update(JSON.stringify([key.orgId, key.integrationKey, key.actionName]))
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

  /** The one live evidence row for one action, or null. */
  async getEvidence(key: ActionEvidenceKey): Promise<ActionEvidenceDoc | null> {
    if (!isTenantScoped(key)) return null;
    const doc = await this.store.get(actionEvidenceIdFor(key));
    // The id already binds the row to the tenant; this re-check covers a document whose stored
    // `orgId` disagrees with the id it lives under (hand-written or migrated), and it fails closed.
    return doc && doc.orgId === key.orgId ? doc : null;
  }

  /**
   * Every evidence row one tenant holds for one integration - the detail page's read.
   *
   * THE POST-FILTER IS REDUNDANT BY CONSTRUCTION, and is recorded as such rather than left to look
   * load-bearing. An exact-match query on `orgId` cannot return a document whose stored `orgId`
   * differs, so the two terms enforce the same predicate on the same field and each MASKS the other
   * under mutation: removing either alone leaves the isolation suite green, and only removing BOTH
   * turns it red (measured, three cases). It is kept because `CapturedCallsStore.listCapture` keeps
   * its own for the same belt-and-braces reason, and because a later change to the query shape
   * (a projection, an `$in`, a re-sort) would otherwise silently remove the only tenancy term.
   *
   * CONTRAST `getEvidence`, WHERE THE RE-CHECK IS NOT REDUNDANT: that lookup is by deterministic
   * `_id` and never consults the stored `orgId` at all, so a hand-written or migrated row whose
   * stored org disagrees with the id it lives under WOULD be returned without it. That mutant dies.
   */
  async listForIntegration(orgId: string, integrationKey: string): Promise<ActionEvidenceDoc[]> {
    if (orgId === '' || integrationKey === '') return [];
    const rows = await this.store.find({ orgId, integrationKey }, { actionName: 1 });
    return rows.filter((row) => row.orgId === orgId);
  }

  /**
   * Drop one action's evidence. Reached when the action itself is gone (a definition write that
   * dropped it), and by the erasure path.
   */
  async discardEvidence(key: ActionEvidenceKey): Promise<boolean> {
    if (!isTenantScoped(key)) return false;
    const doc = await this.getEvidence(key);
    if (!doc) return false;
    return this.store.delete(doc._id);
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
  return key.orgId !== '' && key.integrationKey !== '' && key.actionName !== '';
}

function assertKey(key: ActionEvidenceKey): void {
  if (!isTenantScoped(key)) {
    throw new ActionEvidenceStoreError('INVALID', 'evidence must name an org, an integration and an action');
  }
}

/** Bound what was offered. Callers already cap what they build; this is the module's own ceiling,
 *  so a caller that forgets cannot grow the document past what the collection promises. */
function capEvidence(evidence: ActionEvidence): ActionEvidence {
  if (evidence.kind === 'api-call') {
    const body = capText(evidence.response.body);
    return {
      kind: 'api-call',
      request: {
        ...evidence.request,
        ...(evidence.request.body !== undefined ? { body: capText(evidence.request.body).text } : {}),
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
