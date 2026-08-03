/**
 * Integration agent (slice D2) — the authoring core SHARED by the integration builder and the
 * automation planner, plus the builder's own thin adapter over it.
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
 * Part 1 is the core (its only dependency is the chokepoint). Part 2 is the integration-builder
 * chat turn (ch03 §3.8.14) the dashboard route calls; the builder's SESSION STORE lives on in
 * `integration-builder.ts` (session persistence is per-caller, not core).
 */
import type { Actor, ErrorCode } from '@ekoa/shared';
import { runOneShot, decideForTask, LlmAbortedError, type RouterDecision, type LlmAttribution } from '../llm/index.js';
import { checkAllowance } from '../billing/index.js';
import { assembleAgentContext } from './seams.js';
import { renderPrompt } from './context.js';
import { parseIntegrationOutput } from './integration-builder-parser.js';
import {
  createSession,
  findSessionForKey,
  getOwnedSession,
  recordBuilderTurn,
  type BuilderDeps,
} from './integration-builder.js';

// =========================================================================================
// PART 1 — the shared authoring core
// =========================================================================================

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

// =========================================================================================
// PART 2 — the integration-builder chat turn (ch03 §3.8.14)
// =========================================================================================

/**
 * A job-less, TOOL-LESS one-shot (same posture as brand-research §5.6.4): the user describes the
 * service they want to connect and the agent replies in ONE WORKHORSE turn with a conversational
 * message plus two fenced blocks — ```skill-md (the integration's knowledge doc) and ```config-json
 * (the structured package). The fenced blocks are parsed out (integration-builder-parser.ts) and the
 * user sees only the prose; the package populates the builder's side panel.
 *
 * The builder's repair budget is ZERO, deliberately: its "repair loop" is the human. Problems are
 * surfaced as `validationErrors` next to the package the user is editing, and the next chat turn is
 * the correction — an automatic re-emit would silently replace what they are looking at.
 */

/** Remove the two fenced output blocks from the assistant text before it is stored/shown (the user
 *  never sees raw skill-md/config-json — the side panel renders them, §3.8.14 prohibitions). */
function stripFencedBlocks(text: string): string {
  return text
    .replace(/```skill-md\s*\n[\s\S]*?```/g, '')
    .replace(/```config-json\s*\n[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface BuilderChatInput {
  actor: Actor;
  message: string;
  /** Reply language (default PT-PT); the fenced blocks are always English. */
  language: 'pt' | 'en';
  /** Continue an existing session, else resolve by integrationKey, else start fresh. */
  sessionId?: string;
  integrationKey?: string;
  /** Keys a NEW package may not claim (baseline defs + pipedream) — supplied by the route. */
  reservedKeys: ReadonlySet<string>;
  deps: BuilderDeps;
}

/** The wire chat response shape (shared IntegrationBuilderChatResponse). */
export interface BuilderChatResponse {
  builderSessionId: string;
  generatedPackage: Record<string, unknown>;
  validationErrors: Array<{ message: string }>;
}

export type BuilderChatOutcome =
  | { ok: true; response: BuilderChatResponse }
  | { ok: false; code: ErrorCode; message: string };

/**
 * Run one builder chat turn: allowance gate -> load/create the persisted session -> ONE tool-less
 * WORKHORSE authoring turn on the core (kind 'integration-builder' content sections + the
 * reply-language directive as the output contract) -> parse the two fenced blocks -> persist the
 * turn (fenced blocks stripped from the stored assistant text) -> return the wire ChatResponse.
 */
export async function handleBuilderChat(input: BuilderChatInput): Promise<BuilderChatOutcome> {
  const { actor, message, language, deps } = input;

  const allow = await checkAllowance(actor.userId);
  if (!allow.ok) return { ok: false, code: 'BILLING_BLOCKED', message: allow.message ?? 'Faturação bloqueada.' };

  // Resolve the session: explicit id (owned) -> by key -> a fresh one.
  let session =
    (input.sessionId ? await getOwnedSession(actor.userId, input.sessionId) : null) ??
    (input.integrationKey ? await findSessionForKey(actor.userId, input.integrationKey) : null);
  if (!session) session = await createSession(actor, deps, input.integrationKey ? { integrationKey: input.integrationKey } : {});

  const ctx = await assembleAgentContext({ agentKind: 'integration-builder', userId: actor.userId });
  const langName = language === 'en' ? 'English' : 'Portuguese (PT-PT)';
  const directive =
    `# Reply language\nWrite your conversational reply to the user in ${langName}. ` +
    'The `skill-md` and `config-json` blocks are ALWAYS in English regardless of the reply language.';
  const history = session.messages.map((m) => ({ role: m.role, content: m.content }));

  const outcome = await authorWithRepair({
    contentSections: ctx.promptSections,
    outputContract: directive,
    userText: () => renderPrompt(history, message),
    decision: decideForTask(message, undefined, 'WORKHORSE'),
    attribution: { kind: 'user_work', agentType: 'integration-builder', billeeUserId: actor.userId, sessionId: session._id },
    // An empty reply is an ordinary package-less turn here: it parses to "still conversing", which
    // is exactly what the builder shows. (The planner's opposite rule is its own.)
    emptyReply: 'text',
    // NO reserved-key exemption, for ANY session (A3 review L4). The save path refuses a reserved
    // (shipped/pipedream) key unconditionally since A3, so exempting a "loaded" session here only
    // produced a lie: the chat validated a package the PUT would then refuse with 403. The parser's
    // verdict now matches the save gate for every session, loaded or fresh.
    parse: (text) => {
      const parsed = parseIntegrationOutput(text, { reservedKeys: input.reservedKeys });
      // A package-less turn carries no violations the UI could attach to anything — the builder's
      // wire has surfaced problems only alongside a package since §3.8.14.
      return { draft: parsed, violations: parsed.pkg ? parsed.errors : [] };
    },
  });

  if (outcome.status === 'unavailable') {
    return { ok: false, code: 'INTERNAL', message: outcome.cause instanceof Error ? outcome.cause.message : 'A geração falhou.' };
  }
  const parsed = outcome.draft!; // the parse seam above always returns a draft

  // Persist the turn: user message + assistant message (fenced blocks stripped), and the package
  // when the model produced one (an interim reply leaves the previous package untouched).
  await recordBuilderTurn(
    session,
    {
      userMessage: message,
      assistantText: stripFencedBlocks(outcome.text),
      ...(parsed.pkg
        ? {
            package: {
              config: parsed.pkg,
              skillMd: parsed.skillMd ?? '',
              validationErrors: parsed.errors,
              ...(typeof parsed.pkg.integrationKey === 'string' ? { integrationKey: parsed.pkg.integrationKey } : {}),
            },
          }
        : {}),
    },
    deps,
  );

  const generatedPackage = parsed.pkg ? { skillMd: parsed.skillMd ?? '', config: parsed.pkg } : {};
  const validationErrors = outcome.violations.map((m) => ({ message: m }));
  return { ok: true, response: { builderSessionId: session._id, generatedPackage, validationErrors } };
}
