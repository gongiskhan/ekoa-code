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
  /**
   * Integration-minted items only (WS-C, slice B2): the integration whose connect ceremony minted
   * this item. ADDITIVE and OPTIONAL (Rule 7) — absent on every hand-minted item, and a client that
   * ignores it renders exactly what it rendered before.
   *
   * It exists because connecting an integration AUTO-ISSUES an `until_locked` grant (typing the
   * credentials is the consent ceremony; listeners poll with no user present). An item that reads
   * "Desbloqueada até bloquear" without naming what unlocked it is a standing unlock the user cannot
   * attribute to anything they did — and the lock control is only meaningful if they can. The KEY
   * only: never the config id, never anything value-shaped.
   */
  integrationKey: z.string().optional(),
});
export type CofreItem = z.infer<typeof CofreItem>;

// ---------------------------------------------------------------------------
// Grants — where I7 is enforced
// ---------------------------------------------------------------------------

/**
 * The unlock durations the consent page offers, as a CLOSED enum so the UI and the API cannot
 * drift into offering different sets. `until_locked` is deliberately part of the same enum rather
 * than a separate boolean: it is a scope choice, not a modifier.
 *
 * `2_weeks` is the AD-HOC CAPTURED SESSION's duration (docs/decisions.md 2026-08-24, D-ADHOC-2) and
 * exists so that grant can be expressed in the model that already exists rather than beside it. It
 * is the one duration that names the same span as `DEFAULT_SESSION_TTL_MS` - the item's own expiry -
 * so an ad-hoc session's grant and the session itself die together instead of one outliving the
 * other. Added at the END of the ttl group and never inserted between existing members: this enum is
 * persisted on grant rows, so its members are values, not positions.
 */
export const GrantDuration = z.enum([
  'this_run',
  '10_minutes',
  '40_minutes',
  '1_day',
  '1_week',
  '2_weeks',
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
    duration: z.enum(['10_minutes', '40_minutes', '1_day', '1_week', '2_weeks', '1_month']),
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
/**
 * The LOGIN variant, named so it can be referenced ALONE.
 *
 * Extracted from the union (which is still built from it, below, so the two cannot drift) because
 * the `needs_credentials` ceremony has a server half and the signature ceremony does not. A
 * ceremony request must be typed as "a login prompt", not as "some relay prompt": the whole point
 * of I8 is that the two operations are not interchangeable, and a producer that can only construct
 * the login shape cannot accidentally emit a signature one.
 */
export const RelayLoginPrompt = z.object({
  operation: z.literal('login'),
  relayId: z.string(),
  automationName: z.string(),
  siteOrigin: z.string(),
  reason: z.string(),
  expiresAt: z.string(),
});
export type RelayLoginPrompt = z.infer<typeof RelayLoginPrompt>;

export const RelaySignaturePrompt = z.object({
  operation: z.literal('signature'),
  relayId: z.string(),
  automationName: z.string(),
  siteOrigin: z.string(),
  /** MUST be displayed before any code is accepted. */
  documentName: z.string().min(1),
  documentHash: z.string().min(1),
  documentPreviewUrl: z.string().optional(),
  expiresAt: z.string(),
});
export type RelaySignaturePrompt = z.infer<typeof RelaySignaturePrompt>;

export const RelayPrompt = z.discriminatedUnion('operation', [RelayLoginPrompt, RelaySignaturePrompt]);
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
// The `needs_credentials` halt (P3.1)
// ---------------------------------------------------------------------------

/**
 * HOW the missing credential gets established, and therefore what the human is asked to do.
 *
 *   - `typist` — supply the CREDENTIAL to the Cofre (a password for this origin) and the trusted
 *     typist replays it unattended on resume. The human never touches a browser.
 *   - `ceremony` — the human logs in THEMSELVES in a headed window, and the resulting session is
 *     captured. This is the ONLY answer for an origin whose login is OTP / MFA / CAPTCHA gated
 *     (`origin-posture.ts` `requiresAttendedAuth`), because there is no typed-code automation in
 *     this system and there is deliberately not going to be one.
 */
export const CredentialEstablishmentMode = z.enum(['typist', 'ceremony']);
export type CredentialEstablishmentMode = z.infer<typeof CredentialEstablishmentMode>;

/**
 * What a run parked at `needs_credentials` is asking a human to establish.
 *
 * NOTHING HERE IS A CREDENTIAL, and the field list is the enforcement of that: an ORIGIN (where the
 * credential would be used), a DEEP LINK (where the human goes to establish it), a MODE (what they
 * will be asked to do) and a REASON. There is no field a value could occupy, which is why this
 * shape is safe to persist on a run record, stream over SSE, and render.
 *
 * Published rather than internal for the same reason `RunConsentRequest` is (`automations.ts`): a
 * gateway-key caller can read `status: 'needs_credentials'` off `GET /runs/:id` and has no event
 * stream, so without this on the wire the status would be unanswerable for them.
 */
export const RunCredentialRequest = z.object({
  /** Index of the step that is blocked, matching `RunStepRecord.index`. */
  stepIndex: z.number().int(),
  /**
   * WHERE THE RE-DISPATCH RESTARTS, when that is not the blocked step itself.
   *
   * Absent means "at `stepIndex`", which is every halt raised by the credential gate and every
   * pre-existing row: the gate runs BEFORE its step executes, so the blocked step never ran and
   * restarting at it is exactly right.
   *
   * The AD-HOC ADVERSARIAL halt (docs/decisions.md 2026-08-24, D-ADHOC-5) is the case that needs the
   * two to differ. It fires MID-RUN, on a page the run had already navigated to, and the halt
   * RETURNS the run - which disposes the browser session and releases the machine's profile lease.
   * By the time a human has finished the ceremony there is no page left, so a resume that started at
   * the blocked step would drive a blank tab. This names the step that PUT the run on that page (the
   * nearest preceding navigation), while `stepIndex` keeps naming the step the human is being told
   * about. Conflating them would force one of the two to be wrong.
   */
  resumeFromStepIndex: z.number().int().nonnegative().optional(),
  /** The portal origin the step could not reach. A HOST or scheme+host, never a URL with secrets. */
  origin: BoundOrigin,
  /** Which integration the step was running. Trace + label only; never branched on (Rule 3). */
  integrationKey: z.string().min(1).max(128),
  /** Relative deep link into the Cofre portal where this credential is established. */
  portalDeepLink: z.string().min(1).max(512),
  mode: CredentialEstablishmentMode,
  /**
   * Ceremony mode: the pairing where this origin's session was last established
   * (`SessionMetadata.establishedBy.pairingId`). A PREFERENCE the portal surfaces so the human
   * repeats the ceremony on the machine the portal already knows, not a new identity primitive.
   */
  preferredPairingId: z.string().optional(),
  /** Human-readable cause, composed from the host and the route. Never echoes a failure body. */
  reason: z.string().max(500),
  /**
   * Ceremony mode only: the login relay prompt, so the portal can render "log in to <site> in your
   * headed window". Typed as the LOGIN variant alone — a ceremony request can never be a signature
   * prompt (I8), and `RelayCompleteRequest.code` is NOT wired to anything on this path.
   */
  ceremony: RelayLoginPrompt.optional(),
});
export type RunCredentialRequest = z.infer<typeof RunCredentialRequest>;

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

/**
 * Durable Registo events for bridge INVOCATIONS (J-6).
 *
 * Cortex previously persisted nothing about the bridge plane: only `kind==='read'` ledger rows left
 * the machine at all, into a 15-minute in-memory Map. So "what did my computer do for Ekoa last
 * week" had no answer, and the plane with the most physical access to the user's data was the one
 * with the least durable record.
 *
 * These sit alongside `CofreRegistoEvent` rather than inside it because they describe the TRANSPORT
 * (a task went to a machine and came back), not the custody of a credential.
 */
export const BridgeRegistoEvent = z.enum([
  'bridge_pairing_registered',
  'bridge_pairing_revoked',
  'bridge_delegation_dispatched',
  'bridge_delegation_settled',
  'bridge_secret_delivered',
  'bridge_attended_requested',
  'bridge_session_pushed',
]);
export type BridgeRegistoEvent = z.infer<typeof BridgeRegistoEvent>;

/**
 * The ONLY metadata a bridge Registo row may carry — and the omission is the point.
 *
 * There is NO path field, and there must never be one. `EgressLedgerRow` carries `path`, and the
 * standing §18.2 / FC-407 invariant is that those rows are never persisted hosted-side because a
 * path is itself sensitive (client names live in folder names, and a legal practice's directory
 * listing is privileged information). J-6 makes the FACT of an invocation durable — which machine,
 * which task, what outcome, how many bytes — while leaving WHAT WAS READ exactly as un-persisted as
 * it was before. `.strict()` is what keeps a well-meaning future caller from adding `path` back.
 */
export const BridgeRegistoMetadata = z
  .object({
    pairingId: z.string().max(120).optional(),
    taskId: z.string().max(120).optional(),
    /** Terminal status of a delegation — the DelegationResult status vocabulary. */
    outcome: z.enum(['ok', 'unreachable', 'cap_reached', 'denied']).optional(),
    /** Counts only: how much left the machine, never what. */
    egressBytes: z.number().int().nonnegative().optional(),
    citationCount: z.number().int().nonnegative().optional(),
    /** Capability/tool families touched, from a closed vocabulary — never a free-text argument. */
    tools: z.array(z.string().max(40)).max(20).optional(),
    grantRefCount: z.number().int().nonnegative().optional(),
    itemCount: z.number().int().nonnegative().optional(),
    targetOrigin: z.string().max(253).optional(),
    attendedKind: z.enum(['card_login', 'relay_code', 'login']).optional(),
    /** Why a dispatch was refused, from a closed set — never an error string that could echo input. */
    refusal: z.enum(['write_not_approved', 'no_signing_secret', 'offline', 'not_admitted']).optional(),
  })
  .strict();
export type BridgeRegistoMetadata = z.infer<typeof BridgeRegistoMetadata>;

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

/**
 * Open an attended ceremony for an origin the user reached AD-HOC (D-ADHOC-1/5).
 *
 * THE ORIGIN IS THE WHOLE REQUEST, AND IT IS A BARE HOST, enforced here rather than described here.
 * The value ends up as the address a headed browser opens on the caller's machine, so "a host" and
 * "any string" are very different contracts: a full URL carries a path and a query, a login link's
 * query routinely carries a token, and `https://` is prepended by the daemon to whatever it is
 * given. A hostname is the narrowest thing that still names a portal, so that is what is accepted
 * and everything else is a 400. The ceremony then opens at `https://<origin>` and nowhere else.
 *
 * WHY THE USER MAY NAME IT AT ALL, when the declared rail resolves the origin from a package. The
 * ad-hoc rail has no package: the run reached an undeclared portal from a free-text goal, and the
 * only statement of where the human must log in is the halt the run already wrote. Naming an origin
 * here therefore grants nothing - the ceremony captures a session INTO THE CALLER'S OWN Cofre, under
 * their own actor, on their own machine, which is a thing they could do by opening a browser. What
 * it must not become is a way to reach someone else's: every read on the way back is owner-scoped
 * (D-ADHOC-3), and this endpoint adds no lookup keyed by anything but the caller.
 *
 * NO RUN ID, and the omission is the design. The halted run is woken by the ordinary
 * credential-waiter path the moment the capture lands (`onCredentialEstablished` matches the item's
 * bound origins against parked runs of the same owner), so a run id here would be a field nothing
 * reads: it could not grant anything, could not be trusted if it did, and would invite a later
 * reader to believe the resume depends on the client naming the right run.
 */
export const CofreSessionEstablishRequest = z.object({
  origin: BoundOrigin.regex(
    /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i,
    'origin must be a bare hostname (no scheme, no port, no path, no query)',
  ),
});
export type CofreSessionEstablishRequest = z.infer<typeof CofreSessionEstablishRequest>;

/**
 * The answer is STATUS ONLY - no requestId, no handle, and above all no session.
 *
 * `started: false` with a message is a REFUSAL the user can act on (no machine connected, a daemon
 * too old to hold a ceremony), not an error: nothing went wrong, the ceremony simply cannot happen
 * right now. The client learns the OUTCOME by watching the run it was blocking, exactly as the
 * declared rail's `POST /:key/session` does.
 */
export const CofreSessionEstablishResponse = z.object({
  started: z.boolean(),
  message: z.string().max(500),
});
export type CofreSessionEstablishResponse = z.infer<typeof CofreSessionEstablishResponse>;

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
  /**
   * `auth: 'user'` and NOT `user-or-key`, deliberately. A ceremony needs a human standing at a
   * machine; a gateway key is exactly the caller who is not one, and putting this on the capability
   * surface would publish an endpoint no API client could ever complete.
   */
  cofreSessionEstablish: {
    method: 'POST',
    path: '/api/v1/cofre/sessions/establish',
    auth: 'user',
    request: CofreSessionEstablishRequest,
    response: CofreSessionEstablishResponse,
  },
} as const satisfies DomainDescriptorMap;
