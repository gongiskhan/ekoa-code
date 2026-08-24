/**
 * The in-memory run registry + first-build reservation map (ch05 §5.2.2, §5.3.1, §5.3.3,
 * §5.3.4). This is the single-process concurrency substrate for every streaming run class
 * (FIXED-8). It holds:
 *   - one `LiveRunEntry` per live run (chat, build, brand-research, agent-face), inserted
 *     synchronously at creation (§5.2 step 1: a fast Stop must always find its target) and
 *     removed in the run wrapper's `finally`;
 *   - the `finalized` dual-fire guard (§5.3.4) and the `timedOut` timeout-vs-Stop flag (§5.3.6);
 *   - the 45-minute first-build reservation keyed by `sessionId` (§5.3.3);
 *   - owner-scoped idempotent cancel with set-before-abort ordering (§5.3.1).
 */
import type { Actor } from '@ekoa/shared';
import { loadAgentsConfig } from '../config.js';

export type RunKind = 'chat' | 'build' | 'brand-research' | 'agent-face';

export interface LiveRunEntry {
  id: string;
  ownerUserId: string;
  /** Owner's org — org-admins may cancel build jobs in their own org (§5.3.1). */
  orgId?: string;
  kind: RunKind;
  /** Shared by cancel and the timeout timers (§5.3.6). */
  abort: AbortController;
  /** Dual-fire guard: exactly one of complete/error may finalize (§5.3.4). */
  finalized: boolean;
  /** Distinguishes a timeout (surfaces a terminal error) from a user Stop (silent) (§5.3.6). */
  timedOut: boolean;
  /** Set by cancel BEFORE the abort fires, so the abort path stays quiet (§5.3.1). */
  cancelled: boolean;
  startedAt: number;
  /** Build jobs: the artifact this run targets (follow-up 409 query, §5.3.5). */
  artifactId?: string;
  sessionId?: string;
  /** s1 queued-build lifecycle (run 20260719): build runs only. 'executing' HOLDS a per-user
   *  concurrency slot (counted by liveBuildCountForUser); 'queued' holds none until dispatched.
   *  Undefined for chat/brand-research/agent-face runs, which the cap never governs. */
  state?: 'queued' | 'executing';
  /** s1: a queued build's post-persist dispatch thunk (fires executeBuildJob). tryDispatchUser
   *  flips state -> 'executing', takes-and-clears this, and invokes it — synchronously, so
   *  concurrent dispatchers cannot double-fire it. */
  dispatch?: () => void;
  /** Terminal snapshot for chat runs (kept readable until process exit, §5.2.1/§5.6.8). */
  status?: 'running' | 'complete' | 'cancelled' | 'error';
  result?: unknown;
  error?: { code: string; message: string };
  durationMs?: number;
}

const runs = new Map<string, LiveRunEntry>();

/** Insert a run synchronously at creation (§5.2 step 1). */
export function registerRun(input: {
  id: string;
  ownerUserId: string;
  orgId?: string;
  kind: RunKind;
  abort: AbortController;
  startedAt: number;
  artifactId?: string;
  sessionId?: string;
}): LiveRunEntry {
  const entry: LiveRunEntry = {
    id: input.id,
    ownerUserId: input.ownerUserId,
    orgId: input.orgId,
    kind: input.kind,
    abort: input.abort,
    finalized: false,
    timedOut: false,
    cancelled: false,
    startedAt: input.startedAt,
    artifactId: input.artifactId,
    sessionId: input.sessionId,
  };
  runs.set(input.id, entry);
  return entry;
}

export function getRun(id: string): LiveRunEntry | undefined {
  return runs.get(id);
}

/** Remove a run (the run wrapper's `finally`). */
export function removeRun(id: string): void {
  runs.delete(id);
}

/** Record a chat run's terminal snapshot and KEEP the entry readable until process exit
 *  (§5.2.1/§5.6.8): `GET /chat/runs/:id` serves it; a restart empties the registry → 404. */
export function settleChatRun(id: string, patch: { status: 'complete' | 'cancelled' | 'error'; result?: unknown; error?: { code: string; message: string }; durationMs?: number }): void {
  const entry = runs.get(id);
  if (!entry) return;
  entry.status = patch.status;
  if (patch.result !== undefined) entry.result = patch.result;
  if (patch.error) entry.error = patch.error;
  if (patch.durationMs !== undefined) entry.durationMs = patch.durationMs;
}

/** Wire-facing `ChatRun` projection (shared/chat.ts) of a live/terminal chat entry. */
export function chatRunView(entry: LiveRunEntry): {
  id: string;
  status: 'pending' | 'running' | 'complete' | 'cancelled' | 'error';
  sessionId?: string;
  result?: unknown;
  error?: { code: string; message: string };
  durationMs?: number;
} {
  return {
    id: entry.id,
    status: entry.status ?? 'running',
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.result !== undefined ? { result: entry.result } : {}),
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
  };
}

/**
 * Claim the single terminal transition for a run (§5.3.4 dual-fire guard). Returns true for the
 * FIRST caller and false for every subsequent one — the second complete/error arrival after a
 * wall-clock race is a no-op.
 */
export function finalizeOnce(id: string): boolean {
  const entry = runs.get(id);
  if (!entry || entry.finalized) return false;
  entry.finalized = true;
  return true;
}

/** True when a run targeting `artifactId` is still live (the follow-up 409 query, §5.3.5). Keys on
 *  `!finalized` regardless of state, so a QUEUED follow-up keeps blocking same-artifact POSTs. */
export function hasLiveJobForArtifact(artifactId: string): boolean {
  for (const e of runs.values()) {
    if (e.kind === 'build' && e.artifactId === artifactId && !e.finalized) return true;
  }
  return false;
}

/**
 * s1: count a user's build runs currently HOLDING an execution slot (state==='executing'). Queued
 * builds and every non-build run kind (chat, brand-research, agent-face) are excluded. This is the
 * per-user cap counter read inside build.ts's synchronous commit protocol — the count and the
 * state assignment happen with zero awaits between them, so two creates cannot both pass the cap.
 */
export function liveBuildCountForUser(userId: string): number {
  let n = 0;
  for (const e of runs.values()) {
    if (e.kind === 'build' && e.state === 'executing' && e.ownerUserId === userId) n++;
  }
  return n;
}

/**
 * s1: dispatch a user's oldest QUEUED builds while they are under the per-user cap (FIFO by
 * creation order). Each iteration is fully synchronous — flip the oldest queued entry to
 * 'executing', take-and-clear its dispatch thunk, invoke it — so concurrent callers (two builds
 * finishing at once, the enqueue self-check, boot) can never double-dispatch: the just-flipped
 * entry counts as executing on the next liveBuildCountForUser read. Entries still mid-persist
 * (queued but no dispatch thunk yet) are skipped; their own enqueue path self-checks after persist.
 */
export function tryDispatchUser(userId: string): void {
  const cap = Math.max(1, loadAgentsConfig().maxConcurrentBuildsPerUser);
  for (;;) {
    if (liveBuildCountForUser(userId) >= cap) return;
    let oldest: LiveRunEntry | undefined;
    for (const e of runs.values()) {
      if (e.kind === 'build' && e.state === 'queued' && !e.finalized && e.dispatch && e.ownerUserId === userId) {
        if (!oldest || e.startedAt < oldest.startedAt) oldest = e;
      }
    }
    if (!oldest) return;
    oldest.state = 'executing';
    const thunk = oldest.dispatch!;
    oldest.dispatch = undefined;
    thunk();
  }
}

/**
 * Owner-scoped idempotent cancel (§5.3.1). Ordering is load-bearing: set `cancelled` BEFORE
 * firing the abort so the abort path observes the cancelled state and stays quiet instead of
 * double-reporting. Cancelling a terminal/unknown run returns `{ cancelled: false }` without
 * error. Authorization: owner, an org-admin over a build job in its own org, or a super-admin.
 */
export function cancelRun(id: string, actor: Actor): { cancelled: boolean } {
  const entry = runs.get(id);
  if (!entry || entry.finalized || entry.cancelled) return { cancelled: false };
  if (!canCancel(entry, actor)) return { cancelled: false };
  entry.cancelled = true; // BEFORE abort (§5.3.1)
  entry.abort.abort();
  return { cancelled: true };
}

function canCancel(entry: LiveRunEntry, actor: Actor): boolean {
  if (entry.ownerUserId === actor.userId) return true;
  if (actor.role === 'super-admin') return true;
  if (actor.role === 'org-admin' && entry.kind === 'build' && entry.orgId && entry.orgId === actor.orgId) return true;
  return false;
}

// --- First-build reservation map (§5.3.3) ------------------------------------------------

interface Reservation {
  jobId: string;
  expiresAt: number;
}
const reservations = new Map<string, Reservation>();

/**
 * Reserve a first-build slot for `sessionId`, synchronously before any async work (§5.3.3). A
 * second reservation while a live one exists returns the existing job id (the caller binds to it
 * and returns the running job). The reservation stores an empty job id until `bindReservation`
 * sets it — but the mint happens synchronously with no await in between, so a concurrent caller
 * never observes the empty window.
 */
export function reserveFirstBuild(sessionId: string, now: number): { ok: true } | { ok: false; jobId: string } {
  const existing = reservations.get(sessionId);
  if (existing && existing.expiresAt > now) {
    return { ok: false, jobId: existing.jobId };
  }
  // s1 (review #2): a queued build can outlive the reservation TTL - the queue wait alone can
  // exceed it (cap x buildWallClockMs). While a live un-finalized build entry exists for this
  // session, the session stays bound to that job regardless of reservation expiry: re-arm the
  // reservation instead of admitting a rival first build.
  for (const e of runs.values()) {
    if (e.kind === 'build' && e.sessionId === sessionId && !e.finalized) {
      reservations.set(sessionId, { jobId: e.id, expiresAt: now + loadAgentsConfig().firstBuildReservationTtlMs });
      return { ok: false, jobId: e.id };
    }
  }
  reservations.set(sessionId, { jobId: '', expiresAt: now + loadAgentsConfig().firstBuildReservationTtlMs });
  return { ok: true };
}

/** Bind a freshly-minted job id to the live reservation for `sessionId`. */
export function bindReservation(sessionId: string, jobId: string): void {
  const r = reservations.get(sessionId);
  if (r) r.jobId = jobId;
}

/**
 * Release the reservation for `sessionId`, guarded by job id: a late release cannot free a newer
 * reservation (§5.3.3). Called from the run wrapper's `finally`.
 */
export function releaseReservation(sessionId: string, jobId: string): void {
  const r = reservations.get(sessionId);
  if (r && r.jobId === jobId) reservations.delete(sessionId);
}

/** Test-only: clear all registry + reservation state. */
export function __resetRegistryForTests(): void {
  runs.clear();
  reservations.clear();
}

/** Test/introspection: current live run count. */
export function liveRunCount(): number {
  return runs.size;
}
