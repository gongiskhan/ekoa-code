import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { executeLocalCommandStep } from '../../src/automation/executors/local-command.js';
import {
  approveCommandShape,
  revokeCommandShape,
  isCommandShapeApproved,
  listApprovedShapes,
} from '../../src/automation/consent.js';
import { computeCommandShape } from '../../src/automation/command-shape.js';
import { setDaemonConnectionResolver, __resetAutomationSeamsForTests, type ResultEnvelope } from '../../src/automation/seams.js';
import { approvedCommands } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb } from '../agents/_setup.js';
import type { RunContext } from '../../src/automation/engine.js';
import type { Automation, Step, StepRecord } from '../../src/automation/types.js';

/**
 * local_command consent (ch05 §5.6.7; §13.4). Exercises the once / always / stop flow and the
 * revoke, backed by the registered `approved_commands` store (data/stores.ts):
 *   - APPROVE-ALWAYS persists the command shape so it never re-prompts.
 *   - "once" and "stop" persist nothing (the shape stays un-approved next run — the engine's
 *     awaiting_consent → resume-without-persist / cancel paths).
 *   - REVOKE removes a previously approved shape.
 * Plus the executor-level consent gate: an un-approved shape halts as awaiting_consent, an approved
 * one dispatches to the daemon and completes.
 */
const ctx: RunContext = {
  ownerUserId: 'u1',
  orgId: 'o1',
  triggeredBy: 'user',
  visitedAutomationIds: new Set(),
  traceId: 't1',
};

const automation: Automation = {
  id: 'a1', name: 'A', description: '', steps: [], ownerUserId: 'u1', createdAt: '', updatedAt: '',
};

const finishRecord = (
  base: StepRecord,
  status: StepRecord['status'],
  _stepStart: number,
  extras: Record<string, unknown>,
): StepRecord => ({ ...base, status, durationMs: 0, ...extras } as StepRecord);

function localCmdStep(argv: string[]): Step {
  return { id: 's1', description: 'run a command', type: 'local_command', commandTemplate: { argv } };
}

function runExec(step: Step) {
  const baseRecord: StepRecord = { stepId: step.id, index: 0, status: 'running', tier: 'cache', durationMs: 0 };
  return executeLocalCommandStep({
    step, index: 0, runId: 'r1', automation, ctx, inputs: {}, baseRecord, stepStart: Date.now(), finishRecord,
  });
}

describe('local_command consent (§5.6.7)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_consent'));
  afterAll(shutdownAgentTestDb);
  beforeEach(() => { __resetAutomationSeamsForTests(); });
  afterEach(async () => { __resetAutomationSeamsForTests(); await approvedCommands.deleteMany({}); });

  // ---- consent module: approved_commands persistence + revoke -------------

  it('approve-always persists the shape; isApproved sees it; listApprovedShapes returns it', async () => {
    const shape = computeCommandShape(['bash', '-c', 'ls | wc -l']); // "bash -c <SCRIPT>"
    expect(await isCommandShapeApproved('u1', shape)).toBe(false);

    await approveCommandShape('u1', shape);
    expect(await isCommandShapeApproved('u1', shape)).toBe(true);
    expect(await listApprovedShapes('u1')).toContain(shape);

    // owner-scoped: another user does not inherit the approval
    expect(await isCommandShapeApproved('u2', shape)).toBe(false);
  });

  it('revoke removes a previously approved shape (the kill switch)', async () => {
    const shape = 'cat <FILE>';
    await approveCommandShape('u1', shape);
    expect(await isCommandShapeApproved('u1', shape)).toBe(true);

    const removed = await revokeCommandShape('u1', shape);
    expect(removed).toBe(true);
    expect(await isCommandShapeApproved('u1', shape)).toBe(false);
    expect(await listApprovedShapes('u1')).not.toContain(shape);
  });

  it('"once" / "stop" persist nothing: an un-approved shape stays un-approved', async () => {
    // The engine's awaiting_consent path resumes ("once") or cancels ("stop") WITHOUT calling
    // approveCommandShape, so the store never gains a row.
    expect(await isCommandShapeApproved('u1', 'ls -la <DIR>')).toBe(false);
    expect(await listApprovedShapes('u1')).toHaveLength(0);
  });

  // ---- executor-level consent gate ---------------------------------------

  it('an un-approved command halts the step as awaiting_consent (not executed)', async () => {
    // No daemon needed — the consent gate fires before any dispatch.
    const record = await runExec(localCmdStep(['ls', '-la', '/tmp']));
    expect(record.status).toBe('failed');
    const details = record.error?.details as { kind?: string; shape?: string; argv?: string[]; description?: string } | undefined;
    expect(details?.kind).toBe('awaiting_consent');
    expect(details?.shape).toBe('ls -la <DIR>');
    expect(details?.argv).toEqual(['ls', '-la', '/tmp']);
    expect(typeof details?.description).toBe('string');
  });

  it('an approved command dispatches to the daemon and completes', async () => {
    await approveCommandShape('u1', 'ls -la <DIR>');
    const env: ResultEnvelope = { ok: true, observation: { data: { exitCode: 0, stdout: 'total 0', stderr: '' } } };
    setDaemonConnectionResolver(() => ({ runStep: async () => env }));

    const record = await runExec(localCmdStep(['ls', '-la', '/tmp']));
    expect(record.status).toBe('completed');
    expect(record.output?.kind).toBe('local_command');
    if (record.output?.kind === 'local_command') {
      expect(record.output.exitCode).toBe(0);
      expect(record.output.stdout).toBe('total 0');
    }
  });

  it('a nonzero exit from an approved command fails the step (recoverable)', async () => {
    await approveCommandShape('u1', 'ls -la <DIR>');
    const env: ResultEnvelope = { ok: true, observation: { data: { exitCode: 2, stdout: '', stderr: 'boom' } } };
    setDaemonConnectionResolver(() => ({ runStep: async () => env }));

    const record = await runExec(localCmdStep(['ls', '-la', '/tmp']));
    expect(record.status).toBe('failed');
    expect(record.error?.recoverable).toBe(true);
    expect(record.error?.message).toContain('exited with code 2');
  });
});
