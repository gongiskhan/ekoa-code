/**
 * Auth wiring for the `app` base.
 *
 * The platform injects `window.__EKOA_APP_ID` and the `window.__ekoa` helper
 * into every served app. There is no inline auth token - app-data is scoped
 * per-app by the `X-Ekoa-App-Id` header alone, so apps read and write their
 * own collections without authenticating.
 */

declare global {
  interface Window {
    __EKOA_APP_ID?: string;
    __ekoa?: { fetch?: typeof fetch };
  }
}

export function getAppId(): string {
  const id = typeof window !== 'undefined' ? window.__EKOA_APP_ID : undefined;
  if (!id) throw new Error('No Ekoa app id in window - auth wiring not initialised');
  return id;
}

export interface CurrentUser {
  id: string;
  username: string;
  role: 'user' | 'admin' | 'super-admin';
}

let cachedMe: CurrentUser | null = null;

/**
 * Best-effort lookup of the dashboard user that opened this artifact, used
 * only for personalisation (avatar, greeting). The `/api/v1/action` endpoint
 * still requires the dashboard's auth cookie; in standalone runs (e.g. the
 * screenshot capture pipeline) this resolves to a synthetic anonymous user.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  if (cachedMe) return cachedMe;
  const fetchFn = window.__ekoa?.fetch ?? window.fetch.bind(window);
  try {
    const res = await fetchFn('/api/v1/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'ekoa.auth', intent: 'me' }),
    });
    if (res.ok) {
      const body = (await res.json()) as { type: 'action_result'; data: CurrentUser };
      cachedMe = body.data;
      return body.data;
    }
  } catch { /* fall through to anon */ }
  cachedMe = { id: 'anonymous', username: 'anonymous', role: 'user' };
  return cachedMe;
}
