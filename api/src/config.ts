/**
 * config.ts — the env-derived typed configuration singleton (ch02 §2.6).
 * Loaded once at boot; every other module reads typed values from here instead of
 * touching process.env. Imports nothing (tier 0).
 *
 * Boot validation gates (ch09 §9.7): ENCRYPTION_KEY and JWT_SECRET are mandatory and
 * fail closed. This is the stub for G0; the full store/backend config lands at G2.
 */

export interface Config {
  port: number;
  jwtSecret: string;
  encryptionKey: string;
  nodeEnv: 'development' | 'test' | 'production';
  llmChokepointBaseUrl: string;
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
  };
  return cached;
}

/** Test helper: reset the memoized config (never used in production paths). */
export function __resetConfigForTests(): void {
  cached = undefined;
}
