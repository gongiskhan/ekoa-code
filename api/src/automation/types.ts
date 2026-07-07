/**
 * Type definitions shared across the automation runtime.
 *
 * Two layers:
 *   - User-facing spec: Automation, Step. Plain English. No code, no
 *     locators, no Playwright internals. The user reads and writes
 *     these.
 *   - Cache layer: PlaywrightAction, Locator, PlaywrightAssertion,
 *     PageFingerprint. Resolved by the vision step on cache miss,
 *     stored as memory attachments, replayed deterministically on
 *     cache hit. Never surfaced to the user.
 *
 * Ported as-is from the old Cortex automation family (carryover-audit A8): pure type layer,
 * zero imports, so it re-homes into ekoa-code/automation/ unchanged.
 */

// ============================================================================
// Cache layer — Locators
// ============================================================================

/**
 * A locator describes how Playwright should find a DOM node. Strategies are
 * ordered from most-stable (role/label/testid) to least-stable (CSS). Vision
 * resolution prefers the higher strategies; CSS is a last resort.
 */
export type Locator =
  | { strategy: 'role'; role: string; name?: string; exact?: boolean }
  | { strategy: 'text'; value: string; exact?: boolean }
  | { strategy: 'label'; value: string; exact?: boolean }
  | { strategy: 'placeholder'; value: string }
  | { strategy: 'testid'; value: string }
  | { strategy: 'css'; selector: string }
  | { strategy: 'altText'; value: string }
  | { strategy: 'title'; value: string };

// ============================================================================
// Cache layer — Actions
// ============================================================================

/**
 * A Playwright action that the executor can run directly without further
 * resolution. Vision returns one of these per step on cache miss; we
 * persist it against the (automationId, stepId, fingerprint) key and
 * replay it next time.
 */
export type PlaywrightAction =
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; locator: Locator }
  | { kind: 'dblclick'; locator: Locator }
  | { kind: 'fill'; locator: Locator; value: string }
  | { kind: 'press'; key: string; locator?: Locator }
  | { kind: 'select'; locator: Locator; value: string }
  | { kind: 'check'; locator: Locator }
  | { kind: 'uncheck'; locator: Locator }
  | { kind: 'hover'; locator: Locator }
  | { kind: 'wait'; durationMs: number }
  | { kind: 'wait_for'; locator: Locator; state: 'visible' | 'hidden' | 'attached' | 'detached' }
  | { kind: 'scroll'; locator?: Locator; direction: 'up' | 'down'; pixels?: number }
  | { kind: 'screenshot' }
  /**
   * Resolver-issued "this step is already satisfied / not applicable"
   * signal. Engine treats it as a successful no-op and moves on, no
   * Playwright invocation. Used when the planner generated a redundant
   * step (e.g. "click Submit" after the page already submitted).
   */
  | { kind: 'noop'; reason: string };

// ============================================================================
// Cache layer — resolved actions for non-browser step types
// ============================================================================

/**
 * A local_command's resolved form. Cached so repeated runs replay the
 * exact argv without re-resolving. `shape` is the consent-lookup
 * signature (see command-shape.ts).
 */
export interface LocalCommandResolved {
  kind: 'local_command';
  argv: string[];
  cwd?: string;
  shape: string;
  timeoutMs: number;
  stdin?: string;
}

/**
 * An api_call's resolved form. The request shape is cached; responses
 * are NEVER cached (they're per-run output, not part of the spec).
 */
export interface ApiCallResolved {
  kind: 'api_call';
  method: ApiCallMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  bodyKind: ApiCallBodyKind;
  timeoutMs: number;
  authIntegrationKey?: string;
}

/**
 * An ekoa_action's resolved form. The recipe snapshot is captured so
 * if the artifact's MANIFEST.md changes (manifestRev mismatch) the cache
 * invalidates and re-resolves. recipeSnapshot is intentionally `unknown`
 * here to keep this file's deps tight; platform-primitives.ts owns the
 * concrete shape.
 */
export interface EkoaActionResolved {
  kind: 'ekoa_action';
  artifactId: string;
  capabilityName: string;
  recipeSnapshot: unknown[];
  manifestRev: string;
}

export type ResolvedAction =
  | PlaywrightAction
  | LocalCommandResolved
  | ApiCallResolved
  | EkoaActionResolved;

// ============================================================================
// Cache layer — Assertions (for verify-outcome steps)
// ============================================================================

export type PlaywrightAssertion =
  | { kind: 'expect_visible'; locator: Locator }
  | { kind: 'expect_hidden'; locator: Locator }
  | { kind: 'expect_text'; locator: Locator; contains: string }
  | { kind: 'expect_url'; pattern: string }
  | { kind: 'expect_title'; contains: string };

// ============================================================================
// Cache layer — Page fingerprint
// ============================================================================

/**
 * A small, cheap, content-discriminating identifier for a page state.
 *
 * Pure DOM-shape hashes false-hit on SPAs that re-use the same template
 * across many entities (e.g. Google Docs `/document/d/A/edit` vs
 * `…/d/B/edit`). Mixing in title and first-heading hashes preserves
 * structural reuse caching while preventing cross-entity false hits.
 */
export interface PageFingerprint {
  origin: string;            // e.g. https://docs.google.com
  pathname: string;
  pathSuffix: string;        // last non-empty path segment
  titleHash: string;         // SHA-1(document.title)
  headingHash: string;       // SHA-1(first H1/H2 visible text)
  domShapeHash: string;      // SHA-1 of normalised tag+role/landmark counts (no text, no attribute values)
  viewport: { w: number; h: number };
}

// ============================================================================
// User-facing spec — Step + Automation
// ============================================================================

export type StepType =
  | 'browser'
  | 'verify'
  | 'integration'
  | 'sub_automation'
  | 'navigate'
  | 'wait'
  | 'local_command'
  | 'api_call'
  | 'ekoa_action';

// ============================================================================
// New step type — local_command
// ============================================================================

/**
 * Spec for a local_command step. Argv-array form by default; no shell
 * expansion unless the user explicitly invokes `bash -c "<script>"`,
 * which is its own (separately-consented) command shape.
 */
export interface LocalCommandSpec {
  /** First element is the executable, rest are arguments. */
  argv: string[];
  /** Working directory. Defaults to user's home in local mode. */
  cwd?: string;
  /** Max wall-clock duration. Default 5 min, hard cap 30 min. */
  timeoutMs?: number;
  /** Piped to the process's stdin then closed. */
  stdin?: string;
  /**
   * Environment variables to forward to the subprocess. Never leaks the
   * full daemon/Cortex env. Each name must be a literal string here; we
   * read the corresponding value from `process.env` at spawn time.
   */
  envWhitelist?: string[];
}

// ============================================================================
// New step type — api_call
// ============================================================================

export type ApiCallMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ApiCallBodyKind = 'json' | 'text' | 'form' | 'none';

/**
 * Spec for an api_call step. Template vars: {{input.x}}, {{capture.x}},
 * {{integration.<key>.<field>}} for credential injection.
 */
export interface ApiCallSpec {
  method: ApiCallMethod;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  bodyKind?: ApiCallBodyKind;
  /** Default 30s, hard cap 5 min. */
  timeoutMs?: number;
  /**
   * Routes credential injection through the named integration. Auth-shaped
   * headers (Authorization, X-API-Key…) MUST use this; raw credentials in
   * `headers` are rejected at validation.
   */
  authIntegrationKey?: string;
}

// ============================================================================
// New step type — ekoa_action
// ============================================================================

/** Reference to an artifact capability defined in its MANIFEST.md. */
export interface EkoaActionSpec {
  /** Resolved at execution time via the slug index. */
  artifactSlug: string;
  capabilityName: string;
  inputs: Record<string, unknown>;
}

/**
 * A single step in an automation, as the user reads it. All free-text
 * fields are plain English — no code, no syntax, nothing technical.
 * Type-discriminated extras are optional in the type but required for
 * their type.
 */
export interface Step {
  id: string;
  description: string;       // plain English; the artifact the user edits
  type: StepType;
  expectedOutcome?: string;  // plain English

  // Type-discriminated extras
  url?: string;                          // navigate
  durationMs?: number;                   // wait
  integrationKey?: string;               // integration
  integrationAction?: string;            // integration
  argsTemplate?: Record<string, string>; // integration / sub_automation — '{{input.x}}' or literal
  subAutomationId?: string;              // sub_automation
  commandTemplate?: LocalCommandSpec;    // local_command
  apiRequest?: ApiCallSpec;              // api_call
  ekoaAction?: EkoaActionSpec;           // ekoa_action

  /**
   * Planner-authored deterministic verify assertion (verify steps).
   *
   * When present, the engine runs this assertion before falling back to
   * the (expensive, hallucination-prone) vision verifier. Lets the
   * planner cheaply express outcomes that are naturally deterministic:
   * a URL substring, a page title token, a visible heading.
   *
   * Outcomes that genuinely cannot be expressed deterministically (e.g.
   * "the email was sent" — there is no UI artefact) should leave this
   * undefined and rely on vision (or the verify-after-integration
   * short-circuit).
   */
  cachedAssertion?: PlaywrightAssertion;  // verify
}

export interface AutomationInputField {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

/**
 * How an automation gets to run. v1 supports three kinds:
 *   - manual: only via call_automation or the run button.
 *   - webhook: external HTTP POST at /hooks/<triggerId> from a third-party
 *     (Stripe, GitHub, Slack…) verified against a per-trigger HMAC secret.
 *   - listener: a hosted poll loop calling an integration action on a fixed
 *     interval (IMAP fetch, polling APIs). Same execution surface as webhook.
 *
 * Only one trigger per automation in v1. Triggered automations remain
 * runnable via call_automation but agents are instructed not to invoke them
 * directly unless the user explicitly asks.
 */
export type AutomationTrigger =
  | { kind: 'manual' }
  | {
      kind: 'webhook';
      triggerId: string;
      integrationKey: string;
      eventName: string;
    }
  | {
      kind: 'listener';
      triggerId: string;
      integrationKey: string;
      pollAction: string;
      pollIntervalMs: number;
    };

export interface Automation {
  id: string;
  name: string;
  description: string;       // user-written goal, plain English
  steps: Step[];
  inputSchema?: { fields: AutomationInputField[] };
  ownerUserId: string;
  /**
   * Optional trigger that fires this automation. Absent / { kind: 'manual' }
   * means the automation only runs when explicitly invoked. See
   * AutomationTrigger for the webhook + listener kinds.
   */
  trigger?: AutomationTrigger;
  /**
   * Set when this automation was materialized from an integration's automation
   * template (integration-automations.ts provisioner). Lets the UI link back
   * to the owning integration and keeps re-provisioning idempotent.
   */
  source?: { integrationKey: string; templateKey: string };
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Operational — Run records
// ============================================================================

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type StepTier = 'cache' | 'vision' | 'cache-then-vision';

export interface StepFeedback {
  kind: 'thumbs_up' | 'thumbs_down' | 'correction';
  note?: string;
  submittedAt: string;
}

/**
 * Captured runtime output for non-browser step types. The engine populates
 * this on each step as it executes. UI dispatches on `kind` to render the
 * type-appropriate result panel (stdout/stderr panes for local_command,
 * DevTools-style JSON tree for api_call, primitive-trace + result
 * description for ekoa_action).
 */
export type StepOutput =
  | {
      kind: 'local_command';
      stdout: string;
      stderr: string;
      exitCode: number | null;          // null while still running, or on kill
      durationMs: number;
      truncated: boolean;               // either stream hit 5 MB cap
      timedOut: boolean;
    }
  | {
      kind: 'api_call';
      status: number;
      statusText?: string;
      responseHeaders: Record<string, string>;
      responseBody: string;             // up to 1 MB; truncated otherwise
      responseBodyIsJson: boolean;
      truncated: boolean;
      durationMs: number;
    }
  | {
      kind: 'ekoa_action';
      /** Compact trace of primitives executed in order (human-readable summary). */
      trace: EkoaActionTraceEntry[];
      /** Final rendered description from the capability's result_template. */
      result: string;
      capturedValues: Record<string, unknown>;
      durationMs: number;
    };

/** One step inside an ekoa_action's recipe execution. */
export interface EkoaActionTraceEntry {
  op: string;
  summary: string;                       // human-readable line: "store.create clients → id c-8f3a"
  durationMs: number;
  status: 'ok' | 'failed';
  error?: string;
}

export type HumanActionKind = 'captcha' | 'mfa' | 'payment' | 'identity' | 'login' | 'other';

export interface HumanActionRequired {
  kind: HumanActionKind;
  /** Plain-English ask shown verbatim in the cyan "Ekoa needs you" bar. */
  userInstructions: string;
}

export interface StepRecord {
  stepId: string;
  index: number;
  status: StepStatus;
  tier: StepTier;
  /**
   * Resolved deterministic action: a PlaywrightAction for browser steps,
   * or one of the non-browser ResolvedAction kinds (LocalCommandResolved,
   * ApiCallResolved, EkoaActionResolved). The discriminator is `kind`.
   */
  resolvedAction?: ResolvedAction;
  assertionResolved?: PlaywrightAssertion;
  visionReasoning?: string;
  /**
   * Captured stdout / stderr / response body / primitive trace for non-
   * browser step types. Distinct from screenshotPath which is browser-only.
   * Stays unset for browser steps.
   */
  output?: StepOutput;
  /**
   * `details` is structured failure context (request + redacted
   * response for integration steps; arbitrary debug payload for
   * others) so the UI can show the user *why* a step failed without
   * forcing them to scrape the message.
   */
  error?: { message: string; recoverable: boolean; details?: unknown };
  /**
   * Set when the verifier (or future resolver) classifies the page as
   * needing a human (CAPTCHA, MFA, payment, identity check, login).
   * The engine pauses for the user using these instructions directly,
   * skipping the fixer round-trip entirely.
   */
  humanAction?: HumanActionRequired;
  screenshotPath?: string;     // relative to the automation data dir
  fingerprint?: PageFingerprint;
  durationMs: number;
  feedback?: StepFeedback;
  /** Patches applied at this index during a rehearsal run, in order. */
  rehearsalPatches?: AppliedPatch[];
}

export type RunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'awaiting_integration'
  | 'paused_for_user'
  | 'awaiting_consent'   // local_command needs first-time per-shape consent
  | 'awaiting_daemon';   // browser/local_command step needs the local ekoa daemon, which isn't connected

export interface RunRecord {
  id: string;
  automationId: string;
  startedAt: string;
  endedAt?: string;
  status: RunStatus;
  inputs: Record<string, unknown>;
  steps: StepRecord[];
  /**
   * Where this run originated.
   *   - user: invoked from the UI by the owner.
   *   - agent: invoked from another agent (chat/coding) via call_automation.
   *   - webhook: dispatched by the trigger dispatcher after a third-party
   *     POST'd a verified event at /hooks/<triggerId>.
   *   - listener: dispatched by the trigger dispatcher after a polling
   *     listener picked up new events from an integration action.
   */
  triggeredBy: 'user' | 'agent' | 'webhook' | 'listener';
  /** Run owner + org, persisted at creation so the run resource can be tenant-scoped (visible to
   *  the owner and org-admins) without a join back to the automation (ch05 §5.6.7, Amendment 2). */
  ownerUserId?: string;
  orgId?: string;
  parentRunId?: string;        // sub-automation runs link upward
  awaitingIntegration?: { service: string; reason: string };
  /** 'rehearsal' = first-time validation run that may mutate the spec. 'normal' = deterministic replay. */
  kind?: 'normal' | 'rehearsal';
  rehearsalSummary?: RehearsalSummary;
  /** Set when the engine has paused for human action (CAPTCHA, MFA, …). Cleared on resume. */
  pauseRequest?: PauseRequest;
  /** Set when a local_command step is awaiting first-time consent for its shape. */
  consentRequest?: ConsentRequest;
}

/**
 * A first-time consent prompt for a local_command shape. Surfaces in the
 * UI via automation_run_awaiting_consent SSE event. Resolved via
 * resolve-consent intent on automations-handler.
 */
export interface ConsentRequest {
  stepIndex: number;
  /** Normalized command-shape signature for storage / revocation. */
  shape: string;
  /** Full argv shown only behind a "what exactly will run?" toggle. */
  argv: string[];
  /** Plain English: "run cat to read a file" — never raw argv. */
  description: string;
}

export interface PauseRequest {
  stepIndex: number;
  reasoning: string;
  userInstructions: string;
  /** Path relative to the automation data dir, served via /automation-screenshots. */
  screenshotPath?: string;
}

// ============================================================================
// Operational — Rehearsal patches
// ============================================================================

/**
 * One local edit the rehearsal fixer can propose when a step fails.
 * Patches are intentionally local — no "rewrite the next 4 steps" — so
 * the loop stays stable.
 */
export type RehearsalPatch =
  | { kind: 'insert_before'; newStep: Step; reasoning: string }
  | { kind: 'replace_current'; newStep: Step; reasoning: string }
  | { kind: 'skip_current'; reasoning: string }
  | { kind: 'abort'; reasoning: string }
  /**
   * The page is in a state only a human can resolve: CAPTCHA, MFA / 2FA
   * code entry, payment confirmation, "are you sure?" warnings on
   * destructive actions. The engine pauses, surfaces the screenshot
   * + user-facing instructions, and waits for the user to act in the
   * live (headed) browser window and click "Continue".
   */
  | { kind: 'pause_for_user'; reasoning: string; userInstructions: string };

export type FailureKind = 'verify_failed' | 'browser_failed' | 'navigate_failed' | 'integration_failed' | 'other';

export interface AppliedPatch {
  kind: RehearsalPatch['kind'];
  reasoning: string;
  /** The new step body, when the patch added or replaced one. */
  newStep?: Step;
  /** What the fixer was reacting to. */
  failureKind: FailureKind;
  failureMessage: string;
  /** Wall-clock at the time the patch was applied. */
  appliedAt: string;
}

export type RehearsalStatus = 'ok' | 'budget_exhausted' | 'stuck' | 'aborted' | 'failed';

export interface RehearsalSummary {
  status: RehearsalStatus;
  fixerCallCount: number;
  patchesApplied: number;
  wallClockMs: number;
  /** Index of the step where the rehearsal got stuck (if any). */
  stuckAtIndex?: number;
  reason?: string;
}
