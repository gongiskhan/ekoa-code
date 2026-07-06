/** Triggers + webhook ingress contract (ch03 §3.8.17). */
import { z } from 'zod';
import { Id, IsoTimestamp, itemsResponse, OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const Trigger = z
  .object({
    id: Id,
    integrationKey: z.string(),
    eventName: z.string(),
    automationId: Id.optional(),
    artifactId: Id.optional(),
    entrypoint: z.string().optional(),
    active: z.boolean().optional(),
    publicUrl: z.string(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type Trigger = z.infer<typeof Trigger>;

// The wire shape per ch03 §3.8.17: a union of the two spec-shaped target variants.
// The automation target is FLAT (no `kind`, no `target` wrapper); the artifact-backend
// target carries a nested `target: { kind: 'artifact-backend', ... }`. A plain z.union
// matches the published shape (the variants are structurally distinct — the nested
// `target` vs a flat `automationId`) without inventing a top-level discriminator the
// client never sends. Artifact-backend is tried first (its required nested `target`
// makes it the more specific match).
const AutomationTargetTrigger = z.object({
  automationId: Id,
  integrationKey: z.string(),
  eventName: z.string(),
  artifactId: Id.optional(),
});

const ArtifactBackendTargetTrigger = z.object({
  integrationKey: z.string(),
  eventName: z.string(),
  target: z.object({
    kind: z.literal('artifact-backend'),
    artifactId: Id,
    entrypoint: z.string(),
  }),
});

export const TriggerCreateRequest = z.union([
  ArtifactBackendTargetTrigger,
  AutomationTargetTrigger,
]);
export type TriggerCreateRequest = z.infer<typeof TriggerCreateRequest>;

export const TriggerCreateResponse = z.object({
  trigger: Trigger,
  publicUrl: z.string(),
  secret: z.string().optional(),
  registrationError: z.string().optional(),
});
export type TriggerCreateResponse = z.infer<typeof TriggerCreateResponse>;

export const TriggerListResponse = itemsResponse(Trigger);
export type TriggerListResponse = z.infer<typeof TriggerListResponse>;

export const WebhookIngressResponse = z
  .object({ duplicate: z.boolean().optional() })
  .passthrough();
export type WebhookIngressResponse = z.infer<typeof WebhookIngressResponse>;

export const triggersEndpoints: DomainDescriptorMap = {
  list: {
    method: 'GET',
    path: '/api/v1/triggers',
    auth: 'user',
    response: TriggerListResponse,
  },
  create: {
    method: 'POST',
    path: '/api/v1/triggers',
    auth: 'user',
    request: TriggerCreateRequest,
    response: TriggerCreateResponse,
  },
  delete: {
    method: 'DELETE',
    path: '/api/v1/triggers/:id',
    auth: 'user',
    response: OkResponse,
  },
  listForAutomation: {
    method: 'GET',
    path: '/api/v1/automations/:id/triggers',
    auth: 'user',
    response: TriggerListResponse,
  },
  webhookIngressPost: {
    method: 'POST',
    path: '/hooks/:triggerId',
    auth: 'hmac',
    response: WebhookIngressResponse,
  },
  webhookIngressGet: {
    method: 'GET',
    path: '/hooks/:triggerId',
    auth: 'hmac',
    response: WebhookIngressResponse,
  },
};
