/** Chat runs contract (ch03 §3.8.7 + §3.6.1). */
import { z } from 'zod';
import { Id, IsoTimestamp, UploadRef, Language } from './common.js';
import { ChatRunEvent } from './events.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const ChatRunStatus = z.enum(['pending', 'running', 'complete', 'cancelled', 'error']);
export type ChatRunStatus = z.infer<typeof ChatRunStatus>;

export const ChatRun = z
  .object({
    id: Id,
    status: ChatRunStatus,
    sessionId: z.string().optional(),
    result: z.unknown().optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
    durationMs: z.number().optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type ChatRun = z.infer<typeof ChatRun>;

/** FC-400/FC-411 composer reference token (run s6; D4): a session grant the user attached.
 *  The grantRef is daemon-minted and OPAQUE to the hosted side (§18.2.1 S1 — Cortex never
 *  resolves or widens it); the label is display-only (a file/folder name, never a full path). */
export const ReferenceToken = z.object({
  grantRef: z.string().min(1),
  label: z.string().min(1).max(200),
});
export type ReferenceToken = z.infer<typeof ReferenceToken>;

export const ChatRunCreateRequest = z.object({
  sessionId: z.string(),
  message: z.string(),
  // `Language` already carries `.default('pt')`, which makes the field optional AND
  // applies the PT default when omitted (ch03 §3.4). Wrapping it in `.optional()` would
  // produce ZodOptional(ZodDefault) → an omitted value parses to `undefined`, not `'pt'`,
  // silently defeating the default. Use the bare default schema.
  language: Language,
  attachments: z.array(UploadRef).optional(),
  // Reference tokens ride run context, not hand-typed chat text (D4): the run pipeline
  // injects one "autorizações locais ativas nesta sessão" line so the model calls
  // delegate_to_local with real refs.
  references: z.array(ReferenceToken).max(20).optional(),
});
export type ChatRunCreateRequest = z.infer<typeof ChatRunCreateRequest>;

export const ChatRunCreateResponse = z.object({ runId: z.string() });
export type ChatRunCreateResponse = z.infer<typeof ChatRunCreateResponse>;

export const ChatRunCancelResponse = z.object({ cancelled: z.boolean() });
export type ChatRunCancelResponse = z.infer<typeof ChatRunCancelResponse>;

export const chatEndpoints = {
  createRun: {
    method: 'POST',
    path: '/api/v1/chat/runs',
    auth: 'user',
    request: ChatRunCreateRequest,
    response: ChatRunCreateResponse,
    language: true,
  },
  getRun: {
    method: 'GET',
    path: '/api/v1/chat/runs/:id',
    auth: 'user',
    response: ChatRun,
  },
  runEvents: {
    method: 'GET',
    path: '/api/v1/chat/runs/:id/events',
    auth: 'token-query',
    response: ChatRunEvent,
    kind: 'sse',
  },
  cancelRun: {
    method: 'POST',
    path: '/api/v1/chat/runs/:id/cancel',
    auth: 'user',
    response: ChatRunCancelResponse,
  },
} as const satisfies DomainDescriptorMap;
