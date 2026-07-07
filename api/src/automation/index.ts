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

// --- Actor-scoped REST service surface (ch03 §3.8.18) — routes/ call these; the router never
//     imports data/ directly. Every response is shape-compatible with shared/automations.ts. ------
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
  cancelRun,
  resumeRun,
  resolveConsent,
  submitStepFeedback,
  buildCatalog,
  listApprovedCommands,
  revokeApprovedCommand,
  startRunForTrigger,
  runAutomationForAction,
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
export { automationStore, automationRunStore } from './persistence.js';

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
  setIntegrationActionExecutor,
  setPlatformIntegrationCaller,
  setIntegrationCredentialLoader,
  setScopedMemoryResolver,
  setAppDataStore,
  setArtifactResolver,
  setCatalogSources,
  setLocalBrowserContextProvider,
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
} from './seams.js';
