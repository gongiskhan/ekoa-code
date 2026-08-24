/**
 * The capability-grant section on Settings/Devices (I-3).
 *
 * The page-level e2e is unreachable (the web e2e harness boots api-only, no served dashboard) AND
 * the flow needs a paired machine, which CI has none of - so this committed component spec is the
 * durable regression for the surface that closes
 * `capability-grants-have-no-route-or-ui-so-the-whole-browser-execution-path-is-unreachable`.
 *
 * The typed client is mocked (no network); the REAL store runs against it, so this exercises
 * component -> store -> typed-client wiring end to end. What it pins:
 *
 *   1. THE ROLE GATE. A non-admin gets no section at all, and - the half that matters more - the
 *      list endpoint is never called for them. Rendering an empty box would mean fetching a 403 to
 *      draw it, and a "gate" that still issues the request is not a gate.
 *   2. ADVERTISED vs GRANTED rendered as DIFFERENT things, which is the whole of I-3.
 *   3. `egress.residential` takes an ADDRESS, prefilled from what the machine advertises, and the
 *      address is what gets sent. Granting the capability alone would authorise the machine and let
 *      the machine choose where the org's traffic goes.
 *   4. A capability this server has no name for is SHOWN and has NO grant affordance (fail-closed).
 *   5. A refused grant surfaces the SERVER'S message at the control that was used.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PairedMachinesSection } from '@/components/settings/paired-machines-section';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { useAuthStore } from '@/stores/auth';
import { useBridgeMachinesStore } from '@/stores/bridge-machines';
import { api } from '@/lib/api';
import type { AuthUser, BridgeMachineSummary } from '@ekoa/shared';

vi.mock('@/lib/api', () => ({
  api: {
    ekoaLocal: {
      bridgeListMachines: vi.fn(),
      bridgeGrantCapability: vi.fn(),
      bridgeRevokeCapability: vi.fn(),
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

const mocked = api as unknown as {
  ekoaLocal: {
    bridgeListMachines: ReturnType<typeof vi.fn>;
    bridgeGrantCapability: ReturnType<typeof vi.fn>;
    bridgeRevokeCapability: ReturnType<typeof vi.fn>;
  };
};

function asRole(role: AuthUser['role']): void {
  useAuthStore.setState({ user: { id: 'u1', username: 'admin', role, orgId: 'o1' } as AuthUser } as never);
}

const machine = (over: Partial<BridgeMachineSummary> = {}): BridgeMachineSummary => ({
  pairingId: 'pair-1',
  live: true,
  advertisedCapabilities: ['desktop.automation', 'local.bash'],
  grantedCapabilities: [],
  ...over,
});

function renderSection() {
  return render(
    <ConfirmProvider>
      <PairedMachinesSection />
    </ConfirmProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useBridgeMachinesStore.setState({
    machines: [], isLoading: false, error: null, isLoaded: false, pending: null, failure: null,
  });
  mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({ items: [machine()] });
});

describe('the role gate', () => {
  it('renders nothing for an ordinary user, and never asks for the fleet', async () => {
    asRole('user');
    const { container } = renderSection();

    expect(container.querySelector('[data-testid="paired-machines"]')).toBeNull();
    // The request is the assertion. A section that hid itself but still fetched would put a 403 in
    // every ordinary user's console and would mean the gate is cosmetic.
    expect(mocked.ekoaLocal.bridgeListMachines).not.toHaveBeenCalled();
  });

  it('renders for an org-admin and for a super-admin', async () => {
    asRole('org-admin');
    renderSection();
    await waitFor(() => expect(screen.getByTestId('paired-machines')).toBeTruthy());
    expect(mocked.ekoaLocal.bridgeListMachines).toHaveBeenCalled();

    vi.clearAllMocks();
    mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({ items: [machine()] });
    useBridgeMachinesStore.setState({ machines: [], isLoaded: false });
    asRole('super-admin');
    renderSection();
    await waitFor(() => expect(mocked.ekoaLocal.bridgeListMachines).toHaveBeenCalled());
  });
});

describe('what the administrator is shown', () => {
  it('separates what the machine CLAIMS from what the org AUTHORISED', async () => {
    asRole('org-admin');
    mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({
      items: [machine({ grantedCapabilities: ['local.bash'] })],
    });
    renderSection();

    const card = await screen.findByTestId('machine-pair-1');
    // The granted one offers a withdraw; the advertised-but-ungranted one offers an authorise.
    expect(within(card).getByTestId('capability-toggle-pair-1-local.bash').textContent).toContain('Retirar');
    expect(within(card).getByTestId('capability-toggle-pair-1-desktop.automation').textContent).toContain('Autorizar');
  });

  it('shows an empty state when the org has no machines', async () => {
    asRole('org-admin');
    mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({ items: [] });
    renderSection();
    await waitFor(() => expect(screen.getByText('Sem máquinas emparelhadas')).toBeTruthy());
  });

  /**
   * REVIEW ROUND. A load that FAILED is not a reading of the fleet, so it must never leave the
   * surface able to claim the org has no machines. With `isLoaded` set on failure, the retry below
   * carried `isLoaded: true`, `error: null` (cleared as the retry starts) and an empty list, and
   * the empty state rendered while the request was still in flight - telling an administrator they
   * own no machines when the truth was that the server could not be reached.
   */
  it('a failed load, then a retry, never claims the org has no machines', async () => {
    asRole('org-admin');
    mocked.ekoaLocal.bridgeListMachines.mockRejectedValueOnce(new Error('network down'));
    renderSection();

    // The failure shows as a failure, not as an empty fleet.
    await waitFor(() => expect(screen.getByTestId('machines-error')).toBeTruthy());
    expect(screen.queryByText('Sem máquinas emparelhadas')).toBeNull();

    // The retry is held open, so the in-flight state is observable rather than a race.
    let release!: (value: { items: BridgeMachineSummary[] }) => void;
    mocked.ekoaLocal.bridgeListMachines.mockReturnValueOnce(
      new Promise<{ items: BridgeMachineSummary[] }>((resolve) => { release = resolve; }),
    );
    await userEvent.click(screen.getByText('Tentar novamente'));

    // Mid-flight: still not an empty-fleet claim.
    expect(screen.queryByText('Sem máquinas emparelhadas')).toBeNull();
    expect(screen.getByText('A carregar máquinas...')).toBeTruthy();

    release({ items: [machine()] });
    await waitFor(() => expect(screen.getByTestId('machine-pair-1')).toBeTruthy());
  });

  it('a capability this server does not recognise is shown, and cannot be authorised', async () => {
    asRole('org-admin');
    mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({
      items: [machine({ advertisedCapabilities: ['local.quantum'], grantedCapabilities: [] })],
    });
    renderSection();

    const card = await screen.findByTestId('machine-pair-1');
    // Visible, because the listing must not lie about what the machine claims ...
    expect(within(card).getByText('local.quantum')).toBeTruthy();
    // ... and not grantable, which is the fail-closed direction.
    expect(within(card).queryByTestId('capability-toggle-pair-1-local.quantum')).toBeNull();
    expect(within(card).getByText('Não reconhecida por este servidor')).toBeTruthy();
  });

  it('a grant for something the machine no longer advertises stays visible, so it can be withdrawn', async () => {
    asRole('org-admin');
    mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({
      items: [machine({ advertisedCapabilities: [], grantedCapabilities: ['local.bash'] })],
    });
    renderSection();

    const card = await screen.findByTestId('machine-pair-1');
    expect(within(card).getByText('Não comunicada pela máquina')).toBeTruthy();
    expect(within(card).getByTestId('capability-toggle-pair-1-local.bash').textContent).toContain('Retirar');
  });
});

describe('granting', () => {
  it('sends the capability and replaces the row from the SERVER\'s answer', async () => {
    asRole('org-admin');
    mocked.ekoaLocal.bridgeGrantCapability.mockResolvedValue({
      ok: true,
      machine: machine({ grantedCapabilities: ['desktop.automation'] }),
    });
    renderSection();

    const card = await screen.findByTestId('machine-pair-1');
    await userEvent.click(within(card).getByTestId('capability-toggle-pair-1-desktop.automation'));

    await waitFor(() =>
      expect(mocked.ekoaLocal.bridgeGrantCapability).toHaveBeenCalledWith({
        pairingId: 'pair-1',
        capability: 'desktop.automation',
      }),
    );
    // The row now reflects the server's answer rather than a locally-guessed one.
    await waitFor(() =>
      expect(screen.getByTestId('capability-toggle-pair-1-desktop.automation').textContent).toContain('Retirar'),
    );
  });

  it('egress.residential carries the ADDRESS, prefilled from what the machine advertises', async () => {
    asRole('org-admin');
    mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({
      items: [machine({ advertisedCapabilities: ['egress.residential'], egressEndpoint: 'http://100.64.1.1:1080' })],
    });
    mocked.ekoaLocal.bridgeGrantCapability.mockResolvedValue({
      ok: true,
      machine: machine({
        advertisedCapabilities: ['egress.residential'],
        grantedCapabilities: ['egress.residential'],
        egressEndpoint: 'http://100.64.1.1:1080',
        grantedEgressEndpoint: 'http://100.64.1.1:1080',
      }),
    });
    renderSection();

    const card = await screen.findByTestId('machine-pair-1');
    const field = within(card).getByTestId('egress-endpoint-pair-1') as HTMLInputElement;
    // Prefilled, so the person deciding SEES the destination they are authorising.
    expect(field.value).toBe('http://100.64.1.1:1080');

    await userEvent.click(within(card).getByTestId('capability-toggle-pair-1-egress.residential'));
    await waitFor(() =>
      expect(mocked.ekoaLocal.bridgeGrantCapability).toHaveBeenCalledWith({
        pairingId: 'pair-1',
        capability: 'egress.residential',
        egressEndpoint: 'http://100.64.1.1:1080',
      }),
    );
  });

  /**
   * REVIEW ROUND. The field is seeded from the advertisement, so it has to FOLLOW the
   * advertisement. Seeded once, a card that stays mounted across a refetch keeps offering the
   * address it mounted with while the machine is now advertising a different one - and the
   * administrator authorises a destination nobody is offering. It fails safe (routing withholds
   * the route on mismatch, and the card warns), but it fails safe by accident: the person is being
   * asked to approve an address the surface itself has already superseded.
   */
  it('the endpoint field follows the machine when it re-advertises a different address', async () => {
    asRole('org-admin');
    const advertising = (address: string) =>
      machine({ advertisedCapabilities: ['egress.residential'], egressEndpoint: address });
    mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({ items: [advertising('http://100.64.1.1:1080')] });
    renderSection();

    const field = (await screen.findByTestId('egress-endpoint-pair-1')) as HTMLInputElement;
    expect(field.value).toBe('http://100.64.1.1:1080');

    // The same card stays mounted (same pairingId) while the machine re-advertises.
    mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({ items: [advertising('http://100.64.9.9:1080')] });
    await act(async () => { await useBridgeMachinesStore.getState().fetchMachines(); });

    await waitFor(() =>
      expect((screen.getByTestId('egress-endpoint-pair-1') as HTMLInputElement).value).toBe('http://100.64.9.9:1080'),
    );
    // ...and it is the NEW address that would be authorised, not the one the card mounted with.
    mocked.ekoaLocal.bridgeGrantCapability.mockResolvedValue({ ok: true, machine: advertising('http://100.64.9.9:1080') });
    await userEvent.click(screen.getByTestId('capability-toggle-pair-1-egress.residential'));
    await waitFor(() =>
      expect(mocked.ekoaLocal.bridgeGrantCapability).toHaveBeenCalledWith({
        pairingId: 'pair-1',
        capability: 'egress.residential',
        egressEndpoint: 'http://100.64.9.9:1080',
      }),
    );
  });

  it('warns when the machine has moved to an address the org never authorised', async () => {
    asRole('org-admin');
    mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({
      items: [machine({
        advertisedCapabilities: ['egress.residential'],
        grantedCapabilities: ['egress.residential'],
        egressEndpoint: 'http://100.64.9.9:1080',
        grantedEgressEndpoint: 'http://100.64.1.1:1080',
      })],
    });
    renderSection();
    // Without this an administrator sees a granted capability beside a live machine and no reason
    // for the silence: `egressCandidatesForOrg` withholds the route when the two addresses differ.
    expect(await screen.findByTestId('egress-mismatch')).toBeTruthy();
  });

  it('a refused grant shows the SERVER\'s message at the control that was used', async () => {
    asRole('org-admin');
    mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({
      items: [machine({ advertisedCapabilities: ['egress.residential'] })],
    });
    mocked.ekoaLocal.bridgeGrantCapability.mockRejectedValue(
      Object.assign(new Error('boom'), { message: 'a egress.residential grant must name the egress endpoint it authorises' }),
    );
    renderSection();

    const card = await screen.findByTestId('machine-pair-1');
    await userEvent.click(within(card).getByTestId('capability-toggle-pair-1-egress.residential'));

    const failure = await screen.findByTestId('capability-failure');
    // Verbatim: a residential grant refused for a missing endpoint says exactly what is wrong, and
    // a generic "could not save" would throw that away.
    expect(failure.textContent).toContain('must name the egress endpoint');
  });
});

describe('withdrawing', () => {
  it('confirms first, then calls revoke', async () => {
    asRole('org-admin');
    mocked.ekoaLocal.bridgeListMachines.mockResolvedValue({
      items: [machine({ grantedCapabilities: ['local.bash'] })],
    });
    mocked.ekoaLocal.bridgeRevokeCapability.mockResolvedValue({
      ok: true, revoked: true, machine: machine({ grantedCapabilities: [] }),
    });
    renderSection();

    const card = await screen.findByTestId('machine-pair-1');
    await userEvent.click(within(card).getByTestId('capability-toggle-pair-1-local.bash'));

    // The dialog stands between the click and the call: turning a capability off stops work the
    // org depends on, so it is not a one-click action.
    expect(mocked.ekoaLocal.bridgeRevokeCapability).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retirar' }));

    await waitFor(() =>
      expect(mocked.ekoaLocal.bridgeRevokeCapability).toHaveBeenCalledWith({
        pairingId: 'pair-1', capability: 'local.bash',
      }),
    );
  });
});
