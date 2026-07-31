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
 *
 * SCOPING (Cofre J-7, 2026-07-28). An approval used to be keyed on `userId::shape` alone: no
 * tenant, no machine, no expiry. Three consequences, all closed here:
 *
 *  - **Tenant.** The row carries `orgId` and a lookup requires it. A user who moves between orgs
 *    does not carry local-command approvals across the boundary with them.
 *  - **Machine.** An approval is bound to the PAIRING it was granted for. "Yes, run `git push` on
 *    my work laptop" was never an answer about the machine the user paired later; a second machine
 *    asks again. Callers that cannot name a pairing pass `null`, which is its own distinct scope
 *    and never matches a pairing-bound row.
 *  - **TTL.** Approvals expire (`APPROVAL_TTL_DAYS`). An indefinite standing permission to execute
 *    a command on someone's computer is not something a user meaningfully consented to a year ago,
 *    and the lookup treats an expired row as absent so the prompt simply returns.
 *
 * LEGACY ROWS. Pre-J-7 shapes contain `<FILE>`/`<DIR>`/`<URL>`/`<SCRIPT>` wildcards. Those rows are
 * refused outright rather than matched, so an over-broad approval cannot survive the fix — see
 * `command-shape.ts` DEVIATION 2 for why `cat <FILE>` was a hole rather than a convenience.
 */
import { approvedCommands } from '../data/stores.js';
import { isLegacyWildcardShape } from './command-shape.js';

/** How long an "approve always" stands before the owner is asked again. */
export const APPROVAL_TTL_DAYS = 90;
const APPROVAL_TTL_MS = APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000;

interface ApprovedCommandDoc {
  _id: string;
  userId: string;
  /** Tenant the approval was granted in (J-7). Absent on a pre-J-7 row. */
  orgId?: string;
  /** Machine the approval was granted for (J-7); null = "no specific machine". */
  pairingId?: string | null;
  shape: string;
  createdAt: string;
  /** ISO expiry (J-7). Absent on a pre-J-7 row, which is treated as expired. */
  expiresAt?: string;
  lastUsedAt?: string;
}

/** The scope an approval is granted in and looked up by. */
export interface ApprovalScope {
  userId: string;
  orgId: string;
  /** The paired machine this approval applies to; null when the caller has no pairing in hand. */
  pairingId?: string | null;
}

function idFor(scope: ApprovalScope, shape: string): string {
  return `${scope.orgId}::${scope.userId}::${scope.pairingId ?? '-'}::${shape}`;
}

/**
 * Is this command shape approved for this owner, in this org, on this machine, and still valid?
 *
 * Every one of those qualifiers is load-bearing, and a miss on any of them is a re-prompt, not a
 * failure. Fail-closed by construction: an unknown row, a legacy wildcard row and an expired row
 * all read as "not approved".
 */
export async function isCommandShapeApproved(scope: ApprovalScope, shape: string, now: () => number = Date.now): Promise<boolean> {
  // A wildcard shape can no longer be PRODUCED, so seeing one here means a crafted argument rather
  // than a real command. Refuse before the lookup so it can never match a legacy row.
  if (isLegacyWildcardShape(shape)) return false;
  const row = (await approvedCommands.get(idFor(scope, shape))) as ApprovedCommandDoc | null;
  if (!row) return false;
  if (isLegacyWildcardShape(row.shape)) return false;
  // A row with no expiry predates J-7; treat it as expired rather than as permanent.
  if (!row.expiresAt) return false;
  return Date.parse(row.expiresAt) > now();
}

/** Persist an approve-always for the owner, in scope (idempotent). */
export async function approveCommandShape(scope: ApprovalScope, shape: string, now: () => number = Date.now): Promise<void> {
  const at = now();
  const doc: ApprovedCommandDoc = {
    _id: idFor(scope, shape),
    userId: scope.userId,
    orgId: scope.orgId,
    pairingId: scope.pairingId ?? null,
    shape,
    createdAt: new Date(at).toISOString(),
    expiresAt: new Date(at + APPROVAL_TTL_MS).toISOString(),
  };
  await approvedCommands.put(doc as never);
}

/**
 * Revoke an approved command shape for the owner across EVERY machine in the org.
 *
 * Deliberately not pairing-scoped, even though the rows are: revocation is a safety action and the
 * wire request carries only the shape, so a per-machine revoke would silently leave the same
 * approval standing on the user's other paired machines — the opposite of what someone clicking
 * "revogar" means. Returns true if anything was removed.
 */
export async function revokeCommandShape(scope: { userId: string; orgId: string }, shape: string): Promise<boolean> {
  const removed = await approvedCommands.deleteMany({ userId: scope.userId, orgId: scope.orgId, shape });
  return removed > 0;
}

/** Bump lastUsedAt on an approved shape (fire-and-forget; swallows failures). */
export async function recordApprovalUse(scope: ApprovalScope, shape: string, now: () => number = Date.now): Promise<void> {
  await approvedCommands
    .update(idFor(scope, shape), (cur) => ({ ...cur, lastUsedAt: new Date(now()).toISOString() }))
    .catch(() => null);
}

/** Live (non-legacy, unexpired) approved command shapes for the owner across their org. */
export async function listApprovedShapes(userId: string, now: () => number = Date.now): Promise<string[]> {
  return (await listApprovedCommandRecords(userId, now)).map((r) => r.shape);
}

/**
 * Approved command records for the owner, for the wire `ApprovedCommand` shape.
 *
 * Legacy and expired rows are filtered OUT rather than shown: listing an approval that can never
 * match again would tell the user they have a standing permission they do not have, which is the
 * inverse of what this list is for.
 */
export async function listApprovedCommandRecords(
  userId: string,
  now: () => number = Date.now,
): Promise<Array<{ shape: string; createdAt?: string }>> {
  const rows = (await approvedCommands.find({ userId }, { createdAt: -1 })) as unknown as ApprovedCommandDoc[];
  const at = now();
  return rows
    .filter((r) => !isLegacyWildcardShape(r.shape))
    .filter((r) => r.expiresAt !== undefined && Date.parse(r.expiresAt) > at)
    .map((r) => ({ shape: r.shape, createdAt: r.createdAt }));
}
