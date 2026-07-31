/**
 * streaming/registry.ts — the traceId → StreamSession map (B17 port). A registering session
 * for a traceId that already has one closes the prior (session-level replacement, reason
 * 'replaced'). Distinct from a socket-level takeover, which sends close code 4000 (see
 * session.ts attachSocket, landmine 8).
 */
import type { StreamSession } from './session.js';

const sessions = new Map<string, StreamSession>();

export function registerSession(traceId: string, session: StreamSession): void {
  const prior = sessions.get(traceId);
  if (prior && prior !== session) {
    prior.close('replaced').catch(() => {});
  }
  sessions.set(traceId, session);
}

export function getSession(traceId: string): StreamSession | undefined {
  return sessions.get(traceId);
}

export function unregisterSession(traceId: string, session?: StreamSession): void {
  const current = sessions.get(traceId);
  if (!current) return;
  if (session && current !== session) return;
  sessions.delete(traceId);
}

export function clearAllSessionsForTest(): void {
  for (const session of sessions.values()) {
    session.close('test-cleanup').catch(() => {});
  }
  sessions.clear();
}

export function activeSessionCount(): number {
  return sessions.size;
}

/**
 * Open a credential window on the live session for `traceId`, if any (Cofre F-2).
 *
 * Returns a disposer that resumes the stream. When there is NO live session the disposer is a
 * no-op — that is the common case (most runs have no viewer attached) and it must not be an error,
 * but the typist still asserts that this function was CALLED, so the suppression cannot be
 * forgotten on the path where a viewer does exist.
 */
export async function beginCredentialWindowForTrace(traceId: string): Promise<() => Promise<void>> {
  const session = sessions.get(traceId);
  if (!session) return async () => {};
  return session.beginCredentialWindow();
}

/** True when a live session for `traceId` is currently suppressed. Used by the typist's
 *  post-condition check: it refuses to fill if a viewer is attached and NOT suppressed. */
export function traceIsSuppressed(traceId: string): boolean {
  const session = sessions.get(traceId);
  return !session || session.inCredentialWindow();
}
