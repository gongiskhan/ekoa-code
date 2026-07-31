/**
 * `cortex automations ...` - list/show automations, start runs, poll their status and logs.
 *
 * `watch` POLLS. The run SSE stream is deliberately not part of the public capability surface (it
 * is a platform-session endpoint), so a key holder observes a run exactly the way this command
 * does: `getRun` plus `getRunLogs`, on an interval. There is no hidden stream to prefer.
 */
import { intOption, noExtraPositionals, parseArgs, valueOrPositional, type ParsedArgs } from '../args.js';
import { RuntimeFailure, UsageError } from '../errors.js';
import type { CommandGroup, Ctx } from '../context.js';
import { pad, printJson, shortTime } from '../output.js';

/** A run in one of these states will never move again without a new call. */
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
/** Reached a gate that needs a human or an external system; polling further is pointless. */
const BLOCKED = new Set(['awaiting_integration', 'paused_for_user', 'awaiting_consent', 'awaiting_daemon']);

const DEFAULT_WATCH_INTERVAL_MS = 2_000;
const DEFAULT_WATCH_TIMEOUT_MS = 300_000;

const USAGE = `cortex automations <command>

  list     list the automations the caller can see
  show     show one automation          cortex automations show <automationId>
  run      start a run                  cortex automations run <automationId>
             --input k=v                repeatable; values are strings
             --inputs-json <json>       whole inputs object as JSON (mutually exclusive with --input)
             --idempotency-key <key>    at-most-once: replaying the same key returns the SAME runId
  status   one run's record             cortex automations status <runId>
  logs     one run's per-step logs      cortex automations logs <runId>
  watch    poll until the run settles   cortex automations watch <runId>
             [--interval-ms <n>] [--timeout-ms <n>]

Every command accepts --json.

REPLAY SEMANTICS: "run" answers HTTP 202 for a fresh run and HTTP 200 when an idempotency key
replays one that already exists. --json reports that as "created": true|false (and "replayed" as
its inverse) - the status is the ONLY signal that tells the two apart.`;

async function list(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 0);
  const res = await ctx.client.call('automations.list', {});
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'automations list', status: res.status, data: res.data });
    return;
  }
  if (res.data.items.length === 0) {
    ctx.io.out('no automations');
    return;
  }
  const width = Math.max(...res.data.items.map((a) => a.id.length));
  for (const a of res.data.items) ctx.io.out(`${pad(a.id, width)}  ${a.status ?? '-'}  ${a.name}`);
}

async function show(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 1);
  const id = valueOrPositional(args, 'id', 0, 'automationId');
  const res = await ctx.client.call('automations.get', { path: { id } });
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'automations show', status: res.status, data: res.data });
    return;
  }
  const a = res.data;
  ctx.io.out(`${a.id}  ${a.name}`);
  if (a.description) ctx.io.out(a.description);
  ctx.io.out(`status: ${a.status ?? '-'}   steps: ${a.plan?.steps?.length ?? 0}   updated: ${shortTime(a.updatedAt)}`);
}

async function run(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 1);
  const id = valueOrPositional(args, 'id', 0, 'automationId');
  const inputs = collectInputs(args);
  const idempotencyKey = args.values.get('idempotency-key');

  const res = await ctx.client.call('automations.createRun', {
    path: { id },
    body: {
      ...(inputs === undefined ? {} : { inputs }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    },
  });

  if (ctx.json) {
    printJson(ctx.io, {
      ok: true,
      command: 'automations run',
      status: res.status,
      created: res.created,
      replayed: res.replayed,
      data: res.data,
    });
    return;
  }
  ctx.io.out(
    res.created
      ? `started run ${res.data.runId} (HTTP ${res.status}, fresh)`
      : `replayed run ${res.data.runId} (HTTP ${res.status}, idempotent - nothing new was started)`,
  );
}

/** `--input k=v` (repeatable) or `--inputs-json '{...}'`, never both. */
function collectInputs(args: ParsedArgs): Record<string, unknown> | undefined {
  const pairs = args.multi.get('input');
  const raw = args.values.get('inputs-json');
  if (pairs && raw !== undefined) throw new UsageError('--input and --inputs-json are mutually exclusive');
  if (raw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (cause) {
      throw new UsageError(`--inputs-json is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new UsageError('--inputs-json must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  }
  if (!pairs) return undefined;
  const inputs: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new UsageError(`--input must be key=value, got "${pair}"`);
    inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return inputs;
}

async function status(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 1);
  const id = valueOrPositional(args, 'id', 0, 'runId');
  const res = await ctx.client.call('automations.getRun', { path: { id } });
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'automations status', status: res.status, data: res.data });
    return;
  }
  printRun(ctx, res.data);
}

async function logs(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 1);
  const id = valueOrPositional(args, 'id', 0, 'runId');
  const res = await ctx.client.call('automations.getRunLogs', { path: { id } });
  if (ctx.json) {
    printJson(ctx.io, { ok: true, command: 'automations logs', status: res.status, data: res.data });
    return;
  }
  if (res.data.steps.length === 0) {
    ctx.io.out(`run ${res.data.runId}: no step logs`);
    return;
  }
  for (const step of res.data.steps) {
    ctx.io.out(`-- step ${step.stepIndex}${step.truncated ? ' (truncated)' : ''}`);
    ctx.io.out(step.log);
  }
}

async function watch(ctx: Ctx, args: ParsedArgs): Promise<void> {
  noExtraPositionals(args, 1);
  const id = valueOrPositional(args, 'id', 0, 'runId');
  const intervalMs = intOption(args, 'interval-ms', 100, 60_000) ?? DEFAULT_WATCH_INTERVAL_MS;
  const timeoutMs = intOption(args, 'timeout-ms', 100, 3_600_000) ?? DEFAULT_WATCH_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  let polls = 0;
  let last = '';
  for (;;) {
    const res = await ctx.client.call('automations.getRun', { path: { id } });
    polls += 1;
    const record = res.data;
    const settled = TERMINAL.has(record.status) || BLOCKED.has(record.status);

    if (!ctx.json && record.status !== last) {
      ctx.io.out(`${new Date().toISOString()}  ${record.id}  ${record.status}`);
      last = record.status;
    }
    if (settled) {
      if (ctx.json) {
        printJson(ctx.io, {
          ok: true,
          command: 'automations watch',
          status: res.status,
          polls,
          terminal: TERMINAL.has(record.status),
          blocked: BLOCKED.has(record.status),
          data: record,
        });
        return;
      }
      printRun(ctx, record);
      return;
    }
    if (Date.now() + intervalMs > deadline) {
      // Ran out of patience: the invocation was fine and the work did not settle, so this is a
      // runtime failure (exit 1), never usage.
      throw new RuntimeFailure('WATCH_TIMEOUT', `run ${id} was still "${record.status}" after ${timeoutMs} ms`);
    }
    await sleep(intervalMs);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function printRun(ctx: Ctx, record: { id: string; automationId: string; status: string; summary?: string; startedAt?: string; finishedAt?: string }): void {
  ctx.io.out(`run ${record.id}  automation ${record.automationId}  ${record.status}`);
  ctx.io.out(`started: ${shortTime(record.startedAt)}   finished: ${shortTime(record.finishedAt)}`);
  if (record.summary) ctx.io.out(record.summary);
}

export const automationsCommand: CommandGroup = {
  name: 'automations',
  summary: 'automations: list, show, run (202 fresh / 200 replay), status, logs, watch',
  usage: USAGE,
  async run(ctx, argv) {
    const [sub, ...rest] = argv;
    switch (sub) {
      case 'list':
        return list(ctx, parseArgs(rest, {}));
      case 'show':
        return show(ctx, parseArgs(rest, { values: ['id'] }));
      case 'run':
        return run(ctx, parseArgs(rest, { values: ['id', 'inputs-json', 'idempotency-key'], multi: ['input'] }));
      case 'status':
        return status(ctx, parseArgs(rest, { values: ['id'] }));
      case 'logs':
        return logs(ctx, parseArgs(rest, { values: ['id'] }));
      case 'watch':
        return watch(ctx, parseArgs(rest, { values: ['id', 'interval-ms', 'timeout-ms'] }));
      default:
        throw new UsageError(sub === undefined ? 'automations needs a command' : `unknown command "automations ${sub}"`);
    }
  },
};
