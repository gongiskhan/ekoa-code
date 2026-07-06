/**
 * Regression coverage for the "wrong artifact in preview" bug (prod 2026-06-16).
 *
 * Symptom: opening an artifact from the homepage "Continua onde paraste" stripe
 * (which navigates by sessionId) showed a DIFFERENT artifact's app in the
 * preview, while the artifacts-page "Continue Working" button (which routes
 * through ?continue= and force-sets the artifact's authoritative state) worked.
 *
 * Root cause: build-completion handlers persist a SLUG-based preview URL
 * (`/apps/{slug}/`) per session. Slugs are mutable/re-indexable server-side
 * (renames unindex; a deploy rebuilds the index from an unordered readAll();
 * forks/imports can collide), so a persisted slug-based URL can later resolve
 * to a different artifact. On load, `hydrateSessionFromArtifact` early-returned
 * on any persisted job and `initializeBuilderSession` only filled MISSING
 * fields — neither reconciled the stale slug/appUrl to the artifact's
 * authoritative, slug-drift-immune id-based `data.appUrl`.
 *
 * These tests assert the post-fix behavior: a session that maps to an artifact
 * is reconciled to that artifact's CURRENT id / slug / appUrl on load.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Controllable artifact list. hydrateSessionFromArtifact only calls these two
// client functions; the rest of the store isn't exercised by these tests.
let mockInstances: unknown[] = [];
vi.mock('@/lib/api/client', () => ({
  listArtifactInstances: () => Promise.resolve({ success: true, data: mockInstances }),
  listArtifactFiles: () =>
    Promise.resolve({ success: true, data: { files: [], instance: {} } }),
}));

import { useOrchestrationStore, type SessionJobState } from '@/stores/orchestration';

const SID = 'sess-copia';
const ARTIFACT_ID = '9de8b170-9ae9-41c7-b0fb-25ba1e63f539';

function job(partial: Partial<SessionJobState>): SessionJobState {
  return {
    jobId: null,
    status: 'completed',
    phase: null,
    progress: 0,
    progressMessage: null,
    output: [],
    artifactInstanceId: null,
    slug: null,
    shareable: false,
    projectPath: null,
    lastBuildAt: null,
    ...partial,
  };
}

beforeEach(() => {
  useOrchestrationStore.setState({
    sessionJobs: {},
    sessionPreviews: {},
    sessionFiles: {},
    sessionSidePanelStates: {},
    activeSessionId: null,
    sessions: [],
  });
  mockInstances = [];
});

describe('hydrateSessionFromArtifact reconciles stale identity', () => {
  it('overwrites a stale slug-based appUrl/slug/id with the artifact authoritative values', async () => {
    // Persisted (stale) state: a slug-based preview URL from a prior build whose
    // slug has since been re-indexed to a DIFFERENT artifact.
    useOrchestrationStore.setState({
      sessionJobs: {
        [SID]: job({ artifactInstanceId: 'OLD-stale-id', slug: 'erp-imobiliario' }),
      },
      sessionPreviews: {
        [SID]: { previewId: 'erp-imobiliario', appUrl: '/apps/erp-imobiliario/', status: 'running', error: null },
      },
      activeSessionId: SID,
    });
    mockInstances = [
      {
        id: ARTIFACT_ID,
        slug: 'property-management-5',
        shareable: true,
        updatedAt: '2026-06-16T11:15:23.000Z',
        data: { sessionId: SID, appUrl: `/apps/${ARTIFACT_ID}/`, projectDir: '/sandbox/x' },
      },
    ];

    const ok = await useOrchestrationStore.getState().hydrateSessionFromArtifact(SID);
    expect(ok).toBe(true);

    const j = useOrchestrationStore.getState().sessionJobs[SID];
    const p = useOrchestrationStore.getState().sessionPreviews[SID];
    expect(j.artifactInstanceId).toBe(ARTIFACT_ID);
    expect(j.slug).toBe('property-management-5');
    // Preview must resolve to the artifact's slug-drift-immune id-based URL.
    expect(p.appUrl).toBe(`/apps/${ARTIFACT_ID}/`);
  });

  it('hydrates a fresh (no prior job) session from the matching artifact', async () => {
    mockInstances = [
      {
        id: ARTIFACT_ID,
        slug: 'property-management-5',
        shareable: false,
        updatedAt: '2026-06-16T11:15:23.000Z',
        data: { sessionId: SID, appUrl: `/apps/${ARTIFACT_ID}/`, projectDir: '/sandbox/x' },
      },
    ];

    const ok = await useOrchestrationStore.getState().hydrateSessionFromArtifact(SID);
    expect(ok).toBe(true);
    const j = useOrchestrationStore.getState().sessionJobs[SID];
    expect(j.artifactInstanceId).toBe(ARTIFACT_ID);
    expect(j.slug).toBe('property-management-5');
    expect(useOrchestrationStore.getState().sessionPreviews[SID].appUrl).toBe(`/apps/${ARTIFACT_ID}/`);
  });

  it('disambiguates a SHARED session by the pinned artifact id, not list order', async () => {
    // Two artifacts share one session (legacy fork/copy). The clicked card pins
    // the SECOND one; the FIRST is earlier in list order. hydrate must keep the
    // pinned artifact, not the first-by-sessionId match.
    const PINNED_ID = 'pinned-copy-id';
    useOrchestrationStore.setState({
      sessionJobs: { [SID]: job({ artifactInstanceId: PINNED_ID, slug: 'stale' }) },
      sessionPreviews: { [SID]: { previewId: 'stale', appUrl: '/apps/stale/', status: 'running', error: null } },
      activeSessionId: SID,
    });
    mockInstances = [
      // First in list order, also matches the session — the WRONG one.
      { id: 'sibling-original-id', slug: 'erp-original', shareable: true,
        data: { sessionId: SID, appUrl: '/apps/sibling-original-id/' } },
      // The artifact actually pinned to the session.
      { id: PINNED_ID, slug: 'erp-copy-5', shareable: true, updatedAt: '2026-06-16T11:15:23.000Z',
        data: { sessionId: SID, appUrl: `/apps/${PINNED_ID}/` } },
    ];

    const ok = await useOrchestrationStore.getState().hydrateSessionFromArtifact(SID);
    expect(ok).toBe(true);
    const j = useOrchestrationStore.getState().sessionJobs[SID];
    const p = useOrchestrationStore.getState().sessionPreviews[SID];
    expect(j.artifactInstanceId).toBe(PINNED_ID);
    expect(j.slug).toBe('erp-copy-5');
    expect(p.appUrl).toBe(`/apps/${PINNED_ID}/`);
  });

  it('keeps existing state and reports hydrated when no artifact matches the session', async () => {
    useOrchestrationStore.setState({
      sessionJobs: { [SID]: job({ artifactInstanceId: 'kept-id', slug: 'kept-slug' }) },
      activeSessionId: SID,
    });
    mockInstances = []; // artifact deleted / not in list

    const ok = await useOrchestrationStore.getState().hydrateSessionFromArtifact(SID);
    expect(ok).toBe(true);
    const j = useOrchestrationStore.getState().sessionJobs[SID];
    expect(j.artifactInstanceId).toBe('kept-id');
    expect(j.slug).toBe('kept-slug');
  });

  it('returns false when the session has no job and no matching artifact', async () => {
    mockInstances = [];
    const ok = await useOrchestrationStore.getState().hydrateSessionFromArtifact('unknown-session');
    expect(ok).toBe(false);
  });

  it('does not clobber identity while a build is actively running', async () => {
    useOrchestrationStore.setState({
      sessionJobs: { [SID]: job({ artifactInstanceId: ARTIFACT_ID, slug: 'mid-build', status: 'running' }) },
      sessionPreviews: { [SID]: { previewId: null, appUrl: '/apps/mid-build/', status: 'building', error: null } },
      activeSessionId: SID,
    });
    mockInstances = [
      {
        id: ARTIFACT_ID,
        slug: 'property-management-5',
        shareable: true,
        updatedAt: '2026-06-16T11:15:23.000Z',
        data: { sessionId: SID, appUrl: `/apps/${ARTIFACT_ID}/`, projectDir: '/sandbox/x' },
      },
    ];

    await useOrchestrationStore.getState().hydrateSessionFromArtifact(SID);
    const j = useOrchestrationStore.getState().sessionJobs[SID];
    // Running build's live state is preserved, not overwritten by the load reconcile.
    expect(j.status).toBe('running');
    expect(j.slug).toBe('mid-build');
  });
});
