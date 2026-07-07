/**
 * User-defined integration action runner (ch03 §3.8.13/§3.8.15; carryover-audit B25). The analog
 * of the platform API caller (platform-call.ts) for the shipped, user-CONNECTED integrations
 * (stripe, slack, …): resolve the action's HTTP shape from the versioned package definition,
 * load the owner's encrypted credential row, decrypt just-in-time, interpolate, and call the
 * user-configured endpoint. Credentials are never returned — only the HTTP response is; the
 * request/response dump surfaced on failure is credential-redacted.
 *
 * SSRF posture (spec §9 invariant 8, verbatim scope statement): "User-defined integration actions
 * call arbitrary user-configured endpoints by design … run under the owner's own credentials, and
 * are not SSRF-gated." So this path uses a plain fetch, NOT the guarded fetcher — the boundary is
 * a recorded decision. (The transport is injectable so tests fake it without a live call.)
 *
 * This is the function the automation engine's `integration` step calls for a non-platform key.
 * Auth types executed: `api_key`, `none` (OAuth2/service_account are platform-only). An
 * `automationBinding` action delegates to the injected automation-backed handler (the seam the
 * lead wires to automation/); absent that, it returns a coded, non-throwing result.
 */

import { getDefinition, type IntegrationActionHttpConfig } from './definitions.js';
import { findConfigForOwner, type IntegrationConfigDoc } from './service.js';
import { decrypt } from '../data/crypto.js';
import {
  interpolate,
  interpolateObj,
  buildVars,
  redactHeaders,
  redactBody,
  redactUrl,
  truncateForDisplay,
  findHeaderValue,
  formUrlEncode,
} from './http-template.js';

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

export interface ExecuteIntegrationActionInput {
  orgId: string;
  ownerUserId: string;
  integrationKey: string;
  actionName: string;
  args: Record<string, unknown>;
}

export type IntegrationErrorCode =
  | 'unknown_integration'
  | 'unknown_action'
  | 'not_connected'
  | 'disabled'
  | 'credential_decrypt_failed'
  | 'credential_missing_scope'
  | 'credential_invalid'
  | 'unsupported_auth_type'
  | 'invalid_base_url'
  | 'transient_5xx'
  | 'client_4xx'
  | 'rate_limited'
  | 'transport_error'
  | 'automation_required'
  // Carried automation-backed outcome codes (integração-por-automação, B25).
  | 'unknown_automation'
  | 'forbidden'
  | 'automation_failed'
  | 'unknown';

export interface IntegrationErrorDetails {
  request: { method: string; url: string; headers: Record<string, string>; body?: string };
  response?: { status: number; statusText?: string; headers: Record<string, string>; body: string; bodyIsJson: boolean };
  transportError?: string;
}

export interface ExecuteIntegrationActionResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  code?: IntegrationErrorCode;
  details?: IntegrationErrorDetails;
}

/** Handler for `automationBinding` actions (integração-por-automação). Injected by the composition
 *  root so this module never imports automation/ (a higher tier). */
export type AutomationBackedHandler = (input: {
  binding: unknown;
  args: Record<string, unknown>;
  credentialFields: Record<string, unknown>;
  orgId: string;
  ownerUserId: string;
}) => Promise<ExecuteIntegrationActionResult>;

export interface ExecutorDeps {
  /** Transport seam; default plain fetch (SSRF-exempt by design). Tests inject a fake. */
  fetchImpl?: FetchLike;
  /** Wall-clock timeout for the outbound call (ms). */
  timeoutMs?: number;
  /** Optional automation-backed action handler (the automation/ seam). */
  runAutomationBackedAction?: AutomationBackedHandler;
}

const MAX_BODY_DISPLAY_BYTES = 8_000;

export async function executeUserIntegrationAction(
  input: ExecuteIntegrationActionInput,
  deps: ExecutorDeps = {},
): Promise<ExecuteIntegrationActionResult> {
  const def = getDefinition(input.integrationKey);
  if (!def) return { success: false, code: 'unknown_integration', error: `unknown integration: ${input.integrationKey}` };

  const action = def.actions.find((a) => a.actionName === input.actionName);
  if (!action) {
    const available = def.actions.map((a) => a.actionName).join(', ');
    return { success: false, code: 'unknown_action', error: `action "${input.actionName}" not found on ${input.integrationKey}. Available: ${available}` };
  }
  if (!action.httpConfig && !action.automationBinding) {
    return { success: false, code: 'unsupported_auth_type', error: `action "${input.actionName}" has no httpConfig — only HTTP-backed actions are executable` };
  }

  const config = await findConfigForOwner(input.orgId, input.ownerUserId, input.integrationKey);
  if (!config && def.authType !== 'none') {
    return { success: false, code: 'not_connected', error: `integration ${input.integrationKey} is not connected for this user` };
  }
  if (config && !config.enabled) {
    return { success: false, code: 'disabled', error: `integration ${input.integrationKey} is disabled` };
  }

  const decrypted = decryptCredentialFields(config);
  if (decrypted === DECRYPT_FAILED) {
    return { success: false, code: 'credential_decrypt_failed', error: 'failed to decrypt credentials' };
  }
  const credentialFields = decrypted;

  // automationBinding takes precedence over any httpConfig; delegate to the injected handler.
  if (action.automationBinding) {
    if (!deps.runAutomationBackedAction) {
      return { success: false, code: 'automation_required', error: `action "${input.actionName}" is automation-backed and requires the automation seam` };
    }
    return deps.runAutomationBackedAction({
      binding: action.automationBinding,
      args: input.args,
      credentialFields,
      orgId: input.orgId,
      ownerUserId: input.ownerUserId,
    });
  }

  const httpConfig = action.httpConfig!;
  const { stringVars, rawVars } = buildVars(input.args, credentialFields);
  // The decrypted credential VALUES — for value-based URL redaction in the failure summary.
  const secretValues = Object.values(credentialFields)
    .filter((v): v is string => typeof v === 'string' && v.length >= 4);
  return executeHttpAction(httpConfig, stringVars, rawVars, deps, secretValues);
}

const DECRYPT_FAILED = Symbol('decrypt-failed');

/** Decrypt the config's credential blob into a field map, or DECRYPT_FAILED. No config → {}. */
function decryptCredentialFields(config: IntegrationConfigDoc | null): Record<string, unknown> | typeof DECRYPT_FAILED {
  if (!config || !config.credentialsCiphertext) return {};
  try {
    const plaintext = decrypt(config.credentialsCiphertext);
    try {
      return JSON.parse(plaintext) as Record<string, unknown>;
    } catch {
      return { value: plaintext };
    }
  } catch {
    return DECRYPT_FAILED;
  }
}

async function executeHttpAction(
  httpConfig: IntegrationActionHttpConfig,
  vars: Record<string, string>,
  rawVars: Record<string, unknown>,
  deps: ExecutorDeps,
  secretValues: string[] = [],
): Promise<ExecuteIntegrationActionResult> {
  const baseUrl = interpolate(httpConfig.baseUrl, vars);
  if (!/^https?:\/\//i.test(baseUrl)) {
    return { success: false, code: 'invalid_base_url', error: 'Integration request base URL is missing or invalid — reconnect the integration and check its host/region field.' };
  }
  const url = new URL(`${baseUrl}${interpolate(httpConfig.path, vars)}`);
  if (httpConfig.queryParams) {
    for (const [key, tpl] of Object.entries(httpConfig.queryParams)) {
      const val = interpolate(tpl, vars);
      if (val !== '') url.searchParams.set(key, val);
    }
  }
  const headers: Record<string, string> = {};
  if (httpConfig.headers) {
    for (const [key, tpl] of Object.entries(httpConfig.headers)) headers[key] = interpolate(tpl, vars);
  }
  let body: string | undefined;
  if (httpConfig.bodyTemplate && httpConfig.method !== 'GET') {
    const interp = interpolateObj(httpConfig.bodyTemplate, vars, rawVars);
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(interp)) if (v !== '' && v !== undefined) clean[k] = v;
    const contentType = findHeaderValue(headers, 'content-type') ?? '';
    body = contentType.includes('application/x-www-form-urlencoded') ? formUrlEncode(clean) : JSON.stringify(clean);
  }

  const requestUrl = url.toString();
  const requestSummary = {
    method: httpConfig.method,
    // Redact any credential value that landed in the query string before this summary is surfaced
    // on failure (headers/body are already redacted; the URL was the remaining leak — G8 review).
    url: redactUrl(requestUrl, secretValues),
    headers: redactHeaders(headers),
    body: body ? truncateForDisplay(redactBody(body), MAX_BODY_DISPLAY_BYTES) : undefined,
  };

  const fetchImpl = deps.fetchImpl ?? ((u: string, init?: Parameters<FetchLike>[1]) => globalThis.fetch(u, init as RequestInit));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 30_000);
  try {
    const response = await fetchImpl(requestUrl, { method: httpConfig.method, headers, body, signal: controller.signal });
    const text = await response.text();
    let data: unknown;
    let bodyIsJson = false;
    try {
      data = JSON.parse(text);
      bodyIsJson = true;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });
      return {
        success: false,
        status: response.status,
        code: classifyHttpFailure(response.status, data),
        error: buildErrorMessage(response.status, response.statusText, data, text),
        details: {
          request: requestSummary,
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: redactHeaders(responseHeaders),
            body: truncateForDisplay(bodyIsJson ? safeStringify(data) : text, MAX_BODY_DISPLAY_BYTES),
            bodyIsJson,
          },
        },
      };
    }
    return { success: true, status: response.status, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const transport = msg.includes('abort') ? 'Request timed out after 30s' : msg;
    return { success: false, code: 'transport_error', error: transport, details: { request: requestSummary, transportError: transport } };
  } finally {
    clearTimeout(timeout);
  }
}

function classifyHttpFailure(status: number, data: unknown): IntegrationErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 408 || (status >= 500 && status < 600)) return 'transient_5xx';
  if (status === 401 || status === 403) {
    const msg = extractErrorMessage(data).toLowerCase();
    return /scope|permission|forbidden|insufficient/.test(msg) ? 'credential_missing_scope' : 'credential_invalid';
  }
  if (status >= 400 && status < 500) return 'client_4xx';
  return 'unknown';
}

function extractErrorMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return typeof data === 'string' ? data : '';
  const d = data as Record<string, unknown>;
  if (typeof d.message === 'string') return d.message;
  if (typeof d.error === 'string') return d.error;
  if (d.error && typeof d.error === 'object') {
    const e = d.error as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
  }
  return '';
}

function buildErrorMessage(status: number, statusText: string | undefined, data: unknown, raw: string): string {
  const candidates: string[] = [];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.message === 'string') candidates.push(d.message);
    if (typeof d.error === 'string') candidates.push(d.error);
    if (d.error && typeof d.error === 'object') {
      const e = d.error as Record<string, unknown>;
      if (typeof e.message === 'string') candidates.push(e.message);
    }
    if (typeof d.error_description === 'string') candidates.push(d.error_description);
  }
  const detail = candidates[0] ?? (raw && raw.length < 200 ? raw : '');
  const base = `API error (${status}${statusText ? ` ${statusText}` : ''})`;
  return detail ? `${base}: ${detail}` : base;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
