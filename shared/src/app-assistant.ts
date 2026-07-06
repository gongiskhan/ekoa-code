/** Served-app assistant endpoint contract (ch03 §3.9.1). */
import { z } from 'zod';
import type { DomainDescriptorMap } from './descriptor.js';

export const AssistantChatMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type AssistantChatMessage = z.infer<typeof AssistantChatMessage>;

export const AssistantChatRequest = z.object({
  message: z.string(),
  history: z.array(AssistantChatMessage).optional(),
});
export type AssistantChatRequest = z.infer<typeof AssistantChatRequest>;

export const AssistantChatResponse = z.object({
  reply: z.string(),
});
export type AssistantChatResponse = z.infer<typeof AssistantChatResponse>;

export const appAssistantEndpoints: DomainDescriptorMap = {
  assistantChat: {
    method: 'POST',
    path: '/api/app-assistant',
    auth: 'header-scoped',
    request: AssistantChatRequest,
    response: AssistantChatResponse,
  },
};
