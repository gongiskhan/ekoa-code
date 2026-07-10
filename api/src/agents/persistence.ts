/**
 * Transcript persistence helpers for the run pipelines (ch05 §5.6.1/§5.6.2). Small wrappers over
 * the `messages` + `sessions` stores (agents/ may import data/, ch02 §2.6). A provider-error
 * assistant message is NEVER persisted (§5.3.7) — the caller checks the scanner before calling
 * `persistAssistantMessage`.
 */
import { messages as messagesStore, sessions as sessionsStore } from '../data/stores.js';
import type { Doc } from '../data/store.js';

export interface PersistDeps {
  now: () => number;
  genId: () => string;
}

async function insertMessage(sessionId: string, role: string, content: unknown, deps: PersistDeps, metadata?: Record<string, unknown>): Promise<Doc> {
  const now = new Date(deps.now()).toISOString();
  const doc: Doc = {
    _id: deps.genId(),
    sessionId,
    role,
    content,
    timestamp: now,
    ...(metadata ? { metadata } : {}),
  };
  await messagesStore.insert(doc);
  // A persisted turn touches the session: the web sorts the session list by `updatedAt`.
  await sessionsStore.update(sessionId, (s) => ({ ...s, messageCount: (((s as { messageCount?: number }).messageCount ?? 0) + 1), updatedAt: now }));
  return doc;
}

export function persistUserMessage(sessionId: string, content: string, deps: PersistDeps): Promise<Doc> {
  return insertMessage(sessionId, 'user', content, deps);
}

export function persistAssistantMessage(sessionId: string, content: string, deps: PersistDeps): Promise<Doc> {
  return insertMessage(sessionId, 'assistant', content, deps);
}

/** Persist the last valid `<ekoa-context>` block onto the session record (§5.6.1 step 6). */
export async function persistSessionContext(sessionId: string, contextBlock: string): Promise<void> {
  await sessionsStore.update(sessionId, (s) => ({ ...s, lastContext: contextBlock }));
}
