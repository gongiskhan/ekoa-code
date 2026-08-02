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
export { findConfigForOwner, createConfig, updateConfig, type IntegrationConfigDoc } from './service.js';
export {
  listDefinitions,
  getDefinition,
  integrationSkillMd,
  integrationAutomationTemplate,
  reservedIntegrationKeys,
  type IntegrationDefinition,
  type IntegrationPackageConfig,
  type IntegrationAction,
  type IntegrationActionHttpConfig,
  type IntegrationConfigField,
  type ActiveIntegrationCatalog,
} from './definitions.js';
// A3 — the builder save path (Mongo, private-by-default; the disk runtime writer is retired) and
// the one-shot boot import of the frozen legacy runtime tier (Rule 10, review 2026-08-15).
export { saveAuthoredDefinition, type SaveAuthoredResult } from './definition-save.js';
export {
  importLegacyRuntimePackages,
  LEGACY_RUNTIME_ORG,
  LEGACY_RUNTIME_USER,
  type LegacyImportReport,
} from './legacy-runtime-import.js';
// A2 — the MERGED (tenant Mongo in front of the disk baseline) async read API. Every caller that
// holds an actor reads definitions through this, not through the raw disk functions above.
export {
  resolveDefinition,
  listDefinitionsFor,
  resolveSkillMd,
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
  type DefinitionVisibility,
} from './definition-store.js';
