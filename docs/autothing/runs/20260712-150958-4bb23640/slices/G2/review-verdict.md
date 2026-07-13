# G2 adversarial review verdict - fresh context

Reviewer: fresh-context adversarial (no prior stake). Commit `272f54d`
("feat(operator-run/g2): assistant panel becomes a platform-served lazy runtime asset").
Method: read the full diff + brief + impl-notes; independently ran the offline build, the
moved/new unit suites, the chokepoint gate, and the suite-ledger census; traced the CSP
and injection surfaces in `security-headers.ts` / `injected-context.ts` / `serving.ts`. Did
NOT run `panel-perf.e2e.mjs` (lead owns that run).

## VERDICT: APPROVE

Solid implementation. No High or Medium unaddressed defects. Three Low findings, each with
a cheap, concrete fix; none blocks merge. The live e2e gate the lead is running is the final
functional proof.

Scope note: after this verdict was first written, the first live-gate run FAILED and the
lead landed a fix commit `911f00b`. That commit is reviewed in a distinct section at the
end of this file ("## Follow-up: fix commit 911f00b"). The verdict stands: APPROVE. The fix
is correct and closes a real race - one that my first pass under-called (see 911f00b review,
finding on my own miss). Two of the three original Lows (Low-1 onerror-transport, Low-2
build-artifact fallback) remain; Low-3 (driver arm-after-click) is now fixed.

---

## Findings

### Low-1 - Lazy loader has no script `onerror`; a transport failure on first click permanently bricks the launcher for the page session
`api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js:96-105` (`ensurePanelLoaded`)
sets `injected = true` then appends `<script src="/__ekoa/panel-runtime.js">` with **no
`onerror`**. If that same-origin fetch fails at the transport level (api restarted mid-session
- the run's own model notes redeploys restart the api - offline, socket blip), the script
errors, `injected` stays `true`, the asset never runs to remove the boot launcher, and every
subsequent click is a no-op (the guard blocks a retry). Result: a visibly-present launcher that
silently does nothing until a full page reload, with no feedback.

Scope-limiting context (why Low, not Medium):
- This matches the **established platform precedent**: the sibling `/__ekoa/*.js` assets
  (`action-runtime.js`, `demo-bridge.js`) are injected as static `<script src>` tags
  (`injected-context.ts:260-261`) also with no `onerror`. G2 is consistent with the norm.
- The *likely* failure mode (missing build) is a 200 with a fallback body, so `onerror` would
  not fire for it anyway (see Low-2). This gap only bites a genuine transport failure, which
  requires the server/network to fail specifically between a successful same-origin page load
  and the click - low probability.
- The feature is non-critical and recoverable by reload.

Recommendation (one line): `s.onerror = () => { injected = false; };` so the next click retries.

### Low-2 - `panel-runtime.js` is a gitignored BUILD ARTIFACT (unlike its committed siblings); a build-skipping deploy yields a silently inert launcher with no client-side detection
`.gitignore:36` ignores `api/assets/panel-runtime.js`, whereas `action-runtime-client.js` and
`demo-bridge-client.js` are **committed** source served verbatim (`git ls-files` confirms).
`serving.ts:280-286` reads the asset once at boot and falls back to
`/* ekoa panel runtime unavailable */` (HTTP 200) when it is missing. A deploy that skips
`npm run build --workspace api` therefore serves a 200 comment body: the boot launcher renders,
clicking injects the "script" (a no-op comment), the panel never mounts, and the launcher is a
dead affordance. The only signal is a boot-time server log (`[panel-runtime] client unavailable`);
nothing client-side detects it, and no gate would (the e2e requires the built asset, so it would
just fail loudly rather than flag this specific state).

This is acceptable graceful degradation and the build IS chained (`package.json`:
`"build": "tsc -b && node assets/panel-runtime/build.mjs"`, verified exit 0; `&&` fails the whole
build on a panel-build error), so a normal build produces it. But it is the *first* build-artifact
asset served through this read-once/fallback path, introducing a deploy fragility the two committed
siblings don't have. Recommendation: an ops runbook note that the panel-runtime build step is now
required, and/or a louder startup warning is warranted.

### Low-3 - `panel-perf.e2e.mjs` leg B assumes the click is the FIRST panel-runtime fetch; a slow pre-click screenshot could let the 2s-floored idle preload fetch first and time out `waitForRequest`
`api/tests/e2e/panel-perf.e2e.mjs:261-265`: leg B does `launcher.click()` then
`page.waitForRequest(panel-runtime, {timeout:15_000})` and asserts `panelRuntimeReqs === 1`.
`page.waitForRequest` only matches requests fired **after** it is called. The idle preload is
floored at `IDLE_PRELOAD_MS = 2000` from `mountAssistant()` (mount.js:73,109-117). Leg A runs
several steps before the click - `launcher.waitFor` + `innerText` + two asserts + a **full-page
screenshot** (`:255`). If those exceed the ~2s head start (plausible only under heavy load, where
a full-page screenshot can take >1s), the idle preload fetches first; the once-only guard then
prevents any second fetch, so `waitForRequest` at `:262` waits 15s for a request that never comes
and fails the gate falsely.

The absence-before-interaction leg (A, `:253`) is robust - it is asserted immediately after the
launcher appears, i.e. ~0ms into the 2s window (the launcher and the idle timer start in the same
synchronous `mountAssistant()` execution). Only leg B carries the timing assumption, and in normal
conditions the 2s floor gives ample margin. But it is a latent, load-dependent flake in a committed
gate. Recommendation: move the `:255` screenshot to after the click, or assert on the counter
reaching 1 (idle-preload-tolerant) rather than `waitForRequest`.

---

## Checked and sound (rebuttals)

**Security**
- **Served-app CSP does NOT block the injected script.** The brief's central concern. There IS a
  CSP on served apps (`security-headers.ts:28,93`: `SERVED_APP_CSP = "frame-ancestors 'self'"`),
  which my first grep of `serving.ts` alone missed. It is deliberately **framing-scoped only** - no
  `script-src`/`default-src` - so it imposes zero constraint on the client-injected same-origin
  `<script src="/__ekoa/panel-runtime.js">`. The already-shipped `action-runtime.js` tag relies on
  this exact posture. (Note: the impl-notes never mention the served-app CSP; the safety is
  incidental to the framing-only design. A future tightening of `SERVED_APP_CSP` to add `script-src`
  would have to include `'self'` or it would also break the action-runtime tag - a shared constraint,
  not a panel-specific risk. Worth a one-line note in the impl record.)
- **Injection mechanism differs from the action runtime but is CSP-robust.** Action-runtime is a
  server-side `<script src>` in the HTML (`injected-context.ts:261`); panel-runtime is a
  client-side `document.createElement('script')` (mount.js). Both are same-origin loads; the
  "precedent" the impl claims is genuinely true for the *serving route* (headers/cache identical,
  `serving.ts:451-456`). No differential CSP risk.
- **Injected src is a fixed same-origin constant** (`PANEL_RUNTIME_SRC = '/__ekoa/panel-runtime.js'`,
  mount.js:69) - not attacker-influenceable.
- **No HTML injection into the launcher DOM.** `btn.innerHTML = CHAT_ICON + '<span>Assistente</span>'`
  (mount.js:144) - both fixed constants, no interpolation.
- **`window.__ekoaAssistantAutoOpen` page-writable is benign.** Only consequence is the assistant
  panel opening; not a security boundary, and the generated app is arbitrary same-page code anyway.
- **Egress chokepoint intact.** Built asset has 0 `anthropic` occurrences (verified on the compiled
  221079-byte output); `npm run gate:chokepoint` clean; no `@anthropic-ai` import in any new file.

**Lazy-load lifecycle**
- **No double-load / no lost click / no dead click (asset present).** Module-scoped `injected` guard
  is set synchronously before append. Click-during-idle-in-flight: the click sets `autoOpen` before
  the asset executes, and the asset reads the flag at mount -> opens (intent honored). Click-after-
  idle-mount: the React launcher is clicked (boot launcher already removed). No path double-fetches
  or drops the open intent when the asset is reachable.
- **`__ekoaAssistantMounted` interplay is correct.** index.jsx (`:38-43`) detects an already-mounted
  node (e.g. an old app baking the panel), skips the second mount, and still hands off (removes the
  boot launcher). New apps mount exactly once.
- **Never two launchers.** `removeBootLauncher` targets `[data-ekoa-boot-launcher]` only; the React
  launcher lacks that marker. Boot launcher persists until a successful mount, then is removed - at
  most a sub-frame overlap. Visual parity is close: inline `LAUNCHER_STYLE` mirrors the
  `.ekoa-assistant-launcher` CSS rule token-for-token (same z-index 2147482000, same CSS-var
  fallbacks); only the `:hover` brightness is absent on the boot launcher (negligible).
- **Keyboard a11y OK.** Boot launcher is a native `<button type="button">` with
  `aria-label="Abrir o assistente"` -> Enter/Space fire click natively -> panel opens and focuses
  the composer (the mount-only `defaultOpen` focus effect, AssistantPanel.jsx:411-417). PT-PT copy,
  no emoji, no em/en-dash in authored strings.

**Compat**
- **Pre-G2 apps keep working.** They carry their own baked panel + old mount.js in frozen bundles,
  never request `panel-runtime.js`; the new route doesn't touch them.
- **No dangling scaffold imports.** Scaffold references to AssistantPanel/tour-player are comments
  only; `index.jsx` imports `./lib/assistant/mount` and calls `mountAssistant()`. App build unaffected.
- **Existing e2e drivers (assistant-panel/modes/billing/tour-playback) still fit.** All do
  `launcher.waitFor(visible)` -> `click()` -> `waitFor(panel content)`; the boot launcher is visible
  immediately with class `ekoa-assistant-launcher`, and the async lazy mount is absorbed by their
  auto-waiting locators. They now depend on the built+served asset - the expected, intended
  consequence of the move; no code change needed in them.

**Test honesty**
- **Byte budget is not a tautology.** `panel-lazy.test.ts:61,85-90` reads the committed scaffold
  `mount.js` (measured 5273B vs 8192B budget) - the real file, not one it wrote.
- **Offline compile test compiles the REAL sources.** `buildPanelRuntime({write:false})` runs real
  esbuild over `index.jsx -> AssistantPanel.jsx -> tour-player.js -> AssistantPanel.css`. Independently
  reproduced: 221079-byte IIFE (`"use strict";(()=>{`), contains `ekoa-assistant-root` +
  `data-ekoa-panel`, 0 `anthropic`.
- **`panel-perf.e2e.mjs` genuinely asserts absence + exactly-one.** Request listeners attach BEFORE
  `page.goto` (`:226-229` vs `:241`), so pre-interaction absence (`:253`) is real; exactly-one is
  asserted on click (`:265`) and again after the idle timer (`:332`). Every `assert` hard-exits via
  `fail`->`process.exit(1)`; the final `PASS` prints only if all asserts held - no green-by-default
  path. The tour leg (C) is a real 6-step E2 regression walk to "Tutorial concluído" with spotlight
  geometry, await-action, and inject-prompt. The `/api/demos/**` stub is the schema-validated E2
  fixture (the only stub QA permits).
- **Unit suites pass.** `vitest run` over panel-lazy + D2 assistant-panel + both tour-player suites:
  4 files, 56 tests, all green (reproduced locally).

**Other**
- **D2 test not weakened.** The three mount guards (node-guard, once-only, bounded give-up) are
  re-asserted on the ASSET entry (index.jsx) where they now live (`assistant-panel.test.ts:127-139`);
  the panel source-contract assertions are unchanged and read the moved file; lazy-load wiring
  assertions were added. `AssistantPanel.jsx`/`.css`/`tour-player.js` are verbatim moves except the
  documented `defaultOpen` prop + mount-only focus effect (confirmed by content diff - nothing else
  changed).
- **SUITE_LEDGER census correct.** Independently verified parity: drivers on disk 21 == ledger 21
  (specs 66==66, units 30==30). panel-lazy.test.ts is a `tests/apps` unit file - not censused by the
  runner - so it correctly has no ledger entry. (Aside: the ledger runner then crashes downstream
  with `Unknown gate: operator-run C5` - a PRE-EXISTING limitation, operator-run gate names aren't in
  the runner's GATE_ORDER; it predates G2 and is unrelated. The census parity that G2 needed to
  satisfy is validated before that point.)
- **Diagrams updated in-commit (FIXED-12).** Both `03-request-crud.excalidraw` and
  `07-content-composition.excalidraw` touched in `272f54d`.
- **Build step fails the build on error.** `"build": "tsc -b && node assets/panel-runtime/build.mjs"`;
  build.mjs `process.exit(1)` on esbuild errors; `&&` propagates. Verified exit 0 locally.
- **Skill doc coherent.** `using-the-assistant-panel.md` now describes the launcher/lazy-load split,
  keeps "never render into #ekoa-assistant-root", no emoji, no em-dash.

---

## Follow-up: fix commit 911f00b (open-intent event + driver arm-before-click)

Landed after the first live-gate run FAILED at the load-on-interaction leg. The failure
exposed two things this commit fixes:
- a **driver race** (waitForRequest armed AFTER the click misses a fast same-origin fetch)
  - exactly my original **Low-3**;
- a **real product defect** - a launcher click landing between the idle-preload inject and
  the boot-launcher removal was silently lost, because `ensurePanelLoaded()` no-ops once
  injected and `window.__ekoaAssistantAutoOpen` is only read once at mount.

The fix: the boot-launcher click now ALSO dispatches `CustomEvent('ekoa:assistant-open')`
(mount.js:100-105); the panel adds a window listener calling `open()` (AssistantPanel.jsx:449-459).
Flag covers a click BEFORE the panel mounts (read at mount); event covers a click AFTER it
mounted collapsed. Driver arms the request waiter before the click, tolerates the
idle-race no-new-request case (`.catch(() => null)`), and asserts once-only on the TOTAL
fetch counter (panel-perf.e2e.mjs:265-274).

### Correction to my first pass (honesty)
My original review rated the "click during idle-fetch-in-flight" case as **sound** ("the
click's intent is honored -> open panel"). That was WRONG for the fast-mount sub-case: if
the idle-preloaded asset commits its collapsed mount and reads `autoOpen=false` before the
click sets it, the flag is never re-read and the click is lost. The live gate caught what my
static analysis missed. Credit to the gate; my rebuttal there was over-confident.

### Fix verdict: SOUND. No new defects.

- **Listener lifecycle - no leak, no duplicate.** `AssistantPanel.jsx:453-457` registers the
  listener in `useEffect(..., [open])` with a matching `removeEventListener` cleanup. `open`
  is `useCallback(() => {...}, [])` (AssistantPanel.jsx:440-447) - a STABLE identity - so the
  effect runs exactly once on mount and tears down on unmount; the dep never churns, so no
  repeated add. Verified the pairing (add:455 / remove:456) and the stable dep directly. The
  panel never actually unmounts (createRoot mounts once), but the cleanup is correct if it did.
- **Event spoofable but benign.** Any same-document script can
  `window.dispatchEvent(new CustomEvent('ekoa:assistant-open'))`; the only consequence is the
  assistant panel opening (+ composer focus). Not a security action - it dispatches no model
  call, runs no app-action, exfiltrates nothing - and the generated app is arbitrary
  same-document code that could already manipulate its own page. Same benign posture as the
  pre-existing page-writable `__ekoaAssistantAutoOpen` flag. Worst case is self-inflicted
  focus churn on a page spamming its own event - not a platform concern.
- **Collapsed-state open() focuses correctly.** The listener calls the same `open()` the React
  launcher's onClick uses: `setCollapsed(false)` + `setTimeout(() => textareaRef.current.focus(), 0)`
  after the re-render commits. Correct in the post-mount-collapsed path the event exists for.
- **No double-open / no focus fight.** Pre-mount click (flag path): the event is dispatched
  synchronously at click time, BEFORE the panel mounts, so no listener exists yet - it is
  harmlessly lost, and `defaultOpen` opens the panel. Post-mount click (event path): the flag
  is stale/unread, the event opens it. The two legs tile the timeline; they never both act on
  the same click, and `open()` is idempotent (`setCollapsed(false)` is a no-op when already
  open) so even a redundant call is harmless. The fix can only ever OPEN when intent exists -
  it cannot wedge or double-drive.
- **Contract is pinned.** `panel-lazy.test.ts:80-82` asserts BOTH sides of the magic-string
  coupling: `'ekoa:assistant-open'` present in mount.js (the dispatch) AND in AssistantPanel.jsx
  (the listener). Since the two assets are separately bundled they cannot share a const, so a
  shared-literal grep is the right contract guard here - drift on either side fails the suite.
  Behavioral proof remains the e2e. (The D2 assistant-panel.test.ts was not touched, which is
  fine - panel-lazy pins the new contract.)
- **Driver fix is honest and closes Low-3.** Arming `page.waitForRequest(...).catch(() => null)`
  BEFORE `launcher.click()` removes the arm-after race; not awaiting it and asserting on the
  authoritative `panelRuntimeReqs === 1` total makes the once-only claim true whether the click
  or the idle preload won the fetch (never eager - proven by leg A; never twice - proven here
  and re-checked after the idle timer in leg D). The comment is accurate about why the counter,
  not the waiter, is authoritative.
- **No regression to the other drivers.** The change is additive and idempotent; assistant-
  modes/billing/tour-playback still click `.ekoa-assistant-launcher` and wait for panel content,
  unaffected by an extra open-intent event they never dispatch.

### Independently re-verified after 911f00b
- `node assets/panel-runtime/build.mjs` -> compiles clean, 221238-byte IIFE, `ekoa:assistant-open`
  survives into the built asset.
- `node --check tests/e2e/panel-perf.e2e.mjs` -> OK.
- `vitest run tests/apps/panel-lazy.test.ts tests/apps/assistant-panel.test.ts` -> 2 files, 21
  tests, all green (panel-lazy now pins the event contract on both sides).

### Remaining
- **Low-1** (no script `onerror`) - **NOW FIXED** (landed after the 911f00b review, mount.js:75-78):
  `s.onerror` resets `injected = false` and removes the dead `<script>` node, so a transport
  failure no longer bricks the launcher - the next click (or the one-shot idle preload) retries.
  Verified sound: correctly scoped to transport failure only (the 200 fallback body does not fire
  onerror - that is Low-2, a separate deploy-config matter, not a transport error); retry is
  bounded to click / one-shot idle, so no loop; node removal is safe (fires after load definitively
  failed). panel-lazy.test.ts:83-85 pins `onerror`. mount.js is now 6227 bytes (budget 8192).
  Suites green (21).
- **Low-2** (panel-runtime.js is a gitignored build artifact -> a build-SKIPPING deploy serves the
  200 fallback, silently inert launcher, no client-side detection): still open by design. Not a
  code defect - ops-note territory (the build step is chained in package.json, so a normal build
  produces the asset). Worth a runbook line that the panel-runtime build step is now required.

VERDICT (incl. 911f00b + the onerror follow-up): APPROVE
