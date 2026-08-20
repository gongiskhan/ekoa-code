/**
 * integrations/captured-calls-store.ts - the RAW evidence a discovery pass captured (slice P2.0).
 *
 * ── WHY THIS IS A SEPARATE COLLECTION, AND WHY THAT IS NOT A CONTRADICTION ───────────────────
 *
 * `definition-store.ts` deliberately REJECTED a separate collection for publish snapshots: "the
 * snapshot has no lifecycle independent of its definition (it is written, superseded and deleted
 * with it), and a second document is a second thing that can be missing". Captured calls are the
 * other case on every axis, so they earn what snapshots did not:
 *
 *   - THEY HAVE THEIR OWN LIFECYCLE: capture -> learn -> compile -> DISCARD THE RAW. The distilled
 *     recipe outlives them, and `discardCapture` is a normal end of life, not a deletion of the
 *     definition;
 *   - THEY ARE UNBOUNDED: one discovery pass on a real portal is hundreds of requests with bodies.
 *     Embedded, they would grow the definition document toward the 16MB Mongo limit (Trap T2), be
 *     re-serialised on EVERY compare-and-swap of that document, and be re-walked by `redactSecrets`
 *     on every read of it - three costs paid by every reader of a definition that has nothing to do
 *     with a capture;
 *   - THEY ARE APPEND-ONLY: one document per call, claimed by a deterministic `_id` over
 *     (orgId, integrationKey, actionName, captureId, seq). No CAS contention between concurrent
 *     appends, and a retried append is refused by the duplicate key rather than duplicating a call.
 *
 * Do NOT "simplify" this back onto the definition document. The compiled recipe belongs there
 * (bounded, per-action, same lifecycle - `recipe-store.ts`); the evidence does not.
 *
 * ── WHAT MAY BE STORED ───────────────────────────────────────────────────────────────────────
 *
 * Header NAMES and redacted bodies. Never header values: `CapturedCallInput` has no field for them,
 * so the caller's header maps cannot reach this module at all (`automation/recipe.ts`'s
 * `headerNamesOf` is where a live map's keys are taken and its values dropped). URLs and bodies pass
 * the value-keyed registry AND the name-pattern leg (`security/redaction.ts`'s `redactStream`), and
 * an append whose redacted result still contains a live value is REFUSED - the belt-and-braces that
 * turns "we redacted it" into "we proved it".
 *
 * TENANCY (Capability Contract rule 5): `orgId` is part of the deterministic `_id`, is stored on the
 * row, is a term of every query filter, and is re-checked on every fetched document. A capture is
 * one tenant's session evidence; nothing here is cross-org at any visibility.
 */
import { createHash } from 'node:crypto';
import { Store, type Doc } from '../data/store.js';
import { integrationCapturedCalls } from '../data/stores.js';
import { redactStream, redactUrlByName, type SecretRegistry } from '../security/redaction.js';

/** Same grammar `automation/recipe.ts` brands and `recipe-store.ts` re-proves. A "name" that is not
 *  a name is the shape of the leak all three exist to prevent. */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

/** Per-body cap. A capture is evidence, not an archive: an 8MB HTML dump teaches nothing a
 *  truncated one does not, and one document must stay comfortably clear of the 16MB limit even
 *  though the append pattern already keeps calls in separate documents. */
export const MAX_CAPTURED_BODY_CHARS = 64 * 1024;

/** Names the capture belongs to. Every read and write states it in full - there is no ambient
 *  "current tenant" in this module. */
export interface CaptureKey {
  orgId: string;
  integrationKey: string;
  actionName: string;
  /** One discovery pass. The recipe's `capturedCallsRef` points at exactly this. */
  captureId: string;
}

/**
 * One captured exchange, as the caller offers it. Note what is NOT here: header values, cookies,
 * `storageState`, or any credential the run resolved. The type is the first line of the defence -
 * a caller with a header map cannot express it in this shape.
 */
export interface CapturedCallInput {
  method: string;
  /** Absolute URL as observed. Query values are name-redacted on the way in. */
  url: string;
  requestHeaderNames: readonly string[];
  responseHeaderNames?: readonly string[];
  status?: number;
  requestBody?: string;
  responseBody?: string;
  contentType?: string;
  /** Playwright's resource type (`xhr`, `fetch`, `document`…) - how the learner tells an internal
   *  API call from a page load without re-deriving it from the URL. */
  resourceType?: string;
  durationMs?: number;
}

/** One captured exchange as stored: redacted, truncated, and bounded. */
export interface CapturedCall {
  method: string;
  url: string;
  requestHeaderNames: string[];
  responseHeaderNames: string[];
  status?: number;
  requestBody?: string;
  responseBody?: string;
  contentType?: string;
  resourceType?: string;
  durationMs?: number;
  /** True when a body hit `MAX_CAPTURED_BODY_CHARS`. Recorded, never silent: a learner reading a
   *  truncated body must know it is looking at a prefix. */
  truncated?: boolean;
}

export interface CapturedCallDoc extends Doc, CaptureKey {
  /** Position within the capture. Deterministic, so an append is idempotent under retry. */
  seq: number;
  capturedAt: string;
  /** The automation run that captured it - provenance for the audit trail, never an authority. */
  runId?: string;
  call: CapturedCall;
}

export type CapturedCallsErrorCode = 'UNSAFE' | 'INVALID';

export class CapturedCallsStoreError extends Error {
  constructor(public readonly code: CapturedCallsErrorCode, message: string) {
    super(message);
    this.name = 'CapturedCallsStoreError';
  }
}

/**
 * The deterministic `_id`, JSON-encoded so the encoding is injective for any strings (the argument
 * `definitionIdFor` and `runDedupeId` both make). `orgId` is the FIRST term: two tenants capturing
 * the same action of the same integration never collide, and no id can be derived without naming a
 * tenant.
 */
export function capturedCallIdFor(key: CaptureKey, seq: number): string {
  return createHash('sha256')
    .update(JSON.stringify([key.orgId, key.integrationKey, key.actionName, key.captureId, seq]))
    .digest('hex');
}

export class CapturedCallsStore {
  private readonly store: Store<CapturedCallDoc>;

  constructor(
    store: Store<Doc> = integrationCapturedCalls,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = store as unknown as Store<CapturedCallDoc>;
  }

  /**
   * Append one captured call. Insert-as-claim on the deterministic `_id`: a retry of the same
   * (capture, seq) is REFUSED rather than duplicated, which is the house uniqueness primitive
   * (§4.3.2 - no unique indexes anywhere).
   *
   * `secrets` is the run's registry. It is optional only because a capture can legitimately happen
   * on a run that resolved no credentials; when it is present, a body that still contains a live
   * value after redaction fails the append.
   */
  async appendCapturedCall(
    key: CaptureKey,
    seq: number,
    input: CapturedCallInput,
    opts: { secrets?: SecretRegistry; runId?: string } = {},
  ): Promise<{ verdict: 'ok'; doc: CapturedCallDoc } | { verdict: 'duplicate' }> {
    assertKey(key);
    if (!Number.isInteger(seq) || seq < 0) {
      throw new CapturedCallsStoreError('INVALID', 'a capture sequence number must be a non-negative integer');
    }
    const call = redactCapturedCall(input, opts.secrets);
    const doc: CapturedCallDoc = {
      _id: capturedCallIdFor(key, seq),
      orgId: key.orgId,
      integrationKey: key.integrationKey,
      actionName: key.actionName,
      captureId: key.captureId,
      seq,
      capturedAt: this.now().toISOString(),
      ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
      call,
    };
    // THE LAST GATE, over the WHOLE document rather than the fields the redaction pass knew about:
    // if any live value survives anywhere - including in a field a later slice adds and forgets to
    // filter - the evidence is not written at all.
    assertNoLiveSecret(doc, opts.secrets);
    return (await this.store.insert(doc)) ? { verdict: 'ok', doc } : { verdict: 'duplicate' };
  }

  /** One captured call by position. */
  async getCapturedCall(key: CaptureKey, seq: number): Promise<CapturedCallDoc | null> {
    if (!isTenantScoped(key)) return null;
    const doc = await this.store.get(capturedCallIdFor(key, seq));
    // The id already binds the document to the tenant; this re-check covers a row whose stored
    // `orgId` disagrees with the id it lives under (a hand-written or migrated document), and it
    // fails closed.
    return doc && doc.orgId === key.orgId ? doc : null;
  }

  /** Every call of one capture, in capture order. */
  async listCapture(key: CaptureKey): Promise<CapturedCallDoc[]> {
    if (!isTenantScoped(key)) return [];
    const rows = await this.store.find(
      {
        orgId: key.orgId,
        integrationKey: key.integrationKey,
        actionName: key.actionName,
        captureId: key.captureId,
      },
      { seq: 1 },
    );
    return rows.filter((row) => row.orgId === key.orgId);
  }

  /** The capture ids held for one action, newest first - the discard/compile surface. */
  async listCaptureIds(orgId: string, integrationKey: string, actionName: string): Promise<string[]> {
    if (orgId === '' || integrationKey === '' || actionName === '') return [];
    const rows = await this.store.find({ orgId, integrationKey, actionName }, { capturedAt: -1 });
    const seen = new Set<string>();
    for (const row of rows) if (row.orgId === orgId) seen.add(row.captureId);
    return [...seen];
  }

  /**
   * DISCARD THE RAW - the end of the capture lifecycle, and the reason this data has a collection of
   * its own. Returns how many calls were dropped.
   */
  async discardCapture(key: CaptureKey): Promise<number> {
    if (!isTenantScoped(key)) return 0;
    return this.store.deleteMany({
      orgId: key.orgId,
      integrationKey: key.integrationKey,
      actionName: key.actionName,
      captureId: key.captureId,
    });
  }
}

/** A recipe as a REMOVAL path sees it once it is gone: which action it belonged to, and the pile it
 *  named. Deliberately structural - `IntegrationActionRecipe` lives in the definitions tree, and a
 *  collector that imported it would drag the file-based registry into every caller. */
export interface RemovedRecipe {
  actionName: string;
  capturedCallsRef?: string;
}

/**
 * THE PAIRING - the ONE implementation of "a recipe that has been REMOVED takes its evidence with
 * it", reached by every removal path there is (`integrations/recipe-lifecycle.ts` enumerates them).
 *
 * WHY IT LIVES HERE AND NOT IN `recipe-lifecycle.ts`. Two of the four removal paths remove the
 * recipe by CLEARING it (that module's own job); the other two remove it as a side effect of a write
 * that rewrote the action set, and only the writer knows what it dropped. So the pairing has to be
 * callable from `definition-store.ts` - which stands deliberately on the database alone and must not
 * gain a runtime edge to the file-based registry (`recipe-store.ts` -> `definitions.ts`). This
 * module has no such edge, and the operation IS the end of the evidence lifecycle this module owns.
 *
 * BEST EFFORT AND LOUD, per recipe. The removal is the operation and it has already happened by the
 * time this runs; a throw here must not undo it or be reported as a failed removal. A leaked capture
 * is untidy, and a removal that reported failure after actually removing something is worse.
 */
export async function discardEvidenceOfRemovedRecipes(
  scope: { orgId: string; integrationKey: string },
  removed: readonly RemovedRecipe[],
  deps: { discardCapture?: (key: CaptureKey) => Promise<number> } = {},
): Promise<number> {
  const discardCapture = deps.discardCapture ?? ((key: CaptureKey) => capturedCallsStore.discardCapture(key));
  let discarded = 0;
  for (const recipe of removed) {
    // A recipe compiled before `capturedCallsRef` existed names no pile. Deleting on that would be
    // a delete nothing asked for.
    if (recipe.capturedCallsRef === undefined || recipe.capturedCallsRef === '') continue;
    try {
      discarded += await discardCapture({
        orgId: scope.orgId,
        integrationKey: scope.integrationKey,
        actionName: recipe.actionName,
        captureId: recipe.capturedCallsRef,
      });
    } catch (err) {
      console.warn(
        `[integrations] the evidence ${recipe.capturedCallsRef} of ${scope.integrationKey}/${recipe.actionName} `
          + `outlived the recipe that named it: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return discarded;
}

function isTenantScoped(key: CaptureKey): boolean {
  return key.orgId !== '' && key.integrationKey !== '' && key.actionName !== '' && key.captureId !== '';
}

function assertKey(key: CaptureKey): void {
  if (!isTenantScoped(key)) {
    throw new CapturedCallsStoreError('INVALID', 'a capture must name an org, an integration, an action and a capture id');
  }
}

/** Redact and bound one exchange. Header NAMES are validated (a value parked in the names array is
 *  refused, not stored); everything else that can carry text is passed through both redaction legs. */
function redactCapturedCall(input: CapturedCallInput, secrets?: SecretRegistry): CapturedCall {
  const names = (list: readonly string[] | undefined, field: string): string[] =>
    (list ?? []).map((name, i) => {
      if (typeof name !== 'string' || !HEADER_NAME_RE.test(name)) {
        throw new CapturedCallsStoreError(
          'UNSAFE',
          `${field}[${i}] is not an HTTP header name (length ${String(name).length}) - a capture stores header NAMES, never values`,
        );
      }
      return name.toLowerCase();
    });

  let truncated = false;
  const body = (raw: string | undefined): string | undefined => {
    if (raw === undefined) return undefined;
    const redacted = redactStream(raw, secrets);
    if (redacted.length <= MAX_CAPTURED_BODY_CHARS) return redacted;
    truncated = true;
    return redacted.slice(0, MAX_CAPTURED_BODY_CHARS);
  };

  const requestBody = body(input.requestBody);
  const responseBody = body(input.responseBody);
  return {
    method: input.method,
    // BOTH legs on the URL: the registry substitutes values the run actually holds, and the
    // name-pattern leg masks a conventionally-named query parameter whose value it never held.
    url: redactUrlByName(secrets ? secrets.redact(input.url) : input.url),
    requestHeaderNames: names(input.requestHeaderNames, 'requestHeaderNames'),
    responseHeaderNames: names(input.responseHeaderNames, 'responseHeaderNames'),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(requestBody !== undefined ? { requestBody } : {}),
    ...(responseBody !== undefined ? { responseBody } : {}),
    ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
    ...(input.resourceType !== undefined ? { resourceType: input.resourceType } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(truncated ? { truncated } : {}),
  };
}

/** Prove no registered value survives anywhere in the document. Cheap (one serialisation of an
 *  already-bounded document) and it is what makes the redaction claim testable rather than believed. */
function assertNoLiveSecret(doc: CapturedCallDoc, secrets?: SecretRegistry): void {
  if (!secrets) return;
  const serialised = JSON.stringify(doc);
  if (secrets.redact(serialised) !== serialised) {
    throw new CapturedCallsStoreError('UNSAFE', 'a captured call still contained a live credential value after redaction');
  }
}

/** The process-wide store over the real `integration_captured_calls` collection. */
export const capturedCallsStore = new CapturedCallsStore();
