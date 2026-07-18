/**
 * The single audit write path (FIXED-8, ch09 invariant 3, Registo-ready). Exactly one
 * exported write function; direct writes to the activity collection are grep-banned
 * elsewhere. Records userId + a real username (the old username-stores-id bug is fixed
 * here) + orgId (Amendment 2, backs the Registo read surface).
 */
import { activityLogs, type ActivityLogDoc } from './stores.js';

export interface ActivityActor {
  userId: string;
  username: string;
  orgId: string;
}

let idSeq = 0;
export interface LogActivityDeps {
  now: () => number;
  genId?: () => string;
}

export async function logActivity(
  actor: ActivityActor,
  category: string,
  type: string,
  deps: LogActivityDeps,
  metadata?: Record<string, unknown>,
  usageCounts?: Record<string, number>,
): Promise<void> {
  const id = deps.genId ? deps.genId() : `act_${deps.now()}_${idSeq++}`;
  const doc: ActivityLogDoc = {
    _id: id,
    userId: actor.userId,
    username: actor.username,
    orgId: actor.orgId,
    category,
    type,
    timestamp: new Date(deps.now()).toISOString(),
    ...(metadata ? { metadata } : {}),
    // Counter names verbatim from the metering ledger (A5 vocabulary memo rule 3).
    ...(usageCounts && Object.keys(usageCounts).length > 0 ? { usageCounts } : {}),
  };
  await activityLogs.insert(doc);
}
