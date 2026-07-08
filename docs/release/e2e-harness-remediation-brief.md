# e2e-harness remediation brief (implementation spec)

Status: SPEC ONLY. This document specifies a later Opus feature-profile run; it implements nothing.
Scope: make the committed `npm run e2e` / `e2e:server` baseline reproducibly green on committed
content, folding in the journey probes as a permanent suite. Normative test rules:
`.claude/skills/ekoa-testing/SKILL.md` + `spec/13-test-review-strategy.md`. Ledger authority:
`api/tests/SUITE_LEDGER.json` (ch14 §14.2.5). An implementer with no prior context executes this
without re-deriving anything; verify every named file/line still exists before relying on it.

## 1. Problem statement

The G12 fresh `e2e:server` run (first since the gate-9 tag; G10/G11 ran `ci:lane` only) proved the
committed e2e baseline is NOT reproducibly green on committed content. Three debt classes, per the
two RUN_LOG DEVIATION entries dated 2026-07-08 (Phase 12, ~08:40Z and ~09:00Z) and the G12/G13
gate text (RUN_LOG lines 501-526, 546, 570):

- **band1 (13 web-dashboard specs), zero code change.** `ui-foundation, shell-nav, coherence-locale,
  pages-core, pages-flagship, pages-manage, integrations-sections, integrations-pipedream,
  integration-session-automations, legal-knowledge, demos, legal-shared-drift, simuladores-trabalho`
  (SUITE_LEDGER `playwright.band1_zero_change`). Each `page.goto('/login')` hits `:3000`, but the
  committed `scripts/e2e-with-server.mjs` boots ONLY the api (`dev-api.mjs --built`) - nothing starts
  the Next dashboard, so all 13 get `ERR_CONNECTION_REFUSED`. The historical "127/127" (G6-G9) relied
  on the operator's separate dev web (garrison), never committed.
- **band2 (4 specs) retired-protocol.** `artifacts-apps-section, artifact-backend-panel,
  update-from-bundle, vertical-profile` (SUITE_LEDGER `playwright.band2_fixture_swap`; a 5th,
  `onboarding`, is listed there too - see §3 note). Their `action()` helper POSTs to
  `/api/v1/action`, the FIXED-2-RETIRED action protocol (no such route; the contract test asserts it
  absent). The api returns an Express HTML 404, so `JSON.parse` throws `Unexpected token '<'` in
  `beforeAll` - failing regardless of the web dashboard. band2 additionally drives the dashboard UI,
  so it ALSO depends on the band1 web bring-up.
- **erp-fork (4 node drivers) - OUT OF SCOPE.** `erp-auth-ui, erp-crm-persistence, erp-kyc,
  erp-ops-persistence` need the out-of-catalog brasilsalomão tenant fork (app-sso email login + CRM +
  KYC + ops), which the committed `erp-imobiliario` (accessCode gate, no such surfaces) does not
  provide. Retargeted `G9 -> CUTOVER` at G12; reconstituting the fork is founder-gated cutover work
  (spec §14.1 reference-access, §14.4). This brief does NOT address it; the drivers stay
  `skipped (awaiting CUTOVER)`, printed and censused, never silently green.

## 2. Full-stack harness (band1 fix)

**Recommendation: add a NEW lane `npm run e2e:full` (`scripts/e2e-full.mjs`); do NOT overload
`e2e:server`.** Justification: (a) `e2e:server` stays the fast api-only per-PR gate (band3 + drivers +
contract, no `next dev` cold-compile cost); (b) `e2e:full` is the heavier full-stack superset adding
band1+band2 + the dashboard, runnable on an opt-in/nightly cadence (or per-PR once boot reliability is
proven) without its flake blocking the fast lane.

**Process topology (reuse the PROVEN pattern verbatim from `docs/release/probes/boot-b.mjs` and
`.claude/skills/run-ekoa-code/driver.mjs`):**
- **api** internal `:4211` - `node scripts/dev-api.mjs --built` with `PORT=4211` over an ephemeral
  `mongodb-memory-server` (`dev-api.mjs:27,45`; seeded admin `dev-api.mjs:47-55`).
- **CORS proxy** `:4111` (the `backend.port` the web bundle + node drivers resolve to) - the
  zero-dependency reverse proxy that reflects `Origin`, allows the `Authorization` header, and
  forwards websocket upgrades (`driver.mjs:111-166`, identical block at `boot-b.mjs:164-218`). Needed
  because the api ships no CORS middleware (prod is same-origin behind an edge proxy).
- **web** `next dev` `:3000` with `NEXT_PUBLIC_API_URL=http://localhost:4111` - satisfies the CSP
  `connect-src` computed in `next.config.ts` AND points the browser at the proxy (`driver.mjs:168-178`).
- **readiness gates (deterministic):** api `/health` on `:4211` (60s) -> proxy `/health` on `:4111`
  (10s) -> web `/login` on `:3000` (180s cold compile) (`driver.mjs:181-197`); THEN the featured
  prebuild line `"[featured-builder] built "` (`e2e-with-server.mjs:83`, `PREBUILD_TIMEOUT_MS` 10min)
  - band2 `artifact-backend-panel`/`artifacts-apps-section` need real bundles, not placeholders.
- **env:** dev-only `ENCRYPTION_KEY`/`JWT_SECRET`/`EKOA_ADMIN_*` (`dev-api.mjs:47-55`).
- **teardown:** SIGTERM children + `proxyServer.close()` + `mem.stop()`, SIGKILL after 1500ms
  (`driver.mjs:219-228`); exit with the runner's code (`e2e-with-server.mjs:96-102`).
- After READY, run `node scripts/suite-ledger-run.mjs --run` with `EKOA_E2E_WEB=1` (see the tag
  mechanism below). Playwright `baseURL` already resolves to `:3000` for the dashboard specs.

**Which band1 specs run unmodified:** all 13. They are byte-frozen (ekoa-testing: ported specs are
NEVER edited to pass; a band1 red is a product defect). The harness change alone makes them green.

**Tag/annotation mechanism (smallest that respects the no-edit rule):** add a boolean
`needsWeb: true` to the `band1_zero_change` and `band2_fixture_swap` entries in `SUITE_LEDGER.json`.
`scripts/suite-ledger-run.mjs` reads `EKOA_E2E_WEB`: when unset (the `e2e:server` path) it prints
`needsWeb` DUE specs as `skipped (web lane - run npm run e2e:full)` (printed + reasoned + censused,
exactly the CUTOVER-skip pattern at `suite-ledger-run.mjs:204`, NOT a silent pass) and does not fail;
when `EKOA_E2E_WEB=1` (the `e2e:full` path) it runs them and a red fails the lane. An in-spec
Playwright `@web` tag is rejected: band1 specs cannot be edited, and the ledger already partitions by
band, so a per-band flag is strictly smaller. The two-way census (files on disk == ledger list)
still counts every spec.

## 3. Band2 REST migration (call-by-call)

Every `action(app, intent, params)` helper (identical body across the 4 specs, e.g.
`artifacts-apps-section.spec.ts:29-36`) POSTs `{app, intent, params, request_id}` to
`/api/v1/action` and reads a `{success, data}` envelope. Replace the helper with the typed REST
transport (or `docs/release/probes/_lib.mjs` `api()` shape): each row below is a plain HTTP call
returning the value DIRECTLY (no `success`/`data` envelope). Auth is `Authorization: Bearer <token>`.
band2 is `fixture_swap` (ledger note: "assertions unchanged; seeding-helper bodies rewritten to ch03
REST") - editing these helper bodies is sanctioned; the user-visible assertions stay.

| # | action() call | REST replacement | Response / assertion change |
|---|---------------|------------------|-----------------------------|
| 1 | `ekoa.auth` / `login {username,password}` | `POST /api/v1/auth/login` body `{username,password}` | 200 `LoginResponse {token,user}`. `res.success` -> HTTP 200; `res.data.token` -> `res.token` (`shared/src/auth.ts:32-38`, 92-97). |
| 2 | `ekoa.templates` / `list-instances {}` | `GET /api/v1/artifacts` | 200 `{items, featured}`. `res.data.featured` -> `res.featured`; `res.data.instances` -> `res.items` (`artifacts.ts:73-76`). |
| 3 | `ekoa.templates` / `import-instance {bundle}` | `POST /api/v1/artifacts/import` body `{bundle}` | 201 `Artifact`. `res.data.id/slug` -> `res.id/res.slug`. **BUNDLE SHAPE CHANGES** (see note A). |
| 4 | `ekoa.templates` / `delete-instance {id}` | `DELETE /api/v1/artifacts/:id` | 200 `{ok:true}` (`artifacts.ts:115-124`). Envelope removed. |
| 5 | `ekoa.templates` / `get-instance {id}` | `GET /api/v1/artifacts/:id` | 200 `artifactView` - **NO `data` bag** (see note B). `res.data.data` has NO equivalent. |
| 6 | `ekoa.templates` / `update-instance {id,data}` | `PATCH /api/v1/artifacts/:id` body `{data}` | 200 `artifactView`. `data` PATCH MERGES (`artifacts-service.ts:99-104`), matching old merge semantics - BUT reserved keys stripped (note B). |
| 7 | `ekoa.templates` / `versions-list {artifactId}` | `GET /api/v1/artifacts/:id/versions` | 200 `{items:[{sha,message,author,createdAt}]}`. `res.data.versions` -> `res.items`; `.message` carries `'update from bundle'` + `'pre-update snapshot'` (`artifact-bundle.ts:214,245`). |
| 8 | `ekoa.artifact-backend` / `run-sample {id,entrypoint,input}` | `POST /api/v1/artifacts/:id/backend/sample-run` body `{entrypoint,input}` | 200 `{result, dryRunEffects?}` (`artifacts.ts:357-367`). `r.data.result.ok` -> `r.result.ok`. |
| 9 | `ekoa.settings` / `update {general:{vertical}}` | `PATCH /api/v1/settings` body `{...}` | **NO REST EQUIVALENT FIELD** (see note C). |

**Note A (import bundle rewrite, load-bearing).** The specs' `makeBundle` emits the OLD shape
`{schemaVersion, manifest:{id,name,version,entryPoint,outputDir,type,extends}, scaffold:[{path,
contentB64}], ...}`. The new `ArtifactBundle` (`shared/src/artifacts.ts:58-68`, consumed at
`artifact-bundle.ts:112-116,137,158`) is `{manifestId, name?, slug?, files:[{path, content}], data?,
version?}`: `manifest.id`->`manifestId`, `manifest.name`->`name`, `manifest.version`->`version`,
`scaffold[].contentB64` (base64) -> `files[].content` (PLAINTEXT utf-8). Each `makeBundle` must be
rewritten. **Verify** whether the build still needs `type:'jsx-app'`/`extends:'app-auth-persistent'`/
`entryPoint` - the new import stamps only id+name into `manifest.json` (`artifact-bundle.ts:122-127`);
if the esbuild path needs those, carry them as a `manifest.json` entry inside `files`.

**Note B (no REST read/write path for the featured-update badge - HONEST FLAG).**
`artifactView` (`artifacts-service.ts:51-53`) never returns the `data` bag, and NO artifacts response
includes it (`artifacts.ts:75,89,95,112,142`). AND `updateAvailable`+`customized` are in
`RESERVED_ARTIFACT_DATA_KEYS` (`artifacts-service.ts:34-38`), stripped at the PATCH boundary. So the
`artifacts-apps-section` badge test (rows 5+6) can NEITHER plant `updateAvailable` via `update-instance`
NOR read back `data.ignoredVersion`/`data.updateAvailable`. The badge dismissal itself is a UI click
mapping to `POST /api/v1/artifacts/:id/featured-update/ignore` (`artifacts.ts:177-182`,
`artifact-featured-update.ts:165-180`, which stamps `ignoredVersion`). This is a product-surface gap,
not a transport swap: the implementer must either (a) seed `updateAvailable` through a server-side/
test-only featured-update path and add an owner read that exposes `data` (stripping reserved keys), or
(b) restructure the test to assert only the UI outcome (badge visible -> keep -> toast -> badge gone).
Escalate to the director; do not fake it.

**Note C (vertical-profile has no REST setup path - HONEST FLAG).** There is NO `vertical` and NO
`general` field anywhere in `shared/src/` or the settings/org routers (grep clean). The rebuild's
`PlatformSettingsPatch` (`shared/src/settings.ts:29-35`) is `{integration:{pipedreamEnabled?}}` only.
The whole `vertical-profile` spec (chat legal prompts, login tagline, Juridico cards floated first)
hangs off `settings.general.vertical='legal'`, which the contract dropped. Before this spec can
migrate the implementer must determine how the rebuild configures the legal vertical (seed-time?
different surface? retired?) - this is MORE than a transport swap. Flag to the director; the spec may
need a rewrite or a documented retirement, not a fixture swap.

**Note D (onboarding, the ledger's 5th band2 spec).** `web/e2e/onboarding.spec.ts:61` also POSTs
`/api/v1/action` and additionally stubs `POST /api/v1/chat/runs` and calls `ekoa.sessions delete`
(`onboarding.spec.ts:91,186`). The brief scopes the table to the 4 named specs, but onboarding needs
the same `action()`->REST migration (`ekoa.sessions delete` -> `DELETE /api/v1/sessions/:id`) plus one
chat-run stub swap. Include it or explicitly defer it; do not leave it a silent band2 red.

## 4. Journey suite fold-in

The Boot-A probes (`docs/release/probes/*.mjs`, `_lib.mjs` helpers) are standalone Node scripts that
hit `:4111` and emit `PASS|FAIL|INFO <id>` + write evidence to `docs/release/evidence/<journey>/`
(`BOOT-A-SUMMARY.md`). Fold them into two permanent lanes:

- **Credential-less lane `npm run journeys:credless` (per-PR capable).** New `scripts/journeys-run.mjs`
  boots the api ONLY (`dev-api.mjs`, `:4111`, uncredentialed = Boot-A), waits `DEV-API READY`, runs
  each of `j1-auth, j5-isolation, j8-webhooks, j0-honest-degradation, j9-baseline, contract-sweep`,
  captures stdout, tears down. These are LLM-free + credential-free + deterministic (they hit the api
  server-side; no web, no proxy needed). **Gate semantics:** the wrapper FAILS the lane if any probe
  emits a `FAIL` line; `INFO`/`PASS` pass (INFO = recorded observation, not a defect - `_lib.mjs`
  semantics unchanged). This makes evidence probes a per-PR regression gate without editing them.
  Evidence regenerates under `docs/release/evidence/`.
- **Credentialed lane `npm run journeys:credentialed` (opt-in; NEVER a per-PR CI gate).** Boots
  `docs/release/probes/boot-b.mjs` (reads the operator's Claude Code OAuth from the macOS Keychain,
  seeds it encrypted into mem-mongo, full stack api `:4211`/proxy `:4111`/web `:3000`) and runs the
  credentialed journeys. Requires a real operator credential + real model egress (cost +
  nondeterminism), so it stays opt-in. FLAG: only `boot-b.mjs` and the 6 credless probes are
  committed; the `j2/j3/j4/j6` probe files referenced for this lane DO NOT YET EXIST - they are
  to-be-authored; the lane initially wires `boot-b.mjs up` + whatever credentialed probes exist.

**Ledger wiring (ekoa-testing §14.2.5 census discipline).** Add a `journeys` section to
`SUITE_LEDGER.json` with two lanes, each listing its member probe files + a `perPr` flag
(`credless: perPr:true`, `credentialed: perPr:false`). Keep a two-way census (probe files on disk ==
ledger list). Do NOT ratchet the journeys (they are layer-2/3 evidence, not byte-compat ports) and do
NOT run them through `suite-ledger-run.mjs` (they are separate npm-script lanes, like `ci:lane` vs
`e2e`). npm scripts: `journeys:credless`, `journeys:credentialed`.

## 5. Acceptance criteria (measurable)

1. `npm run e2e:full` on a CLEAN checkout (no operator dev env, no local fork) boots api+proxy+web
   deterministically and exits 0 with all 13 band1 specs green.
2. The 4 band2 specs green under `e2e:full` on committed content, OR each un-migratable assertion
   (notes B/C) resolved by a named product change or documented as a director-approved restructure/
   retirement. band2 `makeBundle` rewritten to the new `ArtifactBundle` shape; no `/api/v1/action`
   reference remains in `web/e2e/` (grep clean).
3. `npm run e2e:server` stays green api-only: band3 (37 served-app) + node drivers + contract; band1
   + band2 print `skipped (web lane)` (not red, not silent).
4. `npm run journeys:credless` exits 0 on a clean checkout, 6 probes run, zero `FAIL` lines; evidence
   regenerated under `docs/release/evidence/`.
5. `SUITE_LEDGER.json`: `band1_zero_change` + `band2_fixture_swap` carry `needsWeb:true`; a `journeys`
   section lists both lanes with `perPr` flags; two-way census matches; ratchet holds; the 4 `erp-*`
   drivers stay `CUTOVER` (unchanged); credentialed journeys `perPr:false`.
6. Honestly deferred (unchanged): erp-fork -> CUTOVER; credentialed journeys + `j2/j3/j4/j6` (need
   operator credential); any band2 note-B/C assertion the director rules out of scope.

## 6. Estimated scope

**Created (~2 files + scripts):** `scripts/e2e-full.mjs` (~120 lines, adapted from `boot-b.mjs`/
`driver.mjs`); `scripts/journeys-run.mjs` (~90 lines); 3 npm scripts (`e2e:full`, `journeys:credless`,
`journeys:credentialed`).
**Modified:** `scripts/suite-ledger-run.mjs` (`needsWeb` + `EKOA_E2E_WEB` gate, ~30 lines);
`SUITE_LEDGER.json` (`needsWeb` flags + `journeys` section); the 4 (or 5 with onboarding) band2 spec
helper bodies (`action()` -> typed REST + `makeBundle` rewrite; ~40-80 lines each - the ONLY
ported-spec edits, sanctioned because band2 is `fixture_swap`, NOT band1 no-edit); `package.json`.
**Risks:** (a) `next dev` cold compile can exceed the 180s `/login` gate on a cold machine -> CI
timeout; consider a `next build && next start` variant for the lane. (b) `mongodb-memory-server`
cold-start / colima flake (`dev-api.mjs:45` `launchTimeout 60_000` + the retry in
`api/tests/helpers/mongo-mem.ts` already mitigate). (c) featured prebuild can take minutes
(`PREBUILD_TIMEOUT_MS` 10min); band2 backend/apps-section depend on it. (d) notes B/C are
product-surface gaps, not transport swaps - the single largest scope risk; sequence a director
decision before coding those two specs.
