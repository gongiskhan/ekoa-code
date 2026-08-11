/**
 * ChatStripes - the wire shape MUST be the real one.
 *
 * WS3 root cause: `artifactView` (`api/src/apps/artifacts-service.ts`) deliberately keeps the
 * server-owned `data` bag OFF the wire - it holds `projectDir`/`sdkSessionId`, which no client may
 * see. The PREVIOUS version of this file mocked `data: { outputKind: 'web_app' }` and
 * `featuredRank` straight onto the API response, which is exactly what the real server never
 * sends - so this suite was green while the component's `a.data?.x` reads were always `undefined`
 * in production. Every fixture below is shaped like the actual `Artifact` wire type
 * (`shared/src/artifacts.ts`): narrow top-level fields (`sessionId`, `outputKind`, `appUrl`,
 * `featuredRank`, `updatedAt`), never a `data` bag.
 *
 * Two behaviours are pinned:
 *  1. A featured Starting Point is edited IN PLACE, never forked (ekoa-dev `c4f7f2c6`). The
 *     load-bearing assertion is NEGATIVE - `api.artifacts.fork` is never called - because
 *     asserting only the navigation would still pass if a fork fired alongside it.
 *  2. An OWN card's click branches on the wire `sessionId`: present → prime the store and jump
 *     straight to `/chat/<sessionId>` (no round trip through `?continue=`); absent → route through
 *     `/chat?continue=<id>` (the working continue-flow), never the old dead `/artifacts?focus=`
 *     link that nothing ever read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatStripes } from '@/components/chat/chat-stripes';
import { api } from '@/lib/api';
import { useOrchestrationStore } from '@/stores/orchestration';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

vi.mock('@/lib/api', () => ({
  api: {
    artifacts: { list: vi.fn(), fork: vi.fn() },
    appUrl: (idOrSlug: string) => `/apps/${idOrSlug}/`,
  },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true as const, data: await fn() };
    } catch (error) {
      return { ok: false as const, error };
    }
  },
}));

const mocked = api.artifacts as unknown as {
  list: ReturnType<typeof vi.fn>;
  fork: ReturnType<typeof vi.fn>;
};

// ---- Real wire shapes (shared/src/artifacts.ts Artifact) - no `data`, ever. ----

const FEATURED = {
  id: 'feat-cobrancas',
  slug: 'cobrancas',
  name: 'Cobranças',
  featured: true,
  featuredRank: 30,
  outputKind: 'web_app',
};

const OWN_WITH_SESSION = {
  id: 'own-linked',
  slug: 'own-linked',
  name: 'App já ligada',
  featured: false,
  status: 'active',
  updatedAt: '2026-08-01T10:00:00.000Z',
  sessionId: 'sess-own-1',
  appUrl: '/apps/own-linked/',
  shareable: false,
};

const OWN_WITHOUT_SESSION = {
  id: 'own-unlinked',
  slug: 'own-unlinked',
  name: 'App nunca continuada',
  featured: false,
  status: 'active',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

let openedUrl: string | null;
let appTab: { opener: unknown; location: { replace: (u: string) => void } };

beforeEach(() => {
  push.mockClear();
  mocked.list.mockReset();
  mocked.fork.mockReset();
  openedUrl = null;
  appTab = {
    opener: {},
    location: { replace: (u: string) => { openedUrl = u; } },
  };
  vi.stubGlobal('open', vi.fn(() => appTab));
  mocked.fork.mockResolvedValue({ id: 'should-never-be-created' });
  // Reset the real orchestration store between tests - own-card clicks write into it directly.
  useOrchestrationStore.setState({
    sessionJobs: {},
    sessionPreviews: {},
    activeSessionId: null,
  } as never);
});

describe('ChatStripes - a featured Starting Point is edited in place, never forked', () => {
  beforeEach(() => {
    mocked.list.mockResolvedValue({ items: [], featured: [FEATURED] });
  });

  async function clickFeaturedCard(): Promise<void> {
    render(<ChatStripes />);
    const card = await screen.findByText('Cobranças');
    await userEvent.click(card);
  }

  it('never forks it into a second gallery copy', async () => {
    await clickFeaturedCard();
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(mocked.fork).not.toHaveBeenCalled();
  });

  it('lands the current tab in the FEATURED app’s own chat, by its own id', async () => {
    await clickFeaturedCard();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat?continue=feat-cobrancas'));
  });

  it('opens the running featured app in the new tab, addressed by its slug', async () => {
    await clickFeaturedCard();
    await waitFor(() => expect(openedUrl).toBe('/apps/cobrancas/'));
  });

  it('severs the opener link before navigating the new tab (reverse-tabnabbing)', async () => {
    await clickFeaturedCard();
    await waitFor(() => expect(openedUrl).not.toBeNull());
    expect(appTab.opener).toBeNull();
  });
});

describe('ChatStripes - an own card branches on the wire sessionId', () => {
  it('sessionId present: primes the store and jumps straight to /chat/<sessionId> (no ?continue= round trip)', async () => {
    mocked.list.mockResolvedValue({ items: [OWN_WITH_SESSION], featured: [] });
    render(<ChatStripes />);
    const card = await screen.findByText('App já ligada');
    await userEvent.click(card);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat/sess-own-1'));
    // The THIS-was-the-bug assertion: before the wire fix, `readData(a, 'sessionId')` was always
    // undefined, so this branch never ran and every own-card click fell through to the dead
    // `/artifacts?focus=` link instead.
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining('/artifacts?focus='));
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining('?continue='));

    const state = useOrchestrationStore.getState();
    expect(state.activeSessionId).toBe('sess-own-1');
    expect(state.sessionJobs['sess-own-1']?.artifactInstanceId).toBe('own-linked');
    expect(state.sessionPreviews['sess-own-1']?.appUrl).toBe('/apps/own-linked/');
  });

  it('sessionId absent: routes through /chat?continue=<id> (never the dead /artifacts?focus= link)', async () => {
    mocked.list.mockResolvedValue({ items: [OWN_WITHOUT_SESSION], featured: [] });
    render(<ChatStripes />);
    const card = await screen.findByText('App nunca continuada');
    await userEvent.click(card);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat?continue=own-unlinked'));
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining('/artifacts?focus='));
  });
});
