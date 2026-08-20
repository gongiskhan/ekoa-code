/**
 * User-defined integration action runner (ch03 §3.8.13/§3.8.15; carryover-audit B25). The analog
 * of the platform API caller (platform-call.ts) for the shipped, user-CONNECTED integrations
 * (stripe, slack, …): resolve the action's HTTP shape from the versioned package definition,
 * load the owner's encrypted credential row, decrypt just-in-time, interpolate, and call the
 * user-configured endpoint. Credentials are never returned — only the HTTP response is; the
 * request/response dump surfaced on failure is credential-redacted.
 *
 * EGRESS POSTURE. The original scope statement (spec §9 invariant 8) read: "User-defined
 * integration actions call arbitrary user-configured endpoints by design … run under the owner's
 * own credentials, and are not SSRF-gated", and this path sent on a bare `fetch`. That has been
 * overtaken twice and the sentence is kept only so the drift is legible: Cofre R-2 put the request
 * behind `guardedFetch`, and C2 (below) put it behind the credential's own origin binding. "By
 * design" described who chooses the URL, never that the choice is unconstrained.
 * (The transport stays injectable so tests fake it without a live call — and the origin check is
 * asserted OUTSIDE it, so injecting a transport cannot step around the binding.)
 *
 * This is the function the automation engine's `integration` step calls for a non-platform key.
 * Auth types executed: `api_key`, `none` (OAuth2/service_account are platform-only).
 *
 * BACKING DISPATCH (C1). Which of the unified Action model's backings an action carries is decided
 * ONCE, by `resolveBackingType` (definitions.ts), never re-derived here: `api-call` takes the HTTP
 * path below, `browser-steps` and a materialised `bash-cli` both delegate to the injected
 * automation-backed handler (the seam the lead wires to automation/); absent that seam, or for an
 * unbound `bash-cli`, the result is a coded, non-throwing refusal. There is deliberately NO
 * server-side CLI runner: bash runs on the user's paired machine, which the automation engine owns.
 *
 * WRITE GATE (C2). A `mutates` action needs a human approval before it runs, and the check lives
 * HERE rather than on any route because this function is the single funnel every rail goes through
 * — the capability route, the automation engine's `integration` step, the listener supervisor's
 * poll tick and the agent tool seam all end up on this line. A gate on a route would be a gate on
 * one of four doors. `action-consent.ts` owns the approval store and the fail-closed rule (only a
 * literal `mutates: false` is a read); this module owns WHEN it is consulted: before the owner's
 * credentials are loaded, let alone decrypted.
 *
 * ORIGIN BINDING (C2, closing the CRITICAL B2's review proved). B2 re-pointed the credential rail
 * at the Cofre and named this module as a SECOND credential read path the binding did not cover: it
 * loads and decrypts the owner's credentials itself, then dialled whatever host the package's
 * `baseUrl` named behind nothing but an SSRF guard — which by design permits every public host. The
 * reviewer's probe locked the Cofre item first and the request STILL went out, carrying the live
 * key to `exfil.example`. And this is the rail the listener supervisor and the automation
 * `integration` step both use — i.e. exactly the "listeners poll with no user present" case that
 * RUN_SPEC assumption 5 uses to justify the auto-grant, running with the grant unchecked. The
 * request now resolves the same Cofre item scope B2 wired at the `api_call` seam, from the same two
 * primitives, so there is one egress truth instead of two; `resolveEgressBinding` documents the one
 * case where this rail is deliberately STRICTER and the one case that stays unbound.
 *
 * WS-C ROTATION (C2, same review, HIGH): a provider rotation writes BOTH credential stores, through
 * the ONE implementation of that job — `service.persistRotatedCredentials`, not a sibling body here.
 *
 * RULE-10 MEASUREMENT (C2, same review, MEDIUM): this rail decrypts the config ITSELF rather than
 * going through the composition root's credential loader, so the shadow comparator never saw it —
 * and since the listener poll runs through here, listener ticks were absent from the sample the
 * 2026-08-15 cutover decision will be read from. `observeCredentialShadow` now runs on this read
 * too (sampled, never throwing, outside the decrypt's own try).
 */

import type { Actor } from '@ekoa/shared';
import {
  resolveBackingType,
  IntegrationActionBackingTypeError,
  type IntegrationActionBackingType,
  type IntegrationActionHttpConfig,
} from './definitions.js';
import { actionRequiresConsent, actionShape, checkActionConsent, targetResolutionOf, type IntegrationActionConsentDescriptor } from './action-consent.js';
// THE ONE RESOLUTION (S1 round four). This module used to inline it; it is now shared with the
// evidence collector so "what a run reaches" and "what a retention decision believes a run reaches"
// are the same function rather than two that drifted. See `action-resolution.ts`'s header.
import { resolveOwnerActionSurface } from './action-resolution.js';
import {
  resolveCredentialEgressBinding,
  observeCredentialShadow,
} from './credential-cofre.js';
import { guardedFetch } from '../services/url-fetcher.js';
import { assertOriginAllowed, CredentialOriginError } from '../security/origin-binding.js';
import { persistRotatedCredentials, type IntegrationConfigDoc } from './service.js';
import { envelopeDecrypt } from '../data/crypto.js';
import {
  interpolate,
  interpolateObj,
  buildVars,
  redactHeaders,
  redactBody,
  redactUrl,
  redactSecretValuesIn,
  redactSecretsDeep,
  truncateForDisplay,
  findHeaderValue,
  formUrlEncode,
} from './http-template.js';
import {
  evidenceSecretsFromValues,
  type ActionEvidenceKey,
  type RecordEvidenceInput,
  type RunStepEvidence,
} from './action-evidence-store.js';

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
  | 'unsupported_transport'
  // C1, the unified Action model's backing discriminator: the package is malformed
  // (`invalid_backing_type`) vs the backing is real but not executable from here
  // (`unsupported_backing_type`). Distinct because the fixes are distinct.
  | 'invalid_backing_type'
  | 'unsupported_backing_type'
  // C2, the write gate: the action mutates and no live human approval covers this exact shape.
  // The SAME token the automation engine uses for its local_command pause, on purpose — one
  // vocabulary for "a human has to answer before this proceeds", whichever rail asks.
  | 'awaiting_consent'
  // C2, the origin binding: the destination is not one of the hosts this credential is bound to.
  // Distinct from an SSRF refusal (the host may be perfectly reachable) and from a 403 from the
  // remote API (`credential_missing_scope`) — nothing was sent.
  | 'origin_refused'
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
  /**
   * Present ONLY with `code: 'awaiting_consent'` — what the human must be shown to answer. Carries
   * no credential and no argument values: which integration, which action, what it does and where
   * it writes. A caller that can reach a human renders it; one that cannot (a listener tick)
   * surfaces the coded failure and stops, which is the correct outcome for an unapproved write.
   */
  consentRequest?: IntegrationActionConsentDescriptor;
}

/** Handler for `automationBinding` actions (integração-por-automação). Injected by the composition
 *  root so this module never imports automation/ (a higher tier). */
export type AutomationBackedHandler = (input: {
  binding: unknown;
  args: Record<string, unknown>;
  credentialFields: Record<string, unknown>;
  orgId: string;
  ownerUserId: string;
  /**
   * WHICH action this is (slice P2.3). Additive-optional, and here for one reason: the automation
   * seam's first move is now to ask whether this action carries a COMPILED RECIPE, and a recipe is
   * keyed on (org, integrationKey, actionName). The `binding` names the automation to run when
   * there is no recipe; it cannot say which action asked.
   *
   * Optional so no existing implementer of this type changes, and a handler that ignores the two
   * fields behaves exactly as it did before.
   */
  integrationKey?: string;
  actionName?: string;
  /**
   * THE OWNER APPROVED THIS ACTION'S WRITES (slice P2.3, trap T4).
   *
   * `true` only when `checkActionConsent` above answered `approved_once`/`approved_always` - i.e.
   * a human was actually asked and actually said yes. A read is `not_mutating`, which is NOT an
   * assent: an action declared `mutates: false` whose learned recipe contains a POST must still
   * stop, because nobody was ever asked about that POST.
   *
   * It is the key to the replay's write gate. Without it the gate could never open and would be a
   * permanent refusal that reads, to a reviewer, as protection.
   */
  writeAssent?: boolean;
  /**
   * THE ACTION'S DECLARED EFFECT (`IntegrationAction.mutates`), which is a different fact from the
   * assent above and is carried for a different reason.
   *
   * `writeAssent` answers "did a human approve this action's writes". This answers "does this action
   * write AT ALL" - and a learned recipe containing no write cannot be the whole of an action that
   * does. Without it the seam cannot tell a read whose recipe legitimately only reads from a WRITE
   * whose recipe silently dropped the write and now reports success for having done nothing.
   */
  mutates?: boolean;
}) => Promise<ExecuteIntegrationActionResult>;

/**
 * Collect the per-step evidence of an automation run (slice S1). INJECTED, never imported: the
 * run record, its `StepRecord.output` and its screenshot paths all live in `automation/`, which is
 * a higher tier this module must not reach into (FIXED-1 / the module-direction table). The
 * composition root binds it exactly as it binds `runAutomationBackedAction`.
 *
 * Answers `null` for a run it cannot resolve - a replay (`replay-…`, which has no
 * `automationRuns` document behind it) or a run already swept.
 */
export type RunEvidenceCollector = (runId: string) => Promise<{
  status?: string;
  steps: RunStepEvidence[];
} | null>;

export interface ExecutorDeps {
  /** Transport seam; default plain fetch (SSRF-exempt by design). Tests inject a fake. */
  fetchImpl?: FetchLike;
  /** Wall-clock timeout for the outbound call (ms). */
  timeoutMs?: number;
  /** Optional automation-backed action handler (the automation/ seam). */
  runAutomationBackedAction?: AutomationBackedHandler;
  /**
   * Persist the evidence of a VALIDATED run (slice S1). Injected so the unit lane can drive the
   * capture without a store; `server.ts` binds it to the real `integration_action_evidence`
   * collection. Absent ⇒ no evidence is recorded and execution is byte-for-byte unchanged, which
   * is what keeps every existing caller of this executor working (Rule 7 additive).
   */
  recordActionEvidence?: (
    key: ActionEvidenceKey,
    input: RecordEvidenceInput,
  ) => Promise<unknown>;
  /** The automation-run half of the same capture. See `RunEvidenceCollector`. */
  collectRunEvidence?: RunEvidenceCollector;
  /**
   * THE READER'S OWN COLLECTION (slice S1, round four) - drop the evidence THIS caller holds for an
   * integration or an action they can no longer resolve.
   *
   * A SEAM AND NOT AN IMPORT, for the same reason `recordActionEvidence` is one: absent ⇒ nothing is
   * collected and execution is byte-for-byte what it was, so no existing caller of this executor
   * changes behaviour (Rule 7 additive).
   *
   * THE SCOPE TYPE CARRIES BOTH TENANCY TERMS AND NO OPTIONAL ONE. `orgId` and `ownerUserId` are
   * required by the type, so the seam cannot be called with a filter that reaches past the caller;
   * `actionName` is the only optional term and its absence means "this owner's rows for this
   * integration", never "everyone's".
   */
  discardOwnActionEvidence?: (scope: OwnActionEvidenceScope) => Promise<number>;
}

/**
 * What the reader's own collection may address: ONE owner, ONE integration, optionally ONE action.
 * There is no org-wide arm and no all-owners arm - a run collects its own rows or nothing.
 */
export interface OwnActionEvidenceScope {
  orgId: string;
  ownerUserId: string;
  integrationKey: string;
  actionName?: string;
}

/**
 * Call the reader's collection seam, BEST EFFORT AND LOUD.
 *
 * The refusal this sits beside has already been decided, so a failure here must not change what the
 * caller is told - the same rule `captureEvidence` follows, for the same reason. FAILING TO COLLECT
 * IS THE SAFE DIRECTION: it leaves an orphaned row, which the boot retention sweep and the owner's
 * own erasure control both still reach.
 */
async function discardOwnEvidence(deps: ExecutorDeps, scope: OwnActionEvidenceScope): Promise<void> {
  if (!deps.discardOwnActionEvidence) return;
  try {
    const dropped = await deps.discardOwnActionEvidence(scope);
    if (dropped > 0) {
      console.log(
        `[integrations] ${scope.orgId}/${scope.ownerUserId} can no longer resolve `
          + `${scope.integrationKey}${scope.actionName ? `/${scope.actionName}` : ''}; `
          + `discarded ${dropped} action-evidence row(s) of their own`,
      );
    }
  } catch (err) {
    console.warn(
      `[integrations] could not collect ${scope.orgId}/${scope.ownerUserId}'s own evidence for `
        + `${scope.integrationKey}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const MAX_BODY_DISPLAY_BYTES = 8_000;

export async function executeUserIntegrationAction(
  input: ExecuteIntegrationActionInput,
  deps: ExecutorDeps = {},
): Promise<ExecuteIntegrationActionResult> {
  // A2: TENANT-SCOPED resolution. The call already carries the verified org + owner (the same pair
  // `findConfigForOwner` below is scoped to), so the package this action runs against is the one
  // THIS org sees — a tenant definition first, the shipped baseline otherwise.
  // The ONE read actor for this call: the verified (org, owner) pair the input carries. Every
  // tenant-scoped read below — the definition, the Cofre item behind the origin binding, the
  // shadow refresh after a rotation — is taken under it, so none of them can resolve a tenant the
  // caller did not name.
  const actor = { userId: input.ownerUserId, orgId: input.orgId, role: 'user' } as const;

  // THE CONFIG ROW IS READ FIRST, and that ordering is load-bearing (2026-08-03 review, CRITICAL-1).
  // An integration definition resolves per (key, PRINCIPAL) — `getForActor` answers the reader's own
  // `private` row before any `org`/`global`/baseline one — so "which package does this action come
  // from" is not a fact about the key. Resolving it as the READER let a same-org peer with role
  // `user` author, in their own private row, both the action that runs and the hosts the ORG-ADMIN's
  // credential may be sent to. The row therefore has to be in hand before the definition is
  // resolved, so the definition can be resolved as the credential's CUSTODIAN.
  //
  // NOTHING IS DECRYPTED HERE and no refusal moves: the write gate below still answers before
  // `not_connected`/`disabled`, so an unapproved write still cannot probe connection state and
  // still cannot cause a credential to be decrypted. What changed is one un-decrypted row read
  // moving above a gate that never depended on it.
  //
  // THE RESOLUTION ITSELF MOVED OUT (S1 round four) to `action-resolution.ts`, and the move is what
  // makes the evidence collector safe rather than being a tidy-up. The collector has to know
  // whether a reader can still reach an action, and three rounds of answering that with a
  // re-derivation deleted other tenants' data. It now calls THE SAME function this line calls, so a
  // divergence between "what a run resolves" and "what a retention decision believes a run
  // resolves" is not expressible. Byte-for-byte the same order, the same actor and the same
  // refusals as before; see that module's header for the three axes a re-derivation got wrong.
  const surface = await resolveOwnerActionSurface(input.orgId, input.ownerUserId, input.integrationKey);
  if (!surface) {
    // Fail closed on an incoherent (actor, config) pair — an org-less reader, or a row from another
    // tenant. There is no principal to resolve the package as, and "resolve it as somebody" is the
    // failure mode this whole change exists to remove.
    return {
      success: false,
      code: 'credential_invalid',
      error: `cannot establish the credential custodian for ${input.integrationKey}`,
    };
  }
  // `definitionActor` is deliberately NOT destructured here: the egress binding below re-derives the
  // custodian from the CONFIG ROW through the shared rule (`resolveCredentialEgressBinding`), so
  // that the package an action comes from and the package its allow-list comes from cannot be two
  // different packages. Binding a second name to the same principal would invite a future caller to
  // pass it there and quietly split that guarantee in two.
  const { config, definition: def } = surface;

  if (!def) {
    // ── THE READER'S OWN COLLECTION (S1 round four) ───────────────────────────────────────────
    // This reader has just proved, through the ONE production resolution, that they cannot reach
    // this integration at all. Every evidence row THEY hold for it is therefore a sample of an
    // action nobody can run again, pinning its screenshots out of the 7-day sweep for ever. It is
    // collected HERE because here is the only place the answer is knowable: a writer in another org
    // cannot see this reader's config, cannot see which document this reader resolves, and cannot
    // see whether a frozen published snapshot still offers it. Scoped to (this org, this owner) and
    // nothing else - the blast radius is the caller's own row, by construction.
    await discardOwnEvidence(deps, { orgId: input.orgId, ownerUserId: input.ownerUserId, integrationKey: input.integrationKey });
    return { success: false, code: 'unknown_integration', error: `unknown integration: ${input.integrationKey}` };
  }

  const action = def.actions.find((a) => a.actionName === input.actionName);
  if (!action) {
    // The same collection, one action wide: the key still resolves for this reader, this action
    // does not. A row exists here only if this very owner ran this very action successfully once,
    // so there is no way for a mistyped action name to reach anyone else's data.
    await discardOwnEvidence(deps, {
      orgId: input.orgId,
      ownerUserId: input.ownerUserId,
      integrationKey: input.integrationKey,
      actionName: input.actionName,
    });
    const available = def.actions.map((a) => a.actionName).join(', ');
    return { success: false, code: 'unknown_action', error: `action "${input.actionName}" not found on ${input.integrationKey}. Available: ${available}` };
  }
  // TRANSPORT GATE (2A-S4). This executor runs exactly two kinds of action: HTTP-backed
  // (`httpConfig`) and automation-backed (`automationBinding`). A package may legitimately declare
  // an action that needs a different wire protocol (the shipped `imap` package's poll action
  // declares `transport: "imap"`). Refuse it here — before any credential is decrypted — with a
  // clear, coded error. The alternative the ekoa-dev scaffold used, a placeholder
  // http://127.0.0.1:0 URL, fails with an unrelated connect error and reads like a network blip; a
  // listener driving this action must fail with the truth ("not available in this version"), never
  // a fabricated empty result.
  const transport = action.transport ?? 'http';
  if (transport !== 'http') {
    return {
      success: false,
      code: 'unsupported_transport',
      error: `action "${input.actionName}" on ${input.integrationKey} needs the "${transport}" transport, which is not available in this version — this executor runs HTTP-backed and automation-backed actions only`,
    };
  }
  // BACKING GATE (C1). `resolveBackingType` is the ONE derivation of "how does this action run";
  // an ABSENT `backingType` reproduces the historical precedence exactly (binding beats httpConfig).
  // Resolved HERE, alongside the transport gate and before any credential is decrypted, because a
  // malformed or unrunnable backing must be refused without ever touching the owner's secrets.
  let backingType: IntegrationActionBackingType;
  try {
    backingType = resolveBackingType(action);
  } catch (err) {
    if (!(err instanceof IntegrationActionBackingTypeError)) throw err;
    return { success: false, code: 'invalid_backing_type', error: `${err.message} (integration ${input.integrationKey})` };
  }
  // BASH NEVER RUNS ON THE CORTEX HOST. A bash-cli action executes on the user's PAIRED machine
  // through the automation engine's `local_command` step, so it is runnable here only once it has
  // been materialised as an automation and bound (`automationBinding`) — then it takes the same
  // seam as a browser-steps action. Unbound, it is refused; there is no server-side CLI runner.
  if (backingType === 'bash-cli' && !action.automationBinding) {
    return {
      success: false,
      code: 'unsupported_backing_type',
      error: `action "${input.actionName}" on ${input.integrationKey} is bash-cli-backed and is not bound to an automation — bash runs on the user's paired machine through the automation engine, never on the Cortex host`,
    };
  }
  if (!action.httpConfig && !action.automationBinding) {
    return { success: false, code: 'unsupported_auth_type', error: `action "${input.actionName}" has no httpConfig — only HTTP-backed actions are executable` };
  }

  // WRITE GATE (C2). Placed HERE — after the shape gates, before `findConfigForOwner` — so that a
  // write nobody approved never causes a credential to be read, let alone decrypted or sent. The
  // ordering has one visible consequence, and it is the intended one: an unapproved write on an
  // integration that is not even connected answers `awaiting_consent` rather than `not_connected`.
  // Refusing for the stronger reason first is the fail-closed direction, and it means the gate
  // cannot be probed for connection state by a caller who has not been approved for the action.
  //
  // A read (`mutates: false`, and ONLY a literal false — see action-consent.ts) falls straight
  // through with no store lookup: an existing non-mutating integration behaves exactly as it did
  // before this slice, prompt-free (Rule 7 additive).
  // The RESOLVED destination comes from `config.publicConfigValues` — the non-secret projection
  // stored in PLAINTEXT beside the ciphertext (service.ts). Reading it decrypts NOTHING, so the
  // sentence above stays true: an unapproved write still causes no credential to be read. What it
  // buys is that the approval is keyed on where this call actually goes, so a config edit that
  // moves the destination cannot be covered by an approval granted for the old one.
  const consent = await checkActionConsent(
    { orgId: input.orgId, userId: input.ownerUserId },
    input.integrationKey,
    action,
    undefined,
    targetResolutionOf(def.configSchema, config?.publicConfigValues),
  );
  if (!consent.allowed) {
    return {
      success: false,
      code: 'awaiting_consent',
      error: `action "${input.actionName}" on ${input.integrationKey} writes (${consent.request.target}) and needs the owner's approval before it can run`,
      consentRequest: consent.request,
    };
  }

  if (!config && def.authType !== 'none') {
    return { success: false, code: 'not_connected', error: `integration ${input.integrationKey} is not connected for this user` };
  }
  if (config && !config.enabled) {
    return { success: false, code: 'disabled', error: `integration ${input.integrationKey} is disabled` };
  }

  const decrypted = await decryptCredentialFields(config);
  if (decrypted === DECRYPT_FAILED) {
    return { success: false, code: 'credential_decrypt_failed', error: 'failed to decrypt credentials' };
  }
  const credentialFields = decrypted;

  // RULE-10 MEASUREMENT (C2, closing B2's review MEDIUM-1). Every OTHER credential read runs the
  // WS-C comparator; this one did not, because this rail decrypts the config itself instead of
  // going through the composition root's loader seam. That is not a small omission: the listener
  // poll runs through this function, so the sample behind the 2026-08-15 cutover decision contained
  // no listener ticks at all — it would have been read as "every read" while measuring two rails
  // out of three.
  //
  // OUTSIDE the decrypt's `try` on purpose (B2 review L1): "the credential did not decrypt" and
  // "the measurement of the credential failed" must never be the same answer to a caller. The
  // observer is sampled per (config, reader) and absorbs everything, so this can neither slow the
  // rail down per call nor fail it.
  if (config) {
    await observeCredentialShadow(
      actor,
      config,
      Object.fromEntries(Object.entries(credentialFields).map(([k, v]) => [k, String(v)])),
    );
  }

  // Provider credential resolver (e.g. Zoho Sign): mint EXTRA computed fields (a
  // fresh access token + api_base) the versioned config's `{{...}}` templates
  // interpolate, and persist any rotated credential (grant_code → refresh_token)
  // back into the saved config's encrypted bundle. No-op for keys with no resolver.
  let computedFields: Record<string, string>;
  try {
    computedFields = await resolveProviderCredentials(input.integrationKey, credentialFields, {
      ownerUserId: input.ownerUserId,
      superAdmin: false,
      configId: config?._id,
      // WS-C ROTATION (C2, closing B2's review HIGH). This used to write the legacy column here and
      // nothing else, so a rotating integration's Cofre shadow went permanently stale from its
      // first rotation: permanent Rule-10 `drift`, and at the 2026-08-15 cutover a spent grant code
      // handed back in place of the refresh token. There is now ONE implementation of "persist a
      // provider-rotated credential" — `service.persistRotatedCredentials` — and this rail calls it
      // rather than carrying a sibling body. Its custody rule is the reason it is the survivor: on
      // an org-shared config with no item yet it REFUSES to mint, because the rotating user is
      // whoever happened to be running, and minting would put custody and the lock switch in the
      // Cofre of someone who never typed the credential. A rotation refreshes a shadow; it does not
      // perform the connect ceremony.
      onCredentialUpdate: config
        ? async (updates) => {
            const outcome = await persistRotatedCredentials(config._id, input.ownerUserId, credentialFields, updates);
            if (outcome !== 'updated') {
              // Never silent: a one-time grant-code exchange that did not persist is unrecoverable,
              // because the code is already burnt.
              console.warn(`[action-executor] rotated credential for ${input.integrationKey} was not persisted (${outcome})`);
            }
          }
        : undefined,
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return {
      success: false,
      code: e?.code === 'not_connected' ? 'not_connected' : 'credential_invalid',
      error: e?.message || 'Falha ao resolver as credenciais da integração.',
    };
  }
  const resolvedFields = { ...credentialFields, ...computedFields };

  // THE BINDING IS RESOLVED BEFORE THE DISPATCH, NOT INSIDE ONE BRANCH OF IT (2026-08-03 review,
  // MEDIUM-1). It used to sit below, on the `api-call` path only, so the automation-backed branch
  // returned with the decrypted bundle in hand having consulted the Cofre grant not at all: a
  // LOCKED item did not stop a `browser-steps` or materialised `bash-cli` action receiving the
  // credentials. "Lock = revoke, load-bearing from day one" was therefore true of one of two
  // dispatch branches while the docblock claimed one egress truth.
  const binding = await resolveEgressBinding(actor, input.integrationKey, config);

  // BACKING DISPATCH (C1). `browser-steps` and a MATERIALISED `bash-cli` both run through the one
  // automation seam (the engine owns the paired machine and the browser alike); `api-call` is the
  // HTTP path below. With no explicit `backingType` this is byte-for-byte the previous rule —
  // an `automationBinding` took precedence over any `httpConfig`, and still derives `browser-steps`.
  if (backingType === 'browser-steps' || backingType === 'bash-cli') {
    // WHAT THIS BRANCH GUARANTEES, EXACTLY. The GRANT half of the binding is enforced: a locked,
    // revoked, stale or unresolvable credential is refused here and the bundle never leaves this
    // function. The ORIGIN half is not enforceable from here and is not claimed to be — the
    // destinations of a browser flow or a paired-machine command are the automation engine's, not a
    // URL this module builds, so there is nothing here to check them against. The exposure that
    // leaves is bounded by the engine: `automation/template-vars.ts` redacts
    // `{{input.credentials…}}` out of model-visible text and the only field a browser step actually
    // consumes is `storageState`.
    //
    // Refused BEFORE the seam check on purpose: a revoked credential must be refused whether or not
    // the automation seam happens to be wired, so the two failures can never be confused.
    if (binding.enforced && binding.origins.length === 0) {
      return {
        success: false,
        code: 'origin_refused',
        error: `the credential for ${input.integrationKey} is locked or no longer reachable — an automation-backed action may not be given it`,
      };
    }
    if (!deps.runAutomationBackedAction) {
      return { success: false, code: 'automation_required', error: `action "${input.actionName}" is automation-backed and requires the automation seam` };
    }
    const automationResult = await deps.runAutomationBackedAction({
      binding: action.automationBinding,
      args: input.args,
      credentialFields: resolvedFields,
      orgId: input.orgId,
      ownerUserId: input.ownerUserId,
      // Names the action so the seam can look for its compiled recipe (P2.3). Carries no new
      // authority: both values were already the caller's own verified inputs to this function.
      integrationKey: input.integrationKey,
      actionName: input.actionName,
      // THE WRITE ASSENT, carried rather than re-derived. `checkActionConsent` above is the ONE
      // approval gate for this action's writes and it has already run; a replayed write is the
      // same write by a cheaper route, so it rides the same answer. `not_mutating` is excluded on
      // purpose - a read that was never gated is not an approval of anything.
      // (`consent.allowed` is already narrowed to `true` here - the refusal returned above.)
      writeAssent: consent.reason !== 'not_mutating',
      // WHAT THE ACTION IS, as its author declared it - read straight off the resolved action rather
      // than inferred from the consent verdict beside it. The two are equal today and are not the
      // same statement: an approval is a fact about a human, `mutates` is a fact about the action,
      // and the recipe-coverage refusal downstream is judged against the action.
      //
      // READ THROUGH `actionRequiresConsent`, WHICH IS THIS REPO'S ONE READING OF THE FIELD: only a
      // literal `false` is a read. `mutates` arrives off a `config.json` that is parsed rather than
      // schema-validated and off Mongo rows an agent authored, so absent / `"false"` / `0` / `null`
      // must all read as WRITE. The first cut here was `action.mutates === true`, which inverted
      // that for exactly those values - and the consequence downstream is not one extra dialog, it
      // is a read-only recipe stored for a write action and every later run reporting success for
      // having done nothing. Calling the predicate rather than restating it is what keeps the two
      // gates from drifting apart.
      mutates: actionRequiresConsent(action),
    });
    // EVIDENCE (slice S1). A run that SUCCEEDED is the "last validated run" the detail page renders
    // and the graduation prerequisite reads. Pointers only - `{runId, stepIndex}` plus capped
    // excerpts - never copies of the screenshots, which stay behind the authenticated screenshot
    // plane that already enforces org + owner on every byte.
    //
    // KEYED BY (org, OWNER, integration, action) - the same pair `findConfigForOwner` above resolved
    // the credential under. This ran against ONE person's third-party account, and the EXCERPT
    // stored beside the pointer is that person's data even though the PNG behind the pointer is
    // still guarded by the plane's own org+owner check. See `action-evidence-store.ts`'s tenancy
    // section for the two consequences an org-only key had.
    await captureEvidence(
      { orgId: input.orgId, ownerUserId: input.ownerUserId, integrationKey: input.integrationKey, actionName: input.actionName },
      backingType,
      // The bytes this run exercised. `promoteToTrusted` binds the graduation prerequisite to this
      // rather than to the action's name, so a re-authored action cannot graduate on an old run.
      actionShape(input.integrationKey, action),
      deps,
      async () => {
        if (!automationResult.success) return null;
        const runId = runIdOf(automationResult.data);
        if (runId === undefined) return null;
        const collected = await deps.collectRunEvidence?.(runId);
        if (!collected) return null;
        return {
          kind: 'automation' as const,
          runId,
          ...(collected.status !== undefined ? { status: collected.status } : {}),
          steps: collected.steps,
        };
      },
      // The values this run actually resolved, so the store's last gate is checked against a real
      // registry rather than an empty one. `resolvedFields` is the same bundle the seam received.
      Object.values(resolvedFields),
    );
    return automationResult;
  }

  // `api-call`: guaranteed to carry an httpConfig — an EXPLICIT api-call without one is refused by
  // `resolveBackingType`, and a DERIVED one without either shape by the guard above.
  const httpConfig = action.httpConfig!;
  const { stringVars, rawVars } = buildVars(input.args, resolvedFields);
  // The credential VALUES (stored + resolver-minted, e.g. a fresh access_token) —
  // for value-based redaction in the failure summary and the returned data.
  const secretValues = Object.values(resolvedFields)
    .filter((v): v is string => typeof v === 'string' && v.length >= 4);
  return executeHttpAction(
    httpConfig,
    stringVars,
    rawVars,
    deps,
    secretValues,
    binding,
    input.integrationKey,
    // EVIDENCE (slice S1). The redacted `requestSummary` is built on EVERY call and, until this
    // slice, thrown away on success - the failure path was the only one that kept it. The sample is
    // that same object plus a capped response body through the same `redactSecretsDeep`; no new
    // redaction is written here, and reusing the failure path's is the safety argument.
    { orgId: input.orgId, ownerUserId: input.ownerUserId, integrationKey: input.integrationKey, actionName: input.actionName },
    actionShape(input.integrationKey, action),
  );
}

/** The run id an automation-backed answer carries, off `ActionRunEnvelope`. Structural rather than
 *  imported: the envelope's type lives in `automation/`, a tier this module does not depend on. */
function runIdOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const runId = (data as { runId?: unknown }).runId;
  return typeof runId === 'string' && runId !== '' ? runId : undefined;
}

/**
 * Persist one evidence row, BEST EFFORT AND LOUD.
 *
 * The action has already run by the time this is called, so a throw here must never turn a
 * succeeded call into a failed one - the same rule, for the same reason, as
 * `discardEvidenceOfRemovedRecipes`. A missing sample is untidy; a call reported as failed after
 * actually writing to a customer's account is worse.
 */
async function captureEvidence(
  key: ActionEvidenceKey,
  backingType: IntegrationActionBackingType,
  shape: string | undefined,
  deps: ExecutorDeps,
  build: () => Promise<RecordEvidenceInput['evidence'] | null>,
  secretValues: Iterable<unknown>,
): Promise<void> {
  if (!deps.recordActionEvidence) return;
  try {
    const evidence = await build();
    if (!evidence) return;
    await deps.recordActionEvidence(key, {
      backingType,
      ...(shape !== undefined ? { shape } : {}),
      evidence,
      secrets: evidenceSecretsFromValues(secretValues),
    });
  } catch (err) {
    console.warn(
      `[integrations] evidence for ${key.integrationKey}/${key.actionName} was not recorded: `
        + `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Is this request's destination bound, and to what? (C2, closing the CRITICAL B2's review proved:
 * a LOCKED Cofre item's credential still went out to an author-chosen host on this rail, because
 * this rail had no origin check at all — only `guardedFetch`, which by design permits every public
 * host. B2's "lock = revoke, load-bearing from day one" was true for `api_call` steps and false
 * here, on the rail the listener supervisor and the automation `integration` step both use.)
 *
 * NOTHING IS RE-DERIVED, AND NOTHING IS RE-DECIDED. C2 composed the same two primitives as the
 * `api_call` seam but kept its own copy of the composition, and the two copies drifted where it
 * mattered: this one resolved the declared-host fallback as the READER, so for an org-shared config
 * with no Cofre item the allow-list was authored by whoever was running (2026-08-03 review,
 * CRITICAL-1). The rule now lives ONCE, in `credential-cofre.resolveCredentialEgressBinding`, and
 * this function is only its projection onto the shape `executeHttpAction` consumes:
 *
 *   granted -> { enforced: true, origins }   enforce exactly those hosts
 *   refused -> { enforced: true, origins: [] } enforce an empty list: `assertOriginAllowed` refuses
 *   unbound -> { enforced: false, origins: [] } no item and no declared host — SSRF guard only
 *
 * THE `unbound` PROJECTION IS THIS RAIL'S ALONE. The api_call seam has no such branch (an empty
 * allow-list simply refuses there), and it is retained here for the bare-templated-`baseUrl`
 * packages — `{{api_base}}`, `{{api_access_point}}`, `{{graph_base_url}}` (zoho-sign,
 * adobe-acrobat-sign, invoicexpress, whatsapp, ifthenpay) — where the host comes from a credential
 * field at run time and the package declares no literal host to bind to. Those same packages mint
 * no Cofre item for the same reason, so refusing here would take the whole class offline, the
 * shipped signing rail included. What CRITICAL-1 changed is not whether this branch exists but who
 * writes the definition it reads: the credential's custodian, never an arbitrary reader.
 */
async function resolveEgressBinding(
  actor: Actor,
  integrationKey: string,
  config: IntegrationConfigDoc | null,
): Promise<{ enforced: boolean; origins: string[] }> {
  // No actor is passed for the definition: the shared rule derives it from the CONFIG ROW, with the
  // same pure `definitionActorForCredential` this executor already used to resolve the action. One
  // row in, one custodian out, both times — so the package an action comes from and the package its
  // allow-list comes from cannot be two different packages.
  const binding = await resolveCredentialEgressBinding(actor, config, integrationKey);
  if (binding.kind === 'granted') return { enforced: true, origins: binding.origins };
  return { enforced: binding.kind === 'refused', origins: [] };
}

// ============================================================================
// Provider credential resolvers (ch03 §3.8.15; ported from cortex
// integration-action-executor.ts). A resolver maps a decrypted credential bundle
// to EXTRA computed fields the versioned config's `{{...}}` templates interpolate
// (a fresh Bearer / access token + host). Shared by the executor and the
// integration-builder test path so both resolve credentials identically.
// ============================================================================

export interface ProviderResolverCtx {
  ownerUserId?: string;
  superAdmin?: boolean;
  configId?: string;
  onCredentialUpdate?: (updates: Record<string, string>) => Promise<void> | void;
}

export type ProviderCredentialResolver = (
  credentialFields: Record<string, unknown>,
  ctx: ProviderResolverCtx,
) => Promise<Record<string, string>>;

const PROVIDER_CREDENTIAL_RESOLVERS: Record<string, ProviderCredentialResolver> = {
  // Zoho Sign (OAuth): mint `{{api_base}}` + `{{access_token}}` from the stored
  // client_id/secret + refresh_token (or a one-time grant code, which the resolver
  // exchanges and persists via ctx.onCredentialUpdate).
  //
  // NOTE: the 'adobe-acrobat-sign' resolver (a fresh Bearer via getAdobeBearer)
  // lands only with the deferred Adobe OAuth slice — Adobe stays facade-only for
  // now (RUN_LOG: BSM signs via Zoho; live Adobe backend has no consumer).
  'zoho-sign': async (fields, ctx) => {
    const { resolveZohoCredentials } = await import('./zoho-sign.js');
    return resolveZohoCredentials(fields, ctx);
  },
};

/**
 * Run the registered resolver for an integration key (if any) and return the
 * extra computed credential fields to merge in. Returning `{}` is a no-op.
 */
export async function resolveProviderCredentials(
  integrationKey: string,
  credentialFields: Record<string, unknown>,
  ctx: ProviderResolverCtx,
): Promise<Record<string, string>> {
  const resolver = PROVIDER_CREDENTIAL_RESOLVERS[integrationKey];
  if (!resolver) return {};
  return resolver(credentialFields, ctx);
}

const DECRYPT_FAILED = Symbol('decrypt-failed');

/**
 * Decrypt the config's credential blob into a field map, or DECRYPT_FAILED. No config → {}.
 *
 * Cofre B-4: reads through the ORG-BOUND versioned envelope. A v1 row (written before K-1) still
 * decrypts, so adoption needed no flag day; a v2 row is bound to the config's own org, so a row
 * copied between tenants no longer decrypts — which the flat global key permitted.
 */
async function decryptCredentialFields(config: IntegrationConfigDoc | null): Promise<Record<string, unknown> | typeof DECRYPT_FAILED> {
  if (!config || !config.credentialsCiphertext) return {};
  try {
    const plaintext = await envelopeDecrypt(config.credentialsCiphertext, config.orgId);
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
  binding: { enforced: boolean; origins: string[] } = { enforced: false, origins: [] },
  credentialLabel?: string,
  /** Slice S1. Present ⇒ record the 2xx sample under this key. Absent ⇒ nothing is captured, which
   *  is what every existing caller of this function does. */
  evidenceKey?: ActionEvidenceKey,
  /** The action shape the call exercises - stamped on the evidence row (slice S1). */
  evidenceShape?: string,
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
  // Systemic credential-boundary redaction (Codex G8): name-based redaction of headers/body is
  // not enough — a secret can land in a benign-named header (X-Tenant) or body field (note). Build
  // the summary with name-based redaction, then deep VALUE-redact the whole object so ANY secret,
  // in any field, is masked before it is persisted/surfaced on failure.
  const requestSummary = redactSecretsDeep({
    method: httpConfig.method,
    url: redactUrl(requestUrl, secretValues),
    headers: redactHeaders(headers),
    body: body ? truncateForDisplay(redactBody(body), MAX_BODY_DISPLAY_BYTES) : undefined,
  }, secretValues) as { method: string; url: string; headers: Record<string, string>; body?: string };

  // ORIGIN BINDING (C2). Asserted HERE, not inside the default transport, because `deps.fetchImpl`
  // exists: a control that a caller can step around by injecting a transport is not a control. So
  // the check runs against the resolved destination whatever ends up dialling it, and nothing has
  // left this process when it refuses.
  //
  // The refusal message names the host and the allowed entries, and — where the destination could
  // not be parsed — the URL itself, which for a `queryParams: { token: '{{api_key}}' }` action
  // contains a live secret. Value-redacted before it becomes a result, like every other string
  // this module returns.
  //
  // What this replaces (the pre-C2 note, kept for the record): "binding this request to the
  // package's own baseUrl would be tautological, because the package declares that baseUrl itself."
  // True, and still true for the declared-origin fallback. It stopped being the whole story with
  // B2: once the credentials live in a Cofre item, the allowlist is the set of hosts bound at the
  // moment the human typed them, so an action authored or edited AFTERWARDS cannot widen its own
  // egress. That is the non-tautological half, and it was reachable on the automation rail and not
  // on this one. The provenance problem the old note named is unchanged — see
  // `integration-package-baseurl-unreviewed` in findings.
  if (binding.enforced) {
    try {
      assertOriginAllowed(requestUrl, { allowedOrigins: binding.origins, credentialLabel });
    } catch (err) {
      if (!(err instanceof CredentialOriginError)) throw err;
      return {
        success: false,
        code: 'origin_refused',
        error: redactSecretValuesIn(err.message, secretValues),
        details: { request: requestSummary },
      };
    }
  }

  // SSRF GUARD (Cofre R-2). This path used to send on a bare `globalThis.fetch` behind nothing but
  // a `^https?://` shape check on a baseUrl written VERBATIM from an LLM-authored package config
  // (routes/integration-builder.ts) — no private-IP block, no metadata-endpoint block, no
  // DNS-rebinding re-check, while injecting the owner's decrypted credential. It now goes through
  // the same guarded fetcher as every other platform-initiated fetch of a user-supplied URL.
  const fetchImpl = deps.fetchImpl
    ?? ((u: string, init?: Parameters<FetchLike>[1]) =>
      guardedFetch(u, {
        method: init?.method ?? httpConfig.method,
        ...(init?.headers ? { headers: init.headers } : {}),
        ...(init?.body !== undefined ? { body: init.body } : {}),
        timeoutMs: deps.timeoutMs ?? 30_000,
      }));
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
      // CREDENTIAL BOUNDARY (Codex G8): a server can echo the CLIENT's own secret in ANY string of
      // the error surface (message, body, headers, statusText/reason phrase). Deep VALUE-redact the
      // whole details object so no field — named or not — can carry a decrypted secret.
      const details = redactSecretsDeep({
        request: requestSummary,
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: redactHeaders(responseHeaders),
          body: truncateForDisplay(bodyIsJson ? safeStringify(data) : text, MAX_BODY_DISPLAY_BYTES),
          bodyIsJson,
        },
      }, secretValues) as IntegrationErrorDetails;
      return {
        success: false,
        status: response.status,
        code: classifyHttpFailure(response.status, data),
        error: redactSecretValuesIn(buildErrorMessage(response.status, response.statusText, data, text), secretValues),
        details,
      };
    }
    // Success: a 2xx body may still echo the client's own credential (which an automation may then
    // capture + persist via integration.call → capturedValues). Deep-redact the client's secret
    // values from the returned data; a token the API legitimately returns is a different value.
    const redactedData = redactSecretsDeep(data, secretValues);
    // EVIDENCE (slice S1) - the ONE point where the request summary stops being discarded on
    // success. The body goes through the SAME `redactSecretsDeep` and the SAME
    // `truncateForDisplay(…, MAX_BODY_DISPLAY_BYTES)` the failure branch above applies, so the
    // sample a person is shown can never contain more than the dump an operator already saw.
    if (evidenceKey) {
      await captureEvidence(evidenceKey, 'api-call', evidenceShape, deps, async () => ({
        kind: 'api-call' as const,
        request: requestSummary,
        response: {
          status: response.status,
          body: truncateForDisplay(
            redactSecretsDeep(bodyIsJson ? safeStringify(data) : text, secretValues) as string,
            MAX_BODY_DISPLAY_BYTES,
          ),
          bodyIsJson,
        },
      }), secretValues);
    }
    return { success: true, status: response.status, data: redactedData };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A transport error message can include the failed URL (secret in the query/authority) — redact.
    const transport = redactSecretValuesIn(msg.includes('abort') ? 'Request timed out after 30s' : msg, secretValues);
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
