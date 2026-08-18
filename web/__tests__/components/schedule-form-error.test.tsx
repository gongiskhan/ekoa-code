/**
 * Where the schedule form puts its validation error.
 *
 * The dialog body scrolls (`max-h-[70vh] overflow-y-auto`, ui/dialog.tsx) and the footer holding
 * Cancel/Create does not. The error used to be the LAST child of that scrolling body, so a form
 * long enough to scroll - which the recurrence builder plus the timezone picker always is - could
 * answer a rejected submit with a message parked below the fold: from where the user was looking,
 * pressing the button did nothing at all.
 *
 * This pins the placement, not the copy: the error must share the non-scrolling footer with the
 * button that produced it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduleForm } from '@/components/schedules/schedule-form';
import { useSchedulesStore } from '@/stores/schedules';

vi.mock('@/lib/api', () => ({
  api: {
    schedules: { create: vi.fn(), patch: vi.fn(), preview: vi.fn().mockResolvedValue({ occurrences: [] }) },
    automations: { list: vi.fn().mockResolvedValue({ items: [] }) },
    integrations: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      listConfigs: vi.fn().mockResolvedValue({ items: [] }),
      listActive: vi.fn().mockResolvedValue({ items: [] }),
    },
  },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true as const, data: await fn() };
    } catch (error) {
      return { ok: false as const, error };
    }
  },
  setToken: vi.fn(),
  clearToken: vi.fn(),
  ApiError: class ApiError extends Error {},
  isApiError: () => false,
}));

beforeEach(() => {
  vi.clearAllMocks();
  useSchedulesStore.setState({ error: undefined, loadError: undefined });
});

describe('schedule form validation error', () => {
  it('renders beside the submit button, outside the scrolling body', async () => {
    render(<ScheduleForm open onClose={() => {}} />);

    // Submit with an empty name: the first validation gate, no network involved.
    const submit = screen.getByTestId('schedule-form-submit');
    await userEvent.click(submit);

    const error = await screen.findByTestId('schedule-form-error');
    expect(error).toHaveTextContent('Dê um nome ao agendamento.');
    // Same container as the button the user just pressed...
    expect(error.parentElement).toContainElement(submit);
    // ...and that container is not the one that scrolls, so the message cannot be off-screen.
    expect(error.closest('.overflow-y-auto')).toBeNull();
    expect(screen.getByTestId('schedule-form')).not.toContainElement(error);
  });
});
