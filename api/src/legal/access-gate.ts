/**
 * Legal-suite served-app access gate (ch07 §7.14, ch09 §9.4, invisible-behaviors
 * §8.10). Carried byte-compatibly from the old `requireLegalSuiteApp` +
 * `makeAppRateLimiter`:
 *
 *   - `X-Ekoa-App-Id` header, slug-resolved (injected resolver), charset-checked;
 *   - per-endpoint app ALLOWLIST -> 403 PT-PT refusal (a rotated/forged header id
 *     still cannot reach the service unless it names an allowlisted app);
 *   - sliding-window rate limits (per-app AND global caps, per minute) -> 429 PT;
 *     a BLOCKED caller's hit is NOT recorded, so it cannot extend its own cooldown.
 *
 * Amendment 2 (ch03 §3.9, Part 3) layers on WITHOUT changing any byte-compat wire
 * shape: when the app resolves to a registered artifact, the artifact OWNER's
 * activation gates service — a deactivated owner refuses with the CONV-2 envelope
 * (403 ACCOUNT_DISABLED / 402 BILLING_LOCKED), and a missing activation record
 * fails CLOSED (mirrors apps/served-data.ts appFor). An allowlisted app with no
 * registered artifact has no owner to gate and proceeds (old no-registration
 * behavior preserved); `/api/citius/consulta` additionally requires registration.
 *
 * The rate-limiter clock is injectable so tests can drive the sliding window and
 * the blocked-hit-not-recorded invariant deterministically.
 */
import type { Request, Response } from 'express';
import { getActivation as defaultGetActivation, type ActivationState } from '../data/activation.js';

/** Shared platform charset for an app id (also a Set-Cookie name component). */
const SAFE_APP_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export function isSafeAppId(appId: unknown): appId is string {
  return typeof appId === 'string' && SAFE_APP_ID_RE.test(appId);
}

export type NowFn = () => number;

/**
 * Sliding-window rate limiter: per-app AND global caps, per `windowMs` (default
 * 60s). Over EITHER budget -> returns true (rate-limited); the pruned windows are
 * persisted but the rejected hit is NOT recorded (a blocked caller must not extend
 * its own cooldown). `>=` comparison => `perAppMax` requests succeed per window.
 */
export function makeAppRateLimiter(
  perAppMax: number,
  globalMax: number,
  windowMs = 60_000,
  now: NowFn = Date.now,
): (appId: string) => boolean {
  const perAppHits = new Map<string, number[]>();
  let globalHits: number[] = [];
  return (appId: string): boolean => {
    const t = now();
    const recent = (arr: number[]): number[] => arr.filter((x) => t - x < windowMs);
    const perApp = recent(perAppHits.get(appId) ?? []);
    const global = recent(globalHits);
    if (perApp.length >= perAppMax || global.length >= globalMax) {
      perAppHits.set(appId, perApp); // pruned window only — NO push(t)
      globalHits = global;
      return true;
    }
    perApp.push(t);
    global.push(t);
    perAppHits.set(appId, perApp);
    globalHits = global;
    return false;
  };
}

/** What the injected resolver returns (a subset of apps/registry.ResolvedApp). */
export interface ResolvedLegalApp {
  appId: string;
  ownerUserId: string;
}

export interface LegalGateDeps {
  /** Resolve a slug-or-id header to a registered app (owner + canonical id), or null. */
  resolveApp: (idOrSlug: string) => Promise<ResolvedLegalApp | null>;
  /** Activation lookup (Amendment 2). Default: the data/ activation cache. */
  getActivation?: (userId: string) => ActivationState | undefined;
}

export interface LegalGateOptions {
  allowed: Set<string>;
  /** 403 PT refusal string. Default: the generic legal-suite message. */
  notAllowedMessage?: string;
  /** citius additionally requires the app to be registered (404 Unknown app). */
  requireRegistered?: boolean;
}

const DEFAULT_NOT_ALLOWED = 'Aplicação não autorizada para esta consulta.';

/**
 * Gate a legal-suite request from `X-Ekoa-App-Id`. Writes the refusal response and
 * returns null when the caller is not authorized; on success returns the resolved
 * app (ownerUserId may be '' for an allowlisted-but-unregistered app).
 *
 * Order (byte-compat then Amendment 2): header present -> slug resolve -> charset
 * -> allowlist -> [registration for citius] -> owner activation.
 */
export async function requireLegalSuiteApp(
  req: Request,
  res: Response,
  deps: LegalGateDeps,
  opts: LegalGateOptions,
): Promise<ResolvedLegalApp | null> {
  const headerId = (req.headers['x-ekoa-app-id'] as string | undefined) || '';
  if (!headerId) {
    res.status(400).json({ error: 'Missing X-Ekoa-App-Id header' });
    return null;
  }
  const resolved = await deps.resolveApp(headerId);
  const appId = resolved?.appId ?? headerId;
  if (!isSafeAppId(appId)) {
    res.status(400).json({ error: 'Invalid X-Ekoa-App-Id header' });
    return null;
  }
  if (!opts.allowed.has(appId)) {
    res.status(403).json({ error: opts.notAllowedMessage ?? DEFAULT_NOT_ALLOWED });
    return null;
  }
  if (opts.requireRegistered && !resolved) {
    res.status(404).json({ error: 'Unknown app' });
    return null;
  }
  // Amendment 2: gate on the artifact owner's activation when resolvable.
  if (resolved) {
    const getAct = deps.getActivation ?? defaultGetActivation;
    const activation = getAct(resolved.ownerUserId);
    if (!activation || activation.active === false) {
      res.status(403).json({ error: { code: 'ACCOUNT_DISABLED', message: 'A sua conta está bloqueada. Contacte o suporte.' } });
      return null;
    }
    if (activation.billingLocked) {
      res.status(402).json({ error: { code: 'BILLING_LOCKED', message: 'A sua conta tem um problema de faturação. Contacte o suporte.' } });
      return null;
    }
  }
  return resolved ?? { appId, ownerUserId: '' };
}
