/**
 * llm/credentials.ts — central model-credential custody (ch06 §6.2, §6.2.4; FIXED-8 as
 * amended by Amendment 2). One credential per environment, held in the `credentials`
 * Mongo singleton (`_id: 'default'`), AES-encrypted at rest through the one crypto
 * module (ch04 §4.7). Two per-environment auth modes:
 *   - `oauth`   — subscription OAuth token, proactively refreshed before expiry; injected to
 *                 the SDK subprocess as `CLAUDE_CODE_OAUTH_TOKEN`.
 *   - `api-key` — Anthropic API key; injected as `ANTHROPIC_API_KEY`.
 *
 * Simplified semantics (§6.2.4): proactive refresh before expiry (oauth), refresh-and-retry
 * once on 401, and a single LATCHED alert on persistent failure that records
 * `lastRefreshError` and flips `GET /health` `claudeAuth.ok` to false — the external-watchdog
 * contract, carried verbatim. DELETED from the old design: credential pools, multi-subscription
 * rollover, rotation mutex / persist-first / peer-adoption, health scoring, selection logic,
 * per-installation rows, and the 20-minute watchdog (reduced to this one latched alert).
 */
import { loadConfig } from '../config.js';
import { credentials as credentialsStore } from '../data/stores.js';
import { encrypt, decrypt } from '../data/crypto.js';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';

const SINGLETON_ID = 'default';
/** Refresh proactively when the token is within this window of expiry (oauth mode). */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Provider env vars scrubbed from every SDK subprocess before the configured credential is
 *  injected — no inherited provider auth or base URL may leak past the chokepoint (§6.2,
 *  FIXED-13). */
const SCRUBBED_PROVIDER_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTH_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
];

export type CredentialMode = 'oauth' | 'api-key';

/** The decrypted credential blob (the plaintext stored in `credentialCiphertext`). */
export interface DecryptedCredential {
  mode: CredentialMode;
  /** oauth: the OAuth access token; api-key: the API key. */
  secret: string;
  /** oauth only: the refresh token, used by the refresh seam. */
  refreshToken?: string;
  /** oauth only: epoch ms at which `secret` expires. */
  expiresAt?: number;
}

/** The `claudeAuth` health field shape (ch03 §3.8.23; the external-watchdog contract). */
export interface ClaudeAuthStatus {
  ok: boolean;
  configured: boolean;
  mode?: CredentialMode;
  lastRefreshError?: string;
}

/**
 * The token-refresh seam. Given the current credential, returns a fresh secret + expiry.
 * Overridable for tests; the default performs the OAuth refresh against a configured token
 * endpoint (`LLM_OAUTH_REFRESH_URL`). When unset it fails closed — which latches the alert,
 * the correct fail-closed posture until an operator configures refresh.
 */
export type RefreshFn = (cred: DecryptedCredential) => Promise<{ secret: string; expiresAt?: number; refreshToken?: string }>;

async function defaultRefresh(cred: DecryptedCredential): Promise<{ secret: string; expiresAt?: number; refreshToken?: string }> {
  const url = process.env.LLM_OAUTH_REFRESH_URL;
  if (!url || !cred.refreshToken) {
    throw new Error('OAuth refresh not configured (LLM_OAUTH_REFRESH_URL + stored refresh token required)');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: cred.refreshToken }),
  });
  if (!res.ok) throw new Error(`OAuth refresh failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!body.access_token) throw new Error('OAuth refresh response missing access_token');
  return {
    secret: body.access_token,
    expiresAt: body.expires_in ? now() + body.expires_in * 1000 : undefined,
    refreshToken: body.refresh_token ?? cred.refreshToken,
  };
}

// --- Injectable seams (tests only) -------------------------------------------------------

let refreshFn: RefreshFn = defaultRefresh;
let nowFn: () => number = () => Date.now();
function now(): number {
  return nowFn();
}

export function __setRefreshFnForTests(fn: RefreshFn): void {
  refreshFn = fn;
}
export function __setNowForTests(fn: () => number): void {
  nowFn = fn;
}

// --- In-memory custody state -------------------------------------------------------------

let cached: DecryptedCredential | null = null;
let loaded = false;
let lastRefreshError: string | null = null;
let alertLatched = false;

export function __resetCredentialsForTests(): void {
  cached = null;
  loaded = false;
  lastRefreshError = null;
  alertLatched = false;
  refreshFn = defaultRefresh;
  nowFn = () => Date.now();
}

/** Read + decrypt the singleton credential into memory (idempotent). Absent row => unconfigured. */
export async function loadCredential(): Promise<void> {
  const row = await credentialsStore.get(SINGLETON_ID);
  loaded = true;
  if (!row || !row.credentialCiphertext) {
    cached = null;
    return;
  }
  try {
    cached = JSON.parse(decrypt(row.credentialCiphertext)) as DecryptedCredential;
    if (cached.mode !== row.mode) cached.mode = row.mode; // the doc's mode is authoritative
  } catch (err) {
    cached = null;
    latchAlert(`credential decrypt failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Persist a credential (test/admin seam): encrypts the blob into the singleton. */
export async function setCredential(cred: DecryptedCredential): Promise<void> {
  const row = (await credentialsStore.get(SINGLETON_ID)) ?? { _id: SINGLETON_ID, mode: cred.mode };
  await credentialsStore.put({
    ...row,
    _id: SINGLETON_ID,
    mode: cred.mode,
    credentialCiphertext: encrypt(JSON.stringify(cred)),
    refreshMeta: { expiresAt: cred.expiresAt ?? null },
  });
  cached = cred;
  loaded = true;
  lastRefreshError = null;
  alertLatched = false;
}

/**
 * The HTTP provisioning path (F2): persist the credential AND write the `credential.set`
 * audit row through the single Registo write path. Secret material never reaches the log —
 * only the mode and whether a refresh token was supplied.
 */
export async function provisionCredential(
  cred: DecryptedCredential,
  actor: ActivityActor,
  deps: LogActivityDeps,
): Promise<void> {
  await setCredential(cred);
  await logActivity(actor, 'credential', 'set', deps, {
    mode: cred.mode,
    hasRefreshToken: cred.refreshToken !== undefined,
    expiresAt: cred.expiresAt ?? null,
  });
}

function latchAlert(message: string): void {
  lastRefreshError = message;
  if (!alertLatched) {
    alertLatched = true;
    console.error(`[llm][claudeAuth] credential alert latched: ${message}`);
  }
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await loadCredential();
}

/** Persist the refreshed secret back into the singleton (so a restart resumes with it). */
async function persistRefreshed(cred: DecryptedCredential): Promise<void> {
  cached = cred;
  const row = (await credentialsStore.get(SINGLETON_ID)) ?? { _id: SINGLETON_ID, mode: cred.mode };
  await credentialsStore.put({
    ...row,
    _id: SINGLETON_ID,
    mode: cred.mode,
    credentialCiphertext: encrypt(JSON.stringify(cred)),
    refreshMeta: { expiresAt: cred.expiresAt ?? null },
  });
}

async function doRefresh(cred: DecryptedCredential): Promise<string> {
  const next = await refreshFn(cred);
  const updated: DecryptedCredential = {
    ...cred,
    secret: next.secret,
    expiresAt: next.expiresAt,
    refreshToken: next.refreshToken ?? cred.refreshToken,
  };
  await persistRefreshed(updated);
  lastRefreshError = null;
  alertLatched = false;
  return updated.secret;
}

/**
 * Return the current secret to authenticate with. In oauth mode, proactively refresh when
 * within `REFRESH_MARGIN_MS` of expiry. On refresh failure the alert latches and the last
 * still-valid secret is returned if present; if none, the failure propagates.
 */
export async function getSecret(): Promise<string> {
  await ensureLoaded();
  if (!cached) throw new Error('No model credential configured for this environment (ch06 §6.2).');

  if (cached.mode === 'oauth' && cached.expiresAt !== undefined && now() >= cached.expiresAt - REFRESH_MARGIN_MS) {
    try {
      return await doRefresh(cached);
    } catch (err) {
      latchAlert(`proactive refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      if (cached.expiresAt !== undefined && now() >= cached.expiresAt) throw err; // hard-expired, no valid token
      return cached.secret; // still-valid window remains
    }
  }
  return cached.secret;
}

/**
 * Force one refresh and return the new secret — the refresh-and-retry-once path a 401 takes
 * (§6.2.1 completeFast, §6.2.4). Latches the alert on failure and rethrows.
 */
export async function forceRefresh(): Promise<string> {
  await ensureLoaded();
  if (!cached) throw new Error('No model credential configured for this environment (ch06 §6.2).');
  if (cached.mode !== 'oauth') {
    // api-key mode cannot refresh; a 401 is terminal.
    latchAlert('api-key rejected (401) — no refresh possible in api-key mode');
    throw new Error('api-key credential rejected (401)');
  }
  try {
    return await doRefresh(cached);
  } catch (err) {
    latchAlert(`forced refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/** The current `claudeAuth` health field (ch03 §3.8.23). `ok` is false whenever a refresh
 *  alert is latched OR no credential is configured — the external-watchdog contract. */
export function claudeAuthStatus(): ClaudeAuthStatus {
  const configured = cached !== null;
  const status: ClaudeAuthStatus = {
    ok: configured && lastRefreshError === null,
    configured,
  };
  if (cached) status.mode = cached.mode;
  if (lastRefreshError) status.lastRefreshError = lastRefreshError;
  return status;
}

/** Per-run environment shaping options (ch05 §5.4.1). */
export interface SubprocessEnvOptions {
  /** Build runs set `HOME = projectDir`, confining `~` expansion to the sandbox (§5.4.1). */
  homeDir?: string;
  /** Agent-face runs raise `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` (§5.4.1, default 180 000 ms). */
  streamCloseTimeoutMs?: number;
}

/** True when the chokepoint base URL is this server's own local gateway (loopback host) —
 *  the DEFAULT topology (`LLM_CHOKEPOINT_BASE_URL` unset resolves to 127.0.0.1). */
function isLocalGatewayChokepoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Build the SDK subprocess env: start from a scrubbed clone of the inherited env (no provider
 * auth/base-url leaks) and point the subprocess at the chokepoint via `ANTHROPIC_BASE_URL`
 * (ch05 §5.4.1; FIXED-13). The credential the subprocess presents depends on the topology (F2):
 *   - DEFAULT (chokepoint = the local gateway): inject the boot-provisioned GATEWAY key as
 *     `ANTHROPIC_API_KEY` — the gateway authenticates that principal and re-injects the real
 *     model credential upstream itself (client.proxyGatewayMessages), so the model secret
 *     never enters the subprocess env.
 *   - EXPLICIT external chokepoint (the sanctioned dev/direct posture): inject the configured
 *     model credential (`CLAUDE_CODE_OAUTH_TOKEN` for oauth, `ANTHROPIC_API_KEY` for api-key).
 * Additionally (§5.4.1): `CLAUDECODE` is deleted (prevents nested-session detection),
 * `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS='1'` is set, build runs get `HOME = projectDir`,
 * and agent-face runs raise the stream-close timeout.
 */
export async function buildSubprocessEnv(opts: SubprocessEnvOptions = {}): Promise<Record<string, string>> {
  const secret = await getSecret();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SCRUBBED_PROVIDER_ENV.includes(k)) continue;
    if (k === 'CLAUDECODE') continue; // deleted: prevents nested-session detection (§5.4.1)
    env[k] = v;
  }
  const cfg = loadConfig();
  const mode = cached!.mode;
  if (isLocalGatewayChokepoint(cfg.llmChokepointBaseUrl) && cfg.llm.gatewayApiKey) {
    // Default topology: present the gateway principal; the model secret stays server-side.
    env.ANTHROPIC_API_KEY = cfg.llm.gatewayApiKey;
  } else if (mode === 'oauth') {
    env.CLAUDE_CODE_OAUTH_TOKEN = secret;
  } else {
    env.ANTHROPIC_API_KEY = secret;
  }
  env.ANTHROPIC_BASE_URL = cfg.llmChokepointBaseUrl;
  env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1';
  if (opts.homeDir) env.HOME = opts.homeDir;
  if (opts.streamCloseTimeoutMs !== undefined) env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = String(opts.streamCloseTimeoutMs);
  return env;
}

/** The current mode, or null when unconfigured (used by the direct-REST transport). */
export async function currentMode(): Promise<CredentialMode | null> {
  await ensureLoaded();
  return cached?.mode ?? null;
}
