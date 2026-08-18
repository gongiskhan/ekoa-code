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
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ledgerAutomation, Tier2Error, type Tier2Context } from './context.js';

const execP = promisify(exec);

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
