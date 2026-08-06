/**
 * Zoho Sign OAuth 2.0 browser-popup connect — the customer-facing way to connect Zoho Sign.
 *
 * Ported from ekoa-dev (`09a29bb7` popup flow, `e620e740` OAuth-only schema, `d8e4538e` clear the
 * pasted client credentials). Before this, the only way to connect Zoho here was the Self Client
 * route: create an app at api-console.zoho.<dc>, paste a client id + secret, then paste a
 * `grant_code` that expires in minutes. That path stays for operator recovery, but it must not be
 * what a customer is asked to do - upstream's commit message records why in one line: Chrome saw a
 * text input followed by a password input, decided it was a login form, and injected the user's
 * Ekoa credentials into the client id and secret.
 *
 * WHY THIS IS NOT A `PlatformProvider`. Google and Microsoft connect into org-scoped
 * `platform-<orgId>-<provider>` rows that only `platform-call.ts` reads. Zoho's credentials are
 * read by the zoho-sign SERVICE and by the generic action executor, both of which resolve the
 * `zoho-sign` INTEGRATION CONFIG for an owner. So this flow writes its grant into that config's
 * encrypted bundle - the same bundle the manual path writes - and everything downstream is
 * unchanged. Adding a third platform provider would have created a second, unread home for the
 * same credential.
 *
 * THE THREE FIELDS THE CALLBACK DELETES are the whole point of `d8e4538e`, and they are the
 * difference between a connect that works and one that "succeeds" and can never mint a token:
 * `getZohoAccessToken` prefers a stored `client_id`/`client_secret` over the platform client from
 * env, so a refresh_token minted by the PLATFORM client but refreshed against a stale PASTED
 * client gets `invalid_code` from Zoho. The one-time `grant_code` goes for the same reason - this
 * consent supersedes it. Clearing uses the `CLEAR_CREDENTIAL` sentinel because credential writes
 * MERGE: an empty string reads as "field untouched" and the stale values would survive.
 *
 * Boundaries: integrations/ may not import auth/, so the connect route's admin gate is INJECTED by
 * the composition root, exactly as m365-proxy.ts takes its JWT verifier.
 */
import { Router, type Request, type Response, type RequestHandler } from 'express';
import { loadZohoEnv, zohoAccountsBase, isValidZohoDc } from './zoho-sign.js';
// The sentinel belongs to the credential-merge rule in service.ts - it is what makes the
// callback's three deletions actually delete rather than read as "field untouched".
import { CLEAR_CREDENTIAL } from './service.js';

/** Zoho Sign scopes the platform client asks for. Zoho takes a COMMA-separated list, not spaces. */
const ZOHO_SCOPES = 'ZohoSign.documents.ALL,ZohoSign.account.READ';

/** How long a pending connect's CSRF state stays valid. */
const STATE_TTL_MS = 10 * 60 * 1000;

/** True when this deployment holds a Zoho OAuth client, i.e. the popup can work at all. */
export function isZohoPlatformClientConfigured(): boolean {
  const env = loadZohoEnv();
  return Boolean(env.clientId.trim() && env.clientSecret.trim());
}

/**
 * The registered redirect URI. `ZOHO_OAUTH_REDIRECT_BASE_URL` overrides the shared
 * `OAUTH_REDIRECT_BASE_URL` for Zoho only: Zoho accepts `http://localhost` redirects, so local
 * development needs no tunnel while Google/Microsoft may need one.
 */
export function zohoRedirectUri(): string {
  const base = (process.env.ZOHO_OAUTH_REDIRECT_BASE_URL || process.env.OAUTH_REDIRECT_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/api/v1/oauth/zoho/callback`;
}

/** The data centre the PLATFORM's OAuth client is registered in - where authorize runs. */
function configuredDc(): string {
  const dc = loadZohoEnv().dc.trim().toLowerCase();
  return isValidZohoDc(dc) ? dc : 'eu';
}

/**
 * Authorize on the DC the OAuth client is registered in. `access_type=offline` + `prompt=consent`
 * make Zoho issue a refresh_token on EVERY connect rather than only the first, so reconnecting is
 * always a repair for a lost or revoked token instead of a no-op.
 */
export function getZohoAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: loadZohoEnv().clientId,
    scope: ZOHO_SCOPES,
    redirect_uri: zohoRedirectUri(),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${zohoAccountsBase(configuredDc(), process.env.ZOHO_ACCOUNTS_BASE_OVERRIDE)}/oauth/v2/auth?${params.toString()}`;
}

/**
 * The account's real data centre, from Zoho's `location` callback param.
 *
 * SECURITY: `location` arrives on an unauthenticated redirect an attacker can craft, and the
 * client_secret is POSTed to the host derived from it. So the raw value NEVER reaches a host
 * string - it is whitelisted first, and anything unrecognised falls back to the platform client's
 * own DC. (`us` is Zoho's spelling of `com`.)
 */
export function dcFromCallbackLocation(location: unknown): string {
  const raw = String(location ?? '').trim().toLowerCase().replace(/^\./, '');
  const dc = raw === 'us' ? 'com' : raw;
  return isValidZohoDc(dc) ? dc : configuredDc();
}

export interface ZohoOAuthBundle {
  refresh_token: string;
  /** Normalised data centre - drives sign.zoho.<dc> for every later call. */
  dc: string;
  auth_type: 'oauth2';
}

/** Injectable transport so tests never touch a live provider. */
export type ZohoHttp = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

const defaultHttp: ZohoHttp = (url, init) => fetch(url, init) as unknown as ReturnType<ZohoHttp>;

/**
 * Redeem the authorization code for a permanent refresh token.
 *
 * Two Zoho-specific failure shapes are handled explicitly because both look like success
 * otherwise: Zoho commonly answers HTTP 200 with `{ error: "invalid_code" }`, and it will answer a
 * perfectly valid 200 with NO refresh_token when the consent was granted without offline access.
 */
export async function exchangeZohoCode(code: string, location?: string, http: ZohoHttp = defaultHttp): Promise<ZohoOAuthBundle> {
  const dc = dcFromCallbackLocation(location);
  const env = loadZohoEnv();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: zohoRedirectUri(),
  });
  const res = await http(`${zohoAccountsBase(dc, process.env.ZOHO_ACCOUNTS_BASE_OVERRIDE)}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  let d: { refresh_token?: string; error?: unknown } = {};
  try {
    d = JSON.parse(text) as typeof d;
  } catch {
    d = {};
  }
  if (!res.ok || d.error) {
    const detail = typeof d.error === 'string' ? d.error : `HTTP ${res.status}`;
    throw new Error(`Zoho token exchange failed (${detail})`);
  }
  if (!d.refresh_token) {
    throw new Error(
      'Zoho returned no refresh_token for the authorization code (the consent may have been granted without offline access - reconnect and accept the prompt).',
    );
  }
  return { refresh_token: d.refresh_token, dc, auth_type: 'oauth2' };
}

// ----------------------------------------------------------------------------
// Connect / callback, over injected store seams (integrations/ owns no store access here)
// ----------------------------------------------------------------------------

/** The one row this flow reads and writes: the caller's `zoho-sign` integration config. */
export interface ZohoOAuthRow {
  _id: string;
  ownerUserId?: string;
  orgId: string;
}

export interface ZohoOAuthDeps {
  now: () => number;
  /** Find-or-create the caller's zoho-sign config row, stamping the pending CSRF state on it. */
  beginConnect: (actor: { userId: string; orgId: string; isAdmin: boolean }, state: string, expiresAt: number) => Promise<ZohoOAuthRow>;
  /** The row holding this pending state, or null when it is unknown or expired. */
  findByState: (state: string, now: number) => Promise<ZohoOAuthRow | null>;
  /** Merge the grant into the row's encrypted bundle, enable it, clear the pending state. */
  persistGrant: (row: ZohoOAuthRow, patch: Record<string, unknown>) => Promise<void>;
  /** High-entropy state nonce. */
  genState: () => string;
  http?: ZohoHttp;
}

export type ConnectOutcome =
  | { ok: true; authUrl: string; state: string }
  | { ok: false; code: 'not_configured' };

export async function startZohoConnect(
  actor: { userId: string; orgId: string; isAdmin: boolean },
  deps: ZohoOAuthDeps,
): Promise<ConnectOutcome> {
  if (!isZohoPlatformClientConfigured()) return { ok: false, code: 'not_configured' };
  const state = deps.genState();
  await deps.beginConnect(actor, state, deps.now() + STATE_TTL_MS);
  return { ok: true, authUrl: getZohoAuthUrl(state), state };
}

export type CallbackOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Complete the popup flow. Every refusal is a rendered page, never a throw: this route is what a
 * customer's browser lands on, and an unhandled error there is a blank tab with no way back.
 */
export async function completeZohoCallback(
  q: { code?: string; state?: string; location?: string; error?: string },
  deps: ZohoOAuthDeps,
): Promise<CallbackOutcome> {
  if (!q.code || !q.state) {
    // Zoho came back without a code - nearly always a denied consent or a misconfigured client.
    return { ok: false, reason: q.error ? `Zoho returned "${q.error}"` : 'Zoho did not return an authorization code.' };
  }
  const row = await deps.findByState(q.state, deps.now());
  if (!row) return { ok: false, reason: 'Invalid or expired OAuth state' };

  let bundle: ZohoOAuthBundle;
  try {
    bundle = await exchangeZohoCode(q.code, q.location, deps.http);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Zoho token exchange failed' };
  }

  // The three deletions are load-bearing - see the module docblock. CLEAR_CREDENTIAL, not '',
  // because the credential write MERGES and an empty string means "untouched".
  await deps.persistGrant(row, {
    ...bundle,
    grant_code: CLEAR_CREDENTIAL,
    client_id: CLEAR_CREDENTIAL,
    client_secret: CLEAR_CREDENTIAL,
  });
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

/**
 * JSON safe to embed inside an inline `<script>`.
 *
 * `JSON.stringify` does NOT escape `/`, so a value containing `</script>` CLOSES the script
 * element during HTML parsing and everything after it is parsed as markup. On this route the
 * error string comes from Zoho's own query parameters on an UNAUTHENTICATED redirect, so that is
 * reflected XSS on the API origin, reachable with a crafted link and no state at all. Escaping the
 * three characters that can start a markup construct (plus the two line terminators JSON allows
 * raw but JavaScript does not) keeps the value a string in both parsers.
 *
 * This is the one deliberate deviation from the upstream implementation, which embeds the raw
 * `JSON.stringify` output. See `docs/findings.md` `zoho-callback-page-script-injection`.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** An attribute-safe URL for the fallback link. */
function attrEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The result page the popup renders: postMessage to the opener, or a redirect when there is none. */
export function renderZohoCallbackPage(success: boolean, appOrigin: string, error?: string): string {
  const payload = jsonForScript({ type: 'oauth-callback', provider: 'zoho', success, ...(success ? {} : { error: error || 'Unknown error' }) });
  // Relative when no origin is configured: production serves web and API same-origin behind the
  // edge proxy, so `/integrations` is correct there and is the honest degrade elsewhere - the
  // popup's real exit is the postMessage below, and this link is only the no-opener fallback.
  const backTo = `${appOrigin.replace(/\/+$/, '')}/integrations`;
  const message = success
    ? 'Zoho Sign ligado com sucesso. A redirecionar…'
    : `Falha ao ligar o Zoho Sign: ${error || 'erro desconhecido'}`;
  // Both the message and the payload are injected as JSON / textContent, never as raw HTML, so a
  // provider-supplied error string cannot break out of the script or the paragraph.
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Ekoa</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;padding:2rem;color:#1f2937">
  <p id="m"></p>
  <p><a id="back" href="${attrEscape(backTo)}">Voltar às integrações</a></p>
  <script>
    document.getElementById('m').textContent = ${jsonForScript(message)};
    var isPopup = false;
    try { isPopup = !!(window.opener && window.opener !== window); } catch (e) { isPopup = false; }
    if (isPopup) {
      try { window.opener.postMessage(${payload}, '*'); } catch (e) {}
      window.close();
    } else {
      setTimeout(function () { location.replace(${JSON.stringify(backTo)}); }, 1200);
    }
  </script>
</body></html>`;
}

export interface ZohoOAuthRouterDeps extends ZohoOAuthDeps {
  /** Admin gate for the connect route, injected (integrations/ never imports auth/). */
  requireAdmin: RequestHandler;
  /** Actor from the verified request, injected for the same reason. */
  actorOf: (req: Request) => { userId: string; orgId: string; isAdmin: boolean };
  /** Origin the callback page links back to. */
  appOrigin: string;
}

export function zohoOAuthRouter(deps: ZohoOAuthRouterDeps): Router {
  const r = Router();

  r.post('/api/v1/integrations/zoho-sign/oauth/connect', deps.requireAdmin, async (req: Request, res: Response) => {
    const result = await startZohoConnect(deps.actorOf(req), deps);
    if (!result.ok) {
      // Names the env vars an operator must set - never a filesystem path, which is what a
      // customer once read inside a served artifact.
      res.status(503).json({
        error: {
          code: 'UPSTREAM_UNAVAILABLE',
          message:
            'Ligação automática indisponível: este servidor não tem as credenciais de aplicação Zoho (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET) definidas no ambiente.',
        },
      });
      return;
    }
    res.json({ authUrl: result.authUrl, state: result.state });
  });

  r.get('/api/v1/oauth/zoho/callback', async (req: Request, res: Response) => {
    const first = (v: unknown): string | undefined => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined);
    let outcome: CallbackOutcome;
    try {
      outcome = await completeZohoCallback(
        { code: first(req.query.code), state: first(req.query.state), location: first(req.query.location), error: first(req.query.error) },
        deps,
      );
    } catch (err) {
      console.error('[zoho-oauth] callback failed:', err instanceof Error ? err.message : err);
      outcome = { ok: false, reason: 'Erro inesperado a concluir a ligação.' };
    }
    if (!outcome.ok) console.warn(`[zoho-oauth] connect refused: ${outcome.reason}`);
    else console.log('[zoho-oauth] connect completed');
    // Always 200 + a page: the browser is a human's, and the popup signals via postMessage.
    res.status(200).type('html').send(renderZohoCallbackPage(outcome.ok, deps.appOrigin, outcome.ok ? undefined : outcome.reason));
  });

  return r;
}
