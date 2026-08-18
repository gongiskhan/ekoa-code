/**
 * Schedules list page. The page-level e2e cannot reach these paths (they need a broken server
 * and a second user in the org), so this committed component spec is the durable regression for
 * the three ways the list surface used to lie to the person reading it:
 *
 *  1. a FAILED read rendered "Ainda não há agendamentos" - the page asserted the user's data
 *     did not exist because it had not arrived. A broken read now takes the empty state's place
 *     and offers a retry;
 *  2. a REFUSED mutation was silent - the enable switch snapped back, delete/run-now/complete
 *     did nothing visible. Every one of them now reports through the toast channel the rest of
 *     the estate uses (integrations/page.tsx);
 *  3. an org-admin SEES the whole org's schedules but may only MUTATE its own (owner-only +
 *     super-admin, `api/src/schedules/store.ts`), and the server refuses the rest with a uniform
 *     404. The peers' rows carried a full set of controls that could only ever fail.
 *
 * The typed client is mocked (no network); the real store and the real page run against it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SchedulesPage from '@/app/(dashboard)/schedules/page';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { useSchedulesStore } from '@/stores/schedules';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { api } from '@/lib/api';
import type { AuthUser, Schedule, ScheduleRun } from '@ekoa/shared';

// next/link needs an app-router context that jsdom has none of; the anchor is what this suite
// asserts about (a real, focusable, href-carrying element), so render exactly that.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/api', () => ({
  api: {
    schedules: {
      list: vi.fn(),
      listAllRuns: vi.fn(),
      listRuns: vi.fn(),
      create: vi.fn(),
      patch: vi.fn(),
      remove: vi.fn(),
      runNow: vi.fn(),
      completeRun: vi.fn(),
      preview: vi.fn(),
    },
    automations: { list: vi.fn() },
    integrations: { listSkills: vi.fn(), listConfigs: vi.fn() },
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
  schedules: Record<'list' | 'listAllRuns' | 'patch' | 'remove' | 'runNow' | 'completeRun', ReturnType<typeof vi.fn>>;
};

const ME = 'u-me';
const PEER = 'u-peer';

const schedule = (over: Partial<Schedule> = {}): Schedule =>
  ({
    id: 'sch-mine',
    name: 'Relatório semanal',
    target: { kind: 'manual', instructions: 'Rever faturação' },
    spec: { kind: 'recurring', rule: { every: 'day', interval: 1, at: { hour: 9, minute: 0 }, timezone: 'Europe/Lisbon' } },
    enabled: true,
    nextRunAt: '2099-01-01T08:00:00.000Z',
    ownerId: ME,
    ...over,
  }) as Schedule;

const task = (over: Partial<ScheduleRun> = {}): ScheduleRun =>
  ({
    id: 'run-mine',
    scheduleId: 'sch-mine',
    status: 'pending',
    plannedFor: '2099-01-01T08:00:00.000Z',
    trigger: 'manual',
    ownerId: ME,
    ...over,
  }) as ScheduleRun;

function seedAuth(role: AuthUser['role']) {
  useAuthStore.setState({ user: { id: ME, username: 'me', role, orgId: 'org1', active: true } as AuthUser });
}

function renderPage() {
  return render(
    <ConfirmProvider>
      <SchedulesPage />
    </ConfirmProvider>,
  );
}

const toastMessages = () => useToastStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.schedules.list.mockResolvedValue({ items: [] });
  mocked.schedules.listAllRuns.mockResolvedValue({ items: [] });
  useSchedulesStore.setState({
    items: [],
    runs: {},
    runsError: {},
    orgRuns: [],
    pendingTasks: [],
    loading: false,
    error: undefined,
    loadError: undefined,
  });
  useToastStore.setState({ toasts: [] });
  seedAuth('user');
});

describe('a read that failed', () => {
  it('shows the failure with a retry instead of claiming there are no schedules', async () => {
    mocked.schedules.list.mockRejectedValue(new Error('Erro interno.'));
    renderPage();

    const failure = await screen.findByTestId('schedules-load-error');
    expect(within(failure).getByText('Erro interno.')).toBeInTheDocument();
    // The empty state is a factual claim about the user's data; it must not be made here.
    expect(screen.queryByText('Ainda não há agendamentos')).toBeNull();

    mocked.schedules.list.mockResolvedValue({ items: [schedule()] });
    await userEvent.click(within(failure).getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('Relatório semanal')).toBeInTheDocument();
    expect(screen.queryByTestId('schedules-load-error')).toBeNull();
  });

  it('still says "no schedules yet" when the list genuinely came back empty', async () => {
    renderPage();
    expect(await screen.findByText('Ainda não há agendamentos')).toBeInTheDocument();
    expect(screen.queryByTestId('schedules-load-error')).toBeNull();
  });
});

describe('a mutation that was refused', () => {
  beforeEach(() => {
    mocked.schedules.list.mockResolvedValue({ items: [schedule()] });
  });

  it('reports a refused toggle rather than letting the switch snap back in silence', async () => {
    mocked.schedules.patch.mockRejectedValue(new Error('Sem permissão.'));
    renderPage();

    await userEvent.click(await screen.findByRole('switch', { name: 'Ativar ou pausar o agendamento' }));

    await waitFor(() => expect(toastMessages()).toContain('Sem permissão.'));
    // The list is untouched: reporting a failed write must not blank the page.
    expect(screen.getByText('Relatório semanal')).toBeInTheDocument();
  });

  it('reports a refused run-now', async () => {
    mocked.schedules.runNow.mockRejectedValue(new Error('Indisponível.'));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Executar agora' }));

    await waitFor(() => expect(toastMessages()).toContain('Indisponível.'));
  });

  it('reports a refused delete once the confirmation is given', async () => {
    mocked.schedules.remove.mockRejectedValue(new Error('Conflito.'));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar agendamento' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(toastMessages()).toContain('Conflito.'));
  });

  it('reports a refused task completion from the inbox', async () => {
    mocked.schedules.listAllRuns.mockResolvedValue({ items: [task()] });
    mocked.schedules.completeRun.mockRejectedValue(new Error('Já concluída.'));
    renderPage();

    const inboxRow = await screen.findByTestId('schedule-inbox-row');
    await userEvent.click(within(inboxRow).getByRole('button', { name: 'Concluir' }));

    await waitFor(() => expect(toastMessages()).toContain('Já concluída.'));
  });
});

describe('controls the actor could not use', () => {
  const rowNamed = async (name: string) => {
    const rows = await screen.findAllByTestId('schedule-row');
    const row = rows.find((candidate) => candidate.textContent?.includes(name));
    if (!row) throw new Error(`row "${name}" not rendered`);
    return row;
  };

  it('gives an org-admin a peer\'s row to read, without the knobs the server would 404', async () => {
    seedAuth('org-admin');
    mocked.schedules.list.mockResolvedValue({
      items: [schedule(), schedule({ id: 'sch-peer', name: 'Cobranças do Peer', ownerId: PEER })],
    });
    renderPage();

    const peerRow = await rowNamed('Cobranças do Peer');
    expect(within(peerRow).queryByRole('switch')).toBeNull();
    expect(within(peerRow).queryByRole('button', { name: 'Executar agora' })).toBeNull();
    expect(within(peerRow).queryByRole('button', { name: 'Eliminar agendamento' })).toBeNull();
    // Readable, though: the enabled state the switch used to carry is still on the row.
    expect(within(peerRow).getByText('Ativo')).toBeInTheDocument();

    const ownRow = await rowNamed('Relatório semanal');
    expect(within(ownRow).getByRole('switch')).toBeInTheDocument();
    expect(within(ownRow).getByRole('button', { name: 'Executar agora' })).toBeInTheDocument();
    expect(within(ownRow).getByRole('button', { name: 'Eliminar agendamento' })).toBeInTheDocument();
  });

  it('lets a super-admin act on anything', async () => {
    seedAuth('super-admin');
    mocked.schedules.list.mockResolvedValue({ items: [schedule({ id: 'sch-peer', ownerId: PEER })] });
    renderPage();

    const row = await rowNamed('Relatório semanal');
    expect(within(row).getByRole('switch')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Eliminar agendamento' })).toBeInTheDocument();
  });

  it('offers Concluir/Dispensar only on the actor\'s own inbox tasks', async () => {
    seedAuth('org-admin');
    mocked.schedules.list.mockResolvedValue({ items: [schedule()] });
    mocked.schedules.listAllRuns.mockResolvedValue({
      items: [task(), task({ id: 'run-peer', ownerId: PEER })],
    });
    renderPage();

    const rows = await screen.findAllByTestId('schedule-inbox-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('button', { name: 'Concluir' })).toBeInTheDocument();
    expect(within(rows[1]!).queryByRole('button', { name: 'Concluir' })).toBeNull();
    expect(within(rows[1]!).queryByRole('button', { name: 'Dispensar' })).toBeNull();
    expect(within(rows[1]!).getByText('De outro utilizador')).toBeInTheDocument();
  });
});

describe('reaching a schedule', () => {
  it('navigates through a real link, so the row is not mouse-only', async () => {
    mocked.schedules.list.mockResolvedValue({ items: [schedule()] });
    renderPage();

    const link = await screen.findByRole('link', { name: 'Relatório semanal' });
    expect(link).toHaveAttribute('href', '/schedules/sch-mine');
    // Reachable by keyboard: an anchor with an href is in the tab order by construction, which
    // the previous `<div onClick>` was not.
    link.focus();
    expect(link).toHaveFocus();
  });
});
