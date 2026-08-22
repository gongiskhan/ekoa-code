/**
 * Rehearsal fixer (carryover-audit B9).
 *
 * When the engine runs and a step fails recoverably, the fixer is asked: "given the current page
 * state and the failure, propose a local patch to the plan." Patches are intentionally local —
 * insert_before, replace_current, skip_current, pause_for_user, or abort — so the self-correction
 * loop stays stable. The fixer does not get to rewrite downstream steps.
 *
 * Re-pointing (B9): the old `callSimpleLlm` seam (with its `ImageAttachment` type) is replaced by
 * the ekoa-code chokepoint `runOneShot` (api/src/llm/), `user_work` `automation-rehearse`, billed
 * to the run owner, EXPERT tier at max effort, current screenshot attached. Budget + validation
 * carry unchanged.
 */

import { randomUUID } from 'node:crypto';
import { runOneShot, decideForTier } from '../llm/index.js';
import { integrationFeedbackSections } from './seams.js';
import { parseFirstJsonObject } from './vision.js';
import type {
  FailureKind,
  RehearsalPatch,
  Step,
  StepType,
} from './types.js';

// ============================================================================
// Inputs / outputs
// ============================================================================

export interface ProposePatchInput {
  /** The user's original goal — keeps the fixer aligned with intent. */
  goal: string;
  /** The full current step list. The fixer may only edit at currentIndex. */
  steps: Step[];
  currentIndex: number;
  /** What kind of failure are we recovering from. */
  failureKind: FailureKind;
  /** Free-text error / verifier reasoning. */
  failureMessage: string;
  /** Screenshot at the moment of failure. */
  screenshotPng: Buffer;
  pageUrl: string;
  /** How many patches we've already applied at this same index — caps thrash. */
  patchesAtThisIndex: number;
  /**
   * Trimmed accessibility tree of the page at failure time. Pixels show
   * what's *visible*; the a11y tree shows what's *targetable*. Giving
   * the fixer both means it can pick a step whose locator will actually
   * resolve, instead of guessing names from on-screen text.
   */
  accessibilitySnapshot?: string;
  /** The run owner — billed for this user_work fixer call. */
  userId: string;
}

// ============================================================================
// Public API
// ============================================================================

const FIXER_SYSTEM = `You are the self-correction layer of an automation engine. A step in the plan just failed. Given the current screenshot, the failure reason, and the surrounding plan, propose ONE local patch to the plan so the rehearsal can continue toward the user's goal.

You may only patch the CURRENT step. You cannot rewrite downstream steps. Allowed patches:

- {"patch":"insert_before","newStep":<Step>,"reasoning":"..."}                                  — insert a new step right before the failing one (the original failing step then runs next)
- {"patch":"replace_current","newStep":<Step>,"reasoning":"..."}                                — swap the failing step for a different one
- {"patch":"skip_current","reasoning":"..."}                                                    — drop the failing step entirely
- {"patch":"pause_for_user","reasoning":"...","userInstructions":"plain-English ask to user"}   — pause the run so the human can act in the live browser, then click "Continue"
- {"patch":"abort","reasoning":"..."}                                                           — give up; the plan cannot recover

Step is one of:

- {"id":"<short-slug>","description":"plain English","type":"browser","expectedOutcome":"plain English"?}
- {"id":"...","description":"...","type":"verify","expectedOutcome":"plain English"}
- {"id":"...","description":"...","type":"navigate","url":"https://..."}
- {"id":"...","description":"...","type":"wait","durationMs":2000}

When to use pause_for_user (this is important — most apparent dead-ends are not actually dead-ends):

The browser window the engine drives is HEADED and visible to the user. They are at their machine and can directly interact with the page. Whenever the page is in a state only a human can pass — and where the rest of the plan would work fine afterwards — pause_for_user, don't abort. Specifically:

- CAPTCHA challenges (reCAPTCHA, hCaptcha, "I'm not a robot", "Não sou um robô", image-grid challenges, slider puzzles, anything from Google / Cloudflare / Akamai bot-checks).
- Two-factor / multi-factor authentication codes (SMS, authenticator app, email-link, security key).
- Payment confirmation, 3-D Secure / SCA challenges, banking step-up authentication.
- "Are you sure?" destructive-action confirmations the user might want to verify themselves (delete account, transfer funds).
- Login flows where the user needs to type a password we don't have.
- Any "verify your identity" / "confirm it's you" / "trusted device" prompt.

For pause_for_user, the userInstructions field is shown directly in the UI — write it like a Post-it note to the user. Examples:
- "Solve the CAPTCHA in the open browser window, then click Continue."
- "Open your authenticator app, type the 6-digit code in the open browser, then click Continue."
- "Confirm the payment in the open browser window, then click Continue."

Heuristics for the other patches:

- failureKind="verify_failed" almost always wants insert_before — the page is in an interim state (cookie/consent overlay, intermediate redirect, "what's new" dialog) and you need a step that resolves it. Don't abort just because the verifier was strict.
- failureKind="browser_failed" almost always wants replace_current — the action targeted the wrong element. Rewrite the same intent with a clearer description so the next vision pass picks a different element.
- failureKind="navigate_failed" usually wants replace_current with a different URL or a wait step.
- skip_current is for steps that turned out to be unnecessary on this page (e.g. a "dismiss cookies" step on a site that has none).
- abort is the LAST resort. Only use it when the screenshot makes it clear the goal genuinely cannot be achieved no matter who's at the keyboard (page error, paywalled with no account, removed feature). If a human at the keyboard could resolve it, prefer pause_for_user over abort.

CRITICAL OVERLAY-INTERCEPT PATTERN:

If the failureMessage contains "subtree intercepts pointer events", "intercepts pointer events", or "Timeout … exceeded" on a click action, the target element IS visible and at the right place — but a transparent overlay (autocomplete suggestions, modal dialog, tooltip, "what's new" popup, suggestion dropdown) is covering it. NEVER abort or skip on intercept errors — they ALWAYS have a recovery path:

1. **Form submission?** (search box, login form, anything with an Enter-submittable input.) Replace the click with a press-Enter action on the input itself. Example: instead of "Click the Google Search button", emit a browser step described as "Press Enter on the search input field to submit the search". This dismisses the autocomplete dropdown AND submits in one action.
2. **Modal / dialog overlay?** insert_before a step that closes it: "Press Escape to close the dialog" or "Click the X / Close button on the open dialog", then let the original click run next.
3. **Cookie / consent banner / 'what's new' tooltip covering the target?** insert_before a step to dismiss it ("Click the Reject / Accept button on the cookie banner", "Click Got it on the welcome tooltip").

For the search-button-blocked-by-autocomplete case specifically (Google search, in-site search, anywhere a search input has live suggestions): replace_current with description "Press Enter on the search input to submit the query" — type=browser, expectedOutcome="The search results page loads".

NEVER-UPLOAD PATTERN:

If the failure mentions a "file chooser", "filechooser", "input[type=file]", "OS file picker", or the screenshot shows a native file dialog, the previous step clicked a file-upload input by mistake. Recovery: insert_before a navigate step that returns to a known-good URL for the goal (e.g. https://www.google.com/search?q=<query> for a search task), or replace_current with a description that explicitly bypasses the uploader (e.g. "Type the query in the search box and press Enter — do not click the camera / lens icon"). NEVER abort on a file-picker dead-end; navigation always recovers it.

GOOGLE-IMAGES DRIFT PATTERN:

If the page URL is on images.google.com or google.com/imghp but the step description / goal was about plain Google search, the run drifted into Google Images (which has a totally different UI and a camera icon that opens the file uploader). Recovery: replace_current with a navigate step to https://www.google.com/search?q=<URL-encoded-query> — that bypasses the Images UI entirely and lands on the regular results page. Don't try to click the "Tudo" / "All" tab on Images; it's another browser-step that can fail.

Rules:
- Output exactly one JSON object. No prose before or after. No markdown fences.
- Step descriptions are PLAIN ENGLISH. Never write code, selectors, or DOM structure.
- New step ids must be short lowercase-hyphenated slugs ("dismiss-cookies", "wait-for-redirect").
- Do not invent UI elements that aren't visible in the screenshot.
- If the same patch index has already been retried 3+ times, prefer skip_current, pause_for_user, or abort over another insert/replace — the loop is stuck.
- LANGUAGE: the end user reads European Portuguese. Write the human-facing free-text fields ("reasoning" and, for pause_for_user, "userInstructions") in português de Portugal (pt-PT), regardless of the page's own language. Keep every JSON key and enum value ("patch", step "type", "url", "durationMs") in English, and keep step "description" fields in plain ENGLISH (the resolver that consumes them next expects English) — translate only "reasoning" and "userInstructions".`;

export async function proposePatch(input: ProposePatchInput): Promise<RehearsalPatch> {
  const currentStep = input.steps[input.currentIndex];
  const beforeCtx = input.steps.slice(Math.max(0, input.currentIndex - 3), input.currentIndex);
  const afterCtx = input.steps.slice(input.currentIndex + 1, input.currentIndex + 4);

  const a11ySection = input.accessibilitySnapshot
    ? [
        ``,
        `## Targetable elements (accessibility tree, trimmed)`,
        `Use this to pick a step whose locator will actually resolve. Element names here are exact.`,
        '```',
        input.accessibilitySnapshot.slice(0, 6000),
        '```',
      ]
    : [];

  // S3: the RUN OWNER'S OWN notes about the integration actions this plan reaches. The fixer is the
  // seam where recorded guidance pays best - "this portal shows a consent overlay on first load"
  // turns an abort into an insert_before - and it is the seam the brief's "feedback feeds self-heal"
  // assumption names. Scrubbed and capped inside `integrations/`; owner-scoped by the seam's
  // signature; never fatal, so a repair still happens when the read fails.
  //
  // IT SITS IN THE USER TEXT AND NOT IN `FIXER_SYSTEM`, which is the placement that matters here.
  // This module's own header calls the fixer the most prompt-injectable authoring surface in the
  // engine - it reasons over a failure message and a screenshot that both come from the remote page
  // - so its system prompt is the one thing on the turn that no tenant-authored byte may enter. A
  // note is a person's guidance about a portal, and it goes where the other observations go.
  const feedbackSection = (await integrationFeedbackSections(input.userId))
    .flatMap((section) => [``, section]);

  const userText = [
    `## User goal`,
    input.goal || '(not provided)',
    ``,
    `## Failure`,
    `kind: ${input.failureKind}`,
    `message: ${input.failureMessage}`,
    `page url: ${input.pageUrl}`,
    `patches already applied at this index: ${input.patchesAtThisIndex}`,
    ``,
    `## Plan window (the current step is the one that failed)`,
    ...beforeCtx.map((s, i) => `[${input.currentIndex - beforeCtx.length + i}] ${formatStepLine(s)}`),
    `[${input.currentIndex}] *FAILING* ${formatStepLine(currentStep)}`,
    ...afterCtx.map((s, i) => `[${input.currentIndex + 1 + i}] ${formatStepLine(s)}`),
    ...a11ySection,
    ...feedbackSection,
    ``,
    `Return the JSON patch object now.`,
  ].join('\n');

  const images = [
    { mediaType: 'image/png', data: input.screenshotPng.toString('base64') },
  ];

  const res = await runOneShot(
    {
      prompt: userText,
      systemPrompt: FIXER_SYSTEM,
      decision: decideForTier('EXPERT'),
      images,
    },
    { kind: 'user_work', agentType: 'automation-rehearse', billeeUserId: input.userId },
  );

  const parsed = parseFirstJsonObject(res.text);
  if (!parsed) {
    throw new Error(`fixer returned non-JSON output: ${res.text.slice(0, 200)}`);
  }
  return validatePatch(parsed);
}

// ============================================================================
// Patch application
// ============================================================================

/**
 * Apply a patch to a step list and return the new list. Pure function —
 * the engine decides when to call this and how to thread the result.
 */
export function applyPatch(steps: Step[], currentIndex: number, patch: RehearsalPatch): Step[] {
  const out = steps.slice();
  switch (patch.kind) {
    case 'insert_before':
      out.splice(currentIndex, 0, normaliseInsertedStep(patch.newStep));
      return out;
    case 'replace_current':
      out.splice(currentIndex, 1, normaliseInsertedStep(patch.newStep));
      return out;
    case 'skip_current':
      out.splice(currentIndex, 1);
      return out;
    case 'pause_for_user':
    case 'abort':
      // Both leave the plan unchanged. pause_for_user yields control to
      // the user; the engine retries the same step after they resume.
      return out;
  }
}

function normaliseInsertedStep(step: Step): Step {
  // Ensure id is non-empty and unique-ish — the fixer sometimes returns
  // duplicates of an existing slug.
  if (!step.id || step.id.trim().length === 0) {
    return { ...step, id: `fix-${randomUUID().slice(0, 6)}` };
  }
  return step;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * The step types the fixer may author. THE FOUR THE PROMPT DOCUMENTS, and no more.
 *
 * `local_command`, `api_call` and `ekoa_action` were admitted here while `FIXER_SYSTEM` never
 * offered them - so nothing legitimate produced them, and the only thing the allowance bought was a
 * route around the write gates. The fixer is a MODEL reacting to a failure message and a screenshot,
 * both of which come from the remote page: it is the most prompt-injectable authoring surface in
 * the engine, and it must not be the one that can mint an effect.
 *
 * Concretely, a `replace_current` carrying `{"type":"api_call","apiRequest":{"method":"POST",
 * "url":"…","authIntegrationKey":"…"}}` performed the write that the Action gate had just refused,
 * with the owner's credentials injected. Both halves are now closed - `executors/api-call.ts` gates
 * a mutating `api_call` wherever it came from, and the fixer cannot author one at all - because the
 * defence that survives a change of mind about the other is the one worth having.
 *
 * Widening this set is a security decision: a step type belongs here only once the prompt teaches
 * the fixer to emit it AND its executor gates its effect.
 */
const VALID_STEP_TYPES_FOR_PATCH: ReadonlySet<StepType> = new Set([
  'browser', 'verify', 'navigate', 'wait',
]);

function validatePatch(value: unknown): RehearsalPatch {
  if (!value || typeof value !== 'object') {
    throw new Error('fixer output must be an object');
  }
  const obj = value as Record<string, unknown>;
  const kind = obj.patch;
  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';

  if (kind === 'skip_current') return { kind: 'skip_current', reasoning };
  if (kind === 'abort') return { kind: 'abort', reasoning };

  if (kind === 'pause_for_user') {
    const userInstructions = typeof obj.userInstructions === 'string' && obj.userInstructions.trim().length > 0
      ? obj.userInstructions.trim()
      : 'Please resolve this in the open browser window, then click Continue.';
    return { kind: 'pause_for_user', reasoning, userInstructions };
  }

  if (kind === 'insert_before' || kind === 'replace_current') {
    const newStep = validateStep(obj.newStep);
    return { kind, newStep, reasoning };
  }

  throw new Error(`fixer returned invalid patch kind: ${String(kind)}`);
}

function validateStep(value: unknown): Step {
  if (!value || typeof value !== 'object') {
    throw new Error('newStep must be an object');
  }
  const s = value as Record<string, unknown>;
  const type = s.type as StepType;
  if (typeof type !== 'string' || !VALID_STEP_TYPES_FOR_PATCH.has(type)) {
    throw new Error(`fixer newStep has unsupported type: ${String(type)}`);
  }
  const id = typeof s.id === 'string' && s.id.length > 0 ? s.id : `fix-${randomUUID().slice(0, 6)}`;
  const description = typeof s.description === 'string' ? s.description : '';
  if (description.trim().length === 0) {
    throw new Error('fixer newStep is missing a description');
  }
  const expectedOutcome = typeof s.expectedOutcome === 'string' ? s.expectedOutcome : undefined;
  const step: Step = { id, description, type, expectedOutcome };

  if (type === 'navigate') {
    if (typeof s.url === 'string' && s.url.trim().length > 0) step.url = s.url;
    else throw new Error('fixer navigate step missing url');
  }
  if (type === 'wait') {
    step.durationMs = typeof s.durationMs === 'number' && s.durationMs > 0 ? s.durationMs : 1000;
  }
  // NOTE: there is deliberately no `commandTemplate` / `apiRequest` / `ekoaAction` mapping here.
  // Those step types are refused above, so any such field on a fixer patch is dropped rather than
  // carried - a patch cannot smuggle an effect payload on a step type that will not execute it.

  return step;
}

// ============================================================================
// Helpers
// ============================================================================

function formatStepLine(step: Step | undefined): string {
  if (!step) return '(none)';
  const out = `${step.type}: ${step.description}`;
  if (step.expectedOutcome) {
    return `${out}  (expect: ${step.expectedOutcome})`;
  }
  if (step.url) {
    return `${out}  (url: ${step.url})`;
  }
  return out;
}

// ============================================================================
// Budget
// ============================================================================

/**
 * MOVED to `budgets.ts` - the one module where every engine knob is declared, so a limit is
 * findable and changeable in one place instead of halfway down whichever file first needed it.
 * Re-exported here (values unchanged) because `engine.ts`, `automation/index.ts` and the suites
 * import it from this module, and a knob relocation is not a reason to churn call sites.
 */
export { REHEARSAL_BUDGET } from './budgets.js';

// ============================================================================
// Fast-path: human-action detection from failure message
// ============================================================================

interface FastPathMatch {
  reasoning: string;
  userInstructions: string;
}

/**
 * Cheap pattern check on the verifier / browser failure message that
 * lets us pause for the user *immediately* on obvious human-action
 * cases — CAPTCHA, MFA, payment confirm, "verify it's you" prompts —
 * without waiting on the 5–15 s Opus fixer round-trip.
 *
 * The verifier tends to spell these out in plain English ("The page
 * shows a Google reCAPTCHA verification page"), so a small ordered
 * keyword table catches the common cases reliably. Anything that doesn't
 * match falls through to the fixer, which is still smart enough to
 * handle the long tail.
 */
export function detectHumanActionable(failureMessage: string): FastPathMatch | null {
  if (!failureMessage) return null;
  const text = failureMessage;
  const RULES: Array<{ pattern: RegExp; out: FastPathMatch }> = [
    {
      pattern: /(re-?capt?cha|cap?tcha|i'?m not a robot|não sou um robô|i am not a robot|hcaptcha|cloudflare.*(challenge|verify)|are you a robot|bot[- ]?check|bot[- ]?detection|\bgoogle.*\/sorry\/|\/sorry\/[^"\s]|unusual (traffic|activity)|automated (traffic|requests|queries)|verify (you are |that you are |you'?re )?(a )?human|prove (you'?re|you are) (a )?human|are you (a )?human|press (and hold|& hold).*\bhuman\b|akamai.*(challenge|verify))/i,
      out: {
        reasoning: 'Detected a CAPTCHA / bot-check page',
        userInstructions: 'Solve the bot-check / CAPTCHA in the open browser window, then click Continue.',
      },
    },
    {
      pattern: /(two[- ]?factor|2[- ]?factor|2fa|mfa|authenticator (app|code)|6[- ]?digit code|enter (the|your) code|security code|one[- ]?time (passcode|password)|otp\b|verification code)/i,
      out: {
        reasoning: 'Detected a multi-factor authentication step',
        userInstructions: 'Open your authenticator app or check your phone for the code, type it in the open browser window, then click Continue.',
      },
    },
    {
      pattern: /(3-?d secure|3ds|sca challenge|step[- ]?up authentication|confirm.*payment|confirm.*purchase|confirm.*transaction|approve.*payment)/i,
      out: {
        reasoning: 'Detected a payment confirmation prompt',
        userInstructions: 'Confirm the payment in the open browser window, then click Continue.',
      },
    },
    {
      pattern: /(verify (your|it'?s) (you|identity)|confirm (your|it'?s) (you|identity)|trusted device|unusual sign[- ]?in|unusual activity|let'?s make sure it'?s you)/i,
      out: {
        reasoning: 'Detected an identity-verification prompt',
        userInstructions: 'Complete the identity check in the open browser window (answer the prompt, click the email link, etc.), then click Continue.',
      },
    },
    {
      pattern: /(enter (your|the) password|password.*required|sign in to continue|you need to sign in|please sign in|please log in)/i,
      out: {
        reasoning: 'Detected a login prompt',
        userInstructions: 'Sign in in the open browser window, then click Continue.',
      },
    },
  ];
  for (const { pattern, out } of RULES) {
    if (pattern.test(text)) return out;
  }
  return null;
}
