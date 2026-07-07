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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** The parsed `config.json` of a versioned integration package. */
interface IntegrationPackageConfig {
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

/** Root of the versioned packages. Resolved at call time so tests can point EKOA_INTEGRATIONS_DIR
 *  at a fixture and refresh() picks it up. `__dirname/../../assets/integrations` holds from both
 *  api/src/integrations and api/dist/integrations (assets/ sits at the api package root). */
function integrationsDir(): string {
  return process.env.EKOA_INTEGRATIONS_DIR || join(__dirname, '..', '..', 'assets', 'integrations');
}

/** Load and project one package directory, or null if it has no readable config.json. */
function loadOne(dir: string): IntegrationDefinition | null {
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
    userCreated: false,
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

/** (Re)load every package directory from disk into a fresh cache. */
function load(): Map<string, IntegrationDefinition> {
  const dir = integrationsDir();
  const next = new Map<string, IntegrationDefinition>();
  if (existsSync(dir)) {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const def = loadOne(join(dir, d.name));
      if (def) next.set(def.key, def);
    }
  }
  cache = next;
  return next;
}

function ensure(): Map<string, IntegrationDefinition> {
  return cache ?? load();
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
