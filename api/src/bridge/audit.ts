/**
 * bridge/audit.ts — durable Registo rows for the bridge plane (Cofre J-6).
 *
 * WHAT WAS MISSING. Cortex persisted NOTHING about bridge invocations. Only `kind==='read'` ledger
 * rows left the machine at all, and they landed in a 15-minute in-memory Map (`activity-buffer.ts`)
 * that exists to render a trust chip, not to be a record. So the plane with the most physical
 * access to a user's data — the one that reads their files and runs commands on their computer —
 * was the only plane with no durable audit, and "what did Ekoa do on my machine last month" had no
 * answer at all. Grant issuance and revocation were unaudited on BOTH sides.
 *
 * WHAT THIS DELIBERATELY DOES NOT RECORD. Paths. `EgressLedgerRow` carries `path`, and the standing
 * §18.2 / FC-407 invariant is that those rows are never persisted hosted-side, because a path is
 * itself sensitive — client names live in folder names, and for a legal practice a directory
 * listing is privileged. J-6 makes the FACT of an invocation durable (which machine, which task,
 * what outcome, how many bytes) while leaving WHAT WAS READ exactly as un-persisted as before.
 * `BridgeRegistoMetadata` is `.strict()` and has no path field, so this is enforced by the contract
 * rather than by everyone remembering.
 *
 * Same writer discipline as `cofre/audit.ts`: metadata that fails the shape is dropped, the ROW is
 * still written. Losing the detail of an event is bad; losing the fact that it happened is worse.
 */
import { BridgeRegistoMetadata, type BridgeRegistoEvent } from '@ekoa/shared';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';

/** Registo category for the bridge plane. Distinct from `cofre` (credential custody) so a reader
 *  can filter "what did my machine do" from "what happened to my credentials". */
export const BRIDGE_REGISTO_CATEGORY = 'bridge';

export async function recordBridgeEvent(
  actor: ActivityActor,
  event: BridgeRegistoEvent,
  metadata: Record<string, unknown>,
  deps: LogActivityDeps,
): Promise<void> {
  const parsed = BridgeRegistoMetadata.safeParse(metadata);
  const write = logActivity(actor, BRIDGE_REGISTO_CATEGORY, event, deps, parsed.success ? parsed.data : undefined);
  inFlight.add(write);
  try {
    await write;
  } finally {
    inFlight.delete(write);
  }
}

/**
 * In-flight audit writes, so a caller that fired one and moved on can still be waited for.
 *
 * WHY THIS EXISTS. These rows are written fire-and-forget from `delegation.ts` — a delegation must
 * not fail because a bookkeeping row could not be written. The hazard that creates is documented in
 * this repo's own `docs/known-flakes.md`: a fire-and-forget pipeline whose write lands AFTER a test
 * has closed mongo previously produced a whole batch of "every test passed but the lane exited 1".
 * A write that outlives its test file can also land in the next file's collection, and several
 * suites assert on `activityLogs` contents.
 *
 * So the async work is trackable rather than untracked. Production never needs to drain it; test
 * teardown and shutdown do.
 */
const inFlight = new Set<Promise<unknown>>();

/** Wait for every in-flight audit write to settle. Rejections are absorbed — the point is to know
 *  the write is DONE (so teardown cannot race it), not to re-surface a failure already swallowed. */
export async function drainBridgeAudit(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

/**
 * The tool families a TaskProgram touches, for the audit row.
 *
 * Names only, from what the task declares — never arguments, never paths, never patterns. A `grep`
 * pattern is user or model text that can embed anything, and a tool NAME is the coarsest fact that
 * still answers "was this a read or a write". Unknown/oddly-shaped entries are ignored rather than
 * recorded verbatim, so a crafted task cannot smuggle text into the Registo through this field.
 */
const KNOWN_TOOLS = new Set(['read', 'list', 'glob', 'grep', 'stat', 'extract_text', 'write']);

export function toolsUsedIn(taskJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(taskJson);
  } catch {
    return [];
  }
  const steps = (parsed as { steps?: unknown })?.steps;
  if (!Array.isArray(steps)) return [];
  const seen = new Set<string>();
  for (const raw of steps) {
    const tool = (raw as { tool?: unknown })?.tool;
    if (typeof tool === 'string' && KNOWN_TOOLS.has(tool)) seen.add(tool);
  }
  return [...seen].sort();
}
