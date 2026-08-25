/**
 * "CONCLUIR E CAPTURAR" - the ceremony's capture signal, moved off the window (D-CEREMONY-DONE).
 *
 * THE FAILURE THIS CLOSES, measured live. The attended ceremony captured the session ONLY when the
 * human CLOSED the headed browser it opened. That window is raised by the OS on every top-level
 * navigation and a real login redirects repeatedly, so during an OTP/2FA flow the person cannot stay
 * in the app holding the code - and nothing on screen said that closing the window is what captures.
 * The operator logged in and the ceremony expired having captured nothing (findings,
 * `attended-ceremony-browser-steals-focus-and-hides-its-capture-signal`).
 *
 * WHAT IS PINNED HERE. The affordance exists only once a window has actually been opened; the copy
 * states the new model in the words that make it usable ("nao precisa de fechar a janela"); the
 * click reaches the capture endpoint; and each of the three outcomes is reported as what it is -
 * captured, not yet, or a refusal in the server's own words. The last one matters most: a button
 * that claims success it has not seen would reproduce the original defect in a new place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { establishMock, captureMock } = vi.hoisted(() => ({
  establishMock: vi.fn(),
  captureMock: vi.fn(),
}));

// Only the typed client is mocked; the page's own state machine is the thing under test.
vi.mock('@/stores/cofre', async () => {
  const actual = await vi.importActual<typeof import('@/stores/cofre')>('@/stores/cofre');
  return {
    ...actual,
    useCofreStore: () => ({
      items: [],
      isLoading: false,
      error: null,
      fetchItems: vi.fn(),
      lockAll: vi.fn(),
      establishSession: establishMock,
      captureSession: captureMock,
    }),
  };
});

vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => vi.fn(async () => true),
}));

import CofrePage from '@/app/(dashboard)/cofre/page';

const ORIGIN = 'orders.adhoc.example';

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', `/cofre?origin=${ORIGIN}`);
  establishMock.mockResolvedValue({ started: true, message: 'Abriu-se uma janela na sua máquina.' });
  captureMock.mockResolvedValue({ requested: true, captured: true, message: 'A capturar a sessão.' });
});

async function openTheWindow(): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Abrir janela de autenticação/i }));
  await waitFor(() => expect(establishMock).toHaveBeenCalledWith(ORIGIN));
}

describe('the Done-capture affordance on the /cofre ceremony card', () => {
  it('is NOT offered before a window has been opened', () => {
    // Offering it first would ask someone to finish something never started, and the server could
    // only answer with a refusal that reads like a fault.
    render(<CofrePage />);
    expect(screen.queryByTestId('cofre-capture-now')).toBeNull();
    expect(screen.queryByTestId('cofre-capture-hint')).toBeNull();
  });

  it('appears once the window is open, and says that closing it is not required', async () => {
    render(<CofrePage />);
    await openTheWindow();

    expect(await screen.findByTestId('cofre-capture-now')).toHaveTextContent('Concluir e capturar');
    // The sentence that replaces "feche a janela quando terminar" - the instruction whose absence
    // cost the live ceremony its capture.
    expect(screen.getByTestId('cofre-capture-hint')).toHaveTextContent(
      'Inicie sessão na janela, depois clique aqui - não precisa de fechar a janela.',
    );
  });

  it('is NOT offered when the window could not be opened', async () => {
    establishMock.mockResolvedValue({ started: false, message: 'Nenhuma máquina ligada.' });
    render(<CofrePage />);
    await openTheWindow();

    expect(await screen.findByTestId('cofre-establish-outcome')).toHaveTextContent('Nenhuma máquina ligada.');
    expect(screen.queryByTestId('cofre-capture-now')).toBeNull();
  });

  it('captures for the origin the card was opened for, and says so when it lands', async () => {
    const user = userEvent.setup();
    render(<CofrePage />);
    await openTheWindow();

    await user.click(screen.getByTestId('cofre-capture-now'));

    await waitFor(() => expect(captureMock).toHaveBeenCalledWith(ORIGIN));
    expect(await screen.findByTestId('cofre-capture-outcome')).toHaveTextContent('Sessão capturada');
  });

  it('does NOT claim a capture it has not seen', async () => {
    // `requested` means a frame reached the machine. If no session followed, the window is still
    // open and the login may simply be unfinished - so the card says that, and does not send the
    // person off to start over on a ceremony that is alive.
    captureMock.mockResolvedValue({ requested: true, captured: false, message: 'A capturar a sessão.' });
    const user = userEvent.setup();
    render(<CofrePage />);
    await openTheWindow();

    await user.click(screen.getByTestId('cofre-capture-now'));

    const outcome = await screen.findByTestId('cofre-capture-outcome');
    expect(outcome).toHaveTextContent('Ainda não recebemos a sessão');
    expect(outcome.textContent).not.toContain('capturada e guardada');
  });

  /**
   * THE ONE STATE WHERE THE REST OF THIS CARD'S ADVICE IS WRONG (review round 2026-08-25, F2).
   *
   * Everything else here says closing the window is unnecessary - true of the happy path, and the
   * whole point of the feature. But this branch is reached exactly when Done did NOT produce a
   * session, and the remaining causes (a Ponte too old to understand the frame, a login that was
   * never finished, a daemon holding a ceremony the request could not reach) share one working
   * route: close the window. Copy that only said "tente novamente" would leave the person pressing
   * the single button that may never work while denying the one action that does.
   */
  it('names closing the window as the recovery when nothing arrived', async () => {
    captureMock.mockResolvedValue({ requested: true, captured: false, message: 'A capturar a sessão.' });
    const user = userEvent.setup();
    render(<CofrePage />);
    await openTheWindow();

    await user.click(screen.getByTestId('cofre-capture-now'));

    const outcome = await screen.findByTestId('cofre-capture-outcome');
    expect(outcome).toHaveTextContent('feche a janela, que também captura');
    // ...and it stays a "not yet" rather than a failure: the ceremony is alive and Done still works.
    expect(outcome).toHaveTextContent('tente novamente');
    expect(outcome.textContent).not.toMatch(/falh|erro/i);
  });

  it('keeps the happy-path hint saying a close is NOT required', async () => {
    // The two sentences are for different states and must not converge: the standing hint is the
    // instruction for the flow that works, and turning it into "close the window" would hand the
    // focus-stealing window its old job back.
    render(<CofrePage />);
    await openTheWindow();

    expect(await screen.findByTestId('cofre-capture-hint')).toHaveTextContent('não precisa de fechar a janela');
  });

  it("shows the server's own words when the capture is refused", async () => {
    captureMock.mockResolvedValue({
      requested: false,
      captured: false,
      message: 'Não há nenhuma janela de autenticação aberta para orders.adhoc.example.',
    });
    const user = userEvent.setup();
    render(<CofrePage />);
    await openTheWindow();

    await user.click(screen.getByTestId('cofre-capture-now'));

    expect(await screen.findByTestId('cofre-capture-outcome')).toHaveTextContent(
      'Não há nenhuma janela de autenticação aberta',
    );
  });
});
