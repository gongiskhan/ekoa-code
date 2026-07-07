/**
 * Client-side mirror of the active vertical.
 *
 * Split from `index.ts` so the settings store can write the mirror without
 * importing the hooks module (which imports the settings store back — a cycle).
 * This file has no store dependency: just the localStorage key + guarded I/O.
 * The mirror lets PRE-AUTH surfaces (e.g. /login), where the settings store
 * never fetches, still resolve the right skin.
 */

export const VERTICAL_STORAGE_KEY = 'ekoa_vertical';

export function readCachedVertical(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(VERTICAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist the active vertical so pre-auth surfaces (login) can read it. */
export function cacheVertical(value: string | undefined | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === 'legal' || value === 'generic') {
      window.localStorage.setItem(VERTICAL_STORAGE_KEY, value);
    }
  } catch {
    /* private mode / storage disabled — non-fatal, env/default still apply */
  }
}
