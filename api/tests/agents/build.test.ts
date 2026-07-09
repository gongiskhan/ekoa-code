import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sseManager } from '../../src/events/sse-manager.js';
import { handleBuildCreate, executeBuildJob, type BuildCreateInput } from '../../src/agents/build.js';
import { registerRun, getRun, liveRunCount } from '../../src/agents/registry.js';
import { persistJob, type JobRecord } from '../../src/agents/jobs.js';
import { setBuildMechanics, setVerifyRunner, type BuildMechanics, type VerifyRunResult } from '../../src/agents/seams.js';
import { jobs, userSettings } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from './_setup.js';
import type { FakeTransport, FakeTransportScript } from './_fake-transport.js';

/**
 * Build jobs (ch05 §5.6.2). Acceptance criteria 1 (409, reservation, aborted-classifier bail),
 * 4 (session resume persist-only-when-changed), 5 (build tool surface), and the per-build
 * verification stage (§5.6.2 step 5).
 */
const actor = { userId: 'u1', orgId: 'o1', role: 'builder' as const };
let seq = 0;
const deps = () => ({ now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` });

function fakeMechanics(over: Partial<BuildMechanics> = {}): { mech: BuildMechanics; calls: { persistSdkSessionId: Array<[string, string]>; activate: number } } {
  const calls = { persistSdkSessionId: [] as Array<[string, string]>, activate: 0 };
  const mech: BuildMechanics = {
    async prepareFirstBuild() { return { artifactId: 'artNew', projectDir: '/pd', slug: 'my-app', appUrl: 'http://app' }; },
    async resolveFollowUp() { return { projectDir: '/pd', resumeSessionId: 'old-sess' }; },
    async finalizeBundle() { return { ok: true }; },
    async snapshot() {},
    screenshot() {},
    async persistSdkSessionId(id, sid) { calls.persistSdkSessionId.push([id, sid]); },
    async activateArtifact() { calls.activate++; },
    async assertProgress() { return { clean: true, reasons: [] }; },
    ...over,
  };
  return { mech, calls };
}

function startEvents(): { events: Array<{ stream: string; type: string; data: unknown }> } {
  const events: Array<{ stream: string; type: string; data: unknown }> = [];
  vi.spyOn(sseManager, 'emit').mockImplementation((stream, _id, type, data) => { events.push({ stream, type, data }); });
  return { events };
}

async function execFirstBuild(t: FakeTransport, mech: BuildMechanics, input: BuildCreateInput): Promise<string> {
  const jobId = 'job-exec';
  const abort = new AbortController();
  registerRun({ id: jobId, ownerUserId: input.actor.userId, orgId: input.actor.orgId, kind: 'build', abort, startedAt: 0, sessionId: input.sessionId });
  await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: input.actor.userId, sessionId: input.sessionId, request: { description: input.description, language: 'pt' }, createdAt: 'x' } as JobRecord);
  setBuildMechanics(mech);
  await executeBuildJob(jobId, input, abort, { firstBuild: true });
  void t;
  return jobId;
}

describe('build create guards (§5.3)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_build'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); });
  afterEach(async () => { vi.restoreAllMocks(); restoreTransport(); await jobs.deleteMany({}); await userSettings.deleteMany({}); });

  it('rejects a concurrent follow-up on the same artifact with conflict → 409 (§5.3.5)', async () => {
    resetAgentState({});
    registerRun({ id: 'live', ownerUserId: 'u1', kind: 'build', abort: new AbortController(), startedAt: 0, artifactId: 'artBusy' });
    const res = await handleBuildCreate({ actor, username: 'u1', sessionId: 's1', description: 'change it', language: 'pt', artifactId: 'artBusy', deps: deps() });
    expect(res.status).toBe('conflict');
  });

  it('a second first-build for the same session binds to the running job (§5.3.3)', async () => {
    resetAgentState({});
    const d = deps();
    const first = await handleBuildCreate({ actor, username: 'u1', sessionId: 'sessDup', description: 'build a crm', language: 'pt', deps: d });
    expect(first.status).toBe('created');
    const firstId = first.status === 'created' ? first.job.id : '';
    const second = await handleBuildCreate({ actor, username: 'u1', sessionId: 'sessDup', description: 'build a crm', language: 'pt', deps: d });
    expect(second.status).toBe('created');
    expect(second.status === 'created' && second.job.id).toBe(firstId); // bound to the existing job
  });

  it('an aborted in-build classifier bails: NO job created, NO side effects (§5.3.2)', async () => {
    resetAgentState({ messagesThrow: 'abort' });
    const before = liveRunCount();
    const res = await handleBuildCreate({ actor, username: 'u1', sessionId: 's9', description: 'tweak', language: 'pt', artifactId: 'artA', deps: deps() });
    expect(res.status).toBe('answered'); // no job
    expect((await jobs.find({}))).toHaveLength(0);
    expect(liveRunCount()).toBe(before); // the run was removed — no leak
  });
});

describe('build execution (§5.4, §5.6.2)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_build_exec'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); });
  afterEach(async () => { vi.restoreAllMocks(); restoreTransport(); await jobs.deleteMany({}); await userSettings.deleteMany({}); });

  it('a timeout firing BEFORE the stream (early abort checkpoint) fails the job with TIMEOUT, never a silent cancel (§5.3.6 — G7B review find)', async () => {
    resetAgentState({ finalText: 'late' });
    startEvents();
    const { mech } = fakeMechanics();
    const jobId = 'job-timeout-early';
    const abort = new AbortController();
    const entry = registerRun({ id: jobId, ownerUserId: 'u1', orgId: 'o1', kind: 'build', abort, startedAt: 0, sessionId: 's1' });
    await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: 'u1', sessionId: 's1', request: { description: 'x', language: 'pt' }, createdAt: 'x' } as JobRecord);
    setBuildMechanics(mech);
    entry.timedOut = true; // the §5.3.6 timer fired during an early await (deterministic simulation)
    abort.abort();
    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'x', language: 'pt', deps: deps() }, abort, { firstBuild: true });
    const job = (await jobs.get(jobId)) as JobRecord & { error?: { code: string } };
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('TIMEOUT');
  });

  it('a build run gets the coding preset and HOME = projectDir (§5.4.1, §5.4.4)', async () => {
    const t = resetAgentState({ finalText: 'built' });
    startEvents();
    const { mech } = fakeMechanics();
    await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build a dashboard', language: 'pt', deps: deps() });
    const call = t.streamCalls[0]!;
    expect(call.allowedTools).toEqual(expect.arrayContaining(['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']));
    expect(call.env.HOME).toBe('/pd');
    // §5.4.4 build row: the knowledge tools + the context-loading tool mount as in-process MCP,
    // and the allowlist carries their translated wire names alongside the untouched built-ins.
    expect((call.sdkTools ?? []).map((s) => s.name)).toEqual(['knowledge_search', 'knowledge_read', 'load_context']);
    expect(call.allowedTools).toEqual(
      expect.arrayContaining(['mcp__ekoa__knowledge_search', 'mcp__ekoa__knowledge_read', 'mcp__ekoa__load_context']),
    );
    expect(call.allowedTools).not.toContain('knowledge_search'); // the plain name is translated, not duplicated
  });

  it('persists a CHANGED sdkSessionId but not an unchanged one (§5.4.5)', async () => {
    // Changed: resume 'old-sess', SDK reports 'new-sess'.
    let t = resetAgentState({ finalText: 'ok', stream: [{ kind: 'session', sessionId: 'new-sess' }] });
    startEvents();
    let fm = fakeMechanics();
    const jobId = 'job-resume';
    const abort = new AbortController();
    registerRun({ id: jobId, ownerUserId: 'u1', kind: 'build', abort, startedAt: 0, artifactId: 'artF', sessionId: 's1' });
    await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: 'u1', artifactId: 'artF', request: { description: 'x', language: 'pt' }, createdAt: 'x' } as JobRecord);
    setBuildMechanics(fm.mech);
    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'change', language: 'pt', artifactId: 'artF', deps: deps() }, abort, { firstBuild: false, artifactId: 'artF' });
    expect(fm.calls.persistSdkSessionId).toEqual([['artF', 'new-sess']]);

    // Unchanged: SDK reports the same id it resumed with → NOT persisted.
    t = resetAgentState({ finalText: 'ok', stream: [{ kind: 'session', sessionId: 'old-sess' }] });
    startEvents();
    fm = fakeMechanics();
    const jobId2 = 'job-resume2';
    const abort2 = new AbortController();
    registerRun({ id: jobId2, ownerUserId: 'u1', kind: 'build', abort: abort2, startedAt: 0, artifactId: 'artF2', sessionId: 's1' });
    await persistJob({ _id: jobId2, kind: 'build', status: 'created', userId: 'u1', artifactId: 'artF2', request: { description: 'x', language: 'pt' }, createdAt: 'x' } as JobRecord);
    setBuildMechanics(fm.mech);
    await executeBuildJob(jobId2, { actor, username: 'u1', sessionId: 's1', description: 'change', language: 'pt', artifactId: 'artF2', deps: deps() }, abort2, { firstBuild: false, artifactId: 'artF2' });
    expect(fm.calls.persistSdkSessionId).toEqual([]);
    void t;
  });

  it('a genuine ran+failed verification GATES completion: full-depth on a first build, the request threaded to the runner, failure a distinct terminal (F28)', async () => {
    // REWRITTEN for F28: this test previously asserted the BUGGY behavior — a ran+failed verify
    // verdict still completed the build with a note (verification theater: the gate that exists
    // to catch a scaffold serving as the app never gated anything). Now a real ran+failed is a
    // distinct non-success terminal, and the runner receives the user's request so it can assert
    // request-fulfilment rather than mere rendering.
    const t = resetAgentState({ finalText: 'built' });
    const { events } = startEvents();
    const inputs: Array<{ depth: string; request: string }> = [];
    setVerifyRunner(async (i): Promise<VerifyRunResult> => { inputs.push({ depth: i.depth, request: i.request }); return { ran: true, passed: false, note: 'Formulário não submete.' }; });
    const { mech, calls } = fakeMechanics();
    const jobId = await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build a form', language: 'pt', deps: deps() });

    expect(inputs).toEqual([{ depth: 'full', request: 'build a form' }]);
    const job = (await jobs.get(jobId)) as unknown as { status: string; error?: { code: string; message?: string } };
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('VERIFY_FAILED');
    expect(job.error?.message).toContain('Formulário não submete.');
    // the failure surfaces as the terminal event — never a clean complete over a failed verify
    expect(events.find((e) => e.stream === 'job' && e.type === 'complete')).toBeUndefined();
    const errEv = events.find((e) => e.stream === 'job' && e.type === 'error');
    expect(JSON.stringify(errEv!.data)).toContain('VERIFY_FAILED');
    expect(calls.activate).toBe(0); // a verify-failed build is not activated
  });

  it('F28 alone catches a scaffold build: honest-completion gate clean, verify ran+failed still gates completion', async () => {
    const t = resetAgentState({ finalText: 'built' });
    startEvents();
    // assertProgress reports clean (F16 disabled-equivalent) — the verify gate must catch it alone.
    setVerifyRunner(async (): Promise<VerifyRunResult> => ({ ran: true, passed: false, note: 'A página servida ainda é o modelo Ekoa.' }));
    const { mech } = fakeMechanics();
    const jobId = await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build a tracker', language: 'pt', deps: deps() });
    const job = (await jobs.get(jobId)) as unknown as { status: string; error?: { code: string } };
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('VERIFY_FAILED');
  });

  it('an honest not-run (e.g. credential-skip) COMPLETES the build with the note surfaced, never fails it', async () => {
    const t = resetAgentState({ finalText: 'built' });
    const { events } = startEvents();
    // A not-run: ran:false, passed:false, note present (the verify-runner's credential-skip shape).
    setVerifyRunner(async (): Promise<VerifyRunResult> => ({ ran: false, passed: false, note: 'verification skipped: model credential unavailable' }));
    const { mech } = fakeMechanics();
    const jobId = await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build a thing', language: 'pt', deps: deps() });
    // The build COMPLETES (a not-run is not a failure) ...
    expect(((await jobs.get(jobId)) as unknown as { status: string }).status).toBe('completed');
    // ... and the honest note is surfaced on the complete event (not silently "clean").
    const complete = events.find((e) => e.stream === 'job' && e.type === 'complete');
    expect((complete!.data as { result?: string }).result).toContain('credential unavailable');
  });

  it('skips verification entirely when the user setting build.verifyBuilds is off', async () => {
    await userSettings.put({ _id: 'u1', build: { verifyBuilds: false } });
    const t = resetAgentState({ finalText: 'built' });
    startEvents();
    let called = false;
    setVerifyRunner(async () => { called = true; return { ran: true, passed: true }; });
    const { mech } = fakeMechanics();
    await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build', language: 'pt', deps: deps() });
    expect(called).toBe(false);
  });

  it('completes the job and activates the artifact (§5.6.2 steps 6-7)', async () => {
    const t = resetAgentState({ finalText: 'built' });
    startEvents();
    const { mech, calls } = fakeMechanics();
    const jobId = await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build', language: 'pt', deps: deps() });
    expect(((await jobs.get(jobId)) as unknown as { status: string }).status).toBe('completed');
    expect(calls.activate).toBe(1);
  });
});

describe('honest-completion gate (F16, §5.6.2 step 5a) — a scaffold build never cleanly completes', () => {
  beforeAll(() => bootAgentTestDb('ekoa_build_f16'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); });
  afterEach(async () => { vi.restoreAllMocks(); restoreTransport(); await jobs.deleteMany({}); await userSettings.deleteMany({}); });

  it('a build whose entrypoint is untouched / dist scaffold-fingerprinted FAILS with a distinct terminal, even with verification passing (F16 alone catches it)', async () => {
    const t = resetAgentState({ finalText: 'created pessoa.html with the app' });
    const { events } = startEvents();
    // Verification (F28's gate) PASSES — proving the honest-completion gate alone catches the miss.
    setVerifyRunner(async (): Promise<VerifyRunResult> => ({ ran: true, passed: true }));
    const { mech, calls } = fakeMechanics({
      async assertProgress() {
        return { clean: false, reasons: ['frontend/src inalterado desde o modelo inicial', 'dist/bundle.js ainda é o modelo Ekoa', 'ficheiro solto pessoa.html na raiz'] };
      },
    });
    const jobId = await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build a pessoa manager', language: 'pt', deps: deps() });

    const job = (await jobs.get(jobId)) as unknown as { status: string; error?: { code: string; message?: string } };
    expect(job.status).not.toBe('completed'); // never a clean completed over a scaffold
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('BUILD_UNFULFILLED');
    // the failure surfaces to the user as the terminal event — not a complete
    expect(events.find((e) => e.stream === 'job' && e.type === 'complete')).toBeUndefined();
    const errEv = events.find((e) => e.stream === 'job' && e.type === 'error');
    expect(errEv).toBeTruthy();
    expect(JSON.stringify(errEv!.data)).toContain('BUILD_UNFULFILLED');
    // a gate-failed build is not activated as the served app
    expect(calls.activate).toBe(0);
  });

  it('a build that really edited the entrypoint (assertProgress clean) still completes (positive case)', async () => {
    const t = resetAgentState({ finalText: 'edited App.jsx' });
    startEvents();
    setVerifyRunner(async (): Promise<VerifyRunResult> => ({ ran: true, passed: true }));
    const { mech, calls } = fakeMechanics(); // default assertProgress: clean
    const jobId = await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build a form', language: 'pt', deps: deps() });
    expect(((await jobs.get(jobId)) as unknown as { status: string }).status).toBe('completed');
    expect(calls.activate).toBe(1);
  });

  it('the build agent is steered: runAgent carries a system prompt naming the manifest entrypoint and forbidding standalone top-level HTML', async () => {
    const t = resetAgentState({ finalText: 'built' });
    startEvents();
    setVerifyRunner(async (): Promise<VerifyRunResult> => ({ ran: true, passed: true }));
    const { mech } = fakeMechanics();
    await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build a tracker', language: 'pt', deps: deps() });
    const call = t.streamCalls[0]!;
    expect(call.systemPrompt).toBeTruthy();
    expect(call.systemPrompt).toContain('frontend/src/App.jsx');
    expect(call.systemPrompt!.toLowerCase()).toContain('html');
  });
});
