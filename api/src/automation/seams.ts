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
import type { Actor } from '@ekoa/shared';
// Type-only import (erased at compile) — the run event emitter's shape lives in engine.ts, which
// imports this module at RUNTIME; a type-only import back here creates no runtime cycle.
import type { RunEventEmitter } from './engine.js';
import type { EgressCandidate, EgressResolution } from './egress-policy.js';

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
  /**
   * The step's declared env-var -> `cofre:` REFERENCE mapping (I9). REFERENCES ONLY - the values
   * are resolved at the composition root through the Cofre's `unwrap()` and delivered to the
   * machine on the one frame in the union that carries credential material, under the SAME
   * invocation id as the step that consumes them.
   *
   * It travels on the seam rather than being read from `bridge/` by the executor because
   * `automation/` must not import the bridge: the wiring belongs at the root, and this field is
   * how the step says what it needs without knowing how it gets there. Absent means no delivery.
   */
  secretEnv?: Record<string, string>;
  /** The run's actor, required only to resolve `secretEnv` (the unwrap is tenant-scoped). */
  actor?: Actor;
}

/** The live daemon control channel for one owner. `runStep` dispatches a resolved browser action
 *  / bash command and returns the post-action observation envelope. Mirrors the old
 *  `BridgeConnection.runStep` (carryover-audit B16); the concrete WS transport lands in `bridge/`. */
export interface DaemonConnection {
  runStep(req: DaemonStepRequest, opts?: { onProgress?: (chunk: string) => void }): Promise<ResultEnvelope>;
  /**
   * The pairing this connection belongs to (Cofre J-7). Optional because the seam predates it and
   * a test double need not supply one — but when the composition root wires the real bridge it
   * MUST, because it is what binds a local-command approval to the machine the user approved it
   * for. Absent means "no specific machine", which is a distinct approval scope that never matches
   * a pairing-bound row rather than a wildcard that matches every one.
   */
  readonly pairingId?: string;
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

// ---- Bound origins for a credential (Cofre R-2, invariant I6) --------------
//
// The api_call step interpolates a decrypted credential into a URL the MODEL wrote, so the
// destination and the credential have independent provenance. The integration's own declared base
// URL is the interim binding (the Cofre's per-item `boundOrigins` replaces this in WS-C without
// moving the enforcement point). `automation/` does not import `integrations/`, hence the seam.

// A2: the resolver now carries the RUN's actor, because an integration definition is tenant-scoped
// — the same key resolves to a different package (and therefore a different allow-list) per org.
// Resolving it unscoped would bind one org's credential to another org's declared hosts.
export type IntegrationOriginResolver = (integrationKey: string, actor: Actor) => Promise<string[]>;

/** DEFAULT IS REFUSE. An unbound credential must not fall back to "any public host" — that is
 *  precisely the hole R-2 closes, and a permissive default would reopen it for every caller that
 *  forgets to bind the seam. */
const defaultOriginResolver: IntegrationOriginResolver = async () => [];
let originResolver: IntegrationOriginResolver = defaultOriginResolver;
export function setIntegrationOriginResolver(fn: IntegrationOriginResolver): void {
  originResolver = fn;
}
/** Hosts the named integration's credential may be sent to, AS SEEN BY `actor`. Empty → the
 *  api_call step refuses (unbound never means unrestricted). */
export function loadIntegrationBoundOrigins(integrationKey: string, actor: Actor): Promise<string[]> {
  return originResolver(integrationKey, actor);
}

// ---- The action's own declaration (P3.1/P3.2, Cofre G-4) -------------------
//
// The credential gate needs two facts about the action a step is running: WHERE it goes (the
// resolved `httpConfig.baseUrl`, which is the repo's one origin truth since `declaredOrigins` was
// deleted) and HOW the origin treats being automated (`posture` / `authProfile`, which
// `origin-posture.ts` folds into a classification). Both live on `IntegrationAction`, which is in
// `integrations/` — the tier `automation/` does not import. Hence a seam, resolved per RUN ACTOR
// for the same reason `IntegrationOriginResolver` is: the same key names a different package per
// org, so an unscoped resolution would read one tenant's declaration for another tenant's run.

/**
 * The three fields the gate reads off an action, structurally rather than as an
 * `IntegrationAction` import. `PostureBearingAction` (`origin-posture.ts`) is the same shape and an
 * `IntegrationAction` satisfies both by construction.
 */
export interface IntegrationActionDeclaration {
  posture?: 'permissive' | 'adversarial';
  authProfile?: { attended: boolean };
  httpConfig?: { baseUrl?: string };
}

export type IntegrationActionDeclarationResolver = (
  integrationKey: string,
  actionName: string,
  actor: Actor,
) => Promise<IntegrationActionDeclaration | null>;

/** DEFAULT IS "NOTHING DECLARED", which `classifyOrigin` reads as adversarial + no cloud egress.
 *  An unbound seam must not be able to open a posture; it can only fail closed. */
const defaultActionDeclarationResolver: IntegrationActionDeclarationResolver = async () => null;
let actionDeclarationResolver: IntegrationActionDeclarationResolver = defaultActionDeclarationResolver;
export function setIntegrationActionDeclarationResolver(fn: IntegrationActionDeclarationResolver): void {
  actionDeclarationResolver = fn;
}
/** The named action's posture + base URL AS SEEN BY `actor`, or null when nothing is declared. */
export function loadIntegrationActionDeclaration(
  integrationKey: string,
  actionName: string,
  actor: Actor,
): Promise<IntegrationActionDeclaration | null> {
  return actionDeclarationResolver(integrationKey, actionName, actor);
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
  /**
   * Integration definitions visible to the ACTOR (their actions feed the catalog). A2: takes the
   * whole actor and is ASYNC, because definition visibility is now a tenant-scoped database read —
   * a user-id alone cannot answer "which definitions may this caller see". The super-admin flag it
   * used to take is `actor.role`.
   */
  getVisibleSkills(actor: Actor): Promise<SkillEntry[]>;
  /** One skill by key, as seen by the actor (listener event-name resolution). */
  getSkill(actor: Actor, integrationKey: string): Promise<SkillEntry | undefined>;
  /** Connected platform accounts (Google/Microsoft) for the "signed in as" block. */
  getConnectedPlatformAccounts(): Promise<ConnectedAccount[]>;
  /** The user's artifact capabilities (MANIFEST.md), flattened into catalog entries. */
  listEkoaActions(userId: string, superAdmin: boolean): Promise<EkoaActionCatalogEntry[]>;
}

const defaultCatalogSources: CatalogSources = {
  getVisibleSkills: async () => [],
  getSkill: async () => undefined,
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
// but not yet built) — the stealth Chromium context the LocalBrowserSession
// runs against when no daemon is paired. Default throws an honest "not
// available" (the engine only reaches it when the local-browser fallback is
// enabled AND no daemon is connected).
//
// THE PROVIDER MUST BE NON-PERSISTENT. This docblock used to describe it as a
// "persistent per-owner" context; it never was — the composition root hands
// back `browser.newContext()` (pinned by
// api/tests/security/browser-context-lifecycle.test.ts), and it must keep
// doing so. Two callers make that a security property rather than a detail:
// `local-browser-session.ts` (no cookie jar shared across runs) and
// `session-establishment.ts`, which calls `context.storageState()` right after
// a login and stores the result as a credential-equivalent Cofre item. Against
// a persistent per-owner profile that call means "capture the owner's WHOLE
// cross-site cookie jar" — every site they were ever signed into, encrypted
// into one item bound to one portal — and a login that merely reused stale
// cookies would report itself as a successful re-establishment.
// ============================================================================

/**
 * P4.1: the provider now also carries the run's EGRESS RESOLUTION, because the proxy is a LAUNCH
 * option - `newContext({ proxy })` - and cannot be applied to a context that already exists. The
 * resolution is computed at the run loop (`locality.ts`, which knows the origin's posture and the
 * step's declaration) and handed down; the composition root's only job is to turn it into the
 * launch option via `proxyOptionFor`. Optional so a caller with nothing to declare behaves exactly
 * as it did before this parameter existed.
 */
export type LocalBrowserContextProvider = (
  ownerUserId: string,
  egress?: EgressResolution,
) => Promise<BrowserContext>;

const defaultLocalBrowserContextProvider: LocalBrowserContextProvider = async () => {
  throw new Error('in-process automation browser context is not wired');
};
let localBrowserContextProvider: LocalBrowserContextProvider = defaultLocalBrowserContextProvider;
export function setLocalBrowserContextProvider(fn: LocalBrowserContextProvider): void {
  localBrowserContextProvider = fn;
}
export function getLocalBrowserContext(
  ownerUserId: string,
  egress?: EgressResolution,
): Promise<BrowserContext> {
  return localBrowserContextProvider(ownerUserId, egress);
}

// ============================================================================
// Egress candidates (Cofre WS-I / I-2) — the org's machines, as the bridge registry sees them.
//
// `resolveEgress` (egress-policy.ts) needs the fleet to choose a route out, and the fleet lives in
// `bridge/` — a module `automation/` does not import (the same one-way tier rule that puts
// `getDaemonConnection` here). So the direction is inverted: this declares the resolver, and the
// composition root binds it to `bridge/registry.ts` `egressCandidatesForOrg`.
//
// DEFAULT IS EMPTY, and empty is the CLOSED answer: with no candidates a residential requirement
// cannot be met, so `resolveEgress` refuses (or queues) rather than falling through to a
// datacenter route. An unbound seam must never be able to widen where a run's traffic may leave
// from — the same posture `defaultOriginResolver` takes above.
// ============================================================================

export type EgressCandidateResolver = (orgId: string) => Promise<EgressCandidate[]>;

const defaultEgressCandidateResolver: EgressCandidateResolver = async () => [];
let egressCandidateResolver: EgressCandidateResolver = defaultEgressCandidateResolver;
export function setEgressCandidateResolver(fn: EgressCandidateResolver): void {
  egressCandidateResolver = fn;
}
/** The machines this ORG may be routed through. Org-scoped by construction (Rule 5). */
export function loadEgressCandidates(orgId: string): Promise<EgressCandidate[]> {
  return egressCandidateResolver(orgId);
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
// Agent-content sections (ch08) — the automation kind's eager content package.
// automation/ must not import content/ or agents/; the composition root wires
// the content loader here. Honest default: no sections (the planner runs on its
// inline shape-contract prompt alone).
// ============================================================================

export type AutomationContentResolver = (userId: string) => Promise<string[]>;
const defaultAutomationContent: AutomationContentResolver = async () => [];
let automationContentFn: AutomationContentResolver = defaultAutomationContent;
export function setAutomationContentSections(fn: AutomationContentResolver): void {
  automationContentFn = fn;
}
/** The automation agent kind's composed eager content sections (never throws a run). */
export async function automationContentSections(userId: string): Promise<string[]> {
  try {
    return await automationContentFn(userId);
  } catch {
    return []; // content assembly is never fatal to a plan
  }
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
  originResolver = defaultOriginResolver;
  actionDeclarationResolver = defaultActionDeclarationResolver;
  scopedMemoryResolver = defaultScopedMemoryResolver;
  appDataStore = defaultAppDataStore;
  artifactResolver = defaultArtifactResolver;
  catalogSources = defaultCatalogSources;
  localBrowserContextProvider = defaultLocalBrowserContextProvider;
  egressCandidateResolver = defaultEgressCandidateResolver;
  automationContentFn = defaultAutomationContent;
}
