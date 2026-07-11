/**
 * Integration-builder output parser (ch03 §3.8.14).
 *
 * Ported from the battle-tested cortex integration-agent parser (parseIntegrationOutput /
 * tryFixJson / autoFixConfigSchema), adapted to the ONE canonical package shape
 * (integrations/definitions.ts `IntegrationPackageConfig` — NO proxyContract) and hardened with
 * key-shape + reserved-key validation.
 *
 * The builder agent emits its package as TWO fenced blocks: ```skill-md (the integration's
 * knowledge doc) and ```config-json (the structured config the admin UI + action executor read).
 * This module extracts and validates them. It never calls the model and does no I/O, so it is a
 * pure function the save route re-uses to re-validate a client-posted package server-side.
 *
 * Types are imported type-only (no runtime coupling agents/ -> integrations/).
 */
import type {
  IntegrationPackageConfig,
  IntegrationConfigField,
} from '../integrations/definitions.js';

/** The field types integrations/definitions.ts `IntegrationConfigField` permits. */
const VALID_CONFIG_TYPES = new Set<string>(['string', 'number', 'boolean', 'url', 'select', 'password', 'textarea']);

/** A well-formed integration key: lower-kebab, leading alphanumeric, 2-49 chars total. */
export const INTEGRATION_KEY_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

export interface ParseOptions {
  /** Keys a NEW package may not claim (every baseline definition key + `pipedream`). */
  reservedKeys?: ReadonlySet<string>;
  /** The key this session is editing — a collision with it is allowed (re-save of the same key). */
  loadedKey?: string;
}

export interface ParseResult {
  /** The parsed config, or null when the model has not emitted a package yet (still conversing)
   *  or the config-json block is absent/unparseable. */
  pkg: IntegrationPackageConfig | null;
  /** The skill-md block body, or null when the model has not emitted one yet. */
  skillMd: string | null;
  /** Human-readable validation problems surfaced to the builder UI; empty on a clean package. */
  errors: string[];
}

/**
 * Repair the common JSON defects an LLM emits, in a single string-aware pass:
 *   - escape raw control chars (newline/CR/tab) that appear INSIDE a string literal;
 *   - strip line comments (slash-slash) and block comments that appear outside strings;
 *   - drop a trailing comma before a closing `}` or `]`.
 * A quote-tracking scanner keeps every fix from touching string contents (a `,}` inside a value,
 * a `//` inside a URL, etc. are left intact).
 */
export function tryFixJson(jsonStr: string): string {
  const out: string[] = [];
  let inString = false;
  let i = 0;
  while (i < jsonStr.length) {
    const ch = jsonStr[i]!;
    const next = jsonStr[i + 1];
    if (inString) {
      if (ch === '\\' && next !== undefined) {
        out.push(ch, next);
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out.push(ch);
      } else if (ch === '\n') {
        out.push('\\n');
      } else if (ch === '\r') {
        out.push('\\r');
      } else if (ch === '\t') {
        out.push('\\t');
      } else {
        out.push(ch);
      }
      i++;
      continue;
    }
    // Outside a string literal.
    if (ch === '"') {
      inString = true;
      out.push(ch);
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < jsonStr.length && jsonStr[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < jsonStr.length && !(jsonStr[i] === '*' && jsonStr[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '}' || ch === ']') {
      // Remove a trailing comma (and intervening whitespace) already emitted before this closer.
      let j = out.length - 1;
      while (j >= 0 && /^\s$/.test(out[j]!)) j--;
      if (j >= 0 && out[j] === ',') out.splice(j, 1);
    }
    out.push(ch);
    i++;
  }
  return out.join('');
}

/** Normalize any invalid configSchema field type to a valid one (secret -> password, else string). */
function autoFixConfigSchema(config: IntegrationPackageConfig): void {
  if (!config.configSchema) return;
  for (const field of config.configSchema) {
    if (!VALID_CONFIG_TYPES.has(field.type)) {
      field.type = (field.secret ? 'password' : 'string') as IntegrationConfigField['type'];
    }
  }
}

/**
 * Validate a parsed package against the canonical shape + the builder rules. Reusable by the save
 * route to re-check a client-posted package server-side (never trust the client's own validation).
 * Returns the list of problems; an empty list means the package is complete and safe to persist.
 */
export function validateConfig(config: IntegrationPackageConfig, opts: ParseOptions = {}): string[] {
  const errors: string[] = [];

  const key = config.integrationKey;
  if (!key) {
    errors.push('Missing integrationKey');
  } else if (!INTEGRATION_KEY_RE.test(key)) {
    errors.push(`Invalid integrationKey "${key}" — use 2-49 lowercase letters, digits or hyphens, starting with a letter or digit`);
  } else if (opts.reservedKeys && opts.reservedKeys.has(key) && key !== opts.loadedKey) {
    errors.push(`integrationKey "${key}" is reserved — choose a different key`);
  }

  if (!config.displayName) errors.push('Missing displayName');
  if (!config.description) errors.push('Missing description');
  if (!config.authType) errors.push('Missing authType');
  if (!config.provider) errors.push('Missing provider');
  if (!config.category) errors.push('Missing category');

  if (!config.configSchema || config.configSchema.length === 0) {
    errors.push('configSchema is empty — must have at least one field for credentials');
  } else {
    for (const field of config.configSchema) {
      if (!field.key) errors.push('Config field missing key');
      if (!field.label) errors.push(`Config field "${field.key ?? '?'}" missing label`);
      if (!VALID_CONFIG_TYPES.has(field.type)) errors.push(`Config field "${field.key ?? '?'}" has invalid type "${field.type}"`);
    }
  }

  if (!config.actions || config.actions.length === 0) {
    errors.push('No actions defined — must have at least one action');
  } else {
    for (const action of config.actions) {
      if (!action.actionName) errors.push('Action missing actionName');
      if (!action.httpConfig) errors.push(`Action "${action.actionName ?? '?'}" missing httpConfig — required for testing`);
    }
  }

  if (config.authType !== 'none' && !config.credentialGuide?.trim()) {
    errors.push('Missing credentialGuide — must include step-by-step instructions for obtaining credentials');
  }

  return errors;
}

/**
 * Parse the agent's reply into { pkg, skillMd, errors }. No skill-md block yet => still conversing
 * (pkg/skillMd null, no errors). A skill-md block without a parseable config-json => a hard error
 * (pkg null). A parseable config is validated + autofixed and returned even with soft errors, so the
 * UI can surface what is still missing while showing the partial package.
 */
export function parseIntegrationOutput(text: string, opts: ParseOptions = {}): ParseResult {
  const skillMdMatch = text.match(/```skill-md\s*\n([\s\S]*?)```/);
  if (!skillMdMatch) return { pkg: null, skillMd: null, errors: [] }; // no output yet

  const skillMd = skillMdMatch[1]!.trim();

  const configMatch = text.match(/```config-json\s*\n([\s\S]*?)```/);
  if (!configMatch) return { pkg: null, skillMd, errors: ['Missing config-json code block'] };

  let config: IntegrationPackageConfig;
  try {
    config = JSON.parse(tryFixJson(configMatch[1]!.trim())) as IntegrationPackageConfig;
  } catch (err) {
    return { pkg: null, skillMd, errors: [`Invalid config JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }

  // The canonical package shape carries NO proxyContract (§3.8.14); drop it if the model emitted one.
  if (config && typeof config === 'object') {
    delete (config as { proxyContract?: unknown }).proxyContract;
  }

  const errors = validateConfig(config, opts);
  autoFixConfigSchema(config); // normalize any invalid field types the model emitted
  return { pkg: config, skillMd, errors };
}
