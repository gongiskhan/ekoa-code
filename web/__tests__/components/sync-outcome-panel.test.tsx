/**
 * SyncOutcomePanel + the pure state mapping behind it (slice CS7).
 *
 * What these assertions are FOR: the Citius workstream's entire value is that
 * "complete" and "incomplete" are different claims about a lawyer's inbox, and that
 * "failed" is a third claim again. The api keeps them apart (`SyncOutcome`,
 * `verified-sync.ts` advancing the watermark only on `complete`); this suite pins that
 * the UI does not quietly re-merge them - different words, different tone, and no path
 * by which a non-complete run can render as "Completa".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SyncRunReport, SyncStateView } from '@ekoa/shared';
import {
  formatSyncMoment,
  incompleteReason,
  notificationCount,
  presentSyncOutcome,
  resolveOutcomeKind,
} from '@/lib/sync/sync-outcome';
import { SyncOutcomePanel } from '@/components/sync/sync-outcome-panel';
import { fetchCitiusSyncState, runCitiusSync } from '@/lib/sync/citius-sync';
import { clearToken, setToken } from '@/lib/api/token';

vi.mock('@/lib/sync/citius-sync', () => ({
  fetchCitiusSyncState: vi.fn(),
  runCitiusSync: vi.fn(),
  CITIUS_SYNC_STATE_PATH: '/api/v1/sync/citius/notificacoes/state',
  CITIUS_SYNC_RUN_PATH: '/api/v1/sync/citius/notificacoes',
}));

const mockedFetch = vi.mocked(fetchCitiusSyncState);
const mockedRun = vi.mocked(runCitiusSync);

// ---- fixtures ---------------------------------------------------------------------------

function report(over: Partial<SyncRunReport> = {}): SyncRunReport {
  const base: SyncRunReport = {
    id: 'r1',
    syncKey: 'org1::citius::inbox',
    orgId: 'org1',
    startedAt: '2026-08-03T10:40:00.000Z',
    endedAt: '2026-08-03T10:42:00.000Z',
    outcome: 'complete',
    window: { since: null, until: '2026-08-03T10:42:00.000Z' },
    verification: {
      pass1: { pages: 2, itemsSeen: 12, newRefs: 4, reachedEnd: true },
      pass2: { pages: 2, itemsSeen: 12, refsOnlyInPass2: [], reachedEnd: true },
      maxPages: 5,
    },
    landed: 4,
    duplicatesSuppressed: 0,
    sessionEvents: ['reused'],
  };
  return { ...base, ...over } as SyncRunReport;
}

function state(over: Partial<SyncStateView> = {}): SyncStateView {
  return {
    watermark: '2026-08-03T10:42:00.000Z',
    lastRunAt: '2026-08-03T10:42:00.000Z',
    lastOutcome: 'complete',
    consecutiveIncomplete: 0,
    consecutiveFailures: 0,
    seenRefs: 12,
    landed: 31,
    latest: report(),
    ...over,
  } as SyncStateView;
}

const incompleteState = (over: Partial<SyncStateView> = {}): SyncStateView =>
  state({
    lastOutcome: 'incomplete',
    consecutiveIncomplete: 1,
    latest: report({
      outcome: 'incomplete',
      verification: {
        pass1: { pages: 2, itemsSeen: 12, newRefs: 4, reachedEnd: true },
        pass2: { pages: 2, itemsSeen: 13, refsOnlyInPass2: ['ref-99'], reachedEnd: true },
        maxPages: 5,
      },
      landed: 5,
    }),
    ...over,
  });

const failedState = (over: Partial<SyncStateView> = {}): SyncStateView =>
  state({
    lastOutcome: 'failed',
    consecutiveFailures: 1,
    latest: report({ outcome: 'failed', landed: 0, error: 'enumerate: 503 do portal' }),
    ...over,
  });

// ---- the pure mapping -------------------------------------------------------------------

describe('presentSyncOutcome - the three outcomes are three different claims', () => {
  it('complete: names the state Completa and claims the inbox is synced', () => {
    const view = presentSyncOutcome(state());
    expect(view.kind).toBe('complete');
    expect(view.label).toBe('Completa');
    expect(view.tone).toBe('success');
    expect(view.headline).toBe('A caixa está sincronizada.');
    expect(view.reason).toBeNull();
  });

  it('incomplete: names the state INCOMPLETA, says notifications may be missing, and says the read pointer did NOT advance', () => {
    const view = presentSyncOutcome(incompleteState());
    expect(view.kind).toBe('incomplete');
    expect(view.label).toBe('INCOMPLETA');
    expect(view.tone).toBe('warning');
    expect(view.headline).toContain('Podem faltar notificações');
    // The watermark half of the contract has to reach the user, or INCOMPLETA is just a mood.
    expect(view.next).toContain('não avançou');
    expect(view.next).toContain('a partir do mesmo ponto');
  });

  it('failed: a different claim from INCOMPLETA - the sync never ran, so nothing is known', () => {
    const view = presentSyncOutcome(failedState());
    expect(view.kind).toBe('failed');
    expect(view.label).toBe('Falhou');
    expect(view.tone).toBe('danger');
    expect(view.headline).toContain('não chegou a correr');
    // Not a re-skin of the incomplete copy.
    const incomplete = presentSyncOutcome(incompleteState());
    expect(view.headline).not.toBe(incomplete.headline);
    expect(view.body).not.toBe(incomplete.body);
    expect(view.tone).not.toBe(incomplete.tone);
    expect(view.label).not.toBe(incomplete.label);
  });

  it('never run: says so, and claims nothing about the inbox', () => {
    const view = presentSyncOutcome(
      state({ watermark: null, lastRunAt: undefined, lastOutcome: undefined, latest: undefined, landed: 0 }),
    );
    expect(view.kind).toBe('never');
    expect(view.label).toBe('Sem sincronizações');
    expect(view.headline).toContain('ainda não foi sincronizada');
  });
});

describe('resolveOutcomeKind - "Completa" is never shown over a disagreement', () => {
  it('a stale row saying complete does not override a report saying incomplete', () => {
    const stale = incompleteState({ lastOutcome: 'complete' });
    expect(resolveOutcomeKind(stale)).toBe('incomplete');
    expect(presentSyncOutcome(stale).label).toBe('INCOMPLETA');
  });

  it('a row saying failed is honoured even when the embedded report says complete', () => {
    expect(resolveOutcomeKind(state({ lastOutcome: 'failed' }))).toBe('failed');
  });

  it('complete requires both to agree', () => {
    expect(resolveOutcomeKind(state())).toBe('complete');
  });
});

describe('incompleteReason - the evidence, in the strength order of the proof', () => {
  it('a reference only the second pass saw is a proved miss, singular and plural', () => {
    expect(incompleteReason(report({ verification: { ...report().verification, pass2: { pages: 2, itemsSeen: 13, refsOnlyInPass2: ['a'], reachedEnd: true } } }))).toBe(
      'A segunda leitura encontrou 1 notificação que a primeira não tinha visto.',
    );
    expect(incompleteReason(report({ verification: { ...report().verification, pass2: { pages: 2, itemsSeen: 15, refsOnlyInPass2: ['a', 'b', 'c'], reachedEnd: true } } }))).toBe(
      'A segunda leitura encontrou 3 notificações que a primeira não tinha visto.',
    );
  });

  it('a count disagreement with the portal quotes both numbers', () => {
    const r = report({
      verification: { ...report().verification, countCheck: { pageTotal: 40, enumerated: 25, match: false } },
    });
    expect(incompleteReason(r)).toBe('O portal indicava 40 notificações e só foram lidas 25.');
  });

  it('a pass that stopped at the page bound names the bound', () => {
    const r = report({
      verification: {
        pass1: { pages: 5, itemsSeen: 50, newRefs: 50, reachedEnd: false },
        pass2: { pages: 5, itemsSeen: 50, refsOnlyInPass2: [], reachedEnd: false },
        maxPages: 5,
      },
    });
    expect(incompleteReason(r)).toBe('A leitura parou no limite de 5 páginas e não chegou ao fim da caixa.');
  });

  it('the proved miss wins over a truncation that is also present', () => {
    const r = report({
      verification: {
        pass1: { pages: 5, itemsSeen: 50, newRefs: 50, reachedEnd: false },
        pass2: { pages: 5, itemsSeen: 51, refsOnlyInPass2: ['x'], reachedEnd: false },
        maxPages: 5,
        countCheck: { pageTotal: 60, enumerated: 50, match: false },
      },
    });
    expect(incompleteReason(r)).toContain('A segunda leitura encontrou 1 notificação');
  });

  it('no report at all yields an honest fallback, never an invented cause', () => {
    expect(incompleteReason(undefined)).toBe('A verificação de completude não passou nesta leitura.');
  });
});

describe('streak + formatting helpers', () => {
  it('the repeated-incomplete note only appears from the second one on', () => {
    expect(presentSyncOutcome(incompleteState({ consecutiveIncomplete: 1 })).streakNote).toBeNull();
    expect(presentSyncOutcome(incompleteState({ consecutiveIncomplete: 3 })).streakNote).toBe(
      'É a 3ª leitura incompleta seguida.',
    );
    expect(presentSyncOutcome(failedState({ consecutiveFailures: 2 })).streakNote).toBe('É a 2ª falha seguida.');
  });

  it('the failure reason is the transport error when there is one', () => {
    expect(presentSyncOutcome(failedState()).reason).toBe('enumerate: 503 do portal');
    expect(presentSyncOutcome(failedState({ latest: report({ outcome: 'failed', landed: 0 }) })).reason).toBe(
      'A leitura não chegou a terminar.',
    );
  });

  it('formats moments in pt-PT and counts with the right plural', () => {
    expect(formatSyncMoment(undefined)).toBeNull();
    expect(formatSyncMoment('2026-08-03T10:42:00.000Z')).toMatch(/03\/08\/2026/);
    expect(formatSyncMoment('not-a-date')).toBe('not-a-date');
    expect(notificationCount(1)).toBe('1 notificação');
    expect(notificationCount(0)).toBe('0 notificações');
    expect(notificationCount(7)).toBe('7 notificações');
  });
});

// ---- the transport ----------------------------------------------------------------------
//
// The panel above talks to a mocked module; THIS block drives the real one against a fake fetch,
// because the guarantee it carries is load-bearing: a body that does not validate against the
// shared schema must never reach the UI as a sync claim.

describe('citius-sync transport (the real module, over a fake fetch)', () => {
  const load = async () => await vi.importActual<typeof import('@/lib/sync/citius-sync')>('@/lib/sync/citius-sync');
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // Through the single token accessor - `ekoa_token` has exactly one reader/writer in web/ (ch12
    // §12.2.4) and a test is not an excuse to add a second.
    setToken('tok-123');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
  });

  const jsonResponse = (status: number, body: unknown) =>
    ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

  it('a valid state body is handed through, from the mounted sync path with the bearer token', async () => {
    const { fetchCitiusSyncState } = await load();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, state()));
    const result = await fetchCitiusSyncState();
    expect(result).toEqual({ kind: 'ready', state: state() });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/sync/citius/notificacoes/state');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('a body that fails SyncStateView is an ERROR, never a rendered state', async () => {
    const { fetchCitiusSyncState } = await load();
    // A plausible-looking payload missing the required streak counters: exactly the shape that
    // would render as a confident "Completa" if it were trusted.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { watermark: 'w', lastOutcome: 'complete', landed: 3 }));
    const result = await fetchCitiusSyncState();
    expect(result.kind).toBe('error');
    expect(result).toMatchObject({ message: expect.stringContaining('não corresponde ao contrato') });
  });

  it('404 is "the feature is off", not an error', async () => {
    const { fetchCitiusSyncState } = await load();
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
    expect(await fetchCitiusSyncState()).toEqual({ kind: 'unavailable' });
  });

  it('a non-2xx carries the server PT-PT message from the shared error envelope', async () => {
    const { fetchCitiusSyncState } = await load();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'A credencial está bloqueada. Desbloqueie-a para sincronizar.' } }),
    );
    expect(await fetchCitiusSyncState()).toEqual({
      kind: 'error',
      message: 'A credencial está bloqueada. Desbloqueie-a para sincronizar.',
    });
  });

  it('a transport failure never claims anything about the inbox', async () => {
    const { fetchCitiusSyncState } = await load();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const result = await fetchCitiusSyncState();
    expect(result.kind).toBe('error');
  });

  it('a run POSTs to the run path and validates the outcome union', async () => {
    const { runCitiusSync } = await load();
    const outcome = { status: 'needs-egress', required: { kind: 'residential', pairingId: 'p1' } };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, outcome));
    const result = await runCitiusSync();
    expect(result).toEqual({ kind: 'outcome', outcome });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/sync\/citius\/notificacoes$/);
    expect(init.method).toBe('POST');

    // An outcome shape the union does not admit is refused rather than rendered.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'ran', report: {} }));
    expect((await runCitiusSync()).kind).toBe('error');
  });
});

// ---- the panel --------------------------------------------------------------------------

describe('SyncOutcomePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRun.mockResolvedValue({ kind: 'error', message: 'not used' });
  });

  it('renders the three outcomes with distinct labels and distinct data-outcome hooks', async () => {
    for (const [fixture, outcome, label] of [
      [state(), 'complete', 'Completa'],
      [incompleteState(), 'incomplete', 'INCOMPLETA'],
      [failedState(), 'failed', 'Falhou'],
    ] as const) {
      mockedFetch.mockResolvedValueOnce({ kind: 'ready', state: fixture });
      const { unmount } = render(<SyncOutcomePanel />);
      const panel = await screen.findByTestId('sync-outcome-panel');
      expect(panel).toHaveAttribute('data-outcome', outcome);
      expect(screen.getByTestId('sync-outcome-label')).toHaveTextContent(label);
      unmount();
    }
  });

  it('the INCOMPLETA panel shows the evidence and the held read pointer', async () => {
    mockedFetch.mockResolvedValueOnce({ kind: 'ready', state: incompleteState() });
    render(<SyncOutcomePanel />);
    expect(await screen.findByTestId('sync-outcome-reason')).toHaveTextContent(
      'A segunda leitura encontrou 1 notificação que a primeira não tinha visto.',
    );
    expect(screen.getByTestId('sync-outcome-next')).toHaveTextContent('não avançou');
    // The evidence a user needs to trust it: when it ran, and how many landed.
    expect(screen.getByTestId('sync-evidence-lastrun')).toHaveTextContent('03/08/2026');
    expect(screen.getByTestId('sync-evidence-landed')).toHaveTextContent('5 notificações');
  });

  it('a failed panel never prints a per-run landed count (a failure cannot claim "0 arrived")', async () => {
    mockedFetch.mockResolvedValueOnce({ kind: 'ready', state: failedState() });
    render(<SyncOutcomePanel />);
    await screen.findByTestId('sync-outcome-panel');
    expect(screen.queryByTestId('sync-evidence-landed')).toBeNull();
    expect(screen.getByTestId('sync-outcome-reason')).toHaveTextContent('enumerate: 503 do portal');
  });

  it('renders nothing when the api answers 404 (the flag is off)', async () => {
    mockedFetch.mockResolvedValueOnce({ kind: 'unavailable' });
    const { container } = render(<SyncOutcomePanel />);
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('a run that never established a session says so, and never looks like a failed sync', async () => {
    mockedFetch.mockResolvedValue({ kind: 'ready', state: state() });
    mockedRun.mockResolvedValueOnce({
      kind: 'outcome',
      outcome: { status: 'needs-human', route: 'attended', reason: 'citius has no credential reference', attempted: true },
    });
    const user = userEvent.setup();
    render(<SyncOutcomePanel />);
    await screen.findByTestId('sync-outcome-panel');
    await user.click(screen.getByTestId('sync-run-now'));

    const notice = await screen.findByTestId('sync-run-notice');
    expect(notice).toHaveTextContent('É preciso entrar no Citius pessoalmente');
    expect(notice).toHaveTextContent('não chegou a correr');
    // `attempted` has a consequence: the portal locks accounts, so a retry is not free.
    expect(notice).toHaveTextContent('não repita sem verificar a credencial');
    // The outcome panel itself is unchanged - a ceremony request is not a sync result.
    expect(screen.getByTestId('sync-outcome-panel')).toHaveAttribute('data-outcome', 'complete');
  });

  it('a run blocked on egress names the missing pairing and does not blame the sync', async () => {
    mockedFetch.mockResolvedValue({ kind: 'ready', state: state() });
    mockedRun.mockResolvedValueOnce({
      kind: 'outcome',
      outcome: { status: 'needs-egress', required: { kind: 'residential', pairingId: 'pair-77' } },
    });
    const user = userEvent.setup();
    render(<SyncOutcomePanel />);
    await screen.findByTestId('sync-outcome-panel');
    await user.click(screen.getByTestId('sync-run-now'));

    const notice = await screen.findByTestId('sync-run-notice');
    expect(notice).toHaveTextContent('saída de rede compatível');
    expect(notice).toHaveTextContent('pair-77');
  });

  it('a response that fails the shared schema is an error, never a "Completa"', async () => {
    mockedFetch.mockResolvedValueOnce({ kind: 'error', message: 'A resposta do servidor não corresponde ao contrato de sincronização.' });
    render(<SyncOutcomePanel />);
    const panel = await screen.findByTestId('sync-outcome-panel');
    expect(panel).toHaveAttribute('data-outcome', 'error');
    expect(screen.getByTestId('sync-outcome-error')).toHaveTextContent('não corresponde ao contrato');
    expect(screen.queryByTestId('sync-outcome-label')).toBeNull();
  });
});
