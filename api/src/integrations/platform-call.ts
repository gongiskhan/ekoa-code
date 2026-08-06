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
 *
 * ============================ THE WRITE GATE ON THIS RAIL (C2 follow-up) ======================
 * C2 put `checkActionConsent` inside `executeUserIntegrationAction` - and named this file as the
 * rail it does NOT cover. Everything routed here (the automation `integration` step, the artifact
 * `integration.call` primitive, the listener supervisor's poll, chat prefetch, email hydration)
 * reached the org's Gmail / Calendar / Drive / OneDrive with NO human confirmation whatsoever.
 * `google-workspace send_email` auto-ran for any org member who could drive an automation.
 *
 * The gate is enforced HERE, in the one function every one of those rails calls, for the same
 * reason C2 enforced its own in the executor rather than in the routers: a gate a caller has to
 * remember is not a gate. `platformActionRequiresConsent` below is the derivation; the approval
 * store, the shape and the fail-closed rule are C2's `action-consent.ts`, reused verbatim
 * (Capability Contract rule 1 - one implementation).
 */

import { actionRequiresConsent, checkActionConsent, describeAction, type IntegrationActionConsentDescriptor } from './action-consent.js';
import { type IntegrationAction, type IntegrationActionHttpConfig } from './definitions.js';
import { resolveDefinition, systemActorForOrg } from './definition-registry.js';
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
  /**
   * The human this call is made ON BEHALF OF, and whose standing approval the write gate looks up.
   *
   * OPTIONAL, and its ABSENCE is a security decision rather than a convenience: a rail that cannot
   * name a user cannot approve a write either, so a mutating action arriving with no acting user is
   * refused outright (see the gate below). The unattended rails - the listener supervisor's poll,
   * chat prefetch, email hydration - deliberately pass nothing: their actions are enumerations, and
   * a poll that could send mail under a standing approval nobody is watching is exactly the trap
   * door this closes. A trigger's `pollAction` may name ANY action of the package, which is what
   * makes that surface worth refusing structurally rather than by convention.
   */
  actingUserId?: string;
}

export interface PlatformCallResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  code?:
    | 'unknown_integration'
    | 'unknown_action'
    | 'not_connected'
    // The action writes and no live human approval covers this exact shape. The SAME token
    // `executeUserIntegrationAction` answers with, on purpose: one vocabulary for "a human has to
    // answer before this proceeds", whichever rail asked.
    | 'awaiting_consent'
    | 'transport_error'
    | 'client_4xx'
    | 'transient_5xx';
  /** Present ONLY with `code: 'awaiting_consent'` - what the human must be shown to answer. */
  consentRequest?: IntegrationActionConsentDescriptor;
}

/**
 * Is this key one of the two shipped PLATFORM packages? Exported because the credential custody
 * differs, and so the rail must: platform tokens live on an org-scoped OAuth row that only
 * `callPlatformIntegration` can read, while `executeUserIntegrationAction` resolves a per-user
 * config row and therefore answers `not_connected` for these keys no matter how connected the org
 * actually is. A caller that dispatches on backing type alone cannot tell the two apart.
 */
export function isPlatformIntegrationKey(integrationKey: string): boolean {
  return keyToProvider(integrationKey) !== null;
}

function keyToProvider(integrationKey: string): PlatformProvider | null {
  if (integrationKey === 'google-workspace') return 'google';
  if (integrationKey === 'microsoft-365') return 'microsoft';
  return null;
}

/**
 * The READ actions of the two shipped platform packages - the ALLOWLIST the write gate derives
 * `mutates` from.
 *
 * WHY AN ALLOWLIST AND NOT THE PACKAGE'S OWN `mutates` FIELD. Both are used (the derivation below
 * requires them to AGREE), but the allowlist is the one that decides the fail-closed direction:
 *
 *  - `mutates` arrives from a `config.json` that is parsed, not schema-validated (definitions.ts),
 *    resolved through the tenant-scoped definition registry. Making a `false` there sufficient
 *    would make "may this send mail as the org?" answerable by whatever the registry returns.
 *  - These are SHIPPED packages at fixed vendor hosts. Their action list is known at build time, so
 *    the read set can be written down once and checked, rather than inferred at runtime.
 *  - An action NOT NAMED HERE - a package bump adding one, a typo, a row that resolves under this
 *    key from somewhere unexpected - is therefore MUTATING. Same direction as C2's
 *    `mutates !== false`: the cost of being wrong is one dialog, not an unapproved write.
 *
 * Deliberately NOT derived from the action name: `read_email` and `modify_email` share a prefix,
 * `complete_task` and `trash_email` read like neither, and a name-shaped heuristic is precisely the
 * guess this rail cannot afford. `platform-action-mutation.test.ts` pins this table against the
 * shipped `config.json` in BOTH directions, so a package bump that adds an action fails the suite
 * instead of silently landing in the gated (or worse, the ungated) set.
 */
const PLATFORM_READ_ACTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  'google-workspace': new Set([
    'list_emails', 'read_email', 'list_events', 'list_files', 'list_labels', 'list_drafts',
    'read_sheet', 'get_file', 'list_task_lists', 'list_tasks', 'get_profile',
  ]),
  'microsoft-365': new Set(['list_emails', 'read_email', 'list_events', 'list_files', 'list_sites', 'get_profile']),
};

/** The read allowlist, for the drift test. Never mutated - the sets are module-private. */
export function platformReadActions(integrationKey: string): ReadonlySet<string> | undefined {
  return PLATFORM_READ_ACTIONS[integrationKey];
}

/**
 * Does this platform action need a human before it runs?
 *
 * BOTH sources must say "read" for the answer to be no: the action is on the shipped read
 * allowlist AND the resolved definition declares a literal `mutates: false` (C2's
 * `actionRequiresConsent`). Either one saying otherwise - an unknown integration key, an unknown
 * action, a `mutates` that is absent / `"false"` / `0` / null - gates the call.
 */
export function platformActionRequiresConsent(
  integrationKey: string,
  action: Pick<IntegrationAction, 'actionName' | 'mutates'>,
): boolean {
  const reads = PLATFORM_READ_ACTIONS[integrationKey];
  if (!reads || !reads.has(action.actionName)) return true;
  return actionRequiresConsent(action);
}

export async function callPlatformIntegration(input: PlatformCallInput, deps: OAuthDeps): Promise<PlatformCallResult> {
  const provider = keyToProvider(input.integrationKey);
  if (!provider) {
    return { success: false, code: 'unknown_integration', error: `unknown platform integration: ${input.integrationKey}` };
  }
  // A2: TENANT-SCOPED. A platform call carries the org (whose OAuth tokens it is about to spend)
  // but no acting user, so the read runs under the org system actor — it can only ever see `org`
  // and `global` rows of this org, never any user's private definition (definition-registry.ts).
  const def = await resolveDefinition(systemActorForOrg(input.orgId), input.integrationKey);
  const action = def?.actions.find((a) => a.actionName === input.actionName);
  if (!action?.httpConfig) {
    return { success: false, code: 'unknown_action', error: `action "${input.actionName}" not found on ${input.integrationKey}` };
  }

  // WRITE GATE. Placed after the shape gates and BEFORE `getValidPlatformTokens`, so an unapproved
  // write never causes the org's OAuth token to be decrypted, refreshed, or spent - the same
  // ordering, and the same reasoning, as C2's gate in `executeUserIntegrationAction`. It has one
  // visible consequence, and it is the intended one: an unapproved write on a platform that is not
  // even connected answers `awaiting_consent` rather than `not_connected`, so the gate cannot be
  // probed for connection state by a caller who has not been approved for the action.
  //
  // A READ (on the allowlist AND declared `mutates: false`) falls straight through with no store
  // lookup, so every existing automation, listener poll, prefetch and hydration keeps behaving
  // exactly as it did (Rule 7 additive).
  if (platformActionRequiresConsent(input.integrationKey, action)) {
    // `mutates` is forced true rather than passed through: the allowlist has already decided this
    // is a write, and `checkActionConsent` must not be able to reach the "not_mutating" exit on a
    // definition field the allowlist just overruled. The SHAPE is unaffected - `actionShape` hashes
    // the backing, transport, httpConfig and binding, never `mutates` - so the fingerprint here is
    // byte-identical to the one the approval route showed the human.
    const gated: IntegrationAction = { ...action, mutates: true };
    if (!input.actingUserId) {
      // NOBODY TO ATTRIBUTE THIS TO. An approval is keyed on (org, USER, action, shape); a rail
      // that names no user has no approval to find and never will. Refused rather than allowed,
      // and refused rather than silently attributed to some org admin.
      return {
        success: false,
        code: 'awaiting_consent',
        error: `action "${input.actionName}" on ${input.integrationKey} writes and cannot run on an unattended rail - it needs a named human's approval`,
        consentRequest: describeAction(input.integrationKey, gated),
      };
    }
    const verdict = await checkActionConsent(
      { orgId: input.orgId, userId: input.actingUserId },
      input.integrationKey,
      gated,
    );
    if (!verdict.allowed) {
      return {
        success: false,
        code: 'awaiting_consent',
        error: `action "${input.actionName}" on ${input.integrationKey} writes (${verdict.request.target}) and needs the owner's approval before it can run`,
        consentRequest: verdict.request,
      };
    }
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

  // Gmail send_email_simple / create_draft_simple: the static template cannot build an RFC 2822
  // message, so encode the structured fields into the `raw` arg here (mirrors the account's own
  // From). Both actions take the SAME structured fields and post the SAME `raw` — they differ only
  // in the Gmail endpoint the package points them at (messages/send vs drafts) — so they share this
  // one encoder rather than growing a second, drifting copy.
  const actionArgs = { ...input.args };
  if (
    input.integrationKey === 'google-workspace' &&
    (input.actionName === 'send_email_simple' || input.actionName === 'create_draft_simple')
  ) {
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
  // Shared by send_email_simple and create_draft_simple — named generically so the draft path does
  // not report a send action's name back to the caller.
  if (!to) throw new Error('gmail structured message: "to" is required');
  if (!subject) throw new Error('gmail structured message: "subject" is required');
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
