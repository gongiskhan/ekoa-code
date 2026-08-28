/**
 * Integration DEFINITIONS registry (ch03 §3.8.13 — the read surface).
 *
 * Loads the VERSIONED integration packages shipped under `api/assets/integrations/<key>/`
 * into an in-memory cache and projects them for two read endpoints:
 *   - the definition list (GET /api/v1/integrations)         -> full action shapes
 *   - the active catalog  (GET /api/v1/integrations/active)  -> action + event catalogs
 *
 * Each package dir carries `config.json` (the definition: key, displayName, actions with
 * httpConfig/automationBinding/passCredentials/mutates, webhookConfig, listenerConfig,
 * authType, configSchema) alongside SKILL.md / history.json which the registry ignores.
 *
 * Ported (read-only subset) from cortex/src/services/integration-storage.ts.
 *
 * THE DISK RUNTIME TIER IS RETIRED (slice A3). Builder saves land in the tenant-scoped Mongo
 * store (`definition-save.ts`, private-by-default); the legacy on-disk runtime packages
 * (`<dataDir>/integrations/runtime/<key>/`) are imported ONCE at boot as `visibility:'global'`,
 * `origin:'legacy-runtime'` rows (`legacy-runtime-import.ts` — RUN_SPEC 20260801 assumption 3,
 * Rule-10 review 2026-08-15 in docs/decisions.md) and the directory is FROZEN: nothing writes it,
 * and NO read below folds it into the cache any more. That merged cache was one process-wide
 * directory any authenticated user of any org could write, which made every reader of it a
 * cross-tenant leak (A2 review F1); every function here is now BASELINE-ONLY by construction —
 * the merged-vs-baseline split (`getBaselineDefinition` et al.) is kept as API so the registry's
 * fallback contract stays explicit, but the two views now hold the same shipped set.
 *
 * These are PACKAGE definitions, not org configs — they hold no credential VALUES. A
 * defensive redaction pass (redactSecrets) still runs over every projection so a
 * credential-named field can never leave the registry, belt-and-braces.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIPEDREAM_INTEGRATION_KEY } from './service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================
// Package (config.json) shapes — the on-disk definition contract
// ============================================

export interface IntegrationConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'url' | 'select' | 'password' | 'textarea';
  required: boolean;
  /** Marks the field as a credential input; the definition still carries no VALUE for it. */
  secret: boolean;
  helpText?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface IntegrationActionHttpConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  baseUrl: string;
  path: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  bodyTemplate?: Record<string, unknown>;
}

export interface IntegrationActionAutomationBinding {
  automationId: string;
  argMap?: Record<string, string>;
  passCredentials?: boolean;
  automationTemplate?: string;
}

/**
 * A `tenant-read` action's backing: the NAME OF THE DATASET it reads (slice S9).
 *
 * ── WHY THIS IS A BACKING AND NOT A TRANSPORT ─────────────────────────────────────────────────
 *
 * `transport` answers "which wire protocol does this request need". A tenant read makes no request:
 * it answers out of rows THIS platform already landed for THIS tenant, through a rail that did the
 * contacting earlier and under its own verification. There is no wire to name, so naming one would
 * be a lie of the same class as the `http://127.0.0.1:0` placeholder the transport gate exists to
 * refuse. What it does have is a different answer to "how does this action run", which is exactly
 * what `resolveBackingType` is for.
 *
 * ── WHAT IT BUYS, STATED AS THE PROPERTY THE EXECUTOR ENFORCES ────────────────────────────────
 *
 * A tenant-read action NEVER CAUSES A CREDENTIAL TO BE DECRYPTED. The executor dispatches it above
 * `decryptCredentialFields`, so the whole credential half of the rail - the decrypt, the shadow
 * comparator, the provider resolver, the egress binding - is not merely unused but unreached. That
 * is the honest shape for an action whose answer costs no third-party access, and it is pinned by
 * `api/tests/integrations/action-backing-type.test.ts` rather than left as a claim.
 *
 * It is still a FULL citizen of the rail above that line: the write gate answers first (a mutating
 * tenant-read action would be gated exactly like any other), and a disconnected or disabled
 * integration still refuses. Reading a tenant's own rows is not a reason to skip a gate; it is a
 * reason not to spend a secret.
 *
 * ── THE DATASET NAME IS A SERVER-SIDE KEY, NEVER A QUERY ──────────────────────────────────────
 *
 * `dataset` names one of a CLOSED set of readers the composition root binds (`ExecutorDeps
 * .readTenantDataset`). It is not a collection name, not a path and not a filter: a package that
 * names a dataset the deployment does not bind is refused with `unknown_dataset`, and nothing about
 * the string reaches a database. The scoping is the reader's own and is never taken from the
 * package - the executor hands the reader the (orgId, ownerUserId) it already resolved, and a
 * reader that widened that would be widening it for itself.
 */
export interface IntegrationActionTenantRead {
  dataset: string;
}

/**
 * HOW an action is executed — the unified Action model's backing discriminator (decisions.md
 * 2026-08-01: "an action's backing type is one of api-call, mcp-call, bash-cli, browser-steps").
 * Only the ones this build can execute or refuse coherently are modelled here; `mcp-call` lands
 * with the slice that implements it, and adding it is additive (this union is not on the wire -
 * `shared/src/integrations.ts` publishes `backingType` as `z.string()`).
 *
 * `tenant-read` (slice S9) is the fourth, and it is the only one that contacts NOTHING: the answer
 * is read out of data this platform already holds for the asking tenant. See
 * `IntegrationActionTenantRead` for why that is a backing rather than a transport.
 *
 * NOT the same axis as `transport`, which names the WIRE PROTOCOL of an api-call action (`http`,
 * `imap`, …). An action is refused for an unimplemented transport and for an unimplemented backing
 * independently, with distinct codes.
 */
export type IntegrationActionBackingType = 'api-call' | 'bash-cli' | 'browser-steps' | 'tenant-read';

/**
 * HOW THE ORIGIN BEHIND AN ACTION TREATS AUTOMATION - the policy label, declared by the action's
 * author. `permissive` is a site that tolerates being driven (a documented API, our own tenant's
 * app, a partner portal); `adversarial` is one that fights it (bot-checks, IP reputation, device
 * fingerprinting), and is what an undeclared origin resolves to.
 *
 * The union is restated here rather than imported from `automation/origin-posture.ts` (which owns
 * the RESOLVER) because integrations/ is a lower tier than automation/ and the dependency runs one
 * way: the same structural-type discipline `schedules/supervisor.ts` uses for automation outcomes.
 * `tests/automation/origin-posture.test.ts` asserts the two unions stay identical, so the
 * duplication cannot silently drift.
 *
 * Deliberately NOT in `shared/`, for the same reason `backingType` is not: it is a server-side
 * policy label, and putting it on the wire would turn a review decision into a client-supplied one.
 */
export type IntegrationActionOriginPosture = 'permissive' | 'adversarial';

/** One deterministic guardrail an authored action was judged against (see `authored-action.ts`). */
export interface IntegrationActionAuthoringCheck {
  name: string;
  ok: boolean;
  /** Why it failed. Never carries a credential value: the checks are about SHAPE, not content. */
  detail?: string;
}

/** The verdict of the whole guardrail suite, frozen onto the action at authoring time. */
export interface IntegrationActionAuthoringVerification {
  verifiedAt: string;
  passed: boolean;
  checks: IntegrationActionAuthoringCheck[];
}

/**
 * PROVENANCE OF A PLATFORM-AUTHORED ACTION (slice D3 — `achieve`).
 *
 * An action carrying this record was written by the platform (`integration-achieve.ts`), not by a
 * human at design time. That distinction is load-bearing rather than decorative:
 *
 *   - `state: 'provisional'` — the action is persisted with `mutates: true` WHATEVER the draft
 *     declared, so it meets C2's write gate on EVERY rail (capability route, automation step,
 *     listener tick, agent tool) before it can run once. `achieve` additionally never
 *     auto-executes a provisional action, so the platform can never author-and-run in one call.
 *   - `state: 'trusted'` — a human who may WRITE the definition promoted it (`POST
 *     …/actions/:actionName/trust`, `auth: 'user'`), echoing the shape they were shown. Promotion
 *     is what lets `declaredMutates` take effect, so a trusted READ auto-runs again (criterion 6).
 *
 * `shape` is the `actionShape` fingerprint of the executable content that was verified. It is the
 * record's INTEGRITY tie: `isTrustedAction` demotes a `trusted` record whose shape no longer
 * matches the action's current bytes, so re-authoring an action drops it back to provisional
 * without anybody remembering to reset a flag.
 *
 * An action with NO record is trusted by construction: shipped packages and human builder saves
 * behave exactly as they did before this slice (Rule 7, additive).
 *
 * WHY THREE OF THESE FIELDS ARE OPTIONAL (slice S6). The record rides into the PUBLISHED SNAPSHOT
 * with the action it belongs to, and a snapshot is read by every other organisation, permanently.
 * `publishableAuthoringOf` (publish-scrub.ts) therefore omits the three that identify a person or
 * carry their prose - `authoredBy`, `trustedBy`, `goal` - while keeping the whole trust semantics.
 * The optionality is that omission expressed in the type; the writer (`authored-action.ts`) always
 * fills them, and NOTHING reads them: `authoringStateOf`, `isTrustedAction` and `promoteToTrusted`
 * read only `state`, `shape`, `declaredMutates` and `verification`. Dropping `state` instead would
 * have been the dangerous shortcut - an ABSENT record means "a human wrote it", so scrubbing the
 * record wholesale would silently promote every provisional action to trusted for every consuming
 * org.
 */
export interface IntegrationActionAuthoring {
  state: 'provisional' | 'trusted';
  /** The user whose `achieve` call produced it (server-stamped from the verified actor).
   *  ABSENT on a published snapshot: a cross-org reader has no business learning who, in another
   *  tenant, typed a goal. Nothing reads it. */
  authoredBy?: string;
  authoredAt: string;
  /** The goal it was authored to satisfy - scrubbed free text, capped. Provenance, never input.
   *  ABSENT on a published snapshot: it is the author's own prose, and it is the ONE free-text field
   *  on the artifact the chokepoint model pass never sees (`FREE_TEXT_PATHS` does not name it), so
   *  the floor alone would be the whole of its protection. */
  goal?: string;
  /** What the draft claimed about mutation. Only a promotion lets this take effect. */
  declaredMutates: boolean;
  /** `actionShape(integrationKey, action)` at authoring time — the integrity tie (see above). */
  shape: string;
  verification: IntegrationActionAuthoringVerification;
  /** The human who promoted it. ABSENT on a published snapshot, same reason as `authoredBy`. */
  trustedBy?: string;
  trustedAt?: string;
}

/**
 * ONE REPLAYABLE INTERNAL CALL of a compiled recipe, AS STORED (slice P2.0).
 *
 * THE LOAD-BEARING PROPERTY IS `headerNames`. Discovery learns WHICH header carries the session
 * token - that name IS the learning, and it is worth keeping. The token itself is worth nothing to
 * a later run (it has expired) and is a durable credential disclosure if written down, so a
 * captured header VALUE never enters this shape: there is no field it could occupy. The engine-side
 * type (`automation/recipe.ts`) additionally makes the names a BRANDED type whose only constructor
 * reads the keys of a header map, so a value cannot be smuggled in as a name by a typo either, and
 * `recipe-store.ts` re-proves both at the persistence boundary.
 *
 * `method`/`locator`/`action` are widened to `string`/`unknown` HERE and narrowed back by
 * `automation/recipe.ts` (whose `InjectedCall`/`ScriptedStep` EXTEND these interfaces, so the two
 * cannot drift). The widening is the tier rule, not laziness: `integrations/` is tier 3 and
 * `automation/` is tier 5 (docs/architecture.md), so this file may not import the engine's
 * `ApiCallMethod`/`Locator`/`PlaywrightAction` unions - the same reason `schedules/supervisor.ts`
 * types its automation outcomes structurally.
 */
export interface IntegrationActionInjectedCall {
  /** The engine's `ApiCallMethod` (`GET` | `POST` | …), widened - see the interface note. */
  method: string;
  /** origin+path with `{{input.*}}` holes. Holds REFERENCES, never a resolved value. */
  urlTemplate: string;
  /** NAMES ONLY: which headers to forward from the live session. NEVER their values. */
  headerNames: string[];
  /** A json/text body template, `{{…}}`-holed on the same terms as `urlTemplate`. */
  bodyTemplate?: string;
  /** A descriptor of the expected JSON response, for the run-level goal-verify (P2.1). */
  expectShape?: unknown;
  /** GET/HEAD/OPTIONS. Gates unattended replay: a write replays only through the write gate. */
  idempotent: boolean;
}

/** One learned DOM interaction of a compiled recipe, for what cannot be done as a call. */
export interface IntegrationActionScriptedStep {
  /** The engine's `Locator` union, widened - see `IntegrationActionInjectedCall`. */
  locator: unknown;
  /** The engine's `PlaywrightAction['kind']`, widened. */
  action: string;
  value?: string;
}

/**
 * THE COMPILED RECIPE of one action: what a first, expensive, vision-first discovery pass LEARNED,
 * distilled to the bounded form a later run replays deterministically (slice P2.0).
 *
 * WHY IT LIVES ON THE ACTION. It is per-action knowledge with exactly the action's lifecycle (it is
 * born with the action's first successful discovery and dies with the action), and it is BOUNDED -
 * templates, locators and short lessons. The RAW captures it was distilled from are none of those
 * things, so they live in their own collection (`captured-calls-store.ts`); see the note there.
 *
 * IT IS TENANT DATA, AND IT IS NOT CALLER CONTENT. Three consequences, each enforced rather than
 * documented: it never reaches the wire (`definition-registry.definitionFromDoc` drops it from every
 * projection), it never enters a published cross-org snapshot (`publish-scrub.packageConfigFromDoc`
 * drops it), and a definition WRITE cannot author or destroy one (`IntegrationDefinitionStore.create`
 * carries the stored recipe forward and ignores any the caller supplies). The one writer is
 * `recipe-store.ts`, which also owns `version` - a monotonic counter a caller must not be able to
 * fake, since it is what the supersede lineage is read from.
 */
/**
 * REPLAY USAGE of one recipe, store-owned (cornerstone K4): the numbers that make "this
 * integration is getting faster" a visible fact instead of a silent server-side one. Written only
 * by `recipe-store.ts` (`recordReplay` on each replayed execution; `learnedRunMs` at compile time),
 * never by a caller - `RecipeDraft` excludes it exactly as it excludes `version`.
 */
export interface IntegrationActionRecipeStats {
  /** How many executions this recipe answered without running the automation. */
  replayCount: number;
  lastReplayedAt?: string;
  /** Wall-clock of the last replay - the "after" of the speed story. */
  lastReplayMs?: number;
  /** Wall-clock of the authored run this recipe was learned from - the "before". */
  learnedRunMs?: number;
  /**
   * Consecutive drift-heals with NO successful replay between them (K6): bumped by a supersede,
   * zeroed by `recordReplay`. The heal loop reads it against `HEAL_BUDGET.maxConsecutiveDriftHeals`
   * and CLEARS an unhealable recipe instead of superseding it forever.
   */
  driftStreak?: number;
}

export interface IntegrationActionRecipe {
  /** Monotonic per (orgId, integrationKey, actionName). Stamped by the store; a supersede bumps it. */
  version: number;
  /** The goal the discovery pass was driving at, in the author's words. */
  goal: string;
  injectedCalls: IntegrationActionInjectedCall[];
  scriptedSteps: IntegrationActionScriptedStep[];
  /**
   * WHICH replayed call carries THIS ACTION'S ANSWER, and how that was decided.
   *
   * A replay must be indistinguishable from the run it replaces, and the ANSWER is half of that.
   * Without this field the replay handed back the LAST call's body, where "last" is the order the
   * page's own `response` events completed in - so one ordinary extra internal call underneath the
   * flow (a notification badge polled after a search) silently changed the action's answer to that
   * call's body, reported as `success: true`. Nothing correlated the compiled calls with the answer
   * the learning run itself gave.
   *
   * So the compile correlates them and writes down what it found: `callIndex` indexes
   * `injectedCalls`, and `matchedBy` says WHY that call was chosen - today only IDENTITY with the
   * learning run's own output (`automation/service.ts extractActionRunOutput`), which is the only
   * correlation strong enough to promise the same answer. A weaker matcher, if one is ever earned,
   * is a NEW value here rather than this one quietly meaning something else.
   *
   * ABSENT means the learning run produced no structured answer at all - the shipped browser-only
   * automations are exactly that shape - so its replay answers nothing either, which is precisely
   * what the run it replaces answered.
   */
  answersWith?: { callIndex: number; matchedBy: 'run-output-identity' };
  /** Short free-text learnings: pagination shape, which header carries the session token, rate hints. */
  lessons: string[];
  /** `captureId` INTO the separate captures collection - a pointer, never the evidence itself. */
  capturedCallsRef?: string;
  compiledAt: string;
  /** One-hop lineage of the recipe this one replaced (the `publishSnapshot` shape, tenant-scoped). */
  supersedes?: { version: number; reason: string };
  /** Replay usage, store-owned (K4). Absent on rows written before it existed. */
  stats?: IntegrationActionRecipeStats;
}

export interface IntegrationAction {
  actionName: string;
  description: string;
  mutates: boolean;
  argsSchema?: Record<string, unknown>;
  returnSchema?: Record<string, unknown>;
  httpConfig?: IntegrationActionHttpConfig;
  automationBinding?: IntegrationActionAutomationBinding;
  /** Present ONLY on a `tenant-read` action (slice S9) - the dataset it answers from. */
  tenantRead?: IntegrationActionTenantRead;
  /**
   * The action's BACKING — how it runs. ABSENT ⇒ derived from the action's shape by
   * `resolveBackingType`, which reproduces today's behaviour byte for byte, so the field is
   * additive and migration-free (no shipped package declares it yet). Declare it only to state
   * something the shape cannot: a `bash-cli` action, or an api-call action that must NOT be
   * re-read as automation-backed because it also carries a binding.
   *
   * An EXPLICIT value that contradicts the shape is a package defect, never a hint to guess
   * around — see `resolveBackingType`.
   */
  backingType?: IntegrationActionBackingType;
  /**
   * WHAT the action is, as a platform-level classification — the vocabulary a consumer discovers
   * an action BY, instead of matching its name. `'email-send'` marks a sender, `'email-draft'` an
   * action that parks a provider-side draft, `'email-draft-send'` one that sends an existing draft.
   *
   * The point is the coupling it removes: without it, every served app that wants to send mail has
   * to hardcode `actionName === 'send_email'` (and a different literal per provider), so renaming
   * or adding a provider action silently breaks apps nobody is looking at. ABSENT ⇒ the action
   * carries no declared capability and is invisible to capability-based discovery, which is why
   * this is additive (Rule 7): no existing package changes behaviour by not declaring one.
   *
   * NOT an authorisation input. A capability says what an action IS, never who may run it — the
   * write gate (`platform-call.ts`) and the consent store decide that, and they never read this
   * field. An action that declares `'email-send'` and mutates is gated exactly as before.
   */
  capabilities?: string[];
  /**
   * Wire protocol the action needs. ABSENT ⇒ `'http'` (every shipped action today), so this is
   * additive and migration-free. A package may declare a protocol the executor does not implement
   * (the `imap` package declares `'imap'`); `executeUserIntegrationAction` then refuses the action
   * with the coded `unsupported_transport` failure instead of dialling a placeholder URL or
   * returning a fabricated empty result (2A-S4).
   */
  transport?: string;
  /**
   * Present ONLY on an action the platform authored (slice D3). ABSENT ⇒ the action was written by
   * a human — a shipped package, a builder save, a legacy import — and is trusted by construction,
   * so every existing package behaves exactly as before (Rule 7, additive). See
   * `IntegrationActionAuthoring` and `integrations/authored-action.ts`.
   */
  authoring?: IntegrationActionAuthoring;
  /**
   * The origin's posture toward automation. ABSENT ⇒ `adversarial`, resolved by
   * `automation/origin-posture.ts` at USE - never stored resolved, and never defaulted open. The
   * closed default is the whole point: an action nobody classified must not silently earn cloud
   * egress or an in-process browser against a site that fingerprints both.
   *
   * Additive (Rule 7): no shipped package declares one, and not declaring one is exactly today's
   * behaviour made explicit. Downgrading `permissive` → `adversarial` is automatic (discovery can
   * learn a site fights back); the upgrade is an author decision, the same shape as every other
   * closed-default-opens-on-assent guardrail in this repo.
   */
  posture?: IntegrationActionOriginPosture;
  /**
   * WHAT THE ORIGIN'S LOGIN DEMANDS. `attended: true` marks a login gated by OTP / MFA / CAPTCHA -
   * something only a human in front of a headed browser can clear, so re-establishing the session
   * is an attended ceremony and NEVER an unattended typist replay, whatever grant is live.
   *
   * Separate from `posture` because the two answer different questions: a permissive site can
   * still demand an OTP, and an adversarial one can have a plain password form. Collapsing them
   * would mean either refusing typist re-auth everywhere or attempting it where it cannot work.
   */
  authProfile?: { attended: boolean };
  /**
   * What discovery LEARNED about running this action (slice P2.0). ABSENT ⇒ the action has never
   * been discovered and runs exactly as it does today (Rule 7, additive: no shipped package, no
   * stored row and no wire shape changes by this field existing). Written ONLY by
   * `recipe-store.ts` - see `IntegrationActionRecipe` for why a definition save cannot author one.
   */
  recipe?: IntegrationActionRecipe;
}

/**
 * The action set with every compiled recipe removed - the ONE implementation of "a recipe does not
 * leave this process", used by all three boundaries that must hold it: the read projection
 * (`definition-registry.definitionFromDoc`, so no wire read carries one), the publishable content
 * (`publish-scrub.packageConfigFromDoc`, so a tenant's learning never freezes into a cross-org
 * snapshot), and the definition write seam (`definition-store.create`, so a caller cannot author
 * one). Three call sites, one rule; re-deriving it in each is exactly the drift that turns a
 * boundary into a hole.
 */
export function actionsWithoutRecipes(actions: IntegrationAction[] | undefined): IntegrationAction[] {
  return (actions ?? []).map((action) => {
    if (action.recipe === undefined) return action;
    const { recipe: _dropped, ...rest } = action;
    return rest;
  });
}

/**
 * A package declares a `backingType` its own shape cannot support. Thrown by `resolveBackingType`
 * and mapped by the executor onto the coded `invalid_backing_type` refusal — the definition module
 * stays free of the executor's error vocabulary (the executor imports this module, never the
 * reverse).
 */
export class IntegrationActionBackingTypeError extends Error {
  constructor(
    readonly actionName: string,
    readonly declaredBackingType: string,
    message: string,
  ) {
    super(message);
    this.name = 'IntegrationActionBackingTypeError';
  }
}

/**
 * The ONE resolver for "how does this action run" — every caller asks this, nobody re-derives it.
 *
 * DERIVATION (no explicit `backingType`), exactly today's executor precedence:
 *   - an `automationBinding` ⇒ `browser-steps` (a bound action delegates to the automation seam,
 *     and that binding has always won over any `httpConfig` on the same action);
 *   - else a `tenantRead` ⇒ `tenant-read` (slice S9). It sits BELOW the binding for the same reason
 *     the binding sits above `httpConfig`: the more specific shape wins, and an action carrying
 *     both is a package defect the EXPLICIT branch below names rather than a precedence to rely on.
 *     No shipped package carried a `tenantRead` before S9, so every existing action derives exactly
 *     what it derived before this clause existed;
 *   - otherwise ⇒ `api-call` (the `httpConfig` path). An action with NEITHER shape also derives
 *     `api-call`: it is unexecutable, and the api-call branch is where the executor has always
 *     refused it, with the same code and the same message as before this field existed.
 *
 * EXPLICIT: validated against the shape, never guessed around. `api-call` needs an `httpConfig`
 * to call; `browser-steps` needs the `automationBinding` naming the steps to run; `bash-cli` must
 * NOT carry an `httpConfig` (it runs a command on the user's paired machine, not an HTTP request);
 * `tenant-read` needs the `tenantRead` naming the dataset and must carry NEITHER request shape,
 * because it contacts nothing and a request config nothing will dial is the dead weight the
 * symmetry rule (C1 review F3) exists to refuse.
 * A contradiction — or a value outside the union, which an unvalidated `config.json` can carry —
 * throws `IntegrationActionBackingTypeError`.
 */
export function resolveBackingType(action: IntegrationAction): IntegrationActionBackingType {
  const declared = action.backingType;
  if (declared === undefined) {
    if (action.automationBinding) return 'browser-steps';
    return action.tenantRead ? 'tenant-read' : 'api-call';
  }

  const refuse = (why: string): never => {
    throw new IntegrationActionBackingTypeError(
      action.actionName,
      String(declared),
      `action "${action.actionName}" declares backingType "${String(declared)}" but ${why}`,
    );
  };
  if (declared === 'api-call') {
    return action.httpConfig ? 'api-call' : refuse('carries no httpConfig — an api-call action must declare the request it makes');
  }
  if (declared === 'browser-steps') {
    if (!action.automationBinding) {
      return refuse('carries no automationBinding — a browser-steps action must name the automation that runs its steps');
    }
    // The contradiction rule is applied SYMMETRICALLY (C1 review F3): bash-cli + httpConfig was
    // refused while browser-steps + httpConfig passed silently, leaving dead request config on the
    // action that nothing would ever dial. A shape the backing cannot use is a package defect
    // whichever backing declares it — say so at parse time rather than let it rot.
    return action.httpConfig
      ? refuse('also carries an httpConfig — a browser-steps action runs its steps through an automation, so the request config is dead weight')
      : 'browser-steps';
  }
  if (declared === 'bash-cli') {
    return action.httpConfig
      ? refuse('carries an httpConfig — a bash-cli action runs a command on the paired machine, never an HTTP request')
      : 'bash-cli';
  }
  if (declared === 'tenant-read') {
    if (!action.tenantRead?.dataset) {
      return refuse('carries no tenantRead.dataset - a tenant-read action must name the dataset it answers from');
    }
    if (action.httpConfig) {
      return refuse('also carries an httpConfig - a tenant-read action contacts nothing, so the request config is dead weight');
    }
    return action.automationBinding
      ? refuse('also carries an automationBinding - a tenant-read action answers from data this platform already holds, so there are no steps to run')
      : 'tenant-read';
  }
  return refuse('that is not a backing type this version implements');
}

export interface IntegrationEvent {
  name: string;
  labelPt: string;
}

export interface IntegrationWebhookConfig {
  verifySignature?: Record<string, unknown>;
  secretSource?: unknown;
  challenge?: Record<string, unknown>;
  getCallback?: Record<string, unknown>;
  dedupKey?: Record<string, unknown>;
  registration?: Record<string, unknown>;
  events?: IntegrationEvent[];
}

export interface IntegrationListenerConfig {
  pollAction: string;
  intervalMs: number;
  cursorField: string;
  eventArrayField: string;
  dedupKeyField: string;
  outOfOrder?: boolean;
  events?: IntegrationEvent[];
}

export interface IntegrationSessionConnectConfig {
  loginUrl: string;
  successUrlContains: string;
  errorUrlContains?: string;
  guidePt?: string;
}

/** The parsed `config.json` of a versioned integration package. Exported so the integration
 *  builder (agents/) types + validates its generated package against the ONE canonical shape. */
export interface IntegrationPackageConfig {
  version?: string;
  skillType?: string;
  integrationKey: string;
  displayName?: string;
  description?: string;
  authType?: string;
  provider?: string;
  category?: string;
  configSchema?: IntegrationConfigField[];
  actions?: IntegrationAction[];
  credentialGuide?: string;
  sessionConnect?: IntegrationSessionConnectConfig;
  webhookConfig?: IntegrationWebhookConfig;
  listenerConfig?: IntegrationListenerConfig;
}

// ============================================
// Projected read shapes
// ============================================

/** A definition as returned by GET /api/v1/integrations (full action shapes). */
export interface IntegrationDefinition {
  /** The stored definition's id — present ONLY for a tenant row of the reading actor's own org
   *  (E1 review F3: the sharing routes key on it, so a client must be able to learn it; a
   *  cross-org `global` row omits it, since the id is derivable from (orgId, key)). Absent on the
   *  shipped disk baseline, which has no stored row. */
  id?: string;
  /** The sharing tier — same own-org-only rule as `id`. Absent for baseline + foreign rows. */
  visibility?: 'private' | 'org' | 'global';
  key: string;
  /** Alias of `key`, kept for compatibility with callers keyed on `integrationKey`. */
  integrationKey: string;
  displayName?: string;
  description?: string;
  version?: string;
  authType?: string;
  provider?: string;
  category?: string;
  userCreated: boolean;
  configSchema: IntegrationConfigField[];
  actions: IntegrationAction[];
  credentialGuide?: string;
  sessionConnect?: IntegrationSessionConnectConfig;
  webhookConfig?: IntegrationWebhookConfig;
  listenerConfig?: IntegrationListenerConfig;
  createdAt: string;
  updatedAt: string;
}

/** An entry of GET /api/v1/integrations/active — action + webhook/listener event catalogs. */
export interface ActiveIntegrationCatalog {
  key: string;
  displayName?: string;
  actions: Array<{ actionName: string; description: string; mutates: boolean }>;
  webhookEvents: IntegrationEvent[];
  listenerEvents: IntegrationEvent[];
}

// ============================================
// Defensive secret scrub
// ============================================

/**
 * Credential-VALUE key names. Anchored so structural fields survive: `secret` (the
 * configSchema boolean flag), `secretSource`, `verifySignature`, `credentialField`,
 * `responseSecretPath` are all NOT credential values and are left intact.
 *
 * A3 (A2 review F7): broadened with the header-shaped names the original set missed —
 * `authorization`, `token`, `x-api-key`, `signature` (and `auth`/`api`-token variants). These
 * names legitimately appear as httpConfig HEADER keys whose values are `{{...}}` TEMPLATES
 * ("Authorization": "Bearer {{access_token}}" in the shipped stripe/slack/zoho packages) that
 * carry no secret and MUST survive, or the executor would send "[REDACTED]" as the header —
 * hence the template exemption in `redactSecrets` below.
 */
export const SECRET_KEY_NAMES =
  'api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|app[_-]?secret|password|passwd|credentials?|bearer[_-]?token|authorization|auth[_-]?token|api[_-]?token|token|x[_-]?api[_-]?key|signature';
const SECRET_KEY_RE = new RegExp(`^(${SECRET_KEY_NAMES})$`, 'i');

/** Does this OBJECT KEY name a credential VALUE? The one vocabulary (`SECRET_KEY_NAMES`), exported
 *  as a predicate so the strict publish-time floor (`publish-scrub.ts`) asks the same question
 *  rather than carrying a second copy of the list (Rule 1). */
export function isCredentialKeyName(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

/** An `{{interpolation}}` placeholder — the shape a template names a credential field with. */
export const PLACEHOLDER_SRC = String.raw`\{\{[^{}]+\}\}`;

/**
 * A string value under a credential-named key that is a pure INTERPOLATION TEMPLATE: it names a
 * credential field (`{{api_key}}`) rather than carrying a value.
 *
 * TIGHTENED (A3 review F4): the old rule only rejected a residue containing a 20+ char token run,
 * so a LITERAL pasted key riding beside a placeholder slid under the floor (`"Bearer
 * sk_live_9aXbZ {{unused}}"`, `"ghp_16C7e42F292c69 {{x}}"` — live-key shapes are routinely under
 * 20 chars). Now the residue outside the placeholders must consist ONLY of scheme-like words —
 * pure letters/hyphens, bounded length ("Bearer", "Zoho-oauthtoken") — plus joining punctuation.
 * ANY digit-bearing or over-long word is treated as a pasted literal and the exemption does not
 * apply, whatever its length. Every shipped package's credential-named values are pure templates
 * ("Bearer {{access_token}}") and pass unchanged — pinned by the shipped-package property test in
 * api/tests/integrations/definitions-runtime.test.ts, so a future tightening cannot silently
 * break a shipped integration.
 */
function isCredentialTemplate(v: unknown): boolean {
  if (typeof v !== 'string' || !new RegExp(PLACEHOLDER_SRC).test(v)) return false;
  const residue = v.replace(new RegExp(PLACEHOLDER_SRC, 'g'), ' ');
  return !residue.split(TOKEN_SPLIT_RE).some((w) => looksLikePastedSecret(w));
}

/** Token boundaries for residue/prose scanning: everything outside the secret alphabet. */
export const TOKEN_SPLIT_RE = /[^A-Za-z0-9+/=_.-]+/;

/**
 * Vendor credential PREFIXES that identify a pasted live key regardless of length or entropy —
 * the shapes that are unmistakably a secret and nothing else.
 */
const CREDENTIAL_PREFIX_RE =
  /^(?:sk|pk|rk)_(?:live|test)_|^(?:ghp|gho|ghu|ghs|ghr)_|^github_pat_|^xox[baprs]-|^AKIA|^ASIA|^AIza|^ya29\.|^eyJ[A-Za-z0-9_-]{8,}/;

/**
 * Is this residue/prose token a PASTED LITERAL SECRET (as opposed to an auth-scheme word, a
 * parameter name, or ordinary prose)?
 *
 * A3 RE-REVIEW HIGH-1 — the F4 tightening ("residue must be scheme-like words: letters/hyphens,
 * <=16 chars") was far too strict and BROKE REAL INTEGRATIONS ON THE WIRE: any digit-bearing
 * scheme word failed it, so `AWS4-HMAC-SHA256 {{signature}}`, `OAuth oauth_consumer_key="{{k}}"`,
 * `Bearer {{sig}}; charset=utf-8`, `Signature keyId="{{k}}",algorithm="rsa-sha256"` and
 * `ApiKey-v1 {{api_key}}` were all redacted — and `action-executor.ts` then sent the literal
 * string `[REDACTED]` as the request's auth header. The shipped-package property test could not
 * catch it because every breaking shape is TENANT-authored.
 *
 * The rule is now about the SHAPE OF A SECRET rather than the shape of a scheme word:
 *   - a known vendor credential prefix (`sk_live_…`, `ghp_…`, `AKIA…`, a JWT) — always a secret;
 *   - a long opaque run (>=24 chars in the secret alphabet) — no scheme word or English word is;
 *   - a >=12-char run mixing UPPER + lower + digit — the entropy signature of a generated key
 *     (`sk_live_9aXbZ`, `ghp_16C7e42F292c69`), while `ApiKey-v1` (9) and `AWS4-HMAC-SHA256`
 *     (no lowercase) and `rsa-sha256` (no uppercase) stay clear;
 *   - a base64 run with padding, or a >=24-char hex run.
 * KNOWN RESIDUAL (accepted, recorded): a SHORT low-entropy literal beside a placeholder still
 * rides the exemption (`{{name}} hunter2`). Catching it would re-break the scheme words above;
 * the defence in depth for it is E2's strict publish-time scrub, not this exemption.
 */
export function looksLikePastedSecret(token: string): boolean {
  const t = token.replace(/^["']+|["']+$/g, '');
  if (t.length < 8) return false;
  if (CREDENTIAL_PREFIX_RE.test(t)) return true;
  if (t.length >= 24) return true;
  if (/^[A-Za-z0-9+/]{16,}={1,2}$/.test(t)) return true; // padded base64
  if (t.length >= 12 && /[a-z]/.test(t) && /[A-Z]/.test(t) && /[0-9]/.test(t)) return true;
  // A long OPAQUE SEGMENT between `_`/`-`/`.` delimiters. Scheme words are built from short
  // dictionary segments (`AWS4-HMAC-SHA256`, `rsa-sha256`, `ApiKey-v1`), whereas a generated key
  // carries one long random run even when the whole token is lowercase (`tok_9f8e7d6c5b4a3210`).
  return t
    .split(/[_.-]+/)
    .some((seg) => seg.length >= 12 && (/^[0-9a-f]+$/i.test(seg) || (/[A-Za-z]/.test(seg) && /[0-9]/.test(seg))));
}

/**
 * The two knobs of the credential walk below. Extracted (E2) so the STRICT publish-time floor
 * (`publish-scrub.ts`) drives the SAME deep walk as the read-path scrub instead of forking a second
 * traversal that can drift from this one (Rule 1 — one implementation). The read path binds the
 * defaults; publish binds a stricter template predicate plus a per-string transform.
 */
export interface SecretWalkRules {
  /** Does a value under a CREDENTIAL-NAMED key survive whole? Default: `isCredentialTemplate`. */
  credentialValueSurvives(value: unknown): boolean;
  /** Applied to every string that was NOT wholly redacted. `key` is the owning property name (for
   *  an array element, the array's own property name), so a rule can treat a string under a
   *  credential-named key differently from ordinary prose without re-walking the document.
   *  Default: identity. */
  transformString?: (value: string, path: string, key: string) => string;
  /** Notified for each WHOLE-value redaction, with the dotted path and the removed length. Never
   *  the removed TEXT: the publish report is served back to an author and must not mint a second
   *  surface carrying credential material. */
  onRedact?: (path: string, removedChars: number) => void;
}

const DEFAULT_WALK_RULES: SecretWalkRules = { credentialValueSurvives: isCredentialTemplate };

/** Dotted/indexed child path, kept human-readable for the publish report (`actions[0].headers.x`). */
function childPath(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

/**
 * Deep-clone a value, redacting any property whose key names a credential value, under `rules`.
 *
 * Exported (A2) so the tenant-scoped Mongo tier in `definition-registry.ts` runs the SAME scrub on
 * its projection as this disk tier runs on its own — one implementation of the rule, never a second
 * copy that can drift from `SECRET_KEY_RE`.
 */
export function redactSecretsWith<T>(value: T, rules: SecretWalkRules, path = '', key = ''): T {
  if (Array.isArray(value)) {
    return value.map((v, i) => redactSecretsWith(v, rules, `${path}[${i}]`, key)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = childPath(path, k);
      if (SECRET_KEY_RE.test(k) && !rules.credentialValueSurvives(v)) {
        rules.onRedact?.(p, typeof v === 'string' ? v.length : JSON.stringify(v ?? null).length);
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSecretsWith(v, rules, p, k);
      }
    }
    return out as unknown as T;
  }
  if (typeof value === 'string' && rules.transformString) {
    return rules.transformString(value, path, key) as unknown as T;
  }
  return value;
}

/** The READ-PATH scrub: the walk above with the default (egress-grade) rules. */
export function redactSecrets<T>(value: T): T {
  return redactSecretsWith(value, DEFAULT_WALK_RULES);
}

/**
 * Deterministic FREE-TEXT scrub for stored knowledge bodies (SKILL.md / lessons) at MODEL EGRESS —
 * a body read back into an agent prompt (A2 review F7: `resolveSkillMd` returned a tenant-authored
 * body verbatim, so a credential the author pasted into their doc would ride into every future
 * prompt). EGRESS ONLY (A3 review F3): this scrub is lossy by design, so it must never touch a
 * body headed back to an EDITABLE surface — the builder reads `resolveSkillMdRaw`, or one ordinary
 * edit cycle would persist the redaction over the tenant's real text. The strict publish-time
 * scrub (deterministic floor + one chokepoint model pass into a frozen snapshot) is slice E2's.
 *
 * Two passes, both value-anchored so documentation of field NAMES survives:
 *   1. `<secret-name>: value` / `<secret-name>=value` — the value is a SEQUENCE of tokens, each a
 *      `{{template}}` placeholder or a secret-shaped run; placeholders survive, literal runs are
 *      redacted. Matching the sequence (not just the first token) closes the A3-review F4 bypass
 *      where a value STARTING with a placeholder waved the pasted literal beside it straight
 *      through (`api_key: {{name}} sk_live_…` — the old `(?!\{\{)` lookahead failed the whole
 *      match). Docs legitimately show `Authorization: Bearer {{access_token}}`, which survives.
 *   2. `Bearer|Basic <long token>` — a pasted credential after an auth scheme word, with the same
 *      per-token rule for the same reason.
 */
/** The value of a credential-named key runs to END OF LINE (A3 re-review LOW-2): bounding it to a
 *  whitespace-joined token sequence let every other joiner (`,` `;` `|` `"` `=` …) carry a literal
 *  past the scrub. The line is then scanned token-by-token, so widening the capture cannot
 *  over-redact — only a token that `looksLikePastedSecret` is touched. */
const SECRET_LINE_RE = new RegExp(String.raw`\b(${SECRET_KEY_NAMES})(\s*[:=][ \t]*)([^\n\r]*)`, 'gi');
/** An auth scheme word followed by its value, likewise to end of line and likewise token-scanned. */
const BEARER_VALUE_RE = /\b(bearer|basic)([ \t]+[^\n\r]*)/gi;

/**
 * Redact the SECRET-SHAPED tokens of a matched value, keeping `{{placeholders}}`, scheme words and
 * ordinary prose intact.
 *
 * A3 RE-REVIEW LOW-2/LOW-3: the previous pass matched a whitespace-joined SEQUENCE of "runs", which
 * was wrong in both directions — any other joiner escaped it entirely (`,` `;` `|` `=` `"` newline
 * … so `api_key: {{n}},sk_live_…` walked straight through), while inside a matched sequence EVERY
 * run was redacted, so plain documentation came back shredded (`token: documentation explains
 * everything` -> three `[REDACTED]`s). Scanning tokens with the shared `looksLikePastedSecret`
 * predicate fixes both: joiners no longer matter because tokens are found wherever they sit, and a
 * word only redacts when it actually looks like a pasted credential.
 */
function redactSecretTokens(value: string): string {
  return value.replace(/\{\{[^{}]+\}\}|[A-Za-z0-9+/=_.-]+/g, (tok) =>
    (tok.startsWith('{{') ? tok : looksLikePastedSecret(tok) ? '[REDACTED]' : tok));
}

/**
 * Walk the two CREDENTIAL-VALUE POSITIONS of a free-text body — the value of a credential-named
 * key, and the value after an auth scheme word — rewriting each with `rewriteValue`.
 *
 * Extracted (E2) so the strict publish-time text floor reuses the SAME notion of "where a
 * credential value sits in prose" as the read-path scrub, and only substitutes the per-value rule.
 * A second copy of these two regexes is exactly how the two floors would silently diverge.
 */
export function scrubSecretTextWith(
  body: string,
  /** `position` names WHICH credential position matched: `key-value` is the value of a
   *  credential-named key (the whole value is the credential's), `scheme` is the text after an auth
   *  scheme word, where the scheme itself has already been consumed and the tail may be ordinary
   *  prose ("Use Bearer {{token}} here."). A rule that is strict about bare words must know the
   *  difference, or it shreds the sentence around the example. */
  rewriteValue: (value: string, position: 'key-value' | 'scheme') => string,
): string {
  return body
    .replace(SECRET_LINE_RE, (_m, key: string, sep: string, value: string) =>
      `${key}${sep}${rewriteValue(value, 'key-value')}`)
    .replace(BEARER_VALUE_RE, (_m, scheme: string, rest: string) => `${scheme}${rewriteValue(rest, 'scheme')}`);
}

export function scrubSecretText(body: string): string {
  return scrubSecretTextWith(body, redactSecretTokens);
}

// ============================================
// Cache + loading
// ============================================

let cache: Map<string, IntegrationDefinition> | null = null;
/** Keys of the read-only BASELINE tier (api/assets/integrations). Rebuilt by load(). The
 *  reserved-key set the builder guards against (a user integration may not claim a shipped key)
 *  is derived from this + the pipedream row. */
let baselineKeys = new Set<string>();
/**
 * The BASELINE tier as its OWN map. Since A3 retired the disk runtime tier from `load()`, `cache`
 * and `baselineCache` hold the SAME shipped set — the separate map (and the baseline-only
 * accessors below) are KEPT deliberately: they are the A2-review contract that the registry's
 * fallback can only ever read shipped packages, and they make any future second tier opt-in at
 * the accessor level instead of silently folded into every reader (the A2 F1 leak shape).
 */
let baselineCache = new Map<string, IntegrationDefinition>();

/** Root of the versioned BASELINE packages. Resolved at call time so tests can point
 *  EKOA_INTEGRATIONS_DIR at a fixture and refresh() picks it up. `__dirname/../../assets/integrations`
 *  holds from both api/src/integrations and api/dist/integrations (assets/ sits at the api root). */
function integrationsDir(): string {
  return process.env.EKOA_INTEGRATIONS_DIR || join(__dirname, '..', '..', 'assets', 'integrations');
}

/** Operational data directory (EKOA_DATA_DIR || ~/.ekoa/data), resolved per call so tests can
 *  override it — same derivation as services/artifact-screenshot.ts dataDir(). */
function dataDir(): string {
  const raw = process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/**
 * Root of the FROZEN legacy runtime tier (`<dataDir>/integrations/runtime/<key>/`) — the directory
 * the builder used to save user packages into before A3 moved that write path to the tenant-scoped
 * Mongo store. Nothing writes it any more and nothing here READS it into the cache; its packages
 * are imported once at boot by `legacy-runtime-import.ts` (which is why the accessor survives) and
 * the directory is removed at the Rule-10 review date (2026-08-15, docs/decisions.md).
 */
export function legacyRuntimeDir(): string {
  return join(dataDir(), 'integrations', 'runtime');
}

/** Load and project one package directory, or null if it has no readable config.json. */
function loadOne(dir: string, userCreated: boolean): IntegrationDefinition | null {
  const configPath = join(dir, 'config.json');
  if (!existsSync(configPath)) return null;

  let config: IntegrationPackageConfig;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8')) as IntegrationPackageConfig;
  } catch (err) {
    console.warn(`[integration-definitions] failed to parse ${configPath}:`, err instanceof Error ? err.message : err);
    return null;
  }

  const key = config.integrationKey;
  if (!key || typeof key !== 'string') return null;

  const iso = new Date(statSync(configPath).mtimeMs).toISOString();
  return redactSecrets<IntegrationDefinition>({
    key,
    integrationKey: key,
    displayName: config.displayName,
    description: config.description,
    version: config.version,
    authType: config.authType,
    provider: config.provider,
    category: config.category,
    userCreated,
    configSchema: config.configSchema ?? [],
    actions: config.actions ?? [],
    credentialGuide: config.credentialGuide,
    sessionConnect: config.sessionConnect,
    webhookConfig: config.webhookConfig,
    listenerConfig: config.listenerConfig,
    createdAt: iso,
    updatedAt: iso,
  });
}

/** Scan one tier's package directories into `next`, marking userCreated + recording keys. */
function loadTier(root: string, userCreated: boolean, next: Map<string, IntegrationDefinition>, keys: Set<string>): void {
  if (!existsSync(root)) return;
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const def = loadOne(join(root, d.name), userCreated);
    if (def) {
      next.set(def.key, def);
      keys.add(def.key);
    }
  }
}

/** (Re)load the BASELINE package directories from disk into a fresh cache. The disk runtime tier
 *  is deliberately NOT loaded (A3): its packages live in Mongo since the boot import, and folding
 *  a world-writable directory into the process-wide cache was the A2 F1 cross-tenant leak. */
function load(): Map<string, IntegrationDefinition> {
  const next = new Map<string, IntegrationDefinition>();
  const baseKeys = new Set<string>();
  loadTier(integrationsDir(), false, next, baseKeys);
  baselineCache = new Map(next);
  cache = next;
  baselineKeys = baseKeys;
  return next;
}

function ensure(): Map<string, IntegrationDefinition> {
  if (!cache) load();
  return cache!;
}

// ============================================
// Public read API
// ============================================

/** All loaded definitions (GET /api/v1/integrations). */
export function listDefinitions(): IntegrationDefinition[] {
  return Array.from(ensure().values());
}

/** One loaded definition by key, or null. Used by the platform API caller (platform-call.ts)
 *  to resolve an action's httpConfig without re-reading config.json off disk. */
export function getDefinition(key: string): IntegrationDefinition | null {
  return ensure().get(key) ?? null;
}

/**
 * BASELINE-ONLY reads — the shipped, repo-authored packages.
 *
 * Why this exists (A2 review, F1). The disk runtime tier was ONE global directory that any
 * authenticated user of any org could write through the builder, and `load()` used to fold it
 * into the same cache as the shipped packages — so every reader of the merged cache handed one
 * tenant's authored package (including its action `baseUrl`s, which the origin resolver turns
 * into a credential-egress allow-list) to every other tenant. The tenant-scoped registry
 * therefore falls back to THESE accessors, never to the merged view. Since A3 retired the runtime
 * tier from `load()` entirely, the two views coincide — the split is kept as the explicit
 * contract (see the module header).
 */
export function getBaselineDefinition(key: string): IntegrationDefinition | null {
  ensure(); // populates baselineCache
  return baselineCache.get(key) ?? null;
}

/** Every SHIPPED definition (runtime-tier packages excluded — see `getBaselineDefinition`). */
export function listBaselineDefinitions(): IntegrationDefinition[] {
  ensure(); // populates baselineCache
  return Array.from(baselineCache.values());
}

/** The SHIPPED package's SKILL.md (runtime tier excluded — see `getBaselineDefinition`). */
export function baselineSkillMd(key: string): string | null {
  ensure(); // populates baselineCache (a cold cache must not answer null for a real baseline key)
  if (!baselineCache.has(key)) return null;
  const p = join(integrationsDir(), key, 'SKILL.md'); // the BASELINE dir only, never the legacy runtime dir
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * An integration package's automation TEMPLATE (`<package>/automations/<templateKey>.json`):
 * the repo-authored blueprint the provisioner materializes as a managed automation. BASELINE
 * ONLY (A3, A2-residual 3): this used to probe the runtime dir FIRST on a tenant response path,
 * i.e. a world-writable directory could steer any org's provisioned automation steps. Templates
 * are package FILES only shipped with baseline packages (the retired runtime writer never wrote
 * an `automations/` dir), so baseline-only is the whole truth. Both path segments are validated
 * (the templateKey never touches the filesystem unvalidated); a malformed file returns null
 * (counted by the caller, never fatal).
 */
export function integrationAutomationTemplate(
  key: string,
  templateKey: string,
): { templateKey: string; name: string; description?: string; inputSchema?: { fields: Array<{ name: string; description: string; required: boolean; defaultValue?: string }> }; steps: Array<Record<string, unknown>> } | null {
  ensure(); // populates baselineCache
  if (!baselineCache.has(key) || !/^[a-z0-9][a-z0-9-]{0,48}$/.test(templateKey)) return null;
  const p = join(integrationsDir(), key, 'automations', `${templateKey}.json`);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    if (typeof raw.name !== 'string' || !Array.isArray(raw.steps)) return null;
    return {
      templateKey,
      name: raw.name,
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(raw.inputSchema && typeof raw.inputSchema === 'object' ? { inputSchema: raw.inputSchema as never } : {}),
      steps: raw.steps as Array<Record<string, unknown>>,
    };
  } catch {
    return null;
  }
}

/** The SHIPPED package's SKILL.md, baseline only (A3 — alias of `baselineSkillMd`, kept for its
 *  existing callers). Tenant knowledge bodies are served by the registry's `resolveSkillMd`. */
export function integrationSkillMd(key: string): string | null {
  return baselineSkillMd(key);
}

/**
 * The keys a user-created integration may NOT claim: every BASELINE definition key plus the
 * reserved `pipedream` connect row. The builder parser AND the Mongo save path
 * (`definition-save.ts`) both refuse a package whose key collides with this set — since A3 with
 * NO loaded-session exemption, so a shipped key can never be shadowed through the builder
 * (§3.8.14/§3.8.16; A2-residual 4).
 */
export function reservedIntegrationKeys(): Set<string> {
  ensure(); // populates baselineKeys
  return new Set<string>([...baselineKeys, PIPEDREAM_INTEGRATION_KEY]);
}

/** The action + event catalog for every loaded definition (unfiltered; the route joins
 *  it against the org's enabled configs to produce the "active" set for the trigger picker). */
export function activeCatalog(): ActiveIntegrationCatalog[] {
  return Array.from(ensure().values()).map((d) => ({
    key: d.key,
    displayName: d.displayName,
    actions: d.actions.map((a) => ({ actionName: a.actionName, description: a.description, mutates: a.mutates })),
    webhookEvents: d.webhookConfig?.events ?? [],
    listenerEvents: d.listenerConfig?.events ?? [],
  }));
}

/**
 * Force a reload from disk (POST /api/v1/integrations/refresh). Since A3 the reported
 * `{count, keys}` is the shipped BASELINE set only — the same for every caller. It used to fold
 * in the runtime tier, which made this org-admin route a cross-tenant KEY ENUMERATION (every
 * tenant's authored package keys, A2-residual 1); tenant definitions live in Mongo, are read per
 * request, and need no refresh.
 */
export function refreshDefinitions(): { count: number; keys: string[] } {
  const m = load();
  return { count: m.size, keys: Array.from(m.keys()).sort() };
}
