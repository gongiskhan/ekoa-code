/**
 * wire/index.ts - the daemon's import surface for the Cortex delegation wire contract.
 *
 * There is no vendored copy any more. When this package lived in its own repository it carried a
 * byte-copy of the delegation schemas (`wire/contract.ts`) plus a drift test that compared the copy
 * against ekoa-code's built `shared` dist, because `@ekoa/shared` is unpublished and could not be
 * depended on across repositories. Inside the monorepo it can: the schemas below come straight from
 * `@ekoa/shared`, so daemon and Cortex parse the same objects and sign the same bytes by
 * construction. Drift is not detected here, it is impossible - which is why the drift test was
 * deleted rather than ported.
 *
 * `signing.ts` stays local: `signDelegatedTask`/`verifyDelegatedTaskSig` are HMAC wrappers over
 * `canonicalTaskBinding` that the shared contract does not carry (the contract holds the canonical
 * BYTES; each side holds its own secret).
 */
export {
  AllowanceRef,
  DelegatedTask,
  PatchProposal,
  DelegationResult,
  EgressLedgerRow,
  BridgeCapability,
  BridgeFrame,
  canonicalTaskBinding,
} from '@ekoa/shared';
export { signDelegatedTask, verifyDelegatedTaskSig } from './signing.js';
