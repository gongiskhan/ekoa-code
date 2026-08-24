import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sseManager } from '../../src/events/sse-manager.js';
import { handleBuildCreate, executeBuildJob, redispatchQueuedBuilds, type BuildCreateInput } from '../../src/agents/build.js';
import { getRun, cancelRun, liveBuildCountForUser, liveRunCount, reserveFirstBuild, __resetRegistryForTests } from '../../src/agents/registry.js';
import { sweepOrphans, type JobRecord } from '../../src/agents/jobs.js';
import { setBuildMechanics, setVerifyRunner, type BuildMechanics, type VerifyRunResult } from '../../src/agents/seams.js';
import type { Actor } from '@ekoa/shared';
import { jobs, userSettings, users, activityLogs } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from './_setup.js';

/**
 * s1 (run 20260719) per-user build cap + queued FIFO dispatch. Unit coverage of the DESIGN.md §C
 * races: 1 (over-cap admission), 2 (dispatch vs cancel-of-queued, both orders), 3 (persistJob
 * failure never leaks a slot), 4 (two same-user builds finishing at once dispatch exactly once),
 * 6 (sweep skips queued + boot re-dispatch with a vanished owner -> ORPHANED). LLM-free via the
 * fake transport + a barrier-gated fake build mechanics that holds a run inside prepareFirstBuild.
 */
const actor: Actor = { userId: 'u1', orgId: 'o1', role: 'user' };
let seq = 0;
const deps = () => ({ now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` });

// Per-session barriers: prepareFirstBuild awaits the gate for its session, so a dispatched build
// can be held mid-run (state 'executing', slot held) until the test releases it. prepareCalls
// records how many times each session's prepareFirstBuild ran — a double-dispatch shows up as 2.
const gates = new Map<string, { promise: Promise<void>; release: () => void }>();
const prepareCalls = new Map<string, number>();
function gate(sessionId: string): void {
  let release!: () => void;
  const promise = new Promise<void>((r) => { release = r; });
  gates.set(sessionId, { promise, release });
}
function releaseAllGates(): void {
  for (const g of gates.values()) g.release();
}
function queueMechanics(): BuildMechanics {
  return {
    async prepareFirstBuild(input) {
      prepareCalls.set(input.sessionId, (prepareCalls.get(input.sessionId) ?? 0) + 1);
      const g = gates.get(input.sessionId);
      if (g) await g.promise;
      return { artifactId: `art_${input.sessionId}`, projectDir: '/pd', slug: 'app', appUrl: 'http://app' };
    },
    async resolveFollowUp() { return { projectDir: '/pd', slug: 'app', appUrl: 'http://app' }; },
    async revalidateWritable() { return 'ok'; },
    async finalizeBundle() { return { ok: true }; },
    async snapshot() {},
    async watchRebuilds() {},
    screenshot() {},
    async persistSdkSessionId() {},
    async activateArtifact() {},
    async assertProgress() { return { clean: true, reasons: [] }; },
  };
}
function passVerify(): void {
  setVerifyRunner(async (): Promise<VerifyRunResult> => ({ ran: true, passed: true }));
}
function silenceSse(): void {
  vi.spyOn(sseManager, 'emit').mockImplementation(() => undefined);
}

/** Wire the fake transport + barrier mechanics + a passing verifier at the requested cap. */
function armQueue(cap: number): void {
  process.env.MAX_CONCURRENT_BUILDS_PER_USER = String(cap);
  resetAgentState({ finalText: 'built' }); // clears registry/seams/config cache -> re-reads the cap
  setBuildMechanics(queueMechanics());
  passVerify();
  silenceSse();
}

function firstBuildInput(sessionId: string): BuildCreateInput {
  return { actor, username: 'u1', sessionId, description: 'build a crm', language: 'pt', deps: deps() };
}
async function createFirst(sessionId: string): Promise<{ jobId: string; status: string; input: BuildCreateInput }> {
  const input = firstBuildInput(sessionId);
  const res = await handleBuildCreate(input);
  if (res.status !== 'created') throw new Error(`expected created, got ${res.status}`);
  return { jobId: res.job.id, status: res.job.status, input };
}
/** Execute a created build to completion (awaitable — unlike the route's fire-and-forget). */
async function execFirst(jobId: string, input: BuildCreateInput): Promise<void> {
  const entry = getRun(jobId);
  if (!entry) throw new Error(`no live entry for ${jobId}`);
  await executeBuildJob(jobId, input, entry.abort, { firstBuild: true });
}
async function statusOf(jobId: string): Promise<string | undefined> {
  return ((await jobs.get(jobId)) as unknown as { status?: string } | null)?.status;
}
async function waitStatus(jobId: string, want: string, ms = 2000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if ((await statusOf(jobId)) === want) return;
    if (Date.now() - t0 > ms) throw new Error(`job ${jobId} never reached ${want} (last: ${await statusOf(jobId)})`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 40));

describe('s1 per-user build cap + queued FIFO dispatch (§C races)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_build_queue'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); });
  afterEach(async () => {
    releaseAllGates();
    await settle();
    gates.clear();
    prepareCalls.clear();
    delete process.env.MAX_CONCURRENT_BUILDS_PER_USER;
    vi.restoreAllMocks();
    restoreTransport();
    __resetRegistryForTests();
    await jobs.deleteMany({});
    await userSettings.deleteMany({});
    await users.deleteMany({});
  });

  it('race 1: two interleaved creates at cap 1 -> exactly one executing, one queued (synchronous commit)', async () => {
    armQueue(1);
    // Concurrent creates for the SAME user, different sessions. The commit block has no await
    // between the count and the state assignment, so the second cannot also pass the cap.
    const [a, b] = await Promise.all([createFirst('s1'), createFirst('s2')]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['created', 'queued']); // one executing (record 'created'), one queued
    expect(liveBuildCountForUser('u1')).toBe(1); // exactly one holds an execution slot
    // The queued record persisted as 'queued'; the executing one as 'created'.
    const queuedId = a.status === 'queued' ? a.jobId : b.jobId;
    expect(await statusOf(queuedId)).toBe('queued');
  });

  it('race 1b: a queued create persists its reconstruction inputs (attachments) only when queued', async () => {
    armQueue(1);
    await createFirst('s1'); // executing, holds the only slot
    const input: BuildCreateInput = { actor, username: 'u1', sessionId: 's2', description: 'x', language: 'pt', attachments: [{ uploadId: 'up1' }], deps: deps() };
    const res = await handleBuildCreate(input);
    const jobId = res.status === 'created' ? res.job.id : '';
    expect(res.status === 'created' && res.job.status).toBe('queued');
    const rec = (await jobs.get(jobId)) as unknown as JobRecord;
    expect(rec.request.attachments).toEqual([{ uploadId: 'up1' }]); // persisted for boot re-dispatch
  });

  it('race 2A: cancel-of-queued lands before the freeing dispatch -> cancelled, never dispatched', async () => {
    armQueue(1);
    const a = await createFirst('s1'); // executing
    const b = await createFirst('s2'); // queued
    expect(b.status).toBe('queued');

    expect(cancelRun(b.jobId, actor)).toEqual({ cancelled: true });
    await waitStatus(b.jobId, 'cancelled');
    expect(getRun(b.jobId)).toBeUndefined(); // finalized + removed

    // Freeing the executing build's slot must NOT resurrect the cancelled queued build.
    await execFirst(a.jobId, a.input);
    await settle();
    expect(await statusOf(b.jobId)).toBe('cancelled');
    expect(prepareCalls.get('s2') ?? 0).toBe(0); // executeBuildJob for s2 never ran
  });

  it('race 2B: the freeing dispatch wins the race -> the build runs, then a cancel takes the running path', async () => {
    armQueue(1);
    const a = await createFirst('s1'); // executing
    const b = await createFirst('s2'); // queued
    gate('s2'); // hold s2 inside prepareFirstBuild once dispatched

    await execFirst(a.jobId, a.input); // frees the slot -> dispatches s2
    await waitStatus(b.jobId, 'running'); // s2 was dispatched (patched running before the gate)
    expect(getRun(b.jobId)?.state).toBe('executing');
    expect(prepareCalls.get('s2')).toBe(1); // dispatched exactly once

    // Cancel now goes through the normal running-cancel path (the queued-cancel listener no-ops).
    expect(cancelRun(b.jobId, actor)).toEqual({ cancelled: true });
    gates.get('s2')!.release();
    await waitStatus(b.jobId, 'cancelled');
    expect(prepareCalls.get('s2')).toBe(1); // still exactly one execution
  });

  it('race 3: a persistJob failure after the commitment releases the slot + reservation (no leak)', async () => {
    armQueue(2);
    vi.spyOn(jobs, 'put').mockRejectedValueOnce(new Error('db down'));
    await expect(handleBuildCreate(firstBuildInput('s1'))).rejects.toThrow('db down');
    expect(liveBuildCountForUser('u1')).toBe(0); // the committed slot was released
    expect(liveRunCount()).toBe(0); // the run entry was removed
    expect(reserveFirstBuild('s1', 1).ok).toBe(true); // the first-build reservation was freed
  });

  it('race 4: two same-user builds finishing simultaneously dispatch both queued builds exactly once', async () => {
    armQueue(2);
    const a = await createFirst('s1'); // executing
    const b = await createFirst('s2'); // executing
    const c = await createFirst('s3'); // queued
    const d = await createFirst('s4'); // queued
    expect([c.status, d.status]).toEqual(['queued', 'queued']);
    expect(liveBuildCountForUser('u1')).toBe(2);

    gate('s3'); // hold the two queued builds mid-run so we can count their dispatches
    gate('s4');
    // Finish the two executing builds "simultaneously": start both, then await together. Each
    // finally calls tryDispatchUser; the synchronous FIFO loop must dispatch s3 and s4 once each.
    const e1 = execFirst(a.jobId, a.input);
    const e2 = execFirst(b.jobId, b.input);
    await Promise.all([e1, e2]);

    // Both queued builds are dispatched (patched running, then held at their gate). Wait for each
    // to reach the gate, then settle: a double-dispatch would push prepareCalls past 1.
    await waitStatus(c.jobId, 'running');
    await waitStatus(d.jobId, 'running');
    await settle();
    expect(prepareCalls.get('s3')).toBe(1);
    expect(prepareCalls.get('s4')).toBe(1);
    expect(liveBuildCountForUser('u1')).toBe(2); // the two dispatched builds now hold the slots
  });

  it('race 6: sweepOrphans skips queued jobs, then redispatchQueuedBuilds runs them (vanished owner -> ORPHANED)', async () => {
    armQueue(2);
    const now = () => 1_700_000_100_000;
    // A running orphan (swept), a queued job for a live user, a queued job for a vanished user.
    await jobs.put({ _id: 'j-run', kind: 'build', status: 'running', userId: 'u1', createdAt: '2026-07-19T00:00:00.000Z' } as unknown as JobRecord);
    await jobs.put({ _id: 'j-queued', kind: 'build', status: 'queued', userId: 'u1', sessionId: 'sQ', request: { description: 'build', language: 'pt' }, createdAt: '2026-07-19T00:00:01.000Z' } as unknown as JobRecord);
    await jobs.put({ _id: 'j-ghost', kind: 'build', status: 'queued', userId: 'ghost', sessionId: 'sG', request: { description: 'build', language: 'pt' }, createdAt: '2026-07-19T00:00:02.000Z' } as unknown as JobRecord);

    const swept = await sweepOrphans(now);
    expect(swept.jobs).toBe(1); // only j-run
    expect(await statusOf('j-run')).toBe('failed');
    expect(await statusOf('j-queued')).toBe('queued'); // untouched
    expect(await statusOf('j-ghost')).toBe('queued'); // untouched

    const result = await redispatchQueuedBuilds(deps());
    expect(result).toEqual({ redispatched: 1, orphaned: 1 });
    // The vanished owner's queued job fails ORPHANED; it can never be attributed/billed.
    expect(await statusOf('j-ghost')).toBe('failed');
    const ghost = (await jobs.get('j-ghost')) as unknown as { error?: { code: string } };
    expect(ghost.error?.code).toBe('ORPHANED');
    // The live user's queued job is dispatched and runs to completion via the fake transport.
    await waitStatus('j-queued', 'completed');
  });

  it('artifact-409 preserved: a QUEUED follow-up on artifact X blocks another follow-up on X', async () => {
    armQueue(1);
    await createFirst('s1'); // first build executing, holds the only slot
    // A follow-up on artX for the same at-cap user: classified 'modification', commits 'queued'.
    const fu = await handleBuildCreate({ actor, username: 'u1', sessionId: 's2', description: 'change it', language: 'pt', artifactId: 'artX', deps: deps() });
    expect(fu.status === 'created' && fu.job.status).toBe('queued');
    // The queued follow-up is still a live job for artX (hasLiveJobForArtifact keys on !finalized),
    // so a second follow-up on the SAME artifact is refused 409 (conflict), never a rival resume.
    const dup = await handleBuildCreate({ actor, username: 'u1', sessionId: 's3', description: 'change again', language: 'pt', artifactId: 'artX', deps: deps() });
    expect(dup.status).toBe('conflict');
  });

  it('review #1: a persist failure dispatches a build queued during the persist window', async () => {
    armQueue(1);
    // First put (the executing build B) blocks until we reject it; every later put is real.
    let rejectFirst!: (e: Error) => void;
    const firstPut = new Promise<never>((_, rej) => { rejectFirst = rej; });
    const realPut = jobs.put.bind(jobs);
    let calls = 0;
    vi.spyOn(jobs, 'put').mockImplementation(async (doc) => {
      calls += 1;
      if (calls === 1) await firstPut; // B's persist hangs, then rejects
      return realPut(doc);
    });
    gate('s2'); // hold C once dispatched so we can observe it
    const bPromise = handleBuildCreate(firstBuildInput('s1')); // commits 'executing', persist pending
    await settle();
    const c = await createFirst('s2'); // queued behind B's committed slot
    expect(c.status).toBe('queued');
    rejectFirst(new Error('db down'));
    await expect(bPromise).rejects.toThrow('db down');
    // The freed slot must pull C - no other terminal transition for this user will ever come.
    await waitStatus(c.jobId, 'running');
    expect(prepareCalls.get('s2')).toBe(1);
  });

  it('review #2+#8: an expired reservation with a live queued build re-binds (and reports queued), never a rival', async () => {
    armQueue(1);
    await createFirst('s1'); // executing, holds the only slot
    const q = await createFirst('s2'); // queued first build in session s2
    expect(q.status).toBe('queued');
    // A duplicate POST for s2 AFTER the 45-min reservation TTL: must bind to the queued job
    // (no rival first build) and report its real 'queued' state, not 'running'.
    const lateDeps = { now: () => 1_700_000_000_000 + 3_000_000, genId: () => `late_${seq++}` };
    const res = await handleBuildCreate({ actor, username: 'u1', sessionId: 's2', description: 'dup', language: 'pt', deps: lateDeps });
    expect(res.status).toBe('created');
    if (res.status === 'created') {
      expect(res.job.id).toBe(q.jobId);
      expect(res.job.status).toBe('queued');
    }
    expect(liveBuildCountForUser('u1')).toBe(1); // still exactly one slot held; no rival registered
  });

  it('review #7: cancelling a queued build writes the terminal Registo row', async () => {
    armQueue(1);
    await activityLogs.deleteMany({}); // earlier tests' cancel rows would inflate the count
    await createFirst('s1'); // executing
    const b = await createFirst('s2'); // queued
    expect(cancelRun(b.jobId, actor)).toEqual({ cancelled: true });
    await waitStatus(b.jobId, 'cancelled');
    await settle(); // audit is fire-and-forget
    const rows = await activityLogs.find({ category: 'build', type: 'cancelled' });
    expect(rows.length).toBe(1);
    await activityLogs.deleteMany({});
  });

  it('review #9: a patchJob rejection during queued-cancel still frees the slot and reservation', async () => {
    armQueue(1);
    const a = await createFirst('s1'); // executing
    const b = await createFirst('s2'); // queued
    vi.spyOn(jobs, 'update').mockRejectedValueOnce(new Error('db down')); // patchJob path
    expect(cancelRun(b.jobId, actor)).toEqual({ cancelled: true });
    await settle();
    expect(getRun(b.jobId)).toBeUndefined(); // entry released despite the patch failure
    expect(reserveFirstBuild('s2', 1_700_000_000_000).ok).toBe(true); // reservation freed
    // The executing build is unaffected.
    expect(getRun(a.jobId)?.state).toBe('executing');
  });

  it('different users never share slots: a second user builds immediately while the first is at cap', async () => {
    armQueue(1);
    await createFirst('s1'); // u1 executing, at cap 1
    await seedUser('u2', 'o2');
    const input: BuildCreateInput = { actor: { userId: 'u2', orgId: 'o2', role: 'user' }, username: 'u2', sessionId: 's2', description: 'x', language: 'pt', deps: deps() };
    const res = await handleBuildCreate(input);
    expect(res.status === 'created' && res.job.status).toBe('created'); // NOT queued: u2's own slot
    expect(liveBuildCountForUser('u2')).toBe(1);
  });
});
