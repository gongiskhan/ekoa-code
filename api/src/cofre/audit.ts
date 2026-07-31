/**
 * cofre/audit.ts — the Cofre's Registo writer.
 *
 * Lives in the DOMAIN module, not the route, because `routes/` may not import `data/` (ch02 §2.7).
 * More importantly, the metadata is validated against `CofreRegistoMetadata`, which is `.strict()`:
 * `RegistoEntry.metadata` is `.passthrough()`, so without that validation a Cofre event could
 * validly carry a credential into an audit trail that is rendered in the dashboard. A row that
 * fails the shape is written WITHOUT metadata rather than dropped — losing the fact that something
 * happened is worse than losing its detail.
 */
import { CofreRegistoMetadata, type CofreRegistoEvent } from '@ekoa/shared';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';

export async function recordCofreEvent(
  actor: ActivityActor,
  event: CofreRegistoEvent,
  metadata: Record<string, unknown>,
  deps: LogActivityDeps,
): Promise<void> {
  const parsed = CofreRegistoMetadata.safeParse(metadata);
  await logActivity(actor, 'cofre', event, deps, parsed.success ? parsed.data : undefined);
}
