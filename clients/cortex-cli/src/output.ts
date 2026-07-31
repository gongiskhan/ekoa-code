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
