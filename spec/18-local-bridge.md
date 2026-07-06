# 18. Local file access and the bridge (Cortex side)

This chapter specifies the Cortex side of local file access: how a hosted agent reaches files that live on the user's own machine without those files ever being uploaded, and how the bridge that carries that work is authenticated, metered, and audited. It is a build chapter for the new repository (`ekoa-code`): everything it specifies is built and tested in this run. The daemon that sits on the user's machine and does the actual file work is a separate project, out of scope here, built later against the contract this chapter states. The load-bearing design source is the Ekoa Local v2 brief (docs/, sections A1, A2, A3.5, A4, A5, A8); the work order is the amendment brief (docs/ekoa-code-spec-amendment-brief.md, Part 4); the carried bridge facts come from reference/invisible-behaviors.md section 9, reference/carryover-audit.md B16, and docs/ekoa-local-browser-session-addendum.md section 0. Visual companions: diagram `spec/diagrams/10-privacy-boundaries` (the two trust boundaries) and diagram `spec/diagrams/11-delegation-security` (the S1-S6 bindings); FIXED-12 applies (any change to delegation, the bridge, or the security bindings updates those diagrams in the same unit of work).

## 18.1 Scope split (absolute)

The scope split is stated first because it governs everything below: it is the boundary between what this run builds and what a later run builds.

- **Everything in `ekoa-code` is in scope.** The hosted delegation tool (18.2), the bridge WebSocket server (18.3), the Anthropic-compatible provider endpoint for bridge traffic (18.4), the Cortex-side halves of the security model (18.5), the web-client surfaces (18.6, detailed in chapter 12), the correlation-id plumbing that joins hosted audit metadata to the local ledger (18.5 S6; chapter 17 section 17.6), and the fake-daemon harness (18.7) are all built and tested in this run.
- **Everything in the ekoa-local daemon is out of scope.** Grant creation via the native OS picker, the containment resolver, the file tools, `extract_text`, the append-only egress ledger and its cap, write-back with hash preconditions, and the daemon-side verification of every delegated task are the daemon's obligations. They are built later by the ekoa-local run (docs/ekoa-local-integration-brief.md), against the contract this chapter states. ekoa-local remains its own project (FIXED-1: "ekoa-local remains its own project; Cortex commanding local tools through it is unchanged and out of scope").

This chapter therefore specifies **the contract the daemon implements against**, not the daemon. Where a security property is enforced daemon-side (S1, S2, the containment resolver), this chapter states the property Cortex may rely on and the daemon must guarantee; Cortex never assumes the daemon validated anything on Cortex's behalf, and daemon-side enforcement never assumes Cortex validated anything on the daemon's (the two are mutually untrusting - see 18.5 S1).

| In scope (built this run, `ekoa-code`) | Out of scope (the daemon's own run, ekoa-local) |
|---|---|
| `delegate_to_local` tool + task minting/signing (18.2) | Grant creation via the native OS picker (the Ekoa Local v2 brief, A2.1) |
| Bridge WS server, pairing registry, revoke kill switch (18.3) | The single containment resolver (realpath, symlink-escape rejection) |
| Anthropic-compatible provider endpoint through the chokepoint (18.4) | The file-tool vocabulary + `extract_text` (the Ekoa Local v2 brief, A2.2) |
| Cortex-side halves of S1-S6; correlation-id minting (18.5) | Daemon-side task verification: signature, nonce, expiry, grant checks (18.5 S2) |
| Trust chip, settings surface, attach affordance (18.6; chapter 12) | Append-only egress ledger + cap; write-back with hash precondition (18.5, 18.6) |
| The fake-daemon harness that stands in for the daemon (18.7) | The real daemon implemented against that harness (docs/ekoa-local-integration-brief.md) |

**The harness wins over prose.** The fake-daemon harness of 18.7 is the executable form of this contract. It is the single authority on the wire: pairing, the delegated-task shape and its bindings, ledger-row events, denial semantics, and provider-endpoint auth. Where this chapter's prose and the harness disagree, the harness is correct and the prose is a bug to be fixed; the ekoa-local run treats the harness the same way ("the wire contract is code, not prose... where this brief or the v2 brief disagrees with that harness, the harness wins; record the conflict in docs" - docs/ekoa-local-integration-brief.md). The hierarchy is therefore: the harness is authoritative; this chapter is the readable statement of what the harness encodes; the v2 brief and amendment are the design provenance behind both.

**What is carried and what is new.** The bridge transport itself is not new. Cortex already runs a WebSocket server that the ekoa-local daemon dials out to, with a distinct bridge-token class, an owner-indexed connection registry, and an act-and-observe envelope protocol (reference/invisible-behaviors.md section 9; reference/carryover-audit.md B16). That transport is carried and re-specified in 18.3. What is new in this run is the layer above it: the `delegate_to_local` tool (18.2), the provider endpoint that lets the local reasoning loop call Cortex for completions (18.4), the S1-S6 security model as an explicit contract (18.5), the privacy web surfaces (18.6), and the harness that makes all of it testable without a real daemon (18.7).

Amendment record: this chapter was authored 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md, Part 4).

Amended again 2026-07-06 per the consolidated-ledger amendment (Amendment 2, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md): swept tenant to org throughout - the S2 binding is `{org, user, session, pairing id, grant_refs, budget, expiry, nonce}`, the delegated-task shape's field is `org: string` (18.2.6), the pairing registry is org-scoped with an `org` column (18.3.4), the provider credential is scoped `{org, pairing}` with the verification chain `provider credential -> pairing -> org` (18.4.4), the vault key is `{org, conversation id}`, and every cross-tenant reference (18.4.4, 18.5 S2, 18.7.2, 18.7.4, 18.8) reads cross-org; rate limits are per-org/per-user. Added the bridge as the third admission plane consulting activation (18.3.2, 18.4.4, S4, and acceptance criterion 7): a deactivated owner's pairing refuses connect, delegated tasks, and provider-endpoint traffic with the CONV-2 `ACCOUNT_DISABLED`/`BILLING_LOCKED` codes (chapter 09 section 9.7.1).

## 18.2 Delegation

### 18.2.1 The hosted tool

A hosted agent that needs to work on the user's local files gets exactly one tool:

```
delegate_to_local(task, grant_refs, budget) -> DelegationResult
```

- `task` - a natural-language instruction plus any structured parameters the hosted agent wants the local loop to carry out (for example, "summarise section 3.1 of the referenced contract and list every party named"). The hosted agent never receives file bytes to reason over; it describes the work and delegates it.
- `grant_refs` - one or more opaque references to grants the daemon owns. Grants are created **daemon-side**, via a native OS picker opened by the daemon, because only the daemon can produce real filesystem paths (the Ekoa Local v2 brief, docs/, A2.1: "Created via a native OS picker opened by the daemon (real paths; browser inputs cannot provide them)"). Grant creation is out of scope for this chapter. Cortex treats each `grant_ref` as an opaque token: it passes the refs through in the delegated task and never resolves, widens, or interprets them. A `grant_ref` that names a grant the daemon does not hold, or a grant from another session, is rejected daemon-side (18.5 S2).
- `budget` - the ceiling for this delegation, in two dimensions that bind together: an egress cap (bytes the local loop may emit across the bridge, default and soft-stop behaviour owned daemon-side per the v2 brief A2.4) and a model-spend allowance checked at the chokepoint's pre-run billing gate (chapter 06 section 6.6.3). The hosted agent cannot raise a cap the user has not consented to; a soft-stop on the egress cap surfaces to the user for an explicit raise (daemon-side; v2 brief A2.4).

The task is sent to the local Pi loop over the bridge (18.3). The local loop executes against the granted roots using the daemon's fixed file-tool vocabulary (18.5 S3), calling Cortex-as-provider (18.4) for its own completions, and returns.

### 18.2.2 Derived output only

The tool returns **derived output only**:

- an answer or summary,
- citations, each as a path plus a byte or line range,
- patch proposals (explicit write-backs the user can accept; the write itself is daemon-side, gated by a hash precondition and a first-write confirmation per the v2 brief A2.5),
- ledger entry references (opaque ids the user can resolve in the daemon-served ledger viewer, 18.6),
- egress and mask telemetry for the per-turn trust chip: bytes emitted across the bridge (from the local ledger) and masked-entity counts by class (from the hosted audit metadata, chapter 17 section 17.6).

Raw local-file content never enters the hosted agent's context and is never written to hosted persistence. This is invariant I2 of the privacy premise, stated verbatim so it lives in the spec (the Ekoa Local v2 brief, docs/, A1): *"Raw local-file content enters model context only inside completion requests from the local Pi loop to Cortex-as-provider. It never enters the hosted agent's own context and is never written to hosted persistence (conversation records, run records, logs). Hosted receives derived output only: summaries, citations, patches, structured results."* The excerpts the local loop reads exist outside the user's machine only transiently, inside the provider requests of 18.4, where they cross the anonymisation chokepoint before Anthropic (chapter 17). The hosted conversation record holds the `DelegationResult`, nothing more. Diagram 10 draws this as the two boundaries: file excerpts cross Boundary 1 (user machine to Cortex) in cleartext, transiently, inside provider requests; only tokens cross Boundary 2 (Cortex to Anthropic); the vault and the ledger never cross either boundary (the Ekoa Local v2 brief, docs/, A1).

### 18.2.3 Offline behaviour is honest

If the daemon is not connected, delegation does not silently fall back to any other path, and above all never degrades to upload. The tool surfaces an unreachable state ("requires the paired machine online"); referenced files are shown unreachable; nothing content-bearing is uploaded to substitute for the missing daemon (invariant I1; the Ekoa Local v2 brief, docs/, A2.3: "nothing is silently degraded to upload"). Offline is a first-class, honest state, not an error to route around. The web surface for this state is chapter 12's concern (18.6).

### 18.2.4 Delegation is the only chat path to local files

Chat-originated file work is never routed through the executor face. The executor face (agent-face runs, automations) keeps its role and its own consent model; delegation is the sole chat path to local files (the Ekoa Local v2 brief, docs/, A2.3 and A5). This matters for the security model: the chat path exposes only the fixed file-tool vocabulary through delegation and has no arbitrary-command primitive, while `local_command` remains an executor-face step under its consent gate (18.5 S3; reference/invisible-behaviors.md section 9.3).

### 18.2.5 Relation to the carried agent face

Delegation is distinct from the carried agent-face run and must not be confused with it. In the carried agent face, the Claude Agent SDK reasons **hosted-side** and RPCs individual tool calls (`bash`/`fs`/`browser`) to the daemon over the bridge, resolving each on an `agent_tool_result` envelope (reference/invisible-behaviors.md section 7.5 and 9.2). In delegation, the reasoning loop runs **on the daemon** (the local Pi loop), and it is the loop's model completions - not its tool calls - that traverse the bridge back to Cortex, through the provider endpoint of 18.4. Both share the same bridge WS transport (18.3); they differ in where the model runs and therefore in what crosses the wire. The carried agent-face run remains supported (reference/invisible-behaviors.md section 7.5; chapter 05 run classes; chapter 03 section 3.10); delegation is the new chat-facing addition specified here.

### 18.2.6 The delegated-task and result shapes (normative)

Cortex mints a delegated task per `delegate_to_local` call and receives a derived result. The shapes below are the contract; the fake-daemon harness (18.7) is authoritative on the exact wire encoding, and a divergence is a bug in this prose, not in the harness (18.1). The task binding carries the eight fields S2 requires (18.5), plus a server-minted id and a signature that are its transport mechanism:

```ts
// Minted hosted-side per delegation, signed by Cortex, sent over the bridge (18.3).
interface DelegatedTask {
  taskId: string;      // server-minted id for this delegation
  org: string;         // resolved from the pairing registry, never a request body (18.4.4)
  user: string;        // the delegating user; owner of the pairing
  session: string;     // hosted conversation id; the anonymisation vault key (18.4.3)
  pairingId: string;   // the target pairing; must match the live socket
  grantRefs: string[]; // opaque; the daemon resolves them against its own grants (18.2.1)
  task: string;        // natural-language instruction + structured params
  budget: {            // the ceiling; see 18.2.1
    egressBytes: number;      // egress cap dimension (daemon-enforced soft-stop)
    modelSpend: AllowanceRef; // billing allowance checked at the chokepoint (ch06 6.6.3)
  };
  expiry: string;      // ISO timestamp; the daemon rejects a task past it (S2)
  nonce: string;       // single-use; the daemon's replay cache rejects a repeat (S2)
  sig: string;         // Cortex signature over the binding; the daemon verifies it (S2)
}

// Returned to the hosted agent. Derived output only (18.2.2); no raw file content.
interface DelegationResult {
  status: 'ok' | 'unreachable' | 'cap_reached' | 'denied';
  answer?: string;                                  // de-tokenized cleartext summary/answer
  citations: { path: string; range: string }[];    // path + byte/line range, never bodies
  patches?: PatchProposal[];                        // explicit write-backs the user may accept
  ledgerRefs: string[];                             // opaque ids for the daemon-served viewer
  telemetry: {                                      // for the per-turn trust chip (18.6)
    egressBytes: number;                            // from the local ledger
    maskedCounts: Record<string, number>;           // by entity class, from hosted audit (17.6)
  };
}
```

The `correlationId` that joins the two audit halves (18.5 S6) is not a field of the task: it is minted per provider request at the chokepoint (18.4) and propagated to the daemon with each provider/tool cycle, where it lands on the daemon's ledger row (18.5 S6). The `DelegationResult` never carries file bytes; a client that needs to see a cited passage resolves the citation through a fresh delegated read, it does not receive the passage inline.

## 18.3 The bridge channel (carried, re-specified)

The bridge is the transport under both delegation (18.2) and the provider endpoint (18.4). It is carried from the old Cortex and re-specified here so the contract is self-contained.

### 18.3.1 One outbound WebSocket, daemon-dialed

The daemon dials **out** to Cortex; Cortex is the WebSocket server. This is NAT-friendly by design - it keeps the real browser, the OS keychain, and the fingerprint on the user's machine while the orchestration is remote (docs/ekoa-local-browser-session-addendum.md, section 0: "The daemon dials OUT to cortex (NAT-friendly...); cortex is the WS server"). The connection is an HTTP Upgrade on `/api/v1/bridge/connect/:pairingId`, over TLS. Cortex attaches this WS surface with `noServer` and scopes the upgrade to that path (reference/carryover-audit.md B16). The daemon wire protocol - the zod envelope schemas - is the compatibility contract and is kept in lockstep with the daemon's own copy (`ekoa-local/src/protocol/control-channel.ts`); Cortex validates every inbound frame at the boundary and drops unparseable or invalid frames (reference/invisible-behaviors.md section 9.2). Every capability returns an act-and-observe `ResultEnvelope` (`{ok, observation, error, meta}`), never a bare boolean (reference/invisible-behaviors.md section 9.2).

### 18.3.2 Pairing-token auth at connect

Authentication at connect is a pairing token, a bridge-token class distinct from the platform JWT. The carried mechanism: a short-lived token minted from the user's JWT via `POST /api/v1/bridge/token`, with audience `ekoa-bridge`, a `pairingId` claim (carried as `connectionId`), and a default TTL of 600 seconds (reference/invisible-behaviors.md section 1.5; chapter 03 section 3.10). The token is presented with a `Authorization: Bearer` header; `?token=` in the URL is accepted only as a transition fallback scheduled for removal, because URL tokens leak into proxy logs (reference/invisible-behaviors.md section 9.1; chapter 03 section 3.10). At connect, the pairing id claimed in the token must equal the pairing id in the URL path (`connection-mismatch` rejection otherwise), and an optional resolved owner must agree with the token's subject or the socket is rejected `ownership-mismatch` (reference/invisible-behaviors.md section 9.1).

**Activation admission (Amendment 2).** Connect and delegation dispatch on a pairing additionally consult the owner's cached activation state (chapter 09 section 9.7.1): a deactivated owner (`active=false`) is refused - the connect Upgrade fails and any in-flight or new delegation on that pairing fails cleanly - with the CONV-2 `ACCOUNT_DISABLED` code, and a billing-locked owner with `BILLING_LOCKED`. This makes the bridge the **third admission plane** alongside the `/api/v1` JWT middleware and the served-app plane gate; deactivation also pushes the owner's tokens into the P-03 revocation set (chapter 09), so the pairing token itself stops verifying on its next refresh. The per-request consult for provider-endpoint traffic is stated in 18.4.4.

### 18.3.3 Presence heartbeat

The WebSocket carries a presence heartbeat; the live/offline state of a pairing is exactly its heartbeat state. Presence is what the web surface reads to decide whether the Reference affordance is enabled, offline, or absent (18.6; the Ekoa Local v2 brief, docs/, A2.6). `GET /health` reports `bridgeConnections` separately from SSE `connections`, and external watchdogs depend on that field (reference/invisible-behaviors.md sections 6 and 9.3; chapter 03).

### 18.3.4 Org-scoped pairing registry

Cortex holds a pairing registry, re-specified as org-scoped. Each row records: pairing id, org, user (owner), created-at, and revoked-at. The registry is keyed by pairing id with a secondary owner index; `getConnectionByOwner(ownerUserId)` returns the most-recently-registered live connection for that owner, and it is **multi-device aware** - an owner may have more than one paired machine, and resolution returns the live one (docs/ekoa-local-browser-session-addendum.md, section 0; reference/invisible-behaviors.md section 9.1). Redialing with the same pairing id retires the stale socket (`replaced`); a socket is unregistered on close (reference/invisible-behaviors.md section 9.1). Org scoping is structural: a pairing belongs to exactly one org, and resolution can never return a pairing from another org (this is the registry half of "cross-org addressing impossible by construction", 18.5 S2; the invariant home is chapter 09 invariant 5).

### 18.3.5 Revoke-pairing kill switch

Revocation is a first-class, two-ended kill switch:

- **Server-side revoke.** An owner (or an admin) may revoke a pairing. Revocation sets `revoked-at`, disconnects the live socket immediately, and causes every subsequent connect attempt and every in-flight delegation on that pairing to fail cleanly. This is the mechanism behind the settings surface's grant/pairing revoke (18.6) and behind the S4 "revocable both ends" guarantee (18.5).
- **Daemon-side unpair.** The daemon may unpair from its end; the socket closes and the same clean-failure semantics apply from the other direction.

The revoke path is exercised as a named test: revoke mid-session, assert the socket disconnects and subsequent delegations fail cleanly (18.7; 18.8).

### 18.3.6 The token-class separation (carried invariant)

Platform JWTs and bridge tokens are two token classes over one secret, never interchangeable. The platform token verifier positively **rejects** bridge tokens - any `connectionId`/`pairingId` claim or `aud === 'ekoa-bridge'` throws - and the bridge verifier positively rejects platform (session) tokens (reference/invisible-behaviors.md sections 1.5 and 17: "positively rejects bridge tokens... two token classes, one secret, never interchangeable"). This is a carried anti-replay and anti-misconfiguration defence, not incidental; its invariant home is chapter 09 section 9.2 (auth model). A stolen platform JWT cannot open a bridge socket, and a stolen bridge token cannot call the platform API.

### 18.3.7 Outside FIXED-2's frontend rule (scoped)

FIXED-2 governs the **frontend-to-Cortex** boundary: "No WebSockets between frontend and Cortex as API transport; one scoped exception exists for the live browser canvas media channel." The bridge is a different boundary entirely - it is **daemon-to-Cortex** transport, not frontend-to-Cortex. It is therefore neither the API-transport prohibition FIXED-2 states nor the canvas media-channel carve-out FIXED-2 admits; it falls outside FIXED-2's scope. This is stated explicitly per the amendment (amendment brief, docs/ekoa-code-spec-amendment-brief.md, Part 4: "This is daemon<->Cortex transport, outside FIXED-2's frontend rule; state that explicitly"). The bridge's own governing invariants are the token-class separation (18.3.6), the outbound-only and revocable-both-ends properties (18.5 S4), and the pairing registry's org scoping (18.3.4) - not FIXED-2.

### 18.3.8 Wire frames added for delegation

The carried envelope is an act-and-observe protocol whose hosted-to-daemon frames are `agent_tool_call | exec_step | cancel` and whose daemon-to-hosted frames are results plus an `Observation` (docs/ekoa-local-browser-session-addendum.md, section 0; reference/invisible-behaviors.md section 9.2). Delegation and the provider endpoint add frames to this envelope, kept in lockstep with the daemon's copy of the protocol (18.3.1):

- **`delegate` (hosted -> daemon).** Carries a `DelegatedTask` (18.2.6). This is how a delegation reaches the local loop.
- **`provider_request` (daemon -> hosted).** The local loop asks Cortex-as-provider for a completion (18.4); the frame carries the pairing-bound credential and the session id (18.4.3).
- **`provider_response` (hosted -> daemon).** The de-tokenized completion, after the chokepoint (18.4.2).
- **`ledger_row` (daemon -> hosted).** One row per local read (18.5 S6), streamed up as display metadata for the trust chip and not persisted hosted by default (18.6).
- **`delegation_result` (daemon -> hosted).** The `DelegationResult` (18.2.6) that ends the delegation.

Cortex validates every inbound frame at the boundary and drops unparseable or invalid frames, exactly as for the carried frames (reference/invisible-behaviors.md section 9.2). The frame catalogue is part of the contract the harness encodes; the harness is authoritative on exact field names and encoding (18.1, 18.7).

## 18.4 The provider endpoint

### 18.4.1 What it is

The local Pi loop does its reasoning on the user's machine but has no model of its own; it calls Cortex-as-provider for completions. Cortex therefore exposes an **Anthropic-compatible completions endpoint for bridge traffic**: the local loop issues completion requests over the bridge, Cortex serves them, and the loop continues. This endpoint exists only for bridge traffic. It is not a generic dispatch endpoint (FIXED-2 forbids one), and it is not reachable with a platform JWT; it is authenticated by the pairing-bound credential of 18.4.3.

### 18.4.2 All bridge completions route through the chokepoint (FIXED-13)

Every completion served on this endpoint routes through the one LLM chokepoint (`api/src/llm/`, chapter 06 section 6.2), with no bypass. FIXED-13 states it directly: "One egress module, three concerns... Nothing else may import or instantiate the Anthropic client... subprocess paths (Agent SDK spawns) are pointed at the chokepoint via base URL/env so their traffic funnels through it." Concretely, for bridge completions this means:

- **Anonymisation.** The request passes the anonymisation pipeline before Anthropic (chapter 17 sections 17.2-17.5): sensitive spans in the file excerpts the local loop is reasoning over are detected on the delta and tokenized; the response is de-tokenized before it returns to the loop, including tool_use argument blocks so the loop greps and edits for real values, not placeholders (chapter 17 section 17.3). This is the second trust boundary in action (diagram 10): the local loop sends cleartext excerpts across Boundary 1; only tokens cross Boundary 2 to Anthropic.
- **Attribution.** Bridge completions are tagged `user_work` at the call site and billed to the delegating user (chapter 06 section 6.3; the carried agent-face attribution folds in at chapter 06 section 6.5.5). No bridge completion is ever tagged `platform`.
- **Metering.** Bridge completions meter through the single metering point on the same ledger as every other user_work call (chapter 06 section 6.5.1); the pre-run billing gate applies to the delegation as a whole (chapter 06 section 6.6.3).
- **Provider routing config.** Provider base URL, region, and zero-retention posture are configuration inside the chokepoint, never hardcoded and never re-declared for bridge traffic (FIXED-13; the Ekoa Local v2 brief, docs/, A6-D6).

There is no separate model path for the bridge. The provider endpoint is a face on the chokepoint, not a second egress.

The endpoint serves every local-loop origin, not only chat delegation: the carried power-user TUI is a local Pi loop too, and its completions traverse this same endpoint and therefore the same chokepoint (the Ekoa Local v2 brief, docs/, A3.1: "bridge provider requests (local Pi, including the TUI)"). The payload-capture assertion of 18.7.3 is stated to hold across TUI sessions for exactly this reason (docs/ekoa-local-integration-brief.md, Phase 5: "Payload capture across ALL scenarios including TUI sessions").

### 18.4.3 Session-identity propagation

The delegated task carries the hosted conversation id (18.2). The local loop's provider requests carry that same conversation id back to Cortex. This is what makes chapter 17's vault **one per conversation across both faces**: the hosted turns of a conversation and the delegated local turns of the same conversation share one vault, so a token minted for a value on a hosted turn stays consistent when a local summary re-enters hosted context and later re-crosses the chokepoint (chapter 17 section 17.5; the Ekoa Local v2 brief, docs/, A3.5). Session identity is the join key for anonymisation determinism, and it flows hosted -> delegated task -> bridge provider request -> chokepoint.

### 18.4.4 Pairing-bound auth and the cross-org guard

The provider credential presented on this endpoint is scoped to `{org, pairing}`. It is not a platform JWT and not a general bridge token; it authorises completions for one pairing, on behalf of one org, for the duration of that pairing.

The verification that a stolen provider credential cannot reach another org's session or vault is checked **server-side, per request**, as a chain:

```
provider credential -> pairing -> org
```

1. The credential resolves to exactly one pairing (18.3.4). A credential that resolves to no live, non-revoked pairing is rejected.
2. The pairing resolves to exactly one org. The org is taken from the pairing registry, never from the request body - the request cannot assert its own org.
3. The conversation id the request carries (18.4.3) must belong to that org. A request naming a conversation from another org is rejected before any model call.
4. The vault the chokepoint uses is keyed by `{org, conversation id}` (chapter 17 section 17.5). Because org is derived from the pairing and not from the request, a credential for org A can never address org B's vault: there is no request field that would let it name one.

A stolen provider credential can therefore, at worst, spend its own pairing's budget against its own org's sessions until the pairing is revoked (18.3.5) - it can never cross into another org's sessions or vault. This is the provider-endpoint expression of S2's "cross-org addressing impossible by construction" (18.5), and it is checked by the auth-binding test named in 18.8.

**Activation admission (Amendment 2).** The chain above is joined by the activation plane: the owner's cached activation state (chapter 09 section 9.7.1) is consulted on every provider request, and a deactivated owner (`active=false`) is refused before any model call with the CONV-2 `ACCOUNT_DISABLED` code, a billing-locked owner with `BILLING_LOCKED`. This is the same third admission plane the connect path applies (18.3.2); because deactivation also pushes the owner's tokens into the P-03 revocation set (chapter 09), an in-flight pairing whose owner is deactivated fails on its next admission check.

### 18.4.5 A completion, end to end

The lifecycle of one bridge completion, stated so the ordering is unambiguous:

1. The local loop emits a `provider_request` frame (18.3.8) carrying the pairing-bound credential and the session (conversation) id, with an Anthropic-messages-shaped body containing the file excerpts it is reasoning over in cleartext (crossing Boundary 1; diagram 10).
2. Cortex resolves the credential to its pairing and the pairing to its org (18.4.4), rejecting anything that does not resolve to a live, non-revoked pairing, and rejecting a session id that does not belong to that org.
3. The chokepoint (`api/src/llm/`) mints a correlation id, runs the anonymisation pipeline (delta detection, deterministic per-session tokenization against the `{org, session}` vault - chapter 17 sections 17.3, 17.5), tags the call `user_work`, and applies the pre-run allowance if the delegation's budget has not yet been gated (chapter 06 sections 6.3, 6.6.3).
4. The tokenized body crosses Boundary 2 to Anthropic. Only tokens cross; the vault stays home (invariant I5).
5. On response, the chokepoint de-tokenizes - including tool_use argument blocks (chapter 17 section 17.3) - records hosted audit metadata under the correlation id (chapter 17 section 17.6), meters the call (chapter 06 section 6.5.1), and returns a `provider_response` frame to the loop.
6. The loop continues locally; each local read it performs is ledgered daemon-side under the same correlation id (18.5 S6), which is how the two audit halves join.

No step is skippable and none is reorderable across the chokepoint: there is no path by which a bridge completion reaches Anthropic without passing anonymisation, attribution, and metering (FIXED-13).

## 18.5 Security model (S1-S6)

The security model rests on six principles, faithful to the amendment (amendment brief, docs/ekoa-code-spec-amendment-brief.md, Part 4) and the Ekoa Local v2 brief (docs/, A1-A5). The governing frame is mutual distrust across the bridge: **the daemon is the enforcement point for file access and treats every Cortex payload as untrusted input; Cortex is the enforcement point for org isolation, metering, and anonymisation and treats every daemon payload as untrusted input.** Each principle below states the property, its Cortex-side obligation (in scope, built this run), and its daemon-side obligation (out of scope, the contract the daemon implements). Diagram 11 draws the S1-S6 bindings.

### S1 - The daemon is the enforcement point; Cortex is untrusted input to it

No Cortex payload can widen a grant, bypass a confirmation, or escape a granted root. Enforcement lives daemon-side, at the single containment function that resolves every path (realpath resolution, symlink-escape rejection, no traversal outside granted roots), lint-enforced as the only path resolver (the Ekoa Local v2 brief, docs/, A2.1).

- **Cortex-side obligation:** Cortex states this contract and relies on it; it never assumes a delegated task it sent was honoured beyond the derived output it receives. Cortex passes `grant_refs` opaquely (18.2) and does not itself resolve paths.
- **Daemon-side obligation (contract):** every file tool resolves through the one containment function; a request to read outside a grant, follow a symlink out of a grant, or traverse above a granted root is rejected and ledgered as a denial (docs/ekoa-local-integration-brief.md, Phase 5 containment scenarios).
- **Test / enforcement:** the fake daemon rejects a containment-violation request (symlink-escape, traversal, absolute-path-outside-grant) and emits a denial ledger row (18.7).

### S2 - Every delegated task binds and is verified

Every delegated task binds `{org, user, session, pairing id, grant_refs, budget, expiry, nonce}`. The daemon verifies all of it; replays are rejected; cross-org addressing is impossible by construction.

- **Cortex-side obligation:** Cortex mints the task with the full binding, signs it, sets the expiry, and issues a fresh nonce per task; it resolves the pairing and org from the registry (never from a request body, 18.4.4) so the `org`/`pairing id` in the binding are authoritative; it never issues a task addressing a pairing outside the caller's org.
- **Daemon-side obligation (contract):** the daemon verifies the signature, the nonce (against a replay cache), the expiry, and that every `grant_ref` names a grant the daemon holds **for this session**; it rejects unknown grants, expired tasks, forged tasks not bound to this pairing, replays, and tasks naming another session's grant, ledgering each denial (docs/ekoa-local-integration-brief.md, Phase 3 and Phase 5 binding scenarios).
- **Test / enforcement:** the fake daemon rejects a replayed task, an expired task, a task naming another session's `grant_ref`, and a forged task not bound to this pairing; cross-org addressing is rejected both server-side (18.4.4, 18.3.4) and daemon-side (18.7).

### S3 - No arbitrary-command primitive on the chat path

Chat delegation runs the **fixed file-tool vocabulary** against granted roots (ls, glob, grep, read-with-ranges, stat, extract_text, and the write-back patch - the Ekoa Local v2 brief, docs/, A2.2, A2.5). There is no arbitrary-command primitive on the chat path. `local_command` stays on the executor face under its own consent model.

- **Cortex-side obligation:** the delegation tool exposes only the fixed file-tool vocabulary; it offers no shell/exec verb. The executor-face `local_command` step remains separate, gated by its carried consent model (unapproved command shapes fail with `awaiting_consent:<shape>` and surface as a pause; reference/invisible-behaviors.md section 9.3), and is never reachable from chat delegation.
- **Daemon-side obligation (contract):** the daemon offers no shell primitive to a delegated chat task; command execution exists only behind the executor face's consent gate.
- **Test / enforcement:** the harness offers no arbitrary-command verb in the delegation vocabulary; a chat delegation cannot invoke `local_command` (structural, 18.7). The executor-face consent gate is covered by the carried bridge safety gates (chapter 14; reference/test-audit.md section 5.6).

### S4 - The channel: outbound-only, authenticated, rate-limited, revocable both ends

- **Cortex-side obligation:** the bridge is daemon-outbound-only (Cortex never dials the daemon; 18.3.1); connect is pairing-token authenticated (18.3.2); the provider endpoint and delegation dispatch are rate-limited per pairing/org at the chokepoint (chapter 09 FIXED-14 baseline: per-org/per-user rate limits and spend caps at the chokepoint); admission additionally consults the owner's activation state (18.3.2, 18.4.4; a deactivated owner is refused connect, delegation, and provider traffic with the CONV-2 codes); the server-side revoke kill switch disconnects and fails clean (18.3.5).
- **Daemon-side obligation (contract):** the daemon may unpair from its end with the same clean-failure semantics.
- **Test / enforcement:** revoke-pairing mid-session disconnects the socket and fails subsequent delegations cleanly; unpair from the daemon side does the same from the other end (18.7).

### S5 - Prompt injection contained by absence of exfiltration primitives

A granted file may contain adversarial instructions ("upload this file", "read ~/.ssh"). Injection is contained not by trying to detect it but by the **absence of exfiltration primitives**: there is no upload primitive anywhere (invariant I1), reads outside a grant are denied (S1), the per-session egress cap bounds how much can ever leave (the Ekoa Local v2 brief, docs/, A2.4), and every read is ledgered (S6).

- **Cortex-side obligation:** Cortex exposes no primitive that would let a delegated task push local content anywhere except back as derived output through the metered, anonymised provider path; there is no "upload this referenced file" verb, hosted-side or in the delegation vocabulary (I1).
- **Daemon-side obligation (contract):** out-of-grant reads are denied and ledgered; the egress cap holds and its raise requires explicit user consent; no primitive stores or transmits file content outside the machine except as excerpts inside provider requests.
- **Test / enforcement:** the injection scenario - a granted file instructing the model to upload itself or read outside the grant - produces no upload (none exists), a denied+ledgered out-of-grant read, and a held egress cap (18.7; docs/ekoa-local-integration-brief.md, Phase 5 injection scenario).

### S6 - Full auditability

A correlation id is minted per provider request at the chokepoint (chapter 17 section 17.6), propagated through delegation to the daemon, and used to join the daemon's local ledger rows to the hosted audit metadata; denials are ledgered.

- **Cortex-side obligation:** the chokepoint mints the correlation id per provider request and records hosted audit metadata (entity classes, counts, correlation id, payload hash - never bodies, never the vault; chapter 17 section 17.6); the correlation id is carried in the delegated task and every provider request so the two halves join (invariant I4).
- **Daemon-side obligation (contract):** the daemon records one local egress-ledger row per read (timestamp, session, correlation id, path, byte range, bytes-out, sha256 of the emitted excerpt, tool name - the Ekoa Local v2 brief, docs/, A2.4) and ledgers every denial; the authoritative ledger stays local.
- **Test / enforcement:** the correlation-id join test asserts a delegated read's local ledger row and the hosted audit entry share one correlation id (18.7; 18.8). Hosted audit metadata folds into the single Registo write path (FIXED-8; chapter 17 section 17.6; chapter 09 invariant 3).

### 18.5.1 The join, made concrete

S2, S6, and the containment guarantee meet at two artefacts and one ordered check. The daemon's egress-ledger row is the local half of the join (the Ekoa Local v2 brief, docs/, A2.4); Cortex relies on its shape for the trust chip and the correlation-id join, though the authoritative copy stays local and Cortex persists no row hosted by default (18.6):

```ts
// Daemon-side, append-only, local. Cortex receives rows as display metadata only (18.6).
interface EgressLedgerRow {
  ts: string;            // timestamp of the read
  session: string;       // hosted conversation id
  correlationId: string; // minted at the chokepoint per provider request (S6); the join key
  path: string;          // the file read (paths can be sensitive: not persisted hosted, 18.6)
  byteRange: string;     // the range emitted
  bytesOut: number;      // bytes that crossed Boundary 1 (the trust-chip numerator)
  sha256: string;        // of the emitted excerpt
  tool: string;          // the file tool that produced the read
}
```

The daemon's verification of a `DelegatedTask` is an ordered sequence, every failure ledgered as a denial (S1, S2, S6); Cortex states the order it relies on, the daemon owns the implementation:

1. Verify `sig` over the binding; reject a forged task (S2).
2. Verify the task is addressed to **this** pairing (`pairingId` matches the live socket); reject a task forged for another pairing (S2).
3. Verify `expiry` is in the future; reject an expired task (S2).
4. Verify `nonce` against the replay cache; reject a replay, then record the nonce (S2).
5. Resolve every `grantRef` against grants the daemon holds **for `session`**; reject an unknown grant or a grant from another session (S1, S2).
6. Execute only the fixed file-tool vocabulary, each path resolved through the single containment function; reject any read outside a granted root (S1).

Because the daemon derives nothing from Cortex's assertion of its own authority - it re-checks the signature, the pairing, and every grant - a compromised or lying Cortex payload cannot widen a grant or escape a root. This is the operational meaning of "the daemon is the enforcement point and Cortex is untrusted input to it" (S1).

## 18.6 Web client surfaces (summary; chapter 12 owns the detail)

The privacy web surfaces live in `web/` and are specified at the FC level in chapter 12. This section is the summary and the pointer. All strings are PT-PT, formal register, no em-dashes, per the owner's conventions; the claims ceiling is chapter 17 section 17.9 (the v2 brief A1/A6 lists), and no surface here may claim ahead of what its mechanism proves (the Ekoa Local v2 brief, docs/, A7.4 publish gate).

| Surface | What it does | Provenance | Detail owner |
|---|---|---|---|
| Attach affordance: Upload vs Reference | The composer offers two actions. Upload is the existing pipeline (stores a copy hosted, at rest). Reference keeps the file on the machine and opens the daemon's native picker; the chosen path becomes a session grant and a visible reference token. Three states: **enabled** (bridge paired and connected), **install** (no bridge - disabled with an install CTA), **offline** (bridge installed but offline - retry hint). | v2 brief A2.6; amendment Part 4 | chapter 12 |
| Per-turn trust chip | Rendered on turns that touched local files. Shows file(s) and range read, bytes-out (from the local ledger via 18.2.2 telemetry), and masked-entity counts by class (from hosted audit metadata, chapter 17 section 17.6). Two-boundary-honest: it must never imply masking happened before Boundary 1. Copy is drafted but ship-gated on Phase-5 evidence. | v2 brief A4; A7.4 | chapter 12 |
| Settings "Privacidade e ponte local" | Absorbs the carried `/settings/bridge` page (Q-07). Sections: bridge status/pairing; active grants with revoke; the local ledger viewer; masking-activity summary; the approved-commands list unified in. | v2 brief A4; amendment Q-07 | chapter 12 |
| Grant / pairing revoke | The revoke control that drives the server-side kill switch of 18.3.5; revocation takes effect on the next tool call. | v2 brief A2.1, A4 | chapter 12 |
| Local ledger viewer | Renders the egress ledger **served live by the daemon** - not from hosted storage. Hosted persistence of ledger rows is off by default and opt-in per org at most, because paths themselves can be sensitive (client names in folder names). | v2 brief A2.4, A4 | chapter 12 |

Verbatim PT-PT copy carried into the spec so it is self-contained (each ship-gated per A7.4):

- Trust chip example (middle dot allowed; no em-dashes): "Leu contrato.docx (secção 3.1) · 3,1 KB saíram desta máquina de forma transitória · 14 nomes e 3 NIFs mascarados antes do fornecedor de IA" (the Ekoa Local v2 brief, docs/, A4).
- Attach micro-copy: "Enviar guarda uma cópia nos nossos servidores. Referenciar mantém o ficheiro apenas no seu computador - recomendado para documentos sensíveis." (the Ekoa Local v2 brief, docs/, A7.2).
- First-time grant line: "Esta autorização permite ao agente ler [pasta/ficheiro] durante esta sessão. Pode revogar a qualquer momento em Definições -> Privacidade e ponte local." (the Ekoa Local v2 brief, docs/, A7.2).

## 18.7 The fake daemon harness

### 18.7.1 What it is

The fake daemon harness is a build deliverable of this run, at `api/test/fake-daemon/`. It is a contract-faithful simulated daemon: a WebSocket **client** that dials the bridge exactly as the real daemon would, implements pairing (18.3), executes delegated tasks against a fixture directory (18.2), emits ledger-row events (18.5 S6), and produces every denial case of the security model (18.5). It is the executable definition of the wire contract, and it ships in the repository so the later ekoa-local run has something to implement against (docs/ekoa-local-integration-brief.md: "`ekoa-code/api/test/fake-daemon/` is the executable definition of the daemon's contract"). Where prose and harness disagree, the harness wins (18.1).

The harness is not a mock that returns canned success. It enforces the daemon-side half of S1 and S2 against its fixture directory: it runs the containment check, verifies task bindings, keeps a replay cache, and rejects what the contract says to reject. That is what makes it a faithful target and a real adversarial test surface rather than a stub.

### 18.7.2 Adversarial scenarios the harness must support

The harness must implement, at minimum, every scenario below, each producing a checkable outcome (a rejection plus a denial ledger row where the contract ledgers denials):

| Scenario | Expected outcome | Principle |
|---|---|---|
| Containment-violation request (symlink-escape, traversal, or absolute path outside the grant) | Rejected; denial ledgered | S1 |
| Replayed delegated task (nonce already seen) | Rejected | S2 |
| Expired delegated task (past its expiry) | Rejected | S2 |
| Task naming a `grant_ref` from another session | Rejected | S2 |
| Forged task not bound to this pairing (bad signature / wrong pairing) | Rejected | S2 |
| Cross-org addressing (a second org tries to address this daemon) | Rejected server-side (18.4.4, 18.3.4) AND daemon-side | S2 |
| Revoke pairing mid-session | Socket disconnects; subsequent delegations fail cleanly | S4 |
| Injection in a granted file ("upload this", "read ~/.ssh") | No upload primitive exists; out-of-grant read denied+ledgered; egress cap holds | S5 |

### 18.7.3 Payload-capture assertions

Payload-capture assertions run against the harness. In test mode, every outbound Anthropic request body is captured (chapter 17 section 17.8), and the assertion is unconditional: planted synthetic sensitive values (checksum-invalid plausible fakes only - never real client data, chapter 17 section 17.8) must appear **tokenized in every captured outbound request**, across delegation flows and provider-endpoint completions alike, while the user-visible derived output is cleartext. This is the same harness discipline the anonymisation layer uses (chapter 17), applied to the bridge path so that "no detected sensitive data reaches the model provider in cleartext" holds for delegated local work exactly as it holds for hosted chat.

### 18.7.4 Which chapter 14 gates consume the harness

The harness is consumed by three sets of gates in the phased run (chapter 14 section 14.4), all against the ordering constraint chokepoint core < anonymisation < agent execution < delegation/bridge:

- **The delegation and bridge phase gate.** The phase the amendment inserts after agent execution (chapter 14 section 14.4) runs: the fake-daemon adversarial scenarios of 18.7.2 (containment-violation rejected, replay rejected, expired rejected, cross-org rejected, forged-pairing rejected); the delegation round trip green against the fake daemon; the derived-output-only assertion (no raw local content in hosted records, 18.2.2); the correlation-id join test (18.5 S6); and the revoke-pairing kill-switch test (18.3.5). The carried bridge safety gates (owner isolation, tool suppression, owner-scoped cancel) remain keep-verbatim gates in this phase (reference/test-audit.md section 5.6).
- **The anonymisation phase gate.** The payload-capture assertion (18.7.3; chapter 17 section 17.8) is checked here for the chokepoint core and re-exercised against the bridge path in the delegation/bridge phase.
- **The final security phase.** The security-review and adversarial-Codex passes plus the cross-org adversarial suite (chapter 14; security addendum F1-F4) exercise bridge auth, the provider endpoint, and anonymisation-bypass attempts against the harness as first-class suite members.

## 18.8 Acceptance criteria (checkable without a human)

1. **The harness exists and implements the scenario list.** `api/test/fake-daemon/` is present and a WS client that pairs, executes delegated tasks against a fixture directory, emits ledger rows, and produces every scenario of 18.7.2, each with its expected rejection/denial outcome.
2. **Every S1-S6 principle has at least one named test or structural enforcement.** S1: containment-violation rejection. S2: replay, expiry, foreign-grant, forged-pairing, and cross-org rejections. S3: the delegation vocabulary structurally excludes any arbitrary-command verb and cannot reach `local_command`. S4: revoke-both-ends disconnect-and-fail-clean tests plus the per-pairing rate limit. S5: the injection scenario yields no upload, a denied+ledgered out-of-grant read, and a held cap. S6: the correlation-id join test.
3. **Provider-endpoint auth binding test.** A test asserts the `credential -> pairing -> org` chain (18.4.4): a credential resolving to no live pairing is rejected; a request carrying a conversation id from another org is rejected before any model call; an org-A credential cannot address org-B's vault (no request field names one).
4. **Derived-output-only assertion.** After a delegation that reads local files, the hosted conversation record and any hosted run record contain only derived output (summary, citations with path+range, patch proposals, ledger refs, telemetry) and no raw local-file content (invariant I2, 18.2.2).
5. **Correlation-id join test.** A delegated read's local ledger row and the hosted audit-metadata entry for the same provider request share one correlation id (18.5 S6; chapter 17 section 17.6).
6. **FIXED-2 exception statement present and scoped.** The chapter states that the bridge WS is daemon-to-Cortex transport, outside FIXED-2's frontend rule - neither the API-transport prohibition nor the canvas media-channel carve-out - and that its governing invariants are the token-class separation, outbound-only/revocable-both-ends, and pairing-registry org scoping (18.3.7). The token-class separation is enforced by the carried verifier tests (platform verifier rejects bridge tokens and vice versa; reference/invisible-behaviors.md sections 1.5 and 17; chapter 09 section 9.2).
7. **Activation admission on the bridge (Amendment 2).** A deactivated owner's pairing is refused at connect, its in-flight and new delegated tasks fail cleanly, and its provider-endpoint completions are refused before any model call with the CONV-2 `ACCOUNT_DISABLED` code (a billing-locked owner with `BILLING_LOCKED`); the bridge is thereby the third admission plane alongside the platform JWT middleware and the served-app plane gate (chapter 09 section 9.7.1).

Cross-references: chapter 03 (bridge and agent-face endpoints, section 3.10; the pairing token mint), chapter 05 (delegation is invoked from a chat run; the carried agent-face run class), chapter 06 (the chokepoint, attribution, and metering the provider endpoint routes through - FIXED-3, FIXED-13), chapter 09 (the token-class separation and org-scoping invariant homes; the activation admission plane, section 9.7.1; the FIXED-14 rate-limit/spend-cap baseline), chapter 12 (the FC-level web surfaces), chapter 14 (the delegation/bridge phase gate, the anonymisation payload-capture gate, and the final security phase that consume the harness), chapter 17 (the anonymisation pipeline, vault, correlation id, and payload-capture harness the provider endpoint and the bridge path depend on - sections 17.3, 17.5, 17.6, 17.8), diagram 10 (privacy boundaries) and diagram 11 (delegation security).
