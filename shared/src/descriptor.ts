import type { ZodTypeAny } from 'zod';

/**
 * Endpoint descriptor (ch02 §2.2, ch12 §12.2.1): the machine-readable form of the
 * ch03 endpoint tables. `api/` mounts validation from these; `web/` derives its
 * typed client from them. Descriptor maps are contract DATA, not code.
 */
export type AuthClass =
  | 'public'
  | 'user'
  | 'user-or-key'
  | 'org-admin'
  | 'super-admin'
  | 'token-query'
  | 'hmac'
  | 'header-scoped'
  | 'optional-jwt'
  | 'app-id-gated'
  | 'bridge';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type EndpointKind = 'rest' | 'sse' | 'ws' | 'binary' | 'redirect' | 'static';

export interface EndpointDescriptor {
  method: HttpMethod;
  path: string;
  auth: AuthClass;
  request?: ZodTypeAny;
  response?: ZodTypeAny;
  query?: ZodTypeAny;
  /**
   * Schema for the express `:params` in `path`, where the route validates them. Declaring it
   * makes two facts contractual that the path template alone cannot carry: the SHAPE a segment
   * must have, and the fact that a malformed segment is a 400 rather than a 404. Omit it only
   * where the route genuinely does not validate the segment (E6).
   */
  params?: ZodTypeAny;
  /**
   * The HTTP status a SUCCESS answers with, when it is not a plain 200; an ARRAY where the same
   * operation has more than one and the status itself carries information the body does not.
   * `automations.createRun` is the reason this exists: `[202, 200]` — 202 started a run, 200 is
   * an idempotent replay returning the same runId, and the status code is the ONLY signal that
   * tells them apart. A consumer generated from a spec that assumed 200 could not implement
   * replay detection at all (E6 review F2).
   */
  successStatus?: number | readonly number[];
  /**
   * The response media type, where the body is not `application/json`. Required alongside
   * `kind: 'binary'` — "opaque bytes" is not a media type, and a generated client picks its
   * `Accept` header and its deserializer from this (E6 review F6).
   */
  mediaType?: string;
  timeoutMs?: number;
  /** default request language when the endpoint carries user-visible model output (ch03 §3.4). */
  language?: boolean;
  kind?: EndpointKind;
}

export type DomainDescriptorMap = Record<string, EndpointDescriptor>;
