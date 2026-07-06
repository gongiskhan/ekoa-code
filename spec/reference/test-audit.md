# Test Audit: What Survives the Cortex Rebuild

This document classifies every existing test in the ekoa-dev repository against a ground-up rebuild of cortex as a conventional Node.js + TypeScript REST service. The question each classification answers: does this test remain an executable check of product behavior after the `/api/v1/action` app/intent envelope, the SSE event stream, and the content-driven (skills/recipes/tools) architecture are replaced? It covers the frontend Playwright suite, the frontend vitest suite, the cortex vitest suite, and the cortex node e2e drivers; analyzes the shared fixture layer and what must change in it; lists product areas with no surviving coverage; and gives a survival estimate for the behavioral contract.

**Method:** derived from code at commit HEAD (3882aa6); docs (CLAUDE.md, docs/) treated as hints only. Inventory and per-directory counts re-verified by direct `find`/`grep` at audit time. Finder evidence was spot-verified against source; discrepancies are recorded in the Conflicts section, never silently resolved.

---

## 1. Inventory and classification legend

Verified counts at HEAD:

| Suite | Location | Count |
|---|---|---|
| Frontend Playwright e2e specs | `ekoa/e2e/*.spec.ts` | 57 |
| Frontend vitest unit tests | `ekoa/__tests__/` + `ekoa/lib/` | 18 |
| Cortex vitest tests | `cortex/tests/**/*.test.ts` | 194 |
| Cortex vitest tests (src-internal) | `cortex/src/**/__tests__/*.test.ts` | 12 |
| Cortex node e2e drivers (live server) | `cortex/tests/e2e/*.e2e.mjs` | 14 |

**Collection rule (what `npm test` actually runs):** cortex's `test` script is `vitest run` (`cortex/package.json:test`) and `cortex/vitest.config.ts` sets **no** `test.include` override, so vitest's default glob collects every `*.test.ts` under both `tests/` and `src/` recursively. The src-internal set is therefore 12 files: 3 in `cortex/src/__tests__/` plus 9 in nested `__tests__/` dirs (`src/bridge/` x3, `src/agent-face/` x3, `src/services/` x2, `src/apps/` x1). **Total cortex vitest = 206 files.** On the frontend, `ekoa/vitest.config.ts:9` includes `['__tests__/**/*.test.{ts,tsx}', '**/*.test.{ts,tsx}']` - the second glob collects `ekoa/lib/artifact-bundle.test.ts`, making 18 frontend unit files. (An earlier revision of this audit undercounted both suites via non-recursive paths - see Conflicts item 8.)

Classification legend:

- **UI-LEVEL** - drives the real UI (or a served app) and asserts visible behavior; survives a backend protocol change with at most base-URL / seeding-helper edits.
- **WIRE-COUPLED** - asserts on or fabricates the `/api/v1/action` envelope, SSE event shapes, or the dispatch protocol; retires or is rewritten for the new REST surface.
- **BACKEND-INTERNAL / carryover** - tests a cortex module whose logic ports to the rebuild; the test ports with it (module ports imply test ports).
- **BACKEND-INTERNAL / intent-contract** - invokes a domain handler directly and encodes intent semantics (authz, defaults, idempotency); rewritten against the new REST endpoints, but the *rules* it pins are requirements to preserve.
- **CONTENT-MACHINERY** - tests the skills/recipes/prompt-assembly plumbing of the content-driven architecture; retires with that architecture by design.

---

## 2. Shared fixtures and helpers: the survivability levers

The single most important finding: **the frontend Playwright harness has no central protocol fixture to break.** Survivability is decided per-file by three touchpoints, all small.

### 2.1 Harness basics (survive as-is)

- `ekoa/playwright.config.ts:15-21` reads `../app.port` for `baseURL` (fallback `5983`); `fullyParallel: false`, `workers: 1` (`playwright.config.ts:24-27`). The header comment (`playwright.config.ts:7-12`) states the suite requires the live dev servers and the `admin / tmp12345` credentials. Note this contradicts CLAUDE.md's "Frontend port (main dev): 3000" - see Conflicts.
- **There is no shared auth fixture file.** Every dashboard spec defines its own `login(page)` that fills the real login form and waits for `/chat` (e.g. `ekoa/e2e/pages-core.spec.ts:16-22`, `shell-nav.spec.ts:11-17`). Login is pure UI, so it survives any backend that keeps a working login page.
- Most specs run against the live backend with **no stubs** by explicit header policy (e.g. `ui-foundation.spec.ts:8`, `integrations-pipedream.spec.ts:6-8`, `coherence-locale.spec.ts:3-7`).

### 2.2 Touchpoint A: inline action-API seeding helpers (swap one function per file)

Seven specs define an inline `action(request, app, intent, params)` helper that POSTs the `{app, intent, params, request_id}` envelope to `POST {backend}/api/v1/action` for **setup/cleanup only** - assertions stay in the UI. Verified example: `ekoa/e2e/onboarding.spec.ts:48-73` (the helper with retry) - the same pattern appears in `vertical-profile.spec.ts`, `artifacts-apps-section.spec.ts`, `update-from-bundle.spec.ts`, `artifact-backend-panel.spec.ts` (plus the two stub-based chat specs below, which go further). **Required change in the rebuild:** replace each inline helper body with the equivalent REST call; the assertions do not change.

### 2.3 Touchpoint B: wire stubbing of the dispatch protocol (retire)

Exactly two specs intercept `page.route('**/api/v1/action')` and fabricate `{type:'action_result', request_id, success:true, data}` envelopes keyed on `app/intent` names, on top of a seeded persisted zustand orchestration store (`SEED_STORE ... version: 4`): `chat-fixes.spec.ts:27-75` and `chat-preview-resolution.spec.ts`. These are coupled to (1) the envelope shape, (2) intent names (`ekoa.sessions/list`, `ekoa.execute/execute-job`, ...), and (3) the frontend store schema. They retire; the behaviors they pin must be re-covered (section 6).

A third, milder case: one test in `onboarding.spec.ts:186-194` stubs `POST /api/v1/request` (fabricating `{trace_id, status:'accepted'}`) to keep the chip-send test LLM-free. Only that one stub needs a matching swap for the new chat-request endpoint; the rest of the file is Touchpoint A. (The finder evidence missed this - see Conflicts.)

### 2.4 Touchpoint C: the served-app spine handle (survives iff the served-app product contract survives)

The 36-spec legal suite plus `demo-spine.spec.ts` (37 total) drives cortex-served static apps directly, with **no frontend and no JWT login**:

- `ekoa/e2e/helpers/legal.ts:9-23` builds `http://localhost:{backend.port}/apps/{appId}/` from the repo-root `backend.port` file (fallback 4111).
- Specs seed/clean via the injected app handle: `page.waitForFunction(() => !!(window).__ekoa?.shared)` then `__ekoa.shared.create/list/delete(...)` (e.g. `legal-citius.spec.ts:27-50`; the handle is typed in `legal-suite-journey.spec.ts:28-42`). 27 of the 38 `legal-*` + `demo-spine` files use `__ekoa` directly (verified by grep).

This couples the suite to **product surfaces, not internal protocol**:

1. static app serving at `/apps/{slug}/`,
2. the `window.__ekoa` / `__EKOA_APP_ID` context injection into served apps,
3. the app-data / app-shared REST routes behind the handle,
4. a handful of app-facing platform routes: `/api/legal/calculos` (`legal-calculos.spec.ts:5-9`), `/api/legal/transcricao` + WAV fixture `e2e/fixtures/audiencia-2vozes.wav` (`legal-transcricao.spec.ts:6-10`), `/api/legal-research`, `/api/citius/consulta`, `/api/app-sso/*` (stubbed in `legal-dossie.spec.ts:242-266`), `/api/app-files`, `/api/demos*`.

**Required change:** none, provided the rebuild preserves that served-app contract byte-compatibly. If any of those four surfaces changes shape, the whole 37-spec block needs a helper-level (not assertion-level) migration.

### 2.5 Cortex vitest harness

`cortex/tests/vitest.setup.ts:12-20` sets `PORT=4111`, `JWT_SECRET=test...`, `NODE_ENV=test` per worker (because `src/config.ts` throws on unset PORT at module load) and force-neutralizes GitHub env (`GITHUB_PUSH_ENABLED='false'`, empty token/org). No vitest file starts the real server; exactly 3 spin their own express instance (verified by grep for `listen(`): `tests/branding/design-tokens-endpoint.test.ts`, `tests/event-sourcing/whatsapp-webhook.test.ts`, `tests/apps/app-files.test.ts`. Handler tests invoke handlers **directly** with a mock ActionEventSender and `vi.mock`ed stores, bypassing HTTP entirely (pattern documented at `tests/e2e/memory-handler.e2e.test.ts:14-18` and the `vi.mock` swap at `:37-44`).

### 2.6 Cortex node e2e driver client

`cortex/tests/e2e/helpers/test-client.ts:41-56` logs in via `POST /api/v1/action` with the `ekoa.auth/login` envelope; `onboarding.e2e.mjs:22-24` documents the full transport (action login for JWT, open SSE stream, `POST /api/v1/request`, read the `complete` event). All 14 drivers read `backend.port` and require a live cortex; several SKIP+exit 0 when `GET /health` reports `claudeAuth.ok === false` (`onboarding.e2e.mjs:10-14`). **This client file is the natural first port to the new REST surface** - swap its login/action methods and the 14 drivers become the seed of the new wire-contract suite.

---

## 3. Frontend Playwright specs (`ekoa/e2e/`, 57 files)

### 3.1 Dashboard UI, no stubs, UI-only login - UI-LEVEL, survive as-is (10)

| File | Subject | Classification | Reason |
|---|---|---|---|
| `ui-foundation.spec.ts` | Login page + auth flow on the token foundation; zero console errors | UI-LEVEL | Real login form, UI assertions only (`:8` "no stubs") |
| `shell-nav.spec.ts` | Sidebar/header nav, PT language label, NAV_ITEMS navigation | UI-LEVEL | Pure UI (`:11-17` UI login) |
| `coherence-locale.spec.ts` | PT-PT default, EN toggle, i18n of automations/settings pages | UI-LEVEL | Pure UI (`:3-7` "no stubs") |
| `pages-core.spec.ts` | /automations /knowledge /usage /settings-platform render PageShell/PageHeader at desktop + 375px, zero console errors | UI-LEVEL | Pure UI (`:16-22` UI login) |
| `pages-flagship.spec.ts` | /artifacts on the design system | UI-LEVEL | Pure UI |
| `pages-manage.spec.ts` | /integrations /memory /users /settings-branding surfaces | UI-LEVEL | Pure UI |
| `integrations-sections.spec.ts` | Restructured integrations page sections | UI-LEVEL | Pure UI |
| `integrations-pipedream.spec.ts` | Pipedream card collapsed/expanded + master-toggle persistence | UI-LEVEL | Pure UI (`:6-8` "no stubs") |
| `integration-session-automations.spec.ts` | CITIUS SessionConnectPanel; "Criar automacoes" provisions 4 managed automations, idempotent | UI-LEVEL | Pure UI; never clicks the real connect (`:8-11`) |
| `legal-knowledge.spec.ts` | Knowledge page: no human search box, agents-first banner, browse + add doc | UI-LEVEL | Pure UI (dashboard page, not a served app) |

### 3.2 UI assertions with action-API setup/cleanup - UI-LEVEL, fixture rewrite only (5)

| File | Subject | Classification | Reason / wire touchpoint |
|---|---|---|---|
| `onboarding.spec.ts` | Guided-onboarding entry: card, single persistent session, welcome chips, re-entry reuse; LLM-free | UI-LEVEL (fixture swap) | Inline `action()` helper deletes/lists onboarding sessions (`:48-73`); one test also stubs `POST /api/v1/request` (`:186-194`) - both need one-function swaps |
| `vertical-profile.spec.ts` | Legal vertical skin over generic core (login tagline, chips, starting points) | UI-LEVEL (fixture swap) | Flips `settings.general.vertical` via real `ekoa.settings/update` in beforeAll |
| `artifacts-apps-section.spec.ts` | /artifacts "Aplicacoes" section, universal "Usar", featured update-by-consent badge | UI-LEVEL (fixture swap) | Imports bundles + mutates a featured instance via `update-instance` intent (`:29-36`) |
| `update-from-bundle.spec.ts` | Import dialog: update-in-place (keeps id+slug) vs new instance vs non-matching direct import | UI-LEVEL (fixture swap) | Bundle import + cleanup via action API (`:68-72`) |
| `artifact-backend-panel.spec.ts` | Artifact backend panel against a real fixture backend: handlers list, true dry-run, enable/disable, empty state | UI-LEVEL (fixture swap) | Bundle-with-backend import via action API (`:1-30`) |

### 3.3 Wire-protocol stubbed - WIRE-COUPLED, retire (2)

| File | Subject | Classification | Reason |
|---|---|---|---|
| `chat-fixes.spec.ts` | Side-panel toggle, message queueing during a run, Stop restores composer | WIRE-COUPLED | `page.route('**/api/v1/action')` fabricating `action_result` envelopes keyed on intent names + seeded zustand store v4 (`:27-75`) |
| `chat-preview-resolution.spec.ts` | Regression for prod 2026-06-16 "wrong artifact in preview" (session pinned to B shows A) | WIRE-COUPLED | Same technique: seeds the exact buggy persisted store + stubs intents |

Both encode envelope shape, intent names, AND frontend store schema. The *behaviors* (queueing, stop-restore, preview reconciliation) must be re-covered post-rebuild; the store-level halves survive as frontend unit tests (section 4).

### 3.4 Served-app legal suite - UI-LEVEL against the served-app product contract (37)

All build URLs via `helpers/legal.ts` (`/apps/legal-*/` on the cortex origin), assert visible behavior inside the served apps, and (27 files) seed/clean via `window.__ekoa.shared`. No JWT/UI login (served apps are public/cookie-scoped). Classification for every row: **UI-LEVEL (served-app contract)** - survives unchanged iff the four product surfaces in section 2.4 survive.

| File | Subject |
|---|---|
| `legal-nucleo.spec.ts` | Nucleo: clientes + FK-linked processos CRUD over the shared spine |
| `legal-dossie.spec.ts` | Dossie: notas, cronologia, M365 doc round-trip. **Partially wire-coupled:** stubs `/api/app-sso/me` + `/api/app-sso/m365/**` Graph proxy (`:242-266`) - those two route shapes must survive or the stubs move |
| `legal-prazos.spec.ts` | CPC deadline computation + radar |
| `legal-citius.spec.ts` | Citius inbox triage: confirm creates prazo+evento; unparseable date keeps Confirmar disabled (`:1-20`) |
| `legal-agenda.spec.ts` | Agenda bookings |
| `legal-kanban.spec.ts` | Kanban tasks |
| `legal-tempos.spec.ts` | Time entries |
| `legal-recursos.spec.ts` | Recursos (appeals) |
| `legal-pecas.spec.ts` | Pecas (pleadings) authoring |
| `legal-pesquisa.spec.ts` | Legal research (DGSI/DRE via `/api/legal-research`) |
| `legal-apoio.spec.ts` | Apoio judiciario (SinOA deadlines feed Prazos) |
| `legal-honorarios.spec.ts` | Honorarios pre-fatura flow |
| `legal-financas.spec.ts` | Financas ledger |
| `legal-cobrancas.spec.ts` | Cobrancas reconciliation |
| `legal-contratos.spec.ts` | Contratos management |
| `legal-contratos-gerar.spec.ts` | Contract-generation wizard (client picker) |
| `legal-modelos.spec.ts` | Modelos (templates) app |
| `legal-forms.spec.ts` | Forms app |
| `legal-correio.spec.ts` | Correio (mail to dossie) |
| `legal-portal.spec.ts` | Client portal |
| `legal-conflitos.spec.ts` | Conflict-check |
| `legal-kyc.spec.ts` | KYC approval flow |
| `legal-calculos.spec.ts` | Juros/custas golden figures through the UI; rate table via `POST /api/legal/calculos` (`:5-9`) |
| `legal-assinatura.spec.ts` | Signature app (Adobe Sign surface) |
| `legal-injuncoes.spec.ts` | Injuncoes app |
| `legal-transcricao.spec.ts` | STT upload (WAV fixture) then review then gated art. 640.o excerpt; deterministic mock engine via `/api/legal/transcricao` (`:6-10`) |
| `legal-rcbe.spec.ts` | RCBE calendar |
| `legal-insolvencias.spec.ts` | Insolvencias app |
| `legal-jurimetria.spec.ts` | Jurimetria app |
| `legal-ret-cons.spec.ts` | Retencoes/consultas mini-spec |
| `legal-dropdown-persistence.spec.ts` | Dropdown state persistence across apps |
| `legal-launcher.spec.ts` | Shared Layout launcher at 28-app scale, grouped searchable panel (`:1-10`) |
| `legal-cadeia-audiencia.spec.ts` | Cross-app chain: audiencia -> transcricao -> excerto -> peca |
| `legal-cadeia-credito.spec.ts` | Cross-app chain: fatura vencida -> cobrancas -> injuncao -> calculos -> prazos |
| `legal-suite.spec.ts` | Six-app single journey over one shared spine, self-restoring (`:1-20`) |
| `legal-suite-journey.spec.ts` | Full-vertical journey (925 lines): conflitos -> nucleo -> KYC -> dossie -> prazos -> kanban -> tempos -> honorarios -> financas -> cobrancas -> agenda -> correio -> apoio; tagged rows + afterAll cleanup |
| `demo-spine.spec.ts` | Fonseca demo spine: install -> cross-app banner -> atomic removal; real records survive |

(Arithmetic: 38 `legal-*.spec.ts` files exist; `legal-knowledge` is classified in 3.1 and `legal-shared-drift` in 3.5, leaving 36 + `demo-spine` = 37 in this block.)

### 3.5 Special cases (3)

| File | Subject | Classification | Reason |
|---|---|---|---|
| `demos.spec.ts` | Validates every `ekoa-data/demos` spec shape (mirrors `demo-registry.ts` schema, `:22-75`), then drives each tour in `/artifacts?demo=<appId>` to `done` | UI-LEVEL (data-driven) | Depends on the public `GET /api/demos*` registry + demo bridge - a product surface, not internal protocol |
| `legal-shared-drift.spec.ts` | Not a browser test: shells `scripts/sync-legal-shared.mjs --check` to prove the 6 scaffolds match `ekoa-data/legal-shared/` (`:13-27`) | CONTENT GATE (backend-agnostic) | Survives any backend |
| `simuladores-trabalho.spec.ts` | Builds the artifact with its own esbuild step, serves it on its own local HTTP server on port 7733 (`:7-15`), asserts Codigo do Trabalho figures | UI-LEVEL (self-contained) | Zero cortex dependency; survives verbatim |

---

## 4. Frontend unit tests (`ekoa/__tests__/` + `ekoa/lib/`, 18 files, vitest + testing-library)

These test the frontend, which the rebuild keeps; they survive unless the frontend transport layer is also rewritten. Flagged where they encode backend intent names or result shapes.

| File | Subject | Classification | Reason |
|---|---|---|---|
| `artifacts-page-wiring.test.ts` | Static source audit that /artifacts calls the right intents/api functions (`:1-10`) | **WIRE-COUPLED** | Asserts app/intent names in page source; rewrite when intents become REST routes |
| `conversation-types.test.ts` | Pins `classifyLocalFallback` mode routing for canonical inputs | UI-LEVEL (frontend-internal) | Pure frontend logic |
| `execute-skip-user-message.test.ts` | `execute({_skipUserMessage:true})` adds zero user messages (build-delegation dup fix) | UI-LEVEL (frontend-internal) | Mocks api client |
| `navigation.test.ts` | NAV_ITEMS uniqueness + locale keys exist | UI-LEVEL | Backend-agnostic |
| `orchestration-hydrate-reconcile.test.ts` | Store-level regression for wrong-artifact-in-preview (pairs with 3.3) | UI-LEVEL (frontend-internal) | Mocks api client; light coupling to `data.appUrl` result shape - update mocks |
| `orchestration-queue-stop.test.ts` | Queue/dequeue + popLastUserTurn store logic (`:1-9`) | UI-LEVEL (frontend-internal) | Api client mocked |
| `verticals.test.ts` | Pure vertical-profile merge logic | UI-LEVEL | Backend-agnostic |
| `components/data-backups-panel.test.tsx` | DataBackupsPanel render states against mocked api client (`:1-6`) | UI-LEVEL (mocked api) | Mock shapes mirror `ekoa.app-data-backups` results; update mocks on rebuild |
| `components/no-mode-picker.test.tsx` | Asserts absence of mode-picker affordances | UI-LEVEL | Static + smoke render |
| `ui/badge.test.tsx`, `ui/button.test.tsx`, `ui/confirm-dialog.test.tsx`, `ui/dialog.test.tsx`, `ui/input.test.tsx`, `ui/tabs.test.tsx`, `ui/textarea.test.tsx`, `ui/toast.test.ts` (8 files) | Design-system primitive rendering | UI-LEVEL | Fully backend-agnostic |
| `ekoa/lib/artifact-bundle.test.ts` (outside `__tests__/`, collected by `ekoa/vitest.config.ts:9`'s `**/*.test.{ts,tsx}` glob) | `bundleFromZip` / `readBundleFile` / `looksLikeZip` zip parsing for artifact-bundle import, against in-memory fflate zips (`:1-12`) | UI-LEVEL (frontend-internal) | Pure frontend logic, no network; backend-agnostic |

Net: 17/18 survive (3 of those need mock-shape updates); 1 retires/rewrites.

---

## 5. Backend test classification (cortex)

### 5.1 Node e2e drivers (`cortex/tests/e2e/*.e2e.mjs`, 14) - WIRE-COUPLED live-server drivers

All authenticate via the action envelope (`helpers/test-client.ts:43-56`) and/or open the real SSE stream. They are the **only executable coverage of the backend HTTP contract as actually served**. As written they retire, but they are the natural porting seed for the new REST surface: swap `test-client.ts` plus each driver's inline `action()` helpers and the assertions (which are about product outcomes, not envelopes) largely carry.

| Driver | Subject |
|---|---|
| `app-auth.e2e.mjs` | Served-app end-user auth (password/SSO session routes) |
| `app-files-upload.e2e.mjs` | `/api/app-files` binary upload/serve/delete round-trip |
| `citius-integration.e2e.mjs` | CITIUS integration path against live cortex |
| `erp-auth-ui.e2e.mjs` | ERP featured-app auth UI flow |
| `erp-crm-persistence.e2e.mjs` | ERP CRM app-data persistence through the served app |
| `erp-kyc.e2e.mjs` | ERP KYC flow |
| `erp-ops-persistence.e2e.mjs` | ERP ops app-data persistence |
| `ifthenpay.e2e.mjs` | ifthenpay integration vs mock provider server (`tests/helpers/mock-ifthenpay-server.mjs`) |
| `invoicexpress.e2e.mjs` | InvoiceXpress integration vs mock provider server |
| `pipedream.e2e.mjs` | Pipedream Connect layer vs mock server |
| `integration-automation.e2e.mjs` | Integration-by-automation round trip |
| `legal-research.e2e.mjs` | `/api/legal-research` DGSI/DRE lookup |
| `onboarding.e2e.mjs` | Live one-turn onboarding chat: action login -> SSE -> `POST /api/v1/request` -> `complete` event; SKIP-gated on `/health` `claudeAuth.ok` (`:10-24`) |
| `whatsapp-inbound.e2e.mjs` | `/hooks/:triggerId` WhatsApp ingress -> event queue -> dispatch |

**Scoping note - ad-hoc smoke drivers in `cortex/scripts/` (out of scope).** Beyond the 14 registered drivers, `cortex/scripts/` holds ~22 unregistered live-server smoke/debug drivers of exactly the wire-coupled kind this section classifies: `chat-cancel-smoke.mjs`, `inbuild-cancel-smoke.mjs`, `github-download-smoke.mjs`, `github-pipeline-smoke.mjs`, `sse-modal-debug.mjs`, and 17 `mega-plan-*.mjs` phase drivers. They speak the action envelope + SSE directly - `tests/e2e/onboarding.e2e.mjs:21-23` explicitly says its "Auth + transport mirror scripts/chat-cancel-smoke.mjs". None is referenced by any test runner or npm script (`cortex/package.json` scripts only reference `../scripts/dev-cortex.sh` and `../scripts/claude-auth.mjs`), so they are excluded from the survival classification: treat them as retire-with-the-wire-protocol debugging artifacts, not coverage. (The remaining `cortex/scripts/*.mjs` files - `app-data-nightly-export`, `export-app-data`, `firestore-create-indexes` - are ops scripts, not tests.)

### 5.2 Intent-contract tests (direct handler invocation) - rewrite against new REST endpoints (23 files)

Pattern: direct handler call with a mock ActionEventSender and `vi.mock`ed stores, bypassing HTTP (`tests/e2e/memory-handler.e2e.test.ts:14-18`, `:37-44`). The rules they pin (authorization, defaults, idempotency, isolation) are behavioral requirements for the rebuild even though the test harness retires.

| File | Subject |
|---|---|
| `e2e/memory-handler.e2e.test.ts` | Every `ekoa.memory` intent (list/stats/tags/create/update/delete/bulk-delete/submit-signal) |
| `e2e/memory-consolidation.e2e.test.ts` | Consolidation grouping/merge/cleanup |
| `handlers/app-data-backups-handler.test.ts` | Backups intents (status/snapshot/restore/preview/download) |
| `handlers/auth-device.test.ts` | Device-login intents |
| `handlers/integrations-session-intents.test.ts` | session-status / connect-session intents |
| `handlers/settings-defaults.test.ts` | Settings singleton defaults |
| `handlers/update-from-bundle-intent.test.ts` | update-from-bundle intent semantics |
| `featured/featured-update.test.ts` | Featured-artifact update-by-consent |
| `featured/list-instances.test.ts` | Instance listing contract |
| `featured/seeder.test.ts` | Seeder idempotency + orphan sweep (in-memory store mock) |
| `featured/set-featured-authz.test.ts` | set-featured super-admin authorization |
| `automation/handler.test.ts` | `ekoa.automations` intents |
| `artifact-backend/handler.test.ts` | `ekoa.artifact-backend` intents |
| `artifact-backend/delete-teardown.test.ts` | Delete teardown + capability revoke |
| `knowledge/knowledge-handler.test.ts` | `ekoa.knowledge` intents |
| `knowledge/knowledge-sources.test.ts` | Crawl-source CRUD |
| `event-sourcing/trigger-target.test.ts` | `ekoa.triggers` target discriminator (automation vs artifact-backend) |
| `event-sourcing/ifthenpay-callback.test.ts` | Callback intent path |
| `phase2/admin-usage-page.test.ts` | Admin billing intents |
| `phase2/user-isolation-integrations.test.ts` | Per-user isolation rules (integrations) |
| `phase2/user-isolation-settings.test.ts` | Per-user isolation rules (settings) |
| `phase2/specialist-removal.test.ts` | Router-tier removal contract |
| `sessions-onboarding-singleton.test.ts` | One persistent onboarding session per user |

### 5.3 Carryover module tests - port with their modules (146 files)

These test modules whose logic is architecture-agnostic or ports directly; the tests carry with them. Grouped by directory (per-directory counts verified):

**Legal engines and content (20, `tests/legal/`) - survive verbatim; engines live in `ekoa-data/` or `src/legal/`:** `simuladores` (Codigo do Trabalho golden figures), `prazo-engine` (CPC deadline goldens, liability-grade), `spine-contract` (shared collection/FK contract + seed coherence), `ferias`, `calculos`, `honorarios`, `injuncoes`, `cobrancas`, `citius`, `agenda`, `assinatura`, `forms`, `kyc`, `rcbe-calendario`, `registar-evento`, `regulatory`, `boundary`, `demo-spine`, `engine-copy-drift`, `jurimetria-strings`.

**Knowledge subsystem (12 of 16, `tests/knowledge/`):** `knowledge-fts` (SQLite FTS5 index), `knowledge-ripgrep` (fallback scan), `accents`, `boilerplate`, `browse`, `crawl`, `domino-ingest`, `api-ingest`, `scheduler`, `tls`, `upload`, `knowledge.test` (vault store), plus the two handler tests counted in 5.2. Two are conditional: `knowledge-mcp` (MCP tool wiring - agent-runtime coupled) and `knowledge-prompt` (grounding prompt section - retires if prompt-injection design changes); see 5.6.

**Automation subsystem (12 of 13, `tests/automation/`):** `engine` (three-tier dispatch, heavy deps mocked, `engine.test.ts:1-6`), `executor`, `fingerprint`, `template-vars`, `self-url`, `rehearsal`, `planner`, `vision` (mocked LLM), `cross-agent`, `automation-browser`, `local-browser-session`, `integration-action-executor`. (`handler.test.ts` counted in 5.2.)

**Memory subsystem (9, `tests/memory/`):** `resolver`, `formatter`, `anonymizer`, `signals`, `migration`, `entity-scoping`, `integration-affinity`, plus heavier `e2e-memory` / `live-integration` (full lifecycle with mocked stores).

**Services (33: 32 in `tests/services/` + 1 src-internal):** citius trio (`citius-connect/consulta/etribunal`, HTML fixtures under `tests/services/fixtures/` + `tests/fixtures/citius/`), `ctt-tracking` (JSON fixture), `legal-calculos`, `legal-research`, `stt-provider` (RGPD consent gate), `signature-provider`, `cloud-files` (provider HTTP mocked), `commit-guard`, `demo-registry`, `url-fetcher`, `app-archive`, `app-sso`, `app-data-backups` (+ `-mongo` restore on the production backend), `artifact-bundle-export`, `artifact-bundle-update`, `artifact-files`, `file-save-commit`, `github-provider`, `github-repos`, `github-backup`, `github-fork`, `integration-automation`, `integration-automations`, `integration-inference`, `integration-action-executor-session`, `invoicexpress-skill` (over-the-wire action tests vs mock server), `pipedream`, `platform-oauth-errors`, `shared-data-scope`. Plus src-internal `src/services/__tests__/artifact-pdf.test.ts` (PDF render/capture via the shared browser pool, config + browser-pool mocked, `:1-15`) - a plain service module, carries with it. (`integration-storage-path` lives in `tests/phase2/`, not here - it is counted once in the Phase2 line below.)

**Persistence (6, `tests/persistence/`) - the highest-value carryover gates for a rebuilt data layer:** `app-data-backend-parity` (one suite run against BOTH fs and mongo drivers with a real in-memory mongod - the gate for driver work), `app-data-mongo-concurrency`, `app-data-pitr-readasof`, `app-data-seed-routing`, `app-data-shared-scope`, `app-sessions` (end-user SSO sessions).

**Event sourcing (5 of 7, `tests/event-sourcing/`):** `dispatch-target`, `gmail-poll`, `platform-poll`, `odata-interpolation`, `whatsapp-webhook` (spins its own express to prove raw-body `/hooks` ingress - couples to a product route that should survive). Plus root-level: `trigger-dispatcher` (durable SQLite queue: atomic claim/retry/idempotency), `listener-supervisor`, `webhooks-pipeline` (pure HMAC verifier/dedup-key).

**Tools (4 of 5, `tests/tools/`):** `crypto` (bcrypt + AES-GCM), `jwt`, `vcs` (per-artifact git), `device-auth`. (`registry` is content-machinery, 5.4.)

**Auth/infra root (`tests/*.test.ts`):** `claude-auth-env-fallback`, `claude-auth-race`, `claude-auth-status`, `claude-auth-watchdog-recovery` (managed OAuth service - conditional on agent runtime porting, see 5.6), `error-sanitizer`, `chat-run-cancel` (server-side abort of in-flight runs - behavior carries; test touches run-registry internals), `token-resolution` (layered design-token resolution base -> company -> featured), `guidance-reader` (per-user guidance override vs global setting), `base-loader` + `base-loader-all-four` (loads bases from `ekoa-data/bases` - carries if the base-template system carries), `adobe-client-signed`, `adobe-sign-oauth`.

**Branding (4, `tests/branding/`):** `design-tokens-css` (pure generator), `css-vars-resilience`, `design-tokens-endpoint` (own express - `/api/design-tokens.css` is a product route), `propagation-e2e` (every served app must `<link>` the tokens CSS before its bundle - a product contract worth keeping as a gate).

**Phase2 (11 of 16, `tests/phase2/`):** `brand-color-filter`, `branding-save`, `design-system`, `rendered-candidates`, `site-builder`, `site-context`, `visual-vibe`, `slug-generation`, `slug-resolution`, `billing-hard-cap` (in-memory store mocks - the billing gate rules carry), `integration-storage-path`. (4 counted in 5.2; `skill-loader-path` in 5.4.)

**Share/fork (3, `tests/share-fork/`):** `build-link` (`/build/:slug` route contract: 404/410/redirect - product surface), `fork-isolation`, `run-link`.

**Apps (4 of 5, `tests/apps/`):** `app-data-migration`, `app-files` (own express over `/api/app-files`), `dev-serve-external`, `import-projectdir`. (`interpreter-recipe-id-match` in 5.4.)

**Artifact-backend (5 of 7, `tests/artifact-backend/`):** `runtime` (WorkerThreadRuntime), `handle-rpc` (capability-scoped `ekoa` handle), `manifest-build`, `citius-onemail`, `nucleo-capture`. (2 in 5.2.)

**Locale audits (3, `tests/locale-audit/`):** `required-keys`, `formal-register`, `template-leak` - audit **frontend** locale files from the cortex suite; backend-agnostic, survive (arguably belong in the frontend package post-rebuild).

### 5.4 Content-machinery - retires with the content-driven architecture (14 files)

| File | Subject |
|---|---|
| `src/__tests__/governance-compliance.test.ts` | Recipe-app structure + handler-layer governance audit |
| `src/apps/__tests__/interpreter.test.ts` | Recipe interpreter core: `matchRecipe` + `executeRecipe` over temp-dir recipe/data files (`:5`) - retires with the recipe DSL |
| `apps/interpreter-recipe-id-match.test.ts` | Recipe DSL matching |
| `tools/registry.test.ts` | Governed-tool registration layer |
| `skills/starting-points-presence.test.ts` | Skill markdown vocabulary audit |
| `skills/template-leak.test.ts` | Skill markdown leak audit |
| `guided-mode/skill-content.test.ts` | Guided-mode skill content audit (no mode-picker language) |
| `routing/base-and-starting-point.test.ts` | Snapshot-replay of `selectBaseTemplate` with recorded LLM responses (`fixtures/inputs.json`, `recordings.json`) |
| `routing/starting-points-prompt-snapshot.test.ts` | Prompt snapshot |
| `onboarding-prompt.test.ts` | Prompt assembly |
| `starting-points-prompt-drift.test.ts` | Prompt drift gate |
| `in-build-classifier.test.ts` | In-build classifier machinery |
| `cross-agent-catalog.test.ts` | Catalog-injection machinery |
| `phase2/skill-loader-path.test.ts` | Skill loader path resolution |

### 5.5 SSE/wire-coupled internals - WIRE-COUPLED (3 files)

| File | Subject | Note |
|---|---|---|
| `src/__tests__/sse.test.ts` | SSEManager unit (mock Response) | Retires or ports with whatever streaming transport replaces SSE |
| `sse-scrub.test.ts` | Provider-error-leak scrub on the SSE write path (fake res) | The scrub *rule* (`sse.ts:101-103` sanitize-at-send closes every leak path) carries as a requirement; the test is SSE-shaped |
| `orchestrator/phase-events.test.ts` | `phase_changed` SSE broadcast on phase transitions (`orchestrator.ts:103-110`) | Pins a wire event that is **dead on the wire today**: cortex emits it as a named SSE event (`sse.ts:173` writes `event: <type>`), the chat page registers `conn.on("phase_changed", ...)` (`ekoa/app/(dashboard)/chat/[[...sessionId]]/page.tsx:873`), but the transport's subscribed `eventTypes` list (`ekoa/lib/cortex/connection.ts:151-169`) omits `phase_changed` and there is no `onmessage` catch-all - so the handler never fires. See Conflicts |

### 5.6 Conditional carryover - depends on which subsystems port (~20 files)

| Group | Files | Carries iff |
|---|---|---|
| Live-browser streaming | `streaming/auth`, `streaming/backlog`, `streaming/registry`, `streaming/state-gate` (fake WS) | The live-browser-view WS subsystem ports |
| LLM gateway | `llm-gateway/gateway-auth`, `llm-gateway/parse-usage` | The LLM gateway ports |
| Agent-runtime adapters | `adapters/contains-auth-error-marker`, `adapters/contains-transient-provider-error-marker`, `adapters/is-auth-error`, `adapters/external-session` (SDK session-resume opt-in rules) | The Claude Agent SDK runtime ports |
| Router | `src/__tests__/llm-router.test.ts` (classify() keyword tiers) | The 4-tier router ports |
| Knowledge agent wiring | `knowledge/knowledge-mcp`, `knowledge/knowledge-prompt` | The in-process MCP server / prompt-injection design ports |
| Local daemon bridge / agent-face (TUI) - all src-internal | `src/bridge/__tests__/registry.test.ts` (bridge connection registry as the cross-user ISOLATION point, finding M15: one owner can never resolve another owner's connection, `:12-16`), `src/bridge/__tests__/correlator.test.ts` (daemon<->hosted protocol correlation over an in-memory fake socket, `:9-13`), `src/bridge/__tests__/server.test.ts` (bridge token sign/verify + connection-id extraction from the dial URL, `:1-14`), `src/agent-face/__tests__/daemon-tools.test.ts` (daemon-RPC tool wrapping: capability routing, no-connection error result, ResultEnvelope rendering, ekoa-local allowlist helper, `:1-10`), `src/agent-face/__tests__/cancel.test.ts` (owner-scoped + idempotent cancel of in-flight agent-face runs - one user must not cancel another's run, `:1-6`), `src/agent-face/__tests__/suppression.test.ts` (host built-in tool suppression - described in-file as the agent face's "CORE SAFETY PROPERTY" (review M14): `disallowedTools` + default-deny `canUseTool` so only `mcp__ekoa-local__*` tools run, on the USER's machine, `:1-16`), `src/services/__tests__/turn-classifier.test.ts` (LLM-backed TUI turn classifier: strict-JSON parse, every failure mode falls back to the keyword scorer, budget guard, FAST-tier billing, `:1-14`) | The local daemon (ekoa-local) bridge / agent-face TUI subsystem ports. If it ports, the suppression and owner-isolation tests are safety gates to keep verbatim |

(The 4 `claude-auth-*` root tests are similar in spirit; counted as carryover in 5.3 since managed OAuth credentials are needed by any rebuild that keeps SDK agents.)

### 5.7 Backend classification totals (206 vitest files: 194 under `tests/`, 12 src-internal)

| Class | Count | Share |
|---|---|---|
| Carryover (module ports, test ports) | 146 | ~71% |
| Conditional carryover (subsystem-dependent) | ~20 | ~10% |
| Intent-contract (rewrite; rules carry as requirements) | 23 | ~11% |
| Content-machinery (retire by design) | 14 | ~7% |
| SSE/wire internals (retire/port with transport) | 3 | ~1.5% |

(Arithmetic check: 146 + 20 + 23 + 14 + 3 = 206.)

Plus the 14 node e2e drivers: 100% wire-coupled as written, ~100% portable in intent via a `test-client.ts` swap.

---

## 6. Coverage gaps

Product areas where the **surviving** executable net is thin or absent after the rebuild:

| Area | Surviving coverage | Gap |
|---|---|---|
| **The wire protocol itself** (auth handshake, action dispatch, SSE stream lifecycle, Last-Event-ID replay, heartbeat) | None | Exercised only by the 14 wire-coupled node drivers + 2 stubbed Playwright specs; the new REST surface starts with zero executable coverage. Port `tests/e2e/helpers/test-client.ts` + the 14 drivers first |
| **Chat during a live agent run** (queueing while running, Stop restores composer, preview reconciliation) | Store-level unit halves only (`orchestration-queue-stop.test.ts`, `orchestration-hydrate-reconcile.test.ts`) | The e2e halves (`chat-fixes`, `chat-preview-resolution`) retire; re-cover through the UI against the new backend |
| **Real-LLM chat/build flows** | `onboarding.e2e.mjs` only, and it SKIPs without `claudeAuth.ok` | No Playwright spec drives a real build or chat completion; deliberate (LLM-free suite), but the rebuild's agent-run path has no deterministic e2e |
| **Dashboard pages beyond rendering** (memory, users, integrations config, settings-branding) | `pages-core`/`pages-manage` assert render + zero console errors at two viewports only | Behavior (memory CRUD via UI, user management flows, branding research run) has no UI-level test; intent rules exist only in 5.2 rewrites |
| **Automations live run through the UI** | List/i18n (`coherence-locale`), provisioning (`integration-session-automations`); engine unit tests | No spec drives a run in `/automations/[id]` and watches the run viewer |
| **Billing UI, teams, activity, observability pages** | `billing-hard-cap` unit (rules); nothing for teams/activity/observability UI | No UI-level tests at all |
| **Platform OAuth connect flows (Google/M365)** | `platform-oauth-errors` unit | No e2e of the OAuth round trip (expected - external IdP), but the callback route shape is untested externally |
| **Template management UI** (create/edit/convert dialog, preview, screenshots) | None found in `ekoa/e2e/` | The `/templates` page has no spec; backend template services covered by unit tests only |
| **Local daemon bridge / agent-face (TUI) subsystem** | src-internal unit tests only (5.6): registry owner-isolation, protocol correlator, bridge token auth, daemon-RPC tool wrapping, owner-scoped cancel, host built-in suppression, TUI turn classifier | No committed e2e drives a real ekoa-local daemon over the bridge. The suppression safety property (preset built-ins must never execute on the Cortex host) and the cancel abort are pinned only at unit level - `src/agent-face/__tests__/cancel.test.ts:4` defers the end-to-end abort to a "live TUI test" that is not among the committed suites inventoried here. If this subsystem ports, it needs a live-daemon driver alongside the ported unit gates |
| **SSE event consumer parity** | None | The `phase_changed` producer/consumer mismatch (5.5) shows no test asserts that every emitted event type has a subscribed consumer; the rebuild should add a protocol-parity gate |

---

## 7. Survival estimate

**Frontend Playwright (the real behavioral safety net): ~96% survives (55/57).**
- 13 specs need zero changes (10 dashboard + `demos` + `legal-shared-drift` + `simuladores-trabalho`).
- 5 need only their inline `action()` seeding helper swapped for REST calls (plus one request-stub in `onboarding`).
- 37 served-app specs need nothing **provided the rebuild preserves the served-app product contract**: `/apps/{slug}/` static serving + `window.__ekoa`/`__ekoa.shared` injection + app-data/app-shared routes + the app-facing platform routes (`/api/legal/*`, `/api/citius/consulta`, `/api/app-sso/*`, `/api/app-files`, `/api/demos*`, `/api/legal-research`). This is the single biggest conditionality in the whole audit: 65% of the Playwright suite hangs on that one contract.
- Only 2 specs retire (`chat-fixes`, `chat-preview-resolution`).
- The shared survivability lever is trivial by design: per-spec UI `login()` + the two port files; there is no central protocol fixture.

**Frontend unit: 17/18 survive** (3 need mock-shape updates); `artifacts-page-wiring` retires.

**Cortex vitest (206): ~71% carryover, ~10% conditional, ~11% intent-contract rewrite, ~7% content retire, ~1.5% SSE-wire** (section 5.7). The pure-module majority (legal engines, knowledge, automation, memory, persistence parity, services, tools, event queue) ports with the modules. The conditional block now includes the src-internal local-daemon-bridge / agent-face (TUI) group, whose suppression and owner-isolation tests are safety gates if that subsystem ports. The 23 direct-handler intent tests are rewritten against the new REST endpoints but fully specify the behavioral rules to preserve. Content-machinery and governance audits retire by design.

**The structural gap:** the backend HTTP contract *as served* (action envelope, SSE stream, auth over the wire) is exercised ONLY by wire-coupled artifacts (14 node drivers + 2 stubbed specs + 3 SSE-internal vitest files). On day one of the rebuild, the externally-executable safety net is the Playwright suite (user-visible contract across chat entry, artifacts lifecycle, integrations, knowledge, onboarding, and the entire legal vertical) plus the ported module tests; the new REST surface itself starts with **zero** surviving executable coverage.

**Net estimate: roughly 65-75% of the product's behavioral contract remains executable through the rebuild.** The transport/protocol layer (order ~15% of the contract) must be re-covered from scratch, seeded by porting `test-client.ts` + the 14 drivers; the agent/prompt/content machinery (the remainder) is intentionally retired. The upper end of the range holds only if the served-app contract is preserved byte-compatibly; if it changes shape, the 37-spec legal block drops from "runs unmodified" to "helper-level migration", and the effective day-one net shrinks accordingly.

---

## 8. Conflicts

1. **Docs vs code - dev ports.** CLAUDE.md states "Frontend port (main dev): 3000. Backend port (main dev): 4111" (Testing section), but the Playwright config reads the repo-root `app.port` file with a fallback of `5983` (`ekoa/playwright.config.ts:15-21`), and the legal helper reads `backend.port` with fallback `4111` (`ekoa/e2e/helpers/legal.ts:9-17`). The port files are the actual source of truth; the CLAUDE.md "3000" is stale as a literal. Recorded, not resolved.

2. **Finder claim vs code - `phase_changed` consumer.** The finder evidence stated "the frontend never registers this event name (`connection.ts:152-170`)". Verified nuance: the frontend *does* register an application-level handler - `conn.on("phase_changed", ...)` at `ekoa/app/(dashboard)/chat/[[...sessionId]]/page.tsx:873` - but the transport's subscribed SSE `eventTypes` list (`ekoa/lib/cortex/connection.ts:151-169`) omits `phase_changed` and the connection has no `onmessage` catch-all, while cortex writes it as a named event (`cortex/src/sse.ts:173`; producer at `cortex/src/services/orchestrator.ts:103-110`). Net effect matches the finder's conclusion (the event is dead on the wire), but the mechanism is a transport-list omission with a live-but-unreachable consumer - which looks like a real frontend bug worth flagging to the rebuild, not just a test-classification footnote.

3. **Finder omission - `onboarding.spec.ts` stubs `POST /api/v1/request`.** The finder classified `onboarding.spec.ts` as touchpoint-A-only (action-API seeding). Verified: one test additionally stubs the AI request endpoint at `onboarding.spec.ts:186-194`, fabricating `{trace_id, status:'accepted'}`. Classification unchanged (UI-LEVEL, fixture swap), but the rewrite checklist for that file has two protocol swaps, not one.

4. **Finder count vs code - legal suite arithmetic.** The finder said "37-spec legal suite"; there are 38 `legal-*.spec.ts` files. Reconciled: `legal-knowledge` (dashboard page, 3.1) and `legal-shared-drift` (content gate, 3.5) are classified outside the served-app block; 36 remaining + `demo-spine` = 37. Consistent, recorded for traceability. Similarly, the finder said "26 of them" use `__ekoa.shared`; grep finds 27 files matching `__ekoa` across `legal-*` + `demo-spine`.

5. **Finder estimate vs recount - cortex carryover share.** The finder estimated "roughly 60% carryover / 13% intent-contract / 6% content-machinery". The first per-file recount gave ~74% carryover + ~7% conditional, 23/197 = ~12% intent-contract, 13/197 = ~7% content-machinery; after the src-internal correction (item 8) the denominator is 206 and the current figures are those in section 5.7 (146/206 = ~71% carryover, ~20/206 = ~10% conditional, 23/206 = ~11% intent-contract, 14/206 = ~7% content-machinery, 3/206 = ~1.5% SSE-wire). The direction is identical across all three estimates; the carryover share remains higher than the finder's round number. This document's figures are the corrected recount.

6. **Docs vs code - persistence backend.** CLAUDE.md describes JsonStore-only persistence at `~/.ekoa/data/`, while the test suite itself proves a mongo driver exists and is production-relevant (`tests/persistence/app-data-backend-parity.test.ts` runs one suite against fs AND mongo with an in-memory mongod; `tests/services/app-data-backups-mongo` tests restore "on the production backend"). The tests are evidence that the doc's persistence story is incomplete; the parity suite is precisely the gate the rebuilt data layer should keep. Recorded, not resolved (persistence spec is another reference doc's scope).

7. **Minor citation drift.** Several finder line citations were off by a few lines against HEAD (e.g. `chat-fixes.spec.ts` stub block is `:48-75` not `:55-70`; `test-client.ts` login is `:41-56`). Content of every spot-checked citation was accurate; line numbers in this document were re-verified where load-bearing.

8. **Audit inventory vs vitest collection - src-internal undercount (corrected in this revision).** An earlier revision of this audit counted `cortex/src/__tests__/*.test.ts` non-recursively (3 files) and stated 197 cortex vitest files. That contradicted what `npm test` actually runs: cortex's `test` script is `vitest run` and `cortex/vitest.config.ts` sets no `test.include` override, so vitest's default glob also collects the 9 tests in nested `src/{bridge,agent-face,services,apps}/__tests__/` - the local-daemon bridge / agent-face (TUI) subsystem plus `artifact-pdf`, `turn-classifier`, and the recipe `interpreter`. True cortex total is 206; sections 1, 5.3, 5.4, 5.6, 5.7, 6 and 7 were re-based accordingly. The same revision fixed three enumeration errors: `ekoa/lib/artifact-bundle.test.ts` (collected by `ekoa/vitest.config.ts:9`'s second include glob) was missing from the frontend inventory (18, not 17); `integration-storage-path` was wrongly listed under `tests/services/` (it exists only at `tests/phase2/integration-storage-path.test.ts`); and the knowledge carryover header read "(14 of 16)" when the section's own enumeration - 12 carryover names here, 2 handler tests in 5.2, 2 conditional in 5.6 - makes it 12 of 16.
