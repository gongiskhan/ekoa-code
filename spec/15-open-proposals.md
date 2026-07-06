# 15. Open proposals

This chapter is the founder review surface: every decision the spec makes that is not on the FIXED list, collated into one numbered register. Each entry carries the owning chapter, the recommendation, its rationale, at least one alternative, a blocking-for-launch or safely-deferrable flag, and what changes in the spec if the alternative is chosen. Zero PROPOSED items may remain unresolved when the implementation run launches (SPEC.md launch gate; chapter 14 gate G-P verifies this mechanically). This register is the canonical id space for P-nn: where an owning chapter's inline marker ever disagrees with this table, this table wins and the chapter is patched (section 15.4 records the reconciliations already performed).

## 15.1 How to resolve

1. **Founder marks each entry** with one of: **ACCEPT** (the recommendation becomes final), **ALTERNATIVE** (the named alternative becomes final), or **OTHER** (the founder writes the decision, which must be as concrete as the recommendation it replaces).
2. **The spec is patched in the same pass:** in the owning chapter, the `PROPOSED P-nn` marker becomes `RESOLVED (P-nn)` and the decided text is folded into the normative prose; every cross-reference occurrence of `PROPOSED P-nn` in other chapters flips to `RESOLVED (P-nn)` in the same pass; any diagram affected by the decision is updated in the same unit of work (FIXED-12). A `Resolved:` line is appended to the entry here.
3. **Deferrable items have a safe default:** any deferrable entry the founder does not mark by launch resolves to its recommendation automatically; gate G-P stamps that default into the register as the resolution. A defaulted resolution is still a resolution - the run starts with zero open decisions (chapter 14 section 14.1).
4. **Blocking items have no default:** gate G-P halts the run (chapter 14 section 14.2.4) if any of the nine blocking entries lacks a recorded resolution.
5. After resolution an item has FIXED status in effect: the implementation run treats resolved text as normative chapter text (chapter 14 precedence order, level 2), and revisiting it post-launch is a new founder decision, not a run-level choice.

## 15.2 Register summary

Nine blocking, eighteen deferrable - twenty-seven entries, all resolved. Twenty-six entries were resolved on 2026-07-06 by the founder resolutions of the first amendment (docs/ekoa-code-spec-amendment-brief.md), which also minted the deferrable P-27 (executor-face run-record retention). The consolidated-ledger amendment of the same date (Amendment 2, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md) then resolved P-27 and re-resolved P-08 and P-12, leaving zero pending entries; gate G-P stamps nothing.

| P | Title | Owner | Flag | Recommendation (one line) | Resolution |
|---|---|---|---|---|---|
| P-01 | HTTP framework | ch02 2.4 | **blocking** | Express 5 + zod validation middleware | ACCEPT |
| P-02 | Web deploy topology | ch02 2.5 | deferrable | Separate web and api containers behind one reverse proxy | defaulted |
| P-03 | Auth refresh + no revocation list | ch03 3.2, 3.8.1; ch09 9.6 | **blocking** | Explicit `POST /auth/refresh`; stateless JWTs, no revocation list in v1 | ALTERNATIVE |
| P-04 | Notifications channel scope | ch03 3.6.4 | deferrable | Exactly five events; drop `usage_progress` and `builder_text` | defaulted |
| P-05 | Platform domain stores to Firestore | ch04 4.3 | **blocking** | Migrate all JsonStore domains to Firestore collections | ACCEPT |
| P-06 | Event queue backend | ch04 4.4.3 | deferrable | Stays local SQLite WAL | defaulted |
| P-07 | Blob storage | ch04 4.4.4 | deferrable | Filesystem in v1, storage-relative keys from day one | defaulted |
| P-08 | Supabase control plane | ch04 4.5 | **blocking** | Keep Supabase, reduced to the 3 live tables | ACCEPT; re-resolved (Amendment 2): ALTERNATIVE - Supabase retired to Firestore |
| P-09 | Retention policy defaults | ch04 4.6 | deferrable | Named per-store retention constants + daily sweep | defaulted |
| P-10 | Persistent job registry + orphan sweep | ch05 5.2.1 | **blocking** | Persist jobs; boot sweep marks orphans failed; still no queue | ACCEPT |
| P-11 | Drop subagent/phase events | ch05 5.7.3 | deferrable | Neither event in the v1 wire contract; fold into `plan_step` | defaulted |
| P-12 | Memory system scope in v1 | ch05 5.8 | **blocking** | CRUD + resolver injection on; auto-extract off by default | ACCEPT; re-resolved (Amendment 2): auto-extract ON as billable user_work |
| P-13 | Usage push vs poll | ch03 3.6.4 | deferrable | Keep `usage_updated` on the notifications channel | defaulted |
| P-14 | KMS for the encryption key | ch04 4.7; ch09 inv. 6 | deferrable | Single mandatory env key in v1; KMS later behind the key-resolution seam | defaulted |
| P-15 | Automation file-op confinement | ch09 inv. 10 | **blocking** | Jail `file.read`/`file.write` to the owner sandbox | ACCEPT |
| P-16 | New repository name | ch02 2.2 (this register, 15.4) | deferrable | Founder names the repo at launch; spec is name-agnostic | OTHER: ekoa-code |
| P-17 | Workspace tooling | ch02 2.3 | deferrable | Plain npm workspaces, no build orchestrator | defaulted |
| P-18 | Agent-face event delivery channel | ch03 3.10 | **blocking** | TUI-only compatibility SSE channel at `GET /api/v1/events` | ACCEPT |
| P-19 | Billing of cancelled runs | ch06 6.9 | deferrable | One uniform rule: bill whatever the provider reported up to abort | defaulted |
| P-20 | Hard-limit launch posture | ch06 6.9 | deferrable | Hard-limit flag on at launch; founder flips it off for paid overage | defaulted |
| P-21 | Content distribution scope in v1 | ch08 8.3.3 | deferrable | Store + composition only; no remote registry client | defaulted |
| P-22 | Periodic audit cadence | ch13 13.8 | deferrable | Monthly full-product discovery pass + scoped post-release passes | defaulted |
| P-23 | Collections-engine hardening guards | ch04 4.2.4 | deferrable | Keep the reserved-prefix rejection and the item-size ceiling | defaulted |
| P-24 | Billing gate coverage widening | ch06 6.6.3 | deferrable | Pre-run allowance gate on every user_work entry, not just chat/build | defaulted |
| P-25 | Billing parity method | ch10 10.4 | **blocking** | Deterministic ledger replay + scripted parity workload | ACCEPT |
| P-26 | Cutover switch mechanism | ch10 10.6 | deferrable | Reverse-proxy upstream swap, not DNS | defaulted |
| P-27 | Executor-face run-record retention | ch17 17.10 | deferrable | Content-bearing run-record fields pass through the detector at persist time | RESOLVED (Amendment 2): detector-at-persist with irreversible redaction |

## 15.3 The register

### P-01 - HTTP framework: Express 5 (blocking)

- **Owner:** chapter 02 section 2.4.
- **Recommendation:** Express 5 with zod validation middleware at every route boundary, schemas from `shared/`.
- **Rationale:** the most conventional choice, maximally in-distribution for an unsupervised run; the carryover modules are already Express-shaped (SSE client manager, LLM gateway sub-app, the extracted router files that template every new router - reference/carryover-audit.md A2, A3, B12). Any other framework converts dozens of port-as-is verdicts into adapts.
- **Alternative:** Fastify (schema-first validation, faster). Rejected as recommendation for the carryover conversion cost and because the archived original backend was Fastify - re-adopting it invites confusion with reference material that must not be ported (FIXED-1).
- **If the alternative is chosen:** chapter 02 sections 2.4 and 2.6 are rewritten; the SSE manager, gateway sub-app, and router-template carryover verdicts flip to adapt; middleware specs (auth, billing gate, validation, error envelope) are re-expressed as Fastify plugins; chapter 14 gate G0 scaffolds differently.
- **Resolved:** ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-02 - Web deploy topology (deferrable)

- **Owner:** chapter 02 section 2.5.
- **Recommendation:** `web/` builds into its own container; `api/` its own; both behind the same reverse proxy, mirroring the current production split. Independent deploys and rollbacks; structurally reinforces FIXED-10.
- **Alternative:** the API serves the built web bundle from one container - simpler ops, but coupled release cadence and a standing temptation to special-case the bundled client.
- **If the alternative is chosen:** chapter 02 section 2.5 flips to Option B; chapter 10's proxy swap (P-26) becomes a single-upstream swap; a standing review rule against client special-casing is added to the new repo CLAUDE.md.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-03 - Explicit auth refresh; no revocation list in v1 (blocking)

- **Owner:** chapter 03 sections 3.2 and 3.8.1; security tradeoff restated in chapter 09 section 9.6.
- **Recommendation:** `GET /auth/me` returns identity only, never a token; `POST /auth/refresh` mints a fresh token and absorbs the role-drift self-heal. Logout stays a client-side token discard: stateless JWTs with the existing expiries (24 h, 30 d with rememberMe) and no server-side revocation list.
- **Rationale:** the current refresh-by-identity-call piggyback is a landmine (reference/operations-inventory.md section 25, landmine 5); a revocation list adds a store read to every request for a threat partially mitigated by short default expiry and forced password change. Single-tenant install with a small trusted user set.
- **Alternative:** a server-side revocation list checked in the auth middleware - enables admin "log out user X", costs one indexed read per request and a new store. The residual risk under the recommendation is stated plainly in chapter 09: a leaked 30-day token cannot be killed server-side.
- **If the alternative is chosen:** chapter 03 gains a logout endpoint; chapter 04 section 4.3.1 gains a revoked-tokens collection; the auth middleware gains a per-request check (the middleware isolates the point, so no route changes); chapter 09 section 9.6's accepted-risk paragraph is deleted.
- **Resolved:** ALTERNATIVE (server-side revocation list, implemented as an in-memory set backed by a small persisted `revoked_tokens` collection, loaded at boot and checked in the auth middleware - O(1) in-memory, correct under FIXED-8's single process, surviving restart via the collection; the explicit `POST /auth/refresh` is kept and chapter 03 gains `POST /auth/logout`, which revokes the current token, with an admin variant that revokes another user's tokens; chapter 04 section 4.3.1 gains the `revoked_tokens` collection, row keyed by token jti/hash with userId and expiry for self-pruning; chapter 09 section 9.6's accepted-risk paragraph is deleted and replaced by the revocation-list spec), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-04 - Notifications channel scope (deferrable)

- **Owner:** chapter 03 section 3.6.4.
- **Recommendation:** exactly five events (`build_intent`, `chat_answer`, `integration_build_intent`, `integration_ready`, `usage_updated`). The cosmetic in-flight token ticker (`usage_progress`) and the integration-builder prose stream (`builder_text`, correlation broken by design today - reference/frontend-cleanup-audit.md FC-035) are dropped.
- **Rationale:** the builder works without streaming; the ticker is cosmetic and degradable (reference/operations-inventory.md section 0.3). Accepted visible consequences are named in chapter 12 (FC-033 gauge updates on completion; FC-035 builder busy state).
- **Alternative:** add a run-correlated `integration_builder_text` event keyed by `builderSessionId`.
- **If the alternative is chosen:** the `shared/events.ts` notification union gains one member; chapter 12 FC-035 flips from busy-state to streaming consumption. Purely additive later; nothing else moves.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-05 - Platform domain stores move to Firestore (blocking)

- **Owner:** chapter 04 section 4.3.
- **Recommendation:** every platform domain store (users, sessions, artifacts, memories, billing ledger, automations, triggers, integration configs, ...) moves from JsonStore JSON files to Firestore collections on the same cluster, driver, and database as app-data. Dev and tests run vanilla MongoDB (`mongodb-memory-server`).
- **Rationale:** kills the worst write-amplification hotspot (the token-events ledger rewrites a whole file per event); unifies the backup story; replaces whole-file atomic-rename concurrency with real single-document atomic primitives (reference/data-inventory.md sections 5.1, 3.2).
- **Alternative:** keep JsonStore - sound under the single-process FIXED-8, but carries the hotspot, the split path conventions (conflict C4), and a second persistence idiom forever.
- **If the alternative is chosen:** chapter 04 sections 4.3 and 4.8 are rewritten around JsonStore; chapter 10 section 10.2 row 2 becomes a file copy instead of import scripts; the `data/` module reshapes; retention sweeps (P-09) become file rewrites; the deliberate exceptions in 4.4 stand either way.
- **Resolved:** ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-06 - Event queue stays SQLite (deferrable)

- **Owner:** chapter 04 section 4.4.3.
- **Recommendation:** the webhook/listener event queue stays a local SQLite WAL database, carrying its proven semantics wholesale (`UNIQUE(trigger_id, dedup_key)` idempotency, atomic claim, the retry ladder, dead-letter, boot recovery).
- **Rationale:** the semantics are a precise fit and already proven (reference/data-inventory.md section 6.1); raw webhook BLOBs can exceed document-size limits, making a naive Firestore port actively worse; single-process is FIXED-8.
- **Alternative:** Cloud Tasks or Pub/Sub plus a Firestore state collection - managed durability at the cost of redesigning claim/retry/dedup and adding a cloud dependency to local dev.
- **If the alternative is chosen:** the `events/` queue internals are redesigned and re-proven; chapter 04 section 4.4.3 and chapter 10 section 10.2 row 7 are rewritten; the API surface does not move (the queue is encapsulated).
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-07 - Blobs stay on the filesystem (deferrable)

- **Owner:** chapter 04 section 4.4.4.
- **Recommendation:** blob bytes (app files, screenshots, PDFs, brand assets, knowledge raw uploads, snapshot dumps) stay filesystem in v1; every blob reference becomes a storage-relative key resolved by one blob-path module, so a later GCS move is a driver swap, not a data migration.
- **Rationale:** nothing currently demands off-volume blob storage; the nightly GCS DR export covers disaster recovery in the interim (reference/data-inventory.md section 3.6).
- **Alternative:** move blobs to GCS now - immediate off-volume durability, at the cost of signed-URL serving work and a cloud dependency in dev.
- **If the alternative is chosen:** the blob-path module becomes a GCS driver; the public static routes (screenshots, PDFs - chapter 03 section 3.8.23) change serving mechanics; dev needs a bucket or emulator; chapter 10 row 4 becomes an upload instead of a copy.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-08 - Supabase control plane stays (blocking)

- **Owner:** chapter 04 section 4.5.
- **Recommendation:** Supabase remains the control plane, reduced to the three live tables (`standalone_credentials`, `companies`, `installations`); the nine dead tables are dropped post-cutover. All eight load-bearing OAuth rotation semantics reproduced exactly.
- **Rationale:** it works, it is isolated (raw PostgREST fetch, no SDK), and the OAuth custody semantics are subtle and load-bearing - each encodes a production incident (reference/data-inventory.md section 4.2). Moving them during a rebuild adds risk for no product gain.
- **Alternative:** fold the three tables into Firestore - one less external system, but the rotation semantics must be re-proven and the license plane loses independence from the product data plane.
- **If the alternative is chosen:** chapter 04 section 4.5 is re-specified over Firestore including a credentials-row migration; boot gates (chapter 09 section 9.7) re-point; chapter 10's installation-row coexistence mechanics (section 10.1) are redesigned.
- **Resolved:** ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).
- **Re-resolved:** the previously rejected alternative is now executed - the three live tables fold into Firestore (credentials encrypted via the one crypto module; `companies` superseded by the org model of Amendment 2; installation and license facts fold into the activation model), and Supabase is retired entirely. Chapter 04 section 4.5 is rewritten over Firestore, chapter 09 section 9.7's boot gates re-point at Firestore, and chapter 10 gains the credentials/installation migration rows and drops the Supabase coexistence mechanics. founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md).

### P-09 - Retention policy defaults (deferrable)

- **Owner:** chapter 04 section 4.6 (the whole table is PROPOSED row by row).
- **Recommendation:** named config constants per store, enforced by a daily in-process sweep: token events 13 months + permanent monthly rollups; activity logs 12 months; automation run documents kept forever (explicit founder decision carried) with screenshots pruned at 180 days; completed jobs 90 days; webhook audit 90 days; messages untouched; snapshot tiers as stated.
- **Rationale:** several stores grow forever today (reference/data-inventory.md section 10.9); the token ledger and screenshots have measurable unbounded cost. Values are constants the founder can override before launch without code changes.
- **Alternative:** no retention anywhere (status quo).
- **If the alternative is chosen:** section 4.6 and its sweep are deleted; unbounded growth of ledger, logs, and screenshots is accepted and monitored manually.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-10 - Persistent job registry with orphan sweep (blocking)

- **Owner:** chapter 05 section 5.2.1.
- **Recommendation:** build and brand-research jobs persist to the `jobs` collection at creation and on every status change; a boot sweep marks every non-terminal job and automation run `failed { code: 'ORPHANED' }` and resets associated artifacts to draft. Chat runs stay ephemeral by design. Still no distributed queue (FIXED-8).
- **Rationale:** crash-orphaned `running` jobs are the single biggest operational defect the reference audit names in this area (reference/invisible-behaviors.md section 7.6).
- **Alternative:** status quo - per-file job records, no boot sweep; a restart orphans running jobs forever.
- **If the alternative is chosen:** the `jobs` collection shape and boot sequence in chapters 04 and 05 simplify; the orphan-sweep tests are removed; the defect is carried as known and documented.
- **Resolved:** ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-11 - Drop subagent_event; fold phase events (deferrable)

- **Owner:** chapter 05 section 5.7.3 (wire consequences in chapter 03 section 3.6.5; client consequences in chapter 12 FC-027/FC-030/FC-032).
- **Recommendation:** neither `subagent_event` nor `phase_changed` appears in the v1 wire contract - both are dead on the wire today (emitted, never registered client-side). Sub-task notifications still reset the inactivity timer internally; phase information folds into `plan_step` and the session resource.
- **Rationale:** carrying dead wire surface into a typed contract manufactures obligations no client has ever met. Adding events later is purely additive.
- **Alternative:** register both as typed events and build the client consumption that never existed.
- **If the alternative is chosen:** `shared/events.ts` gains the two members; chapter 12's three delete rows become build rows; Open question Q-04 resolves as "register" on both sides.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md). (Q-04 resolved "delete on both sides", executing this drop branch.)

### P-12 - Memory system scope in v1 (blocking)

- **Owner:** chapter 05 section 5.8 (surface scope noted in chapter 03 section 3.8.19).
- **Recommendation:** memory CRUD and resolver injection ship on; automatic post-turn extraction ships **off by default** behind a config flag; consolidation becomes deterministic code. The privacy-scrub patterns and pipeline shape are preserved behind the flag, not deleted.
- **Rationale:** auto-extraction is an ambient model call riding every turn that is not user-requested work; its recorded fate is "dropped from the platform baseline" (reference/llm-usage-map.md section 7, call 23). If learning returns, it returns as an explicit user-invoked action - billable user work.
- **Alternative:** carry auto-extract on by default (status quo).
- **If the alternative is chosen:** the flag default flips, and chapter 06 must be reworked: row 23 of the disposition table re-fates the call (either billed user_work or a sanctioned ambient class), and the zero-platform-calls launch posture (chapter 06 section 6.3 rule 3, section 6.4.3 acceptance) is weakened accordingly. This is the only deferrable-looking entry whose alternative ripples into a FIXED-adjacent posture, which is why it is blocking.
- **Resolved:** ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).
- **Re-resolved:** the previously rejected alternative is now executed, refined - automatic post-turn extraction ships ON, asynchronous post-run so it never adds turn latency, FAST/Haiku-class and batched once per run, correctly attributed as billable `user_work` (agentType `memory-extract`, billee the run's user), so the zero-platform-calls posture of chapter 06 stands untouched (call 23 re-fated to billable `user_work`). It runs on hosted agent runs only; delegated local work is mined solely from derived output already in the hosted record (invariant I2 preserved). Privacy-scrub patterns are kept and consolidation stays deterministic code. It is a per-user setting, default ON; every automatic write is `visibility: 'private'` (sharedness is never inferred) and visible as a Registo entry plus a UI affordance. Chapter 05 section 5.8 and chapter 06 call 23 are re-fated accordingly. founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md).

### P-13 - Usage push vs poll (deferrable)

- **Owner:** chapter 03 section 3.6.4 (metering side in chapter 06 section 6.7).
- **Recommendation:** keep `usage_updated` on the notifications channel - a bare poke, client refetches `GET /billing/usage`. Cheap, already consumed by the header gauge.
- **Alternative:** drop the event; the gauge polls on an interval.
- **If the alternative is chosen:** the notification union shrinks by one; the injected usage-notifier seam (chapter 02 section 2.8 seam 1, chapter 06 section 6.7) is removed; the client gains a polling interval.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-14 - Defer KMS for the encryption key (deferrable)

- **Owner:** chapter 04 section 4.7; restated in chapter 09 invariant 6.
- **Recommendation:** v1 keeps a single env-provided `ENCRYPTION_KEY`, now mandatory in every environment with no default constant anywhere; key resolution is isolated behind one function so envelope encryption lands later without touching call sites.
- **Rationale:** the threat model (single-tenant process, encrypted volume) does not yet demand KMS; the mandatory-key change already removes the real exposure (the insecure default constant).
- **Alternative:** GCP KMS envelope encryption from day one - stronger custody, but a cloud dependency at boot and in local dev.
- **If the alternative is chosen:** the crypto module's key resolution calls KMS; chapter 09 section 9.7 gains a KMS-reachability boot gate; dev needs credentials or an emulated key path.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-15 - Confinement of the automation file operations (blocking)

- **Owner:** chapter 09 invariant 10.
- **Recommendation:** jail the automation vocabulary's `file.read`/`file.write` to the owner's sandbox via the same symlink-hardened safe-path helper as artifact files: relative paths resolve against the sandbox root, absolute paths outside it fail with uniform not-found. Today these operations read and write arbitrary filesystem paths (verified; reference/data-inventory.md section 7.5); porting that silently is explicitly forbidden.
- **Alternative:** drop `file.read`/`file.write` from the vocabulary entirely; automations use the collections engine for state (FIXED-5). Cleaner, but breaks existing manifests that use them and removes a legitimately useful local-file capability.
- **If the alternative is chosen:** the two operations are removed from the automation step vocabulary; existing manifests using them must be migrated at cutover (a new chapter 10 checklist item); chapter 09's P-15 paragraph is replaced by a removal note.
- **Resolved:** ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-16 - New repository name (deferrable)

- **Owner:** chapter 02 by subject matter; presented only here (see 15.4 - the id was minted during spec drafting but no chapter carried it, a collation finding, not a decision gap).
- **Recommendation:** the founder names the repository at launch. The spec is deliberately name-agnostic: no chapter binds to a repo name, so nothing needs patching whatever the choice.
- **Alternative:** the implementation run scaffolds under a placeholder name and the founder renames later (Git hosting renames redirect).
- **If the alternative is chosen:** nothing structural changes; purely cosmetic.
- **Resolved:** OTHER (the repository is named ekoa-code, a sibling folder of ekoa-dev; the spec stays name-agnostic and binds this value only where the name aids clarity - chapter 02 section 2.2 carries the canonical statement), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-17 - Workspace tooling (deferrable)

- **Owner:** chapter 02 section 2.3.
- **Recommendation:** plain npm workspaces at the repo root with `api/`, `web/`, `shared/` as the three workspaces. No turbo, no nx, no lerna (FIXED-1 forbids monorepo tooling; npm workspaces is a stock npm feature used only so the apps can depend on `shared/` by name).
- **Alternative:** no workspaces; `file:../shared` dependencies or relative TypeScript project references - works, but makes editor tooling and CI installs fiddlier for no gain.
- **If the alternative is chosen:** chapter 02 section 2.3 flips; project references and CI install steps are re-wired; boundary rules are unaffected.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-18 - Agent-face event delivery channel (blocking)

- **Owner:** chapter 03 section 3.10.
- **Recommendation:** port a compatibility SSE channel at `GET /api/v1/events?token=` serving **only** agent-face/TUI traffic, leaving ekoa-local untouched. The web client never uses it; chapter 03 acceptance criterion 4 scopes it TUI-only.
- **Rationale:** the consumer is ekoa-local, whose client code FIXED-1 declares out of scope; the TUI must stream results at cutover.
- **Alternative:** migrate ekoa-local to per-run streams (`GET /api/v1/agent-face/runs/:id/events`) and delete the legacy endpoint - cleaner, but requires coordinated ekoa-local changes.
- **If the alternative is chosen:** chapter 03 section 3.10 is rewritten around per-run streams; ekoa-local client work becomes in-scope, which contradicts FIXED-1's out-of-scope declaration - the founder must explicitly relax that scope for this one change (that contradiction is why this entry is blocking and cannot default).
- **Resolved:** ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-19 - Billing of cancelled runs (deferrable)

- **Owner:** chapter 06 section 6.9.
- **Recommendation:** one uniform rule at the single metering point - every call bills the usage the provider actually reported up to the abort; if nothing was reported, nothing is billed. Today cancelled agent-face runs are deliberately unbilled while other cancelled runs bill what the adapter recorded (reference/llm-usage-map.md section 8, points 2 and 5).
- **Rationale:** tokens were consumed; a special-case skip re-creates a second metering policy inside the agent-face fold-in (chapter 06 section 6.5.5).
- **Alternative:** carry the agent-face skip as a special case for exact behavioral parity.
- **If the alternative is chosen:** the chokepoint metering gains one run-class special case; either way the chapter 10 parity check whitelists this known difference.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-20 - Hard-limit launch posture (deferrable)

- **Owner:** chapter 06 section 6.9.
- **Recommendation:** carry the hard-limit flag as config, default **on** at launch - exact behavior parity, no accidental spend during cutover. The founder flips it off when paid overage goes live, at which point credits and overage switches become functional exactly per chapter 06 section 6.6.2.
- **Alternative:** default off from day one so purchased credits work immediately.
- **If the alternative is chosen:** one config default flips; the cutover billing-parity check must whitelist overage-spend differences between the stacks.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-21 - Content distribution scope in v1 (deferrable)

- **Owner:** chapter 08 section 8.3.3 (renumbered from that chapter's original inline P-19 - see 15.4).
- **Recommendation:** v1 ships the content-addressed store and composition mechanics with no remote registry client. Package sources are exactly: repo-bundled baseline, runtime-authored integration definitions, and manual fitting import. APM-style registry distribution is a post-launch additive step (a fetch in front of `importPackage`).
- **Rationale:** there is no registry endpoint to verify from this repo, the fittings inventory itself is an open question (Q-06), and an unverifiable network dependency inside an unsupervised build run is needless risk.
- **Alternative:** build the remote registry client in v1.
- **If the alternative is chosen:** `content/` gains a registry fetch step and endpoint configuration; the loader's v1 contract is otherwise identical.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-22 - Periodic audit cadence (deferrable)

- **Owner:** chapter 13 section 13.8 (renumbered from that chapter's original inline P-19 - see 15.4).
- **Recommendation:** one full-product vision-discovery pass per month plus a scoped pass after any release adding user-visible surface; each pass ends with a suite-adjustment PR (possibly empty, stating so). The layer itself is day-one process; only the cadence is proposed.
- **Alternative:** audit only on demand before major releases - cheaper, but coverage drift is exactly the failure mode this layer catches, and unscheduled processes decay.
- **If the alternative is chosen:** the scheduled CI job is removed; section 13.8's cadence text is replaced with the on-demand trigger list.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-23 - Collections-engine hardening guards (deferrable)

- **Owner:** chapter 04 section 4.2.4, rules 2 and 3, which carry the inline `RESOLVED (P-23)` marker (flipped from PROPOSED on resolution) and present the same recommendation, alternative, and flag. Originally caught as decided prose by the silent-decision cross-check (see 15.5); chapter 04 was patched in the same unit of work as this register.
- **Recommendation:** keep both new guards on the otherwise byte-compatible served-app data plane: (a) reject client writes to reserved-prefix collection names (`__`, `usr.`) with 403; (b) enforce a per-collection serialized item size ceiling (default 256 KiB) with 413.
- **Rationale:** (a) closes public-plane access to platform-managed collections (`__files` metadata); (b) protects against backend document-size limit crashes. Safety argument recorded in chapter 04: no known served app writes reserved collections directly, and the 37-spec legal suite plus the featured apps are the compatibility gate - if the guards broke anything real, cutover criterion 1 (chapter 10) would catch it.
- **Alternative:** strict byte-compatibility - no new rejection classes; oversized writes surface as raw driver errors and reserved collections stay reachable, exactly as today.
- **If the alternative is chosen:** chapter 04 section 4.2.4 rules 2-3 are deleted along with their error codes and tests; nothing else moves.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-24 - Billing gate coverage widening (deferrable)

- **Owner:** chapter 06 section 6.6.3, where it is presented inline, now marked `RESOLVED (P-24)`. The pre-run-only gate semantics are carried behavior; the coverage widening is the proposal. (Originally presented there under a "FIXED posture" heading; promoted by collation - see 15.5 - and the chapter has since been patched to present it inline.)
- **Recommendation:** run the pre-run allowance gate at every user_work entry (chat, build, integration-builder, brand research, automation runs including trigger-initiated, agent-face, served-app assistant, artifact-backend model capability, gateway calls). Today only chat turns and build jobs are gated, while the most expensive calls in the system (EXPERT effort-max vision and planning) run ungated (reference/invisible-behaviors.md section 12.7).
- **Rationale:** an allowance system that skips the most expensive entries is not an allowance system; gate semantics stay carried (pre-run only, no mid-run kill).
- **Alternative:** exact behavior parity - gate only chat and build for cutover, widen afterwards. Simplifies the parity comparison marginally; carries the ungated-cost exposure.
- **If the alternative is chosen:** the section 6.6.3 table shrinks to two rows; the remaining rows return as a post-cutover change; metering (and therefore P-25 parity) is unaffected either way, since the gate is admission, not accounting.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-25 - Billing parity method (blocking)

- **Owner:** chapter 10 section 10.4.
- **Recommendation:** two complementary checks instead of live-traffic mirroring: (A) deterministic ledger replay - a full closed billing period's raw events re-computed through the new billing math must match old per-user totals exactly; (B) a fixed scripted workload run once against each stack - structural assertions exact (one ledger event per model call, correct attribution, zero platform-attributed calls), totals banded at plus/minus 25% only to catch gross wiring errors.
- **Rationale:** replaying agent prompts is nondeterministic in token counts, doubles Anthropic spend, and duplicates side effects; A proves the arithmetic with zero model calls, B proves the wiring.
- **Alternative:** shadow-mirror live production traffic and compare ledgers - all cost (double spend, a side-effect quarantine layer needing its own verification), no additional assurance.
- **If the alternative is chosen:** chapter 10 section 10.4 is rewritten around a mirroring layer; chapter 14 gate G10's deliverables change from replay harness + workload to mirror + quarantine tooling; the cutover window plan re-budgets.
- **Resolved:** ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-26 - Cutover switch mechanism (deferrable)

- **Owner:** chapter 10 section 10.6.
- **Recommendation:** switch at the reverse proxy - an upstream swap for `api.` and `app.`, rollback being the same swap reversed, effective in seconds. Both stacks already sit behind the existing proxy.
- **Alternative:** DNS record change to new hosts - simpler if the new stack lives elsewhere, but rollback is TTL-bound and client-cached.
- **If the alternative is chosen:** chapter 10 section 10.6's procedure steps and the rollback plan (10.7) are re-expressed for DNS; the staging hostname pair becomes the future production pair; the 30-day rollback window mechanics account for DNS caching.
- **Resolved:** defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### P-27 - Executor-face run-record retention (deferrable)

Minted 2026-07-06 by the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md, Part 3) and resolved the same day by the consolidated-ledger amendment (Amendment 2). It is deferrable with a safe default; its owning-chapter marker (chapter 17 section 17.10) now reads `RESOLVED (P-27)`, so no live PROPOSED marker remains anywhere in the spec.

- **Owner:** chapter 17 section 17.10 (inline presentation there; this is the register entry of record).
- **Recommendation:** content-bearing executor-face run-record fields - file reads and command output captured inside automation runs - pass through the anonymisation detector at persist time, reusing the same service the egress module runs (chapter 17). Run records then never become the quiet at-rest cleartext copy that would violate the spirit of invariant I1 for file-heavy automations.
- **Rationale:** run records must not become the quiet at-rest copy of content the anonymisation layer scrubs on egress (the Ekoa Local v2 brief, docs/, A5); a file-heavy automation would otherwise accumulate unmasked client material in its persisted run history, defeating the layer for everything the automation touched.
- **Alternative:** mark the content-bearing fields ephemeral with a short TTL, pruned by the retention sweep (chapter 04 section 4.6) rather than tokenized at persist.
- **If the alternative is chosen:** chapter 17 section 17.10's persist-time detector hook is replaced by a TTL marker on those fields plus a retention-sweep rule in chapter 04 section 4.6; the anonymisation service is not invoked on the run-record write path.
- **Resolved:** RESOLVED (Amendment 2) - detector-at-persist with irreversible redaction of detected spans, never session tokens (the vault is ephemeral; tokens at rest are permanent noise). The founder took the recommendation, not the TTL alternative; the chapter 17 section 17.10 hook is the persist-time detector with irreversible redaction. founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md).

## 15.4 Numbering reconciliation

This register is the canonical P-nn id space. Two reconciliations were performed during collation:

1. **Three chapters independently minted "P-19".** Chapter 06 (billing of cancelled runs), chapter 08 (content distribution scope), and chapter 13 (periodic audit cadence) each presented an inline item numbered P-19. Canonical assignment: **P-19 stays with chapter 06** (first in chapter order); chapter 08's item is **P-21** and chapter 13's item is **P-22**. Chapters 08 and 13 have been patched in the same unit of work as this register, so no chapter now contradicts this table. No other chapter referenced the colliding ids across chapter boundaries at reconciliation time (verified by grep census); chapter 05's later cross-references to P-19 (sections 5.6.5 and 5.9.2) point at the canonical chapter 06 item and present nothing.
2. **P-16 (repository name)** was minted during spec drafting, before the chapters were written, but presented in no chapter. It is cosmetic and name-agnostic by construction; entry P-16 above is its presentation of record. No chapter patch is needed.

A related id collision arose in the Open-questions space and is recorded here because the founder reads both registers: chapter 08 minted Q-09 (fate of the `legal-shared`/`legal-spine` content directories) and chapter 09 provisionally minted a colliding Q-09 for the workspace Graph proxy (`/api/m365/*`), delegating the final id to chapter 16's collation. Resolved there: **Q-09 stays with chapter 08** (legal content packages) and **chapter 09's Graph proxy question is Q-10**. The resolution is patched in both places - chapter 09 section 9.4 records the renumbering inline where the question is presented, and chapter 16 section 16.1 records Q-10 as final - so Q-nn ids are unique across the spec (chapter 16 acceptance criterion 5).

## 15.5 Silent-decision cross-check

Method: every chapter 02-14 was read end to end; every decision was checked for either an inline FIXED-n citation or presence in this register. Per the spec's ground rules, a decision that is neither is a defect. Findings:

| Finding | Disposition |
|---|---|
| Chapter 04 section 4.2.4: two new hardening guards on the byte-compatible data plane, presented as decided prose ("the one deliberate hardening") without a PROPOSED marker | Promoted to **P-23**; chapter 04 section 4.2.4 patched with an inline P-23 presentation (PROPOSED at the time, since resolved) with its recommendation, alternative, and deferrable flag, in the same unit of work |
| Chapter 06 section 6.6.3: billing-gate coverage widened from two entries to all nine, originally presented under a "FIXED posture" heading although the widening is new | Promoted to **P-24**; chapter 06 has since been patched in the same unit of work to drop the FIXED label and present the widening inline as P-24 (PROPOSED at the time, since resolved) |
| Chapter 12 section 12.5: a 12-row inline decision register (client error style, no auto-retries, descriptor maps in `shared/`, redirect-stub deletion, and peers) explicitly declaring "none is PROPOSED" | Accepted as decided, not registered: each row cites FIXED-9 behavior-preserving cleanup or an existing register id; the three accepted visible changes (FC-013, FC-033, FC-035) trace to FIXED-9's explicit shape-change mandate and to P-04/P-13 outcomes. The founder can scan that table directly at chapter 12 section 12.5 |
| Chapter 09: log-redaction middleware for `?token=` query values ("new, this chapter") and bcrypt cost unification to 12 | Accepted as decided: additive security controls inside chapter 09's invariant mandate, strictly risk-reducing, no product-visible alternative worth a founder cycle. Listed here for transparency |
| Chapter 03 section 3.4 conventions (pagination normalization, ISO-8601 timestamps, opaque `uploadId` replacing absolute paths, explicit `language` field); chapter 05 named config constants; chapter 06 typed abort rejection and no-default-model | Accepted as decided: each cites FIXED-9 shape-change mandate or a recorded reference-doc conflict it fixes (reference/llm-usage-map.md conflicts 11, 13) |
| Chapter 04 design rules: single-document atomicity only; no unique indexes (deterministic-`_id` inserts) | Accepted as decided: consequences of recorded environmental constraints (least-privilege runtime user, unverified transaction GA - reference/data-inventory.md sections 3.2, 3.4; Q-03) |
| Chapter 14 phase ordering | Explicitly a recommendation the run's planning phase may reorder within the hard constraints of 14.3; not a register item by design |

No other undeclared decisions were found. Chapters 02-14 otherwise mark every load-bearing choice FIXED-n, P-nn, or Q-nn.

## 15.6 Acceptance criteria (checkable without a human)

1. **Census match, both directions:** every `RESOLVED (P-nn)` marker across chapters 02-18 - including chapter 17 section 17.10's `RESOLVED (P-27)`, re-marked from its former proposed marker by Amendment 2 - names an id present in this register; every register entry names an owning chapter section that exists and presents the same recommendation and flag - with exactly one register-alone exception carved out in criterion 2 (P-16, which has no owning chapter marker). (Grep census over `spec/*.md`; the census scope now spans chapters 02-18 because the amendment added chapters 17 and 18.)
2. **One owner per id:** every P-nn has exactly one owning chapter that presents the full entry inline - marker, recommendation, alternative, and flag - at the section the register table names. Every other occurrence of that id across the spec is a cross-reference or an explicitly labelled restatement, never a second free-standing presentation: it names the owning chapter within the same sentence, list item, or table row (e.g. chapter 09 section 9.6 restates P-03 and names chapter 03 as owner; chapter 01's overview cites P-05 alongside chapter 04). P-16 is the single register-alone exception: no chapter carries a marker, and this register is its presentation of record (section 15.4 states why). P-27's owner is chapter 17 section 17.10, whose marker now reads `RESOLVED (P-27)` after Amendment 2; every owning-chapter marker now reads `RESOLVED (P-nn)` and no live PROPOSED marker remains anywhere in the spec. Spot greps: an inline P-19 marker outside chapter 06 and this chapter returns nothing (chapter 05 sections 5.6.5 and 5.9.2 cross-reference P-19 by id without presenting it - they defer to the chapter 06 item); `P-21` appears only in chapter 08 and here; `P-22` only in chapter 13 and here; `P-23` only in chapter 04 section 4.2.4 and here; `P-24` only in chapter 06 and here (one presentation at section 6.6.3; chapter 06's other P-24 lines, in sections 6.9 and 6.11, are pointers to it, not second presentations); `P-27` appears only in chapter 17 section 17.10 and here.
3. **Entry completeness:** all 27 entries carry owner, flag, recommendation, rationale, at least one alternative, and an alternative-consequence line (mechanically checkable against the entry template).
4. **Blocking census:** exactly 9 entries were flagged blocking (P-01, P-03, P-05, P-08, P-10, P-12, P-15, P-18, P-25), and the nine blocking entries are all resolved as of 2026-07-06; chapter 14 gate G-P consumes exactly this list. Neither amendment adds a blocking entry (P-27 is deferrable), and Amendment 2's re-resolution of P-08 and P-12 leaves both blocking and resolved, so the blocking census is unchanged.
5. **Launch gate:** every entry's Resolution column reads a recorded decision (ACCEPT, ALTERNATIVE, OTHER, or defaulted-to-recommendation for deferrable items) as of 2026-07-06, and Amendment 2 resolved the last pending entry (P-27), so zero entries read "pending" and gate G-P stamps nothing. G-P halts only if a blocking entry lacks a resolution (chapter 14 section 14.2.4); none does.
6. **Patch discipline:** for every resolved entry except P-16, the owning chapter's inline marker reads `RESOLVED (P-nn)` and the decided text is normative prose (P-16 resolves in this register alone - it has no chapter marker by construction, section 15.4); cross-reference occurrences in other chapters flip to `RESOLVED (P-nn)` in the same pass (15.1 step 2). A spec-wide grep for live PROPOSED markers now returns zero hits - the last one, P-27 in chapter 17 section 17.10, was resolved by Amendment 2, and every owning-chapter marker across chapters 02-18 reads `RESOLVED (P-nn)`.

*Amendment record: amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md). All 26 pre-amendment entries carry recorded resolutions; P-27 was minted by this amendment.*

*Amended again 2026-07-06 per the consolidated-ledger amendment (Amendment 2, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md): P-27 resolved to detector-at-persist with irreversible redaction; P-08 re-resolved to its ALTERNATIVE (Supabase retired to Firestore); P-12 re-resolved to auto-extract ON as billable user_work. All 27 entries now carry recorded resolutions, zero pending; the blocking census is unchanged (nine blocking, all resolved) and gate G-P stamps nothing.*

*End of chapter 15.*
