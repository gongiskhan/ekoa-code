/**
 * The Cofre contract (Cofre WS-A). The shared vocabulary every host UI and the Apify actor build
 * against: item types and states, the credential-REFERENCE format, grants and their scopes, the
 * relay's operation typing, and the Registo event names.
 *
 * TWO INVARIANTS ARE ENCODED HERE RATHER THAN IN PROSE, because a rule that lives only in a
 * docstring is a rule a future change can silently drop:
 *
 *   I7 — signature authority never enters the grant/TTL model. `Grant` is a discriminated union in
 *        which a `certificate_identity` item CANNOT carry a TTL or an until-locked scope: the
 *        schema rejects it. "Cada utilização é uma cerimónia" becomes a validation error.
 *   I8 — relay prompts are operation-typed AT THE PROTOCOL LEVEL. `RelayPrompt` is a discriminated
 *        union on `operation`, and the signature variant makes document identity structurally
 *        REQUIRED, so a login-typed prompt cannot type-check into a signature completion.
 *
 * The model operates on REFERENCES; values live only below the model boundary. Nothing in this file
 * has a field that can carry a secret value, and `CredentialRef` is a branded opaque string whose
 * regex rejects anything value-shaped.
 */
import { z } from 'zod';
import type { DomainDescriptorMap } from './descriptor.js';

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** The item types the Cofre stores. `certificate_identity` is a POINTER — a smartcard's private
 *  key is sealed in the chip and cannot be exported, so the Cofre stores "which machine, which
 *  reader", never key material. */
export const CofreItemType = z.enum([
  'password',
  'api_key',
  'oauth_token',
  'totp_seed',
  'session',
  'software_certificate',
  'certificate_identity',
]);
export type CofreItemType = z.infer<typeof CofreItemType>;

/**
 * Per-item state as the UI renders it.
 *   - `locked`               → Bloqueada
 *   - `unlocked`             → Desbloqueada (a live countdown; carries `unlockedUntil`)
 *   - `unlocked_until_locked`→ Desbloqueada até bloquear (a DISTINCT state, deliberately: an
 *                              indefinite unlock must never look like a timed one)
 *   - `in_use`               → Em utilização (an automation is holding it right now)
 */
export const CofreItemState = z.enum(['locked', 'unlocked', 'unlocked_until_locked', 'in_use']);
export type CofreItemState = z.infer<typeof CofreItemState>;

/**
 * An opaque handle to a credential — `cofre:<itemId>`. This is the ONLY form in which a credential
 * appears in anything a model can read or write.
 *
 * The regex is deliberately narrow (an opaque id charset, bounded length) so that a value-shaped
 * string cannot masquerade as a reference: a model that emits `cofre:sk-live-…` fails validation
 * rather than smuggling a secret through a field named "ref".
 */
export const CREDENTIAL_REF_PATTERN = /^cofre:[A-Za-z0-9_-]{1,64}$/;
export const CredentialRef = z
  .string()
  .regex(CREDENTIAL_REF_PATTERN, 'must be an opaque cofre:<itemId> reference, never a value');
export type CredentialRef = z.infer<typeof CredentialRef>;

/** A host the item's credential may be sent to. Matched exact-or-parent-domain by the enforcement
 *  point; see api/src/security/origin-binding.ts (I6). */
export const BoundOrigin = z.string().min(1).max(253);
export type BoundOrigin = z.infer<typeof BoundOrigin>;

/**
 * The item as the API returns it. There is NO value field and there never may be one — the item
 * view is what the dashboard and every host UI render, and a value here would defeat I1/I2 at the
 * contract layer rather than at a call site.
 */
export const CofreItem = z.object({
  id: z.string(),
  ref: CredentialRef,
  type: CofreItemType,
  label: z.string(),
  state: CofreItemState,
  boundOrigins: z.array(BoundOrigin),
  /** Present only while `state === 'unlocked'`; absent for `unlocked_until_locked` by design. */
  unlockedUntil: z.string().optional(),
  /** Set while an automation holds the item — drives the live "Em utilização" indicator. */
  heldByRunId: z.string().optional(),
  lastUsedAt: z.string().optional(),
  /** Which automation or integration last used it (a name, never a payload). */
  lastUsedBy: z.string().optional(),
  createdAt: z.string(),
  /** Session items only: health/expiry of the captured storageState. */
  expiresAt: z.string().optional(),
  /** certificate_identity only: the human-readable pointer ("cartão OA no computador do escritório"). */
  identityPointer: z.string().optional(),
});
export type CofreItem = z.infer<typeof CofreItem>;

// ---------------------------------------------------------------------------
// Grants — where I7 is enforced
// ---------------------------------------------------------------------------

/**
 * The unlock durations the consent page offers, as a CLOSED enum so the UI and the API cannot
 * drift into offering different sets. `until_locked` is deliberately part of the same enum rather
 * than a separate boolean: it is a scope choice, not a modifier.
 */
export const GrantDuration = z.enum([
  'this_run',
  '10_minutes',
  '40_minutes',
  '1_day',
  '1_week',
  '1_month',
  'until_locked',
]);
export type GrantDuration = z.infer<typeof GrantDuration>;

export const GrantScope = z.enum(['this_run', 'ttl', 'until_locked']);
export type GrantScope = z.infer<typeof GrantScope>;

const GrantBase = {
  credentialId: z.string(),
  issuedByUserId: z.string(),
  issuedAt: z.string(),
};

/**
 * A grant. I7 IS THE UNION: an item of type `certificate_identity` may only ever hold a
 * `this_run` grant, so a TTL or until-locked grant on a signature identity is a VALIDATION ERROR,
 * not a policy note. The Cofre renders no duration control for those items, and this schema is what
 * stops the UI regressing that on its own.
 */
export const Grant = z.discriminatedUnion('scope', [
  z.object({
    ...GrantBase,
    scope: z.literal('this_run'),
    /** The run this grant dies with. A `this_run` grant is consumed by run id, never by time. */
    runId: z.string(),
  }),
  z.object({
    ...GrantBase,
    scope: z.literal('ttl'),
    duration: z.enum(['10_minutes', '40_minutes', '1_day', '1_week', '1_month']),
    expiresAt: z.string(),
    /** Refused for `certificate_identity` — see `assertGrantAllowedForItemType`. */
    itemType: CofreItemType.refine((t) => t !== 'certificate_identity', {
      message: 'a signature identity cannot hold a TTL grant (I7): every signature is a fresh ceremony',
    }),
  }),
  z.object({
    ...GrantBase,
    scope: z.literal('until_locked'),
    itemType: CofreItemType.refine((t) => t !== 'certificate_identity', {
      message: 'a signature identity cannot hold an until-locked grant (I7)',
    }),
  }),
]);
export type Grant = z.infer<typeof Grant>;

/**
 * The runtime half of I7, for the call sites that hold an item type and a requested duration
 * before a `Grant` object exists. Throws rather than returning a boolean: a signature identity
 * given a TTL is a programming error, not a user-input branch.
 */
export function assertGrantAllowedForItemType(itemType: CofreItemType, duration: GrantDuration): void {
  if (itemType === 'certificate_identity' && duration !== 'this_run') {
    throw new Error(
      `I7: a certificate_identity may only be granted for a single run (asked for "${duration}") — ` +
        'signature authority never enters the grant/TTL model.',
    );
  }
}

export const GrantRequest = z.object({
  duration: GrantDuration,
  /** Echoed back in the Registo row so the audit says what the user was consenting to. */
  reason: z.string().max(500).optional(),
});
export type GrantRequest = z.infer<typeof GrantRequest>;

// ---------------------------------------------------------------------------
// Relay — where I8 is enforced
// ---------------------------------------------------------------------------

/**
 * The relay prompt. ONE surface, TWO protocol-level types.
 *
 * The signature variant requires `documentName` AND (`documentHash` or `documentPreviewUrl`), so a
 * signature ceremony that does not show the user what they are signing cannot be CONSTRUCTED. That
 * is the technical enforcement of "we never sign for the lawyer", and it is also the anti-phishing
 * control: the relay teaches users that a code prompt with no visible document is never legitimate.
 */
export const RelayPrompt = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('login'),
    relayId: z.string(),
    automationName: z.string(),
    siteOrigin: z.string(),
    reason: z.string(),
    expiresAt: z.string(),
  }),
  z.object({
    operation: z.literal('signature'),
    relayId: z.string(),
    automationName: z.string(),
    siteOrigin: z.string(),
    /** MUST be displayed before any code is accepted. */
    documentName: z.string().min(1),
    documentHash: z.string().min(1),
    documentPreviewUrl: z.string().optional(),
    expiresAt: z.string(),
  }),
]);
export type RelayPrompt = z.infer<typeof RelayPrompt>;

/**
 * Completing a relay. The `operation` is echoed and the server refuses a MISMATCH against the
 * prompt's own type — a login-typed relay cannot complete a signature operation (I8). The code is
 * used once and never stored.
 */
export const RelayCompleteRequest = z.object({
  relayId: z.string(),
  operation: z.enum(['login', 'signature']),
  code: z.string().min(1).max(32),
});
export type RelayCompleteRequest = z.infer<typeof RelayCompleteRequest>;

// ---------------------------------------------------------------------------
// Registo vocabulary
// ---------------------------------------------------------------------------

/**
 * The minimum Registo event set. Bridge-side uses emit events IDENTICAL in shape to cloud events,
 * so the audit spans both planes and a user reading their Registo cannot tell which plane served a
 * request except by the machine named in the metadata.
 */
export const CofreRegistoEvent = z.enum([
  'cofre_grant_issued',
  'cofre_item_unlocked',
  'cofre_item_used',
  'cofre_session_established',
  'cofre_session_refreshed',
  'cofre_session_expired',
  'cofre_relay_completed',
  'cofre_lock_now',
  'cofre_lock_all',
  'cofre_bridge_secret_delivered',
  'cofre_attended_ceremony_completed',
]);
export type CofreRegistoEvent = z.infer<typeof CofreRegistoEvent>;

/**
 * The ONLY metadata a Cofre Registo row may carry. Ids, counts, origins and timestamps — never a
 * value, and never free text that could carry one. `RegistoEntry.metadata` is `.passthrough()`, so
 * without this an event could validly carry a credential; the Cofre category is validated against
 * this shape at the write site.
 */
export const CofreRegistoMetadata = z
  .object({
    itemId: z.string().optional(),
    itemType: CofreItemType.optional(),
    runId: z.string().optional(),
    automationName: z.string().max(120).optional(),
    targetOrigin: z.string().max(253).optional(),
    machineId: z.string().max(120).optional(),
    scope: GrantScope.optional(),
    duration: GrantDuration.optional(),
    relayOperation: z.enum(['login', 'signature']).optional(),
    itemCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CofreRegistoMetadata = z.infer<typeof CofreRegistoMetadata>;

// ---------------------------------------------------------------------------
// Capabilities + step declarations (A-4 / A-5 vocabulary)
// ---------------------------------------------------------------------------

/** What a registered bridge advertises it can do. Closed, so a capability cannot be invented by a
 *  model or a config file. */
export const BridgeCapability = z.enum([
  'local.filesystem',
  'local.bash',
  'attended.card_login',
  'egress.residential',
  'desktop.automation',
]);
export type BridgeCapability = z.infer<typeof BridgeCapability>;

/** Where a step must run. `pinned:<pairingId>` binds to one machine; `any:<capability>` lets the
 *  router choose; `cloud` is the managed path. */
export const StepTarget = z.union([
  z.object({ kind: z.literal('cloud') }),
  z.object({ kind: z.literal('pinned'), pairingId: z.string() }),
  z.object({ kind: z.literal('any'), capability: BridgeCapability }),
]);
export type StepTarget = z.infer<typeof StepTarget>;

/**
 * What a run does when its declared machine is offline. DEFAULTS TO `fail`: a run that silently
 * proceeds from a datacenter IP when it was written to leave from a residential one is a
 * correctness AND a detection problem, so the safe option is the one you get by not choosing.
 */
export const OfflinePolicy = z.enum(['fail', 'queue', 'datacenter']);
export type OfflinePolicy = z.infer<typeof OfflinePolicy>;

/** The declaration a step carries so the router can place it. Credential REFERENCES only. */
export const StepDeclaration = z.object({
  requiredCapabilities: z.array(BridgeCapability).default([]),
  target: StepTarget.default({ kind: 'cloud' }),
  attended: z.boolean().default(false),
  credentialRefs: z.array(CredentialRef).default([]),
  offlinePolicy: OfflinePolicy.default('fail'),
});
export type StepDeclaration = z.infer<typeof StepDeclaration>;

/** Session metadata (resolves former exploration task E5): a session item records WHERE it was
 *  established so the router can reproduce that identity at checkout. */
export const SessionMetadata = z.object({
  establishedBy: z.union([
    z.object({ kind: z.literal('cloud') }),
    z.object({ kind: z.literal('machine'), pairingId: z.string() }),
  ]),
  boundEgress: z.union([
    z.object({ kind: z.literal('datacenter') }),
    z.object({ kind: z.literal('residential'), pairingId: z.string() }),
  ]),
  userAgentProfile: z.string().max(512).optional(),
  establishedAt: z.string(),
  expiresAt: z.string().optional(),
  healthy: z.boolean(),
});
export type SessionMetadata = z.infer<typeof SessionMetadata>;

// ---------------------------------------------------------------------------
// Wire shapes + descriptors (WS-B B-3)
// ---------------------------------------------------------------------------

/** Mint an item. The VALUE is write-only: it is accepted here and never returned by any endpoint. */
export const CofreItemCreateRequest = z.object({
  type: CofreItemType,
  label: z.string().min(1).max(120),
  value: z.string().min(1),
  boundOrigins: z.array(BoundOrigin).default([]),
  identityPointer: z.string().max(200).optional(),
  expiresAt: z.string().optional(),
});
export type CofreItemCreateRequest = z.infer<typeof CofreItemCreateRequest>;

export const CofreItemListResponse = z.object({ items: z.array(CofreItem) });
export type CofreItemListResponse = z.infer<typeof CofreItemListResponse>;

/** The mint response is the ITEM VIEW — there is no show-once secret, because unlike a gateway key
 *  the user already HAS this credential; the Cofre is storing it, not generating it. */
export const CofreItemCreateResponse = CofreItem;
export type CofreItemCreateResponse = z.infer<typeof CofreItemCreateResponse>;

export const CofreGrantResponse = z.object({
  ok: z.literal(true),
  scope: GrantScope,
  expiresAt: z.string().optional(),
});
export type CofreGrantResponse = z.infer<typeof CofreGrantResponse>;

export const CofreLockResponse = z.object({ ok: z.literal(true), revoked: z.number().int().nonnegative() });
export type CofreLockResponse = z.infer<typeof CofreLockResponse>;

export const CofreDeleteResponse = z.object({ ok: z.literal(true) });
export type CofreDeleteResponse = z.infer<typeof CofreDeleteResponse>;

export const cofreEndpoints = {
  cofreItemsList: {
    method: 'GET',
    path: '/api/v1/cofre/items',
    auth: 'user',
    response: CofreItemListResponse,
  },
  cofreItemsCreate: {
    method: 'POST',
    path: '/api/v1/cofre/items',
    auth: 'user',
    request: CofreItemCreateRequest,
    response: CofreItemCreateResponse,
  },
  cofreItemsDelete: {
    method: 'DELETE',
    path: '/api/v1/cofre/items/:id',
    auth: 'user',
    response: CofreDeleteResponse,
  },
  cofreItemGrant: {
    method: 'POST',
    path: '/api/v1/cofre/items/:id/grants',
    auth: 'user',
    request: GrantRequest,
    response: CofreGrantResponse,
  },
  cofreItemLock: {
    method: 'POST',
    path: '/api/v1/cofre/items/:id/lock',
    auth: 'user',
    response: CofreLockResponse,
  },
  cofreLockAll: {
    method: 'POST',
    path: '/api/v1/cofre/lock-all',
    auth: 'user',
    response: CofreLockResponse,
  },
} as const satisfies DomainDescriptorMap;
