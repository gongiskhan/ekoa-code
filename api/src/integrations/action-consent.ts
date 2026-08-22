/**
 * integrations/action-consent.ts — the WRITE GATE for integration actions (slice C2).
 *
 * ================================ WHAT THIS IS ==============================================
 * RUN_SPEC criterion 6: "`mutates: true` actions are an execution gate: a write requires human
 * confirmation BEFORE first run AND BEFORE an authored one persists as executable; reads
 * auto-run." This module is the durable approval store behind that sentence;
 * `executeUserIntegrationAction` (action-executor.ts) is where it is ENFORCED, so a call arriving
 * by any rail — capability route, automation `integration` step, listener tick, agent tool — hits
 * the same gate rather than each caller remembering to ask.
 *
 * ================================ WHY CONSENT, NOT WRITE-APPROVAL ===========================
 * The repo already has TWO approval mechanisms and they are not interchangeable
 * (RUN_SPEC assumption 7):
 *
 *   - `bridge/`'s write-approval store is PROCESS-LOCAL, SINGLE-USE and PAIRING-BOUND. It was
 *     built for the daemon file ceremony, where a human is watching a specific machine at a
 *     specific moment. A listener that polls at 03:00 with nobody present cannot use it, and a
 *     restart would silently drop every standing answer.
 *   - `automation/consent.ts` (`approved_commands`) is DURABLE, org+user scoped and TTL'd — the
 *     tested shape for "the owner already answered this question, and their answer still stands".
 *     That is exactly what an integration write gate needs.
 *
 * So this is consent.ts's pattern, in the integrations tier, over its own collection. It is a
 * SIBLING rather than a call into `automation/consent.ts` because the module direction runs
 * integrations/ -> (nothing in automation/): action-executor.ts reaches the automation engine only
 * through an injected seam precisely so this tier never imports that one. Extracting the shared
 * core into a lower tier (`security/`) would be the consolidation, and it is journaled as a
 * follow-up rather than done here — `automation/consent.ts` is another slice's live surface this
 * wave. What is deliberately NOT re-derived: the semantics. Same 90-day TTL, same "a row with no
 * expiry is treated as expired", same "a miss is a re-prompt, never a failure".
 *
 * ================================ THE SCOPE OF AN APPROVAL ==================================
 * An approval is keyed on (orgId, userId, integrationKey, actionName, SHAPE, DESTINATION) and is
 * transferable across none of them:
 *
 *   - **Tenant.** The org is in the key. An approval does not follow a user across a tenant
 *     boundary, and no other tenant can reach it.
 *   - **User.** The approving human is in the key. "Yes, this may send invoices as me" was never
 *     an answer about a colleague's account.
 *   - **Action.** The integration key AND the action name are both in it: approving
 *     `slack.send_message` says nothing about `slack.delete_message` or `whatsapp.send_message`.
 *   - **SHAPE.** The action's own executable content — backing, transport, HTTP method/URL/headers
 *     /body template, automation binding — is hashed into the key. This is the direct analogue of
 *     `command-shape.ts`: consent.ts never approved "the command called deploy", it approved a
 *     command SHAPE. An action that is re-authored (by the builder, by `achieve`, by a package
 *     bump) therefore does NOT inherit the approval the human gave the old one — which is the
 *     other half of criterion 6, "before an authored one persists as executable". Persistence is
 *     free; executability is not.
 *   - **DESTINATION** (2026-08-04). The RESOLVED target — the URL after the action's
 *     `{{placeholders}}` are filled from the config's non-secret values — is in the key too,
 *     because the SHAPE alone is not the destination. A templated path (`/{{ntfy_topic}}`,
 *     `/{{workspace}}/messages`) hashes identically whatever the config says, so before this the
 *     dialog could only name the template and editing one config value silently redirected an
 *     approval nobody re-granted: reproduced end to end, a message landed on a topic the approver
 *     had never seen. Now the human is shown the real destination and the approval is keyed on
 *     that same string, so the two cannot disagree.
 *     Deliberately NOT a fingerprint of the credential blob: the envelope is non-deterministic, so
 *     that would make every routine OAuth refresh (`persistRotatedCredentials`) revoke every
 *     standing approval. Rotating a secret must not re-prompt; MOVING A DESTINATION must.
 *   - **TTL.** 90 days, like consent.ts. A standing permission to write to someone's Stripe
 *     account is not something they meaningfully consented to a year ago.
 *
 * FAIL-CLOSED, PRECISELY. `mutates` arrives from a `config.json` that is parsed, not
 * schema-validated (definitions.ts), and from Mongo rows an agent authored. So ONLY a literal
 * boolean `false` reads as "this is a read". Absent, `"false"`, `0`, `null`, a missing action
 * field — every one of those is treated as MUTATING and gated. The cost of being wrong in that
 * direction is one dialog; in the other it is an unapproved write.
 */
import { createHash } from 'node:crypto';
import { approvedIntegrationActions } from '../data/stores.js';
import { resolveBackingType, type IntegrationAction } from './definitions.js';

/** How long an "aprovar sempre" stands before the owner is asked again — consent.ts's constant. */
export const ACTION_APPROVAL_TTL_DAYS = 90;
const ALWAYS_TTL_MS = ACTION_APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * How long a run-scoped "aprovar uma vez" stays claimable. Deliberately SHORT: "once" means
 * "run it now, I am watching", so a row that outlived the user's attention is a trapdoor, not a
 * convenience. It is also single-use — the claim atomically deletes it (`Store.consume`), so a
 * crash between claim and call costs a re-prompt rather than leaving a second free write.
 */
export const ONCE_APPROVAL_TTL_MINUTES = 15;
const ONCE_TTL_MS = ONCE_APPROVAL_TTL_MINUTES * 60 * 1000;

export type ActionApprovalDecision = 'once' | 'always';

/** The (org, user) pair an approval belongs to. Never read from a request body — see routes. */
export interface ActionApprovalScope {
  orgId: string;
  userId: string;
}

/**
 * What the human is being asked to approve, in the words the dialog shows them. A confirm dialog
 * that does not say what it is confirming is not consent, so every field here is destined for the
 * UI: which integration, which action, what it does, and WHERE it will write.
 */
export interface IntegrationActionConsentDescriptor {
  integrationKey: string;
  actionName: string;
  description: string;
  /** Human-readable statement of what runs: `POST https://slack.com/api/chat.postMessage`. */
  target: string;
  /** Fingerprint of the exact executable content approved (see the SHAPE note above). */
  shape: string;
}

interface ApprovedActionDoc {
  _id: string;
  orgId: string;
  userId: string;
  integrationKey: string;
  actionName: string;
  shape: string;
  decision: ActionApprovalDecision;
  /** Rendered target at approval time — for the audit trail, never re-derived from here. */
  target: string;
  createdAt: string;
  /** ISO expiry. A row without one is treated as EXPIRED, never as permanent (consent.ts J-7). */
  expiresAt?: string;
  lastUsedAt?: string;
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON: object keys sorted at every depth. `JSON.stringify` preserves INSERTION
 * order, so the same action read from disk and read back from Mongo after a save/round-trip can
 * serialise differently — which would silently invalidate a live approval and re-prompt for an
 * action nobody touched. (The same determinism bug class the listener rail's `dedupKey` fixed.)
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonical(src[key]);
    return out;
  }
  return value;
}

/** The backing, or the literal `'invalid'` — a malformed package still gets a stable shape rather
 *  than throwing out of a security check. (The executor refuses it as malformed anyway, earlier.) */
function safeBacking(action: IntegrationAction): string {
  try {
    return resolveBackingType(action);
  } catch {
    return 'invalid';
  }
}

/**
 * The fingerprint of everything about an action that decides what actually happens when it runs.
 *
 * INCLUDED, and why the payload templates are in here rather than just the destination: this is a
 * WRITE gate. "Post to #general" and "post to every channel in the workspace" differ only in a
 * `bodyTemplate`, and a human who approved the first did not approve the second. Re-prompting
 * after an edit is the conservative direction, and consent.ts's own rule — a miss is a re-prompt,
 * not a failure — makes that cheap.
 *
 * EXCLUDED: `description`, `argsSchema`, `returnSchema`. They are documentation and validation of
 * the CALLER's input; changing them cannot change what the action does to the remote account.
 *
 * SLICE S9 ADDED A TERM WITHOUT MOVING ONE EXISTING FINGERPRINT, and the conditional spread below
 * is the whole of that promise. A `tenant-read` action's `dataset` decides what happens when it
 * runs on exactly the terms `httpConfig` and `automationBinding` do, so it belongs in here; but a
 * fingerprint is DURABLE STATE - it is stored on every standing approval and on every authored
 * action's `authoring.shape`. Appending an unconditional `null` would have re-hashed every action
 * in existence: every standing approval silently unmatched (re-prompting people who had already
 * answered) and every `trusted` action demoted to `provisional`, because `authoringStateOf`
 * compares the stored shape against a freshly computed one. Appending the term ONLY when the field
 * is present leaves the tuple byte-identical for every action shipped before S9, which is what
 * `actionShape` stability is pinned on in `api/tests/integrations/action-backing-type.test.ts`.
 */
export function actionShape(integrationKey: string, action: IntegrationAction): string {
  const tuple = [
    integrationKey,
    action.actionName,
    safeBacking(action),
    action.transport ?? 'http',
    action.httpConfig ?? null,
    action.automationBinding ?? null,
    ...(action.tenantRead === undefined ? [] : [action.tenantRead]),
  ];
  return createHash('sha256').update(JSON.stringify(canonical(tuple))).digest('hex').slice(0, 32);
}

/** `{{name}}` / `{{$odata}}` — the ONE placeholder grammar, matching `http-template.ts`'s. */
const TARGET_PLACEHOLDER_RE = /\{\{(\$?\w+)\}\}/g;

/** The masking stand-in for a placeholder naming a SECRET config field. A destination that depends
 *  on a secret still has to be *distinguishable* between two different secrets, which is why the
 *  fingerprint below covers the raw resolution while the dialog only ever sees this. */
const SECRET_MASK = '••••';

/**
 * The non-secret config values an action's destination may interpolate, as the consent path sees
 * them. `secretKeys` are the schema's `secret` fields: they are never resolved, only masked.
 */
export interface TargetResolution {
  publicValues?: Record<string, string>;
  secretKeys?: readonly string[];
}

/**
 * Build the resolution from the two things every consent call site already has: the definition's
 * `configSchema` (which fields are secret) and the config row's non-secret projection.
 *
 * ONE derivation, because the capability view, the approvals list, the approve handler and the
 * executor's gate must agree exactly - a `target` that differs between the dialog and the gate by
 * so much as a character is an approval that can never be matched.
 */
export function targetResolutionOf(
  configSchema: readonly { key: string; secret?: boolean }[] | undefined,
  publicConfigValues: Record<string, string> | undefined,
): TargetResolution {
  return {
    ...(publicConfigValues ? { publicValues: publicConfigValues } : {}),
    secretKeys: (configSchema ?? []).filter((f) => f?.secret).map((f) => f.key),
  };
}

/**
 * Interpolate a destination string for a HUMAN.
 *
 * A placeholder resolves when the projection carries it, renders as `••••` when the schema calls
 * it secret, and is LEFT ALONE otherwise - an unresolvable name is shown as itself rather than
 * blanked, because a dialog that quietly drops part of a URL is worse than one that admits it
 * does not know. (`http-template.interpolate` substitutes a missing variable with the empty
 * string, which is right at call time and wrong here, for the same reason D3's render probe does
 * not reuse it.)
 */
function resolveTargetText(text: string, resolution?: TargetResolution): string {
  if (!resolution) return text;
  const secret = new Set(resolution.secretKeys ?? []);
  return text.replace(TARGET_PLACEHOLDER_RE, (whole, name: string) => {
    if (secret.has(name)) return SECRET_MASK;
    const value = resolution.publicValues?.[name];
    return value === undefined ? whole : value;
  });
}

/**
 * WHERE this action writes, for the dialog. Never a guess: an action whose backing cannot be
 * resolved says so rather than rendering a reassuring blank.
 *
 * With a `resolution` the destination is RESOLVED - `POST https://ntfy.sh/equipa-juridica` rather
 * than `POST https://ntfy.sh/{{ntfy_topic}}`. That string is what the human is shown AND what the
 * approval is keyed on (`idFor`), so the two can never disagree: a config edit that moves the
 * destination moves the key, and the standing approval stops matching.
 */
export function actionTarget(action: IntegrationAction, resolution?: TargetResolution): string {
  const backing = safeBacking(action);
  if (backing === 'api-call' && action.httpConfig) {
    const raw = `${action.httpConfig.method} ${action.httpConfig.baseUrl}${action.httpConfig.path}`;
    return resolveTargetText(raw, resolution);
  }
  const binding = action.automationBinding;
  if (binding) {
    const named = binding.automationTemplate ?? binding.automationId;
    // S8/D4: the product no longer calls this an "automação" anywhere a person can read.
    // CONSEQUENCE, RECORDED RATHER THAN SLIPPED IN: this string is the approval KEY as well as the
    // dialog's words (see `idFor` below), so changing it retires every standing approval for a
    // bound MUTATING action - the next run re-prompts instead of failing, which is the module's own
    // "a miss is a re-prompt" rule, and docs/findings.md carries the entry.
    return backing === 'bash-cli'
      ? `comando na máquina emparelhada (sequência de passos ${named})`
      : `sequência de passos ${named}`;
  }
  // SLICE S9 (review round). A `tenant-read` action RESOLVES cleanly, so it must not receive the
  // fallback this function reserves for a backing that could not be resolved at all - a required
  // public field (`IntegrationCapabilityAction.target`) was reporting a valid action as broken, the
  // same misreport the dashboard's backing chip was fixed for in the first round and this one was
  // not. The destination is the DATASET, because that is the whole of where this action goes: no
  // host, no request, no machine. It matters beyond cosmetics for a future MUTATING tenant-read
  // action, whose consent dialog would otherwise show a human no destination at all and key their
  // approval (`idFor`) on the cannot-resolve string.
  if (backing === 'tenant-read' && action.tenantRead?.dataset) {
    return `dados já sincronizados neste Ekoa (${action.tenantRead.dataset})`;
  }
  return 'destino indeterminado';
}

export function describeAction(
  integrationKey: string,
  action: IntegrationAction,
  resolution?: TargetResolution,
): IntegrationActionConsentDescriptor {
  return {
    integrationKey,
    actionName: action.actionName,
    description: action.description ?? '',
    target: actionTarget(action, resolution),
    shape: actionShape(integrationKey, action),
  };
}

/**
 * Does this action need a human before it runs?
 *
 * ONLY a literal boolean `false` is a read. Everything else — absent, a string, a number, null —
 * is a write. `mutates` comes off an unvalidated `config.json` or an agent-authored Mongo row, and
 * "we could not determine whether this writes" must never share a code path with "this is a read".
 */
export function actionRequiresConsent(action: Pick<IntegrationAction, 'mutates'>): boolean {
  return (action as { mutates?: unknown }).mutates !== false;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * Approval id. A sha256 over the JSON tuple, NOT a `::` join: org ids, user ids, integration keys
 * and action names are all caller-influenced strings, and a separator join is not injective when
 * any component may contain the separator (the C1 provisioner-id lesson). The decision is part of
 * the id so a single-use "once" row and a standing "always" row coexist without one consuming the
 * other.
 */
function idFor(
  scope: ActionApprovalScope,
  integrationKey: string,
  actionName: string,
  shape: string,
  decision: ActionApprovalDecision,
  target: string,
): string {
  const tuple = JSON.stringify([scope.orgId, scope.userId, integrationKey, actionName, shape, decision, target]);
  return `ia_${createHash('sha256').update(tuple).digest('hex')}`;
}

function isLive(row: ApprovedActionDoc | null, at: number): row is ApprovedActionDoc {
  if (!row) return false;
  if (!row.expiresAt) return false; // no expiry = not a row this version wrote = expired
  return Date.parse(row.expiresAt) > at;
}

/** Why a call was allowed through the gate — carried into the executor's audit line. */
export type ActionConsentVerdict =
  | { allowed: true; reason: 'not_mutating' | 'approved_always' | 'approved_once' }
  | { allowed: false; request: IntegrationActionConsentDescriptor };

/**
 * THE GATE. Called by `executeUserIntegrationAction` before any credential is loaded.
 *
 * Order matters and is deliberate: a standing "always" is checked FIRST, so a user who has both a
 * standing approval and a stale single-use row does not burn the single-use one. Only then is the
 * "once" row CLAIMED — atomically, via `consume`, so two concurrent runs cannot both spend it.
 */
export async function checkActionConsent(
  scope: ActionApprovalScope,
  integrationKey: string,
  action: IntegrationAction,
  now: () => number = Date.now,
  /**
   * The non-secret config values this call will interpolate. Read off the config row the executor
   * ALREADY holds un-decrypted (`publicConfigValues`), so supplying it costs no decryption and the
   * gate keeps answering before any credential is loaded.
   *
   * Its effect is the point of this parameter: the approval is keyed on the RESOLVED destination,
   * so an approval granted for one topic/channel/path does not cover another. Omit it and the key
   * falls back to the template - the pre-2026-08-04 behaviour, which is what a row written before
   * the projection existed still gets.
   */
  resolution?: TargetResolution,
): Promise<ActionConsentVerdict> {
  if (!actionRequiresConsent(action)) return { allowed: true, reason: 'not_mutating' };
  const descriptor = describeAction(integrationKey, action, resolution);
  const at = now();

  const always = (await approvedIntegrationActions.get(
    idFor(scope, integrationKey, action.actionName, descriptor.shape, 'always', descriptor.target),
  )) as ApprovedActionDoc | null;
  if (isLive(always, at)) {
    void recordApprovalUse(always._id, at);
    return { allowed: true, reason: 'approved_always' };
  }

  // Single-use: the claim IS the delete. An expired row is still consumed — leaving it would let a
  // clock change or a later grant of the same id resurrect an answer the user gave weeks ago.
  const claimed = (await approvedIntegrationActions.consume(
    idFor(scope, integrationKey, action.actionName, descriptor.shape, 'once', descriptor.target),
  )) as ApprovedActionDoc | null;
  if (isLive(claimed, at)) return { allowed: true, reason: 'approved_once' };

  return { allowed: false, request: descriptor };
}

/** Persist a human's answer. Idempotent: re-approving refreshes the window rather than stacking. */
export async function approveAction(
  scope: ActionApprovalScope,
  descriptor: IntegrationActionConsentDescriptor,
  decision: ActionApprovalDecision,
  now: () => number = Date.now,
): Promise<{ expiresAt: string }> {
  const at = now();
  const expiresAt = new Date(at + (decision === 'always' ? ALWAYS_TTL_MS : ONCE_TTL_MS)).toISOString();
  const doc: ApprovedActionDoc = {
    _id: idFor(scope, descriptor.integrationKey, descriptor.actionName, descriptor.shape, decision, descriptor.target),
    orgId: scope.orgId,
    userId: scope.userId,
    integrationKey: descriptor.integrationKey,
    actionName: descriptor.actionName,
    shape: descriptor.shape,
    decision,
    target: descriptor.target,
    createdAt: new Date(at).toISOString(),
    expiresAt,
  };
  await approvedIntegrationActions.put(doc as never);
  return { expiresAt };
}

/**
 * Revoke EVERY approval this user holds for this action in this org — both decisions, and every
 * SHAPE, not just the current one.
 *
 * Deliberately broader than the grant key, exactly as `revokeCommandShape` is broader than the
 * pairing it was granted for: revocation is a safety action, and leaving an approval standing for
 * a shape the action used to have is the opposite of what someone clicking "revogar" means.
 */
export async function revokeActionApprovals(
  scope: ActionApprovalScope,
  integrationKey: string,
  actionName: string,
): Promise<number> {
  return approvedIntegrationActions.deleteMany({
    orgId: scope.orgId,
    userId: scope.userId,
    integrationKey,
    actionName,
  });
}

/** The live decision covering this exact shape, or null. Drives the dashboard's per-action state. */
export async function liveApprovalFor(
  scope: ActionApprovalScope,
  integrationKey: string,
  actionName: string,
  shape: string,
  /** The RESOLVED destination this approval must cover - see `idFor`. */
  target: string,
  now: () => number = Date.now,
): Promise<{ decision: ActionApprovalDecision; expiresAt: string } | null> {
  const at = now();
  for (const decision of ['always', 'once'] as const) {
    const row = (await approvedIntegrationActions.get(idFor(scope, integrationKey, actionName, shape, decision, target))) as ApprovedActionDoc | null;
    if (isLive(row, at)) return { decision, expiresAt: row.expiresAt! };
  }
  return null;
}

/** Bump lastUsedAt (fire-and-forget; a bookkeeping write never fails a run — consent.ts's rule). */
async function recordApprovalUse(id: string, at: number): Promise<void> {
  await approvedIntegrationActions
    .update(id, (cur) => ({ ...cur, lastUsedAt: new Date(at).toISOString() }))
    .catch(() => null);
}
