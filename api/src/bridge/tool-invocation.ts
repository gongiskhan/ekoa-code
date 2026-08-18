/**
 * bridge/tool-invocation.ts — the awaitable half of `tool.invoke` / `tool.result` (Cofre J-1 wiring).
 *
 * The frames landed with J-1; nothing awaited them. This is the coordinator that turns a fire-and-
 * forget frame pair into a promise the automation engine can `await`, and it is what makes
 * `setDaemonConnectionResolver` wireable at all.
 *
 * SAME SHAPE AS `delegation.ts`, deliberately. A pending map keyed by invocation id, a timeout that
 * settles rather than hangs, and a socket-close sweep that fails every in-flight call for that
 * pairing. Copying the delegation coordinator's structure rather than inventing a second one means
 * the failure modes are the ones already reasoned about: a step never hangs forever, a dropped
 * daemon fails its work cleanly instead of leaving a run wedged, and a late frame for a settled
 * invocation is dropped rather than resolving something twice.
 *
 * THE CAPABILITY IS CHECKED BEFORE THE FRAME GOES OUT. `invokeTool` takes the capability the step
 * declared and refuses if the target machine is not granted it. That check belongs here rather than
 * only at placement because placement chooses a machine once, while invocation happens per step —
 * and a capability grant revoked mid-run must take effect on the next step, not at the next run.
 */
import { randomUUID } from 'node:crypto';
import type { BridgeCapability } from '@ekoa/shared';
import { sendToPairing } from './registry.js';
import { isCapabilityGranted } from './capability-grants.js';

/** How long a single tool invocation may take before it is reported unreachable. Generous: a
 *  browser step on a slow machine legitimately takes tens of seconds. */
const INVOCATION_TIMEOUT_MS = 120_000;

export interface ToolResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  /**
   * Per-step visual evidence the machine captured (P1.4), raw base64 PNG. Carried through so the
   * daemon-step seam can map it onto `observation.screenshotB64` - the field
   * `DaemonBrowserSession.ingest` already reads and which then feeds the existing tenant-scoped
   * screenshot plane. It rode `tool.result` all the way to this type and was dropped here, so a
   * bridge run produced no evidence at all while a hosted run produced it for every step.
   */
  screenshotB64?: string;
}

interface Pending {
  pairingId: string;
  resolve: (r: ToolResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();

function settle(invocationId: string, result: ToolResult): void {
  const p = pending.get(invocationId);
  if (!p) return; // late frame for a settled invocation — dropped, never resolved twice
  clearTimeout(p.timer);
  pending.delete(invocationId);
  p.resolve(result);
}

/** Route an inbound `tool.result` frame back to its awaiting caller (server.ts calls this). */
export function resolveToolResult(invocationId: string, result: ToolResult): void {
  settle(invocationId, result);
}

/** Fail every in-flight invocation on a pairing — its socket closed or it was revoked. */
export function failInvocationsForPairing(pairingId: string): void {
  for (const [id, p] of pending) {
    if (p.pairingId === pairingId) settle(id, { ok: false, error: 'the machine disconnected' });
  }
}

export class ToolInvocationRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInvocationRefused';
  }
}

/**
 * Invoke one capability on one machine and await its result.
 *
 * Refuses — rather than sending — when the org has not granted the capability on that machine
 * (I-3). The grant is re-read per invocation on purpose: a capability revoked while a run is in
 * flight must stop the NEXT step, and a check done once at placement would let the rest of the run
 * continue on an authorisation that no longer exists.
 */
export async function invokeTool(input: {
  pairingId: string;
  orgId: string;
  capability: BridgeCapability;
  payload: unknown;
  timeoutMs?: number;
  /**
   * The id this invocation runs under. Supplied when a `secret.deliver` was authorised for the
   * SAME id and must be joined to it on the machine - the daemon keys its RAM-held credential by
   * invocationId, so an id minted independently here would leave the delivery unmatched and the
   * child unauthenticated. Absent (the common case) mints a fresh one, exactly as before.
   */
  invocationId?: string;
}): Promise<ToolResult> {
  const { pairingId, orgId, capability, payload } = input;

  if (!(await isCapabilityGranted(orgId, pairingId, capability))) {
    throw new ToolInvocationRefused(`${capability} is not granted for machine ${pairingId} in this org`);
  }

  const invocationId = input.invocationId ?? randomUUID();
  const result = new Promise<ToolResult>((resolve) => {
    const timer = setTimeout(
      () => settle(invocationId, { ok: false, error: 'the machine did not answer in time' }),
      input.timeoutMs ?? INVOCATION_TIMEOUT_MS,
    );
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    pending.set(invocationId, { pairingId, resolve, timer });
  });

  if (!sendToPairing(pairingId, { type: 'tool.invoke', invocationId, capability, input: payload })) {
    settle(invocationId, { ok: false, error: 'the machine is not reachable' });
  }
  return result;
}

/** Test helper. */
export function __resetInvocationsForTests(): void {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
}

/** Test helper: in-flight invocation count. */
export function __pendingInvocationCount(): number {
  return pending.size;
}
