/*
 * Operator Assistant Panel - EDIT MODE controller (operator-run H3; admins only).
 *
 * A thin FRONT-END over the platform's EXISTING build machinery (all H1-gated). It is
 * NOT a second brain: an admin's edit request becomes a SCOPED FOLLOW-UP BUILD (a
 * "patch run") over the app's own git repo, exactly the path the dashboard uses.
 *
 * This module owns the NETWORK side of that flow, factored out of AssistantPanel.jsx so
 * it can be unit-proven against a fake fetch (tests/apps/edit-mode.test.ts). Every call
 * targets the PLATFORM /api/v1/* API with the admin's platform Bearer - a SEPARATE plane
 * from the served-app POST /api/app-assistant, which stays visitor-blind (it never reads
 * the caller JWT). Nothing here grounds, bills, or issues an assistant turn.
 *
 * The plane's gates are the server's, not ours:
 *   - POST /api/v1/jobs { kind:'build', artifactId, description } → a follow-up build,
 *     gated server-side by can(canEditApps) AND loadWritable(actor, artifactId) (H1).
 *     A non-admin (no token / plain user / cross-org) is refused there with a uniform
 *     404, so this front-end can offer the switch freely: the SERVER is the authority.
 *   - GET  /api/v1/artifacts/:id/versions → the commit list (newest first). We read it
 *     BEFORE the run (the pre-run head = the rollback target / diff point) and AFTER
 *     (the new head) for the preview.
 *   - POST /api/v1/artifacts/:id/versions/:sha/restore → forward-restore to the pre-run
 *     head (one-click rollback). writable()-gated + canEditApps (H1).
 *   - GET  /api/v1/jobs/:id/events?token=... → the job SSE (progress narration). The
 *     job's own owner-scoped stream (?token= = the same admin token that created it).
 *
 * Graceful degradation is a first-class outcome: any mid-flow 401/403/404 (token
 * expired, lost writability, app gone) resolves to a calm PT-PT message, never a throw
 * and never a crash. PT-PT throughout, no emoji, no em/en-dash.
 */

/** The build-jobs collection endpoint (a follow-up build is a POST here with artifactId). */
export const JOBS_ENDPOINT = '/api/v1/jobs';

/** GET the artifact's version list (commits, newest first). */
export function versionsEndpoint(appId) {
  return `/api/v1/artifacts/${encodeURIComponent(appId)}/versions`;
}

/** POST to forward-restore the artifact to `sha` (one-click rollback). */
export function restoreEndpoint(appId, sha) {
  return `/api/v1/artifacts/${encodeURIComponent(appId)}/versions/${encodeURIComponent(sha)}/restore`;
}

/** The job SSE stream. EventSource cannot set headers (CONV-1), so the job stream
 *  authenticates via ?token= (verifySseToken, the same chain requireAuth runs); we read
 *  it with fetch (the panel's one transport) rather than EventSource so it stays
 *  abortable and unit-testable. */
export function jobEventsUrl(jobId, token) {
  return `/api/v1/jobs/${encodeURIComponent(jobId)}/events?token=${encodeURIComponent(token)}`;
}

/** PT-PT copy for the edit flow. Kept here so the panel and the tests share one source
 *  of truth for the confirmation wording, the progress fallback and the empty-diff note. */
export const EDIT_COPY = {
  confirm: 'Vou preparar esta alteração como uma revisão. Confirma?',
  preparing: 'A preparar a alteração...',
  applied: 'Alteração aplicada. Reveja antes de aprovar.',
  noChange: 'A revisão terminou sem alterações ao código.',
  approved: 'Alteração mantida.',
  rolledBack: 'Alteração revertida.',
};

/** Map a mid-flow platform failure onto a calm PT-PT message (graceful degradation).
 *  401 = the admin's session expired; 403 = writability was lost (no longer an editor);
 *  404 = the app is gone / not writable; anything else = a generic, non-alarming line. */
export function degradeMessage(status) {
  if (status === 401) return 'A sua sessão expirou. Inicie sessão novamente para continuar a editar.';
  if (status === 403) return 'Já não tem permissão para editar esta aplicação.';
  if (status === 404) return 'Esta aplicação já não está disponível para edição.';
  return 'Não foi possível concluir a alteração. Tente novamente mais tarde.';
}

/** A client-side correlation id for the follow-up build. A follow-up does NOT reserve a
 *  session (only a first build does); sessionId merely tags the job record + run, so a
 *  fresh per-edit id is correct and collision-safe. */
export function newEditSessionId(appId) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `edit-${appId || 'app'}-${Date.now()}-${rand}`;
}

/**
 * Parse accumulated SSE text into the complete events plus the unparsed remainder. An SSE
 * event is terminated by a blank line; the job stream carries its JobEvent JSON on
 * `data:` lines (other fields - `id:`, `event:`, `:` comments - are ignored). The caller
 * accumulates `rest` and feeds it back with the next chunk, so a frame split across chunk
 * boundaries is never dropped. A garbled/partial frame is skipped, never thrown.
 */
export function parseSseBuffer(buffer) {
  const events = [];
  const normalised = String(buffer || '').replace(/\r\n/g, '\n');
  const chunks = normalised.split('\n\n');
  const rest = chunks.pop() || ''; // trailing, possibly incomplete frame stays buffered
  for (const chunk of chunks) {
    const dataLines = chunk.split('\n').filter((l) => l.startsWith('data:'));
    if (!dataLines.length) continue;
    const payload = dataLines.map((l) => l.slice(5).trimStart()).join('\n');
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* a partial or garbled frame - skip it, never crash the stream */
    }
  }
  return { events, rest };
}

/**
 * Start the follow-up build (the patch run) for `appId`. POSTs the H1-gated jobs endpoint
 * with the admin Bearer. Returns a discriminated result:
 *   - { ok:true, status:'created', jobId }  - the build was accepted (202)
 *   - { ok:true, status:'answered', reason} - the in-build classifier resolved it with no
 *                                             job (e.g. it read the request as a question)
 *   - { ok:false, status }                  - a refusal (401/403/404/409/...) → the panel
 *                                             degrades on `status`; the SERVER is the gate
 * Never throws - a network failure is { ok:false, status:0 }.
 */
export async function startEditJob({ fetchImpl, appId, token, description, sessionId }) {
  let res;
  try {
    res = await fetchImpl(JOBS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        kind: 'build',
        description,
        sessionId: sessionId || newEditSessionId(appId),
        language: 'pt',
        artifactId: appId,
      }),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (data && data.status === 'answered') {
    return { ok: true, status: 'answered', reason: typeof data.reason === 'string' ? data.reason : '' };
  }
  const jobId = data && data.job && typeof data.job.id === 'string' ? data.job.id : undefined;
  if (!jobId) return { ok: false, status: res.status };
  return { ok: true, status: 'created', jobId };
}

/**
 * Read the artifact's version list. Returns { ok:true, items, head } where `head` is the
 * newest commit sha (items[0].sha) or undefined for a fresh repo, or { ok:false, status }
 * on a refusal. Never throws.
 */
export async function readVersions({ fetchImpl, appId, token }) {
  let res;
  try {
    res = await fetchImpl(versionsEndpoint(appId), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const items = data && Array.isArray(data.items) ? data.items : [];
  const head = items.length && items[0] && typeof items[0].sha === 'string' ? items[0].sha : undefined;
  return { ok: true, items, head };
}

/**
 * Forward-restore the artifact to `sha` (one-click rollback to the pre-run head). Returns
 * { ok:true, newHeadSha } or { ok:false, status } on a refusal. Never throws.
 */
export async function rollbackToVersion({ fetchImpl, appId, token, sha }) {
  let res;
  try {
    res = await fetchImpl(restoreEndpoint(appId, sha), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const newHeadSha = data && typeof data.newHeadSha === 'string' ? data.newHeadSha : undefined;
  return { ok: true, newHeadSha };
}

/**
 * Consume the job SSE stream with fetch, forwarding each JobEvent to `onEvent`, and
 * resolve once a terminal event lands (or the stream ends). Outcomes:
 *   - { outcome:'complete', event } - the build finished
 *   - { outcome:'error', event }    - the build failed (JobEvent error)
 *   - { outcome:'http-error', status } - the stream endpoint refused (e.g. token expired)
 *   - { outcome:'closed' }          - the stream ended / a network blip with no terminal
 *                                     event (the caller re-reads versions to see the head)
 * Never throws.
 */
export async function streamJobEvents({ fetchImpl, jobId, token, onEvent, signal }) {
  let res;
  try {
    res = await fetchImpl(jobEventsUrl(jobId, token), {
      method: 'GET',
      ...(signal ? { signal } : {}),
    });
  } catch {
    return { outcome: 'closed' };
  }
  if (!res || !res.ok) return { outcome: 'http-error', status: res ? res.status : 0 };
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') return { outcome: 'closed' };

  const reader = body.getReader();
  const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder ? decoder.decode(value, { stream: true }) : String(value || '');
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.rest;
      for (const ev of parsed.events) {
        if (onEvent) onEvent(ev);
        if (ev && ev.type === 'complete') {
          try { await reader.cancel(); } catch { /* already closing */ }
          return { outcome: 'complete', event: ev };
        }
        if (ev && ev.type === 'error') {
          try { await reader.cancel(); } catch { /* already closing */ }
          return { outcome: 'error', event: ev };
        }
      }
    }
  } catch {
    /* aborted (unmount / timeout) or read error → treated as a soft close */
  }
  return { outcome: 'closed' };
}

/**
 * Run the whole confirmed patch, front-to-back, as a sequence of the H1-gated platform
 * calls. Returns a discriminated result the panel maps straight onto its UI; every
 * network refusal is a graceful outcome, never a throw:
 *   - { outcome:'ready', preRunSha, newHeadSha } - build done; show APPROVE vs ROLLBACK
 *   - { outcome:'answered', reason }             - no job (in-build classifier answered)
 *   - { outcome:'failed', event }                - the build reported an error event
 *   - { outcome:'degraded', status }             - a mid-flow 401/403/404/... → calm msg
 *
 * `onProgress(jobEvent)` receives each streamed JobEvent (the panel narrates plan_step).
 */
export async function runEditPatch({ fetchImpl, appId, token, description, onProgress, signal }) {
  // 1. Capture the pre-run head BEFORE the build - the rollback target and diff point.
  const before = await readVersions({ fetchImpl, appId, token });
  if (!before.ok) return { outcome: 'degraded', status: before.status };
  const preRunSha = before.head;

  // 2. Start the follow-up build (the H1-gated patch run).
  const started = await startEditJob({
    fetchImpl,
    appId,
    token,
    description,
    sessionId: newEditSessionId(appId),
  });
  if (!started.ok) return { outcome: 'degraded', status: started.status };
  if (started.status === 'answered') return { outcome: 'answered', reason: started.reason };

  // 3. Stream the job SSE - live plan_step narration to onProgress.
  const stream = await streamJobEvents({
    fetchImpl,
    jobId: started.jobId,
    token,
    signal,
    onEvent: (ev) => {
      if (onProgress) onProgress(ev);
    },
  });
  if (stream.outcome === 'http-error') return { outcome: 'degraded', status: stream.status };
  if (stream.outcome === 'error') return { outcome: 'failed', event: stream.event };

  // 4. Read the new head for the preview (the versions read is the source of truth for the
  //    head; a soft close still lands here, and an unchanged head reads as "no change").
  const after = await readVersions({ fetchImpl, appId, token });
  if (!after.ok) return { outcome: 'degraded', status: after.status };
  return { outcome: 'ready', preRunSha, newHeadSha: after.head, jobId: started.jobId };
}

/** A one-line PT-PT narration for a streamed JobEvent (plan_step primarily). Returns null
 *  for events with nothing worth showing, so the panel keeps the last meaningful line. */
export function progressLine(ev) {
  if (!ev || typeof ev !== 'object') return null;
  if (ev.type === 'plan_step') {
    const text = ev.description || ev.detail || ev.status;
    return typeof text === 'string' && text ? text : null;
  }
  if (ev.type === 'routing') return 'A preparar a alteração...';
  return null;
}
