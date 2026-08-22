/**
 * AUTOMATIONS -> INTEGRATIONS, CLASSIFIED AND NOT TOUCHED (slice S7, decision D3).
 *
 * ── WHAT THIS MODULE IS ───────────────────────────────────────────────────────────────────────
 *
 * A boot-time and on-demand pass that walks stored automations and says, for each one, what it
 * would become if the automation surface were replaced by integration actions - and what a person
 * would lose in the exchange. It is the REPORT half of a migration whose write half does not exist.
 *
 * ── WHAT IT DOES NOT DO, AND WHY THAT IS THE POINT ────────────────────────────────────────────
 *
 * IT WRITES NOTHING. No action is minted, no definition row is touched, no automation is renumbered
 * and nothing is deleted. Automation ids are LIVE REFERENCES: a trigger names one, a schedule names
 * one, every run record in history names one. So the migration that eventually acts on this
 * classification mints WRAPPER actions pointing at the rows that already exist (`automationBinding`,
 * whose mechanism, tenancy, write gate and consent story are already end-to-end - the citius package
 * is the live proof), and it does that through the BUILDER SAVE PATH, never through `achieve`: the
 * authored-action api-call-only guardrail is not widened by this slice or by the one that follows.
 *
 * MCP IS OUT. The backing union stubs it (`integrations/definitions.ts`) and no automation
 * classifies onto it here; an MCP backing is its own later slice, not a tier of this one.
 *
 * ── THE THREE TIERS ───────────────────────────────────────────────────────────────────────────
 *
 *   1. FLATTEN  - exactly one `api_call` step that fits, whole, inside `IntegrationActionHttpConfig`.
 *                 The automation row stops being needed by the action; it is still not deleted.
 *   2. WRAP     - everything else. The action's backing is a binding onto the automation as it is.
 *   3. ENGINE-INTERNAL - not a third disposition but the CONTENTS of the wrappers: sub-automation
 *                 graphs, cofre/declaration references, off-cloud targets, attended steps and the
 *                 rehearsal/vision loop keep running inside the engine, hidden behind tier 2's
 *                 action. Reported per automation so the wrapper cannot read as lossless.
 *
 * ── DEGRADATIONS ARE PART OF THE ANSWER ───────────────────────────────────────────────────────
 *
 * A report that returns only a tier is a migration plan with its costs deleted, so the two known
 * losses are first-class fields rather than prose in a document:
 *
 *   - THE ACTION RAIL NARROWS. An action is reached through the integration definition row for its
 *     key, and a row a builder save creates is `visibility: 'private'` (`integrations/
 *     definition-save.ts`), visible to its author alone. An automation that is org-visible today
 *     therefore narrows to one person unless someone shares the destination row.
 *   - MID-RUN PAUSES COLLAPSE. Action execution is synchronous. An automation that pauses for a
 *     human (a CAPTCHA or MFA caught by the fast-path detector, or the rehearsal fixer's
 *     `pause_for_user` patch - both in `engine.ts`'s `pauseRunForUser`) answers the action caller
 *     `automation_failed` carrying the run id. The lifecycle survives on the RUN, which the
 *     integration detail page renders; the action's own answer is a failure code. WHICH AUTOMATIONS
 *     CAN PAUSE is the engine's question, not this module's guess at it: see
 *     `FIXER_REACHABLE_STEPS`, and the review-round note there about the browser-only reading that
 *     was wrong.
 *   - A CONTESTED DESTINATION. Two owners' automations resolving to one destination key cannot both
 *     land on it: a definition row is one per (org, key) with one author.
 *
 * ── HOW IT BEHAVES AT BOOT ────────────────────────────────────────────────────────────────────
 *
 * NEVER FAILS BOOT, on `legacy-runtime-import.ts`'s contract: a row the classifier cannot read
 * lands in `errors` instead of throwing, and the composition root wraps the whole call besides.
 * BOUNDED AT THE READ, which is the only place boundedness means anything: the query carries the
 * projection AND a `limit` of `cap + 1`, so the database decides which rows come back and the
 * process never holds more than the cap plus one. The first cut fetched everything and sliced in
 * JS, which is the unbounded-`find` hazard `data/store.ts` documents with the slice as decoration
 * (review round F12/F19). The boot log carries COUNTS AND NO NAMES; the per-automation detail is
 * reachable only through the per-caller endpoint, under that caller's own tenancy.
 *
 * NO ENV FLAG, deliberately, and this is a documented deviation from D3's "env-flag opt-in" wording
 * (docs/decisions.md, 2026-08-22). The flag in the legacy-runtime-import shape gates PERSISTENCE.
 * This pass has no persisting mode to gate, so a flag here would gate a log line and would be
 * furniture by the time the write arrives - which Rule 10 names as the thing not to build. The flag
 * lands with the write it protects.
 */

import { createHash } from 'node:crypto';
import type {
  AutomationMigrationDegradation,
  AutomationMigrationEngineInternal,
  AutomationMigrationEntry,
  AutomationMigrationFlattenRefusal,
  AutomationMigrationReportResponse,
} from '@ekoa/shared';
import { automations } from '../data/stores.js';
import { reservedIntegrationKeys } from '../integrations/definitions.js';
import { resolveStepDeclaration, type ApiCallSpec, type Automation, type Step } from './types.js';

/**
 * The stored shape: the domain type plus the two fields that live only on the document (see
 * `automation/service.ts`, which declares the same pair for the same reason).
 */
type StoredAutomation = Automation & { orgId: string; visibility?: 'private' | 'org' };

/**
 * How many rows one pass classifies, newest first. A cap rather than a stream because the answer is
 * a REPORT: an operator reading "1000 of them, 940 wrap" acts on it exactly as they would on the
 * whole estate, and an unbounded read of a collection whose rows carry full step arrays is the
 * failure mode `data/store.ts` warns about.
 */
export const MIGRATION_SCAN_CAP = 1000;

/**
 * Only what the classifier reads. `steps` is the bulk of an automation row and is unavoidable - it
 * IS the thing being classified - so everything else is trimmed to keep one pass's working set
 * proportional to the steps alone.
 */
const SCAN_PROJECTION = {
  _id: 1,
  // A row carries the id twice (`automations.insert({ _id: id, ...doc })`); both are projected so
  // the normalisation below is a safety net rather than the only thing that works.
  id: 1,
  name: 1,
  orgId: 1,
  ownerUserId: 1,
  visibility: 1,
  source: 1,
  trigger: 1,
  steps: 1,
} as const;

/**
 * The methods a self-contained api-call action can express. `IntegrationActionHttpConfig.method` is
 * a NARROWER union than the automation step's `ApiCallMethod` - HEAD and OPTIONS have no action
 * spelling - and that difference is a refusal rather than a silent rewrite.
 */
const ACTION_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * The budget a flattened action would actually run under: `action-executor.ts`'s own default, which
 * no per-action config can currently override. A step declaring exactly this is representable; a
 * step declaring anything else is not (review round F16).
 */
const ACTION_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Header names whose VALUE is a credential. The rule and its three names are the automation
 * planner's own (`planner.ts`, check 1e: an api_call step may reference credentials as
 * `{{integration.<key>.<field>}}` and may never carry a literal). Restated here rather than imported
 * because importing it would pull the model-facing planner - and everything it imports - into a
 * module that runs at boot; the comment is the tie, and `migration-report.test.ts` pins the list.
 */
const AUTH_SHAPED_HEADERS = new Set(['authorization', 'x-api-key', 'x-auth-token']);

/**
 * STEP TYPES THE ENGINE'S FIXER WILL ACT ON, restated from `engine.ts`'s `shouldAttemptFix`. This is
 * the set that decides whether a mid-run PAUSE is reachable, and getting it wrong is what review
 * round F15 caught: the first cut keyed the pause degradation on `browser` steps alone, on a reading
 * that `pauseRunForUser`'s two callers were "both on the browser rail". They are not. Both callers
 * are gated on `shouldAttemptFix` and nothing narrower, so a `[navigate, verify]` automation with no
 * browser step pauses today while the report said it could not - a false negative in exactly the
 * direction this report exists to prevent.
 *
 * Restated rather than imported because `engine.ts` is the run loop and this module runs at boot;
 * the comment is the tie and `migration-report.test.ts` pins the set against the real counterexample.
 */
const FIXER_REACHABLE_STEPS = new Set(['browser', 'verify', 'navigate', 'local_command', 'api_call', 'ekoa_action']);

/** `{{integration.<key>.<field>}}` - the credential hole. Captures the integration key. */
const INTEGRATION_HOLE = /\{\{\s*integration\.([^.}\s]+)\.[^}]*\}\}/g;
/** `{{capture.<name>}}` - a value an EARLIER step produced. */
const CAPTURE_HOLE = /\{\{\s*capture\.[^}]*\}\}/;

/** Scope of one pass. Both fields absent = the whole estate, which is what boot asks for. */
export interface MigrationScanScope {
  /** Restrict to one tenant. */
  orgId?: string;
  /**
   * Apply the automation service's own `private` predicate for this reader. Absent = no visibility
   * filter, which is only ever correct for the estate-wide boot pass whose output is counts.
   */
  readerUserId?: string;
}

/** Injected clock, on the house pattern (`legacy-runtime-import.ts`): live default, testable seam. */
export interface MigrationScanDeps {
  now?: () => Date;
  /**
   * The scan cap, injectable for the same reason the clock is. Review round F24: the truncation
   * branch had no test that could fail because reaching it meant seeding a thousand rows, so the
   * only "capped" case hand-built a report object and asserted the log FORMAT of a state production
   * could no longer produce. A seam makes the mechanism itself drivable.
   */
  cap?: number;
}

/**
 * Everything the classifier can say about one automation, as strings the wire schema also names.
 * Exported so the unit suite can drive the pure classification without a store.
 */
export function classifyAutomation(
  doc: StoredAutomation,
  /**
   * The keys a builder save may NOT claim (`reservedIntegrationKeys()`). Passed IN rather than read
   * here so the classifier stays pure and unit-testable: resolving it touches the definition
   * registry, which is the walker's job once per pass, not this function's once per row.
   */
  reservedKeys: ReadonlySet<string> = new Set<string>(),
): AutomationMigrationEntry {
  const steps = Array.isArray(doc.steps) ? doc.steps : [];
  const visibility = doc.visibility === 'private' ? 'private' : 'org';
  const flattenRefusals = refusalsForFlatten(steps);
  const tier = flattenRefusals.length === 0 ? 'flatten' : 'wrap';
  const engineInternal = engineInternalFeatures(steps, doc.trigger);
  const destination = destinationKey(doc, steps);

  const degradations: AutomationMigrationDegradation[] = [];
  // THE NARROWING IS A PROPERTY OF THE DESTINATION ROW, NOT OF THE AUTOMATION, and review round F10
  // caught the first cut asserting exactly that in a comment while reading only `doc.visibility`.
  //
  // The class that made it wrong is the one provisioning mass-mints: an integration-provisioned
  // automation is `org`-visible with `source.integrationKey` naming a SHIPPED package, and a shipped
  // key is reserved - `definition-save.ts` refuses it outright - so such an automation cannot land
  // on a fresh private builder row at all. Its wrapper action already exists on the shipped
  // definition, org-wide. Reporting every one of them as narrowing inflated the degradation census
  // an operator acts on to essentially all org-visible rows.
  //
  // So the question is asked of the DESTINATION: an org-visible automation narrows only when its
  // action would land on a row a builder save could actually create.
  if (visibility === 'org' && destinationNarrows(destination, reservedKeys)) {
    degradations.push('org-visible-narrows-to-owner');
  }
  // A PAUSE IS REACHABLE WHEREVER THE FIXER IS, which is the engine's own rule and not a property of
  // browser steps (review round F15). A `sub_automation` step is included even though the fixer
  // refuses it directly: the engine recurses into the child under the same browser lease, so the
  // child's own fixable steps pause the parent, and this classifier cannot see inside the child.
  // Conservative in the honest direction - it reports a cost that may not materialise, rather than
  // hiding one that will.
  //
  // GATED ON `wrap` BY CONSTRUCTION, not by a claim about pausing: the collapse being described is
  // what a WRAPPER does to a pause. A flattened automation can reach the fixer today (an `api_call`
  // step is fixable), but a flattened action does not run the engine at all, so there is no mid-run
  // pause for synchronous action semantics to collapse - what it loses is the fixer, which is a
  // different loss and is named in the decisions entry rather than mislabelled as this one.
  if (tier === 'wrap' && pauseIsReachable(steps)) degradations.push('mid-run-pause-collapses');
  if (doc.trigger !== undefined && doc.trigger.kind !== 'manual') degradations.push('trigger-not-carried');

  return {
    automationId: doc.id,
    name: doc.name,
    ownerUserId: doc.ownerUserId,
    visibility,
    stepCount: steps.length,
    tier,
    shapeHash: shapeHash(doc, steps),
    flattenRefusals,
    engineInternal,
    degradations,
    ...(destination !== undefined ? { destinationIntegrationKey: destination } : {}),
    ...(doc.source !== undefined ? { source: doc.source } : {}),
  };
}

/**
 * CAN THE ENGINE PAUSE THIS AUTOMATION MID-RUN? The engine's own answer, not a proxy for it: both
 * `pauseRunForUser` callers are gated on `shouldAttemptFix` and nothing narrower, so any step type
 * the fixer will act on makes a pause reachable. `sub_automation` counts because the engine recurses
 * into the child under the same lease and this pass cannot see the child's steps.
 *
 * Exported so the suite can pin the SET against the engine rather than only its consequences.
 */
export function pauseIsReachable(steps: Step[]): boolean {
  return steps.some((s) => FIXER_REACHABLE_STEPS.has(s.type) || s.type === 'sub_automation');
}

/**
 * WOULD A MINTED ACTION LAND ON A ROW THAT NARROWS? Only if a builder save could create that row.
 *
 * A destination naming a RESERVED key (every shipped baseline package, plus the pipedream connect
 * row) cannot be a fresh private row: `definition-save.ts` refuses reserved keys outright, and the
 * wrapper actions for those packages already exist on the shipped definition, visible org-wide. An
 * UNRESOLVED destination is treated as narrowing because the honest default for "nobody has decided
 * yet" is the cost, not the absence of it.
 */
function destinationNarrows(destination: string | undefined, reservedKeys: ReadonlySet<string>): boolean {
  return destination === undefined || !reservedKeys.has(destination);
}

/**
 * WHY THIS AUTOMATION CANNOT BECOME ONE REQUEST. Every member of the returned list names a property
 * of the action's http config that the step does not fit into; an empty list is the flatten verdict.
 * All refusals are collected rather than short-circuited, because an operator planning the work
 * needs the full reason, not the first one.
 */
function refusalsForFlatten(steps: Step[]): AutomationMigrationFlattenRefusal[] {
  const refusals: AutomationMigrationFlattenRefusal[] = [];
  if (steps.length !== 1) refusals.push('not-single-step');
  const step = steps[0];
  if (!step || step.type !== 'api_call' || step.apiRequest === undefined) {
    refusals.push('step-not-api-call');
    return refusals;
  }
  const req = step.apiRequest;

  if (!ACTION_METHODS.has(req.method)) refusals.push('method-unrepresentable');
  if (!originIsLiteral(req.url)) refusals.push('origin-not-literal');
  if (!bodyIsSubstitutableObject(req)) refusals.push('body-not-json-object');

  // THE BUDGET IS PART OF THE SHAPE (review round F16). `ApiCallSpec.timeoutMs` is honoured by the
  // step executor up to five minutes; `IntegrationActionHttpConfig` has no timeout field at all and
  // the action executor's own default is 30s. A step that declares anything else would run under a
  // DIFFERENT budget after flattening, silently - a two-minute call against a slow endpoint that
  // works today and times out tomorrow - so it refuses rather than flattening optimistically. A
  // step that declares nothing already agrees with the action default and is not refused.
  if (req.timeoutMs !== undefined && req.timeoutMs !== ACTION_DEFAULT_TIMEOUT_MS) {
    refusals.push('timeout-unrepresentable');
  }

  // AND SO IS THE DECLARATION (review round F16). `engineInternalFeatures` already reads these very
  // fields and calls them "what stays engine-internal behind a wrapper" - so a FLATTEN verdict
  // carrying them was self-contradictory: a flattened action has no wrapper to keep them in.
  if (declarationIsEngineInternal(step)) refusals.push('step-declaration-unrepresentable');

  const templated = [req.url, req.body ?? '', ...Object.entries(req.headers ?? {}).flat()].join('\n');
  if (CAPTURE_HOLE.test(templated)) refusals.push('capture-holes');

  // ONE DESTINATION OR NONE. The action's http config has no credential vocabulary of its own: its
  // `{{...}}` holes are filled from the integration's OWN resolved config plus the caller's args, so
  // a step drawing credentials from two integrations has no single key to land under.
  if (credentialKeys(req).size > 1) refusals.push('multiple-credential-sources');

  for (const [name, value] of Object.entries(req.headers ?? {})) {
    // READ THE HOLE THE WAY THE ENGINE READS IT (review round F20). The first cut tested for the
    // literal substring `{{integration.`, while `INTEGRATION_HOLE` two lines up - and
    // `template-vars.ts`, which is what actually interpolates the value - both tolerate whitespace
    // inside the braces. So `{{ integration.alpha.token }}` was counted as a credential SOURCE by
    // one reader and reported as a LITERAL credential by the other, on the same header, in the same
    // entry. Both readers now go through the same regex, so the module cannot contradict itself
    // about a value it is making a COFRE H-6 statement on.
    if (AUTH_SHAPED_HEADERS.has(name.toLowerCase()) && !hasIntegrationHole(value)) {
      // The header NAME is the actionable part and the value is, by definition, a credential. It is
      // never read into the report (COFRE H-6, the same reason the planner reports a category).
      refusals.push('literal-auth-header');
      break;
    }
  }

  return refusals;
}

/** Does this value carry a credential hole, read exactly as the engine's interpolator reads one? */
function hasIntegrationHole(value: string): boolean {
  // A fresh RegExp per call: INTEGRATION_HOLE is `g`-flagged and `.test` on a shared global regex
  // carries `lastIndex` between calls, which would make this answer depend on call order.
  return new RegExp(INTEGRATION_HOLE.source).test(value);
}

/**
 * Does this step's declaration name anything the action shape has no vocabulary for? Read through
 * `resolveStepDeclaration`, the ONE place declaration defaults are filled, so this cannot drift from
 * `engineInternalFeatures`, which asks the same question for the wrapper case.
 */
function declarationIsEngineInternal(step: Step): boolean {
  const declaration = resolveStepDeclaration(step);
  return (
    declaration.credentialRefs.length > 0 || declaration.target.kind !== 'cloud' || declaration.attended
  );
}

/** Scheme, host and port must be literal: an action's `baseUrl` is not a place to discover a host. */
function originIsLiteral(url: string): boolean {
  if (!/^https?:\/\/[^/?#{}\s]+([/?#]|$)/i.test(url)) return false;
  try {
    // Holes may legitimately appear in the PATH and QUERY, where they become action args. Parse with
    // them neutralised so a template is judged on its shape rather than on its unfilled state.
    new URL(url.replace(/\{\{[^}]*\}\}/g, 'x'));
    return true;
  } catch {
    return false;
  }
}

/**
 * A body survives flattening only as `bodyTemplate`, an OBJECT whose leaves are substituted. A text
 * or form body has no such spelling, and a JSON body with a hole in VALUE position (`{"n": {{x}}}`)
 * is not parseable as the object the action would carry.
 */
function bodyIsSubstitutableObject(req: ApiCallSpec): boolean {
  const kind = req.bodyKind ?? (req.body !== undefined && req.body !== '' ? 'json' : 'none');
  if (kind === 'none' || req.body === undefined || req.body === '') return true;
  if (kind !== 'json') return false;
  try {
    const parsed: unknown = JSON.parse(req.body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** Every integration key named by a credential hole, plus the step's declared auth integration. */
function credentialKeys(req: ApiCallSpec): Set<string> {
  const keys = new Set<string>();
  if (req.authIntegrationKey !== undefined && req.authIntegrationKey !== '') keys.add(req.authIntegrationKey);
  const haystack = [req.url, req.body ?? '', ...Object.entries(req.headers ?? {}).flat()].join('\n');
  for (const match of haystack.matchAll(INTEGRATION_HOLE)) {
    const key = match[1];
    if (key !== undefined && key !== '') keys.add(key);
  }
  return keys;
}

/**
 * WHAT THE WRAPPER WOULD HIDE. Read through `resolveStepDeclaration`, which is the ONE place a
 * step's declaration defaults are filled - re-deriving them here would be a second reading of the
 * same field, and the two would drift.
 */
function engineInternalFeatures(steps: Step[], trigger: Automation['trigger']): AutomationMigrationEngineInternal[] {
  const found = new Set<AutomationMigrationEngineInternal>();
  for (const step of steps) {
    if (step.type === 'sub_automation') found.add('sub-automation');
    if (step.type === 'browser' || step.type === 'verify') found.add('rehearsal-vision');
    if (Object.keys(step.commandTemplate?.envRefs ?? {}).length > 0) found.add('command-env-refs');
    const declaration = resolveStepDeclaration(step);
    if (declaration.credentialRefs.length > 0) found.add('credential-refs');
    if (declaration.target.kind !== 'cloud') found.add('off-cloud-target');
    if (declaration.attended) found.add('attended-step');
  }
  if (trigger !== undefined && trigger.kind !== 'manual') found.add('self-firing-trigger');
  return [...found];
}

/**
 * WHERE THE MIGRATED ACTION WOULD LAND, when the data already says. Provenance first: an automation
 * provisioned from an integration template belongs to that integration by construction, and that is
 * true whatever its steps do. Otherwise the single integration its credential holes name. Absent
 * means the destination is an unmade decision - never that migration is impossible.
 */
function destinationKey(doc: StoredAutomation, steps: Step[]): string | undefined {
  if (doc.source?.integrationKey !== undefined && doc.source.integrationKey !== '') return doc.source.integrationKey;
  const step = steps[0];
  if (steps.length !== 1 || !step || step.type !== 'api_call' || step.apiRequest === undefined) return undefined;
  const keys = credentialKeys(step.apiRequest);
  return keys.size === 1 ? [...keys][0] : undefined;
}

/**
 * A fingerprint of exactly what was classified. Two reports taken at different times are diffable on
 * it: a moved hash means the automation was edited since the earlier classification and its tier may
 * no longer be the one an operator read. Deliberately NOT the whole document - `updatedAt` moves for
 * a rename, which changes nothing about the migration.
 */
function shapeHash(doc: StoredAutomation, steps: Step[]): string {
  return createHash('sha256')
    .update(JSON.stringify([doc.id, doc.trigger?.kind ?? 'manual', doc.visibility ?? 'org', steps]))
    .digest('hex');
}

/**
 * Walk, classify, and answer. The ONLY read is the projected `find` below; nothing on this path
 * writes, and a row that throws is contained per-row rather than lost with the pass.
 */
export async function buildMigrationReport(
  scope: MigrationScanScope = {},
  deps: MigrationScanDeps = {},
): Promise<AutomationMigrationReportResponse> {
  const now = deps.now ?? (() => new Date());
  const cap = deps.cap ?? MIGRATION_SCAN_CAP;
  const report: AutomationMigrationReportResponse = {
    mode: 'report-only',
    generatedAt: now().toISOString(),
    scanned: 0,
    truncated: false,
    tiers: { flatten: 0, wrap: 0, engineInternalBehindWrappers: 0 },
    entries: [],
    errors: [],
  };

  let rows: StoredAutomation[];
  try {
    // THE READ IS BOUNDED, not just the loop over it (review round F12/F19). The first cut fetched
    // the whole collection and sliced in JS, which bounds nothing: by the time the slice runs, every
    // row's full `steps` array is already in the process, and `data/store.ts` documents that failure
    // as an OOM abort no catch can contain. `cap + 1` is what distinguishes "exactly at the cap"
    // from "more than the cap" without reading a second page.
    rows = (await automations.find(
      scope.orgId !== undefined ? { orgId: scope.orgId } : {},
      { updatedAt: -1 },
      { projection: { ...SCAN_PROJECTION }, limit: cap + 1 },
    )) as unknown as StoredAutomation[];
  } catch (err) {
    // The scan itself failing is reported, not thrown: boot continues and the endpoint answers an
    // honest empty report with the reason on it rather than a 500 with a stack.
    report.errors.push({ automationId: '<scan>', error: err instanceof Error ? err.message : String(err) });
    return report;
  }

  // TRUNCATION IS A FACT ABOUT THE READ, and it is read off the row count the database returned
  // rather than off the visible set: the cap bounds what was FETCHED, so that is what it reports.
  report.truncated = rows.length > cap;
  const fetched = rows.slice(0, cap);

  // The visibility filter is the automation service's rule applied in memory, exactly as
  // `listAutomations` applies it, and for the same reason: expressing it as a query clause would let
  // the two read paths drift apart.
  const visible =
    scope.readerUserId === undefined
      ? fetched
      : fetched.filter((doc) => doc.visibility !== 'private' || doc.ownerUserId === scope.readerUserId);

  // ONE registry read per pass, never per row: `classifyAutomation` stays pure and the definition
  // registry is touched once. A registry that cannot be read is not fatal - the destination question
  // then answers "narrows", which is the conservative direction.
  let reservedKeys: ReadonlySet<string> = new Set<string>();
  try {
    reservedKeys = reservedIntegrationKeys();
  } catch (err) {
    report.errors.push({ automationId: '<reserved-keys>', error: err instanceof Error ? err.message : String(err) });
  }

  for (const doc of visible) {
    // The store hands back `_id`; the domain type calls it `id`. Normalised here so one classifier
    // serves both the document and a hand-built fixture.
    const raw = doc as unknown as { id?: string; _id?: string };
    const normalised: StoredAutomation = { ...doc, id: raw.id ?? raw._id ?? '' };
    try {
      const entry = classifyAutomation(normalised, reservedKeys);
      report.entries.push(entry);
      report.scanned += 1;
      if (entry.tier === 'flatten') report.tiers.flatten += 1;
      else {
        report.tiers.wrap += 1;
        if (entry.engineInternal.length > 0) report.tiers.engineInternalBehindWrappers += 1;
      }
    } catch (err) {
      report.errors.push({
        automationId: normalised.id === '' ? '<unidentified>' : normalised.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  markContestedDestinations(report.entries);
  return report;
}

/**
 * A DESTINATION TWO DIFFERENT OWNERS WOULD BOTH LAND ON (review round F10, divergence b). A
 * definition row is one per (org, key) with a single author, so when two owners' automations resolve
 * to the same key the second arrival does not narrow "to its owner" - it forks a key, or lands on a
 * row private to the OTHER author.
 *
 * Marked as the FACT this scan can see (the destinations collide) rather than as a prediction about
 * which of those two outcomes a write half nobody has written would choose. Only entries that were
 * already flagged as narrowing can be contested: a destination that cannot narrow at all - a shipped
 * package, whose actions are org-wide - is not contested by two owners arriving at it.
 */
function markContestedDestinations(entries: AutomationMigrationEntry[]): void {
  const ownersByKey = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.destinationIntegrationKey === undefined) continue;
    if (!entry.degradations.includes('org-visible-narrows-to-owner')) continue;
    const owners = ownersByKey.get(entry.destinationIntegrationKey) ?? new Set<string>();
    owners.add(entry.ownerUserId);
    ownersByKey.set(entry.destinationIntegrationKey, owners);
  }
  for (const entry of entries) {
    const key = entry.destinationIntegrationKey;
    if (key === undefined) continue;
    if ((ownersByKey.get(key)?.size ?? 0) > 1) entry.degradations.push('destination-key-contested');
  }
}

/**
 * The boot obligation: one estate-wide pass, COUNTS ONLY. Names never reach the log - an operator
 * needs the size and shape of the work, and the per-automation detail belongs behind the endpoint
 * where the caller's own tenancy answers for it.
 */
export function migrationBootSummary(report: AutomationMigrationReportResponse): string {
  return (
    `[automation-migration] mode ${report.mode}: scanned ${report.scanned}` +
    `${report.truncated ? ' (capped)' : ''}, ` +
    `flatten ${report.tiers.flatten}, wrap ${report.tiers.wrap}, ` +
    `engine-internal behind wrappers ${report.tiers.engineInternalBehindWrappers}, errors ${report.errors.length}`
  );
}
