# 05 - Refresh + browser topology (BRIEF tracks 1-5 delta over the 20260712 analyses)

Run `20260717-190134-9d4c1cbf`, slice A1. Read-only delta pass: the four committed analyses of run
`20260712-150958-4bb23640` were spot-checked against TODAY's main (branch `mega-run` = main @ 52d586f
plus run-doc-only commits; `git diff main..mega-run` touches no source). Both the operator run
(20260712, slices B-H landed AFTER those analyses were written) and the gateway run (20260717-071930,
S1-S7) sit between the old analyses and today's tree. All paths under `/Users/ggomes/dev/ekoa-code`.

---

## 1. Refresh verdicts per standing analysis

### 1.1 `analysis/01-automations-actions.md` - STILL TRUE (line drift only, one claim re-scoped)

- **9-value `StepType` union** - still true; now `api/src/automation/types.ts:159-167` (cited 159-168).
- **Engine dispatch switch** - still true; cases at `api/src/automation/engine.ts:1158-1272` (cited 1157-1292).
- **17-op primitive union** - still true, unchanged at `api/src/automation/platform-primitives.ts:36-62`.
- **`listEkoaActions` honest-empty** - still true, moved `api/src/server.ts:402` -> `server.ts:425`
  (`listEkoaActions: async () => []`). The data-plane capability catalog still advertises nothing.
- **"`automation/` never calls `logActivity`"** - still grep-negative, still true. The predicted "new
  audit-path usage" has since materialized outside `automation/`: `api/src/apps/assistant-tools.ts:93`
  logs category `app-assistant`, type `action.<outcome>` through the single `logActivity` path.
- **DRIFT (re-scope, not contradiction): Q3 "automations cannot drive a generated app's UI in-page"** -
  still true FOR THE AUTOMATION ENGINE (no in-page dispatch step type landed), but the platform-wide
  absence the section implied is gone: the in-page UI action plane now exists
  (`shared/src/action-manifest.ts:76-88` `AppActionManifest`, `api/assets/action-runtime-client.js`,
  `api/assets/panel-runtime/`), driven by the served-app assistant panel, not by automations.

### 1.2 `analysis/02-demos-tutorials.md` - DRIFTED (the planned extensions landed, in a different shape)

- **Spec format + validator survive** - `version: z.literal(1)` now `api/src/services/demo-registry.ts:141`
  (cited 125); six step types intact.
- **DRIFT: `tourId` + `kind` landed** - optional, additive, `demo-registry.ts:149-150`. But the registry
  key was NOT changed to `(appId, tourId)`: `getDemoSpec` is still first-match-by-appId
  (`demo-registry.ts:290-292`) and `GET /api/demos/:appId` still returns ONE spec
  (`api/src/apps/serving.ts:534-542`). Multi-tour took a different shape: generated tours live on the
  artifact data bag (`artifact.data.tours`, operator-run E1), validated by `parseStoredTours`
  (`demo-registry.ts:308`), resolved by the serving route and the in-app panel player.
- **DRIFT: the "one net-new component" (same-document player) landed** - `api/assets/panel-runtime/`
  built to `panel-runtime.js`, served as a lazy runtime asset (operator-run G2). New route
  `GET /api/demos/:appId/availability` (`serving.ts:529-533`) is the panel teach launcher's probe, so
  the "launcher is a URL contract, not UI" claim is superseded.
- **Still true: the duplicate-catalog hazard is UNRESOLVED** - `api/assets/demos/` and `ekoa-data/demos/`
  both exist, both now 29 specs (was 28). The memo's "collapse before generation lands" did not happen.
- **Still true: `placement` remains latent** - no `placement` in `demo-registry.ts` (grep-negative).

### 1.3 `analysis/03-knowledge-hooks.md` - DRIFTED (F1 + D1 shipped exactly along its recommendations)

- **Grounding core still true** - `GroundingInput`/`kind` at `api/src/knowledge/grounding.ts:40-48`;
  build legal-gate now `grounding.ts:66` (cited 63-69); chat-always/build-legal mapping unchanged at
  `api/src/server.ts:221-223`.
- **DRIFT: "`/api/app-assistant` contract exists but no route implements it" is now FALSE** -
  `api/src/apps/app-assistant-route.ts` implements `POST /api/app-assistant` +
  `GET /api/app-assistant/whoami` (operator-run D1/H2), with org + billing from the server-resolved
  OWNER, never the visitor (route header, lines 1-18) - the analysis's prescribed design, landed.
- **DRIFT: F1 mid-build ingest landed as a seam, not the predicted direct call** -
  `ingestBuildKnowledge` seam (`api/src/agents/seams.ts:95`, honest-empty default at `:91`), bound at
  `server.ts:228-236` to `ingestDocument` (refuses `_shared`, immediate index). The build grounding
  call moved `build.ts:347` -> `api/src/agents/build.ts:416`.

### 1.4 `analysis/04-internal-templates.md` - HEAVILY DRIFTED (the dropped base system was reconnected)

- **"No loader / `templateScaffoldFiles` fed by nobody / `templateId` discarded" - all three now FALSE.**
  `api/src/apps/base-loader.ts` exists (`loadBase` at `:99`, ported per its own header `:6`);
  `api/src/apps/build-mechanics.ts:81-90` consumes `templateId` (explicit base wins fail-loud, else
  classification via `baseForType`); `build-mechanics.ts:179` feeds
  `templateScaffoldFiles: baseProjectFiles(base)` into `scaffoldApp`; a selection step exists
  (`selectBaseTemplate`, `api/src/agents/guided-build.ts:84`).
- **Base set grew** - `api/assets/bases/` now has a NEW `app` base (full scaffold/wiring/skills/
  recipes/layouts) alongside the original five + `CSS_VARS_CONTRACT.md`.
- **The token-tax baseline is STALE** - `api/content/coding-agent/SKILL.md` shrank 12,722 -> 10,546
  bytes. The measured ~3,780-token standing prompt / ~2,700-token structural figure no longer
  describes today's build prompt; treat it as historical.

---

## 2. Track 1 delta - browser-context topology inventory (plumbing only)

Where an automation's Playwright/browser context actually RUNS today:

- **Executor face.** The engine drives an abstract `BrowserSession`
  (`api/src/automation/browser-session.ts:72-110`); two implementations exist.
- **Selection, per run** (`api/src/automation/engine.ts:329-356`): `getDaemonConnection(ownerUserId)`
  -> `DaemonBrowserSession` when a daemon is dialed in; else `LocalBrowserSession` when
  `loadAutomationConfig().localBrowserEnabled`; else `null` and any browser step halts the run in
  `awaiting_daemon`. The session is created lazily on first browser use (`engine.ts:339-341`).
- **Daemon-backed path (plumbed, transport-absent).** `DaemonConnection.runStep` dispatches a resolved
  action / bash command and returns an observation envelope (`api/src/automation/seams.ts:44-62`).
  The resolver is NEVER BOUND on today's main: `setDaemonConnectionResolver` stays on its null default -
  `api/src/server.ts:432` ("the bridge lands at G8A"). `api/src/bridge/` exists but is the Pi-loop LLM
  provider plane (`bridge/provider.ts:1-17`: `provider_request` frames -> the `llm/` chokepoint) plus
  pairing registry/token/delegation; nothing in it constructs a `DaemonConnection`.
- **In-process fallback - the ONLY live browser path today.** `LocalBrowserSession`
  (`api/src/automation/local-browser-session.ts:76`) runs resolved actions through the intact
  page-level runner `executor.ts` against a context from the `getLocalBrowserContext` seam
  (`seams.ts:304-315`), which `server.ts:428-431` binds to the shared headless-Chromium pool:
  `api/src/services/browser-pool.ts` `getSharedBrowser()` (one lazy
  `chromium.launch({ headless: true })` per API process, `:20-33`) + a FRESH `newContext()` per
  acquisition. Note a comment drift: `local-browser-session.ts:9-10` and `seams.ts:297-299` describe a
  "persistent per-owner stealth context from automation-browser.ts" - no such module exists; the
  actual binding is fresh contexts off the shared pool.
- **Hosted vs local, net:** gate `localBrowserEnabled` = `EKOA_AUTOMATION_LOCAL_BROWSER`, default ON
  in dev / OFF in prod (`api/src/automation/config.ts:41`). So dev = in-process Chromium inside the
  hosted API process; prod = NO browser plane at all (daemon unbound + fallback off -> every browser
  step halts `awaiting_daemon`). `local_command` has the same daemon dependency and NO in-process
  fallback (`api/src/automation/executors/local-command.ts:115-133`).
- **Credentials:** integration-captured `storageState` is injected only into the LOCAL session; the
  daemon path deliberately does not forward it ("the bridge protocol has no cookie channel yet",
  `engine.ts:344-351`). Vision/planning stays hosted through `api/src/llm/` on either plane; the page
  fingerprint is computed hosted-side from the observation (`browser-session.ts:101-102`).

---

## 3. Track 5 - integrations -> automations routing today (plumbing only)

- **Do integrations invoke browser automation? YES - one path.** An integration action whose
  definition carries `automationBinding` (+ optional `passCredentials`,
  `api/src/integrations/definitions.ts:57`) is delegated by the action runner to an INJECTED handler
  (`api/src/integrations/action-executor.ts` header, lines 14-17); the composition root binds that
  handler (`api/src/server.ts:337-347`) to `runAutomationForAction`
  (`api/src/automation/service.ts:660-700`), which owner-checks the bound automation and runs it via
  `runAutomation`. `passCredentials` nests decrypted credential fields under `inputs.credentials`;
  a `storageState` there reaches only the local browser session (section 2). Whether a browser is
  involved depends on the bound automation's steps - the binding itself is step-type-agnostic.
- **Provisioning, not invocation:** integration packages also materialize automation TEMPLATES
  (`api/src/automation/integration-automations.ts:1-13`, deterministic id
  `<integrationKey>-<templateKey>`, caller = routes).
- **Reverse direction is seam-injected the same way:** engine `integration` steps and the
  `integration.call` recipe primitive reach integrations only through
  `executeIntegrationAction` / `callPlatformIntegration` (`automation/seams.ts:96,128`;
  `platform-primitives.ts:13,143`), bound at `server.ts:325-359`. Neither sibling imports the other;
  every crossing meets at the `server.ts` composition block (~`:320-360`).
- **Where a single shared consumption seam would sit - candidate locations only, no design:**
  (a) the `server.ts` seam-wiring block (~`:320-360`), already the de-facto junction of both
  directions - the natural place to collapse the two directional callbacks into one surface;
  (b) `api/src/integrations/service.ts` `executeUserIntegrationAction`, the single execution core all
  three consumer planes funnel into today (automation steps, agent catalog tools, the app plane via
  `/api/v1/action` + `integration.call` recipes);
  (c) the automation-side face `automation/seams.ts:91-135`, which a unified seam would subsume.

---

## 4. Standing-memo check (do the three 20260712 memos still bind on today's main?)

**`memos/registry.md` - binds unchanged.** The registry was built exactly as decided: a new
client-plane component (`shared/src/action-manifest.ts:76-88`, `action-runtime-client.js`,
`panel-runtime`), the automation engine and `platform-primitives.ts` untouched (op union and dispatch
verified unchanged, section 1.1), registry actions auditing through `logActivity` with the new
`app-assistant` kind (`apps/assistant-tools.ts:93`). The migration the memo deferred remains deferred:
`listEkoaActions` is still the honest empty (`server.ts:425`), so the two planes still do not share
one catalog - precisely the memo's "documented path, not executed" posture. Nothing contradicts it.

**`memos/tour-format.md` - binds, with one shape refinement.** Reuse-wholesale held (validator,
PUBLIC routes, bridge, iframe player all intact) and both bounded extensions landed - but extension 1
landed as optional `tourId`/`kind` fields on v1 (`demo-registry.ts:149-150`) plus generated tours on
`artifact.data.tours` via `parseStoredTours` (`demo-registry.ts:308`), NOT as a rekeyed
`(appId, tourId)` registry with a list-returning `/api/demos/:appId` (still single-spec,
`serving.ts:534-542`). The one net-new same-document player shipped (`panel-runtime`). Two memo
obligations remain OPEN: the duplicate spec catalog was never collapsed (29 = 29 in both dirs) and
`placement` is still latent. The memo's decision stands; its drift-hazard list is still live work.

**`memos/base-set.md` - executed; binds as done rather than pending.** The loader was ported
(`api/src/apps/base-loader.ts`), `templateId` is consumed with fail-loud explicit selection
(`build-mechanics.ts:81-90`), scaffolds feed through `templateScaffoldFiles`
(`build-mechanics.ts:179`), and the planned NEW `app` base exists with a real scaffold alongside
`document` (`api/assets/bases/app/`). Consequence: the memo's measured bar (~2,700 structural tokens)
is now historical - `SKILL.md` already shrank 12,722 -> 10,546 bytes - so any future shrink claim must
re-measure against today's prompt, not the 20260712 number.
