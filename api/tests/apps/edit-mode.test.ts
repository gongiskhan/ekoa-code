import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * H3 edit mode (admins only) - BEHAVIOURAL unit tests of the panel's edit-flow controller
 * (api/assets/panel-runtime/src/edit-mode.js). That controller is a browser ASSET compiled by
 * esbuild (outside the tsc program), so it is imported at RUNTIME via its file URL and driven with
 * a FAKE fetch - proving the real network flow, not just its source text:
 *   - the confirmed patch run POSTs /api/v1/jobs { kind:'build', artifactId, description } with the
 *     admin platform Bearer (a follow-up build over the H1-gated machinery - reused, not rebuilt);
 *   - the pre-run head is captured BEFORE the run (the rollback target / diff point);
 *   - rollback POSTs /api/v1/artifacts/:id/versions/:sha/restore (one click, the pre-run head);
 *   - a mid-flow 401/403/404 resolves to a calm PT-PT message (graceful degradation, never a throw);
 *   - the job SSE is parsed frame-by-frame (even split across chunk boundaries) into progress.
 * The heavy end-to-end (a REAL patch run editing a real app + rollback) is the lead's live probe;
 * here the flow is unit-proven. Every call targets the PLATFORM /api/v1/* plane with the admin
 * Bearer - a SEPARATE plane from the visitor-blind POST /api/app-assistant.
 */

// The controller is plain JS (a compiled-by-esbuild browser asset), so tsc cannot resolve it as a
// typed module; import it at runtime by URL and describe only the shape these tests exercise.
type FetchInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown };
type FetchImpl = (url: string, init?: FetchInit) => Promise<unknown>;
interface JobEvent { type: string; [k: string]: unknown }
type Sleep = (ms: number) => Promise<void>;
interface EditModeApi {
  JOBS_ENDPOINT: string;
  versionsEndpoint(appId: string): string;
  restoreEndpoint(appId: string, sha: string): string;
  jobEventsUrl(jobId: string, token: string): string;
  jobEndpoint(jobId: string): string;
  degradeMessage(status: number): string;
  parseSseBuffer(buffer: string): { events: JobEvent[]; rest: string };
  newEditSessionId(appId: string): string;
  EDIT_COPY: Record<string, string>;
  progressLine(ev: unknown): string | null;
  startEditJob(a: { fetchImpl: FetchImpl; appId: string; token: string; description: string; sessionId?: string }): Promise<{ ok: boolean; status?: number | string; jobId?: string; reason?: string }>;
  readVersions(a: { fetchImpl: FetchImpl; appId: string; token: string }): Promise<{ ok: boolean; status?: number; items?: unknown[]; head?: string }>;
  rollbackToVersion(a: { fetchImpl: FetchImpl; appId: string; token: string; sha: string }): Promise<{ ok: boolean; status?: number; newHeadSha?: string }>;
  guardedRollback(a: { fetchImpl: FetchImpl; appId: string; token: string; preRunSha?: string; expectedHeadSha?: string }): Promise<{ ok: boolean; status?: number; newHeadSha?: string; reason?: string }>;
  streamJobEvents(a: { fetchImpl: FetchImpl; jobId: string; token: string; onEvent?: (ev: JobEvent) => void; signal?: unknown }): Promise<{ outcome: string; status?: number; event?: JobEvent }>;
  pollJobUntilTerminal(a: { fetchImpl: FetchImpl; jobId: string; token: string; pollMs?: number; deadlineMs?: number; maxTransients?: number; now?: () => number; sleep?: Sleep; signal?: unknown }): Promise<{ outcome: string; status?: number | string; job?: unknown }>;
  runEditPatch(a: { fetchImpl: FetchImpl; appId: string; token: string; description: string; onProgress?: (ev: JobEvent) => void; signal?: unknown; pollMs?: number; deadlineMs?: number; now?: () => number; sleep?: Sleep }): Promise<{ outcome: string; status?: number; preRunSha?: string; newHeadSha?: string; reason?: string; job?: unknown }>;
}

/** A no-op sleep so the poll loop never waits on a real timer in tests. */
const noSleep: Sleep = async () => {};

const MODULE_URL = new URL('../../assets/panel-runtime/src/edit-mode.js', import.meta.url);
const MODULE_SRC = readFileSync(fileURLToPath(MODULE_URL), 'utf-8');

let em: EditModeApi;
beforeAll(async () => {
  em = (await import(/* @vite-ignore */ MODULE_URL.href)) as unknown as EditModeApi;
});

// --- fake-fetch harness ----------------------------------------------------------------------
interface Recorded { url: string; method: string; headers: Record<string, string>; body?: string }
const enc = new TextEncoder();

/** A minimal streaming body (getReader) that yields the given SSE frames as UTF-8 chunks. */
function sseBody(frames: string[]) {
  let i = 0;
  return {
    getReader() {
      return {
        read: async () => (i < frames.length ? { value: enc.encode(frames[i++]), done: false } : { value: undefined, done: true }),
        cancel: async () => {},
      };
    },
  };
}
function jsonRes(status: number, data: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

/**
 * A scenario fetch: records every call and answers per-endpoint. `versionsHeads` supplies the head
 * sha for successive /versions reads (runEditPatch reads twice: pre-run then post-run).
 */
function scenario(opts: {
  versionsHeads?: string[];
  versionsItems?: Array<Array<{ sha: string }>>;
  versionsStatus?: number;
  jobs?: { status: number; data?: unknown };
  jobStatus?: string[]; // successive GET /jobs/:id statuses (M1 poll); default 'completed'
  restore?: { status: number; data?: unknown };
  sseFrames?: string[];
  sseStatus?: number;
}) {
  const calls: Recorded[] = [];
  let versionsIdx = 0;
  let jobPollIdx = 0;
  const fetchImpl: FetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    if (url === em.JOBS_ENDPOINT) {
      const j = opts.jobs || { status: 202, data: { status: 'created', job: { id: 'job-1', status: 'running' } } };
      return jsonRes(j.status, j.data ?? {});
    }
    if (url.includes('/jobs/') && url.includes('/events')) {
      if (opts.sseStatus) return jsonRes(opts.sseStatus, {});
      return { ok: true, status: 200, body: sseBody(opts.sseFrames || ['data: {"type":"complete","durationMs":10}\n\n']) };
    }
    if (url.startsWith('/api/v1/jobs/')) {
      // GET /jobs/:id status poll (M1): the AUTHORITATIVE terminal signal. Successive statuses.
      const seq = opts.jobStatus || ['completed'];
      const s = seq[Math.min(jobPollIdx, seq.length - 1)];
      jobPollIdx += 1;
      return jsonRes(200, {
        id: 'job-1',
        status: s,
        ...(s === 'completed' ? { artifactId: 'app' } : {}),
        ...(s === 'failed' ? { error: { code: 'BUILD_FAILED', message: 'boom' } } : {}),
      });
    }
    if (url.includes('/versions/') && url.endsWith('/restore')) {
      const r = opts.restore || { status: 200, data: { newHeadSha: 'restored-head' } };
      return jsonRes(r.status, r.data ?? {});
    }
    if (url.endsWith('/versions')) {
      if (opts.versionsStatus) return jsonRes(opts.versionsStatus, {});
      if (opts.versionsItems) {
        const items = opts.versionsItems[Math.min(versionsIdx, opts.versionsItems.length - 1)];
        versionsIdx += 1;
        return jsonRes(200, { items });
      }
      const heads = opts.versionsHeads || ['head-a', 'head-b'];
      const head = heads[Math.min(versionsIdx, heads.length - 1)];
      versionsIdx += 1;
      return jsonRes(200, { items: [{ sha: head }, { sha: 'older-1' }] });
    }
    return jsonRes(404, {});
  };
  return { fetchImpl, calls };
}

const jobPolls = (calls: Recorded[]) => calls.filter((c) => c.url.startsWith('/api/v1/jobs/') && !c.url.includes('/events'));
const versionReads = (calls: Recorded[]) => calls.filter((c) => c.url.endsWith('/versions'));

describe('H3 edit-mode controller - endpoints + copy (the admin /api/v1/* plane)', () => {
  it('builds the platform version + restore + job-event paths (encoded)', () => {
    expect(em.JOBS_ENDPOINT).toBe('/api/v1/jobs');
    expect(em.versionsEndpoint('app 1')).toBe('/api/v1/artifacts/app%201/versions');
    expect(em.restoreEndpoint('app1', 'sha/x')).toBe('/api/v1/artifacts/app1/versions/sha%2Fx/restore');
    expect(em.jobEventsUrl('job1', 't ok')).toBe('/api/v1/jobs/job1/events?token=t%20ok');
    expect(em.jobEndpoint('job 1')).toBe('/api/v1/jobs/job%201'); // the M1 status-poll target
  });

  it('degradeMessage maps 401/403/404 to distinct calm PT-PT lines (no emoji, no em/en-dash)', () => {
    const m401 = em.degradeMessage(401);
    const m403 = em.degradeMessage(403);
    const m404 = em.degradeMessage(404);
    const mOther = em.degradeMessage(500);
    for (const m of [m401, m403, m404, mOther]) {
      expect(typeof m).toBe('string');
      expect(m.length).toBeGreaterThan(0);
      expect(m).not.toMatch(/[–—]/); // no en/em dash
      expect(m.match(/\p{Extended_Pictographic}/u)).toBeNull(); // no emoji
    }
    // 401 (expired session) and 403 (lost writability) read differently.
    expect(m401).not.toBe(m403);
    expect(m401).toMatch(/sess/i);
  });

  it('EDIT_COPY.confirm is the PT-PT confirmation step', () => {
    expect(em.EDIT_COPY.confirm).toContain('revisão');
    expect(em.EDIT_COPY.confirm).toContain('Confirma');
  });

  it('the controller source carries no emoji (UI-code rule)', () => {
    expect(MODULE_SRC.match(/\p{Extended_Pictographic}/u)).toBeNull();
  });
});

describe('H3 startEditJob - the follow-up build (POST /jobs, H1-gated)', () => {
  it('POSTs /api/v1/jobs { kind:build, artifactId, description } with the admin Bearer', async () => {
    const { fetchImpl, calls } = scenario({});
    const r = await em.startEditJob({ fetchImpl, appId: 'app-42', token: 'TKN', description: 'adicione um botão' });
    expect(r).toEqual({ ok: true, status: 'created', jobId: 'job-1' });
    const post = calls.find((c) => c.url === '/api/v1/jobs');
    expect(post).toBeTruthy();
    expect(post!.method).toBe('POST');
    expect(post!.headers.Authorization).toBe('Bearer TKN'); // the platform admin JWT
    const body = JSON.parse(post!.body || '{}');
    expect(body.kind).toBe('build'); // a build job (a follow-up edits an existing app)
    expect(body.artifactId).toBe('app-42'); // targets THIS app (server re-gates writability)
    expect(body.description).toBe('adicione um botão');
    expect(body.language).toBe('pt');
    expect(typeof body.sessionId).toBe('string'); // a correlation tag (follow-ups reserve nothing)
    expect(body.sessionId.length).toBeGreaterThan(0);
  });

  it('honours the SERVER gate: a 403/404 refusal returns ok:false + the status (front-end degrades)', async () => {
    const forbidden = scenario({ jobs: { status: 403, data: { error: { code: 'FORBIDDEN' } } } });
    expect(await em.startEditJob({ fetchImpl: forbidden.fetchImpl, appId: 'a', token: 'T', description: 'x' })).toEqual({ ok: false, status: 403 });
    const missing = scenario({ jobs: { status: 404, data: {} } });
    expect(await em.startEditJob({ fetchImpl: missing.fetchImpl, appId: 'a', token: 'T', description: 'x' })).toEqual({ ok: false, status: 404 });
  });

  it('surfaces an in-build classifier answer (no job created) as status:answered', async () => {
    const { fetchImpl } = scenario({ jobs: { status: 200, data: { status: 'answered', reason: 'question' } } });
    const r = await em.startEditJob({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
    expect(r).toEqual({ ok: true, status: 'answered', reason: 'question' });
  });
});

describe('H3 runEditPatch - the confirmed patch flow', () => {
  it('captures the pre-run head BEFORE the build, streams progress, and returns the new head for preview', async () => {
    const { fetchImpl, calls } = scenario({
      versionsHeads: ['before-sha', 'after-sha'],
      sseFrames: [
        'data: {"type":"ready","jobId":"job-1"}\n\n',
        'data: {"type":"plan_step","status":"running","description":"A editar a tabela de honorários"}\n\n',
        'data: {"type":"complete","durationMs":1200}\n\n',
      ],
    });
    const progress: string[] = [];
    const r = await em.runEditPatch({
      fetchImpl,
      appId: 'app-42',
      token: 'TKN',
      description: 'adicione um botão de exportação',
      sleep: noSleep,
      onProgress: (ev) => {
        const line = em.progressLine(ev);
        if (line) progress.push(line);
      },
    });
    expect(r.outcome).toBe('ready');
    expect(r.preRunSha).toBe('before-sha'); // the rollback target / diff point
    expect(r.newHeadSha).toBe('after-sha');
    expect(progress).toContain('A editar a tabela de honorários'); // plan_step narration surfaced
    // The JOB record was polled to a terminal status before the preview (M1): the new head reflects
    // the CONFIRMED completed build, not a mid-build snapshot.
    expect(jobPolls(calls).length).toBeGreaterThanOrEqual(1);

    // ORDER matters: the pre-run version read must happen BEFORE the POST /jobs, so the rollback
    // target is the head as it was before the patch.
    const firstVersions = calls.findIndex((c) => c.url.endsWith('/versions'));
    const jobsPost = calls.findIndex((c) => c.url === '/api/v1/jobs');
    expect(firstVersions).toBeGreaterThanOrEqual(0);
    expect(jobsPost).toBeGreaterThan(firstVersions);
  });

  it('a mid-flow 401 (expired session) on POST /jobs degrades calmly, never throws', async () => {
    const { fetchImpl } = scenario({ jobs: { status: 401, data: {} } });
    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
    expect(r).toEqual({ outcome: 'degraded', status: 401 });
    // the panel maps this straight to a calm PT-PT line
    expect(em.degradeMessage(r.status!)).toMatch(/sess/i);
  });

  it('a 403 on the pre-run versions read (lost writability) degrades calmly', async () => {
    const { fetchImpl, calls } = scenario({ versionsStatus: 403 });
    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
    expect(r).toEqual({ outcome: 'degraded', status: 403 });
    // it never reached the build: no POST /jobs was issued.
    expect(calls.some((c) => c.url === '/api/v1/jobs')).toBe(false);
  });

  it('a job that reaches terminal FAILED status resolves to outcome:failed', async () => {
    // M1: failure is AUTHORITATIVE from the job record, not the SSE. Even with an error frame on the
    // stream, the terminal decision is the polled job status.
    const { fetchImpl } = scenario({
      jobStatus: ['failed'],
      sseFrames: ['data: {"type":"error","code":"BUILD_FAILED","message":"boom"}\n\n'],
    });
    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x', sleep: noSleep });
    expect(r.outcome).toBe('failed');
  });

  it('an answered follow-up (no job) resolves to outcome:answered', async () => {
    const { fetchImpl } = scenario({ jobs: { status: 200, data: { status: 'answered', reason: 'question' } } });
    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x', sleep: noSleep });
    expect(r.outcome).toBe('answered');
  });

  // ---- M1: an SSE early-close must NOT read as "done"; the job status is the arbiter ------------
  it('M1: an SSE that closes WITHOUT a terminal event polls the job to completion (no false no-change)', async () => {
    // The stream carries progress but NO complete/error frame (a proxy/network blip). The build then
    // finishes (poll running -> completed) and activates a NEW head. runEditPatch must poll the job
    // record and only preview the CONFIRMED completed build - never treat the early close as done and
    // report the unchanged pre-run head as "no change".
    const { fetchImpl, calls } = scenario({
      sseFrames: ['data: {"type":"plan_step","status":"go","description":"a editar a tabela"}\n\n'], // no terminal
      jobStatus: ['running', 'completed'],
      versionsHeads: ['before', 'after'],
    });
    const progress: string[] = [];
    const r = await em.runEditPatch({
      fetchImpl,
      appId: 'app-42',
      token: 'TKN',
      description: 'x',
      sleep: noSleep,
      onProgress: (ev) => {
        const line = em.progressLine(ev);
        if (line) progress.push(line);
      },
    });
    expect(r.outcome).toBe('ready');
    expect(r.newHeadSha).toBe('after'); // reflects the build that completed AFTER the blip
    expect(r.preRunSha).toBe('before');
    expect(jobPolls(calls).length).toBe(2); // polled running, then completed
    expect(progress).toContain('a editar a tabela'); // progress still surfaced off the (dropped) stream
    // the post-run head read happened AFTER the job was confirmed completed
    const lastVersions = calls.map((c) => c.url).lastIndexOf('/api/v1/artifacts/app-42/versions');
    const lastJobPoll = calls.reduce((acc, c, i) => (c.url.startsWith('/api/v1/jobs/') && !c.url.includes('/events') ? i : acc), -1);
    expect(lastVersions).toBeGreaterThan(lastJobPoll);
  });

  it('M1: a build still running at the poll deadline returns pending (never a false ready/no-change)', async () => {
    const { fetchImpl, calls } = scenario({ jobStatus: ['running'], versionsHeads: ['before', 'before'] });
    let t = 1000;
    const now = () => t;
    const sleep: Sleep = async () => {
      t += 1000; // each poll interval advances the clock so the bounded deadline is reached
    };
    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x', now, sleep, deadlineMs: 50 });
    expect(r.outcome).toBe('pending');
    // it did NOT read a post-run head (no false preview): only the pre-run versions read happened.
    expect(versionReads(calls).length).toBe(1);
  });
});

describe('H3 pollJobUntilTerminal - transient-tolerant job-status poll (M1)', () => {
  it('tolerates a transient 502 / non-JSON blip, then returns the completed terminal status', async () => {
    let n = 0;
    const fetchImpl: FetchImpl = async () => {
      n += 1;
      if (n === 1) return { ok: false, status: 502, json: async () => { throw new Error('proxy error (text/plain)'); } };
      return jsonRes(200, { id: 'job-1', status: 'completed', artifactId: 'app' });
    };
    const r = await em.pollJobUntilTerminal({ fetchImpl, jobId: 'job-1', token: 'T', sleep: noSleep });
    expect(r.outcome).toBe('terminal');
    expect(r.status).toBe('completed');
  });

  it('degrades on a deterministic 401 (no endless retry masking an auth failure)', async () => {
    const fetchImpl: FetchImpl = async () => jsonRes(401, { error: { code: 'UNAUTHENTICATED' } });
    const r = await em.pollJobUntilTerminal({ fetchImpl, jobId: 'job-1', token: 'T', sleep: noSleep });
    expect(r).toMatchObject({ outcome: 'degraded', status: 401 });
  });

  it('treats a cancelled job as a terminal failure', async () => {
    const fetchImpl: FetchImpl = async () => jsonRes(200, { id: 'job-1', status: 'cancelled' });
    const r = await em.pollJobUntilTerminal({ fetchImpl, jobId: 'job-1', token: 'T', sleep: noSleep });
    expect(r).toMatchObject({ outcome: 'terminal', status: 'failed' });
  });
});

describe('H3 rollbackToVersion - one-click restore to the pre-run head', () => {
  it('POSTs /api/v1/artifacts/:id/versions/:sha/restore with the admin Bearer', async () => {
    const { fetchImpl, calls } = scenario({});
    const r = await em.rollbackToVersion({ fetchImpl, appId: 'app-42', token: 'TKN', sha: 'before-sha' });
    expect(r).toEqual({ ok: true, newHeadSha: 'restored-head' });
    const post = calls.find((c) => c.url.endsWith('/restore'));
    expect(post).toBeTruthy();
    expect(post!.url).toBe('/api/v1/artifacts/app-42/versions/before-sha/restore');
    expect(post!.method).toBe('POST');
    expect(post!.headers.Authorization).toBe('Bearer TKN');
  });

  it('a 404 on restore degrades calmly (ok:false + status)', async () => {
    const { fetchImpl } = scenario({ restore: { status: 404, data: {} } });
    const r = await em.rollbackToVersion({ fetchImpl, appId: 'a', token: 'T', sha: 's' });
    expect(r).toEqual({ ok: false, status: 404 });
  });
});

describe('H3 guardedRollback - refuse a stale rollback (M2)', () => {
  it('restores to the pre-run head ONLY when HEAD is still the head THIS edit produced', async () => {
    // Current HEAD (items[0].sha) is still 'after' (the edit head), and the pre-run target 'before'
    // is still in history -> the guarded rollback fires restore to 'before'.
    const { fetchImpl, calls } = scenario({ versionsItems: [[{ sha: 'after' }, { sha: 'before' }, { sha: 'older' }]] });
    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
    expect(r).toEqual({ ok: true, newHeadSha: 'restored-head' });
    const restore = calls.find((c) => c.url.endsWith('/restore'));
    expect(restore!.url).toBe('/api/v1/artifacts/app-42/versions/before/restore');
    expect(restore!.headers.Authorization).toBe('Bearer TKN');
  });

  it('REFUSES (no restore fired) when HEAD advanced - a concurrent change would be wiped', async () => {
    // Someone else moved HEAD to 'someone-else' between preview and the Reverter click. Restoring to
    // 'before' would silently wipe that change, so the guard refuses.
    const { fetchImpl, calls } = scenario({ versionsItems: [[{ sha: 'someone-else' }, { sha: 'after' }, { sha: 'before' }]] });
    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
    expect(r).toEqual({ ok: false, reason: 'head-advanced' });
    expect(calls.some((c) => c.url.endsWith('/restore'))).toBe(false); // NO blind restore
  });

  it('REFUSES (no restore fired) when the pre-run target sha is gone from history', async () => {
    const { fetchImpl, calls } = scenario({ versionsItems: [[{ sha: 'after' }, { sha: 'older' }]] });
    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
    expect(r).toEqual({ ok: false, reason: 'target-missing' });
    expect(calls.some((c) => c.url.endsWith('/restore'))).toBe(false);
  });

  it('degrades (ok:false + status) when the versions re-read itself is refused', async () => {
    const { fetchImpl } = scenario({ versionsStatus: 403 });
    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
    expect(r).toEqual({ ok: false, status: 403 });
  });
});

describe('H3 parseSseBuffer - job SSE frame parsing', () => {
  it('parses complete frames, ignores non-data lines, and buffers a partial trailing frame', () => {
    const buf = ': keep-alive\n\nid: 1\ndata: {"type":"ready","jobId":"j"}\n\ndata: {"type":"plan_step","status":"go"}\n\ndata: {"type":"comp';
    const { events, rest } = em.parseSseBuffer(buf);
    expect(events.map((e) => e.type)).toEqual(['ready', 'plan_step']);
    expect(rest).toContain('"type":"comp'); // the incomplete frame stays buffered
  });

  it('reassembles a frame split across two chunk reads', () => {
    const a = em.parseSseBuffer('data: {"type":"plan_');
    expect(a.events).toEqual([]);
    const b = em.parseSseBuffer(a.rest + 'step","status":"x"}\n\n');
    expect(b.events).toEqual([{ type: 'plan_step', status: 'x' }]);
  });
});
