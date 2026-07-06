/**
 * Injected app-scope resolution for the integrations served-app planes (ch03 §3.9,
 * FIXED-9). integrations/ may NOT import apps/ (module tiers, ch02 §2.7), yet the
 * app-sso / cloud-files / m365 routers must turn an `X-Ekoa-App-Id` header (slug OR
 * canonical id) into the canonical artifact id + owner + served/opt-in facts. So the
 * composition root (server.ts) injects a `ResolveAppScope` built from apps/registry +
 * apps/app-registry + the manifest; these routers stay tier-clean.
 *
 * The owner-activation gate (Amendment 2, ch03 §3.2/§3.9 second admission plane) lives
 * here and is identical to api/src/apps/served-data.ts `appFor`: it consults the one
 * activation map (data/activation) and fails CLOSED - an unknown owner, a deactivated
 * owner, or a billing lock refuses with the CONV-2 envelope. A cache miss is never an
 * allow.
 */
import { getActivation } from '../data/activation.js';

export interface ResolvedAppScope {
  /** Canonical artifact id (never the slug). */
  appId: string;
  ownerUserId: string;
  /** True when the app is REGISTERED (served) in the app registry - the Q-10
   *  "app exists AND is served" half of the workspace Graph-proxy gate. */
  isServed: boolean;
  /** Per-app manifest opt-in for the workspace Microsoft Graph proxy (Q-10,
   *  manifest flag `m365Proxy`). Only the workspace /api/m365 proxy consults it. */
  m365Proxy: boolean;
}

/** Resolve a slug-or-id header to a canonical app scope, or null when unknown.
 *  Injected by server.ts (see the report) so integrations/ never imports apps/. */
export type ResolveAppScope = (idOrSlug: string) => Promise<ResolvedAppScope | null>;

export type ActivationVerdict = { ok: true } | { ok: false; status: number; body: unknown };

/**
 * The second admission plane, carried verbatim from served-data.appFor: the artifact
 * OWNER's activation gates service. Fails CLOSED on a missing record. Returns the exact
 * CONV-2 envelope (the one sanctioned non-byte-compat response on this plane).
 */
export function checkOwnerActivation(ownerUserId: string): ActivationVerdict {
  // No owner => no subject for the admission plane. This is a dev-serve / raw-id app
  // (the key-value served-app planes carry no artifact owner); the old plane served it
  // without an owner-activation check. An artifact-backed app always carries an owner.
  if (!ownerUserId) return { ok: true };
  const activation = getActivation(ownerUserId);
  if (!activation || activation.active === false) {
    return {
      ok: false,
      status: 403,
      body: { error: { code: 'ACCOUNT_DISABLED', message: 'A sua conta está bloqueada. Contacte o suporte.' } },
    };
  }
  if (activation.billingLocked) {
    return {
      ok: false,
      status: 402,
      body: { error: { code: 'BILLING_LOCKED', message: 'A sua conta tem um problema de faturação. Contacte o suporte.' } },
    };
  }
  return { ok: true };
}
