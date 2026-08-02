/**
 * Integration DEFINITIONS registry (ch03 §3.8.13 — the read surface).
 *
 * Loads the VERSIONED integration packages shipped under `api/assets/integrations/<key>/`
 * into an in-memory cache and projects them for two read endpoints:
 *   - the definition list (GET /api/v1/integrations)         -> full action shapes
 *   - the active catalog  (GET /api/v1/integrations/active)  -> action + event catalogs
 *
 * Each package dir carries `config.json` (the definition: key, displayName, actions with
 * httpConfig/automationBinding/passCredentials/mutates, webhookConfig, listenerConfig,
 * authType, configSchema) alongside SKILL.md / history.json which the registry ignores.
 *
 * Ported (read-only subset) from cortex/src/services/integration-storage.ts. Explicitly
 * DEFERRED to G8 (the execution stack): per-user sandbox skills, runtime overrides, saves /
 * mutations, conversation history, and the connect/provision flows.
 *
 * These are PACKAGE definitions, not org configs — they hold no credential VALUES. A
 * defensive redaction pass (redactSecrets) still runs over every projection so a
 * credential-named field can never leave the registry, belt-and-braces.
 */

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIPEDREAM_INTEGRATION_KEY } from './service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================
// Package (config.json) shapes — the on-disk definition contract
// ============================================

export interface IntegrationConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'url' | 'select' | 'password' | 'textarea';
  required: boolean;
  /** Marks the field as a credential input; the definition still carries no VALUE for it. */
  secret: boolean;
  helpText?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface IntegrationActionHttpConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  baseUrl: string;
  path: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  bodyTemplate?: Record<string, unknown>;
}

export interface IntegrationActionAutomationBinding {
  automationId: string;
  argMap?: Record<string, string>;
  passCredentials?: boolean;
  automationTemplate?: string;
}

/**
 * HOW an action is executed — the unified Action model's backing discriminator (decisions.md
 * 2026-08-01: "an action's backing type is one of api-call, mcp-call, bash-cli, browser-steps").
 * Only the three this build can execute or refuse coherently are modelled here; `mcp-call` lands
 * with the slice that implements it, and adding it is additive (this union is not on the wire).
 *
 * NOT the same axis as `transport`, which names the WIRE PROTOCOL of an api-call action (`http`,
 * `imap`, …). An action is refused for an unimplemented transport and for an unimplemented backing
 * independently, with distinct codes.
 */
export type IntegrationActionBackingType = 'api-call' | 'bash-cli' | 'browser-steps';

export interface IntegrationAction {
  actionName: string;
  description: string;
  mutates: boolean;
  argsSchema?: Record<string, unknown>;
  returnSchema?: Record<string, unknown>;
  httpConfig?: IntegrationActionHttpConfig;
  automationBinding?: IntegrationActionAutomationBinding;
  /**
   * The action's BACKING — how it runs. ABSENT ⇒ derived from the action's shape by
   * `resolveBackingType`, which reproduces today's behaviour byte for byte, so the field is
   * additive and migration-free (no shipped package declares it yet). Declare it only to state
   * something the shape cannot: a `bash-cli` action, or an api-call action that must NOT be
   * re-read as automation-backed because it also carries a binding.
   *
   * An EXPLICIT value that contradicts the shape is a package defect, never a hint to guess
   * around — see `resolveBackingType`.
   */
  backingType?: IntegrationActionBackingType;
  /**
   * Wire protocol the action needs. ABSENT ⇒ `'http'` (every shipped action today), so this is
   * additive and migration-free. A package may declare a protocol the executor does not implement
   * (the `imap` package declares `'imap'`); `executeUserIntegrationAction` then refuses the action
   * with the coded `unsupported_transport` failure instead of dialling a placeholder URL or
   * returning a fabricated empty result (2A-S4).
   */
  transport?: string;
}

/**
 * A package declares a `backingType` its own shape cannot support. Thrown by `resolveBackingType`
 * and mapped by the executor onto the coded `invalid_backing_type` refusal — the definition module
 * stays free of the executor's error vocabulary (the executor imports this module, never the
 * reverse).
 */
export class IntegrationActionBackingTypeError extends Error {
  constructor(
    readonly actionName: string,
    readonly declaredBackingType: string,
    message: string,
  ) {
    super(message);
    this.name = 'IntegrationActionBackingTypeError';
  }
}

/**
 * The ONE resolver for "how does this action run" — every caller asks this, nobody re-derives it.
 *
 * DERIVATION (no explicit `backingType`), exactly today's executor precedence:
 *   - an `automationBinding` ⇒ `browser-steps` (a bound action delegates to the automation seam,
 *     and that binding has always won over any `httpConfig` on the same action);
 *   - otherwise ⇒ `api-call` (the `httpConfig` path). An action with NEITHER shape also derives
 *     `api-call`: it is unexecutable, and the api-call branch is where the executor has always
 *     refused it, with the same code and the same message as before this field existed.
 *
 * EXPLICIT: validated against the shape, never guessed around. `api-call` needs an `httpConfig`
 * to call; `browser-steps` needs the `automationBinding` naming the steps to run; `bash-cli` must
 * NOT carry an `httpConfig` (it runs a command on the user's paired machine, not an HTTP request).
 * A contradiction — or a value outside the union, which an unvalidated `config.json` can carry —
 * throws `IntegrationActionBackingTypeError`.
 */
export function resolveBackingType(action: IntegrationAction): IntegrationActionBackingType {
  const declared = action.backingType;
  if (declared === undefined) return action.automationBinding ? 'browser-steps' : 'api-call';

  const refuse = (why: string): never => {
    throw new IntegrationActionBackingTypeError(
      action.actionName,
      String(declared),
      `action "${action.actionName}" declares backingType "${String(declared)}" but ${why}`,
    );
  };
  if (declared === 'api-call') {
    return action.httpConfig ? 'api-call' : refuse('carries no httpConfig — an api-call action must declare the request it makes');
  }
  if (declared === 'browser-steps') {
    return action.automationBinding
      ? 'browser-steps'
      : refuse('carries no automationBinding — a browser-steps action must name the automation that runs its steps');
  }
  if (declared === 'bash-cli') {
    return action.httpConfig
      ? refuse('carries an httpConfig — a bash-cli action runs a command on the paired machine, never an HTTP request')
      : 'bash-cli';
  }
  return refuse('that is not a backing type this version implements');
}

export interface IntegrationEvent {
  name: string;
  labelPt: string;
}

export interface IntegrationWebhookConfig {
  verifySignature?: Record<string, unknown>;
  secretSource?: unknown;
  challenge?: Record<string, unknown>;
  getCallback?: Record<string, unknown>;
  dedupKey?: Record<string, unknown>;
  registration?: Record<string, unknown>;
  events?: IntegrationEvent[];
}

export interface IntegrationListenerConfig {
  pollAction: string;
  intervalMs: number;
  cursorField: string;
  eventArrayField: string;
  dedupKeyField: string;
  outOfOrder?: boolean;
  events?: IntegrationEvent[];
}

export interface IntegrationSessionConnectConfig {
  loginUrl: string;
  successUrlContains: string;
  errorUrlContains?: string;
  guidePt?: string;
}

/** The parsed `config.json` of a versioned integration package. Exported so the integration
 *  builder (agents/) types + validates its generated package against the ONE canonical shape. */
export interface IntegrationPackageConfig {
  version?: string;
  skillType?: string;
  integrationKey: string;
  displayName?: string;
  description?: string;
  authType?: string;
  provider?: string;
  category?: string;
  configSchema?: IntegrationConfigField[];
  actions?: IntegrationAction[];
  credentialGuide?: string;
  sessionConnect?: IntegrationSessionConnectConfig;
  webhookConfig?: IntegrationWebhookConfig;
  listenerConfig?: IntegrationListenerConfig;
}

// ============================================
// Projected read shapes
// ============================================

/** A definition as returned by GET /api/v1/integrations (full action shapes). */
export interface IntegrationDefinition {
  key: string;
  /** Alias of `key`, kept for compatibility with callers keyed on `integrationKey`. */
  integrationKey: string;
  displayName?: string;
  description?: string;
  version?: string;
  authType?: string;
  provider?: string;
  category?: string;
  userCreated: boolean;
  configSchema: IntegrationConfigField[];
  actions: IntegrationAction[];
  credentialGuide?: string;
  sessionConnect?: IntegrationSessionConnectConfig;
  webhookConfig?: IntegrationWebhookConfig;
  listenerConfig?: IntegrationListenerConfig;
  createdAt: string;
  updatedAt: string;
}

/** An entry of GET /api/v1/integrations/active — action + webhook/listener event catalogs. */
export interface ActiveIntegrationCatalog {
  key: string;
  displayName?: string;
  actions: Array<{ actionName: string; description: string; mutates: boolean }>;
  webhookEvents: IntegrationEvent[];
  listenerEvents: IntegrationEvent[];
}

// ============================================
// Defensive secret scrub
// ============================================

/**
 * Credential-VALUE key names. Anchored so structural fields survive: `secret` (the
 * configSchema boolean flag), `secretSource`, `verifySignature`, `credentialField`,
 * `responseSecretPath` are all NOT credential values and are left intact.
 */
const SECRET_KEY_RE =
  /^(api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|app[_-]?secret|password|passwd|credentials?|bearer[_-]?token)$/i;

/**
 * Deep-clone a value, redacting any property whose key names a credential value.
 *
 * Exported (A2) so the tenant-scoped Mongo tier in `definition-registry.ts` runs the SAME scrub on
 * its projection as this disk tier runs on its own — one implementation of the rule, never a second
 * copy that can drift from `SECRET_KEY_RE`.
 */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? '[REDACTED]' : redactSecrets(v);
    }
    return out as unknown as T;
  }
  return value;
}

// ============================================
// Cache + loading
// ============================================

let cache: Map<string, IntegrationDefinition> | null = null;
/** Keys that come from the read-only BASELINE tier (api/assets/integrations). Rebuilt by load().
 *  The reserved-key set the builder guards against (a user integration may not shadow a shipped
 *  one) is derived from this + the pipedream row — not from the whole cache, which now also holds
 *  runtime (user-created) packages. */
let baselineKeys = new Set<string>();
/**
 * The BASELINE tier as its OWN map, not a key-set view over `cache`.
 *
 * `load()` writes both tiers into one map and lets runtime SHADOW baseline on a key collision, so
 * for a colliding key `cache.get(key)` is the RUNTIME object while `baselineKeys.has(key)` is still
 * true. A baseline-only read built as "look in `cache`, then check the key-set" would therefore hand
 * back the user-authored package for exactly the key an attacker would choose (A2 review F1, the
 * predicted residual). The builder's reserved-key guard makes that write hard, but the READ must not
 * depend on the write path holding — so the shipped packages are kept in a map of their own.
 */
let baselineCache = new Map<string, IntegrationDefinition>();

/** Root of the versioned BASELINE packages. Resolved at call time so tests can point
 *  EKOA_INTEGRATIONS_DIR at a fixture and refresh() picks it up. `__dirname/../../assets/integrations`
 *  holds from both api/src/integrations and api/dist/integrations (assets/ sits at the api root). */
function integrationsDir(): string {
  return process.env.EKOA_INTEGRATIONS_DIR || join(__dirname, '..', '..', 'assets', 'integrations');
}

/** Operational data directory (EKOA_DATA_DIR || ~/.ekoa/data), resolved per call so tests can
 *  override it — same derivation as services/artifact-screenshot.ts dataDir(). */
function dataDir(): string {
  const raw = process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/** Root of the RUNTIME tier: user-created integration packages the builder saves
 *  (`<dataDir>/integrations/runtime/<key>/`). Shadows baseline on key collision. */
function runtimeDir(): string {
  return join(dataDir(), 'integrations', 'runtime');
}

/** Load and project one package directory, or null if it has no readable config.json. */
function loadOne(dir: string, userCreated: boolean): IntegrationDefinition | null {
  const configPath = join(dir, 'config.json');
  if (!existsSync(configPath)) return null;

  let config: IntegrationPackageConfig;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8')) as IntegrationPackageConfig;
  } catch (err) {
    console.warn(`[integration-definitions] failed to parse ${configPath}:`, err instanceof Error ? err.message : err);
    return null;
  }

  const key = config.integrationKey;
  if (!key || typeof key !== 'string') return null;

  const iso = new Date(statSync(configPath).mtimeMs).toISOString();
  return redactSecrets<IntegrationDefinition>({
    key,
    integrationKey: key,
    displayName: config.displayName,
    description: config.description,
    version: config.version,
    authType: config.authType,
    provider: config.provider,
    category: config.category,
    userCreated,
    configSchema: config.configSchema ?? [],
    actions: config.actions ?? [],
    credentialGuide: config.credentialGuide,
    sessionConnect: config.sessionConnect,
    webhookConfig: config.webhookConfig,
    listenerConfig: config.listenerConfig,
    createdAt: iso,
    updatedAt: iso,
  });
}

/** Scan one tier's package directories into `next`, marking userCreated + recording keys. */
function loadTier(root: string, userCreated: boolean, next: Map<string, IntegrationDefinition>, keys: Set<string>): void {
  if (!existsSync(root)) return;
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const def = loadOne(join(root, d.name), userCreated);
    if (def) {
      next.set(def.key, def); // later tiers overwrite earlier ones (runtime shadows baseline)
      keys.add(def.key);
    }
  }
}

/** (Re)load every package directory from disk into a fresh cache: baseline first, then runtime
 *  (which shadows baseline on key collision, §8.3.2 rule 2). */
function load(): Map<string, IntegrationDefinition> {
  const next = new Map<string, IntegrationDefinition>();
  const baseKeys = new Set<string>();
  loadTier(integrationsDir(), false, next, baseKeys);
  // Snapshot the baseline BEFORE the runtime tier shadows anything into `next`.
  baselineCache = new Map(next);
  loadTier(runtimeDir(), true, next, new Set<string>());
  cache = next;
  baselineKeys = baseKeys;
  return next;
}

function ensure(): Map<string, IntegrationDefinition> {
  if (!cache) load();
  return cache!;
}

// ============================================
// Public read API
// ============================================

/** All loaded definitions (GET /api/v1/integrations). */
export function listDefinitions(): IntegrationDefinition[] {
  return Array.from(ensure().values());
}

/** One loaded definition by key, or null. Used by the platform API caller (platform-call.ts)
 *  to resolve an action's httpConfig without re-reading config.json off disk. */
export function getDefinition(key: string): IntegrationDefinition | null {
  return ensure().get(key) ?? null;
}

/**
 * BASELINE-ONLY reads — the shipped, repo-authored packages, with the process-wide RUNTIME tier
 * excluded.
 *
 * Why this exists (A2 review, F1). The runtime tier is ONE global directory that any authenticated
 * user of any org can write through the builder, and `load()` folds it into the same cache as the
 * shipped packages. So `getDefinition`/`listDefinitions` — which read that merged cache — hand one
 * tenant's authored package to every other tenant. That is the very leak the tenant-scoped registry
 * exists to close, and a fallback to the MERGED cache silently reopened it: the definition-registry
 * would fall through a tenant miss straight into another tenant's runtime package, including its
 * action `baseUrl`s, which the origin resolver turns into a credential-egress allow-list.
 *
 * The tenant-scoped registry therefore falls back to THESE, never to the merged cache. Runtime-tier
 * packages stay reachable only through the paths that already existed for them (the builder's own
 * routes) until A3 moves that write path into Mongo and retires the tier entirely.
 */
export function getBaselineDefinition(key: string): IntegrationDefinition | null {
  ensure(); // populates baselineCache
  return baselineCache.get(key) ?? null;
}

/** Every SHIPPED definition (runtime-tier packages excluded — see `getBaselineDefinition`). */
export function listBaselineDefinitions(): IntegrationDefinition[] {
  ensure(); // populates baselineCache
  return Array.from(baselineCache.values());
}

/** The SHIPPED package's SKILL.md (runtime tier excluded — see `getBaselineDefinition`). */
export function baselineSkillMd(key: string): string | null {
  ensure(); // populates baselineCache (a cold cache must not answer null for a real baseline key)
  if (!baselineCache.has(key)) return null;
  const p = join(integrationsDir(), key, 'SKILL.md'); // the BASELINE dir only, never runtimeDir()
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The integration package's knowledge SKILL.md (raw markdown), or null when the package has
 * none. The definitions registry deliberately ignores SKILL.md (config.json is the runtime
 * contract); this is the ON-DEMAND knowledge surface the agents pull through `load_context`
 * as `integration-<key>`. Only a KNOWN definition key resolves — the key never touches the
 * filesystem unvalidated.
 */
/**
 * An integration package's automation TEMPLATE (`<package>/automations/<templateKey>.json`):
 * the repo-authored blueprint the provisioner materializes as a managed automation. Runtime
 * tier wins over baseline (same shadowing rule as the definitions). Both path segments are
 * validated (the templateKey never touches the filesystem unvalidated); a malformed file
 * returns null (counted by the caller, never fatal).
 */
export function integrationAutomationTemplate(
  key: string,
  templateKey: string,
): { templateKey: string; name: string; description?: string; inputSchema?: { fields: Array<{ name: string; description: string; required: boolean; defaultValue?: string }> }; steps: Array<Record<string, unknown>> } | null {
  if (!ensure().has(key) || !/^[a-z0-9][a-z0-9-]{0,48}$/.test(templateKey)) return null;
  for (const root of [runtimeDir(), integrationsDir()]) {
    const p = join(root, key, 'automations', `${templateKey}.json`);
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
      if (typeof raw.name !== 'string' || !Array.isArray(raw.steps)) return null;
      return {
        templateKey,
        name: raw.name,
        ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
        ...(raw.inputSchema && typeof raw.inputSchema === 'object' ? { inputSchema: raw.inputSchema as never } : {}),
        steps: raw.steps as Array<Record<string, unknown>>,
      };
    } catch {
      return null;
    }
  }
  return null;
}

export function integrationSkillMd(key: string): string | null {
  if (!ensure().has(key)) return null;
  // Runtime wins over baseline (a user-created package shadows a shipped one of the same key).
  for (const p of [join(runtimeDir(), key, 'SKILL.md'), join(integrationsDir(), key, 'SKILL.md')]) {
    if (!existsSync(p)) continue;
    try {
      return readFileSync(p, 'utf8');
    } catch {
      /* try the next tier */
    }
  }
  return null;
}

/** Regex for a well-formed integration key, enforced at write time (mirrors the builder parser). */
const RUNTIME_KEY_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

/**
 * The keys a user-created integration may NOT claim: every BASELINE definition key plus the
 * reserved `pipedream` connect row. The integration builder rejects a generated/edited package
 * whose key collides with this set (unless the session is editing that very key), so a user
 * integration can never shadow a shipped one or the platform Pipedream row (§3.8.14/§3.8.16).
 */
export function reservedIntegrationKeys(): Set<string> {
  ensure(); // populates baselineKeys
  return new Set<string>([...baselineKeys, PIPEDREAM_INTEGRATION_KEY]);
}

/**
 * Persist a user-created integration package into the RUNTIME tier
 * (`<dataDir>/integrations/runtime/<key>/{config.json,SKILL.md}`) and refresh the registry so the
 * new definition is immediately resolvable (list/getDefinition/integrationSkillMd). `integrations/`
 * owns this filesystem write (the builder route calls it). The key shape is re-validated here as a
 * belt-and-braces guard even though the builder already checked it. Returns the reload summary.
 */
export function writeRuntimePackage(key: string, config: Record<string, unknown>, skillMd: string): { count: number; keys: string[] } {
  if (!RUNTIME_KEY_RE.test(key)) throw new Error(`invalid integration key: ${JSON.stringify(key)}`);
  const dir = join(runtimeDir(), key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  writeFileSync(join(dir, 'SKILL.md'), skillMd, 'utf8');
  return refreshDefinitions();
}

/** The action + event catalog for every loaded definition (unfiltered; the route joins
 *  it against the org's enabled configs to produce the "active" set for the trigger picker). */
export function activeCatalog(): ActiveIntegrationCatalog[] {
  return Array.from(ensure().values()).map((d) => ({
    key: d.key,
    displayName: d.displayName,
    actions: d.actions.map((a) => ({ actionName: a.actionName, description: a.description, mutates: a.mutates })),
    webhookEvents: d.webhookConfig?.events ?? [],
    listenerEvents: d.listenerConfig?.events ?? [],
  }));
}

/** Force a reload from disk (POST /api/v1/integrations/refresh). */
export function refreshDefinitions(): { count: number; keys: string[] } {
  const m = load();
  return { count: m.size, keys: Array.from(m.keys()).sort() };
}
