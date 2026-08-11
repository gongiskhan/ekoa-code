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
    /** brand-research: whether the merge wrote anything onto org.branding. */
    brandingApplied: z.boolean().optional(),
    /** brand-research: whether usable brand COLORS were applied. `false` means the site yielded
     *  no non-neutral color the research could trust — the fail-loud signal the old platform
     *  raised as NO_PRIMARY_COLOR; the client tells the user to set colors manually. */
    colorsApplied: z.boolean().optional(),
    /** brand-research: non-fatal degradation codes (e.g. NO_PRIMARY_COLOR). */
    warnings: z.array(z.string()).optional(),
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
  // WS6 incident fix (Rule 7, additive): `description` is often the chat-agent's <=15-word build
  // paraphrase, not the user's own words - a paraphrase used to be the ENTIRE input to both the
  // artifact-type classifier and the build agent's prompt, so "a construir uma apresentação..."
  // briefed a slide deck when the user asked for a website. `originalMessage` carries the user's
  // actual request text alongside it; `description` keeps naming the artifact (what it is good
  // at). Absent on a direct composer build, where `description` already IS the user's own text.
  originalMessage: z.string().optional(),
  sessionId: z.string(),
  language: z.enum(['pt', 'en']).default('pt'),
  templateId: z.string().optional(),
  integrationKeys: z.array(z.string()).optional(),
  artifactId: z.string().optional(),
  attachments: z.array(UploadRef).optional(),
  fieldValues: z.record(z.unknown()).optional(),
  configValues: z.record(z.unknown()).optional(),
  // F1 knowledge-during-build: scoping-provided reference documents a domain-heavy FIRST build
  // ingests into the org knowledge area (org-scoped server-side by the run's actor). Additive +
  // optional. Bounded at the boundary: max 20 docs, 256 KiB of text each.
  knowledgeDocs: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        text: z.string().min(1).max(262144),
        collection: z.string().min(1).max(100).optional(),
      }),
    )
    .max(20)
    .optional(),
});
export type JobCreateRequest = z.infer<typeof JobCreateRequest>;

export const JobCreateResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('created'), job: Job }),
  z.object({ status: z.literal('answered'), reason: z.string() }),
]);
export type JobCreateResponse = z.infer<typeof JobCreateResponse>;

export const JobCancelResponse = z.object({ cancelled: z.boolean() });
export type JobCancelResponse = z.infer<typeof JobCancelResponse>;

/** Steer (Conduzir): inject a user message into the IN-FLIGHT build run (same contract as
 *  chat.steerRun — `steered: false` is the queue-and-flush fallback signal, never an error). */
export const JobSteerRequest = z.object({ message: z.string().min(1) });
export type JobSteerRequest = z.infer<typeof JobSteerRequest>;

export const JobSteerResponse = z.object({ steered: z.boolean() });
export type JobSteerResponse = z.infer<typeof JobSteerResponse>;

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
  steer: {
    method: 'POST',
    path: '/api/v1/jobs/:id/steer',
    auth: 'user',
    request: JobSteerRequest,
    response: JobSteerResponse,
  },
  events: {
    method: 'GET',
    path: '/api/v1/jobs/:id/events',
    auth: 'token-query',
    kind: 'sse',
    response: JobEvent,
  },
} as const satisfies DomainDescriptorMap;
