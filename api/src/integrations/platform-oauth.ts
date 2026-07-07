/**
 * Platform OAuth (ch03 §3.8.15) — managed workspace connections for Google Workspace and
 * Microsoft 365. Three concerns, one module:
 *
 *   1. Provider protocol — authorize-URL builders, authorization-code exchange, token refresh,
 *      and the userinfo lookup, for `google` and `microsoft`.
 *   2. Token custody — the encrypted-at-rest OAuth token bundle lives on an org-scoped row in
 *      the `integrationConfigs` store; `getValidPlatformTokens` decrypts, refreshes-on-expiry,
 *      and re-persists (singleflight per row so a rotating refresh_token is never double-spent).
 *   3. Service operations — connect / callback / status / disconnect / list, org-scoped
 *      (Amendment 2: the workspace connection is org custody; connect/disconnect are org-admin).
 *
 * Egress: every provider call goes through the injectable `PlatformHttp` seam, whose production
 * default is the SSRF-guarded fetcher (services/url-fetcher). Credentials are encrypted via the
 * one crypto module (data/crypto) and NEVER returned to a client or written to a log.
 *
 * The OAuth callback path `GET /api/v1/oauth/:provider/callback` is a registered redirect URI in
 * the provider consoles and is kept verbatim — the CSRF `state` is a high-entropy nonce stored on
 * the row at connect time and matched (with a TTL) at callback time; an absent/expired/mismatched
 * state is refused.
 */

import { randomUUID } from 'node:crypto';
import { integrationConfigs } from '../data/stores.js';
import { encrypt, decrypt } from '../data/crypto.js';
import { logActivity, type ActivityActor } from '../data/activity.js';
import { guardedFetch } from '../services/url-fetcher.js';
import type { Actor } from '@ekoa/shared';
import type { IntegrationConfigDoc } from './service.js';

// ============================================================================
// Types
// ============================================================================

export type PlatformProvider = 'google' | 'microsoft';
export const PLATFORM_PROVIDERS: readonly PlatformProvider[] = ['google', 'microsoft'];

/** The stored (encrypted) token bundle. */
export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: string; // ISO
  scope: string;
  email?: string;
  provider: PlatformProvider;
}

/** Per-provider client credentials + redirect base. Injected (default reads env) so tests never
 *  need real client secrets and never touch a live provider. */
export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  /** Origin the redirect URI is built against, e.g. `https://app.ekoa.pt`. */
  redirectBaseUrl: string;
  /** Microsoft only: tenant segment of the authorize/token endpoints (default `common`). */
  tenantId?: string;
}
export type PlatformOAuthEnv = Record<PlatformProvider, OAuthProviderConfig>;

/** Injectable HTTP seam. Production default = the SSRF-guarded fetcher. */
export type PlatformHttp = (
  url: string,
  opts?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number },
) => Promise<Response>;

const defaultHttp: PlatformHttp = (url, opts = {}) => guardedFetch(url, { timeoutMs: 30_000, ...opts });

export interface OAuthDeps {
  now: () => number;
  genId: () => string;
  http?: PlatformHttp;
  env?: PlatformOAuthEnv;
}

/** Read provider client credentials from env (mirrors config.ts env-helper convention; the
 *  definitions registry reads EKOA_INTEGRATIONS_DIR the same way). Overridable via OAuthDeps.env
 *  so tests inject fakes. */
export function loadPlatformOAuthEnv(): PlatformOAuthEnv {
  const redirectBaseUrl = process.env.OAUTH_REDIRECT_BASE_URL ?? '';
  return {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirectBaseUrl,
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
      redirectBaseUrl,
      tenantId: process.env.MICROSOFT_TENANT_ID ?? 'common',
    },
  };
}

function envOf(deps: OAuthDeps): PlatformOAuthEnv {
  return deps.env ?? loadPlatformOAuthEnv();
}
function httpOf(deps: OAuthDeps): PlatformHttp {
  return deps.http ?? defaultHttp;
}

/** How long a pending OAuth `state` is valid (connect → callback). */
const STATE_TTL_MS = 10 * 60 * 1000;

function isProvider(v: unknown): v is PlatformProvider {
  return v === 'google' || v === 'microsoft';
}
function assertProvider(v: unknown): PlatformProvider {
  if (!isProvider(v)) throw new Error(`invalid provider: ${String(v)}`);
  return v;
}

function redirectUri(cfg: OAuthProviderConfig, provider: PlatformProvider): string {
  return `${cfg.redirectBaseUrl.replace(/\/+$/, '')}/api/v1/oauth/${provider}/callback`;
}

// ============================================================================
// Provider protocol — Google
// ============================================================================

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/tasks',
].join(' ');

function googleAuthUrl(cfg: OAuthProviderConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(cfg, 'google'),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'select_account consent',
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

async function googleExchange(cfg: OAuthProviderConfig, code: string, http: PlatformHttp, now: number): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirectUri(cfg, 'google'),
    grant_type: 'authorization_code',
  });
  const res = await http(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`google token exchange failed (${res.status})`);
  const d = (await res.json()) as { access_token: string; refresh_token?: string; token_type: string; expires_in: number; scope: string };
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? '',
    token_type: d.token_type,
    expires_at: new Date(now + d.expires_in * 1000).toISOString(),
    scope: d.scope,
    provider: 'google',
  };
}

async function googleRefresh(cfg: OAuthProviderConfig, refreshToken: string, http: PlatformHttp, now: number): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await http(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`google token refresh failed (${res.status}): ${await safeText(res)}`);
  const d = (await res.json()) as { access_token: string; token_type: string; expires_in: number; scope: string };
  return {
    access_token: d.access_token,
    refresh_token: refreshToken, // Google does not rotate the refresh token
    token_type: d.token_type,
    expires_at: new Date(now + d.expires_in * 1000).toISOString(),
    scope: d.scope,
    provider: 'google',
  };
}

async function googleEmail(accessToken: string, http: PlatformHttp): Promise<string> {
  const res = await http(GOOGLE_USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`google userinfo failed (${res.status})`);
  const d = (await res.json()) as { email?: string };
  return d.email ?? '';
}

// ============================================================================
// Provider protocol — Microsoft
// ============================================================================

const MICROSOFT_USERINFO_ENDPOINT = 'https://graph.microsoft.com/v1.0/me';
const MICROSOFT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.ReadWrite',
  'Files.ReadWrite.All',
  'Sites.ReadWrite.All',
].join(' ');

function msTenant(cfg: OAuthProviderConfig): string {
  return cfg.tenantId || 'common';
}
function msAuthEndpoint(cfg: OAuthProviderConfig): string {
  return `https://login.microsoftonline.com/${msTenant(cfg)}/oauth2/v2.0/authorize`;
}
function msTokenEndpoint(cfg: OAuthProviderConfig): string {
  return `https://login.microsoftonline.com/${msTenant(cfg)}/oauth2/v2.0/token`;
}

function microsoftAuthUrl(cfg: OAuthProviderConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(cfg, 'microsoft'),
    response_type: 'code',
    scope: MICROSOFT_SCOPES,
    state,
  });
  return `${msAuthEndpoint(cfg)}?${params.toString()}`;
}

async function microsoftExchange(cfg: OAuthProviderConfig, code: string, http: PlatformHttp, now: number): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirectUri(cfg, 'microsoft'),
    grant_type: 'authorization_code',
  });
  const res = await http(msTokenEndpoint(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`microsoft token exchange failed (${res.status})`);
  const d = (await res.json()) as { access_token: string; refresh_token?: string; token_type: string; expires_in: number; scope: string };
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? '',
    token_type: d.token_type,
    expires_at: new Date(now + d.expires_in * 1000).toISOString(),
    scope: d.scope,
    provider: 'microsoft',
  };
}

async function microsoftRefresh(cfg: OAuthProviderConfig, refreshToken: string, http: PlatformHttp, now: number): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await http(msTokenEndpoint(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`microsoft token refresh failed (${res.status}): ${await safeText(res)}`);
  const d = (await res.json()) as { access_token: string; refresh_token?: string; token_type: string; expires_in: number; scope: string };
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token || refreshToken, // Microsoft may rotate
    token_type: d.token_type,
    expires_at: new Date(now + d.expires_in * 1000).toISOString(),
    scope: d.scope,
    provider: 'microsoft',
  };
}

async function microsoftEmail(accessToken: string, http: PlatformHttp): Promise<string> {
  const res = await http(MICROSOFT_USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`microsoft userinfo failed (${res.status})`);
  const d = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return d.mail || d.userPrincipalName || '';
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}

// ---- provider dispatch -----------------------------------------------------

function buildAuthUrl(cfg: OAuthProviderConfig, provider: PlatformProvider, state: string): string {
  return provider === 'google' ? googleAuthUrl(cfg, state) : microsoftAuthUrl(cfg, state);
}
function exchangeCode(cfg: OAuthProviderConfig, provider: PlatformProvider, code: string, http: PlatformHttp, now: number): Promise<OAuthTokens> {
  return provider === 'google' ? googleExchange(cfg, code, http, now) : microsoftExchange(cfg, code, http, now);
}
function refreshTokens(cfg: OAuthProviderConfig, provider: PlatformProvider, refreshToken: string, http: PlatformHttp, now: number): Promise<OAuthTokens> {
  return provider === 'google' ? googleRefresh(cfg, refreshToken, http, now) : microsoftRefresh(cfg, refreshToken, http, now);
}
function fetchEmail(provider: PlatformProvider, accessToken: string, http: PlatformHttp): Promise<string> {
  return provider === 'google' ? googleEmail(accessToken, http) : microsoftEmail(accessToken, http);
}

// ============================================================================
// Store access (org-scoped rows)
// ============================================================================

function rowId(orgId: string, provider: PlatformProvider): string {
  return `platform-${orgId}-${provider}`;
}

async function getOrgRow(orgId: string, provider: PlatformProvider): Promise<IntegrationConfigDoc | null> {
  const row = (await integrationConfigs.get(rowId(orgId, provider))) as IntegrationConfigDoc | null;
  // Structural org confinement: the id embeds orgId, but re-check the stored orgId + marker.
  if (!row || row.orgId !== orgId || row.platformProvider !== provider) return null;
  return row;
}

// ============================================================================
// Token custody — getValidPlatformTokens (used by platform-call.ts)
// ============================================================================

export class PlatformNotConnectedError extends Error {
  constructor(public readonly provider: PlatformProvider, public readonly needsReauth: boolean) {
    super(needsReauth ? `${provider} needs to be reconnected` : `${provider} is not connected`);
    this.name = 'PlatformNotConnectedError';
  }
}

/** In-flight refresh per row id (singleflight): the lazy refresh and a future background sweep
 *  must never both spend a rotating refresh_token. */
const inflightRefresh = new Map<string, Promise<OAuthTokens>>();

/** Decrypt + refresh-on-expiry the org's tokens for a provider. Throws PlatformNotConnectedError
 *  when the connection is missing/disabled/dead. */
export async function getValidPlatformTokens(orgId: string, provider: PlatformProvider, deps: OAuthDeps): Promise<OAuthTokens> {
  const row = await getOrgRow(orgId, provider);
  if (!row || !row.enabled || !row.credentialsCiphertext) throw new PlatformNotConnectedError(provider, false);
  if (row.needsReauth) throw new PlatformNotConnectedError(provider, true);
  const tokens = JSON.parse(decrypt(row.credentialsCiphertext)) as OAuthTokens;
  const expiresAt = new Date(tokens.expires_at).getTime();
  if (deps.now() <= expiresAt - 60_000) return tokens; // still valid (60s skew)
  return refreshAndPersist(row, provider, tokens, deps);
}

async function refreshAndPersist(row: IntegrationConfigDoc, provider: PlatformProvider, current: OAuthTokens, deps: OAuthDeps): Promise<OAuthTokens> {
  const existing = inflightRefresh.get(row._id);
  if (existing) return existing;
  const run = doRefreshAndPersist(row, provider, current, deps).finally(() => {
    if (inflightRefresh.get(row._id) === run) inflightRefresh.delete(row._id);
  });
  inflightRefresh.set(row._id, run);
  return run;
}

async function doRefreshAndPersist(row: IntegrationConfigDoc, provider: PlatformProvider, current: OAuthTokens, deps: OAuthDeps): Promise<OAuthTokens> {
  const cfg = envOf(deps)[provider];
  const http = httpOf(deps);
  try {
    const refreshed = await refreshTokens(cfg, provider, current.refresh_token, http, deps.now());
    refreshed.email = current.email;
    await integrationConfigs.update(row._id, (cur) => ({
      ...cur,
      credentialsCiphertext: encrypt(JSON.stringify(refreshed)),
      needsReauth: false,
    }));
    return refreshed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid_grant/i.test(msg)) {
      // Re-read: a concurrent refresh may already have replaced the credentials.
      const fresh = (await integrationConfigs.get(row._id)) as IntegrationConfigDoc | null;
      if (fresh?.credentialsCiphertext && fresh.credentialsCiphertext !== row.credentialsCiphertext) {
        try {
          return JSON.parse(decrypt(fresh.credentialsCiphertext)) as OAuthTokens;
        } catch {
          /* fall through to dead-flag */
        }
      }
      await integrationConfigs.update(row._id, (cur) => ({ ...cur, needsReauth: true })).catch(() => undefined);
      throw new PlatformNotConnectedError(provider, true);
    }
    throw err;
  }
}

// ============================================================================
// Service operations — connect / callback / status / disconnect / list
// ============================================================================

export type ConnectResult =
  | { ok: true; authUrl: string; state: string }
  | { ok: false; code: 'invalid_provider' | 'not_configured' };

/** Begin an OAuth flow (org-admin). Stores a fresh CSRF `state` on the org's row and returns the
 *  provider authorize URL. Takes an audit-capable actor (username) because it writes an audit row. */
export async function connectPlatform(actor: ActivityActor, providerRaw: string, deps: OAuthDeps): Promise<ConnectResult> {
  if (!isProvider(providerRaw)) return { ok: false, code: 'invalid_provider' };
  const provider = providerRaw;
  const cfg = envOf(deps)[provider];
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectBaseUrl) return { ok: false, code: 'not_configured' };

  const state = randomUUID(); // high-entropy CSRF nonce; matched (with TTL) at callback
  const oauthStateExpiresAt = deps.now() + STATE_TTL_MS;
  const id = rowId(actor.orgId, provider);
  const existing = (await integrationConfigs.get(id)) as IntegrationConfigDoc | null;
  if (existing) {
    await integrationConfigs.update(id, (cur) => ({ ...cur, oauthState: state, oauthStateExpiresAt }));
  } else {
    const doc: IntegrationConfigDoc = {
      _id: id,
      orgId: actor.orgId,
      ownerUserId: undefined, // org-shared workspace connection (Amendment 2)
      integrationKey: `platform-${provider}`,
      name: provider === 'google' ? 'Google Workspace' : 'Microsoft 365',
      enabled: false,
      platformProvider: provider,
      oauthState: state,
      oauthStateExpiresAt,
    };
    await integrationConfigs.insert(doc as never);
  }
  await logActivity(actor, 'platform-integrations', 'connect', deps, { provider });
  return { ok: true, authUrl: buildAuthUrl(cfg, provider, state), state };
}

export type CallbackOutcome =
  | { ok: true; provider: PlatformProvider; email: string }
  | { ok: false; provider: string; reason: 'invalid_provider' | 'invalid_state' | 'exchange_failed' | 'denied' };

/** Complete an OAuth flow from the public redirect. Validates the CSRF state (existence + TTL),
 *  exchanges the code, fetches the account email, and persists the encrypted token bundle. The
 *  caller is the public callback route; there is no actor. */
export async function completeCallback(
  providerRaw: string,
  params: { code?: string; state?: string; error?: string },
  deps: OAuthDeps,
): Promise<CallbackOutcome> {
  if (!isProvider(providerRaw)) return { ok: false, provider: String(providerRaw), reason: 'invalid_provider' };
  const provider = providerRaw;
  if (params.error) return { ok: false, provider, reason: 'denied' };
  const { code, state } = params;
  if (!code || !state) return { ok: false, provider, reason: 'invalid_state' };

  // Locate the pending row by (provider, state). The state is a high-entropy nonce and is the
  // sole security token on this public path, so this lookup is deliberately cross-org.
  const matches = (await integrationConfigs.find({ platformProvider: provider, oauthState: state })) as IntegrationConfigDoc[];
  const row = matches[0];
  if (!row || row.oauthState !== state) return { ok: false, provider, reason: 'invalid_state' };
  if (row.oauthStateExpiresAt != null && deps.now() > row.oauthStateExpiresAt) {
    return { ok: false, provider, reason: 'invalid_state' };
  }

  const cfg = envOf(deps)[provider];
  const http = httpOf(deps);
  let tokens: OAuthTokens;
  try {
    tokens = await exchangeCode(cfg, provider, code, http, deps.now());
  } catch {
    return { ok: false, provider, reason: 'exchange_failed' };
  }
  let email = '';
  try {
    email = await fetchEmail(provider, tokens.access_token, http);
    tokens.email = email;
  } catch {
    /* userinfo is best-effort; a connection with no email is still valid */
  }
  await integrationConfigs.update(row._id, (cur) => ({
    ...cur,
    credentialsCiphertext: encrypt(JSON.stringify(tokens)),
    email: email || undefined,
    enabled: true,
    needsReauth: false,
    oauthState: undefined,
    oauthStateExpiresAt: undefined,
  }));
  // The public callback has no authenticated actor; attribute the completion to the system on
  // behalf of the org whose pending flow the state matched (the connect initiation is already
  // audited to the org-admin who started it).
  await logActivity(
    { userId: 'system', username: 'oauth-callback', orgId: row.orgId },
    'platform-integrations',
    'callback',
    deps,
    { provider, email },
  );
  return { ok: true, provider, email };
}

/** Connection status for one provider (any org member). */
export async function platformStatus(actor: Actor, providerRaw: string): Promise<{ connected: boolean; email?: string; expiresAt?: string }> {
  const provider = assertProvider(providerRaw);
  const row = await getOrgRow(actor.orgId, provider);
  if (!row || !row.credentialsCiphertext || row.needsReauth) return { connected: false };
  try {
    const tokens = JSON.parse(decrypt(row.credentialsCiphertext)) as OAuthTokens;
    return { connected: true, email: tokens.email || row.email || undefined, expiresAt: tokens.expires_at };
  } catch {
    return { connected: false };
  }
}

/** Disconnect a provider (org-admin). Idempotent — clears credentials + state. */
export async function disconnectPlatform(actor: ActivityActor, providerRaw: string, deps: OAuthDeps): Promise<void> {
  const provider = assertProvider(providerRaw);
  const id = rowId(actor.orgId, provider);
  const existing = (await integrationConfigs.get(id)) as IntegrationConfigDoc | null;
  if (existing && existing.orgId === actor.orgId) {
    await integrationConfigs.update(id, (cur) => ({
      ...cur,
      credentialsCiphertext: undefined,
      email: undefined,
      enabled: false,
      needsReauth: false,
      oauthState: undefined,
      oauthStateExpiresAt: undefined,
    }));
    await logActivity(actor, 'platform-integrations', 'disconnect', deps, { provider });
  }
}

/** All providers with their connection state for the actor's org (any org member). */
export async function listPlatform(actor: Actor): Promise<Array<{ provider: PlatformProvider; connected: boolean; email?: string }>> {
  const out: Array<{ provider: PlatformProvider; connected: boolean; email?: string }> = [];
  for (const provider of PLATFORM_PROVIDERS) {
    const row = await getOrgRow(actor.orgId, provider);
    if (!row || !row.credentialsCiphertext || row.needsReauth) {
      out.push({ provider, connected: false });
      continue;
    }
    let email: string | undefined = row.email || undefined;
    if (!email) {
      try {
        email = (JSON.parse(decrypt(row.credentialsCiphertext)) as OAuthTokens).email || undefined;
      } catch {
        out.push({ provider, connected: false });
        continue;
      }
    }
    out.push({ provider, connected: true, email });
  }
  return out;
}

// ============================================================================
// Callback page (server-rendered; postMessage to the opener — ch03 §3.8.15)
// ============================================================================

/** Minimal HTML that posts the OAuth result to the opener window and closes. No inline provider
 *  data beyond provider + success flag (never a token/email/error body). PT-PT copy, no emoji. */
export function renderCallbackPage(provider: string, success: boolean): string {
  const safeProvider = /^[a-z0-9-]+$/i.test(provider) ? provider : 'unknown';
  const title = success ? 'Ligação concluída' : 'Ligação não concluída';
  const message = success
    ? 'Pode fechar esta janela.'
    : 'Não foi possível concluir a ligação. Feche esta janela e tente novamente.';
  const payload = JSON.stringify({ type: 'oauth-callback', provider: safeProvider, success });
  return `<!doctype html>
<html lang="pt">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center}main{text-align:center;padding:2rem}h1{font-size:1.1rem;font-weight:600;margin:0 0 .5rem}p{color:#94a3b8;margin:0}</style>
</head>
<body><main><h1>${title}</h1><p>${message}</p></main>
<script>
(function(){
  try { if (window.opener) window.opener.postMessage(${payload}, '*'); } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch (e) {} }, 800);
})();
</script>
</body></html>`;
}
