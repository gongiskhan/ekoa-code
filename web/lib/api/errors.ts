/**
 * web/ transport error model (ch12 §12.2.2).
 *
 * Every failure surfaced by the request core is an {@link ApiError}: HTTP errors carry
 * the server status + the UPPER_SNAKE `code` from the shared error envelope
 * (`shared/errors.ts`); transport failures carry `status: 0` and a client-side code
 * (`NETWORK_ERROR` / `TIMEOUT` / `ABORTED`). Contract-validation failures in dev/test use
 * `status: 0` + `CONTRACT_MISMATCH` (the ch13 contract test asserts this). Messages are
 * user-safe and PT-aware because they are already sanitised at the API egress (FIXED-8).
 *
 * The old `{ success, data?, error? }` envelope object is retired with the old client
 * (FC-019/FC-020). `tryCall` lets stores written in the non-throwing style migrate
 * mechanically.
 */

export class ApiError extends Error {
  /** HTTP status, or 0 for a client-side failure (network / timeout / abort / contract). */
  readonly status: number;
  /** UPPER_SNAKE code from the shared envelope, or NETWORK_ERROR / TIMEOUT / ABORTED / CONTRACT_MISMATCH. */
  readonly code: string;
  /** Optional structured context (zod issues, safetyNetSnapshotId, conflict details, ...). */
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    // Restore the prototype chain across the ES5 target transpilation so `instanceof` holds.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export type CallResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/**
 * Wrap a throwing client call in the non-throwing `{ ok, data | error }` result style
 * (ch12 §12.2.2). Any thrown value that is not already an {@link ApiError} is normalised
 * to one so callers only ever handle a single error type.
 */
export async function tryCall<T>(fn: () => Promise<T>): Promise<CallResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error };
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: new ApiError(0, 'NETWORK_ERROR', message) };
  }
}
