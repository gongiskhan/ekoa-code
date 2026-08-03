/**
 * Integration-builder SESSION STORE (ch03 §3.8.14).
 *
 * Sessions are PERSISTED (data/stores.ts integrationBuilderSessions) — the old cortex builder kept an
 * in-memory Map that died on restart, but load-by-key durability requires the transcript + last
 * package to survive. This module owns the session store and nothing else: the chat TURN moved to
 * `integration-agent.ts` at slice D2, where it shares one authoring core with the automation
 * planner. The route owns load/save/test orchestration and supplies the reserved-key set (it may
 * import integrations/; agents/ does not).
 */
import type { Actor } from '@ekoa/shared';
import { integrationBuilderSessions } from '../data/stores.js';
import type { Doc } from '../data/store.js';

/** A persisted builder session (ch03 §3.8.14). */
export interface BuilderSessionDoc extends Doc {
  userId: string;
  orgId: string;
  /** The current package's proposed key (from generation or load). Powers findSessionForKey.
   *  NOTE (A3 review L4): sessions used to also carry `loadedKey`, a per-session reserved-key
   *  exemption. It is GONE: the save path refuses reserved keys unconditionally (A2-residual 4),
   *  so an exemption on the chat surface only let the agent present a package the PUT would then
   *  403 — and a stale pre-A3 session doc carrying the field is deliberately ignored. */
  integrationKey?: string;
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
  seed: { integrationKey?: string; currentPackage?: unknown; currentSkillMd?: string; messages?: BuilderSessionDoc['messages'] } = {},
): Promise<BuilderSessionDoc> {
  const iso = new Date(deps.now()).toISOString();
  const doc: BuilderSessionDoc = {
    _id: deps.genId(),
    userId: actor.userId,
    orgId: actor.orgId,
    ...(seed.integrationKey ? { integrationKey: seed.integrationKey } : {}),
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

/** Pin a session to a just-SAVED integration: its package/body snapshot and key now track the
 *  save. Called by the save route (which owns integrations/ but must not touch data/ directly,
 *  ch02 §2.7). */
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

/**
 * Persist ONE chat turn onto the session: the user message + the assistant message (already
 * stripped of the fenced blocks by the caller), and the package when the model produced one — an
 * interim reply leaves the previous package, body and validation verdict untouched. The session's
 * key is pinned on the FIRST package that names one and never re-pointed afterwards (the key a
 * session edits is decided once; a save re-pins it through markSessionSaved).
 */
export async function recordBuilderTurn(
  session: BuilderSessionDoc,
  turn: {
    userMessage: string;
    assistantText: string;
    package?: { config: unknown; skillMd: string; validationErrors: string[]; integrationKey?: string };
  },
  deps: BuilderDeps,
): Promise<void> {
  const iso = new Date(deps.now()).toISOString();
  const patch: Partial<BuilderSessionDoc> = {
    messages: [
      ...session.messages,
      { role: 'user', content: turn.userMessage, timestamp: iso },
      { role: 'assistant', content: turn.assistantText, timestamp: iso },
    ],
    updatedAt: iso,
  };
  if (turn.package) {
    patch.currentPackage = turn.package.config;
    patch.currentSkillMd = turn.package.skillMd;
    patch.validationErrors = turn.package.validationErrors;
    if (!session.integrationKey && turn.package.integrationKey) patch.integrationKey = turn.package.integrationKey;
  }
  const saved = await integrationBuilderSessions.update(session._id, (cur) => ({ ...cur, ...patch }));
  // The row is gone (a concurrent delete): the turn is NOT persisted. The response still carries
  // the session id, exactly as before — but the write no longer disappears silently (C1 review).
  if (!saved) console.warn(`[integration-builder] session ${session._id} vanished mid-turn — the turn was not persisted`);
}
