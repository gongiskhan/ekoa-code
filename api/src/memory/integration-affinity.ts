/**
 * Integration-affinity writer (ch05 §5.8 item 1; reference/invisible-behaviors.md §11.6). A
 * deterministic, NO-model-call writer that `integrations/` invokes on integration creation,
 * configuration update, and re-enable. It writes or refreshes ONE idempotent shared `preference`
 * memory keyed by the tag `integration-affinity:<key>` — the mechanism by which agents learn to
 * prefer a connected integration. Re-enabling refreshes the timestamps of the existing row
 * instead of duplicating it. Write failures are SWALLOWED: the memory is advisory and must never
 * fail the configuration operation.
 *
 * Idempotency is by a deterministic `_id` (`memAff:<orgId>:<key>`), so exactly one row exists per
 * (org, integration key) regardless of how many times the writer fires.
 */
import { memories } from '../data/stores.js';
import type { MemoryDoc } from './resolver.js';

export interface AffinityInput {
  orgId: string;
  userId: string;
  integrationKey: string;
  /** Human label used in the preference text ("Prefer <label> for …"). */
  label: string;
  /** Task descriptors this integration is preferred for. */
  taskHints?: string[];
  /** Trigger keywords that should route to this integration. */
  triggerKeywords?: string[];
  deps: { now: () => number };
}

function affinityId(orgId: string, key: string): string {
  return `memAff:${orgId}:${key}`;
}

function affinityContent(input: AffinityInput): string {
  const tasks = input.taskHints?.length ? ` for tasks ${input.taskHints.join(', ')}` : '';
  const triggers = input.triggerKeywords?.length ? ` Trigger keywords: ${input.triggerKeywords.join(', ')}.` : '';
  return `Prefer ${input.label}${tasks}.${triggers}`.trim();
}

/**
 * Write or refresh the affinity memory. Returns the memory id on success, or null when the write
 * was swallowed (never throws). Zero model calls (asserted by acceptance criterion 11).
 */
export async function writeIntegrationAffinity(input: AffinityInput): Promise<string | null> {
  const id = affinityId(input.orgId, input.integrationKey);
  const now = new Date(input.deps.now()).toISOString();
  const tag = `integration-affinity:${input.integrationKey}`;
  try {
    const doc: MemoryDoc = {
      _id: id,
      orgId: input.orgId,
      userId: input.userId,
      visibility: 'org', // shared preference
      title: `Integration affinity: ${input.label}`,
      content: affinityContent(input),
      type: 'preference',
      tags: [tag],
      tier: 'active',
      score: 85,
      verified: true,
      createdAt: now,
      updatedAt: now,
    } as MemoryDoc;
    const inserted = await memories.insert(doc as never);
    if (!inserted) {
      // Existing row: refresh the timestamps + content, never duplicate (§5.8).
      await memories.update(id, (cur) => ({
        ...cur,
        content: affinityContent(input),
        tags: [tag],
        score: 85,
        verified: true,
        updatedAt: now,
      } as never));
    }
    return id;
  } catch {
    return null; // swallowed — advisory write must never fail the configuration operation
  }
}
