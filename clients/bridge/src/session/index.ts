/**
 * session/index.ts — barrel for the daemon's in-memory per-session state: the grant table
 * (session-scoped resolution), the nonce replay cache, and per-session egress accounting. All
 * filesystem-free; the verification engine (src/verify) and the tool layer build on these.
 */
export { GrantTable } from './grants.js';
export type { Grant } from './grants.js';
export { NonceCache } from './nonces.js';
export { EgressAccounting } from './egress.js';
