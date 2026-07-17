# Findings ledger

The live findings ledger: OPEN first, then recently fixed, then accepted/by-design. A finding closes
only by a landed fix + committed test, or a written dismissal. Replaces the release FINDINGS table and
the RUN_LOG finding tail. Journey findings keep their `F` ids; later findings use readable slugs.

## OPEN

### Cortex gateway (run 20260717-071930-d1244839)

- **`gateway-vault-per-request-instability`** (found by S6 live proof; being fixed by S7). On the
  gateway path a stock Anthropic client (Claude Code) sends no `metadata.session_id`, so
  `proxyGatewayMessages` opens a FRESH ephemeral vault per request (`sess_${correlationId}`). Vault
  tokens are minted per-class by sequence and are deterministic only WITHIN one vault, so across
  Claude Code's agentic tool loop (each tool step is a separate gateway request) a deny-list literal
  in a filesystem path tokenizes inconsistently and a prior turn's token fails to detokenize - the
  CLI then sees a directory that "does not exist" and the tool loop fails in confusing ways (exactly
  the brief's §3 anticipated failure). The EMPTY-ruleset round trip is a true no-op and lands
  byte-identical (proven live), so only deny-list orgs are affected. Fix (S7): derive a STABLE
  session key for a gateway principal without an explicit session_id (the gateway keyId), so one
  Claude Code session shares one vault (30-min TTL) and tokens stay stable across the loop.

### Contract / schema drift (the schema-coverage honor-system class)

- **`schema-coverage-honor-system`** (structural). The schema-coverage gate is a hand-maintained
  allowlist that does NOT verify a test exercises each COVERED endpoint; a green gate is not proof a
  body matches its schema. Audit 2026-07-10 found 27 of 154 COVERED keys unexercised and ~6 endpoint
  groups returning schema-violating bodies. The three items below are instances. Real fix: a run-wide
  registry of actually-exercised schemas (specified, unimplemented). Tracked: `docs/testing.md`.
- **`llm-classify-contract`** (medium). `ekoaLocal.llmClassify` handler emits no `category` and reads
  `req.body.prompt`, diverging from the contract input shape; a compliant client gets a schema-
  violating response.
- **`triggerView-active-drop`** (minor). `triggerView` drops the `active`/disabled field (optional
  field silently omitted), so trigger state is invisible to a schema-strict client.
- **`view-timestamps-drop`** (minor). `memoryView` and `artifactView` omit `createdAt`/`updatedAt`
  (optional-drop).
- **F14** (harness-gap, minor). The served-app owner bypass accepts both `Authorization: Bearer` and
  `?token=`; the committed suite asserts only `?token=`. Untested accepted-auth surface.
- **`artifact-cards-invalid-date`** (minor, UX). The expanded "Os Meus Artefactos" cards render
  "Invalid Date" in the date row for every featured artifact (observed live 2026-07-12 on a fresh
  dev stack, all 41 cards). Likely the card formats a missing/differently-shaped timestamp on
  seeded featured artifacts (`createdAt`/`updatedAt` absent or non-ISO) straight through
  `new Date(...)`. Fix: tolerate absent timestamps (hide the row) and add a regression assertion
  that no card ever renders the literal "Invalid Date".
- **`ai-integration-lands-under-platform-tab`** (minor, UX). An AI-built integration saved via the
  chat builder (e.g. open-library, e2e-proof-weather, openweathermap) renders under
  `/integrations?tab=plataforma` ("Integrações da Plataforma"), while "Minhas Integrações"
  (`?tab=minhas`) shows the empty state - so a user who just built an integration and looks under
  "Minhas Integrações" does not find it (confusing). It is available to the org (works), just filed
  under the wrong tab for its provenance. Observed live 2026-07-11. Likely the "mine" filter keys on
  a config/credential-instance concept rather than `userCreated` runtime definitions. Decide the
  intended split and route userCreated runtime defs to the "mine" tab (or relabel the tabs).
- **`integration-handoff-spurious-build`** (medium, UX). Confirming a chat integration offer (the
  two-turn `[[EKOA_INTEGRATION_BUILD]]` handshake) reliably ALSO spawns a real app-build job that
  runs the coding agent with an effectively-empty task and terminates `BUILD_UNFULFILLED` ("A
  construção não chegou à aplicação servida"). Observed live 2026-07-11 for both rest-countries and
  open-library: the integration panel opens and generates+saves correctly (proven — the integration
  lands on `/integrations` with its actions), but the chat column shows a spurious failed build
  alongside it. The build job carries a jobId (server-created) yet no `Vou ligar essa integração
  primeiro.` message precedes it, so it is NOT the build-path in-build classifier; and the client
  `isBuildSession` gate is false on a fresh chat session, so the client message router did not kick
  it — the spurious `build_intent` originates in the server marker orchestration when the
  confirmation turn is classified. Not blocking (the integration still saves) but pollutes the
  handoff. Close by tracing the turn-2 emission: the chat run must emit ONLY the integration signal
  (or, if it emits both, integration must win over build in `agents/chat.ts` — currently build is
  checked first). Add a deterministic test asserting one signal per confirmation turn.

- **`served-app-data-unauthenticated-writes`** (HIGH, pre-existing, operator decision - surfaced by
  H5's destructive-action-authz assertion). The served-app data plane `/api/app-data/:collection`
  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
  `X-Ekoa-App-Id` header + the app OWNER's activation, then scopes to that app's partition. So ANY
  caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data ACROSS TENANTS (a private
  org app's data can be tampered/deleted by an outsider who learns its id). Two compounding facts:
  (1) the manifest collection-rule `access:{ write:'session'|'server' }` is DECLARED but NOT enforced
  by served-data.ts (the write mode is decorative); (2) the app-sso session cookie is
  `Path=/api/app-sso`, so it is not even sent to `/api/app-data` - there is no session to check at
  that path today. NOT introduced by the operator-run (C3/D-era served-app data plane); on a
  DIFFERENT axis from the platform role/capability layer H1-H4 close (which is complete). Phase 10's
  "destructive-action authorization asserted server-side" is NOT met for this surface. FIX (an
  operator architecture decision, a dedicated post-H slice): enforce the declared collection write
  mode and make an app-sso session verifiable at the data path (widen the app-sso cookie path or mint
  a session token the data plane checks); `write:'server'` collections should reject ALL client
  mutations. Pinned as a TRIPWIRE in `api/tests/security/destructive-action-authz.test.ts` (a fix
  flips the test) + behaviorally green today in `api/tests/contract/served-app.test.ts`. Tracked in
  `docs/security.md`.

### Gateway / egress

- **`gateway-502-masks-401`** - CLOSED (local-bridge consumer run s7, 2026-07-11, merged from the
  parallel session): typed `CredentialError` -> 503 `credential_error` (non-retryable), rate-cap ->
  429, transient stays 502; `/health claudeAuth.lastProviderError` carries class+timestamp only;
  gateway metadata is an allowlist (`user_id` only), killing the sibling mask.
- **`health-bridgeConnections-mismatch`** (small, merged from the parallel session's recon). `/health
  bridgeConnections` reports `sseManager.connectionCount` (SSE clients), not the bridge registry's
  daemon-socket count the field name promises. One-line fix in server.ts /health + a health contract
  assertion.
- **`e2e-estate-no-committed-env`** (open, structural; merged - extends `e2e-estate-baseline-13`
  below). 49 of 213 due specs red when the WHOLE ledger estate runs against the run-driver stack
  (the served-app compat `/api/v1/action` suites 404 at every commit; demo tours exceed the 30s
  timeout on dev-next latency). Needs a committed full-stack e2e harness + a compat-suite triage.
- **`gateway-apikey-checkAllowance`** (medium, security). The gateway `apikey` principal skips
  `checkAllowance` and bills the platform admin account - an exfil surface reachable from a build
  subprocess. Operator decision owed on the sanctioned posture.
- **F8** (judgment, minor). Provider/credential error surfaces are not user-grade: chat can stream an
  English spec citation, the adapter can leak raw provider JSON, and build failure is a generic PT
  sentence with no cause. Needs one error-mapping layer at the streaming sink (PT message + machine
  code, detail in logs).

### Product bugs

- **`restoreVersion-featured-500`** (medium). `restoreVersion` on a *featured* artifact still 500s.
  (The broader versions-500 - never-built artifacts and the featured list - was fixed 2026-07-11; this
  case remains.)
- **`web-sourceinput-divergence`** (medium). A web/`shared` `SourceInput` divergence makes a seed-
  template knowledge source 400 from the UI.
- **`login-double-session`** (minor, dev-only). The login landing double-creates sessions (React
  StrictMode double-mount of the eager empty-session create); dev-DB orphan-row noise, and the /chat
  landing intermittently GETs a just-created session id that 404s (the e2e trackers carry a scoped
  exclusion for exactly that 404 pattern - remove it when this closes). The write should be
  idempotent/effect-guarded.
- **`chat-sse-discovery`** (deferred, batch-2). S1 adversarial-tester discovery set: chat-SSE late-
  subscriber gap, run hangs on upstream auth failure, temp-session 404 persist.
- **`web-tests-untypechecked`** (low, batch-2). Web `__tests__` are excluded from tsc, so web test
  files are never typechecked.
- **`e2e-estate-baseline-13`** (medium, per-spec debt). The first honest full-stack estate run
  (2026-07-11, 187/200 green after this run's fixes) leaves 13 red ported specs, ALL pre-existing
  product/UI gaps (none touch this run's diffs): (a) the documented band2 legacy group still built
  around the retired `/api/v1/action` + old stubs - artifact-backend-panel, artifacts-apps-section,
  update-from-bundle, vertical-profile, onboarding x3 (REST migration owed; see
  docs/e2e-harness-remediation-brief.md); (b) integrations UI gaps - pages-manage expects a search
  input the migrated page lost, integrations-sections' Webhooks tab renders no webhook rows,
  integrations-pipedream master-toggle default/persistence semantics differ; (c) legal-content
  gaps - legal-rcbe journey, legal-shared-drift (six scaffolds vs canonical layer), simuladores-
  trabalho exact CT figures. Each is closed by building the missing surface or by an explicit
  retire decision - never by editing the ported spec.

- **`branding-tab-stale-after-research`** (minor, UI freshness). Right after a brand research
  completes, the Marca tab can render the PREVIOUS palette (local component state seeded at page
  load) while `org.branding` already holds the new one - a fresh reload shows the correct values.
  Observed live 2026-07-11 during the walkthrough recording (post-research tab showed `#1A2D5A`,
  persisted+reload truth was `#1C2B4A`). Likely the local-state sync effect on
  `settings/branding/page.tsx` not re-seeding after `fetchCompany()`. Close with a deterministic
  test that researches (fake transport), switches to the Marca tab and asserts the fresh hex.

- **`collection-rule-access-unenforced`** (medium, data-plane; H5 assertion-layer surfaced). A
  collection rule's `access:{write:'session'|'server'}` is DECLARED in the app manifest schema but
  NOT enforced by served-data.ts - all app-data writes are app-id-scoped (owner-activation
  admission), so the per-collection write mode is decorative. Pre-existing C3/data-plane concern,
  OUTSIDE the H security block (which gates the PLATFORM authz; the served-data plane is a separate,
  documented app-id-scoped design). Close by enforcing the declared write mode in served-data.ts OR
  by removing the unenforced field from the manifest schema. Flagged by H5's destructive-action-authz
  assertion (the privileged app-sso ops ARE gated + asserted; this is the general data plane).

- **`h3-edit-mode-no-cancel`** (low, UX fast-follow; H3 fresh review flagged, non-blocking). The admin
  edit-mode `running` phase (`api/assets/panel-runtime/src/edit-mode.js` / `AssistantPanel.jsx`) has
  no client-side timeout, no AbortController, and no Cancel affordance - unlike the sibling visitor
  `send()` in the same panel (which got FETCH_TIMEOUT_MS + AbortController for codex-d2). Toggling the
  edit switch OFF mid-run does not abort the in-flight `runEditPatch`, so a late resolve can flip the
  phase to `preview` with stale shas. The stale-sha CONSEQUENCE is already mitigated (the H6/codex
  fix: `guardedRollback` re-reads HEAD and refuses a stale restore), so this is a UX gap not a data
  hazard. Fast-follow: mirror the visitor path - an AbortController tied to editMode-off/unmount + a
  run-generation guard + a Cancel button. Every server action stays H1-gated regardless.

### Operator-blocked / external

- **`prod-corpus-import`** (external). The real production knowledge corpus import is pending, blocked
  on operator ssh/rsync of the staged corpus. The importer CLI and the `_shared` plane are ready
  (`docs/operations-runbook.md`).
- **`remote-tag-f25`** (operator action). The remote tag `batch1-f25` still points at the broken
  commit `8a2a67b`; re-point with `git push origin +refs/tags/batch1-f25:refs/tags/batch1-f25` (local
  is already at `af8b556`).

## Recently fixed - 2026-07-14 operator UX round (scope steering, verify narration, console noise)

- **`build-ambiguous-request-no-scoping`** (UX, operator 2026-07-14, live) - "faz uma app para
  ferias" built a personal vacation-itinerary planner with zero questions: the chat agent had no
  business-context steer and no scoping step, so ambiguous one-liners went straight to the wrong
  interpretation. Fixed in the content packs (business-scope section + ONE pre-marker scoping
  round; see decisions 2026-07-14) and pinned by a loader.test.ts canary.
- **`scaffold-copy-dev-facing`** (UX, operator 2026-07-14, live) - the app-base HomePage the end
  user watches DURING a build showed developer instructions ("Adicione páginas ao registo PAGES...
  frontend/src/pages/"). Now a user-facing PT building state ("A construir algo fantástico..." +
  pulse). data-demo-target="home-empty" and the mustEdit gate are untouched.
- **`verify-phase-silent-progress`** (UX, operator 2026-07-14, live) - the verify stage showed one
  status line then generic fillers for minutes (narration existed but landed in the COLLAPSED
  thinking block). Fixed: per-action ">> " narration contract in the verify prompt, re-emitted as
  same-status plan_steps -> live spinner label + Output tab (pinned by build.test.ts +
  verify-runner.test.ts). Two adjacent defects fixed with it: the verify scrub chain's hold-back
  tail was never flushed (final narration characters silently dropped), and the FC-505
  VerificationBanner was dead code (gated on a phase the store never received - plan_step phases
  now mirror into the store and the gate keys on 'verifying').
- **`monaco-cdn-csp-block`** (broken feature, operator 2026-07-14, live) - the file-editor dialog
  never initialized under the dashboard CSP: @monaco-editor/react's default loader pulls from
  cdn.jsdelivr.net, blocked by script-src 'self' ("Monaco initialization: error" + uncaught
  promise rejections in the console). Fixed by self-hosting the AMD tree from web/public/monaco
  (copy-monaco.mjs, predev/prebuild); the CSP was not widened.
- **`expected-absent-probe-console-noise`** (console hygiene, operator 2026-07-14, live) - every
  served-app load logged `GET /api/app-sso/me 401` (scaffold whoami) and, on tourless apps,
  `GET /api/demos/:appId 404` (panel teach probe) - "expected-absent" by design but console-visible
  on every load. Fixed with two additive always-200 probe routes (appSsoSession,
  demoAvailability - contract-tested) + repointed scaffold wiring and panel probe. Residual
  ACCEPTED: apps built BEFORE this change baked the old wiring and keep logging the /me 401, so
  the e2e benign-console allowlists for the 401 stay; the demos-404 allowlist entries were removed
  (the probe no longer 404s on any panel version served by a rebuilt api).
- **`preview-iframe-sandbox-warning`** (console hygiene, operator 2026-07-14, live) - Chrome
  warned "An iframe which has both allow-scripts and allow-same-origin... can escape its
  sandboxing" on every side-panel preview load (incl. each about:blank hot-reload hop). The
  sandbox attribute was removed (escapable as configured; see decisions 2026-07-14 for the
  isolation model + accepted top-navigation residual). Out of scope, not ours: the
  ObjectMultiplex "orphaned data" and MaxListenersExceededWarning lines in the same console
  capture come from the MetaMask extension's content script, not the product.
- **`suite-ledger-gate-crash-operator-run-gates`** (QA infra, found 2026-07-14 while running the
  gate) - `scripts/suite-ledger-run.mjs` threw `Unknown gate: operator-run C5` on the slice-named
  targetGates the operator run registered (commit ac1f3d3), so `npm run gate:ledger` AND
  `npm run e2e` crashed outright. Fixed: `gateIndex` maps any `operator-run*` gate to one shared
  post-G13 `OPERATOR-RUN` milestone (those drivers need the credentialed live stack and report
  as awaiting in the CI lane; they were live-verified during the operator run itself).
- **`suite-ledger-census-refusal-file-request`** (QA infra, found 2026-07-14 by the same gate
  run) - the unit census was red (disk 31 != ledger 30): commit 8996048 (BRIEF-9a) said
  "ledgered" but never added `refusal-file-request` to `frontend_unit.surviving`. Registered,
  with a census_note breadcrumb.

## Recently fixed - 2026-07-14 walkthrough-prep sweep (operator evidence pass)

- **`api-js-yaml-undeclared-dependency`** (dev-mode boot, 2026-07-14) - `api/` imports `js-yaml`
  (action-manifest parsing) but never declared it: at runtime it resolved ONLY as a transitive dep
  of **eslint** (a devDependency), so a production `npm ci --omit=dev` install would crash the API
  on import, and types came from an ambient shim (`api/src/automation/vendor.d.ts`) that tsc loads
  via `include` but the ts-node ESM loader does not (`files: false`) - making `EKOA_API_MODE=dev`
  die on boot with an unrenderable TS7016 diagnostic (`[Object: null prototype]`). This was the
  ledgered G8 action the shim itself prescribed. Fixed: `js-yaml` added to api dependencies,
  `@types/js-yaml` to devDependencies, shim deleted, and the api `dev` script switched to
  `ts-node/esm/transpile-only` (type checking stays with the `typecheck` gate; dev watch restarts
  no longer pay a whole-program check and are immune to the ambient-file-loading gap class).
- **`app-manifest-recipe-dsl-undocumented`** (discovery, 2026-07-14, live) - the app base ships
  skills for `ui_actions` (declaring-ui-actions) and tours (authoring-tours) but NONE for the
  `capabilities:` recipe DSL, so build agents GUESS the shape. Observed live on a fresh tarefas
  build: the agent flattened `store.query` (`{ op: store.query, field: ..., op: eq, ... }` - the
  comparison belongs under `where: { field, op, value }`), duplicating the `op` key; ONE invalid
  line fails the whole frontmatter YAML parse at activation, so the app lost BOTH its action
  manifest AND its tours (`actionManifestError` + `toursError`) - the assistant could neither
  operate nor teach the app, and the errors surface only in server logs (no operator UI). Fixed:
  (a) new base skill `api/assets/bases/app/skills/declaring-capabilities.md` documenting the EXACT
  recipe op shapes (source of truth: `api/src/automation/platform-primitives.ts`) with the
  store.query `where:` mistake called out; (b) the live app repaired through the product's own
  path (an admin patch run dictating the corrected line) - tour + 2 actions now served. Residual
  (minor, open): `actionManifestError`/`toursError` are invisible outside server logs; consider an
  operator-visible surface.
- **`app-custom-action-unregistered`** (discovery, 2026-07-14, live) - second instance of the
  agent-content class: the tarefas build declared `ui_actions: - id: tarefa-adicionar, kind: custom`
  but never registered `window.__ekoaApp.actions['tarefa-adicionar']` (the declaring-ui-actions
  contract), so the assistant's operate flow ALWAYS failed its second action ("Não foi possível
  executar a ação.") - observed on camera. No build-time check catches a declared custom id with no
  registration in the app source. Live app repaired via patch run (kind -> `toggle`, a declarative
  click, no registration needed). Residual (minor, open): readUiActions could WARN when a custom id
  has no `__ekoaApp.actions[` registration anywhere in frontend/src.
- **`edit-mode-preview-not-visible-in-page`** (UX, open, 2026-07-14, observed live) - after a
  patch run completes, the panel's preview phase shows only the sha diff; the RUNNING served-app
  page keeps executing the old bundle (nothing reloads it), and manually reloading to SEE the
  change destroys the pending approve/revert panel state (client-only), leaving no panel path to
  revert. The admin therefore decides from shas alone. Fast-follow candidates: an in-panel
  "recarregar a aplicação" affordance that persists the pending preview (e.g. sessionStorage), or
  a live-reload signal to the served page on activation (the dashboard preview already gets
  preview_reload). Sits beside the ledgered `h3-edit-mode-no-cancel` fast-follow. Also note: the
  post-restore dist rebuild is asynchronous - an immediate reload can race it.
- **`assistant-operate-turn-noise-citations`** (minor, open, 2026-07-14) - an operate-mode panel
  turn ("Adiciona uma tarefa...") rendered a Fontes block citing five irrelevant jurisprudência
  acórdãos (org grounding ran and cited for a non-question turn). Cosmetic but confusing; consider
  suppressing citations on do-mode turns whose grounding contributed nothing.
- **`panel-dead-tour-launcher`** (discovery, 2026-07-14, fixed in d172c2a) - teach mode offered
  "Iniciar tutorial guiado" unconditionally; on an app with no stored tour the player can only
  error ("an app with no tours simply has no teach path", authoring-tours). The panel now probes
  GET /api/demos/:appId once on mount (zero-token) and renders the launcher only when a tour
  exists. Asset rebuilt; the RUNNING api caches panel bytes in memory, so the live swap (and its
  live verification) lands on the next stack boot - the E2 driver covers it (its demos stub
  precedes navigation, so the probe is fulfilled).

- **`chat-refusal-affordance-unwired`** (discovery, 2026-07-14) - BRIEF 9a promised a refused
  build in the dashboard chat "converts into a pre-drafted build request routed to the org-admin
  - never a dead end", and diagram 03's H4 block + the change-requests store's `fileFromRefusal`
  action both claimed the feed - but NO component ever called it: a capability refusal
  (POST /jobs 403 `canBuildApps`/`canEditApps`) rendered as a plain red error with no way to file
  the pedido (code-behind-diagram drift; the served-app panel path was wired, the dashboard chat
  path was not). Fixed: `useAgentExecution` attaches the pre-drafted request
  (`metadata.refusal = { text, appId? }`) to the capability-refusal message, and the chat bubble
  renders "Pedir ao administrador" -> `fileFromRefusal` -> "Pedido enviado ao administrador."
  (`data-testid` chat-refusal-file/filed). Pinned by `web/__tests__/refusal-file-request.test.ts`
  (403+capability carries the payload incl. appId on follow-ups; 500 and capability-less 403 do
  not). Diagram 03 already depicted the flow - no diagram change needed.
- **`assistant-panel-e2e-stale-intro-assert`** (discovery, 2026-07-14) - the committed D2 driver
  `api/tests/e2e/assistant-panel.e2e.mjs` asserted the first-open lead contains "apresentar", but
  the shipped copy (AssistantPanel.jsx) says "mostrar ... ensinar ... operá-la": a re-run failed at
  step B on copy drift, not behavior. Fixed the assertion to the shipped copy ('mostrar').

## Recently fixed - 2026-07-13 preview probe CORS duplicate header (operator)

- **`F-2026-07-13-proxy-duplicate-acao`** (operator-reported, 2026-07-13) - in dev, the preview
  probe's `HEAD /apps/<slug>/` from the dashboard origin failed CORS on EVERY request:
  `The 'Access-Control-Allow-Origin' header contains multiple values '*, http://localhost:3000'`
  (`net::ERR_FAILED` despite a 200), so `probePreviewDocument` classified every served app as
  `transient` and the panel's probe-gated first render churned through its retry budget. Root
  cause: both dev CORS proxies (`.claude/skills/run-ekoa-code/driver.mjs` and its verbatim copy in
  `api/tests/journeys/boot-b.mjs`) merged response headers with
  `{ ...proxyRes.headers, ...corsHeaders(req) }` - Node lowercases upstream header names while
  `corsHeaders()` uses mixed case, so on planes where the api sets its OWN CORS header
  (`/apps/*` and design tokens send `Access-Control-Allow-Origin: *` - `serving.ts`,
  `design-tokens.ts`) the spread kept BOTH keys and the wire carried two ACAO values, which
  browsers reject outright. Dev-only (prod is same-origin, no proxy). Fixed in both files:
  upstream-wins per-header merge (`mergeResponseHeaders`) - the proxy only injects the CORS
  headers upstream did not already set, so `/apps/*` answers a single `ACAO: *` exactly as
  `web/lib/preview-probe.ts` documents, and `/api/*` keeps the reflected-origin set. Verified
  live through a restarted boot-b stack: `/apps/legal-agenda-reservas/` ACAO count 1 (`*`),
  `/health` reflected origin single-valued, OPTIONS preflight unchanged.

## Recently fixed - 2026-07-12 preview "proxy error" (operator)

- **`F-2026-07-12-preview-502`** (operator-reported, 2026-07-12) - during a build, the side-panel
  preview iframe displayed a raw `proxy error` body and stayed there (screenshot: 502 on the
  `/apps/<id>/?token=` document request while adjacent `/api/v1/billing/usage` calls returned 200).
  Two stacked defects:
  1. **Dev-harness proxy transient** (root cause of THIS 502): the run-ekoa-code driver's CORS
     reverse proxy (`.claude/skills/run-ekoa-code/driver.mjs`) forwarded upstream requests over the
     Node 20 global agent (keep-alive pooled, server closes idles at its default 5s
     `keepAliveTimeout`) and answered ANY pre-response upstream socket error with a bare 502
     `proxy error` - silently (no log), so the exact errno of the operator's occurrence (2 of 265
     requests) is unrecoverable. Fixed: fresh upstream connection per request
     (`http.Agent({ keepAlive: false })` - loopback, sub-ms), one replay for bodyless idempotent
     methods (GET/HEAD) failing before a response, upstream errors logged with method/path/errno,
     and a mid-stream failure destroys the response instead of appending garbage. Forensics note:
     the classic close-vs-reuse race would NOT reproduce in 365 timed attempts against Node 20
     (agent honors the server's Keep-Alive hint), so the residual trigger class is broader than
     that race - the fix covers the class, and the new logging captures any recurrence.
  2. **Preview panel could not recover** (product gap, any 5xx source incl. a prod edge blip): an
     iframe NEVER fires its error event for an HTTP error response - it renders the error body and
     fires `load` - so `side-panel.tsx`'s retry machinery never engaged and the raw body stuck
     until a manual refresh. Fixed: `web/lib/preview-probe.ts` classifies the document plane via a
     HEAD probe (`ok` 2xx / `transient` network+5xx / `hard` other); the panel now gates the first
     iframe render on the probe (polls at the existing 500ms/30s bounds), re-probes on every iframe
     `load`, routes `transient` into the existing bounded retry, restores the retry budget on a
     verified-ok load, and renders `hard` pages (410 revoked) as-is. Manual refresh polling unified
     on the same classification (and now probes the tokened URL the iframe actually loads).
  Accepted residual: a blip that hits ONLY the iframe's GET while the adjacent HEAD probes pass is
  undetectable cross-origin without a new parent<->iframe liveness protocol on the byte-compat
  injection plane (the demo bridge stays dormant until `demo.init` by design) - disproportionate;
  revisit only if it recurs behind the fixed proxy/edge. Tests:
  `web/__tests__/lib/preview-probe.test.ts` (classification),
  `web/__tests__/components/side-panel-preview-recovery.test.tsx` (wiring: probe-gated first
  render, 410 renders as-is, on-load transient -> retry -> recovery); both fail against the
  pre-fix behavior. Live-verified 2026-07-12: stack restarted on the fixed driver, real-UI login,
  /artifacts + served `legal-nucleo` render through the proxy, 16/16 doc-plane requests across
  5s keep-alive boundaries clean.

## Recently fixed - 2026-07-12 brand research colors (operator round 3)

- **`brand-colors-fake-teal`** (operator-reported, 2026-07-12) - research on
  mariliasantoscabral.webnode.pt showed primary `#0d9488` (teal-600, the OLD platform default) on a
  navy/white site with no teal anywhere. Root-cause forensics (live DB + job records + a live
  extraction probe) proved the teal never existed in the pipeline, the model output, or the org
  record: it was the branding page's HARDCODED display fallbacks (`#0d9488`/`#1e293b`) rendered
  whenever `org.branding` lacked colors - indistinguishable from a research result, and
  `handleSaveBranding` would persist them verbatim on Guardar. Fixed: unset colors are `null` state
  end-to-end (explicit "Não definida" swatch/placeholder, neutral preview placeholders), Save OMITS
  unset colors, and the exact pair appears nowhere. Tests: `web/e2e/branding-colors.spec.ts`.
- **`brand-research-silent-no-color`** (same run) - the research flow structurally could not produce
  a color for this site yet reported success: the grounded snapshot contained ONLY grayscale hexes,
  the model complied, `sanitizeBrandColors` nulled them, the patch dropped the nulls, and the job
  completed `brandingApplied:true` with no signal (the old cortex NO_PRIMARY_COLOR fail-loud guard
  was never ported - color-filter.ts's own comment referenced a "no usable primary guard" that did
  not exist). Fixed as partial-apply-with-warning: the job result + complete event + `jobView` carry
  `colorsApplied` and `warnings: [NO_PRIMARY_COLOR]`; the web shows an amber "defina-as manualmente"
  banner/toast instead of green success. Tests: `api/tests/contract/branding.test.ts` (fail-loud
  monochrome case), shared `Job` schema extended.
- **`brand-colors-image-only-blind`** (same run, the actual extraction gap) - the firm's navy lives
  ONLY as pixels in the hero JPEG; the rendered walker samples computed styles, so `paintedHexes`
  came back empty, the Webnode builder scrub then intersected the CSS candidates against that empty
  set and wiped all 8, leaving the model four grayscale hexes. Fixed with a screenshot-PIXEL
  quantization fallback in `rendered-candidates.ts` (fires only when nothing non-neutral paints;
  in-page canvas quantization of the Playwright screenshot - a data: image, so no cross-origin
  taint), surfaced as an explicitly low-confidence "Cores amostradas dos píxeis" prompt section with
  a neutral-ban rule, deliberately exempt from the brandFit floor (the desaturated navy ~0.26 is the
  point). Live-verified against the real site: research now persists primary `#374559` (the actual
  hero navy) and no neutrals. Tests: `api/tests/services/branding/rendered-candidates.test.ts`
  (`screenshotClustersToCandidates`), `snapshot.test.ts` (pixel section + rules).
- **`brand-colors-no-membership-guard`** (found during the fix, latent in old cortex too) - the
  "every returned hex must appear literally in a candidate list" rule was prompt-only; a
  hallucinated saturated color would have merged unchecked. Fixed: `collectAllowedHexes` gathers the
  snapshot evidence and the apply-step NULLS any returned color outside it (grounded path only).
  Tests: `api/tests/contract/branding.test.ts` (out-of-snapshot teal dropped),
  `snapshot.test.ts` (`collectAllowedHexes`).
- **`sanitize-accent-gap`** (same run) - `sanitizeBrandColors` never checked `accentColor`, so gray
  `#9d9d9d` persisted as the org accent; and the promotion swap PARKED the demoted gray in the
  accent slot. Fixed: a grayscale accent is nulled last (no slot ever persists a neutral). Tests:
  `api/tests/services/branding/color-filter.test.ts`.
- **`branding-save-wholesale-wipe`** (found during the fix) - `saveBrandingHandler` passed the
  client's 4-field branding object straight to `updateOrg`, which replaces top-level keys wholesale:
  every dashboard Guardar silently WIPED `designSystem`/`visualVibe`/researched fields. Fixed: the
  handler merges onto existing branding (same semantics as the research apply-step). Test:
  `api/tests/contract/branding.test.ts` (save-merge case).
- **`accent-picker-secondary-binding`** (same run) - the "Cor de Destaque" picker was bound to
  `secondaryColor`, so the persisted `accentColor` was never displayed and Save wrote the fallback
  slate into `secondaryColor` under an accent label. Fixed: the accent picker binds `accentColor`.
  Test: `web/e2e/branding-colors.spec.ts` (accent stays unset when only primary is saved).
- **`branding-page-stale-until-reload`** (operator-reported, 2026-07-12 follow-up: "had to refresh
  to see the changes on the brand area") - the branding page re-syncs its local editor state only
  when the `${company.id}_${company.updatedAt}` fingerprint changes, but `orgView` never returned
  `updatedAt` and nothing stamped it, so the fingerprint NEVER changed after mount: the
  `branding_updated` notification correctly refetched the company (round-2 fix), the store updated,
  and the page kept rendering stale colors/name until a reload remounted it. Fixed server-side:
  `updateOrg` stamps `updatedAt` on every org patch, `orgView` + shared `OrgConfig` expose it.
  Live-verified: page open on the Marca tab, research fired via API, primary + company name updated
  in place with zero navigation. Test: `api/tests/contract/branding.test.ts` (updatedAt present +
  changes across saves + GET /org parity).
- **`founder-name-never-updated`** (operator-visible in the same screenshot) - "Founder" is the
  seedAdmin bootstrap displayName; `BrandResearchResult` had no `companyName` field, so research
  could never replace it (old cortex wrote displayName from the extracted companyName). Fixed:
  `companyName` added to the shared schema + both system prompts, applied to `org.displayName`
  (never merged into branding, via `RESEARCH_META_KEYS`). Live-verified: displayName became
  "Marília Santos Cabral". Test: `api/tests/contract/branding.test.ts` (companyName case).

## Recently fixed - 2026-07-11 operator round 2 (build surface + verify + logo)

- **`verify-runner-portscan-hang`** (operator-reported, 2026-07-11) - a simple flyer build sat in
  `verifying` with NO output for 13+ minutes, then surfaced a half-redacted raw SDK error ("Agente
  EKOA Code returned an error result: Reached maximum number of turns (15)"). Root causes, from the
  verifier's own transcript: (1) `build.ts` passed the artifact-relative `appUrl` (`/apps/<id>/`,
  no origin) verbatim into the verify prompt, so the agent PORT-SCANNED the host (`:80 :3000 :8080
  :5173 :7080-7090`, `find /`, old-ekoa nginx configs) hunting for the app it could never find;
  (2) the build wall-clock/inactivity timers are cleared BEFORE verify, so nothing bounded it;
  (3) the raw error string reached the user chat. Fixed in `apps/verify-runner.ts`: the prompt gets
  an ABSOLUTE loopback URL (`resolveVerifyUrl` - the API serves `/apps/*` itself), a hard
  `AbortSignal.timeout(verifyWallClockMs)` (5 min default, env-tunable) as the REAL bound, an
  explicit no-scavenger-hunt rule (URL dead → FAIL immediately, never search the host), a
  proportionate-effort rule (static flyer → quick pass), live narration forwarded through the new
  job thinking channel (`onProgress` seam), and PT-generic user-facing notes (raw errors go to the
  server log only). Turn ceilings raised per operator directive ("must never stop users mid-task"):
  verify 15→60, build 100→500, chat 30→60 - backstops, not bounds. A verify note no longer REPLACES
  the agent's completion summary (it's appended). Tests: `api/tests/apps/verify-runner.test.ts`.
- **`build-chat-raw-internals`** (operator-reported, 2026-07-11) - the build transcript showed raw
  tool calls (Bash command lines, Read/Write with absolute sandbox paths, tool results incl. "File
  does not exist... your current working directory is /Users/..."), "Routing: EXPERT - first build",
  commentary bubbles split MID-WORD ("...construir s" / "obre a estrutura..."), and the final
  summary named `window.__ekoa.exportPdf`. Root causes: `build.ts` flattened the chokepoint's
  thinking/text channels into `text_chunk` (chat.ts had the thinking channel; build never did);
  `useJobStream` flushed the live buffer into a permanent message on EVERY tool_event (the mid-word
  chops) and rendered raw tool traffic + the routing decision into the user-visible feed. Fixed:
  `JobEvent` gained `thinking_chunk`; build routes commentary through MarkerProcessor +
  StreamingIdentityRedactor into the collapsible thinking UI (same as chat); the activity feed shows
  friendly white-labelled one-liners with project-relative paths (never commands/results/routing);
  `BUILD_SYSTEM_PROMPT` forbids internal API/machinery names in the final user-facing message.
- **`build-no-live-preview-no-files`** (operator-reported, 2026-07-11) - preview stayed empty during
  (and after) the build and the files area showed nothing, even though `prepareFirstBuild` had
  ALREADY built + registered + served the scaffold ("register it so the preview is live before the
  agent runs" - the last mile was never wired: nothing emitted `preview_reload`, and the client
  learned the artifactId only at `complete`). Fixed: new `JobEvent` `artifact`
  `{artifactId, appUrl, slug}` emitted right after prep/resolve → the preview iframe + REAL file
  tree (GET `/artifacts/:id/files`, the scaffold/template files) show from second zero; the esbuild
  watcher's `onRebuild` now fires `sink.previewReload()` so the iframe follows the agent's writes
  live (follow-up builds get a watcher too - they previously ran without one); the Files tab is fed
  from the server list (source of truth) with live +/M/D badges, and file paths are project-relative
  - which also fixes the Monaco editor dialog (it exists and works; it was sending
  `sandboxes/...`-prefixed paths that the path-confined API rejected). Latent bug fixed on the way:
  follow-up completion blanked the artifact's slug/appUrl (`resolveFollowUp` now returns them).
- **`brand-logo-wrong-image`** (operator-reported, 2026-07-11) - "not the logo at all": the logo
  picker chose a 380KB touch-icon (`/brand-assets/01d6df7c73d6.png`) because selection was
  source-name heuristics only (favicons/og-image) with no eyes on the rendered page - the OLD ekoa
  worked better because its research agent DROVE A BROWSER and picked the header logo by sight.
  Restored that ability tool-lessly (§5.6.4 intact): (1) `rendered-candidates.ts` now harvests logo
  candidates from the RENDERED DOM (header/nav imgs, inline `<svg>` logos - stored as sanitized
  local svg assets - and logo-classed background images), scored by placement (header, top-left,
  home-link, logo attrs, aspect ratio); (2) new top trust tier `rendered-header` beats
  design-system/favicon sources, JPEG photos demoted within tiers; (3) ONE FAST vision one-shot
  (`logo-vision.ts`) compares the downloaded candidates against the header-strip screenshot and can
  override the heuristic pick ("qual é o logótipo visível no cabeçalho?"). Tests extended in
  `api/tests/services/branding/brand-assets.test.ts`.
- **`brand-stale-until-refresh`** (operator-reported, 2026-07-11) - the dashboard kept the old
  brand until a manual page reload. The Marca page refetches on its own job stream, but the header
  logo/theme only read the company store on first load. Fixed with a `branding_updated`
  notification (NotificationEvent) emitted when research applies branding; the header listens on
  the global notifications stream (same pattern as `usage_updated`) and refetches the company
  config - live brand refresh, no reload.
- **`verify-blocked-by-shareability-gate`** (found during the live re-verify of the fix above) -
  with the URL fixed, the verifier reached the app in 17 SECONDS but got the §7.7 "Link já não
  disponível" page: a draft, non-shareable artifact's document is owner-gated, and the verify
  agent carries no auth (and must NEVER carry a user JWT in an agent transcript - it would
  authenticate on every API route). Fixed with a PURPOSE-SCOPED preview token
  (`services/preview-token.ts`: HMAC capability `pv1.<artifactId>.<exp>.<mac>`, not a JWT,
  grants viewing ONE artifact's served document for the verify window): verify-runner appends it
  to the URL; serving.ts accepts it in the owner-bypass ahead of the user-JWT path. Verdict notes
  are now requested in PT (they surface to the end user). Tests: preview-token expiry/tamper +
  resolveVerifyUrl token cases in `api/tests/apps/verify-runner.test.ts`.
- **`app-pdf-endpoint-never-mounted`** (CAUGHT BY THE NOW-WORKING VERIFIER, live 2026-07-11:
  "o botão 'Descarregar PDF' não funciona — o servidor retorna um erro 404") - the injected
  `window.__ekoa.exportPdf` client was carried in the port but its endpoint `POST /api/app-pdf`
  (and the `/artifact-pdfs` static mount) never were: EVERY in-app document export 404'd since
  rc-1. Ported from old cortex into `apps/pdf.ts`: `renderAppDocumentPdf` (page JS disabled,
  subresource allowlist blocking private ranges/metadata, injected `<base>`, embedded print
  reset, @page-aware margins) + `appPdfRouter` (X-Ekoa-App-Id scoping, html required, 4MB cap)
  + both mounts in server.ts. Contract test: `api/tests/contract/app-pdf.test.ts`. Second-order
  fix in the same class: agent-written `@import '/api/design-tokens.css'` failed the whole
  esbuild bundle ("could not resolve") - server-absolute paths are now treated as runtime URLs
  (CSS externals / JS stubs) in builder.ts's resolver, and the coding-agent content now says the
  tokens are auto-linked in index.html and must never be imported.
- **`brand-consent-overlay-polluted-vision`** (found during the live re-verify) - plmj.com's
  Cookiebot overlay covered the header strip, so the logo-vision ground truth showed a cookie
  banner and the rendered harvest scored a team-PORTRAIT carousel into the top tier (position +
  aspect alone). Fixed: `consent-chrome.ts` (shared vendor-token list + in-page removal) runs
  before EVERY rendered pass (colours, logo harvest, header shot, visual-vibe screenshots);
  harvest candidates now require a STRUCTURAL logo signal (logo attrs / header-nav / home-link)
  to qualify, and photo JPEGs are score-penalized. Re-verified live: the vision gate then
  correctly overrode dembrandt's white-on-white candidate to the REAL PLMJ wordmark, and the
  header logo swapped in live (`navigations: 1`, no reload).
- **`brand-assets-url-keyed-cache-staleness`** - stored assets were keyed by md5(source URL), so
  a re-research whose logo changed at the same URL kept the same `/brand-assets/<hash>` path and
  every browser served its stale cached copy. Now keyed by md5(CONTENT).
- **`dev-harness-30s-health-window`** - `scripts/dev-api.mjs` killed healthy API boots at 30s while
  a cold boot registering ~200 featured apps takes ~90s. Now 120s default (`DEV_API_HEALTH_TIMEOUT_MS`
  override); the run-skill driver's API window raised to 180s.

## Recently fixed - 2026-07-11 stabilization run

- **`brand-research-site-blind`** (operator-reported, 2026-07-11) - brand research "saved nothing
  from the site": the agent was TOOL-LESS *and* model-knowledge-only, so it never touched the
  target website, never saved a logo, and never produced a design system - it emitted a plausible
  palette from memory and the job's `summary`/`confidence` were the only real output. Fixed by
  porting the REAL cortex pipeline as deterministic SERVER-SIDE services (`api/src/services/branding/`):
  `fetchSiteContext` (HTML + linked-CSS scrape: title/meta/generator, CSS colour + font candidates),
  `fetchRenderedCandidates` (headless-Chromium area-weighted painted colours + fonts),
  `fetchDesignSystem` (the `dembrandt` 0.23 CLI: confidence-scored palette, CSS variables, typography,
  spacing, radii, shadows, button styles, frameworks), `fetchVisualVibe` (hero/mid/footer screenshots
  → vision one-shot → mood/shape/density/texture/hero), plus website-builder chrome detection/scrub so
  a Webnode/Wix promo stripe never masquerades as the brand. The agent STAYS tool-less (§5.6.4
  anti-injection): all site access is server code, the model receives a server-built snapshot and
  returns constrained JSON grounded "usa APENAS a informação do snapshot". The orchestrator
  (`agents/brand-research.ts`) now: fetch site-context → (parallel) rendered + dembrandt + vibe →
  grounded `runOneShot` → resolve + STORE a real logo file under `/brand-assets/<file>` (SSRF-guarded
  download, content-type + size cap) → merge colours/fonts/tone/instructions + `designSystem` +
  `visualVibe` + `logo` onto `org.branding`. Site unreachable → honest degradation to the
  knowledge-only prompt, noted on the job (`siteReachable: false`). All server fetches of the
  user-supplied URL go through the SSRF guard (new `guardedFetchFollow` re-validates each redirect
  hop); the dembrandt URL is guard-validated BEFORE the subprocess spawns. `shared/OrgBranding`
  gained optional typed `designSystem` (StoredDesignSystem) + `visualVibe` fields (the dashboard
  Design System tab already reads them). Covered by 6 unit suites under
  `api/tests/services/branding/` + the extended `api/tests/contract/branding.test.ts` (reachable-site
  run merges colours + designSystem + visualVibe + a stored logo; unreachable degrades to knowledge).
  Decision logged in `docs/decisions.md`. LIVE-VERIFIED 2026-07-11 against plmj.com: real logo stored
  and served at `/brand-assets/...`, real brand colours (`#110088` navy + `#a90707` red), real fonts
  (Domaine Display + GT America), a populated Design System tab (palette + typography + visual vibe),
  visible in the Marca preview. Three follow-up fixes made during that live verification:
  (a) **vibe screenshots exceeded the 32MB provider request cap** ("Request too large") - three
  viewport PNGs of a photo-heavy site are multi-MB base64; switched the vibe captures to JPEG q60
  (`api/src/services/branding/visual-vibe.ts`), which keeps each shot in the low-hundreds-of-KB.
  (b) **cookie-consent vendor chrome leaked into the palette** - dembrandt colours whose sources were
  all `cybotcookiebotdialog...`/OneTrust/etc. were surviving; added a builder-independent
  consent-chrome source filter in `filterDesignSystemChrome`, AND made `scrubBuilderChrome` always run
  the design-system filter (it previously early-returned when NO site-builder was detected, so custom
  sites like plmj.com were never scrubbed). (c) A `manifest:theme_color` white legitimately survives
  (mixed owner source) - by design. Covered by new cases in the design-system + snapshot suites.
- **`gateway-empty-text-block-cache-control`** (vision-discovered, walkthrough 2026-07-11) - the
  Agent SDK intermittently appends an EMPTY text block that still carries a `cache_control`
  breakpoint on multi-turn chat runs (reproduced deterministically on the integration-build
  handoff two-turn handshake). The OAuth beta endpoint 400s
  `messages.N.content.M.text: cache_control cannot be set for empty text blocks`, killing the whole
  turn - so the integration-builder generation failed every time while plain builds and single-turn
  chat were unaffected. Fixed at the egress chokepoint (`proxyGatewayMessages`, the last place we
  control before the provider): `stripEmptyTextBlocks` scrubs empty text blocks out of the
  forwarded `messages`/`system`, guarded so a message is never left with an empty `content: []`.
  Covered by `api/tests/llm/gateway-payload-allowlist.test.ts` (3 cases: scrub-alongside-real,
  never-empty-the-array, plain-string-passthrough). Live-verified: the same handoff that 400'd now
  reaches `package-ready` with a Save button. Decision logged in `docs/decisions.md`.
- **`run-activity-bar-word-wrap`** (vision-discovered, walkthrough 2026-07-11) - the automation
  rehearsal activity bar rendered the fixer commentary one-word-per-line: `Headline`/`Subline`/
  `ResolutionLine` sat as siblings in the flex-row `BarWrapper`, so a long failure message squeezed
  the headline to content-width. Fixed by wrapping the text block in a `min-w-0 flex-1` column in
  the `fixing-step` and `running-step` branches (`web/components/automations/run-activity-bar.tsx`).
  Evidence: walkthrough `stabilization-verification/2026-07-11_11-26-17` (pre-fix state on camera).
- **`chat-turn-no-progress-indicator`** (vision-discovered, walkthrough 2026-07-11) - plain chat
  turns showed NO indicator between send and the first streamed chunk (the whole knowledge-search
  phase was a blank screen): the progress indicator required `sessionJob`, which only build
  sessions have. Fixed: `isExecuting && (sessionJob || !isBuildSession)`
  (`web/components/builder/chat-panel.tsx`), so chat turns show "A pensar..." + elapsed time
  immediately. Evidence: walkthrough `2026-07-11_11-44-28` (blank) vs `2026-07-11_11-49-20` (fixed).
- **`automation-step-events-thin`** (operator-reported, 2026-07-11) - a regression vs old cortex: the
  automation run's `step` SSE event dropped everything but `{runId, stepIndex, status}`, so per-step
  screenshots captured + persisted server-side (`writeStepScreenshot`) never reached the run viewer,
  and there was NO `express.static('/automation-screenshots', ...)` mount - even the already-emitted
  `pause_for_user` screenshot URL 404'd. Fixed by (a) extending the shared `AutomationRunEvent.step`
  member + `RunRecord` with the optional enrichment (`stepId/tier/error/errorDetails/screenshotUrl/
  output/durationMs`; `errorDetails` is the executor's already-redacted+bounded integration/api
  request-response that lights up the live IntegrationErrorPanel; per-step `RunStepRecord` with a
  served `screenshotUrl`), (b) a pure, unit-tested
  mapper `automationStepEventPayload` (api/src/automation/run-events.ts) the composition-root emitter
  now forwards, (c) mounting `/automation-screenshots` on `automationRunsRoot()` mirroring the
  `/artifact-screenshots` precedent, and (d) serializing steps (with `screenshotUrl`) in `toWireRun`
  so `GET /runs/:id` + the Histórico drill-in render thumbnails without knowing the disk layout. The
  disk-path -> served-URL map lives in ONE helper (`screenshotUrlFromPath`). Covered by
  `api/tests/automation/run-events.test.ts`, `api/tests/contract/automation-screenshots.test.ts`, and
  shared `contract.test.ts` (thin+enriched parse). Decision logged in `docs/decisions.md`. Remaining
  for live verification: a real automation run driven end-to-end (operator session).
- **`automation-vision-empty-screenshot`** (operator-reported, 2026-07-11) - a browser/verify step
  could hand the vision tier an EMPTY screenshot (a `page.screenshot()` that failed on the local
  session, or a daemon observation envelope missing `screenshotB64`); the model then answered
  `confidence:'low'` and the engine refused ("No screenshot was provided"), burning the fixer budget
  blind and crippling self-recovery. Fixed with a guard (`screenshotForVision` in engine.ts): on an
  empty capture, force ONE fresh `observe()` and re-read; if still empty, fail the step RECOVERABLE
  with a user-grade PT message ("captura de ecrã indisponível - o passo não pode ser resolvido
  visualmente") so the fixer/pause machinery handles it - the model is never asked to work blind.
  Belt-and-braces: `LocalBrowserSession.capture()` now retries the screenshot once after a settle and
  only keeps a NON-EMPTY capture; `resolvePlaywrightAction`/`verifyOutcome` throw on an empty image
  (documents the invariant). Covered by two `api/tests/automation/engine.test.ts` cases (browser +
  verify: no blind vision call, recoverable PT failure). LIVE-VERIFIED 2026-07-11 (DRE-search
  automation): per-step screenshots stream into the run viewer AND the Histórico drill-in; step
  screenshots serve 200 at `/automation-screenshots/<automationId>/<runId>/step-N.png`; the run
  completed with no blind-refusal. One more display fix made during that run: the verify-failure
  prefix was still English (`outcome not met:`) - now PT (`resultado não atingido:`) in
  `engine.ts` (the one test asserting the prefix updated).
- **`automation-run-surfaces-word-wrap`** (operator-reported, 2026-07-11) - extends
  `run-activity-bar-word-wrap` to the terminal states + the run viewer: the completed/failed activity
  bar and the run-viewer run-level + per-step error surfaces rendered long unformatted text that
  ballooned the layout. Fixed with `min-w-0 break-words` + `line-clamp` (2-3 lines, full text on
  `title`) on the completed/failed `Headline` detail (`run-activity-bar.tsx`) and the error blocks
  (`run-viewer.tsx`). Also: the vision resolver/verifier/fixer/classifier prompts now instruct the
  model to write human-facing free-text (reasoning, userInstructions) in pt-PT while keeping all JSON
  keys/enums in English.

- **`apps-embed-frame-headers`** - the `/apps/*` embed surface now answers CSP
  `frame-ancestors 'self'` + the configured dashboard origins (`EKOA_DASHBOARD_ORIGINS` csv ->
  `EKOA_APP_ORIGIN` -> dev localhost:3000; invalid entries dropped) with NO `X-Frame-Options`;
  the dashboard CSP gained `frame-src`/`img-src` for the api origin. The preview iframe renders
  live and is pinned by e2e. Other planes unchanged (API `'none'`+DENY, served `'self'`+SAMEORIGIN).
- **`registo-targetIds`** - `registoEntry.targetIds` emitted the metadata object where the schema
  wants `array(Id)`, failing `RegistoListResponse` validation; now derives ids from id-keyed metadata.
  Verified live.
- **`/users` + `/usage` crashes** - undefined `.toLocaleString()`; `adminListUsage` now left-joins
  users and emits the full gauge surface, `fmtTokens` on totals.
- **integrations page crash** - the session stub now answers `sessionConnect` + `actions`
  (`SessionCaptureStatus` carries both).
- **artifact versions 500** - `readVersions` graceful dual-jail for never-built artifacts and the
  featured list. (Featured-artifact `restoreVersion` remains open - see `restoreVersion-featured-500`.)
- **`knowledge.listUploads`** `_id`->`id`; **`ekoaLocal.llmModels`** `{data}` envelope; **servedApp**
  `appDataList`/`appSharedList` envelope - contract fold-ins.
- **artifact thumbnails** - previously unimplemented; now end-to-end (build-mechanics screenshot seam,
  `/artifact-screenshots` static mount, `Artifact.screenshotUrl`, dev CSP `img-src`).
- **automations planner failures** - TRUE ROOT CAUSE: the SDK option was `customSystemPrompt`, ignored
  by Agent SDK 0.2.118 (the option is `systemPrompt`), so EVERY system prompt was silently dropped on
  the live path - the planner never saw the required JSON shape. Fixed, plus `runOneShot` `maxTurns`
  1->3 for thinking-heavy EXPERT one-shots, plus a distinct `plan_unavailable` wire status for egress
  outages (never "reformule o objetivo" for a dead transport).
- **brand research not persisting** - the agent now emits a structured `BrandResearchResult` that is
  merge-written onto `org.branding`.
- **gateway always-FAST clamp** - amended: a request whose model matches one of the three configured
  tier models now runs AND meters at that tier (EXPERT ~20x FAST cost - deliberate); other models keep
  the FAST clamp. This un-starved the strict-JSON EXPERT planner and thinking-heavy builds.
- **`<ekoa-context>` reinjection** - the persisted context block was never re-injected on the next
  turn; now re-injected (`agents/context.ts`).
- **thinking channel** (2026-07-10) - intermediate commentary self-identifying as the engine briefly
  flashed unredacted; now a first-class `thinking_chunk` channel, server-side branding-redacted, and
  `result.text` is answer-only (which also fixed the persisted-answer contamination).

## Previously fixed - rc-1 release hardening + batch-final (2026-07-08..10)

All fixed-verified with committed tests: **F1** (auth lifecycle - refresh/logout/password/device +
jti revoke), **F2** (credential provisioning + live turn), **F3** (Registo CRUD/login/build write
coverage, metadata-only, org-scoped), **F4** (branding research + `PUT /branding` alias), **F5**
(UI-called endpoints mounted + mount-coverage drift gate), **F6** (terminal JSON-envelope 404),
**F7** (honest failed-build serving state + `Job.error`), **F10** (per-org deny-list resolver wired +
org-admin CRUD + live masking proof), **F11** (session rename `name`/`title` + `createdAt`/`updatedAt`),
**F13** (stale `credentials.ts` header), **F16/F28** (build served the untouched scaffold and verify
passed it - `BUILD_UNFULFILLED`/`VERIFY_FAILED` terminals + live J3 re-proof), **F20** (chat result
truncation - persisted == concatenated chunks), **F21** (memory recall injection wired + backfilled
test), **F22** (`memoryView` omitted `orgId`/`tags` - `/memory` rendered 0 cards), **F23** (7 console
errors on `/memory`), **F25** (host-context bleed - mechanism reproduced, hardened, accepted residual
documented), **F26** (de-anon round-trip broken by model whitespace reformatting - format-tolerant
detokenizer + 13k-case security property), **F29** (automation plan-from-goal 500 -> structured
`plan_failed` 200). **F19** was a verified billing PASS (no fix).

## Accepted / by-design / won't-fix

- **collections-engine access rules defined-not-enforced** (tracked `docs/decisions.md` 2026-07-07).
  The per-collection `access`/`declaredOnly`/field/size rules are defined in
  `data/collections-engine.ts` but not threaded end-to-end: no producer (app manifest) declares
  `collections`, so the plane runs at the safe default (schemaless, 256 KiB, app-scope). Not
  exploitable. Close both halves together when a producer lands: wire the manifest's `collections`
  block onto `artifact.collections` AND thread the resolved rule into the engine + gate `access`
  levels in `served-data.ts`.
- **served-app per-app data plane open posture** (by-design). `/api/app-data` is unauthenticated app-
  global storage scoped only by `X-Ekoa-App-Id`, carried verbatim for byte-compatibility; private data
  belongs on the server-authenticated shared/JWT/SSO planes. Documented in `docs/security.md`.
- **subprocess PATH home-path residual** (by-design). The agent subprocess inherits the operator's
  home on `PATH`; accepted residual from the F25 hardening (disposition doc committed).
- **`sweepOrphans` boot-recovery gap** (accepted). Boot-time crash recovery flips orphaned jobs to
  `failed{ORPHANED}` without a Registo row; guaranteed-once holds on the normal live path.
- **F9** (won't-fix-minor). Trigger disable (410) is unreachable over the API (delete-only lifecycle).
- **F24** (won't-fix-minor). Extraction can persist a markdown-only junk memory (`**`).
- **F27** (won't-fix-minor). `GET /registo?type=anonymisation` returns 0 rows - filter-granularity
  confusion (the qualified query returns all rows); not a missing row.
- **F30** (won't-fix-minor). Builds do not emit a `memory-extract` billing row (build post-run
  extraction differs from the chat path).
- **served-app assistant "Fontes" can contradict the reply** (open; found by D2 fresh review, 2026-07-13; CONFIRMED harder by D3 live evidence: 5 authoritative-looking Acórdão citations rendered directly under an explicit "não posso responder" refusal — slices/D3 live-04-fontes.png of run 20260712-150958-4bb23640).
  `runAppAssistant` returns ALL grounding hits as citations (`api/src/apps/app-assistant.ts`
  `grounding.citations`), not the sources the model actually used - the live D2 evidence shows a
  reply saying the excerpts were not used while five "Fontes" render under it. Trust-eroding for a
  cite-your-source legal product. Candidate fix: emit only reply-referenced citations, or suppress
  the list when the model states it grounded on nothing. Owner: D3/F-slice follow-up on the
  operator-run branch (or platform, whichever lands first).
- **served-app anonymous `whoami` logs a console 401** (open platform nit, surfaced by the D2 strict
  console gate, 2026-07-13). `injected-context.ts:110` fetches `/api/app-sso/me`; for an anonymous
  visitor it 401s and the browser logs the failed resource on EVERY served app load. Candidate fix:
  200 `{user:null}` for anonymous (contract response is `z.unknown()`, additive). Until fixed, the
  D2 e2e allowlists exactly this signature (documented in `api/tests/e2e/assistant-panel.e2e.mjs`).
- **served-app health beacon 502 through the dev proxy** (open platform nit, surfaced by the D2
  strict console gate, 2026-07-13). `injected-context.ts:244` POSTs `/api/app-health`; through the
  dev proxy (:4111) it 502s and logs a console error on load. Likely a dev-proxy forwarding gap
  (relates to d55bd02). Prod path unverified. Allowlisted (documented) in the D2 e2e only.
