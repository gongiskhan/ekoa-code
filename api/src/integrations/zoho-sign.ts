/**
 * Zoho Sign OAuth token service — resolves the `{{api_base}}` + `{{access_token}}`
 * that the versioned `zoho-sign` integration's httpConfig templates interpolate.
 *
 * Zoho has no long-lived API key. A Self Client yields a one-time `grant_code`
 * that is exchanged ONCE for a permanent `refresh_token`; every subsequent call
 * mints a ~1h access token from that refresh token (Zoho does NOT rotate refresh
 * tokens on refresh). This service:
 *
 *   1. exchanges a freshly pasted grant code for the refresh token and reports it
 *      back via `ctx.onCredentialUpdate` (so the caller persists it and burns the
 *      grant code) — works for saved configs AND unsaved builder test creds;
 *   2. refreshes access tokens from the refresh token on demand;
 *   3. caches access tokens in-memory (keyed by config id, or a sha256 of
 *      client_id+refresh_token when there is no id, e.g. builder tests) and
 *      singleflights concurrent refreshes so N callers trigger 1 token HTTP call.
 *
 * Auth header is `Authorization: Zoho-oauthtoken <token>` (NOT Bearer). Errors are
 * sanitized — a raw token/secret never reaches a message or a log.
 *
 * Hosts derive from the `dc` credential field (com|eu|in|jp|au|ca|sa):
 *   api base  = https://sign.zoho.<dc>
 *   accounts  = https://accounts.zoho.<dc>
 * Both are overridable via ZOHO_API_BASE_OVERRIDE / ZOHO_ACCOUNTS_BASE_OVERRIDE
 * (test seam — never set in production).
 *
 * Ported from cortex/src/services/zoho-sign.ts (token core). Adaptation for
 * ekoa-code: the old repo's `config.platformIntegrations.zoho` object does not
 * exist here (ekoa-code loads OAuth env lazily — see platform-oauth.ts's
 * loadPlatformOAuthEnv), so the client-cred env fallback is a local
 * `loadZohoEnv()` reading ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_DC. Manually
 * pasted credentials always win when present. This module is the S1 token core;
 * the served-app proxy (send/status/sign-url/document) lands in a later slice.
 */

import { createHash } from 'node:crypto';

const VALID_DC = new Set(['com', 'eu', 'in', 'jp', 'au', 'ca', 'sa']);

/** Refresh access tokens this many ms before their real expiry. */
const EXPIRY_MARGIN_MS = 60_000;
/** Fallback TTL when Zoho omits expires_in. */
const DEFAULT_TTL_SECONDS = 3600;

export interface ZohoResolverCtx {
  ownerUserId?: string;
  superAdmin?: boolean;
  /** The stored config id, when resolving for a saved integration (executor path). */
  configId?: string;
  /**
   * Invoked when the grant-code exchange mints the permanent refresh token, with
   * `{ refresh_token, grant_code: '' }`. A saved config persists it into the
   * encrypted bundle; a builder test with no config returns it to the client as
   * `credentialUpdates` to fold into testCredentials before save.
   */
  onCredentialUpdate?: (updates: Record<string, string>) => Promise<void> | void;
}

export class ZohoSignError extends Error {
  readonly status: number;
  /** Raw upstream detail for SERVER-SIDE logging only — never put in a user message. */
  readonly detail?: string;
  constructor(message: string, status = 502, detail?: string) {
    super(message);
    this.name = 'ZohoSignError';
    this.status = status;
    this.detail = detail;
  }
}

/** Distinct "not connected" signal so the route layer can answer 409 + reconnect. */
export class ZohoSignNotConnectedError extends Error {
  readonly code = 'not_connected';
  constructor(message = 'O Zoho Sign não está ligado nesta área de trabalho.') {
    super(message);
    this.name = 'ZohoSignNotConnectedError';
  }
}

interface ZohoTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: unknown;
  [k: string]: unknown;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();

// ----------------------------------------------------------------------------
// Env fallback (client creds only) — ekoa-code has no config.platformIntegrations
// ----------------------------------------------------------------------------

/** Platform-level Zoho client credentials from env, backing OAuth-connected bundles
 *  that deliberately omit per-user client creds. Manually pasted creds always win. */
export function loadZohoEnv(): { clientId: string; clientSecret: string; dc: string } {
  return {
    clientId: process.env.ZOHO_CLIENT_ID ?? '',
    clientSecret: process.env.ZOHO_CLIENT_SECRET ?? '',
    dc: process.env.ZOHO_DC ?? '',
  };
}

// ----------------------------------------------------------------------------
// Host derivation
// ----------------------------------------------------------------------------

function normalizeDc(dc: unknown): string {
  const d = String(dc ?? '').trim().toLowerCase().replace(/^\./, '');
  return VALID_DC.has(d) ? d : 'com';
}

/** Public API host for a data center. `override` (test seam) wins when set. */
export function zohoApiBase(dc: unknown, override?: string): string {
  const o = (override ?? '').trim();
  if (o) return o.replace(/\/+$/, '');
  return `https://sign.zoho.${normalizeDc(dc)}`;
}

/** Accounts/OAuth host for a data center. `override` (test seam) wins when set. */
export function zohoAccountsBase(dc: unknown, override?: string): string {
  const o = (override ?? '').trim();
  if (o) return o.replace(/\/+$/, '');
  return `https://accounts.zoho.${normalizeDc(dc)}`;
}

function apiBase(dc: unknown): string {
  return zohoApiBase(dc, process.env.ZOHO_API_BASE_OVERRIDE);
}

function accountsBase(dc: unknown): string {
  return zohoAccountsBase(dc, process.env.ZOHO_ACCOUNTS_BASE_OVERRIDE);
}

// ----------------------------------------------------------------------------
// Token flow
// ----------------------------------------------------------------------------

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function cacheKey(configId: string | undefined, clientId: string, refreshToken: string): string {
  if (configId) return `id:${configId}`;
  return `rt:${createHash('sha256').update(`${clientId}:${refreshToken}`).digest('hex')}`;
}

function cacheSet(key: string, token: string, expiresIn: unknown): void {
  const ttl = Number(expiresIn) > 0 ? Number(expiresIn) : DEFAULT_TTL_SECONDS;
  tokenCache.set(key, { accessToken: token, expiresAt: Date.now() + ttl * 1000 - EXPIRY_MARGIN_MS });
}

function sanitizeZohoError(json: ZohoTokenResponse, status: number): string {
  const err = json?.error;
  const code =
    typeof err === 'string'
      ? err
      : err && typeof err === 'object' && typeof (err as Record<string, unknown>).code === 'string'
        ? String((err as Record<string, unknown>).code)
        : typeof json?.code === 'string'
          ? String(json.code)
          : '';
  const msg = typeof json?.message === 'string' ? String(json.message) : '';
  const detail = [code, msg].filter(Boolean).join(': ');
  return `Zoho token request failed${detail ? ` (${detail})` : ` (HTTP ${status})`}`;
}

async function tokenRequest(dc: unknown, params: Record<string, string>): Promise<ZohoTokenResponse> {
  const url = `${accountsBase(dc)}/oauth/v2/token`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: ZohoTokenResponse = {};
    try {
      json = JSON.parse(text) as ZohoTokenResponse;
    } catch {
      json = {};
    }
    // Zoho commonly returns HTTP 200 with `{ error: "invalid_code" }` on failure.
    if (!res.ok || json.error) {
      throw new ZohoSignError(sanitizeZohoError(json, res.status), res.status >= 400 ? res.status : 502);
    }
    if (!json.access_token) {
      throw new ZohoSignError('Zoho token endpoint returned no access_token.', 502);
    }
    return json;
  } catch (err) {
    if (err instanceof ZohoSignError) throw err;
    const msg = err instanceof Error && err.name === 'AbortError' ? 'Zoho token request timed out.' : 'Zoho token request failed.';
    throw new ZohoSignError(msg, 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function exchangeGrantCode(
  clientId: string,
  clientSecret: string,
  code: string,
  dc: unknown,
): Promise<ZohoTokenResponse> {
  return tokenRequest(dc, {
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });
}

async function doRefresh(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  dc: unknown,
  key: string,
): Promise<string> {
  const res = await tokenRequest(dc, {
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  cacheSet(key, res.access_token as string, res.expires_in);
  return res.access_token as string;
}

/**
 * Resolve a valid Zoho access token from a decrypted credential bundle. Performs
 * the one-time grant-code exchange (persisting the refresh token via
 * `ctx.onCredentialUpdate`), else refreshes from the stored refresh token, with
 * an in-memory cache + singleflight so concurrent callers trigger one HTTP call.
 */
export async function getZohoAccessToken(
  fields: Record<string, unknown>,
  ctx: ZohoResolverCtx = {},
): Promise<string> {
  // OAuth-connected bundles (the popup flow) deliberately omit client creds — the
  // platform's Zoho client (ZOHO_CLIENT_ID/SECRET in env) backs their refreshes,
  // so rotating the secret never orphans a stored bundle. Manually-pasted creds
  // always win when present.
  const env = loadZohoEnv();
  const clientId = str(fields.client_id) || env.clientId;
  const clientSecret = str(fields.client_secret) || env.clientSecret;
  const grantCode = str(fields.grant_code);
  let refreshToken = str(fields.refresh_token);
  const dc = fields.dc ?? env.dc;

  if (!clientId || !clientSecret) {
    throw new ZohoSignError(
      'Zoho Sign is missing client_id / client_secret (paste them in the credentials form, or set ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET in the environment).',
      400,
    );
  }

  // One-time grant-code exchange: no refresh token yet, but a grant code was pasted.
  if (!refreshToken && grantCode) {
    const exchanged = await exchangeGrantCode(clientId, clientSecret, grantCode, dc);
    refreshToken = str(exchanged.refresh_token);
    if (!refreshToken) {
      throw new ZohoSignError('Zoho returned no refresh_token for the grant code (it may be expired or already used).', 400);
    }
    // Persist the permanent refresh token and burn the one-time grant code.
    if (ctx.onCredentialUpdate) await ctx.onCredentialUpdate({ refresh_token: refreshToken, grant_code: '' });
    const key = cacheKey(ctx.configId, clientId, refreshToken);
    cacheSet(key, exchanged.access_token as string, exchanged.expires_in);
    return exchanged.access_token as string;
  }

  if (!refreshToken) {
    throw new ZohoSignError('Zoho Sign is not connected — paste a Grant Code or a Refresh Token.', 400);
  }

  const key = cacheKey(ctx.configId, clientId, refreshToken);
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.accessToken;

  const existing = inflight.get(key);
  if (existing) return existing; // join the in-flight refresh — never double-refresh

  const run = doRefresh(clientId, clientSecret, refreshToken, dc, key).finally(() => {
    if (inflight.get(key) === run) inflight.delete(key);
  });
  inflight.set(key, run);
  return run;
}

/**
 * Provider resolver for the generic integration executor: mints the computed
 * `api_base` + `access_token` the `zoho-sign` httpConfig templates interpolate.
 */
export async function resolveZohoCredentials(
  fields: Record<string, unknown>,
  ctx: ZohoResolverCtx = {},
): Promise<Record<string, string>> {
  const accessToken = await getZohoAccessToken(fields, ctx);
  return {
    api_base: apiBase(fields.dc ?? loadZohoEnv().dc),
    access_token: accessToken,
  };
}

/** Test seam: clear the in-memory access-token cache and any in-flight refreshes. */
export function __resetZohoTokenCache(): void {
  tokenCache.clear();
  inflight.clear();
}
