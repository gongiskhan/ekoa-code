/**
 * Vision-grounded action resolution for the automation engine (carryover-audit B10; old home
 * `services/vision.ts`).
 *
 * On cache miss (or cache failure), the engine sends the current page screenshot plus the step's
 * natural-language description to Claude vision. The model returns a deterministic Playwright
 * action that the executor can run. The engine caches the result for future runs. Same path for
 * outcome verification: send screenshot + expected outcome, get pass/fail and (on first pass) a
 * cacheable assertion.
 *
 * Re-pointing (B10): the old `callSimpleLlm` seam is replaced by the ekoa-code chokepoint
 * `runOneShot` (api/src/llm/). Routing is PINNED to the EXPERT tier at maximum effort — `high` is
 * the top effort the rebuilt tier config exposes (config.ts LlmTierConfig), and there is NO
 * tier escalation (invisible-behaviors §13.2). resolve/verify are `user_work` billed to the run
 * owner; the human-action tail-catcher is a FAST `classifier`. Images ride the SdkCallParams
 * base64 path (§5.4.4). JSON parsing/validation port unchanged.
 */

import { runOneShot, decideForTier } from '../llm/index.js';
import { parseFirstJsonObject } from '../services/json-extract.js';
import type {
  Locator,
  PlaywrightAction,
  PlaywrightAssertion,
} from './types.js';

// ============================================================================
// Inputs / outputs
// ============================================================================

export type VisionTier = 'workhorse' | 'expert';

export interface ResolveActionInput {
  stepDescription: string;
  expectedOutcome?: string;
  screenshotPng: Buffer;
  pageUrl: string;
  /** Optional accessibility/aria snapshot for grounding. Free-form string. */
  domSummary?: string;
  /** Pre-formatted memory snippets relevant to this automation. */
  scopedMemories: string[];
  /** Legacy field, ignored: the resolver always runs on the EXPERT tier at max effort (§13.2). */
  tier?: VisionTier;
  /** The run owner — billed for this user_work vision call (§5.6.7). */
  userId: string;
  /** Legacy field, ignored: the chokepoint manages its own timeout. */
  timeoutMs?: number;
}

export interface ResolveActionOutput {
  action: PlaywrightAction;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface VerifyOutcomeInput {
  expectedOutcome: string;
  screenshotPng: Buffer;
  pageUrl: string;
  scopedMemories: string[];
  tier?: VisionTier;
  userId: string;
  timeoutMs?: number;
  /**
   * Inputs the run was started without that the verifier should look
   * for on the page (e.g. the goal needs `lawyerEmail` and the verify
   * step is on the lawyer's contact page — extract it). Each entry is
   * a `{name, description}` from the automation's inputSchema. If the
   * page plainly shows a value that matches a target, the verifier
   * returns it in `extractedInputs` and the engine threads it into
   * subsequent steps' argsTemplate interpolation.
   */
  extractTargets?: Array<{ name: string; description: string }>;
}

/**
 * The verifier surfaces "this is a human-action page" directly in its
 * structured output, so the engine can pause for the user without a
 * second LLM round-trip through the fixer. Opus already sees the
 * screenshot — it's far more reliable to ask it explicitly than to
 * regex its prose afterwards.
 */
export type HumanActionKind = 'captcha' | 'mfa' | 'payment' | 'identity' | 'login' | 'other';

export interface HumanActionRequired {
  kind: HumanActionKind;
  /** Shown verbatim in the cyan "Ekoa needs you" bar. */
  userInstructions: string;
}

export interface VerifyOutcomeOutput {
  /**
   * Required commit fields. Forcing the model to label the page's class
   * BEFORE deciding pass/fail measurably reduces "rubber-stamp on
   * unrelated page" hallucinations on Opus. The output validator
   * rejects responses missing them.
   *
   * - `pageClassObserved`: short label for what the page actually is
   *   (e.g. "Gmail compose UI", "Google search results", "Gmail
   *   marketing landing page", "lawyer-website contact page").
   * - `pageClassExpected`: short label for what the outcome implicitly
   *   expected the page to be.
   */
  pageClassObserved: string;
  pageClassExpected: string;
  passed: boolean;
  reasoning: string;
  /** Populated on pass; the engine caches this for next run's deterministic check. */
  cachedAssertion?: PlaywrightAssertion;
  /** Set when the page is in a state only a human can resolve. */
  humanAction?: HumanActionRequired;
  /**
   * Values the verifier read directly off the page that match
   * `extractTargets` from the input. The engine merges these into the
   * run's input map so subsequent steps' `{{input.<name>}}` template
   * references resolve to the discovered value — e.g. the user runs
   * the lawyer-email automation without filling lawyerEmail; the
   * contact-page verifier extracts the visible email and the
   * send_email_simple step uses it.
   */
  extractedInputs?: Record<string, string>;
}

// ============================================================================
// Public API
// ============================================================================

const RESOLVE_ACTION_SYSTEM = `You are the resolver layer of an automation engine. Given a screenshot of a web page and a natural-language description of what the user wants done next, return a single, deterministic Playwright action that executes that intent on this page.

Return ONLY a JSON object in the EXACT shape:

{
  "action": <PlaywrightAction>,
  "reasoning": "one short sentence explaining the choice",
  "confidence": "high" | "medium" | "low"
}

PlaywrightAction is a discriminated union by "kind". One of:

- {"kind":"navigate","url":"https://..."}
- {"kind":"click","locator":<Locator>}
- {"kind":"dblclick","locator":<Locator>}
- {"kind":"fill","locator":<Locator>,"value":"..."}
- {"kind":"press","key":"Enter","locator":<Locator>?}
- {"kind":"select","locator":<Locator>,"value":"..."}
- {"kind":"check","locator":<Locator>}
- {"kind":"uncheck","locator":<Locator>}
- {"kind":"hover","locator":<Locator>}
- {"kind":"wait","durationMs":1000}
- {"kind":"wait_for","locator":<Locator>,"state":"visible"|"hidden"|"attached"|"detached"}
- {"kind":"scroll","direction":"up"|"down","pixels":600}  (or with "locator")
- {"kind":"screenshot"}
- {"kind":"noop","reason":"the page is already in the state this step describes"}

Locator is one of:

- {"strategy":"role","role":"button","name":"Sign in","exact":false}
- {"strategy":"text","value":"Sign in","exact":false}
- {"strategy":"label","value":"Email","exact":false}
- {"strategy":"placeholder","value":"you@example.com"}
- {"strategy":"testid","value":"submit-button"}
- {"strategy":"altText","value":"Logo"}
- {"strategy":"title","value":"Help"}
- {"strategy":"css","selector":"button.primary"}

Locator preference order: role > label > testid > text > placeholder > altText > title > css. Pick the most stable strategy that uniquely identifies the target. Use "css" only as a last resort.

Rules:
- Output exactly one JSON object. No prose before or after. No markdown fences.
- "action" must be a single primitive — no arrays, no compound steps.
- Never invent text that isn't in the screenshot.
- If the step is unambiguous, use confidence "high"; if reasonable but uncertain, "medium"; if guessing, "low".
- If you cannot resolve a deterministic action from the screenshot, return {"kind":"screenshot"} with confidence "low" and explain in reasoning.
- If the page is ALREADY in the state the step is asking for (e.g. the step says "click the Submit button to submit the search" but the page already shows the submitted results — the previous step typed and the form auto-submitted; or the step says "dismiss the cookie banner" but no banner is present), return {"kind":"noop","reason":"<one short sentence>"} with confidence "high". The engine treats noop as a successful no-op and moves on. Don't invent a click on an irrelevant element just because the step mentioned one.
- For SEARCH SUBMISSION (Google search, in-site search, autocomplete-driven inputs) prefer {"kind":"press","key":"Enter","locator":<the search input>} over clicking the submit button. Reason: search inputs almost always show an autocomplete suggestions dropdown that overlays the submit button — clicking the button is blocked by the overlay ("subtree intercepts pointer events"). Pressing Enter on the input dismisses the dropdown and submits the form in one action.
- For LOGIN / SIGN-UP form submission, the same applies — press Enter on the password / last-required field rather than clicking the submit button when the page has any kind of suggestion or validation overlay visible.
- If the page has an obvious DISMISSIBLE OVERLAY (autocomplete suggestions, pop-up dialog, "what's new" tooltip, cookie banner) covering the element you'd click, return {"kind":"press","key":"Escape"} (no locator) so the overlay closes; the engine will run the click on the next attempt.
- NEVER return a click whose target is a FILE UPLOAD INPUT or an icon that opens one (camera/lens icons on Google Images for "search by image", Drive's "Upload file" button, "Choose file" / "Procurar" / "Anexar" buttons next to a file input). The OS file picker that opens cannot be interacted with from JavaScript and will jam the run. If the step plainly requires uploading a file you have no way to source, return {"kind":"screenshot"} with confidence "low" and a reasoning that explains the upload is the blocker — the rehearsal fixer can then re-route.
- If you find yourself on GOOGLE IMAGES (images.google.com, google.com/imghp) when the step description was about plain Google Search, the safer action is {"kind":"navigate","url":"https://www.google.com/search?q=<query>"} directly — clicking buttons on Images often opens the reverse-image-search uploader.`;

const VERIFY_OUTCOME_SYSTEM = `You are the verifier layer of an automation engine. Given a screenshot of a web page and a natural-language expected outcome, decide whether the outcome holds and (if it does) propose a deterministic Playwright assertion that future runs can check without re-asking the model.

Return ONLY a JSON object in the EXACT shape, with the fields ordered EXACTLY as below (commit to a page class label BEFORE deciding pass/fail — do not skip these fields):

{
  "pageClassObserved": "short label for what the page actually is (e.g. 'Gmail compose UI', 'Google search results', 'Gmail marketing landing page', 'lawyer-website contact page', 'sign-in form', 'CAPTCHA challenge')",
  "pageClassExpected": "short label for the page class the outcome implicitly expects (e.g. 'Gmail compose UI with To/Subject/Body fields', 'search-results page listing the query')",
  "passed": true | false,
  "reasoning": "one short sentence explaining the decision",
  "cachedAssertion": <PlaywrightAssertion> | null,
  "humanAction": null | {
    "kind": "captcha" | "mfa" | "payment" | "identity" | "login" | "other",
    "userInstructions": "plain-English Post-it telling the user exactly what to do in the headed browser, then click Continue"
  },
  "extractedInputs": null | { "<name>": "<value-as-shown-on-page>", ... }
}

extractedInputs (CRITICAL when "Extract targets" appears in the user message):

The user message may include an "Extract targets" section listing fields the run started without that should be filled in from page content if visible. For each target whose value is plainly readable on the page (e.g. an email address in a contact section, a phone number in a footer), include it in extractedInputs keyed by the target's name. Read VERBATIM — never reformat, normalize, or guess. If a target isn't visible on the page, omit it from extractedInputs (don't include null entries). If no targets are listed, set extractedInputs to null.

Examples:
- Targets: [{name: "lawyerEmail", description: "the lawyer's contact email"}]; page shows "Email: maria@example.pt" -> extractedInputs: {"lawyerEmail": "maria@example.pt"}.
- Same target, page shows no email -> extractedInputs: null.

If pageClassObserved and pageClassExpected refer to fundamentally different kinds of page, set "passed": false regardless of any visual fragments that might resemble the outcome (e.g. a marketing landing page that happens to have a search box is NOT a Gmail compose UI; do not pass on it).

PlaywrightAssertion is a discriminated union by "kind". One of:

- {"kind":"expect_visible","locator":<Locator>}
- {"kind":"expect_hidden","locator":<Locator>}
- {"kind":"expect_text","locator":<Locator>,"contains":"..."}
- {"kind":"expect_url","pattern":"/inbox"}
- {"kind":"expect_title","contains":"Inbox"}

Locator strategies (preference order): role > label > testid > text > placeholder > altText > title > css.

Rules:
- Output exactly one JSON object. No prose before or after.
- Set "passed" strictly: true only if the screenshot clearly satisfies the expected outcome.
- Set "cachedAssertion" only when "passed" is true. Pick the most discriminating, most stable assertion: a visible heading, a URL substring, a title token. Avoid asserting on text that is timestamp-like or session-specific.
- If "passed" is false, set "cachedAssertion" to null.

humanAction (CRITICAL — populate this field aggressively whenever the page is a known human-only state. It is the SINGLE MOST IMPORTANT signal you produce. If you populate humanAction, the engine pauses and asks the user — perfect outcome. If you don't, the user gets a confusing failure and is stuck. WHEN IN DOUBT, POPULATE IT.):

The browser the engine drives is HEADED and visible to the user. They are at their machine and can interact with the page. Whenever the screenshot shows a state only a human can pass — and where the rest of the plan would work fine afterwards — set humanAction so the engine pauses and asks the user, instead of failing the run. This applies regardless of "passed":

- "captcha": ANY page asking the user to prove they're human. Includes: reCAPTCHA, hCaptcha, Cloudflare / Akamai bot-checks, "I'm not a robot", "Não sou um robô" (Portuguese), "Soy humano" (Spanish), "Je ne suis pas un robot" (French), image-grid challenges, slider puzzles, "press and hold" challenges, Google "/sorry/" pages, any "we have detected unusual traffic" / "tráfego incomum" page, any "before you continue" page that gates browsing on a check, ANY page where a checkbox / button / puzzle is the user's job.
- "mfa": SMS code entry, authenticator app code, security key, email-link verification, push-notification approval.
- "payment": 3-D Secure / SCA, banking step-up, "confirm this payment", "approve this transaction".
- "identity": "verify it's you", "is this you?", "trusted device", "unusual activity / sign-in", account-recovery checks.
- "login": password / sign-in prompt for a credential we don't have stored.
- "other": any other clearly-human-only step the page is asking for.

userInstructions is shown VERBATIM in the UI as a Post-it to the user. Write it like a clear instruction in the language of the page when possible. Examples:
- "Solve the reCAPTCHA in the open browser window, then click Continue."
- "Marque a caixa 'Não sou um robô' na janela aberta do navegador, depois clique em Continuar."
- "Open your authenticator app, type the 6-digit code in the open browser, then click Continue."
- "Approve the payment on the 3-D Secure screen, then click Continue."

If the screenshot does NOT show a human-action page, set humanAction to null. But if you see ANY of: a CAPTCHA widget, a "verify you are human" prompt, an "unusual traffic" / "/sorry/" page, an MFA / OTP entry, a 3-D Secure screen, an "is this you?" identity check, or a sign-in form — set humanAction. Don't second-guess this — the engine knows what to do with the signal.`;

export async function resolvePlaywrightAction(input: ResolveActionInput): Promise<ResolveActionOutput> {
  void input.tier; // legacy field; resolver always runs on EXPERT at max effort
  void input.timeoutMs; // the chokepoint manages its own timeout

  const memorySection = input.scopedMemories.length > 0
    ? `## Relevant memory for this automation\n${input.scopedMemories.map(m => `- ${m}`).join('\n')}\n\n`
    : '';
  const expectedSection = input.expectedOutcome
    ? `## Expected outcome after this step\n${input.expectedOutcome}\n\n`
    : '';
  const domSection = input.domSummary
    ? `## Accessibility summary\n${input.domSummary.slice(0, 4000)}\n\n`
    : '';

  const userText =
    `Page URL: ${input.pageUrl}\n\n` +
    memorySection +
    `## Step description\n${input.stepDescription}\n\n` +
    expectedSection +
    domSection +
    `Return the JSON action object now.`;

  const res = await runOneShot(
    {
      prompt: userText,
      systemPrompt: RESOLVE_ACTION_SYSTEM,
      decision: decideForTier('EXPERT'),
      images: [{ mediaType: 'image/png', data: input.screenshotPng.toString('base64') }],
    },
    { kind: 'user_work', agentType: 'vision-resolve', billeeUserId: input.userId },
  );

  const parsed = parseFirstJsonObject(res.text);
  if (!parsed) {
    throw new Error(`vision resolver returned non-JSON output: ${res.text.slice(0, 200)}`);
  }
  return validateResolveActionOutput(parsed);
}

const VALID_HUMAN_ACTION_KINDS: ReadonlySet<string> = new Set([
  'captcha', 'mfa', 'payment', 'identity', 'login', 'other',
]);

// ============================================================================
// FAST-tier human-action classifier (third-pass fallback)
// ============================================================================

const HUMAN_ACTION_CLASSIFIER_SYSTEM = `You are a fast classifier for an automation engine. You are shown a screenshot of a web page. Your job: decide whether the page is in a state that a HUMAN must resolve (CAPTCHA, MFA / OTP, payment confirmation, identity check, login, etc.) before the automation can continue.

Return ONLY a JSON object in the EXACT shape:

{
  "humanAction": null | {
    "kind": "captcha" | "mfa" | "payment" | "identity" | "login" | "other",
    "userInstructions": "plain-English Post-it telling the user exactly what to do in the headed browser, then click Continue"
  }
}

Set humanAction whenever the screenshot shows ANY of:
- A CAPTCHA / reCAPTCHA / hCaptcha widget, "I'm not a robot" / "Não sou um robô" / "Soy humano" checkboxes, image-grid challenges, slider puzzles, "press and hold" challenges, Cloudflare / Akamai / Google bot-checks, "/sorry/" pages, "unusual traffic" / "tráfego incomum" warnings, or any "before you continue" interstitial that gates browsing on a check  -> kind="captcha".
- An MFA / 2FA / OTP / authenticator-app / SMS-code / security-key / email-link prompt -> kind="mfa".
- A 3-D Secure / SCA / banking step-up / "confirm payment" / "approve transaction" screen -> kind="payment".
- A "verify it's you" / "is this you?" / "trusted device" / "unusual sign-in" identity check -> kind="identity".
- A password / sign-in form for a credential we don't have stored -> kind="login".
- Any other clearly-human-only step the page is asking for -> kind="other".

Otherwise set humanAction to null.

userInstructions is shown VERBATIM in the UI as a Post-it to the user. Write it in the language of the page when possible. Examples:
- "Solve the reCAPTCHA in the open browser window, then click Continue."
- "Marque a caixa 'Não sou um robô' na janela aberta do navegador, depois clique em Continuar."
- "Open your authenticator app, type the 6-digit code in the open browser, then click Continue."

Rules:
- Output exactly one JSON object. No prose before or after. No markdown fences.
- Bias toward populating humanAction when in doubt — a false positive merely asks the user to take a quick look; a false negative leaves them stuck.`;

export interface ClassifyHumanActionInput {
  screenshotPng: Buffer;
  pageUrl: string;
  /** Description of the step that just failed — used as soft context. */
  stepContext?: string;
  /** The run owner — billed for this FAST classifier call. */
  userId: string;
}

/**
 * Third-pass fallback: when neither the verifier's structured humanAction field nor the regex on
 * the failure message catches a human-action page, run a fast classifier directly on the fresh
 * screenshot. Cheap and resilient. Returns the parsed classification or null on any error / parse
 * failure. The caller treats null as "no signal, fall through".
 */
export async function classifyHumanAction(
  input: ClassifyHumanActionInput,
): Promise<HumanActionRequired | null> {
  const userText = `Page URL: ${input.pageUrl}\n\n${input.stepContext ? `## Step that just failed\n${input.stepContext}\n\n` : ''}Return the JSON classification now.`;
  let text: string;
  try {
    const res = await runOneShot(
      {
        prompt: userText,
        systemPrompt: HUMAN_ACTION_CLASSIFIER_SYSTEM,
        decision: decideForTier('FAST'),
        images: [{ mediaType: 'image/png', data: input.screenshotPng.toString('base64') }],
      },
      { kind: 'classifier', agentType: 'vision-classify-human-action', billeeUserId: input.userId },
    );
    text = res.text;
  } catch (err) {
    console.warn(`[vision] human-action classifier call failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  const parsed = parseFirstJsonObject(text);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const ha = obj.humanAction;
  if (!ha || typeof ha !== 'object') return null;
  const haObj = ha as Record<string, unknown>;
  const kind = haObj.kind;
  const userInstructions = haObj.userInstructions;
  if (
    typeof kind !== 'string' ||
    !VALID_HUMAN_ACTION_KINDS.has(kind) ||
    typeof userInstructions !== 'string' ||
    userInstructions.trim().length === 0
  ) {
    return null;
  }
  return {
    kind: kind as HumanActionKind,
    userInstructions: userInstructions.trim(),
  };
}

export async function verifyOutcome(input: VerifyOutcomeInput): Promise<VerifyOutcomeOutput> {
  void input.tier;
  void input.timeoutMs;

  const memorySection = input.scopedMemories.length > 0
    ? `## Relevant memory for this automation\n${input.scopedMemories.map(m => `- ${m}`).join('\n')}\n\n`
    : '';

  const extractTargetsSection =
    input.extractTargets && input.extractTargets.length > 0
      ? `## Extract targets\n` +
        `The run started without these inputs filled. If any of them are plainly visible on the page (an email in a contact block, a phone number in a footer, a name on a profile), include them in extractedInputs.\n` +
        input.extractTargets.map((t) => `- ${t.name}: ${t.description}`).join('\n') +
        `\n\n`
      : '';

  const userText =
    `Page URL: ${input.pageUrl}\n\n` +
    memorySection +
    extractTargetsSection +
    `## Expected outcome\n${input.expectedOutcome}\n\n` +
    `Return the JSON verdict object now.`;

  const res = await runOneShot(
    {
      prompt: userText,
      systemPrompt: VERIFY_OUTCOME_SYSTEM,
      decision: decideForTier('EXPERT'),
      images: [{ mediaType: 'image/png', data: input.screenshotPng.toString('base64') }],
    },
    { kind: 'user_work', agentType: 'vision-verify', billeeUserId: input.userId },
  );

  const parsed = parseFirstJsonObject(res.text);
  if (!parsed) {
    throw new Error(`vision verifier returned non-JSON output: ${res.text.slice(0, 200)}`);
  }
  return validateVerifyOutcomeOutput(parsed);
}

// ============================================================================
// JSON parsing & validation (ported verbatim)
// ============================================================================

// Lenient first-JSON-object extraction — hoisted to services/json-extract.ts (brand research
// parses model JSON the same way). Re-exported so automation callers keep their import path.
export { parseFirstJsonObject };

const VALID_ACTION_KINDS: ReadonlySet<string> = new Set([
  'navigate', 'click', 'dblclick', 'fill', 'press', 'select',
  'check', 'uncheck', 'hover', 'wait', 'wait_for', 'scroll', 'screenshot',
  'noop',
]);

const VALID_ASSERTION_KINDS: ReadonlySet<string> = new Set([
  'expect_visible', 'expect_hidden', 'expect_text', 'expect_url', 'expect_title',
]);

const VALID_LOCATOR_STRATEGIES: ReadonlySet<string> = new Set([
  'role', 'text', 'label', 'placeholder', 'testid', 'css', 'altText', 'title',
]);

function validateLocator(value: unknown): Locator {
  if (!value || typeof value !== 'object') throw new Error('locator must be an object');
  const obj = value as Record<string, unknown>;
  const strategy = obj.strategy;
  if (typeof strategy !== 'string' || !VALID_LOCATOR_STRATEGIES.has(strategy)) {
    throw new Error(`invalid locator strategy: ${String(strategy)}`);
  }
  return obj as unknown as Locator;
}

function validateResolveActionOutput(value: unknown): ResolveActionOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('resolver output must be an object');
  }
  const obj = value as Record<string, unknown>;
  const action = obj.action;
  if (!action || typeof action !== 'object') throw new Error('missing action');
  const actionObj = action as Record<string, unknown>;
  const kind = actionObj.kind;
  if (typeof kind !== 'string' || !VALID_ACTION_KINDS.has(kind)) {
    throw new Error(`invalid action kind: ${String(kind)}`);
  }
  // Strategy validation for kinds that have a locator
  if ('locator' in actionObj && actionObj.locator != null) {
    validateLocator(actionObj.locator);
  }
  const confidence = obj.confidence;
  const validConfidence: ReadonlySet<string> = new Set(['high', 'medium', 'low']);
  return {
    action: action as PlaywrightAction,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
    confidence: typeof confidence === 'string' && validConfidence.has(confidence)
      ? (confidence as 'high' | 'medium' | 'low')
      : 'medium',
  };
}

function validateVerifyOutcomeOutput(value: unknown): VerifyOutcomeOutput {
  if (!value || typeof value !== 'object') throw new Error('verifier output must be an object');
  const obj = value as Record<string, unknown>;

  // pageClassObserved / pageClassExpected are REQUIRED. Forcing the
  // model to commit to a class label before deciding pass/fail
  // measurably reduces "rubber-stamp on unrelated page" hallucinations.
  // Reject the response if either is missing or empty so the engine
  // treats it as a verifier failure (and the fixer re-plans) rather
  // than silently accepting an unstructured verdict.
  const pageClassObserved =
    typeof obj.pageClassObserved === 'string' ? obj.pageClassObserved.trim() : '';
  const pageClassExpected =
    typeof obj.pageClassExpected === 'string' ? obj.pageClassExpected.trim() : '';
  if (!pageClassObserved || !pageClassExpected) {
    throw new Error(
      'verifier output missing required pageClassObserved / pageClassExpected fields',
    );
  }

  const passed = obj.passed === true;
  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';

  // cachedAssertion is OPTIONAL. If the model returns a malformed one
  // (wrong kind, missing locator strategy, garbage shape) we drop the
  // cached assertion silently and keep the pass/fail verdict.
  let cachedAssertion: PlaywrightAssertion | undefined;
  if (passed && obj.cachedAssertion && typeof obj.cachedAssertion === 'object') {
    try {
      const a = obj.cachedAssertion as Record<string, unknown>;
      const kind = a.kind;
      if (typeof kind === 'string' && VALID_ASSERTION_KINDS.has(kind)) {
        // Locator is required for visible/hidden/text assertions; not
        // for url/title. Validate only if present.
        const needsLocator = kind === 'expect_visible' || kind === 'expect_hidden' || kind === 'expect_text';
        if (needsLocator) {
          if (!a.locator) {
            throw new Error(`assertion kind "${kind}" requires a locator`);
          }
          validateLocator(a.locator);
        }
        cachedAssertion = a as unknown as PlaywrightAssertion;
      }
    } catch (err) {
      // Swallow — we keep the verifier's verdict, just no cache write.
      console.warn(`[vision] dropping malformed cachedAssertion: ${err instanceof Error ? err.message : err}`);
    }
  }

  // humanAction is OPTIONAL but, when set, completely changes how the
  // engine handles a non-passing verdict. Validate strictly enough to
  // avoid garbage propagating to the UI; drop silently on malformed
  // shapes (the regex fallback in detectHumanActionable still has a
  // chance to catch the obvious cases).
  let humanAction: HumanActionRequired | undefined;
  if (obj.humanAction && typeof obj.humanAction === 'object') {
    const ha = obj.humanAction as Record<string, unknown>;
    const kind = ha.kind;
    const userInstructions = ha.userInstructions;
    if (
      typeof kind === 'string' &&
      VALID_HUMAN_ACTION_KINDS.has(kind) &&
      typeof userInstructions === 'string' &&
      userInstructions.trim().length > 0
    ) {
      humanAction = {
        kind: kind as HumanActionKind,
        userInstructions: userInstructions.trim(),
      };
    } else if (kind != null || userInstructions != null) {
      console.warn(
        `[vision] dropping malformed humanAction: kind=${String(kind)} instructions=${typeof userInstructions}`,
      );
    }
  }

  // extractedInputs — drop entries that aren't strings; otherwise pass
  // through as-is. Verbatim values from the model; the engine merges
  // them into the run's `inputs` map for subsequent argsTemplate
  // interpolation.
  let extractedInputs: Record<string, string> | undefined;
  if (obj.extractedInputs && typeof obj.extractedInputs === 'object' && !Array.isArray(obj.extractedInputs)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.extractedInputs as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim();
    }
    if (Object.keys(out).length > 0) extractedInputs = out;
  }

  return { pageClassObserved, pageClassExpected, passed, reasoning, cachedAssertion, humanAction, extractedInputs };
}
