/**
 * Model-credential provisioning contract (ch06 §6.2; F2). WRITE-ONLY surface: the platform
 * model credential can be set by a super-admin but never read back — no GET descriptor
 * exists by design, and the response never echoes the secret.
 */
import { z } from 'zod';
import type { DomainDescriptorMap } from './descriptor.js';

export const CredentialMode = z.enum(['oauth', 'api-key']);
export type CredentialMode = z.infer<typeof CredentialMode>;

export const CredentialSetRequest = z.object({
  mode: CredentialMode,
  /** oauth: the OAuth access token; api-key: the Anthropic API key. Never echoed. */
  secret: z.string().min(1),
  /** oauth only: refresh token for the proactive-refresh seam (§6.2.4). */
  refreshToken: z.string().min(1).optional(),
  /** oauth only: epoch ms at which `secret` expires. */
  expiresAt: z.number().int().positive().optional(),
});
export type CredentialSetRequest = z.infer<typeof CredentialSetRequest>;

/** The claudeAuth health field (ch03 §3.8.23) — the only thing the write reflects back. */
export const ClaudeAuthHealth = z.object({
  ok: z.boolean(),
  configured: z.boolean(),
  mode: CredentialMode.optional(),
  lastRefreshError: z.string().optional(),
  // Diagnostics honesty (run s7, D6; FINDINGS 502-masks-401): the most recent CLASSED
  // provider error — a class + timestamp, never bodies, never secrets. Operators get
  // truth here while user-facing text stays white-labelled.
  lastProviderError: z
    .object({
      class: z.enum(['auth', 'billing', 'invalid_request', 'rate_limit', 'transient']),
      at: z.string(),
    })
    .optional(),
});
export type ClaudeAuthHealth = z.infer<typeof ClaudeAuthHealth>;

export const CredentialSetResponse = z.object({
  ok: z.literal(true),
  claudeAuth: ClaudeAuthHealth,
});
export type CredentialSetResponse = z.infer<typeof CredentialSetResponse>;

export const credentialsEndpoints = {
  set: {
    method: 'POST',
    path: '/api/v1/credentials',
    auth: 'super-admin',
    request: CredentialSetRequest,
    response: CredentialSetResponse,
  },
} as const satisfies DomainDescriptorMap;
