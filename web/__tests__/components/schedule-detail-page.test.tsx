/**
 * Schedule detail page. Three failures this surface used to hide, none of them reachable from
 * the e2e harness (they need a server that breaks in a chosen way):
 *
 *  1. `setCurrent(res.ok ? res.data : null)` threw the ApiError away, so a 500, a 403 and a
 *     dropped connection all rendered "Agendamento não encontrado" - the page told the user
 *     their schedule was gone. Only the server's 404 means that (it is also how a refusal and a
 *     cross-tenant read answer - one uniform envelope, deliberately);
 *  2. the run history read `runs === undefined` as "still loading", but a FAILED history fetch
 *     never writes that key, so the spinner ran forever;
 *  3. edit/toggle/run-now/delete are owner-only on the server (+ super-admin); an org-admin
 *     reading a peer's schedule was shown all four, each guaranteed to 404.
 *
 * The typed client is mocked (no network); the real store and the real page run against it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScheduleDetailPage from '@/app/(dashboard)/schedules/[id]/page';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { useSchedulesStore } from '@/stores/schedules';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { api } from '@/lib/api';
import type { AuthUser, Schedule, ScheduleRun } from '@ekoa/shared';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'sch-1' }),
  useRouter: () => ({ push: (...args: unknown[]) => push(...args) }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** Shaped like the transport's ApiError: the page branches on `status`, which the old code lost. */
class FakeApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

vi.mock('@/lib/api', () => ({
  api: {
    schedules: {
      get: vi.fn(),
      listRuns: vi.fn(),
      patch: vi.fn(),
      remove: vi.fn(),
      runNow: vi.fn(),
      create: vi.fn(),
      preview: vi.fn(),
      list: vi.fn(),
      listAllRuns: vi.fn(),
      completeRun: vi.fn(),
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
  // The page imports ApiError as a TYPE and branches on `error.status`, so the exported class
  // is only here for the auth store's value import (vi.mock factories are hoisted, which is why
  // the thrown FakeApiError above cannot be reused here).
  ApiError: class ApiError extends Error {},
  isApiError: () => false,
}));

const mocked = api as unknown as {
  schedules: Record<'get' | 'listRuns' | 'patch' | 'remove' | 'runNow', ReturnType<typeof vi.fn>>;
};

const ME = 'u-me';
const PEER = 'u-peer';

const schedule = (over: Partial<Schedule> = {}): Schedule =>
  ({
    id: 'sch-1',
    name: 'Relatório semanal',
    target: { kind: 'manual', instructions: 'Rever faturação' },
    spec: { kind: 'recurring', rule: { every: 'day', interval: 1, at: { hour: 9, minute: 0 }, timezone: 'Europe/Lisbon' } },
    enabled: true,
    nextRunAt: '2099-01-01T08:00:00.000Z',
    ownerId: ME,
    ...over,
  }) as Schedule;

const run = (over: Partial<ScheduleRun> = {}): ScheduleRun =>
  ({
    id: 'run-1',
    scheduleId: 'sch-1',
    status: 'ok',
    plannedFor: '2026-08-17T08:00:00.000Z',
    trigger: 'auto',
    ownerId: ME,
    ...over,
  }) as ScheduleRun;

function seedAuth(role: AuthUser['role']) {
  useAuthStore.setState({ user: { id: ME, username: 'me', role, orgId: 'org1', active: true } as AuthUser });
}

function renderPage() {
  return render(
    <ConfirmProvider>
      <ScheduleDetailPage />
    </ConfirmProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.schedules.get.mockResolvedValue(schedule());
  mocked.schedules.listRuns.mockResolvedValue({ items: [] });
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

describe('a fetch that failed vs a schedule that is gone', () => {
  it('offers a retry on a 500 instead of announcing the schedule does not exist', async () => {
    mocked.schedules.get.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'Erro interno.'));
    renderPage();

    const failure = await screen.findByTestId('schedule-detail-load-error');
    expect(screen.getByText('Não foi possível carregar o agendamento')).toBeInTheDocument();
    expect(screen.getByText('Erro interno.')).toBeInTheDocument();
    expect(screen.queryByText('Agendamento não encontrado')).toBeNull();

    mocked.schedules.get.mockResolvedValue(schedule());
    await userEvent.click(within(failure).getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('Relatório semanal')).toBeInTheDocument();
  });

  it('treats a lost connection as a failed read, not as an absent schedule', async () => {
    mocked.schedules.get.mockRejectedValue(new FakeApiError(0, 'NETWORK_ERROR', 'Sem ligação.'));
    renderPage();

    expect(await screen.findByTestId('schedule-detail-load-error')).toBeInTheDocument();
    expect(screen.queryByText('Agendamento não encontrado')).toBeNull();
  });

  it('keeps the not-found story for the server 404 that means exactly that', async () => {
    mocked.schedules.get.mockRejectedValue(new FakeApiError(404, 'NOT_FOUND', 'Agendamento não encontrado.'));
    renderPage();

    expect(await screen.findByText('Agendamento não encontrado')).toBeInTheDocument();
    expect(screen.queryByTestId('schedule-detail-load-error')).toBeNull();
  });
});

describe('run history', () => {
  it('shows the failure with a retry instead of a spinner that never resolves', async () => {
    mocked.schedules.listRuns.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'Histórico indisponível.'));
    renderPage();

    const failure = await screen.findByTestId('schedule-history-error');
    expect(within(failure).getByText('Histórico indisponível.')).toBeInTheDocument();
    expect(screen.queryByText('A carregar histórico...')).toBeNull();

    mocked.schedules.listRuns.mockResolvedValue({ items: [run()] });
    await userEvent.click(within(failure).getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByTestId('schedule-run-row')).toBeInTheDocument();
    expect(screen.queryByTestId('schedule-history-error')).toBeNull();
  });

  it('still says the history is empty when it came back empty', async () => {
    renderPage();
    expect(await screen.findByText('Ainda não houve execuções.')).toBeInTheDocument();
    expect(screen.queryByTestId('schedule-history-error')).toBeNull();
  });
});

describe('owner-only controls', () => {
  it('gives an org-admin a peer\'s schedule to read, without the four controls that would 404', async () => {
    seedAuth('org-admin');
    mocked.schedules.get.mockResolvedValue(schedule({ ownerId: PEER }));
    renderPage();

    expect(await screen.findByText('Relatório semanal')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Executar agora' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Eliminar agendamento' })).toBeNull();
    // The state the switch carried survives as a badge.
    expect(screen.getByText('Ativo')).toBeInTheDocument();
  });

  it('keeps every control on the owner\'s own schedule', async () => {
    renderPage();

    expect(await screen.findByRole('switch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Executar agora' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar agendamento' })).toBeInTheDocument();
  });
});

describe('a mutation that was refused', () => {
  it('reports a refused toggle instead of leaving the switch to snap back', async () => {
    mocked.schedules.patch.mockRejectedValue(new FakeApiError(404, 'NOT_FOUND', 'Agendamento não encontrado.'));
    renderPage();

    await userEvent.click(await screen.findByRole('switch'));

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Agendamento não encontrado.'),
    );
    expect(push).not.toHaveBeenCalled();
  });
});
