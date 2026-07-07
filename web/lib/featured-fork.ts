/**
 * Featured-artifact "Use" flow.
 *
 * Pressing "Usar" on a featured artifact (Starting Point) forks it into a fresh
 * copy the user owns, then lands them in BOTH surfaces at once:
 *   - the running fork, in a new tab, so they can *use* it, and
 *   - the fork's chat (via /chat?continue=), so they can *change* it.
 *
 * The running-app tab must be opened synchronously inside the click handler
 * (before any await) or the browser's popup blocker eats it. The caller opens a
 * blank tab, hands it here, and this points it at the fork once the fork
 * resolves. The served /apps/{slug}/ route shows an auto-refreshing "Building…"
 * placeholder until the (fire-and-forget) build lands, so navigating the tab
 * immediately after fork is safe.
 *
 * Shared by the /artifacts Starting Points strip and the /chat empty-state
 * stripes so both behave identically.
 */
import * as api from '@/lib/api/client';

export interface ForkedInstance {
  id: string;
  slug?: string;
}

/**
 * Fork `sourceId` and point `appTab` at the running fork. Returns the fork so
 * the caller can route into its chat, or `null` on failure (in which case the
 * pre-opened tab is closed here — the caller surfaces the error to the user).
 */
export async function forkFeaturedInto(
  sourceId: string,
  appTab: Window | null,
): Promise<ForkedInstance | null> {
  const res = await api.wsAction<ForkedInstance>('ekoa.templates', 'fork-instance', {
    sourceId,
  });
  if (!res.success || !res.data?.id) {
    appTab?.close();
    return null;
  }
  const fork = res.data;
  if (appTab) {
    // Sever the opener link before navigating (reverse-tabnabbing), matching the
    // noopener posture of the regular "Run" action. The tab is same-origin
    // (about:blank) until we navigate it, so this assignment succeeds now and is
    // moot afterwards.
    try {
      appTab.opener = null;
    } catch {
      /* cross-origin after navigation — nothing to sever */
    }
    appTab.location.replace(api.getAppUrl(fork.slug || fork.id));
  }
  return fork;
}
