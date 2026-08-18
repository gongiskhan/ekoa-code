/**
 * tools/tier2/bash.ts — the Tier-2 `bash` tool (ADR-002, build-only). Runs a shell command with the
 * mandatory Tier-2 safety controls: a timeout that kills the child, an output cap, and a SCRUBBED
 * environment (only a small allowlist is passed; secrets in the daemon's own env never reach the
 * child). Refuses (ledgered) unless the session has the automation tier explicitly enabled.
 *
 * This tier is exfiltration-capable by nature (a shell can curl); it is NOT contained by S5, is NOT
 * reachable from a file-tier delegation (that path's TaskProgram schema has no `bash` step, so such a
 * task is refused S3 before any tool runs), and is excluded from every claim + the custody map.
 */
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ContainmentError, resolveWithinGrant } from '../../containment/index.js';
import { ledgerAutomation, Tier2Error, type Tier2Context } from './context.js';

const execP = promisify(exec);
const execFileP = promisify(execFile);

/** The ONLY environment variables passed to a Tier-2 child. Everything else (API keys, tokens the
 *  daemon holds) is scrubbed — a child never inherits the daemon's secrets. */
const ENV_ALLOWLIST = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TZ'] as const;
const DEFAULT_TIMEOUT_MS = 30_000;
/** Output cap (bytes) for stdout and stderr each — a runaway child is killed at the buffer limit. */
const OUTPUT_CAP_BYTES = 256 * 1024;

export interface BashOptions {
  timeoutMs?: number;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
}

/** Build the scrubbed child environment from the allowlist only. */
function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const v = process.env[key];
    if (typeof v === 'string') env[key] = v;
  }
  return env;
}

// ---------------------------------------------------------------------------
// The ARGV form - what a bridge `local_command` step actually sends.
// ---------------------------------------------------------------------------

export interface BashArgvOptions extends BashOptions {
  /**
   * Working directory REQUEST. Resolved through the containment resolver against `grantRoot`
   * before it is honoured; a cwd that escapes the grant throws `ContainmentError` and the step is
   * denied. Absent means "the grant root itself".
   */
  cwd?: string;
  /**
   * The real root this step's grant names. REQUIRED for a cwd to be honoured at all: without a
   * grant there is nothing to jail against, and the previous behaviour - inheriting the DAEMON'S
   * OWN process cwd, unbounded - meant a bash step ran wherever the daemon happened to be started
   * from and could `cd` anywhere on the machine. That was the gap; this closes it.
   */
  grantRoot?: string;
  /** Extra environment for the child, on TOP of the scrubbed allowlist. The I9 injection point:
   *  values arrive from `SecretHold.withChildEnv`, exist for the spawn, and are zeroized after. */
  env?: Record<string, string>;
  /** Piped to the child's stdin, then closed. */
  stdin?: string;
}

/**
 * Run an argv vector with the Tier-2 controls: enablement gate, timeout, output cap, scrubbed
 * environment, AND a cwd jailed to the step's grant.
 *
 * NO SHELL. `execFile` spawns the executable directly, so an argument can never become shell
 * syntax - which matters more here than in the string form because these arguments are built
 * hosted-side by interpolating run inputs into a template.
 */
export async function bashArgv(ctx: Tier2Context, argv: string[], opts: BashArgvOptions = {}): Promise<BashResult> {
  const detail = argv.join(' ');
  if (!ctx.enablement.isEnabled(ctx.session)) {
    ledgerAutomation(ctx, 'bash', detail, 'denied', undefined, 'automation tier not enabled for this session');
    throw new Tier2Error('automation tier not enabled for this session', 'disabled');
  }
  const file = argv[0];
  if (file === undefined || file.length === 0) {
    ledgerAutomation(ctx, 'bash', detail, 'denied', undefined, 'empty command');
    throw new Tier2Error('empty command', 'error');
  }

  // THE JAIL. Resolved through the SINGLE containment resolver (S1), never re-derived here.
  let cwd: string | undefined;
  if (opts.grantRoot !== undefined) {
    try {
      cwd = resolveWithinGrant(opts.grantRoot, opts.cwd ?? '.');
    } catch (err) {
      const reason = err instanceof ContainmentError ? err.reason : String(err);
      ledgerAutomation(ctx, 'bash', detail, 'denied', undefined, reason);
      throw new Tier2Error(reason, 'error');
    }
  } else if (opts.cwd !== undefined) {
    // A cwd with no grant to bound it is refused rather than silently honoured. Honouring it is
    // precisely the unbounded behaviour this function exists to replace.
    const reason = 'a working directory needs a grant to be bounded by';
    ledgerAutomation(ctx, 'bash', detail, 'denied', undefined, reason);
    throw new Tier2Error(reason, 'error');
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = { ...scrubbedEnv(), ...(opts.env ?? {}) };
  const spawnOpts = {
    timeout: timeoutMs,
    killSignal: 'SIGKILL' as const,
    maxBuffer: OUTPUT_CAP_BYTES,
    env,
    windowsHide: true,
    ...(cwd !== undefined ? { cwd } : {}),
  };

  try {
    const child = execFileP(file, argv.slice(1), spawnOpts);
    if (opts.stdin !== undefined) {
      child.child.stdin?.end(opts.stdin);
    }
    const { stdout, stderr } = await child;
    ledgerAutomation(ctx, 'bash', detail, 'ran', 0);
    return { stdout, stderr, exitCode: 0, timedOut: false, truncated: false };
  } catch (err) {
    const e = err as { killed?: boolean; signal?: string; code?: number | string; stdout?: string; stderr?: string };
    const timedOut = e.killed === true && (e.signal === 'SIGKILL' || e.signal === 'SIGTERM');
    const truncated = e.code === 'ERR_CHILD_PROCESS_STDOUT_MAXBUFFER';
    if (timedOut && !truncated) {
      ledgerAutomation(ctx, 'bash', detail, 'timeout', undefined, `killed after ${timeoutMs}ms`);
      throw new Tier2Error(`command timed out after ${timeoutMs}ms`, 'timeout');
    }
    const exitCode = typeof e.code === 'number' ? e.code : -1;
    ledgerAutomation(ctx, 'bash', detail, 'ran', exitCode, truncated ? 'output truncated at cap' : undefined);
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode, timedOut, truncated };
  }
}

export async function bash(ctx: Tier2Context, command: string, opts: BashOptions = {}): Promise<BashResult> {
  // Enablement gate (ADR-002): OFF by default; a disabled session is refused + ledgered.
  if (!ctx.enablement.isEnabled(ctx.session)) {
    ledgerAutomation(ctx, 'bash', command, 'denied', undefined, 'automation tier not enabled for this session');
    throw new Tier2Error('automation tier not enabled for this session', 'disabled');
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const { stdout, stderr } = await execP(command, {
      shell: '/bin/sh',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: OUTPUT_CAP_BYTES,
      env: scrubbedEnv(),
      windowsHide: true,
    });
    ledgerAutomation(ctx, 'bash', command, 'ran', 0);
    return { stdout, stderr, exitCode: 0, timedOut: false, truncated: false };
  } catch (err) {
    const e = err as { killed?: boolean; signal?: string; code?: number | string; stdout?: string; stderr?: string };
    // A timeout kills the child (killed + signal). A maxBuffer overflow is also a kill with a
    // truncated capture. A non-zero exit sets a numeric `code`. All are ledgered distinctly.
    const timedOut = e.killed === true && (e.signal === 'SIGKILL' || e.signal === 'SIGTERM');
    const truncated = e.code === 'ERR_CHILD_PROCESS_STDOUT_MAXBUFFER';
    if (timedOut && !truncated) {
      ledgerAutomation(ctx, 'bash', command, 'timeout', undefined, `killed after ${timeoutMs}ms`);
      throw new Tier2Error(`command timed out after ${timeoutMs}ms`, 'timeout');
    }
    const exitCode = typeof e.code === 'number' ? e.code : -1;
    ledgerAutomation(ctx, 'bash', command, 'ran', exitCode, truncated ? 'output truncated at cap' : undefined);
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode,
      timedOut,
      truncated,
    };
  }
}
