/**
 * ChatStripes — clicking a featured Starting Point must EDIT IT IN PLACE, never fork.
 *
 * The bug this pins (ekoa-dev `c4f7f2c6`): the chat empty-state card called the artifact FORK
 * endpoint, which created a second copy of the featured app. The user then saw the same app twice
 * in their gallery with no way to tell which one their changes had gone into — and /artifacts had
 * already been fixed to route straight into the featured app's own chat, so the two surfaces
 * disagreed about what "use this" means.
 *
 * The assertion that matters is a NEGATIVE one: `api.artifacts.fork` is never called. Asserting
 * only the navigation would still pass if a fork fired alongside it, which is exactly the shape the
 * bug had.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatStripes } from '@/components/chat/chat-stripes';
import { api } from '@/lib/api';

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

const FEATURED = {
  id: 'feat-cobrancas',
  slug: 'cobrancas',
  name: 'Cobranças',
  featured: true,
  featuredRank: 30,
  data: { outputKind: 'web_app' },
};

let openedUrl: string | null;
let appTab: { opener: unknown; location: { replace: (u: string) => void } };

beforeEach(() => {
  push.mockClear();
  openedUrl = null;
  appTab = {
    opener: {},
    location: { replace: (u: string) => { openedUrl = u; } },
  };
  vi.stubGlobal('open', vi.fn(() => appTab));
  mocked.list.mockResolvedValue({ items: [], featured: [FEATURED] });
  mocked.fork.mockResolvedValue({ id: 'should-never-be-created' });
});

async function clickFeaturedCard(): Promise<void> {
  render(<ChatStripes />);
  const card = await screen.findByText('Cobranças');
  await userEvent.click(card);
}

describe('ChatStripes — a featured app is THE app', () => {
  it('never forks it into a second gallery copy', async () => {
    await clickFeaturedCard();
    // The whole bug in one assertion.
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
