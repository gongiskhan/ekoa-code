/**
 * The schedules store is the only thing between the typed client and every schedules
 * surface, so what is asserted here is the CACHE CONTRACT the pages depend on:
 *
 *  - `pendingTasks` is DERIVED from `orgRuns` on every write that touches them - the task
 *    inbox can never show a task the run feed no longer has, whichever action moved it;
 *  - mutations update the cached array from the RESPONSE (create prepends, update maps,
 *    remove filters) rather than re-fetching, so a list does not blink on every edit;
 *  - a failed call leaves the cache untouched and puts a user-safe message on the channel the
 *    surface renders: `loadError` for a broken READ (the page shows it instead of an empty
 *    list), `error` for a broken ACTION, `runsError[id]` for one schedule's history - a
 *    distinction the pages depend on to avoid claiming "no schedules yet" over a 500;
 *  - `preview` is the exception: its failures are the FORM's (an incomplete rule) and are
 *    returned to the caller, never written to the page-wide `error`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Schedule, ScheduleRun } from '@ekoa/shared';

const listSpy = vi.fn();
const listAllRunsSpy = vi.fn();
const listRunsSpy = vi.fn();
const createSpy = vi.fn();
const patchSpy = vi.fn();
const removeSpy = vi.fn();
const runNowSpy = vi.fn();
const completeRunSpy = vi.fn();
const previewSpy = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    schedules: {
      list: (...args: unknown[]) => listSpy(...args),
      listAllRuns: (...args: unknown[]) => listAllRunsSpy(...args),
      listRuns: (...args: unknown[]) => listRunsSpy(...args),
      create: (...args: unknown[]) => createSpy(...args),
      patch: (...args: unknown[]) => patchSpy(...args),
      remove: (...args: unknown[]) => removeSpy(...args),
      runNow: (...args: unknown[]) => runNowSpy(...args),
      completeRun: (...args: unknown[]) => completeRunSpy(...args),
      preview: (...args: unknown[]) => previewSpy(...args),
    },
  },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true, data: await fn() };
    } catch (error) {
      return { ok: false, error };
    }
  },
}));

import { useSchedulesStore } from '@/stores/schedules';

const schedule = (over: Partial<Schedule> = {}): Schedule =>
  ({
    id: 'sch-1',
    name: 'Relatório semanal',
    target: { kind: 'manual', instructions: 'Rever faturação' },
    spec: { kind: 'recurring', rule: { every: 'week', interval: 1, weekdays: [1], at: { hour: 9, minute: 0 }, timezone: 'Europe/Lisbon' } },
    enabled: true,
    nextRunAt: '2026-08-24T08:00:00.000Z',
    ...over,
  }) as Schedule;

const run = (over: Partial<ScheduleRun> = {}): ScheduleRun =>
  ({
    id: 'run-1',
    scheduleId: 'sch-1',
    status: 'pending',
    plannedFor: '2026-08-17T08:00:00.000Z',
    trigger: 'auto',
    ...over,
  }) as ScheduleRun;

/** A rejection shaped like the transport's ApiError: what `res.error.message` reads. */
const failWith = (message: string) => () => Promise.reject(new Error(message));

beforeEach(() => {
  for (const spy of [
    listSpy,
    listAllRunsSpy,
    listRunsSpy,
    createSpy,
    patchSpy,
    removeSpy,
    runNowSpy,
    completeRunSpy,
    previewSpy,
  ]) {
    spy.mockReset();
  }
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
});

describe('fetchSchedules', () => {
  it('loads the list and clears the loading flag', async () => {
    listSpy.mockResolvedValue({ items: [schedule()] });
    await useSchedulesStore.getState().fetchSchedules();
    const state = useSchedulesStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0]!.name).toBe('Relatório semanal');
    expect(state.loading).toBe(false);
    expect(state.error).toBeUndefined();
  });

  it('surfaces the failure on loadError - the READ channel, not the action one', async () => {
    listSpy.mockImplementation(failWith('Sessão expirada'));
    await useSchedulesStore.getState().fetchSchedules();
    const state = useSchedulesStore.getState();
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.loadError).toBe('Sessão expirada');
    // `error` is what a failed ACTION writes; a broken list must not read as one, or the page
    // cannot tell "show this instead of the list" from "toast this and leave the list".
    expect(state.error).toBeUndefined();
  });

  it('falls back to a user-safe message when the failure carries none', async () => {
    listSpy.mockImplementation(() => Promise.reject(new Error('')));
    await useSchedulesStore.getState().fetchSchedules();
    expect(useSchedulesStore.getState().loadError).toBe('Não foi possível carregar os agendamentos.');
  });

  it('clears a previous loadError once the list comes back', async () => {
    useSchedulesStore.setState({ loadError: 'Falha anterior' });
    listSpy.mockResolvedValue({ items: [schedule()] });
    await useSchedulesStore.getState().fetchSchedules();
    expect(useSchedulesStore.getState().loadError).toBeUndefined();
  });
});

describe('fetchOrgRuns', () => {
  it('derives pendingTasks from the feed, ignoring runs in any other status', async () => {
    listAllRunsSpy.mockResolvedValue({
      items: [run(), run({ id: 'run-2', status: 'ok' }), run({ id: 'run-3', status: 'pending' })],
    });
    await useSchedulesStore.getState().fetchOrgRuns();
    const state = useSchedulesStore.getState();
    expect(state.orgRuns).toHaveLength(3);
    expect(state.pendingTasks.map((r) => r.id)).toEqual(['run-1', 'run-3']);
  });

  it('passes the status filter through, and sends no query without one', async () => {
    listAllRunsSpy.mockResolvedValue({ items: [] });
    await useSchedulesStore.getState().fetchOrgRuns('pending');
    expect(listAllRunsSpy).toHaveBeenCalledWith({ status: 'pending' });
    await useSchedulesStore.getState().fetchOrgRuns();
    expect(listAllRunsSpy).toHaveBeenLastCalledWith(undefined);
  });

  it('reports a broken feed on loadError, leaving the inbox as it was', async () => {
    useSchedulesStore.setState({ orgRuns: [run()], pendingTasks: [run()] });
    listAllRunsSpy.mockImplementation(failWith('Serviço indisponível'));
    await useSchedulesStore.getState().fetchOrgRuns('pending');
    const state = useSchedulesStore.getState();
    expect(state.loadError).toBe('Serviço indisponível');
    expect(state.error).toBeUndefined();
    expect(state.pendingTasks.map((r) => r.id)).toEqual(['run-1']);
  });

  it('does not erase the list fetch failure it races against', async () => {
    // The list page fires both on mount. Each clears loadError BEFORE its first await, so the
    // later success cannot wipe the earlier failure's message off the page.
    listSpy.mockImplementation(failWith('Lista em baixo'));
    listAllRunsSpy.mockResolvedValue({ items: [] });
    await Promise.all([
      useSchedulesStore.getState().fetchSchedules(),
      useSchedulesStore.getState().fetchOrgRuns('pending'),
    ]);
    expect(useSchedulesStore.getState().loadError).toBe('Lista em baixo');
  });
});

describe('fetchRuns', () => {
  it('caches history under the schedule id without disturbing other ids', async () => {
    useSchedulesStore.setState({ runs: { 'sch-other': [run({ id: 'keep' })] } });
    listRunsSpy.mockResolvedValue({ items: [run({ id: 'run-9', status: 'ok' })] });
    await useSchedulesStore.getState().fetchRuns('sch-1');
    const { runs } = useSchedulesStore.getState();
    expect(runs['sch-1']!.map((r) => r.id)).toEqual(['run-9']);
    expect(runs['sch-other']!.map((r) => r.id)).toEqual(['keep']);
    expect(listRunsSpy).toHaveBeenCalledWith({ id: 'sch-1' });
  });

  it('records WHY a history is missing, so its absence is not read as "still loading"', async () => {
    listRunsSpy.mockImplementation(failWith('Histórico indisponível'));
    await useSchedulesStore.getState().fetchRuns('sch-1');
    const state = useSchedulesStore.getState();
    // No history was cached (there is none) - the reason is what the detail page renders.
    expect(state.runs['sch-1']).toBeUndefined();
    expect(state.runsError['sch-1']).toBe('Histórico indisponível');
  });

  it('scopes the failure to its own schedule and forgets it on a retry', async () => {
    listRunsSpy.mockImplementation(failWith('Histórico indisponível'));
    await useSchedulesStore.getState().fetchRuns('sch-1');
    expect(useSchedulesStore.getState().runsError['sch-other']).toBeUndefined();

    listRunsSpy.mockReset();
    listRunsSpy.mockResolvedValue({ items: [run({ id: 'run-9', status: 'ok' })] });
    await useSchedulesStore.getState().fetchRuns('sch-1');
    const state = useSchedulesStore.getState();
    expect(state.runsError['sch-1']).toBeUndefined();
    expect(state.runs['sch-1']!.map((r) => r.id)).toEqual(['run-9']);
  });
});

describe('clearError', () => {
  it('acknowledges an action failure without touching the read channel', async () => {
    useSchedulesStore.setState({ error: 'Sem permissão', loadError: 'Lista em baixo' });
    useSchedulesStore.getState().clearError();
    const state = useSchedulesStore.getState();
    expect(state.error).toBeUndefined();
    expect(state.loadError).toBe('Lista em baixo');
  });
});

describe('create', () => {
  it('prepends the created schedule from the response', async () => {
    useSchedulesStore.setState({ items: [schedule({ id: 'sch-old', name: 'Antigo' })] });
    createSpy.mockResolvedValue(schedule({ id: 'sch-new', name: 'Novo' }));
    const created = await useSchedulesStore.getState().create({
      name: 'Novo',
      target: { kind: 'manual', instructions: 'Fazer' },
      spec: { kind: 'once', at: '2026-09-01T09:00:00.000Z' },
    });
    expect(created?.id).toBe('sch-new');
    expect(useSchedulesStore.getState().items.map((s) => s.id)).toEqual(['sch-new', 'sch-old']);
  });

  it('returns null and leaves the list untouched on failure', async () => {
    useSchedulesStore.setState({ items: [schedule()] });
    createSpy.mockImplementation(failWith('Fuso horário inválido'));
    const created = await useSchedulesStore.getState().create({
      name: 'Novo',
      target: { kind: 'manual' },
      spec: { kind: 'once', at: '2026-09-01T09:00:00.000Z' },
    });
    expect(created).toBeNull();
    expect(useSchedulesStore.getState().items.map((s) => s.id)).toEqual(['sch-1']);
    expect(useSchedulesStore.getState().error).toBe('Fuso horário inválido');
  });
});

describe('update', () => {
  it('maps the response over the cached row and sends the id as a path param', async () => {
    useSchedulesStore.setState({ items: [schedule(), schedule({ id: 'sch-2', name: 'Outro' })] });
    patchSpy.mockResolvedValue(schedule({ enabled: false, nextRunAt: null }));
    const saved = await useSchedulesStore.getState().update('sch-1', { enabled: false });
    expect(patchSpy).toHaveBeenCalledWith({ id: 'sch-1', enabled: false });
    expect(saved?.enabled).toBe(false);
    const items = useSchedulesStore.getState().items;
    expect(items[0]!.enabled).toBe(false);
    expect(items[1]!.name).toBe('Outro');
  });

  it('returns null and keeps the old row on failure', async () => {
    useSchedulesStore.setState({ items: [schedule()] });
    patchSpy.mockImplementation(failWith('Sem permissão'));
    expect(await useSchedulesStore.getState().update('sch-1', { enabled: false })).toBeNull();
    expect(useSchedulesStore.getState().items[0]!.enabled).toBe(true);
    expect(useSchedulesStore.getState().error).toBe('Sem permissão');
  });
});

describe('remove', () => {
  it('drops the schedule, its cached history and its runs from the feed', async () => {
    useSchedulesStore.setState({
      items: [schedule(), schedule({ id: 'sch-2' })],
      runs: { 'sch-1': [run()], 'sch-2': [run({ id: 'run-2', scheduleId: 'sch-2' })] },
      orgRuns: [run(), run({ id: 'run-2', scheduleId: 'sch-2' })],
      pendingTasks: [run(), run({ id: 'run-2', scheduleId: 'sch-2' })],
    });
    removeSpy.mockResolvedValue({ ok: true });
    expect(await useSchedulesStore.getState().remove('sch-1')).toBe(true);
    const state = useSchedulesStore.getState();
    expect(state.items.map((s) => s.id)).toEqual(['sch-2']);
    expect(state.runs['sch-1']).toBeUndefined();
    expect(state.orgRuns.map((r) => r.id)).toEqual(['run-2']);
    expect(state.pendingTasks.map((r) => r.id)).toEqual(['run-2']);
  });

  it('keeps everything on failure', async () => {
    useSchedulesStore.setState({ items: [schedule()] });
    removeSpy.mockImplementation(failWith('Conflito'));
    expect(await useSchedulesStore.getState().remove('sch-1')).toBe(false);
    expect(useSchedulesStore.getState().items).toHaveLength(1);
    expect(useSchedulesStore.getState().error).toBe('Conflito');
  });
});

describe('runNow', () => {
  it('prepends the answered run to the feed and to a cached history', async () => {
    useSchedulesStore.setState({ runs: { 'sch-1': [run({ id: 'run-old', status: 'ok' })] } });
    runNowSpy.mockResolvedValue({ run: run({ id: 'run-new', status: 'running' }) });
    const fired = await useSchedulesStore.getState().runNow('sch-1');
    expect(runNowSpy).toHaveBeenCalledWith({ id: 'sch-1' });
    expect(fired?.id).toBe('run-new');
    const state = useSchedulesStore.getState();
    expect(state.runs['sch-1']!.map((r) => r.id)).toEqual(['run-new', 'run-old']);
    expect(state.orgRuns.map((r) => r.id)).toEqual(['run-new']);
    // A `running` fire is not a task, so the inbox must stay empty.
    expect(state.pendingTasks).toEqual([]);
  });

  it('puts a manual fire straight into the task inbox', async () => {
    runNowSpy.mockResolvedValue({ run: run({ id: 'run-task', status: 'pending' }) });
    await useSchedulesStore.getState().runNow('sch-1');
    expect(useSchedulesStore.getState().pendingTasks.map((r) => r.id)).toEqual(['run-task']);
  });

  it('returns null on failure', async () => {
    runNowSpy.mockImplementation(failWith('Indisponível'));
    expect(await useSchedulesStore.getState().runNow('sch-1')).toBeNull();
    expect(useSchedulesStore.getState().error).toBe('Indisponível');
  });
});

describe('completeRun', () => {
  it('replaces the run everywhere it is cached and re-derives the inbox', async () => {
    useSchedulesStore.setState({
      orgRuns: [run(), run({ id: 'run-2', status: 'pending' })],
      pendingTasks: [run(), run({ id: 'run-2', status: 'pending' })],
      runs: { 'sch-1': [run()] },
    });
    completeRunSpy.mockResolvedValue({ run: run({ status: 'done', note: 'feito' }) });

    expect(await useSchedulesStore.getState().completeRun('run-1', 'done', 'feito')).toBe(true);
    expect(completeRunSpy).toHaveBeenCalledWith({ runId: 'run-1', outcome: 'done', note: 'feito' });

    const state = useSchedulesStore.getState();
    expect(state.orgRuns.find((r) => r.id === 'run-1')!.status).toBe('done');
    expect(state.runs['sch-1']![0]!.status).toBe('done');
    // Only the still-pending sibling survives in the inbox.
    expect(state.pendingTasks.map((r) => r.id)).toEqual(['run-2']);
  });

  it('leaves the inbox untouched on failure', async () => {
    useSchedulesStore.setState({ orgRuns: [run()], pendingTasks: [run()] });
    completeRunSpy.mockImplementation(failWith('Já concluída'));
    expect(await useSchedulesStore.getState().completeRun('run-1', 'dismissed')).toBe(false);
    expect(useSchedulesStore.getState().pendingTasks.map((r) => r.id)).toEqual(['run-1']);
    expect(useSchedulesStore.getState().error).toBe('Já concluída');
  });
});

describe('preview', () => {
  it('returns the server occurrences - the client never computes them', async () => {
    previewSpy.mockResolvedValue({ occurrences: ['2026-08-24T08:00:00.000Z'] });
    const spec = { kind: 'recurring' as const, rule: { every: 'day' as const, interval: 1, at: { hour: 9, minute: 0 }, timezone: 'Europe/Lisbon' } };
    const result = await useSchedulesStore.getState().preview({ spec, count: 3 });
    expect(previewSpy).toHaveBeenCalledWith({ spec, count: 3 });
    expect(result).toEqual({ ok: true, occurrences: ['2026-08-24T08:00:00.000Z'] });
  });

  it('forwards the anchor schedule id, so an edit dialog previews the stored anchor', async () => {
    // The anchor is the SERVER's business (it reads the schedule's creation instant); the store's
    // only duty is to carry the id, and dropping it silently returns the create-form series.
    previewSpy.mockResolvedValue({ occurrences: ['2026-08-17T12:32:00.000Z'] });
    const spec = { kind: 'recurring' as const, rule: { every: 'hour' as const, interval: 5, timezone: 'Europe/Lisbon' } };
    await useSchedulesStore.getState().preview({ spec, count: 1, scheduleId: 'sch-1' });
    expect(previewSpy).toHaveBeenCalledWith({ spec, count: 1, scheduleId: 'sch-1' });
  });

  it('returns a validation failure to the FORM without touching the page-wide error', async () => {
    previewSpy.mockImplementation(failWith('Fuso horário desconhecido'));
    const result = await useSchedulesStore.getState().preview({
      spec: { kind: 'recurring', rule: { every: 'day', interval: 1, timezone: 'Marte/Olympus' } },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Fuso horário desconhecido');
    expect(useSchedulesStore.getState().error).toBeUndefined();
  });
});
