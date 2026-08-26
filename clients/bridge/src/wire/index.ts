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
  CeremonyInputEvent,
  canonicalTaskBinding,
  // The local EXECUTION plane (P1.2/P1.4). Same argument as above: one schema, parsed on both
  // sides, so the step Cortex sends and the step the daemon runs cannot drift apart.
  LocalBrowserLocator,
  LocalBrowserAction,
  LocalBrowserLeaseOp,
  LocalBrowserStepInput,
  LocalBashStepInput,
  LocalToolInvokeInput,
  LocalBrowserObservation,
  LocalBashObservation,
  // The discovery spine's two additions (P2.2/P2.3): network capture underneath a discovery pass,
  // and the in-page replay of one learned call.
  LocalBrowserCaptureOp,
  LocalBrowserCapture,
  LocalBrowserInjectedCall,
  LocalBrowserInjectedCallResult,
} from '@ekoa/shared';
export { signDelegatedTask, verifyDelegatedTaskSig } from './signing.js';
