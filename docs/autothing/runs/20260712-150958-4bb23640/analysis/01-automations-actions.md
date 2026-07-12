# A1 — Automations layer + existing action primitives (verified analysis)

Run `20260712-150958-4bb23640`, slice A1. Read-only pass over `api/src/automation/**` + the composition-root wiring in `api/src/server.ts` + the coding-agent SKILL. Every claim below cites an absolute path + line. Where something does **not** exist I say so explicitly rather than infer it.

Bottom line, up front:
- The automation engine can invoke a **closed 9-value step vocabulary** across two execution planes: a **vision+Playwright browser plane** (drives *external* sites) and a **deterministic server-side plane** (integration calls, sub-automations, HTTP, local shell, and the `ekoa_action` app-data primitive).
- The **"ekoa action" data-plane primitive exists and is real** (`platform-primitives.ts` + `manifest-parser.ts` + `executors/ekoa-action.ts`), fully wired to app-data and artifact resolution at the composition root — **but** it operates on app **DATA**, never UI, its capability-discovery seam is wired to an honest empty (`listEkoaActions: async () => []`), and **no code generates the `MANIFEST.md` it reads** (the coding agent is merely *instructed* to author one).
- Automations **cannot drive a generated app's UI in-page today**. There is no in-page JS/registry/postMessage dispatch anywhere in `automation/`. The only way to touch a served app's *UI* is to navigate to `/apps/<slug>/` and drive it *as an external website* through the vision tier.
- Audit: the single audit write path is `logActivity` (`api/src/data/activity.ts`), **and the automation engine does not call it at all**. Automation runs record to their own `automation_runs` store as `RunRecord.steps` + per-step PNG screenshots, streamed over SSE — a self-contained run ledger that sits *outside* the global activity audit.
- This **confirms RUN_SPEC assumption 1** (registry as foundation, unify at the MANIFEST level, automations engine untouched this run) **with evidence**: the primitives are a server-side data-plane interpreter; UI driving is a client-side plane; they are genuinely different execution planes and share only the per-app *manifest* as a unification point.

---

## Q1 — What can the automations area invoke today?

### 1.1 The step/action vocabulary (closed union)

`StepType` is a closed 9-member union — `api/src/automation/types.ts:159-168`:

```
'browser' | 'verify' | 'integration' | 'sub_automation' |
'navigate' | 'wait' | 'local_command' | 'api_call' | 'ekoa_action'
```

The same whitelist is mirrored defensively where integration packages materialize automation templates — `api/src/automation/integration-automations.ts:19-22` (`STEP_TYPES` set). A `Step` (`types.ts:241-272`) is plain-English (`description`, `expectedOutcome`) plus type-discriminated extras: `url` (navigate), `durationMs` (wait), `integrationKey`/`integrationAction`/`argsTemplate` (integration), `subAutomationId` (sub_automation), `commandTemplate: LocalCommandSpec` (local_command), `apiRequest: ApiCallSpec` (api_call), `ekoaAction: EkoaActionSpec` (ekoa_action), `cachedAssertion: PlaywrightAssertion` (verify).

### 1.2 How a step executes — two planes

The engine dispatches on `step.type` in one switch — `api/src/automation/engine.ts:1157-1292`. Two distinct execution planes:

**A. Vision + Playwright browser plane** (needs a browser — daemon-backed or in-process Chromium fallback):
- `navigate` (`engine.ts:1158-1173`) and `wait` (`1175-1183`) — deterministic `browser.act(...)` calls, no model.
- `browser` (`1244-1247`) → `executeBrowserStep` (`engine.ts:1332+`) and `verify` (`1249-1252`) → `executeVerifyStep`. These run a **three-tier resolve loop** documented at `engine.ts:1-22`: (1) **cache replay** of a previously-resolved `PlaywrightAction`; (2) on miss/failure, **vision resolution** pinned to the EXPERT tier at max effort (`resolvePlaywrightAction`, invoked at `engine.ts:1386`), which returns a concrete `PlaywrightAction`; (3) low-confidence vision → **surface/refuse** rather than guess (`engine.ts:1408-1421`). The tier recorded is `cache` / `vision` / `cache-then-vision` (`types.ts:338`).
- The **pure deterministic Playwright runner** is `api/src/automation/executor.ts` — `executePlaywrightAction` (`executor.ts:164-261`) handles `navigate/click/dblclick/fill/press/select/check/uncheck/hover/wait/wait_for/scroll/screenshot/noop`, with a locator fallback ladder (`resolveWithLadder`, `executor.ts:63-84`). `executePlaywrightAssertion` (`executor.ts:270-310`) handles `expect_visible/hidden/text/url/title`. This module has **no vision, no cache, no LLM** — the engine feeds it a resolved action (`executor.ts:1-11`).
- All model access on this plane goes through `api/src/llm/` (`vision.ts`, `planner.ts`, `rehearsal.ts`) — never the executor (`seams.ts:13-15`, `engine.ts:12-22`, FIXED-3).

**B. Deterministic server-side plane** (no browser, no model):
- `integration` (`engine.ts:1201-1242`) — calls `executeIntegrationAction` (user skills) or `callPlatformIntegration` (Google Workspace / Microsoft 365) through injected seams; "not connected" → `awaiting_integration`.
- `sub_automation` (`engine.ts:1185-1199`) — recursive `runAutomation` with a `parentRunId` link and a visited-set for cycle safety.
- `local_command` (`engine.ts:1254-1262`) → `executors/local-command.ts` — argv-array commands run on the **user's machine via the local daemon's `bash` capability** over the bridge control channel (`local-command.ts:1-18`); first use of a new command *shape* requires one-time consent.
- `api_call` (`engine.ts:1264-1270`) → `executors/api-call.ts` — HTTP via native `fetch`, auth-shaped headers routed through `authIntegrationKey` credential injection (`api-call.ts:1-10`).
- `ekoa_action` (`engine.ts:1272-1278`) → `executors/ekoa-action.ts` — the app-data primitive interpreter (see Q2).

### 1.3 The cache

Two type layers (`types.ts:1-15`): the user-facing spec (`Automation`, `Step`, plain English) and a hidden **cache layer** — `Locator` (`types.ts:26-34`), `PlaywrightAction` (`46-66`), `PlaywrightAssertion` (`126-131`), `PageFingerprint` (`145-153`). Vision resolves an action on cache miss and it is persisted against the `(automationId, stepId, fingerprint)` key and replayed deterministically next run; the cache is memory-backed (`api/src/automation/cache.ts`, exported `evictCacheForFingerprint` at `index.ts:96`). `PageFingerprint` mixes origin + pathname + title-hash + heading-hash + DOM-shape-hash so SPA template reuse still caches while cross-entity states don't false-hit (`types.ts:137-153`). Non-browser step types cache their *resolved request shape* (`LocalCommandResolved`, `ApiCallResolved`, `EkoaActionResolved` — `types.ts:77-114`) but **never** their responses.

### 1.4 The catalog (what agents are told they can invoke)

`api/src/automation/catalog.ts` builds the "available capabilities" block injected into the planner + chat/coding-agent system prompts. `buildAutomationCatalog` (`catalog.ts:75-81`) returns four sections: `automations`, `integrationActions`, `connectedAccounts`, `ekoaActions`. `formatCatalogForPrompt` (`catalog.ts:202-305`) renders them and tells agents to use the `call_automation` / `call_integration_action` / `call_ekoa_action` tools (and `list_*` for the tail beyond the 25-entry cap). **Note the gap:** the `ekoaActions` section is populated from the `listEkoaActions` seam, which the composition root wires to an empty (see Q2.5) — so today the catalog advertises no app capabilities.

---

## Q2 — Does an "ekoa action" primitive exist? YES. (Verified, precise.)

Confirmed. It is a **server-side, deterministic, data-plane** primitive layer. Documented intent at `platform-primitives.ts:1-10`: *"Everything here is fully deterministic — no LLM in the loop, no vision, no browser. Recipes are content; this module is the interpreter."*

### 2.1 The full `PlatformPrimitive` op list

`api/src/automation/platform-primitives.ts:36-62` — the closed union (17 ops in 5 groups):

| Group | Ops | Line |
|---|---|---|
| JSON store | `store.list`, `store.get`, `store.create`, `store.update`, `store.delete`, `store.query` | 37-43 |
| Integration / cross-artifact | `integration.call`, `artifact.invoke` | 45-47 |
| Pure data | `data.validate`, `data.generate_id`, `data.now`, `data.format`, `data.assign` | 49-54 |
| File | `file.read`, `file.write` | 56-58 |
| Flow control | `flow.fail`, `flow.if` (with `then`/`else` nested recipes) | 60-62 |

Supporting shapes: `SimpleQuery` (`store.query` predicate, 8 ops — `platform-primitives.ts:22-26`), `ConditionExpr` (`flow.if` — `28-32`), `ValidateRule` (`email/url/uuid/iso_date/non_empty` — `34`), `TemplateRef` = `"{{inputs.x}}"` / `"{{captured.y}}"` (`20`).

### 2.2 How the interpreter walks a recipe

`executeRecipe(recipe, ctx)` (`platform-primitives.ts:86-90`) walks the array top-to-bottom; `executePrimitive` (`92-247`) is the switch that implements each op. Store ops go through the injected `getAppDataStore()` (`97, 104, 111, 119, 126, 132`); `integration.call` splits platform vs user integrations (`138-161`); `artifact.invoke` recurses into another artifact's capability via a pluggable hook (`162-170`, wired at `executors/ekoa-action.ts:224-242`). Template refs are resolved by `renderRef` (`249-270`) with a hardened credential boundary — a direct `{{inputs.credentials}}` ref returns `undefined` (`260`). Failures throw `EkoaActionFailure` (`77-79`); every op appends an `EkoaActionTraceEntry` whether it succeeds or fails (`99, 240-245`).

### 2.3 How `MANIFEST.md` capabilities are parsed

`api/src/automation/manifest-parser.ts`. `parseManifest(text)` (`86-146`) reads YAML frontmatter (`extractFrontmatter`, `163-170`, computes a SHA-1 `revision` of the frontmatter for cache invalidation) into an `ArtifactManifest` (`64-74`): `name`, `purpose`, `data_model` (collections → fields + `indexed_by`), `external_dependencies` (`integrations`, `artifacts`), and `capabilities[]`. Each `ArtifactManifestCapability` (`45-52`) = `{ name, description, inputs: Record<name, {type, required, ...}>, recipe: PlatformPrimitive[], result_template?, mutates? }`. `getCapability(manifest, name)` (`159-161`) looks one up. **The recipe array is cast, not validated against the primitive union** (`manifest-parser.ts:124-131`) — a malformed op surfaces only at execution as `unknown primitive` (`platform-primitives.ts:233-235`).

The format is documented for the coding agent in `api/content/coding-agent/SKILL.md:100-155` — `MANIFEST.md` is `OBRIGATÓRIO na raiz` (`SKILL.md:37`), with `name/purpose/data_model/external_dependencies/capabilities`, each capability carrying `name/description/inputs/recipe/result_template` (`SKILL.md:107`), including `integration.call` capabilities "executed by the platform" (`SKILL.md:155`).

### 2.4 Which executor walks them + how automations invoke app capabilities today

`api/src/automation/executors/ekoa-action.ts` → `executeEkoaActionStep` (`60-181`):
1. Reads `step.ekoaAction` (`EkoaActionSpec = { artifactSlug, capabilityName, inputs }`, `types.ts:228-233`); missing slug/capability → fail (`64-72`).
2. Resolves `slug → { artifactId, projectDir }`, **org-scoped to the run** so a cross-org artifact is refused (`resolveArtifactProjectDir`, `ekoa-action.ts:76-86, 218-220`; the org check lives in the wired resolver, see Q2.5).
3. Loads `MANIFEST.md` from `projectDir` (`loadManifestFromFile`, `88-111`) — **fails `recoverable:true` with "Ask the coding agent to generate a manifest" if the file is absent** (`91-99`).
4. `getCapability` (`113-123`), drops `credentials` from inputs before the recipe (credential boundary — `126-132`), builds `EkoaActionContext` (`135-142`), and `executeRecipe(capability.recipe, actionCtx)` (`146`).
5. Renders `result_template` (`166, 192-211`) and returns a `StepRecord` with `StepOutput.kind='ekoa_action'` (`168-180`).

`artifact.invoke` is wired to recurse through the same executor (`setInvokeArtifactCapability`, `ekoa-action.ts:224-242`) — org-scoped, in-process, no browser.

**So the ONLY way an automation invokes an app capability today** is an `ekoa_action` *step* inside an automation spec (or, transitively, a capability that itself contains an `integration.call` / `artifact.invoke` primitive). This is server-side direct execution against the app's DATA layer — never the app's runtime/UI (`ekoa-action.ts:1-10`: *"No browser, no app runtime spin-up — server-side direct calls."*).

### 2.5 Composition-root wiring — what's real vs honest-empty

`api/src/server.ts`:
- **Real:** `setAppDataStore(...)` binds the primitives' store to a `CollectionsEngine` (Mongo-backed app-data), scoped via `sharedScope(artifactId, ownerId)` (`server.ts:360-372`). `setArtifactResolver(...)` binds slug→projectDir through `resolveApp` **with the cross-org refusal** (`server.ts:376-382`). So an `ekoa_action` step that targets an existing app with a hand-authored `MANIFEST.md` **works end-to-end today.**
- **Honest-empty (does NOT exist yet):** `listEkoaActions: async () => []` (`server.ts:402`), with the explicit comment that "artifact (ekoa_action) capabilities keep honest empties this gate — the seam carries … no MANIFEST-capability surface exists yet (G9 note)" (`server.ts:383-385`). **Consequence: app capabilities are invocable but not discoverable** — the planner/agent catalog advertises none.

### 2.6 What audit/trace it leaves

`EkoaActionTraceEntry` (`types.ts:384-390`) = `{ op, summary, durationMs, status: 'ok'|'failed', error? }`, e.g. `"store.create clients → id c-8f3a"`. Accumulated into `ctx.trace` by every primitive (`platform-primitives.ts:99` etc.) and surfaced as `StepOutput.kind='ekoa_action'` = `{ trace, result, capturedValues, durationMs }` (`types.ts:373-381`). The resolved form `EkoaActionResolved` (`types.ts:108-114`) snapshots `recipeSnapshot` + `manifestRev` so a changed `MANIFEST.md` invalidates the cache. **This trace lives entirely inside the `RunRecord`, not the global audit log** (see Q5).

### 2.7 The two-manifest gotcha (do not conflate)

There are **two** unrelated manifest concepts:
- **`manifest.json`** — the *build* manifest (`api/src/apps/manifest.ts`): `id/name/version/entryPoint/outputDir/type/dependencies/backend/sharedData/extends`. Written by the coding agent, read by the build tool + registry. **Not** capabilities.
- **`MANIFEST.md`** — the *capability/recipe* manifest (`api/src/automation/manifest-parser.ts`): YAML frontmatter with `data_model` + `capabilities`-as-recipes. Read only by the ekoa_action executor. **No code writes it; there is no generator or build-time validator** — the coding agent is instructed to author it, and its absence is a run-time failure (`ekoa-action.ts:91-99`).

---

## Q3 — Can automations drive GENERATED APPS' UI today (not data — UI)? NO. (Verified.)

Confirmed **NO** for in-page UI driving. Evidence:

- **No in-page dispatch primitive anywhere in `automation/`.** Grep for `page.evaluate` / `postMessage` / `injectedContext` / `demo-bridge` / in-page execution across `api/src/automation/**` returns only `api/src/automation/fingerprint.ts:94-95` — two `page.evaluate` calls that *read* DOM shape (tag/role counts, first heading) to compute a cache fingerprint. That is observation for caching, **not** action dispatch, and it runs against whatever page the browser is on, with no knowledge of a served app's components or state.
- **`ekoa_action` drives DATA, not UI** (Q2.4): it calls the CollectionsEngine directly, server-side, and never spins up the app runtime.
- **The one path that touches a served app's UI treats it as an external website.** `planner.ts:151` and `planner.ts:209` explicitly allow a `navigate`/`browser` step to open the Ekoa app or `/apps/<slug>/` by building the URL from the injected app origin. But that goes through the *same vision+Playwright browser plane* as any third-party site (Q1.2 plane A): screenshot → EXPERT-tier vision → a guessed `PlaywrightAction` with a vision-picked ARIA/CSS locator. There is **no** structured in-page action registry, **no** dispatch through the app's own state layer, and **no** stable registry-ID selectors — exactly the capability the RUN_SPEC sets out to build.

So: an automation *can* click around a generated app the crude way (drive its rendered page as an opaque website via vision), but **UI-level in-page action dispatch does not exist** — which matches the RUN_SPEC's ground-truth note (*"UI-level in-page actions do NOT exist"*, RUN_SPEC line 13).

---

## Q4 — Decision evidence for the A5 memo (extend vs rebuild)

**RUN_SPEC assumption 1** (RUN_SPEC.md:39): *CHOSEN — build the UI action registry as the foundation (per-app manifest of UI commands + in-page runtime on the demo-bridge transport pattern), unify at the MANIFEST level with the existing capability/recipe primitives; automations keep their engine untouched this run (migration is a documented path, not executed). ALTERNATIVE — extend `platform-primitives.ts` into the UI registry (rejected: server-side data-plane ops walked by a server executor vs client-side UI dispatch — different execution plane).*

**Verdict: CONFIRMED with evidence.** The two are genuinely different execution planes, and the only sound unification point is the per-app *manifest*, not the interpreter.

### Evidence AGAINST extending `platform-primitives.ts` into the UI registry
1. **Server vs client execution plane.** `executeRecipe` is a synchronous, in-process Node async loop that resolves against injected server seams (`getAppDataStore`, `executeIntegrationAction`) — `platform-primitives.ts:86-247`. Its own header asserts *"no LLM, no vision, no browser"* (`1-10`). A UI action (`setField`, `toggle`, `navigate` a route) must execute **inside the served app in the browser**, dispatched through the app's state layer (RUN_SPEC criterion 3, line 25). To route that through this interpreter you would need either a live browser round-trip (which the module is explicitly built to avoid) or client-op variants the server cannot execute — both couple the tier-5 server plane to the served-app client plane.
2. **The trace/output contract is server-run-record shaped.** `EkoaActionTraceEntry` + `StepOutput.kind='ekoa_action'` (`types.ts:373-390`) are populated inline as the server walks the recipe. A client-dispatched UI action has no equivalent synchronous server trace; forcing it into this shape misrepresents where the work happened.
3. **The executor already assumes a filesystem project dir + server org resolution** (`ekoa-action.ts:76-111`, `server.ts:376-382`). None of that maps onto in-page dispatch.

### Evidence FOR unifying at the MANIFEST level (and leaving the engine untouched)
1. **`MANIFEST.md` is already a multi-section per-app manifest.** It carries `data_model`, `external_dependencies`, **and** `capabilities` side-by-side (`manifest-parser.ts:64-74`). Adding a UI-actions section alongside data-plane `capabilities` is a natural extension of the same file — precedent for multiple sections already exists.
2. **`ArtifactManifestCapability` is already a clean "named, described, typed-input operation" record** (`manifest-parser.ts:45-52`). A UI-command entry (`navigate/setField/toggle/select/highlight/startTour` + per-component actions, per RUN_SPEC criterion 3) is the same *shape* of declaration — differing only in which runtime executes it.
3. **The catalog already models a unified discovery surface.** `EkoaActionCatalogEntry` (`catalog.ts:55-62`) + the `call_ekoa_action` / `list_ekoa_actions` tool wiring (`catalog.ts:271-302`) is exactly the surface a UI-action registry would feed. The catalog builder is plane-agnostic; it just needs the (currently empty) `listEkoaActions` seam populated.
4. **The engine needs no change to coexist.** `ekoa_action` already reaches app *data*, not UI (Q2.4); a UI registry is purely additive on the served-app plane. Nothing in `engine.ts:1157-1292` has to move for the registry to ship. The only debt is the discovery gap (`server.ts:402`), which a manifest-level unification closes without touching the interpreter.

### Contradiction / caveat to flag for the memo
- The "prior lean: registry as foundation, automations migrate" and RUN_SPEC assumption 1 **agree** on the foundation; they differ only on *timing of migration*. Assumption 1 defers migration ("documented path, not executed") — the evidence supports that: since the data-plane primitives and the UI registry are different planes, there is **no forced migration**; they can coexist indefinitely under one manifest. Migration (folding data-plane `ekoa_action` discovery into the same registry surface) is desirable for a single "operate manifest" but is not a blocker.
- One concrete unification lever already sitting idle: `listEkoaActions: async () => []` (`server.ts:402`). Whatever emits the UI-action manifest at build time can also finally populate this seam, giving one catalog for both planes without touching the engine.

---

## Q5 — Where the audit rows go

### 5.1 The single audit write path exists — and automations don't use it

The single audit write path is `logActivity` — `api/src/data/activity.ts:21-40` (header: *"The single audit write path (FIXED-8, ch09 invariant 3, Registo-ready). Exactly one exported write function; direct writes to the activity collection are grep-banned elsewhere."*). It records `{ userId, username, orgId, category, type, timestamp, metadata? }` into `activityLogs`.

**Finding: `automation/` never calls `logActivity`.** Grep for `logActivity` across `api/src/automation/**` returns nothing. The callers of `data/activity` are `server.ts`, `llm/credentials.ts`, `llm/anonymise/audit.ts`, `memory/extraction.ts`, `auth/service.ts`, `agents/build.ts`, `integrations/platform-oauth.ts`, `routes/org.ts`, `services/{deny-list,platform-crud,commit-guard}.ts` — **no automation module.** So automation runs (including `ekoa_action` executions) are **not** written to the global activity audit today.

### 5.2 What automation runs actually record

The automation run ledger is its own store, `automation_runs`, via the persistence adapter `api/src/automation/persistence.ts`:
- `automationRunStore` (`persistence.ts:37-54`): `create` on run start, `update` **at every status transition** (`persistence.ts:38-45`; the header notes "Run records persist at EVERY status transition … the engine already calls `update` at each one"), keyed by a globally-unique `runId`.
- The persisted shape is `RunRecord` (`types.ts:451-482`): `status`, `inputs`, `steps: StepRecord[]`, `triggeredBy: 'user'|'agent'|'webhook'|'listener'`, `ownerUserId`, `orgId` (persisted at creation so the run is tenant-scoped to owner + org-admins), `parentRunId`, plus pause/consent/rehearsal fields.
- Each `StepRecord` (`types.ts:400-439`) carries `status`, `tier`, `resolvedAction`, `output` (the `StepOutput` union, incl. the `ekoa_action` primitive `trace`), `error{message,recoverable,details}`, `humanAction`, `screenshotPath`, `fingerprint`, `durationMs`, `feedback`.

### 5.3 Screenshots + the run-events stream

- Per-step PNG screenshots: `writeStepScreenshot(automationId, runId, index, png)` (`persistence.ts:63-78`) writes `automation-runs/<automationId>/<runId>/step-<i>.png` under the automation data dir, **best-effort** (returns `undefined`, never throws — a write failure never fails a run). Served via the `/automation-screenshots` static mount rooted at `automationRunsRoot()` (`persistence.ts:80-89`); the public capability URL is built by `screenshotUrlFromPath` (`persistence.ts:98-101`) — the unguessable `automationId/runId` path *is* the capability.
- Live stream: `api/src/automation/run-events.ts` → `automationStepEventPayload(record, runId)` (`run-events.ts:30-44`) maps a `StepRecord` onto the SSE `step` event (status/tier/error/errorDetails/screenshotUrl/output/durationMs) so the run UI renders each step without a follow-up fetch. The engine emits these via an injected `RunEventEmitter` (`seams.ts:317-334`); `automation/` never imports `events/` or the SSE manager.

### 5.4 Implication for the operator/registry work

RUN_SPEC assumption 8 (RUN_SPEC.md:46) says assistant/registry actions must log **through `logActivity` with a new activity kind**, and RUN_SPEC criterion 3 (line 25) requires "every action logs to audit". This analysis confirms the target is `api/src/data/activity.ts:logActivity` — and that **automations currently sit outside it**, recording only to their own `automation_runs` ledger. The operator's registry-action audit is therefore *new* audit-path usage (a new `category`/`type` on `logActivity`), not an extension of anything the automation engine writes today. The existing activity surface + filters (assumption 8's "global audit view" satisfied by the existing subsystem) is the correct home; no new audit store is warranted.

---

## Memo input — extend-vs-rebuild evidence table

| Dimension | Extend `platform-primitives.ts` into the UI registry | Registry as foundation + unify at MANIFEST level (RUN_SPEC assumption 1) |
|---|---|---|
| **Execution plane** | AGAINST — interpreter is server-side, in-process, synchronous; explicitly *"no LLM, no vision, no browser"* (`platform-primitives.ts:1-10, 86-247`). | FOR — UI dispatch is client-side, in the served app, through the app's state layer (RUN_SPEC criterion 3). Different plane; keep separate. |
| **Op semantics** | AGAINST — the 17 ops are data/integration/file/flow (`platform-primitives.ts:36-62`); none is a UI command; adding client ops the server can't run breaks the union's contract. | FOR — a UI-command manifest section is a *sibling* declaration, not a new interpreter. |
| **Trace/output contract** | AGAINST — `EkoaActionTraceEntry`/`StepOutput` are populated inline as the server walks the recipe (`types.ts:373-390`); no synchronous server trace exists for a client-dispatched UI action. | Neutral/FOR — the registry defines its own client-side trace; audit lands via `logActivity` (Q5.4), not the run-record trace. |
| **Manifest surface** | Neutral — would still read `MANIFEST.md`. | FOR — `MANIFEST.md` already carries `data_model` + `external_dependencies` + `capabilities` together (`manifest-parser.ts:64-74`); a UI-actions section is an additive section in the same per-app file. |
| **Discovery / catalog** | AGAINST — coupling UI ops into the server executor still leaves the catalog seam (`listEkoaActions`) empty and now conflated across planes. | FOR — the catalog already models a unified `EkoaActionCatalogEntry` + `call_ekoa_action` surface (`catalog.ts:55-62, 271-302`); populate the idle `listEkoaActions` seam (`server.ts:402`) for one catalog across both planes. |
| **Engine blast radius** | AGAINST — would force changes into the `engine.ts` step dispatch + the interpreter. | FOR — zero engine change; `ekoa_action` already reaches DATA not UI (`ekoa-action.ts:1-10`); the registry is purely additive on the served-app plane (`engine.ts:1157-1292` untouched). |
| **Migration pressure** | — | FOR — because the planes are genuinely different, there is **no forced migration**; data-plane `ekoa_action` and the UI registry coexist under one manifest. Folding both into a single "operate manifest" is a documented future path, not a run blocker. |

**Net:** evidence supports RUN_SPEC assumption 1 as written. Build the UI action registry fresh on the served-app (client) plane, declare it as a new section of each app's per-app manifest alongside the existing `capabilities`, feed it into the existing catalog/discovery surface (closing the `listEkoaActions` empty), audit registry actions through `logActivity` with a new kind, and leave the automation engine + `platform-primitives.ts` interpreter untouched this run. The single genuine coupling point is the *manifest*, exactly as assumption 1 states.

---

### Verification notes / gaps
- All step-execution, primitive, manifest-parse, persistence, and wiring claims were read directly from source at the cited lines (not inferred).
- The "no in-page UI driving" and "no `logActivity` in automation/" claims are grep-negative results over `api/src/automation/**` — honest absences, not omissions.
- Not explored per constraints: auth/sessions/roles/permissions (only the *org-scoping* of the artifact resolver is noted where it bears on ekoa_action reach — `server.ts:376-382`).
- `executors/api-call.ts` and `executors/local-command.ts` were confirmed by header + type (`ApiCallSpec`/`LocalCommandSpec`) as deterministic HTTP / daemon-bash; not read line-by-line since they are outside the app-capability/UI question. `cache.ts`, `vision.ts`, `planner.ts`, `rehearsal.ts`, `service.ts` were sampled via the engine's call sites, not read in full.
