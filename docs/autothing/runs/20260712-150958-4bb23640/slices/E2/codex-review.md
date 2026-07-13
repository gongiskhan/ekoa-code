Reading additional input from stdin...
OpenAI Codex v0.142.5
--------
workdir: /Users/ggomes/dev/ekoa-code
model: gpt-5.4
provider: openai
approval: never
sandbox: read-only
reasoning effort: medium
reasoning summaries: none
session id: 019f5a89-f0ed-7442-adbd-6cf1b3839393
--------
user
You are an adversarial cross-model code reviewer. Repo: /Users/ggomes/dev/ekoa-code, branch operator-run. Review COMMITS fde090e and fc27f10 (git show each) - slice E2 'same-document tour playback' of a gated run. What landed: (1) api/assets/action-runtime-client.js - the C3 in-page action runtime's transient driving-highlight ring refactored into one buildRingOverlay primitive; NEW same-document API window.__ekoaActions.spotlight(target, copy) -> Promise<boolean> (persistent ring + PT-PT tooltip, polls for the data-demo-target element) and clearSpotlight(); spotlight is deliberately NOT an execution-queue item. (2) NEW framework-free player api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js - fetches GET /api/demos/:appId, sequences 6 declarative step types (navigate via runtime execute, spotlight/annotate via rt.spotlight, await-action waits for a REAL user click on the target with timeout+manual advance, inject-prompt drops a suggested prompt into the composer NEVER auto-sends, external-image-step). (3) AssistantPanel.jsx wiring: startTour assistant actions route to the player; teach-mode launcher. (4) api/tests/apps/tour-player.test.ts (23 tests incl. fixture validated against the real demoSpecSchema) + live driver api/tests/e2e/tour-playback.e2e.mjs + fixture. (5) fc27f10 drops home-empty from tour-writer SHELL_LANDMARKS (replaceable placeholder absent in built apps - now warns). ACCEPTANCE: zero-token playback (no POST /api/app-assistant during a tour - asserted by counting requests in the live gate), rebuild selector stability via registry-ID data-demo-target NAMES, strict console gate. CONSTRAINTS: no security/permission logic; no model calls in the player; egress chokepoint untouched; spotlight must only DRAW (never dispatch actions); tour copy must render as TEXT (no innerHTML of spec strings - a hostile tour spec must not be XSS in every served app); C3 transient-highlight semantics unchanged for action execution. Impl-notes with the worker's claims: docs/autothing/runs/20260712-150958-4bb23640/slices/E2/impl-notes.md (verify, do not trust). Live evidence: slices/E2/live-output.txt. Find REAL defects with concrete failure scenarios: XSS via tour copy/images, spotlight abuse to drive UI, zero-token bypass (any code path where playback triggers a model call), await-action click listener leaks/wedges (panel closed mid-tour, double start, timeout paths), the e2e asserting tautologies, runtime refactor regressions (transient ring semantics, pause-on-user-input still cancels queued actions), external-image-step loading arbitrary origins vs CSP. Number findings High/Medium/Low + file:line; end with APPROVE or NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commits `fde090e` and `fc27f10` as a code review pass focused on the tour playback slice and the specific failure modes you listed. I’ll first load repo context (`PRD.md` / `PLANING.md` / `TASKS.md`), confirm whether CodeGraph is available, and inspect the exact landed diffs before checking the relevant runtime, player, panel wiring, and tests.
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc pwd in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/Users/ggomes/dev/ekoa-code

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc 'test -d .codegraph && echo yes || echo no' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
yes

exec
/bin/zsh -lc 'ls -la' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
total 1240
drwxr-xr-x@  32 ggomes  staff    1024 Jul 12 16:38 .
drwxr-xr-x   30 ggomes  staff     960 Jul  8 20:58 ..
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 04:34 .claude
drwxr-xr-x@   9 ggomes  staff     288 Jul 13 09:13 .codegraph
-rw-r--r--@   1 ggomes  staff     281 Jul  8 10:24 .dockerignore
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 15:57 .ekoa-run
-rw-r--r--@   1 ggomes  staff    5369 Jul  8 04:08 .eslintrc.cjs
drwxr-xr-x@  16 ggomes  staff     512 Jul 13 09:13 .git
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:59 .githooks
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:55 .github
-rw-r--r--@   1 ggomes  staff     791 Jul 11 22:20 .gitignore
-rw-r--r--@   1 ggomes  staff     450 Jul  7 02:23 .npmrc
drwxr-xr-x@  56 ggomes  staff    1792 Jul 12 07:34 .playwright-cli
drwxr-xr-x@   6 ggomes  staff     192 Jul 11 22:20 .walkthrough
-rw-r--r--@   1 ggomes  staff    5797 Jul 11 22:20 CLAUDE.md
-rw-r--r--@   1 ggomes  staff    1992 Jul  8 10:24 Dockerfile.api
-rw-r--r--@   1 ggomes  staff    1658 Jul  8 10:24 Dockerfile.web
-rw-r--r--@   1 ggomes  staff   30245 Jul 13 08:48 RUN_LOG.md
drwxr-xr-x@  18 ggomes  staff     576 Jul 13 08:52 api
-rw-r--r--@   1 ggomes  staff       5 Jul  6 22:50 backend.port
drwxr-xr-x@   6 ggomes  staff     192 Jul  8 10:26 deploy
drwxr-xr-x@  17 ggomes  staff     544 Jul 13 07:49 docs
drwxr-xr-x@   3 ggomes  staff      96 Jul  8 09:40 ekoa-data
drwxr-xr-x@ 715 ggomes  staff   22880 Jul 11 15:53 node_modules
-rw-r--r--@   1 ggomes  staff  545459 Jul 11 22:20 package-lock.json
-rw-r--r--@   1 ggomes  staff    1751 Jul  8 04:36 package.json
-rw-r--r--@   1 ggomes  staff    1070 Jul  7 01:01 playwright.config.ts
drwxr-xr-x@  11 ggomes  staff     352 Jul 11 22:20 scripts
drwxr-xr-x@   8 ggomes  staff     256 Jul  6 19:06 shared
drwxr-xr-x@   3 ggomes  staff      96 Jul 12 06:09 test-results
-rw-r--r--@   1 ggomes  staff     429 Jul  6 18:55 tsconfig.base.json
drwxr-xr-x@  24 ggomes  staff     768 Jul 13 02:47 web

exec
/bin/zsh -lc 'git status --short' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-QBFCPjvB' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-PrvmOJyn' (errno=Operation not permitted)
 M web/next-env.d.ts
?? docs/autothing/runs/20260712-150958-4bb23640/slices/E2/codex-review.md
?? docs/autothing/runs/20260712-150958-4bb23640/slices/G1/
?? docs/autothing/runs/20260712-150958-4bb23640/slices/G2/

exec
/bin/zsh -lc 'find .. -name PRD.md -o -name PLANING.md -o -name TASKS.md' in /Users/ggomes/dev/ekoa-code
codex
CodeGraph is present, so I’m using it first for structure and blast radius, then I’ll verify specific lines in the landed files and tests. There are unrelated working tree changes; I’ll ignore them and review only the requested commits.
codex
I have the repo shape and the requested branch state. Next I’m pulling the exact commit diffs plus the project context files and the claimed evidence so the review is grounded in what actually landed, not the worker notes.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md'" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
hook: PreToolUse
hook: PreToolUse
exec
/bin/zsh -lc 'git show --stat --summary --oneline fde090e' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-tPix85kb' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-O9DdkmRg' (errno=Operation not permitted)
fde090e feat(operator-run/e2): same-document tour playback in the assistant panel (zero-token) + rebuild selector-stability gate
 api/assets/action-runtime-client.js                | 146 +++++++--
 .../frontend/src/lib/assistant/AssistantPanel.css  | 115 +++++++
 .../frontend/src/lib/assistant/AssistantPanel.jsx  | 150 ++++++++-
 .../frontend/src/lib/assistant/tour-player.js      | 316 +++++++++++++++++++
 api/tests/apps/tour-player.test.ts                 | 216 +++++++++++++
 api/tests/e2e/fixtures/e2-overview-tour.json       |  52 ++++
 api/tests/e2e/tour-playback.e2e.mjs                | 345 +++++++++++++++++++++
 .../slices/E2/impl-notes.md                        | 256 +++++++++++++++
 .../slices/E2/live-output.txt                      |  14 +
 .../slices/E2/prevalidation-current-stack.txt      |   9 +
 docs/diagrams/03-request-crud.excalidraw           | 127 ++++++++
 11 files changed, 1721 insertions(+), 25 deletions(-)
 create mode 100644 api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js
 create mode 100644 api/tests/apps/tour-player.test.ts
 create mode 100644 api/tests/e2e/fixtures/e2-overview-tour.json
 create mode 100644 api/tests/e2e/tour-playback.e2e.mjs
 create mode 100644 docs/autothing/runs/20260712-150958-4bb23640/slices/E2/impl-notes.md
 create mode 100644 docs/autothing/runs/20260712-150958-4bb23640/slices/E2/live-output.txt
 create mode 100644 docs/autothing/runs/20260712-150958-4bb23640/slices/E2/prevalidation-current-stack.txt

hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,260p' docs/autothing/runs/20260712-150958-4bb23640/slices/E2/live-output.txt" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "sed -n '1,220p' docs/autothing/runs/20260712-150958-4bb23640/slices/E2/impl-notes.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
PASS admin login
PASS fresh app-base app built (05250353-7074-4e7d-a9c8-6f2e5d3ad545)
PASS serving route live for the built app (GET /api/demos/:appId -> 404)
PASS A: teach launcher started the tour; panel fetched GET /api/demos/:appId and rendered the tour block
PASS A: spotlight ring drawn on the real app-nav element (highlight matches a real element)
PASS A: spotlight ring drawn on the planted app target e2-tour-alvo
PASS A: await-action advanced on a real user click on the target
PASS A: inject-prompt dropped the suggestion into the composer and did NOT send it
PASS A: tour reached "concluído" (data-tour-status=done)
PASS B: zero POST /api/app-assistant during playback (client-side, zero-token)
PASS C: the SAME app was rebuilt (follow-up build on the same artifactId)
PASS C: after the rebuild the same tour selectors still resolve real elements (selector stability via registry-ID names)
PASS D: zero non-benign page JS console errors throughout
E2 LIVE GATE: PASS

 succeeded in 0ms:
# E2 — Same-document tour playback + rebuild selector-stability — impl notes

**Slice:** E2 (SAME-DOCUMENT tour playback in the operator assistant panel, zero-token;
plus a rebuild selector-stability gate). **Branch:** operator-run. **Do NOT commit — the lead runs the gates.**

## What E2 delivers

Per `FLOW_PLAN.md:63`, E2 is the IN-APP tour PLAYER: the assistant panel plays a
pre-generated declarative tour SAME-DOCUMENT (not the dashboard cross-origin iframe),
with ZERO model tokens, and a committed proof that tour selectors survive a rebuild.

A2 §gap 1 identified this as the one genuinely net-new build: the surviving Tutorial
Bridge player (`web/lib/demo/tour-machine.ts` + `DemoOverlay.tsx` + the injected
`demo-bridge-client.js`) is a cross-origin iframe+postMessage player whose host/frame
split does NOT apply inside a served app. E2 REUSES the drawing primitive and replaces
the transport: a same-window player that drives the page directly and reuses the C3
runtime's spotlight.

## Design

1. **Runtime spotlight hook (minimal) — `api/assets/action-runtime-client.js`.**
   The C3 runtime already draws a transient driving-highlight ring (`highlightTarget`,
   ~2.5 s auto-clear). E2 refactored that ring into ONE reusable primitive
   `buildRingOverlay(el, opts)` (ring + optional PT-PT copy tooltip + follow-on-scroll +
   `clear()`), and both the transient highlight AND a new PERSISTENT tour spotlight build
   on it — the ring is not duplicated. Exposed on the same-document API:
   `window.__ekoaActions.spotlight(target, copy)` → `Promise<boolean>` (draws the ring +
   tooltip on the `data-demo-target` element, polling `TARGET_TIMEOUT_MS` for a target
   that does not exist yet, e.g. right after a navigate; resolves true once drawn) and
   `window.__ekoaActions.clearSpotlight()`. The spotlight is deliberately NOT an
   execution-queue item, so a real user click on the highlighted element (an await-action
   step) is NOT swallowed by pause-on-user-input — the player advances instead. This is
   the ONLY runtime change (the reserved-path note permitted it "only if a minimal
   same-document spotlight hook is needed").

2. **The player — `.../lib/assistant/tour-player.js` (new, framework-free).**
   `createTourPlayer({ onState })` fetches the tour from `GET /api/demos/:appId`
   (keyed on `window.__EKOA_APP_ID`) and sequences the six declarative step types:
   - `navigate` → reuses `window.__ekoaActions.execute({kind:'navigate'})` (no duplicated
     nav logic); a navigate WITH copy pauses, a bare navigate flows through;
   - `spotlight` / `annotate-result` → `rt.spotlight(target, copy)` then manual advance;
   - `await-action` → spotlight + wait for the user to actually click the target (a
     capture-phase document listener scoped to `[data-demo-target="<name>"]`) or, for
     `result-ready`, poll the target to a laid-out box; a per-step / default timeout and a
     manual "Seguinte" both un-hang it;
   - `inject-prompt` → surfaces the suggested prompt in the composer, NEVER auto-sends;
   - `external-image-step` → renders the image + copy.
   **ZERO TOKENS:** the ONLY network read is the static tour spec; the module has no POST
   and never touches the app-assistant endpoint (asserted in source + the live gate).

3. **Panel wiring — `.../lib/assistant/AssistantPanel.jsx` (+ `.css`).**
   - Builds ONE lazy player; its `onState` drives a `.ekoa-assistant-tour` block (step
     counter, copy, `Seguinte` / `Sair`, `data-tour-status` + `data-tour-step-index` for
     the gate) and, on an inject-prompt step, drops the suggested prompt into the composer.
   - **Two triggers** (per acceptance a): a `startTour` action returned by the assistant is
     routed to the player, NOT the runtime executor (the runtime's cross-frame startTour
     only posts a tour-request — a no-op in-page — and drops the tourId; the panel owns the
     player); and a teach-mode launcher button ("Iniciar tutorial guiado") shown when the
     visitor pins Ensinar, which starts playback with no model call.
   - Brand-neutral (CSS-var contract), PT-PT, no emoji.

## Zero-token & selector-stability (the acceptance)

- **Zero tokens (b):** playback is 100 % client-side; the live gate counts POST
  `/api/app-assistant` and asserts it stays 0 across the whole tour (incl. inject-prompt).
- **Rebuild selector-stability (c):** tour `target`s are `data-demo-target` NAMES — the
  action-registry id namespace (A2 (ii)) — resolved by ATTRIBUTE selector inside the C3
  runtime, never a DOM path. The gate builds a real app-base app, plays a tour targeting
  the platform SHELL LANDMARKS (`app-nav`, `home-empty`, emitted by `App.jsx` on every
  build) + a planted app target, then REBUILDS THE SAME app in place (deterministic
  `export` → `bundle-update`, no model) and replays: the spotlight still resolves the same
  NAMES against the freshly-built DOM. The NAME contract is rebuild-invariant.

## Deterministic gate + the "stub" question (honest note)

`data.tours` is a server-owned reserved key (`artifacts-service.ts:44`) STRIPPED from
client PATCHes, and `data.tours` is only captured by `activateArtifact` in the build-job
flow (never `bundle-update`) — so a gate cannot deterministically make the route serve a
specific tour without depending on the model authoring one. The gate therefore serves the
tour to the panel via a browser-boundary `page.route` fulfill of `GET /api/demos/:appId`
with a **schema-validated** overview spec (the one stub class the QA rules permit). The
exact fixture (`tests/e2e/fixtures/e2-overview-tour.json`) is validated against the real
`demoSpecSchema` in `tour-player.test.ts`, so it is provably the same shape a real E1
capture serves. The app UNDER the tour is real (built through the jobs pipeline, real +
rebuilt shell landmarks); only the tour BYTES are injected. E1's capture + the serving
route are covered end-to-end by `tests/apps/{tour-writer,serving-tours}.test.ts`; E2's gate
owns the PLAYER. The player's real `GET /api/demos/:appId` fetch IS exercised (the panel
issues it; the route-fulfill answers it).

## Diagram (non-negotiable)

Updated **`docs/diagrams/03-request-crud.excalidraw`** — added the E2 same-document
tour-player node beside the C3 injected-runtime node (`GET /api/demos/:appId`, zero-token,
reuses the C3 spotlight on rebuild-stable `data-demo-target` NAMES) + a "reuses spotlight"
arrow to the C3 node. That is the affected diagram: E2's structural change is the new
in-page playback flow that hangs off the C3 runtime. E1's `artifact.data.tours` data shape
lives in `05-data-model` (unchanged by E2).

## Constraints honoured

Reserved paths only (+ the two justified: `serving.ts` was already E1's; here untouched);
runtime spotlight is the single, minimal same-document hook; the player REUSES the C3 ring
(no duplicate spotlight drawing — the runtime owns visible UI); zero model calls during
playback; PT-PT; no emoji; brand-neutral CSS vars; no permission logic; chokepoint clean
(no `@anthropic-ai` / `api.anthropic.com`); structural change ships with its diagram.

## Validation (exact commands + results)

| Command | Result |
|---|---|
| `npx vitest run tests/apps/tour-player.test.ts --root api` | **23 passed** (incl. fixture schema-validation) |
| `npx vitest run tests/apps/assistant-panel.test.ts tests/apps/action-runtime.test.ts tests/apps/serving-tours.test.ts tests/apps/tour-writer.test.ts --root api` | **55 passed** (no regression from the runtime refactor) |
| `cd api && npx tsc --noEmit` | **exit 0** |
| `npx eslint api/tests/apps/tour-player.test.ts` | **exit 0** (the 3 browser assets are eslint-ignored, same as demo-bridge-client.js) |
| `npm run gate:chokepoint --silent` | **clean, exit 0** |
| `node --check api/tests/e2e/tour-playback.e2e.mjs` | **syntax OK** |
| `node api/tests/e2e/tour-playback.e2e.mjs` (live, post-restart) | **E2 LIVE GATE: PASS** (see Live gate below) |

## Live gate — GREEN (`E2 LIVE GATE: PASS`), after a stack restart + two fix-forward iterations

The chronological log below records the initial restart hand-off and the two defects found
and fixed during live verification.

### Iteration 0 — the restart blocker (hand-off to lead)

The live gate requires the running api to serve the NEW runtime asset (with the spotlight
hook). `serving.ts` reads `action-runtime-client.js` ONCE at boot, so the boot-b stack
running since ~06:50Z serves the OLD runtime (verified: `curl /__ekoa/action-runtime.js |
grep -c drawSpotlight` = 0). Making it live needs a stack restart (NO dist rebuild — assets
resolve to `api/assets` source and only assets + tests changed; the scaffold player is read
per-build so a fresh build already carries it).

**I ran the gate against the CURRENT (unrestarted) stack as a driver pre-validation**
(`prevalidation-current-stack.txt`). It passes EVERYTHING up to the first spotlight and
fails only there — proving the whole flow is correct and the runtime restart is the sole
blocker:

```
PASS admin login
PASS fresh app-base app built (d1f8641b-...)          <- carries the new scaffold player
PASS serving route live for the built app (GET /api/demos/:appId -> 404)
PASS A: teach launcher started the tour; panel fetched GET /api/demos/:appId and rendered the tour block
E2E FAIL: waiting for [data-ekoa-actions-ui="spotlight"]   <- old runtime lacks spotlight (expected)
```

That is: teach-mode launcher works, the panel really issues `GET /api/demos/:appId`, the
tour block renders, and step-1 navigate + copy + advance all pass. Only the runtime
spotlight is missing, which the restart fixes.

**I could not restart the stack:** the permission classifier (correctly) denied killing the
shared boot-b process — it is a workload this session did not create, with live bridge
connections, and no human authorized the restart. So the live run is handed to the run lead
(who owns the stack). After a restart, the gate should go green unchanged. Exact steps:

```
# 1. restart boot-b so the api re-reads the runtime asset (cred file present at
#    ~/.config/ekoa/claude-credentials.json; ports fixed: proxy 4111)
node api/tests/journeys/boot-b.mjs up        # after stopping the current one
# 2. confirm the new runtime is live (must print a non-zero count):
curl -s http://localhost:4111/__ekoa/action-runtime.js | grep -c drawSpotlight
# 3. run the gate, capturing the cast:
asciinema rec -c "node api/tests/e2e/tour-playback.e2e.mjs" \
  docs/autothing/runs/20260712-150958-4bb23640/slices/E2/evidence-live.cast
# expect the final line: E2 LIVE GATE: PASS
```

### Live-gate iteration 1 (lead restarted the stack, ran the gate) — found a FIXTURE defect

On the fresh stack the gate passed login → build → route live → teach launcher → fetch →
tour block → spotlight on `app-nav` → spotlight on the planted target → await-action
advanced on a real click (reached step index 4), then TIMED OUT at step 5 waiting for the
`home-empty` spotlight.

**Root cause (verified live, not the initial navigation hypothesis):** `home-empty`
(`App.jsx:36`) lives inside the DEFAULT `HomePage` placeholder, which a generated app
REPLACES with the real product page. Inspecting the built "clientes" app
(185931b0-...) confirmed its `data-demo-target` set is
`app-shell, app-topbar, app-nav, app-content, cliente-form, cliente-nome, cliente-telefone,
cliente-guardar, clientes-empty, assistant-root` — **no `home-empty`**. So the player
correctly polled for a target that does not exist and drew no overlay; the fixture asked
for a non-existent landmark. (The nav click did NOT navigate away — the app has a single
"Clientes" page — ruling out the navigation hypothesis.)

**Fix (fixture/driver, NOT the player):** step 5 now spotlights `app-content` — genuine
SHELL CHROME (`App.jsx:106`, the `<main>` region that wraps every route's page), present in
every generated app and re-emitted on every rebuild. Updated in
`fixtures/e2-overview-tour.json`, the gate's step-5 assertion, and the unit test (which now
also asserts the fixture does NOT target `home-empty`). Re-verified: `tour-player.test.ts`
23 pass.

**Latent finding for E1 (flagged, not fixed — out of E2 scope/reserved paths):**
`tour-writer.ts:41` lists `home-empty` in `SHELL_LANDMARKS`, so a generated tour targeting
it passes target cross-validation WITHOUT a warning — yet it is absent in a real built app.
Consider dropping `home-empty` from `SHELL_LANDMARKS` (keep only the shell-chrome
landmarks: `app-shell/app-topbar/app-nav/app-content/assistant-root`) so the writer warns
when a tour targets the replaceable placeholder.

### Live-gate iteration 2 — found + fixed the rebuild mechanism (413)

With the `home-empty` fix, the whole PLAYBACK section went green (all six step types incl.
step 5, plus zero-token). The next failure was in the REBUILD step: my "rebuild in place"
via `export` → `bundle-update` returned **413 PAYLOAD_TOO_LARGE** — the exported app bundle
(all source files as JSON) exceeds the `bundle-update` POST body limit.

**Fix:** the rebuild is now a **follow-up build on the same artifactId** (`POST /api/v1/jobs`
with `artifactId` + a modification description) — the product's real "rebuild the app" path,
which re-runs the pipeline + re-activation in place with no large body. The modification is
generation-agnostic (add a page) and the coding agent never touches the platform shell, so
the tour's shell-chrome targets (`app-nav` / `app-content`) are guaranteed to survive — which
is exactly the selector-stability claim. (The build uses the model, but tour PLAYBACK stays
zero-token; the follow-up build is a server-side jobs POST, not an app-assistant turn, so the
replay's zero-token assertion still holds.)

### Live-gate iteration 3 — GREEN

`node api/tests/e2e/tour-playback.e2e.mjs` against the restarted stack (with the new
runtime), full output saved to `slices/E2/live-output.txt`:

```
PASS admin login

exec
/bin/zsh -lc 'git show --stat --summary --oneline fc27f10' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-JaCfFnZ7' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-SxQLrsRv' (errno=Operation not permitted)
fc27f10 fix(operator-run/e1): drop home-empty from SHELL_LANDMARKS (E2 live-gate finding)
 api/src/apps/tour-writer.ts        |  4 +++-
 api/tests/apps/tour-writer.test.ts | 16 ++++++++++++++++
 2 files changed, 19 insertions(+), 1 deletion(-)

hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_explore started
mcp: codegraph/codegraph_explore (completed)
codex
The core sources are loaded. I’m now checking the specific risk surfaces you named: whether `spotlight` can accidentally drive UI, whether the player can leak listeners or re-enter, whether image and copy rendering stays inert, and whether the live gate is actually proving the intended properties.
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'git show fde090e -- api/assets/action-runtime-client.js api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx api/tests/apps/tour-player.test.ts api/tests/e2e/tour-playback.e2e.mjs' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-nDXoz5gk' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-jc9HgLkK' (errno=Operation not permitted)
commit fde090e27173732d1519897a5efc3339a2ca690e
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 09:12:07 2026 +0100

    feat(operator-run/e2): same-document tour playback in the assistant panel (zero-token) + rebuild selector-stability gate
    
    The panel now PLAYS the E1-generated declarative tours in-page: tour-player.js
    (framework-free) fetches GET /api/demos/:appId (window.__EKOA_APP_ID) and
    sequences all six step types - navigate reuses the runtime execute path,
    spotlight/annotate reuse the C3 ring (refactored into ONE buildRingOverlay
    primitive; new same-document window.__ekoaActions.spotlight/clearSpotlight,
    poll-for-target, deliberately outside the execution queue so a real user click
    on an await-action target is never swallowed), await-action waits for the real
    user click (capture-phase, target-scoped) with timeout + manual advance,
    inject-prompt drops the suggestion into the composer and NEVER auto-sends,
    external-image-step renders. Two triggers: assistant startTour actions route to
    the player (not the cross-frame runtime no-op) and a teach-mode launcher
    ('Iniciar tutorial guiado'). PT-PT formal, brand-neutral, no emoji.
    
    Zero-token: playback is 100% client-side - the only network read is the static
    tour spec; live gate counts POST /api/app-assistant = 0 across the whole tour.
    
    Live gate (tour-playback.e2e.mjs, evidence in slices/E2): 13 PASS + final
    'E2 LIVE GATE: PASS' on the credentialed stack - real app-base build, teach
    launcher -> fetch -> playback with spotlights on real elements, await-action on
    a real click, inject-prompt unsent, done state; REBUILD via a follow-up build
    on the same artifactId then replay: the same data-demo-target NAMES still
    resolve (registry-ID selector stability); strict console gate green.
    Loop history: 2 driver/fixture defects fixed (home-empty is a replaceable
    placeholder absent from built apps -> spotlight app-content; bundle-update
    rebuild 413 -> the real follow-up-build path). The player needed NO fix.
    
    Static wall: tour-player 23 + five-suite 79/79; tsc src+test clean; eslint
    clean; chokepoint clean. Diagram 03-request-crud updated (player node + reuses-
    spotlight arrow). Tour spec bytes in the gate are a schema-validated stub
    (fixture validated against the real demoSpecSchema in tour-player.test.ts);
    the app under the tour is real and rebuilt.
    
    Claude-Session: https://claude.ai/code/session_015PyYEsLxYr7bEe5EP6pNd3

diff --git a/api/assets/action-runtime-client.js b/api/assets/action-runtime-client.js
index 905bcd6..e0f4f89 100644
--- a/api/assets/action-runtime-client.js
+++ b/api/assets/action-runtime-client.js
@@ -148,28 +148,18 @@
 
   // ---- highlight / driving indicator ----------------------------------------
 
-  var hlOverlay = null;
-  var hlTimer = null;
-
-  function clearHighlight() {
-    if (hlTimer) { window.clearTimeout(hlTimer); hlTimer = null; }
-    if (!hlOverlay) return;
-    try {
-      window.removeEventListener('scroll', hlOverlay.reposition, true);
-      window.removeEventListener('resize', hlOverlay.reposition, true);
-    } catch (_) { /* ignore */ }
-    if (hlOverlay.root && hlOverlay.root.parentNode) hlOverlay.root.parentNode.removeChild(hlOverlay.root);
-    hlOverlay = null;
-  }
-
-  // Spotlight ring around the element being driven (mirrors demo-bridge
-  // drawOverlay minus the tooltip). Auto-clears after ~2.5s or on the next call.
-  function highlightTarget(el) {
-    clearHighlight();
-    if (!el || !document.body) return;
-
+  // Build a fixed, full-viewport overlay carrying a highlight ring around `el`
+  // (and, for a tour spotlight, a small copy tooltip anchored to it). The overlay
+  // follows the element on scroll/resize and is pointer-events:none, so the user
+  // (and an awaited real action) can still reach the element beneath. Returns a
+  // handle whose clear() detaches the listeners and removes the node. This is the
+  // ONE ring-drawing primitive: the transient driving highlight (highlightTarget)
+  // and the persistent same-document tour spotlight (E2) both build on it - the
+  // runtime OWNS this visible UI so the tour player never redraws it.
+  function buildRingOverlay(el, opts) {
+    opts = opts || {};
     var root = document.createElement('div');
-    root.setAttribute('data-ekoa-actions-ui', 'highlight');
+    root.setAttribute('data-ekoa-actions-ui', opts.uiKind || 'highlight');
     root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
 
     var ring = document.createElement('div');
@@ -178,8 +168,38 @@
       'outline:2px solid var(--color-primary, #0f766e);outline-offset:2px;' +
       'transition:top .15s ease,left .15s ease,width .15s ease,height .15s ease;';
     if (!reducedMotion) ring.style.animation = 'ekoaActionsPulse 1.4s ease-in-out infinite';
-
     root.appendChild(ring);
+
+    // Optional tooltip: the tour step's PT-PT copy, rendered right where the user
+    // is looking. Narration only (pointer-events:none via the root) - the advance
+    // controls (Seguinte / Sair) live in the assistant panel, not here.
+    var tip = null;
+    var copy = opts.copy;
+    if (copy && (copy.titlePt || copy.bodyPt)) {
+      tip = document.createElement('div');
+      tip.setAttribute('data-ekoa-actions-ui', 'spotlight-tip');
+      tip.style.cssText =
+        'position:fixed;max-width:280px;box-sizing:border-box;padding:12px 14px;' +
+        'background:var(--color-surface, #ffffff);color:var(--color-text, #0f172a);' +
+        'border:1px solid var(--color-border, #e2e8f0);border-radius:var(--radius-md, 8px);' +
+        'box-shadow:0 12px 32px rgba(15,23,42,.20);' +
+        'font-family:var(--font-sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif);' +
+        'font-size:var(--text-sm, 13px);line-height:1.45;';
+      if (copy.titlePt) {
+        var tt = document.createElement('div');
+        tt.style.cssText = 'font-weight:600;margin-bottom:4px;';
+        tt.textContent = copy.titlePt;
+        tip.appendChild(tt);
+      }
+      if (copy.bodyPt) {
+        var tb = document.createElement('div');
+        tb.style.cssText = 'color:var(--color-text-muted, #475569);';
+        tb.textContent = copy.bodyPt;
+        tip.appendChild(tb);
+      }
+      root.appendChild(tip);
+    }
+
     document.body.appendChild(root);
 
     var reposition = function () {
@@ -188,15 +208,86 @@
       ring.style.left = Math.round(r.left - 4) + 'px';
       ring.style.width = Math.round(r.width + 8) + 'px';
       ring.style.height = Math.round(r.height + 8) + 'px';
+      if (tip) {
+        // Prefer below the element; flip above when there is no room below.
+        var th = tip.offsetHeight || 96;
+        var tw = tip.offsetWidth || 280;
+        var below = r.bottom + 10;
+        var top = below + th > window.innerHeight && r.top - 10 - th > 0 ? r.top - 10 - th : below;
+        var left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 8));
+        tip.style.top = Math.round(top) + 'px';
+        tip.style.left = Math.round(left) + 'px';
+      }
     };
 
-    hlOverlay = { root: root, reposition: reposition };
     reposition();
     window.addEventListener('scroll', reposition, true);
     window.addEventListener('resize', reposition, true);
+
+    return {
+      root: root,
+      reposition: reposition,
+      clear: function () {
+        try {
+          window.removeEventListener('scroll', reposition, true);
+          window.removeEventListener('resize', reposition, true);
+        } catch (_) { /* ignore */ }
+        if (root.parentNode) root.parentNode.removeChild(root);
+      },
+    };
+  }
+
+  var hlOverlay = null;
+  var hlTimer = null;
+
+  function clearHighlight() {
+    if (hlTimer) { window.clearTimeout(hlTimer); hlTimer = null; }
+    if (hlOverlay) { hlOverlay.clear(); hlOverlay = null; }
+  }
+
+  // Transient driving highlight around the element an action is driving.
+  // Auto-clears after ~2.5s or on the next call.
+  function highlightTarget(el) {
+    clearHighlight();
+    if (!el || !document.body) return;
+    hlOverlay = buildRingOverlay(el, { uiKind: 'highlight' });
     hlTimer = window.setTimeout(clearHighlight, HIGHLIGHT_MS);
   }
 
+  // ---- same-document tour spotlight (E2) -------------------------------------
+  // A PERSISTENT ring + copy tooltip the in-app tour player (assistant panel,
+  // tour-player.js) draws on a step's data-demo-target element. Unlike
+  // highlightTarget it does NOT auto-clear and is NOT an execution-queue item, so a
+  // real user click on the highlighted element (an await-action step) is NOT
+  // treated as pause-on-user-input - the player advances the tour instead. Pure
+  // client-side: no model call is ever made to draw or clear it.
+  var spotlightOverlay = null;
+
+  function clearSpotlight() {
+    if (spotlightOverlay) { spotlightOverlay.clear(); spotlightOverlay = null; }
+  }
+
+  // Draw the spotlight on `name`, polling briefly (a target may not exist yet, e.g.
+  // right after a navigate). Resolves true once drawn, false if it never appears.
+  function drawSpotlight(name, copy) {
+    return new Promise(function (resolve) {
+      var draw = function (node) {
+        clearSpotlight();
+        spotlightOverlay = buildRingOverlay(node, { uiKind: 'spotlight', copy: copy });
+        try { node.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' }); } catch (_) { /* ignore */ }
+        resolve(true);
+      };
+      var found = findTarget(name);
+      if (found) { draw(found); return; }
+      var deadline = Date.now() + TARGET_TIMEOUT_MS;
+      var timer = window.setInterval(function () {
+        var el = findTarget(name);
+        if (el) { window.clearInterval(timer); draw(el); return; }
+        if (Date.now() > deadline) { window.clearInterval(timer); resolve(false); }
+      }, POLL_MS);
+    });
+  }
+
   var badge = null;
   function showDrivingBadge() {
     if (badge || !document.body) return;
@@ -582,6 +673,15 @@
     },
     /** Cancel a pending/active same-document action by the id returned in a result. */
     cancel: function (id) { cancelById(id); },
+    /** SAME-DOCUMENT TOUR SPOTLIGHT (E2). Draw a persistent highlight ring + PT-PT
+     *  copy tooltip on a data-demo-target element; resolves true once drawn, false
+     *  if the target never appears within the poll window. The in-app tour player
+     *  (tour-player.js) owns step sequencing + controls; the runtime owns this
+     *  visible highlight, so it is never duplicated. No model call - pure client-
+     *  side rendering of a pre-generated declarative tour. */
+    spotlight: function (target, copy) { return drawSpotlight(target, copy); },
+    /** Clear the current tour spotlight (advance to the next step / end of tour). */
+    clearSpotlight: function () { clearSpotlight(); },
   };
 
   // Keyframes for the (motion-safe) accent pulse on the driven target.
diff --git a/api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx b/api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx
index 39eda45..3f89894 100644
--- a/api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx
+++ b/api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx
@@ -26,6 +26,7 @@
  * from the app and every failure renders a calm message instead of crashing.
  */
 import { useCallback, useEffect, useRef, useState } from 'react';
+import { createTourPlayer } from './tour-player';
 import './AssistantPanel.css';
 
 const ENDPOINT = '/api/app-assistant';
@@ -131,6 +132,79 @@ function ChatIcon() {
   );
 }
 
+/** PT-PT status line for a non-stepping tour phase (playing/awaiting show the copy). */
+function tourStatusText(status) {
+  switch (status) {
+    case 'loading':
+      return 'A carregar o tutorial...';
+    case 'awaiting':
+      return 'Aguardando a sua ação na aplicação...';
+    case 'done':
+      return 'Tutorial concluído.';
+    case 'error':
+      return 'Não foi possível carregar o tutorial guiado.';
+    default:
+      return '';
+  }
+}
+
+/**
+ * The tour block rendered in the panel while a same-document tour plays. The
+ * on-page highlight/tooltip is drawn by the C3 runtime (window.__ekoaActions
+ * spotlight); this block carries the step counter, the narration, and the
+ * Seguinte / Sair controls. It exposes data-tour-status + data-tour-step-index for
+ * the deterministic live gate. No emoji; brand-neutral via the panel CSS vars.
+ */
+function TourView({ tour, onNext, onClose }) {
+  const { status, stepIndex, total, copy, imageUrl, injectedPrompt } = tour;
+  const stepping = status === 'playing' || status === 'awaiting';
+  const stepNo = total > 0 ? Math.min(stepIndex + 1, total) : 0;
+  const statusLine = tourStatusText(status);
+  return (
+    <section
+      className="ekoa-assistant-tour"
+      data-tour-status={status}
+      data-tour-step-index={stepIndex}
+      aria-label="Tutorial guiado"
+    >
+      <div className="ekoa-assistant-tour-head">
+        <span className="ekoa-assistant-tour-title">Tutorial guiado</span>
+        {stepping && total > 0 ? (
+          <span className="ekoa-assistant-tour-progress">{`Passo ${stepNo} de ${total}`}</span>
+        ) : null}
+      </div>
+
+      {copy ? (
+        <div className="ekoa-assistant-tour-copy">
+          {copy.titlePt ? <div className="ekoa-assistant-tour-copy-title">{copy.titlePt}</div> : null}
+          {copy.bodyPt ? <div className="ekoa-assistant-tour-copy-body">{copy.bodyPt}</div> : null}
+        </div>
+      ) : null}
+
+      {injectedPrompt ? (
+        <div className="ekoa-assistant-tour-note">
+          Sugestão colocada na caixa de mensagem, para rever antes de enviar.
+        </div>
+      ) : null}
+
+      {imageUrl ? <img className="ekoa-assistant-tour-image" src={imageUrl} alt="" /> : null}
+
+      {statusLine ? <div className="ekoa-assistant-tour-status">{statusLine}</div> : null}
+
+      <div className="ekoa-assistant-tour-controls">
+        {stepping ? (
+          <button type="button" className="ekoa-assistant-tour-next" onClick={onNext}>
+            Seguinte
+          </button>
+        ) : null}
+        <button type="button" className="ekoa-assistant-tour-close" onClick={onClose}>
+          {status === 'done' || status === 'error' ? 'Fechar' : 'Sair'}
+        </button>
+      </div>
+    </section>
+  );
+}
+
 export function AssistantPanel() {
   const [collapsed, setCollapsed] = useState(true);
   // `mode` is the mode CURRENTLY shown on the toggle - the server's inference (echoed
@@ -142,12 +216,17 @@ export function AssistantPanel() {
   const [messages, setMessages] = useState([]); // { id, role, content, citations?, runs? }
   const [draft, setDraft] = useState('');
   const [busy, setBusy] = useState(false);
+  // E2 same-document tour playback state (null when no tour is active). The player
+  // is 100% client-side and issues ZERO model calls: it fetches the pre-generated
+  // tour from GET /api/demos/:appId and drives it in the page.
+  const [tour, setTour] = useState(null);
 
   const idRef = useRef(0);
   const messagesRef = useRef(messages);
   const actionResultsRef = useRef([]); // rolling buffer of recent action results for context
   const listRef = useRef(null);
   const textareaRef = useRef(null);
+  const playerRef = useRef(null);
 
   useEffect(() => {
     messagesRef.current = messages;
@@ -171,6 +250,44 @@ export function AssistantPanel() {
     if (buf.length > MAX_ACTION_RESULTS) buf.splice(0, buf.length - MAX_ACTION_RESULTS);
   }, []);
 
+  // ---- E2 tour playback (same-document, zero-token) ------------------------
+  // Lazily build ONE client-side tour player. Its state drives the tour block in
+  // the panel; when a step surfaces a suggested prompt (inject-prompt) it lands in
+  // the composer - never auto-sent. No path here calls /api/app-assistant.
+  const ensurePlayer = useCallback(() => {
+    if (!playerRef.current) {
+      playerRef.current = createTourPlayer({
+        onState: (state) => {
+          setTour(state);
+          if (state && state.injectedPrompt) setDraft(state.injectedPrompt);
+        },
+      });
+    }
+    return playerRef.current;
+  }, []);
+
+  /** Start playing the app's guided tour in the page. Triggered by teach mode or a
+   *  startTour action. Fetches GET /api/demos/:appId inside the player - no model
+   *  turn is issued. `tourId` is forwarded for forward-compat (the route serves the
+   *  app's overview tour today). */
+  const startTourPlayback = useCallback(
+    (tourId) => {
+      const player = ensurePlayer();
+      setCollapsed(false);
+      void player.start(undefined, tourId);
+    },
+    [ensurePlayer],
+  );
+
+  const tourNext = useCallback(() => {
+    if (playerRef.current) playerRef.current.next();
+  }, []);
+
+  const tourClose = useCallback(() => {
+    if (playerRef.current) playerRef.current.cancel();
+    setTour(null);
+  }, []);
+
   /** Run the assistant's proposed actions in order through the C3 runtime. The
    *  runtime draws the driving badge / highlight / destructive confirm and pauses
    *  on real user input - the panel only reflects each run's state. */
@@ -186,13 +303,25 @@ export function AssistantPanel() {
             runs: (m.runs || []).map((r) => (r.id === runId ? { ...r, status, detail } : r)),
           }));
 
+        // A startTour action is played by the SAME-DOCUMENT tour player, not the
+        // runtime executor: the runtime's cross-frame startTour only posts a
+        // tour-request (a no-op in-page) and drops the tourId. The panel owns the
+        // player, so it starts playback here. Client-side + zero-token.
+        const runtimeAction = toRuntimeAction(a);
+        if (runtimeAction && runtimeAction.kind === 'startTour') {
+          startTourPlayback(runtimeAction.tourId);
+          setStatus('done');
+          recordResult({ toolName: a && a.toolName, status: 'done' });
+          continue;
+        }
+
         if (!runtime || typeof runtime.execute !== 'function') {
           setStatus('unavailable');
           recordResult({ toolName: a && a.toolName, status: 'unavailable' });
           continue;
         }
         try {
-          const result = await runtime.execute(toRuntimeAction(a));
+          const result = await runtime.execute(runtimeAction);
           const status = (result && result.status) || 'done';
           setStatus(status, result && result.detail);
           recordResult({ toolName: a && a.toolName, status, detail: result && result.detail });
@@ -202,7 +331,7 @@ export function AssistantPanel() {
         }
       }
     },
-    [patchTurn, recordResult],
+    [patchTurn, recordResult, startTourPlayback],
   );
 
   const send = useCallback(
@@ -315,6 +444,9 @@ export function AssistantPanel() {
     );
   }
 
+  // A tour is on-screen for every phase except idle/cancelled (both mean "no tour").
+  const tourActive = !!(tour && tour.status && tour.status !== 'idle' && tour.status !== 'cancelled');
+
   return (
     <aside className="ekoa-assistant" data-collapsed="false" role="complementary" aria-label="Assistente">
       <header className="ekoa-assistant-header">
@@ -393,6 +525,20 @@ export function AssistantPanel() {
         )}
       </div>
 
+      {tourActive ? (
+        <TourView tour={tour} onNext={tourNext} onClose={tourClose} />
+      ) : mode === 'teach' ? (
+        <div className="ekoa-assistant-tour-launch">
+          <button
+            type="button"
+            className="ekoa-assistant-tour-start"
+            onClick={() => startTourPlayback()}
+          >
+            Iniciar tutorial guiado
+          </button>
+        </div>
+      ) : null}
+
       <div className="ekoa-assistant-composer">
         <textarea
           ref={textareaRef}
diff --git a/api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js b/api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js
new file mode 100644
index 0000000..e3de189
--- /dev/null
+++ b/api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js
@@ -0,0 +1,316 @@
+/*
+ * Ekoa in-app TOUR PLAYER - SAME-DOCUMENT guided-tour playback for the operator
+ * assistant panel (operator-run E2).
+ *
+ * The surviving Tutorial Bridge player (web/lib/demo/tour-machine.ts) drives a
+ * tour across a CROSS-ORIGIN iframe over postMessage. Inside a served app there is
+ * no host<->frame split, so THIS player drives the SAME document directly: it
+ * reuses the C3 action runtime's spotlight primitive (window.__ekoaActions.
+ * spotlight / clearSpotlight - the runtime OWNS the visible highlight) and
+ * sequences the declarative steps itself. It replaces only the transport; the
+ * drawing / await primitives are reused, not rebuilt.
+ *
+ * ZERO TOKENS. Playback is 100% client-side. The ONLY network read is
+ * GET /api/demos/:appId for the pre-generated tour (a static declarative spec).
+ * The player NEVER calls the app-assistant model endpoint - no model turn is
+ * issued while a tour plays. That is the zero-token guarantee (asserted in
+ * tests/apps/tour-player.test.ts and the live gate tests/e2e/tour-playback.e2e.mjs).
+ *
+ * Step types (authoritative validator: api/src/services/demo-registry.ts):
+ *   navigate | spotlight | await-action | annotate-result | inject-prompt |
+ *   external-image-step.
+ * Every step `target` is a data-demo-target NAME - the action-registry id
+ * namespace - resolved by ATTRIBUTE selector inside the C3 runtime, so a rebuilt
+ * app's tour still points at real elements (selector stability, the E2 rebuild
+ * gate). inject-prompt only surfaces a suggested prompt in the composer; it NEVER
+ * auto-sends (the LLM may be unavailable, and sending would break the zero-token
+ * invariant).
+ *
+ * Brand-neutral + PT-PT throughout; no emoji. The panel renders the narration +
+ * controls; this module holds no view.
+ */
+
+const DEMOS_ENDPOINT = '/api/demos/';
+// A safety ceiling so an unattended await-action step can never hang the tour
+// forever; a spec may override it per step (timeoutMs). The user can always
+// advance manually (Seguinte) before this fires.
+const DEFAULT_AWAIT_TIMEOUT_MS = 60000;
+
+/** The served-app id stamped by injectAppContext(); absent in a standalone preview. */
+function currentAppId() {
+  return typeof window !== 'undefined' && window.__EKOA_APP_ID ? window.__EKOA_APP_ID : undefined;
+}
+
+/** The C3 same-document action runtime, when installed (absent in a bare preview). */
+function runtime() {
+  return typeof window !== 'undefined' ? window.__ekoaActions : undefined;
+}
+
+function cssAttr(name) {
+  return String(name).replace(/"/g, '\\"');
+}
+
+/** The narration for a step. await-action carries no `copy`, so give it a calm
+ *  PT-PT instruction; every other pausing step uses its authored copy. */
+function stepCopy(step) {
+  if (!step) return null;
+  if (step.copy) return step.copy;
+  if (step.type === 'await-action') {
+    return {
+      titlePt: 'A sua vez',
+      bodyPt: 'Faça esta ação na aplicação para continuar. Também pode usar Seguinte para avançar.',
+    };
+  }
+  return null;
+}
+
+/**
+ * Create a same-document tour player. `onState(state)` is called on every
+ * transition with `{ status, stepIndex, total, step, copy, injectedPrompt,
+ * imageUrl?, tourId, error? }`. The panel reflects it (step counter, copy,
+ * controls) and, when `injectedPrompt` is set, drops it into the composer.
+ *
+ * `status`: idle | loading | playing | awaiting | done | error | cancelled.
+ */
+export function createTourPlayer(opts) {
+  opts = opts || {};
+  const onState = typeof opts.onState === 'function' ? opts.onState : function () {};
+  const fetchImpl =
+    opts.fetch || (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : null);
+
+  let spec = null;
+  let stepIndex = -1;
+  let status = 'idle';
+  let cancelled = false;
+  let injectedPrompt = null;
+  let advanceResolve = null; // resolves the current manual-advance / await wait
+  let cleanupAwait = null; // detaches an await-action listener/poller/timeout
+
+  function emit(extra) {
+    const step = spec && stepIndex >= 0 && stepIndex < spec.steps.length ? spec.steps[stepIndex] : null;
+    const base = {
+      status,
+      stepIndex,
+      total: spec ? spec.steps.length : 0,
+      step,
+      copy: stepCopy(step),
+      injectedPrompt,
+      tourId: spec ? spec.tourId || null : null,
+    };
+    onState(extra ? Object.assign(base, extra) : base);
+  }
+
+  function clearSpotlight() {
+    const rt = runtime();
+    if (rt && typeof rt.clearSpotlight === 'function') rt.clearSpotlight();
+  }
+
+  // Pause until the panel calls next() (Seguinte).
+  function waitManual() {
+    return new Promise((resolve) => {
+      advanceResolve = resolve;
+    });
+  }
+
+  // Wait for the user to perform the awaited action on the step's target, OR for a
+  // manual Seguinte (skip), OR the safety timeout - whichever comes first. Reuses
+  // the C3 runtime's spotlight to keep the target highlighted while waiting.
+  function awaitUserAction(step) {
+    return new Promise((resolve) => {
+      let settled = false;
+      let onClick = null;
+      let poll = null;
+      let timer = null;
+      const cleanup = () => {
+        advanceResolve = null;
+        cleanupAwait = null;
+        if (onClick) document.removeEventListener('click', onClick, true);
+        if (poll) window.clearInterval(poll);
+        if (timer) window.clearTimeout(timer);
+      };
+      const finish = () => {
+        if (settled) return;
+        settled = true;
+        cleanup();
+        resolve();
+      };
+      // Seguinte skips the wait; cancel() also drives this.
+      advanceResolve = finish;
+      cleanupAwait = cleanup;
+
+      if (step.event === 'click') {
+        const sel = '[data-demo-target="' + cssAttr(step.target) + '"]';
+        onClick = (e) => {
+          const t = e && e.target;
+          if (t && t.closest && t.closest(sel)) finish();
+        };
+        document.addEventListener('click', onClick, true);
+      } else {
+        // result-ready: resolve once the target is present and laid out (non-zero box).
+        poll = window.setInterval(() => {
+          const el = document.querySelector('[data-demo-target="' + cssAttr(step.target) + '"]');
+          if (el) {
+            const r = el.getBoundingClientRect();
+            if (r.width > 0 && r.height > 0) finish();
+          }
+        }, 200);
+      }
+      const to = step.timeoutMs && step.timeoutMs > 0 ? step.timeoutMs : DEFAULT_AWAIT_TIMEOUT_MS;
+      timer = window.setTimeout(finish, to);
+    });
+  }
+
+  // Navigate the app to `to` by REUSING the runtime's navigate action (app hook +
+  // history fallback) - no duplicated navigation logic, still zero-token.
+  async function doNavigate(to) {
+    const rt = runtime();
+    if (rt && typeof rt.execute === 'function') {
+      try {
+        await rt.execute({ id: 'tour-navigate', kind: 'navigate', route: to || '' });
+        return;
+      } catch (_) {
+        /* fall through to a best-effort direct navigation */
+      }
+    }
+    try {
+      if (typeof window !== 'undefined' && window.__ekoaApp && typeof window.__ekoaApp.navigate === 'function') {
+        window.__ekoaApp.navigate(to || '');
+      }
+    } catch (_) {
+      /* best-effort */
+    }
+  }
+
+  async function spotlight(step) {
+    const rt = runtime();
+    if (rt && typeof rt.spotlight === 'function') {
+      await rt.spotlight(step.target, stepCopy(step));
+    }
+  }
+
+  async function runStep(step) {
+    status = step.type === 'await-action' ? 'awaiting' : 'playing';
+
+    switch (step.type) {
+      case 'navigate': {
+        await doNavigate(step.to);
+        emit();
+        // A navigate WITH copy pauses for the reader; a bare navigate flows through.
+        if (step.copy) await waitManual();
+        break;
+      }
+      case 'spotlight':
+      case 'annotate-result': {
+        await spotlight(step);
+        emit();
+        await waitManual();
+        clearSpotlight();
+        break;
+      }
+      case 'await-action': {
+        await spotlight(step);
+        emit();
+        await awaitUserAction(step);
+        clearSpotlight();
+        break;
+      }
+      case 'inject-prompt': {
+        // Surface the suggested prompt in the composer; NEVER auto-send.
+        injectedPrompt = step.prompt;
+        emit();
+        await waitManual();
+        break;
+      }
+      case 'external-image-step': {
+        emit({ imageUrl: DEMOS_ENDPOINT.replace('/demos/', '/demos/assets/') + step.image });
+        await waitManual();
+        break;
+      }
+      default: {
+        emit();
+        break;
+      }
+    }
+  }
+
+  async function run() {
+    status = 'playing';
+    for (stepIndex = 0; stepIndex < spec.steps.length; stepIndex++) {
+      if (cancelled) return;
+      injectedPrompt = null;
+      await runStep(spec.steps[stepIndex]);
+      if (cancelled) return;
+    }
+    clearSpotlight();
+    status = 'done';
+    stepIndex = spec.steps.length;
+    injectedPrompt = null;
+    emit();
+  }
+
+  async function load() {
+    status = 'loading';
+    emit();
+    const id = currentAppId();
+    if (!id) throw new Error('no-app-id');
+    if (!fetchImpl) throw new Error('no-fetch');
+    const res = await fetchImpl(DEMOS_ENDPOINT + encodeURIComponent(id), {
+      headers: { Accept: 'application/json' },
+    });
+    if (!res.ok) throw new Error('tour-fetch-' + res.status);
+    return res.json();
+  }
+
+  return {
+    /**
+     * Start playback. Pass a spec to play it directly; otherwise the overview tour
+     * is fetched from GET /api/demos/:appId. `tourId` is accepted for forward
+     * compatibility (multi-tour selection) - the route currently serves the app's
+     * overview tour, which is what plays.
+     */
+    async start(preSpec /*, tourId */) {
+      cancelled = false;
+      injectedPrompt = null;
+      try {
+        spec = preSpec || (await load());
+        if (!spec || !Array.isArray(spec.steps) || spec.steps.length === 0) {
+          throw new Error('empty-tour');
+        }
+        await run();
+      } catch (err) {
+        clearSpotlight();
+        status = 'error';
+        emit({ error: (err && err.message) || 'tour-error' });
+      }
+    },
+    /** Advance the current step (Seguinte), or skip an await-action wait. */
+    next() {
+      if (advanceResolve) {
+        const r = advanceResolve;
+        advanceResolve = null;
+        r();
+      }
+    },
+    /** Stop the tour and clear all transient UI (Sair). */
+    cancel() {
+      cancelled = true;
+      if (cleanupAwait) cleanupAwait();
+      if (advanceResolve) {
+        const r = advanceResolve;
+        advanceResolve = null;
+        r();
+      }
+      clearSpotlight();
+      status = 'cancelled';
+      stepIndex = -1;
+      injectedPrompt = null;
+      emit();
+    },
+    /** The current status (idle | loading | playing | awaiting | done | error | cancelled). */
+    get status() {
+      return status;
+    },
+  };
+}
+
+export default createTourPlayer;
diff --git a/api/tests/apps/tour-player.test.ts b/api/tests/apps/tour-player.test.ts
new file mode 100644
index 0000000..b3a81d1
--- /dev/null
+++ b/api/tests/apps/tour-player.test.ts
@@ -0,0 +1,216 @@
+import { describe, it, expect } from 'vitest';
+import { readFileSync, existsSync } from 'node:fs';
+import { fileURLToPath } from 'node:url';
+import { validateDemoSpec } from '../../src/services/demo-registry.js';
+
+/**
+ * operator-run E2 — the SAME-DOCUMENT tour player that plays a pre-generated
+ * declarative tour inside the served app, driven from the assistant panel.
+ *
+ * The player + its panel wiring + the runtime spotlight hook are browser assets
+ * bundled per-app from esm.sh at real build time (like the C3 runtime and the D2
+ * panel, they are not in the vitest module stack), so this suite asserts their
+ * SOURCE contract; the behavioural loop (playback + zero-token + rebuild
+ * selector-stability) lands in the live gate api/tests/e2e/tour-playback.e2e.mjs.
+ *
+ * The load-bearing invariants:
+ *  - the player fetches the tour from GET /api/demos/:appId and NOTHING ELSE over
+ *    the network — it NEVER calls /api/app-assistant, so no model turn (no token)
+ *    is issued while a tour plays (the zero-token guarantee);
+ *  - it handles all six declarative step types;
+ *  - inject-prompt only surfaces a suggested prompt, never auto-sends;
+ *  - it REUSES the C3 runtime spotlight (window.__ekoaActions.spotlight /
+ *    clearSpotlight) rather than redrawing the highlight;
+ *  - the panel routes a startTour action + a teach-mode launcher into the player;
+ *  - no emoji anywhere (UI-code rule).
+ */
+
+const ASSIST = new URL('../../assets/bases/app/scaffold/frontend/src/lib/assistant/', import.meta.url);
+const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, ASSIST)), 'utf-8');
+
+const PLAYER_PATH = fileURLToPath(new URL('tour-player.js', ASSIST));
+const PLAYER = readFileSync(PLAYER_PATH, 'utf-8');
+const PANEL = read('AssistantPanel.jsx');
+const CSS = read('AssistantPanel.css');
+const RUNTIME = readFileSync(
+  fileURLToPath(new URL('../../assets/action-runtime-client.js', import.meta.url)),
+  'utf-8',
+);
+
+describe('E2 tour player — files exist', () => {
+  it('the same-document tour player ships in the app base scaffold', () => {
+    expect(existsSync(PLAYER_PATH)).toBe(true);
+    expect(PLAYER.length).toBeGreaterThan(0);
+  });
+});
+
+describe('E2 tour player source contract', () => {
+  it('fetches the pre-generated tour from GET /api/demos/:appId, keyed by window.__EKOA_APP_ID', () => {
+    expect(PLAYER).toContain('/api/demos/');
+    expect(PLAYER).toContain('window.__EKOA_APP_ID');
+    // it reads the app id and appends it to the demos endpoint
+    expect(PLAYER).toMatch(/DEMOS_ENDPOINT\s*\+\s*encodeURIComponent/);
+  });
+
+  it('makes ZERO model calls during playback — it never touches /api/app-assistant', () => {
+    // The only network read the player performs is the static tour spec. If this
+    // ever references the assistant endpoint, a tour would cost tokens — forbidden.
+    expect(PLAYER).not.toContain('/api/app-assistant');
+    // Belt-and-braces: the module documents the zero-token invariant explicitly.
+    expect(PLAYER).toContain('ZERO TOKENS');
+  });
+
+  it('handles all six declarative step types', () => {
+    for (const type of [
+      "case 'navigate'",
+      "case 'spotlight'",
+      "case 'annotate-result'",
+      "case 'await-action'",
+      "case 'inject-prompt'",
+      "case 'external-image-step'",
+    ]) {
+      expect(PLAYER).toContain(type);
+    }
+  });
+
+  it('inject-prompt surfaces the suggested prompt but NEVER auto-sends', () => {
+    expect(PLAYER).toContain('injectedPrompt = step.prompt');
+    expect(PLAYER).toContain('NEVER auto-send');
+    // there is no send/POST path in the player at all
+    expect(PLAYER).not.toMatch(/method:\s*'POST'/);
+  });
+
+  it('REUSES the C3 runtime spotlight instead of redrawing the highlight', () => {
+    expect(PLAYER).toContain('window.__ekoaActions');
+    expect(PLAYER).toMatch(/rt\.spotlight\(/);
+    expect(PLAYER).toMatch(/clearSpotlight/);
+    // it does NOT build its own overlay/ring DOM — the runtime owns visible UI
+    expect(PLAYER).not.toContain('box-shadow: 0 0 0 9999px');
+    expect(PLAYER).not.toContain('createElement');
+  });
+
+  it('await-action waits for a real user action on the target (or a manual skip)', () => {
+    expect(PLAYER).toContain('await-action');
+    expect(PLAYER).toContain('data-demo-target="');
+    expect(PLAYER).toMatch(/addEventListener\('click'/);
+    expect(PLAYER).toContain('result-ready');
+    // a safety timeout so an unattended await never hangs the tour forever
+    expect(PLAYER).toContain('DEFAULT_AWAIT_TIMEOUT_MS');
+  });
+
+  it('navigate reuses the runtime navigate action (no duplicated navigation logic)', () => {
+    expect(PLAYER).toMatch(/kind:\s*'navigate'/);
+    expect(PLAYER).toMatch(/rt\.execute\(/);
+  });
+
+  it('emits a state object the panel reflects (status/stepIndex/total/copy)', () => {
+    expect(PLAYER).toContain('onState');
+    expect(PLAYER).toContain('status');
+    expect(PLAYER).toContain('stepIndex');
+    expect(PLAYER).toContain('injectedPrompt');
+  });
+
+  it('contains NO emoji (UI-code rule)', () => {
+    const m = PLAYER.match(/\p{Extended_Pictographic}/u);
+    expect(m, m ? `player emoji: ${JSON.stringify(m[0])}` : '').toBeNull();
+  });
+});
+
+describe('E2 runtime spotlight hook', () => {
+  it('exposes window.__ekoaActions.spotlight + clearSpotlight for same-document tours', () => {
+    expect(RUNTIME).toMatch(/spotlight:\s*function/);
+    expect(RUNTIME).toMatch(/clearSpotlight:\s*function/);
+    expect(RUNTIME).toContain('drawSpotlight');
+  });
+
+  it('reuses ONE ring-drawing primitive for the transient highlight and the tour spotlight', () => {
+    expect(RUNTIME).toContain('buildRingOverlay');
+    // both the transient highlight and the persistent spotlight build on it
+    expect(RUNTIME).toMatch(/hlOverlay\s*=\s*buildRingOverlay/);
+    expect(RUNTIME).toMatch(/spotlightOverlay\s*=\s*buildRingOverlay/);
+  });
+
+  it('the tour spotlight is persistent (not the ~2.5s auto-clear) and separate state', () => {
+    expect(RUNTIME).toContain('spotlightOverlay');
+    // the spotlight is NOT wired to the HIGHLIGHT_MS auto-clear timer (that is the
+    // transient driving highlight only)
+    expect(RUNTIME).toMatch(/hlTimer\s*=\s*window\.setTimeout\(clearHighlight, HIGHLIGHT_MS\)/);
+    expect(RUNTIME).not.toMatch(/spotlightOverlay[\s\S]{0,80}HIGHLIGHT_MS/);
+  });
+
+  it('contains NO emoji (UI-code rule)', () => {
+    const m = RUNTIME.match(/\p{Extended_Pictographic}/u);
+    expect(m, m ? `runtime emoji: ${JSON.stringify(m[0])}` : '').toBeNull();
+  });
+});
+
+describe('E2 panel wiring', () => {
+  it('imports and builds the same-document tour player', () => {
+    expect(PANEL).toContain("import { createTourPlayer } from './tour-player'");
+    expect(PANEL).toContain('createTourPlayer(');
+    expect(PANEL).toContain('startTourPlayback');
+  });
+
+  it('routes a startTour action into the player (not the runtime executor)', () => {
+    expect(PANEL).toMatch(/runtimeAction\.kind === 'startTour'/);
+    expect(PANEL).toContain('startTourPlayback(runtimeAction.tourId)');
+  });
+
+  it('offers a teach-mode launcher that starts playback without a model call', () => {
+    expect(PANEL).toContain('Iniciar tutorial guiado');
+    expect(PANEL).toMatch(/mode === 'teach'/);
+    expect(PANEL).toContain('onClick={() => startTourPlayback()}');
+  });
+
+  it('drops an inject-prompt suggestion into the composer but never sends it', () => {
+    // onState mirror: a surfaced prompt lands in the draft; there is no auto-send.
+    expect(PANEL).toContain('if (state && state.injectedPrompt) setDraft(state.injectedPrompt)');
+  });
+
+  it('renders the tour block with the deterministic gate landmarks', () => {
+    expect(PANEL).toContain('data-tour-status');
+    expect(PANEL).toContain('data-tour-step-index');
+    expect(PANEL).toContain('Passo ');
+    expect(PANEL).toContain('Seguinte');
+  });
+
+  it('contains NO emoji (UI-code rule) — panel and css', () => {
+    const inPanel = PANEL.match(/\p{Extended_Pictographic}/u);
+    expect(inPanel, inPanel ? `panel emoji: ${JSON.stringify(inPanel[0])}` : '').toBeNull();
+    const inCss = CSS.match(/\p{Extended_Pictographic}/u);
+    expect(inCss, inCss ? `css emoji: ${JSON.stringify(inCss[0])}` : '').toBeNull();
+  });
+});
+
+describe('E2 live-gate tour fixture', () => {
+  // The live gate (tests/e2e/tour-playback.e2e.mjs) serves this exact fixture to the
+  // panel via a browser-boundary route-fulfill. It is a schema-VALIDATED stub only
+  // if it validates against the real demo-spec schema — assert that here.
+  const FIXTURE = JSON.parse(
+    readFileSync(fileURLToPath(new URL('../e2e/fixtures/e2-overview-tour.json', import.meta.url)), 'utf-8'),
+  );
+
+  it('validates against the authoritative demo-spec schema (a schema-validated stub)', () => {
+    const { valid, errors } = validateDemoSpec(FIXTURE);
+    expect(valid, errors.join('; ')).toBe(true);
+  });
+
+  it('exercises the step types the gate drives, targeting rebuild-stable shell landmarks', () => {
+    const types = FIXTURE.steps.map((s: { type: string }) => s.type);
+    for (const t of ['navigate', 'spotlight', 'await-action', 'inject-prompt']) {
+      expect(types).toContain(t);
+    }
+    const targets = FIXTURE.steps.flatMap((s: { target?: string }) => (s.target ? [s.target] : []));
+    // SHELL-CHROME landmarks (App.jsx shell, present on every route + re-emitted on every
+    // build → rebuild-stable). NB: NOT home-empty, which lives in the default HomePage
+    // placeholder a generated app replaces — it is absent in a real built app.
+    expect(targets).toContain('app-nav');
+    expect(targets).toContain('app-content');
+    expect(targets).not.toContain('home-empty');
+  });
+
+  it('never auto-sends the inject-prompt (sendInHarness: false)', () => {
+    const inject = FIXTURE.steps.find((s: { type: string }) => s.type === 'inject-prompt');
+    expect(inject.sendInHarness).toBe(false);
+  });
+});
diff --git a/api/tests/e2e/tour-playback.e2e.mjs b/api/tests/e2e/tour-playback.e2e.mjs
new file mode 100644
index 0000000..d6b9b58
--- /dev/null
+++ b/api/tests/e2e/tour-playback.e2e.mjs
@@ -0,0 +1,345 @@
+#!/usr/bin/env node
+/**
+ * SAME-DOCUMENT TOUR PLAYBACK + REBUILD SELECTOR-STABILITY live gate — committed,
+ * re-runnable end-to-end driver (operator-run E2).
+ *
+ * E1 generates + stores per-app tours; D2/D3 proved the assistant panel. E2 is the
+ * IN-APP tour PLAYER: the panel plays a pre-generated declarative tour SAME-DOCUMENT
+ * (not the dashboard cross-origin iframe), reusing the C3 runtime's spotlight
+ * primitive, with ZERO model calls. This driver proves the three E2 properties live
+ * in a REAL served app-base app driven by a real Chromium on the credentialed
+ * boot-b stack:
+ *
+ *   A. PLAYBACK. Pinning Ensinar (teach) surfaces the "Iniciar tutorial guiado"
+ *      launcher; clicking it makes the panel FETCH GET /api/demos/:appId and play
+ *      the tour step-by-step IN THE PAGE: a navigate step, spotlight steps that draw
+ *      the C3 highlight ring ON the real data-demo-target element, an await-action
+ *      step that advances when the user actually clicks the target, and an
+ *      inject-prompt step that drops a suggested prompt into the composer (never
+ *      sent). The tour reaches "Tutorial concluído." (data-tour-status="done").
+ *   B. ZERO TOKENS. NO POST /api/app-assistant fires at any point during playback
+ *      (asserted by a request counter): the player is 100% client-side.
+ *   C. REBUILD SELECTOR-STABILITY. The SAME app is REBUILT (a follow-up build on the
+ *      same artifactId — the product's real "rebuild the app" path), then the tour is
+ *      replayed: the spotlight still resolves the shell-landmark targets
+ *      (data-demo-target NAMES survive the rebuild — the A2 requirement (ii):
+ *      registry-ID selectors, not DOM paths).
+ *   D. ZERO non-benign page JS console errors throughout (the SAME documented
+ *      allowlist as the D2/D3 drivers).
+ *
+ * DETERMINISM. A committed gate cannot depend on what a given generation produced,
+ * nor on the model authoring a tour. So the served tour is a schema-valid overview
+ * spec fulfilled at the browser boundary (page.route) — a schema-validated stub, the
+ * only stub QA permits; the SAME spec shape a real E1 capture would serve (E1's
+ * capture + the serving route are covered by tests/apps/{tour-writer,serving-tours}
+ * .test.ts). The app under it is REAL: built through the jobs pipeline, so its shell
+ * landmarks (app-nav / app-content, data-demo-target on the platform App.jsx SHELL —
+ * present on every route, unlike the replaceable HomePage placeholder) are genuinely
+ * emitted and genuinely re-emitted after the rebuild. One app-specific
+ * registry-ID target (e2-tour-alvo) is planted in the page (same technique as the
+ * C5/D3 gates) so the tour also exercises a non-landmark target. Every assertion is
+ * STRUCTURAL — tour status, spotlight geometry over the real element, composer
+ * value, request count — never on model prose.
+ *
+ * Black-box over the running dev cortex (backend.port, the boot-b proxy) + a real
+ * Chromium. Builds ONE fresh app-base app (verify OFF), then rebuilds it via a
+ * follow-up build on the same artifactId. Run: node tests/e2e/tour-playback.e2e.mjs
+ */
+import { readFileSync } from 'node:fs';
+import { join, dirname } from 'node:path';
+import { fileURLToPath } from 'node:url';
+import { chromium } from 'playwright';
+
+const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
+const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
+const BASE = `http://localhost:${PORT}`;
+const ADMIN = { username: 'admin', password: 'tmp12345' };
+const EVID = join(REPO_ROOT, 'docs', 'autothing', 'runs', '20260712-150958-4bb23640', 'slices', 'E2');
+
+const BUILD_TIMEOUT_MS = 10 * 60_000;
+// The app-specific (non-landmark) registry-ID target the tour spotlights - planted
+// in the page like the C5/D3 gates so the surface is deterministic.
+const PLANTED_TARGET = 'e2-tour-alvo';
+
+// The schema-valid overview tour the panel fetches - the SAME fixture the unit test
+// validates against demoSpecSchema (tests/apps/tour-player.test.ts), so this "stub"
+// is a schema-validated stub. Targets are data-demo-target NAMES: SHELL-CHROME
+// landmarks (app-nav/app-content, present on every route + rebuild-stable) plus the
+// planted app target.
+const TOUR_FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'e2-overview-tour.json'), 'utf-8'));
+const INJECT_PROMPT = TOUR_FIXTURE.steps.find((s) => s.type === 'inject-prompt').prompt;
+
+/** The fixture tour with `appId` stamped to the built artifact (as a real serve would). */
+function buildTour(appId) {
+  return { ...TOUR_FIXTURE, appId };
+}
+
+function fail(msg) { console.error(`E2E FAIL: ${msg}`); process.exit(1); }
+function ok(msg) { console.log(`PASS ${msg}`); }
+function assert(cond, msg) { if (!cond) fail(msg); }
+
+async function login() {
+  const r = await fetch(`${BASE}/api/v1/auth/login`, {
+    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN),
+  });
+  assert(r.ok, `login ${r.status}`);
+  return (await r.json()).token;
+}
+
+/** Build ONE fresh app-base app through the real jobs pipeline (verify OFF —
+ *  nondeterministic + orthogonal, same pattern as C5/D2/D3). */
+async function buildSampleApp(token) {
+  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
+  await fetch(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
+  const s = await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'e2-tour-playback' }) })).json();
+  const created = await (await fetch(`${BASE}/api/v1/jobs`, {
+    method: 'POST', headers: H,
+    body: JSON.stringify({ kind: 'build', sessionId: s.id, language: 'pt', templateId: 'app', description: 'Um registo simples de clientes do escritório com nome e telefone' }),
+  })).json();
+  const jobId = created.job.id;
+  const deadline = Date.now() + BUILD_TIMEOUT_MS;
+  for (;;) {
+    if (Date.now() > deadline) fail(`build ${jobId} did not finish in 10min`);
+    await new Promise((r) => setTimeout(r, 6000));
+    const job = await (await fetch(`${BASE}/api/v1/jobs/${jobId}`, { headers: H })).json();
+    if (job.status === 'completed') return job.artifactId;
+    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
+  }
+}
+
+/** REBUILD the SAME app — a FOLLOW-UP build on the same artifactId (the product's
+ *  real "rebuild the app" path: POST a build job carrying the artifactId + a
+ *  modification, which re-runs the pipeline + re-activation in place). This is the
+ *  faithful "rebuild the SAME app" and, unlike bundle-update, carries no large body.
+ *  The modification is generation-agnostic (add a page) and the coding agent never
+ *  touches the platform shell, so the shell landmarks the tour targets (app-nav /
+ *  app-content) are guaranteed to survive — that is exactly the selector-stability
+ *  claim under test. Model is used to modify the app, but tour PLAYBACK stays
+ *  zero-token (asserted separately for the replay). */
+async function followUpRebuild(token, artifactId) {
+  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
+  const s = await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'e2-tour-rebuild' }) })).json();
+  const created = await (await fetch(`${BASE}/api/v1/jobs`, {
+    method: 'POST', headers: H,
+    body: JSON.stringify({ kind: 'build', sessionId: s.id, artifactId, language: 'pt', description: 'Adicione uma nova página chamada Definições com um campo para o nome do escritório.' }),
+  })).json();
+  if (!created.job || !created.job.id) fail(`follow-up rebuild not created (classifier deflected?): ${JSON.stringify(created)}`);
+  const jobId = created.job.id;
+  const deadline = Date.now() + BUILD_TIMEOUT_MS;
+  for (;;) {
+    if (Date.now() > deadline) fail(`follow-up rebuild ${jobId} did not finish in 10min`);
+    await new Promise((r) => setTimeout(r, 6000));
+    const job = await (await fetch(`${BASE}/api/v1/jobs/${jobId}`, { headers: H })).json();
+    if (job.status === 'completed') return;
+    if (job.status === 'failed') fail(`follow-up rebuild failed: ${JSON.stringify(job.error)}`);
+  }
+}
+
+/**
+ * Benign console-error allowlist — COPIED VERBATIM from the D2/D3 drivers
+ * (assistant-panel.e2e.mjs / assistant-modes.e2e.mjs). None is E2 code; each fires
+ * on EVERY served app. Every OTHER console error fails the gate (strict).
+ */
+function benign(entry) {
+  const url = String(entry.url || '');
+  const text = String(entry.text || '');
+  // 1. favicon: the browser auto-requests /favicon.ico and served apps ship none → 404. Not app code.
+  if (/favicon/i.test(`${url} ${text}`)) return true;
+  // 2. Anonymous SSO whoami probe (injected-context.ts:110): window.__ekoa.whoami() GETs
+  //    /api/app-sso/me and treats 401 as the normal "no visitor session" state (returns null). The
+  //    401 is the EXPECTED anonymous state; the browser merely logs the failed resource. Pre-existing.
+  if (url.endsWith('/api/app-sso/me') && /\b401\b/.test(text)) return true;
+  // 3. Injected health beacon (injected-context.ts:244): POSTs /api/app-health (keepalive) on load;
+  //    through the boot-b dev CORS proxy this returns 5xx (a proxy artifact — same-origin prod does
+  //    not proxy the beacon). Pre-existing dev-harness noise on every served app, not E2 code.
+  if (url.endsWith('/api/app-health') && /\b5\d\d\b/.test(text)) return true;
+  return false;
+}
+
+/** Plant the app-specific tour target + a fresh spotlight-UI observer as direct
+ *  children of <body> (React never reclaims them — same technique as the C5/D3
+ *  gates). Re-run after every navigation/reload. */
+async function plant(page) {
+  await page.evaluate((target) => {
+    if (!document.querySelector('[data-demo-target="' + target + '"]')) {
+      const el = document.createElement('div');
+      el.setAttribute('data-demo-target', target);
+      el.style.cssText = 'position:fixed;top:8px;left:8px;width:200px;height:36px;z-index:1;background:#fff;border:1px solid #ccc;';
+      document.body.appendChild(el);
+    }
+  }, PLANTED_TARGET);
+}
+
+/** Geometry check: the tour spotlight ring is drawn AROUND the real element that
+ *  carries `data-demo-target=<name>` (proves the highlight matches a real element). */
+async function spotlightSurrounds(page, name) {
+  return page.evaluate((n) => {
+    const overlay = document.querySelector('[data-ekoa-actions-ui="spotlight"]');
+    if (!overlay) return { ok: false, reason: 'no-spotlight-overlay' };
+    const ring = overlay.firstElementChild;
+    const target = document.querySelector('[data-demo-target="' + n + '"]');
+    if (!ring) return { ok: false, reason: 'no-ring' };
+    if (!target) return { ok: false, reason: 'no-target' };
+    const rr = ring.getBoundingClientRect();
+    const tr = target.getBoundingClientRect();
+    // buildRingOverlay draws the ring at the target rect inflated by 4px each side.
+    const near = Math.abs(rr.left - (tr.left - 4)) < 8 && Math.abs(rr.top - (tr.top - 4)) < 8 && Math.abs(rr.width - (tr.width + 8)) < 12 && Math.abs(rr.height - (tr.height + 8)) < 12;
+    return { ok: near, ring: { l: rr.left, t: rr.top, w: rr.width, h: rr.height }, target: { l: tr.left, t: tr.top, w: tr.width, h: tr.height } };
+  }, name);
+}
+
+async function openPanelAndStartTour(page) {
+  const launcher = page.locator('.ekoa-assistant-launcher');
+  await launcher.waitFor({ state: 'visible', timeout: 30_000 });
+  await launcher.click();
+  await page.locator('.ekoa-assistant-intro-lead').waitFor({ state: 'visible', timeout: 10_000 });
+  await page.waitForFunction(() => typeof window.__ekoaActionRuntimeInstalled !== 'undefined', { timeout: 15_000 });
+  // Pin Ensinar (teach) — a pure client action, no model call — to surface the launcher.
+  await page.locator('.ekoa-assistant-mode', { hasText: 'Ensinar' }).click();
+  const startBtn = page.locator('.ekoa-assistant-tour-start');
+  await startBtn.waitFor({ state: 'visible', timeout: 10_000 });
+  await startBtn.click();
+  await page.locator('.ekoa-assistant-tour').waitFor({ state: 'visible', timeout: 10_000 });
+}
+
+async function advance(page) {
+  await page.locator('.ekoa-assistant-tour-next').click();
+}
+
+async function main() {
+  const token = await login();
+  ok('admin login');
+
+  const artifactId = await buildSampleApp(token);
+  ok(`fresh app-base app built (${artifactId})`);
+
+  // Soft probe: the serving route is live (a fresh app has no captured tour -> 404,
+  // or a valid overview if the generation authored one). Either way the route works;
+  // playback below runs against the deterministic schema-valid spec.
+  const routeProbe = await fetch(`${BASE}/api/demos/${artifactId}`);
+  assert(routeProbe.status === 404 || routeProbe.status === 200, `GET /api/demos/:appId returned ${routeProbe.status} (route not live)`);
+  ok(`serving route live for the built app (GET /api/demos/:appId -> ${routeProbe.status})`);
+
+  const browser = await chromium.launch();
+  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
+  const page = await context.newPage();
+
+  const consoleErrors = [];
+  page.on('console', (msg) => {
+    if (msg.type() === 'error') { const loc = msg.location(); consoleErrors.push({ text: msg.text(), url: loc && loc.url }); }
+  });
+  page.on('pageerror', (err) => consoleErrors.push({ text: `pageerror: ${err && err.message}`, url: '' }));
+
+  // Zero-token counter: count EVERY assistant model POST for the whole session.
+  let assistantPosts = 0;
+  page.on('request', (req) => {
+    if (req.method() === 'POST' && req.url().includes('/api/app-assistant')) assistantPosts += 1;
+  });
+
+  // Deterministic served tour: fulfil the panel's GET /api/demos/:appId at the
+  // browser boundary with the schema-valid overview spec (a schema-validated stub).
+  await page.route('**/api/demos/**', (route) =>
+    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildTour(artifactId)) }),
+  );
+
+  const appUrl = `${BASE}/apps/${artifactId}/`;
+  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
+  await plant(page);
+
+  // ============================================================================
+  // A. PLAYBACK — teach launcher -> fetch -> play step-by-step in the page.
+  // ============================================================================
+  await openPanelAndStartTour(page);
+  const tour = page.locator('.ekoa-assistant-tour');
+  ok('A: teach launcher started the tour; panel fetched GET /api/demos/:appId and rendered the tour block');
+
+  // Step 1 (navigate, "Bem-vindo") — the counter + copy render.
+  await tour.locator('.ekoa-assistant-tour-progress', { hasText: 'Passo 1 de 6' }).waitFor({ state: 'visible', timeout: 10_000 });
+  assert((await tour.locator('.ekoa-assistant-tour-copy-title').innerText()).includes('Bem-vindo'), 'step 1 copy missing "Bem-vindo"');
+  await page.screenshot({ path: join(EVID, 'live-01-tour-start.png') });
+  await advance(page);
+
+  // Step 2 (spotlight app-nav) — the C3 ring is drawn AROUND the real app-nav.
+  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
+  await page.locator('.ekoa-assistant-tour[data-tour-step-index="1"]').waitFor({ timeout: 10_000 });
+  let geo = await spotlightSurrounds(page, 'app-nav');
+  assert(geo.ok, `spotlight did not surround real app-nav: ${JSON.stringify(geo)}`);
+  await page.screenshot({ path: join(EVID, 'live-02-spotlight-appnav.png') });
+  ok('A: spotlight ring drawn on the real app-nav element (highlight matches a real element)');
+  await advance(page);
+
+  // Step 3 (spotlight the planted app target).
+  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
+  geo = await spotlightSurrounds(page, PLANTED_TARGET);
+  assert(geo.ok, `spotlight did not surround ${PLANTED_TARGET}: ${JSON.stringify(geo)}`);
+  ok(`A: spotlight ring drawn on the planted app target ${PLANTED_TARGET}`);
+  await advance(page);
+
+  // Step 4 (await-action app-nav click) — advances only when the user really clicks.
+  await page.locator('.ekoa-assistant-tour[data-tour-status="awaiting"]').waitFor({ timeout: 10_000 });
+  await page.locator('[data-demo-target="app-nav"] button').first().click();
+  await page.locator('.ekoa-assistant-tour[data-tour-step-index="4"]').waitFor({ timeout: 10_000 });
+  ok('A: await-action advanced on a real user click on the target');
+
+  // Step 5 (spotlight app-content — a stable shell landmark present on every route,
+  // unlike the default HomePage's home-empty which a generated app replaces).
+  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
+  geo = await spotlightSurrounds(page, 'app-content');
+  assert(geo.ok, `spotlight did not surround app-content: ${JSON.stringify(geo)}`);
+  await advance(page);
+
+  // Step 6 (inject-prompt) — the suggested prompt lands in the composer, unsent.
+  await page.locator('.ekoa-assistant-tour-note').waitFor({ timeout: 10_000 });
+  const draftVal = await page.locator('.ekoa-assistant-textarea').inputValue();
+  assert(draftVal.trim() === INJECT_PROMPT, `inject-prompt did not land in the composer: "${draftVal}"`);
+  assert(assistantPosts === 0, `inject-prompt auto-sent (assistant POSTs=${assistantPosts})`);
+  await page.screenshot({ path: join(EVID, 'live-03-inject-prompt.png') });
+  ok('A: inject-prompt dropped the suggestion into the composer and did NOT send it');
+  await advance(page);
+
+  // Done.
+  await page.locator('.ekoa-assistant-tour[data-tour-status="done"]').waitFor({ timeout: 10_000 });
+  ok('A: tour reached "concluído" (data-tour-status=done)');
+
+  // ============================================================================
+  // B. ZERO TOKENS — no assistant model POST fired during the whole playback.
+  // ============================================================================
+  assert(assistantPosts === 0, `playback issued ${assistantPosts} POST /api/app-assistant — tours must be zero-token`);
+  ok('B: zero POST /api/app-assistant during playback (client-side, zero-token)');
+
+  // Close the tour before the rebuild.
+  await page.locator('.ekoa-assistant-tour-close').click();
+
+  // ============================================================================
+  // C. REBUILD SELECTOR-STABILITY — rebuild the SAME app, replay, targets resolve.
+  // ============================================================================
+  await followUpRebuild(token, artifactId);
+  ok('C: the SAME app was rebuilt (follow-up build on the same artifactId)');
+
+  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
+  await plant(page);
+  const postsBeforeReplay = assistantPosts;
+  await openPanelAndStartTour(page);
+  // Advance to the app-nav spotlight (step index 1) and assert it STILL resolves the
+  // rebuilt app's real app-nav — the data-demo-target NAME survived the rebuild.
+  await advance(page);
+  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
+  await page.locator('.ekoa-assistant-tour[data-tour-step-index="1"]').waitFor({ timeout: 10_000 });
+  geo = await spotlightSurrounds(page, 'app-nav');
+  assert(geo.ok, `after rebuild the spotlight no longer resolves app-nav: ${JSON.stringify(geo)}`);
+  await page.screenshot({ path: join(EVID, 'live-04-rebuild-replay.png') });
+  assert(assistantPosts === postsBeforeReplay, `rebuild replay issued ${assistantPosts - postsBeforeReplay} assistant POST(s)`);
+  ok('C: after the rebuild the same tour selectors still resolve real elements (selector stability via registry-ID names)');
+
+  // ============================================================================
+  // D. ZERO non-benign page JS console errors throughout.
+  // ============================================================================
+  const errors = consoleErrors.filter((e) => !benign(e));
+  if (errors.length) fail(`page console errors: ${JSON.stringify(errors, null, 2)}`);
+  ok('D: zero non-benign page JS console errors throughout');
+
+  await browser.close();
+  console.log('E2 LIVE GATE: PASS');
+}
+
+main().catch((e) => fail(e && e.stack ? e.stack : String(e)));

exec
/bin/zsh -lc 'git show fc27f10 -- api/src/apps/tour-writer.ts api/tests/apps/tour-writer.test.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-zYYEy5vc' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-9uQmTJSn' (errno=Operation not permitted)
commit fc27f10a66793a6b83f6f55ccea79940f690e371
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 09:12:21 2026 +0100

    fix(operator-run/e1): drop home-empty from SHELL_LANDMARKS (E2 live-gate finding)
    
    home-empty lives in the scaffold's default HomePage placeholder, which a
    generated app REPLACES - the E2 live gate proved a real built app has no such
    target (verified live DOM), yet the tour writer listed it as a landmark so a
    generated tour targeting it cross-validated clean and then pointed at nothing.
    Removed from SHELL_LANDMARKS (writer now WARNS, warn-not-fail preserved) with
    the rationale in place; new test pins the warning. tour-writer 23/23, tsc +
    eslint clean.
    
    Claude-Session: https://claude.ai/code/session_015PyYEsLxYr7bEe5EP6pNd3

diff --git a/api/src/apps/tour-writer.ts b/api/src/apps/tour-writer.ts
index 761ea13..5ea7b20 100644
--- a/api/src/apps/tour-writer.ts
+++ b/api/src/apps/tour-writer.ts
@@ -44,7 +44,9 @@ export const SHELL_LANDMARKS = [
   'app-nav',
   'app-content',
   'assistant-root',
-  'home-empty',
+  // 'home-empty' is deliberately NOT a landmark: it lives in the scaffold's default HomePage
+  // placeholder, which a generated app REPLACES - a tour targeting it validates clean but points
+  // at nothing in the built app (E2 live-gate finding). Keeping it out makes the writer WARN.
 ] as const;
 
 export type ToursResult =
diff --git a/api/tests/apps/tour-writer.test.ts b/api/tests/apps/tour-writer.test.ts
index b173fef..52fe477 100644
--- a/api/tests/apps/tour-writer.test.ts
+++ b/api/tests/apps/tour-writer.test.ts
@@ -207,6 +207,22 @@ describe('readTours — target cross-validation warns, never fails', () => {
       expect(res.warnings.some((w) => w.includes('app-nav'))).toBe(false);
     }
   });
+
+  it('warns on home-empty - the replaceable HomePage placeholder is NOT a landmark (E2 live-gate finding)', async () => {
+    const dir = await tmpProject();
+    const tour = overviewTour();
+    (tour.steps as Array<Record<string, unknown>>)[1] = {
+      id: 'destacar-vazio', type: 'spotlight', target: 'home-empty',
+      copy: { titlePt: 'Início', bodyPt: 'O estado vazio da página inicial.' },
+    };
+    await writeManifestTours(dir, [tour]);
+    const res = await readTours(dir, { appId: 'art-he' });
+    expect(res.status).toBe('valid'); // WARN, not fail
+    if (res.status === 'valid') {
+      expect(SHELL_LANDMARKS).not.toContain('home-empty');
+      expect(res.warnings.some((w) => w.includes('home-empty'))).toBe(true);
+    }
+  });
 });
 
 describe('readTours — kebab/dup/kind fail-loud rules', () => {

 succeeded in 27207ms:
../pnmui-mon/TASKS.md

hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_explore started
mcp: codegraph/codegraph_explore (completed)
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,220p' api/tests/e2e/fixtures/e2-overview-tour.json" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "sed -n '1,260p' api/src/services/demo-registry.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
{
  "version": 1,
  "appId": "e2-sample-app",
  "tourId": "visao-geral",
  "kind": "overview",
  "card": {
    "titlePt": "Visão geral",
    "descriptionPt": "Conheça os elementos principais da aplicação em poucos passos.",
    "durationSec": 45
  },
  "steps": [
    {
      "id": "abrir",
      "type": "navigate",
      "to": "/",
      "copy": { "titlePt": "Bem-vindo", "bodyPt": "Vamos ver os elementos principais desta aplicação." }
    },
    {
      "id": "ver-navegacao",
      "type": "spotlight",
      "target": "app-nav",
      "copy": { "titlePt": "Navegação", "bodyPt": "Aqui muda entre as páginas da aplicação." }
    },
    {
      "id": "destacar-registo",
      "type": "spotlight",
      "target": "e2-tour-alvo",
      "copy": { "titlePt": "Registo", "bodyPt": "Este cartão é um alvo que as ações do assistente conhecem." }
    },
    {
      "id": "clicar-navegacao",
      "type": "await-action",
      "target": "app-nav",
      "event": "click",
      "simulate": { "actions": [{ "kind": "click", "target": "app-nav" }] }
    },
    {
      "id": "ver-inicio",
      "type": "spotlight",
      "target": "app-content",
      "copy": { "titlePt": "Área principal", "bodyPt": "O conteúdo de cada página aparece nesta zona." }
    },
    {
      "id": "sugerir",
      "type": "inject-prompt",
      "surface": "chat",
      "sendInHarness": false,
      "prompt": "Como adiciono um novo registo?",
      "copy": { "titlePt": "Peça ajuda ao assistente", "bodyPt": "Deixámos esta sugestão na caixa de mensagem para rever antes de enviar." }
    }
  ]
}

 succeeded in 0ms:
/**
 * Demo registry - loads and validates the Tutorial Bridge demo specs (carryover
 * services sweep; backs `/api/demos*` and the demo-bridge guided tours, whose
 * routes land in another slice).
 *
 * A demo spec is a plain-English, code-free tour of one served artifact app. The
 * host tour machine drives it; the injected bridge client executes the in-app
 * parts. This module is the single source of truth for the spec shape: the zod
 * schema documents and enforces it for the loader and tests.
 *
 * Reusable, side-effect-free content loading + validation shared by the demo HTTP
 * routes and the registry test - a Service, not handler logic.
 *
 * Ported as-is except the specs directory: the old `resolveEkoaDataPath` helper
 * (a repo-relative `ekoa-data/` content tree) is not carried; the directory is env
 * -configurable via `EKOA_DEMOS_DIR`, defaulting to `<dataDir>/demos`.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// ---- schema ----------------------------------------------------------------

const copySchema = z.strictObject({
  titlePt: z.string().min(1),
  bodyPt: z.string().min(1),
});

const optionalCopySchema = z.strictObject({
  titlePt: z.string().min(1),
  bodyPt: z.string().min(1),
});

const simulateActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('click'), target: z.string().min(1) }),
  z.strictObject({ kind: z.literal('fill'), target: z.string().min(1), value: z.string() }),
  // `select` drives a native <select> (which "fill" cannot). Pick by option
  // `value` when known, else by `index` (0-based). At least one must be present -
  // enforced in the top-level superRefine (zod 3 forbids a refined member inside a
  // discriminated union, so the "value or index" check moved to the parent).
  z.strictObject({
    kind: z.literal('select'),
    target: z.string().min(1),
    value: z.string().optional(),
    index: z.number().int().min(0).optional(),
  }),
]);

const simulateSchema = z.strictObject({
  actions: z.array(simulateActionSchema).min(1),
});

const navigateStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('navigate'),
  to: z.string().min(1),
  copy: optionalCopySchema.optional(),
});

const spotlightStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('spotlight'),
  target: z.string().min(1),
  copy: copySchema,
  timeoutMs: z.number().int().positive().optional(),
});

const awaitActionStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('await-action'),
  target: z.string().min(1),
  event: z.enum(['click', 'result-ready']),
  // MANDATORY: the harness performs these inside the iframe; live users perform
  // them themselves. A spec omitting `simulate` is rejected.
  simulate: simulateSchema,
  timeoutMs: z.number().int().positive().optional(),
});

const annotateResultStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('annotate-result'),
  target: z.string().min(1),
  copy: copySchema,
  timeoutMs: z.number().int().positive().optional(),
});

const injectPromptStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('inject-prompt'),
  surface: z.literal('chat'),
  prompt: z.string().min(1),
  // Invariant: the harness never sends (the LLM may be unavailable); it only
  // asserts the text landed in the composer.
  sendInHarness: z.literal(false).optional(),
  copy: optionalCopySchema.optional(),
});

const externalImageStepSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('external-image-step'),
  image: z.string().min(1),
  copy: copySchema,
});

const stepSchema = z.discriminatedUnion('type', [
  navigateStepSchema,
  spotlightStepSchema,
  awaitActionStepSchema,
  annotateResultStepSchema,
  injectPromptStepSchema,
  externalImageStepSchema,
]);

const cardSchema = z.strictObject({
  titlePt: z.string().min(1),
  descriptionPt: z.string().min(1),
  durationSec: z.number().int().positive(),
  thumbnail: z.string().min(1).optional(),
});

/** Kebab id for per-app tours (operator-run E1) - the same shape as an action
 *  registry id (shared/action-manifest). Shared here so the tour writer applies
 *  one rule. */
export const TOUR_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const demoSpecSchema = z
  .strictObject({
    version: z.literal(1),
    appId: z.string().min(1),
    // operator-run E1: a single app now carries MULTIPLE generated tours - an
    // overview plus one per main journey. They are keyed within the app by an
    // optional kebab `tourId` and marked `kind`. Both are OPTIONAL and additive:
    // the 28 hand-authored platform specs omit them and stay valid (strictObject
    // rejects unknown fields, so this MUST be declared on the schema to be
    // accepted); the build-time tour writer stamps them on every generated tour.
    tourId: z.string().regex(TOUR_ID_RE, 'tourId must be kebab-case').optional(),
    kind: z.enum(['overview', 'journey']).optional(),
    card: cardSchema,
    steps: z.array(stepSchema).min(1),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    spec.steps.forEach((step, i) => {
      if (seen.has(step.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate step id "${step.id}"`, path: ['steps', i, 'id'] });
      }
      seen.add(step.id);

      // Every `select` simulate action must pick by value or index (one is
      // required; both-absent is meaningless). Enforced here because the member
      // can't carry its own `.refine` inside the discriminated union (zod 3).
      if (step.type === 'await-action') {
        step.simulate.actions.forEach((a, j) => {
          if (a.kind === 'select' && a.value === undefined && a.index === undefined) {
            ctx.addIssue({
              code: 'custom',
              message: 'select action requires "value" or "index"',
              path: ['steps', i, 'simulate', 'actions', j],
            });
          }
        });
      }

      // Executability invariant: an await-action that waits for a CLICK can only
      // advance when its target is actually clicked, so the simulate the harness
      // (and, conceptually, the live user) performs MUST include a click on that
      // target. Without this a "click" await hangs until timeout.
      if (step.type === 'await-action' && step.event === 'click') {
        const clicksTarget = step.simulate.actions.some((a) => a.kind === 'click' && a.target === step.target);
        if (!clicksTarget) {
          ctx.addIssue({
            code: 'custom',
            message: `await-action "${step.id}" waits for a click on "${step.target}" but its simulate never clicks it`,
            path: ['steps', i, 'simulate'],
          });
        }
      }
    });
  });

// ---- types -----------------------------------------------------------------

export type DemoCopy = z.infer<typeof copySchema>;
export type DemoSimulateAction = z.infer<typeof simulateActionSchema>;
export type DemoStep = z.infer<typeof stepSchema>;
export type DemoCard = z.infer<typeof cardSchema>;
export type DemoSpec = z.infer<typeof demoSpecSchema>;
export type DemoKind = 'overview' | 'journey';

export interface DemoValidationResult {
  valid: boolean;
  errors: string[];
  spec?: DemoSpec;
}

// ---- validation ------------------------------------------------------------

/**
 * Validate an arbitrary parsed JSON value against the demo spec schema. Exported
 * for the registry test and used by the loader. Never throws.
 */
export function validateDemoSpec(raw: unknown): DemoValidationResult {
  const result = demoSpecSchema.safeParse(raw);
  if (result.success) return { valid: true, errors: [], spec: result.data };
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  return { valid: false, errors };
}

// ---- loading ---------------------------------------------------------------

function dataDir(): string {
  const raw = process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/** Absolute path to the demo specs directory. Default is the VERSIONED in-repo
 *  catalog (api/assets/demos - the Fonseca spine the demo-spine spec drives),
 *  overridable via EKOA_DEMOS_DIR; resolves from both src/ and dist/ like the
 *  other api/assets consumers. */
export function demosDir(): string {
  const raw = process.env.EKOA_DEMOS_DIR;
  if (raw) return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  const inRepo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'demos');
  if (existsSync(inRepo)) return inRepo;
  return join(dataDir(), 'demos');
}

/** Absolute path to `<demosDir>/assets`. */
export function demoAssetsDir(): string {
  return join(demosDir(), 'assets');
}

let cache: DemoSpec[] | null = null;

/**
 * Load every valid demo spec from `<demosDir>/*.json`. Files whose name starts
 * with `_` (e.g. `_schema.json`) are skipped. Invalid specs are logged and
 * excluded rather than crashing startup. Cached after first read.
 */
export function loadDemoSpecs(force = false): DemoSpec[] {
  if (cache && !force) return cache;
  const dir = demosDir();
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  } catch {
    cache = [];
    return cache;
  }
  const specs: DemoSpec[] = [];
  for (const file of entries.sort()) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      const { valid, errors, spec } = validateDemoSpec(raw);
      if (valid && spec) {

exec
/bin/zsh -lc "rg -n \"demos/assets|external-image-step|image:\" api/src api/assets -g '"'!**/node_modules/**'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/assets/demos/legal-prazos.json:65:      "type": "external-image-step",
api/assets/demos/_schema.json:54:          "description": "Optional path under /api/demos/assets/."
api/assets/demos/_schema.json:177:            "type": { "const": "external-image-step" },
api/assets/demos/_schema.json:178:            "image": { "type": "string", "minLength": 1, "description": "Path under /api/demos/assets/ of an external-portal screenshot." },
api/assets/bases/CSS_VARS_CONTRACT.md:79:Consumers must check for emptiness before applying the URL (e.g. `.logo[style*="--logo-url"] { background-image: var(--logo-url); }`).
api/src/services/demo-registry.ts:102:  type: z.literal('external-image-step'),
api/src/services/demo-registry.ts:103:  image: z.string().min(1),
api/src/services/branding/site-context.ts:477:  if (ctx.ogImage) lines.push(`og:image: ${ctx.ogImage}`);
api/src/services/branding/brand-assets.ts:131:      return { success: false, originalUrl: imageUrl, error: `Not an image: ${contentType}` };
api/src/apps/serving.ts:438:  r.use('/api/demos/assets', (_req, res, next) => {
api/src/apps/serving.ts:444:    '/api/demos/assets',
api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js:21: *   external-image-step.
api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js:224:      case 'external-image-step': {
api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js:225:        emit({ imageUrl: DEMOS_ENDPOINT.replace('/demos/', '/demos/assets/') + step.image });

hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,200p' api/assets/demos/_schema.json" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://ekoa.local/schemas/demo-spec.json",
  "title": "Ekoa Tutorial Bridge demo spec",
  "description": "A plain-English, code-free guided tour of one served artifact app. The authoritative validator is cortex/src/services/demo-registry.ts (validateDemoSpec); this JSON Schema mirrors it for humans and tests. Files named _*.json in ekoa-data/demos are NOT specs (this file is skipped by the loader).",
  "type": "object",
  "additionalProperties": false,
  "required": ["version", "appId", "card", "steps"],
  "properties": {
    "version": { "const": 1 },
    "appId": {
      "type": "string",
      "minLength": 1,
      "description": "Canonical app id / slug of the served artifact (e.g. legal-prazos). The tour opens /apps/<appId>/ in an iframe."
    },
    "tourId": {
      "type": "string",
      "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
      "description": "operator-run E1: kebab id keying one tour within an app (overview + one per journey). Optional and additive - the shipped platform specs omit it. The build-time tour writer stamps it on generated tours."
    },
    "kind": {
      "enum": ["overview", "journey"],
      "description": "operator-run E1: overview tour vs a per-journey tour. Optional and additive - the shipped platform specs omit it."
    },
    "card": { "$ref": "#/definitions/card" },
    "steps": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/definitions/step" }
    }
  },
  "definitions": {
    "copy": {
      "type": "object",
      "additionalProperties": false,
      "required": ["titlePt", "bodyPt"],
      "description": "PT-PT formal copy shown to the user. No emoji, no em-dashes.",
      "properties": {
        "titlePt": { "type": "string", "minLength": 1 },
        "bodyPt": { "type": "string", "minLength": 1 }
      }
    },
    "card": {
      "type": "object",
      "additionalProperties": false,
      "required": ["titlePt", "descriptionPt", "durationSec"],
      "properties": {
        "titlePt": { "type": "string", "minLength": 1 },
        "descriptionPt": { "type": "string", "minLength": 1 },
        "durationSec": { "type": "integer", "exclusiveMinimum": 0 },
        "thumbnail": {
          "type": "string",
          "minLength": 1,
          "description": "Optional path under /api/demos/assets/."
        }
      }
    },
    "simulateAction": {
      "description": "One deterministic action the HARNESS performs inside the iframe. Live users perform the action themselves; simulate exists so the automated test can drive the same flow.",
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["kind", "target"],
          "properties": {
            "kind": { "const": "click" },
            "target": { "type": "string", "minLength": 1 }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["kind", "target", "value"],
          "properties": {
            "kind": { "const": "fill" },
            "target": { "type": "string", "minLength": 1 },
            "value": { "type": "string" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["kind", "target"],
          "description": "Drives a native <select> (fill cannot). Provide value (option value) or index (0-based).",
          "properties": {
            "kind": { "const": "select" },
            "target": { "type": "string", "minLength": 1 },
            "value": { "type": "string" },
            "index": { "type": "integer", "minimum": 0 }
          },
          "anyOf": [{ "required": ["value"] }, { "required": ["index"] }]
        }
      ]
    },
    "step": {
      "description": "Target namespace: a plain name matches data-demo-target inside the app iframe; a 'host:' prefix matches data-demo-target on dashboard (host) elements.",
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["id", "type", "to"],
          "properties": {
            "id": { "type": "string", "minLength": 1 },
            "type": { "const": "navigate" },
            "to": { "type": "string", "minLength": 1, "description": "App-relative path inside the iframe, e.g. '/' or '/calculadora'." },
            "copy": { "$ref": "#/definitions/copy" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["id", "type", "target", "copy"],
          "properties": {
            "id": { "type": "string", "minLength": 1 },
            "type": { "const": "spotlight" },
            "target": { "type": "string", "minLength": 1 },
            "copy": { "$ref": "#/definitions/copy" },
            "timeoutMs": { "type": "integer", "exclusiveMinimum": 0 }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["id", "type", "target", "event", "simulate"],
          "description": "Executability invariant (enforced by validateDemoSpec, not expressible in JSON Schema): when event is \"click\", simulate.actions MUST include a click on this step's target - otherwise the awaited click never fires and the tour hangs.",
          "properties": {
            "id": { "type": "string", "minLength": 1 },
            "type": { "const": "await-action" },
            "target": { "type": "string", "minLength": 1 },
            "event": { "enum": ["click", "result-ready"] },
            "simulate": {
              "type": "object",
              "additionalProperties": false,
              "required": ["actions"],
              "properties": {
                "actions": {
                  "type": "array",
                  "minItems": 1,
                  "items": { "$ref": "#/definitions/simulateAction" }
                }
              }
            },
            "timeoutMs": { "type": "integer", "exclusiveMinimum": 0 }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["id", "type", "target", "copy"],
          "properties": {
            "id": { "type": "string", "minLength": 1 },
            "type": { "const": "annotate-result" },
            "target": { "type": "string", "minLength": 1 },
            "copy": { "$ref": "#/definitions/copy" },
            "timeoutMs": { "type": "integer", "exclusiveMinimum": 0 }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["id", "type", "surface", "prompt"],
          "properties": {
            "id": { "type": "string", "minLength": 1 },
            "type": { "const": "inject-prompt" },
            "surface": { "const": "chat" },
            "prompt": { "type": "string", "minLength": 1 },
            "sendInHarness": { "const": false, "description": "The harness never sends (the LLM may be unavailable); it only asserts the text landed." },
            "copy": { "$ref": "#/definitions/copy" }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["id", "type", "image", "copy"],
          "properties": {
            "id": { "type": "string", "minLength": 1 },
            "type": { "const": "external-image-step" },
            "image": { "type": "string", "minLength": 1, "description": "Path under /api/demos/assets/ of an external-portal screenshot." },
            "copy": { "$ref": "#/definitions/copy" }
          }
        }
      ]
    }
  }
}

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"Content-Security-Policy|img-src|script-src|frame-src|connect-src\" api/src/api assets web -g '"'!**/node_modules/**'"'" in /Users/ggomes/dev/ekoa-code
 exited 2 in 0ms:
rg: api/src/api: No such file or directory (os error 2)
rg: assets: No such file or directory (os error 2)
web/next.config.ts:88:    // allow the api as a frame SOURCE here (no frame-src = default-src 'self' = blocked).
web/next.config.ts:92:    // bootstrap. Websocket dev-HMR needs ws: in connect-src. The security-load-bearing directives
web/next.config.ts:96:    const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
web/next.config.ts:97:    const connect = isDev ? `connect-src ${connectSrc} ws: wss:` : `connect-src ${connectSrc}`;
web/next.config.ts:102:      `img-src ${imgSrc}`,
web/next.config.ts:103:      `frame-src ${frameSrc}`,
web/next.config.ts:113:          { key: "Content-Security-Policy", value: csp },
web/lib/bridge-local.ts:10: * NEXT_PUBLIC_BRIDGE_LOCAL_ORIGIN — the same origin sits in the dashboard CSP connect-src,

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"Content-Security-Policy|img-src|script-src|frame-src|connect-src\" api/src api/assets web --glob '"'!**/node_modules/**'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
web/next.config.ts:88:    // allow the api as a frame SOURCE here (no frame-src = default-src 'self' = blocked).
web/next.config.ts:92:    // bootstrap. Websocket dev-HMR needs ws: in connect-src. The security-load-bearing directives
web/next.config.ts:96:    const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
web/next.config.ts:97:    const connect = isDev ? `connect-src ${connectSrc} ws: wss:` : `connect-src ${connectSrc}`;
web/next.config.ts:102:      `img-src ${imgSrc}`,
web/next.config.ts:103:      `frame-src ${frameSrc}`,
web/next.config.ts:113:          { key: "Content-Security-Policy", value: csp },
web/lib/bridge-local.ts:10: * NEXT_PUBLIC_BRIDGE_LOCAL_ORIGIN — the same origin sits in the dashboard CSP connect-src,
api/src/security-headers.ts:15: *     — `Content-Security-Policy: frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`.
api/src/security-headers.ts:79:    res.setHeader('Content-Security-Policy', API_CSP);
api/src/security-headers.ts:88:      'Content-Security-Policy',
api/src/security-headers.ts:93:    res.setHeader('Content-Security-Policy', SERVED_APP_CSP);

hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_search started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_search (failed)
user cancelled MCP tool call
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_search started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_search (failed)
user cancelled MCP tool call
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_search started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_search (failed)
user cancelled MCP tool call
codex
I’ve narrowed it to two classes now: actual runtime/player behavior issues and test coverage gaps. I’m reading the served-app CSP and the existing action-queue pause/cancel path to see whether the new spotlight path accidentally weakens either of those guarantees.
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,220p' api/assets/action-runtime-client.js" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'rg -n "pause|cancelById|pause-on-user-input|activeRun|pendingRuns|__ekoaActionRuntimeInstalled|tour-request|startTour" api/assets/action-runtime-client.js' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
25: *                 actions.tour-request {id, tourId}  (kind 'startTour' only)
41:  if (window.__ekoaActionRuntimeInstalled) return;
42:  window.__ekoaActionRuntimeInstalled = true;
262:  // treated as pause-on-user-input - the player advances the tour instead. Pure
478:      case 'startTour': {
480:        post('actions.tour-request', { id: id, tourId: action.tourId || null });
556:  function cancelById(id) {
645:        cancelById(data.id);
658:  // confirmation, same pause-on-user-input) and resolves a Promise with the terminal result. The
675:    cancel: function (id) { cancelById(id); },

 succeeded in 0ms:
/*
 * Ekoa In-Page Action Runtime - CLIENT (injected into every served artifact app).
 *
 * Plain browser IIFE, no build step (sibling to demo-bridge-client.js). The
 * platform injects this file via a <script src="/__ekoa/action-runtime.js"> tag
 * added by injectAppContext() in api/src/apps/injected-context.ts. It is a no-op
 * until a host (the operator assistant panel) sends an `actions.init`
 * postMessage, so it NEVER affects normal app usage.
 *
 * It executes the app's declared ui_actions (shared/src/action-manifest.ts) by
 * driving the app's OWN state layer through user-EQUIVALENT DOM events - the
 * same events a human interaction produces - so the app's validation and
 * business logic always run. It carries NO authorisation logic: the destructive
 * confirmation is a UX affordance only; server-side authorisation lives in a
 * later block.
 *
 * Protocol (postMessage envelope: { __ekoaActions: 1, type, ... }):
 *   Host -> app:  actions.init {hostOrigin},
 *                 actions.execute {id, action}  (action = a manifest AppAction
 *                   JSON, with param VALUES carried on action.params),
 *                 actions.cancel {id}
 *   App -> host:  actions.ready {targets},
 *                 actions.result {id, status:'done'|'failed'|'cancelled'|'confirm-pending', detail?},
 *                 actions.error {id, reason},
 *                 actions.tour-request {id, tourId}  (kind 'startTour' only)
 *
 * Origin validation mirrors the demo bridge: the host origin is pinned from the
 * FIRST actions.init whose origin matches document.referrer's origin (when the
 * referrer is absent, the first init is accepted and its origin pinned).
 * Afterwards any message from a different origin is rejected, and every reply is
 * posted with an explicit targetOrigin. This keeps a served app from being
 * driven by a hostile frame.
 *
 * Optional app-side hooks the runtime looks for (a generated app MAY provide
 * them on window.__ekoaApp): `navigate(route)` for local-state page navigation,
 * and `actions[<id>](params)` for kind 'custom'.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__ekoaActionRuntimeInstalled) return;
  window.__ekoaActionRuntimeInstalled = true;

  var POLL_MS = 200;
  var TARGET_TIMEOUT_MS = 8000;
  var HIGHLIGHT_MS = 2500;

  var hostOrigin = null; // pinned on first valid actions.init
  var active = false;
  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) { reducedMotion = false; }

  // Execution state. `queue` holds not-yet-started executes; `activeItem` is the
  // one currently running or awaiting confirmation. teardown() removes the
  // item's transient UI/timers WITHOUT reporting - the caller decides the report.
  var queue = [];
  var activeItem = null; // { id, action, teardown }

  function noop() {}

  // ---- messaging -------------------------------------------------------------

  function post(type, payload) {
    if (!hostOrigin || typeof window.parent === 'undefined' || window.parent === window) return;
    var msg = { __ekoaActions: 1, type: type };
    if (payload) {
      for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
    }
    try { window.parent.postMessage(msg, hostOrigin); } catch (_) { /* host gone */ }
  }

  function currentTargets() {
    var out = [];
    var seen = Object.create(null);
    var nodes = document.querySelectorAll('[data-demo-target]');
    for (var i = 0; i < nodes.length; i++) {
      var name = nodes[i].getAttribute('data-demo-target');
      if (name && !seen[name]) { seen[name] = true; out.push(name); }
    }
    return out;
  }

  function findTarget(name) {
    if (!name) return null;
    try {
      return document.querySelector('[data-demo-target="' + String(name).replace(/"/g, '\\"') + '"]');
    } catch (_) { return null; }
  }

  function refererOrigin() {
    try {
      if (!document.referrer) return null;
      return new URL(document.referrer).origin;
    } catch (_) { return null; }
  }

  // ---- param values ----------------------------------------------------------

  // At EXECUTE time action.params carries VALUES (an object like { valor: 'X' }),
  // distinct from the manifest's param DEFINITIONS (an array). Read defensively.
  function paramsObject(action) {
    var p = action && action.params;
    if (p && typeof p === 'object' && !Array.isArray(p)) return p;
    return {};
  }
  function paramValue(action, keys) {
    var p = paramsObject(action);
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(p, keys[i]) && p[keys[i]] != null) return p[keys[i]];
    }
    return undefined;
  }

  // ---- user-equivalent DOM events -------------------------------------------

  // Set an input/textarea/select value via the NATIVE setter, then dispatch
  // bubbling input+change events so React's synthetic-event tracking (which reads
  // the native value) sees the change and runs the app's onChange/validation.
  function setNativeValue(el, value) {
    var proto;
    if (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) proto = HTMLTextAreaElement.prototype;
    else if (typeof HTMLSelectElement !== 'undefined' && el instanceof HTMLSelectElement) proto = HTMLSelectElement.prototype;
    else proto = HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fireEvent(el, type) {
    var ev;
    try {
      ev = new Event(type, { bubbles: true });
    } catch (_) {
      ev = document.createEvent('Event');
      ev.initEvent(type, true, false);
    }
    el.dispatchEvent(ev);
  }

  function fieldInside(host) {
    if (!host) return null;
    var tag = host.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return host;
    return host.querySelector ? host.querySelector('input,textarea,select') : null;
  }

  // ---- highlight / driving indicator ----------------------------------------

  // Build a fixed, full-viewport overlay carrying a highlight ring around `el`
  // (and, for a tour spotlight, a small copy tooltip anchored to it). The overlay
  // follows the element on scroll/resize and is pointer-events:none, so the user
  // (and an awaited real action) can still reach the element beneath. Returns a
  // handle whose clear() detaches the listeners and removes the node. This is the
  // ONE ring-drawing primitive: the transient driving highlight (highlightTarget)
  // and the persistent same-document tour spotlight (E2) both build on it - the
  // runtime OWNS this visible UI so the tour player never redraws it.
  function buildRingOverlay(el, opts) {
    opts = opts || {};
    var root = document.createElement('div');
    root.setAttribute('data-ekoa-actions-ui', opts.uiKind || 'highlight');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';

    var ring = document.createElement('div');
    ring.style.cssText =
      'position:fixed;border-radius:10px;box-shadow:0 0 0 9999px rgba(15,23,42,0.28);' +
      'outline:2px solid var(--color-primary, #0f766e);outline-offset:2px;' +
      'transition:top .15s ease,left .15s ease,width .15s ease,height .15s ease;';
    if (!reducedMotion) ring.style.animation = 'ekoaActionsPulse 1.4s ease-in-out infinite';
    root.appendChild(ring);

    // Optional tooltip: the tour step's PT-PT copy, rendered right where the user
    // is looking. Narration only (pointer-events:none via the root) - the advance
    // controls (Seguinte / Sair) live in the assistant panel, not here.
    var tip = null;
    var copy = opts.copy;
    if (copy && (copy.titlePt || copy.bodyPt)) {
      tip = document.createElement('div');
      tip.setAttribute('data-ekoa-actions-ui', 'spotlight-tip');
      tip.style.cssText =
        'position:fixed;max-width:280px;box-sizing:border-box;padding:12px 14px;' +
        'background:var(--color-surface, #ffffff);color:var(--color-text, #0f172a);' +
        'border:1px solid var(--color-border, #e2e8f0);border-radius:var(--radius-md, 8px);' +
        'box-shadow:0 12px 32px rgba(15,23,42,.20);' +
        'font-family:var(--font-sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif);' +
        'font-size:var(--text-sm, 13px);line-height:1.45;';
      if (copy.titlePt) {
        var tt = document.createElement('div');
        tt.style.cssText = 'font-weight:600;margin-bottom:4px;';
        tt.textContent = copy.titlePt;
        tip.appendChild(tt);
      }
      if (copy.bodyPt) {
        var tb = document.createElement('div');
        tb.style.cssText = 'color:var(--color-text-muted, #475569);';
        tb.textContent = copy.bodyPt;
        tip.appendChild(tb);
      }
      root.appendChild(tip);
    }

    document.body.appendChild(root);

    var reposition = function () {
      var r = el.getBoundingClientRect();
      ring.style.top = Math.round(r.top - 4) + 'px';
      ring.style.left = Math.round(r.left - 4) + 'px';
      ring.style.width = Math.round(r.width + 8) + 'px';
      ring.style.height = Math.round(r.height + 8) + 'px';
      if (tip) {
        // Prefer below the element; flip above when there is no room below.
        var th = tip.offsetHeight || 96;
        var tw = tip.offsetWidth || 280;
        var below = r.bottom + 10;
        var top = below + th > window.innerHeight && r.top - 10 - th > 0 ? r.top - 10 - th : below;
        var left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 8));
        tip.style.top = Math.round(top) + 'px';
        tip.style.left = Math.round(left) + 'px';
      }

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '220,520p' api/assets/action-runtime-client.js" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "sed -n '520,760p' api/assets/action-runtime-client.js" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
      }
      case 'select': {
        withTarget(id, action.target, function (host) {
          if (!activeItem) return;
          var sel = host.tagName === 'SELECT' ? host : (host.querySelector ? host.querySelector('select') : null);
          if (!sel) { finish('failed', 'no-select'); return; }
          highlightTarget(sel);
          var val = paramValue(action, ['value']);
          var idx = paramValue(action, ['index']);
          if (val != null) {
            setNativeValue(sel, String(val));
          } else if (idx != null && sel.options && sel.options[Number(idx)]) {
            setNativeValue(sel, sel.options[Number(idx)].value);
          }
          fireEvent(sel, 'input');
          fireEvent(sel, 'change');
          finish('done');
        });
        break;
      }
      case 'highlight': {
        withTarget(id, action.target, function (host) {
          if (!activeItem) return;
          highlightTarget(host);
          finish('done');
        });
        break;
      }
      default:
        fail('unsupported-kind');
        break;
    }
  }

  // ---- cancellation ----------------------------------------------------------

  function cancelById(id) {
    if (activeItem && activeItem.id === id) {
      var settle = activeItem.resolve;
      try { activeItem.teardown(); } catch (_) { /* ignore */ }
      hideDrivingBadge();
      activeItem = null;
      post('actions.result', { id: id, status: 'cancelled' });
      if (settle) { try { settle({ id: id, status: 'cancelled' }); } catch (_) { /* ignore */ } }
      runNext();
      return;
    }
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].id === id) {
        var qitem = queue.splice(i, 1)[0];
        post('actions.result', { id: id, status: 'cancelled' });
        if (qitem && qitem.resolve) { try { qitem.resolve({ id: id, status: 'cancelled' }); } catch (_) { /* ignore */ } }
        return;
      }
    }
  }

  // PAUSE-ON-USER-INPUT: a real (isTrusted) pointer/keyboard event during a
  // queued/executing sequence means the human took over - never fight them.
  // Cancel the active item (if it is still WAITING) and everything queued, and
  // report cancelled for each. Events on the runtime's OWN UI (the confirm
  // buttons, overlays) are ignored - they are the assistant, not the user.
  function cancelAllForUserInput() {
    var settlers = [];
    if (activeItem) {
      try { activeItem.teardown(); } catch (_) { /* ignore */ }
      settlers.push({ id: activeItem.id, resolve: activeItem.resolve });
      activeItem = null;
    }
    for (var i = 0; i < queue.length; i++) settlers.push({ id: queue[i].id, resolve: queue[i].resolve });
    queue.length = 0;
    hideDrivingBadge();
    clearHighlight();
    clearConfirm();
    for (var j = 0; j < settlers.length; j++) {
      var payload = { id: settlers[j].id, status: 'cancelled', detail: 'user-input' };
      post('actions.result', payload);
      if (settlers[j].resolve) { try { settlers[j].resolve(payload); } catch (_) { /* ignore */ } }
    }
  }

  function onUserInput(e) {
    if (!e || e.isTrusted !== true || !active) return;
    var t = e.target;
    if (t && t.closest) {
      try { if (t.closest('[data-ekoa-actions-ui]')) return; } catch (_) { /* ignore */ }
    }
    if (!activeItem && queue.length === 0) return;
    cancelAllForUserInput();
  }
  window.addEventListener('pointerdown', onUserInput, true);
  window.addEventListener('keydown', onUserInput, true);

  // ---- message dispatch ------------------------------------------------------

  window.addEventListener('message', function (e) {
    var data = e && e.data;
    if (!data || data.__ekoaActions !== 1 || typeof data.type !== 'string') return;

    if (data.type === 'actions.init') {
      // Pin the host origin from the FIRST valid init only (demo-bridge discipline).
      if (hostOrigin) {
        if (e.origin !== hostOrigin) return; // reject re-init from another origin
      } else {
        var ref = refererOrigin();
        if (ref && e.origin !== ref) return; // referrer known but mismatched -> reject
        hostOrigin = e.origin;
      }
      active = true;
      post('actions.ready', { targets: currentTargets() });
      return;
    }

    // Every other message must come from the pinned host origin.
    if (!hostOrigin || e.origin !== hostOrigin) return;

    switch (data.type) {
      case 'actions.execute': {
        if (!data.action || typeof data.id === 'undefined' || data.id === null) return;
        queue.push({ id: data.id, action: data.action });
        runNext();
        break;
      }
      case 'actions.cancel': {
        if (typeof data.id === 'undefined' || data.id === null) return;
        cancelById(data.id);
        break;
      }
      default:
        break;
    }
  });

  // ---- SAME-DOCUMENT public API ----------------------------------------------
  // The operator assistant PANEL (operator-run D2) mounts INSIDE the served app (same document,
  // at #ekoa-assistant-root), so it has no host frame to postMessage across - the cross-frame
  // path (post() -> window.parent) refuses same-window drive by design. This direct API routes a
  // manifest action through the SAME executor (same events, same highlight, same destructive
  // confirmation, same pause-on-user-input) and resolves a Promise with the terminal result. The
  // dashboard/tour iframe path is unchanged.
  var idSeq = 0;
  window.__ekoaActions = {
    /** Execute one manifest action; resolves { id, status:'done'|'failed'|'cancelled', detail? }
     *  or rejects on a structural error ({ status:'error', reason }). Never dispatches without the
     *  app's own events + (for destructive actions) the confirmation card. */
    execute: function (action) {
      return new Promise(function (resolve, reject) {
        if (!action || typeof action !== 'object') { reject({ status: 'error', reason: 'invalid-action' }); return; }
        active = true; // same-document drive needs no init handshake
        var id = 'panel-' + (++idSeq);
        queue.push({ id: id, action: action, resolve: resolve, reject: reject });
        runNext();
      });
    },
    /** Cancel a pending/active same-document action by the id returned in a result. */
    cancel: function (id) { cancelById(id); },
    /** SAME-DOCUMENT TOUR SPOTLIGHT (E2). Draw a persistent highlight ring + PT-PT
     *  copy tooltip on a data-demo-target element; resolves true once drawn, false
     *  if the target never appears within the poll window. The in-app tour player
     *  (tour-player.js) owns step sequencing + controls; the runtime owns this
     *  visible highlight, so it is never duplicated. No model call - pure client-
     *  side rendering of a pre-generated declarative tour. */
    spotlight: function (target, copy) { return drawSpotlight(target, copy); },
    /** Clear the current tour spotlight (advance to the next step / end of tour). */
    clearSpotlight: function () { clearSpotlight(); },
  };

  // Keyframes for the (motion-safe) accent pulse on the driven target.
  try {
    var style = document.createElement('style');
    style.setAttribute('data-ekoa-actions', 'styles');
    style.textContent =
      '@keyframes ekoaActionsPulse{0%,100%{outline-color:var(--color-primary, #0f766e)}50%{outline-color:rgba(45,212,191,.4)}}';
    (document.head || document.documentElement).appendChild(style);
  } catch (_) { /* ignore */ }
})();

 succeeded in 0ms:
      }
    };

    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition, true);

    return {
      root: root,
      reposition: reposition,
      clear: function () {
        try {
          window.removeEventListener('scroll', reposition, true);
          window.removeEventListener('resize', reposition, true);
        } catch (_) { /* ignore */ }
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
  }

  var hlOverlay = null;
  var hlTimer = null;

  function clearHighlight() {
    if (hlTimer) { window.clearTimeout(hlTimer); hlTimer = null; }
    if (hlOverlay) { hlOverlay.clear(); hlOverlay = null; }
  }

  // Transient driving highlight around the element an action is driving.
  // Auto-clears after ~2.5s or on the next call.
  function highlightTarget(el) {
    clearHighlight();
    if (!el || !document.body) return;
    hlOverlay = buildRingOverlay(el, { uiKind: 'highlight' });
    hlTimer = window.setTimeout(clearHighlight, HIGHLIGHT_MS);
  }

  // ---- same-document tour spotlight (E2) -------------------------------------
  // A PERSISTENT ring + copy tooltip the in-app tour player (assistant panel,
  // tour-player.js) draws on a step's data-demo-target element. Unlike
  // highlightTarget it does NOT auto-clear and is NOT an execution-queue item, so a
  // real user click on the highlighted element (an await-action step) is NOT
  // treated as pause-on-user-input - the player advances the tour instead. Pure
  // client-side: no model call is ever made to draw or clear it.
  var spotlightOverlay = null;

  function clearSpotlight() {
    if (spotlightOverlay) { spotlightOverlay.clear(); spotlightOverlay = null; }
  }

  // Draw the spotlight on `name`, polling briefly (a target may not exist yet, e.g.
  // right after a navigate). Resolves true once drawn, false if it never appears.
  function drawSpotlight(name, copy) {
    return new Promise(function (resolve) {
      var draw = function (node) {
        clearSpotlight();
        spotlightOverlay = buildRingOverlay(node, { uiKind: 'spotlight', copy: copy });
        try { node.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' }); } catch (_) { /* ignore */ }
        resolve(true);
      };
      var found = findTarget(name);
      if (found) { draw(found); return; }
      var deadline = Date.now() + TARGET_TIMEOUT_MS;
      var timer = window.setInterval(function () {
        var el = findTarget(name);
        if (el) { window.clearInterval(timer); draw(el); return; }
        if (Date.now() > deadline) { window.clearInterval(timer); resolve(false); }
      }, POLL_MS);
    });
  }

  var badge = null;
  function showDrivingBadge() {
    if (badge || !document.body) return;
    badge = document.createElement('div');
    badge.setAttribute('data-ekoa-actions-ui', 'badge');
    badge.textContent = 'Assistente a executar...';
    badge.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483001;' +
      'background:var(--color-primary, #0f766e);color:var(--color-on-primary, #ffffff);' +
      'font-family:var(--font-sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif);' +
      'font-size:var(--text-sm, 13px);padding:8px 12px;border-radius:var(--radius-md, 8px);' +
      'box-shadow:0 8px 24px rgba(15,23,42,.18);pointer-events:none;';
    document.body.appendChild(badge);
  }
  function hideDrivingBadge() {
    if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
    badge = null;
  }

  // ---- destructive confirmation (UX affordance, NOT authorisation) -----------

  var confirmCard = null;
  function clearConfirm() {
    if (confirmCard && confirmCard.parentNode) confirmCard.parentNode.removeChild(confirmCard);
    confirmCard = null;
  }

  function showConfirm(action, onConfirm, onCancel) {
    clearConfirm();
    if (!document.body) { onCancel(); return; }

    var root = document.createElement('div');
    root.setAttribute('data-ekoa-actions-ui', 'confirm');
    root.style.cssText =
      'position:fixed;inset:0;z-index:2147483002;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(15,23,42,0.45);' +
      'font-family:var(--font-sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif);';

    var card = document.createElement('div');
    card.style.cssText =
      'max-width:320px;width:calc(100% - 32px);background:var(--color-surface, #ffffff);' +
      'color:var(--color-text, #0f172a);border:1px solid var(--color-border, #e2e8f0);' +
      'border-radius:var(--radius-lg, 12px);padding:20px;box-shadow:0 12px 32px rgba(15,23,42,.24);';

    var title = document.createElement('div');
    title.style.cssText = 'font-size:var(--text-base, 15px);font-weight:600;line-height:1.4;margin-bottom:16px;';
    title.textContent = 'Confirmar ação: ' + (action.labelPt || action.id || '');

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.setAttribute('data-demo-target', 'ekoa-cancelar-acao');
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.style.cssText =
      'padding:8px 14px;border-radius:var(--radius-md, 8px);border:1px solid var(--color-border, #e2e8f0);' +
      'background:transparent;color:var(--color-text, #0f172a);font-size:var(--text-sm, 13px);cursor:pointer;';

    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.setAttribute('data-demo-target', 'ekoa-confirm-acao');
    confirmBtn.textContent = 'Confirmar';
    confirmBtn.style.cssText =
      'padding:8px 14px;border-radius:var(--radius-md, 8px);border:1px solid var(--color-primary, #0f766e);' +
      'background:var(--color-primary, #0f766e);color:var(--color-on-primary, #ffffff);' +
      'font-size:var(--text-sm, 13px);cursor:pointer;';

    cancelBtn.addEventListener('click', function () { onCancel(); });
    confirmBtn.addEventListener('click', function () { onConfirm(); });

    row.appendChild(cancelBtn);
    row.appendChild(confirmBtn);
    card.appendChild(title);
    card.appendChild(row);
    root.appendChild(card);
    document.body.appendChild(root);
    confirmCard = root;
  }

  // ---- navigation ------------------------------------------------------------

  function doNavigate(route) {
    route = route || '';
    if (window.__ekoaApp && typeof window.__ekoaApp.navigate === 'function') {
      try { window.__ekoaApp.navigate(route); return true; } catch (_) { return false; }
    }
    // Fallback for router-based apps: hash routes go straight to location.hash;
    // path routes use pushState + a popstate dispatch so a listening router reacts.
    try {
      if (route.charAt(0) === '#') { window.location.hash = route; return true; }
      window.history.pushState({}, '', route);
      var pop;
      try { pop = new PopStateEvent('popstate', { state: {} }); }
      catch (_) { pop = document.createEvent('Event'); pop.initEvent('popstate', true, false); }
      window.dispatchEvent(pop);
      return true;
    } catch (_) {
      try { window.location.hash = route; return true; } catch (_) { return false; }
    }
  }

  // ---- execution queue -------------------------------------------------------

  function runNext() {
    if (activeItem || queue.length === 0) return;
    var item = queue.shift();
    activeItem = { id: item.id, action: item.action, teardown: noop, resolve: item.resolve, reject: item.reject };
    startItem(item.id, item.action);
  }

  // Terminal report for the active item. Tears down its transient UI and drains.
  // An item enqueued through the SAME-DOCUMENT API (window.__ekoaActions.execute) carries a
  // `resolve`/`reject` pair instead of a host frame; report to it directly. Cross-frame items
  // carry neither and report via post() (the iframe/dashboard host). post() no-ops in the
  // same-document case (no parent), so no message leaks.
  function finish(status, detail) {
    if (!activeItem) return;
    var id = activeItem.id;
    var settle = activeItem.resolve;
    try { activeItem.teardown(); } catch (_) { /* ignore */ }
    hideDrivingBadge();
    var payload = { id: id, status: status };
    if (detail) payload.detail = detail;
    activeItem = null;
    post('actions.result', payload);
    if (settle) { try { settle(payload); } catch (_) { /* ignore */ } }
    runNext();
  }

  // Terminal STRUCTURAL failure (mirrors demo.error): the action could not run.
  function fail(reason) {
    if (!activeItem) return;
    var id = activeItem.id;
    var settle = activeItem.reject;
    try { activeItem.teardown(); } catch (_) { /* ignore */ }
    hideDrivingBadge();
    activeItem = null;
    post('actions.error', { id: id, reason: reason });
    if (settle) { try { settle({ id: id, status: 'error', reason: reason }); } catch (_) { /* ignore */ } }
    runNext();
  }

  function startItem(id, action) {
    if (action && action.destructive === true) {
      // Client-side confirmation before ANY dispatch (UX, not authorisation).
      activeItem.teardown = clearConfirm;
      showConfirm(
        action,
        function onConfirm() {
          clearConfirm();
          if (activeItem) activeItem.teardown = noop;
          perform(id, action);
        },
        function onCancel() { finish('cancelled'); }
      );
      post('actions.result', { id: id, status: 'confirm-pending' });
      return;
    }
    perform(id, action);
  }

  // Resolve an element target, polling up to TARGET_TIMEOUT_MS (targets may not
  // exist yet - e.g. right after a navigate). fail('target-not-found') on timeout.
  function withTarget(id, name, onFound) {
    var found = findTarget(name);
    if (found) { onFound(found); return; }
    var deadline = Date.now() + TARGET_TIMEOUT_MS;
    var timer = window.setInterval(function () {
      if (!activeItem || activeItem.id !== id) { window.clearInterval(timer); return; }
      var el = findTarget(name);
      if (el) { window.clearInterval(timer); onFound(el); return; }
      if (Date.now() > deadline) { window.clearInterval(timer); fail('target-not-found'); }
    }, POLL_MS);
    activeItem.teardown = function () { window.clearInterval(timer); };
  }

  function perform(id, action) {
    if (!action || typeof action.kind !== 'string') { fail('invalid-action'); return; }
    showDrivingBadge();

    switch (action.kind) {
      case 'navigate': {
        var ok = doNavigate(action.route || '');
        finish(ok ? 'done' : 'failed', ok ? undefined : 'navigate-failed');
        break;
      }
      case 'startTour': {
        // The tour player lands in a later slice; the runtime only surfaces the request.
        post('actions.tour-request', { id: id, tourId: action.tourId || null });
        finish('done');
        break;
      }
      case 'custom': {
        var fn = window.__ekoaApp && window.__ekoaApp.actions && window.__ekoaApp.actions[action.id];
        if (typeof fn !== 'function') { fail('unregistered-custom-action'); break; }
        try { fn(paramsObject(action)); finish('done'); }
        catch (_) { fail('custom-action-threw'); }
        break;
      }
      case 'setField': {
        withTarget(id, action.target, function (host) {
          if (!activeItem) return;
          var field = fieldInside(host);
          if (!field) { finish('failed', 'no-field'); return; }
          highlightTarget(field);
          var val = paramValue(action, ['valor', 'value']);
          setNativeValue(field, val == null ? '' : String(val));
          fireEvent(field, 'input');
          fireEvent(field, 'change');
          finish('done');
        });
        break;
      }
      case 'toggle': {
        withTarget(id, action.target, function (host) {
          if (!activeItem) return;
          var el = null;
          try {
            el = host.matches && host.matches('input,button,[role="switch"],[role="checkbox"]')
              ? host
              : host.querySelector('input[type="checkbox"],input[type="radio"],[role="switch"],[role="checkbox"],button');
          } catch (_) { el = null; }
          var clickEl = el || host;
          highlightTarget(clickEl);
          try { clickEl.click(); } catch (_) { finish('failed', 'not-clickable'); return; }
          finish('done');
        });
        break;
      }

codex
I have two concrete product bugs and at least one gate gap. I’m validating one last edge: whether `external-image-step` can escape the `/api/demos/assets/` mount via `..` segments, because that determines whether there’s a third shipped issue or just a coverage problem.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
exec
/bin/zsh -lc "node -e \"for (const s of ['../../app-assistant','../x.png','legal.png','https://evil.test/x.png']) console.log(s, '=>', new URL('/api/demos/assets/' + s, 'http://x').pathname)\"" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
../../app-assistant => /api/app-assistant
../x.png => /api/demos/x.png
legal.png => /api/demos/assets/legal.png
https://evil.test/x.png => /api/demos/assets/https://evil.test/x.png

hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,220p' api/tests/apps/serving-tours.test.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { artifacts } from '../../src/data/stores.js';
import { indexSlug } from '../../src/apps/slug-index.js';
import { servingRouter } from '../../src/apps/serving.js';
import { stripReservedDataKeys, RESERVED_ARTIFACT_DATA_KEYS } from '../../src/apps/artifacts-service.js';

/**
 * operator-run E1 (codex-fix): the GET /api/demos/:appId generated-tour fallback + the
 * server-owned reserved-key protection that makes it safe to serve.
 *
 * The fallback serves a per-app OVERVIEW tour stored on artifact.data.tours. Because that surface
 * is public, `tours` must be server-owned (set only at activation, stripped from client patches)
 * AND the served tour must belong to the RESOLVED artifact. These tests pin exactly that: catalog
 * miss -> the artifact's own overview; slug resolves to the same artifact; invalid stored entries
 * dropped; a tour whose appId != the resolved artifact is NOT served; 404 when only bad data exists.
 */

const PORT_HOST = '127.0.0.1';

function tourSpec(appId: string, tourId: string, kind: 'overview' | 'journey') {
  // Shape matches the shipped legal-*.json specs (card.titlePt/descriptionPt/durationSec;
  // steps with id + copy.titlePt/bodyPt) so it validates through the SAME demoSpecSchema.
  return {
    version: 1,
    appId,
    tourId,
    kind,
    card: { titlePt: `Tour ${tourId}`, descriptionPt: 'Uma visita guiada à aplicação.', durationSec: 30 },
    steps: [{ id: 'inicio', type: 'navigate', to: '/', copy: { titlePt: 'Início', bodyPt: 'Bem-vindo.' } }],
  };
}

async function getJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://${PORT_HOST}:${port}${path}`);
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

describe('E1 — reserved-key protection (unit)', () => {
  it('tours/toursError/actionManifest/artifactType are server-owned reserved keys', () => {
    for (const k of ['tours', 'toursError', 'actionManifest', 'artifactType']) {
      expect(RESERVED_ARTIFACT_DATA_KEYS).toContain(k);
    }
  });

  it('stripReservedDataKeys removes a client-supplied tours bag but keeps app data', () => {
    const cleaned = stripReservedDataKeys({
      tours: [tourSpec('victim-app', 'poison', 'overview')],
      toursError: 'x',
      actionManifest: { version: 1, actions: [] },
      title: 'My App',
      count: 3,
    });
    expect(cleaned).not.toHaveProperty('tours');
    expect(cleaned).not.toHaveProperty('toursError');
    expect(cleaned).not.toHaveProperty('actionManifest');
    expect(cleaned).toEqual({ title: 'My App', count: 3 });
  });
});

describe('E1 — GET /api/demos/:appId generated-tour fallback (integration)', () => {
  let mem: MongoMemoryServer;
  let server: Server;
  let port: number;

  beforeAll(async () => {
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa');
    const app = express();
    // The /api/demos fallback under test is public; token auth is never exercised here.
    app.use(servingRouter({ verifyToken: () => { throw new Error('token auth not exercised in this suite'); } }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, PORT_HOST, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await closeMongo();
    await mem?.stop();
  });

  it('serves the artifact OWN overview tour on a catalog miss (resolved by raw id)', async () => {
    const id = 'art-tour-1';
    await artifacts.insert({
      _id: id,
      data: { tours: [tourSpec(id, 'geral', 'overview'), tourSpec(id, 'criar-cliente', 'journey')] },
    } as never);
    const { status, body } = await getJson(port, `/api/demos/${id}`);
    expect(status).toBe(200);
    expect((body as { tourId: string }).tourId).toBe('geral'); // the OVERVIEW, not the journey
    expect((body as { appId: string }).appId).toBe(id);
  });

  it('resolves a slug to its artifact and serves that artifact\'s overview', async () => {
    const id = 'art-tour-2';
    await artifacts.insert({ _id: id, data: { tours: [tourSpec(id, 'geral', 'overview')] } } as never);
    indexSlug('meu-app', id); // getAppIdBySlug reads the in-memory index, not the store directly
    const { status, body } = await getJson(port, '/api/demos/meu-app');
    expect(status).toBe(200);
    expect((body as { appId: string }).appId).toBe(id);
  });

  it('drops invalid stored entries and still serves a valid overview', async () => {
    const id = 'art-tour-3';
    await artifacts.insert({
      _id: id,
      data: { tours: [{ version: 1, appId: id, junk: true }, tourSpec(id, 'geral', 'overview')] },
    } as never);
    const { status, body } = await getJson(port, `/api/demos/${id}`);
    expect(status).toBe(200);
    expect((body as { tourId: string }).tourId).toBe('geral');
  });

  it('does NOT serve a tour whose appId != the resolved artifact (provenance)', async () => {
    const id = 'art-tour-4';
    // A tour smuggled into this artifact but stamped for another app must never be served here.
    await artifacts.insert({ _id: id, data: { tours: [tourSpec('victim-app', 'geral', 'overview')] } } as never);
    const { status } = await getJson(port, `/api/demos/${id}`);
    expect(status).toBe(404);
  });

  it('404s when the artifact has no tours / does not exist', async () => {
    const { status: noTours } = await getJson(port, '/api/demos/art-none');
    expect(noTours).toBe(404);
    const id = 'art-tour-5';
    await artifacts.insert({ _id: id, data: {} } as never);
    const { status: emptyData } = await getJson(port, `/api/demos/${id}`);
    expect(emptyData).toBe(404);
  });
});

exec
/bin/zsh -lc "sed -n '1,220p' web/next.config.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Resolve the cortex API URL at config-load time.
//
// Single source of truth: `../backend.port` written by garrison. We do
// NOT honor an inherited shell NEXT_PUBLIC_API_URL — past port drift
// came from stale env vars overriding the port files.
//
// In production builds the file isn't present; deployments are expected
// to set NEXT_PUBLIC_API_URL explicitly at build time, so we only enforce
// the file's presence in dev.
function resolveApiUrl(): string {
  const portFile = join(process.cwd(), "..", "backend.port");
  if (existsSync(portFile)) {
    const port = readFileSync(portFile, "utf8").trim();
    if (/^\d+$/.test(port)) return `http://localhost:${port}`;
    throw new Error(`next.config.ts: ${portFile} contents invalid: '${port}'`);
  }
  // Production / CI path: an explicit env var is required.
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;
  throw new Error(
    `next.config.ts: ${portFile} not found and NEXT_PUBLIC_API_URL not set. ` +
      "Garrison should write backend.port for local dev; production builds " +
      "must pass NEXT_PUBLIC_API_URL via the build environment."
  );
}

// The vertical presentation profile for pre-auth surfaces. Declared here (not
// only in .env.local) because Turbopack compiles bare process.env.NEXT_PUBLIC_*
// reads in client modules to a runtime polyfill lookup, which is empty in the
// browser — config `env` entries are inlined reliably (same mechanism as
// NEXT_PUBLIC_API_URL above). Falls back to parsing .env.local so dev and
// explicit build envs behave identically.
function resolveVertical(): string {
  if (process.env.NEXT_PUBLIC_EKOA_VERTICAL) return process.env.NEXT_PUBLIC_EKOA_VERTICAL;
  const envFile = join(process.cwd(), ".env.local");
  if (existsSync(envFile)) {
    const match = readFileSync(envFile, "utf8").match(/^NEXT_PUBLIC_EKOA_VERTICAL=(.*)$/m);
    if (match) return match[1].trim();
  }
  return "generic";
}

const nextConfig: NextConfig = {
  devIndicators: false,
  // Standalone output for the container image (Dockerfile.web sets NEXT_OUTPUT_STANDALONE=1):
  // emits `.next/standalone` with the traced server + minimal node_modules, so the runtime
  // image ships only what it needs. Off by default so dev/CI builds are unchanged.
  ...(process.env.NEXT_OUTPUT_STANDALONE ? { output: "standalone" as const } : {}),
  // Gate/CI builds can use an isolated dist dir so a `next build` never
  // corrupts a live dev server's .next incremental state.
  distDir: process.env.NEXT_BUILD_DIST_DIR || ".next",
  env: {
    NEXT_PUBLIC_API_URL: resolveApiUrl(),
    NEXT_PUBLIC_EKOA_VERTICAL: resolveVertical(),
  },
  // The single carried redirect (FC-100): `/settings` is a natural URL users
  // type. The other eight deleted stub routes had zero inbound links and get
  // no redirect.
  async redirects() {
    return [
      { source: "/settings", destination: "/settings/platform", permanent: false },
    ];
  },

  // Security-headers baseline for the dashboard (ch09 §9.8 D1, FIXED-14) — the web half of
  // D1; the api sets its own via composition-root middleware. A dashboard-scoped CSP (self +
  // the inline styles/scripts Next emits; connect to the API origin; frame-ancestors 'none'
  // so the authenticated dashboard cannot be framed by a served app or hostile origin), plus
  // HSTS / nosniff / referrer / X-Frame-Options.
  async headers() {
    const apiOrigin = process.env.NEXT_PUBLIC_API_URL || "";
    // The ekoa-bridge daemon's loopback surface (FC-406/FC-407, run D2): grants + the
    // egress ledger are fetched by the BROWSER straight from 127.0.0.1 — never proxied or
    // persisted hosted-side. Default port is the proposed C1 stable port; keep the literal
    // in sync with web/lib/bridge-local.ts (this config cannot import app code here).
    const bridgeLocalOrigin =
      process.env.NEXT_PUBLIC_BRIDGE_LOCAL_ORIGIN || "http://127.0.0.1:8791";
    const connectSrc = ["'self'", apiOrigin, bridgeLocalOrigin].filter(Boolean).join(" ");
    // Artifact thumbnails are served by the API (/artifact-screenshots, ch07 §7.11); in dev
    // that origin is http so the blanket `https:` does not cover it — allow it explicitly.
    const imgSrc = ["'self'", "data:", "blob:", "https:", apiOrigin].filter(Boolean).join(" ");
    // The artifact preview overlay frames the API's /apps/* plane (cross-origin). Framing is
    // two-sided: the api allowlists the dashboard via frame-ancestors, and the dashboard must
    // allow the api as a frame SOURCE here (no frame-src = default-src 'self' = blocked).
    const frameSrc = ["'self'", apiOrigin].filter(Boolean).join(" ");
    // Next's dev server (fast-refresh/HMR) and the webpack runtime evaluate code via eval, so
    // 'unsafe-eval' is required for the app to run; 'unsafe-inline' covers Next's inline
    // bootstrap. Websocket dev-HMR needs ws: in connect-src. The security-load-bearing directives
    // here are frame-ancestors 'none' (anti-clickjacking, the D1 requirement) + base-uri 'none';
    // script tightening to nonces is a certification-phase hardening (§9.9), not this run.
    const isDev = process.env.NODE_ENV !== "production";
    const scriptSrc = isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    const connect = isDev ? `connect-src ${connectSrc} ws: wss:` : `connect-src ${connectSrc}`;
    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      `img-src ${imgSrc}`,
      `frame-src ${frameSrc}`,
      "font-src 'self' data:",
      connect,
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;

codex
1. Medium — `api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js:184`, `:236`, `:271`, `:295`; `api/assets/action-runtime-client.js:272`; `api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx:273`  
   Tour runs are not lifecycle-safe. `startTourPlayback()` always calls the one shared player’s `start()` with no guard, `start()` reuses shared mutable state, and `cancel()` cannot abort an in-flight `rt.spotlight()` poll. Concrete failure: advance from step 1 into a spotlight whose target appears late, then click `Sair` or trigger another `startTour` before the target exists. The old runtime poll keeps running; when the target appears (or the poll times out) the cancelled run resumes on stale shared state, can redraw the overlay, and can wedge in a fresh `waitManual()` that nobody resolves.

2. Medium — `api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx:454`  
   Closing the panel mid-tour does not cancel the tour. The header close button only does `setCollapsed(true)`, so any active spotlight/manual-wait step keeps running while the UI with `Seguinte` / `Sair` disappears. Concrete failure: close the panel on a `spotlight` or `inject-prompt` step; the ring remains active and the tour is effectively stuck until the user reopens the panel.

3. Medium — `api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js:224`; `api/src/services/demo-registry.ts:102`; `api/src/security-headers.ts:14`  
   `external-image-step` does not enforce “path under `/api/demos/assets/`”. It blindly concatenates `step.image` into the URL, and the schema only requires a non-empty string. A hostile spec can use dot-segments: `../../app-assistant` normalizes to `/api/app-assistant`, so the browser issues arbitrary same-origin GETs outside the demo-assets mount. That is not arbitrary-origin XSS, but it is still an unintended request surface from untrusted tour data.

4. Low — `api/tests/e2e/tour-playback.e2e.mjs:241`, `:252`, `:322`  
   The live gate claims “panel fetched GET /api/demos/:appId”, but it never asserts that the route was actually hit, and it never exercises the assistant-returned `startTour` path at all. A regression that stopped fetching and instead used cached/embedded tour data, or broke only the assistant-action routing while leaving the teach launcher intact, could keep this gate green.

NEEDS-WORK
hook: Stop
hook: Stop Completed
tokens used
126,996
1. Medium — `api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js:184`, `:236`, `:271`, `:295`; `api/assets/action-runtime-client.js:272`; `api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx:273`  
   Tour runs are not lifecycle-safe. `startTourPlayback()` always calls the one shared player’s `start()` with no guard, `start()` reuses shared mutable state, and `cancel()` cannot abort an in-flight `rt.spotlight()` poll. Concrete failure: advance from step 1 into a spotlight whose target appears late, then click `Sair` or trigger another `startTour` before the target exists. The old runtime poll keeps running; when the target appears (or the poll times out) the cancelled run resumes on stale shared state, can redraw the overlay, and can wedge in a fresh `waitManual()` that nobody resolves.

2. Medium — `api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx:454`  
   Closing the panel mid-tour does not cancel the tour. The header close button only does `setCollapsed(true)`, so any active spotlight/manual-wait step keeps running while the UI with `Seguinte` / `Sair` disappears. Concrete failure: close the panel on a `spotlight` or `inject-prompt` step; the ring remains active and the tour is effectively stuck until the user reopens the panel.

3. Medium — `api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js:224`; `api/src/services/demo-registry.ts:102`; `api/src/security-headers.ts:14`  
   `external-image-step` does not enforce “path under `/api/demos/assets/`”. It blindly concatenates `step.image` into the URL, and the schema only requires a non-empty string. A hostile spec can use dot-segments: `../../app-assistant` normalizes to `/api/app-assistant`, so the browser issues arbitrary same-origin GETs outside the demo-assets mount. That is not arbitrary-origin XSS, but it is still an unintended request surface from untrusted tour data.

4. Low — `api/tests/e2e/tour-playback.e2e.mjs:241`, `:252`, `:322`  
   The live gate claims “panel fetched GET /api/demos/:appId”, but it never asserts that the route was actually hit, and it never exercises the assistant-returned `startTour` path at all. A regression that stopped fetching and instead used cached/embedded tour data, or broke only the assistant-action routing while leaving the teach launcher intact, could keep this gate green.

NEEDS-WORK
