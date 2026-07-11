/**
 * Goal -> Step[] planner (carryover-audit B9).
 *
 * Single EXPERT-tier max-effort call that turns a user's plain-English goal into an initial step
 * list. The user then reviews/edits before running. The planner is given the available integration
 * / sub-automation catalog so it can prefer existing capabilities over open-ended browser steps.
 * When it detects a need for an unauthorized service (no matching integration), it surfaces a
 * `needs_integration` flag on the result instead of guessing.
 *
 * Re-pointing (B9): the old `callSimpleLlm` seam is replaced by the ekoa-code chokepoint
 * `runOneShot` (api/src/llm/), `user_work` `automation-plan`, billed to the run owner, EXPERT tier
 * (max effort — `high` is the top effort exposed). The corrective-retry budget (one violation-fed
 * retry) and closed-vocabulary cross-validation carry unchanged.
 */

import { randomUUID } from 'node:crypto';
import { runOneShot, decideForTier, LlmAbortedError } from '../llm/index.js';
import { automationContentSections } from './seams.js';
import { parseFirstJsonObject } from './vision.js';
import { formatCatalogForPrompt, type Catalog } from './catalog.js';
import { loadAutomationConfig } from './config.js';
import type {
  Step,
  StepType,
  AutomationInputField,
  PlaywrightAssertion,
  Locator,
} from './types.js';

// ============================================================================
// Public types
// ============================================================================

export interface PlanFromGoalInput {
  goal: string;
  userId: string;
  catalog: Catalog;
  /** Echoed back in the response (and used for the metadata). */
  automationName?: string;
}

export interface PlanFromGoalSuccess {
  status: 'ok';
  name: string;
  description: string;
  inputSchema?: { fields: AutomationInputField[] };
  steps: Step[];
  reasoning: string;
}

export interface PlanFromGoalNeedsIntegration {
  status: 'awaiting_integration';
  service: string;
  reason: string;
}

/** F29: the model could not produce a usable plan (non-JSON, no steps, invalid step, or it
 *  failed cross-validation after the corrective retry). A STRUCTURED outcome — the caller maps it
 *  to a `plan_failed` wire plan — instead of a thrown Error the route masked as an opaque 500. */
export interface PlanFromGoalFailed {
  status: 'failed';
  violations: string[];
}

/** The model transport failed or answered EMPTY — an egress outage, not a validation failure.
 *  Kept distinct from `failed` so the wire never blames the user's goal for a broken credential
 *  or provider outage (the old collapse produced "reformule o objetivo" for a dead transport). */
export interface PlanFromGoalUnavailable {
  status: 'unavailable';
  /** Server-side diagnostic only — may quote transport errors; never sent to the client. */
  detail: string;
}

export type PlanFromGoalResult =
  | PlanFromGoalSuccess
  | PlanFromGoalNeedsIntegration
  | PlanFromGoalFailed
  | PlanFromGoalUnavailable;

// ============================================================================
// System prompt
// ============================================================================

const PLANNER_SYSTEM = `You are the planner layer of an automation engine. Given a user's natural-language goal, return an initial list of automation steps for the user to review.

Return ONLY a JSON object in one of two shapes:

Shape A (success):
{
  "status": "ok",
  "name": "short title (3-7 words)",
  "description": "one or two sentence summary of the goal",
  "inputs": [ { "name": "...", "description": "...", "required": true|false } ],
  "steps": [ <Step>, ... ],
  "reasoning": "one short sentence on the chosen plan"
}

Shape B (needs an integration):
{
  "status": "awaiting_integration",
  "service": "google-workspace" | "slack" | "<service name>",
  "reason": "one short sentence on why this integration is required"
}

Step is one of:

- {"id":"<uuid-or-slug>","description":"plain English","type":"browser","expectedOutcome":"plain English"?}
- {"id":"...","description":"...","type":"verify","expectedOutcome":"plain English","cachedAssertion":<PlaywrightAssertion>?}
- {"id":"...","description":"...","type":"navigate","url":"https://..."}
- {"id":"...","description":"...","type":"wait","durationMs":2000}
- {"id":"...","description":"...","type":"integration","integrationKey":"<key>","integrationAction":"<actionName>","argsTemplate":{ "k":"{{input.x}}" | "literal" }}
- {"id":"...","description":"...","type":"sub_automation","subAutomationId":"<id>","argsTemplate":{...}}
- {"id":"...","description":"...","type":"local_command","commandTemplate":{"argv":["cmd","arg1","arg2",...],"cwd":"~/Downloads"?,"timeoutMs":300000?}}
- {"id":"...","description":"...","type":"api_call","apiRequest":{"method":"GET|POST|...","url":"https://api...","headers":{...}?,"body":"..."?,"bodyKind":"json|text|form|none"?,"authIntegrationKey":"<integrationKey>"?}}
- {"id":"...","description":"...","type":"ekoa_action","ekoaAction":{"artifactSlug":"my-crm","capabilityName":"add_client","inputs":{"name":"Alice","email":"a@b.com"}}}

PlaywrightAssertion (only on verify steps; OPTIONAL — emit when the outcome is naturally expressible deterministically):

- {"kind":"expect_visible","locator":<Locator>}
- {"kind":"expect_hidden","locator":<Locator>}
- {"kind":"expect_text","locator":<Locator>,"contains":"..."}
- {"kind":"expect_url","pattern":"/contact"}        // substring of URL
- {"kind":"expect_title","contains":"Inbox"}

Locator (when needed):

- {"strategy":"role","role":"button","name":"Sign in"}
- {"strategy":"text","value":"Contact us"}
- {"strategy":"label","value":"Email"}
- {"strategy":"placeholder","value":"you@example.com"}
- {"strategy":"testid","value":"submit-button"}
- {"strategy":"css","selector":".cta"}              // last resort

Rules:
- Output exactly one JSON object. No prose before or after. No markdown fences.
- Step descriptions are PLAIN ENGLISH. Never write code. Never write Playwright selectors. Never write CSS. Never describe DOM structure. The user reads these.

STEP TYPE PRIORITY (pick the FIRST that applies):
  1. ekoa_action — the goal touches an Ekoa-built artifact (one of "## Available Ekoa actions" in the catalog) AND the operation matches a capability listed there. Always prefer this for app-data operations: faster, deterministic, no browser, no UI driving.
  2. integration — the goal involves a third-party service (Gmail, Slack, Notion, etc.) that has a connected integration covering the action. ALWAYS prefer this over browser/navigate for the same action.
  3. api_call — the goal hits an HTTP API that is reachable directly. No integration needed (or auth is routed via authIntegrationKey to a connected integration). Cheaper, faster, more reliable than driving a UI.
  4. local_command — the goal involves filesystem, processes, CLI tools, or anything system-shaped on the user's machine. Reading a file, listing a directory, running git/npm/node/curl, etc.
  5. browser — only when nothing else fits. The action genuinely requires UI interaction with a third-party app that has no API, no integration, and isn't expressible as local commands.

- Prefer sub_automation steps when the goal would be served by an existing automation in the catalog.
- HARD RULE: NEVER use browser/navigate steps to operate inside a service whose connected integration covers the same action. If Google Workspace is connected and the goal is "send an email", emit ONE integration step using google-workspace.send_email_simple — do NOT navigate to gmail.com / mail.google.com / Gmail compose, do NOT type into Gmail UI fields. Same for Microsoft 365 (outlook.office.com), Slack (slack.com), etc. Browser steps inside these hosts are forbidden whenever the matching integration covers the action.
- HARD RULE: NEVER use browser steps to access local files. file:/// URIs do not render reliably in Chromium and listing local directories via the browser is the wrong tool. For "read the latest .txt file from Downloads" -> use local_command with argv like ["bash","-c","ls -t ~/Downloads/*.txt | head -1 | xargs cat"] OR a sequence of local_command steps. NEVER navigate to file:///Users/.../Downloads/.
- HARD RULE: local_command argv MUST be an argv array, NOT a shell command line. Shell metacharacters (|, >, <, &&) in argv ARGS will NOT work — Cortex spawns argv[0] directly with shell:false. If you genuinely need shell semantics (pipes, redirects), use ["bash", "-c", "<full script>"] as the argv. bash -c is its own command shape requiring its own user consent.
- HARD RULE: api_call auth headers (Authorization, X-API-Key, etc.) MUST be routed via authIntegrationKey. The runtime will inject credentials from the named integration. Do NOT put raw tokens in headers; do NOT prompt the user for tokens as inputs.
- HARD RULE: A step description must NEVER mention an integration name (e.g. "use the gmail integration", "call slack", "via google workspace") on a browser/navigate step. If you would write that, change the step's type to "integration" with the right integrationKey and integrationAction. Integration intent -> integration step type, always.
- HARD RULE: when a navigate/browser step targets the Ekoa app itself or one of its served artifacts (e.g. a path like /apps/<slug>/), use the origin given under "## Ekoa app origin" below as the base — NEVER hardcode a host or port (no http://localhost:3000). The running frontend port changes; always build self-URLs from the provided origin.
- For browser steps, write one short imperative sentence per action ("Click the Export button", "Fill the search field with the document title"). Keep steps small enough that one screenshot resolves them.
- Add a "verify" step after each meaningful intent change, with a plain-English expected outcome ("The PDF download starts").
- A verify step right after an integration or sub_automation step is auto-confirmed by that step's HTTP/return success — the runtime skips the vision call. It is fine to include one for the user's mental model, but never make the goal succeed conditionally on visual evidence the page can't show (e.g. "the email was sent" — the page won't change).
- For verify steps, emit a "cachedAssertion" whenever the outcome is naturally expressible as a Playwright assertion: a URL substring (expect_url), a page title token (expect_title), a visible heading or named element (expect_visible / expect_text). The runtime runs cachedAssertion deterministically — no vision call, no hallucination. Skip cachedAssertion when the outcome is something vision must judge (e.g. "the search results look relevant"). Concretely: prefer cachedAssertion for "Confirm the contact page is open" (expect_url contains "/contact"), "Confirm the inbox is showing" (expect_title contains "Inbox"). Skip it for "Confirm the search results are credible" (judgment call).
- If the goal references a service that needs authentication AND no matching integration appears in the available catalog, return shape B with status="awaiting_integration".
- "inputs" is the list of values the user will supply when running the automation. Empty array if none. Each input field name is referenced in argsTemplate / step descriptions as {{input.<name>}}.
- All ids must be short, deterministic, lowercase-hyphenated slugs (e.g. "open-doc", "click-export").
- When the goal refers to the user themselves (e.g. "send to me", "email myself", "in my inbox", "to my account") and a relevant integration is connected, use that integration's authenticated email LITERALLY in the step description and argsTemplate. Do NOT add an input field (recipientEmail, userEmail, etc.) for the user's own email — read it straight from the "Connected accounts" section above.
- Only declare a recipient input when the goal explicitly names a different person, contact, or external address that the user must provide at run time.

Template variables — STRICT:
- The ONLY template forms that exist are "{{input.<name>}}" (user-supplied inputs) and "{{capture.lastScreenshot}}" (base64-encoded PNG of the page open right before the integration step runs).
- NEVER invent other template forms. There is no {{generated.x}}, {{step.x.output}}, {{run.x}}, or function-call syntax. If you cannot express a value as a literal string, an {{input.<name>}}, or {{capture.lastScreenshot}}, redesign the step.
- For sending email with a screenshot attachment, use google-workspace.send_email_simple with attachmentBase64 = "{{capture.lastScreenshot}}", attachmentMimeType = "image/png", attachmentFilename = "screenshot.png". Do NOT use send_email (raw mode) for this — you cannot pre-encode RFC 2822 with an attachment at plan time.
- For Gmail email steps, ALWAYS prefer google-workspace.send_email_simple (structured to/subject/body) over google-workspace.send_email (raw RFC 2822) — the simple form is built by the runtime, the raw form requires you to produce a complete base64url message which you cannot do with templates.

WORKED EXAMPLES (representative, not exhaustive — apply the priority logic):

Goal: "Read the latest .txt file from my Downloads folder and email its contents to myself"
Plan: ONE local_command step (resolve filename via shell pipeline) -> ONE local_command step (read its content) -> ONE integration step (Gmail send). Three steps total. No browser. The first command uses bash -c to chain ls + head + xargs into a single argv. The second pipes the captured filename into cat. The integration uses google-workspace.send_email_simple with the authenticated email as both to and from.
Example argv for "find latest .txt": ["bash","-c","ls -t ~/Downloads/*.txt | head -n 1"]
Example argv for "read its content": ["bash","-c","cat \\"$(ls -t ~/Downloads/*.txt | head -n 1)\\""]

Goal: "Fetch the current weather in Lisbon and post it to our #general Slack channel"
Plan: ONE api_call (https://api.open-meteo.com/...) -> ONE integration step (slack.post_message). Two steps. No auth on the weather API.

Goal: "Add Maria Silva as a new client to the CRM with email maria@example.com"
Plan: ONE ekoa_action step. artifactSlug="my-crm" (or whichever slug matches), capabilityName="add_client", inputs={"name":"Maria Silva","email":"maria@example.com"}. ZERO browser, ZERO integration.

Goal: "When a new client signs up, create CRM entry, send a welcome email, log it in Notion"
Plan: ONE ekoa_action (CRM.add_client) -> ONE integration (google-workspace.send_email_simple) -> ONE integration (notion.create_page). Three deterministic steps.

Goal: "Find all PDFs in ~/Documents modified this week"
Plan: ONE local_command with argv ["bash","-c","find ~/Documents -name '*.pdf' -mtime -7"]. One step. Plain text result.

Goal: "Run the test suite in my project and tell me what failed"
Plan: ONE local_command with argv ["npm","test"] and cwd set to the project (or use bash -c with the test command). One step. Outcome verification reads exit code + stderr.

Goal: "Click the export button on this Google Docs"
Plan: browser step + verify. Browser is correct here — operating on Google Docs UI for an action with no integration coverage.

Goal: "Send an email via Gmail"
Plan: integration step using google-workspace.send_email_simple (when google-workspace is connected). NEVER browser/navigate to mail.google.com.

Goal: "Fetch the latest commits from octocat/hello-world on GitHub"
Plan: ONE api_call step. method=GET, url=https://api.github.com/repos/octocat/hello-world/commits. No auth needed for public repos. (If user has a github integration connected for higher rate limits, use authIntegrationKey="github".)`;

// ============================================================================
// Public API
// ============================================================================

export async function planFromGoal(input: PlanFromGoalInput): Promise<PlanFromGoalResult> {
  const catalogSection = formatCatalogForPrompt(input.catalog);
  const appOrigin = loadAutomationConfig().appOrigin;

  const baseUserText =
    `## Goal\n${input.goal}\n\n` +
    `## Ekoa app origin\n${appOrigin}\n(Use this as the base for any navigate/browser step that opens the Ekoa app or one of its artifacts, e.g. ${appOrigin}/apps/<slug>/. Never hardcode a host or port.)\n\n` +
    (catalogSection ? `${catalogSection}\n\n` : '') +
    (input.automationName ? `## Working title\n${input.automationName}\n\n` : '');

  // Pass 1
  let firstResult = await callPlannerOnce(input, baseUserText + `Return the JSON plan now.`);
  if (firstResult.status === 'unavailable') {
    // An outage is not a validation failure — violation feedback cannot fix it. One plain
    // immediate retry, then surface the outage as-is.
    console.warn(`[planner] model unavailable (pass 1): ${firstResult.detail} — one plain retry`);
    firstResult = await callPlannerOnce(input, baseUserText + `Return the JSON plan now.`);
    if (firstResult.status === 'unavailable') return firstResult;
  }
  if (firstResult.status === 'awaiting_integration') return firstResult;
  // A pass-1 FAILURE (unparseable / invalid model output) feeds the corrective retry the same way a
  // cross-validation violation does — the feedback is what makes the retry actually fix it (F29).
  const firstViolations = firstResult.status === 'failed'
    ? firstResult.violations
    : crossValidatePlan(firstResult, input.goal, input.catalog);
  if (firstResult.status === 'ok' && firstViolations.length === 0) {
    return firstResult;
  }

  // Pass 2 — single retry with violation-specific feedback. Generic
  // retries produce identical garbage; the feedback is what makes the
  // retry actually fix the problem.
  console.warn(
    `[planner] plan rejected (pass 1), retrying with violations:\n${firstViolations.map((v) => `- ${v}`).join('\n')}`,
  );
  const feedbackSection =
    `## Plan rejected — fix these violations and re-emit:\n` +
    firstViolations.map((v) => `- ${v}`).join('\n') +
    `\n\nRe-emit the FULL plan, with these issues fixed. Same JSON shape as before.`;
  const secondResult = await callPlannerOnce(
    input,
    baseUserText + feedbackSection + `\n\nReturn the corrected JSON plan now.`,
  );
  if (secondResult.status === 'unavailable') return secondResult; // outage mid-flow — never a plan_failed
  if (secondResult.status === 'awaiting_integration') return secondResult;
  if (secondResult.status === 'failed') return secondResult;
  const secondViolations = crossValidatePlan(secondResult, input.goal, input.catalog);
  if (secondViolations.length === 0) {
    return secondResult;
  }
  // Structured failure — surface the violations to the user (as a `plan_failed` wire plan) rather
  // than silently shipping a malformed plan, and rather than throwing an Error the route masks as
  // a 500 (F29).
  return { status: 'failed', violations: secondViolations };
}

async function callPlannerOnce(input: PlanFromGoalInput, userText: string): Promise<PlanFromGoalResult> {
  // The automation kind's content sections lead; the inline PLANNER_SYSTEM (the JSON shape
  // contract) stays LAST so the output contract is the final word. Content is never fatal.
  const sections = await automationContentSections(input.userId);
  const systemPrompt = [...sections, PLANNER_SYSTEM].filter(Boolean).join('\n\n');

  let res: { text: string };
  try {
    res = await runOneShot(
      { prompt: userText, systemPrompt, decision: decideForTier('EXPERT') },
      { kind: 'user_work', agentType: 'automation-plan', billeeUserId: input.userId },
    );
  } catch (err) {
    // A deliberate abort (budget/cancel) keeps its typed error — the route owns that mapping.
    if (err instanceof LlmAbortedError) throw err;
    // Transport/credential failure: an OUTAGE (see PlanFromGoalUnavailable) — never mapped to
    // the "invalid plan" family that tells the user to rephrase the goal.
    return { status: 'unavailable', detail: err instanceof Error ? err.message : String(err) };
  }

  if (res.text.trim() === '') {
    // Empty text is the transport failing quietly (dead credential, clamped model refusing),
    // not the model emitting a bad plan.
    return { status: 'unavailable', detail: 'empty model response' };
  }

  const parsed = parseFirstJsonObject(res.text);
  if (!parsed) {
    return { status: 'failed', violations: [`o modelo não devolveu um plano em JSON válido: ${res.text.slice(0, 120)}`] };
  }
  const validated = validatePlanOutput(parsed);
  if (validated.status === 'failed') {
    // Server-side only (violations can quote raw model output — never sent to the client):
    // the raw text is the ONLY way to diagnose a live shape mismatch.
    console.warn(`[planner] model text on validation failure (server-side diagnostic):\n${res.text.slice(0, 800)}`);
  }
  return validated;
}

// ============================================================================
// Validation
// ============================================================================

const VALID_STEP_TYPES: ReadonlySet<StepType> = new Set([
  'browser', 'verify', 'integration', 'sub_automation', 'navigate', 'wait',
  'local_command', 'api_call', 'ekoa_action',
]);

function validatePlanOutput(value: unknown): PlanFromGoalResult {
  // F29: an unusable model output is a STRUCTURED `failed`, never a thrown Error the route masks
  // as a 500. Each `fail` is a user-surfaceable violation string.
  const fail = (msg: string): PlanFromGoalFailed => ({ status: 'failed', violations: [msg] });
  if (!value || typeof value !== 'object') {
    return fail('a saída do modelo não é um objeto de plano');
  }
  const obj = value as Record<string, unknown>;

  if (obj.status === 'awaiting_integration') {
    return {
      status: 'awaiting_integration',
      service: typeof obj.service === 'string' ? obj.service : 'unknown',
      reason: typeof obj.reason === 'string' ? obj.reason : '',
    };
  }

  if (obj.status !== 'ok') {
    return fail(`o modelo devolveu um estado inesperado: ${String(obj.status)}`);
  }

  const stepsRaw = obj.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    return fail('o plano do modelo não tem passos');
  }

  let steps: Step[];
  try {
    steps = stepsRaw.map((s, i) => normaliseStep(s, i));
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'passo inválido no plano do modelo');
  }

  const inputs = Array.isArray(obj.inputs) ? obj.inputs : [];
  const inputSchema: { fields: AutomationInputField[] } | undefined = inputs.length > 0
    ? {
        fields: inputs
          .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
          .map((f) => ({
            name: typeof f.name === 'string' ? f.name : 'input',
            description: typeof f.description === 'string' ? f.description : '',
            required: f.required === true,
            defaultValue: typeof f.defaultValue === 'string' ? f.defaultValue : undefined,
          })),
      }
    : undefined;

  return {
    status: 'ok',
    name: typeof obj.name === 'string' && obj.name.trim().length > 0 ? obj.name.trim() : 'Automation',
    description: typeof obj.description === 'string' ? obj.description : '',
    inputSchema,
    steps,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
  };
}

function normaliseStep(value: unknown, index: number): Step {
  if (!value || typeof value !== 'object') {
    throw new Error(`step ${index} is not an object`);
  }
  const s = value as Record<string, unknown>;
  const type = s.type as StepType;
  if (typeof type !== 'string' || !VALID_STEP_TYPES.has(type)) {
    throw new Error(`step ${index} has invalid type: ${String(type)}`);
  }
  const id = typeof s.id === 'string' && s.id.length > 0 ? s.id : `step-${index}-${randomUUID().slice(0, 6)}`;
  const description = typeof s.description === 'string' ? s.description : '';
  const expectedOutcome = typeof s.expectedOutcome === 'string' ? s.expectedOutcome : undefined;

  const step: Step = { id, description, type, expectedOutcome };

  if (type === 'navigate' && typeof s.url === 'string') step.url = s.url;
  if (type === 'wait' && typeof s.durationMs === 'number') step.durationMs = s.durationMs;
  if (type === 'integration') {
    if (typeof s.integrationKey === 'string') step.integrationKey = s.integrationKey;
    if (typeof s.integrationAction === 'string') step.integrationAction = s.integrationAction;
    if (s.argsTemplate && typeof s.argsTemplate === 'object') {
      step.argsTemplate = sanitiseArgsTemplate(s.argsTemplate as Record<string, unknown>);
    }
  }
  if (type === 'sub_automation') {
    if (typeof s.subAutomationId === 'string') step.subAutomationId = s.subAutomationId;
    if (s.argsTemplate && typeof s.argsTemplate === 'object') {
      step.argsTemplate = sanitiseArgsTemplate(s.argsTemplate as Record<string, unknown>);
    }
  }

  if (type === 'local_command' && s.commandTemplate && typeof s.commandTemplate === 'object') {
    const ct = s.commandTemplate as Record<string, unknown>;
    if (Array.isArray(ct.argv) && ct.argv.every((a) => typeof a === 'string')) {
      step.commandTemplate = {
        argv: ct.argv as string[],
        cwd: typeof ct.cwd === 'string' ? ct.cwd : undefined,
        timeoutMs: typeof ct.timeoutMs === 'number' ? ct.timeoutMs : undefined,
        stdin: typeof ct.stdin === 'string' ? ct.stdin : undefined,
        envWhitelist: Array.isArray(ct.envWhitelist) ? (ct.envWhitelist as string[]).filter((v) => typeof v === 'string') : undefined,
      };
    }
  }

  if (type === 'api_call' && s.apiRequest && typeof s.apiRequest === 'object') {
    const a = s.apiRequest as Record<string, unknown>;
    if (typeof a.method === 'string' && typeof a.url === 'string') {
      step.apiRequest = {
        method: a.method as import('./types.js').ApiCallMethod,
        url: a.url,
        headers: a.headers && typeof a.headers === 'object'
          ? Object.fromEntries(Object.entries(a.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string>
          : undefined,
        body: typeof a.body === 'string' ? a.body : undefined,
        bodyKind: typeof a.bodyKind === 'string' ? a.bodyKind as import('./types.js').ApiCallBodyKind : undefined,
        timeoutMs: typeof a.timeoutMs === 'number' ? a.timeoutMs : undefined,
        authIntegrationKey: typeof a.authIntegrationKey === 'string' ? a.authIntegrationKey : undefined,
      };
    }
  }

  if (type === 'ekoa_action' && s.ekoaAction && typeof s.ekoaAction === 'object') {
    const e = s.ekoaAction as Record<string, unknown>;
    if (typeof e.artifactSlug === 'string' && typeof e.capabilityName === 'string') {
      step.ekoaAction = {
        artifactSlug: e.artifactSlug,
        capabilityName: e.capabilityName,
        inputs: e.inputs && typeof e.inputs === 'object' ? (e.inputs as Record<string, unknown>) : {},
      };
    }
  }

  // Optional planner-authored deterministic assertion (verify steps).
  // Drop silently if malformed — the verify step still works via vision.
  if (type === 'verify' && s.cachedAssertion && typeof s.cachedAssertion === 'object') {
    const assertion = sanitiseCachedAssertion(s.cachedAssertion as Record<string, unknown>);
    if (assertion) step.cachedAssertion = assertion;
  }

  return step;
}

const VALID_ASSERTION_KINDS: ReadonlySet<string> = new Set([
  'expect_visible', 'expect_hidden', 'expect_text', 'expect_url', 'expect_title',
]);

const VALID_LOCATOR_STRATEGIES: ReadonlySet<string> = new Set([
  'role', 'text', 'label', 'placeholder', 'testid', 'css', 'altText', 'title',
]);

function sanitiseCachedAssertion(raw: Record<string, unknown>): PlaywrightAssertion | undefined {
  const kind = raw.kind;
  if (typeof kind !== 'string' || !VALID_ASSERTION_KINDS.has(kind)) return undefined;

  if (kind === 'expect_url') {
    if (typeof raw.pattern !== 'string' || raw.pattern.length === 0) return undefined;
    return { kind: 'expect_url', pattern: raw.pattern };
  }
  if (kind === 'expect_title') {
    if (typeof raw.contains !== 'string' || raw.contains.length === 0) return undefined;
    return { kind: 'expect_title', contains: raw.contains };
  }

  // expect_visible / expect_hidden / expect_text — locator required.
  const locator = sanitiseLocator(raw.locator);
  if (!locator) return undefined;

  if (kind === 'expect_text') {
    if (typeof raw.contains !== 'string' || raw.contains.length === 0) return undefined;
    return { kind: 'expect_text', locator, contains: raw.contains };
  }
  return { kind: kind as 'expect_visible' | 'expect_hidden', locator };
}

function sanitiseLocator(raw: unknown): Locator | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const l = raw as Record<string, unknown>;
  const strategy = l.strategy;
  if (typeof strategy !== 'string' || !VALID_LOCATOR_STRATEGIES.has(strategy)) return undefined;
  switch (strategy) {
    case 'role': {
      if (typeof l.role !== 'string') return undefined;
      const out: Locator = { strategy: 'role', role: l.role };
      if (typeof l.name === 'string') (out as { name?: string }).name = l.name;
      if (typeof l.exact === 'boolean') (out as { exact?: boolean }).exact = l.exact;
      return out;
    }
    case 'text':
    case 'label':
      return typeof l.value === 'string'
        ? { strategy, value: l.value, exact: typeof l.exact === 'boolean' ? l.exact : undefined } as Locator
        : undefined;
    case 'placeholder':
    case 'testid':
    case 'altText':
    case 'title':
      return typeof l.value === 'string' ? ({ strategy, value: l.value } as Locator) : undefined;
    case 'css':
      return typeof l.selector === 'string' ? { strategy: 'css', selector: l.selector } : undefined;
    default:
      return undefined;
  }
}

function sanitiseArgsTemplate(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

// ============================================================================
// Cross-validation — deterministic checks that catch malformed plans before
// they reach the engine. Runs after validatePlanOutput. Returns a list of
// human-readable violations; empty array means the plan is OK. Each
// violation is phrased as feedback to the planner LLM for the retry.
// ============================================================================

/**
 * Tokens that, when they appear in a browser/navigate step description,
 * imply the planner mixed up the step type. The check is intentionally
 * generous — false positives just trigger one retry, which is cheap.
 */
const INTEGRATION_NAME_PATTERNS: Array<{ token: RegExp; integrationKey: string; serviceLabel: string }> = [
  { token: /\b(gmail|google\s+workspace|google\s+mail)\b/i, integrationKey: 'google-workspace', serviceLabel: 'Gmail' },
  { token: /\b(google\s+calendar)\b/i, integrationKey: 'google-workspace', serviceLabel: 'Google Calendar' },
  { token: /\b(google\s+drive)\b/i, integrationKey: 'google-workspace', serviceLabel: 'Google Drive' },
  { token: /\b(microsoft\s*365|outlook|office\s*365)\b/i, integrationKey: 'microsoft-365', serviceLabel: 'Microsoft 365' },
  { token: /\b(slack)\b/i, integrationKey: 'slack', serviceLabel: 'Slack' },
];

/**
 * Hosts that are forbidden in browser/navigate steps when the matching
 * platform integration is connected. The engine's cross-origin gate
 * also catches drift at runtime; this check stops the planner from
 * authoring it in the first place.
 */
const HOST_TO_INTEGRATION_KEY: Array<{ hostPattern: RegExp; integrationKey: string; serviceLabel: string }> = [
  { hostPattern: /\b(mail\.google\.com|gmail\.com)\b/i, integrationKey: 'google-workspace', serviceLabel: 'Gmail' },
  { hostPattern: /\b(outlook\.office\.com|outlook\.live\.com|outlook\.office365\.com)\b/i, integrationKey: 'microsoft-365', serviceLabel: 'Outlook' },
  { hostPattern: /\bapp\.slack\.com\b/i, integrationKey: 'slack', serviceLabel: 'Slack' },
];

/**
 * Multilingual email-send intent regexes for the goal text. Used by the
 * capability-coverage check to detect "the user asked to send an email"
 * regardless of language.
 */
const EMAIL_SEND_INTENT_PATTERNS: RegExp[] = [
  /\bsend(?:ing)?\s+(?:an?\s+)?(?:e-?mail|message)\b/i,
  /\b(?:e-?mail|message)\s+(?:her|him|them|me|us|to)\b/i,
  /\benvi(?:a|ar|e|ando)\s+(?:um\s+)?(?:e-?mail|mensagem)\b/i,
  /\bmandar\s+(?:um\s+)?(?:e-?mail|mensagem)\b/i,
  /\benvoyer\s+(?:un\s+)?(?:e-?mail|message|courriel)\b/i,
  /\benviar\s+(?:un\s+)?(?:correo|e-?mail|mensaje)\b/i,
];

/** Email-capable integration action names by integrationKey. */
const EMAIL_ACTION_NAMES: Record<string, ReadonlySet<string>> = {
  'google-workspace': new Set(['send_email', 'send_email_simple']),
  'microsoft-365': new Set(['send_email', 'send_email_simple']),
};

export function crossValidatePlan(
  result: PlanFromGoalSuccess,
  goal: string,
  catalog: Catalog,
): string[] {
  const violations: string[] = [];

  // Check 1 — integration-capture mismatch. Browser/navigate steps with
  // descriptions that name an integration whose connected account is
  // available in the catalog.
  const connectedKeys = new Set(catalog.connectedAccounts.map((a) => a.integrationKey));
  for (let i = 0; i < result.steps.length; i++) {
    const step = result.steps[i]!;
    if (step.type !== 'browser' && step.type !== 'navigate') continue;

    // 1a. integration-name token in description
    for (const { token, integrationKey, serviceLabel } of INTEGRATION_NAME_PATTERNS) {
      if (!token.test(step.description)) continue;
      if (!connectedKeys.has(integrationKey)) continue;
      const actionHint = pickActionHintForGoal(goal, integrationKey, catalog);
      violations.push(
        `Step ${i + 1} (id="${step.id}") has type="${step.type}" but the description says "${shorten(step.description)}" — that names ${serviceLabel}, which is connected as integration "${integrationKey}". ` +
          `Change the step's type to "integration" with integrationKey="${integrationKey}"${actionHint ? ` and integrationAction="${actionHint}"` : ''}, or remove the integration reference. Browser-driven ${serviceLabel} use is forbidden when the integration is connected.`,
      );
    }

    // 1b. forbidden host in URL (navigate) or in description (browser)
    const haystack = `${step.description} ${step.url ?? ''}`.toLowerCase();
    for (const { hostPattern, integrationKey, serviceLabel } of HOST_TO_INTEGRATION_KEY) {
      if (!hostPattern.test(haystack)) continue;
      if (!connectedKeys.has(integrationKey)) continue;
      const actionHint = pickActionHintForGoal(goal, integrationKey, catalog);
      violations.push(
        `Step ${i + 1} (id="${step.id}") with type="${step.type}" targets a ${serviceLabel} host whose integration "${integrationKey}" is connected. ` +
          `Replace it with one integration step using integrationKey="${integrationKey}"${actionHint ? ` and integrationAction="${actionHint}"` : ''}.`,
      );
    }
  }

  // Check 1c — file:/// URLs are NEVER allowed in browser/navigate
  // steps. Chromium doesn't render directory listings reliably; the
  // planner must use local_command for filesystem operations.
  for (let i = 0; i < result.steps.length; i++) {
    const step = result.steps[i]!;
    if (step.type === 'navigate' && typeof step.url === 'string' && /^file:\/\//i.test(step.url)) {
      violations.push(
        `Step ${i + 1} (id="${step.id}") navigates to a file:// URL ("${step.url}"). Browser steps cannot reliably operate on local files. Replace with a local_command step using argv like ["bash","-c","ls -la ~/Downloads"] or ["cat","~/path/file"].`,
      );
    }
    if ((step.type === 'browser' || step.type === 'navigate') && /(\/users\/[^/]+\/(downloads|documents|desktop)|file:\/\/)/i.test(step.description)) {
      violations.push(
        `Step ${i + 1} (id="${step.id}") with type="${step.type}" references a local filesystem path. Browser cannot read local files. Use type="local_command" with argv to read or list files.`,
      );
    }
  }

  // Check 1d — local_command steps must have a valid argv array.
  for (let i = 0; i < result.steps.length; i++) {
    const step = result.steps[i]!;
    if (step.type !== 'local_command') continue;
    const argv = step.commandTemplate?.argv;
    if (!Array.isArray(argv) || argv.length === 0) {
      violations.push(
        `Step ${i + 1} (id="${step.id}") is type="local_command" but commandTemplate.argv is missing/empty. Provide argv:["executable","arg1","arg2",...].`,
      );
      continue;
    }
    // Shell metacharacters in argv args (other than bash -c context) are a planner mistake — they won't be interpreted by spawn(shell:false).
    if (!(argv[0] === 'bash' || argv[0] === 'sh' || argv[0] === 'zsh') || argv[1] !== '-c') {
      for (let j = 1; j < argv.length; j++) {
        if (/[|<>;&]/.test(argv[j]!)) {
          violations.push(
            `Step ${i + 1} (id="${step.id}") argv[${j}]="${argv[j]}" contains shell metacharacters (|<>;&). These are NOT interpreted by spawn(shell:false). Either remove the shell syntax, or wrap the whole script: argv=["bash","-c","<your script>"].`,
          );
          break;
        }
      }
    }
  }

  // Check 1e — api_call steps must not have raw auth headers.
  for (let i = 0; i < result.steps.length; i++) {
    const step = result.steps[i]!;
    if (step.type !== 'api_call') continue;
    const headers = step.apiRequest?.headers ?? {};
    for (const [k, v] of Object.entries(headers)) {
      const keyLower = k.toLowerCase();
      const valuePreview = (v as string).slice(0, 50);
      const isAuthShaped = keyLower === 'authorization' || keyLower === 'x-api-key' || keyLower === 'x-auth-token';
      // Allow {{integration.<k>.<f>}} interpolation; reject literal Bearer/token values.
      if (isAuthShaped && !(v as string).includes('{{integration.')) {
        violations.push(
          `Step ${i + 1} (id="${step.id}") sets an auth-shaped header "${k}"="${valuePreview}…" directly. Auth MUST come from an integration: set apiRequest.authIntegrationKey="<key>" and reference credentials as "{{integration.<key>.<field>}}". Never put raw tokens in headers.`,
        );
      }
    }
  }

  // Check 2 — capability coverage. Email-send intent in goal + email
  // integration connected + no integration step using a send_email
  // action -> the plan is browser-driving the send, which is forbidden.
  const goalAsksToSendEmail = EMAIL_SEND_INTENT_PATTERNS.some((re) => re.test(goal));
  if (goalAsksToSendEmail) {
    const connectedEmailAccounts = catalog.connectedAccounts.filter((a) =>
      EMAIL_ACTION_NAMES[a.integrationKey] !== undefined,
    );
    if (connectedEmailAccounts.length > 0) {
      const hasIntegrationSend = result.steps.some(
        (s) =>
          s.type === 'integration' &&
          s.integrationKey !== undefined &&
          s.integrationAction !== undefined &&
          EMAIL_ACTION_NAMES[s.integrationKey]?.has(s.integrationAction) === true,
      );
      if (!hasIntegrationSend) {
        const acc = connectedEmailAccounts[0]!;
        const preferredAction = catalog.integrationActions.some(
          (a) => a.integrationKey === acc.integrationKey && a.actionName === 'send_email_simple',
        )
          ? 'send_email_simple'
          : 'send_email';
        violations.push(
          `The goal asks to send an email and ${acc.integrationKey} is connected as ${acc.email}, but no integration step uses ${acc.integrationKey}.send_email_simple / send_email. ` +
            `Add one integration step with integrationKey="${acc.integrationKey}", integrationAction="${preferredAction}", and the appropriate argsTemplate. Do NOT browser-drive Gmail / Outlook composition when the integration is connected.`,
        );
      }
    }
  }

  return violations;
}

/** Best guess at the action the planner should call given the goal text. */
function pickActionHintForGoal(goal: string, integrationKey: string, catalog: Catalog): string | undefined {
  const isEmailGoal = EMAIL_SEND_INTENT_PATTERNS.some((re) => re.test(goal));
  if (!isEmailGoal) return undefined;
  const actions = catalog.integrationActions.filter((a) => a.integrationKey === integrationKey);
  if (actions.some((a) => a.actionName === 'send_email_simple')) return 'send_email_simple';
  if (actions.some((a) => a.actionName === 'send_email')) return 'send_email';
  return undefined;
}

function shorten(s: string, max = 80): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
