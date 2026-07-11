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

export interface IntegrationAction {
  actionName: string;
  description: string;
  mutates: boolean;
  argsSchema?: Record<string, unknown>;
  returnSchema?: Record<string, unknown>;
  httpConfig?: IntegrationActionHttpConfig;
  automationBinding?: IntegrationActionAutomationBinding;
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

/** Deep-clone a value, redacting any property whose key names a credential value. */
function redactSecrets<T>(value: T): T {
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
 * The integration package's knowledge SKILL.md (raw markdown), or null when the package has
 * none. The definitions registry deliberately ignores SKILL.md (config.json is the runtime
 * contract); this is the ON-DEMAND knowledge surface the agents pull through `load_context`
 * as `integration-<key>`. Only a KNOWN definition key resolves — the key never touches the
 * filesystem unvalidated.
 */
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
