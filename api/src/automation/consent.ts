/**
 * local_command first-time consent (ch05 §5.6.7; invisible-behaviors §13.4). A local_command step
 * runs on the user's machine, so the FIRST time a given command SHAPE (command-shape.ts) is seen it
 * needs the owner's approval: approve once (run now, no persistence), approve always (persist so it
 * never re-prompts), or stop (deny → the run cancels). Approvals persist in the registered
 * `approved_commands` store (data/stores.ts) — re-pointed from the old Cortex
 * `user.preferences.approvedLocalCommandShapes`.
 *
 * The engine drives the pause/resume around this (awaiting_consent → resumeSignal); the "always"
 * write and the revoke are owner-scoped operations the consent route / test performs through the
 * helpers below. This module makes no model call and never fails a run on a bookkeeping write.
 */
import { approvedCommands } from '../data/stores.js';

interface ApprovedCommandDoc {
  _id: string;
  userId: string;
  shape: string;
  createdAt: string;
  lastUsedAt?: string;
}

function idFor(userId: string, shape: string): string {
  return `${userId}::${shape}`;
}

/** Is this command shape already approved (approve-always) for the owner? */
export async function isCommandShapeApproved(userId: string, shape: string): Promise<boolean> {
  return (await approvedCommands.get(idFor(userId, shape))) != null;
}

/** Persist an approve-always for the owner (idempotent). */
export async function approveCommandShape(userId: string, shape: string, now: () => number = Date.now): Promise<void> {
  const doc: ApprovedCommandDoc = {
    _id: idFor(userId, shape),
    userId,
    shape,
    createdAt: new Date(now()).toISOString(),
  };
  await approvedCommands.put(doc as never);
}

/** Revoke a previously approved command shape. Returns true if a row was removed. */
export async function revokeCommandShape(userId: string, shape: string): Promise<boolean> {
  return approvedCommands.delete(idFor(userId, shape));
}

/** Bump lastUsedAt on an approved shape (fire-and-forget; swallows failures). */
export async function recordApprovalUse(userId: string, shape: string, now: () => number = Date.now): Promise<void> {
  await approvedCommands
    .update(idFor(userId, shape), (cur) => ({ ...cur, lastUsedAt: new Date(now()).toISOString() }))
    .catch(() => null);
}

/** All approved command shapes for the owner. */
export async function listApprovedShapes(userId: string): Promise<string[]> {
  const rows = (await approvedCommands.find({ userId })) as unknown as ApprovedCommandDoc[];
  return rows.map((r) => r.shape);
}

/** Approved command records for the owner (shape + createdAt), for the wire ApprovedCommand shape. */
export async function listApprovedCommandRecords(userId: string): Promise<Array<{ shape: string; createdAt?: string }>> {
  const rows = (await approvedCommands.find({ userId }, { createdAt: -1 })) as unknown as ApprovedCommandDoc[];
  return rows.map((r) => ({ shape: r.shape, createdAt: r.createdAt }));
}
