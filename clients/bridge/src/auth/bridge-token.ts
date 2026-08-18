/**
 * auth/bridge-token.ts — mint the short-lived (~600s) BRIDGE token the WS upgrade verifies, from the
 * durable PLATFORM credential in the credential store, refreshing the platform credential first when
 * it is at/near expiry.
 *
 * Provenance: PORTED (copy-with-review) from the archived Bun-era `ekoa-local/src/control/mint.ts`
 * (`mintBridgeToken`). Endpoints read from ekoa-code READ-ONLY:
 *   POST /api/v1/bridge/token  { pairingId }  (Bearer platform JWT)
 *       -> { token, expiresIn, signingSecret?, org? }
 *   POST /api/v1/auth/refresh                  (Bearer platform JWT) -> { token, expiresIn }
 *
 * The mint response carries the TASK BINDING as well as the token: the pairing's own HMAC signing
 * secret (Cofre R-8) and the org that pairing is scoped to. Both are needed for a delegated task to
 * be accepted - the verifier checks the signature first and cross-org addressing second - and this
 * module used to parse only `token` and drop them, which denied every real delegation. They are
 * RETURNED to the caller rather than persisted here: this module performs no filesystem access, so
 * `serve` owns writing them to config.json (the single-writer rule for the credential store).
 *
 * The bridge token is verified per WS upgrade and lives only ~600s, so BridgeSocket mints a fresh one
 * before EVERY (re)dial — `getToken()` is written for exactly that call site (transport/bridge-socket).
 * Refresh happens BEFORE the platform token's real edge (isExpired's skew), because ekoa-code's
 * /auth/refresh re-signs the CALLER's still-valid token; once truly expired it 401s and the daemon
 * must be re-paired.
 */
import { pt } from '../i18n/pt.js';
import { isExpired, type PlatformCredentials } from './credentials.js';
import { decodeJwtExpiryMs, type FetchLike } from './device-login.js';

/** Timeout for a single mint/refresh HTTP call (ms). */
const HTTP_TIMEOUT_MS = 10_000;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type BridgeTokenReason = 'no-credentials' | 'refresh-failed' | 'mint-failed';

export class BridgeTokenError extends Error {
  constructor(
    readonly reason: BridgeTokenReason,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeTokenError';
  }
}

export interface BridgeTokenDeps {
  cortexBaseUrl: string;
  pairingId: string;
  /** Read the current platform credential (undefined = unpaired). */
  getCredentials: () => PlatformCredentials | undefined;
  /** Persist a refreshed platform credential (so the next dial/run starts fresh). */
  setCredentials: (cred: PlatformCredentials) => void;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Refresh this many ms before the real expiry (default 60s). */
  skewMs?: number;
}

/**
 * One mint: the dial credential plus the task binding Cortex scoped to this pairing.
 *
 * `signingSecret`/`org` are absent when Cortex will not hand them over (not the owner, an unknown
 * or revoked pairing) - the fail-closed direction. An absent field means "Cortex said nothing", NOT
 * "clear what you hold": the caller keeps its current binding rather than blanking it, because a
 * momentary omission must not turn a working daemon into one that denies everything.
 */
export interface BridgeTokenMint {
  token: string;
  signingSecret?: string;
  org?: string;
}

export interface BridgeTokenProvider {
  /** Resolve a currently-valid bridge token plus its binding, refreshing the platform credential
   *  first if needed. */
  getToken: () => Promise<BridgeTokenMint>;
}

/** Mint a bridge token for `pairingId` using a platform JWT. Throws BridgeTokenError on failure. */
export async function mintBridgeToken(
  fetchImpl: FetchLike,
  cortexBaseUrl: string,
  jwt: string,
  pairingId: string,
): Promise<BridgeTokenMint> {
  const url = `${cortexBaseUrl.replace(/\/+$/, '')}/api/v1/bridge/token`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ pairingId }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new BridgeTokenError('mint-failed', pt.tokenMintFailed(res.status));
  const data = (await res.json().catch(() => ({}))) as { token?: unknown; signingSecret?: unknown; org?: unknown };
  if (typeof data.token !== 'string' || data.token.length === 0) {
    throw new BridgeTokenError('mint-failed', pt.tokenMintFailed(res.status));
  }
  // The binding halves are validated INDEPENDENTLY of the token: a Cortex that omits or malforms
  // them still yields a usable dial credential, and the daemon then keeps whatever binding it
  // already had. Empty strings are treated as absent - an empty secret verifies nothing.
  const signingSecret = typeof data.signingSecret === 'string' && data.signingSecret.length > 0 ? data.signingSecret : undefined;
  const org = typeof data.org === 'string' && data.org.length > 0 ? data.org : undefined;
  return {
    token: data.token,
    ...(signingSecret !== undefined ? { signingSecret } : {}),
    ...(org !== undefined ? { org } : {}),
  };
}

/** Refresh the platform credential via /auth/refresh. Throws BridgeTokenError on failure. */
export async function refreshPlatformToken(
  fetchImpl: FetchLike,
  cortexBaseUrl: string,
  current: PlatformCredentials,
  now: number,
): Promise<PlatformCredentials> {
  const url = `${cortexBaseUrl.replace(/\/+$/, '')}/api/v1/auth/refresh`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${current.access}` },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new BridgeTokenError('refresh-failed', pt.tokenRefreshFailed);
  const data = (await res.json().catch(() => ({}))) as { token?: unknown; expiresIn?: unknown };
  if (typeof data.token !== 'string' || data.token.length === 0) {
    throw new BridgeTokenError('refresh-failed', pt.tokenRefreshFailed);
  }
  const expiresIn = typeof data.expiresIn === 'number' ? data.expiresIn : undefined;
  const expires =
    expiresIn && expiresIn > 0 ? now + expiresIn * 1000 : (decodeJwtExpiryMs(data.token) ?? now + DEFAULT_TTL_MS);
  // Carry the identity forward; the refreshed access token is also the new refresh bearer.
  return { access: data.token, refresh: data.token, expires, ...(current.user ? { user: current.user } : {}) };
}

/**
 * Build a bridge-token provider bound to a credential source. `getToken()` refreshes the platform
 * credential when expired (persisting the fresh one) and then mints a bridge token — a fresh one on
 * every call, matching BridgeSocket's per-dial mint.
 */
export function createBridgeTokenProvider(deps: BridgeTokenDeps): BridgeTokenProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  return {
    async getToken(): Promise<BridgeTokenMint> {
      const cred = deps.getCredentials();
      if (!cred) throw new BridgeTokenError('no-credentials', pt.tokenNoCredentials);

      let active = cred;
      if (isExpired(cred, deps.skewMs, now())) {
        active = await refreshPlatformToken(fetchImpl, deps.cortexBaseUrl, cred, now());
        deps.setCredentials(active);
      }
      return mintBridgeToken(fetchImpl, deps.cortexBaseUrl, active.access, deps.pairingId);
    },
  };
}
