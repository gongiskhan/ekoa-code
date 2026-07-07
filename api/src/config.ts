/**
 * config.ts — the env-derived typed configuration singleton (ch02 §2.6).
 * Loaded once at boot; every other module reads typed values from here instead of
 * touching process.env. Imports nothing (tier 0).
 *
 * Boot validation gates (ch09 §9.7): ENCRYPTION_KEY and JWT_SECRET are mandatory and
 * fail closed. This is the stub for G0; the full store/backend config lands at G2.
 */

/** Per-tier model routing config (ch06 §6.2.3). Model ids + billing weights live here,
 *  env-overridable, and NOWHERE else outside api/src/llm/. Tier configs carry `effort`
 *  ONLY — the old per-tier thinking budgets were dead on the wire (ch06 conflict 5) and
 *  are not carried. */
export interface LlmTierConfig {
  model: string;
  effort: 'low' | 'medium' | 'high';
  /** Billing weight snapshotted onto every ledger event (ch06 §6.5.2). */
  weight: number;
}

export interface LlmConfig {
  tiers: { FAST: LlmTierConfig; WORKHORSE: LlmTierConfig; EXPERT: LlmTierConfig };
  /** Cache-read discount factor in the metering formula (ch06 §6.5.2), default 0.25. */
  cacheReadFactor: number;
  /** Provider base URL for the direct Messages REST transport + gateway forward.
   *  Empty string => the built-in default resolved INSIDE api/src/llm/ (the provider host
   *  literal must stay out of config.ts to satisfy the FIXED-13 chokepoint grep gate). */
  providerBaseUrl: string;
  /** ekoa-local gateway static key (X-API-Key); undefined => JWT-only gateway auth. */
  gatewayApiKey: string | undefined;
  /** ekoa-local gateway mount toggle (ch03 §3.10); default on. */
  gatewayEnabled: boolean;
}

export interface Config {
  port: number;
  jwtSecret: string;
  encryptionKey: string;
  nodeEnv: 'development' | 'test' | 'production';
  llmChokepointBaseUrl: string;
  llm: LlmConfig;
}

/** Parse a positive float env override, falling back to `dflt` on unset/invalid. */
function envFloat(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

/** Build the LLM routing config from env (ch06 §6.2.3). Exported so tests that construct a
 *  bare `Config` literal share the one source of tier/model/weight truth. */
export function defaultLlmConfig(): LlmConfig {
  return {
    tiers: {
      FAST: { model: process.env.LLM_MODEL_FAST ?? 'claude-haiku-4-5-20251001', effort: 'low', weight: envFloat('LLM_WEIGHT_FAST', 0.02) },
      WORKHORSE: { model: process.env.LLM_MODEL_WORKHORSE ?? 'claude-sonnet-4-6', effort: 'medium', weight: envFloat('LLM_WEIGHT_WORKHORSE', 0.1) },
      EXPERT: { model: process.env.LLM_MODEL_EXPERT ?? 'claude-opus-4-8[1m]', effort: 'high', weight: envFloat('LLM_WEIGHT_EXPERT', 0.4) },
    },
    cacheReadFactor: envFloat('LLM_CACHE_READ_FACTOR', 0.25),
    providerBaseUrl: process.env.LLM_PROVIDER_BASE_URL ?? '',
    gatewayApiKey: process.env.LLM_GATEWAY_API_KEY || undefined,
    gatewayEnabled: process.env.LLM_GATEWAY_ENABLED !== 'false',
  };
}

class ConfigError extends Error {}

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return v;
}

/** Parse PORT, treating set-but-empty and non-numeric as "use the default" rather than
 *  silently binding port 0 (ephemeral) or throwing at listen on NaN. */
function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 4111;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new ConfigError(`Invalid PORT: ${JSON.stringify(raw)}`);
  }
  return n;
}

let cached: Config | undefined;

/** Build (and validate) the config singleton. Throws on a missing mandatory key. */
export function loadConfig(): Config {
  if (cached) return cached;
  const nodeEnv = (process.env.NODE_ENV as Config['nodeEnv']) ?? 'development';
  cached = {
    port: parsePort(process.env.PORT),
    jwtSecret: required('JWT_SECRET'),
    encryptionKey: required('ENCRYPTION_KEY'),
    nodeEnv,
    llmChokepointBaseUrl: process.env.LLM_CHOKEPOINT_BASE_URL ?? 'http://127.0.0.1:4111/api/v1/llm',
    llm: defaultLlmConfig(),
  };
  return cached;
}

/** Test helper: reset the memoized config (never used in production paths). */
export function __resetConfigForTests(): void {
  cached = undefined;
}
