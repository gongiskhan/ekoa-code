/**
 * Output discipline, in one place.
 *
 * `--json` prints ONE document to stdout and nothing else, so a caller can `JSON.parse(stdout)`
 * without stripping chatter. Failures never contaminate that stream: the error document goes to
 * stderr and stdout stays empty. Human mode prints plain lines - no colour, no emoji, no spinner,
 * because every consumer here is a log, a pipe or an agent transcript.
 */

/** The three exit codes this CLI uses. Nothing else is ever returned. */
export const EXIT_OK = 0;
/** A refusal from Cortex, a timeout, or a network failure. */
export const EXIT_API_ERROR = 1;
/** The caller got the invocation wrong (bad flag, missing argument, missing configuration). */
export const EXIT_USAGE = 2;

/** Injected so tests can drive the CLI without touching the real process streams. */
export interface Io {
  out(text: string): void;
  err(text: string): void;
  outBytes(bytes: Buffer): void;
}

export const processIo: Io = {
  out(text) {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  },
  err(text) {
    process.stderr.write(text.endsWith('\n') ? text : `${text}\n`);
  },
  outBytes(bytes) {
    process.stdout.write(bytes);
  },
};

/**
 * Survive a reader that walks away.
 *
 * `cortex memory export --out - | tar -tf -` and `... --json | head` are documented patterns, and
 * both close the read end early. Without this, the write raises EPIPE on a stream with no `error`
 * listener, which is an uncaught exception: a raw Node stack on stderr and an exit code that never
 * came from `main()` - the exact thing the three-code contract above promises cannot happen.
 *
 * The conventional shape for a CLI is to stop quietly: the reader got what it wanted, and its own
 * exit code is what the shell reports. Any other stream error is left to blow up, because it is a
 * real fault and hiding it would be the same mistake in the other direction.
 *
 * The two streams are NOT symmetric, and treating them as such is a data-loss bug. STDOUT carries
 * the result, so a reader that closed early already got what it asked for and EXIT_OK is honest.
 * STDERR is only written on the FAILURE path, so exiting 0 there reports a failed command as a
 * success - and the spool drain deletes a capture on exit 0, so `cortex memory write ... 2>&1 |
 * head` would discard a note that never landed. A stderr EPIPE therefore swallows the error and
 * leaves whatever exit code the run already determined untouched.
 *
 * Installed from the binary entry point only - importing this module must not attach handlers to
 * a host process's streams.
 */
export function installPipeGuard(exit: (code: number) => never = process.exit.bind(process)): void {
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') exit(EXIT_OK);
    else throw error;
  });
  process.stderr.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error;
    // Swallow only: the command's own outcome still decides the exit code.
  });
}

/** The success document every `--json` invocation prints. */
export interface JsonSuccess {
  ok: true;
  command: string;
  /** The HTTP status of the call this command made, where it made exactly one. */
  status?: number;
  [key: string]: unknown;
}

export function printJson(io: Io, doc: Record<string, unknown>): void {
  io.out(JSON.stringify(doc, null, 2));
}

export function printJsonError(
  io: Io,
  command: string,
  error: { code: string; message: string; status?: number; details?: unknown },
): void {
  io.err(JSON.stringify({ ok: false, command, error }, null, 2));
}

/** `2026-07-31T09:12:33.000Z` -> `2026-07-31 09:12` for human listings. */
export function shortTime(iso: string | undefined): string {
  if (!iso) return '-';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return new Date(at).toISOString().slice(0, 16).replace('T', ' ');
}

/** Left-pad a column so a listing lines up without pulling in a table library. */
export function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}
