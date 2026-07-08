# G11 Discovery + §13.6 gap-table census (phase-11)

Ch13 layer-2 discovery is expensive-by-design and disposable (never a CI gate); its durable output
is deterministic layer-3 tests. A finding closes ONLY by a pinning test or a written dismissal
(§13.4) - never silently. This file is the findings log + the §13.6 census for the gate.

## §13.6 coverage-gap census (every gap: artifact present, or a reasoned deferral)

| §13.6 gap | Owner layer | Status | Artifact / deferral |
|---|---|---|---|
| Wire protocol (auth handshake, request/stream lifecycle, Last-Event-ID replay, keepalive) | Regression (contract) | **ARTIFACT** | api/tests/contract (15) + stream tests (29) + the protocol-parity gate (shared/contract.test) |
| Chat during a live run (queue, Stop restores composer, preview reconciliation) | Regression (Playwright+unit) | **ARTIFACT** | web/__tests__ store-level unit (orchestration-queue-stop, execute-skip-user-message) |
| Real-LLM chat/build flows | Baseline driver + discovery | **DEFERRED (by design)** | The ported chat driver is SKIP-gated on credential health + runs in the scheduled nightly lane with managed credentials; a real end-to-end build is exercised on the P-22 periodic-audit cadence (§13.8) - expensive-by-design, the accepted price of the billable surface. CI has no managed credential, so this is nightly/periodic, not per-PR. |
| Dashboard pages beyond rendering (memory CRUD, user management, branding research) | Discovery then regression | **ARTIFACT (unit) + partial deferral** | API-side rules pinned (contract + the ch03 §3.8 rule sets); page BEHAVIOR pinned by new web unit specs this phase (users role/activate, memory visibility, branding research - g11-specs). Full page-level e2e is DEFERRED: the run's e2e:server harness boots api-only for served apps; a platform-Next.js e2e-boot lane is a documented follow-up (periodic-audit cadence). |
| Automations live run through the UI | Regression (Playwright) | **ARTIFACT** | web/e2e/automation-deterministic.spec (navigate/wait, no vision) asserts step progression + terminal state |
| Billing + observability pages | Discovery then regression | **ARTIFACT (unit) + partial deferral** | Billing rules pinned by the ported billing gate (api 39 tests); page BEHAVIOR pinned by a new web unit spec this phase (usage display / overage toggle). Observability page-e2e deferred with the dashboard-e2e lane above. Teams pages DELETED end to end (Amendment 2) - no specs owed. Activity read surface = the Registo read-surface suite (metadata-only) + the Registo admin-page. |
| Platform OAuth connect flows (Google/M365) | Regression (contract) | **ARTIFACT** | api contract pins the callback route's server-rendered postMessage shape + state validation; the external IdP round trip is a manual pre-cutover check (ch10) |
| Template management UI | Discovery then regression | **MOOT - no specs owed** | The template subsystem (FC-105 template-inference, FC-106 types/template, FC-107 client-side classifier) was DELETED end to end in G9 W4 (§12.5), like teams. There is no template-management UI to spec. |
| Local daemon bridge / TUI subsystem | Conditional carryover + new driver | **ARTIFACT + DEFERRED (no daemon in CI)** | The unit safety gates + fake-daemon adversarial S1-S6 suites port with bridge/ (api/tests/bridge + fake-daemon, G8A). A live-daemon node driver is SKIP-gated on daemon availability; running it against a real daemon is a manual pre-cutover gate (ch10) - CI has no daemon. |
| SSE consumer parity | Regression (gate) | **ARTIFACT** | the protocol-parity gate (shared/contract.test §13.5 item 4), permanent in CI |

Every §13.6 gap is thus owned: artifact present, moot, or a reasoned deferral (per the phase-11
acceptance: "artifact present or RUN_LOG deferral"). The deferrals are the structurally-CI-unfit
surfaces (managed-credential real-LLM, platform-page e2e without a web-boot lane, live-daemon
without a daemon) - each pinned at the achievable layer (unit/contract/adversarial) with the live
gate recorded as a manual pre-cutover / nightly / periodic step.

## Discovery findings + triage (100% closure)

Code-level adversarial discovery over the migrated platform surfaces was run as the fresh-context
gate reviews of G9 and G10 (layer-4 with a discovery charter over the net-new + migrated surfaces).
All findings were closed by a fix + a re-verification (not silently):
- G9 review (6, all fixed+re-verified): masking claim rendered raw -> ship-gated; FIXED-1 web->api
  eslint pattern missed deep escapes -> precise pattern; login base-URL bypass -> resolveBaseUrl;
  web build 4111 default masking a prod misconfig -> moved to ci:lane; orphan src/client.ts deleted;
  an em-dash.
- G10 review (1 HIGH, fixed+re-verified): import CLI default journal wrote into the SOURCE dir
  (read-only-on-source violation) -> journal defaults to CWD.
- This phase: the "Dashboard/Billing page behavior" gap findings become the new web unit specs
  (g11-specs) - the durable layer-3 artifact §13.6 calls for.

Vision-based UI discovery (an agent driving the rendered UI + a model analyzing screenshots, §13.4)
is DEFERRED to the §13.8 periodic-audit cadence (one full-product pass per month + a scoped pass
after any release adding user-visible surface, ending in a suite-adjustment PR). It requires the
platform Next.js app booted + browser + vision tooling on dev credentials outside api/ (never the
product LLM module) - a scheduled post-cutover process by design, not a per-PR gate. Recorded here
as the standing layer-5 process, not a blocking build artifact.
