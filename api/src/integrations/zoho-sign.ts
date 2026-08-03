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
 * pasted credentials always win when present.
 *
 * Part 1 (2B-S1) is the token core above. Part 2 (2B-S2, below) is the served-app
 * PROXY — the create→submit Zoho two-step + status/sign-url/document reads + the
 * `zohoSignRouter` mirroring `adobeSignRouter`. Because `integrations/` may NOT
 * import `apps/` (module tiers, FIXED-1) and because the composition root
 * (server.ts) is the sole place cross-seam collaborators are wired, EVERY external
 * dependency of the proxy is INJECTED via `ZohoSignDeps` (HTML→PDF rendering, the
 * owner→org lookup, config custody = findConfigForOwner + decrypt, credential
 * persistence). That injection also keeps this module free of the mongodb-pulling
 * import chain, so the hermetic proxy e2e can drive the real backend under plain
 * node against an inline Zoho mock. The inbound-webhook BUSINESS logic (agreement
 * index + owner-scoped re-verify + proposal advance) lands in 2B-S3; this slice
 * ships the public webhook echo route with an injected `onWebhook` seam (default
 * no-op), exactly as `adobeSignRouter` does.
 */

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Router, type Request, type Response } from 'express';

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

// ============================================================================
// Part 2 (2B-S2) — Served-app proxy: send / status / sign-url / document
//
// A same-origin served artifact calls /api/zoho-sign/* token-free (scoped by
// X-Ekoa-App-Id); the router resolves the app's OWNER and hands the backend that
// owner id. The backend resolves the owner's org (injected getOwnerOrgId), loads +
// decrypts the owner's saved `zoho-sign` config JIT (injected config custody), mints
// an access token via the part-1 token core, and drives the Zoho two-step (create
// draft → submit with a Signature field). Credentials never leave this module;
// errors are sanitized so no token/secret reaches a message or a log.
//
// Mirrors integrations/adobe-sign.ts (the sibling e-signature provider); the only
// structural difference is Zoho's create-then-submit + mandatory signature field
// placement (Zoho refuses to send a signer with no field).
// ============================================================================

/** Versioned integration key whose saved config owns the Zoho credentials. */
const INTEGRATION_KEY = 'zoho-sign';

/** Abuse caps for the credential-free, X-Ekoa-App-Id-scoped /api/zoho-sign/send route. */
const MAX_RECIPIENTS = 10;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB rendered/decoded PDF
const MAX_HTML_CHARS = 5 * 1024 * 1024; // ~5 MB of HTML before rendering

/**
 * Signature-field placement on the LAST page (Zoho page coordinate model, top-left
 * origin, ~points on the rendered A4 page). The signable document ends with a
 * DEDICATED signature page (buildProposalSignHtml forces a page break), so the last
 * page always starts fresh: heading + intro at the top, then a "signature zone"
 * beginning ~SIG_ZONE_TOP down. Each signer's field is stacked vertically (SIG_STEP
 * apart) so multiple signers never overlap. This is far more reliable than a fixed
 * y:700 which could land below a short page's content and render unclickable. Tuned
 * against the live Zoho signer UI.
 */
const SIG_ZONE_TOP = 200; // top of the signature zone on the dedicated last page
const SIG_STEP = 92; // vertical gap between stacked signers (= HTML .sig-row height)
const SIG_X = 96; // left inset of each signature box
const SIG_W = 300; // box width
const SIG_H = 44; // box height
/** Field box for signer index `i` (0-based) on the dedicated signature page. */
function signatureFieldBox(i: number) {
  return { x: SIG_X, y: SIG_ZONE_TOP + i * SIG_STEP, width: SIG_W, height: SIG_H };
}

export interface ZohoSignRecipient {
  email: string;
  name?: string;
  /** Zoho action type; only SIGN is placed with a signature field. */
  role?: string;
  /** 1-based signing position; distinct orders sign sequentially. */
  order?: number;
  /** When true, mint an embedded (in-portal) signing URL; otherwise Zoho emails. */
  embedded?: boolean;
}

export interface ZohoSendInput {
  ownerUserId?: string;
  documentName: string;
  fileName?: string;
  /** Self-contained HTML document; rendered to PDF server-side. */
  html?: string;
  /** Alternative to html: raw PDF bytes, base64 (data-URI prefix tolerated). */
  pdfBase64?: string;
  recipients: ZohoSignRecipient[];
  /** Note shown to signers (Zoho `notes` + per-action `private_notes`). */
  message?: string;
  /** Where an embedded signer is redirected after signing (embed `host`). */
  redirectUrl?: string;
  /** Optional Zoho expiration window. */
  expirationDays?: number;
  /** Force sequential/parallel; defaults from whether orders differ. */
  isSequential?: boolean;
  /** Zoho notification/UI language for signers. Defaults to 'pt' (PT-PT). */
  language?: string;
  /** Correlator for the requestId→proposta reverse index (S3 agreement store). */
  externalRef?: { appId?: string; propostaId?: string; clientEmail?: string };
}

export interface ZohoSigningUrl {
  email: string;
  /** Embedded one-time URL, or null when the signer is delivered by email. */
  signUrl: string | null;
}

export interface ZohoSendResult {
  success: boolean;
  requestId: string;
  status: string;
  signingUrls: ZohoSigningUrl[];
}

interface ZohoAction {
  action_id?: string;
  recipient_email?: string;
  recipient_name?: string;
  action_status?: string;
  action_type?: string;
  [k: string]: unknown;
}
interface ZohoDocument {
  document_id?: string;
  total_pages?: number;
  document_name?: string;
  [k: string]: unknown;
}
interface ZohoRequest {
  request_id?: string;
  request_name?: string;
  request_status?: string;
  actions?: ZohoAction[];
  document_ids?: ZohoDocument[];
  [k: string]: unknown;
}
interface ZohoRequestEnvelope {
  code?: number;
  status?: string;
  message?: string;
  requests?: ZohoRequest;
  [k: string]: unknown;
}

/** Reverse index row written at send time (S3 agreement store consumes it). Same
 *  tiny, non-sensitive shape as the Adobe path: no credentials. */
export interface ZohoAgreementRef {
  /** Zoho Sign requestId — the store key. */
  id: string;
  /** Canonical app id (not slug) that owns the `propostas` collection. */
  appId: string;
  /** The `propostas` record id this request was created for. */
  propostaId: string;
  /** App owner — scopes the Zoho credential lookup for the verification re-fetch. */
  ownerUserId: string;
  /** The signer we treat as "the client" for advance-on-client-sign. */
  clientEmail: string;
  createdAt: string;
}

// ----------------------------------------------------------------------------
// Injected dependencies (composition root wires the real collaborators; the
// hermetic proxy e2e wires test doubles). integrations/ may not import apps/, and
// keeping config custody injected also keeps this module out of the mongodb import
// chain so it drives under plain node.
// ----------------------------------------------------------------------------

/** The minimal shape of a saved integration-config row this module reads. */
export interface ZohoSignConfigRow {
  _id: string;
  enabled: boolean;
  needsReauth?: boolean;
  /** Encrypted credential bundle (JSON of client_id/secret, refresh_token/grant_code, dc, ...). */
  credentialsCiphertext?: string;
  /**
   * WS-C custody fields, PASSED THROUGH and never read here (B2 review M1). This module makes no
   * decision with them; they exist so the injected shadow observer below receives the row this
   * function already loaded instead of paying a second store read on every signature call.
   */
  orgId?: string;
  ownerUserId?: string;
  cofreItemId?: string;
}

export interface ZohoSignDeps {
  /** Owner user id → their org id (ResolvedAppScope carries none). Root: users.get. */
  getOwnerOrgId: (ownerUserId: string) => Promise<string | null>;
  /** Resolve the owner's connected `zoho-sign` config (own row wins, else org-shared).
   *  Root: integrations service.findConfigForOwner. */
  findConfigForOwner: (orgId: string, ownerUserId: string, key: string) => Promise<ZohoSignConfigRow | null>;
  /** Decrypt a credential ciphertext under its org-bound envelope. Root: data/crypto.envelopeDecrypt
   *  (reads v1 rows transparently). B1: was flat `decrypt`, which threw on a v2 row written by the
   *  normal POST /integrations/configs path — a latent unreadable-config bug. */
  decrypt: (ciphertext: string, orgId: string) => Promise<string>;
  /** Render self-contained HTML → PDF bytes. Root: apps/pdf.renderHtmlToPdf (INJECTED
   *  because integrations/ may not import apps/). */
  renderHtmlToPdf: (html: string) => Promise<Buffer>;
  /** Persist rotated credential fields (grant_code → refresh_token) back into the saved
   *  bundle. Root: `integrations/service.persistRotatedCredentials`, which writes the legacy column
   *  AND refreshes the WS-C shadow (B2 review H2: this used to write the legacy column only, so a
   *  shadowed row drifted permanently from its first rotation). `ownerUserId` is carried because the
   *  shadow refresh is an owner-scoped Cofre write, not a store update. Best-effort; a no-op default
   *  means an unsaved/builder context simply does not persist. */
  persistOwnerCredentialUpdates?: (
    configId: string,
    ownerUserId: string,
    currentFields: Record<string, unknown>,
    updates: Record<string, string>,
  ) => Promise<void>;
  /**
   * REPORT A LIVE CREDENTIAL READ to the WS-C Rule-10 comparator (B2 review M1). This is the
   * served-app signature rail, and it is a REAL credential read that B2's census did not see: its
   * claim was "every read", the comparator was wired into the automation seam only, and the
   * 2026-08-15 cutover decision would have been made on a biased sample.
   *
   * Injected rather than imported for this module's standing reason (config custody is injected so
   * `integrations/zoho-sign.ts` stays out of the mongodb import chain and drives under plain node),
   * and SYNCHRONOUS-VOID so a measurement can never be awaited on the signature path. Default: a
   * no-op, i.e. an unmeasured read, never a broken one.
   */
  observeCredentialRead?: (
    orgId: string,
    ownerUserId: string,
    config: ZohoSignConfigRow,
    fields: Record<string, string>,
  ) => void;
  /** Record the requestId→proposta reverse index (2B-S3 agreement store). Default: no-op. */
  recordAgreement?: (ref: ZohoAgreementRef) => Promise<void>;
}

/** The privileged Zoho operations a served-app route drives (owner-scoped). Mirrors
 *  AdobeSignBackend; built from injected deps by `makeZohoSignBackend`. */
export interface ZohoSignBackend {
  isConnected(ownerUserId?: string): Promise<boolean>;
  sendForSignature(input: ZohoSendInput): Promise<ZohoSendResult>;
  getRequest(ownerUserId: string | undefined, requestId: string): Promise<ZohoRequest>;
  getSignUrl(ownerUserId: string | undefined, requestId: string, email: string): Promise<string | null>;
  getDocument(ownerUserId: string | undefined, requestId: string): Promise<{ bytes: Buffer; contentType: string }>;
}

// ----------------------------------------------------------------------------
// Owner credential resolution (mirrors adobe-sign; uses injected config custody)
// ----------------------------------------------------------------------------

interface OwnerZohoContext {
  fields: Record<string, unknown>;
  configId: string;
  /** The owner this context was resolved FOR, and their org — both needed by the rotation write and
   *  the shadow observer, and both already known here, so neither is looked up a second time. */
  ownerUserId: string;
  orgId: string;
}

/**
 * Resolve the connected `zoho-sign` config for a served app's owner. Preference is
 * the owner's OWN connection, else the org-shared one (findConfigForOwner encodes
 * that pick); we never fall back to an arbitrary other user's connection. A
 * `needsReauth`/disabled row is skipped so status reports false and callers get a
 * reconnect prompt. Returns the DECRYPTED credential fields + the config id (needed
 * to persist a rotated refresh token). Null when not connected / undecryptable.
 */
async function resolveOwnerZohoContext(deps: ZohoSignDeps, ownerUserId?: string): Promise<OwnerZohoContext | null> {
  const orgId = ownerUserId ? await deps.getOwnerOrgId(ownerUserId) : null;
  if (!orgId || !ownerUserId) return null;
  const config = await deps.findConfigForOwner(orgId, ownerUserId, INTEGRATION_KEY);
  if (!config || !config.enabled || config.needsReauth || !config.credentialsCiphertext) return null;
  let fields: Record<string, unknown>;
  try {
    fields = JSON.parse(await deps.decrypt(config.credentialsCiphertext, orgId)) as Record<string, unknown>;
  } catch {
    return null;
  }
  // The WS-C comparator, on the rail it was missing from (B2 review M1). OUTSIDE the decrypt's
  // `try` and inside its own, for the same reason the api_call rail keeps it outside: "the
  // credential did not decrypt" and "measuring the credential failed" must not be the same answer.
  if (deps.observeCredentialRead) {
    try {
      deps.observeCredentialRead(
        orgId,
        ownerUserId,
        config,
        Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
      );
    } catch {
      /* a measurement may never break the rail it measures */
    }
  }
  return { fields, configId: config._id, ownerUserId, orgId };
}

interface ZohoCallContext {
  token: string;
  base: string;
}

/**
 * Resolve a fresh access token + the account's API base for a served app's owner.
 * Throws ZohoSignNotConnectedError when the owner has no usable config.
 */
async function ownerCallContext(deps: ZohoSignDeps, ownerUserId?: string): Promise<ZohoCallContext> {
  const ctx = await resolveOwnerZohoContext(deps, ownerUserId);
  if (!ctx) throw new ZohoSignNotConnectedError();
  const token = await getZohoAccessToken(ctx.fields, {
    ownerUserId,
    configId: ctx.configId,
    onCredentialUpdate: deps.persistOwnerCredentialUpdates
      ? (updates) => deps.persistOwnerCredentialUpdates!(ctx.configId, ctx.ownerUserId, ctx.fields, updates)
      : undefined,
  });
  return { token, base: apiBase(ctx.fields.dc) };
}

/**
 * Connected == the owner has a `zoho-sign` config carrying a usable permanent
 * refresh_token (or a still-unused grant code that first use will exchange). No
 * network call — a status check stays cheap (mirrors adobe-sign.isConnected).
 */
async function isConnectedFor(deps: ZohoSignDeps, ownerUserId?: string): Promise<boolean> {
  const ctx = await resolveOwnerZohoContext(deps, ownerUserId);
  if (!ctx) return false;
  return str(ctx.fields.refresh_token).length > 0 || str(ctx.fields.grant_code).length > 0;
}

// ----------------------------------------------------------------------------
// Low-level Zoho REST (auth header = `Zoho-oauthtoken <token>`, NOT Bearer)
// ----------------------------------------------------------------------------

function zohoAuthHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Zoho-oauthtoken ${token}`, ...(extra || {}) };
}

async function safeText(res: globalThis.Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 600);
  } catch {
    return '';
  }
}

/**
 * Build a sanitized ZohoSignError from an upstream failure. The user-facing message
 * carries only Zoho's `code`/`message` (never the raw body or any header); the raw
 * body is stashed in `.detail` for server-side logging.
 */
function zohoApiError(fallback: string, status: number, bodyText: string): ZohoSignError {
  let code = '';
  let message = '';
  try {
    const j = JSON.parse(bodyText) as Record<string, unknown>;
    if (typeof j.code !== 'undefined') code = String(j.code);
    if (typeof j.message === 'string') message = j.message;
  } catch {
    /* non-JSON upstream body — keep code/message empty */
  }
  const detail = [code && `código ${code}`, message].filter(Boolean).join(': ');
  const httpStatus = status >= 400 && status < 600 ? status : 502;
  return new ZohoSignError(`${fallback}${detail ? ` (${detail})` : ` (HTTP ${status})`}`, httpStatus, bodyText);
}

/**
 * Force the embedded signer page into Portuguese. Zoho's `zsguest` embed URL carries
 * a `locale` query param that defaults to `en`; rewriting it to `pt` renders the whole
 * signing UI in Portuguese (the request-level notification language is NOT an accepted
 * create key — Zoho returns 9043 "Extra key found").
 */
export function withPtLocale(url: string | null): string | null {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('locale', 'pt');
    return u.toString();
  } catch {
    return url.includes('locale=') ? url.replace(/([?&]locale=)[^&]*/, '$1pt') : url + (url.includes('?') ? '&' : '?') + 'locale=pt';
  }
}

function extractSignUrl(json: Record<string, unknown>): string | null {
  if (typeof json.sign_url === 'string') return withPtLocale(json.sign_url);
  const reqs = json.requests as Record<string, unknown> | undefined;
  if (reqs && typeof reqs.sign_url === 'string') return withPtLocale(reqs.sign_url);
  const acts = (reqs?.actions ?? json.actions) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(acts)) {
    for (const a of acts) {
      if (typeof a.sign_url === 'string') return withPtLocale(a.sign_url);
      if (typeof a.embed_url === 'string') return withPtLocale(a.embed_url);
    }
  }
  return null;
}

async function fetchRequestRaw(base: string, token: string, requestId: string): Promise<ZohoRequest> {
  const res = await fetch(`${base}/api/v1/requests/${encodeURIComponent(requestId)}`, {
    method: 'GET',
    headers: zohoAuthHeaders(token),
  });
  if (!res.ok) throw zohoApiError('Não foi possível ler o pedido de assinatura.', res.status, await safeText(res));
  const json = (await res.json()) as ZohoRequestEnvelope;
  return json.requests || {};
}

/**
 * Mint a fresh one-time embedded signing URL for a signer's action. Best-effort: a
 * missing action id, a 404 (email-only Zoho account), or a parse miss all degrade to
 * null (the signer is emailed instead) rather than failing the send.
 */
async function mintEmbeddedSignUrl(
  base: string,
  token: string,
  requestId: string,
  actionId: string | undefined,
  host?: string,
): Promise<string | null> {
  if (!actionId) return null;
  const form = new URLSearchParams();
  if (host) form.set('host', host);
  const res = await fetch(
    `${base}/api/v1/requests/${encodeURIComponent(requestId)}/actions/${encodeURIComponent(actionId)}/embedtoken`,
    {
      method: 'POST',
      headers: zohoAuthHeaders(token, { 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form.toString(),
    },
  );
  if (!res.ok) {
    // Server-side visibility only — Zoho's error code/message, never the token.
    const body = (await res.json().catch(() => ({}))) as ZohoTokenResponse;
    console.warn(`[zoho-sign] embedtoken failed for request ${requestId}: ${sanitizeZohoError(body, res.status)}`);
    return null;
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const url = extractSignUrl(json);
  if (!url) console.warn(`[zoho-sign] embedtoken 2xx but no sign URL in response for request ${requestId}`);
  return url;
}

function sanitizeFileName(name: string): string {
  const cleaned = (name || 'documento').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const withExt = /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
  return withExt.slice(0, 120) || 'documento.pdf';
}

// ----------------------------------------------------------------------------
// Public orchestration (backend methods; deps-injected)
// ----------------------------------------------------------------------------

/**
 * Send a document for e-signature via Zoho's two-step flow:
 *   1. POST /api/v1/requests (multipart: `file` PDF + `data` JSON) → DRAFT,
 *      read document_ids[].total_pages + the generated action ids;
 *   2. POST /api/v1/requests/{id}/submit (data JSON) with each action carrying a
 *      mandatory Signature field on the LAST page — Zoho refuses to send a signer
 *      with no field.
 * Embedded recipients get a minted one-time URL; the rest are emailed by Zoho and
 * carry null.
 */
async function sendForSignatureImpl(deps: ZohoSignDeps, input: ZohoSendInput): Promise<ZohoSendResult> {
  const { token, base } = await ownerCallContext(deps, input.ownerUserId);

  const recipients = (input.recipients || []).filter((r) => r && r.email);
  if (recipients.length === 0) throw new ZohoSignError('É necessário pelo menos um destinatário.', 400);
  if (recipients.length > MAX_RECIPIENTS) throw new ZohoSignError(`Demasiados destinatários (máx. ${MAX_RECIPIENTS}).`, 400);

  // Document bytes: decode base64, or render HTML → PDF (Zoho rejects raw HTML).
  let bytes: Buffer;
  const fileName = sanitizeFileName(input.fileName || `${input.documentName || 'documento'}.pdf`);
  if (input.pdfBase64) {
    bytes = Buffer.from(input.pdfBase64.replace(/^data:[^,]*,/, ''), 'base64');
    if (bytes.length === 0) throw new ZohoSignError('pdfBase64 vazio.', 400);
  } else if (input.html) {
    if (input.html.length > MAX_HTML_CHARS) throw new ZohoSignError('O HTML do documento é demasiado grande para renderizar.', 413);
    bytes = await deps.renderHtmlToPdf(input.html);
  } else {
    throw new ZohoSignError('Forneça html ou pdfBase64 para assinar.', 400);
  }
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new ZohoSignError('O documento excede o limite de 10 MB.', 413);

  const orders = recipients.map((r, i) => (typeof r.order === 'number' && r.order > 0 ? Math.floor(r.order) : i + 1));
  const isSequential = typeof input.isSequential === 'boolean' ? input.isSequential : new Set(orders).size > 1;

  // Post-sign redirect (Zoho `redirect_pages`): after a signer finishes, Zoho sends
  // their browser to `redirectUrl` — the ERP proposal's portal page — INSTEAD of
  // parking them on Zoho's terminal "download" page. `sign_success` fires when the
  // signer signs but the request is not yet complete; `sign_completed` when it is.
  // This is what makes send_completed_document safe again: the signer is redirected
  // back to the A09 conversion checklist rather than stranded, so it no longer breaks
  // the post-sign flow. Only https URLs are honoured (no open-redirect).
  const redirectUrl =
    typeof input.redirectUrl === 'string' && /^https:\/\//i.test(input.redirectUrl.trim())
      ? input.redirectUrl.trim()
      : undefined;
  // Zoho's redirect_pages URLs reject a bare '#'/fragment (error 3007 "Url has invalid
  // character"), but the ERP portal IS a hash route (…/apps/<id>/#/portal?t=…). Wrap it
  // in a fragment-free bounce through our own GET /api/zoho-sign/return?to=<url-encoded>,
  // which 302-redirects to the real fragmented URL — the browser then loads the hash
  // route. The encoded `to` carries the '#' as %23, so the URL Zoho sees has no invalid
  // characters.
  let redirectTarget: string | undefined;
  if (redirectUrl) {
    try {
      const origin = new URL(redirectUrl).origin;
      redirectTarget = `${origin}/api/zoho-sign/return?to=${encodeURIComponent(redirectUrl)}`;
    } catch {
      redirectTarget = undefined;
    }
  }
  const redirectPages = redirectTarget
    ? { sign_success: redirectTarget, sign_completed: redirectTarget, sign_later: redirectTarget }
    : undefined;

  // 1. Create DRAFT — multipart file + data JSON.
  const createData = {
    requests: {
      request_name: input.documentName || fileName,
      actions: recipients.map((r, i) => ({
        recipient_email: r.email,
        recipient_name: r.name || r.email,
        action_type: 'SIGN',
        signing_order: orders[i],
        verify_recipient: false,
        // Email each signer the signed PDF (parity with Adobe) — but ONLY when a
        // redirect (redirect_pages) is configured. send_completed_document parks the
        // signer on Zoho's download page; without a redirect that strands them and
        // breaks the ERP post-sign flow (the 2026-07 regression). Gated on redirectPages
        // so an app that passes no redirectUrl keeps the safe behavior.
        ...(redirectPages ? { send_completed_document: true } : {}),
        // Real Zoho refuses embedtoken minting ("Action is not embedded") unless the
        // action was created embedded. Embedded signers are NOT emailed by Zoho — the
        // app hands them the minted URL instead.
        ...(r.embedded ? { is_embedded: true } : {}),
        ...(input.message ? { private_notes: input.message } : {}),
      })),
      ...(typeof input.expirationDays === 'number' && input.expirationDays > 0
        ? { expiration_days: Math.floor(input.expirationDays) }
        : {}),
      is_sequential: isSequential,
      ...(redirectPages ? { redirect_pages: redirectPages } : {}),
      ...(input.message ? { notes: input.message } : {}),
    },
  };

  const createForm = new FormData();
  createForm.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), fileName);
  createForm.append('data', JSON.stringify(createData));
  const createRes = await fetch(`${base}/api/v1/requests`, { method: 'POST', headers: zohoAuthHeaders(token), body: createForm });
  if (!createRes.ok) throw zohoApiError('O Zoho Sign recusou a criação do pedido.', createRes.status, await safeText(createRes));

  const created = ((await createRes.json()) as ZohoRequestEnvelope).requests || {};
  const requestId = str(created.request_id);
  if (!requestId) throw new ZohoSignError('O Zoho Sign não devolveu um request_id.', 502);

  const firstDoc = (Array.isArray(created.document_ids) ? created.document_ids[0] : undefined) || {};
  const documentId = str(firstDoc.document_id);
  // Zoho page_no is 0-BASED (all official examples use 0 for the first page), so the
  // last page of an N-page document is N-1. An out-of-range page_no is accepted
  // silently ("placed but not viewable") — the signer then has no reachable field and
  // can never finish signing.
  const lastPageIndex = Number(firstDoc.total_pages) > 0 ? Number(firstDoc.total_pages) - 1 : 0;
  const createdActions = Array.isArray(created.actions) ? created.actions : [];

  // 2. Submit — each action carries a mandatory Signature field on the LAST page.
  // Pair each recipient with a DISTINCT created action: prefer same-index (Zoho echoes
  // actions in submission order), fall back to first unconsumed email match. A plain
  // email `find` would map two same-email recipients (e.g. the same person signing as
  // client AND as firm) onto one action_id.
  const consumedActionIds = new Set<string>();
  const submitActions = recipients.map((r, i) => {
    const byIndex = createdActions[i];
    const sameEmail = (a: ZohoAction | undefined) => str(a?.recipient_email).toLowerCase() === r.email.toLowerCase();
    const match =
      byIndex && sameEmail(byIndex) && !consumedActionIds.has(str(byIndex.action_id))
        ? byIndex
        : createdActions.find((a) => sameEmail(a) && !consumedActionIds.has(str(a.action_id)));
    const actionId = str(match?.action_id);
    if (actionId) consumedActionIds.add(actionId);
    return {
      ...(actionId ? { action_id: actionId } : {}),
      recipient_email: r.email,
      recipient_name: r.name || r.email,
      action_type: 'SIGN',
      signing_order: orders[i],
      verify_recipient: false,
      // Signed-PDF email, gated on a configured redirect (see create-action note).
      ...(redirectPages ? { send_completed_document: true } : {}),
      ...(r.embedded ? { is_embedded: true } : {}),
      ...(input.message ? { private_notes: input.message } : {}),
      fields: [
        {
          field_type_name: 'Signature',
          // Documented-mandatory companions of a positioned field; a Signature field's
          // category is 'image' (the signature drawing/upload).
          field_category: 'image',
          field_label: `Assinatura ${i + 1}`,
          field_name: `Assinatura ${i + 1}`,
          document_id: documentId,
          page_no: lastPageIndex,
          // Points at 72dpi, origin top-left (A4 = 595x842). Send ONLY the abs pair:
          // `width`/`height` are PERCENT of page (0-100) in Zoho's API, so echoing
          // 300/44 there declared a 300%x44% field — undefined behavior alongside the
          // abs pair.
          ...(() => {
            const box = signatureFieldBox(i);
            return { x_coord: box.x, y_coord: box.y, abs_width: box.width, abs_height: box.height };
          })(),
          is_mandatory: true,
          ...(actionId ? { action_id: actionId } : {}),
        },
      ],
    };
  });

  const submitForm = new FormData();
  submitForm.append(
    'data',
    JSON.stringify({ requests: { actions: submitActions, ...(redirectPages ? { redirect_pages: redirectPages } : {}) } }),
  );
  const submitRes = await fetch(`${base}/api/v1/requests/${encodeURIComponent(requestId)}/submit`, {
    method: 'POST',
    headers: zohoAuthHeaders(token),
    body: submitForm,
  });
  if (!submitRes.ok) throw zohoApiError('O Zoho Sign recusou o envio do pedido.', submitRes.status, await safeText(submitRes));

  const submitted = ((await submitRes.json()) as ZohoRequestEnvelope).requests || {};
  const status = str(submitted.request_status) || 'inprogress';
  const submittedActions = Array.isArray(submitted.actions) ? submitted.actions : createdActions;

  // Persist the requestId → proposta reverse index so an inbound Zoho webhook can route
  // the signature event back to this exact app + record (and pick the owner-scoped
  // credentials to re-verify). Best-effort; the store itself lands in 2B-S3, injected
  // here as `recordAgreement` (default no-op). Mirrors adobe-sign's agreement write.
  const ref = input.externalRef || {};
  if (deps.recordAgreement && ref.appId && ref.propostaId && input.ownerUserId) {
    try {
      await deps.recordAgreement({
        id: requestId,
        appId: ref.appId,
        propostaId: ref.propostaId,
        ownerUserId: input.ownerUserId,
        clientEmail: (ref.clientEmail || '').toLowerCase(),
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[zoho-sign] agreement index write failed:', (e as Error)?.message);
    }
  }

  // 3. Signing URLs — embedded recipients get a minted one-time URL (best-effort);
  //    everyone else is emailed by Zoho and carries null.
  const signingUrls: ZohoSigningUrl[] = [];
  const mintedActionIds = new Set<string>();
  for (const r of recipients) {
    if (!r.embedded) {
      signingUrls.push({ email: r.email, signUrl: null });
      continue;
    }
    const actionId =
      str(
        submittedActions.find(
          (a) => str(a.recipient_email).toLowerCase() === r.email.toLowerCase() && !mintedActionIds.has(str(a.action_id)),
        )?.action_id,
      ) || undefined;
    if (actionId) mintedActionIds.add(actionId);
    const signUrl = await mintEmbeddedSignUrl(base, token, requestId, actionId, input.redirectUrl).catch(() => null);
    signingUrls.push({ email: r.email, signUrl });
  }

  return { success: true, requestId, status, signingUrls };
}

/**
 * Mint a fresh embedded signing URL for one signer, at click time. Resolves the
 * signer's action id from the live request, then mints. Null when the signer has no
 * embedded action (email-only) or the account does not offer hosted signing.
 */
async function getSignUrlImpl(
  deps: ZohoSignDeps,
  ownerUserId: string | undefined,
  requestId: string,
  email: string,
): Promise<string | null> {
  const { token, base } = await ownerCallContext(deps, ownerUserId);
  const req = await fetchRequestRaw(base, token, requestId);
  const actions = Array.isArray(req.actions) ? req.actions : [];
  const match = actions.find((a) => str(a.recipient_email).toLowerCase() === String(email).toLowerCase());
  return mintEmbeddedSignUrl(base, token, requestId, str(match?.action_id) || undefined);
}

/**
 * Build the live Zoho backend from injected deps. The composition root wires the real
 * collaborators; the hermetic proxy e2e wires test doubles + points the token core at
 * an inline mock via ZOHO_*_BASE_OVERRIDE.
 */
export function makeZohoSignBackend(deps: ZohoSignDeps): ZohoSignBackend {
  return {
    isConnected: (ownerUserId) => isConnectedFor(deps, ownerUserId),
    sendForSignature: (input) => sendForSignatureImpl(deps, input),
    async getRequest(ownerUserId, requestId) {
      const { token, base } = await ownerCallContext(deps, ownerUserId);
      return fetchRequestRaw(base, token, requestId);
    },
    getSignUrl: (ownerUserId, requestId, email) => getSignUrlImpl(deps, ownerUserId, requestId, email),
    async getDocument(ownerUserId, requestId) {
      const { token, base } = await ownerCallContext(deps, ownerUserId);
      const res = await fetch(`${base}/api/v1/requests/${encodeURIComponent(requestId)}/pdf`, {
        method: 'GET',
        headers: zohoAuthHeaders(token),
      });
      if (!res.ok) throw zohoApiError('O documento assinado ainda não está disponível.', res.status, await safeText(res));
      const ab = await res.arrayBuffer();
      return { bytes: Buffer.from(ab), contentType: res.headers.get('content-type') || 'application/pdf' };
    },
  };
}

/** Default backend: nothing connected (every privileged call → not_connected → 409).
 *  Mirrors adobe-sign.notConnectedBackend; the composition root injects the live one. */
export const notConnectedZohoBackend: ZohoSignBackend = {
  async isConnected(): Promise<boolean> {
    return false;
  },
  async sendForSignature(): Promise<ZohoSendResult> {
    throw new ZohoSignNotConnectedError();
  },
  async getRequest(): Promise<ZohoRequest> {
    throw new ZohoSignNotConnectedError();
  },
  async getSignUrl(): Promise<string | null> {
    throw new ZohoSignNotConnectedError();
  },
  async getDocument(): Promise<{ bytes: Buffer; contentType: string }> {
    throw new ZohoSignNotConnectedError();
  },
};

// ----------------------------------------------------------------------------
// Inbound-webhook business logic (owner-scoped re-verify; replay-safe)
//
// Parity with adobe-sign.handleAdobeWebhook, now that Zoho replaced Adobe on the
// SALOMAO ERP. SECURITY: the webhook route is PUBLIC + credential-free, so a
// "completed" body could be forged. This handler NEVER trusts the payload for
// signature STATE — it resolves the requestId to a known ERP record via the
// owner-scoped reverse index, RE-FETCHES the request owner-scoped (injected
// getRequest), and only then confirms the CLIENT specifically signed. A
// forged/unknown/unverifiable/unsigned requestId is a fail-closed no-op. The advance
// is idempotent (guarded on stage !== 'Assinada'), so a replay advances exactly once
// and cannot race the still-running client-side portal poll into a double-advance.
// ----------------------------------------------------------------------------

/** Zoho action_status considered "signed". */
function isZohoSignedActionStatus(s: unknown): boolean {
  return String(s || '').toUpperCase() === 'SIGNED';
}

/**
 * Has the given signer ("the client") signed this request? Server-side mirror of the
 * ERP frontend's `zohoEmailSigned`: true if the WHOLE request is `completed`, OR the
 * action matching `email` is in a `SIGNED` status. Feed this the raw request from
 * `getRequest`/`fetchRequestRaw` so mid-flight (client signed, BSM pending) is detected
 * even before the request itself completes. Mirrors adobeClientSigned.
 */
export function zohoClientSigned(request: unknown, email: string): boolean {
  const r = (request || {}) as ZohoRequest;
  if (String(r.request_status || '').toLowerCase() === 'completed') return true;
  const want = String(email || '').toLowerCase();
  const actions = Array.isArray(r.actions) ? r.actions : [];
  return actions.some((a) => str(a.recipient_email).toLowerCase() === want && isZohoSignedActionStatus(a.action_status));
}

/** Injected collaborators for the inbound-webhook advance (wired at the composition
 *  root; the store-backed find + the owner-scoped re-fetch + the propostas engine).
 *  Mirrors AdobeWebhookDeps — integrations/ never reaches data/ or the backend directly
 *  from the public webhook path. */
export interface ZohoWebhookDeps {
  /** Reverse index lookup (requestId -> ERP record). Root: sign-agreements.findZohoAgreement. */
  findAgreement: (requestId: string) => Promise<ZohoAgreementRef | null>;
  /** Owner-scoped re-fetch of the live request (NEVER the payload). Root: the live Zoho
   *  backend's getRequest. */
  getRequest: (ownerUserId: string, requestId: string) => Promise<unknown>;
  /** Read the `propostas` record that owns the signature. Root: collections engine (app scope). */
  getProposta: (appId: string, id: string) => Promise<Record<string, unknown> | null>;
  /** Idempotent proposal advance. Root: collections engine upsert (app scope). */
  updateProposta: (appId: string, id: string, patch: Record<string, unknown>) => Promise<void>;
}

/** Pull the requestId + a best-effort event label out of a Zoho webhook envelope. Zoho
 *  wraps the payload under `notifications`/`requests` in different account configs; the
 *  requestId is the only field we key on (the event label is diagnostic only). */
function extractZohoWebhook(payload: Record<string, unknown>): { requestId: string; event: string } {
  const notif = ((payload?.notifications ?? payload?.requests ?? payload) || {}) as Record<string, unknown>;
  const event = String(
    (payload?.event_type as string) || (notif?.operation_type as string) || (notif?.request_status as string) || '',
  );
  const requestId = str(notif?.request_id) || str(payload?.request_id);
  return { requestId, event };
}

/**
 * Process one Zoho Sign webhook notification. Best-effort and self-contained: swallows-
 * and-logs every error so a malformed event can never crash the process or bubble back
 * to Zoho (the route already replied 200). Durable STATE ADVANCE only (stage +
 * eSignature + conversionPending); the heavy conversion still runs client-side off the
 * `conversionPending` flag. Returns a short outcome string for logging/tests.
 */
export async function handleZohoWebhook(payload: Record<string, unknown>, deps: ZohoWebhookDeps): Promise<string> {
  try {
    const { requestId, event } = extractZohoWebhook(payload || {});
    if (!requestId) return zwlog('ignored: no request_id in payload');

    const ref = await deps.findAgreement(requestId);
    // Unknown requestId = not one of our ERP requests (an account-scoped webhook fires
    // for every request in the workspace). Silent no-op, no error.
    if (!ref) return zwlog(`ignored: unknown request_id ${requestId}`);

    // Authenticity + freshness gate: re-fetch owner-scoped, never trust the payload.
    let request: unknown;
    try {
      request = await deps.getRequest(ref.ownerUserId, requestId);
    } catch (e) {
      // Fail-closed: do NOT advance on an unverifiable event. Zoho retries.
      return zwlog(`skip: getRequest failed for ${requestId}: ${(e as Error)?.message}`);
    }
    if (!zohoClientSigned(request, ref.clientEmail)) {
      return zwlog(`skip: client ${ref.clientEmail} not signed yet on ${requestId} (event ${event || 'unknown'})`);
    }

    // Idempotent advance in the app that owns the record.
    let proposta: Record<string, unknown> | null = null;
    try {
      proposta = await deps.getProposta(ref.appId, ref.propostaId);
    } catch {
      proposta = null;
    }
    if (!proposta) return zwlog(`skip: proposta ${ref.propostaId} not found in ${ref.appId}`);
    if (String(proposta.stage) === 'Assinada') return zwlog(`no-op: proposta ${ref.propostaId} already Assinada`);

    const nowIso = new Date().toISOString();
    const existingESig =
      proposta.eSignature && typeof proposta.eSignature === 'object' ? (proposta.eSignature as Record<string, unknown>) : {};
    const assinatura =
      proposta.assinatura && typeof proposta.assinatura === 'object' ? (proposta.assinatura as Record<string, unknown>) : {};
    const signatario = String(assinatura.nome || proposta.client || 'Cliente');

    await deps.updateProposta(ref.appId, ref.propostaId, {
      stage: 'Assinada',
      // Spread the existing nested eSignature so we don't clobber requestId/participants.
      eSignature: { ...existingESig, status: 'SIGNED', clientSignedAt: nowIso },
      assinaturaCliente: { nome: signatario, data: nowIso },
      assinadaEm: nowIso,
      conversionPending: true,
    });
    return zwlog(`advanced proposta ${ref.propostaId} (${ref.appId}) -> Assinada + conversionPending (request ${requestId})`);
  } catch (e) {
    return zwlog(`error: ${(e as Error)?.message}`);
  }
}

function zwlog(msg: string): string {
  console.log('[zoho-sign] webhook', msg);
  return msg;
}

// ----------------------------------------------------------------------------
// Served-app router (mirrors adobeSignRouter — X-Ekoa-App-Id → owner → backend)
// ----------------------------------------------------------------------------

const SAFE_APP_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export interface ZohoRouterDeps {
  /** Resolve X-Ekoa-App-Id (slug or id) → registered app (owner + canonical id), or null. */
  resolveApp: (idOrSlug: string) => Promise<{ appId: string; ownerUserId: string } | null>;
  /** Live Zoho backend. Default: notConnectedZohoBackend (isConnected=false, calls → not_connected). */
  backend?: ZohoSignBackend;
  /** Inbound-webhook dispatch (fired async after the 200 ack). Default: no-op (2B-S3 wires it). */
  onWebhook?: (payload: Record<string, unknown>) => Promise<unknown>;
}

/** Map a zoho-sign service error to a sanitized HTTP response (no token/secret leak). */
export function sendZohoError(res: Response, err: unknown): void {
  const e = err as { code?: string; status?: number; message?: string; detail?: string };
  if (e?.code === 'not_connected') {
    res.status(409).json({ error: 'not_connected', message: e.message || 'O Zoho Sign não está ligado.' });
    return;
  }
  const status = typeof e?.status === 'number' && e.status >= 400 && e.status < 600 ? e.status : 502;
  const message = e?.message || 'Pedido ao Zoho Sign falhou.';
  console.error('[zoho-sign]', message, e?.detail ? `· ${String(e.detail).slice(0, 300)}` : '');
  res.status(status).json({ error: message });
}

/**
 * Is `to` a safe post-sign redirect target for the /return bounce? Allows the ekoa.io
 * production hosts (https only) OR the deployment's own configured origin
 * (OAUTH_REDIRECT_BASE_URL — e.g. a self-hosted or dev http://host:port). Anything
 * else is refused so this never becomes an open redirector.
 */
function isAllowedReturnTarget(to: string): boolean {
  let u: URL;
  try {
    u = new URL(to);
  } catch {
    return false;
  }
  if (u.protocol === 'https:' && /(^|\.)ekoa\.io$/i.test(u.hostname)) return true;
  const base = (process.env.OAUTH_REDIRECT_BASE_URL ?? '').trim();
  if (base) {
    try {
      if (new URL(base).origin === u.origin) return true;
    } catch {
      /* malformed env — fall through to refuse */
    }
  }
  return false;
}

export function zohoSignRouter(deps: ZohoRouterDeps): Router {
  const r = Router();
  const backend = deps.backend ?? notConnectedZohoBackend;

  /** X-Ekoa-App-Id → registered app → ownerUserId (owner-scoped credential lookup). */
  async function requireZohoAppContext(req: Request, res: Response): Promise<{ ownerUserId: string; appId: string } | null> {
    const headerId = (req.headers['x-ekoa-app-id'] as string | undefined) || '';
    if (!headerId) {
      res.status(400).json({ error: 'Missing X-Ekoa-App-Id header' });
      return null;
    }
    const resolved = await deps.resolveApp(headerId);
    const appId = resolved?.appId ?? headerId;
    if (!SAFE_APP_ID_RE.test(appId)) {
      res.status(400).json({ error: 'Invalid X-Ekoa-App-Id header' });
      return null;
    }
    if (!resolved) {
      res.status(404).json({ error: 'Unknown app' });
      return null;
    }
    return { ownerUserId: resolved.ownerUserId, appId };
  }

  // GET /api/zoho-sign/status
  r.get('/api/zoho-sign/status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ctx = await requireZohoAppContext(req, res);
    if (!ctx) return;
    try {
      res.json({ connected: await backend.isConnected(ctx.ownerUserId) });
    } catch (err) {
      sendZohoError(res, err);
    }
  });

  // POST /api/zoho-sign/send
  r.post('/api/zoho-sign/send', async (req, res) => {
    const ctx = await requireZohoAppContext(req, res);
    if (!ctx) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const bRef = (b.externalRef && typeof b.externalRef === 'object' ? b.externalRef : {}) as Record<string, unknown>;
    try {
      const result = await backend.sendForSignature({
        ownerUserId: ctx.ownerUserId,
        documentName: String(b.documentName || 'Documento'),
        fileName: typeof b.fileName === 'string' ? b.fileName : undefined,
        html: typeof b.html === 'string' ? b.html : undefined,
        pdfBase64: typeof b.pdfBase64 === 'string' ? b.pdfBase64 : undefined,
        recipients: Array.isArray(b.recipients) ? (b.recipients as ZohoSignRecipient[]) : [],
        message: typeof b.message === 'string' ? b.message : undefined,
        redirectUrl: typeof b.redirectUrl === 'string' ? b.redirectUrl : undefined,
        language: typeof b.language === 'string' ? b.language : undefined,
        // appId is server-trusted (from the app context), never the body.
        externalRef: {
          appId: ctx.appId,
          propostaId: typeof bRef.propostaId === 'string' ? bRef.propostaId : undefined,
          clientEmail: typeof bRef.clientEmail === 'string' ? bRef.clientEmail : undefined,
        },
      });
      res.json(result);
    } catch (err) {
      sendZohoError(res, err);
    }
  });

  // GET /api/zoho-sign/requests/:id
  r.get('/api/zoho-sign/requests/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ctx = await requireZohoAppContext(req, res);
    if (!ctx) return;
    try {
      res.json({ request: await backend.getRequest(ctx.ownerUserId, req.params.id as string) });
    } catch (err) {
      sendZohoError(res, err);
    }
  });

  // GET /api/zoho-sign/requests/:id/sign-url?email=...
  r.get('/api/zoho-sign/requests/:id/sign-url', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ctx = await requireZohoAppContext(req, res);
    if (!ctx) return;
    const email = typeof req.query.email === 'string' ? req.query.email : '';
    if (!email) {
      res.status(400).json({ error: 'Parâmetro "email" em falta.' });
      return;
    }
    try {
      res.json({ signUrl: await backend.getSignUrl(ctx.ownerUserId, req.params.id as string, email) });
    } catch (err) {
      sendZohoError(res, err);
    }
  });

  // GET /api/zoho-sign/requests/:id/document
  r.get('/api/zoho-sign/requests/:id/document', async (req, res) => {
    const ctx = await requireZohoAppContext(req, res);
    if (!ctx) return;
    try {
      const { bytes, contentType } = await backend.getDocument(ctx.ownerUserId, req.params.id as string);
      res.status(200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="zoho-request-${req.params.id}.pdf"`);
      // nosniff hardens the binary-serving path: bytes are the owner-scoped signed
      // document (Zoho-sourced PDF), Content-Type is set explicitly above, and the
      // browser must not content-type-sniff it into HTML/script.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Reviewed false-positive (XSS SAST): not HTML. Explicit binary Content-Type +
      // nosniff on owner-scoped PDF bytes; mirrors the accepted adobe-sign.ts:452 precedent
      // (this path additionally sets nosniff, which Adobe's does not).
      res.send(bytes); // nosemgrep
    } catch (err) {
      sendZohoError(res, err);
    }
  });

  // GET/POST /api/zoho-sign/webhook — deliberately public + credential-free (Zoho has
  // no app context). SECURITY: the payload is NEVER trusted for signature STATE — the
  // ack is immediate; any real advance re-fetches owner-scoped in the injected onWebhook
  // handler (2B-S3). Ack first, then dispatch async — never block Zoho.
  r.get('/api/zoho-sign/webhook', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true });
  });
  r.post('/api/zoho-sign/webhook', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true });
    const payload = (req.body ?? {}) as Record<string, unknown>;
    if (deps.onWebhook) {
      Promise.resolve(deps.onWebhook(payload)).catch((e) => console.error('[zoho-sign] webhook dispatch failed:', (e as Error)?.message));
    }
  });

  // GET /api/zoho-sign/return — post-sign redirect bounce. Zoho's redirect_pages rejects
  // a bare '#' fragment, so sendForSignature points redirect_pages here with the real
  // (hash) app URL url-encoded in `to`; we 302 to it so the browser loads the hash route.
  // The ekoa.io / configured-origin guard prevents this becoming an open redirector.
  r.get('/api/zoho-sign/return', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    if (!isAllowedReturnTarget(to)) {
      res.status(400).send('invalid redirect target');
      return;
    }
    res.redirect(302, to);
  });

  return r;
}
