/**
 * URL helpers (ch12 §12.2.6). Attached to the `api` object by `index.ts`. These replace
 * the three legacy helpers with identical output shapes, but source the base origin and
 * the token through the single resolver (§12.2.5) and the single accessor (§12.2.4) - no
 * raw `localStorage` reads (FC-066).
 */

import { resolveBaseUrl } from './base-url';
import { getToken } from './token';

/** Relative API path -> absolute URL (replaces FC-017 `resolveApiUrl`). Absolute URLs pass through. */
export function resolveUrl(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
  const base = resolveBaseUrl();
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Static app URL for an artifact instance: `{base}/apps/{idOrSlug}/` (replaces FC-023 `getAppUrl`). */
export function appUrl(idOrSlug: string): string {
  return `${resolveBaseUrl()}/apps/${idOrSlug}/`;
}

/**
 * Append `?token=` for owner-checked, non-shareable artifact previews only (replaces
 * FC-024; RESOLVED Q-05). Callers MUST NOT use this for shareable artifacts. Isolating
 * the behaviour here keeps a future switch to same-origin cookies to one function.
 * A server-side log-redaction middleware scrubs the `?token=` value from logs (ch16).
 */
export function withPreviewToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}
