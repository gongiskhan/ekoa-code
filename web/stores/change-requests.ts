'use client';

/**
 * Change-requests store (operator-run H4). The org-admin queue read + the two admin actions
 * (convert / dismiss), plus the refused-build feed's file action.
 *
 * `GET /api/v1/change-requests`: an org-admin sees its OWN org, a super-admin may pass `orgId`
 * to cross orgs (the exact registo scoping). "Converter" starts a patch run the way the panel's
 * edit mode does — a follow-up build via `POST /api/v1/jobs` (H1-gated: the org-admin has
 * canEditApps + loadWritable on an org app) — then marks the request converted with the job id.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import type { ChangeRequest, ChangeRequestStatus, ChangeRequestQuery } from '@ekoa/shared';

const PAGE_SIZE = 100;

interface ChangeRequestsState {
  requests: ChangeRequest[];
  total: number;
  /** '' = all statuses; otherwise a single status filter (defaults to 'open' at first load). */
  statusFilter: ChangeRequestStatus | '';
  /** super-admin cross-org filter ('' = all orgs). */
  orgId: string;
  isLoading: boolean;
  /** id currently being converted/dismissed (guards double-click + drives the row spinner). */
  actingId: string | null;
  error: string | null;

  fetchRequests: () => Promise<void>;
  setStatusFilter: (value: ChangeRequestStatus | '') => void;
  setOrgId: (value: string) => void;
  convert: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  /** Refused-build feed (BRIEF 9a): file a pre-drafted request to the requester's OWN org queue
   *  (no served-app header) so an H1 refusal is never a dead end. `appId` is the edit-refusal
   *  artifact when present (informational; convert re-gates it). */
  fileFromRefusal: (input: { text: string; appId?: string; route?: string }) => Promise<boolean>;
  clearError: () => void;
}

export const useChangeRequestsStore = create<ChangeRequestsState>()((set, get) => ({
  requests: [],
  total: 0,
  statusFilter: 'open',
  orgId: '',
  isLoading: false,
  actingId: null,
  error: null,

  fetchRequests: async () => {
    const { statusFilter, orgId } = get();
    set({ isLoading: true, error: null });
    const query: ChangeRequestQuery = { limit: PAGE_SIZE };
    if (statusFilter) query.status = statusFilter;
    if (orgId) query.orgId = orgId;
    const response = await tryCall(() =>
      api.changeRequests.list(query as unknown as Record<string, unknown>),
    );
    if (response.ok) {
      set({ requests: response.data.items, total: response.data.total, isLoading: false });
    } else {
      set({ error: response.error.message || 'Falha ao carregar os pedidos.', isLoading: false });
    }
  },

  setStatusFilter: (value) => {
    set({ statusFilter: value });
    void get().fetchRequests();
  },

  setOrgId: (value) => {
    set({ orgId: value });
    void get().fetchRequests();
  },

  convert: async (id) => {
    const request = get().requests.find((r) => r.id === id);
    if (!request || get().actingId) return;
    set({ actingId: id, error: null });
    // 1) Start the patch run — the SAME H1-gated follow-up build the dashboard/panel drive. A
    //    request that names an app is a follow-up (artifactId); a refused-build request without
    //    one is a first build. Both are re-gated server-side (canBuildApps/canEditApps).
    const job = await tryCall(() =>
      api.jobs.create({
        kind: 'build',
        description: request.text,
        sessionId: `pedido-${request.id}`,
        language: 'pt',
        ...(request.appId ? { artifactId: request.appId } : {}),
      }),
    );
    if (!job.ok) {
      set({ actingId: null, error: job.error.message || 'Não foi possível iniciar a alteração.' });
      return;
    }
    if (job.data.status !== 'created') {
      // The in-build classifier answered without starting a job: nothing to link. Leave the
      // request open and tell the admin to reformulate.
      set({ actingId: null, error: 'O pedido foi respondido sem criar uma revisão. Reformule o pedido.' });
      return;
    }
    // 2) Link the resulting job and flip the request to converted. Read the id out here, where the
    //    union is narrowed to the 'created' variant (the narrowing does not survive into a closure).
    const jobId = job.data.job.id;
    const converted = await tryCall(() => api.changeRequests.convert({ id: request.id, jobId }));
    set({ actingId: null });
    if (!converted.ok) {
      set({ error: converted.error.message || 'A revisão foi iniciada mas o pedido não foi marcado.' });
    }
    await get().fetchRequests();
  },

  dismiss: async (id) => {
    if (get().actingId) return;
    set({ actingId: id, error: null });
    const response = await tryCall(() => api.changeRequests.dismiss({ id }));
    set({ actingId: null });
    if (!response.ok) {
      set({ error: response.error.message || 'Não foi possível dispensar o pedido.' });
      return;
    }
    await get().fetchRequests();
  },

  fileFromRefusal: async ({ text, appId, route }) => {
    const response = await tryCall(() =>
      api.changeRequests.file({ text, ...(appId ? { appId } : {}), ...(route ? { route } : {}) }),
    );
    return response.ok;
  },

  clearError: () => set({ error: null }),
}));
