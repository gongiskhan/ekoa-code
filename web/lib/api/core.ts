/**
 * The request core (ch12 §12.2.2). One function, `request(descriptor, args, opts?)`, does
 * everything the old `sendAction`/`wsAction` pair did, conventionally: URL building (path
 * params substituted, query serialized), the `Authorization` header from the token
 * accessor, per-descriptor timeout + caller abort, JSON parsing, dev/test contract
 * validation, and the two interceptors (§12.2.3). It performs NO automatic retries
 * (duplicate-create risk; every long-lived surface has an explicit re-sync path).
 *
 * SSE (`kind: 'sse'`) is consumed by `stream.ts`, never here. `kind: 'binary'` sends the
 * caller's raw body (`opts.rawBody`) with caller-set headers and can return the raw
 * `Response`/`Blob` via `opts.responseType`.
 */

import type { EndpointDescriptor } from '@ekoa/shared';
import { ErrorEnvelope } from '@ekoa/shared';
import { ApiError } from './errors';
import { resolveBaseUrl } from './base-url';
import { getToken, clearToken } from './token';

const DEFAULT_TIMEOUT_MS = 120_000;
/** Persisted auth-store key cleared alongside the token on a 401 (ch12 §12.2.3). */
const AUTH_STATE_KEY = 'ekoa_auth';

export interface RequestOptions {
  /** Caller abort signal, merged with the per-descriptor timeout. */
  signal?: AbortSignal;
  /** Extra request headers (binary uploads set `X-Filename` etc. here). */
  headers?: Record<string, string>;
  /** Raw body for `kind: 'binary'` endpoints (Blob / ArrayBuffer / FormData / ...). */
  rawBody?: BodyInit;
  /** How to read a 2xx body. `json` (default) parses + validates; `blob`/`response` for downloads. */
  responseType?: 'json' | 'blob' | 'response';
}

export type RequestArgs = Record<string, unknown>;

// -- Language source seam (§12.2.3, FC-009/FC-069) --------------------------------------
//
// The `language: true` descriptors (chat run create, job create, integration-builder chat,
// automation plan) inject an explicit `language` body field from the SINGLE language
// source: the i18n store's persisted value. The transport never reads localStorage for
// this. To keep this egress core store-agnostic (no import cycle, SSR-safe, unit-testable)
// the source is INJECTED: the ApiProvider wires it on mount via `setLanguageSource`. Until
// wired (SSR / tests) no field is injected and the server-side schema default ('pt') applies.
let languageSource: (() => string | undefined) | null = null;

export function setLanguageSource(source: () => string | undefined): void {
  languageSource = source;
}

function currentLanguage(): string | undefined {
  try {
    return languageSource?.();
  } catch {
    return undefined;
  }
}

// -- Argument splitting -----------------------------------------------------------------

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

function queryShapeKeys(schema: unknown): Set<string> {
  // zod ZodObject exposes `.shape`; guard for other schema kinds.
  const shape = (schema as { shape?: Record<string, unknown> } | null)?.shape;
  return shape && typeof shape === 'object' ? new Set(Object.keys(shape)) : new Set();
}

interface SplitArgs {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: Record<string, unknown> | undefined;
}

function splitArgs(descriptor: EndpointDescriptor, args?: RequestArgs): SplitArgs {
  const src: Record<string, unknown> = { ...(args ?? {}) };
  const params: Record<string, string> = {};

  for (const name of pathParamNames(descriptor.path)) {
    const value = src[name];
    if (value === undefined || value === null) {
      throw new ApiError(0, 'VALIDATION_FAILED', `Missing path parameter '${name}' for ${descriptor.path}`);
    }
    params[name] = String(value);
    delete src[name];
  }

  const hasBody = descriptor.method === 'POST' || descriptor.method === 'PUT' || descriptor.method === 'PATCH';
  const query: Record<string, unknown> = {};
  let body: Record<string, unknown> | undefined;

  if (!hasBody) {
    // GET / DELETE carry no body: every remaining key is a query param.
    Object.assign(query, src);
  } else if (descriptor.query) {
    // A body method that also declares query params: split by the query schema's keys.
    const keys = queryShapeKeys(descriptor.query);
    for (const key of Object.keys(src)) {
      if (keys.has(key)) {
        query[key] = src[key];
        delete src[key];
      }
    }
    body = src;
  } else {
    body = src;
  }

  return { params, query, body };
}

function buildUrl(descriptor: EndpointDescriptor, params: Record<string, string>, query: Record<string, unknown>): string {
  let path = descriptor.path;
  for (const [name, value] of Object.entries(params)) {
    path = path.replace(`:${name}`, encodeURIComponent(value));
  }
  const url = new URL(`${resolveBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
}

// -- Interceptors -----------------------------------------------------------------------

/**
 * Auth-failure interceptor (§12.2.3, replaces FC-021's string matching). Status-based,
 * never message-string-based. A rejected token is already invalid, so this only clears
 * local state - it never calls `POST /auth/logout` (that is the explicit sign-out path).
 */
function handleUnauthorized(): void {
  clearToken();
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTH_STATE_KEY);
  } catch {
    /* ignore storage errors */
  }
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }
  const parsed = ErrorEnvelope.safeParse(payload);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new ApiError(res.status, code, message, details);
  }
  const message =
    payload && typeof payload === 'object' && 'message' in payload && typeof (payload as { message: unknown }).message === 'string'
      ? (payload as { message: string }).message
      : res.statusText || `HTTP ${res.status}`;
  return new ApiError(res.status, statusToCode(res.status), message, payload);
}

/** Best-effort code for a non-enveloped error body (the API always envelopes; this is a fallback). */
function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHENTICATED';
    case 402:
      return 'BILLING_BLOCKED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 422:
      return 'SECRET_GUARD_BLOCKED';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL' : 'REQUEST_FAILED';
  }
}

// -- The request core -------------------------------------------------------------------

export async function request(descriptor: EndpointDescriptor, args?: RequestArgs, opts?: RequestOptions): Promise<unknown> {
  const { params, query, body } = splitArgs(descriptor, args);
  const url = buildUrl(descriptor, params, query);

  const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
  const token = getToken();
  if (token && descriptor.auth !== 'public') {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Language interceptor (§12.2.3): inject the single-source language into the body.
  let jsonBody = body;
  if (descriptor.language) {
    const language = currentLanguage();
    if (language) jsonBody = { ...(jsonBody ?? {}), language };
  }

  // Body encoding.
  let fetchBody: BodyInit | undefined;
  if (descriptor.kind === 'binary') {
    fetchBody = opts?.rawBody;
  } else if (jsonBody !== undefined && (descriptor.request !== undefined || Object.keys(jsonBody).length > 0)) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(jsonBody);
  }

  // Per-descriptor timeout + caller abort, merged into one controller.
  const timeoutMs = descriptor.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let abortedByCaller = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => {
    abortedByCaller = true;
    controller.abort();
  };
  if (opts?.signal) {
    if (opts.signal.aborted) onCallerAbort();
    else opts.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(url, { method: descriptor.method, headers, body: fetchBody, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new ApiError(0, 'TIMEOUT', `Request timed out after ${timeoutMs}ms`);
    if (abortedByCaller) throw new ApiError(0, 'ABORTED', 'Request aborted');
    throw new ApiError(0, 'NETWORK_ERROR', error instanceof Error ? error.message : 'Network request failed');
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener('abort', onCallerAbort);
  }

  if (!res.ok) {
    if (res.status === 401 && descriptor.auth !== 'public') handleUnauthorized();
    throw await toApiError(res);
  }

  if (opts?.responseType === 'response') return res;
  if (opts?.responseType === 'blob') return res.blob();

  if (res.status === 204) return undefined;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(0, 'CONTRACT_MISMATCH', `Response for ${descriptor.method} ${descriptor.path} was not valid JSON`);
  }

  // Contract validation in dev/test (ch13 contract tests). Off in production for cost.
  if (process.env.NODE_ENV !== 'production' && descriptor.response && data !== undefined) {
    const check = descriptor.response.safeParse(data);
    if (!check.success) {
      throw new ApiError(
        0,
        'CONTRACT_MISMATCH',
        `Response for ${descriptor.method} ${descriptor.path} failed contract validation`,
        check.error.issues,
      );
    }
  }

  return data;
}
