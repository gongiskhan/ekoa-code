import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sseManager } from '../../src/events/sse-manager.js';
import { handleBuildCreate, executeBuildJob, buildProgressLine, type BuildCreateInput } from '../../src/agents/build.js';
import { registerRun, liveRunCount } from '../../src/agents/registry.js';
import { persistJob, type JobRecord } from '../../src/agents/jobs.js';
import { setBuildMechanics, setVerifyRunner, setIngestBuildKnowledge, __resetAgentSeamsForTests, type BuildMechanics, type VerifyRunResult, type BuildKnowledgeDoc } from '../../src/agents/seams.js';
import type { Actor } from '@ekoa/shared';
import { jobs, userSettings, activityLogs } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from './_setup.js';
import { makeFakeTransport } from './_fake-transport.js';
import { __setTransportForTests } from '../../src/llm/client.js';
import { __resetAgentsConfigForTests } from '../../src/config.js';
import type { FakeTransport } from './_fake-transport.js';
import { awaitPendingBuildSummary, __resetBuildSummaryChainsForTests } from '../../src/agents/build-summary.js';

/**
 * Build jobs (ch05 §5.6.2). Acceptance criteria 1 (409, reservation, aborted-classifier bail),
 * 4 (session resume persist-only-when-changed), 5 (build tool surface), and the per-build
 * verification stage (§5.6.2 step 5).
 */
const actor = { userId: 'u1', orgId: 'o1', role: 'user' as const };
let seq = 0;
const deps = () => ({ now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` });

function fakeMechanics(over: Partial<BuildMechanics> = {}): { mech: BuildMechanics; calls: { persistBuildSummary: Array<[string, string]>; activate: number } } {
  const calls = { persistBuildSummary: [] as Array<[string, string]>, activate: 0 };
  const mech: BuildMechanics = {
    async prepareFirstBuild() { return { artifactId: 'artNew', projectDir: '/pd', slug: 'my-app', appUrl: 'http://app' }; },
    // Token-economics port: a follow-up resolves the running summary (no `resumeSessionId`). Default
    // returns none — the follow-up then uses the legacy conversation tail; override to inject one.
    async resolveFollowUp() { return { projectDir: '/pd', slug: 'my-app', appUrl: 'http://app' }; },
    async revalidateWritable() { return 'ok'; }, // TOCTOU re-check: writable by default (H1 MEDIUM)
    async finalizeBundle() { return { ok: true }; },
    async snapshot() {},
    async watchRebuilds() {},
    screenshot() {},
    async persistBuildSummary(id, summary) { calls.persistBuildSummary.push([id, summary]); },
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
    // §5.4.4 build row: the knowledge tools + the context-loading tool + the §5.4.8 delegation
    // tool + the three 2C-S5 ekoa-docx tools mount as in-process MCP, and the allowlist carries
    // their translated wire names alongside the untouched built-ins.
    expect((call.sdkTools ?? []).map((s) => s.name)).toEqual([
      'knowledge_search', 'knowledge_read', 'load_context', 'delegate_to_local',
      'docx_read', 'docx_source_set', 'docx_apply_edits',
    ]);
    expect(call.allowedTools).toEqual(
      expect.arrayContaining([
        'mcp__ekoa__knowledge_search', 'mcp__ekoa__knowledge_read', 'mcp__ekoa__load_context', 'mcp__ekoa__delegate_to_local',
        'mcp__ekoa__docx_read', 'mcp__ekoa__docx_source_set', 'mcp__ekoa__docx_apply_edits',
      ]),
    );
    expect(call.allowedTools).not.toContain('knowledge_search'); // the plain name is translated, not duplicated
  });

  it('a BASIC first build routes on the EXPERT tier (opus, high effort) — the ambition classifier gates the frontier floor (2026-08-14)', async () => {
    // Classifier answer 'basic' (also the committed fallback for an empty/garbage answer).
    const t = resetAgentState({ finalText: 'built', oneShotText: 'basic' });
    startEvents();
    const { mech } = fakeMechanics();
    const jobId = await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build a dashboard', language: 'pt', deps: deps() });
    const call = t.streamCalls[0]!;
    expect(call.model).toBe('claude-opus-5');
    expect(call.effort).toBe('high');
    // The impeccable design skill rides as an Agent SDK local plugin (settingSources stays [] — FIXED-6).
    expect(call.plugins?.some((p) => p.endsWith('content/plugins/impeccable'))).toBe(true);
    const job = (await jobs.get(jobId)) as JobRecord & { routing?: { tier: string; reason?: string } };
    expect(job.routing?.tier).toBe('EXPERT');
    expect(job.routing?.reason).toBe('first build (basic)');
  });

  it('an AMBITIOUS first build keeps the GENIUS frontier floor (claude-fable-5, high effort) and mounts the design-skill plugin (2026-08-07 directive, effort re-set 2026-08-14)', async () => {
    const t = resetAgentState({ finalText: 'built', oneShotText: 'ambitious' });
    startEvents();
    const { mech } = fakeMechanics();
    const jobId = await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build a premium marketing landing page', language: 'pt', deps: deps() });
    const call = t.streamCalls[0]!;
    expect(call.model).toBe('claude-fable-5');
    expect(call.effort).toBe('high');
    expect(call.plugins?.some((p) => p.endsWith('content/plugins/impeccable'))).toBe(true);
    const job = (await jobs.get(jobId)) as JobRecord & { routing?: { tier: string; reason?: string } };
    expect(job.routing?.tier).toBe('GENIUS');
    expect(job.routing?.reason).toBe('first build (ambitious)');
  });

  // Cost + quality guardrails on the build run (operator directive 2026-08-10, after a live site
  // build spent 142 turns / ~15M tokens / 34 min and auto-compacted mid-run, on a dark "atrium"
  // world the concept-seed roll assigned against the prompt's own light-background house style).
  it('does NOT order the concept-seed / new-work flow, states the craft floor inline, and bans subagents', async () => {
    const t = resetAgentState({ finalText: 'built' });
    startEvents();
    const { mech } = fakeMechanics();
    await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'um site sobre as apps', language: 'pt', deps: deps() });
    const call = t.streamCalls[0]!;
    const prompt = String(call.systemPrompt ?? '');

    // The roll is what assigned the world; the flow is what loaded 315 KB of reference docs.
    expect(prompt).toMatch(/Do NOT run impeccable's new-work flow or its concept-seed roll/);
    expect(prompt).not.toMatch(/build the direction it assigns/);

    // What replaced it: the craft floor + anti-slop defaults stated in the prompt itself.
    expect(prompt).toMatch(/Craft floor/);
    expect(prompt).toMatch(/4\.5:1/);
    expect(prompt).toMatch(/kicker\/eyebrow/);
    expect(prompt).toMatch(/Work in few, large steps/);

    // A build subagent re-pays the whole context; the run is single-agent.
    expect(call.allowedTools).toContain('Write');
    expect(call.allowedTools).not.toContain('Agent');
  });

  it('narrates real progress from tool events, deduped, and stays silent for read-only tools', async () => {
    // Write/Edit/Bash are the steps a user can see; Read/Glob/Grep are how the agent thinks.
    expect(buildProgressLine({ phase: 'started', tool: 'Write', args: { file_path: '/p/frontend/src/pages/Contactos.jsx' } }))
      .toBe('A construir "Contactos"...');
    expect(buildProgressLine({ phase: 'started', tool: 'Edit', args: { file_path: '/p/frontend/src/index.css' } }))
      .toBe('A afinar o aspeto e o espaçamento...');
    expect(buildProgressLine({ phase: 'started', tool: 'Bash', args: {} })).toBe('A compilar e verificar...');
    expect(buildProgressLine({ phase: 'started', tool: 'Read', args: { file_path: '/p/frontend/src/App.jsx' } })).toBeNull();
    expect(buildProgressLine({ phase: 'started', tool: 'Grep', args: {} })).toBeNull();
    // A PascalCase screen name becomes a human label; the shell files do not masquerade as screens.
    expect(buildProgressLine({ phase: 'started', tool: 'Write', args: { file_path: '/p/frontend/src/pages/CasosRecentes.jsx' } }))
      .toBe('A construir "Casos Recentes"...');
    expect(buildProgressLine({ phase: 'started', tool: 'Write', args: { file_path: '/p/frontend/src/App.jsx' } }))
      .toBe('A montar a estrutura da aplicação...');
    // Only the `started` edge narrates, so one step is not reported twice.
    expect(buildProgressLine({ phase: 'finished', tool: 'Write', args: { file_path: '/p/frontend/src/pages/X.jsx' } })).toBeNull();
  });

  it('a routine FOLLOW-UP floors at WORKHORSE (claude-sonnet-5), runs a FRESH session (no resume), and still mounts the design-skill plugin (token-economics port)', async () => {
    const t = resetAgentState({ finalText: 'edited' });
    startEvents();
    const { mech } = fakeMechanics();
    const jobId = 'job-followup-tier';
    const abort = new AbortController();
    registerRun({ id: jobId, ownerUserId: 'u1', orgId: 'o1', kind: 'build', abort, startedAt: 0, artifactId: 'artX', sessionId: 's1' });
    await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: 'u1', sessionId: 's1', artifactId: 'artX', request: { description: 'tweak the header', language: 'pt' }, createdAt: 'x' } as JobRecord);
    setBuildMechanics(mech);
    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'tweak the header', language: 'pt', deps: deps() }, abort, { firstBuild: false, artifactId: 'artX' });
    const call = t.streamCalls[0]!;
    expect(call.model).toBe('claude-sonnet-5'); // WORKHORSE floor, not Opus
    expect(call.resume).toBeUndefined(); // fresh session — never resumes a transcript
    expect(call.plugins?.some((p) => p.endsWith('content/plugins/impeccable'))).toBe(true);
    const job = (await jobs.get(jobId)) as JobRecord & { routing?: { tier: string } };
    expect(job.routing?.tier).toBe('WORKHORSE');
  });

  it('a big-change FOLLOW-UP (2+ Tier-4 keywords) still escalates to EXPERT (claude-opus-5)', async () => {
    const t = resetAgentState({ finalText: 'rebuilt' });
    startEvents();
    const { mech } = fakeMechanics();
    const jobId = 'job-followup-big';
    const abort = new AbortController();
    const desc = 'refactor the dashboard: rebuild the whole feature';
    registerRun({ id: jobId, ownerUserId: 'u1', orgId: 'o1', kind: 'build', abort, startedAt: 0, artifactId: 'artB', sessionId: 's1' });
    await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: 'u1', sessionId: 's1', artifactId: 'artB', request: { description: desc, language: 'pt' }, createdAt: 'x' } as JobRecord);
    setBuildMechanics(mech);
    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: desc, language: 'pt', deps: deps() }, abort, { firstBuild: false, artifactId: 'artB' });
    expect(t.streamCalls[0]!.model).toBe('claude-opus-5');
    const job = (await jobs.get(jobId)) as JobRecord & { routing?: { tier: string } };
    expect(job.routing?.tier).toBe('EXPERT');
  });

  it('a completed build schedules a running-summary refresh through the mechanics seam (token-economics port)', async () => {
    resetAgentState({ finalText: 'edited the clientes screen', oneShotText: 'CRM app: clientes collection with nif + estado.' });
    startEvents();
    const fm = fakeMechanics();
    const jobId = 'job-summary';
    const abort = new AbortController();
    registerRun({ id: jobId, ownerUserId: 'u1', kind: 'build', abort, startedAt: 0, artifactId: 'artF', sessionId: 's1' });
    await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: 'u1', artifactId: 'artF', request: { description: 'x', language: 'pt' }, createdAt: 'x' } as JobRecord);
    setBuildMechanics(fm.mech);
    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'change', language: 'pt', artifactId: 'artF', deps: deps() }, abort, { firstBuild: false, artifactId: 'artF' });
    // The summary pass is fire-and-forget off the terminal event; let its FAST one-shot + persist settle.
    await awaitPendingBuildSummary('artF', 2_000);
    expect(fm.calls.persistBuildSummary.map(([id]) => id)).toEqual(['artF']);
    expect(fm.calls.persistBuildSummary[0]![1]).toBeTruthy(); // a non-empty summary was written
  });

  it('a follow-up with a running summary injects "Prior Work On This App" into the build prompt and feeds the files changed (project-relative) to the summary pass (token-economics port)', async () => {
    const SUMMARY = 'App overview: a customer list screen with a status column.';
    const t = resetAgentState({
      finalText: 'edited the customer list',
      oneShotText: 'v2 running summary',
      // A Write tool event drives collectChangedFile -> filesChanged (path is project-relative to /pd).
      stream: [{ kind: 'tool_use', tool: 'Write', toolId: 'w1', args: { file_path: '/pd/frontend/src/Clientes.jsx' } }],
    });
    const { mech, calls } = fakeMechanics({
      async resolveFollowUp() { return { projectDir: '/pd', buildSummary: SUMMARY, slug: 'my-app', appUrl: 'http://app' }; },
    });
    const jobId = 'job-priorwork';
    const abort = new AbortController();
    registerRun({ id: jobId, ownerUserId: 'u1', kind: 'build', abort, startedAt: 0, artifactId: 'artPW', sessionId: 's1' });
    await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: 'u1', artifactId: 'artPW', request: { description: 'change the header', language: 'pt' }, createdAt: 'x' } as JobRecord);
    setBuildMechanics(mech);
    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'change the header', language: 'pt', artifactId: 'artPW', deps: deps() }, abort, { firstBuild: false, artifactId: 'artPW' });

    // [4] The build prompt leads with the summary section, so the fresh session inherits prior work.
    const buildPrompt = t.streamCalls[0]!.prompt;
    expect(buildPrompt.startsWith('# Prior Work On This App')).toBe(true);
    expect(buildPrompt).toContain(SUMMARY);

    // [5] The changed file reaches the summary pass, stripped to a project-relative path (no /pd prefix).
    await awaitPendingBuildSummary('artPW', 2_000);
    const summaryCall = t.oneShotCalls.find((c) => c.prompt.includes('<files_changed>'));
    expect(summaryCall).toBeTruthy();
    expect(summaryCall!.prompt).toContain('frontend/src/Clientes.jsx');
    expect(summaryCall!.prompt).not.toContain('/pd/frontend'); // absolute sandbox prefix stripped
    expect(calls.persistBuildSummary).toEqual([['artPW', 'v2 running summary']]);
  });

  it('TOCTOU: a follow-up whose artifact became UNWRITABLE between create and execute fails the job (EDIT_FORBIDDEN), never resuming the agent (H1 MEDIUM)', async () => {
    resetAgentState({ finalText: 'ok' });
    startEvents();
    // The artifact flipped org→private (or was deleted) after the create-time gate: revalidate now
    // returns 'forbidden'. resolveFollowUp MUST NOT be reached (it would resume the code agent).
    let resolveCalled = 0;
    const { mech } = fakeMechanics({
      async revalidateWritable() { return 'forbidden'; },
      async resolveFollowUp() { resolveCalled++; return { projectDir: '/pd', slug: 'my-app', appUrl: 'http://app' }; },
    });
    const jobId = 'job-toctou';
    const abort = new AbortController();
    registerRun({ id: jobId, ownerUserId: 'u1', orgId: 'o1', kind: 'build', abort, startedAt: 0, artifactId: 'artT', sessionId: 's1' });
    await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: 'u1', artifactId: 'artT', request: { description: 'x', language: 'pt' }, createdAt: 'x' } as JobRecord);
    setBuildMechanics(mech);
    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'change', language: 'pt', artifactId: 'artT', deps: deps() }, abort, { firstBuild: false, artifactId: 'artT' });

    const job = (await jobs.get(jobId)) as JobRecord & { error?: { code: string } };
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('EDIT_FORBIDDEN');
    expect(resolveCalled).toBe(0); // the code-writing agent was never resumed
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

  it('verify per-action narration: ">> " lines re-emit as same-status plan_steps, other narration stays off the step channel, and the hold-back tail is flushed (operator ask 2026-07-14)', async () => {
    const t = resetAgentState({ finalText: 'built' });
    const { events } = startEvents();
    setVerifyRunner(async (i): Promise<VerifyRunResult> => {
      // Chunks deliberately split MID-LINE: the assembler in build.ts must reassemble.
      i.onProgress?.('>> A abrir a apli');
      i.onProgress?.('cação\nvou analisar a página primeiro\n>> A clicar em "Adicionar"\n');
      // Marker GLUED to the previous sentence (observed live 2026-07-14: the model skips
      // the newline) - the scan is marker-anchored, so this must still emit.
      i.onProgress?.('Vou registar o pedido.>> A ir para Aprovações\n');
      // Final action WITHOUT a trailing newline: only reachable through the end-of-run flush
      // (MarkerProcessor holds back a tail to catch split markers).
      i.onProgress?.('>> A confirmar que a lista atualiza');
      return { ran: true, passed: true };
    });
    const { mech } = fakeMechanics();
    await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build a crm', language: 'pt', deps: deps() });

    const steps = events.filter((e) => e.type === 'plan_step' && (e.data as { status?: string }).status === 'verifying');
    const descs = steps.map((e) => (e.data as { description?: string }).description);
    expect(descs).toContain('A testar a aplicação...'); // the stage banner step
    expect(descs).toContain('A abrir a aplicação'); // reassembled across chunk split
    expect(descs).toContain('A clicar em "Adicionar"');
    expect(descs).toContain('A ir para Aprovações'); // marker glued to the previous sentence
    expect(descs).toContain('A confirmar que a lista atualiza'); // flushed tail, no trailing newline
    // Plain narration lines ride the thinking channel only, never the step channel.
    expect(descs.some((d) => d?.includes('vou analisar'))).toBe(false);
    const thinking = events.filter((e) => e.type === 'thinking_chunk').map((e) => (e.data as { text?: string }).text).join('');
    expect(thinking).toContain('vou analisar a página primeiro');
    expect(thinking).toContain('A confirmar que a lista atualiza'); // tail also flushed to thinking
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

describe('F1 knowledge-during-build — scoping narrates a knowledge request and ingests scoping docs', () => {
  beforeAll(() => bootAgentTestDb('ekoa_build_f1'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); });
  afterEach(async () => { __resetBuildSummaryChainsForTests(); __resetAgentSeamsForTests(); vi.restoreAllMocks(); restoreTransport(); await jobs.deleteMany({}); await userSettings.deleteMany({}); });

  const passVerify = () => setVerifyRunner(async (): Promise<VerifyRunResult> => ({ ran: true, passed: true }));
  const planSteps = (events: Array<{ stream: string; type: string; data: unknown }>, status: string) =>
    events.filter((e) => e.stream === 'job' && e.type === 'plan_step' && (e.data as { status?: string }).status === status);

  it('a domain-heavy first build NARRATES a knowledge-scope plan_step (PT-PT, no emoji)', async () => {
    const t = resetAgentState({ finalText: 'built' });
    const { events } = startEvents();
    passVerify();
    let ingestCalls = 0;
    setIngestBuildKnowledge(async () => { ingestCalls++; return { id: 'x' }; });
    const { mech } = fakeMechanics();
    // "taxas"/"custas" -> financial domain; no knowledgeDocs -> narrate only, no ingest.
    await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'Aplicação para calcular as taxas e custas de um processo', language: 'pt', deps: deps() });

    const scoped = planSteps(events, 'knowledge-scope');
    expect(scoped).toHaveLength(1);
    const msg = (scoped[0]!.data as { description?: string }).description ?? '';
    expect(msg).toContain('área de conhecimento da organização');
    expect(msg).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u); // no emoji
    expect(msg).not.toMatch(/[—–]/); // no em/en dash
    expect(ingestCalls).toBe(0); // nothing to ingest without knowledgeDocs
    expect(planSteps(events, 'knowledge-indexed')).toHaveLength(0);
  });

  it('scoping-provided documents are ingested via the seam with the RUN ACTOR org + narrated', async () => {
    const t = resetAgentState({ finalText: 'built' });
    const { events } = startEvents();
    passVerify();
    const seen: Array<{ actor: Actor; doc: BuildKnowledgeDoc }> = [];
    setIngestBuildKnowledge(async (a, doc) => { seen.push({ actor: a, doc }); return { id: `kd_${seen.length}` }; });
    const { mech } = fakeMechanics();
    await execFirstBuild(t, mech, {
      actor, username: 'u1', sessionId: 's1', language: 'pt', deps: deps(),
      description: 'Gestão de apólices de seguro e sinistros',
      knowledgeDocs: [{ title: 'Manual de subscrição', text: 'regras de subscrição e franquias' }],
    });

    // the seam saw the build actor's org (org-scoped by construction) + the scoping doc
    expect(seen).toHaveLength(1);
    expect(seen[0]!.actor.orgId).toBe('o1');
    expect(seen[0]!.doc.title).toBe('Manual de subscrição');
    expect(seen[0]!.doc.sourceType).toBe('build-scoping');
    // and the build narrated the indexed confirmation
    const indexed = planSteps(events, 'knowledge-indexed');
    expect(indexed).toHaveLength(1);
    expect((indexed[0]!.data as { description?: string }).description).toContain('Foi indexado 1 documento');
  });

  it('an ALL-FAILED ingest is narrated honestly (review-f1 Low: it used to be silent), build still completes', async () => {
    const t = resetAgentState({ finalText: 'built' });
    const { events } = startEvents();
    passVerify();
    setIngestBuildKnowledge(async () => { throw new Error('índice indisponível'); });
    const { mech } = fakeMechanics();
    await execFirstBuild(t, mech, {
      actor, username: 'u1', sessionId: 's1', language: 'pt', deps: deps(),
      description: 'Gestão de apólices e sinistros',
      knowledgeDocs: [{ title: 'Manual', text: 'regras' }, { title: 'Anexo', text: 'franquias' }],
    });
    const indexed = planSteps(events, 'knowledge-indexed');
    expect(indexed).toHaveLength(1);
    const msg = (indexed[0]!.data as { description?: string }).description ?? '';
    expect(msg).toContain('Não foi possível indexar os 2 documentos fornecidos');
    expect(msg).not.toContain('Foram indexados'); // never pretends success
  });

  it('a generic (non-domain-heavy) first build neither narrates nor ingests', async () => {
    const t = resetAgentState({ finalText: 'built' });
    const { events } = startEvents();
    passVerify();
    let ingestCalls = 0;
    setIngestBuildKnowledge(async () => { ingestCalls++; return { id: 'x' }; });
    const { mech } = fakeMechanics();
    await execFirstBuild(t, mech, {
      actor, username: 'u1', sessionId: 's1', language: 'pt', deps: deps(),
      description: 'Cria uma lista de tarefas com um painel de estatísticas',
      knowledgeDocs: [{ title: 'irrelevante', text: 'nao deve ser indexado' }], // ignored: not domain-heavy
    });
    expect(planSteps(events, 'knowledge-scope')).toHaveLength(0);
    expect(ingestCalls).toBe(0);
  });

  it('follow-up builds skip knowledge scoping (scoping is a first-build phase)', async () => {
    resetAgentState({ finalText: 'ok' });
    const { events } = startEvents();
    passVerify();
    let ingestCalls = 0;
    setIngestBuildKnowledge(async () => { ingestCalls++; return { id: 'x' }; });
    const fm = fakeMechanics();
    const jobId = 'job-f1-followup';
    const abort = new AbortController();
    registerRun({ id: jobId, ownerUserId: 'u1', orgId: 'o1', kind: 'build', abort, startedAt: 0, artifactId: 'artK', sessionId: 's1' });
    await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: 'u1', artifactId: 'artK', request: { description: 'x', language: 'pt' }, createdAt: 'x' } as JobRecord);
    setBuildMechanics(fm.mech);
    // a domain-heavy description on a FOLLOW-UP must not trigger scoping
    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'adiciona o cálculo de taxas e custas', language: 'pt', artifactId: 'artK', knowledgeDocs: [{ title: 'x', text: 'y' }], deps: deps() }, abort, { firstBuild: false, artifactId: 'artK' });
    expect(planSteps(events, 'knowledge-scope')).toHaveLength(0);
    expect(ingestCalls).toBe(0);
  });
});

describe('Registo build lifecycle rows (F3) — a terminal build audits exactly once, metadata-only', () => {
  beforeAll(() => bootAgentTestDb('ekoa_build_registo'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); await activityLogs.deleteMany({}); });
  // The terminal build audit is fire-and-forget (production best-effort); settle it before
  // clearing so a late write from one test never pollutes the next (both use jobId 'job-exec').
  const settleAudit = () => new Promise((r) => setTimeout(r, 60));
  afterEach(async () => { await settleAudit(); vi.restoreAllMocks(); restoreTransport(); await jobs.deleteMany({}); await userSettings.deleteMany({}); await activityLogs.deleteMany({}); });

  it('a COMPLETED build writes one build.completed row (orgId scoped, no description text)', async () => {
    const t = resetAgentState({ finalText: 'built' });
    startEvents();
    setVerifyRunner(async (): Promise<VerifyRunResult> => ({ ran: true, passed: true }));
    const { mech } = fakeMechanics();
    await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'segredo do cliente Petrova', language: 'pt', deps: deps() });
    await settleAudit();
    const rows = (await activityLogs.find({ category: 'build' })) as Array<{ type: string; orgId: string }>;
    const completed = rows.filter((r) => r.type === 'completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.orgId).toBe('o1');
    expect(JSON.stringify(rows)).not.toContain('Petrova'); // description never reaches the audit row
    expect(JSON.stringify(rows)).not.toContain('segredo');
  });

  it('a VERIFY_FAILED build writes one build.failed row carrying the code, not a completed row', async () => {
    const t = resetAgentState({ finalText: 'built' });
    startEvents();
    setVerifyRunner(async (): Promise<VerifyRunResult> => ({ ran: true, passed: false, note: 'scaffold servido' }));
    const { mech } = fakeMechanics();
    await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'build a form', language: 'pt', deps: deps() });
    await settleAudit();
    const rows = (await activityLogs.find({ category: 'build' })) as Array<{ type: string; metadata?: { code?: string } }>;
    expect(rows.some((r) => r.type === 'completed')).toBe(false);
    const failed = rows.filter((r) => r.type === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.metadata?.code).toBe('VERIFY_FAILED');
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

describe('overload resilience — one transparent in-job retry (finding 2026-08-13)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_build_retry'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    await seedUser('u1', 'o1');
    // Fast knobs for the retry machinery (reset the memoized config so they take).
    process.env.BUILD_OVERLOAD_RETRY_DELAY_MS = '10';
    process.env.BUILD_FIRST_EVENT_DEADLINE_MS = '200';
    __resetAgentsConfigForTests();
  });
  afterEach(async () => {
    delete process.env.BUILD_OVERLOAD_RETRY_DELAY_MS;
    delete process.env.BUILD_FIRST_EVENT_DEADLINE_MS;
    __resetAgentsConfigForTests();
    vi.restoreAllMocks();
    restoreTransport();
    await jobs.deleteMany({});
    await userSettings.deleteMany({});
  });

  /** A transport whose FIRST streamAgent call misbehaves per `firstCall` and whose second call
   *  succeeds — the two-phase shape the in-job retry exists for. */
  function twoPhaseTransport(firstCall: 'throw-529' | 'error-as-result' | 'auth-as-result' | 'hang' | 'stream-then-throw'): FakeTransport {
    const good = makeFakeTransport({ finalText: 'built after retry' });
    let call = 0;
    const t: FakeTransport = {
      ...good,
      async *streamAgent(params) {
        call += 1;
        if (call === 1) {
          // The good transport records only calls it serves — record the misbehaving first
          // attempt here so the tests can count BOTH attempts.
          (good.streamCalls as unknown as Array<typeof params>).push(params);
          if (firstCall === 'throw-529') {
            throw new Error('Claude Code returned an error result: API Error: 529 Overloaded. This is a server-side issue.');
          }
          if (firstCall === 'error-as-result') {
            yield { kind: 'final', text: 'API Error: 529 Overloaded', usage: { input: 1, output: 1, cacheCreate: 0, cacheRead: 0 }, aborted: false };
            return;
          }
          if (firstCall === 'auth-as-result') {
            yield { kind: 'final', text: 'authentication failed: invalid api key', usage: { input: 1, output: 1, cacheCreate: 0, cacheRead: 0 }, aborted: false };
            return;
          }
          if (firstCall === 'stream-then-throw') {
            yield { kind: 'text', text: 'algum texto visível' };
            throw new Error('API Error: 529 Overloaded');
          }
          // hang: no events at all until the per-attempt first-event deadline aborts us.
          await new Promise<void>((resolve) => {
            if (params.signal?.aborted) { resolve(); return; }
            const t2 = setTimeout(resolve, 10_000);
            params.signal?.addEventListener('abort', () => { clearTimeout(t2); resolve(); });
          });
          yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: true };
          return;
        }
        yield* good.streamAgent(params);
      },
    };
    return t;
  }

  async function runRetryBuild(t: FakeTransport): Promise<{ jobId: string; events: Array<{ stream: string; type: string; data: unknown }> }> {
    const { events } = startEvents();
    const { mech } = fakeMechanics();
    const jobId = 'job-retry';
    const abort = new AbortController();
    registerRun({ id: jobId, ownerUserId: 'u1', orgId: 'o1', kind: 'build', abort, startedAt: 0, sessionId: 's-retry' });
    await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: 'u1', sessionId: 's-retry', request: { description: 'todo app', language: 'pt' }, createdAt: 'x' } as JobRecord);
    setBuildMechanics(mech);
    __setTransportForTests(t);
    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's-retry', description: 'todo app', language: 'pt', deps: deps() }, abort, { firstBuild: true });
    return { jobId, events };
  }

  it('an overload THROW before anything streamed retries once, keeps the SAME routing, and completes', async () => {
    const t = twoPhaseTransport('throw-529');
    const { jobId, events } = await runRetryBuild(t);
    expect(((await jobs.get(jobId)) as unknown as { status: string }).status).toBe('completed');
    expect(t.streamCalls).toHaveLength(2);
    // The retry preserves this run's own routing decision (the GENIUS first-build directive is
    // exactly what the manual-retry path used to lose by rerouting as a follow-up).
    expect(t.streamCalls[1]!.model).toBe(t.streamCalls[0]!.model);
    expect(t.streamCalls[1]!.effort).toBe(t.streamCalls[0]!.effort);
    // The retry is narrated, never silent.
    const steps = events.filter((e) => e.type === 'plan_step').map((e) => e.data as { status: string });
    expect(steps.some((s) => s.status === 'retrying')).toBe(true);
  });

  it('a transient provider-error-AS-RESULT (nothing streamed) retries once and completes', async () => {
    const t = twoPhaseTransport('error-as-result');
    const { jobId } = await runRetryBuild(t);
    expect(((await jobs.get(jobId)) as unknown as { status: string }).status).toBe('completed');
    expect(t.streamCalls).toHaveLength(2);
  });

  it('an AUTH-classed error-as-result never retries (operator work, not an overload window)', async () => {
    const t = twoPhaseTransport('auth-as-result');
    const { jobId } = await runRetryBuild(t);
    const job = (await jobs.get(jobId)) as JobRecord & { error?: { code: string } };
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('ADAPTER_ERROR');
    expect(t.streamCalls).toHaveLength(1);
  });

  it('the first-event deadline cuts a silent overload window and the retry completes the build', async () => {
    const t = twoPhaseTransport('hang');
    const { jobId } = await runRetryBuild(t);
    expect(((await jobs.get(jobId)) as unknown as { status: string }).status).toBe('completed');
    expect(t.streamCalls).toHaveLength(2);
  }, 15_000);

  it('anything already streamed forfeits the retry (never re-stream a transcript)', async () => {
    const t = twoPhaseTransport('stream-then-throw');
    const { jobId } = await runRetryBuild(t);
    const job = (await jobs.get(jobId)) as JobRecord & { error?: { code: string } };
    expect(job.status).toBe('failed');
    expect(job.error?.code).toBe('ADAPTER_ERROR');
    expect(t.streamCalls).toHaveLength(1);
  });
});
