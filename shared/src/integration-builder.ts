/** Integration builder contract (ch03 §3.8.14). */
import { z } from 'zod';
import { Language } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const IntegrationBuilderMessage = z
  .object({
    role: z.string(),
    content: z.string(),
  })
  .passthrough();
export type IntegrationBuilderMessage = z.infer<typeof IntegrationBuilderMessage>;

export const IntegrationBuilderValidationError = z
  .object({
    path: z.string().optional(),
    message: z.string(),
  })
  .passthrough();
export type IntegrationBuilderValidationError = z.infer<typeof IntegrationBuilderValidationError>;

export const GeneratedPackage = z
  .object({
    integrationKey: z.string().optional(),
    displayName: z.string().optional(),
    actions: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type GeneratedPackage = z.infer<typeof GeneratedPackage>;

export const IntegrationBuilderChatRequest = z.object({
  message: z.string(),
  builderSessionId: z.string().optional(),
  // Bare default schema (not `.optional()`): `Language` already applies the PT default
  // when omitted (ch03 §3.4). `.optional()` would neutralize it (ZodOptional(ZodDefault)).
  language: Language,
});
export type IntegrationBuilderChatRequest = z.infer<typeof IntegrationBuilderChatRequest>;

export const IntegrationBuilderChatResponse = z.object({
  builderSessionId: z.string(),
  generatedPackage: GeneratedPackage,
  validationErrors: z.array(IntegrationBuilderValidationError),
});
export type IntegrationBuilderChatResponse = z.infer<typeof IntegrationBuilderChatResponse>;

export const IntegrationBuilderLoadQuery = z.object({
  integrationKey: z.string(),
});
export type IntegrationBuilderLoadQuery = z.infer<typeof IntegrationBuilderLoadQuery>;

export const IntegrationBuilderLoadResponse = z.object({
  builderSessionId: z.string(),
  generatedPackage: GeneratedPackage,
  messages: z.array(IntegrationBuilderMessage),
  validationErrors: z.array(IntegrationBuilderValidationError),
});
export type IntegrationBuilderLoadResponse = z.infer<typeof IntegrationBuilderLoadResponse>;

export const IntegrationBuilderSaveRequest = z.union([
  z.object({ builderSessionId: z.string() }),
  z.object({
    generatedPackage: GeneratedPackage,
    testCredentials: z.record(z.unknown()).optional(),
  }),
]);
export type IntegrationBuilderSaveRequest = z.infer<typeof IntegrationBuilderSaveRequest>;

export const IntegrationBuilderSaveResponse = z.object({
  integrationKey: z.string(),
  displayName: z.string(),
  saved: z.boolean(),
  configured: z.boolean().optional(),
});
export type IntegrationBuilderSaveResponse = z.infer<typeof IntegrationBuilderSaveResponse>;

export const IntegrationBuilderTestRequest = z.object({
  builderSessionId: z.string(),
  actionKey: z.string(),
  testCredentials: z.record(z.unknown()).optional(),
  testInput: z.record(z.unknown()).optional(),
});
export type IntegrationBuilderTestRequest = z.infer<typeof IntegrationBuilderTestRequest>;

export const IntegrationBuilderTestResponse = z.object({
  actionKey: z.string(),
  success: z.boolean(),
  statusCode: z.number().optional(),
  response: z.unknown().optional(),
  error: z.string().optional(),
});
export type IntegrationBuilderTestResponse = z.infer<typeof IntegrationBuilderTestResponse>;

export const integrationBuilderEndpoints: DomainDescriptorMap = {
  chat: {
    method: 'POST',
    path: '/api/v1/integration-builder/chat',
    auth: 'user',
    request: IntegrationBuilderChatRequest,
    response: IntegrationBuilderChatResponse,
    timeoutMs: 300000,
    language: true,
  },
  load: {
    method: 'GET',
    path: '/api/v1/integration-builder/package',
    auth: 'user',
    query: IntegrationBuilderLoadQuery,
    response: IntegrationBuilderLoadResponse,
  },
  save: {
    method: 'PUT',
    path: '/api/v1/integration-builder/package',
    auth: 'user',
    request: IntegrationBuilderSaveRequest,
    response: IntegrationBuilderSaveResponse,
  },
  test: {
    method: 'POST',
    path: '/api/v1/integration-builder/test',
    auth: 'user',
    request: IntegrationBuilderTestRequest,
    response: IntegrationBuilderTestResponse,
    timeoutMs: 60000,
  },
};
