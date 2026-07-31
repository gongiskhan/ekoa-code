import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { RunLogsResponse } from '@ekoa/shared';
import { runAutomation, type RunContext } from '../../src/automation/engine.js';
import {
  createStepLogAccumulator,
  runLogsFromSteps,
  STEP_LOG_MAX_CHARS,
  RUN_LOG_MAX_CHARS,
} from '../../src/automation/persistence.js';
import { getRunLogs } from '../../src/automation/service.js';
import { computeCommandShape } from '../../src/automation/command-shape.js';
import { approveCommandShape } from '../../src/automation/consent.js';
import {
  setDaemonConnectionResolver,
  __resetAutomationSeamsForTests,
  type DaemonConnection,
} from '../../src/automation/seams.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import { automations, automationRuns, approvedCommands } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import type { Automation, StepRecord } from '../../src/automation/types.js';

/**
 * Run-log capture (slice E4). Step stdout/stderr used to exist ONLY as ephemeral SSE
 * `step_output_chunk` frames — a caller with no stream (a gateway key) could never see it. The
 * engine now accumulates a BOUNDED tail per step and persists it on the step record.
 *
 * Driven through the REAL engine + REAL persistence with a fake daemon connection that streams
 * progress chunks the way the bash capability does; the caps themselves are also unit-tested
 * directly, because their run-wide arithmetic is not reachable through one automation.
 */
const ARGV = ['echo', 'olá'];

const ctx: RunContext = {
  ownerUserId: 'u1',
  orgId: 'o1',
  triggeredBy: 'user',
  visitedAutomationIds: new Set(),
  traceId: 't1',
};

function automationWith(id: string): Automation {
  return {
    id,
    name: 'Comando local',
    description: '',
    ownerUserId: 'u1',
    steps: [{ id: 's1', description: 'correr um comando', type: 'local_command', commandTemplate: { argv: ARGV } }],
    createdAt: '',
    updatedAt: '',
  };
}

/** A daemon that streams `chunks` over the progress channel and then answers one observation. */
function streamingDaemon(chunks: string[], data: Record<string, unknown>): DaemonConnection {
  return {
    async runStep(_req, opts) {
      for (const c of chunks) opts?.onProgress?.(c);
      return { ok: true, observation: { data } };
    },
  };
}

async function persistedSteps(runId: string): Promise<StepRecord[]> {
  const doc = (await automationRuns.get(runId)) as unknown as { steps?: StepRecord[] } | null;
  return doc?.steps ?? [];
}

describe('step log accumulator caps (slice E4)', () => {
  it('keeps the newest characters per step and flags the drop', () => {
    const acc = createStepLogAccumulator();
    // 4 chunks of 6000 = 24 000 > the 16 384 per-step cap.
    for (const c of ['A', 'B', 'C', 'D']) acc.append(0, c.repeat(6000));
    const tail = acc.tailFor(0)!;
    expect(tail.text.length).toBe(STEP_LOG_MAX_CHARS);
    expect(tail.truncated).toBe(true);
    // A TAIL: the newest bytes survive, the oldest are evicted.
    expect(tail.text.endsWith('D')).toBe(true);
    expect(tail.text.includes('A')).toBe(false);
  });

  it('bounds the WHOLE run, not just each step', () => {
    const acc = createStepLogAccumulator();
    // 16 steps x 16 KB would be 256 KB; the run budget is 128 KB.
    for (let i = 0; i < 16; i += 1) acc.append(i, 'x'.repeat(STEP_LOG_MAX_CHARS));
    let total = 0;
    let truncatedSteps = 0;
    for (let i = 0; i < 16; i += 1) {
      const tail = acc.tailFor(i);
      if (!tail) continue;
      total += tail.text.length;
      if (tail.truncated) truncatedSteps += 1;
    }
    expect(total).toBeLessThanOrEqual(RUN_LOG_MAX_CHARS);
    expect(truncatedSteps).toBeGreaterThan(0);
    // Steps past the budget are still REPORTED (empty + truncated), never silently identical to
    // a step that produced nothing.
    expect(acc.tailFor(15)).toEqual({ text: '', truncated: true });
  });

  it('a single oversized chunk cannot blow the cap, and a step that streamed nothing has no tail', () => {
    const acc = createStepLogAccumulator();
    acc.append(0, 'z'.repeat(STEP_LOG_MAX_CHARS * 4));
    expect(acc.tailFor(0)!.text.length).toBe(STEP_LOG_MAX_CHARS);
    expect(acc.tailFor(0)!.truncated).toBe(true);
    acc.append(1, '');
    expect(acc.tailFor(1)).toBeUndefined();
    expect(acc.tailFor(99)).toBeUndefined();
  });

  it('projection: an unbounded persisted output is re-capped on the way out', () => {
    const steps: StepRecord[] = [
      {
        stepId: 's0', index: 0, status: 'completed', tier: 'cache', durationMs: 1,
        // No tail (an older record / a run with no streaming): the stored stdout is the source.
        output: { kind: 'local_command', stdout: 'q'.repeat(5 * 1024 * 1024), stderr: '', exitCode: 0, durationMs: 1, truncated: false, timedOut: false },
      },
      { stepId: 's1', index: 1, status: 'completed', tier: 'cache', durationMs: 1 },
    ];
    const logs = runLogsFromSteps(steps);
    expect(logs.map((l) => l.stepIndex)).toEqual([0]);
    expect(logs[0]!.log.length).toBe(STEP_LOG_MAX_CHARS);
    expect(logs[0]!.truncated).toBe(true);
  });

  it('projection: a tail that is NOT contained in the authoritative stdout keeps both honest', () => {
    // Neither view contains the other (a step that streamed one thing and captured another).
    const [longer] = runLogsFromSteps([
      {
        stepId: 's0', index: 0, status: 'completed', tier: 'cache', durationMs: 1,
        logTail: { text: 'apenas-transmitido', truncated: false },
        output: { kind: 'local_command', stdout: 'capturado-e-mais-longo', stderr: '', exitCode: 0, durationMs: 1, truncated: false, timedOut: false },
      },
    ]);
    expect(longer!.log).toBe('capturado-e-mais-longo'); // the longer, authoritative side wins
    expect(longer!.truncated).toBe(true); // and the discarded tail is declared

    // The reverse: a captured stdout SHORTER than the tail (a truncated observation) is not the
    // one kept, and is likewise declared.
    const [shorter] = runLogsFromSteps([
      {
        stepId: 's0', index: 0, status: 'completed', tier: 'cache', durationMs: 1,
        logTail: { text: 'transmitido-mais-longo-do-que-o-capturado', truncated: false },
        output: { kind: 'local_command', stdout: 'xyz', stderr: 'aviso', exitCode: 0, durationMs: 1, truncated: false, timedOut: false },
      },
    ]);
    expect(shorter!.log).toBe('transmitido-mais-longo-do-que-o-capturado\naviso');
    expect(shorter!.truncated).toBe(true);
  });

  it('projection: an ekoa_action trace and an api_call body both become readable logs', () => {
    const logs = runLogsFromSteps([
      {
        stepId: 's0', index: 0, status: 'completed', tier: 'cache', durationMs: 1,
        output: { kind: 'ekoa_action', trace: [{ op: 'store.create', summary: 'clients -> id c-1', durationMs: 1, status: 'ok' }], result: 'cliente criado', capturedValues: {}, durationMs: 1 },
      },
      {
        stepId: 's1', index: 1, status: 'completed', tier: 'cache', durationMs: 1,
        output: { kind: 'api_call', status: 200, responseHeaders: {}, responseBody: '{"ok":true}', responseBodyIsJson: true, truncated: false, durationMs: 1 },
      },
    ]);
    expect(logs[0]!.log).toContain('store.create: clients -> id c-1');
    expect(logs[0]!.log).toContain('cliente criado');
    expect(logs[0]!.truncated).toBe(false);
    expect(logs[1]!.log).toBe('{"ok":true}');
  });
});

describe('engine persists a bounded log tail for streamed steps (slice E4)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_run_logs'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    resetAgentState(); // fake LLM transport — this suite never reaches a model
    __resetAutomationSeamsForTests();
    __resetAutomationConfigForTests();
    await approveCommandShape('u1', computeCommandShape(ARGV)); // no consent pause
  });
  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
    await approvedCommands.deleteMany({});
  });

  it('a real run keeps the streamed chunks on the persisted step record', async () => {
    await automations.insert({ _id: 'auto-log', ...automationWith('auto-log') } as never);
    setDaemonConnectionResolver(() => streamingDaemon(
      ['linha 1\n', 'linha 2\n', 'linha 3\n'],
      { exitCode: 0, stdout: 'linha 1\nlinha 2\nlinha 3\n', stderr: 'aviso' },
    ));

    const result = await runAutomation('auto-log', ctx, { runId: 'run-log-ok' });
    expect(result.status).toBe('completed');

    const steps = await persistedSteps('run-log-ok');
    expect(steps).toHaveLength(1);
    expect(steps[0]!.logTail).toEqual({ text: 'linha 1\nlinha 2\nlinha 3\n', truncated: false });

    // The service projection serves the tail plus the final stderr the progress channel never had.
    const logs = await getRunLogs({ userId: 'u1', orgId: 'o1', role: 'user' }, 'run-log-ok');
    expect(RunLogsResponse.safeParse(logs).success).toBe(true);
    expect(logs.steps).toHaveLength(1);
    expect(logs.steps[0]!.stepIndex).toBe(0);
    expect(logs.steps[0]!.log).toBe('linha 1\nlinha 2\nlinha 3\n\naviso');
    expect(logs.steps[0]!.truncated).toBe(false);
  });

  it('E4 review finding 1: a streamed chunk NEVER hides the authoritative stdout behind truncated:false', async () => {
    await automations.insert({ _id: 'auto-auth', ...automationWith('auto-auth') } as never);
    // The daemon's progress channel carries ONE undiscriminated line; the final observation carries
    // the real 200 KB stdout (executors/local-command.ts: "the authoritative stdout/stderr split
    // comes from the final observation"). Preferring the tail dropped 200 KB while reporting
    // truncated:false — a log that lies about being complete.
    const authoritative = `${'S'.repeat(200_000)}FIM-AUTORITATIVO`;
    setDaemonConnectionResolver(() => streamingDaemon(
      ['a correr...\n'],
      { exitCode: 0, stdout: authoritative, stderr: '' },
    ));

    await runAutomation('auto-auth', ctx, { runId: 'run-log-auth' });

    const logs = await getRunLogs({ userId: 'u1', orgId: 'o1', role: 'user' }, 'run-log-auth');
    expect(RunLogsResponse.safeParse(logs).success).toBe(true);
    const entry = logs.steps[0]!;
    // The authoritative capture is what is served (its END, per the tail semantics)…
    expect(entry.log).toContain('FIM-AUTORITATIVO');
    expect(entry.log.length).toBe(STEP_LOG_MAX_CHARS);
    // …and the response SAYS output was dropped.
    expect(entry.truncated).toBe(true);
    // The pre-fix behaviour, pinned so it cannot come back: the one-line tail alone, claiming
    // nothing was lost.
    expect(entry.log).not.toBe('a correr...\n');
  });

  it('the truncated flag does not cry wolf when the tail is genuinely part of stdout', async () => {
    await automations.insert({ _id: 'auto-quiet', ...automationWith('auto-quiet') } as never);
    // The ordinary case: the daemon streamed exactly what stdout ends up holding. Nothing was
    // dropped, so nothing may be reported as dropped.
    setDaemonConnectionResolver(() => streamingDaemon(
      ['linha A\n', 'linha B\n'],
      { exitCode: 0, stdout: 'linha A\nlinha B\n', stderr: '' },
    ));

    await runAutomation('auto-quiet', ctx, { runId: 'run-log-quiet' });

    const logs = await getRunLogs({ userId: 'u1', orgId: 'o1', role: 'user' }, 'run-log-quiet');
    expect(logs.steps[0]!.log).toBe('linha A\nlinha B\n');
    expect(logs.steps[0]!.truncated).toBe(false);
  });

  it('a chatty step is capped at the per-step bound with truncated=true, keeping the END', async () => {
    await automations.insert({ _id: 'auto-flood', ...automationWith('auto-flood') } as never);
    // 40 x 1000 = 40 000 characters streamed, well over the 16 384 cap.
    const chunks = Array.from({ length: 40 }, (_, i) => `${String(i).padStart(4, '0')}${'.'.repeat(996)}`);
    setDaemonConnectionResolver(() => streamingDaemon(chunks, { exitCode: 0, stdout: '', stderr: '' }));

    await runAutomation('auto-flood', ctx, { runId: 'run-log-flood' });

    const tail = (await persistedSteps('run-log-flood'))[0]!.logTail!;
    expect(tail.text.length).toBe(STEP_LOG_MAX_CHARS);
    expect(tail.truncated).toBe(true);
    expect(tail.text.endsWith('.')).toBe(true);
    expect(tail.text.includes('0039')).toBe(true); // the last chunk survived
    expect(tail.text.includes('0000')).toBe(false); // the first did not

    const logs = await getRunLogs({ userId: 'u1', orgId: 'o1', role: 'user' }, 'run-log-flood');
    expect(RunLogsResponse.safeParse(logs).success).toBe(true);
    expect(logs.steps[0]!.log.length).toBeLessThanOrEqual(STEP_LOG_MAX_CHARS);
    expect(logs.steps[0]!.truncated).toBe(true);
  });

  it('the tail survives a FAILED step (it is written as the step finishes, not only on success)', async () => {
    await automations.insert({ _id: 'auto-fail', ...automationWith('auto-fail') } as never);
    setDaemonConnectionResolver(() => streamingDaemon(
      ['a começar\n', 'erro fatal\n'],
      { exitCode: 3, stdout: '', stderr: 'saiu com 3' },
    ));

    const result = await runAutomation('auto-fail', ctx, { runId: 'run-log-fail' });
    expect(result.status).toBe('failed');
    const steps = await persistedSteps('run-log-fail');
    expect(steps[0]!.status).toBe('failed');
    expect(steps[0]!.logTail!.text).toBe('a começar\nerro fatal\n');

    const logs = await getRunLogs({ userId: 'u1', orgId: 'o1', role: 'user' }, 'run-log-fail');
    expect(logs.steps[0]!.log).toContain('erro fatal');
    expect(logs.steps[0]!.log).toContain('saiu com 3');
  });

  it('logs are owner-scoped: another tenant gets the same uniform NOT_FOUND as a missing run', async () => {
    await automations.insert({ _id: 'auto-scope', ...automationWith('auto-scope') } as never);
    setDaemonConnectionResolver(() => streamingDaemon(['segredo do inquilino\n'], { exitCode: 0, stdout: '', stderr: '' }));
    await runAutomation('auto-scope', ctx, { runId: 'run-log-scope' });

    await expect(getRunLogs({ userId: 'u2', orgId: 'o2', role: 'user' }, 'run-log-scope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getRunLogs({ userId: 'u2', orgId: 'o2', role: 'org-admin' }, 'run-log-scope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getRunLogs({ userId: 'u1', orgId: 'o1', role: 'user' }, 'nao-existe')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // The run's own owner still sees it (the refusal is scoping, not a broken read).
    expect((await getRunLogs({ userId: 'u1', orgId: 'o1', role: 'user' }, 'run-log-scope')).steps).toHaveLength(1);
  });
});
