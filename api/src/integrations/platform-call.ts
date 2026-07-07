/**
 * Platform API caller (ch03 §3.8.15; carryover-audit B5). Runs a named action against a
 * connected platform integration (Google Workspace / Microsoft 365) using the org's stored,
 * decrypted, refresh-on-expiry OAuth access token (token custody lives in platform-oauth.ts).
 *
 * The action's HTTP shape comes from the versioned package definition (definitions.ts), not a
 * re-read off disk. Every provider call goes through the SSRF-guarded fetcher — these are the
 * two native platform providers at fixed public hosts, so guarding is defence-in-depth with no
 * functional cost. This is the path the automation engine takes for an `integration` step whose
 * key is a platform provider; a "not connected" failure is what the engine maps to
 * `awaiting_integration`.
 *
 * The generic user-defined integration runner is action-executor.ts; the two are deliberately
 * separate (different credential custody, different SSRF posture — ch09 invariant 8).
 */

import { getDefinition, type IntegrationActionHttpConfig } from './definitions.js';
import { guardedFetch } from '../services/url-fetcher.js';
import { SsrfError } from '../services/url-safety.js';
import {
  getValidPlatformTokens,
  PlatformNotConnectedError,
  type OAuthDeps,
  type PlatformProvider,
} from './platform-oauth.js';
import { interpolate, interpolateObj, buildVars, findHeaderValue, formUrlEncode } from './http-template.js';

export interface PlatformCallInput {
  orgId: string;
  integrationKey: string; // 'google-workspace' | 'microsoft-365'
  actionName: string;
  args: Record<string, unknown>;
}

export interface PlatformCallResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  code?: 'unknown_integration' | 'unknown_action' | 'not_connected' | 'transport_error' | 'client_4xx' | 'transient_5xx';
}

function keyToProvider(integrationKey: string): PlatformProvider | null {
  if (integrationKey === 'google-workspace') return 'google';
  if (integrationKey === 'microsoft-365') return 'microsoft';
  return null;
}

export async function callPlatformIntegration(input: PlatformCallInput, deps: OAuthDeps): Promise<PlatformCallResult> {
  const provider = keyToProvider(input.integrationKey);
  if (!provider) {
    return { success: false, code: 'unknown_integration', error: `unknown platform integration: ${input.integrationKey}` };
  }
  const def = getDefinition(input.integrationKey);
  const action = def?.actions.find((a) => a.actionName === input.actionName);
  if (!action?.httpConfig) {
    return { success: false, code: 'unknown_action', error: `action "${input.actionName}" not found on ${input.integrationKey}` };
  }

  let accessToken: string;
  let accountEmail: string | undefined;
  try {
    const tokens = await getValidPlatformTokens(input.orgId, provider, deps);
    accessToken = tokens.access_token;
    accountEmail = tokens.email;
  } catch (err) {
    if (err instanceof PlatformNotConnectedError) {
      // "not connected" wording is load-bearing: the engine maps it to awaiting_integration.
      return { success: false, code: 'not_connected', error: `${input.integrationKey} is not connected` };
    }
    throw err;
  }

  // Gmail send_email_simple: the static template cannot build an RFC 2822 message, so encode the
  // structured fields into the `raw` arg here (mirrors the account's own From).
  const actionArgs = { ...input.args };
  if (input.integrationKey === 'google-workspace' && input.actionName === 'send_email_simple') {
    actionArgs.raw = buildGmailRaw(actionArgs, accountEmail);
    for (const k of ['to', 'subject', 'body', 'attachmentBase64', 'attachmentFilename', 'attachmentMimeType']) delete actionArgs[k];
  }

  const { stringVars, rawVars } = buildVars(actionArgs, { access_token: accessToken });
  return executePlatformHttp(action.httpConfig, stringVars, rawVars, deps);
}

async function executePlatformHttp(
  httpConfig: IntegrationActionHttpConfig,
  vars: Record<string, string>,
  rawVars: Record<string, unknown>,
  deps: OAuthDeps,
): Promise<PlatformCallResult> {
  const url = new URL(`${httpConfig.baseUrl}${interpolate(httpConfig.path, vars)}`);
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

  const fetchImpl = deps.http ?? ((u: string, o: Parameters<typeof guardedFetch>[1]) => guardedFetch(u, { timeoutMs: 30_000, ...o }));
  try {
    const res = await fetchImpl(url.toString(), { method: httpConfig.method, headers, body });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        code: res.status >= 500 ? 'transient_5xx' : 'client_4xx',
        error: `API error (${res.status})`,
      };
    }
    return { success: true, status: res.status, data };
  } catch (err) {
    // An SSRF refusal (a private/loopback host) is a transport failure — never echo the URL.
    if (err instanceof SsrfError) return { success: false, code: 'transport_error', error: 'Pedido bloqueado por segurança.' };
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, code: 'transport_error', error: msg.includes('abort') ? 'Request timed out' : 'Não foi possível contactar o serviço.' };
  }
}

// ---------------------------------------------------------------------------
// Gmail RFC 2822 + base64url raw builder (send_email_simple)
// ---------------------------------------------------------------------------

function base64url(input: string | Buffer): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildGmailRaw(args: Record<string, unknown>, fromEmail: string | undefined): string {
  const to = String(args.to ?? '').trim();
  const subject = String(args.subject ?? '').trim();
  const bodyText = String(args.body ?? '');
  if (!to) throw new Error('send_email_simple: "to" is required');
  if (!subject) throw new Error('send_email_simple: "subject" is required');
  const from = fromEmail ?? 'me';
  const isAscii = [...subject].every((c) => c.charCodeAt(0) <= 0x7f);
  const encodedSubject = isAscii ? subject : `=?utf-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
  const attachmentB64 = typeof args.attachmentBase64 === 'string' && args.attachmentBase64.length > 0 ? args.attachmentBase64 : undefined;

  if (!attachmentB64) {
    const message =
      `From: ${from}\r\nTo: ${to}\r\nSubject: ${encodedSubject}\r\n` +
      `MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${bodyText}`;
    return base64url(message);
  }
  const boundary = `=_ekoa_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const wrappedB64 = attachmentB64.replace(/(.{76})/g, '$1\r\n');
  const filename = String(args.attachmentFilename ?? 'attachment.bin').replace(/[\r\n"]/g, '_');
  const mime = String(args.attachmentMimeType ?? 'application/octet-stream');
  const message =
    `From: ${from}\r\nTo: ${to}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${bodyText}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}; name="${filename}"\r\n` +
    `Content-Disposition: attachment; filename="${filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrappedB64}\r\n` +
    `--${boundary}--\r\n`;
  return base64url(message);
}
