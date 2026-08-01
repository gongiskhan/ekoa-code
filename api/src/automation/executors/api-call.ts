/**
 * API call step executor.
 *
 * Performs an HTTP request via native fetch and captures the response.
 * Auth-shaped headers MUST be routed via `authIntegrationKey`; raw
 * credentials in headers are rejected at validation time (planner side).
 *
 * Template interpolation handles {{input.x}}, {{capture.x}}, and
 * {{integration.<key>.<field>}} for credential injection.
 */

import type {
  Step,
  StepRecord,
  Automation,
  ApiCallResolved,
  StepOutput,
  ResolvedAction,
} from '../types.js';
import type { RunContext } from '../engine.js';
import { interpolate } from '../template-vars.js';
import {
  loadIntegrationCredentialFields as loadDecryptedCredentialFields,
  loadIntegrationBoundOrigins,
} from '../seams.js';
import { assertOriginAllowed, CredentialOriginError } from '../../security/origin-binding.js';
import { guardedFetch } from '../../services/url-fetcher.js';
import { SsrfError } from '../../services/url-safety.js';
// Cofre R-6: one value-keyed masker for the whole repo. The private copy that used to live in this
// file matched only the RAW literal, so a URL-encoded/base64/JSON-escaped occurrence of a secret
// walked straight into the persisted step record.
import { secretRegistryFromFields } from '../../security/redaction.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024;

interface ExecuteApiCallArgs {
  step: Step;
  index: number;
  runId: string;
  automation: Automation;
  ctx: RunContext;
  inputs: Record<string, unknown>;
  baseRecord: StepRecord;
  stepStart: number;
  finishRecord: (
    base: StepRecord,
    status: StepRecord['status'],
    stepStart: number,
    extras: {
      tier?: StepRecord['tier'];
      resolvedAction?: ResolvedAction;
      error?: { message: string; recoverable: boolean; details?: unknown };
      output?: StepOutput;
    },
  ) => StepRecord;
}

export async function executeApiCallStep(args: ExecuteApiCallArgs): Promise<StepRecord> {
  const { step, ctx, inputs, baseRecord, stepStart, finishRecord } = args;

  const spec = step.apiRequest;
  if (!spec || !spec.url || !spec.method) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: { message: `api_call step ${step.id} missing apiRequest.method or .url`, recoverable: false },
    });
  }

  const timeoutMs = Math.min(spec.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  // Resolve integration credentials if requested
  let integrationFields: Record<string, Record<string, string>> | undefined;
  if (spec.authIntegrationKey) {
    try {
      const fields = await loadDecryptedCredentialFields(spec.authIntegrationKey, ctx.ownerUserId);
      if (fields) {
        integrationFields = { [spec.authIntegrationKey]: fields };
      } else {
        return finishRecord(baseRecord, 'failed', stepStart, {
          tier: 'cache',
          error: {
            message: `integration ${spec.authIntegrationKey} not connected`,
            recoverable: false,
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return finishRecord(baseRecord, 'failed', stepStart, {
        tier: 'cache',
        error: { message: `failed to load integration credentials: ${message}`, recoverable: true },
      });
    }
  }

  // Interpolate URL, headers, body
  const resolvedUrl = interpolate(spec.url, inputs, undefined, integrationFields);
  const resolvedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec.headers ?? {})) {
    resolvedHeaders[k] = interpolate(v, inputs, undefined, integrationFields);
  }
  const resolvedBody = spec.body ? interpolate(spec.body, inputs, undefined, integrationFields) : undefined;
  const bodyKind = spec.bodyKind ?? (resolvedBody ? 'json' : 'none');

  // ORIGIN BINDING (Cofre R-2, invariant I6). `spec.url` is MODEL-authored and, since rehearsal.ts
  // lets the mid-run fixer rewrite it, is not covered by the planner's checks. A decrypted
  // credential may therefore only leave for a host the integration itself declares. Checked AFTER
  // interpolation (the binding is about where the bytes actually go) and BEFORE the request.
  if (spec.authIntegrationKey) {
    try {
      // A2: resolved TENANT-SCOPED. The run's owner + org are the read actor, so the allow-list
      // comes from the definition THIS org sees — never another tenant's package of the same key.
      const allowedOrigins = await loadIntegrationBoundOrigins(spec.authIntegrationKey, {
        userId: ctx.ownerUserId,
        orgId: ctx.orgId,
        role: 'user',
      });
      assertOriginAllowed(resolvedUrl, { allowedOrigins, credentialLabel: spec.authIntegrationKey });
    } catch (err) {
      if (err instanceof CredentialOriginError) {
        return finishRecord(baseRecord, 'failed', stepStart, {
          tier: 'cache',
          // The URL is NOT echoed: a refused destination is attacker-chosen text and this record is
          // persisted and surfaced. The host and the binding are in the error's own message.
          error: { message: err.message, recoverable: false },
        });
      }
      throw err;
    }
  }

  // Default content-type by bodyKind when caller didn't set it
  if (resolvedBody && !findHeader(resolvedHeaders, 'content-type')) {
    if (bodyKind === 'json') resolvedHeaders['Content-Type'] = 'application/json';
    else if (bodyKind === 'form') resolvedHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    else if (bodyKind === 'text') resolvedHeaders['Content-Type'] = 'text/plain';
  }

  // CREDENTIAL BOUNDARY (ch05 §5.6.7): the resolved action is PERSISTED into the step record and
  // returned by GET /automations/runs/:id. Name-based header redaction is not enough — a secret
  // interpolated into the URL query string, the request body, or a non-auth-shaped header would
  // otherwise be stored in cleartext. Redact every occurrence of any decrypted integration secret
  // VALUE from the persisted copy (the real request above already used the un-redacted values).
  const secrets = secretRegistryFromFields(integrationFields);
  const resolved: ApiCallResolved = {
    kind: 'api_call',
    method: spec.method,
    url: secrets.redact(resolvedUrl),
    headers: secrets.redactHeaderValues(redactHeadersForCache(resolvedHeaders)),
    body: resolvedBody ? secrets.redact(resolvedBody) : resolvedBody,
    bodyKind,
    timeoutMs,
    authIntegrationKey: spec.authIntegrationKey,
  };

  const fetchStart = Date.now();
  let response: Response;
  try {
    // SSRF guard (Codex G8): an automation-authored api_call URL is untrusted, so route it through
    // guardedFetch — it rejects private/loopback/link-local/metadata hosts (incl. a public name
    // that resolves to one, DNS-rebinding) and refuses redirects to such addresses. An SsrfError is
    // a hard, non-recoverable failure.
    response = await guardedFetch(resolvedUrl, {
      method: spec.method,
      headers: resolvedHeaders,
      ...(spec.method === 'GET' || spec.method === 'HEAD' ? {} : { body: resolvedBody }),
      timeoutMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A network/timeout error message can include the failed request URL, which may carry a secret
    // in its query string or authority — redact before persisting/emitting it (credential boundary).
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: { message: secrets.redact(`request failed: ${message}`), recoverable: !(err instanceof SsrfError) },
      resolvedAction: resolved,
    });
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    responseHeaders[k] = isAuthShapedHeader(k) ? '<redacted>' : v;
  });

  // Read body with truncation cap.
  let bodyText = '';
  let truncated = false;
  try {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      bodyText = text.slice(0, MAX_RESPONSE_BYTES);
      truncated = true;
    } else {
      bodyText = text;
    }
  } catch (err) {
    bodyText = `[failed to read response body: ${err instanceof Error ? err.message : String(err)}]`;
  }

  const isJson = looksLikeJson(responseHeaders, bodyText);

  // CREDENTIAL BOUNDARY (Codex round-2): a server can echo the CLIENT's own secret back in the
  // response body/headers of an error (e.g. "invalid client_secret: sk-live-…"). That body is
  // PERSISTED in the step output + error details, so mask any occurrence of the client's decrypted
  // credential values. This only ever masks the CLIENT's own configured secret — a token the API
  // legitimately RETURNS is a different value (not in secretValues), so real data survives.
  const safeBody = secrets.redact(bodyText);
  const safeResponseHeaders = secrets.redactHeaderValues(responseHeaders);
  // The HTTP reason phrase (statusText) is server-controlled and can echo the client secret too.
  const safeStatusText = secrets.redact(response.statusText);

  const output: StepOutput = {
    kind: 'api_call',
    status: response.status,
    statusText: safeStatusText,
    responseHeaders: safeResponseHeaders,
    responseBody: safeBody,
    responseBodyIsJson: isJson,
    truncated,
    durationMs: Date.now() - fetchStart,
  };

  const ok = response.status >= 200 && response.status < 300;
  if (!ok) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: `HTTP ${response.status} ${safeStatusText}`,
        recoverable: true,
        // Both the URL (query-string secret) and the response body (echoed secret) are redacted.
        details: { request: { method: spec.method, url: secrets.redact(resolvedUrl) }, response: { status: response.status, body: safeBody.slice(0, 2000) } },
      },
      output,
      resolvedAction: resolved,
    });
  }

  return finishRecord(baseRecord, 'completed', stepStart, {
    tier: 'cache',
    output,
    resolvedAction: resolved,
  });
}

function findHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

function isAuthShapedHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === 'authorization' ||
    lower === 'x-api-key' ||
    lower === 'x-auth-token' ||
    lower.startsWith('x-amz-security') ||
    lower === 'cookie'
  );
}

function redactHeadersForCache(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isAuthShapedHeader(k) ? '<resolved-at-runtime>' : v;
  }
  return out;
}

function looksLikeJson(headers: Record<string, string>, body: string): boolean {
  const ct = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  if (/json/i.test(ct)) return true;
  const trimmed = body.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}
