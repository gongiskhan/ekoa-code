// Automations domain contract (ch03 §3.8.18, §3.6.3): automations CRUD, plan-from-goal, runs, consent, catalog, approved commands.
import { z } from 'zod';
import { Id, IsoTimestamp, itemsResponse, OkResponse, Language, Visibility } from './common.js';
import { AutomationRunEvent } from './events.js';
import type { DomainDescriptorMap } from './descriptor.js';

/** Run status machine (ch03 §3.6.3; ops-inventory §17). */
export const RunStatus = z.enum([
  'idle',
  'running',
  'completed',
  'failed',
  'cancelled',
  'awaiting_integration',
  'paused_for_user',
  'awaiting_consent',
  'awaiting_daemon',
]);
export type RunStatus = z.infer<typeof RunStatus>;

/** A step in an automation plan. */
export const PlanStep = z
  .object({
    stepId: Id.optional(),
    index: z.number().int().optional(),
    description: z.string().optional(),
    tool: z.string().optional(),
    argv: z.array(z.string()).optional(),
  })
  .passthrough();
export type PlanStep = z.infer<typeof PlanStep>;

/** The planned step sequence for an automation. */
export const Plan = z
  .object({
    steps: z.array(PlanStep).optional(),
    status: z.string().optional(),
  })
  .passthrough();
export type Plan = z.infer<typeof Plan>;

export const Automation = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string().optional(),
    plan: Plan.optional(),
    status: z.string().optional(),
    ownerId: Id.optional(),
    orgId: Id.optional(),
    visibility: Visibility.optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type Automation = z.infer<typeof Automation>;

export const AutomationCreateRequest = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    plan: Plan.optional(),
    visibility: Visibility.optional(),
  })
  .passthrough();
export type AutomationCreateRequest = z.infer<typeof AutomationCreateRequest>;

export const AutomationPatch = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    plan: Plan.optional(),
    status: z.string().optional(),
    visibility: Visibility.optional(),
  })
  .passthrough();
export type AutomationPatch = z.infer<typeof AutomationPatch>;

/** Plan-from-goal request (language-carrying, ch03 §3.4). */
export const PlanRequest = z.object({
  goal: z.string(),
  name: z.string().optional(),
  automationId: Id.optional(),
  language: Language,
});
export type PlanRequest = z.infer<typeof PlanRequest>;

/**
 * Landmine 9: plan-from-goal is not pure planning - it persists the automation
 * and starts a rehearsal run, so the response names both side effects.
 */
export const PlanResponse = z.object({
  plan: Plan,
  automation: Automation.optional(),
  runId: Id.optional(),
  rehearsing: z.boolean().optional(),
});
export type PlanResponse = z.infer<typeof PlanResponse>;

export const RunRecord = z
  .object({
    id: Id,
    automationId: Id,
    status: RunStatus,
    inputs: z.record(z.unknown()).optional(),
    summary: z.string().optional(),
    startedAt: IsoTimestamp.optional(),
    finishedAt: IsoTimestamp.optional(),
    ownerId: Id.optional(),
    orgId: Id.optional(),
  })
  .passthrough();
export type RunRecord = z.infer<typeof RunRecord>;

export const RunCreateRequest = z.object({
  inputs: z.record(z.unknown()).optional(),
});
export type RunCreateRequest = z.infer<typeof RunCreateRequest>;

export const RunCreateResponse = z.object({ runId: Id });
export type RunCreateResponse = z.infer<typeof RunCreateResponse>;

export const RunCancelResponse = z.object({ cancelled: z.boolean() });
export type RunCancelResponse = z.infer<typeof RunCancelResponse>;

export const RunResumeResponse = z.object({ resumed: z.boolean() });
export type RunResumeResponse = z.infer<typeof RunResumeResponse>;

export const ConsentRequest = z.object({
  decision: z.enum(['once', 'always', 'stop']),
  shape: z.string(),
});
export type ConsentRequest = z.infer<typeof ConsentRequest>;

export const ConsentResult = z
  .object({
    decision: z.enum(['once', 'always', 'stop']).optional(),
    resumed: z.boolean().optional(),
    persisted: z.boolean().optional(),
  })
  .passthrough();
export type ConsentResult = z.infer<typeof ConsentResult>;

export const StepFeedbackRequest = z.object({
  kind: z.string(),
  note: z.string().optional(),
});
export type StepFeedbackRequest = z.infer<typeof StepFeedbackRequest>;

export const StepFeedbackResponse = z.object({
  ok: z.literal(true),
  evicted: z.boolean().optional(),
});
export type StepFeedbackResponse = z.infer<typeof StepFeedbackResponse>;

export const CatalogEntry = z
  .object({
    key: z.string(),
    name: z.string(),
    description: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();
export type CatalogEntry = z.infer<typeof CatalogEntry>;

export const CatalogResponse = z.object({
  automations: z.array(CatalogEntry),
  integrationActions: z.array(CatalogEntry),
});
export type CatalogResponse = z.infer<typeof CatalogResponse>;

export const ApprovedCommand = z
  .object({
    shape: z.string(),
    description: z.string().optional(),
    createdAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type ApprovedCommand = z.infer<typeof ApprovedCommand>;

export const RevokeApprovedCommandRequest = z.object({ shape: z.string() });
export type RevokeApprovedCommandRequest = z.infer<typeof RevokeApprovedCommandRequest>;

export const RevokeApprovedCommandResponse = z.object({
  revoked: z.boolean(),
  remaining: z.number().int().nonnegative(),
});
export type RevokeApprovedCommandResponse = z.infer<typeof RevokeApprovedCommandResponse>;

export const AutomationListResponse = itemsResponse(Automation);
export type AutomationListResponse = z.infer<typeof AutomationListResponse>;

export const RunListResponse = itemsResponse(RunRecord);
export type RunListResponse = z.infer<typeof RunListResponse>;

export const ApprovedCommandListResponse = itemsResponse(ApprovedCommand);
export type ApprovedCommandListResponse = z.infer<typeof ApprovedCommandListResponse>;

export const RunListQuery = z.object({
  automationId: Id.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type RunListQuery = z.infer<typeof RunListQuery>;

export const automationsEndpoints: DomainDescriptorMap = {
  list: {
    method: 'GET',
    path: '/api/v1/automations',
    auth: 'user',
    response: AutomationListResponse,
  },
  get: {
    method: 'GET',
    path: '/api/v1/automations/:id',
    auth: 'user',
    response: Automation,
  },
  create: {
    method: 'POST',
    path: '/api/v1/automations',
    auth: 'org-admin',
    request: AutomationCreateRequest,
    response: Automation,
  },
  patch: {
    method: 'PATCH',
    path: '/api/v1/automations/:id',
    auth: 'user',
    request: AutomationPatch,
    response: Automation,
  },
  remove: {
    method: 'DELETE',
    path: '/api/v1/automations/:id',
    auth: 'user',
    response: OkResponse,
  },
  plan: {
    method: 'POST',
    path: '/api/v1/automations/plan',
    auth: 'user',
    request: PlanRequest,
    response: PlanResponse,
    language: true,
  },
  createRun: {
    method: 'POST',
    path: '/api/v1/automations/:id/runs',
    auth: 'user',
    request: RunCreateRequest,
    response: RunCreateResponse,
  },
  listRuns: {
    method: 'GET',
    path: '/api/v1/automations/runs',
    auth: 'user',
    query: RunListQuery,
    response: RunListResponse,
  },
  getRun: {
    method: 'GET',
    path: '/api/v1/automations/runs/:id',
    auth: 'user',
    response: RunRecord,
  },
  cancelRun: {
    method: 'POST',
    path: '/api/v1/automations/runs/:id/cancel',
    auth: 'user',
    response: RunCancelResponse,
  },
  resumeRun: {
    method: 'POST',
    path: '/api/v1/automations/runs/:id/resume',
    auth: 'user',
    response: RunResumeResponse,
  },
  consent: {
    method: 'POST',
    path: '/api/v1/automations/runs/:id/consent',
    auth: 'user',
    request: ConsentRequest,
    response: ConsentResult,
  },
  stepFeedback: {
    method: 'POST',
    path: '/api/v1/automations/runs/:id/steps/:stepId/feedback',
    auth: 'user',
    request: StepFeedbackRequest,
    response: StepFeedbackResponse,
  },
  events: {
    method: 'GET',
    path: '/api/v1/automations/runs/:id/events',
    auth: 'token-query',
    kind: 'sse',
    response: AutomationRunEvent,
  },
  catalog: {
    method: 'GET',
    path: '/api/v1/automations/catalog',
    auth: 'user',
    response: CatalogResponse,
  },
  approvedCommands: {
    method: 'GET',
    path: '/api/v1/automations/approved-commands',
    auth: 'user',
    response: ApprovedCommandListResponse,
  },
  revokeApprovedCommand: {
    method: 'POST',
    path: '/api/v1/automations/approved-commands/revoke',
    auth: 'user',
    request: RevokeApprovedCommandRequest,
    response: RevokeApprovedCommandResponse,
  },
};
