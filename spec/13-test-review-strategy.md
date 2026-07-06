# 13. Test and review strategy

This chapter defines the QA methodology for `api/` and `web/`: five layers, adopted as repo process from day one and written into the new repo CLAUDE.md alongside the diagram invariant (FIXED-12). It grounds the port plan in the numbers of reference/test-audit.md (read as ground truth throughout), assigns an owner layer to every coverage gap that document records, fixes the contract-test mechanism that exercises every `shared/` schema, sketches the CI wiring, and closes with the verbatim CLAUDE.md text. The unsupervised implementation run treats every rule here as process, not advice: a change that skips its layer is incomplete, exactly as a structural change without its diagram update is incomplete (FIXED-12).

## 13.1 The five layers

| # | Layer | Job | When it runs | Cost profile | Permanence |
|---|---|---|---|---|---|
| 1 | Baseline port | Port the surviving UI-level e2e tests first, as the safety net under everything else | Day one, before feature work on each area | Cheap (tests already exist) | Permanent |
| 2 | Discovery | Vision-based exploratory testing: an agent drives the real UI, screenshots are analyzed by a model; surfaces probable issues and edge cases | After each build phase (ch14) and on the recurring cadence of 13.8 | Expensive by design | Ephemeral: findings feed layer 3, the runs themselves are never regression |
| 3 | Regression | Deterministic tests written from findings: Playwright e2e, API contract tests validating responses against the `shared/` zod schemas, unit tests where logic warrants; covers happy paths and the discovered edge cases | Every PR in CI | Cheap per run | Permanent |
| 4 | Review loop | Opus code review, followed by adversarial Codex review on significant changes | Every PR (Opus); significant PRs (Codex, definition in 13.7) | Moderate | Permanent process |
| 5 | Periodic audit | Recurring vision-testing passes that re-exercise the product and adjust the e2e suite (add specs for new behavior, retire stale ones) | Scheduled (RESOLVED (P-22), 13.8) | Expensive by design | Permanent process, ephemeral runs |

Two boundary rules apply to layers 2 and 5. First, their model calls are development tooling, not product traffic: they run outside the `api/` process, on their own credentials, and never through the product LLM module - FIXED-3 governs the service, and QA tooling must not pollute the product's metering or use its managed OAuth custody. Second, a discovery finding is only closed in one of two ways: a deterministic layer-3 test that pins it, or a written dismissal with reason in the PR (or RUN_LOG during the build, ch14). Findings never close silently.

## 13.2 Layer 1: the Playwright port plan (55/57 survive)

The frontend Playwright suite is the real behavioral safety net and ports first. Per reference/test-audit.md §7: 55 of 57 specs survive, in three bands, because the harness has no central protocol fixture to break - survivability is decided per file by three small touchpoints (§2).

**Band 1 - 13 specs, zero changes (reference/test-audit.md §3.1, §3.5).** These run against the new stack as soon as the login page and the pages they visit exist; they are the first green light of the rebuild.

| Spec | Why zero changes |
|---|---|
| `ui-foundation` | Real login form, UI assertions only, explicit no-stubs policy |
| `shell-nav` | Pure UI navigation over the sidebar/header |
| `coherence-locale` | PT-PT default and EN toggle, no stubs |
| `pages-core` | Page rendering at desktop + 375px, zero console errors |
| `pages-flagship` | Artifacts page on the design system |
| `pages-manage` | Integrations / memory / users / branding surfaces |
| `integrations-sections` | Pure UI over page sections |
| `integrations-pipedream` | Card states + master-toggle persistence, no stubs |
| `integration-session-automations` | Provisioning flow, never clicks the real connect |
| `legal-knowledge` | Dashboard knowledge page (agents-first banner, browse) |
| `demos` | Drives tours via the public `GET /api/demos*` registry, kept verbatim (ch03 §3.8.23) |
| `legal-shared-drift` | Shells a sync-check script; ports with the featured-app source tree and its script (ch07) |
| `simuladores-trabalho` | Fully self-contained: own esbuild step, own local server; ports verbatim |

**Band 2 - 5 specs, fixture swap only (reference/test-audit.md §3.2, §2.2).** Each asserts in the UI but seeds/cleans through an inline helper that speaks the old generic command endpoint; the port replaces each helper body with the equivalent typed REST calls from the ch03 map. Assertions do not change.

| Spec | Old seeding touchpoint | New REST calls (ch03) |
|---|---|---|
| `onboarding` | Session delete/list helper; one test also stubs the old chat-request endpoint (test-audit conflict 3 - two swaps, not one) | `GET/DELETE /api/v1/sessions*`; stub `POST /api/v1/chat/runs` (§3.8.6, §3.8.7) |
| `vertical-profile` | Flips the vertical setting in beforeAll | `PATCH /api/v1/settings` (§3.8.5) |
| `artifacts-apps-section` | Bundle import + featured-instance mutation | `POST /api/v1/artifacts/import`, `PATCH /api/v1/artifacts/:id`, featured-update endpoints (§3.8.9) |
| `update-from-bundle` | Bundle import + cleanup | `POST /api/v1/artifacts/import`, `POST /api/v1/artifacts/:id/bundle-update`, `DELETE /api/v1/artifacts/:id` (§3.8.9) |
| `artifact-backend-panel` | Bundle-with-backend import | `POST /api/v1/artifacts/import` + backend status/logs endpoints (§3.8.9, §3.8.11) |

**Band 3 - 37 specs, conditional on the served-app contract (reference/test-audit.md §2.4, §3.4).** The 36 legal served-app specs plus `demo-spine` drive apps served at `/apps/{slug}/` with no frontend and no platform login, seeding through the injected `window.__ekoa` handle. They survive unchanged if and only if the served-app plane survives byte-compatibly - and ch03 §3.9 fixes exactly that (FIXED-5, FIXED-9: same paths, headers, cookies, response shapes, and context injection; ch04 §4.2.7 carries the data routes; ch07 carries serving and injection). Under this spec they therefore run without modification; conversely, they are the enforcement mechanism for that byte-compatibility promise, and chapter 10 makes them a cutover criterion. `legal-dossie` additionally stubs two `/api/app-sso/*` route shapes, which ch03 §3.9 also carries.

**The 2 that retire, and re-coverage (reference/test-audit.md §3.3).** `chat-fixes.spec.ts` and `chat-preview-resolution.spec.ts` fabricate old-protocol response envelopes on the wire and seed a versioned persisted frontend store; they are coupled to the retired envelope, the old operation names, and the store schema, and cannot be swapped at fixture level. Their behaviors are requirements and get re-covered twice:

1. The store-level halves survive as frontend unit tests and port with mock updates: `orchestration-queue-stop.test.ts` (queue/dequeue, Stop restores the composer) and `orchestration-hydrate-reconcile.test.ts` (the production 2026-06-16 wrong-artifact-in-preview regression) - reference/test-audit.md §4.
2. New layer-3 Playwright specs re-cover the e2e halves against the new backend: side-panel toggle, message queueing during a live run, Stop restoring the composer, and preview reconciliation. Technique fix: the new specs stub `POST /api/v1/chat/runs` and the run SSE stream with fixtures that are validated against the `shared/events.ts` unions by a test helper at authoring time - so, unlike the retired pair, the stubs cannot silently drift from the real contract. LLM-free stays a property of the per-PR suite.

**Frontend unit tests: 17/18 survive (reference/test-audit.md §4).** Three need mock-shape updates (`orchestration-hydrate-reconcile`, `data-backups-panel`, plus the queue-stop mocks); `artifacts-page-wiring.test.ts` retires and is rewritten as a static audit that the artifacts page calls only functions of the generated typed client (same cheap technique, new target).

Carried suite discipline: per-spec UI `login()` against the real form, the two port files as the only configuration, no-console-errors assertions where the current specs make them, `fullyParallel: false` with one worker (reference/test-audit.md §2.1). The new repo keeps all four.

## 13.3 Layer 1: the backend port plan

**The wire surface starts at zero and is seeded by one file (reference/test-audit.md §2.6, §5.1, §7).** The old backend's HTTP contract as actually served was exercised only by wire-coupled artifacts, all of which retire as written. The port order is therefore fixed: `tests/e2e/helpers/test-client.ts` is ported first - its login and request methods swapped for the ch03 REST surface, returning typed responses parsed with the `shared/` schemas - and the 14 node e2e drivers are re-seeded on top of it. Their assertions are about product outcomes, so they largely carry once the client swap is done. The chat driver keeps its SKIP-gate on `/health` model-credential status; the ~22 unregistered smoke scripts the audit scopes out (§5.1 scoping note) are not ported.

| Driver | Product outcome it pins | New surface exercised (ch03) |
|---|---|---|
| `app-auth` | Served-app end-user password/SSO sessions | `/api/app-sso/*` (§3.9) |
| `app-files-upload` | Binary upload/serve/delete round trip | `/api/app-files*` (§3.9) |
| `citius-integration` | CITIUS consultation path | `/api/citius/consulta` + integrations (§3.9, §3.8.13) |
| `erp-auth-ui` | Featured-app auth UI flow | served-app plane (§3.9) |
| `erp-crm-persistence` | App-data persistence through a served app | `/api/app-data/*` (§3.9) |
| `erp-kyc` | KYC flow | served-app plane (§3.9) |
| `erp-ops-persistence` | Ops app-data persistence | `/api/app-data/*` (§3.9) |
| `ifthenpay` | Payment integration vs committed mock server | integration proxy + triggers (§3.9, §3.8.17) |
| `invoicexpress` | Invoicing integration vs committed mock server | integration proxy (§3.9) |
| `pipedream` | Pipedream layer vs mock server | `/api/v1/pipedream*` (§3.8.16) |
| `integration-automation` | Integration-by-automation round trip | `/api/v1/automations*`, `/api/v1/integrations*` |
| `legal-research` | DGSI/DRE lookup | `/api/legal-research` (§3.9) |
| `onboarding` | Live one-turn chat, login to terminal event; SKIP-gated | `/api/v1/auth/login`, `/api/v1/chat/runs*` + SSE (§3.8.7, §3.6.1) |
| `whatsapp-inbound` | Webhook ingress to queue to delivery | `/hooks/:triggerId` (§3.8.17) |

**The 23 rule-set files rewrite as REST contract tests (reference/test-audit.md §5.2).** These files invoked the old backend's domain layer directly and pinned behavioral rules; the harness retires, the rules are requirements. Each is rewritten as a contract test against the corresponding ch03 endpoint group, running the real router stack in-process (13.5 mechanism), asserting the same rules at the HTTP boundary - strictly stronger than the old direct invocation, because auth middleware and validation now sit in the tested path. The full rewrite map (recorded in `api/tests/contract/README.md` per acceptance criterion 4):

| Old rule-set file (test-audit §5.2) | Rules it pins | Rewrite target (ch03) |
|---|---|---|
| `memory-handler` | Full memory CRUD, signals, stats, tags | `/api/v1/memories*` (§3.8.19) |
| `memory-consolidation` | Grouping/merge/cleanup rules (deterministic per ch06 fates) | memory service tests + `/api/v1/memories*` |
| `app-data-backups-handler` | Status/snapshot/restore/preview/download semantics | `/api/v1/artifacts/:id/backups*` (§3.8.10) |
| `auth-device` | Device-login lifecycle, single-use approval, pacing | `/api/v1/auth/device*` (§3.8.1) |
| `integrations-session-*` | Session-capture status/connect rules | `/api/v1/integrations/:key/session` (§3.8.13) |
| `settings-defaults` | Settings singleton defaults | `GET/PATCH /api/v1/settings` (§3.8.5) |
| `update-from-bundle-*` | Update-in-place vs force semantics, 409 on mismatch | `POST /api/v1/artifacts/:id/bundle-update` (§3.8.9) |
| `featured/featured-update` | Update-by-consent flow | `/api/v1/artifacts/:id/featured-update/*` (§3.8.9) |
| `featured/list-instances` | List shape contract | `GET /api/v1/artifacts` (§3.8.9) |
| `featured/seeder` | Seeder idempotency + orphan sweep | boot-path service test (seed routing, ch04 §4.2.8 item 7) |
| `featured/set-featured-authz` | Super-admin-only authorization | `PUT /api/v1/artifacts/:id/featured` (§3.8.9) |
| `automation/handler` | Automation CRUD + run rules | `/api/v1/automations*` (§3.8.18) |
| `artifact-backend/handler` | Backend lifecycle rules | `/api/v1/artifacts/:id/backend*` (§3.8.11) |
| `artifact-backend/delete-teardown` | Delete teardown + capability revoke | `DELETE /api/v1/artifacts/:id` cascade (§3.8.9, ch07) |
| `knowledge/knowledge-handler` | Vault operations, admin reindex | `/api/v1/knowledge*` (§3.8.20) |
| `knowledge/knowledge-sources` | Crawl-source CRUD | `/api/v1/knowledge/sources*` (§3.8.20) |
| `event-sourcing/trigger-target` | Target discriminator (automation vs artifact backend) | `POST /api/v1/triggers` discriminated union (§3.8.17) |
| `event-sourcing/ifthenpay-callback` | Callback path rules | `/hooks/:triggerId` delivery (§3.8.17) |
| `phase2/admin-usage-page` | Admin billing surfaces + authorization | `/api/v1/billing/admin/*` (§3.8.21) |
| `phase2/user-isolation-integrations` | Per-user isolation; owner-undefined-means-global nuance (ch04 §4.3.1) | `/api/v1/integrations/configs*` (§3.8.13) |
| `phase2/user-isolation-settings` | Per-user settings isolation | settings + `user_settings` paths (§3.8.5, ch04) |
| `phase2/specialist-removal` | Tier-routing removal contract | `llm/router.ts` unit tests (ch06) |
| `sessions-onboarding-singleton` | One persistent onboarding session per user | `POST /api/v1/sessions` idempotency (§3.8.6) |

**The 146 carryover module tests port with their modules (reference/test-audit.md §5.3).** Each module port in ch14's sequence brings its tests in the same unit of work; a module PR without its ported tests fails review by rule. Breakdown by group, with the new-module home from the ch02 map:

| Group (test-audit §5.3) | Count | New home (ch02) |
|---|---|---|
| Legal engines, golden figures, spine contract | 20 | `legal/`, `apps/` |
| Knowledge subsystem (index, fallback scan, ingest, crawl) | 12 | `knowledge/` |
| Automation subsystem (engine, fingerprint, planner, vision mocked) | 12 | `automation/` |
| Memory (resolver, formatter, signals, scoping) | 9 | `memory/` |
| Services long tail (sanitizer, guards, GitHub pipeline, providers, ...) | 33 | `services/`, `integrations/`, `apps/` |
| Persistence parity gates (one suite, every driver target - normative per ch04 §4.2.8) | 6 | `data/` |
| Event queue + delivery (queue, supervisor, HMAC, polling) | 8 | `events/` |
| Crypto / JWT / per-artifact git / device auth | 4 | `data/`, `auth/`, `services/` |
| Auth/infra root (managed OAuth, sanitizer, cancel, tokens, bases, Adobe) | 12 | `llm/`, `services/`, `agents/` |
| Branding token gates (incl. every-app-links-tokens-css product gate) | 4 | `services/`, `apps/` |
| Phase-2 rule files (billing hard cap, slugs, branding, site building) | 11 | `billing/`, `apps/`, `services/` |
| Share/fork link contracts (`/build/:slug` 404/410/redirect) | 3 | `apps/` |
| App pipeline (migration, files, serving, import) | 4 | `apps/` |
| Artifact-backend runtime (worker, capability handle, manifest) | 5 | `apps/` |
| Locale audits (move to the `web/` package where they belong) | 3 | `web/` |

(Arithmetic: 20+12+12+9+33+6+8+4+12+4+11+3+4+5+3 = 146, matching reference/test-audit.md §5.7.)

**Q-01 resolved to the carve-out (RESOLVED (Q-01), chapter 16): the live browser canvas ships and the `streaming/` module is built unconditionally, so the four remote-display tests leave the conditional set and port unconditionally with `streaming/` (chapter 02), due green at G8 (chapter 14, the automation phase that lands `streaming/`).**

**Conditional carryover (~16 files, reference/test-audit.md §5.6)** follows its subsystems: the LLM gateway pair rides the chokepoint port (ch06); the four agent-runtime adapter tests (auth-error and transient-provider-error markers, SDK session-resume opt-in rules) ride the Agent SDK runtime port (ch05); the tier-classifier test rides `llm/router.ts`; the knowledge agent-wiring pair rides ch05/ch08 design; the local-daemon bridge and TUI group (registry owner-isolation, correlator, bridge token auth, daemon-RPC wrapping, owner-scoped cancel, host tool suppression, turn classifier) ports with `bridge/` - and its suppression and owner-isolation tests are safety gates kept verbatim, per the audit's explicit flag. (Arithmetic: 2+4+1+2+7 = 16; the four remote-display tests the audit grouped here - making its 20 - now port unconditionally per the Q-01 resolution above. The four `claude-auth-*` managed-OAuth tests are also not in this conditional set: the audit counts them as unconditional carryover, and they already sit in the 146 table above, Auth/infra root row - reference/test-audit.md §5.3 and the closing note of §5.6.)

**Retired by design:** the 14 tests of the old backend's runtime content plumbing (reference/test-audit.md §5.4) retire with that architecture (FIXED-4, FIXED-6); nothing re-covers them because the machinery they test does not exist in the rebuild. Of the 3 stream-internal tests (§5.5): the sanitize-at-send rule is re-pinned as a new unit test on the new SSE manager (the rule carries, ch09; the old test shape does not); the phase-event test retires with P-11/Q-04; and the SSEManager unit test (`src/__tests__/sse.test.ts`) retires as written - the new `events/` SSE manager (ch02; ch14 phase 5) gets its own unit tests in the same unit of work as its port, and its wire behavior is pinned by the dedicated replay and keepalive stream tests of 13.6 row 1.

**Port order (the day-one-onward sequence, aligned with ch14's phases):**

1. Port `test-client.ts` to the ch03 REST surface - the first executable coverage of the new wire contract.
2. Stand up the contract-suite skeleton: in-process app boot, `mongodb-memory-server`, the error-envelope helper, and the (initially near-empty) schema-coverage gate of 13.5.
3. Port the 13 band-1 Playwright specs as each page they visit lands in `web/`.
4. Port the 5 band-2 specs with their helper swaps.
5. Rewrite the 23 rule-set files as contract tests, domain by domain, as each router lands - each router PR carries its contract tests (the coverage gate enforces this mechanically).
6. Re-seed the 14 node drivers on the ported test-client as their surfaces land (served-app plane, integrations, hooks, chat runs).
7. Run the 37 band-3 served-app specs once the served-app plane and app pipeline exist (ch04, ch07); they must pass without modification - a failure here is a byte-compatibility defect in the plane, never a reason to edit the specs.
8. The 146 module tests ride with each module port throughout, never as a separate phase.

## 13.4 Layer 2: vision-based discovery

An agent drives the real running product (both `web/` dashboard flows and served apps) through a real browser, capturing a screenshot at every state transition; the screenshots plus the step narrative are analyzed by a model against an explicit charter ("find broken states, dead ends, wrong data, layout breakage, PT-PT copy errors, and edge cases worth pinning"). This layer is expensive by design and that is accepted: its job is to surface probable issues and edge cases that no one thought to script, not to be a permanent regression suite. Properties fixed here:

- **Output is a findings log**, one entry per suspected issue: repro steps, screenshot references, severity guess. Every entry is triaged within the same unit of work to exactly one of: a layer-3 deterministic test (bug confirmed or behavior worth pinning), a fix plus its test, or a written dismissal with reason.
- **Runs are disposable.** No discovery run is ever wired into CI as a gate; flakiness and model subjectivity make it structurally unfit for regression. The deterministic tests it spawns are the durable artifact.
- **Scope per pass** is declared up front (e.g. "memory page CRUD + guardrails" or "artifact lifecycle end to end") so passes are comparable over time and budget is controllable.
- During the implementation run, a discovery pass closes each ch14 phase that ships user-visible surface; findings triage is a phase-gate input (ch14).

## 13.5 Layer 3: regression, and the contract-test mechanism

Three deterministic instruments, chosen per finding by what the failure would be:

- **Playwright e2e** for anything a user sees: the ported suite (13.2) plus new specs from discovery findings and the gap plan (13.6). LLM-free per PR; stubs, where unavoidable, validate against `shared/` schemas as in 13.2.
- **API contract tests** for every endpoint's request/response shape and rules. Mechanism fixed below.
- **Unit tests** where logic warrants: pure engines, stores, guards - the ported 146 set the pattern.

**Contract-test mechanism (every `shared/` schema exercised).** The contract suite lives in `api/tests/contract/`, boots the composed Express app in-process (supertest against `server.ts`'s app factory, no network listener) over `mongodb-memory-server` (ch04 §4.2.8), and:

1. For every endpoint row in the ch03 domain resource map there is at least one test that performs the request and validates the response with the endpoint's named `shared/` schema via `safeParse` - a failed parse is a test failure with the zod issue list printed. Happy path is mandatory; discovered edge cases accrete here.
2. Every non-2xx response asserted anywhere in the suite is additionally validated against the shared error envelope schema (ch03 §3.3) by a common helper - one helper, so the rule cannot be forgotten per test.
3. **Schema coverage gate:** `shared/` exports a complete index of its schemas; the validation helper records each schema name it exercises into a run-wide registry; a final gate test diffs the registry against the index and fails CI listing every unexercised schema by name. Adding a schema to `shared/` without a contract test that exercises it is therefore an automatic build failure - this is the checkable form of "every shared/ schema exercised".
4. **SSE unions:** events captured by the ported node drivers and by dedicated stream tests are parsed against the `shared/events.ts` unions; an event that fails the union parse fails the test. A **protocol-parity gate** closes the class of bug the audit found live (the dead-on-the-wire event, reference/test-audit.md §5.5 and conflict 2): one test asserts that the set of event types the server can emit per stream, the shared union, and the set of types the generated client subscribes to are equal. Ch03 acceptance criterion 4 (exactly four SSE endpoints) is asserted here too, by route census.
5. **Belt and braces:** the development/test-mode response-validation middleware (ch03 §3.1) validates every response against its schema in every other test run as well, so contract drift surfaces even in tests that were not written to check shapes.
6. The eight carried collections-engine semantics (ch04 §4.2.8) each map to at least one named test in this suite or the ported persistence parity suite; ch04 acceptance criterion 3 is discharged here.

**Security and privacy suite classes (amendment 2026-07-06).** Beyond the per-endpoint contract tests, the deterministic estate carries these named suite classes as first-class, permanent members. Chapter 17 section 17.8 (the payload-capture harness) and chapter 18 section 18.7 (the fake-daemon harness) own the harness detail; this chapter owns their place in the strategy. Where a suite is deterministic it runs in the per-PR lane (13.9); the real-model evidence runs escalate in the final security phase (chapter 14, Phase 12).

- **Cross-tenant adversarial suite (security addendum F3).** Authenticated user A attempts every operation against tenant B's resources - every domain, every route, and the collections engine - and the suite fails on anything but a clean 403/404 (never a 200, never a 500 that leaks existence). The collections engine gets the same treatment driven by a hostile manifest (one that names another tenant's collection, expresses an unscoped query, or claims an escalated capability). These are first-class per-PR members, not a one-off phase activity, and they escalate at whole-repo scope in the final security phase.
- **Rate-limit and spend-cap tests (security addendum F4).** The per-tenant and per-user rate limits and spend caps at the LLM chokepoint (chapter 06; FIXED-14) are asserted deterministically against a stubbed clock and a fixture ledger: the request past the window limit is refused, the cap-reached state blocks a run at the pre-run allowance gate, and anomalous-burn alerting fires.
- **Payload-capture assertions (chapter 17 section 17.8).** In test mode every outbound Anthropic request body is captured; planted synthetic values (a checksum-INVALID NIF, a deny-listed party name) MUST appear tokenized - never cleartext - in EVERY captured request across every scenario, TUI sessions included. A single cleartext leak in any captured payload fails the suite.
- **Streaming straddle de-tokenization (chapter 17 section 17.8).** A placeholder token straddling a stream-chunk boundary de-tokenizes correctly in the user-visible output, with minimal straddle buffering.
- **Prompt-cache byte-identical prefix (chapter 17 section 17.8).** Across a multi-turn session the tokenized prefix is byte-identical turn over turn (delta-only detection, per-session determinism) and a cache hit is observed; a model switch is asserted to be a cache boundary.
- **tool_use de-tokenization round trip (chapter 17 section 17.8).** A model tool call referencing a masked value executes against the real cleartext value locally - tool_use argument blocks buffered whole and de-tokenized, tool results re-entering and re-tokenizing.
- **Fake-daemon adversarial scenarios (chapter 18 section 18.7).** Against the committed fake-daemon harness (`api/test/fake-daemon/`): a containment-violation request, a replayed task, an expired task, a cross-tenant-addressed task, and a forged-pairing connect are each rejected, and every rejection is ledgered as a denial. The green path - a delegation round trip returning derived output only - runs against the same harness.
- **Revoke-pairing kill switch (chapter 18 section 18.5).** Revoking a pairing server-side immediately refuses all subsequent delegated tasks and provider-endpoint traffic bound to that pairing.
- **Derived-output-only assertion (chapter 18 section 18.2).** After a delegation round trip the hosted conversation and run records are asserted to hold only derived output (summaries, citations path+range, patch proposals, ledger refs); no raw local file content and no cleartext excerpt appears in any hosted record. Paired with the correlation-id join: the chokepoint audit metadata and the daemon ledger row join on the per-request correlation id.

Synthetic test-data rule (binding across all of the above): only checksum-INVALID plausible fakes are used - a valid fake NIF may be a real person's - and never real client data (chapter 17 section 17.8).

## 13.6 Coverage-gap closure plan

Every gap in reference/test-audit.md §6 gets an owner layer and a concrete plan. None is left unowned.

| Gap (test-audit §6) | Owner layer | Plan |
|---|---|---|
| The wire protocol itself (auth handshake, request lifecycle, stream lifecycle, Last-Event-ID replay, keepalive) | Regression (contract) | Day-one priority: ported test-client + 14 drivers + the contract suite of 13.5; replay and keepalive get dedicated stream tests (ch03 §3.6 mechanics are the checklist) |
| Chat during a live run (queueing, Stop restores composer, preview reconciliation) | Regression (Playwright + unit) | The re-coverage plan of 13.2: ported store-level unit halves + new schema-validated-stub specs replacing the retired pair |
| Real-LLM chat/build flows | Baseline driver + discovery | The ported chat driver (SKIP-gated on credential health) runs in the scheduled nightly lane with managed credentials; discovery passes exercise a real build end to end on the P-22 cadence - expensive by design, which is the accepted price of covering the billable surface |
| Dashboard pages beyond rendering (memory CRUD, user management, branding research) | Discovery then regression | Early discovery pass targets exactly these; findings become Playwright specs; the rewritten rule sets of 13.3 already pin the API-side rules |
| Automations live run through the UI | Regression (Playwright) | New spec drives a deterministic automation (navigate/wait steps only - no vision dependency) in the run viewer and asserts step progression and terminal state |
| Billing, teams, observability pages | Discovery then regression | Billing page spec pins usage display, credit purchase flow, overage toggle (rules already pinned by the ported billing gate unit test); teams and observability get behavior specs after a discovery pass. The activity read surface is dropped in v1 (ch03 Appendix A), so no UI test is owed there |
| Platform OAuth connect flows (Google/M365) | Regression (contract) | Contract test pins the callback route's server-rendered postMessage page shape and state validation (ch03 §3.8.15); the external IdP round trip stays a manual pre-cutover check, recorded as such in ch10 |
| Template management UI | Discovery then regression | The migrated surface (ch12) gets a discovery pass, then specs pinning create/edit and preview behavior |
| Local daemon bridge / TUI subsystem | Conditional carryover + new driver | The unit safety gates port verbatim with `bridge/` (13.3); a new live-daemon node driver (SKIP-gated on daemon availability, like the chat driver) covers the end-to-end abort and suppression properties the audit says are pinned only at unit level; running it against a real daemon is a mandatory manual pre-cutover gate (ch10), since CI has no daemon. Shape follows the P-18 decision (ch03 §3.10) |
| SSE consumer parity | Regression (gate) | The protocol-parity gate of 13.5 item 4, permanent in CI |

## 13.7 Layer 4: the review loop

- **Opus code review on every PR.** The reviewer model reads the full diff plus the touched modules' tests, hunting correctness bugs first, then contract drift (does the change touch `shared/` coherently on both sides), then the ch02 §2.9 boundary rules. Findings are fixed or explicitly waived in the PR before merge.
- **Adversarial Codex review on significant changes.** A second, different-vendor model reviews the same diff with an adversarial charter (try to break it), and the loop iterates until it approves. "Significant" is a deterministic trigger list, not judgment: any PR that (a) touches `shared/`, `api/src/auth/`, `api/src/billing/`, `api/src/llm/`, or the collections engine in `api/src/data/`, (b) touches more than 300 changed lines of non-test code, or (c) changes any security invariant enforcement point named in ch09. CI labels PRs against this list mechanically.
- **Security-briefed review passes (security addendum F1-F2, amendment 2026-07-06).** On the same dual-model cadence but with a security charter distinct from the code-quality reviews above: (i) Claude Code's built-in security review over the full repo, findings triaged and looped back to implement like any other gate; (ii) a separately-briefed adversarial Codex pass charged specifically with authorization bypass, tenant leakage, and injection paths - not the general adversarial review, a security one. Both run in the run's final security phase (chapter 14, Phase 12) over the whole repo; their verdicts are recorded in RUN_LOG.md and real findings block the gate. The cross-tenant adversarial suite (F3, 13.5) and the rate-limit/spend-cap tests (F4, 13.5) are the objective companions to these passes.
- During the unsupervised implementation run, both code-quality reviews run at every ch14 phase gate, and their verdicts are recorded in RUN_LOG.md (ch14 journal discipline); a red adversarial verdict blocks the gate.

## 13.8 Layer 5: periodic audit (RESOLVED (P-22))

Recurring vision-testing passes re-exercise the product after launch and keep the e2e suite honest: new behavior observed gets a spec, stale specs asserting removed behavior are retired (with the removal noted in the PR), and drift between what the suite covers and what the product does is reviewed against the ch03 endpoint map.

The cadence is normative: one full-product discovery pass per month, plus a scoped pass after any release that adds user-visible surface; each pass ends with a suite-adjustment PR (possibly empty, stating so). The layer itself was never optional - it is part of the day-one process; only its cadence was ever in question, and it is now fixed to this constant.

Rejected alternative: audit only on demand (before major releases) - cheaper, but coverage drift is exactly the failure mode this layer exists to catch, and unscheduled processes decay.

Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 13.9 CI wiring sketch

Two lanes plus scheduled jobs. Single CI provider assumed (whatever the new repo uses; nothing below is provider-specific).

**Per-PR lane (blocking, LLM-free, deterministic):**

1. Install; boundary lint (ch02 §2.9 rules 1 and 3); chokepoint grep gate (ch02 §2.9 rule 2); `ENCRYPTION_KEY` default-constant grep gate (ch04 acceptance 6).
2. Typecheck `shared/`, `api/`, `web/`.
3. Unit and module tests: `api/` vitest (ported 146+ and new), `web/` vitest (ported 17+ and new).
4. Contract suite (in-process app + `mongodb-memory-server`), ending with the schema-coverage gate and the protocol-parity gate (13.5); the deterministic security and privacy suite classes of 13.5 run in this lane - the cross-tenant adversarial suite (clean 403/404 only), the rate-limit and spend-cap tests, and the fake-daemon adversarial scenarios, tool_use round trip, streaming-straddle, prompt-cache byte-identical prefix, derived-output-only, and revoke-pairing suites, exercised against the fake daemon and a stubbed provider so they stay LLM-free.
5. Build `web/`, build `api/`.
6. Playwright e2e against the booted stack (api + web + seeded data): bands 1-3 plus new layer-3 specs. LLM-dependent specs skip cleanly (they run in the nightly lane below).
7. Suite-ledger check (ch14 §14.2.5): every skip in items 3, 4 and 6 must be ledger-scoped - it carries either an `awaiting G<N>` reason (during the build, for artifacts whose gate has not arrived) or a standing reason (LLM-dependence or daemon availability, routed to the scheduled jobs below); anything the ledger marks due at the current gate is green; and the ratchet holds - nothing previously green regresses to skip or red. This is the lane step that ch14's gate template item 2 enforces mechanically. After G9 the ledger is trivially all-due, so the step reduces to no unexplained skips and no regressions.
8. Significance labeler (13.7) - marks the PR for the review lane if triggered.

**Review lane (on every PR; extended on significant PRs):** Opus review; adversarial Codex review where the significance triggers match; merge blocked until findings are resolved or waived in writing.

**Scheduled jobs:** nightly - the LLM-dependent drivers (chat driver and successors) with managed credentials, plus the live-daemon driver when a daemon environment is available; per P-22 cadence (13.8) - the discovery pass with findings triage; final security phase once (chapter 14, Phase 12) - the two security-briefed review passes of 13.7 and the real-model payload-capture evidence run (every outbound Anthropic body captured and asserted tokens-only across all scenarios, chapter 17 section 17.8); pre-cutover once - the collections-engine suite against the production Firestore database and the manual OAuth/daemon checks (ch10 gates).

## 13.10 New repo CLAUDE.md: the verbatim block

The following text lands in the new repo's CLAUDE.md on day one, verbatim, alongside the ch02 §2.9 boundary and chokepoint statements. It is the repo-process form of this chapter plus FIXED-12.

> ## QA process (non-negotiable)
>
> Testing runs in five layers. Every change lands inside them; skipping a layer makes the change incomplete.
>
> 1. **Baseline.** The ported e2e suite is the safety net. It stays green on every PR. A red baseline spec is fixed before any new work merges.
> 2. **Discovery.** Vision-based exploratory passes (an agent drives the real UI; a model analyzes the screenshots) surface probable issues and edge cases. Discovery runs are never CI gates and never regression. Every finding is closed by a deterministic test or a written dismissal - never silently.
> 3. **Regression.** Findings become deterministic tests: Playwright e2e for user-visible behavior, contract tests validating every response against the `shared/` zod schemas, unit tests where logic warrants. Every schema exported from `shared/` must be exercised by the contract suite - the coverage gate fails the build otherwise. Every non-2xx body must validate against the shared error envelope. New endpoint means new contract test in the same PR. Test stubs for API responses must be validated against the `shared/` schemas.
> 4. **Review.** Every PR gets an Opus code review. PRs touching `shared/`, auth, billing, the LLM module, or the collections engine - or exceeding 300 changed non-test lines - additionally get an adversarial Codex review and merge only on its approval.
> 5. **Periodic audit.** Recurring vision passes re-exercise the product and adjust the e2e suite: new behavior gets a spec, stale specs are retired explicitly.
>
> Modules travel with their tests: a PR that ports or changes a module without its tests fails review. E2e specs use real UI login, no protocol stubs except schema-validated ones, and assert zero console errors where they touch the dashboard.
>
> ## Diagrams (non-negotiable)
>
> The system is documented visually in Excalidraw under `spec/diagrams/`. Any change that alters structure, flow, or data shape must update the affected diagrams in the same unit of work. A structural change without its diagram update is incomplete, and review must reject it.

## 13.11 Acceptance criteria (checkable without a human)

1. The 13 band-1 Playwright specs run unchanged and green against the new stack; the 5 band-2 specs differ from their originals only in seeding-helper bodies (plus the one documented stub swap in `onboarding`); the 37 band-3 specs run without modification (diffable against the old repo).
2. The two retired specs' behaviors are each covered by at least one new Playwright spec and the two ported store-level unit tests, traceable by name in the suite.
3. A ported test-client exists and all 14 node drivers run against the new REST surface (SKIP-gated drivers may skip, but must execute their gate logic).
4. Each of the 23 rewritten rule-set files maps to a named contract-test file covering the same rules; the mapping is recorded in a table in `api/tests/contract/README.md`.
5. The schema-coverage gate exists and demonstrably fails when a schema is added to `shared/` without a contract test (verifiable by a deliberate red-test commit during the build, logged in RUN_LOG.md).
6. The protocol-parity gate exists and passes; the route census confirms exactly four `text/event-stream` endpoints under `/api/v1` for web clients (plus P-18 if approved, TUI-only).
7. Every row of the 13.6 gap table has its planned artifact present in the repo (spec file, driver, or gate) or an explicit deferral recorded in RUN_LOG.md.
8. The new repo CLAUDE.md contains the 13.10 block verbatim.
9. CI runs the per-PR lane of 13.9 on every PR; the significance labeler is active; the nightly lane exists in CI configuration.
10. Discovery and periodic-audit tooling never imports or calls the product LLM module and holds no product managed-OAuth credentials (lint/grep-checkable in the QA tooling directory).
11. The cross-tenant adversarial suite (13.5, security addendum F3) exists as a first-class per-PR member: it enumerates authenticated user A against tenant B for every domain and the collections engine under a hostile manifest, and it fails on any response other than 403/404 (verifiable by a deliberate red - a temporarily-unscoped repository query makes it red, logged in RUN_LOG.md).
12. The payload-capture harness (chapter 17 section 17.8) is wired into the suite: with a planted checksum-INVALID NIF and a deny-listed party name in a turn, every captured outbound Anthropic request body validates as tokens-only (no cleartext) and the tool_use round trip resolves the real value locally; the streaming-straddle and prompt-cache byte-identical-prefix suites pass; the synthetic test-data rule holds (only checksum-INVALID fakes appear in fixtures, grep-checkable).
13. The fake-daemon adversarial suite (chapter 18 section 18.7) exists and is green: containment-violation, replay, expiry, cross-tenant-addressing, and forged-pairing requests are each rejected and ledgered as denials; the delegation round trip returns derived output only, the derived-output-only assertion confirms no raw local content in any hosted record, the correlation-id join succeeds, and the revoke-pairing kill switch refuses subsequent traffic.
14. The rate-limit and spend-cap tests at the chokepoint pass (13.5, security addendum F4: per-tenant/per-user limit refusal, cap-reached run block); the security-briefed review passes of 13.7 (Claude Code full-repo security review + adversarial security Codex pass) ran in the final phase with verdicts recorded in RUN_LOG.md.

Cross-references: ch02 §2.9 (lint and CI enforcement this chapter's lane 1 executes), ch03 §3.12 (endpoint-map acceptance the contract suite discharges), ch04 §4.2.8 and §4.10 (engine semantics and parity gates), ch05 (run lifecycle the stream tests exercise), ch09 (invariants whose enforcement points trigger adversarial review; FIXED-14 security baseline), ch10 (cutover gates consuming this chapter's suites), ch12 (web migration this chapter's frontend tests ride), ch14 (phase gates, RUN_LOG discipline; the anonymisation phase G7A and the delegation/bridge phase G8A whose objective gates these suites are), ch17 §17.8 (payload-capture harness), ch18 §18.7 (fake-daemon harness).

**Amendment record.** Amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md): Q-01 resolved (the four remote-display tests become unconditional, 13.3); P-22 resolved-defaulted (13.8 cadence normative); the security addendum RUN items merged (cross-tenant adversarial suite, rate-limit/spend-cap tests, and the two security-briefed review passes - 13.5, 13.7, 13.9); the new anonymisation and bridge suite classes named as first-class deterministic members (13.5), with harness detail owned by chapter 17 section 17.8 and chapter 18 section 18.7.

*End of chapter 13.*
