/**
 * automation/ injected seams (ch02 §2.8; ch05 §5.6.7). The engine and its step executors must
 * cause work in collaborators that either do not exist yet in ekoa-code (the daemon bridge lands
 * at G8A) or sit in a sibling/unbuilt module the automation engine must NOT import directly
 * (integration execution, platform integration, the app-data collections engine, artifact/slug
 * resolution). Each is a typed callback with a SAFE, HONEST default; the composition root
 * (`server.ts`) wires the real implementation.
 *
 * Honesty of defaults is load-bearing (ch05 §5.6.7): a step needing the daemon halts the run in
 * `awaiting_daemon`; a step needing an integration returns an `awaiting_integration`/failure
 * envelope; scoped-memory grounding returns no snippets. Nothing crashes a run.
 *
 * FIXED-3 note: NO seam here touches a model. All model calls in automation/ go through
 * `api/src/llm/` (vision.ts, planner.ts, rehearsal.ts). These seams are transport/persistence.
 */
import type { BrowserContext } from 'playwright';
// Type-only import (erased at compile) — the run event emitter's shape lives in engine.ts, which
// imports this module at RUNTIME; a type-only import back here creates no runtime cycle.
import type { RunEventEmitter } from './engine.js';

// ============================================================================
// Daemon bridge (ch02 `bridge/`, lands at G8A) — getDaemonConnection
// ============================================================================

/** The daemon `browser`/`bash` capability result envelope (bridge protocol; ch18). Validated
 *  leniently by the browser session — the daemon is a trust boundary. */
export interface ResultEnvelope {
  ok: boolean;
  observation?: {
    screenshotB64?: string;
    text?: string;
    data?: unknown;
  };
  error?: { message?: string; retryable?: boolean };
  meta?: { truncated?: boolean };
}

export interface DaemonStepRequest {
  capability: 'browser' | 'bash';
  input: unknown;
  stepId?: string;
  runId: string;
}

/** The live daemon control channel for one owner. `runStep` dispatches a resolved browser action
 *  / bash command and returns the post-action observation envelope. Mirrors the old
 *  `BridgeConnection.runStep` (carryover-audit B16); the concrete WS transport lands in `bridge/`. */
export interface DaemonConnection {
  runStep(req: DaemonStepRequest, opts?: { onProgress?: (chunk: string) => void }): Promise<ResultEnvelope>;
}

export type DaemonConnectionResolver = (ownerUserId: string) => DaemonConnection | null;

const defaultDaemonResolver: DaemonConnectionResolver = () => null;
let daemonResolver: DaemonConnectionResolver = defaultDaemonResolver;
export function setDaemonConnectionResolver(fn: DaemonConnectionResolver): void {
  daemonResolver = fn;
}
/** The live daemon for this owner, or null when none is paired → any step needing it halts the
 *  run in `awaiting_daemon` (§5.6.7, the engine's honest daemon-less path). */
export function getDaemonConnection(ownerUserId: string): DaemonConnection | null {
  return daemonResolver(ownerUserId);
}

// ============================================================================
// Integration execution (ch02 `integrations/`, built concurrently) — a sibling
// tier-5/tier-3 module the engine must not import; wired at the root.
// ============================================================================

export interface IntegrationActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  details?: unknown;
}

export interface IntegrationActionCall {
  integrationKey: string;
  actionName: string;
  args: Record<string, unknown>;
  ownerUserId: string;
}

export type IntegrationActionExecutor = (call: IntegrationActionCall) => Promise<IntegrationActionResult>;

const defaultIntegrationExecutor: IntegrationActionExecutor = async (call) => ({
  success: false,
  error: `integration ${call.integrationKey} is not connected`,
});
let integrationExecutor: IntegrationActionExecutor = defaultIntegrationExecutor;
export function setIntegrationActionExecutor(fn: IntegrationActionExecutor): void {
  integrationExecutor = fn;
}
/** Run a user-defined integration action. Default: honest "not connected" → the engine surfaces
 *  `awaiting_integration` (§5.6.7). */
export function executeIntegrationAction(call: IntegrationActionCall): Promise<IntegrationActionResult> {
  return integrationExecutor(call);
}

// ---- Platform integration (Google Workspace / Microsoft 365) --------------

export interface PlatformIntegrationCall {
  integrationKey: string;
  actionName: string;
  args: Record<string, unknown>;
}

export interface PlatformIntegrationActor {
  userId: string;
  userRole: string;
  userScopes: string[];
  traceId: string;
}

export type PlatformIntegrationCaller = (
  call: PlatformIntegrationCall,
  actor: PlatformIntegrationActor,
) => Promise<IntegrationActionResult>;

const defaultPlatformCaller: PlatformIntegrationCaller = async (call) => ({
  success: false,
  error: `platform integration ${call.integrationKey} is not connected`,
});
let platformCaller: PlatformIntegrationCaller = defaultPlatformCaller;
export function setPlatformIntegrationCaller(fn: PlatformIntegrationCaller): void {
  platformCaller = fn;
}
export function callPlatformIntegration(
  call: PlatformIntegrationCall,
  actor: PlatformIntegrationActor,
): Promise<IntegrationActionResult> {
  return platformCaller(call, actor);
}

// ---- Decrypted integration credential fields (api_call auth injection) -----

export type IntegrationCredentialLoader = (
  integrationKey: string,
  ownerUserId: string,
) => Promise<Record<string, string> | null>;

const defaultCredentialLoader: IntegrationCredentialLoader = async () => null;
let credentialLoader: IntegrationCredentialLoader = defaultCredentialLoader;
export function setIntegrationCredentialLoader(fn: IntegrationCredentialLoader): void {
  credentialLoader = fn;
}
/** Decrypted credential fields for an integration, injected into api_call templates via
 *  `{{integration.<key>.<field>}}`. Default null → the api_call step fails "not connected". */
export function loadIntegrationCredentialFields(
  integrationKey: string,
  ownerUserId: string,
): Promise<Record<string, string> | null> {
  return credentialLoader(integrationKey, ownerUserId);
}

// ============================================================================
// Scoped memory grounding (ch02 `memory/`) — the engine may import memory/ per
// §2.7, but the entity-scoped resolver with a snippet cap is not on memory/'s
// public surface, so it is injected. Default: no snippets (honest empty).
// ============================================================================

export interface ScopedMemoryQuery {
  automationId: string;
  ownerUserId: string;
  orgId: string;
  query: string;
  maxMemories: number;
}

export type ScopedMemoryResolver = (q: ScopedMemoryQuery) => Promise<string[]>;

const defaultScopedMemoryResolver: ScopedMemoryResolver = async () => [];
let scopedMemoryResolver: ScopedMemoryResolver = defaultScopedMemoryResolver;
export function setScopedMemoryResolver(fn: ScopedMemoryResolver): void {
  scopedMemoryResolver = fn;
}
export function resolveScopedMemories(q: ScopedMemoryQuery): Promise<string[]> {
  return scopedMemoryResolver(q);
}

// ============================================================================
// App-data collections store (ch02 `data/` collections engine) — used by the
// platform-primitive interpreter behind ekoa_action steps.
// ============================================================================

export interface AppDataStore {
  list(artifactId: string, collection: string): Promise<Array<Record<string, unknown>>>;
  get(artifactId: string, collection: string, id: string): Promise<Record<string, unknown> | null>;
  create(artifactId: string, collection: string, data: Record<string, unknown>): Promise<{ id: string } & Record<string, unknown>>;
  update(artifactId: string, collection: string, id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  delete(artifactId: string, collection: string, id: string): Promise<boolean>;
}

const notWired = (op: string) => async (): Promise<never> => {
  throw new Error(`app-data store not wired (ekoa_action ${op})`);
};
const defaultAppDataStore: AppDataStore = {
  list: notWired('store.list'),
  get: notWired('store.get'),
  create: notWired('store.create'),
  update: notWired('store.update'),
  delete: notWired('store.delete'),
};
let appDataStore: AppDataStore = defaultAppDataStore;
export function setAppDataStore(s: AppDataStore): void {
  appDataStore = s;
}
export function getAppDataStore(): AppDataStore {
  return appDataStore;
}

// ============================================================================
// Artifact resolution (ch02 `apps/`) — slug/id → project dir for ekoa_action.
// The engine may not import `apps/` (sibling tier 5); wired at the root.
// ============================================================================

export interface ArtifactResolution {
  artifactId: string;
  projectDir: string;
}

// Async: the real resolver (apps/ registry) reads the slug index + artifacts store off the
// database, so it returns a Promise. Default resolves null. `requesterOrgId` is the RUN's org —
// the resolver MUST refuse an artifact outside it, so an ekoa_action step cannot target another
// org's artifact and execute its manifest capability against the victim's app-data (Codex G8).
export type ArtifactResolver = (slugOrId: string, requesterOrgId: string) => Promise<ArtifactResolution | null>;

const defaultArtifactResolver: ArtifactResolver = async () => null;
let artifactResolver: ArtifactResolver = defaultArtifactResolver;
export function setArtifactResolver(fn: ArtifactResolver): void {
  artifactResolver = fn;
}
export function resolveArtifactProjectDir(slugOrId: string, requesterOrgId: string): Promise<ArtifactResolution | null> {
  return artifactResolver(slugOrId, requesterOrgId);
}

// ============================================================================
// Cross-agent catalog inputs (ch05 §5.5.2 layer 4) — integration definitions,
// connected accounts, and artifact capabilities live in sibling/unbuilt
// modules; the catalog builder reads them through these seams. All default
// empty (catalog build failures are non-fatal — §5.5.2 item 4).
// ============================================================================

export interface SkillActionEntry {
  actionName: string;
  description: string;
  argsSchema?: Record<string, unknown>;
  mutates?: boolean;
}

export interface SkillEntry {
  integrationKey: string;
  actions?: SkillActionEntry[];
  listenerConfig?: { events?: Array<{ name: string }> };
}

export interface ConnectedAccount {
  integrationKey: string;
  email: string;
}

export interface EkoaActionCatalogEntry {
  artifactSlug: string;
  artifactName: string;
  capabilityName: string;
  description: string;
  argsSummary: string;
  mutates: boolean;
}

export interface CatalogSources {
  /** Integration definitions visible to the user (their actions feed the catalog). */
  getVisibleSkills(userId: string, superAdmin: boolean): SkillEntry[];
  /** One skill by key (listener event-name resolution). */
  getSkill(integrationKey: string, ownerUserId?: string): SkillEntry | undefined;
  /** Connected platform accounts (Google/Microsoft) for the "signed in as" block. */
  getConnectedPlatformAccounts(): Promise<ConnectedAccount[]>;
  /** The user's artifact capabilities (MANIFEST.md), flattened into catalog entries. */
  listEkoaActions(userId: string, superAdmin: boolean): Promise<EkoaActionCatalogEntry[]>;
}

const defaultCatalogSources: CatalogSources = {
  getVisibleSkills: () => [],
  getSkill: () => undefined,
  getConnectedPlatformAccounts: async () => [],
  listEkoaActions: async () => [],
};
let catalogSources: CatalogSources = defaultCatalogSources;
export function setCatalogSources(s: CatalogSources): void {
  catalogSources = s;
}
export function getCatalogSources(): CatalogSources {
  return catalogSources;
}

// ============================================================================
// In-process browser context (ch02 `services/` automation-browser, port-as-is
// but not yet built) — the persistent per-owner stealth Chromium context the
// LocalBrowserSession runs against when no daemon is paired. Default throws an
// honest "not available" (the engine only reaches it when the local-browser
// fallback is enabled AND no daemon is connected).
// ============================================================================

export type LocalBrowserContextProvider = (ownerUserId: string) => Promise<BrowserContext>;

const defaultLocalBrowserContextProvider: LocalBrowserContextProvider = async () => {
  throw new Error('in-process automation browser context is not wired');
};
let localBrowserContextProvider: LocalBrowserContextProvider = defaultLocalBrowserContextProvider;
export function setLocalBrowserContextProvider(fn: LocalBrowserContextProvider): void {
  localBrowserContextProvider = fn;
}
export function getLocalBrowserContext(ownerUserId: string): Promise<BrowserContext> {
  return localBrowserContextProvider(ownerUserId);
}

// ============================================================================
// Run event emitter factory (ch03 §3.6.3) — the SSE stream for an automation run.
// automation/ must NOT import events/ (ch02 §2.8), so the run-start path asks this
// factory for a per-run `RunEventEmitter`; the composition root binds it to an
// sseManager adapter that maps the emitter callbacks onto the wire AutomationRunEvent
// union. Default: no emitter (the engine runs, just without a stream).
// ============================================================================

export type RunEventEmitterFactory = (runId: string) => RunEventEmitter | undefined;

const defaultRunEventEmitterFactory: RunEventEmitterFactory = () => undefined;
let runEventEmitterFactoryFn: RunEventEmitterFactory = defaultRunEventEmitterFactory;
export function setRunEventEmitterFactory(fn: RunEventEmitterFactory): void {
  runEventEmitterFactoryFn = fn;
}
export function runEventEmitterFactory(runId: string): RunEventEmitter | undefined {
  return runEventEmitterFactoryFn(runId);
}

// ============================================================================
// Reset (tests)
// ============================================================================

/** Reset every automation seam to its default (tests). */
export function __resetAutomationSeamsForTests(): void {
  runEventEmitterFactoryFn = defaultRunEventEmitterFactory;
  daemonResolver = defaultDaemonResolver;
  integrationExecutor = defaultIntegrationExecutor;
  platformCaller = defaultPlatformCaller;
  credentialLoader = defaultCredentialLoader;
  scopedMemoryResolver = defaultScopedMemoryResolver;
  appDataStore = defaultAppDataStore;
  artifactResolver = defaultArtifactResolver;
  catalogSources = defaultCatalogSources;
  localBrowserContextProvider = defaultLocalBrowserContextProvider;
}
