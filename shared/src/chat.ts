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

export const ChatRunCreateRequest = z.object({
  sessionId: z.string(),
  message: z.string(),
  // `Language` already carries `.default('pt')`, which makes the field optional AND
  // applies the PT default when omitted (ch03 §3.4). Wrapping it in `.optional()` would
  // produce ZodOptional(ZodDefault) → an omitted value parses to `undefined`, not `'pt'`,
  // silently defeating the default. Use the bare default schema.
  language: Language,
  attachments: z.array(UploadRef).optional(),
});
export type ChatRunCreateRequest = z.infer<typeof ChatRunCreateRequest>;

export const ChatRunCreateResponse = z.object({ runId: z.string() });
export type ChatRunCreateResponse = z.infer<typeof ChatRunCreateResponse>;

export const ChatRunCancelResponse = z.object({ cancelled: z.boolean() });
export type ChatRunCancelResponse = z.infer<typeof ChatRunCancelResponse>;

export const chatEndpoints: DomainDescriptorMap = {
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
};
