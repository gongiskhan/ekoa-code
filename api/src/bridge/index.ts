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
  getPairingsByOwner,
  getConnectionByOwner,
  getLiveConnection,
  isLive,
  isRevoked,
  revokePairing,
  bridgeConnectionCount,
  type PairingRow,
  type LiveConnection,
} from './registry.js';

// The daemon-facing WS server (ch18 §18.3).
export { attachBridgeServer, type BridgeServerHandle, type BridgeServerDeps } from './server.js';

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
