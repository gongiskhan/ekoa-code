/** Registo org activity read surface — ch03 §3.8.24 (`/api/v1/registo`, metadata only). */
import { z } from 'zod';
import { Id, IsoTimestamp, listResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

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
});
export type RegistoQuery = z.infer<typeof RegistoQuery>;

export const RegistoListResponse = listResponse(RegistoEntry);
export type RegistoListResponse = z.infer<typeof RegistoListResponse>;

export const registoEndpoints = {
  listRegisto: {
    method: 'GET',
    path: '/api/v1/registo',
    auth: 'org-admin',
    query: RegistoQuery,
    response: RegistoListResponse,
  },
} as const satisfies DomainDescriptorMap;
