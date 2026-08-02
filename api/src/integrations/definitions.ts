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
 * Ported (read-only subset) from cortex/src/services/integration-storage.ts.
 *
 * THE DISK RUNTIME TIER IS RETIRED (slice A3). Builder saves land in the tenant-scoped Mongo
 * store (`definition-save.ts`, private-by-default); the legacy on-disk runtime packages
 * (`<dataDir>/integrations/runtime/<key>/`) are imported ONCE at boot as `visibility:'global'`,
 * `origin:'legacy-runtime'` rows (`legacy-runtime-import.ts` — RUN_SPEC 20260801 assumption 3,
 * Rule-10 review 2026-08-15 in docs/decisions.md) and the directory is FROZEN: nothing writes it,
 * and NO read below folds it into the cache any more. That merged cache was one process-wide
 * directory any authenticated user of any org could write, which made every reader of it a
 * cross-tenant leak (A2 review F1); every function here is now BASELINE-ONLY by construction —
 * the merged-vs-baseline split (`getBaselineDefinition` et al.) is kept as API so the registry's
 * fallback contract stays explicit, but the two views now hold the same shipped set.
 *
 * These are PACKAGE definitions, not org configs — they hold no credential VALUES. A
 * defensive redaction pass (redactSecrets) still runs over every projection so a
 * credential-named field can never leave the registry, belt-and-braces.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
    if (!action.automationBinding) {
      return refuse('carries no automationBinding — a browser-steps action must name the automation that runs its steps');
    }
    // The contradiction rule is applied SYMMETRICALLY (C1 review F3): bash-cli + httpConfig was
    // refused while browser-steps + httpConfig passed silently, leaving dead request config on the
    // action that nothing would ever dial. A shape the backing cannot use is a package defect
    // whichever backing declares it — say so at parse time rather than let it rot.
    return action.httpConfig
      ? refuse('also carries an httpConfig — a browser-steps action runs its steps through an automation, so the request config is dead weight')
      : 'browser-steps';
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
  /** The stored definition's id — present ONLY for a tenant row of the reading actor's own org
   *  (E1 review F3: the sharing routes key on it, so a client must be able to learn it; a
   *  cross-org `global` row omits it, since the id is derivable from (orgId, key)). Absent on the
   *  shipped disk baseline, which has no stored row. */
  id?: string;
  /** The sharing tier — same own-org-only rule as `id`. Absent for baseline + foreign rows. */
  visibility?: 'private' | 'org' | 'global';
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
 *
 * A3 (A2 review F7): broadened with the header-shaped names the original set missed —
 * `authorization`, `token`, `x-api-key`, `signature` (and `auth`/`api`-token variants). These
 * names legitimately appear as httpConfig HEADER keys whose values are `{{...}}` TEMPLATES
 * ("Authorization": "Bearer {{access_token}}" in the shipped stripe/slack/zoho packages) that
 * carry no secret and MUST survive, or the executor would send "[REDACTED]" as the header —
 * hence the template exemption in `redactSecrets` below.
 */
const SECRET_KEY_RE =
  /^(api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|app[_-]?secret|password|passwd|credentials?|bearer[_-]?token|authorization|auth[_-]?token|api[_-]?token|token|x[_-]?api[_-]?key|signature)$/i;

/**
 * A string value under a credential-named key that is a pure INTERPOLATION TEMPLATE: it names a
 * credential field (`{{api_key}}`) rather than carrying a value. The residue outside the
 * placeholders must not itself look like a pasted token — a scheme word ("Bearer ",
 * "Zoho-oauthtoken ") passes, `"Bearer sk-live-<28 chars>"` does not.
 */
function isCredentialTemplate(v: unknown): boolean {
  if (typeof v !== 'string' || !/\{\{[^{}]+\}\}/.test(v)) return false;
  const residue = v.replace(/\{\{[^{}]+\}\}/g, '');
  return !/[A-Za-z0-9+/=_.-]{20,}/.test(residue);
}

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
      out[k] = SECRET_KEY_RE.test(k) && !isCredentialTemplate(v) ? '[REDACTED]' : redactSecrets(v);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Deterministic FREE-TEXT scrub for stored knowledge bodies (SKILL.md / lessons) read back into an
 * agent prompt (A2 review F7: `resolveSkillMd` returned a tenant-authored body verbatim, so a
 * credential the author pasted into their doc would ride into every future prompt). This is the
 * READ-path floor only — the strict publish-time scrub (deterministic floor + one chokepoint model
 * pass into a frozen snapshot) is slice E2's.
 *
 * Two passes, both value-anchored so documentation of field NAMES survives:
 *   1. `<secret-name>: value` / `<secret-name>=value` — the value token is redacted unless it is a
 *      `{{template}}` placeholder (docs legitimately show `Authorization: Bearer {{access_token}}`).
 *   2. `Bearer|Basic <long token>` — a pasted credential after an auth scheme word.
 */
const SECRET_LINE_RE =
  /\b(api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|app[_-]?secret|password|passwd|credentials?|bearer[_-]?token|authorization|auth[_-]?token|api[_-]?token|token|x[_-]?api[_-]?key|signature)(\s*[:=]\s*)(?!\{\{)("?[A-Za-z0-9+/=_.-]{8,}"?)/gi;
const BEARER_VALUE_RE = /\b(bearer|basic)\s+(?!\{\{)[A-Za-z0-9+/=_.-]{16,}/gi;

export function scrubSecretText(body: string): string {
  return body
    .replace(SECRET_LINE_RE, (_m, key: string, sep: string) => `${key}${sep}[REDACTED]`)
    .replace(BEARER_VALUE_RE, (_m, scheme: string) => `${scheme} [REDACTED]`);
}

// ============================================
// Cache + loading
// ============================================

let cache: Map<string, IntegrationDefinition> | null = null;
/** Keys of the read-only BASELINE tier (api/assets/integrations). Rebuilt by load(). The
 *  reserved-key set the builder guards against (a user integration may not claim a shipped key)
 *  is derived from this + the pipedream row. */
let baselineKeys = new Set<string>();
/**
 * The BASELINE tier as its OWN map. Since A3 retired the disk runtime tier from `load()`, `cache`
 * and `baselineCache` hold the SAME shipped set — the separate map (and the baseline-only
 * accessors below) are KEPT deliberately: they are the A2-review contract that the registry's
 * fallback can only ever read shipped packages, and they make any future second tier opt-in at
 * the accessor level instead of silently folded into every reader (the A2 F1 leak shape).
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

/**
 * Root of the FROZEN legacy runtime tier (`<dataDir>/integrations/runtime/<key>/`) — the directory
 * the builder used to save user packages into before A3 moved that write path to the tenant-scoped
 * Mongo store. Nothing writes it any more and nothing here READS it into the cache; its packages
 * are imported once at boot by `legacy-runtime-import.ts` (which is why the accessor survives) and
 * the directory is removed at the Rule-10 review date (2026-08-15, docs/decisions.md).
 */
export function legacyRuntimeDir(): string {
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
      next.set(def.key, def);
      keys.add(def.key);
    }
  }
}

/** (Re)load the BASELINE package directories from disk into a fresh cache. The disk runtime tier
 *  is deliberately NOT loaded (A3): its packages live in Mongo since the boot import, and folding
 *  a world-writable directory into the process-wide cache was the A2 F1 cross-tenant leak. */
function load(): Map<string, IntegrationDefinition> {
  const next = new Map<string, IntegrationDefinition>();
  const baseKeys = new Set<string>();
  loadTier(integrationsDir(), false, next, baseKeys);
  baselineCache = new Map(next);
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
 * BASELINE-ONLY reads — the shipped, repo-authored packages.
 *
 * Why this exists (A2 review, F1). The disk runtime tier was ONE global directory that any
 * authenticated user of any org could write through the builder, and `load()` used to fold it
 * into the same cache as the shipped packages — so every reader of the merged cache handed one
 * tenant's authored package (including its action `baseUrl`s, which the origin resolver turns
 * into a credential-egress allow-list) to every other tenant. The tenant-scoped registry
 * therefore falls back to THESE accessors, never to the merged view. Since A3 retired the runtime
 * tier from `load()` entirely, the two views coincide — the split is kept as the explicit
 * contract (see the module header).
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
  const p = join(integrationsDir(), key, 'SKILL.md'); // the BASELINE dir only, never the legacy runtime dir
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * An integration package's automation TEMPLATE (`<package>/automations/<templateKey>.json`):
 * the repo-authored blueprint the provisioner materializes as a managed automation. BASELINE
 * ONLY (A3, A2-residual 3): this used to probe the runtime dir FIRST on a tenant response path,
 * i.e. a world-writable directory could steer any org's provisioned automation steps. Templates
 * are package FILES only shipped with baseline packages (the retired runtime writer never wrote
 * an `automations/` dir), so baseline-only is the whole truth. Both path segments are validated
 * (the templateKey never touches the filesystem unvalidated); a malformed file returns null
 * (counted by the caller, never fatal).
 */
export function integrationAutomationTemplate(
  key: string,
  templateKey: string,
): { templateKey: string; name: string; description?: string; inputSchema?: { fields: Array<{ name: string; description: string; required: boolean; defaultValue?: string }> }; steps: Array<Record<string, unknown>> } | null {
  ensure(); // populates baselineCache
  if (!baselineCache.has(key) || !/^[a-z0-9][a-z0-9-]{0,48}$/.test(templateKey)) return null;
  const p = join(integrationsDir(), key, 'automations', `${templateKey}.json`);
  if (!existsSync(p)) return null;
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

/** The SHIPPED package's SKILL.md, baseline only (A3 — alias of `baselineSkillMd`, kept for its
 *  existing callers). Tenant knowledge bodies are served by the registry's `resolveSkillMd`. */
export function integrationSkillMd(key: string): string | null {
  return baselineSkillMd(key);
}

/**
 * The keys a user-created integration may NOT claim: every BASELINE definition key plus the
 * reserved `pipedream` connect row. The builder parser AND the Mongo save path
 * (`definition-save.ts`) both refuse a package whose key collides with this set — since A3 with
 * NO loaded-session exemption, so a shipped key can never be shadowed through the builder
 * (§3.8.14/§3.8.16; A2-residual 4).
 */
export function reservedIntegrationKeys(): Set<string> {
  ensure(); // populates baselineKeys
  return new Set<string>([...baselineKeys, PIPEDREAM_INTEGRATION_KEY]);
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

/**
 * Force a reload from disk (POST /api/v1/integrations/refresh). Since A3 the reported
 * `{count, keys}` is the shipped BASELINE set only — the same for every caller. It used to fold
 * in the runtime tier, which made this org-admin route a cross-tenant KEY ENUMERATION (every
 * tenant's authored package keys, A2-residual 1); tenant definitions live in Mongo, are read per
 * request, and need no refresh.
 */
export function refreshDefinitions(): { count: number; keys: string[] } {
  const m = load();
  return { count: m.size, keys: Array.from(m.keys()).sort() };
}
