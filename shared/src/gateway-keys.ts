/**
 * Per-user LLM-gateway API keys (S4a, run 20260717). Self-service: any active user mints
 * long-lived revocable keys for stock Anthropic clients (Claude Code) pointed at the gateway;
 * billee = key owner. The secret is returned EXACTLY ONCE at mint and never stored or listed.
 */
import { z } from 'zod';
import type { DomainDescriptorMap } from './descriptor.js';

export const GatewayKeyMintRequest = z.object({ label: z.string().min(1).max(64) });
export type GatewayKeyMintRequest = z.infer<typeof GatewayKeyMintRequest>;

export const GatewayKeySummary = z.object({
  id: z.string(),
  label: z.string(),
  /** Last 4 chars of the secret - the UI renders 'ekoa_gk_...abcd'. Never the secret. */
  secretHint: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().optional(),
  lastUsedAt: z.string().optional(),
});
export type GatewayKeySummary = z.infer<typeof GatewayKeySummary>;

export const GatewayKeyMintResponse = z.object({
  id: z.string(),
  /** The plaintext secret - shown once, never retrievable again. */
  key: z.string(),
  label: z.string(),
  secretHint: z.string(),
  createdAt: z.string(),
});
export type GatewayKeyMintResponse = z.infer<typeof GatewayKeyMintResponse>;

export const GatewayKeyListResponse = z.object({ items: z.array(GatewayKeySummary) });
export type GatewayKeyListResponse = z.infer<typeof GatewayKeyListResponse>;

export const GatewayKeyRevokeResponse = z.object({ ok: z.literal(true) });
export type GatewayKeyRevokeResponse = z.infer<typeof GatewayKeyRevokeResponse>;

export const gatewayKeysEndpoints = {
  gatewayKeysMint: {
    method: 'POST',
    path: '/api/v1/gateway-keys',
    auth: 'user',
    request: GatewayKeyMintRequest,
    response: GatewayKeyMintResponse,
  },
  gatewayKeysList: {
    method: 'GET',
    path: '/api/v1/gateway-keys',
    auth: 'user',
    response: GatewayKeyListResponse,
  },
  gatewayKeysRevoke: {
    method: 'POST',
    path: '/api/v1/gateway-keys/:id/revoke',
    auth: 'user',
    response: GatewayKeyRevokeResponse,
  },
} as const satisfies DomainDescriptorMap;
