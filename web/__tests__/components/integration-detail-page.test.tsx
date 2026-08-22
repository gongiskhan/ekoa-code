/**
 * The integration DETAIL page (slice S2). Every case here is a rendering failure the store's own
 * suite cannot see, and each one has already shipped on the schedules surface in this repo:
 *
 *  1. a failed page read rendered as "not found" - the user is told their integration is gone
 *     because a server hiccuped. Only the server's uniform 404 means absent;
 *  2. a failed section read rendered as an EMPTY - "no runs yet" over a 500 is telling somebody
 *     their history does not exist;
 *  3. a failed read rendered as a spinner that never resolves, because "not back yet" and "came
 *     back broken" were the same state;
 *  4. a mutating control rendered for an actor the server would refuse. The write gate lives in
 *     `api/src/integrations/action-consent.ts`; the page mirrors its answer (`requiresApproval`,
 *     `approved`, `connected`) and, where it cannot offer the control, still renders the row;
 *  5. a failed mutation swallowed into a store field nobody reads.
 *
 * The typed client is mocked (no network); the REAL stores and the REAL page run against it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntegrationDetailPage from '@/app/(dashboard)/integrations/[key]/page';
import { useIntegrationDetailStore } from '@/stores/integration-detail';
import { useSchedulesStore } from '@/stores/schedules';
import { useToastStore } from '@/stores/toast';
import { api } from '@/lib/api';
import type { IntegrationCapability, Schedule } from '@ekoa/shared';

const KEY = 'citius';
const HTTP_ACTION = 'consultar_processo';
const RUN_ACTION = 'listar_pendentes';
const AUTOMATION_ID = 'aut-77';

/** The URL's query, mutable so a case can drive an in-app navigation that changes `?action=`
 *  without remounting the page - which is exactly the navigation a mount-only read loses. */
const nav = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ key: KEY }),
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** Shaped like the transport's ApiError: the page branches on `status`. */
class FakeApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

vi.mock('@/lib/api', () => ({
  api: {
    integrations: {
      getIntegration: vi.fn(),
      listActionEvidence: vi.fn(),
      listActionFeedback: vi.fn(),
      setActionFeedback: vi.fn(),
      discardActionFeedback: vi.fn(),
      executeAction: vi.fn(),
    },
    automations: { get: vi.fn(), listRuns: vi.fn() },
    schedules: { list: vi.fn(), listAllRuns: vi.fn(), listRuns: vi.fn() },
    resolveUrl: (u: string) => u,
    withPreviewToken: (u: string) => u,
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

/** The toaster is not mounted here; the store IS the surface the toast lands on. */
const toastMessages = () => useToastStore.getState().toasts.map((t) => t.message);

const mocked = api as unknown as {
  integrations: Record<
    'getIntegration' | 'listActionEvidence' | 'listActionFeedback' | 'setActionFeedback'
    | 'discardActionFeedback' | 'executeAction',
    ReturnType<typeof vi.fn>
  >;
  automations: Record<'get' | 'listRuns', ReturnType<typeof vi.fn>>;
  schedules: Record<'list', ReturnType<typeof vi.fn>>;
};

const capability = (over: Partial<IntegrationCapability> = {}): IntegrationCapability =>
  ({
    integration: {
      key: KEY,
      displayName: 'Citius',
      description: 'Portal dos tribunais',
      actions: [
        { actionName: HTTP_ACTION, description: 'consulta um processo', mutates: false,
          httpConfig: { method: 'get', baseUrl: 'https://citius.example', path: 'processos/{{input.ref}}' } },
        // Declared placeholder, deliberately NOT the org's id - see the store suite's note.
        { actionName: RUN_ACTION, description: 'lista os pendentes', mutates: true,
          automationBinding: { automationId: 'citius-lista-template', automationTemplate: 'lista' } },
      ],
    },
    connected: true,
    actions: [
      { actionName: HTTP_ACTION, description: 'consulta um processo', backingType: 'api-call', transport: 'http',
        target: 'GET https://citius.example/processos', shape: 'sha-http', requiresApproval: false, approved: false },
      { actionName: RUN_ACTION, description: 'lista os pendentes', backingType: 'browser-steps', transport: 'http',
        target: 'browser: citius', shape: 'sha-run', requiresApproval: true, approved: true,
        automationId: AUTOMATION_ID },
    ],
    ...over,
  }) as IntegrationCapability;

const schedule = (over: Partial<Schedule> = {}): Schedule =>
  ({
    id: 'sch-9',
    name: 'Pendentes diários',
    target: { kind: 'integration_action', integrationKey: KEY, actionName: RUN_ACTION },
    spec: { kind: 'recurring', rule: { every: 'day', interval: 1, at: { hour: 9, minute: 0 }, timezone: 'Europe/Lisbon' } },
    enabled: true,
    nextRunAt: '2099-01-01T08:00:00.000Z',
    ...over,
  }) as Schedule;

/** Open one action's panel. The toggle is a real button with an aria-expanded state. */
async function openAction(actionName: string) {
  await userEvent.click(await screen.findByTestId(`integration-action-toggle-${actionName}`));
}

/** The bound automation's plan, two steps - the plan the samples below are joined onto. */
function seedTwoStepPlan() {
  mocked.automations.get.mockResolvedValue({
    id: AUTOMATION_ID,
    name: 'Citius pendentes',
    plan: { steps: [{ description: 'Abrir o portal' }, { description: 'Contar pendentes' }] },
  });
}

/** A two-step automation sample pinning `run-1`, with the action's CURRENT shape. */
function seedRunSample() {
  mocked.integrations.listActionEvidence.mockResolvedValue({
    items: [{
      actionName: RUN_ACTION,
      backingType: 'browser-steps',
      shape: 'sha-run',
      validatedAt: '2026-08-19T10:00:00.000Z',
      evidence: {
        kind: 'automation',
        runId: 'run-1',
        steps: [
          { stepIndex: 0, screenshotUrl: '/automation-screenshots/aut-77/run-1/0.png' },
          { stepIndex: 1, excerpt: 'total 3 pendentes' },
        ],
      },
    }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = '';
  mocked.integrations.getIntegration.mockResolvedValue(capability());
  mocked.integrations.listActionEvidence.mockResolvedValue({ items: [] });
  mocked.integrations.listActionFeedback.mockResolvedValue({ items: [] });
  mocked.automations.get.mockResolvedValue({ id: AUTOMATION_ID, name: 'Citius pendentes', plan: { steps: [] } });
  mocked.automations.listRuns.mockResolvedValue({ items: [] });
  mocked.schedules.list.mockResolvedValue({ items: [] });
  useIntegrationDetailStore.getState().reset();
  useSchedulesStore.setState({ items: [], runs: {}, runsError: {}, orgRuns: [], pendingTasks: [], loading: false, error: undefined, loadError: undefined });
  useToastStore.setState({ toasts: [] });
});

describe('a fetch that failed vs an integration that is not there', () => {
  it('offers a retry on a 500 instead of announcing the integration does not exist', async () => {
    mocked.integrations.getIntegration.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'Erro interno.'));
    render(<IntegrationDetailPage />);

    const failure = await screen.findByTestId('integration-detail-load-error');
    expect(screen.getByText('Não foi possível carregar esta integração')).toBeInTheDocument();
    expect(screen.getByText('Erro interno.')).toBeInTheDocument();
    expect(screen.queryByText('Integração não encontrada')).toBeNull();

    mocked.integrations.getIntegration.mockResolvedValue(capability());
    await userEvent.click(within(failure).getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByText('Citius')).toBeInTheDocument();
  });

  it('treats a lost connection as a failed read, not as an absent integration', async () => {
    mocked.integrations.getIntegration.mockRejectedValue(new FakeApiError(0, 'NETWORK_ERROR', 'Sem ligação.'));
    render(<IntegrationDetailPage />);

    expect(await screen.findByTestId('integration-detail-load-error')).toBeInTheDocument();
    expect(screen.queryByText('Integração não encontrada')).toBeNull();
  });

  it('keeps the not-found story for the server 404 that means exactly that', async () => {
    mocked.integrations.getIntegration.mockRejectedValue(new FakeApiError(404, 'NOT_FOUND', 'Não encontrado.'));
    render(<IntegrationDetailPage />);

    expect(await screen.findByText('Integração não encontrada')).toBeInTheDocument();
    expect(screen.queryByTestId('integration-detail-load-error')).toBeNull();
  });
});

describe('the read-only steps view', () => {
  it('shows an api-call action\'s method and URL template, placeholders and all', async () => {
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    const panel = screen.getByTestId(`integration-action-${HTTP_ACTION}`);
    // Uppercased method, base + path joined, and the `{{input.ref}}` left EXACTLY as authored -
    // resolving it would need argument values this page does not have and must not invent.
    expect(within(panel).getByText('GET')).toBeInTheDocument();
    expect(within(panel).getByText('https://citius.example/processos/{{input.ref}}')).toBeInTheDocument();
  });

  it('resolves the evidence run\'s screenshot and output onto the step it belongs to', async () => {
    seedTwoStepPlan();
    seedRunSample();
    // The run the sample pins IS in this automation's own history: the strongest identity the data
    // carries, so the samples are joined with no caveat.
    mocked.automations.listRuns.mockResolvedValue({
      items: [{ id: 'run-1', automationId: AUTOMATION_ID, status: 'completed', startedAt: '2026-08-19T10:00:00.000Z' }],
    });
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    const steps = await screen.findByTestId(`integration-steps-${AUTOMATION_ID}`);
    expect(within(steps).getByText('Abrir o portal')).toBeInTheDocument();
    // The join is by INDEX - the excerpt belongs to step 2, not step 1.
    expect(within(steps).getByText('total 3 pendentes')).toBeInTheDocument();
    const shot = within(steps).getByRole('img', { name: 'Captura do passo 1' });
    // A POINTER into the authenticated plane, never bytes copied onto the evidence row.
    expect(shot).toHaveAttribute('src', '/automation-screenshots/aut-77/run-1/0.png');
    // Identified, so no caveat above the list.
    expect(screen.queryByTestId(`integration-steps-samples-older-${AUTOMATION_ID}`)).toBeNull();
  });

  it('says the samples may be from an EARLIER version when nothing ties them to this plan', async () => {
    seedTwoStepPlan();
    seedRunSample();
    // The run is not in this automation's history (bounded at 20, or the binding moved). The
    // samples still ADDRESS these steps, so they are shown - with the provenance stated rather
    // than presented as evidence for the steps on screen.
    mocked.automations.listRuns.mockResolvedValue({
      items: [{ id: 'some-other-run', automationId: AUTOMATION_ID, status: 'completed' }],
    });
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    expect(await screen.findByTestId(`integration-steps-samples-older-${AUTOMATION_ID}`)).toBeInTheDocument();
    const steps = screen.getByTestId(`integration-steps-${AUTOMATION_ID}`);
    expect(within(steps).getByText('total 3 pendentes')).toBeInTheDocument();
  });

  it('joins NOTHING when the sample addresses steps this plan does not have', async () => {
    // The bound automation was edited down to two steps after a three-step run. Joining by index
    // here would file step 3's output under step 1's neighbour and call it that step's evidence;
    // the sample is dropped instead, and the steps read as steps.
    seedTwoStepPlan();
    mocked.integrations.listActionEvidence.mockResolvedValue({
      items: [{
        actionName: RUN_ACTION,
        backingType: 'browser-steps',
        shape: 'sha-run',
        validatedAt: '2026-08-19T10:00:00.000Z',
        evidence: {
          kind: 'automation',
          runId: 'run-1',
          steps: [
            { stepIndex: 0, excerpt: 'abriu o portal' },
            { stepIndex: 1, excerpt: 'total 3 pendentes' },
            { stepIndex: 2, excerpt: 'exportou o mapa' },
          ],
        },
      }],
    });
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    const steps = await screen.findByTestId(`integration-steps-${AUTOMATION_ID}`);
    expect(within(steps).getByText('Abrir o portal')).toBeInTheDocument();
    expect(within(steps).queryByText('total 3 pendentes')).toBeNull();
    expect(within(steps).queryByText('abriu o portal')).toBeNull();
    expect(screen.queryByTestId(`integration-steps-samples-older-${AUTOMATION_ID}`)).toBeNull();
  });

  it('says the STEPS failed to load instead of rendering "this automation has no steps"', async () => {
    mocked.automations.get.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'Automação indisponível.'));
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    const panel = screen.getByTestId(`integration-action-${RUN_ACTION}`);
    expect(await within(panel).findByText('Automação indisponível.')).toBeInTheDocument();
    expect(within(panel).queryByText('Esta automatização não tem passos.')).toBeNull();
  });

  it('says the SAMPLES failed to load instead of "this action has never run"', async () => {
    mocked.integrations.listActionEvidence.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'Evidências indisponíveis.'));
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    const evidence = screen.getByTestId(`integration-action-evidence-${HTTP_ACTION}`);
    expect(within(evidence).getByText('Evidências indisponíveis.')).toBeInTheDocument();
    // The lie this replaces: the action may well have run - the request to find out just failed.
    expect(within(evidence).queryByText('Esta ação ainda não foi executada com sucesso.')).toBeNull();
  });

  it('does not say "never run" while the samples read is still OUTSTANDING', async () => {
    // Never resolves: the samples are in flight for the whole render.
    mocked.integrations.listActionEvidence.mockImplementation(() => new Promise(() => {}));
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    const evidence = screen.getByTestId(`integration-action-evidence-${HTTP_ACTION}`);
    // The page renders as soon as the CAPABILITY lands - a slow section must not hold the page -
    // and the section says it is still loading rather than making a claim it cannot support.
    expect(within(evidence).getByText('A carregar a última execução...')).toBeInTheDocument();
    expect(within(evidence).queryByText('Esta ação ainda não foi executada com sucesso.')).toBeNull();
  });

  it('marks a sample recorded against a DIFFERENT version of the action', async () => {
    mocked.integrations.listActionEvidence.mockResolvedValue({
      items: [{
        actionName: HTTP_ACTION,
        backingType: 'api-call',
        // The action's live shape is `sha-http`; this sample is about the bytes before an edit.
        shape: 'sha-http-OLD',
        validatedAt: '2026-08-19T10:00:00.000Z',
        evidence: {
          kind: 'api-call',
          request: { method: 'GET', url: 'https://citius.example/processos/2024-1', headers: {} },
          response: { status: 200, body: '{"ok":true}' },
        },
      }],
    });
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    expect(await screen.findByTestId(`integration-evidence-stale-${HTTP_ACTION}`)).toBeInTheDocument();
  });

  it('and does NOT mark a sample whose shape is the action\'s own', async () => {
    // THE NEGATIVE HALF, and it is the half that has teeth. Pinned only in the positive direction,
    // the rule survives being disabled in the widest possible way - `evidence?.shape !== undefined`
    // alone flags EVERY healthy sample as recorded-before-the-edit, which is a user-visible lie
    // about every action that ever ran, and every case above stays green through it.
    mocked.integrations.listActionEvidence.mockResolvedValue({
      items: [{
        actionName: HTTP_ACTION,
        backingType: 'api-call',
        // Exactly the shape on the capability row: this sample IS about today's action.
        shape: 'sha-http',
        validatedAt: '2026-08-19T10:00:00.000Z',
        evidence: {
          kind: 'api-call',
          request: { method: 'GET', url: 'https://citius.example/processos/2024-1', headers: {} },
          response: { status: 200, body: '{"ok":true}' },
        },
      }],
    });
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    // The sample rendered (non-vacuous: the absence below is not "nothing arrived")...
    const evidence = await screen.findByTestId(`integration-action-evidence-${HTTP_ACTION}`);
    expect(within(evidence).getByText('https://citius.example/processos/2024-1')).toBeInTheDocument();
    // ...and it carries no warning.
    expect(screen.queryByTestId(`integration-evidence-stale-${HTTP_ACTION}`)).toBeNull();
  });

  it('offers a RETRY on a failed samples read, not just a sentence', async () => {
    mocked.integrations.listActionEvidence.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'Evidências indisponíveis.'));
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    const evidence = await screen.findByTestId(`integration-action-evidence-${HTTP_ACTION}`);
    mocked.integrations.listActionEvidence.mockResolvedValue({
      items: [{
        actionName: HTTP_ACTION, backingType: 'api-call', shape: 'sha-http',
        validatedAt: '2026-08-19T10:00:00.000Z',
        evidence: { kind: 'api-call', request: { method: 'GET', url: 'https://citius.example/processos/2024-1', headers: {} }, response: { status: 200 } },
      }],
    });
    await userEvent.click(within(evidence).getByRole('button', { name: 'Tentar novamente' }));

    // Recovered in place: a full page reload was the only way out before.
    expect(await within(evidence).findByText('https://citius.example/processos/2024-1')).toBeInTheDocument();
  });
});

describe('the run history', () => {
  it('shows the failure with a retry instead of a spinner that never resolves', async () => {
    mocked.automations.listRuns.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'Histórico indisponível.'));
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    const history = await screen.findByTestId(`integration-action-history-${RUN_ACTION}`);
    expect(within(history).getByText('Histórico indisponível.')).toBeInTheDocument();
    expect(within(history).queryByText('A carregar o histórico...')).toBeNull();
    expect(within(history).queryByText('Ainda não há execuções registadas.')).toBeNull();

    mocked.automations.listRuns.mockResolvedValue({
      items: [{ id: 'run-abc12345', automationId: AUTOMATION_ID, status: 'completed', startedAt: '2026-08-19T10:00:00.000Z' }],
    });
    await userEvent.click(within(history).getByRole('button', { name: 'Tentar novamente' }));

    expect(await within(history).findByTestId(`integration-action-last-run-${RUN_ACTION}`)).toBeInTheDocument();
  });

  it('says "no runs yet" only once the read has actually come back empty', async () => {
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    const history = await screen.findByTestId(`integration-action-history-${RUN_ACTION}`);
    await waitFor(() => expect(within(history).getByText('Ainda não há execuções registadas.')).toBeInTheDocument());
  });

  it('says a queued run has not started, rather than leaving its timestamp blank', async () => {
    // Neither stamp yet. `formatStamp` answers '' for an absent one, which renders as a gap the
    // reader has to interpret - beside a status badge that says the run is queued.
    mocked.automations.listRuns.mockResolvedValue({
      items: [{ id: 'run-queued-1', automationId: AUTOMATION_ID, status: 'queued' }],
    });
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    const history = await screen.findByTestId(`integration-action-history-${RUN_ACTION}`);
    expect(await within(history).findByText('Ainda não começou')).toBeInTheDocument();
  });
});

describe('the action\'s schedules', () => {
  it('lists only the schedules aimed at THIS action, as real links', async () => {
    // Seeded through the CLIENT, not the store: the page fires `fetchSchedules` on mount, so a
    // store seeded directly would be overwritten by the very fetch under test.
    mocked.schedules.list.mockResolvedValue({
      items: [
        schedule(),
        // A schedule for the SAME integration but a different action, and one for another
        // integration entirely: neither belongs on this action's row.
        schedule({ id: 'sch-other-action', name: 'Outra ação', target: { kind: 'integration_action', integrationKey: KEY, actionName: HTTP_ACTION } } as Partial<Schedule>),
        schedule({ id: 'sch-other-key', name: 'Outra integração', target: { kind: 'integration_action', integrationKey: 'slack', actionName: RUN_ACTION } } as Partial<Schedule>),
      ],
    });
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    const section = screen.getByTestId(`integration-action-schedules-${RUN_ACTION}`);
    const link = await within(section).findByRole('link', { name: /Pendentes diários/ });
    expect(link).toHaveAttribute('href', '/schedules/sch-9');
    expect(within(section).queryByText('Outra ação')).toBeNull();
    expect(within(section).queryByText('Outra integração')).toBeNull();
  });

  it('counts a schedule aimed at the action\'s BOUND AUTOMATION as scheduling the action', async () => {
    // The two target kinds reach the same execution for an automation-backed action: the runs this
    // schedule produces are the very runs the history section on this page attributes to the
    // action. Counting only `integration_action` told a person "this action is not scheduled"
    // about an action that fires every morning.
    mocked.schedules.list.mockResolvedValue({
      items: [
        schedule({
          id: 'sch-via-automation',
          name: 'Pendentes pela automatização',
          target: { kind: 'automation', automationId: AUTOMATION_ID },
        } as Partial<Schedule>),
        // Another automation entirely - not this action's, and not on the row.
        schedule({
          id: 'sch-other-automation',
          name: 'Outra automatização',
          target: { kind: 'automation', automationId: 'aut-99' },
        } as Partial<Schedule>),
      ],
    });
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    const section = screen.getByTestId(`integration-action-schedules-${RUN_ACTION}`);
    expect(await within(section).findByRole('link', { name: /Pendentes pela automatização/ })).toBeInTheDocument();
    expect(within(section).queryByText('Outra automatização')).toBeNull();
    expect(within(section).queryByText('Esta ação não está agendada.')).toBeNull();
    // ...and an api-call action, which has no binding, is untouched by the automation arm.
    await openAction(HTTP_ACTION);
    const httpSection = screen.getByTestId(`integration-action-schedules-${HTTP_ACTION}`);
    expect(within(httpSection).getByText('Esta ação não está agendada.')).toBeInTheDocument();
  });

  it('says the SCHEDULES failed to load instead of "this action is not scheduled", and offers a retry', async () => {
    mocked.schedules.list.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'Agendamentos indisponíveis.'));
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    const section = screen.getByTestId(`integration-action-schedules-${RUN_ACTION}`);
    expect(await within(section).findByText('Agendamentos indisponíveis.')).toBeInTheDocument();
    expect(within(section).queryByText('Esta ação não está agendada.')).toBeNull();

    mocked.schedules.list.mockResolvedValue({ items: [schedule()] });
    await userEvent.click(within(section).getByRole('button', { name: 'Tentar novamente' }));

    expect(await within(section).findByRole('link', { name: /Pendentes diários/ })).toBeInTheDocument();
  });
});

describe('the ?action= deep link', () => {
  it('opens the linked action on arrival', async () => {
    nav.search = `action=${RUN_ACTION}`;
    render(<IntegrationDetailPage />);

    const toggle = await screen.findByTestId(`integration-action-toggle-${RUN_ACTION}`);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('follows a link to a DIFFERENT action on the same page, which never remounts it', async () => {
    nav.search = `action=${RUN_ACTION}`;
    const { rerender } = render(<IntegrationDetailPage />);
    expect(await screen.findByTestId(`integration-action-toggle-${RUN_ACTION}`)).toHaveAttribute('aria-expanded', 'true');

    // An in-app navigation within the same route: the component re-renders, it does not remount,
    // so a param read only at mount leaves the previous action open and the link does nothing.
    nav.search = `action=${HTTP_ACTION}`;
    rerender(<IntegrationDetailPage />);

    await waitFor(() =>
      expect(screen.getByTestId(`integration-action-toggle-${HTTP_ACTION}`)).toHaveAttribute('aria-expanded', 'true'),
    );
    expect(screen.getByTestId(`integration-action-toggle-${RUN_ACTION}`)).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('run-now, and the controls the server would refuse', () => {
  it('offers run-now for a read and for an already-approved write', async () => {
    render(<IntegrationDetailPage />);

    expect(await screen.findByTestId(`integration-action-run-${HTTP_ACTION}`)).toBeInTheDocument();
    expect(screen.getByTestId(`integration-action-run-${RUN_ACTION}`)).toBeInTheDocument();
  });

  it('withholds it from an unapproved write - and the row still reads', async () => {
    const cap = capability();
    cap.actions[1]!.approved = false;
    mocked.integrations.getIntegration.mockResolvedValue(cap);
    render(<IntegrationDetailPage />);

    const blocked = await screen.findByTestId(`integration-action-blocked-${RUN_ACTION}`);
    expect(screen.queryByTestId(`integration-action-run-${RUN_ACTION}`)).toBeNull();
    // Not a dead row: the reason is stated, and the page that CAN fix it is one real link away.
    expect(within(blocked).getByText(/tem de ser autorizada/)).toBeInTheDocument();
    expect(within(blocked).getByRole('link', { name: 'Autorizar na página de integrações' })).toHaveAttribute('href', '/integrations');
    // ...and the action itself is still fully readable.
    expect(screen.getByText('lista os pendentes')).toBeInTheDocument();
  });

  it('withholds it from every action of a DISCONNECTED integration', async () => {
    mocked.integrations.getIntegration.mockResolvedValue(capability({ connected: false }));
    render(<IntegrationDetailPage />);

    expect(await screen.findByTestId(`integration-action-blocked-${HTTP_ACTION}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`integration-action-run-${HTTP_ACTION}`)).toBeNull();
    // Both actions carry the reason - the integration, not the action, is what is not connected.
    expect(screen.getAllByText('Ligue esta integração para executar as suas ações.')).toHaveLength(2);
  });

  it('reports a run that was ADMITTED and then failed - the 200 with success:false', async () => {
    mocked.integrations.executeAction.mockResolvedValue({ success: false, status: 502, code: 'upstream_error', error: 'O portal respondeu 502.' });
    render(<IntegrationDetailPage />);

    await userEvent.click(await screen.findByTestId(`integration-action-run-${HTTP_ACTION}`));

    // Visible to the user, at the moment of the click - not swallowed into a store field.
    await waitFor(() => expect(toastMessages()).toContain('O portal respondeu 502.'));
  });

  it('turns a code-only failure into a SENTENCE, never showing the executor\'s own token', async () => {
    // The executor named the outcome and sent no prose. The old fallback chain put `code` itself
    // in the toast, so a person was shown `not_connected` and told that was the reason.
    mocked.integrations.executeAction.mockResolvedValue({ success: false, code: 'not_connected' });
    render(<IntegrationDetailPage />);

    await userEvent.click(await screen.findByTestId(`integration-action-run-${HTTP_ACTION}`));

    await waitFor(() => expect(toastMessages()).toContain('Esta integração não está ligada para a sua conta.'));
    expect(toastMessages().join('\n')).not.toContain('not_connected');
  });

  it('falls back to the generic sentence for a token nobody has copy for', async () => {
    mocked.integrations.executeAction.mockResolvedValue({ success: false, code: 'some_future_token' });
    render(<IntegrationDetailPage />);

    await userEvent.click(await screen.findByTestId(`integration-action-run-${HTTP_ACTION}`));

    await waitFor(() => expect(toastMessages()).toContain('Não foi possível concluir a ação.'));
    expect(toastMessages().join('\n')).not.toContain('some_future_token');
  });

  it('reports a run refused by the write gate', async () => {
    mocked.integrations.executeAction.mockRejectedValue(
      new FakeApiError(403, 'FORBIDDEN', 'Esta ação precisa de autorização.', { code: 'awaiting_consent' }),
    );
    render(<IntegrationDetailPage />);

    await userEvent.click(await screen.findByTestId(`integration-action-run-${RUN_ACTION}`));

    await waitFor(() => expect(toastMessages()).toContain('Esta ação precisa de autorização.'));
  });
});


// ---------------------------------------------------------------------------------------------
// PER-USER NOTES (slice S3)
// ---------------------------------------------------------------------------------------------

/** The bound automation's plan with STABLE step ids - what makes a per-step note addressable. */
function seedIdentifiedPlan() {
  mocked.automations.get.mockResolvedValue({
    id: AUTOMATION_ID,
    name: 'Citius pendentes',
    plan: {
      steps: [
        { stepId: 'abrir-portal', description: 'Abrir o portal' },
        // NO `stepId`: this step is not addressable, so it must get no note box.
        { description: 'Contar pendentes' },
      ],
    },
  });
}

describe('the notes affordance', () => {
  it('offers a box for the action, and one per step that has an ID - never one keyed by position', async () => {
    seedIdentifiedPlan();
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    const notes = await screen.findByTestId(`integration-action-notes-${RUN_ACTION}`);
    // The action's own note, always - the only shape an api-call action can hold either.
    expect(within(notes).getByTestId(`integration-note-${RUN_ACTION}`)).toBeTruthy();
    await waitFor(() =>
      expect(within(notes).getByTestId(`integration-note-${RUN_ACTION}-abrir-portal`)).toBeTruthy());
    // …and exactly two boxes: the id-less step is not addressable, so it gets none. A note filed
    // by POSITION would move when the plan does.
    // The container test ids only - the edit/remove/save/input/text/error ids share the prefix.
    expect(within(notes).getAllByTestId(/^integration-note-(?!edit-|remove-|save-|input-|text-|error-)/)).toHaveLength(2);
  });

  it('says that the assistant reads what is typed, before anything is typed', async () => {
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    const notes = await screen.findByTestId(`integration-action-notes-${HTTP_ACTION}`);
    expect(within(notes).getByText(/o assistente lê-as/i)).toBeTruthy();
  });

  it('writes a note through the real store and renders what the SERVER answered', async () => {
    mocked.integrations.setActionFeedback.mockResolvedValue({
      actionName: HTTP_ACTION,
      note: 'guardado pelo servidor',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-22T10:00:00.000Z',
    });
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    await userEvent.click(await screen.findByTestId(`integration-note-edit-${HTTP_ACTION}`));
    await userEvent.type(screen.getByTestId(`integration-note-input-${HTTP_ACTION}`), 'o que escrevi');
    await userEvent.click(screen.getByTestId(`integration-note-save-${HTTP_ACTION}`));

    await waitFor(() =>
      expect(screen.getByTestId(`integration-note-text-${HTTP_ACTION}`).textContent).toBe('guardado pelo servidor'));
    expect(mocked.integrations.setActionFeedback).toHaveBeenCalledWith({
      key: KEY, actionName: HTTP_ACTION, note: 'o que escrevi',
    });
  });

  it('a failed save keeps the editor OPEN with the text in it, under the error', async () => {
    mocked.integrations.setActionFeedback.mockRejectedValue(
      new FakeApiError(400, 'VALIDATION_FAILED', 'A nota excede o limite.'));
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    await userEvent.click(await screen.findByTestId(`integration-note-edit-${HTTP_ACTION}`));
    await userEvent.type(screen.getByTestId(`integration-note-input-${HTTP_ACTION}`), 'a minha nota');
    await userEvent.click(screen.getByTestId(`integration-note-save-${HTTP_ACTION}`));

    await waitFor(() =>
      expect(screen.getByTestId(`integration-note-error-${HTTP_ACTION}`).textContent).toContain('excede o limite'));
    // Closing the box on a failure would throw away what the person just wrote.
    expect((screen.getByTestId(`integration-note-input-${HTTP_ACTION}`) as HTMLTextAreaElement).value)
      .toBe('a minha nota');
  });

  it('a failed notes READ disables the editor and says why - it never opens empty over a real note', async () => {
    mocked.integrations.listActionFeedback.mockRejectedValue(
      new FakeApiError(500, 'INTERNAL', 'Notas indisponíveis.'));
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    const notes = await screen.findByTestId(`integration-action-notes-${HTTP_ACTION}`);
    await waitFor(() =>
      expect(within(notes).getByTestId('integration-detail-section-error')).toBeTruthy());
    expect((within(notes).getByTestId(`integration-note-edit-${HTTP_ACTION}`) as HTMLButtonElement).disabled).toBe(true);
    expect(within(notes).getByText(/edição fica indisponível/i)).toBeTruthy();
  });

  it('the failed-read RETRY re-fires the read and re-enables the editors', async () => {
    // The does-the-trigger-fire class: wiring onRetry to fetchEvidence, to a stale key, or to
    // undefined would leave the previous test green - it only asserted the error row rendered.
    // Every other section's failed-read test in this file clicks its retry; this one now does too.
    mocked.integrations.listActionFeedback.mockRejectedValueOnce(
      new FakeApiError(500, 'INTERNAL', 'Notas indisponíveis.'));
    mocked.integrations.listActionFeedback.mockResolvedValue({ items: [] });
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    const notes = await screen.findByTestId(`integration-action-notes-${HTTP_ACTION}`);
    const errorRow = await within(notes).findByTestId('integration-detail-section-error');
    await userEvent.click(within(errorRow).getByRole('button', { name: /tentar novamente/i }));

    // The read fired again AND the editor came back - the only path that flips feedbackLoaded.
    await waitFor(() =>
      expect((within(notes).getByTestId(`integration-note-edit-${HTTP_ACTION}`) as HTMLButtonElement).disabled)
        .toBe(false));
    expect(mocked.integrations.listActionFeedback).toHaveBeenCalledTimes(2);
    expect(mocked.integrations.listActionFeedback).toHaveBeenLastCalledWith({ key: KEY });
  });

  it('says LOADING while the read is outstanding and EMPTY only once it came back', async () => {
    // "you have no note" and "we do not know yet" are different sentences - the component's own
    // comment. A mutant collapsing the ternary to notesEmpty used to stay green.
    let release: (v: unknown) => void = () => {};
    mocked.integrations.listActionFeedback.mockImplementation(() => new Promise((r) => { release = r; }));
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    const notes = await screen.findByTestId(`integration-action-notes-${HTTP_ACTION}`);
    expect(within(notes).getByText(/a carregar as suas notas/i)).toBeTruthy();
    expect(within(notes).queryByText(/ainda não há nota/i)).toBeNull();

    release({ items: [] });
    await waitFor(() => expect(within(notes).getByText(/ainda não há nota/i)).toBeTruthy());
    expect(within(notes).queryByText(/a carregar as suas notas/i)).toBeNull();
  });

  it('refuses to SAVE an empty or whitespace draft, and counts what was typed', async () => {
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);
    await userEvent.click(await screen.findByTestId(`integration-note-edit-${HTTP_ACTION}`));

    const save = screen.getByTestId(`integration-note-save-${HTTP_ACTION}`) as HTMLButtonElement;
    expect(save.disabled, 'an empty draft cannot be saved - a save that deletes loses what people wrote').toBe(true);

    await userEvent.type(screen.getByTestId(`integration-note-input-${HTTP_ACTION}`), '   ');
    expect(save.disabled, 'whitespace is empty').toBe(true);
    // The counter reflects what was typed, whitespace included.
    expect(screen.getByText(/3\/2000 caracteres/)).toBeTruthy();

    await userEvent.type(screen.getByTestId(`integration-note-input-${HTTP_ACTION}`), 'a nota');
    expect(save.disabled).toBe(false);
    expect(screen.getByText(/9\/2000 caracteres/)).toBeTruthy();
    expect(mocked.integrations.setActionFeedback).not.toHaveBeenCalled();
  });

  it('a note whose STEP left the plan still renders, is labeled, and can be erased', async () => {
    // THE REVIEW'S MAJOR. The component looked notes up only BY SLOT, so a row whose stepRef named
    // no current step rendered nowhere and could not be deleted - while the API kept feeding it to
    // the author's prompts, and the module header and findings.md both claimed otherwise.
    seedIdentifiedPlan();
    mocked.integrations.listActionFeedback.mockResolvedValue({
      items: [{
        actionName: RUN_ACTION, stepRef: 'passo-que-desapareceu', note: 'sobre um passo que ja nao existe',
        createdAt: '2026-08-20T10:00:00.000Z', updatedAt: '2026-08-20T10:00:00.000Z',
      }],
    });
    mocked.integrations.discardActionFeedback.mockResolvedValue({ ok: true, discarded: true });
    render(<IntegrationDetailPage />);
    await openAction(RUN_ACTION);

    const orphan = await screen.findByTestId(`integration-note-${RUN_ACTION}-passo-que-desapareceu`);
    expect(orphan.getAttribute('data-orphaned'), 'rendered in the stranded register').toBe('true');
    expect(within(orphan).getByText(/passo que já não existe no plano/i)).toBeTruthy();
    expect(within(orphan).getByTestId(`integration-note-text-${RUN_ACTION}-passo-que-desapareceu`).textContent)
      .toBe('sobre um passo que ja nao existe');

    // …and the erasure control WORKS, which is the half the findings ledger claimed and never had.
    await userEvent.click(within(orphan).getByTestId(`integration-note-remove-${RUN_ACTION}-passo-que-desapareceu`));
    await waitFor(() =>
      expect(screen.queryByTestId(`integration-note-${RUN_ACTION}-passo-que-desapareceu`)).toBeNull());
    expect(mocked.integrations.discardActionFeedback).toHaveBeenCalledWith({
      key: KEY, actionName: RUN_ACTION, stepRef: 'passo-que-desapareceu',
    });
  });

  it('a note whose ACTION left the package renders in its own section, ERASE-ONLY', async () => {
    // The worse half: the page maps capability.actions, so a de-published action had no card at
    // all and its notes were unreachable from the UI entirely.
    mocked.integrations.listActionFeedback.mockResolvedValue({
      items: [{
        actionName: 'accao_removida', note: 'sobre uma acao que ja nao existe',
        createdAt: '2026-08-20T10:00:00.000Z', updatedAt: '2026-08-20T10:00:00.000Z',
      }],
    });
    mocked.integrations.discardActionFeedback.mockResolvedValue({ ok: true, discarded: true });
    render(<IntegrationDetailPage />);

    const section = await screen.findByTestId('integration-departed-notes');
    expect(within(section).getByText(/ações que esta integração já não tem/i)).toBeTruthy();
    const box = within(section).getByTestId('integration-note-accao_removida');
    expect(within(box).getByTestId('integration-note-text-accao_removida').textContent)
      .toBe('sobre uma acao que ja nao existe');
    // NO edit control: writeFeedbackFor refuses an action off the definition, so an edit here would
    // be a button that exists to be refused.
    expect(within(box).queryByTestId('integration-note-edit-accao_removida')).toBeNull();

    await userEvent.click(within(box).getByTestId('integration-note-remove-accao_removida'));
    await waitFor(() => expect(screen.queryByTestId('integration-departed-notes')).toBeNull());
    expect(mocked.integrations.discardActionFeedback).toHaveBeenCalledWith({ key: KEY, actionName: 'accao_removida' });
  });

  it('the departed-notes section is ABSENT when every note belongs to a live action', async () => {
    // A recovery affordance, not furniture: it must not appear in the ordinary case.
    mocked.integrations.listActionFeedback.mockResolvedValue({
      items: [{
        actionName: HTTP_ACTION, note: 'uma nota normal',
        createdAt: '2026-08-20T10:00:00.000Z', updatedAt: '2026-08-20T10:00:00.000Z',
      }],
    });
    render(<IntegrationDetailPage />);
    await screen.findByTestId(`integration-action-${HTTP_ACTION}`);
    await waitFor(() => expect(screen.queryByTestId('integration-departed-notes')).toBeNull());
  });

  it('erases a note only on a confirmed answer', async () => {
    mocked.integrations.listActionFeedback.mockResolvedValue({
      items: [{ actionName: HTTP_ACTION, note: 'para apagar', createdAt: '2026-08-20T10:00:00.000Z', updatedAt: '2026-08-20T10:00:00.000Z' }],
    });
    mocked.integrations.discardActionFeedback.mockResolvedValue({ ok: true, discarded: true });
    render(<IntegrationDetailPage />);
    await openAction(HTTP_ACTION);

    await waitFor(() => expect(screen.getByTestId(`integration-note-text-${HTTP_ACTION}`).textContent).toBe('para apagar'));
    await userEvent.click(screen.getByTestId(`integration-note-remove-${HTTP_ACTION}`));

    await waitFor(() => expect(screen.queryByTestId(`integration-note-text-${HTTP_ACTION}`)).toBeNull());
    expect(mocked.integrations.discardActionFeedback).toHaveBeenCalledWith({ key: KEY, actionName: HTTP_ACTION });
  });
});
