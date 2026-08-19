/**
 * bridge/ public entry (ch02 §2.6; ch18). The Cortex-side of local file access: the pairing
 * registry + revoke kill switch, the daemon-facing WS server, the hosted `delegate_to_local` tool,
 * and the Anthropic-compatible provider endpoint that routes bridge completions through the LLM
 * chokepoint (FIXED-13). The composition root (server.ts) wires the surface below; nothing here
 * imports the provider SDK — provider completions go through `llm/`'s public entry only.
 */

// Token class (ch18 §18.3.2, §18.3.6). Mint/verify/read + the shape rule the platform verifier
// guards against.
export {
  mintBridgeToken,
  verifyBridgeToken,
  readBridgeToken,
  looksLikeBridgeToken,
  BridgeAuthError,
  BRIDGE_AUDIENCE,
  BRIDGE_TOKEN_TTL_SECONDS,
  type BridgeTokenClaims,
} from './token.js';

// DelegatedTask signature (ch18 §18.2.6, §18.5.1) — exported so the fake-daemon harness verifies
// with the SAME bytes (wire lockstep, §18.1).
export { signDelegatedTask, verifyDelegatedTaskSig, canonicalTaskBinding } from './signing.js';

// The org-scoped pairing registry + revoke kill switch (ch18 §18.3.4, §18.3.5).
export {
  registerPairing,
  getPairingById,
  getPairingSigningSecret,
  getPairingsByOwner,
  getConnectionByOwner,
  getLiveConnection,
  isLive,
  isRevoked,
  revokePairing,
  revokePairingAudited,
  bridgeConnectionCount,
  type PairingRow,
  type LiveConnection,
} from './registry.js';

// The daemon-facing WS server (ch18 §18.3).
export { attachBridgeServer, type BridgeServerHandle, type BridgeServerDeps } from './server.js';

// The bounded in-memory ledger-row buffer feeding the FC-402 trust chip (§18.2; run s5).
export { bufferLedgerRow, rowsForSession, __resetActivityBufferForTests } from './activity-buffer.js';

// The provider endpoint (ch18 §18.4).
export { createProviderHandler, type ProviderHandler, type ProviderDeps, type ProviderOutcome, type ResolvedPairing } from './provider.js';

// The hosted delegation tool + its result coordinator (ch18 §18.2).
export {
  delegateToLocal,
  resolveDelegationResult,
  resolveDenial,
  failDelegationsForPairing,
  type DelegationActor,
  type DelegationRequest,
  type DelegationDeps,
} from './delegation.js';

// Cofre J-1 wiring: the awaitable half of the tool.invoke / tool.result frame pair.
export { invokeTool, ToolInvocationRefused, type ToolResult } from './tool-invocation.js';

// I-3 per-tenant-per-machine grants. Exported because the daemon step seam consults this BEFORE it
// delivers a credential, and the composition root is what hands it over. Passing the function
// itself rather than a predicate written at the root keeps one authorisation question with one
// implementation - a root-local wrapper is where a second, drifting copy of it would start.
export { isCapabilityGranted } from './capability-grants.js';

// P1.2/P1.3 - the automation-step seam (one place a resolved step becomes a `tool.invoke`) and the
// I9 delivery half it calls. `secret-delivery.ts` was built, tested and had no production caller;
// exporting it here is what makes the composition root able to be one.
export { createDaemonStepConnection, capabilityForStep, type DaemonStepDeps } from './daemon-step-seam.js';
export { authoriseDelivery, deliverSecrets, newInvocationId, SecretDeliveryError } from './secret-delivery.js';
