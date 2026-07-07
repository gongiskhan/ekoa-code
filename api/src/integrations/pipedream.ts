/**
 * Pipedream Connect layer (ch03 §3.8.16; carryover-audit B23) — the "ligações externas
 * alargadas" surface: for services with no native integration, Pipedream Connect exposes
 * thousands of connectors behind one credential boundary. A thin, governed REST client — all
 * business logic here, the router only dispatches.
 *
 * Security posture:
 *   - The project keys (client_id / client_secret / project_id) live in ONE org-scoped,
 *     encrypted `integrationConfigs` row (Amendment 2: org custody). Decrypted just-in-time,
 *     never logged/thrown/returned.
 *   - Every action run is gated by (a) the platform master toggle (settings.integration
 *     .pipedreamEnabled, read from the global singleton) and (b) the pre-run billing allowance,
 *     then metered against the owner's account whatever the outcome.
 *   - All external I/O goes through the injectable transport, whose production default is the
 *     SSRF-guarded fetcher — a misconfigured private base URL is refused. Tests inject a fake
 *     transport (the guarded fetcher would block a 127.0.0.1 mock, by design).
 */

import { integrationConfigs, settings } from '../data/stores.js';
import { encrypt, decrypt } from '../data/crypto.js';
import { guardedFetch } from '../services/url-fetcher.js';
import { SsrfError } from '../services/url-safety.js';
import { checkAllowance, recordTokenEvent } from '../billing/index.js';
import { PIPEDREAM_INTEGRATION_KEY, type IntegrationConfigDoc } from './service.js';
import type { Actor } from '@ekoa/shared';

const DEFAULT_BASE_URL = 'https://api.pipedream.com';
/** Fixed synthetic token count metered per Pipedream action run (platform-attributed). */
const PIPEDREAM_TOKENS_PER_CALL = 1_000;

// PT-PT copy — never leaks credentials or provider bodies.
const MSG_DISABLED = 'As ligações externas através da rede Pipedream estão desativadas.';
const MSG_CAPPED = 'Limite de utilização atingido. Contacte o administrador.';
const MSG_NOT_CONFIGURED = 'A Pipedream ainda não está configurada.';

/** Injectable transport seam — tests point this at a local mock server. */
export interface PipedreamDeps {
  fetchImpl?: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;
  baseUrl?: string;
  now?: () => number;
}

export type PipedreamResultCode = 'disabled' | 'billing_capped' | 'not_configured' | 'client_4xx' | 'rate_limited' | 'transient_5xx' | 'transport_error' | 'unknown';

export interface PipedreamRunResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  code?: PipedreamResultCode;
}

export interface PipedreamAccount {
  id: string;
  name?: string;
  app?: string;
  healthy?: boolean;
}

export interface PipedreamStatus {
  configured: boolean;
  enabled: boolean;
  accountCount: number;
}

export interface ConnectToken {
  token: string;
  connectLinkUrl: string;
  expiresAt: string;
}

interface PipedreamConfig {
  clientId: string;
  clientSecret: string;
  projectId: string;
  environment: string;
}

// --- module-level client-credentials token cache (short-lived, per config) ---
interface CachedToken {
  accessToken: string;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedToken>();

/** Test hook: clear the token cache. */
export function resetPipedreamCaches(): void {
  tokenCache.clear();
}

// ============================================================================
// Config + toggle (org-scoped)
// ============================================================================

function configRowId(orgId: string): string {
  return `pipedream-${orgId}`;
}

async function loadPipedreamConfig(orgId: string): Promise<PipedreamConfig | null> {
  const row = (await integrationConfigs.get(configRowId(orgId))) as IntegrationConfigDoc | null;
  if (!row || row.orgId !== orgId || row.integrationKey !== PIPEDREAM_INTEGRATION_KEY || !row.enabled || !row.credentialsCiphertext) {
    return null;
  }
  try {
    const creds = JSON.parse(decrypt(row.credentialsCiphertext)) as Record<string, unknown>;
    if (!creds.clientId || !creds.clientSecret || !creds.projectId) return null;
    return {
      clientId: String(creds.clientId),
      clientSecret: String(creds.clientSecret),
      projectId: String(creds.projectId),
      environment: String(creds.environment ?? 'production'),
    };
  } catch {
    return null; // undecryptable / malformed → not configured; never surface why
  }
}

/** Platform master toggle from the global settings singleton (like billing.globalOverageEnabled).
 *  undefined/true = ON; explicit false = OFF. Fails ON when settings are unreadable. */
async function isPipedreamEnabled(): Promise<boolean> {
  try {
    const s = (await settings.get('default')) as { integration?: { pipedreamEnabled?: boolean } } | null;
    return s?.integration?.pipedreamEnabled !== false;
  } catch {
    return true;
  }
}

export async function getPipedreamStatus(actor: Actor, deps: PipedreamDeps = {}): Promise<PipedreamStatus> {
  const cfg = await loadPipedreamConfig(actor.orgId);
  const configured = !!cfg;
  const enabled = await isPipedreamEnabled();
  let accountCount = 0;
  if (configured && enabled) {
    try {
      accountCount = (await listConnectedAccounts(actor, deps)).length;
    } catch {
      accountCount = 0; // status must never fail on a provider hiccup
    }
  }
  return { configured, enabled, accountCount };
}

/** Upsert the org's Pipedream config (org-admin). Credentials encrypted at rest. */
export async function savePipedreamConfig(
  actor: Actor,
  input: { clientId: string; clientSecret: string; projectId: string; environment?: string },
): Promise<{ id: string; configured: boolean }> {
  const environment = input.environment || 'production';
  const ciphertext = encrypt(JSON.stringify({ clientId: input.clientId, clientSecret: input.clientSecret, projectId: input.projectId, environment }));
  const id = configRowId(actor.orgId);
  const existing = (await integrationConfigs.get(id)) as IntegrationConfigDoc | null;
  if (existing && existing.orgId === actor.orgId) {
    await integrationConfigs.update(id, (cur) => ({ ...cur, credentialsCiphertext: ciphertext, enabled: true }));
  } else {
    const doc: IntegrationConfigDoc = {
      _id: id,
      orgId: actor.orgId,
      ownerUserId: undefined, // org-scoped (Amendment 2)
      integrationKey: PIPEDREAM_INTEGRATION_KEY,
      name: 'Pipedream Connect',
      enabled: true,
      credentialsCiphertext: ciphertext,
    };
    await integrationConfigs.insert(doc as never);
  }
  resetPipedreamCaches();
  return { id, configured: true };
}

/** Remove the org's Pipedream config (org-admin). */
export async function removePipedreamConfig(actor: Actor): Promise<{ ok: true }> {
  const id = configRowId(actor.orgId);
  const existing = (await integrationConfigs.get(id)) as IntegrationConfigDoc | null;
  if (existing && existing.orgId === actor.orgId) await integrationConfigs.delete(id);
  resetPipedreamCaches();
  return { ok: true };
}

// ============================================================================
// Connect link + account management (per external user = the calling user)
// ============================================================================

export async function getConnectToken(actor: Actor, deps: PipedreamDeps = {}): Promise<ConnectToken> {
  const cfg = await requireConfig(actor.orgId);
  const bearer = await getAccessToken(cfg, deps);
  const res = await doFetch(deps, `${baseUrl(deps)}/v1/connect/${enc(cfg.projectId)}/tokens`, {
    method: 'POST',
    headers: authJsonHeaders(bearer),
    body: JSON.stringify({ external_user_id: actor.userId }),
  });
  if (!res.ok) throw new Error(`Não foi possível criar a ligação Pipedream (${res.status}).`);
  const json = (await res.json()) as Record<string, unknown>;
  return {
    token: String(json.token ?? ''),
    connectLinkUrl: String(json.connect_link_url ?? json.connectLinkUrl ?? ''),
    expiresAt: String(json.expires_at ?? json.expiresAt ?? new Date((deps.now ?? Date.now)()).toISOString()),
  };
}

export async function listConnectedAccounts(actor: Actor, deps: PipedreamDeps = {}): Promise<PipedreamAccount[]> {
  const cfg = await loadPipedreamConfig(actor.orgId);
  if (!cfg) return [];
  const bearer = await getAccessToken(cfg, deps);
  const url = new URL(`${baseUrl(deps)}/v1/connect/${enc(cfg.projectId)}/accounts`);
  url.searchParams.set('external_user_id', actor.userId);
  const res = await doFetch(deps, url.toString(), { headers: { Authorization: `Bearer ${bearer}` } });
  if (!res.ok) throw new Error(`Não foi possível listar as ligações Pipedream (${res.status}).`);
  const json = (await res.json()) as unknown;
  const raw = Array.isArray(json) ? json : Array.isArray((json as Record<string, unknown>)?.data) ? ((json as Record<string, unknown>).data as unknown[]) : [];
  return raw.map(normalizeAccount);
}

export async function disconnectAccount(actor: Actor, accountId: string, deps: PipedreamDeps = {}): Promise<{ ok: true }> {
  const cfg = await loadPipedreamConfig(actor.orgId);
  if (!cfg) return { ok: true };
  const bearer = await getAccessToken(cfg, deps);
  const url = new URL(`${baseUrl(deps)}/v1/connect/${enc(cfg.projectId)}/accounts/${enc(accountId)}`);
  url.searchParams.set('external_user_id', actor.userId);
  await doFetch(deps, url.toString(), { method: 'DELETE', headers: { Authorization: `Bearer ${bearer}` } });
  return { ok: true };
}

// ============================================================================
// Action run — the gated + metered hot path (not a REST route; agent/automation path)
// ============================================================================

export interface RunPipedreamActionInput {
  actor: Actor;
  app: string; // connected app slug (drives the billing agentType)
  actionKey: string; // Pipedream component/action key
  args?: Record<string, unknown>;
}

export async function runPipedreamAction(input: RunPipedreamActionInput, deps: PipedreamDeps = {}): Promise<PipedreamRunResult> {
  if (!(await isPipedreamEnabled())) return { success: false, code: 'disabled', error: MSG_DISABLED };

  const allowance = await checkAllowance(input.actor.userId, deps.now?.());
  if (!allowance.ok) return { success: false, code: 'billing_capped', error: MSG_CAPPED };

  const cfg = await loadPipedreamConfig(input.actor.orgId);
  if (!cfg) return { success: false, code: 'not_configured', error: MSG_NOT_CONFIGURED };

  let result: PipedreamRunResult;
  try {
    const bearer = await getAccessToken(cfg, deps);
    const res = await doFetch(deps, `${baseUrl(deps)}/v1/connect/${enc(cfg.projectId)}/actions/run`, {
      method: 'POST',
      headers: { ...authJsonHeaders(bearer), 'X-PD-Environment': cfg.environment },
      body: JSON.stringify({ external_user_id: input.actor.userId, id: input.actionKey, configured_props: input.args ?? {} }),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    result = res.ok
      ? { success: true, status: res.status, data }
      : { success: false, status: res.status, code: classifyStatus(res.status), error: `A ação Pipedream falhou (${res.status}).` };
  } catch (err) {
    // Never surface the raw reason (could carry the project id / an SSRF-refused URL).
    result = { success: false, code: 'transport_error', error: err instanceof SsrfError ? 'Pedido bloqueado por segurança.' : 'Não foi possível contactar a Pipedream.' };
  }

  // Meter the attempt (whatever the outcome). Metering must never fail the attempt.
  try {
    await recordTokenEvent({
      billeeUserId: input.actor.userId,
      attributionKind: 'platform',
      agentType: `pipedream:${input.app}:${input.actionKey}`,
      model: 'pipedream',
      tier: 'FAST',
      raw: { input: PIPEDREAM_TOKENS_PER_CALL, output: 0, cacheCreate: 0, cacheRead: 0 },
      now: deps.now?.(),
    });
  } catch {
    /* metering never turns a completed attempt into a failure */
  }
  return result;
}

// ============================================================================
// Internals — token, fetch, mapping
// ============================================================================

async function requireConfig(orgId: string): Promise<PipedreamConfig> {
  const cfg = await loadPipedreamConfig(orgId);
  if (!cfg) throw new Error(MSG_NOT_CONFIGURED);
  return cfg;
}

function baseUrl(deps: PipedreamDeps): string {
  return (deps.baseUrl || process.env.PIPEDREAM_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, '');
}
function enc(v: string): string {
  return encodeURIComponent(v);
}
function authJsonHeaders(bearer: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` };
}

/** Default transport = the SSRF-guarded fetcher; injectable for tests. */
function doFetch(deps: PipedreamDeps, url: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response> {
  const impl = deps.fetchImpl ?? ((u: string, o: { method?: string; headers?: Record<string, string>; body?: string }) => guardedFetch(u, { timeoutMs: 15_000, ...o }));
  return impl(url, init);
}

/** Client-credentials bearer, cached per (client_id, project_id) until ~30s before expiry.
 *  Never logs/throws the client_secret or the response body. */
async function getAccessToken(cfg: PipedreamConfig, deps: PipedreamDeps): Promise<string> {
  const now = (deps.now ?? Date.now)();
  const cacheKey = `${cfg.clientId}:${cfg.projectId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now + 30_000) return cached.accessToken;

  const res = await doFetch(deps, `${baseUrl(deps)}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }),
  });
  if (!res.ok) throw new Error(`Falha na autenticação com a Pipedream (${res.status}).`);
  const json = (await res.json()) as Record<string, unknown>;
  const accessToken = String(json.access_token ?? '');
  if (!accessToken) throw new Error('Resposta de autenticação da Pipedream inválida.');
  const expiresIn = Number(json.expires_in ?? 3600);
  tokenCache.set(cacheKey, { accessToken, expiresAt: now + expiresIn * 1000 });
  return accessToken;
}

function classifyStatus(status: number): PipedreamResultCode {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'transient_5xx';
  if (status >= 400) return 'client_4xx';
  return 'unknown';
}

/** Map a raw account object to a UI-safe shape — never carries tokens/secrets. */
function normalizeAccount(raw: unknown): PipedreamAccount {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const appField = a.app;
  const app =
    typeof appField === 'string'
      ? appField
      : appField && typeof appField === 'object'
        ? String((appField as Record<string, unknown>).name_slug ?? (appField as Record<string, unknown>).name ?? '')
        : '';
  return {
    id: String(a.id ?? ''),
    app: app || undefined,
    name: String(a.name ?? a.external_id ?? '') || undefined,
    healthy: a.healthy === undefined ? true : Boolean(a.healthy),
  };
}
