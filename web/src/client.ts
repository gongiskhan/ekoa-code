/**
 * web/ typed REST client seam (FIXED-9). The G0 placeholder: the full generated client
 * against the shared/ endpoint descriptors lands at G9 (web migration). web/ imports
 * shared/ ONLY (FIXED-1) — never api/.
 */
import { ErrorEnvelope } from '@ekoa/shared';

export type { ErrorEnvelope };

/** The single API base-URL resolver (ch12 §12.8 criterion 5: exactly one). */
export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4111';
}
