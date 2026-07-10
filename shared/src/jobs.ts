// Build jobs domain contract (ch03 §3.8.8, §3.6.2): job resource, create, cancel, event stream.
import { z } from 'zod';
import { UploadRef } from './common.js';
import { JobEvent } from './events.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const Job = z
  .object({
    id: z.string(),
    status: z.string(),
    artifactId: z.string().optional(),
    slug: z.string().optional(),
    createdAt: z.string(),
    /** The terminal failure cause (F7): the record has always persisted it, but jobView omitted
     *  it, so a failed job looked cause-less to clients. Present only on a failed job. */
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  })
  .passthrough();
export type Job = z.infer<typeof Job>;

export const JobCreateRequest = z.object({
  // POST /jobs creates BUILD jobs only (ch03 §3.8.8). Brand-research jobs are created
  // exclusively via POST /branding/research (§3.8.4, org-admin) and merely reuse the
  // jobs RESOURCE for state/events — they are not creatable through this endpoint.
  kind: z.literal('build'),
  description: z.string(),
  sessionId: z.string(),
  language: z.enum(['pt', 'en']).default('pt'),
  templateId: z.string().optional(),
  integrationKeys: z.array(z.string()).optional(),
  artifactId: z.string().optional(),
  attachments: z.array(UploadRef).optional(),
  fieldValues: z.record(z.unknown()).optional(),
  configValues: z.record(z.unknown()).optional(),
});
export type JobCreateRequest = z.infer<typeof JobCreateRequest>;

export const JobCreateResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('created'), job: Job }),
  z.object({ status: z.literal('answered'), reason: z.string() }),
]);
export type JobCreateResponse = z.infer<typeof JobCreateResponse>;

export const JobCancelResponse = z.object({ cancelled: z.boolean() });
export type JobCancelResponse = z.infer<typeof JobCancelResponse>;

export const jobsEndpoints = {
  create: {
    method: 'POST',
    path: '/api/v1/jobs',
    auth: 'user',
    request: JobCreateRequest,
    response: JobCreateResponse,
    language: true,
  },
  get: {
    method: 'GET',
    path: '/api/v1/jobs/:id',
    auth: 'user',
    response: Job,
  },
  cancel: {
    method: 'POST',
    path: '/api/v1/jobs/:id/cancel',
    auth: 'user',
    response: JobCancelResponse,
  },
  events: {
    method: 'GET',
    path: '/api/v1/jobs/:id/events',
    auth: 'token-query',
    kind: 'sse',
    response: JobEvent,
  },
} as const satisfies DomainDescriptorMap;
