/**
 * Local-command step executor.
 *
 * Runs argv-array commands on the user's machine via the local ekoa
 * daemon's `bash` capability (executor face), dispatched over the bridge
 * control channel. Phase 5 of the executor-face migration replaced the
 * in-process `DirectLocalExecutor.spawn()` with this daemon round-trip —
 * the command now executes on the user's real machine, not the Cortex
 * host. All other logic (consent, interpolation, truncation, timeout and
 * exit-code handling, the `LocalCommandResolved` / `StepOutput` shapes,
 * the streamed output chunks) is preserved.
 *
 * Consent: first-time use of any new command shape requires the user to
 * approve once / always / stop. Approvals are keyed by user.preferences
 * and resolved via the resolve-consent intent on automations-handler.
 */

import type {
  Step,
  StepRecord,
  Automation,
  LocalCommandResolved,
} from '../types.js';
import type { RunContext } from '../engine.js';
import { computeCommandShape, describeCommandShape } from '../command-shape.js';
import { getDaemonConnection } from '../seams.js';
import { isCommandShapeApproved, recordApprovalUse } from '../consent.js';
import { applyArgsTemplate } from '../template-vars.js';

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

interface ExecuteLocalCommandArgs {
  step: Step;
  index: number;
  runId: string;
  automation: Automation;
  ctx: RunContext;
  inputs: Record<string, unknown>;
  baseRecord: StepRecord;
  stepStart: number;
  finishRecord: (
    base: StepRecord,
    status: StepRecord['status'],
    stepStart: number,
    extras: {
      tier?: StepRecord['tier'];
      resolvedAction?: import('../types.js').ResolvedAction;
      error?: { message: string; recoverable: boolean; details?: unknown };
      output?: import('../types.js').StepOutput;
    },
  ) => StepRecord;
  emitChunk?: (info: { runId: string; stepIndex: number; chunk: string; stream: 'stdout' | 'stderr' }) => void;
}

/** Structured payload the daemon's `bash` capability returns under observation.data. */
interface BashObservationData {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  truncated?: boolean;
}

export async function executeLocalCommandStep(
  args: ExecuteLocalCommandArgs,
): Promise<StepRecord> {
  const { step, index, runId, ctx, inputs, baseRecord, stepStart, finishRecord, emitChunk } = args;

  const spec = step.commandTemplate;
  if (!spec || !Array.isArray(spec.argv) || spec.argv.length === 0) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: `local_command step ${step.id} missing commandTemplate.argv`,
        recoverable: false,
      },
    });
  }

  // Interpolate template vars in argv, cwd, stdin
  const interpolatedArgv = spec.argv.map((arg) => applyArgsTemplate({ x: arg }, inputs).x as string);
  const interpolatedCwd = spec.cwd ? (applyArgsTemplate({ x: spec.cwd }, inputs).x as string) : undefined;
  const interpolatedStdin = spec.stdin ? (applyArgsTemplate({ x: spec.stdin }, inputs).x as string) : undefined;

  const shape = computeCommandShape(interpolatedArgv);
  const timeoutMs = Math.min(spec.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  // Consent check. Scoped to the tenant AND the machine (J-7): "yes, run this on my work laptop"
  // was never an answer about a machine paired later. Resolved here rather than reusing the
  // defensive re-resolve below so the SCOPE is fixed before the approval is looked up; the control
  // flow is unchanged (a missing daemon still surfaces as awaiting_consent first, then
  // awaiting_daemon, exactly as before).
  const scope = {
    userId: ctx.ownerUserId,
    orgId: ctx.orgId,
    pairingId: getDaemonConnection(ctx.ownerUserId)?.pairingId ?? null,
  };
  // "Permitir uma vez" lives on the run, not in the store, and is checked FIRST so a one-off answer
  // never touches the durable approvals — that is the whole distinction between `once` and
  // `sempre`. Before this existed, `once` set the resume flag, the step re-ran, this lookup found
  // nothing (correctly, since `once` persists nothing) and the same dialog returned: a loop whose
  // only exits were the two answers the user had just declined to give.
  const isApproved =
    ctx.runApprovedShapes?.has(shape) === true || (await isCommandShapeApproved(scope, shape));

  if (!isApproved) {
    // Mark step as awaiting consent; engine's caller will surface
    // through pauseRunForUser-style flow.
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: `awaiting_consent:${shape}`,
        recoverable: true,
        details: {
          kind: 'awaiting_consent',
          shape,
          argv: interpolatedArgv,
          description: describeCommandShape(shape, interpolatedArgv),
          stepIndex: index,
          // The SCOPE the answer will be banked in, decided by the party that is asking. An
          // "approve always" is looked up again right here, by this exact key — so if the resolver
          // re-derived the scope on its own it could bank a row this lookup never reads, and the
          // user would re-approve the same command forever. It travels with the question instead.
          approvalScope: scope,
        },
      },
    });
  }

  // Bump approval lastUsedAt (fire-and-forget)
  void recordApprovalUse(scope, shape).catch(() => {});

  // The bash capability runs on the local daemon. The engine only reaches
  // this executor after confirming a daemon is connected, but re-resolve
  // defensively: a connection can drop between the check and here.
  const connection = getDaemonConnection(ctx.ownerUserId);
  if (!connection) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: 'local ekoa daemon not connected — this local command step needs your local Ekoa running',
        recoverable: false,
        details: { kind: 'awaiting_daemon', capability: 'bash', stepIndex: index },
      },
      resolvedAction: makeResolved(interpolatedArgv, interpolatedCwd, shape, timeoutMs, interpolatedStdin),
    });
  }

  const resolved = makeResolved(interpolatedArgv, interpolatedCwd, shape, timeoutMs, interpolatedStdin);

  // Dispatch to the daemon and stream output chunks to the UI. The control
  // channel's step_progress carries a single undiscriminated chunk; we
  // surface streamed chunks as stdout (the dominant stream). The
  // authoritative stdout/stderr split comes from the final observation.
  const spawnStart = Date.now();
  let env;
  try {
    env = await connection.runStep(
      {
        capability: 'bash',
        input: {
          argv: interpolatedArgv,
          cwd: interpolatedCwd,
          stdin: interpolatedStdin,
          timeoutMs,
        },
        // Cofre J-4 (I9): a secret reaches a child process ONLY through
        // cofre/process-injection.ts, from a declared name -> `cofre:` REFERENCE mapping resolved
        // through unwrap(). Nothing here reads the Cortex server's own environment, and no value
        // passes through this module at all - the mapping goes out on the seam and the composition
        // root authorises, resolves and delivers it under the step's own invocation id.
        //
        // This used to read `env: undefined` on the input, beside a comment describing a delivery
        // that had no caller anywhere: `authoriseDelivery`/`deliverSecrets` were built, tested, and
        // invoked by nothing. A step declaring a credential simply ran without it.
        ...(spec.envRefs && Object.keys(spec.envRefs).length > 0
          ? { secretEnv: spec.envRefs, actor: { userId: ctx.ownerUserId, orgId: ctx.orgId, role: 'user' as const } }
          : {}),
        stepId: step.id,
        runId,
      },
      {
        onProgress: emitChunk
          ? (chunk) => emitChunk({ runId, stepIndex: index, chunk, stream: 'stdout' })
          : undefined,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const duration = Date.now() - spawnStart;
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: { message: `local_command dispatch failed: ${message}`, recoverable: true },
      output: {
        kind: 'local_command',
        stdout: '',
        stderr: `\n[dispatch error] ${message}`,
        exitCode: null,
        durationMs: duration,
        truncated: false,
        timedOut: false,
      },
      resolvedAction: resolved,
    });
  }

  const duration = Date.now() - spawnStart;
  const data = (env.observation?.data ?? {}) as BashObservationData;

  // Apply the same 5 MB cap the in-process executor enforced.
  let truncated = data.truncated === true || env.meta?.truncated === true;
  let stdout = typeof data.stdout === 'string' ? data.stdout : '';
  let stderr = typeof data.stderr === 'string' ? data.stderr : '';
  if (stdout.length > MAX_OUTPUT_BYTES) {
    stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
    truncated = true;
  }
  if (stderr.length > MAX_OUTPUT_BYTES) {
    stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
    truncated = true;
  }
  const exitCode = typeof data.exitCode === 'number' ? data.exitCode : null;
  const timedOut = data.timedOut === true;

  const output: import('../types.js').StepOutput = {
    kind: 'local_command',
    stdout,
    stderr,
    exitCode,
    durationMs: duration,
    truncated,
    timedOut,
  };

  // A daemon-side failure that isn't a normal nonzero-exit (e.g. the
  // capability couldn't spawn) surfaces as an !ok envelope.
  if (!env.ok && exitCode === null && !timedOut) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: env.error?.message ?? 'local_command failed on daemon',
        recoverable: env.error?.retryable !== false,
      },
      output,
      resolvedAction: resolved,
    });
  }

  // Outcome verification
  if (timedOut) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: { message: `command timed out after ${timeoutMs}ms`, recoverable: true },
      output,
      resolvedAction: resolved,
    });
  }

  if (exitCode !== 0) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: `command exited with code ${exitCode}${stderr ? `: ${stderr.split('\n').slice(0, 3).join(' ')}` : ''}`,
        recoverable: true,
      },
      output,
      resolvedAction: resolved,
    });
  }

  return finishRecord(baseRecord, 'completed', stepStart, {
    tier: 'cache',
    output,
    resolvedAction: resolved,
  });
}

function makeResolved(argv: string[], cwd: string | undefined, shape: string, timeoutMs: number, stdin?: string): LocalCommandResolved {
  return { kind: 'local_command', argv, cwd, shape, timeoutMs, stdin };
}

