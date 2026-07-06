import type { ZodTypeAny } from 'zod';

/**
 * Endpoint descriptor (ch02 §2.2, ch12 §12.2.1): the machine-readable form of the
 * ch03 endpoint tables. `api/` mounts validation from these; `web/` derives its
 * typed client from them. Descriptor maps are contract DATA, not code.
 */
export type AuthClass =
  | 'public'
  | 'user'
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
  timeoutMs?: number;
  /** default request language when the endpoint carries user-visible model output (ch03 §3.4). */
  language?: boolean;
  kind?: EndpointKind;
}

export type DomainDescriptorMap = Record<string, EndpointDescriptor>;
