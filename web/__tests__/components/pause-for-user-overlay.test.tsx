/**
 * S8 review round - the pause overlay's IDENTIFIER, and the fact that it had no test at all.
 *
 * WHY THIS EXISTS. S8 rebranded the overlay's footer from "Run is on automation <id>" to
 * "Run <id>" by renaming the locale key and nothing else, so the value underneath stayed the
 * AUTOMATION id: the overlay told a person their run was `1a2b3c4d` when no run has that id. The
 * review found it by reading, because nothing could find it by running - no unit test rendered the
 * component and no e2e drove the `paused_for_user` path, so the label and the value could disagree
 * indefinitely.
 *
 * The overlay is deliberately kept alive by S8 (it pops for headless runs whatever started them),
 * which is exactly why it needs a test: it is the one automation-branded component that did not
 * become unreachable, so it is the one that will keep being edited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { storeState, confirmMock } = vi.hoisted(() => ({
  storeState: {
    current: {} as Record<string, unknown>,
  },
  confirmMock: vi.fn(),
}));

vi.mock('@/stores/automations', () => ({
  useAutomationsStore: (selector: (s: unknown) => unknown) => selector(storeState.current),
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => confirmMock,
}));

import PauseForUserOverlay from '@/components/automations/pause-for-user-overlay';

const RUN_ID = 'run-abcd1234-5678';
const AUTOMATION_ID = 'auto-wxyz9876-5432';

function paused(over: Record<string, unknown> = {}) {
  storeState.current = {
    activeRun: {
      status: 'paused_for_user',
      runId: RUN_ID,
      automationId: AUTOMATION_ID,
      pauseRequest: { stepIndex: 0, reasoning: 'a captcha', userInstructions: 'solve it' },
      streamingSession: undefined,
      ...over,
    },
    resume: vi.fn(),
    cancel: vi.fn(),
  };
}

beforeEach(() => {
  confirmMock.mockReset();
  paused();
});

describe('S8 review round - the overlay names the RUN, with the run id', () => {
  it('renders the RUN id, not the automation id, under the run label', () => {
    render(<PauseForUserOverlay />);
    const shown = screen.getByTestId('pause-overlay-run-id');
    expect(shown.textContent).toBe(RUN_ID.slice(0, 8));
    // The precise regression: the automation id must not be what the "Run" label points at.
    expect(shown.textContent).not.toBe(AUTOMATION_ID.slice(0, 8));
  });

  it('degrades to a dash rather than showing the wrong id when no run id is known', () => {
    paused({ runId: undefined });
    render(<PauseForUserOverlay />);
    expect(screen.getByTestId('pause-overlay-run-id').textContent).toBe('-');
  });

  it('stays closed when nothing is paused, so it cannot claim an id for a run that is not waiting', () => {
    paused({ status: 'running' });
    render(<PauseForUserOverlay />);
    expect(screen.queryByTestId('pause-overlay-run-id')).toBeNull();
  });

  it('stays closed when the status is paused but no pause request has arrived yet', () => {
    paused({ pauseRequest: undefined });
    render(<PauseForUserOverlay />);
    expect(screen.queryByTestId('pause-overlay-run-id')).toBeNull();
  });
});
