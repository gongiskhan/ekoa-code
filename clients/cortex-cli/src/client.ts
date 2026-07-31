/**
 * THE fetch wrapper. One generic call path for all 27 operations of the public Cortex Capability
 * API - there is deliberately no per-capability HTTP code anywhere in this package: a command
 * names an operationId and hands over typed slots, and everything else (URL assembly, auth,
 * timeout, success-status semantics, the error envelope, the binary path) happens exactly once,
 * here.
 *
 * Types come from `generated/cortex-v1.d.ts` (openapi-typescript over the committed spec); the
 * per-operation VALUES a `.d.ts` cannot carry - method, path template, declared success statuses
 * in order, media type, timeout - come from `generated/operations.ts`. Both are generated from
 * `docs/openapi/cortex.v1.json` and diffed by the drift gate, so this file can never drift from
 * the contract without the build failing.
 */
import { ErrorEnvelope } from '@ekoa/shared';
import type { operations as Ops } from './generated/cortex-v1.js';
import { OPERATIONS, type OperationId, type OperationSpec } from './generated/operations.js';

/**
 * The generated TYPES and the generated runtime TABLE describe the same operation set. If a
 * regeneration ever produced two different sets, this assertion stops compiling - which is the
 * point: the wrapper's type safety rests on the two halves being one contract.
 */
type Assert<T extends true> = T;
type _OperationSetsAgree = Assert<
  [OperationId] extends [keyof Ops] ? ([keyof Ops] extends [OperationId] ? true : false) : false
>;

// --------------------------------------------------------------------------------------------
// Typed slots, derived from the generated operation types.
// --------------------------------------------------------------------------------------------

/**
 * The RAW slot types, `undefined` INCLUDED - indexed access is used deliberately (`P['query']`,
 * not `P extends { query?: infer Q }`), because inference through an optional property strips the
 * `undefined`, and that `undefined` is the whole signal: it says the slot may be omitted. An
 * operation with no such slot has `path?: never`, i.e. `undefined`, and one with mandatory
 * parameters has `query: {...}` with no `undefined` at all.
 */
type RawPathOf<I extends OperationId> = Ops[I]['parameters']['path'];
type RawQueryOf<I extends OperationId> = Ops[I]['parameters']['query'];
type RawBodyOf<I extends OperationId> = [Ops[I]['requestBody']] extends [undefined]
  ? // No body at all (`requestBody?: never`). Checked FIRST and in a tuple, because
    // `never extends X` is vacuously true and would infer `unknown` - a slot that accepts
    // anything, which is the opposite of what an absent body means.
    undefined
  : NonNullable<Ops[I]['requestBody']> extends { content: { 'application/json': infer B } }
    ? undefined extends Ops[I]['requestBody']
      ? B | undefined
      : B
    : never;

/** The success responses an operation declares (200/201/202 are the only ones on this surface). */
type SuccessStatus = 200 | 201 | 202;
type SuccessResponseOf<I extends OperationId> = Ops[I]['responses'][Extract<
  keyof Ops[I]['responses'],
  SuccessStatus
>];
type SuccessContentOf<I extends OperationId> = SuccessResponseOf<I> extends { content: infer C } ? C : never;

/**
 * The decoded body: the JSON schema for a JSON operation, raw bytes for a `binary` one
 * (`memvault.exportVault` answers `application/x-tar`, which is never parsed as JSON).
 */
export type ResultData<I extends OperationId> = SuccessContentOf<I> extends { 'application/json': infer J }
  ? J
  : Buffer;

type RawSlots<I extends OperationId> = { path: RawPathOf<I>; query: RawQueryOf<I>; body: RawBodyOf<I> };
type Slots<I extends OperationId> = { [K in keyof RawSlots<I>]: Exclude<RawSlots<I>[K], undefined> };
/** A slot is required unless it is absent (`never`) or explicitly optional (`| undefined`). */
type SlotIsRequired<T> = [Exclude<T, undefined>] extends [never] ? false : undefined extends T ? false : true;

/** Per-call knobs that are never part of the contract. */
export interface CallOptions {
  /** Extra request headers. Never used to special-case a consumer - trace only (rule 3). */
  headers?: Record<string, string>;
  /** Overrides the operation's declared timeout for this call only. */
  timeoutMs?: number;
  /** Caller-owned cancellation, composed with the timeout. */
  signal?: AbortSignal;
}

/**
 * The arguments of one call: exactly the slots the operation declares. A slot the operation does
 * not have is typed `never`, so passing it does not compile; a slot whose parameters are all
 * optional is optional.
 */
export type RequestArgs<I extends OperationId> = {
  [K in keyof RawSlots<I> as SlotIsRequired<RawSlots<I>[K]> extends true ? K : never]: Slots<I>[K];
} & {
  [K in keyof RawSlots<I> as SlotIsRequired<RawSlots<I>[K]> extends true ? never : K]?: Slots<I>[K];
} & CallOptions;

/** One completed call. */
export interface CortexResult<I extends OperationId> {
  /** The HTTP status. It is part of the contract: see `created`. */
  readonly status: number;
  readonly data: ResultData<I>;
  /**
   * True when the status is the operation's PRIMARY declared success status
   * (`x-ekoa-success-statuses[0]`). It carries information wherever an operation declares more
   * than one: `automations.createRun` answers **202 for a fresh run** and **200 for an idempotent
   * replay of the same runId**, and the status is the only signal telling them apart.
   */
  readonly created: boolean;
  /** The inverse of `created`, and meaningful only on multi-status operations. */
  readonly replayed: boolean;
  readonly headers: Headers;
}

// --------------------------------------------------------------------------------------------
// Errors. Every failure the CLI can hit is one of these three, and each carries a machine code.
// --------------------------------------------------------------------------------------------

/** A refusal from Cortex: an HTTP status outside the operation's declared success statuses. */
export class CortexApiError extends Error {
  override readonly name = 'CortexApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly operationId?: string,
  ) {
    super(message);
  }
}

/** The per-operation timeout elapsed (or the caller's own signal aborted). */
export class CortexTimeoutError extends Error {
  override readonly name = 'CortexTimeoutError';
  readonly code = 'TIMEOUT';
  constructor(
    readonly operationId: string,
    readonly timeoutMs: number,
  ) {
    super(`${operationId} timed out after ${timeoutMs} ms`);
  }
}

/** The request never produced a response (DNS, connection refused, TLS, socket reset). */
export class CortexNetworkError extends Error {
  override readonly name = 'CortexNetworkError';
  readonly code = 'NETWORK';
  constructor(
    readonly operationId: string,
    readonly url: string,
    override readonly cause: unknown,
  ) {
    super(`${operationId}: request to ${url} failed: ${describe(cause)}`);
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

// --------------------------------------------------------------------------------------------
// The client.
// --------------------------------------------------------------------------------------------

export interface CortexClientOptions {
  /** Deployment origin, e.g. `https://cortex.example.com`. From `CORTEX_BASE_URL` in the CLI. */
  baseUrl: string;
  /** A user-scoped gateway key (`ekoa_gk_...`). From `CORTEX_API_KEY` in the CLI. */
  apiKey: string;
  /** `X-Client` value - trace only, never branched on server-side. */
  clientTag: string;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Body bytes cap when quoting a non-envelope error body back to the caller. */
const ERROR_BODY_EXCERPT_MAX = 300;

export class CortexClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly clientTag: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CortexClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.clientTag = opts.clientTag;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  /** The generated spec row for an operation - the only per-operation knowledge in this package. */
  static spec(id: OperationId): OperationSpec {
    return OPERATIONS[id];
  }

  async call<I extends OperationId>(id: I, args: RequestArgs<I> = {} as RequestArgs<I>): Promise<CortexResult<I>> {
    const spec = OPERATIONS[id] as OperationSpec;
    const slots = args as unknown as {
      path?: Record<string, string | number>;
      query?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
      signal?: AbortSignal;
    };
    const url = this.baseUrl + buildPath(spec.path, slots.path) + buildQuery(slots.query);

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      'x-client': this.clientTag,
      accept: spec.mediaType,
      ...(slots.headers ?? {}),
    };
    if (slots.body !== undefined) headers['content-type'] = 'application/json';

    const timeoutMs = slots.timeoutMs ?? spec.timeoutMs;
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(slots.signal?.reason);
    // An ALREADY-aborted caller signal never fires a listener, so it has to be honoured up front
    // or the call would sail past a cancellation the caller already made.
    if (slots.signal?.aborted) controller.abort(slots.signal.reason);
    else slots.signal?.addEventListener('abort', onCallerAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: spec.method,
        headers,
        body: slots.body === undefined ? undefined : JSON.stringify(slots.body),
        signal: controller.signal,
      });
    } catch (cause) {
      if (timedOut) throw new CortexTimeoutError(id, timeoutMs);
      if (slots.signal?.aborted) throw new CortexTimeoutError(id, timeoutMs);
      throw new CortexNetworkError(id, url, cause);
    } finally {
      clearTimeout(timer);
      slots.signal?.removeEventListener('abort', onCallerAbort);
    }

    if (!spec.successStatuses.includes(res.status)) throw await this.refusal(id, res);

    const data =
      spec.kind === 'binary'
        ? (Buffer.from(await res.arrayBuffer()) as ResultData<I>)
        : ((await this.json(id, res)) as ResultData<I>);

    return {
      status: res.status,
      data,
      created: res.status === spec.successStatuses[0],
      replayed: res.status !== spec.successStatuses[0],
      headers: res.headers,
    };
  }

  /**
   * Turn a non-success response into a `CortexApiError`. Every non-2xx body on this surface is the
   * shared error envelope (CONV-2), and it is validated as such against the `shared/` zod schema -
   * anything else is reported as a protocol violation rather than silently re-shaped.
   */
  private async refusal(id: OperationId, res: Response): Promise<CortexApiError> {
    const text = await res.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return new CortexApiError(
        res.status,
        'NON_ENVELOPE_RESPONSE',
        `HTTP ${res.status} with a non-JSON body: ${excerpt(text)}`,
        undefined,
        id,
      );
    }
    const envelope = ErrorEnvelope.safeParse(parsed);
    if (!envelope.success) {
      return new CortexApiError(
        res.status,
        'NON_ENVELOPE_RESPONSE',
        `HTTP ${res.status} with a body that is not the shared error envelope: ${excerpt(text)}`,
        undefined,
        id,
      );
    }
    return new CortexApiError(
      res.status,
      envelope.data.error.code,
      envelope.data.error.message,
      envelope.data.error.details,
      id,
    );
  }

  private async json(id: OperationId, res: Response): Promise<unknown> {
    const text = await res.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new CortexApiError(
        res.status,
        'INVALID_RESPONSE',
        `HTTP ${res.status} success body was not JSON: ${excerpt(text)}`,
        undefined,
        id,
      );
    }
  }
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > ERROR_BODY_EXCERPT_MAX ? `${flat.slice(0, ERROR_BODY_EXCERPT_MAX)}...` : flat;
}

/** `/api/v1/automations/{id}/runs` + `{ id }` -> `/api/v1/automations/a1/runs`. */
function buildPath(template: string, params: Record<string, string | number> | undefined): string {
  return template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null || value === '') {
      throw new TypeError(`missing path parameter "${name}" for ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item !== undefined && item !== null) usp.append(key, String(item));
    } else {
      usp.append(key, String(value));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export { OPERATIONS, OPERATION_IDS, type OperationId, type OperationSpec } from './generated/operations.js';
