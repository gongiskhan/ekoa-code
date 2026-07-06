/** Sessions domain contract (ch03 §3.8.6): session CRUD, messages, seed-featured. */
import { z } from 'zod';
import { Id, IsoTimestamp, itemsResponse, OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const SessionMessage = z
  .object({
    id: Id,
    sessionId: Id,
    role: z.string(),
    content: z.string(),
    metadata: z.record(z.unknown()).optional(),
    createdAt: IsoTimestamp,
  })
  .passthrough();
export type SessionMessage = z.infer<typeof SessionMessage>;

export const Session = z
  .object({
    id: Id,
    name: z.string().optional(),
    type: z.string().optional(),
    artifactId: Id.optional(),
    messages: z.array(SessionMessage).optional(),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp,
  })
  .passthrough();
export type Session = z.infer<typeof Session>;

export const SessionSummary = z
  .object({
    id: Id,
    name: z.string().optional(),
    type: z.string().optional(),
    artifactId: Id.optional(),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp,
  })
  .passthrough();
export type SessionSummary = z.infer<typeof SessionSummary>;

export const SessionCreateRequest = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  artifactId: Id.optional(),
});
export type SessionCreateRequest = z.infer<typeof SessionCreateRequest>;

export const SessionPatch = z.object({
  name: z.string().optional(),
});
export type SessionPatch = z.infer<typeof SessionPatch>;

export const MessageCreateRequest = z.object({
  role: z.string(),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
});
export type MessageCreateRequest = z.infer<typeof MessageCreateRequest>;

export const SessionSummaryListResponse = itemsResponse(SessionSummary);
export type SessionSummaryListResponse = z.infer<typeof SessionSummaryListResponse>;

export const SessionMessageListResponse = itemsResponse(SessionMessage);
export type SessionMessageListResponse = z.infer<typeof SessionMessageListResponse>;

export const SeedFeaturedRequest = z.object({ artifactId: Id });
export type SeedFeaturedRequest = z.infer<typeof SeedFeaturedRequest>;

export const sessionsEndpoints: DomainDescriptorMap = {
  create: {
    method: 'POST',
    path: '/api/v1/sessions',
    auth: 'user',
    request: SessionCreateRequest,
    response: Session,
  },
  list: {
    method: 'GET',
    path: '/api/v1/sessions',
    auth: 'user',
    response: SessionSummaryListResponse,
  },
  get: {
    method: 'GET',
    path: '/api/v1/sessions/:id',
    auth: 'user',
    response: Session,
  },
  update: {
    method: 'PATCH',
    path: '/api/v1/sessions/:id',
    auth: 'user',
    request: SessionPatch,
    response: Session,
  },
  delete: {
    method: 'DELETE',
    path: '/api/v1/sessions/:id',
    auth: 'user',
    response: OkResponse,
  },
  getMessages: {
    method: 'GET',
    path: '/api/v1/sessions/:id/messages',
    auth: 'user',
    response: SessionMessageListResponse,
  },
  addMessage: {
    method: 'POST',
    path: '/api/v1/sessions/:id/messages',
    auth: 'user',
    request: MessageCreateRequest,
    response: SessionMessage,
  },
  seedFeatured: {
    method: 'POST',
    path: '/api/v1/sessions/:id/seed-featured',
    auth: 'user',
    request: SeedFeaturedRequest,
    response: OkResponse,
  },
};
