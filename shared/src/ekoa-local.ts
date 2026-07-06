// ekoa-local surfaces (ch03 §3.10): LLM gateway, agent-face, bridge - ported wire-stable, plus the P-18 TUI compat SSE.
import { z } from 'zod';
import { Id, OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const LlmMessagesRequest = z.unknown();
export type LlmMessagesRequest = z.infer<typeof LlmMessagesRequest>;

export const LlmMessagesResponse = z.unknown();
export type LlmMessagesResponse = z.infer<typeof LlmMessagesResponse>;

export const LlmModel = z.object({ id: z.string() }).passthrough();
export type LlmModel = z.infer<typeof LlmModel>;

export const LlmModelsResponse = z.object({ data: z.array(LlmModel) }).passthrough();
export type LlmModelsResponse = z.infer<typeof LlmModelsResponse>;

export const LlmClassifyRequest = z.object({
  input: z.string(),
  categories: z.array(z.string()).optional(),
}).passthrough();
export type LlmClassifyRequest = z.infer<typeof LlmClassifyRequest>;

export const LlmClassifyResponse = z.object({
  category: z.string(),
  fallback: z.boolean().optional(),
}).passthrough();
export type LlmClassifyResponse = z.infer<typeof LlmClassifyResponse>;

export const AgentFaceRunRequest = z.unknown();
export type AgentFaceRunRequest = z.infer<typeof AgentFaceRunRequest>;

export const AgentFaceRunResponse = z.object({ traceId: z.string() });
export type AgentFaceRunResponse = z.infer<typeof AgentFaceRunResponse>;

export const AgentFaceCancelRequest = z.object({ traceId: Id.optional() }).passthrough();
export type AgentFaceCancelRequest = z.infer<typeof AgentFaceCancelRequest>;

export const AgentFaceCancelResponse = OkResponse;
export type AgentFaceCancelResponse = z.infer<typeof AgentFaceCancelResponse>;

export const BridgeTokenResponse = z.object({
  token: z.string(),
  expiresIn: z.number(),
});
export type BridgeTokenResponse = z.infer<typeof BridgeTokenResponse>;

export const BridgeDebugInvokeRequest = z.unknown();
export type BridgeDebugInvokeRequest = z.infer<typeof BridgeDebugInvokeRequest>;

export const BridgeDebugInvokeResponse = z.unknown();
export type BridgeDebugInvokeResponse = z.infer<typeof BridgeDebugInvokeResponse>;

export const ekoaLocalEndpoints: DomainDescriptorMap = {
  llmMessages: {
    method: 'POST',
    path: '/api/v1/llm/messages',
    auth: 'user',
    request: LlmMessagesRequest,
    response: LlmMessagesResponse,
  },
  llmMessagesV1: {
    method: 'POST',
    path: '/api/v1/llm/v1/messages',
    auth: 'user',
    request: LlmMessagesRequest,
    response: LlmMessagesResponse,
  },
  llmModels: {
    method: 'GET',
    path: '/api/v1/llm/models',
    auth: 'user',
    response: LlmModelsResponse,
  },
  llmClassify: {
    method: 'POST',
    path: '/api/v1/llm/classify',
    auth: 'user',
    request: LlmClassifyRequest,
    response: LlmClassifyResponse,
  },
  agentFaceRun: {
    method: 'POST',
    path: '/api/v1/agent-face/run',
    auth: 'user',
    request: AgentFaceRunRequest,
    response: AgentFaceRunResponse,
  },
  agentFaceCancel: {
    method: 'POST',
    path: '/api/v1/agent-face/cancel',
    auth: 'user',
    request: AgentFaceCancelRequest,
    response: AgentFaceCancelResponse,
  },
  bridgeToken: {
    method: 'POST',
    path: '/api/v1/bridge/token',
    auth: 'user',
    response: BridgeTokenResponse,
  },
  bridgeConnect: {
    method: 'GET',
    path: '/api/v1/bridge/connect/:connectionId',
    auth: 'bridge',
    kind: 'ws',
  },
  bridgeDebugInvoke: {
    method: 'POST',
    path: '/api/v1/bridge/debug-invoke',
    auth: 'user',
    request: BridgeDebugInvokeRequest,
    response: BridgeDebugInvokeResponse,
  },
  tuiEvents: {
    method: 'GET',
    path: '/api/v1/events',
    auth: 'token-query',
    response: z.unknown(),
    kind: 'sse',
  },
};
