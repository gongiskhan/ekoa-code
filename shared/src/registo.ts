/** Registo org activity read surface — ch03 §3.8.24 (`/api/v1/registo`, metadata only). */
import { z } from 'zod';
import { Id, IsoTimestamp, listResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

/**
 * One activity row. `actionType` = `<category>.<type>` under the ONE event vocabulary (A5
 * memo, run 20260717-190134): `app-assistant.action.<outcome>` (landed), `voice.turn` +
 * `voice.tts` (C2 - a voice turn logs like any agent action, `source:'voice'` + refs in
 * metadata, never transcript/audio bodies), `portal.*` (Part E). `usageCounts` keys reuse the
 * metering-ledger counter names VERBATIM (memo rule 3) - e.g. `voice.turn` carries
 * `voice_stt_ms`, `voice.tts` carries `voice_tts_chars`; the ledger and the activity row
 * never invent two names for one quantity. Vocabulary extension is additive only.
 */
export const RegistoEntry = z
  .object({
    actor: Id,
    actionType: z.string(),
    timestamp: IsoTimestamp,
    targetIds: z.array(Id).optional(),
    usageCounts: z.record(z.number()).optional(),
  })
  .passthrough();
export type RegistoEntry = z.infer<typeof RegistoEntry>;

export const RegistoQuery = z.object({
  userId: Id.optional(),
  type: z.string().optional(),
  from: IsoTimestamp.optional(),
  to: IsoTimestamp.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  orgId: Id.optional(),
  /**
   * DOCUMENTED DEFAULT (registo-anon-audit-actor-blank mitigation, docs/findings.md): without an
   * explicit `type` filter, `readRegisto` (api/src/services/platform-crud.ts) hides
   * `category: 'anonymisation'` rows - a single chat/build turn's Agent SDK subprocess writes
   * many of these per one human action, most correctly `'system'`-attributed (no per-request
   * principal exists at that HTTP boundary) rather than a person, so left in they swamp every
   * human-attributable row in the one place this matters: a super-admin's unscoped cross-org
   * view (an org-scoped view never sees them regardless - their `orgId` never matches a real
   * org). The filtering is a documented, VISIBLE default, never a silent one: the web surfaces
   * it as a notice with a one-click toggle (`web/app/(dashboard)/registo/page.tsx`), and an
   * explicit `type` filter already bypasses it (unchanged reachability). `'true'`/`'false'` as
   * strings since GET query values are always strings on the wire.
   */
  includeAnonymisation: z.enum(['true', 'false']).optional(),
});
export type RegistoQuery = z.infer<typeof RegistoQuery>;

export const RegistoListResponse = listResponse(RegistoEntry);
export type RegistoListResponse = z.infer<typeof RegistoListResponse>;

/** FC-408 masking activity summary (§17.6): the caller's OWN anonymisation-audit aggregate —
 *  entity classes and counts, never bodies, never the vault. Per-user surface (the settings
 *  privacy page), hence auth `user`, scoped server-side to the requester. */
export const MaskingSummaryResponse = z.object({
  /** entity class -> total count of masked entities across the user's audited events. */
  classes: z.record(z.number()),
  entityCount: z.number(),
  events: z.number(),
});
export type MaskingSummaryResponse = z.infer<typeof MaskingSummaryResponse>;

export const registoEndpoints = {
  listRegisto: {
    method: 'GET',
    path: '/api/v1/registo',
    auth: 'org-admin',
    query: RegistoQuery,
    response: RegistoListResponse,
  },
  maskingSummary: {
    method: 'GET',
    path: '/api/v1/registo/masking-summary',
    auth: 'user',
    response: MaskingSummaryResponse,
  },
} as const satisfies DomainDescriptorMap;
