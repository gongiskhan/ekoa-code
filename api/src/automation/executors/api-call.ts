/**
 * API call step executor.
 *
 * Performs an HTTP request via native fetch and captures the response.
 * Auth-shaped headers MUST be routed via `authIntegrationKey`; raw
 * credentials in headers are rejected at validation time (planner side).
 *
 * Template interpolation handles {{input.x}}, {{capture.x}}, and
 * {{integration.<key>.<field>}} for credential injection.
 *
 * ============================ THE WRITE GATE ON THIS RAIL ====================================
 * C2 made a `mutates: true` INTEGRATION ACTION need a human. This step type reaches the same
 * effect one step over: an `api_call` performs any HTTP method against any URL, with the same
 * integration credentials injected, and was authorable by exactly the agent that would have been
 * refused at the Action gate - the automation planner, the `achieve` author, and (until the same
 * change) the rehearsal fixer's `replace_current`. A gate that is a property of the Action model
 * and not of the EFFECT is not a gate.
 *
 * WHERE THE LINE IS DRAWN: the HTTP method. `GET`/`HEAD`/`OPTIONS` auto-run; every other method is
 * a write and needs a human. That is the only signal a raw step carries that is about the effect
 * rather than about the wording of a description - the RFC-7231 safe-method set is the direct
 * analogue of `mutates`, it is not model-authored, and it cannot be talked around by naming the
 * step "fetch the report".
 *
 * WHICH CONSENT STORE, AND WHY NOT `integrations/action-consent.ts` (Rule 1 in full). C2's module
 * is the right one for an ACTION: it is keyed on (org, user, integrationKey, actionName, shape) and
 * a human answers it on the integration's action-approvals surface. A raw `api_call` step is not an
 * action of any integration - it appears in no definition - so `POST /integrations/:key/actions/
 * :actionName/approval` resolves nothing for it and 404s. Gating this rail on that store would
 * therefore be a BAN, not a gate: every mutating `api_call` refused forever with no reachable way
 * to say yes. The engine already owns a STEP-level consent ceremony - pause the run, emit
 * `awaiting_consent`, dialog with once / always / stop, `resolveConsent` on the handler - and that
 * ceremony's "sempre" writes to `automation/consent.ts`'s `approved_commands` store. A step gate
 * that pauses through it and then reads a DIFFERENT store makes "aprovar sempre" an infinite loop
 * (the exact bug `runApprovedShapes` exists to prevent, one store over). So this reuses the
 * automation tier's EXISTING consent module - no second implementation is written anywhere - and
 * an `api_call` step is now confirmed the same way a `local_command` step has always been.
 *
 * The shape is namespaced `api_call:<sha256>`; see `apiCallConsentShape`.
 */

import { createHash } from 'node:crypto';
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
import { isCommandShapeApproved } from '../consent.js';
import { guardedFetch } from '../../services/url-fetcher.js';
import { SsrfError } from '../../services/url-safety.js';
// Cofre R-6: one value-keyed masker for the whole repo. The private copy that used to live in this
// file matched only the RAW literal, so a URL-encoded/base64/JSON-escaped occurrence of a secret
// walked straight into the persisted step record.
import { secretRegistryFromFields } from '../../security/redaction.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024;

/**
 * The methods that auto-run: RFC 7231's safe set. Everything else is a write.
 *
 * `OPTIONS` is here because it is safe by definition (a preflight/capability probe) and excluding
 * it would prompt for something that changes nothing. `TRACE` is not in the step vocabulary.
 */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Does this step's method write? Fail-closed: an unrecognised/absent method is a write. */
export function apiCallStepMutates(method: string | undefined): boolean {
  return !SAFE_METHODS.has(String(method ?? '').toUpperCase());
}

/**
 * The consent fingerprint of an `api_call` step - the analogue of `command-shape.ts` for HTTP.
 *
 * OVER THE TEMPLATE, NOT THE INTERPOLATED REQUEST, and deliberately the same choice C2's
 * `actionShape` makes: the human approves an action's `httpConfig`, not one run's rendered URL. A
 * shape over interpolated values would re-prompt on every run whose inputs differ by an id, which
 * is the reliable way to train a user to click through the dialog. What the dialog therefore shows
 * - and what is approved - is the template, variables visible.
 *
 * INCLUDED: the method, the URL template, the header templates, the body template + kind, and the
 * `authIntegrationKey` (which credential is spent). Changing ANY of them is a different write:
 * "POST /messages with body A" and "POST /messages with body B" differ only in a body template,
 * exactly the case C2 names.
 *
 * NAMESPACED `api_call:` and hashed. Namespaced because this shape shares the `approved_commands`
 * store with argv-derived command shapes and the two vocabularies must not collide; hashed because
 * a URL template can carry a user's private path and the shape is what gets stored and listed.
 * (A crafted argv could in principle spell an `api_call:<hex>` string - it would still have to be
 * shown to a human and approved as a command, and would then only authorise executing a
 * nonexistent binary; the collision is inert in both directions.)
 */
export function apiCallConsentShape(spec: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyKind?: string;
  authIntegrationKey?: string;
}): string {
  const headers = Object.entries(spec.headers ?? {})
    .map(([k, v]) => [k.toLowerCase(), v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const tuple = JSON.stringify([
    String(spec.method ?? '').toUpperCase(),
    spec.url ?? '',
    headers,
    spec.body ?? null,
    spec.bodyKind ?? null,
    spec.authIntegrationKey ?? null,
  ]);
  return `api_call:${createHash('sha256').update(tuple).digest('hex')}`;
}

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
  const { step, index, ctx, inputs, baseRecord, stepStart, finishRecord } = args;

  const spec = step.apiRequest;
  if (!spec || !spec.url || !spec.method) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: { message: `api_call step ${step.id} missing apiRequest.method or .url`, recoverable: false },
    });
  }

  // WRITE GATE (see the module header). BEFORE the credential load, so a write nobody approved
  // never causes an integration credential to be decrypted - C2's ordering, and the reason the
  // shape is over the template rather than the interpolated request.
  //
  // NON-RECOVERABLE on purpose. `shouldAttemptFix` refuses a non-recoverable record, so the
  // self-heal fixer is never invited to "repair" a refusal by rewriting the very step that was
  // refused; the engine turns this record into the run's consent pause instead.
  if (apiCallStepMutates(spec.method)) {
    const shape = apiCallConsentShape(spec);
    const scope = { userId: ctx.ownerUserId, orgId: ctx.orgId, pairingId: null };
    // A store that cannot be read is NOT an approval. `isCommandShapeApproved` already treats an
    // unknown, legacy or expired row as a miss; this extends the same direction to the store being
    // unreachable, so a database blip can never be the reason a write ran unapproved.
    const approved =
      ctx.runApprovedShapes?.has(shape) === true ||
      (await isCommandShapeApproved(scope, shape).catch(() => false));
    if (!approved) {
      const target = `${spec.method} ${spec.url}`;
      return finishRecord(baseRecord, 'failed', stepStart, {
        tier: 'cache',
        error: {
          message: `este passo escreve (${target}) e precisa da sua autorização antes de correr`,
          recoverable: false,
          // The engine reads this to raise the run's consent pause. `argv` is the dialog's
          // "what exactly will run?" detail - for HTTP that is the method and the URL TEMPLATE,
          // which carries no interpolated secret (a credential only ever enters after this point).
          details: {
            kind: 'awaiting_consent',
            stepIndex: index,
            shape,
            argv: [String(spec.method).toUpperCase(), spec.url],
            description: `pedido HTTP ${target}${spec.authIntegrationKey ? ` com as credenciais de ${spec.authIntegrationKey}` : ''}`,
            approvalScope: scope,
          },
        },
      });
    }
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
