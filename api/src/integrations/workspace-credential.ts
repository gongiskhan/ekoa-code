/**
 * The WORKSPACE credential seam, resolved per APP OWNER.
 *
 * The served-app workspace planes - the Microsoft Graph proxy (`/api/m365/*`) and the
 * workspace cloud-files plane (`/api/app-cloud-files/*`) - act as "the workspace's connected
 * account". In the old Cortex that was a single ambient process-wide Microsoft connection.
 * Here it is not: platform-OAuth rows are ORG-scoped (`platform-<orgId>-<provider>`), so the
 * workspace of a served app is the org of the app's OWNER, resolved per request from the
 * app scope the router already admitted. There is no ambient identity and no cross-tenant
 * token: an app can only ever reach its own owner's org connection (Capability Contract
 * rules 4 + 5).
 *
 * Honest degrade is preserved verbatim: while the owner has no Microsoft/Google connection
 * (or it needs reauth, or the owner row carries no org), `accessToken`/`graphToken` throw an
 * Error whose message contains `not connected` - the signal `app-cloud-files.ts` maps to 409
 * and `m365-proxy.ts` maps to 502 - and `status` reports `connected: false`. Never a silent
 * failure, never a fake success.
 *
 * Boundaries: this module lives in integrations/ and imports only integrations/ + the users
 * lookup seam, which the composition root injects (integrations/ never imports data/ or auth/).
 */
import {
  getValidPlatformTokens,
  PlatformNotConnectedError,
  type OAuthDeps,
  type PlatformProvider,
} from './platform-oauth.js';
import type { CloudFilesStatus, CloudProvider } from './app-cloud-files.js';

export interface WorkspaceCredentialDeps {
  /** The owner's organisation, or null when the user row is missing/org-less. Injected. */
  resolveOwnerOrgId: (ownerUserId: string) => Promise<string | null>;
  /** Token custody deps (clock, id, and the injectable http/env seams tests use). */
  oauth: OAuthDeps;
}

export interface WorkspaceCredentials {
  /** A valid workspace Graph access token for this app owner's org. Throws when not connected. */
  graphToken: (ownerUserId: string) => Promise<string>;
  /** Which workspace providers this owner can use right now. Never throws. */
  status: (ownerUserId: string) => Promise<CloudFilesStatus>;
  /** A valid workspace access token for `provider`. Throws when not connected. */
  accessToken: (provider: CloudProvider, ownerUserId: string) => Promise<string>;
}

/** The honest-degrade error. The `not connected` substring is the contract both routers read;
 *  `code` is for callers that would rather branch than match a string. */
function notConnected(provider: PlatformProvider, needsReauth: boolean): Error {
  const what = provider === 'microsoft' ? 'Microsoft workspace integration' : 'Google workspace integration';
  return Object.assign(
    new Error(needsReauth ? `${what} is not connected: reconnect required` : `${what} is not connected`),
    { code: 'not_connected' as const },
  );
}

export function createWorkspaceCredentials(deps: WorkspaceCredentialDeps): WorkspaceCredentials {
  /**
   * FAIL CLOSED on an org-less owner - the same rule the integration action executor applies
   * (server.ts, A2 review F4): orgId selects WHICH tenant's row is read, so an empty one must
   * never fall through to a lookup. An unregistered served app has an empty ownerUserId, and
   * that must not resolve a connection either.
   */
  async function tokensFor(provider: PlatformProvider, ownerUserId: string) {
    if (!ownerUserId) throw notConnected(provider, false);
    const orgId = await deps.resolveOwnerOrgId(ownerUserId);
    if (!orgId) throw notConnected(provider, false);
    try {
      return await getValidPlatformTokens(orgId, provider, deps.oauth);
    } catch (err) {
      if (err instanceof PlatformNotConnectedError) throw notConnected(provider, err.needsReauth);
      throw err;
    }
  }

  async function providerStatus(provider: PlatformProvider, ownerUserId: string) {
    try {
      await tokensFor(provider, ownerUserId);
      return { connected: true, needsReauth: false };
    } catch (err) {
      // `needsReauth` is the actionable half of not-connected: the app shows "reconnect", not
      // "connect". Any OTHER failure (a provider outage mid-refresh) is reported as
      // not-connected rather than thrown - a status probe must not break the app's UI.
      const msg = err instanceof Error ? err.message : String(err);
      return { connected: false, needsReauth: /reconnect required/.test(msg) };
    }
  }

  return {
    graphToken: async (ownerUserId) => (await tokensFor('microsoft', ownerUserId)).access_token,
    accessToken: async (provider, ownerUserId) => (await tokensFor(provider, ownerUserId)).access_token,
    status: async (ownerUserId) => ({
      google: await providerStatus('google', ownerUserId),
      microsoft: await providerStatus('microsoft', ownerUserId),
    }),
  };
}
