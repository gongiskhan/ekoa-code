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
