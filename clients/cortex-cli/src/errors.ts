/**
 * The two LOCAL failure classes, kept apart because they mean different things to a caller:
 *
 *  - `UsageError` (exit 2) - the invocation was wrong, and NOTHING WAS SENT. That second half is a
 *    promise: a command may only raise it before it makes a request.
 *  - `RuntimeFailure` (exit 1) - the invocation was fine and the work did not complete: a watch
 *    that ran out of patience, an export that arrived but could not be written to disk. It sits
 *    with the wrapper's own api/timeout/network failures, never with usage.
 *
 * (The remote failures - `CortexApiError`, `CortexTimeoutError`, `CortexNetworkError` - live in
 * client.ts, beside the wrapper that raises them.)
 */

/** The caller got the invocation wrong. Always exit 2, and always before any request. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
  readonly code = 'USAGE';
}

/** The work did not complete, and it is not the caller's invocation that was wrong. Exit 1. */
export class RuntimeFailure extends Error {
  override readonly name = 'RuntimeFailure';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
