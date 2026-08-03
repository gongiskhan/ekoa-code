/**
 * The AUTHORING CORE (slice D2) — the one model-call loop the integration builder
 * (`agents/integration-agent.ts`) and the automation planner (`automation/planner.ts`) share.
 *
 * Both surfaces did the same four things around one model call, in two copies:
 *   1. compose ONE system prompt as [content sections …, output contract] — the contract LAST, so
 *      the output shape is the final word (both copies carried that comment);
 *   2. run ONE tool-less turn through the chokepoint (`api/src/llm/`, FIXED-3/8/13 — nothing here
 *      names a provider), tagged for attribution + metering;
 *   3. classify the outcome: text, a transport failure, an EMPTY reply (a transport failing
 *      quietly), or a deliberate abort;
 *   4. parse the text into a draft + violations and, when the caller has a repair budget, re-emit
 *      ONCE with the violations fed back — a generic retry produces identical garbage; the
 *      feedback is what makes a retry fix anything.
 *
 * What stays PER CALLER, supplied as typed seams and never branched on inside the core: the output
 * FORMAT and its validation vocabulary (`parse`), the turn text incl. how a repair request reads
 * (`userText`), the tier/attribution, the persistence target, the consent semantics, the wire
 * shape and its error mapping. The core decides nothing a caller must own — an outage, an abort
 * and an empty reply come back TYPED and each adapter maps them to its own contract.
 *
 * ITS ONLY DEPENDENCY IS THE CHOKEPOINT, and that is now a property of the file rather than a claim
 * about a section of one (D2 re-review LOW-1). D2 shipped this core as Part 1 of
 * `integration-agent.ts`, whose Part 2 (the builder chat adapter) also imports `billing/`,
 * `agents/seams`, `agents/context`, the builder parser and the builder SESSION STORE — so the
 * planner's import transitively loaded the session store and, through it, the Mongo store registry
 * at module-load time, and the docblock, `docs/decisions.md` and the module-map annotation all
 * stated something untrue. The two concerns were already described as separate; they are now
 * separate, and the sentence is checkable by reading the imports below.
 */
import { runOneShot, LlmAbortedError, type RouterDecision, type LlmAttribution } from '../llm/index.js';

/**
 * The ONE system-prompt rule both callers encode: the agent kind's content sections LEAD, the
 * caller's output contract is ALWAYS last (an output shape stated before the content can be
 * overridden by it), and empty sections are dropped rather than emitting blank separators.
 */
export function composeAuthoringPrompt(contentSections: readonly string[], outputContract: string): string {
  return [...contentSections, outputContract].filter(Boolean).join('\n\n');
}

/**
 * Why a turn produced no usable text.
 * - `transport` — the chokepoint threw (dead credential, provider down, network).
 * - `empty` — the model resolved EMPTY. Only classified when the caller opts in (see
 *   `emptyReply`): it is a transport failing quietly, not a short answer.
 * - `aborted` — a deliberate stop (budget/cancel) carrying the original `LlmAbortedError`. It is a
 *   control signal, NOT an outage: it is never retried here, and each caller decides whether to
 *   re-throw it (the automation route owns that mapping) or report it.
 */
export type AuthoringUnavailableReason = 'transport' | 'empty' | 'aborted';

/** One turn's outcome, before any caller-specific parsing. */
type AuthoringTurnResult =
  | { status: 'text'; text: string }
  | { status: 'unavailable'; reason: AuthoringUnavailableReason; detail: string; cause?: unknown };

/** What a caller's `parse` seam returns: the draft it could build (or null) + what is wrong with
 *  it. A non-empty `violations` is what drives (and is fed back into) a repair attempt. */
export interface AuthoringDraft<TDraft> {
  draft: TDraft | null;
  violations: string[];
}

export interface AuthoringRunInput<TDraft> {
  /** The agent kind's composed content sections; they LEAD the system prompt. */
  contentSections: readonly string[];
  /** The caller's output contract — always the LAST system section. */
  outputContract: string;
  /**
   * The turn's user text. Called with `null` for the first attempt and with the previous attempt's
   * violations for a repair attempt, so the caller words its own repair request (the wording is
   * part of its output contract, not of the core).
   */
  userText: (violations: readonly string[] | null) => string;
  decision: RouterDecision;
  attribution: LlmAttribution;
  /**
   * How an EMPTY model reply is classified. REQUIRED — the two callers answer differently and a
   * third must answer consciously:
   *   `unavailable` — the planner's rule: empty text is a quiet transport failure, never a plan.
   *   `text`        — the builder's rule: a chat turn that emitted no package is an ordinary
   *                   conversational turn, and '' parses to exactly that.
   * It is the ONLY required policy knob: `repairs` and `retryUnavailableOnce` are optional with
   * documented defaults (0 repairs, no plain retry), because a caller that says nothing about them
   * gets the conservative single-turn behaviour rather than a wrong guess.
   */
  emptyReply: 'unavailable' | 'text';
  /** Parse the model text into a draft + violations. Pure; never calls the model. */
  parse: (text: string) => AuthoringDraft<TDraft>;
  /** Repair attempts AFTER the first. 0 (default) = one turn, violations surfaced as-is. */
  repairs?: number;
  /** One PLAIN re-attempt (same text, no feedback) when the FIRST turn is unavailable. An outage
   *  is not a validation failure — violation feedback cannot fix it. Never applied to an abort. */
  retryUnavailableOnce?: boolean;
  /** Diagnostics only, in the caller's own voice. Never influences control flow. */
  onUnavailable?: (info: { reason: AuthoringUnavailableReason; detail: string; willRetry: boolean }) => void;
  onRepair?: (violations: readonly string[]) => void;
}

export type AuthoringResult<TDraft> =
  /** The model answered. `violations` is the LAST attempt's verdict — empty means clean. */
  | { status: 'authored'; text: string; draft: TDraft | null; violations: string[]; attempts: number }
  | { status: 'unavailable'; reason: AuthoringUnavailableReason; detail: string; cause?: unknown; attempts: number };

/** One chokepoint turn: compose the system prompt, call, classify. No parsing, no retries. */
async function runAuthoringTurn(
  input: Pick<AuthoringRunInput<unknown>, 'contentSections' | 'outputContract' | 'decision' | 'attribution' | 'emptyReply'>,
  userText: string,
): Promise<AuthoringTurnResult> {
  const systemPrompt = composeAuthoringPrompt(input.contentSections, input.outputContract);
  let res: { text: string };
  try {
    res = await runOneShot({ prompt: userText, systemPrompt, decision: input.decision }, input.attribution);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return err instanceof LlmAbortedError
      ? { status: 'unavailable', reason: 'aborted', detail, cause: err }
      : { status: 'unavailable', reason: 'transport', detail, cause: err };
  }
  if (input.emptyReply === 'unavailable' && res.text.trim() === '') {
    return { status: 'unavailable', reason: 'empty', detail: 'empty model response' };
  }
  return { status: 'text', text: res.text };
}

/**
 * Author with the caller's repair budget: turn → parse → (violations ? repair with feedback) →
 * the last attempt's verdict. Returns the FINAL attempt in both directions — a caller that ran out
 * of repairs gets the draft AND the violations that are still open, and decides what that means on
 * its wire.
 */
export async function authorWithRepair<TDraft>(input: AuthoringRunInput<TDraft>): Promise<AuthoringResult<TDraft>> {
  const repairs = input.repairs ?? 0;
  let attempts = 0;
  let previousViolations: readonly string[] | null = null;

  for (let attempt = 0; attempt <= repairs; attempt++) {
    if (attempt > 0) input.onRepair?.(previousViolations ?? []);
    const text = input.userText(previousViolations);

    let turn = await runAuthoringTurn(input, text);
    attempts++;
    if (turn.status === 'unavailable') {
      // A plain retry is only ever the FIRST attempt's privilege, and never an abort's.
      const willRetry = attempt === 0 && input.retryUnavailableOnce === true && turn.reason !== 'aborted';
      input.onUnavailable?.({ reason: turn.reason, detail: turn.detail, willRetry });
      if (!willRetry) return { ...turn, attempts };
      turn = await runAuthoringTurn(input, text);
      attempts++;
      if (turn.status === 'unavailable') {
        input.onUnavailable?.({ reason: turn.reason, detail: turn.detail, willRetry: false });
        return { ...turn, attempts };
      }
    }

    const parsed = input.parse(turn.text);
    if (parsed.violations.length === 0 || attempt === repairs) {
      return { status: 'authored', text: turn.text, draft: parsed.draft, violations: [...parsed.violations], attempts };
    }
    previousViolations = parsed.violations;
  }

  /* c8 ignore next 2 — the loop always returns: `attempt === repairs` is terminal. */
  throw new Error('authorWithRepair: unreachable');
}
