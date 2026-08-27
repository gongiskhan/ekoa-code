/**
 * Security-headers baseline (ch09 §9.8 D1, FIXED-14; addendum D1). The composition-root
 * middleware half of D1 — the CORS allowlist + app-SSO cookie flags live in their own homes
 * (§9.2), and the web dashboard sets its own CSP via next.config. This sets, on every api
 * response:
 *   - X-Content-Type-Options: nosniff        (MIME-confusion defence, all responses)
 *   - Referrer-Policy: no-referrer           (no path/token leakage via Referer; the /apps
 *                                             document surface relaxes to same-origin, below)
 *   - Strict-Transport-Security               (transit encryption posture, C2; HTTPS-only effect)
 * and, split by surface:
 *   - the JSON API surface (/api*, /health, /hooks) — a locked-down document CSP
 *     `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` + `X-Frame-Options: DENY`.
 *     These responses render nothing, so the strict CSP cannot break them; it hardens the odd
 *     error page / sniffed-HTML vector and forbids framing of any API response.
 *   - the served-app plane (everything else: the /apps bundles, dev-serve, legal, build, demos)
 *     — `Content-Security-Policy: frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`.
 *     Byte-compat (FIXED-9): the ported served apps load their own inline scripts / external
 *     resources, so the plane's containment is framing-scoped (anti-clickjacking; a hostile app
 *     cannot frame another app or a platform page) rather than a resource-restricting CSP that
 *     would break the carried bundles. A served-app handler MAY override these before emit.
 *
 * Set as early as possible (before routing) so every downstream handler inherits them; a
 * handler that needs a different value (a framed embed) calls res.setHeader to replace.
 */
import type { Request, Response, NextFunction } from 'express';

const HSTS = 'max-age=63072000; includeSubDomains';
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
const SERVED_APP_CSP = "frame-ancestors 'self'";

/** True for the JSON/machine surface that renders nothing in a browser document context. */
function isApiSurface(path: string): boolean {
  return path === '/health' || path.startsWith('/api') || path.startsWith('/hooks');
}

/** True for the EMBEDDABLE app documents (/apps/*): the dashboard's preview overlay frames
 *  these cross-origin (app.<domain> → api.<domain>; :3000 → :4111 in dev), so this surface —
 *  and ONLY this surface — allowlists the dashboard origins as frame ancestors. */
function isEmbeddableAppsSurface(path: string): boolean {
  return path === '/apps' || path.startsWith('/apps/');
}

/**
 * Dashboard origins allowed to embed /apps/*: `EKOA_DASHBOARD_ORIGINS` (comma-separated
 * absolute origins) → `EKOA_APP_ORIGIN` (the canonical running-frontend origin) → the dev
 * dashboard. Entries must parse as http(s) URLs; invalid ones are dropped with a warning
 * (never silently widened). Memoized — env is process-stable; tests reset.
 */
let cachedDashboardOrigins: string[] | null = null;
export function dashboardOrigins(): string[] {
  if (cachedDashboardOrigins) return cachedDashboardOrigins;
  const raw = process.env.EKOA_DASHBOARD_ORIGINS || process.env.EKOA_APP_ORIGIN || 'http://localhost:3000';
  const out: string[] = [];
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      const u = new URL(entry);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        out.push(u.origin);
        continue;
      }
    } catch {
      /* fall through to the warning */
    }
    console.warn(`[security-headers] dropped invalid dashboard-origin entry: ${entry}`);
  }
  cachedDashboardOrigins = out;
  return out;
}
function isLocalhostOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

/**
 * The primary dashboard origin for building an ABSOLUTE user-facing URL (the device-pairing approval
 * page), or null when no web origin is explicitly configured.
 *
 * Returns null on the bare default so a SAME-ORIGIN production (web and API behind one edge proxy)
 * keeps a relative path joined to the API base - hard-coding localhost would be wrong there. When
 * `EKOA_DASHBOARD_ORIGINS`/`EKOA_APP_ORIGIN` IS set (split-origin dev, or a prod that declares its web
 * origin) it prefers an https non-localhost origin, then any non-localhost one, so a tailnet user is
 * sent to the reachable https URL and not to `localhost` (the wrong-port pairing-URL bug, 2026-08-27).
 */
export function configuredDashboardOrigin(): string | null {
  if (!(process.env.EKOA_DASHBOARD_ORIGINS || process.env.EKOA_APP_ORIGIN)) return null;
  const origins = dashboardOrigins();
  if (origins.length === 0) return null;
  return (
    origins.find((o) => o.startsWith('https://') && !isLocalhostOrigin(o)) ??
    origins.find((o) => !isLocalhostOrigin(o)) ??
    origins.find((o) => o.startsWith('https://')) ??
    origins[0]!
  );
}

export function __resetDashboardOriginsForTests(): void {
  cachedDashboardOrigins = null;
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Universal — safe on every response, no rendering impact.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', HSTS);

  if (isApiSurface(req.path)) {
    res.setHeader('Content-Security-Policy', API_CSP);
    res.setHeader('X-Frame-Options', 'DENY');
  } else if (isEmbeddableAppsSurface(req.path)) {
    // /apps embed surface: 'self' + the configured dashboard origins. Deliberately NO
    // X-Frame-Options here — XFO cannot express an allowlist and a SAMEORIGIN value would
    // keep blocking the cross-origin dashboard in some engines; every modern browser gives
    // frame-ancestors precedence, and legacy XFO-only browsers fail CLOSED (no framing).
    const origins = dashboardOrigins();
    res.setHeader(
      'Content-Security-Policy',
      `frame-ancestors 'self'${origins.length > 0 ? ` ${origins.join(' ')}` : ''}`,
    );
    // An app DOCUMENT is the one surface whose Referer carries platform meaning: the org's brand
    // resolves from the requesting app (`/apps/<slug>/` → its org's design tokens), and under
    // no-referrer every already-built app - whose <head> predates the parametrised tokens link -
    // fell back to the platform default palette. same-origin sends the referrer only to this
    // origin (the api serving both the app and /api/design-tokens.css) and still sends NOTHING
    // cross-origin, so no path or token leaves the platform. Documents only; the JSON API surface
    // above keeps no-referrer.
    res.setHeader('Referrer-Policy', 'same-origin');
  } else {
    // Served-app plane: framing-scoped containment, resource loading left to byte-compat.
    res.setHeader('Content-Security-Policy', SERVED_APP_CSP);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  next();
}
