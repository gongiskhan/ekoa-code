import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { ConfirmProvider, useConfirm } from '@/components/ui/confirm-dialog';

function Harness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () => {
        const ok = await confirm({ title: 'Delete this?', confirmLabel: 'Yes', tone: 'danger' });
        onResult(ok);
      }}
    >
      trigger
    </button>
  );
}

describe('useConfirm', () => {
  it('resolves true when the confirm action is taken', async () => {
    const results: boolean[] = [];
    render(
      <ConfirmProvider>
        <Harness onResult={(v) => results.push(v)} />
      </ConfirmProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'trigger' }));
    expect(screen.getByText('Delete this?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(results).toEqual([true]));
  });

  it('resolves false when cancelled', async () => {
    const results: boolean[] = [];
    render(
      <ConfirmProvider>
        <Harness onResult={(v) => results.push(v)} />
      </ConfirmProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'trigger' }));
    // Default cancel label comes from i18n (pt): "Cancelar".
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(results).toEqual([false]));
  });

  it('resolves the first pending promise with false when a second confirm arrives', async () => {
    const first: boolean[] = [];
    const second: boolean[] = [];

    function Concurrent() {
      const confirm = useConfirm();
      const firstPromise = useRef<Promise<boolean> | null>(null);
      return (
        <>
          <button
            onClick={() => {
              firstPromise.current = confirm({ title: 'First?' });
              firstPromise.current.then((v) => first.push(v));
            }}
          >
            open-first
          </button>
          <button
            onClick={() => {
              confirm({ title: 'Second?' }).then((v) => second.push(v));
            }}
          >
            open-second
          </button>
        </>
      );
    }

    render(
      <ConfirmProvider>
        <Concurrent />
      </ConfirmProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'open-first' }));
    await userEvent.click(screen.getByRole('button', { name: 'open-second' }));

    // First promise settled false immediately; second is still pending.
    await waitFor(() => expect(first).toEqual([false]));
    expect(second).toEqual([]);
    expect(screen.getByText('Second?')).toBeInTheDocument();

    // Confirming the second dialog resolves only the second promise with true.
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(second).toEqual([true]));
    expect(first).toEqual([false]);
  });

  it('resolves a pending confirm with false when the provider unmounts', async () => {
    const results: boolean[] = [];

    function Trigger() {
      const confirm = useConfirm();
      return (
        <button onClick={() => confirm({ title: 'Pending?' }).then((v) => results.push(v))}>
          open
        </button>
      );
    }

    const { unmount } = render(
      <ConfirmProvider>
        <Trigger />
      </ConfirmProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(results).toEqual([]);

    act(() => unmount());
    await waitFor(() => expect(results).toEqual([false]));
  });

  it('throws when used outside a ConfirmProvider', () => {
    function Bare() {
      useConfirm();
      return null;
    }
    // Silence the expected React error boundary noise.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow(/ConfirmProvider/);
    spy.mockRestore();
  });
});
