/**
 * Integration-BUILDER agent (slice D2) — the builder's thin adapter over the shared authoring core.
 *
 * The core itself (`composeAuthoringPrompt` + `authorWithRepair`, the one model-call loop this
 * surface shares with `automation/planner.ts`) lives in `agents/authoring-core.ts`, whose ONLY
 * dependency is the chokepoint. D2 shipped both in this file as Part 1 / Part 2 and claimed the
 * core's isolation in a docblock; the re-review (LOW-1) caught that the claim was false of the
 * FILE — the adapter below pulls in `billing/`, the agent seams, the parser and the builder SESSION
 * STORE (and through it the Mongo store registry), all of which the planner's import was
 * transitively loading. The split makes the sentence true instead of softening it.
 *
 * This module is the builder's half: the chat turn (ch03 §3.8.14) the dashboard route calls. The
 * builder's SESSION STORE stays in `integration-builder.ts` (persistence is per-caller, not core).
 */
import { runErrorText } from '@ekoa/shared';
import type { Actor, ErrorCode } from '@ekoa/shared';
import { decideForTask } from '../llm/index.js';
import { authorWithRepair } from './authoring-core.js';
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
    // The cause is a transport/credential failure from the chokepoint; its message can name the
    // provider, an env var, or a host. `routes/integration-builder.ts` puts this straight into the
    // error envelope the builder UI renders, so it must be curated text — the same rule the run
    // streams follow (finding `run-error-text-leak`). Honest detail goes to the log.
    console.error('[integration-agent] generation unavailable:', outcome.cause instanceof Error ? (outcome.cause.stack ?? outcome.cause.message) : outcome.cause);
    return { ok: false, code: 'INTERNAL', message: runErrorText('PROVIDER_UNAVAILABLE', 'pt') };
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
