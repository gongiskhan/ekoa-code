/**
 * cofre/ — the credential custody module (Cofre WS-B/WS-C).
 *
 * PUBLIC SURFACE. Everything a caller outside this module may touch is here. The raw stores are
 * deliberately NOT exported: items and grants are reachable only through the scoped repositories in
 * `store.ts`, and every credential read goes through `unwrap()`.
 *
 * MODULE PLACEMENT (decisions.md 2026-07-27). A new TOP-LEVEL module registered in the
 * `.eslintrc.cjs` module-direction zone array — not under `data/` (a policy decision does not
 * belong in the storage tier) and not inside `automation/` or `integrations/` (both consume it, and
 * duplicating it per consumer is the defect this replaces).
 */
export {
  unwrap,
  recordUse,
  lockItem,
  lockAll,
  isGrantActive,
  CofreLockedError,
  CofreNotFoundError,
  CredentialOriginError,
  type UsageContext,
  type UnwrapOptions,
  type UnwrappedCredential,
} from './service.js';

export { recordCofreEvent } from './audit.js';

export {
  mintCofreItem,
  deleteCofreItem,
  issueGrant,
  listCofreItems,
  type MintCofreItemInput,
  type CofreDeps,
} from './items.js';

export {
  captureSessionToCofre,
  captureSessionWithGrant,
  boundOriginsForEstablishedHost,
  originsFromStorageState,
  findSessionItemsForOrigin,
  markSessionUnhealthy,
  sessionIsExpired,
  DEFAULT_SESSION_TTL_MS,
  type CaptureSessionInput,
} from './sessions.js';

export {
  mintIntegrationCredentialItem,
  updateIntegrationCredentialValue,
  findIntegrationCredentialItem,
  integrationOriginScope,
  unwrapForIntegration,
  discardIntegrationCredentialItem,
  fieldsFromBundle,
  type IntegrationCredentialFields,
  type IntegrationItemAccess,
  type IntegrationOriginScope,
  type MintIntegrationCredentialInput,
} from './integration-items.js';

export {
  checkoutSession,
  reestablishRouteFor,
  markUnhealthy,
  type CheckoutDecision,
  type ReestablishRoute,
} from './session-checkout.js';

export type { CofreItemDoc, CofreGrantDoc, IntegrationItemLink } from './types.js';
