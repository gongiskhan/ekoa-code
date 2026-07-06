# 16. Open questions

This chapter is the single register of genuine unknowns: places where the old system's behavior or the rebuild's correct course is ambiguous even after reading the code, and where guessing would be worse than asking. Every question here names who can answer it (founder, ops check, or external verification), the recommendation if one exists, the default the implementation run follows while the question is open (when a safe default exists), and exactly what blocks on the answer. This register and the PROPOSED register (chapter 15) are the only two places a decision may remain open in this spec; both must read zero-unresolved before the implementation run launches (SPEC.md status line; chapter 14 gate G-P refuses to start the run while any blocking item lacks a recorded resolution).

## 16.1 How to read this register

**Questions versus proposals.** A PROPOSED item (chapter 15) is a recommendation awaiting approval: the spec knows what it wants and asks the founder to confirm or override. An Open question is an unknown: code alone cannot tell us the answer, so the spec cannot even form a complete recommendation without outside input, or the answer is a value judgment (risk acceptance, product direction, external-world fact) that no amount of code reading resolves. Where the line was blurry, one home was picked and cross-referenced; section 16.4 lists the blurry-line items that live in chapter 15.

**Block classes.** Each question carries exactly one of three flags:

| Flag | Meaning |
|---|---|
| **blocks run start** | Gate G-P (chapter 14) requires a recorded founder resolution before the implementation run begins |
| **blocks cutover** | The run may start and build; the chapter 10 cutover checklist holds a criterion hostage to this answer |
| **deferrable with default** | The run proceeds on the stated default; the founder may override at launch review or later without re-planning the run |

**Resolution mechanics.** Resolutions are recorded inline in this file: each question ends with a `Resolution:` line, filled during founder review with the decision, the date, and who decided. A resolution that changes spec text (for example Q-04 answered "register" instead of "drop") is executed by amending the owning chapter before the spec freeze; the `Resolution:` line then cites the amended section. Gate G-P (chapter 14) checks that every **blocks run start** question has a filled `Resolution:` line, and chapter 10's checklist checks the **blocks cutover** ones.

**Id hygiene.** Ids Q-01 through Q-08 were minted while drafting this spec, before chapter collation; each is presented by its owning chapter, and this file is the register of record. Q-09 was minted by chapter 08 (legal content packages). Chapter 09 provisionally minted a colliding Q-09 for the workspace Graph proxy and delegated renumbering to this collation; it is Q-10 here and in chapter 09's text. Ids are unique across the spec.

## 16.2 The register at a glance

| Id | Question (short) | Who answers | Flag | Default while open | Resolution (2026-07-06) |
|---|---|---|---|---|---|
| Q-01 | Live browser view WebSocket versus the no-WebSockets rule (FIXED-2) | Founder | **blocks run start** | none - must be decided | Carve-out (a); FIXED-2 text patched, canvas is a scoped media channel |
| Q-02 | Literal production app-data backend value (lives in ekoa-deploy, unverified) | Ops check | **blocks cutover** | spec assumes Firestore | Cutover-class - confirmed cutover-checklist ops action, answered at cutover |
| Q-03 | PITR GA status on the Mongo-compat surface + driver support | External verification | **blocks cutover** (one criterion) | backups UI does not advertise PITR | Cutover-class - confirmed cutover-checklist verification, re-verified at cutover |
| Q-04 | `phase_changed` / `subagent_event`: missing-registration bug or abandoned feature - register or delete on both sides | Founder | deferrable with default | drop from the v1 wire contract (P-11) | Delete on both sides (executes P-11) |
| Q-05 | App preview `?token=` in URL versus same-origin cookies | Founder | deferrable with default | carry today's behavior + log redaction | Defaulted - carry `?token=` + log-redaction middleware |
| Q-06 | Garrison fittings inventory: which fittings exist and are wanted | Founder | deferrable with default | consume zero fittings at launch | Defaulted - zero fittings at launch; inventory supplied later |
| Q-07 | `/settings/bridge` orphan page + write-only demo-cards state: link, build, or drop | Founder | deferrable with default | carry page unlinked; delete write-only state | Link the page as "Privacidade e ponte local"; delete write-only state |
| Q-08 | STT: does live transcription ship in v1, and on which engine | Founder + ops | deferrable with default | interface + mock engine only, metering as specified | Defaulted - interface + mock + metering; FIXED-11 interpretation recorded |
| Q-09 | `ekoa-data/legal-shared/` + `legal-spine/`: import as knowledge packages or drop | Founder | **blocks cutover** (migration import) | run proceeds; loader supports either outcome | Import both as on-demand knowledge packages, task-scoped to legal builds |
| Q-10 | Workspace Graph proxy `/api/m365/*`: gate it (behavior change) or carry the open proxy | Founder | **blocks run start** | none - must be decided | Gate it (X-Ekoa-App-Id + manifest opt-in); served-app sweep on ch10 checklist |

## 16.3 The questions in full

### Q-01 - Live browser view WebSocket versus FIXED-2

**The question.** The automation pause-for-user feature includes an interactive live browser canvas: the only WebSocket in the product, genuinely bidirectional (JPEG frames down, mouse and keyboard input up), handed off via the `streaming_available` event carrying `{token, wsUrl, viewport}` (reference/operations-inventory.md section 22). FIXED-2 says no WebSockets between frontend and Cortex. Read strictly, the rule kills the feature. Does the founder (a) carve the canvas out as a media channel exception - it is a screen-share, not API traffic - or (b) drop the interactive canvas and keep only the screenshot-based pause UI?

**Why code cannot answer it.** The code proves the feature exists and works; it cannot rank a fixed architectural rule against an existing product feature. That is a founder-only trade.

**Who answers.** Founder.

**Recommendation.** The carve-out (chapter 03 section 3.7): the canvas is not request-response API traffic and cannot be SSE (reference/operations-inventory.md section 0.3 marks it "Yes, bidirectional - cannot be SSE"). Port it per reference/carryover-audit.md B17, preserving the close-code contract (1000 normal, 4000 takeover never reconnects - reference/operations-inventory.md landmine 8). The exception is scoped: one endpoint, short-TTL token, media frames and input events only, never JSON API payloads.

**What blocks on it.** Whether the `streaming/` module is built at all (chapter 02 section on `streaming/` reserves it either way); the scope of gate G8 in the build sequence (chapter 14 names the Q-01 resolution an explicit input); the four remote-display tests in the conditional carryover set (chapter 13 section 13.3); whether `streaming_available` stays in the automation event union (chapter 03 section 3.6.3) or is deleted with the feature; the pause-for-user UX in the migrated client (chapter 12). Gate G-P holds the run until this is resolved.

**Where it surfaces.** Chapters 01, 02, 03 (3.7), 12, 13, 14 (G8).

**Resolution:** Carve-out (a) - the live browser canvas WebSocket is a scoped media-channel exception, not API traffic. FIXED-2's text was patched to read: "No WebSockets between frontend and Cortex as API transport; one scoped exception exists for the live browser canvas media channel (frames down, input events up, short-TTL token, never JSON API payloads)." The consequences that were conditional on this answer are now unconditional: the `streaming/` module is built (chapter 02); the chapter 03 section 3.7 canvas endpoint is final, preserving the close-code contract (1000 normal, 4000 takeover never reconnects); `streaming_available` stays in the automation event union (chapter 03 section 3.6.3); the pause-for-user UX with the live canvas ships in the migrated client (chapter 12); chapter 13's four remote-display tests move from the conditional carryover set into the ported set; gate G8's Q-01 input is resolved (chapter 14). founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### Q-02 - Production app-data backend value is unverified

**The question.** Everything inspectable from this machine - code, provisioning scripts, integration docs - says production app-data runs on Firestore Enterprise with MongoDB compatibility (project `spatial-tempo-488909-s5`, database `ekoa-app-data`), selected by an environment switch. The literal production value of that switch lives in the external ekoa-deploy repository and could not be verified from here (reference/data-inventory.md section 1 and Conflicts C1). Is production actually on the Firestore backend?

**Why code cannot answer it.** The code contains both backends behind one switch; which one production selects is deployment configuration in another repository, not a fact in this codebase.

**Who answers.** Ops check: inspect the cortex service environment in ekoa-deploy (the per-service Dockerfile/deploy configuration) or the running production container's environment. Minutes of work for whoever has access.

**Recommendation.** Verify early, not at cutover eve. The whole spec assumes Firestore-in-prod (chapter 04 section 4.1); chapter 10's migration plan row 1 ("app-data stays in place, no migration") depends on it.

**What blocks on it.** Cutover criterion 6 (chapter 10 section 10.5) is a hard gate: Q-02 resolved plus the collections-engine parity suite passed once against the production database. If the answer turns out to be the filesystem backend, chapter 10 section 10.2 row 1 becomes a real data import (tooling already specified for dev in chapter 04 section 4.8 item 1) and the cutover window must be re-rehearsed before the freeze. The implementation run itself does not block - it builds against its own dev database either way.

**Where it surfaces.** Chapters 04 (4.9), 10 (10.5 criterion 6, 10.9).

**Resolution:** Unchanged - confirmed as a cutover-checklist ops action; answered at cutover, not at run start. It stays cutover criterion 6 (chapter 10 section 10.5); the implementation run does not block on it. Confirmed by the founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### Q-03 - PITR maturity on the Mongo-compat surface

**The question.** Point-in-time snapshot reads on Firestore's MongoDB-compat surface were Preview, not GA, at research time, and Node-driver support for the snapshot-timestamp mechanism was unverified; the current code degrades honestly when unsupported (reference/data-inventory.md section 3.5 and Conflicts C9). Are PITR restore points GA and driver-supported now, such that the rebuilt product may advertise them?

**Why code cannot answer it.** GA status is a fact about Google's product roadmap, external to any repository; driver support needs a live probe against a real cluster.

**Who answers.** External verification: Google Cloud release notes for Firestore Enterprise (Mongo-compat) plus a driver probe against a test cluster. Anyone can run it; the founder signs off on the product promise.

**Recommendation.** Re-verify shortly before cutover, not before the run. The data layer was deliberately designed so nothing correctness-critical depends on the answer: single-document atomic operations only, multi-document transactions never load-bearing (chapter 04 section 4.1).

**What blocks on it.** Cutover criterion 9 (chapter 10 section 10.5): PITR either verified GA-and-driver-supported, or the backups UI demonstrably does not advertise time-travel restore beyond local snapshots. The default posture - do not advertise - is what the run builds; a positive verification upgrades the UI copy later.

**Where it surfaces.** Chapters 04 (4.1, 4.9), 10 (criterion 9).

**Resolution:** Unchanged - confirmed as a cutover-checklist external-verification action; re-verified at cutover, not at run start. It stays cutover criterion 9 (chapter 10 section 10.5); the run builds the do-not-advertise default either way. Confirmed by the founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### Q-04 - Dead-on-wire events: bug or abandoned feature

**The question.** The old backend emits `phase_changed` and `subagent_event`; the old frontend has handlers for both, but the transport's subscription list omits the event names, so the handlers can never fire - producer alive, consumer dead (reference/frontend-cleanup-audit.md Conflicts C-2; reference/invisible-behaviors.md Conflicts 12 and 13; reference/operations-inventory.md C5.1 and C5.3; reference/test-audit.md Conflicts 2 confirms the mechanism is a transport-list omission with a live-but-unreachable handler). Was this a missing-registration bug in a feature someone wanted, or an abandoned feature? Register on both sides, or delete on both sides?

**Why code cannot answer it.** The code shows exactly the contradiction and nothing more. Whether anyone still wants a phase side-panel or a subagent activity display is a product question, not a code fact.

**Who answers.** Founder.

**Recommendation.** Delete on both sides for v1: neither event appears in the wire contract; sub-task notifications are consumed internally (they reset the inactivity timer, chapter 05 section 5.3.6); phase information folds into `plan_step` on job streams and into the session resource (chapter 05 section 5.7.3, RESOLVED (P-11)). The contrast case proves the register path was chosen where the feature was wanted: `preview_reload` had the same class of bug and the new contract fixes it by construction (chapter 03 section 3.6.2, FC-026).

**Default while open.** The drop is already drafted into the contract (chapter 03 sections 3.6.5 and Appendix A; chapter 12 FC-027/FC-030 delete the unreachable branches). Deferrable: adding events later is additive. A "register" answer is cleanest before the shared contract lands (chapter 14, phase 0 / gate G0) but remains an additive change afterward.

**Where it surfaces.** Chapters 03 (3.6.5, Appendix A), 05 (5.7.3, P-11), 12 (FC-027, FC-030), 13 (the retired phase-event test).

**Resolution:** Delete on both sides - neither `phase_changed` nor `subagent_event` enters the v1 wire contract; both the producers and the dead client handlers are removed, executing P-11's drop branch. founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### Q-05 - App preview `?token=` in the URL versus same-origin cookies

**The question.** Non-shareable artifact previews append the bearer JWT as `?token=` to `/apps/...` URLs, because cross-origin dev iframes cannot share cookies (reference/operations-inventory.md landmine 4; reference/frontend-cleanup-audit.md FC-024 and FC-068). Tokens in URLs leak into logs, browser history, and referrers. Keep the query token, or move app serving to same-origin session cookies?

**Why code cannot answer it.** Both designs are implementable; the choice is a security-versus-plumbing trade (cookie scope, dev-mode cross-origin topology, CSRF posture for the served-app plane) that someone must own.

**Who answers.** Founder, on chapter 09's framing of the tradeoff (section 9.5).

**Recommendation.** None strong enough to promote to PROPOSED; the spec deliberately leaves this as a genuine question. Chapter 09 bounds the risk either way with the log-redaction rule (the `token` query parameter is redacted by middleware before any log or audit write, test-gated), which makes the default safe to carry.

**Default while open.** Carry today's behavior exactly: `?token=` for owner-checked non-shareable previews only, deliberately never for shareable ones (chapter 03 section 3.2; chapter 07's access gate works under either resolution; chapter 12's `api.withPreviewToken` helper isolates the behavior so a later flip touches one function).

**Where it surfaces.** Chapters 03 (3.2), 07 (access gate), 09 (9.5, redaction rule), 12 (FC-024, FC-068).

**Resolution:** Defaulted to the stated default - carry today's `?token=` behavior for owner-checked non-shareable previews only, bounded by the log-redaction middleware that scrubs the `token` query parameter before any log or audit write (chapter 09 section 9.5). A later flip to same-origin cookies touches one function (`api.withPreviewToken`). founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### Q-06 - Garrison fittings inventory

**The question.** Which Garrison fittings exist, and which does the founder want consumed as agent context content in the rebuilt product? The inventory is not enumerable from this repository (chapter 08 section 8.5).

**Why code cannot answer it.** Garrison is the founder's separate content ecosystem (FIXED-7); this repository contains no registry of it and no endpoint to query.

**Who answers.** Founder, by supplying the list.

**Recommendation.** Supply the inventory whenever convenient; nothing waits on it. Fitting import is a content operation the shipped loader already supports (chapter 08), so resolving Q-06 later requires no code change.

**Default while open.** The implementation run consumes zero fittings: the launch composition is the repo-bundled baseline plus runtime-authored integration definitions only (chapter 08). The remote registry client is explicitly not built in v1 (chapter 08 section 8.3.3 rejects it partly because of this question).

**Where it surfaces.** Chapter 08.

**Resolution:** Defaulted - the run consumes zero fittings; the launch composition is the repo-bundled baseline plus runtime-authored integration definitions only. The founder supplies the fittings inventory later; fitting import is a content operation the shipped loader already supports, so resolving this later requires no code change. founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### Q-07 - The bridge settings orphan page and the write-only demo-cards state

**The question.** Two half-connected frontend artifacts of ambiguous purpose (reference/frontend-cleanup-audit.md FC-101 and FC-120; reference/operations-inventory.md C4.6 and C5.6): (a) `/settings/bridge` is a working page (approved-commands list and revoke - a functional, security-relevant surface) with no navigation entry pointing at it; (b) the demo-cards store state is fetched on every dashboard mount for a gallery panel that was never built. Link the page, build the gallery, or drop them?

**Why code cannot answer it.** Both are readable as either work-in-progress someone intends to finish or leftovers of a changed plan. Only the person who parked them knows.

**Who answers.** Founder.

**Recommendation.** For (a): add the bridge page to the settings navigation - one nav entry, no redesign; the feature is functional and security-relevant (chapter 12 FC-101). For (b): decide whether the gallery panel is still wanted; if not, the deletion already performed by the default is final.

**Default while open.** Defined in chapter 12 so the run is never blocked: carry `/settings/bridge` as-is, unlinked (exact status quo - either founder answer is then a one-line follow-up); delete the write-only demo-cards state (nothing reads it; behavior-preserving and reversible - if the gallery is wanted later, the state returns with its reader; the live demo tour overlay itself migrates regardless, FC-063).

**Where it surfaces.** Chapter 12 (12.5.1, decision register), chapter 03 (the approved-commands endpoints stay either way, section 3.8.18).

**Resolution:** (a) Link `/settings/bridge` into the settings navigation; the page becomes the settings surface "Privacidade e ponte local", extended by this amendment's chapter 17 work (masking activity summary) and chapter 18 work (bridge status and pairing, active grants with revoke, local ledger viewer served live by the daemon, approved-commands list absorbed), with chapter 12 owning the client-facing detail. (b) The write-only demo-cards state is deleted - the default is confirmed final. founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### Q-08 - STT: does live transcription ship in v1, and on which engine

**The question.** The legal transcription endpoint is a real, metered product surface, but the STT provider layer is an interface with stubs: `mock` (a deterministic PT-PT two-speaker fixture) is the only working engine; `whisperx` (self-hosted, the stated default posture for segredo profissional, pending GPU provisioning) and `elevenlabs` (cloud, requiring an API key plus an explicit per-matter `consentCloud` RGPD opt-in) both throw (reference/llm-usage-map.md section 10, STT entry; reference/invisible-behaviors.md sections 8.10 and 12.7). Does live STT ship in v1? If so, which engine, and does the FIXED-11 exclusion of non-Anthropic model providers even apply to a non-LLM speech service?

**Why code cannot answer it.** Three unknowns are outside the code: procurement and provisioning (GPU capacity or an ElevenLabs contract), the RGPD posture the founder wants to lead with, and the scope interpretation of FIXED-11 (its text targets LLM providers; STT is a different modality, but only the decision's author can say whether the exclusion was meant to cover it).

**Who answers.** Founder (product, RGPD posture, FIXED-11 interpretation) with an ops check on provisioning feasibility.

**Recommendation.** Ship the interface, the mock engine, and the metering exactly as today (per-started-audio-minute at a flat configured rate, engine-tagged, best-effort so a billing failure never loses a finished transcription - chapter 06 section on non-LLM metered surfaces). Defer live-engine selection to a config-plus-provisioning decision after launch; the engine interface makes it a deployment change, not a build change.

**Default while open.** Exactly that recommendation: mock-only behavior parity. The legal e2e suite exercises the transcription flow against the deterministic fixture, so test coverage does not depend on a live engine.

**Where it surfaces.** Chapters 03 (served-app plane, `/api/legal/transcricao`), 06 (metering, explicitly "ships subject to Q-08").

**Resolution:** Defaulted - the STT interface, the mock engine, and the metering ship exactly as specified (mock-only behavior parity); live-engine selection is deferred to a post-launch config-plus-provisioning decision, which the engine interface makes a deployment change rather than a build change. Recorded FIXED-11 interpretation (normative): the non-Anthropic-provider exclusion targets LLM providers, not STT; whisperx-self-hosted remains the segredo-profissional posture when provisioned. founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### Q-09 - Legal content directories with no code reader

**The question.** `ekoa-data/legal-shared/` and `ekoa-data/legal-spine/` have no code reader anywhere in the old backend (reference/data-inventory.md Conflicts C14), yet the sweep records them as agent-consumed content: material the coding agent reads from disk during legal builds through its generic file access, not through any loader. Import both into the rebuilt content system as on-demand knowledge packages, or drop them with the other dead C14 rows?

**Why code cannot answer it.** Consumption that happens through an agent's generic file reads leaves no import edge to grep for. Whether current legal builds actually depend on this material is knowledge held by whoever runs those builds.

**Who answers.** Founder (owner of the legal vertical).

**Recommendation.** Import both as on-demand knowledge packages for the coding agent, task-scoped to legal builds (chapter 08, slot 8) - making today's implicit consumption explicit and durable. Alternative: drop them and rely on the knowledge base for legal grounding.

**What blocks on it.** Not the run - the content loader supports either outcome without code change (chapter 08). It must be resolved before chapter 10's migration import so the baseline package set is final; treat it as part of the pre-cutover checklist.

**Where it surfaces.** Chapter 08 (where the question is minted), chapter 10 (migration import).

**Resolution:** Import both `ekoa-data/legal-shared/` and `ekoa-data/legal-spine/` into the rebuilt content system as on-demand knowledge packages, task-scoped to legal builds (chapter 08 slot 8 becomes normative), making today's implicit agent file-read consumption explicit and durable. Resolved before chapter 10's migration import so the baseline package set is final. founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### Q-10 - Workspace Graph proxy: gate it or carry the open proxy

**The question.** The `/api/m365/*` workspace Graph proxy injects the workspace Microsoft platform token into caller-chosen Graph paths. An inline comment in the old code claims `X-Ekoa-App-Id` scoping; no such gate exists in the route - verified (reference/invisible-behaviors.md section 1.2; chapter 09 section 9.4). Today an unauthenticated same-origin request can act as the workspace Microsoft account. Gate the proxy in the rebuild (a behavior change on an otherwise byte-compatible served-app plane), or carry the open proxy for exact parity?

**Why code cannot answer it.** The code shows a comment-versus-behavior contradiction; whether the missing gate is a vulnerability to close or a deliberate simplification someone relies on is a matter of original purpose plus risk acceptance. Closing it can break existing apps that call the proxy without the header, so it needs a sweep and sign-off, not a silent fix.

**Who answers.** Founder (risk acceptance and sign-off), with a sweep of existing served apps that call the proxy to size the breakage.

**Recommendation.** Gate it: require and verify `X-Ekoa-App-Id` (slug-resolved, charset-checked, app must exist and be served) on every `/api/m365/*` request, mirroring the app-data plane gate, plus a per-app opt-in flag in the app manifest (chapter 09 section 9.4). Alternative: carry the open proxy as-is and accept the exposure.

**What blocks on it.** Gate G-P holds the run: the implementation run must know which behavior to build on this route, and the spec refuses to default a security decision that either changes behavior on a byte-compatible plane or knowingly ships an open proxy. This and Q-01 are the only two questions that block run start.

**Where it surfaces.** Chapter 09 (9.4, where it is minted), chapter 03 (3.9, the plane it sits on).

**Resolution:** Gate the `/api/m365/*` proxy - require and verify `X-Ekoa-App-Id` on every request (slug-resolved, charset-checked, the app must exist and be served), mirroring the app-data plane gate, plus a per-app opt-in flag in the app manifest (chapter 09 section 9.4). The served-app sweep that sizes which existing apps call the proxy without the header becomes a named cutover checklist item in chapter 10. founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 16.4 Blurry-line items that live in chapter 15, not here

These read like open questions but are proposals: the spec has a formed recommendation and needs approval, not information. They are listed here only so nobody searches this register for them.

| Item | Why it is a proposal, not a question | Home |
|---|---|---|
| Agent-face event delivery channel (P-18) | The unknown (how ekoa-local consumes events post-rebuild) is fully mapped; two complete designs exist and one is recommended | Chapter 03 section 3.10; chapter 15 |
| Server-side logout / revocation list (P-03) | The tradeoff is fully characterized; recommendation formed (stateless + short expiry, no revocation list in v1) | Chapters 03 and 09; chapter 15 |
| `subagent_event` / `phase_changed` contract drop (P-11) | The proposal is the recommended action; the underlying unknown (bug or abandoned) is Q-04 here. Division of labor: founder answers Q-04, P-11 executes the "delete" branch | Chapter 05; chapter 15 |
| Memory system v1 scope (P-12) | Scope recommendation formed from the LLM-call fates | Chapters 03 and 05; chapter 15 |
| Hard-limit billing launch posture (P-20) | Config default with a formed recommendation | Chapter 06; chapter 15 |
| Billing parity method (P-25) and proxy-level cutover switch (P-26) | Procedures with formed recommendations | Chapter 10; chapter 15 |

## 16.5 Reference-doc conflicts reviewed and not promoted to questions

Every Conflicts section of the seven reference documents was swept for items requiring a decision. The ones that required one and could not be decided from evidence became Q-01 through Q-10 above. The rest fall into two classes, listed here so the collation is checkable.

**Decided in a chapter (a decision was required and the spec made it, from evidence):**

| Conflict | Decision and home |
|---|---|
| SSE resume semantics undefined on the client (frontend-cleanup C-8) | Explicit contract: monotonic ids, `Last-Event-ID` replay from a bounded per-stream ring (200 events, 300 s idle sweep), client re-sync via the resource read after `ready` (chapter 03 section 3.6; chapter 05 section 5.6.8) |
| `preview_reload` unreachable client-side (operations-inventory C5.2) | Kept in the typed contract and consumed; the registration bug is fixed by construction (chapter 03 section 3.6.2; chapter 12 FC-026) |
| Registered-but-unconsumed stream events and dead page selections (operations-inventory C5.4, C5.5) | Dropped from the v1 contract with per-event reasons (chapter 03 Appendix A) and deleted in the client cleanup (chapter 12) |
| Dead client surfaces and orphan operations (operations-inventory C1-C3; frontend-cleanup C-1, C-10; invisible-behaviors 3) | Every one fated individually: chapter 03's Orphans appendix and chapter 12's per-item tables |
| Docs implied a live external anonymiser; none exists in the code (carryover-audit 1) | The egress sanitization chokepoint carries; originally formalized as a future Presidio integration point (an interface seam), promoted on 2026-07-06 to a built anonymisation layer - FIXED-8 as amended, specified in chapter 17, restated in chapter 09 invariant 2 |
| Split data-directory resolution across stores (data-inventory C4) | Not carried: all filesystem paths derive from one configured data directory (chapter 04 section 4.4) |
| No server-side token kill switch (invisible-behaviors 6) | Routed to PROPOSED P-03 (chapters 03 and 09; section 16.4 above) |
| Process exit drops in-flight requests and streams (invisible-behaviors 8) | Crash-safety comes from the P-10 orphan sweep at boot and the client reconnect re-sync (chapter 05); no separate drain contract is specified |
| Single-instance in-memory state breaks multi-pod deployment (invisible-behaviors 9) | Accepted and recorded: single multi-tenant process is FIXED-8; chapter 04 restates the single-writer constraint |
| Old activity-log read surface is write-only today (invisible-behaviors 21) | Dropped from the v1 API; audit stays a single write path with read surfaces deferred (chapter 03 Appendix A; FIXED-8) |
| Activity rows store the user id in the username field (invisible-behaviors 20) | Fixed as part of the port, regression-tested (chapter 09 invariant 3) |
| Thinking budgets dead on the wire (llm-usage-map 5) | Not carried; effort parameter only, conflict recorded (chapter 06 sections 6.2.3 and 6.8) |
| Unbilled router-bypassing visual-vibe call (llm-usage-map 10) | Call class eliminated; no unbilled model calls (chapter 06; FIXED-3) |
| Abort returning empty string could fall through to a heuristic build (llm-usage-map 11) | Guard carried as a FIXED behavior with a dedicated test (chapter 05 section 5.3.2; CONV-5) |
| Dead code-generation flag on the integration builder (llm-usage-map 9) | Not carried; the tier table states the truth (chapter 06, call-site table) |
| Expensive default model on the no-decision fallback (llm-usage-map 13) | Not inherited; every call site passes an explicit routing decision (chapter 06) |
| Two parallel AES-256-GCM implementations (invisible-behaviors 4) | Unified into one crypto module (chapter 04; chapter 09 invariant 6) |
| ENCRYPTION_KEY default has no production guard (invisible-behaviors 5) | Boot guard extended to ENCRYPTION_KEY (chapter 09 invariant 11; FIXED-8) |
| License tier feature map computed but never enforced (invisible-behaviors 7) | Carried as-is, recorded honestly; runtime enforcement would be a new product decision, out of scope (chapter 09 section on license facts) |
| Orphaned `running` jobs after a crash (invisible-behaviors 14) | PROPOSED P-10: minimal persistent job registry with boot-time orphan sweep (chapter 05) |
| Unbounded growth across stores (invisible-behaviors 22; data-inventory C12) | PROPOSED P-09 retention table, with the founder's keep-forever call on automation runs preserved (chapter 04 section on retention) |
| Silent chat-history truncation caps (invisible-behaviors 10) | Caps carried explicitly as retention rules (chapter 04, `session_contexts` row) |
| Cloud-restore source accepted by validation but non-functional (data-inventory C10) | Not specified as working; excluded from the v1 surface (chapter 04) |
| Old protocol schema carries WebSocket-era variants (carryover-audit 6) | The old schema is not ported; the contract is derived from actual consumers (chapter 03; FIXED-9) |
| Naming collisions: three "sessions" stores, two migration modules (data-inventory C6) | Resolved by the chapter 04 store map (one sessions domain; distinct module names) |
| Dead Supabase tables and license-key format drift (data-inventory C7) | PROPOSED P-08 keeps only the three live tables; dead schema dropped (chapter 04) |
| Dead modules: the anonymizer, the unused in-process command runner, an unused credential-delete helper (invisible-behaviors 15, 25; data-inventory C11) | Not carried; the carryover audit's verdicts are normative (chapter 02 build-from-reference list) |

**Recorded only (doc/code staleness or environmental facts with no decision to make):** the remaining conflict entries are corrections of stale comments, stale CLAUDE.md sections, phantom files, finder arithmetic, citation drift, and load-bearing environmental facts already restated where they matter (carryover-audit 2-5, 7-10; llm-usage-map 1-4, 6-8, 12, 14, 15 - number 7, the OAuth model-access asymmetry, is restated as a constraint in chapters 05 and 06; data-inventory C2, C3, C5, C8, C13, C15, C16; invisible-behaviors 1, 2, 11, 16-19, 23, 24; operations-inventory C4, C6; test-audit 1, 3-8; frontend-cleanup C-3 through C-7, C-9). They shaped the reference docs' accuracy and need no resolution here. One of them deserves a standing caution the new repo should inherit: documentation drifted from code in dozens of places in the old system; the rebuild's defense is FIXED-12 (diagrams updated in the same unit of work as structural change) plus chapter 13's review gates.

## 16.6 Acceptance criteria for this chapter

Checkable without a human, except where the check is itself the founder's sign-off:

1. Every question Q-01 through Q-10 carries: the question, why code alone cannot answer it, who answers, a recommendation or an explicit "none", a block-class flag, and what blocks on it.
2. Exactly two questions block run start (Q-01, Q-10); both now carry filled `Resolution:` lines as of 2026-07-06 - Q-01 resolved to the media-channel carve-out (FIXED-2 patched) and Q-10 resolved to gating the proxy - so gate G-P's run-start check is satisfied. Gate G-P (chapter 14) lists this register as its input and refuses launch while either lacks a filled `Resolution:` line.
3. Every deferrable question states a default the implementation run can execute with no founder input; every blocks-cutover question maps to a named chapter 10 criterion (Q-02 to criterion 6, Q-03 to criterion 9, Q-09 to the migration import step).
4. No PROPOSED item is restated here as a question; section 16.4 cross-references the blurry-line items to chapter 15.
5. Q-nn ids are unique across the whole spec (the chapter 08/09 collision is resolved: chapter 09's Graph proxy question is Q-10 everywhere).
6. Every Conflicts entry across the seven reference docs is accounted for: promoted to a question above, listed as decided-in-chapter with its home in 16.5, or classed as recorded-only in 16.5.
7. At spec freeze, every `Resolution:` line in this file is filled (SPEC.md status line: zero unresolved Open questions). All ten `Resolution:` lines are filled as of 2026-07-06. Q-02 and Q-03 are cutover-class: their `Resolution:` lines record that they are confirmed cutover-checklist actions answered at cutover (chapter 10 criteria 6 and 9), not at run start - the recorded launch-gate interpretation per this amendment, so a filled cutover-class resolution satisfies this criterion without pre-empting the cutover checklist.

*Amendment record: amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md). All ten Open questions carry filled Resolution lines; Q-01 and Q-10 (the two run-start blockers) are resolved, and Q-02/Q-03 are confirmed cutover-class.*

*End of chapter 16.*
