/**
 * End-user SSO sessions + pending-auth records for served artifacts (ch03 §3.9;
 * ported from cortex/src/persistence/app-sessions.ts). These are the identity layer
 * for `/apps/{id}/` visitors (an ERP login flow), NOT the dashboard's own JWT sessions
 * and NOT the workspace integration token. Each record is scoped to ONE artifact by
 * `appId`; isolation is enforced server-side by `session.appId === <canonical id>`,
 * never by cookie path.
 *
 * Storage carryover: the old monolith used JSON stores; here both live in Firestore via
 * the generic `Store<T>` (ch04 §4.3.3), matching the rest of the new data layer. The
 * pending-auth single-use guarantee is `Store.consume` (findOneAndDelete - atomic), so
 * two concurrent /callback requests carrying the same state can never both observe the
 * record (the second gets null) - the no-replay property is local, not merely reliant
 * on Azure's one-time authorization-code enforcement.
 */
import { Store, type Doc } from '../data/store.js';

/** A logged-in end-user of a served artifact (the cookie value is the `_id`). */
export interface AppSessionDoc extends Doc {
  /** High-entropy opaque token; the value held in the HttpOnly cookie. */
  _id: string;
  /** Canonical artifact id this session is valid for (never the slug). */
  appId: string;
  email: string;
  name?: string;
  /** Microsoft object id (stable per-user identifier across the tenant). */
  oid?: string;
  /** Tenant id (`9188040d-…` = personal/MSA). */
  tid?: string;
  createdAt: string;
  /** ISO expiry; the session is invalid once now > expiresAt. */
  expiresAt: string;
  /** Encrypted JSON `{ access_token, refresh_token }` for acting AS this user on Graph.
   *  Present only when the visitor granted delegated Mail.Send/Calendars scopes. The
   *  served app never sees it - the /api/app-sso/m365 proxy injects it. */
  graphTokensEnc?: string;
  /** ISO expiry of the graph access token (cleartext, for cheap refresh checks). */
  graphTokenExpiresAt?: string;
  /** For PASSWORD sessions only: the user collection + identity field this session
   *  authenticated against at login. set-password authorization binds to THESE
   *  server-established values, never to request-supplied ones. Absent for SSO. */
  authCollection?: string;
  authIdentityField?: string;
}

/**
 * An in-flight authorization-code roundtrip. Created at /start, consumed once at
 * /callback. `_id === state` so the callback looks it up by the `state` Microsoft
 * returns, in O(1). Holds the nonce + PKCE verifier the authorize request committed to.
 */
export interface PendingAppAuthDoc extends Doc {
  /** Equals `state`. */
  _id: string;
  appId: string;
  nonce: string;
  pkceVerifier: string;
  /** Absolute, validated `/apps/…` path to redirect to after sign-in. */
  returnUrl: string;
  /** The exact redirect_uri sent to Azure (must be replayed at token exchange). */
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
}

export const appSessions = new Store<AppSessionDoc>('app_sessions');
export const pendingAppAuth = new Store<PendingAppAuthDoc>('app_sso_pending');

/** Session lifetime: 8h. Pending-auth lifetime: 10min (one login roundtrip). */
export const APP_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

/**
 * Look up a still-valid session by its cookie token, scoped to one app. Returns null
 * for missing/expired/wrong-app - callers surface 401 without disclosing which. Expired
 * rows are swept opportunistically.
 */
export async function findValidAppSession(sessionToken: string, appId: string): Promise<AppSessionDoc | null> {
  if (!sessionToken || !appId) return null;
  const found = await appSessions.get(sessionToken);
  if (!found) return null;
  if (found.appId !== appId) return null;
  if (Date.parse(found.expiresAt) <= Date.now()) {
    await appSessions.delete(sessionToken).catch(() => {});
    return null;
  }
  return found;
}

/**
 * Look up and CONSUME a pending-auth by state. ATOMIC single-use via findOneAndDelete,
 * so a replayed state can never be observed twice. Returns null when missing or expired.
 */
export async function consumePendingAppAuth(state: string): Promise<PendingAppAuthDoc | null> {
  if (!state) return null;
  const found = await pendingAppAuth.consume(state);
  if (!found) return null;
  if (Date.parse(found.expiresAt) <= Date.now()) return null;
  return found;
}

/** Drop every expired session and pending-auth row. Safe to call on a timer. */
export async function sweepExpiredAppSso(): Promise<{ sessions: number; pending: number }> {
  const now = Date.now();
  const sessions = await appSessions.deleteMany({ expiresAt: { $lte: new Date(now).toISOString() } });
  const pending = await pendingAppAuth.deleteMany({ expiresAt: { $lte: new Date(now).toISOString() } });
  return { sessions, pending };
}
