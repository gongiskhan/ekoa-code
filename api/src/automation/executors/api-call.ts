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

  const resolved: ApiCallResolved = {
    kind: 'api_call',
    method: spec.method,
    url: resolvedUrl,
    headers: redactHeadersForCache(resolvedHeaders),
    body: resolvedBody,
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
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: { message: `request failed: ${message}`, recoverable: true },
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

  const output: StepOutput = {
    kind: 'api_call',
    status: response.status,
    statusText: response.statusText,
    responseHeaders,
    responseBody: bodyText,
    responseBodyIsJson: isJson,
    truncated,
    durationMs: Date.now() - fetchStart,
  };

  const ok = response.status >= 200 && response.status < 300;
  if (!ok) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: `HTTP ${response.status} ${response.statusText}`,
        recoverable: true,
        details: { request: { method: spec.method, url: resolvedUrl }, response: { status: response.status, body: bodyText.slice(0, 2000) } },
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
