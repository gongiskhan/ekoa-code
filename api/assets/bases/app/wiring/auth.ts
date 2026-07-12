/**
 * Auth wiring for the `app` base.
 *
 * Identity comes from the injected runtime's end-user SSO (Microsoft, per-app
 * cookie). `getCurrentUser()` resolves the signed-in visitor or null - logged
 * out, OR the runtime is absent (standalone preview, file://, screenshot
 * pipeline). Everything here is best-effort and NON-THROWING: the shell must
 * render fully for an anonymous visitor, with no error card.
 *
 * Authorize by `oid` (+ `tid`), NEVER by `email`: email is mutable and
 * display-only. Do not confuse this visitor identity (SSO) with the workspace
 * account behind integrations - they are different principals.
 */
import { whoami, signIn, signOut, type WhoAmI } from './protocol-client';

export type CurrentUser = WhoAmI;

/** This app's id, or null outside a served-app document. Never throws. */
export function getAppId(): string | null {
  return typeof window !== 'undefined' ? window.__EKOA_APP_ID ?? null : null;
}

let cached: CurrentUser | null | undefined;

/**
 * The signed-in visitor, or null. Resolved once and cached. Never throws -
 * a logged-out visitor or an absent runtime both resolve to null, and the
 * caller renders the anonymous state.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (cached !== undefined) return cached;
  cached = await whoami();
  return cached;
}

/** Re-export the SSO actions so the shipped shell has one identity import. */
export { signIn, signOut };
