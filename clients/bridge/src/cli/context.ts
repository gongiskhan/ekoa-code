/**
 * cli/context.ts — the injected environment every command runs against, plus argv parsing.
 *
 * Commands take a CliContext instead of touching process/globals directly, so tests drive them with a
 * scratch home, captured IO, a fake `fetch`, a fake clock/sleep, and a stubbed folder picker — no real
 * network, no real waits, no GUI. `defaultContext()` wires the real process for the shipped binary.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { platform } from 'node:os';
import { ekoaBridgeHome, type FetchLike } from '../auth/index.js';

/** Process exit codes: 0 ok, 1 error, 2 usage (task S7 contract). */
export const EXIT = { OK: 0, ERROR: 1, USAGE: 2 } as const;

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
}

/** Result of the native folder picker: a path, or why none was chosen. */
export type PickFolderResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'unavailable' | 'cancelled' };

export interface CliContext {
  home: string;
  io: CliIO;
  fetchImpl: FetchLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  env: NodeJS.ProcessEnv;
  /** Native folder picker for `grant` (macOS osascript); unavailable on CI / non-macOS. */
  pickFolder: (promptText: string) => Promise<PickFolderResult>;
  /** Short random suffix for pairing ids / grant refs (injectable for deterministic tests). */
  randomSuffix: () => string;
}

/** Parse `--key value`, `--key=value`, and boolean `--flag` argv; everything else is a positional. */
export function parseFlags(args: string[]): {
  positionals: string[];
  flags: Map<string, string | true>;
} {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags.set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(body, next);
        i += 1;
      } else {
        flags.set(body, true);
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

/** A flag's string value, or undefined when absent / a bare boolean / empty. */
export function flagStr(flags: Map<string, string | true>, key: string): string | undefined {
  const v = flags.get(key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Native macOS folder picker via osascript. Never runs on CI or off macOS (returns 'unavailable'). */
function osascriptPickFolder(promptText: string, env: NodeJS.ProcessEnv): Promise<PickFolderResult> {
  if (env.CI || platform() !== 'darwin') {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
  const script = `POSIX path of (choose folder with prompt ${JSON.stringify(promptText)})`;
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 120_000 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, reason: 'cancelled' }); // user cancelled the dialog, or it timed out
        return;
      }
      const path = stdout.trim();
      resolve(path.length > 0 ? { ok: true, path } : { ok: false, reason: 'cancelled' });
    });
  });
}

/** The real process-backed context for the shipped binary. */
export function defaultContext(env: NodeJS.ProcessEnv = process.env): CliContext {
  return {
    home: ekoaBridgeHome(env),
    io: {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
    fetchImpl: fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    env,
    pickFolder: (promptText) => osascriptPickFolder(promptText, env),
    randomSuffix: () => randomBytes(4).toString('hex'),
  };
}
