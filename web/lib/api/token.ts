/**
 * The single token accessor (ch12 §12.2.4). This is the ONLY module in `web/` that
 * touches the token storage key `localStorage['ekoa_token']` (acceptance criterion 4:
 * grep count of `ekoa_token` in `web/` equals this module's own occurrences). The five
 * independent raw readers recorded in FC-066 all route through here.
 *
 * `setToken` notifies subscribers so the stream manager re-authenticates open streams
 * (FC-004); `clearToken` notifies with `null` so they close. The cross-tab `storage`
 * listener (login/logout sync across tabs, FC-025) lives here and delegates to the same
 * notification path. All access is SSR-guarded (`window` only exists in the browser).
 */

const TOKEN_KEY = 'ekoa_token';

export type TokenListener = (token: string | null) => void;
export type Unsubscribe = () => void;

const listeners = new Set<TokenListener>();

function notify(token: string | null): void {
  for (const listener of [...listeners]) listener(token);
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
  notify(token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  notify(null);
}

/** Subscribe to token changes (set / clear / cross-tab). Returns an unsubscribe. */
export function subscribe(listener: TokenListener): Unsubscribe {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Cross-tab sync (FC-025): another tab's login/logout writes `ekoa_token`; mirror the
// change into this tab's subscribers. `storage` events only fire in the browser.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === TOKEN_KEY) notify(event.newValue);
  });
}
