// integrations/ module — see spec/02-module-map.md §2.6.
// Served-app AUTH + CLOUD planes (ch03 §3.9, slice S5). The app-files router lives in
// apps/ (app-files.ts); these are the integrations/-homed planes plus their injected seams.
export * from './app-scope.js';
export * from './app-sso-sessions.js';
export * from './app-sso.js';
export * from './m365-proxy.js';
export * from './app-cloud-files.js';

// G8 platform-integration execution layer (ch03 §3.8.15/§3.8.16): managed OAuth flows +
// token custody, the platform API caller (the events/ + automation/ seam), the user-defined
// action runner (the automation `integration`-step seam), and the Pipedream Connect layer.
export * from './platform-oauth.js';
export * from './platform-call.js';
export * from './action-executor.js';
export * from './pipedream.js';
// The live integration pre-fetch (ch05 §5.5.2 layer 3) — the IntegrationPrefetchFn seam impl.
export { integrationPrefetch, __resetPrefetchCacheForTests, type PrefetchDeps } from './prefetch.js';
// Config custody + the definitions registry (the composition root binds these to the
// automation credential-loader and catalog seams).
export {
  findConfigForOwner,
  createConfig,
  updateConfig,
  // The provider-rotation write (B2 review H2): legacy column + WS-C shadow, in that order.
  persistRotatedCredentials,
  // OAuth connect for INTEGRATION-CONFIG-backed providers (Zoho Sign): find-or-create with a
  // pending CSRF state, look the row up by that state, merge the grant into its bundle.
  beginConfigOAuth,
  findConfigByOAuthState,
  persistConfigOAuthGrant,
  type RotationOutcome,
  type IntegrationConfigDoc,
} from './service.js';
export {
  listDefinitions,
  getDefinition,
  integrationSkillMd,
  integrationAutomationTemplate,
  reservedIntegrationKeys,
  actionsWithoutRecipes,
  type IntegrationDefinition,
  type IntegrationPackageConfig,
  type IntegrationAction,
  type IntegrationActionHttpConfig,
  type IntegrationConfigField,
  type ActiveIntegrationCatalog,
} from './definitions.js';
// A3 — the builder save path (Mongo, private-by-default; the disk runtime writer is retired).
// The legacy-runtime boot importer (`legacy-runtime-import.ts`) is DELIBERATELY NOT re-exported
// here (A3 review L2): it mints a platform-level import actor, so only the composition root
// (server.ts bootState) may reach it, via a deep import. A barrel export would put that ambient
// authority one import away from every route module. Pinned by a barrel-surface test in
// api/tests/integrations/legacy-runtime-import.test.ts.
export { saveAuthoredDefinition, type SaveAuthoredResult } from './definition-save.js';
// A2 — the MERGED (tenant Mongo in front of the disk baseline) async read API. Every caller that
// holds an actor reads definitions through this, not through the raw disk functions above.
export {
  resolveDefinition,
  listDefinitionsFor,
  resolveSkillMd,
  resolveSkillMdRaw,
  canEditDefinitionRaw,
  activeCatalogFor,
  definitionFromDoc,
  systemActorForOrg,
  actorForOwnedRow,
  type DefinitionStoreReader,
} from './definition-registry.js';
export {
  integrationDefinitionStore,
  IntegrationDefinitionStore,
  type IntegrationDefinitionDoc,
  type IntegrationDefinitionPublishedSnapshot,
  type PublishModelPassRecord,
  type DefinitionVisibility,
} from './definition-store.js';
// C3 — per-integration LESSONS: the raw (editor) / scrubbed (prompt) split over the `lessons`
// field, its refusing ceiling, its CAS write, and the `load_context` concatenation.
export {
  readLessons,
  writeLessons,
  lessonsForPrompt,
  lessonsViewOf,
  composeIntegrationContext,
  INTEGRATION_LESSONS_MAX_CHARS,
  LESSONS_PROMPT_HEADING,
  type ReadLessonsResult,
  type WriteLessonsResult,
  type LessonsStoreReader,
} from './definition-lessons.js';
// E2 — the publish scrub: deterministic floor + one chokepoint model pass into a FROZEN snapshot
// other orgs read, plus its dry-run preview. `applyPublishFloor`/`publishedViewOf` are the pure
// read-time half; `previewPublish`/`publishDefinition` are the two doors the route layer mounts.
export {
  applyPublishFloor,
  scrubForPublish,
  scrubPublishText,
  previewPublish,
  publishDefinition,
  publishedViewOf,
  publishableContentOf,
  packageConfigFromDoc,
  isPublishSafeCredentialValue,
  looksLikeLiteralSecret,
  PUBLISH_SCRUB_VERSION,
  type PublishableContent,
  type PublishScrubOptions,
  type PublishScrubResult,
  type PublishRedaction,
  type PublishPreviewResult,
  type PublishResult,
  type PublishModelPass,
} from './publish-scrub.js';
