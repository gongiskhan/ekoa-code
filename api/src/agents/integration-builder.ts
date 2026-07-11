/**
 * Integration-builder agent (ch03 §3.8.14).
 *
 * A job-less, TOOL-LESS one-shot (same posture as brand-research §5.6.4): the user describes the
 * service they want to connect and the agent replies in ONE WORKHORSE turn with a conversational
 * message plus two fenced blocks — ```skill-md (the integration's knowledge doc) and ```config-json
 * (the structured package). The fenced blocks are parsed out (integration-builder-parser.ts) and the
 * user sees only the prose; the package populates the builder's side panel.
 *
 * Sessions are PERSISTED (data/stores.ts integrationBuilderSessions) — the old cortex builder kept an
 * in-memory Map that died on restart, but load-by-key durability requires the transcript + last
 * package to survive. This module owns the session store + the chat turn; the route owns load/save/test
 * orchestration and supplies the reserved-key set (it may import integrations/; agents/ does not).
 */
import type { Actor, ErrorCode } from '@ekoa/shared';
import { checkAllowance } from '../billing/index.js';
import { runOneShot, decideForTask } from '../llm/index.js';
import { integrationBuilderSessions } from '../data/stores.js';
import type { Doc } from '../data/store.js';
import { assembleAgentContext } from './seams.js';
import { renderPrompt } from './context.js';
import { parseIntegrationOutput } from './integration-builder-parser.js';

/** A persisted builder session (ch03 §3.8.14). */
export interface BuilderSessionDoc extends Doc {
  userId: string;
  orgId: string;
  /** The current package's proposed key (from generation or load). Powers findSessionForKey. */
  integrationKey?: string;
  /** Set ONLY when the session EDITS an existing saved integration (the load route / a completed
   *  save). A reserved key (shipped/pipedream) may be re-saved only when it equals this — a fresh
   *  chat that merely PROPOSES a reserved key is still rejected. */
  loadedKey?: string;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  /** The last generated package config (the `IntegrationPackageConfig` shape). */
  currentPackage?: unknown;
  /** The last generated SKILL.md body. */
  currentSkillMd?: string;
  /** The last parse's soft validation problems, surfaced to the UI. */
  validationErrors?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BuilderDeps {
  now: () => number;
  genId: () => string;
}

// --- Session store helpers (exported for the load/save/test route) -----------------------

/** The caller's session by id, or null when it does not exist or belongs to another user. */
export async function getOwnedSession(userId: string, sessionId: string): Promise<BuilderSessionDoc | null> {
  const doc = (await integrationBuilderSessions.get(sessionId)) as BuilderSessionDoc | null;
  return doc && doc.userId === userId ? doc : null;
}

/** The caller's most-recently-updated session for an integration key, or null. */
export async function findSessionForKey(userId: string, integrationKey: string): Promise<BuilderSessionDoc | null> {
  const rows = (await integrationBuilderSessions.find({ userId, integrationKey })) as BuilderSessionDoc[];
  if (rows.length === 0) return null;
  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]!;
}

/** Create + persist a new session, optionally seeded (the load route seeds from a saved package). */
export async function createSession(
  actor: Actor,
  deps: BuilderDeps,
  seed: { integrationKey?: string; loadedKey?: string; currentPackage?: unknown; currentSkillMd?: string; messages?: BuilderSessionDoc['messages'] } = {},
): Promise<BuilderSessionDoc> {
  const iso = new Date(deps.now()).toISOString();
  const doc: BuilderSessionDoc = {
    _id: deps.genId(),
    userId: actor.userId,
    orgId: actor.orgId,
    ...(seed.integrationKey ? { integrationKey: seed.integrationKey } : {}),
    ...(seed.loadedKey ? { loadedKey: seed.loadedKey } : {}),
    messages: seed.messages ?? [],
    ...(seed.currentPackage !== undefined ? { currentPackage: seed.currentPackage } : {}),
    ...(seed.currentSkillMd !== undefined ? { currentSkillMd: seed.currentSkillMd } : {}),
    validationErrors: [],
    createdAt: iso,
    updatedAt: iso,
  };
  await integrationBuilderSessions.insert(doc as never);
  return doc;
}

/** Pin a session to a just-SAVED integration: it now edits that key, so `loadedKey` is set and a
 *  future re-save of the same key passes the reserved-key guard. Called by the save route (which
 *  owns integrations/ but must not touch data/ directly, ch02 §2.7). */
export async function markSessionSaved(
  sessionId: string,
  saved: { config: unknown; skillMd: string; integrationKey: string },
  deps: BuilderDeps,
): Promise<void> {
  const iso = new Date(deps.now()).toISOString();
  await integrationBuilderSessions.update(sessionId, (cur) => ({
    ...cur,
    currentPackage: saved.config,
    currentSkillMd: saved.skillMd,
    integrationKey: saved.integrationKey,
    loadedKey: saved.integrationKey,
    validationErrors: [],
    updatedAt: iso,
  }));
}

/** The wire `generatedPackage` view-model for a session: `{ skillMd, config }` when a package has
 *  been generated, else `{}` (the web treats a config-less package as "no package yet"). */
export function generatedPackageOf(session: BuilderSessionDoc): Record<string, unknown> {
  if (session.currentPackage == null) return {};
  return { skillMd: session.currentSkillMd ?? '', config: session.currentPackage };
}

/** The wire `validationErrors` for a session (the shape shared/ declares: `{ message }[]`). */
export function validationErrorsOf(session: BuilderSessionDoc): Array<{ message: string }> {
  return (session.validationErrors ?? []).map((message) => ({ message }));
}

// --- The chat turn -----------------------------------------------------------------------

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
 * Run one builder chat turn: allowance gate -> load/create the persisted session -> assemble the
 * (kind 'integration-builder') system prompt + reply-language directive -> ONE tool-less WORKHORSE
 * runOneShot -> parse the two fenced blocks -> persist the turn (fenced blocks stripped from the
 * stored assistant text) -> return the wire ChatResponse.
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

  // System prompt: the composed integration-builder content sections + a reply-language directive.
  const ctx = await assembleAgentContext({ agentKind: 'integration-builder', userId: actor.userId });
  const langName = language === 'en' ? 'English' : 'Portuguese (PT-PT)';
  const directive =
    `# Reply language\nWrite your conversational reply to the user in ${langName}. ` +
    'The `skill-md` and `config-json` blocks are ALWAYS in English regardless of the reply language.';
  const systemPrompt = [...ctx.promptSections, directive].filter(Boolean).join('\n\n');

  const history = session.messages.map((m) => ({ role: m.role, content: m.content }));
  const prompt = renderPrompt(history, message);
  const decision = decideForTask(message, undefined, 'WORKHORSE');

  let text: string;
  try {
    const result = await runOneShot(
      { prompt, decision, systemPrompt },
      { kind: 'user_work', agentType: 'integration-builder', billeeUserId: actor.userId, sessionId: session._id },
    );
    text = result.text;
  } catch (err) {
    return { ok: false, code: 'INTERNAL', message: err instanceof Error ? err.message : 'A geração falhou.' };
  }

  const parsed = parseIntegrationOutput(text, {
    reservedKeys: input.reservedKeys,
    // Only a session EDITING an existing key (loadedKey) may re-propose that reserved key; a fresh
    // chat that merely proposes a reserved key is rejected (the parser reports it).
    ...(session.loadedKey ? { loadedKey: session.loadedKey } : {}),
  });

  // Persist the turn: user message + assistant message (fenced blocks stripped), and the package
  // when the model produced one (an interim reply leaves the previous package untouched).
  const iso = new Date(deps.now()).toISOString();
  const assistantText = stripFencedBlocks(text);
  const messages = [
    ...session.messages,
    { role: 'user', content: message, timestamp: iso },
    { role: 'assistant', content: assistantText, timestamp: iso },
  ];
  const patch: Partial<BuilderSessionDoc> = { messages, updatedAt: iso };
  if (parsed.pkg) {
    patch.currentPackage = parsed.pkg;
    patch.currentSkillMd = parsed.skillMd ?? '';
    patch.validationErrors = parsed.errors;
    const pkgKey = typeof parsed.pkg.integrationKey === 'string' ? parsed.pkg.integrationKey : undefined;
    if (!session.integrationKey && pkgKey) patch.integrationKey = pkgKey;
  }
  const saved = (await integrationBuilderSessions.update(session._id, (cur) => ({ ...cur, ...patch }))) as BuilderSessionDoc;

  const generatedPackage = parsed.pkg ? { skillMd: parsed.skillMd ?? '', config: parsed.pkg } : {};
  const validationErrors = (parsed.pkg ? parsed.errors : []).map((m) => ({ message: m }));
  void saved;
  return { ok: true, response: { builderSessionId: session._id, generatedPackage, validationErrors } };
}
