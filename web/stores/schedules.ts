"use client";

/**
 * Schedules store.
 *
 * Holds the schedule list, the org-wide run feed (which the task inbox reads) and the
 * per-schedule run history. Every call goes through the typed client + `tryCall`; in dev the
 * transport validates each 2xx body against the shared zod schema, so this store only ever
 * touches fields `shared/src/schedules.ts` declares.
 *
 * `pendingTasks` is DERIVED from `orgRuns` and recomputed inside every `set` that touches
 * them - never assigned independently, so the inbox can't drift from the feed it summarises.
 * Occurrence math (next fire, preview) belongs to the server; nothing here computes a date.
 *
 * Failures are kept in THREE channels because the surfaces render them in three different
 * places: `loadError` (the page's own read broke - show that instead of an empty list),
 * `error` (the action the user just took broke - report it, leave the list alone) and
 * `runsError[scheduleId]` (one schedule's history broke - offer a retry in its place).
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import type {
  Schedule,
  ScheduleCreateRequest,
  SchedulePatch,
  ScheduleRun,
  ScheduleRunStatus,
  ScheduleSpec,
} from '@ekoa/shared';

interface SchedulesState {
  items: Schedule[];
  /** Run history per schedule id (detail page). */
  runs: Record<string, ScheduleRun[]>;
  /**
   * Why a schedule's history is missing, per schedule id. `runs[id]` stays UNSET on a failed
   * fetch (there is no history to show), so without this a reader cannot tell "not back yet"
   * from "came back broken" and renders a spinner that never resolves.
   */
  runsError: Record<string, string>;
  /** The org-wide run feed. */
  orgRuns: ScheduleRun[];
  /** Derived from `orgRuns`: the manual tasks still waiting on the owner. */
  pendingTasks: ScheduleRun[];
  loading: boolean;
  /**
   * A failed ACTION the user just took (create / patch / delete / run-now / complete). Read
   * once and cleared, so the surface reports it instead of letting the control snap back.
   */
  error?: string;
  /**
   * A failed READ of the page's own data (the list or the org run feed). Kept apart from
   * `error` because the two demand opposite renderings: a broken read must replace the list
   * (never "no schedules yet"), a broken write must leave the list standing.
   */
  loadError?: string;
}

/**
 * Create / patch payloads ARE the shared request contracts - aliased rather than restated so
 * a contract change lands here as a type error instead of a silent drift.
 */
export type ScheduleInput = ScheduleCreateRequest;
export type SchedulePatchInput = SchedulePatch;

export interface PreviewResult {
  ok: boolean;
  occurrences?: string[];
  error?: string;
}

interface SchedulesActions {
  fetchSchedules: () => Promise<void>;
  fetchOrgRuns: (status?: ScheduleRunStatus) => Promise<void>;
  fetchRuns: (scheduleId: string) => Promise<void>;
  /** Acknowledge the last action failure once a surface has reported it. */
  clearError: () => void;
  create: (input: ScheduleInput) => Promise<Schedule | null>;
  update: (id: string, patch: SchedulePatchInput) => Promise<Schedule | null>;
  remove: (id: string) => Promise<boolean>;
  runNow: (id: string) => Promise<ScheduleRun | null>;
  completeRun: (runId: string, outcome: 'done' | 'dismissed', note?: string) => Promise<boolean>;
  /** `scheduleId` anchors the preview on an EXISTING schedule (the edit dialog); omitted, the
   *  server anchors on the request instant, which is what the create form wants. */
  preview: (input: { spec: ScheduleSpec; count?: number; scheduleId?: string }) => Promise<PreviewResult>;
}

const pendingOf = (runs: ScheduleRun[]): ScheduleRun[] => runs.filter((r) => r.status === 'pending');

/** Replace a run wherever it is cached (org feed + every per-schedule history). */
function replaceRun(state: SchedulesState, run: ScheduleRun): Pick<SchedulesState, 'orgRuns' | 'pendingTasks' | 'runs'> {
  const orgRuns = state.orgRuns.map((r) => (r.id === run.id ? run : r));
  const runs: Record<string, ScheduleRun[]> = {};
  for (const [scheduleId, list] of Object.entries(state.runs)) {
    runs[scheduleId] = list.map((r) => (r.id === run.id ? run : r));
  }
  return { orgRuns, pendingTasks: pendingOf(orgRuns), runs };
}

export const useSchedulesStore = create<SchedulesState & SchedulesActions>((set) => ({
  items: [],
  runs: {},
  runsError: {},
  orgRuns: [],
  pendingTasks: [],
  loading: false,

  /**
   * The list page fires this and `fetchOrgRuns` together; both clear `loadError` before their
   * first await and only ever set it afterwards, so the pair cannot erase each other's failure
   * however the two responses interleave.
   */
  async fetchSchedules() {
    set({ loading: true, error: undefined, loadError: undefined });
    const res = await tryCall(() => api.schedules.list());
    if (res.ok) {
      set({ items: res.data.items, loading: false });
    } else {
      set({ loading: false, loadError: res.error.message || 'Não foi possível carregar os agendamentos.' });
    }
  },

  async fetchOrgRuns(status) {
    set({ loadError: undefined });
    const res = await tryCall(() => api.schedules.listAllRuns(status ? { status } : undefined));
    if (res.ok) {
      const orgRuns = res.data.items;
      set({ orgRuns, pendingTasks: pendingOf(orgRuns) });
    } else {
      set({ loadError: res.error.message || 'Não foi possível carregar as execuções.' });
    }
  },

  async fetchRuns(scheduleId) {
    const forget = (state: SchedulesState) => {
      const runsError = { ...state.runsError };
      delete runsError[scheduleId];
      return runsError;
    };
    set((s) => ({ runsError: forget(s) }));
    const res = await tryCall(() => api.schedules.listRuns({ id: scheduleId }));
    if (res.ok) {
      set((s) => ({ runs: { ...s.runs, [scheduleId]: res.data.items }, runsError: forget(s) }));
    } else {
      set((s) => ({
        runsError: { ...s.runsError, [scheduleId]: res.error.message || 'Não foi possível carregar o histórico.' },
      }));
    }
  },

  clearError() {
    set({ error: undefined });
  },

  async create(input) {
    set({ error: undefined });
    const res = await tryCall(() => api.schedules.create(input));
    if (res.ok) {
      const created = res.data;
      set((s) => ({ items: [created, ...s.items] }));
      return created;
    }
    set({ error: res.error.message || 'Não foi possível criar o agendamento.' });
    return null;
  },

  async update(id, patch) {
    set({ error: undefined });
    const res = await tryCall(() => api.schedules.patch({ id, ...patch }));
    if (res.ok) {
      const updated = res.data;
      set((s) => ({ items: s.items.map((item) => (item.id === id ? updated : item)) }));
      return updated;
    }
    set({ error: res.error.message || 'Não foi possível guardar o agendamento.' });
    return null;
  },

  async remove(id) {
    set({ error: undefined });
    const res = await tryCall(() => api.schedules.remove({ id }));
    if (res.ok) {
      set((s) => {
        const runs = { ...s.runs };
        delete runs[id];
        const runsError = { ...s.runsError };
        delete runsError[id];
        const orgRuns = s.orgRuns.filter((r) => r.scheduleId !== id);
        return {
          items: s.items.filter((item) => item.id !== id),
          runs,
          runsError,
          orgRuns,
          pendingTasks: pendingOf(orgRuns),
        };
      });
      return true;
    }
    set({ error: res.error.message || 'Não foi possível eliminar o agendamento.' });
    return false;
  },

  async runNow(id) {
    set({ error: undefined });
    const res = await tryCall(() => api.schedules.runNow({ id }));
    if (res.ok) {
      const run = res.data.run;
      set((s) => {
        const cached = s.runs[id];
        const orgRuns = [run, ...s.orgRuns];
        return {
          runs: cached ? { ...s.runs, [id]: [run, ...cached] } : s.runs,
          orgRuns,
          pendingTasks: pendingOf(orgRuns),
        };
      });
      return run;
    }
    set({ error: res.error.message || 'Não foi possível executar o agendamento.' });
    return null;
  },

  async completeRun(runId, outcome, note) {
    set({ error: undefined });
    const res = await tryCall(() => api.schedules.completeRun({ runId, outcome, note }));
    if (res.ok) {
      set((s) => replaceRun(s, res.data.run));
      return true;
    }
    set({ error: res.error.message || 'Não foi possível concluir a tarefa.' });
    return false;
  },

  async preview({ spec, count, scheduleId }) {
    // Preview errors are the FORM's (an incomplete rule), not the page's - they are returned
    // for inline rendering and deliberately never written to the store-wide `error`.
    const res = await tryCall(() => api.schedules.preview({ spec, count, scheduleId }));
    if (res.ok) return { ok: true, occurrences: res.data.occurrences };
    return { ok: false, error: res.error.message };
  },
}));

