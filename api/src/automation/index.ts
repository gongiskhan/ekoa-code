/**
 * automation/ public entry (ch02 §2.6; ch05 §5.6.7). The vision-first automation engine: the
 * three-tier resolve loop (cache replay -> vision pinned EXPERT/max effort -> surface), the
 * deterministic Playwright action runner, page fingerprinting, the memory-backed action/assertion
 * cache, planning + rehearsal, the vision resolve/verify service, the cross-agent catalog, browser
 * sessions (daemon-backed via the injected daemon seam / in-process fallback), and the per-step
 * integration/API/local-command runners.
 *
 * `routes/` (the /automations resource) and the trigger delivery pipeline call the run-class entry
 * points and pass an injected `RunEventEmitter`; `server.ts` wires the injected seams
 * (daemon connection, integration + platform execution, credential loader, scoped-memory resolver,
 * app-data store, artifact resolver, catalog sources, in-process browser context). The engine
 * NEVER imports events/ or the SSE manager (ch02 §2.8), and all model access is through
 * `api/src/llm/` (vision.ts, planner.ts, rehearsal.ts) — FIXED-3.
 */

// --- Run classes (called by routes/ + trigger delivery) ---------------------
export {
  runAutomation,
  rehearseAutomation,
  type RunContext,
  type RunEventEmitter,
  type RunAutomationOptions,
  type RehearseAutomationOptions,
  type RunAutomationResult,
  type RehearseAutomationResult,
  type RunAwaitingConsentPayload,
  type RunAwaitingDaemonPayload,
  type RunPauseForUserPayload,
  type RunPatchEventPayload,
  type RunOutputChunkPayload,
  type RunStreamingAvailablePayload,
} from './engine.js';

// --- Rehearsal fixer (budget + fast-path detector) --------------------------
export { REHEARSAL_BUDGET, detectHumanActionable } from './rehearsal.js';

// --- The discovery spine (P2), and there is exactly ONE loop in it: the ordinary automation run.
//
//     A browser-steps action with no recipe runs the way it always did, with the machine's network
//     recorder armed underneath (`RunAutomationOptions.observeNetwork`); what the page's own
//     JavaScript asked the server for is compiled into a recipe (`network-capture.ts`) and stored.
//     Every later run replays that recipe with no model in the loop at all
//     (`replayIntegrationAction`, mounted first inside `runAutomationForAction`). A site whose
//     private API moves reports `drift`, the next instrumented run re-learns it, and the new recipe
//     SUPERSEDES the old one in-tenant (`healDriftedRecipe`).
//
//     NOTHING HERE IS A SECOND, GOAL-DRIVEN EXPLORATION PASS. The first attempt at this slice built
//     one; no production path could reach it, and the authored steps plus `rehearsal.ts` already do
//     that job. See `self-heal.ts` and docs/decisions.md. -----------------------------------------
export { replayIntegrationAction } from './replay-action.js';
export { replayCompiledAction, scriptedStepWrites, type ReplayResult } from './executors/injected-call.js';
export {
  healDriftedRecipe,
  applyHealedRecipe,
  classifyReplayDrift,
  writesIn,
  type HealResult,
  type ReplayFailureClass,
} from './self-heal.js';

// --- The credential halt's observer half (P3.1). `server.ts` binds `onCredentialEstablished` to
//     the Cofre-side notifier seam and `setCredentialResumeDriver` to the run re-dispatcher, which
//     is how a Cofre mint reaches a waiting run without `cofre/` importing `automation/`. ---------
export {
  onCredentialEstablished,
  setCredentialResumeDriver,
  registerCredentialWaiter,
  clearCredentialWaiter,
  credentialWaiterCount,
  __resetCredentialWaitersForTests,
  type CredentialResumeDriver,
} from './credential-waiters.js';
export {
  evaluateCredentialGate,
  credentialEstablishmentMode,
  cofrePortalDeepLink,
  type CredentialGateVerdict,
} from './credential-gate.js';

// --- Actor-scoped REST service surface (ch03 §3.8.18) — routes/ call these; the router never
//     imports data/ directly. Every response is shape-compatible with shared/automations.ts. ------
export {
  provisionIntegrationAutomations,
  sessionActionRows,
  managedAutomationId,
  type ProvisionBinding,
  type IntegrationAutomationTemplate,
  type SessionActionRow,
} from './integration-automations.js';
export {
  AutomationServiceError,
  type AutomationErrorCode,
  listAutomations,
  getAutomation,
  createAutomation,
  patchAutomation,
  deleteAutomation,
  canCreateAutomation,
  planFromGoal,
  startRun,
  listRuns,
  getRunRecord,
  getRunLogs,
  type RunCreateInput,
  type RunCreateCallContext,
  type RunCreateOutcome,
  cancelRun,
  resumeRun,
  redispatchRunAwaitingCredentials,
  resolveConsent,
  submitStepFeedback,
  buildCatalog,
  listApprovedCommands,
  revokeApprovedCommand,
  startRunForTrigger,
  runAutomationForAction,
  // The ONE mapping from the executor's automation seam onto a run (P2). `server.ts` binds it;
  // the acceptance suite enters through it, so a field dropped from it fails a test.
  automationBackedActionHandler,
  __resetAutomationServiceForTests,
  type TriggerRunInput,
  type ActionRunInput,
  type ActionRunResult,
  type ActionRunBinding,
  type TriggerRunOutcome,
} from './service.js';

// --- Cross-agent catalog (planner input + chat/coding system prompts) -------
export {
  buildAutomationCatalog,
  formatCatalogForPrompt,
  type Catalog,
  type AutomationCatalogEntry,
  type IntegrationActionCatalogEntry,
  type ConnectedAccountEntry,
  type EkoaActionCatalogEntry,
} from './catalog.js';

// --- Persistence (routes read runs; the plan endpoint saves automations) ----
export { automationStore, automationRunStore, automationRunsRoot, screenshotUrlFromPath } from './persistence.js';

// --- Run SSE step mapping (composition root's emitter adapts this onto sseManager) -------------
export { automationStepEventPayload, type AutomationStepEventPayload } from './run-events.js';

// --- Memory-backed cache eviction (step-feedback route; §11.6) --------------
export { evictCacheForFingerprint } from './cache.js';

// --- local_command consent (the consent route + revoke) ---------------------
export {
  approveCommandShape,
  revokeCommandShape,
  isCommandShapeApproved,
  listApprovedShapes,
} from './consent.js';

// --- User-facing spec types -------------------------------------------------
export type {
  Automation,
  Step,
  StepType,
  RunRecord,
  RunStatus,
  StepRecord,
  AutomationTrigger,
  AutomationInputField,
} from './types.js';

// --- Injected seams (wired at the composition root; ch02 §2.8) --------------
export {
  setDaemonConnectionResolver,
  setAutomationContentSections,
  setIntegrationActionExecutor,
  setPlatformIntegrationCaller,
  setIntegrationCredentialLoader,
  setIntegrationOriginResolver,
  setIntegrationActionDeclarationResolver,
  setScopedMemoryResolver,
  // S3 - the run owner's own integration notes, for the planner and the rehearsal fixer.
  setIntegrationFeedbackResolver,
  setAppDataStore,
  setArtifactResolver,
  setCatalogSources,
  setLocalBrowserContextProvider,
  localBrowserContextProviderUsing,
  setEgressCandidateResolver,
  setRunEventEmitterFactory,
  __resetAutomationSeamsForTests,
  type RunEventEmitterFactory,
  type DaemonConnection,
  type DaemonConnectionResolver,
  type ResultEnvelope,
  type IntegrationActionExecutor,
  type IntegrationActionResult,
  type IntegrationActionCall,
  type PlatformIntegrationCaller,
  type IntegrationCredentialLoader,
  type IntegrationActionDeclaration,
  type IntegrationActionDeclarationResolver,
  type ScopedMemoryResolver,
  type ScopedMemoryQuery,
  type AppDataStore,
  type ArtifactResolver,
  type ArtifactResolution,
  type CatalogSources,
  type SkillEntry,
  type SkillActionEntry,
  type ConnectedAccount,
  type LocalBrowserContextProvider,
  type EgressCandidateResolver,
} from './seams.js';

// --- Egress / locality (Cofre WS-I, P4.1) ----------------------------------
// `proxyOptionFor` renders a resolution into a launch option, and the ONE caller that does so is
// `localBrowserContextProviderUsing` above (exported for the composition root to bind). The decision
// itself is made in `locality.ts` inside the run loop and never here.
export {
  proxyOptionFor,
  resolveEgress,
  DEFAULT_EGRESS,
  type EgressCandidate,
  type EgressDeclaration,
  type EgressRequirement,
  type EgressResolution,
} from './egress-policy.js';
// `sameRoute` is deliberately NOT here, and no longer exported from `locality.ts` either: it is the
// route-switch decision's predicate, that decision now lives beside it inside `narrowLocalityForRun`,
// and an export whose only caller was a test asserting the predicate in isolation was a stand-in for
// the decision rather than the decision itself.
export {
  resolveLocality,
  narrowLocalityForRun,
  egressRequirementFor,
  hostedTypistPermitFor,
  refusalIsNeutral,
  CLEARING_ACTS,
  type ClearingAct,
  type ClearingActFacts,
  type LocalityInput,
  type LocalityRefusal,
  type LocalityVerdict,
  type RunSoFar,
} from './locality.js';

export {
  screenshotPlaneRouter,
  sweepExpiredScreenshots,
  deleteRunScreenshots,
  DEFAULT_SCREENSHOT_RETENTION_DAYS,
} from './screenshot-plane.js';

// Slice S1: the automation half of integration action evidence. `integrations/` may not import
// `automation/` (FIXED-1), so the executor declares a `RunEvidenceCollector` seam and the
// composition root binds it to this collector.
export {
  collectRunEvidence,
  type CollectedRunEvidence,
  type CollectedStepEvidence,
} from './action-evidence.js';

// Slice S7: the automations -> integrations migration CLASSIFIER. Report-only by construction - the
// module has no write path at all. `routes/integrations.ts` reads it per caller under that caller's
// own tenancy; the composition root logs the estate-wide COUNTS once at boot.
export {
  buildMigrationReport,
  classifyAutomation,
  migrationBootSummary,
  MIGRATION_SCAN_CAP,
  type MigrationScanDeps,
  type MigrationScanScope,
} from './migration-report.js';
