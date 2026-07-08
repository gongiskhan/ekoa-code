import { z } from 'zod';

/**
 * The error envelope (CONV-2, ch03 §3.3). Every non-2xx response carries this shape
 * with a correct HTTP status. `code` is stable UPPER_SNAKE; `message` is user-safe
 * and PT-aware; `details` is optional structured context. Every error message passes
 * the egress anonymisation/sanitisation chokepoint before leaving the process (FIXED-8).
 */
export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'BILLING_BLOCKED',
  'BILLING_LOCKED',
  'FORBIDDEN',
  'ACCOUNT_DISABLED',
  'NOT_FOUND',
  'DAEMON_NOT_CONNECTED',
  'DUPLICATE_BUILD',
  'SLUG_TAKEN',
  'MANIFEST_ID_MISMATCH',
  'TRIGGER_DISABLED',
  'PAYLOAD_TOO_LARGE',
  'SECRET_GUARD_BLOCKED',
  'RATE_LIMITED',
  'INTERNAL',
  'UPSTREAM_FAILED',
  'UPSTREAM_UNAVAILABLE',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * `details` is bounded to plain JSON values (scalars, arrays, nested records) - NOT `unknown`.
 * This is a contract-level egress guard (ch09 §9.3 invariant 2, error sanitisation to clients):
 * a raw driver error, an `Error` instance, a stack-trace object, a `Buffer`, or any class
 * instance carries non-plain / non-enumerable / circular structure and does NOT satisfy this
 * schema, so it cannot validate as a legal error body. Legitimate details - zod validation
 * `issues`, a `billingUrl`, a `reason`, a `retryAfter` - are all plain JSON and pass. Runtime
 * sanitisation (FIXED-8) remains the primary control; this makes the contract test a guard too.
 */
export const JsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValue), z.record(JsonValue)]),
);
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(JsonValue).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

/** Canonical HTTP status per error code (ch03 §3.3 status table). */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  BILLING_BLOCKED: 402,
  BILLING_LOCKED: 402,
  FORBIDDEN: 403,
  ACCOUNT_DISABLED: 403,
  NOT_FOUND: 404,
  DAEMON_NOT_CONNECTED: 409,
  DUPLICATE_BUILD: 409,
  SLUG_TAKEN: 409,
  MANIFEST_ID_MISMATCH: 409,
  TRIGGER_DISABLED: 410,
  PAYLOAD_TOO_LARGE: 413,
  SECRET_GUARD_BLOCKED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_FAILED: 502,
  UPSTREAM_UNAVAILABLE: 503,
};
