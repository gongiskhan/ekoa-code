/**
 * bridge/delegation.ts — the hosted `delegate_to_local` tool (ch18 §18.2) and the coordinator that
 * awaits its result frame.
 *
 * `delegateToLocal` is the SOLE chat path to local files (§18.2.4). It mints a signed DelegatedTask
 * bound to the eight S2 fields (§18.2.6, §18.5 S2), resolving org + pairing FROM the registry (never
 * a request body, §18.4.4), sends the `delegate` frame down the bridge, and awaits the
 * `delegation_result` frame — returning DERIVED OUTPUT ONLY (§18.2.2). Offline is honest: with no
 * live pairing the tool returns `unreachable` and NEVER degrades to upload (§18.2.3, S5 — there is
 * no upload primitive anywhere).
 *
 * The coordinator (registerPending / resolveDelegationResult / failDelegationsForPairing) lets the
 * WS server (server.ts) route inbound `delegation_result` / `denial` frames back to the awaiting
 * call, and fail every in-flight delegation cleanly when a socket closes or a pairing is revoked
 * (§18.3.5, S4).
 */
import { randomUUID } from 'node:crypto';
import type { AllowanceRef, BridgeFrame, DelegatedTask, DelegationResult } from '@ekoa/shared';
import { getActivation as defaultGetActivation } from '../data/activation.js';
import { getConnectionByOwner as defaultGetConnectionByOwner, sendToPairing as defaultSend, type LiveConnection } from './registry.js';
import { signDelegatedTask } from './signing.js';

/** How long a minted task stays valid; the daemon rejects a task past its `expiry` (S2). */
const DELEGATION_TASK_TTL_MS = 300_000;

/** How long the tool waits for the `delegation_result` frame before reporting the pairing
 *  unreachable. Generous because the local loop reasons + makes provider round trips. */
const DELEGATION_AWAIT_TIMEOUT_MS = 300_000;

/** The delegating principal: the pairing owner + the hosted conversation id (the §18.4.3 vault key). */
export interface DelegationActor {
  userId: string;
  sessionId: string;
}

/** The tool arguments (§18.2.1). `grantRefs` are opaque — Cortex passes them through, never
 *  resolving or widening them (§18.2.1, S1). */
export interface DelegationRequest {
  task: string;
  grantRefs: string[];
  budget: { egressBytes: number; modelSpend: AllowanceRef };
}

export interface DelegationDeps {
  now?: () => number;
  genId?: () => string;
  genNonce?: () => string;
  getActivation?: (userId: string) => { active: boolean; billingLocked: boolean } | undefined;
  getConnectionByOwner?: (ownerUserId: string) => LiveConnection | undefined;
  send?: (pairingId: string, frame: BridgeFrame) => boolean;
  timeoutMs?: number;
}

interface PendingDelegation {
  pairingId: string;
  resolve: (result: DelegationResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingDelegation>();

/** Empty derived result for an offline/denied outcome (never carries file bytes, §18.2.2). */
function terminalResult(status: DelegationResult['status']): DelegationResult {
  return { status, citations: [], ledgerRefs: [], telemetry: { egressBytes: 0, maskedCounts: {} } };
}

function settle(taskId: string, result: DelegationResult): void {
  const p = pending.get(taskId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(taskId);
  p.resolve(result);
}

/** Resolve an awaiting delegation with the daemon's `delegation_result` frame (server.ts routes it). */
export function resolveDelegationResult(taskId: string, result: DelegationResult): void {
  settle(taskId, result);
}

/** Resolve an awaiting delegation as a clean denial (a `denial` frame carrying this taskId). */
export function resolveDenial(taskId: string): void {
  settle(taskId, terminalResult('denied'));
}

/** Fail every in-flight delegation on a pairing cleanly (socket closed / revoked — §18.3.5, S4). */
export function failDelegationsForPairing(pairingId: string): void {
  for (const [taskId, p] of pending) {
    if (p.pairingId === pairingId) settle(taskId, terminalResult('unreachable'));
  }
}

/**
 * The hosted tool. Resolves the caller's live pairing, mints + signs a bound task, dispatches it,
 * and awaits the derived result. Offline => `unreachable` (no upload, ever). A deactivated /
 * billing-locked owner => a clean denial (the third admission plane at delegation dispatch,
 * §18.3.2). This function is exposed for `agents/` to offer as a chat/build tool; the composition
 * root wires it (an injected seam or a direct call).
 */
export async function delegateToLocal(
  actor: DelegationActor,
  req: DelegationRequest,
  deps: DelegationDeps = {},
): Promise<DelegationResult> {
  const now = deps.now ?? Date.now;
  const genId = deps.genId ?? randomUUID;
  const genNonce = deps.genNonce ?? randomUUID;
  const getActivation = deps.getActivation ?? defaultGetActivation;
  const getConn = deps.getConnectionByOwner ?? defaultGetConnectionByOwner;
  const send = deps.send ?? defaultSend;
  const timeoutMs = deps.timeoutMs ?? DELEGATION_AWAIT_TIMEOUT_MS;

  // Offline is a first-class state — no live pairing means unreachable, never a silent upload
  // (§18.2.3, invariant I1, S5).
  const conn = getConn(actor.userId);
  if (!conn) return terminalResult('unreachable');

  // Activation admission at delegation dispatch (§18.3.2): a deactivated / billing-locked owner's
  // delegation fails cleanly. The DelegationResult shape cannot carry a CONV-2 code, so this maps
  // to a clean `denied` (the connect + provider planes surface ACCOUNT_DISABLED / BILLING_LOCKED).
  const act = getActivation(conn.ownerUserId);
  if (!act || !act.active || act.billingLocked) return terminalResult('denied');

  // Mint the S2 binding. org + pairingId come from the registry-resolved connection, NEVER a
  // request body (§18.4.4); a fresh nonce and a future expiry bind replay + staleness (S2).
  const base: Omit<DelegatedTask, 'sig'> = {
    taskId: genId(),
    org: conn.org,
    user: actor.userId,
    session: actor.sessionId,
    pairingId: conn.pairingId,
    grantRefs: req.grantRefs,
    task: req.task,
    budget: req.budget,
    expiry: new Date(now() + DELEGATION_TASK_TTL_MS).toISOString(),
    nonce: genNonce(),
  };
  const task: DelegatedTask = { ...base, sig: signDelegatedTask(base) };

  const result = new Promise<DelegationResult>((resolve) => {
    const timer = setTimeout(() => settle(task.taskId, terminalResult('unreachable')), timeoutMs);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    pending.set(task.taskId, { pairingId: task.pairingId, resolve, timer });
  });

  // Dispatch. A failed send (socket died between resolve and send) is an honest unreachable.
  if (!send(task.pairingId, { type: 'delegate', task })) {
    settle(task.taskId, terminalResult('unreachable'));
  }

  return result;
}

/** Test helper: clear the pending-delegation table (resolves nothing; drops timers). */
export function __resetPendingDelegationsForTests(): void {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
}
