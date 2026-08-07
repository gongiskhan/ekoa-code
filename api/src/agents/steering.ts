/**
 * Conduzir — steer a live run (ch05 §5.6.1/§5.6.2 addendum). The queued-message banner's
 * "send it NOW" path: instead of waiting for the run to finish (queue-and-flush), the message
 * is pushed into the in-flight Agent SDK session as an additional user turn (llm/ streaming
 * input). Owner-only (registry.steerRun); a false outcome is the client's signal to fall back
 * to the ordinary queue — never an error.
 *
 * A steered message is a real user turn: it persists to the session transcript HERE (server-
 * side, like the chat pipeline's step-1 user message) so a reloaded transcript replays it in
 * order. The client mirrors it locally with persist:false, same as every run-pipeline turn.
 */
import type { Actor } from '@ekoa/shared';
import { getRun, steerRun } from './registry.js';
import { persistUserMessage, type PersistDeps } from './persistence.js';

export async function steerLiveRun(
  id: string,
  actor: Actor,
  message: string,
  deps: PersistDeps,
): Promise<{ steered: boolean }> {
  const outcome = steerRun(id, actor, message);
  if (!outcome.steered) return outcome;
  const sessionId = getRun(id)?.sessionId;
  if (sessionId) {
    // Persistence failure never un-steers the run (the model already received the turn);
    // the transcript self-heals on the client mirror. Same fire-and-forget posture as the
    // billing ledger (§6.7).
    await persistUserMessage(sessionId, message, deps).catch((err) =>
      console.warn('[agents] steered message not persisted:', err instanceof Error ? err.message : err),
    );
  }
  return outcome;
}
