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
import { loadIntegrationCredentialFields as loadDecryptedCredentialFields } from '../seams.js';

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
  const secretValues = collectSecretValues(integrationFields);
  const resolved: ApiCallResolved = {
    kind: 'api_call',
    method: spec.method,
    url: redactSecretValues(resolvedUrl, secretValues),
    headers: redactHeaderValues(redactHeadersForCache(resolvedHeaders), secretValues),
    body: resolvedBody ? redactSecretValues(resolvedBody, secretValues) : resolvedBody,
    bodyKind,
    timeoutMs,
    authIntegrationKey: spec.authIntegrationKey,
  };

  const fetchStart = Date.now();
  let response: Response;
  try {
    response = await fetch(resolvedUrl, {
      method: spec.method,
      headers: resolvedHeaders,
      body: spec.method === 'GET' || spec.method === 'HEAD' ? undefined : resolvedBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A network/timeout error message can include the failed request URL, which may carry a secret
    // in its query string or authority — redact before persisting/emitting it (credential boundary).
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: { message: redactSecretValues(`request failed: ${message}`, secretValues), recoverable: true },
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
  const safeBody = redactSecretValues(bodyText, secretValues);
  const safeResponseHeaders = redactHeaderValues(responseHeaders, secretValues);
  // The HTTP reason phrase (statusText) is server-controlled and can echo the client secret too.
  const safeStatusText = redactSecretValues(response.statusText, secretValues);

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
        details: { request: { method: spec.method, url: redactSecretValues(resolvedUrl, secretValues) }, response: { status: response.status, body: safeBody.slice(0, 2000) } },
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

/** Every decrypted secret value across the resolved integration credential fields. Longest first
 *  so an overlapping shorter value never masks a longer one. */
function collectSecretValues(integrationFields: Record<string, Record<string, string>> | undefined): string[] {
  if (!integrationFields) return [];
  const values = new Set<string>();
  for (const fields of Object.values(integrationFields)) {
    for (const v of Object.values(fields)) {
      if (typeof v === 'string' && v.length >= 4) values.add(v); // skip trivially-short values
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/** Replace every occurrence of any secret value in `text` with a redaction marker. */
function redactSecretValues(text: string, secretValues: string[]): string {
  let out = text;
  for (const secret of secretValues) {
    if (out.includes(secret)) out = out.split(secret).join('<redacted>');
  }
  return out;
}

/** Redact secret values that landed in a (non-auth-shaped) header value. */
function redactHeaderValues(headers: Record<string, string>, secretValues: string[]): Record<string, string> {
  if (!secretValues.length) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = redactSecretValues(v, secretValues);
  return out;
}

function looksLikeJson(headers: Record<string, string>, body: string): boolean {
  const ct = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  if (/json/i.test(ct)) return true;
  const trimmed = body.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}
