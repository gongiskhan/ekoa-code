/**
 * config.ts — the env-derived typed configuration singleton (ch02 §2.6).
 * Loaded once at boot; every other module reads typed values from here instead of
 * touching process.env. Imports nothing but Node builtins (tier 0).
 *
 * Boot validation gates (ch09 §9.7): ENCRYPTION_KEY and JWT_SECRET are mandatory and
 * fail closed. This is the stub for G0; the full store/backend config lands at G2.
 */
import { randomBytes } from 'node:crypto';

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

/** Agent-execution tunables (ch05 §5.4.7). Named config values, never inline literals; every
 *  default carries today's value. Read by `agents/` (timers, turn ceilings, reservation TTL,
 *  the memory-extract kill switch, tool_event truncation). */
export interface AgentsConfig {
  /** 5.3.6 chat run timer. */
  chatRunTimeoutMs: number;
  /** 5.3.6 build inactivity timer (reset on every stream/tool callback). */
  buildInactivityTimeoutMs: number;
  /** 5.3.6 build absolute wall-clock ceiling. */
  buildWallClockMs: number;
  /** 5.3.3 first-build reservation TTL (wall clock + 5 min margin). */
  firstBuildReservationTtlMs: number;
  /** 5.4.4 build maxTurns. */
  maxTurnsBuild: number;
  /** 5.4.4 text/chat/one-shot maxTurns. */
  maxTurnsText: number;
  /** 5.4.2 transient-provider retry backoff. */
  transientRetryBackoffMs: number[];
  /** 5.4.1 agent-face stream-close timeout. */
  agentFaceStreamCloseTimeoutMs: number;
  /** P-12 (5.8) platform kill switch for automatic memory extraction. The per-user
   *  `memory.autoExtract` toggle (default ON) rides user settings and gates independently. */
  memoryAutoExtractEnabled: boolean;
  /** 5.7.1 tool_event result/args truncation length. */
  toolResultTruncateChars: number;
}

export interface Config {
  port: number;
  jwtSecret: string;
  encryptionKey: string;
  nodeEnv: 'development' | 'test' | 'production';
  llmChokepointBaseUrl: string;
  llm: LlmConfig;
  /** Static x-api-key for the machine-to-machine ad-broker endpoint (S1). Optional: unset ⇒
   *  undefined ⇒ the endpoint is fail-closed (every request 401). Optional on the interface so
   *  the suite's many bare-`Config` literals stay valid; `loadConfig` always populates it. */
  adBrokerApiKey?: string;
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
/**
 * Boot-provisioned gateway key (F2): when the operator sets no `LLM_GATEWAY_API_KEY`, the
 * process derives one random key at first config load, so the DEFAULT chokepoint topology
 * (subprocess → local gateway) self-authenticates. The key never leaves the process except
 * into SDK subprocess envs (`buildSubprocessEnv`); external ekoa-local tools still need the
 * operator to set the env var explicitly. Generated once per process; an explicit env var
 * always wins.
 */
let bootGatewayKey: string | undefined;
function provisionedGatewayKey(): string {
  if (!bootGatewayKey) bootGatewayKey = randomBytes(32).toString('hex');
  return bootGatewayKey;
}

export function defaultLlmConfig(): LlmConfig {
  return {
    tiers: {
      FAST: { model: process.env.LLM_MODEL_FAST ?? 'claude-haiku-4-5-20251001', effort: 'low', weight: envFloat('LLM_WEIGHT_FAST', 0.02) },
      // D7 (consumer run): refreshed to the current Sonnet id. Same $3/$15 sticker price as
      // sonnet-4-6, so the tier weight stands (billing re-check 2026-07-11); env overrides win.
      WORKHORSE: { model: process.env.LLM_MODEL_WORKHORSE ?? 'claude-sonnet-5', effort: 'medium', weight: envFloat('LLM_WEIGHT_WORKHORSE', 0.1) },
      EXPERT: { model: process.env.LLM_MODEL_EXPERT ?? 'claude-opus-4-8[1m]', effort: 'high', weight: envFloat('LLM_WEIGHT_EXPERT', 0.4) },
    },
    cacheReadFactor: envFloat('LLM_CACHE_READ_FACTOR', 0.25),
    providerBaseUrl: process.env.LLM_PROVIDER_BASE_URL ?? '',
    gatewayApiKey: process.env.LLM_GATEWAY_API_KEY || provisionedGatewayKey(),
    gatewayEnabled: process.env.LLM_GATEWAY_ENABLED !== 'false',
  };
}

/** Parse a positive integer env override, falling back to `dflt` on unset/invalid. */
function envInt(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : dflt;
}

/** Build the agent-execution config (ch05 §5.4.7) from env. Kept as a standalone memoized
 *  loader (like `defaultLlmConfig`) rather than a field on `Config`, so the many bare-`Config`
 *  literals in the suite stay valid; `agents/` reads it via `loadAgentsConfig()`. */
export function defaultAgentsConfig(): AgentsConfig {
  return {
    chatRunTimeoutMs: envInt('CHAT_RUN_TIMEOUT_MS', 300_000),
    buildInactivityTimeoutMs: envInt('BUILD_INACTIVITY_TIMEOUT_MS', 300_000),
    buildWallClockMs: envInt('BUILD_WALL_CLOCK_MS', 2_400_000),
    firstBuildReservationTtlMs: envInt('FIRST_BUILD_RESERVATION_TTL_MS', 2_700_000),
    maxTurnsBuild: envInt('MAX_TURNS_BUILD', 100),
    maxTurnsText: envInt('MAX_TURNS_TEXT', 30),
    transientRetryBackoffMs: [envInt('TRANSIENT_RETRY_BACKOFF_MS_1', 5_000), envInt('TRANSIENT_RETRY_BACKOFF_MS_2', 15_000)],
    agentFaceStreamCloseTimeoutMs: envInt('AGENT_FACE_STREAM_CLOSE_TIMEOUT_MS', 180_000),
    memoryAutoExtractEnabled: process.env.MEMORY_AUTO_EXTRACT_ENABLED !== 'false',
    toolResultTruncateChars: envInt('TOOL_RESULT_TRUNCATE_CHARS', 200),
  };
}

let cachedAgents: AgentsConfig | undefined;
export function loadAgentsConfig(): AgentsConfig {
  if (!cachedAgents) cachedAgents = defaultAgentsConfig();
  return cachedAgents;
}
export function __resetAgentsConfigForTests(): void {
  cachedAgents = undefined;
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
    adBrokerApiKey: process.env.AD_BROKER_API_KEY || undefined,
  };
  return cached;
}

/** Test helper: reset the memoized config (never used in production paths). */
export function __resetConfigForTests(): void {
  cached = undefined;
}
