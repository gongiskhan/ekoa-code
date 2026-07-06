/**
 * End-user SSO for served artifacts (ch03 §3.9, FIXED-9). Two credential paths mint the
 * SAME per-app HttpOnly session cookie so a served app can offer Microsoft SSO AND
 * app-declared username/password sign-in, with whoami()/signOut() working identically:
 *
 *   - Microsoft OIDC authorization-code + PKCE (`/microsoft/start` + `/callback`): logs an
 *     `/apps/{id}/` visitor in as THEMSELVES (an ERP login), entirely separate from the
 *     workspace integration token. Server-mediated code flow with PKCE + nonce; identity
 *     lands in the per-app cookie. The app JS never sees the token - identity comes only
 *     from GET /me; the visitor's delegated Graph token (if granted) is proxied through
 *     ALL /m365/* and never exposed.
 *   - App-declared password auth (`/login` + `/set-password`): the app names its own user
 *     collection + identity field, so this stays domain-agnostic; the bcrypt hash lives on
 *     the app's own app-data row (`passwordHash`) and is never returned.
 *
 * Ported from cortex/src/services/app-sso.ts + the /api/app-sso routes in cortex/src/
 * server.ts. Carried security properties (invisible-behaviors §1.8): atomic single-use
 * state consumption, timing-safe-ish password compare (always-run bcrypt, dummy hash on
 * miss), session-bound auth collection for the set-password privilege check, per-app
 * cookie isolation by NAME + server-side appId check (never by path). Amendment 2: the
 * data-bearing routes (login/set-password/m365) consult the artifact OWNER's activation.
 *
 * Egress note: id_token validation verifies RS256 against Microsoft's per-tenant JWKS
 * using node:crypto (the repo carries no `jose`); see validateIdToken.
 */
import { Router, json as expressJson, raw as expressRaw, type Request, type Response } from 'express';
import { createHash, randomBytes, createPublicKey, createVerify } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { CollectionsEngine, appScope, collectionName } from '../data/collections-engine.js';
import { encrypt, decrypt } from '../data/crypto.js';
import { checkOwnerActivation, type ResolveAppScope } from './app-scope.js';
import {
  appSessions,
  pendingAppAuth,
  findValidAppSession,
  consumePendingAppAuth,
  APP_SESSION_TTL_MS,
  PENDING_AUTH_TTL_MS,
  type AppSessionDoc,
} from './app-sso-sessions.js';

// ---------------------------------------------------------------------------
// Microsoft SSO config (env; config.ts does not yet carry platformIntegrations)
// ---------------------------------------------------------------------------

function ssoClientId(): string { return process.env.MICROSOFT_SSO_CLIENT_ID || ''; }
function ssoClientSecret(): string { return process.env.MICROSOFT_SSO_CLIENT_SECRET || ''; }
function ssoTenantId(): string { return process.env.MICROSOFT_SSO_TENANT_ID || ''; }
function ssoRedirectUriEnv(): string { return process.env.MICROSOFT_SSO_REDIRECT_URI || ''; }

export function isSsoConfigured(): boolean {
  return Boolean(ssoClientId() && ssoClientSecret());
}

/** Personal/consumer Microsoft accounts (outlook.com/live.com) resolve here. */
export const MSA_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

// Identity + delegated Graph scopes so a served artifact can act AS the signed-in user;
// offline_access yields a refresh token so those actions survive the ~1h access-token life.
const SSO_SCOPES = 'openid profile email offline_access Mail.Send Calendars.ReadWrite';

function authority(): string {
  return `https://login.microsoftonline.com/${ssoTenantId() || 'common'}`;
}

// ---------------------------------------------------------------------------
// PKCE + tokens (pure/testable except the external fetches)
// ---------------------------------------------------------------------------

export interface Pkce { verifier: string; challenge: string }

/** RFC 7636 PKCE pair: base64url verifier, S256 challenge. */
export function generatePkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Opaque high-entropy token (state, nonce, session id). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export interface AuthorizeParams { state: string; nonce: string; codeChallenge: string; redirectUri: string }

export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const params = new URLSearchParams({
    client_id: ssoClientId(),
    response_type: 'code',
    redirect_uri: p.redirectUri,
    response_mode: 'query',
    scope: SSO_SCOPES,
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${authority()}/oauth2/v2.0/authorize?${params.toString()}`;
}

export interface ExchangeResult { idToken: string; accessToken: string; refreshToken: string; expiresIn: number }

export async function exchangeCode(opts: { code: string; codeVerifier: string; redirectUri: string }): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    client_id: ssoClientId(),
    client_secret: ssoClientSecret(),
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
    scope: SSO_SCOPES,
  });
  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`SSO token exchange failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { id_token?: string; access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.id_token) throw new Error('SSO token exchange returned no id_token');
  return { idToken: data.id_token, accessToken: data.access_token || '', refreshToken: data.refresh_token || '', expiresIn: data.expires_in || 3600 };
}

export interface RefreshResult { accessToken: string; refreshToken: string; expiresIn: number }

export async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  const body = new URLSearchParams({
    client_id: ssoClientId(),
    client_secret: ssoClientSecret(),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SSO_SCOPES,
  });
  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`SSO token refresh failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('SSO token refresh returned no access_token');
  return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken, expiresIn: data.expires_in || 3600 };
}

// ---------------------------------------------------------------------------
// id_token validation (the security boundary) — RS256 via node:crypto + per-tenant JWKS
// ---------------------------------------------------------------------------

export interface SsoIdentity { email: string; name?: string; oid?: string; tid?: string; preferredUsername?: string }

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface Jwk { kid?: string; kty?: string; n?: string; e?: string; use?: string; [k: string]: unknown }
const jwksByTenant = new Map<string, { at: number; keys: Jwk[] }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

async function jwksForTenant(tid: string): Promise<Jwk[]> {
  const cached = jwksByTenant.get(tid);
  if (cached && Date.now() - cached.at < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(`https://login.microsoftonline.com/${tid}/discovery/v2.0/keys`);
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status}) for tenant ${tid}`);
  const json = (await res.json()) as { keys?: Jwk[] };
  const keys = json.keys ?? [];
  jwksByTenant.set(tid, { at: Date.now(), keys });
  return keys;
}

function b64urlJson(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/**
 * Cryptographically validate a Microsoft id_token and return the caller's identity. Pins:
 * signature (per-tenant JWKS, RS256), audience (our SSO client id), nonce. Validates issuer
 * dynamically as `https://login.microsoftonline.com/{tid}/v2.0` against the token's own
 * tenant (required for a `common`-audience app). Throws on any failure.
 */
export async function validateIdToken(idToken: string, expectedNonce: string): Promise<SsoIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('id_token is not a well-formed JWT');
  const [h, p, s] = parts as [string, string, string];

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = b64urlJson(h);
    payload = b64urlJson(p);
  } catch {
    throw new Error('id_token is not a well-formed JWT');
  }

  const unsafeTid = payload.tid;
  if (typeof unsafeTid !== 'string' || !GUID_RE.test(unsafeTid)) {
    throw new Error('id_token has a missing or malformed tenant id (tid)');
  }
  if (header.alg !== 'RS256') throw new Error('id_token alg is not RS256');

  const keys = await jwksForTenant(unsafeTid);
  const jwk = keys.find((k) => k.kid === header.kid && (k.kty === 'RSA' || k.kty === undefined));
  const n = jwk?.n;
  const e = jwk?.e;
  if (!n || !e) throw new Error('id_token signing key not found in tenant JWKS');

  let verified: boolean;
  try {
    const pub = createPublicKey({ key: { kty: 'RSA', n, e }, format: 'jwk' });
    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${p}`);
    v.end();
    verified = v.verify(pub, Buffer.from(s, 'base64url'));
  } catch (err) {
    throw new Error(`id_token signature validation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!verified) throw new Error('id_token signature did not verify');

  if (payload.aud !== ssoClientId()) throw new Error('id_token audience mismatch');
  const expectedIssuer = `https://login.microsoftonline.com/${unsafeTid}/v2.0`;
  if (payload.iss !== expectedIssuer) throw new Error('id_token issuer does not match its tenant');

  const nowSec = Math.floor(Date.now() / 1000);
  const skew = 60;
  if (typeof payload.exp === 'number' && payload.exp + skew < nowSec) throw new Error('id_token expired');
  if (typeof payload.nbf === 'number' && payload.nbf - skew > nowSec) throw new Error('id_token not yet valid');
  if (!payload.nonce || payload.nonce !== expectedNonce) throw new Error('id_token nonce mismatch (possible replay)');

  const claims = payload as { email?: string; name?: string; oid?: string; tid?: string; preferred_username?: string };
  const email = claims.email || claims.preferred_username || '';
  if (!email) throw new Error('id_token carried no email or preferred_username claim');
  return { email, name: claims.name, oid: claims.oid, tid: claims.tid || unsafeTid, preferredUsername: claims.preferred_username };
}

// ---------------------------------------------------------------------------
// Cookies + safe-appId (pure)
// ---------------------------------------------------------------------------

export const APP_SSO_COOKIE_PREFIX = 'ekoa_app_sso_';
export const APP_SSO_CALLBACK_PATH = '/api/app-sso/microsoft/callback';

const SAFE_APP_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;
export function isSafeAppId(appId: unknown): appId is string {
  return typeof appId === 'string' && SAFE_APP_ID_RE.test(appId);
}

/** Per-app session cookie name. Isolation is by NAME + a server-side appId check, never
 *  by cookie path. Throws on an unsafe appId so a crafted id can never reach a cookie name. */
export function appSsoCookieName(appId: string): string {
  if (!isSafeAppId(appId)) throw new Error(`Refusing to build an SSO cookie name for an unsafe appId: ${String(appId).slice(0, 40)}`);
  return APP_SSO_COOKIE_PREFIX + appId;
}

/** The post-login return target must be an absolute path inside /apps/ on this same origin
 *  (open-redirect guard for the `return` query param). */
export function isSafeReturnPath(pth: unknown): pth is string {
  return (
    typeof pth === 'string' &&
    pth.length > 0 &&
    pth.length < 2048 &&
    pth.startsWith('/apps/') &&
    !pth.startsWith('//') &&
    !pth.includes('\\') &&
    !pth.includes('://') &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x1f]/.test(pth)
  );
}

/** Set-Cookie for the per-app session. Path scoped to the SSO endpoints; isolation is by
 *  name + server-side appId check. crossSite true emits CHIPS (SameSite=None; Secure;
 *  Partitioned) for the cross-site dashboard iframe; false emits SameSite=Lax. maxAgeMs 0
 *  clears the cookie. */
export function buildSessionCookie(name: string, value: string, maxAgeMs: number, opts: { crossSite: boolean }): string {
  const base = `${name}=${value}; Path=/api/app-sso; HttpOnly; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
  return opts.crossSite ? `${base}; Secure; SameSite=None; Partitioned` : `${base}; SameSite=Lax`;
}

function readNamedCookie(req: Request, name: string): string | undefined {
  const cookieHeader = (req.headers.cookie || '') as string;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|;\\s*)' + escaped + '=([^;]+)').exec(cookieHeader)?.[1];
}

function requestOrigin(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol;
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.get('host') || '';
  return `${proto}://${host}`;
}

function ssoRedirectUri(req: Request): string {
  return ssoRedirectUriEnv() || `${requestOrigin(req)}${APP_SSO_CALLBACK_PATH}`;
}

function escapeHtmlBasic(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
}
function ssoErrorPage(message: string): string {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign-in failed</title></head>' +
    '<body style="font-family:system-ui;text-align:center;padding:3rem;color:#525252;">' +
    '<h2>Sign-in failed</h2><p>' + escapeHtmlBasic(message) + '</p>' +
    '<p style="font-size:13px;color:#a3a3a3;">You can close this window and try again.</p></body></html>'
  );
}
function ssoAdminConsentPage(tenant?: string): string {
  const tenantLine = tenant ? '<p style="font-size:13px;color:#a3a3a3;">Tenant: ' + escapeHtmlBasic(tenant) + '</p>' : '';
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Consentimento concedido</title></head>' +
    '<body style="font-family:system-ui;text-align:center;padding:3rem;color:#525252;">' +
    '<h2>Consentimento concedido</h2>' +
    '<p>A aplicação Ekoa foi autorizada na sua organização. Os utilizadores já podem iniciar sessão com as suas contas Microsoft 365.</p>' +
    tenantLine + '<p style="font-size:13px;color:#a3a3a3;">Pode fechar esta janela.</p></body></html>'
  );
}

// ---------------------------------------------------------------------------
// App-declared password auth helpers (ported)
// ---------------------------------------------------------------------------

const APP_AUTH_PRIVILEGED_ROLES = ['master', 'coordenador'];
const BCRYPT_COST = 12;
let _dummyHash: Promise<string> | null = null;
function appAuthDummyHash(): Promise<string> {
  if (!_dummyHash) _dummyHash = bcrypt.hash('ekoa-app-auth-no-such-user', BCRYPT_COST);
  return _dummyHash;
}

interface AppAuthRequest { collection: string; identityField: string; identity: string; password: string }
function readAppAuthBody(req: Request): AppAuthRequest | null {
  const b = (req.body || {}) as Record<string, unknown>;
  const collection = typeof b.collection === 'string' ? b.collection : '';
  const identityField = typeof b.identityField === 'string' ? b.identityField : '';
  const identity = typeof b.identity === 'string' ? b.identity.trim() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!collectionName.safeParse(collection).success) return null;
  if (!/^[A-Za-z0-9_]{1,40}$/.test(identityField)) return null;
  if (!identity || !password) return null;
  return { collection, identityField, identity, password };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface AppSsoDeps {
  now: () => number;
  genId: () => string;
  /** Injected by server.ts (see app-scope.ts) so integrations/ never imports apps/. */
  resolveAppScope: ResolveAppScope;
  /** Cross-site (CHIPS) cookie attributes. Defaults to NODE_ENV === 'production'. */
  crossSite?: boolean;
}

export function appSsoRouter(deps: AppSsoDeps): Router {
  const r = Router();
  const engine = new CollectionsEngine({ now: deps.now, genId: deps.genId });
  const crossSite = deps.crossSite ?? process.env.NODE_ENV === 'production';
  const setCookie = (name: string, value: string, maxAgeMs: number) => buildSessionCookie(name, value, maxAgeMs, { crossSite });

  /** Resolve the header to a canonical, cookie-safe app id, or null. */
  async function resolveCanonical(req: Request): Promise<{ appId: string; ownerUserId: string } | null> {
    const headerId = (req.headers['x-ekoa-app-id'] as string | undefined) || '';
    if (!headerId) return null;
    const app = await deps.resolveAppScope(headerId);
    if (!app || !isSafeAppId(app.appId)) return null;
    return { appId: app.appId, ownerUserId: app.ownerUserId };
  }

  /** Find a user row in the app's own app-data collection by identity field. */
  async function findUser(appId: string, collection: string, identityField: string, identity: string): Promise<Record<string, unknown> | null> {
    const rows = await engine.list(appScope(appId), collection);
    const want = identity.trim().toLowerCase();
    return rows.find((row) => String(row[identityField] ?? '').trim().toLowerCase() === want) ?? null;
  }

  // --- Username/password sign-in → mints the per-app session cookie -------------------
  r.post('/login', expressJson({ limit: '256kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const scope = await resolveCanonical(req);
    if (!scope) { res.status(400).json({ success: false, error: 'missing_or_invalid_app_id' }); return; }
    const gate = checkOwnerActivation(scope.ownerUserId);
    if (!gate.ok) { res.status(gate.status).json(gate.body); return; }
    const body = readAppAuthBody(req);
    if (!body) { res.status(400).json({ success: false, error: 'invalid_request' }); return; }
    try {
      const row = await findUser(scope.appId, body.collection, body.identityField, body.identity);
      const storedHash = row && typeof row.passwordHash === 'string' ? (row.passwordHash as string) : '';
      // Always run a bcrypt compare (real or dummy) to blunt user-enumeration timing.
      const valid = await bcrypt.compare(body.password, storedHash || (await appAuthDummyHash())).catch(() => false);
      if (!row || !storedHash || !valid) { res.status(401).json({ success: false, error: 'invalid_credentials' }); return; }
      const now = deps.now();
      const session: AppSessionDoc = {
        _id: randomToken(),
        appId: scope.appId,
        email: body.identity,
        name: typeof row.name === 'string' ? (row.name as string) : undefined,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + APP_SESSION_TTL_MS).toISOString(),
        // Bind authorization to the collection we actually verified against.
        authCollection: body.collection,
        authIdentityField: body.identityField,
      };
      await appSessions.insert(session);
      res.setHeader('Set-Cookie', setCookie(appSsoCookieName(scope.appId), session._id, APP_SESSION_TTL_MS));
      res.json({ success: true, data: { email: session.email, name: session.name || null } });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- Set/reset a user's password (self, or privileged caller in own collection) -----
  r.post('/set-password', expressJson({ limit: '256kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const scope = await resolveCanonical(req);
    if (!scope) { res.status(400).json({ success: false, error: 'missing_or_invalid_app_id' }); return; }
    const gate = checkOwnerActivation(scope.ownerUserId);
    if (!gate.ok) { res.status(gate.status).json(gate.body); return; }
    const body = readAppAuthBody(req);
    if (!body) { res.status(400).json({ success: false, error: 'invalid_request' }); return; }
    const token = readNamedCookie(req, appSsoCookieName(scope.appId));
    const session = token ? await findValidAppSession(token, scope.appId) : null;
    if (!session) { res.status(401).json({ success: false, error: 'not_authenticated' }); return; }
    try {
      const sameEmail = body.identity.trim().toLowerCase() === String(session.email).trim().toLowerCase();
      // "Self" = the EXACT authenticated principal (for password sessions: same collection +
      // identity field the session logged in against), not merely a matching email string.
      const isSelf = sameEmail && (!session.authCollection
        || (body.collection === session.authCollection && body.identityField === session.authIdentityField));
      if (!isSelf) {
        // Authorize against the collection this session authenticated against at login
        // (server-established) — NEVER the request's collection.
        const callerColl = session.authCollection || body.collection;
        const callerField = session.authIdentityField || body.identityField;
        const caller = await findUser(scope.appId, callerColl, callerField, session.email);
        const callerRole = caller && typeof caller.role === 'string' ? (caller.role as string) : '';
        if (!APP_AUTH_PRIVILEGED_ROLES.includes(callerRole)) { res.status(403).json({ success: false, error: 'forbidden' }); return; }
        if (session.authCollection && body.collection !== session.authCollection) {
          res.status(403).json({ success: false, error: 'forbidden_collection' }); return;
        }
      }
      const target = await findUser(scope.appId, body.collection, body.identityField, body.identity);
      if (!target || typeof target.id !== 'string') { res.status(404).json({ success: false, error: 'user_not_found' }); return; }
      const hash = await bcrypt.hash(body.password, BCRYPT_COST);
      await engine.upsert(appScope(scope.appId), body.collection, target.id as string, { passwordHash: hash });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --- who am I? (per-app cookie; 401 when signed out; identity when signed in) -------
  r.get('/me', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const scope = await resolveCanonical(req);
    const token = scope ? readNamedCookie(req, appSsoCookieName(scope.appId)) : undefined;
    const session = scope && token ? await findValidAppSession(token, scope.appId) : null;
    if (!session) { res.status(401).json({ success: false, error: 'not_authenticated' }); return; }
    res.json({
      success: true,
      data: {
        email: session.email,
        name: session.name || null,
        oid: session.oid || null,
        tid: session.tid || null,
        canSendMail: Boolean(session.graphTokensEnc),
      },
    });
  });

  // --- sign out — delete the session + clear the per-app cookie -----------------------
  r.post('/logout', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const scope = await resolveCanonical(req);
    if (scope) {
      const cookieName = appSsoCookieName(scope.appId);
      const token = readNamedCookie(req, cookieName);
      if (token) await appSessions.delete(token).catch(() => {});
      res.setHeader('Set-Cookie', setCookie(cookieName, '', 0));
    }
    res.json({ success: true });
  });

  // --- Microsoft OIDC: begin sign-in --------------------------------------------------
  r.get('/microsoft/start', async (req, res) => {
    if (!isSsoConfigured()) {
      res.status(503).type('text/html').send(ssoErrorPage('Microsoft sign-in is not configured for this platform.'));
      return;
    }
    const rawAppId = (req.query.appId as string | undefined) || '';
    if (!rawAppId) { res.status(400).type('text/html').send(ssoErrorPage('Missing appId.')); return; }
    const app = await deps.resolveAppScope(rawAppId);
    if (!app || !isSafeAppId(app.appId)) { res.status(400).type('text/html').send(ssoErrorPage('Invalid appId.')); return; }

    const returnUrl = isSafeReturnPath(req.query.return) ? (req.query.return as string) : `/apps/${encodeURIComponent(rawAppId)}/`;
    const state = randomToken();
    const nonce = randomToken();
    const pkce = generatePkce();
    const redirectUri = ssoRedirectUri(req);
    const now = deps.now();
    await pendingAppAuth.insert({
      _id: state,
      appId: app.appId,
      nonce,
      pkceVerifier: pkce.verifier,
      returnUrl,
      redirectUri,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PENDING_AUTH_TTL_MS).toISOString(),
    });
    res.redirect(302, buildAuthorizeUrl({ state, nonce, codeChallenge: pkce.challenge, redirectUri }));
  });

  // --- Microsoft OIDC: callback (single-use state, id_token validation, session) ------
  r.get('/microsoft/callback', async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const aadError = (req.query.error_description as string | undefined) || (req.query.error as string | undefined);

    const adminConsent = req.query.admin_consent as string | undefined;
    if (adminConsent && adminConsent.toLowerCase() === 'true' && !code) {
      res.status(200).type('text/html').send(ssoAdminConsentPage(req.query.tenant as string | undefined));
      return;
    }
    if (aadError && !code) { res.status(400).type('text/html').send(ssoErrorPage('Microsoft returned an error during sign-in.')); return; }
    if (!code || !state) { res.status(400).type('text/html').send(ssoErrorPage('Missing authorization code or state.')); return; }

    // Single-use lookup by state (consumed on read → no replay).
    const pending = await consumePendingAppAuth(state);
    if (!pending) {
      res.status(400).type('text/html').send(ssoErrorPage('Your sign-in session expired or was already used. Please try again.'));
      return;
    }
    try {
      const tokens = await exchangeCode({ code, codeVerifier: pending.pkceVerifier, redirectUri: pending.redirectUri });
      const identity = await validateIdToken(tokens.idToken, pending.nonce);
      const now = deps.now();
      const session: AppSessionDoc = {
        _id: randomToken(),
        appId: pending.appId,
        email: identity.email,
        name: identity.name,
        oid: identity.oid,
        tid: identity.tid,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + APP_SESSION_TTL_MS).toISOString(),
      };
      if (tokens.accessToken) {
        try {
          session.graphTokensEnc = encrypt(JSON.stringify({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken }));
          session.graphTokenExpiresAt = new Date(now + tokens.expiresIn * 1000).toISOString();
        } catch (e) {
          console.warn('[app-sso] could not persist graph token:', e instanceof Error ? e.message : e);
        }
      }
      await appSessions.insert(session);
      res.setHeader('Set-Cookie', setCookie(appSsoCookieName(pending.appId), session._id, APP_SESSION_TTL_MS));
      res.redirect(302, pending.returnUrl);
    } catch (err) {
      console.error('[app-sso] callback failed:', err instanceof Error ? err.message : err);
      res.status(500).type('text/html').send(ssoErrorPage('Could not complete sign-in. Please try again.'));
    }
  });

  // --- Visitor Microsoft Graph proxy (acts AS the signed-in visitor) ------------------
  r.all(/^\/m365\/(.+)$/, expressRaw({ type: '*/*', limit: '30mb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const scope = await resolveCanonical(req);
    if (!scope) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const gate = checkOwnerActivation(scope.ownerUserId);
    if (!gate.ok) { res.status(gate.status).json(gate.body); return; }
    const token = readNamedCookie(req, appSsoCookieName(scope.appId));
    const session = token ? await findValidAppSession(token, scope.appId) : null;
    if (!session) { res.status(401).json({ error: 'not_authenticated' }); return; }

    const accessToken = await getSessionGraphAccessToken(session);
    if (!accessToken) { res.status(403).json({ error: 'graph_not_authorized', message: 'Sign in again to grant email/calendar access.' }); return; }

    const graphPath = (req.params as Record<string, string>)[0] ?? '';
    try {
      await proxyToGraph(req, res, graphPath, accessToken);
    } catch (err) {
      console.error(`[app-sso-m365] ${req.method} ${graphPath} failed:`, err instanceof Error ? err.message : err);
      res.status(502).json({ error: `Microsoft Graph proxy error: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  return r;
}

/**
 * Decrypt and return a valid Graph access token for a session, refreshing + re-persisting
 * when within 60s of expiry. Null when the session carries no graph token or the refresh
 * failed (revoked/expired) — the app must then re-consent.
 */
async function getSessionGraphAccessToken(session: AppSessionDoc): Promise<string | null> {
  if (!session.graphTokensEnc) return null;
  let parsed: { access_token?: string; refresh_token?: string };
  try {
    parsed = JSON.parse(decrypt(session.graphTokensEnc));
  } catch {
    return null;
  }
  const exp = session.graphTokenExpiresAt ? Date.parse(session.graphTokenExpiresAt) : 0;
  if (parsed.access_token && exp && Date.now() < exp - 60_000) return parsed.access_token;
  if (!parsed.refresh_token) return parsed.access_token || null;
  try {
    const refreshed = await refreshAccessToken(parsed.refresh_token);
    await appSessions.update(session._id, (cur) => ({
      ...cur,
      graphTokensEnc: encrypt(JSON.stringify({ access_token: refreshed.accessToken, refresh_token: refreshed.refreshToken })),
      graphTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
    }));
    return refreshed.accessToken;
  } catch (err) {
    console.warn('[app-sso-m365] graph token refresh failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Forward a request verbatim to Microsoft Graph with the given bearer, mirroring the
 *  upstream status + content-type. Raw bodies pass through; a pre-parsed JSON body (when
 *  a global json parser ran first) is re-serialized so JSON POSTs still forward. */
export async function proxyToGraph(req: Request, res: Response, graphPath: string, accessToken: string): Promise<void> {
  const targetUrl = new URL(`https://graph.microsoft.com/${graphPath}`);
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== 'token') targetUrl.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  const ct = req.headers['content-type'];
  if (ct) headers['Content-Type'] = String(ct);

  let bodyBytes: Uint8Array | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (Buffer.isBuffer(req.body) && req.body.length > 0) bodyBytes = new Uint8Array(req.body);
    else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      bodyBytes = new Uint8Array(Buffer.from(JSON.stringify(req.body)));
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }
  }
  const upstream = await fetch(targetUrl.toString(), { method: req.method, headers, body: bodyBytes });
  const text = await upstream.text();
  res.status(upstream.status);
  res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
  res.send(text);
}
