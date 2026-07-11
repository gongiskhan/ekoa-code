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

/** Hosted bridge presence, derived from the pairing registry ONLY — no daemon round trip
 *  (ch18 §18.3.3; §12.6 FC-401/FC-405). `pairingId` present when paired; `lastSeenAt` is the
 *  last heartbeat stamp and only known while a live socket exists in this process. */
export const BridgeStatusResponse = z.object({
  paired: z.boolean(),
  live: z.boolean(),
  pairingId: z.string().optional(),
  lastSeenAt: z.string().optional(),
});
export type BridgeStatusResponse = z.infer<typeof BridgeStatusResponse>;

export const BridgeDebugInvokeRequest = z.unknown();
export type BridgeDebugInvokeRequest = z.infer<typeof BridgeDebugInvokeRequest>;

export const BridgeDebugInvokeResponse = z.unknown();
export type BridgeDebugInvokeResponse = z.infer<typeof BridgeDebugInvokeResponse>;

export const ekoaLocalEndpoints = {
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
  bridgeStatus: {
    method: 'GET',
    path: '/api/v1/bridge/status',
    auth: 'user',
    response: BridgeStatusResponse,
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
} as const satisfies DomainDescriptorMap;

// ---------------------------------------------------------------------------
// Bridge delegation wire contract (ch18 §18.2.6, §18.3.8, §18.5.1). The shared
// schemas both the Cortex bridge server AND the fake-daemon harness build against
// (§18.1: the harness is authoritative on the wire; this is the readable form).
// ---------------------------------------------------------------------------

/** Billing allowance reference carried in a delegation budget (ch06 §6.6.3). */
export const AllowanceRef = z.object({ userId: z.string() }).passthrough();
export type AllowanceRef = z.infer<typeof AllowanceRef>;

/** A task minted hosted-side per delegation, signed by Cortex, sent over the bridge (§18.2.6).
 *  Binds the eight S2 fields + a server-minted id + a signature. */
export const DelegatedTask = z.object({
  taskId: z.string(),
  org: z.string(),
  user: z.string(),
  session: z.string(),
  pairingId: z.string(),
  grantRefs: z.array(z.string()),
  task: z.string(),
  // egressBytes is a SIGNED cap. `.finite().nonnegative()` rejects Infinity/-Infinity (zod 3's
  // z.number() accepts Infinity) - a non-finite number would canonicalise to the JSON bytes
  // `null` (see stableStringify) and collapse two distinct budgets onto identical signing bytes
  // (§18.1 canonicalisation must be injective over accepted values).
  budget: z.object({ egressBytes: z.number().finite().nonnegative(), modelSpend: AllowanceRef }),
  expiry: z.string(),
  nonce: z.string(),
  sig: z.string(),
});
export type DelegatedTask = z.infer<typeof DelegatedTask>;

/** Derived output only (§18.2.2); never raw file bytes. */
export const PatchProposal = z.object({ path: z.string(), diff: z.string() }).passthrough();
export type PatchProposal = z.infer<typeof PatchProposal>;

export const DelegationResult = z.object({
  status: z.enum(['ok', 'unreachable', 'cap_reached', 'denied']),
  answer: z.string().optional(),
  citations: z.array(z.object({ path: z.string(), range: z.string() })),
  patches: z.array(PatchProposal).optional(),
  ledgerRefs: z.array(z.string()),
  telemetry: z.object({ egressBytes: z.number(), maskedCounts: z.record(z.number()) }),
});
export type DelegationResult = z.infer<typeof DelegationResult>;

/** Daemon-side append-only egress ledger row; Cortex receives rows as display metadata (§18.5.1). */
export const EgressLedgerRow = z.object({
  ts: z.string(),
  session: z.string(),
  correlationId: z.string(),
  path: z.string(),
  byteRange: z.string(),
  bytesOut: z.number(),
  sha256: z.string(),
  tool: z.string(),
});
export type EgressLedgerRow = z.infer<typeof EgressLedgerRow>;

/** The bridge WS frames added for delegation (§18.3.8). Discriminated on `type`. Cortex validates
 *  every inbound frame at the boundary and drops unparseable/invalid frames (§18.3.1). */
export const BridgeFrame = z.discriminatedUnion('type', [
  // hosted -> daemon
  z.object({ type: z.literal('delegate'), task: DelegatedTask }),
  z.object({ type: z.literal('provider_response'), correlationId: z.string(), body: z.unknown() }),
  z.object({ type: z.literal('cancel'), taskId: z.string() }),
  // daemon -> hosted
  z.object({ type: z.literal('provider_request'), correlationId: z.string(), session: z.string(), credential: z.string(), body: z.unknown() }),
  z.object({ type: z.literal('ledger_row'), taskId: z.string(), row: EgressLedgerRow }),
  z.object({ type: z.literal('delegation_result'), taskId: z.string(), result: DelegationResult }),
  z.object({ type: z.literal('denial'), taskId: z.string().optional(), reason: z.string(), principle: z.string() }),
  // presence
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('pong') }),
]);
export type BridgeFrame = z.infer<typeof BridgeFrame>;

/**
 * The canonical byte string a DelegatedTask signature covers (§18.1, §18.2.6): the whole task
 * MINUS `sig`, deterministically stringified (recursively sorted keys). Lives in the frozen shared
 * contract so the Cortex signer AND the daemon verifier compute the SAME bytes without importing
 * each other — a divergence in canonicalisation would be a wire bug (§18.1). The HMAC secret is
 * NOT here (each side holds its own); this is only the bytes.
 */
function stableStringify(value: unknown): string {
  // A non-finite number (NaN/Infinity) JSON.stringifies to `null`, which would make
  // canonicalisation non-injective (two distinct tasks → identical signing bytes). Refuse it
  // loudly rather than sign ambiguous bytes; the DelegatedTask schema already rejects a
  // non-finite egressBytes, so this is a belt-and-braces guard for any future signed field.
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('canonicalTaskBinding: refusing to sign a non-finite number (ambiguous canonical bytes)');
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
export function canonicalTaskBinding(task: Omit<DelegatedTask, 'sig'> & { sig?: string }): string {
  const { sig: _sig, ...binding } = task as Record<string, unknown> & { sig?: string };
  return stableStringify(binding);
}
