// ekoa-local surfaces (ch03 §3.10): LLM gateway, agent-face, bridge - ported wire-stable, plus the P-18 TUI compat SSE.
import { z } from 'zod';
import { BridgeCapability } from './cofre.js';
import { Id, OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const LlmMessagesRequest = z.unknown();
export type LlmMessagesRequest = z.infer<typeof LlmMessagesRequest>;

export const LlmMessagesResponse = z.unknown();
export type LlmMessagesResponse = z.infer<typeof LlmMessagesResponse>;

export const LlmModel = z.object({ id: z.string() }).passthrough();
export type LlmModel = z.infer<typeof LlmModel>;

export const LlmModelsResponse = z.object({ data: z.array(LlmModel) }).passthrough();
export type LlmModelsResponse = z.infer<typeof LlmModelsResponse>;

export const LlmCountTokensResponse = z.object({ input_tokens: z.number() }).passthrough();
export type LlmCountTokensResponse = z.infer<typeof LlmCountTokensResponse>;

export const LlmClassifyRequest = z.object({
  input: z.string(),
  categories: z.array(z.string()).optional(),
}).passthrough();
export type LlmClassifyRequest = z.infer<typeof LlmClassifyRequest>;

export const LlmClassifyResponse = z.object({
  category: z.string(),
  fallback: z.boolean().optional(),
}).passthrough();
export type LlmClassifyResponse = z.infer<typeof LlmClassifyResponse>;

export const AgentFaceRunRequest = z.unknown();
export type AgentFaceRunRequest = z.infer<typeof AgentFaceRunRequest>;

export const AgentFaceRunResponse = z.object({ traceId: z.string() });
export type AgentFaceRunResponse = z.infer<typeof AgentFaceRunResponse>;

export const AgentFaceCancelRequest = z.object({ traceId: Id.optional() }).passthrough();
export type AgentFaceCancelRequest = z.infer<typeof AgentFaceCancelRequest>;

export const AgentFaceCancelResponse = OkResponse;
export type AgentFaceCancelResponse = z.infer<typeof AgentFaceCancelResponse>;

export const BridgeTokenResponse = z.object({
  token: z.string(),
  expiresIn: z.number(),
  /**
   * The pairing's PER-PAIRING task-signing secret (Cofre R-8). Present only for the OWNER of a
   * live, non-revoked pairing. Delegated tasks were previously HMAC'd with the platform-wide JWT
   * secret, so making delegation work required copying the key that signs every user's session
   * onto every paired laptop; this is minted per pairing and delivered on the daemon's own
   * authenticated pre-dial exchange. Optional so a revoked/unknown pairing simply omits it and the
   * daemon fails closed rather than falling back to anything.
   */
  signingSecret: z.string().optional(),
  /**
   * The org the pairing is scoped to - delivered on the SAME owner-gated exchange as
   * `signingSecret`, because the daemon needs both to accept a real task. Its verifier checks the
   * signature first and cross-org addressing second (`verify-task.ts`), so a daemon that learned
   * the secret but not the org denies every delegated task on the second check while the first one
   * masks the cause. Optional for the same reason `signingSecret` is: an unknown or revoked pairing
   * simply omits the pair and the daemon fails closed.
   */
  org: z.string().optional(),
});
export type BridgeTokenResponse = z.infer<typeof BridgeTokenResponse>;

/** Hosted bridge presence, derived from the pairing registry ONLY — no daemon round trip
 *  (ch18 §18.3.3; §12.6 FC-401/FC-405). `pairingId` present when paired; `lastSeenAt` is the
 *  last heartbeat stamp and only known while a live socket exists in this process. */
export const BridgeStatusResponse = z.object({
  paired: z.boolean(),
  live: z.boolean(),
  pairingId: z.string().optional(),
  lastSeenAt: z.string().optional(),
});
export type BridgeStatusResponse = z.infer<typeof BridgeStatusResponse>;

// ---------------------------------------------------------------------------
// The CAPABILITY-GRANT admin surface (I-3). A machine ADVERTISES what it can do;
// the ORG GRANTS what its work may be routed through it for. Both facts travel
// here, side by side and clearly distinguished, because the whole point of I-3 is
// that they are different questions and only the tenant answers the second one.
// ---------------------------------------------------------------------------

/**
 * One paired machine as its org's administrator sees it.
 *
 * THE TWO CAPABILITY LISTS ARE `z.array(z.string())`, NOT `z.array(BridgeCapability)`, and that is
 * deliberate on a READ. Both lists are STORED data: `advertisedCapabilities` is whatever the daemon
 * last put in its `hello` frame and `grantedCapabilities` is whatever was granted at the time. A
 * machine running a newer build advertises a capability this vocabulary does not have yet, and a
 * grant may outlive a capability removed from it. Narrowing the read to the closed enum would make
 * the WHOLE fleet listing fail validation because one machine is ahead of the server - the admin
 * surface would go blank exactly when someone needs to look at it. The WRITE stays closed
 * (`BridgeGrantCapabilityRequest.capability` is the enum), which is the direction that matters: a
 * capability nobody can name cannot be granted.
 *
 * THE TWO ADDRESSES ARE ALSO SEPARATE, for the same reason the two capability lists are.
 * `egressEndpoint` is what the machine ADVERTISES; `grantedEgressEndpoint` is what the org
 * AUTHORISED. `egressCandidatesForOrg` routes traffic only when the two match in canonical form,
 * so a surface carrying one of them cannot show an administrator why a machine they believe they
 * granted is carrying nothing - and a surface carrying only the NAME of the capability is how a
 * machine-supplied address gets authorised by someone who never saw it (`bridge/registry.ts`).
 */
export const BridgeMachineSummary = z.object({
  pairingId: z.string(),
  /** A live daemon socket in the serving process right now. Presence, never a grant. */
  live: z.boolean(),
  advertisedCapabilities: z.array(z.string()),
  grantedCapabilities: z.array(z.string()),
  /** The address the MACHINE advertises for residential egress. A self-assertion. */
  egressEndpoint: z.string().optional(),
  /** The address the ORG authorised, in the canonical form it was stored in. Absent when
   *  `egress.residential` is not granted. Traffic flows only where this equals the advertised one. */
  grantedEgressEndpoint: z.string().optional(),
});
export type BridgeMachineSummary = z.infer<typeof BridgeMachineSummary>;

export const BridgeMachinesResponse = z.object({ items: z.array(BridgeMachineSummary) });
export type BridgeMachinesResponse = z.infer<typeof BridgeMachinesResponse>;

/** Path params for the two grant writes. The capability segment is a free string on the wire for
 *  the same reason the read lists are: a grant for a capability since dropped from the vocabulary
 *  must stay REVOCABLE. The route applies its own charset guard. */
export const BridgePairingParams = z.object({ pairingId: z.string().min(1).max(128) });
export type BridgePairingParams = z.infer<typeof BridgePairingParams>;

export const BridgeCapabilityParams = z.object({
  pairingId: z.string().min(1).max(128),
  capability: z.string().min(1).max(64),
});
export type BridgeCapabilityParams = z.infer<typeof BridgeCapabilityParams>;

/**
 * Grant one capability on one machine.
 *
 * `egressEndpoint` is REQUIRED by the service for `egress.residential` and meaningless for every
 * other capability, so it is optional HERE and enforced THERE (`bridge/capability-grants.ts`
 * throws `CapabilityGrantError`, which the route answers as a 400). Encoding the conditional in
 * the schema would put the same rule in two places, and the service's copy is the one that also
 * guards every non-HTTP caller.
 *
 * The org and the granting user are NEVER body fields: both come from the authenticated caller.
 */
export const BridgeGrantCapabilityRequest = z.object({
  capability: BridgeCapability,
  egressEndpoint: z.string().max(255).optional(),
});
export type BridgeGrantCapabilityRequest = z.infer<typeof BridgeGrantCapabilityRequest>;

/** The machine as it now stands, so a client renders the truth it just created rather than the
 *  truth it assumed. `advertised` is echoed back too: granting a capability the machine does not
 *  advertise is permitted (grant now, upgrade the daemon later) and produces nothing USABLE, and
 *  this shape is what lets a surface show that honestly instead of implying it took effect. */
export const BridgeGrantCapabilityResponse = z.object({
  ok: z.literal(true),
  machine: BridgeMachineSummary,
});
export type BridgeGrantCapabilityResponse = z.infer<typeof BridgeGrantCapabilityResponse>;

/** `revoked` is false when there was no live grant to turn off - the idempotent case. Not a 404:
 *  the state the caller asked for holds either way, and a 404 here would answer a different
 *  question (does this grant exist) than the one asked (make sure it does not). */
export const BridgeRevokeCapabilityResponse = z.object({
  ok: z.literal(true),
  revoked: z.boolean(),
  machine: BridgeMachineSummary,
});
export type BridgeRevokeCapabilityResponse = z.infer<typeof BridgeRevokeCapabilityResponse>;

export const BridgeDebugInvokeRequest = z.unknown();
export type BridgeDebugInvokeRequest = z.infer<typeof BridgeDebugInvokeRequest>;

export const BridgeDebugInvokeResponse = z.unknown();
export type BridgeDebugInvokeResponse = z.infer<typeof BridgeDebugInvokeResponse>;

export const ekoaLocalEndpoints = {
  llmMessages: {
    method: 'POST',
    path: '/api/v1/llm/messages',
    auth: 'user',
    request: LlmMessagesRequest,
    response: LlmMessagesResponse,
  },
  llmMessagesV1: {
    method: 'POST',
    path: '/api/v1/llm/v1/messages',
    auth: 'user',
    request: LlmMessagesRequest,
    response: LlmMessagesResponse,
  },
  llmCountTokens: {
    method: 'POST',
    path: '/api/v1/llm/v1/messages/count_tokens',
    auth: 'user',
    request: LlmMessagesRequest,
    response: LlmCountTokensResponse,
  },
  llmCountTokensAlias: {
    method: 'POST',
    path: '/api/v1/llm/messages/count_tokens',
    auth: 'user',
    request: LlmMessagesRequest,
    response: LlmCountTokensResponse,
  },
  llmModels: {
    method: 'GET',
    path: '/api/v1/llm/models',
    auth: 'user',
    response: LlmModelsResponse,
  },
  llmClassify: {
    method: 'POST',
    path: '/api/v1/llm/classify',
    auth: 'user',
    request: LlmClassifyRequest,
    response: LlmClassifyResponse,
  },
  agentFaceRun: {
    method: 'POST',
    path: '/api/v1/agent-face/run',
    auth: 'user',
    request: AgentFaceRunRequest,
    response: AgentFaceRunResponse,
  },
  agentFaceCancel: {
    method: 'POST',
    path: '/api/v1/agent-face/cancel',
    auth: 'user',
    request: AgentFaceCancelRequest,
    response: AgentFaceCancelResponse,
  },
  bridgeToken: {
    method: 'POST',
    path: '/api/v1/bridge/token',
    auth: 'user',
    response: BridgeTokenResponse,
  },
  bridgeStatus: {
    method: 'GET',
    path: '/api/v1/bridge/status',
    auth: 'user',
    response: BridgeStatusResponse,
  },
  // I-3 capability grants. `auth: 'org-admin'` is the CONTRACT-LEVEL TIER MARKING, not a note about
  // which middleware happens to be mounted: `docs/api-contract.md` CONV-1 lists
  // `super-admin` / `org-admin` as "marked per endpoint", and a consumer reads an endpoint's tier
  // off its descriptor. `org-admin` names the NARROWEST role admitted - exactly as
  // `registo.listRegisto` declares `org-admin` for a router that mounts
  // `requireRole('org-admin', 'super-admin')`. A super-admin is admitted alongside, not instead.
  //
  // Declaring `user` here would be a contract-accuracy defect on a PRIVILEGE-WIDENING surface: it
  // would tell every reader and every generated client that an ordinary member may grant
  // `local.bash` on a machine, which is the opposite of what these endpoints do.
  bridgeListMachines: {
    method: 'GET',
    path: '/api/v1/bridge/machines',
    auth: 'org-admin',
    response: BridgeMachinesResponse,
  },
  bridgeGrantCapability: {
    method: 'POST',
    path: '/api/v1/bridge/pairings/:pairingId/capabilities',
    auth: 'org-admin',
    params: BridgePairingParams,
    request: BridgeGrantCapabilityRequest,
    response: BridgeGrantCapabilityResponse,
  },
  bridgeRevokeCapability: {
    method: 'DELETE',
    path: '/api/v1/bridge/pairings/:pairingId/capabilities/:capability',
    auth: 'org-admin',
    params: BridgeCapabilityParams,
    response: BridgeRevokeCapabilityResponse,
  },
  bridgeConnect: {
    method: 'GET',
    path: '/api/v1/bridge/connect/:connectionId',
    auth: 'bridge',
    kind: 'ws',
  },
  bridgeDebugInvoke: {
    method: 'POST',
    path: '/api/v1/bridge/debug-invoke',
    auth: 'user',
    request: BridgeDebugInvokeRequest,
    response: BridgeDebugInvokeResponse,
  },
  tuiEvents: {
    method: 'GET',
    path: '/api/v1/events',
    auth: 'token-query',
    response: z.unknown(),
    kind: 'sse',
  },
} as const satisfies DomainDescriptorMap;

// ---------------------------------------------------------------------------
// Bridge delegation wire contract (ch18 §18.2.6, §18.3.8, §18.5.1). The shared
// schemas both the Cortex bridge server AND the fake-daemon harness build against
// (§18.1: the harness is authoritative on the wire; this is the readable form).
// ---------------------------------------------------------------------------

/** Billing allowance reference carried in a delegation budget (ch06 §6.6.3). */
export const AllowanceRef = z.object({ userId: z.string() }).passthrough();
export type AllowanceRef = z.infer<typeof AllowanceRef>;

/** A task minted hosted-side per delegation, signed by Cortex, sent over the bridge (§18.2.6).
 *  Binds the eight S2 fields + a server-minted id + a signature. */
export const DelegatedTask = z.object({
  taskId: z.string(),
  org: z.string(),
  user: z.string(),
  session: z.string(),
  pairingId: z.string(),
  grantRefs: z.array(z.string()),
  task: z.string(),
  // egressBytes is a SIGNED cap. `.finite().nonnegative()` rejects Infinity/-Infinity (zod 3's
  // z.number() accepts Infinity) - a non-finite number would canonicalise to the JSON bytes
  // `null` (see stableStringify) and collapse two distinct budgets onto identical signing bytes
  // (§18.1 canonicalisation must be injective over accepted values).
  budget: z.object({ egressBytes: z.number().finite().nonnegative(), modelSpend: AllowanceRef }),
  expiry: z.string(),
  nonce: z.string(),
  sig: z.string(),
});
export type DelegatedTask = z.infer<typeof DelegatedTask>;

/** Derived output only (§18.2.2); never raw file bytes. */
export const PatchProposal = z.object({ path: z.string(), diff: z.string() }).passthrough();
export type PatchProposal = z.infer<typeof PatchProposal>;

export const DelegationResult = z.object({
  status: z.enum(['ok', 'unreachable', 'cap_reached', 'denied']),
  answer: z.string().optional(),
  citations: z.array(z.object({ path: z.string(), range: z.string() })),
  patches: z.array(PatchProposal).optional(),
  ledgerRefs: z.array(z.string()),
  telemetry: z.object({ egressBytes: z.number(), maskedCounts: z.record(z.number()) }),
});
export type DelegationResult = z.infer<typeof DelegationResult>;

/** Daemon-side append-only egress ledger row; Cortex receives rows as display metadata (§18.5.1). */
export const EgressLedgerRow = z.object({
  ts: z.string(),
  session: z.string(),
  correlationId: z.string(),
  path: z.string(),
  byteRange: z.string(),
  bytesOut: z.number(),
  sha256: z.string(),
  tool: z.string(),
});
export type EgressLedgerRow = z.infer<typeof EgressLedgerRow>;

/** The bridge WS frames added for delegation (§18.3.8). Discriminated on `type`. Cortex validates
 *  every inbound frame at the boundary and drops unparseable/invalid frames (§18.3.1). */
export const BridgeFrame = z.discriminatedUnion('type', [
  // hosted -> daemon
  z.object({ type: z.literal('delegate'), task: DelegatedTask }),
  z.object({ type: z.literal('provider_response'), correlationId: z.string(), body: z.unknown() }),
  z.object({ type: z.literal('cancel'), taskId: z.string() }),
  // daemon -> hosted
  z.object({ type: z.literal('provider_request'), correlationId: z.string(), session: z.string(), credential: z.string(), body: z.unknown() }),
  z.object({ type: z.literal('ledger_row'), taskId: z.string(), row: EgressLedgerRow }),
  z.object({ type: z.literal('delegation_result'), taskId: z.string(), result: DelegationResult }),
  z.object({ type: z.literal('denial'), taskId: z.string().optional(), reason: z.string(), principle: z.string() }),
  // presence
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('pong') }),

  // ---- PROTOCOL v2 (Cofre WS-J) ------------------------------------------------------------
  // Added, not replaced. `provider_request`/`provider_response` STAY: they are the mechanism that
  // keeps the LLM egress chokepoint intact for bridge traffic, and dropping them would need a
  // replacement story nobody has (recorded as a decision rather than left implicit).
  //
  // daemon -> hosted: the machine ADVERTISES what it is and what it can do. Capabilities are a
  // closed vocabulary, and advertisement REPLACES the stored list — a machine that stops offering
  // a capability must stop being selected for it.
  z.object({
    type: z.literal('hello'),
    machineName: z.string().max(120),
    capabilities: z.array(BridgeCapability),
    /** Tailnet address for residential egress. Absent = this machine offers no egress. */
    egressEndpoint: z.string().max(255).optional(),
    daemonVersion: z.string().max(40),
  }),
  // hosted -> daemon: a streamed tool invocation, replacing the ad-hoc per-capability shapes.
  z.object({
    type: z.literal('tool.invoke'),
    invocationId: z.string(),
    capability: BridgeCapability,
    input: z.unknown(),
  }),
  z.object({
    type: z.literal('tool.result'),
    invocationId: z.string(),
    ok: z.boolean(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    /**
     * Per-step visual evidence from the machine that ran the step (P1.4): raw base64 PNG, no
     * `data:` prefix. ADDITIVE and OPTIONAL - a daemon that captures nothing simply omits it and
     * an older parser is unaffected (Rule 7). It rides the RESULT rather than a frame of its own
     * because the screenshot IS the post-action observation: splitting them would let a run record
     * a picture of a step that failed to report, or a report with no picture, with nothing to join
     * them by. Cortex maps it onto `observation.screenshotB64`, which
     * `DaemonBrowserSession.ingest` already reads, and from there into the existing tenant-scoped
     * screenshot plane - so a bridge run produces the same evidence a hosted run does.
     *
     * NOT redacted, and deliberately so: it is an image, not text. The accompanying free text
     * (`output`, `error`) goes through the daemon's outbound redactor and Cortex's ingress one.
     * Credential-bearing REGIONS are a browser-side masking concern, not a wire-filter one.
     */
    screenshotB64: z.string().optional(),
  }),
  /**
   * ONE-TIME secret delivery (the bridge transit rule, I9). The payload is nonce-bound and
   * single-use; the daemon holds it in RAM only, injects it at execution time and zeroizes it. It
   * is NEVER written to bridge disk and NEVER ledgered as a value.
   */
  z.object({
    type: z.literal('secret.deliver'),
    invocationId: z.string(),
    nonce: z.string(),
    /** env-var name -> value. The only frame in the union that carries credential material. */
    env: z.record(z.string(), z.string()),
  }),
  /** Route a ceremony (a card unlock, a relay code) to a machine with a human at it. */
  z.object({
    type: z.literal('attended.request'),
    requestId: z.string(),
    kind: z.enum(['card_login', 'relay_code']),
    origin: z.string(),
    reason: z.string().max(500),
  }),
  /** The daemon returns a captured session for storage as a Cofre item (WS-G). */
  z.object({
    type: z.literal('session.push'),
    requestId: z.string(),
    origin: z.string(),
    storageState: z.unknown(),
  }),
]);
export type BridgeFrame = z.infer<typeof BridgeFrame>;

// ---------------------------------------------------------------------------
// The local EXECUTION plane (P1.2 / P1.4) - the contract for a `tool.invoke` that
// runs a STEP on the paired machine, and for the observation that comes back.
//
// WHY THIS IS IN `shared/` AND NOT IN EITHER END. Both ends already spoke this
// shape and neither declared it: Cortex's `DaemonBrowserSession.toDaemonInput`
// flattens a `PlaywrightAction` `{kind,...rest}` into `{action:kind,...rest}` and
// its `ingest` reads a fixed set of keys off `observation.data`, silently dropping
// anything it does not recognise. A daemon that spelled one key differently would
// therefore produce a run that "worked" while every fingerprint was wrong. One
// versioned schema, parsed on both sides, makes that failure loud.
//
// RULE 7: these are NEW EXPORTS. No existing export changes shape.
// ---------------------------------------------------------------------------

/** How the machine finds a DOM node. Identical union to Cortex's `Locator` (automation/types.ts);
 *  the strategies are ordered stable-first and the set is CLOSED - an unrecognised strategy is a
 *  step the daemon must refuse rather than approximate. */
export const LocalBrowserLocator = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('role'), role: z.string(), name: z.string().optional(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('text'), value: z.string(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('label'), value: z.string(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('placeholder'), value: z.string() }),
  z.object({ strategy: z.literal('testid'), value: z.string() }),
  z.object({ strategy: z.literal('css'), selector: z.string() }),
  z.object({ strategy: z.literal('altText'), value: z.string() }),
  z.object({ strategy: z.literal('title'), value: z.string() }),
]);
export type LocalBrowserLocator = z.infer<typeof LocalBrowserLocator>;

/**
 * One browser step, in the FLATTENED form Cortex puts on the wire (`{action:<kind>, ...rest}`).
 *
 * Actions and ASSERTIONS share the union because they share the wire slot: `DaemonBrowserSession`
 * dispatches both through the same `runStep`, distinguished only by the verb. Keeping them in one
 * discriminated union is what lets the daemon parse the frame ONCE and be sure it holds something
 * it can run - the alternative (parse as action, else parse as assertion) has a silent third
 * branch where neither matched.
 *
 * The vocabulary is the WHOLE of `PlaywrightAction` + `PlaywrightAssertion`, including the six
 * verbs (`dblclick`/`select`/`check`/`uncheck`/`wait_for`/`scroll`) the daemon previously could
 * not run - `browser-session.ts` called reconciling that gap a follow-up, and this is it.
 *
 * IT IS A PAGE VOCABULARY, AND ONLY THAT. The browser lease's lifecycle verbs (`release`,
 * `keepalive`) are NOT members: they live on `LocalBrowserStepInput.leaseOp`, a different arm of
 * the step payload. That separation is structural rather than stylistic. Everything in THIS union
 * is something a resolver, a planner or the vision tier can emit for a step - so a lifecycle verb
 * sitting here would be one bad model completion away from a step that ends its own run, and the
 * daemon's page runner would need a case for a verb that must never reach a page. Keeping the two
 * apart means `runBrowserAction`'s exhaustive switch covers exactly the verbs that touch a page,
 * and "no step can end its own run" is a property of the shape rather than of a review comment.
 */
export const LocalBrowserAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), url: z.string() }),
  z.object({ action: z.literal('click'), locator: LocalBrowserLocator }),
  z.object({ action: z.literal('dblclick'), locator: LocalBrowserLocator }),
  z.object({ action: z.literal('fill'), locator: LocalBrowserLocator, value: z.string() }),
  z.object({ action: z.literal('press'), key: z.string(), locator: LocalBrowserLocator.optional() }),
  z.object({ action: z.literal('select'), locator: LocalBrowserLocator, value: z.string() }),
  z.object({ action: z.literal('check'), locator: LocalBrowserLocator }),
  z.object({ action: z.literal('uncheck'), locator: LocalBrowserLocator }),
  z.object({ action: z.literal('hover'), locator: LocalBrowserLocator }),
  z.object({ action: z.literal('wait'), durationMs: z.number().finite().nonnegative() }),
  z.object({
    action: z.literal('wait_for'),
    locator: LocalBrowserLocator,
    state: z.enum(['visible', 'hidden', 'attached', 'detached']),
  }),
  z.object({
    action: z.literal('scroll'),
    locator: LocalBrowserLocator.optional(),
    direction: z.enum(['up', 'down']),
    pixels: z.number().finite().optional(),
  }),
  z.object({ action: z.literal('screenshot') }),
  z.object({ action: z.literal('noop'), reason: z.string() }),
  // Assertions - the daemon runs them and reports the verdict on `assertionPassed`.
  z.object({ action: z.literal('expect_visible'), locator: LocalBrowserLocator }),
  z.object({ action: z.literal('expect_hidden'), locator: LocalBrowserLocator }),
  z.object({ action: z.literal('expect_text'), locator: LocalBrowserLocator, contains: z.string() }),
  z.object({ action: z.literal('expect_url'), pattern: z.string() }),
  z.object({ action: z.literal('expect_title'), contains: z.string() }),
]);
export type LocalBrowserAction = z.infer<typeof LocalBrowserAction>;

/**
 * The two LIFECYCLE operations on a browser lease. Neither touches a page.
 *
 *  - `release`  END OF RUN. The daemon holds ONE page and ONE cookie jar per lease across every
 *               invoke that names it, so something on the wire has to say the lease is finished:
 *               that is where the page is dropped and the injected Cofre session is wiped out of a
 *               jar the next run will share. Sent once, from the engine's run `finally`.
 *  - `keepalive` THE LEASE IS STILL WANTED. The daemon reaps a lease nobody has driven for
 *               `RUN_IDLE_MS`, because a Cortex that died mid-run must not leave an authenticated
 *               jar and a headed window resident. But a live run can legitimately go minutes
 *               without a browser step - it is blocked on a sub-automation, on a slow API call, or
 *               on a HUMAN solving a CAPTCHA in that very window - and reaping those is a
 *               correctness bug wearing a security control's clothes. This is the signal that
 *               distinguishes "nobody is driving this" from "nobody is driving this RIGHT NOW",
 *               and without it the idle window would have to be either uselessly long or wrong.
 */
export const LocalBrowserLeaseOp = z.enum(['release', 'keepalive']);
export type LocalBrowserLeaseOp = z.infer<typeof LocalBrowserLeaseOp>;

/**
 * NETWORK CAPTURE, the two lifecycle operations (slice P2.2).
 *
 * Discovery drives a page vision-first and, underneath, listens to what the page's own JavaScript
 * asks the server for. That listening is what a compiled recipe is distilled FROM - the private
 * API a portal's UI already uses is the thing a later run replays instead of re-driving the DOM.
 *
 * It is a LIFECYCLE arm, not a page verb, for the same structural reason `leaseOp` is: everything
 * in `LocalBrowserAction` is something a model can emit for a step, and "start recording every
 * request this page makes" must never be one bad completion away from being turned on by a
 * resolver. Capture is armed by the DISCOVERY DRIVER and by nothing else.
 *
 * `stop` also DROPS the machine-side buffer, including the live header values the injected-call
 * replay reads (see `LocalBrowserInjectedCall`). Releasing the lease drops it too - the buffer can
 * never outlive the authenticated jar it was recorded from.
 */
export const LocalBrowserCaptureOp = z.enum(['start', 'stop']);
export type LocalBrowserCaptureOp = z.infer<typeof LocalBrowserCaptureOp>;

/**
 * ONE captured exchange, as it crosses the wire toward Cortex.
 *
 * WHAT IS NOT HERE IS THE POINT: there is no field for a header VALUE, in either direction. The
 * machine reads the header names off the live request and drops the values before the frame is
 * built, so a value cannot reach Cortex, the captures collection, a run record or a model prompt
 * even by mistake - the wire shape cannot express it. Which header carries the session token is
 * the learning; the token is a durable credential disclosure the moment it is written down.
 *
 * Bodies DO ride, because the response body is what teaches the shape a replay expects. They pass
 * the machine's outbound redactor on the way out and the run's `SecretRegistry` on the way in
 * (`automation/network-capture.ts`), and an exchange whose redacted form still contains a live
 * value is REFUSED at the store rather than stored.
 */
export const LocalBrowserCapture = z.object({
  method: z.string(),
  url: z.string(),
  requestHeaderNames: z.array(z.string()),
  responseHeaderNames: z.array(z.string()),
  status: z.number().optional(),
  requestBody: z.string().optional(),
  responseBody: z.string().optional(),
  contentType: z.string().optional(),
  /** Playwright's resource type (`xhr`, `fetch`, `document`…) - how the learner tells an internal
   *  API call from a page load without re-deriving it from the URL. */
  resourceType: z.string().optional(),
  durationMs: z.number().optional(),
  /** A body hit the machine's per-body cap and is a PREFIX. Recorded, never silent. */
  truncated: z.boolean().optional(),
});
export type LocalBrowserCapture = z.infer<typeof LocalBrowserCapture>;

/**
 * REPLAY ONE LEARNED CALL INSIDE THE AUTHENTICATED PAGE (slice P2.3, trap T3).
 *
 * The call is issued by `fetch` running in the page's own JavaScript context, so it inherits the
 * page's origin, its cookie jar, its SameSite rules and its TLS session. A bare Node request from
 * Cortex would inherit none of those: same-origin XHR would become a cross-origin one, SameSite
 * cookies would be dropped, and the site would see a different TLS fingerprint from a different IP.
 *
 * `headerNames` IS NAMES ONLY, and that is what makes the replay possible without ever writing a
 * credential down. The machine holds the last observed value for each header name on the capture
 * buffer - in memory, for the life of the lease, never on the wire - and forwards the named ones.
 * Cortex asks for `["x-csrf-token"]`; the machine supplies whatever that header currently is.
 */
export const LocalBrowserInjectedCall = z.object({
  method: z.string(),
  url: z.string(),
  /** Which headers the machine should forward from the live session. NAMES, never values. */
  headerNames: z.array(z.string()),
  body: z.string().optional(),
  contentType: z.string().optional(),
  timeoutMs: z.number().finite().positive().optional(),
});
export type LocalBrowserInjectedCall = z.infer<typeof LocalBrowserInjectedCall>;

/** What the in-page fetch answered. Header NAMES again - the response's values are no more
 *  storable than the request's. */
export const LocalBrowserInjectedCallResult = z.object({
  status: z.number(),
  ok: z.boolean(),
  bodyText: z.string(),
  contentType: z.string().optional(),
  responseHeaderNames: z.array(z.string()),
  truncated: z.boolean().optional(),
});
export type LocalBrowserInjectedCallResult = z.infer<typeof LocalBrowserInjectedCallResult>;

/**
 * The browser step's payload: the owner it runs for, and EITHER one page action to run OR one
 * lifecycle operation on the run's lease. Two arms, never both.
 *
 * `leaseId` IS NOT THE RUN ID, and that distinction is the whole reason it exists.
 *
 *  - A SUB-AUTOMATION is a separate run - its own runId, its own run record - executing inside its
 *    parent's flow, on the same owner and therefore the same daemon and the same profile. Keyed by
 *    runId, the child would queue behind a lease its parent holds for the duration of the parent
 *    run, and the parent cannot finish until the child does: a deadlock, on the single most
 *    ordinary composition in the product. The parent's lease id is threaded down the call tree, so
 *    parent and child are the same tenant of one lease and the child continues on the page its
 *    parent left open - which is also what a sub-automation should do.
 *  - A RESUMED RUN (needs_credentials -> the user unlocks -> the run continues) reuses its runId.
 *    Keyed by runId, the resumed pass would collide with the ended pass's tombstone and be refused
 *    forever. Each PASS mints its own lease id, so the resumed pass takes a clean lease.
 *
 * Optional, so RULE 7 holds in both directions: a Cortex that predates it sends none and the daemon
 * falls back to the runId (exactly the old behaviour), and a daemon that predates it ignores the
 * field. The lifecycle arm is genuinely new, so an older daemon refuses THAT at its zod boundary -
 * fail-closed, and the lease is then ended by the daemon's own idle backstop rather than promptly.
 */
export const LocalBrowserStepInput = z.union([
  z.object({
    owner: z.string(),
    leaseId: z.string().optional(),
    action: LocalBrowserAction,
  }),
  z.object({
    owner: z.string(),
    leaseId: z.string().optional(),
    leaseOp: LocalBrowserLeaseOp,
  }),
  z.object({
    owner: z.string(),
    leaseId: z.string().optional(),
    captureOp: LocalBrowserCaptureOp,
  }),
  z.object({
    owner: z.string(),
    leaseId: z.string().optional(),
    injectedCall: LocalBrowserInjectedCall,
  }),
]);
export type LocalBrowserStepInput = z.infer<typeof LocalBrowserStepInput>;

/**
 * The bash step's payload. `argv` - NOT a command string: the argument vector never round-trips
 * through a shell hosted-side, so a value interpolated into an argument cannot become shell syntax.
 * `cwd` is a REQUEST, resolved on the machine through its containment resolver against the step's
 * grant; a cwd that escapes is refused there, never honoured here.
 */
export const LocalBashStepInput = z.object({
  argv: z.array(z.string()).min(1),
  cwd: z.string().optional(),
  stdin: z.string().optional(),
  timeoutMs: z.number().finite().positive().optional(),
  /** The grant whose root bounds `cwd`. Absent means "the daemon's default working root". */
  grantRef: z.string().optional(),
});
export type LocalBashStepInput = z.infer<typeof LocalBashStepInput>;

/** The `tool.invoke.input` envelope the Cortex daemon-connection resolver builds around a step. */
export const LocalToolInvokeInput = z.object({
  capability: z.enum(['browser', 'bash']),
  input: z.unknown(),
  stepId: z.string().optional(),
  runId: z.string(),
});
export type LocalToolInvokeInput = z.infer<typeof LocalToolInvokeInput>;

/**
 * The post-action page observation - EXACTLY the keys `DaemonBrowserSession.ingest` reads off
 * `observation.data`, and no others. A key not listed here is a key Cortex throws away, so adding
 * one to the daemon without adding it here is work that produces nothing.
 *
 * `domShapeSketch` must be byte-identical in form to what Cortex's own `buildShapeSketchInPage`
 * produces (`tags:<sorted>|roles:<sorted>|landmarks:<n>`), because it is hashed into the page
 * fingerprint that keys the action cache: a different serialisation is a permanent cache miss,
 * not a visible error.
 */
export const LocalBrowserObservation = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
  heading: z.string().optional(),
  domShapeSketch: z.string().optional(),
  accessibilitySnapshot: z.string().optional(),
  viewport: z.object({ w: z.number(), h: z.number() }).optional(),
  assertionPassed: z.boolean().optional(),
  /**
   * Exchanges the page made since the previous frame, when capture is armed (slice P2.2). Drained
   * with the observation rather than fetched by a separate verb: the capture belongs to the act
   * that provoked it, and a separate drain would race the next act's requests into the wrong step.
   * ABSENT on every frame of an unarmed lease, which is every frame a pre-P2.2 daemon ever sends.
   */
  captures: z.array(LocalBrowserCapture).optional(),
  /** The verdict of an `injectedCall` frame (slice P2.3). Absent on every other frame. */
  injectedCall: LocalBrowserInjectedCallResult.optional(),
});
export type LocalBrowserObservation = z.infer<typeof LocalBrowserObservation>;

/** The bash step's observation, as `local-command.ts` reads it off `observation.data`. */
export const LocalBashObservation = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  timedOut: z.boolean().optional(),
  truncated: z.boolean().optional(),
});
export type LocalBashObservation = z.infer<typeof LocalBashObservation>;

/**
 * The canonical byte string a DelegatedTask signature covers (§18.1, §18.2.6): the whole task
 * MINUS `sig`, deterministically stringified (recursively sorted keys). Lives in the frozen shared
 * contract so the Cortex signer AND the daemon verifier compute the SAME bytes without importing
 * each other — a divergence in canonicalisation would be a wire bug (§18.1). The HMAC secret is
 * NOT here (each side holds its own); this is only the bytes.
 */
function stableStringify(value: unknown): string {
  // A non-finite number (NaN/Infinity) JSON.stringifies to `null`, which would make
  // canonicalisation non-injective (two distinct tasks → identical signing bytes). Refuse it
  // loudly rather than sign ambiguous bytes; the DelegatedTask schema already rejects a
  // non-finite egressBytes, so this is a belt-and-braces guard for any future signed field.
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('canonicalTaskBinding: refusing to sign a non-finite number (ambiguous canonical bytes)');
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
export function canonicalTaskBinding(task: Omit<DelegatedTask, 'sig'> & { sig?: string }): string {
  const { sig: _sig, ...binding } = task as Record<string, unknown> & { sig?: string };
  return stableStringify(binding);
}
