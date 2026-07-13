# E2 fresh-context adversarial review — verdict

**Reviewer:** fresh-context adversarial (no prior stake). **Commits:** `fde090e` (same-document
tour playback + rebuild selector-stability gate), `fc27f10` (drop `home-empty` from
`SHELL_LANDMARKS`). **Branch:** operator-run.

## VERDICT: APPROVE

The three load-bearing E2 acceptance properties are genuinely satisfied and, for the most
critical one (zero-token), structurally guaranteed rather than merely observed. All static
gates pass on my own runs. The findings below are all **Low** (robustness / coverage / UX
polish); none blocks the slice.

## Evidence I gathered myself (did not trust reported results)

| Check | Command | Result |
|---|---|---|
| E1/E2 vitest suites | `npx vitest run tests/apps/{tour-player,action-runtime,assistant-panel,tour-writer,serving-tours}.test.ts` | **79 passed** |
| Typecheck | `cd api && npx tsc --noEmit` | **exit 0** |
| Lint (changed .ts + assets) | `npx eslint …` | exit 0 (browser assets ignored, same policy as `demo-bridge-client.js`) |
| Egress chokepoint | `npm run gate:chokepoint` | **clean, exit 0**; no `@anthropic-ai`/`api.anthropic.com` in the new files |
| Console allowlist verbatim | diff `benign()` vs `assistant-panel.e2e.mjs` / `assistant-modes.e2e.mjs` | **identical** (favicon 404, whoami 401, app-health 5xx) — not broadened |
| Live cast | `evidence-live.cast` | valid asciinema v3; 13 PASS + `E2 LIVE GATE: PASS`, exit 0, realistic timings (108s build / 61s rebuild) |
| Spotlight UI | `live-02-spotlight-appnav.png` (viewed) | teal ring correctly around real `app-nav`; panel shows "Passo 2 de 6 / Navegação / Seguinte / Sair" |
| Diagram invariant | `docs/diagrams/03-request-crud.excalidraw` | real E2 tour-player node + "reuses spotlight" arrow added |

## Checklist results (evidence-based)

**2. Zero-token (load-bearing) — PASS, structurally proven.** `tour-player.js` has exactly one
network read — `load()` at `tour-player.js:257` issues `GET /api/demos/:appId` (no `method`, no
body → GET). There is no POST path anywhere in the module; `inject-prompt` only sets
`injectedPrompt = step.prompt` (`tour-player.js:219`) and never sends. The panel mirrors it via
`setDraft(state.injectedPrompt)` (`AssistantPanel.jsx:259`) with no auto-send. The runtime
spotlight (`action-runtime-client.js:272` `drawSpotlight`) is draw-only. The e2e counts real
requests, not a flag: `assistantPosts` increments on every `POST …/api/app-assistant`
(`tour-playback.e2e.mjs:235-237`) and is asserted `=== 0` across the whole tour AND the rebuild
replay (`:295`, `:307`, `:331`). Because the source has no send path, **no tour spec can trigger a
model call** — the schema even forbids `sendInHarness:true` (`demo-registry.ts:96`
`z.literal(false).optional()`) and the player ignores the field entirely.

**3. Runtime refactor safety — PASS.** The C3 transient highlight is preserved: `highlightTarget`
(`action-runtime-client.js:250`) still `clearHighlight()`s, builds the ring via the extracted
`buildRingOverlay(el,{uiKind:'highlight'})` (`:253`), and re-arms the `HIGHLIGHT_MS` auto-clear
(`:254`) — same ring geometry, same 2.5s auto-clear, same add/remove-listener symmetry (`clear()`
removes the same `reposition` closure it added, `:230-236`). `action-runtime.test.ts` is green.
The spotlight is deliberately **outside** the execution queue (never touches `queue`/`activeItem`),
so `onUserInput` short-circuits (`:607` `if (!activeItem && queue.length === 0) return;`) during an
await-action — a real user click on the target is not swallowed. Conversely the spotlight cannot
drive actions: `drawSpotlight` only builds an overlay + `scrollIntoView` (`:272-289`), never
dispatches events. The overlay root is `pointer-events:none` (`:163`), so the awaited click passes
through to the real element — confirmed in the geometry assertion + screenshot.

**4. Injection surfaces — PASS.** The C3 tooltip primitive renders copy with `textContent`
(`action-runtime-client.js:191`, `:197`) — no `innerHTML`. The panel renders copy through React JSX
(`AssistantPanel.jsx:171-178`, auto-escaped). `injectedPrompt` lands as a textarea *value*, not
markup. The only spec-derived attribute is the image `src` (`AssistantPanel.jsx` `TourView`, from
`tour-player.js:225`), which is prefixed with `/api/demos/assets/` and React-escaped — a hostile
tour spec cannot become XSS in a served app even if E1 validation were bypassed.

**5. E2E honesty — PASS.** The gate fails if the property fails (`assert`→`process.exit(1)`). The
rebuild is a real follow-up build on the same `artifactId` (`tour-playback.e2e.mjs:119-136`), fails
loud if the classifier deflects (`:126`), and selector-stability is asserted against the **reloaded
rebuilt DOM** (`:319` reload → `:328` `spotlightSurrounds(page,'app-nav')`). The fixture is
schema-validated against the real `validateDemoSpec` (`tour-player.test.ts:193-196`) — I re-ran it,
passes. The console allowlist is verbatim-identical to the D2/D3 baseline drivers.

**6. `fc27f10` — PASS.** `home-empty` is used nowhere else as a landmark: the only remaining
references are `App.jsx:36` (the placeholder itself), the tour-writer comment, and tests
(grep confirmed). `SHELL_LANDMARKS` is consumed only at `tour-writer.ts:167`, and `readTours`
still returns `status:'valid'` with a warning (warn-not-fail preserved) — the new test at
`tour-writer.test.ts:211` pins exactly that.

**7. Copy/brand — PASS.** No em/en-dash in any shipped source (`tour-player.js`,
`AssistantPanel.jsx/.css`, `action-runtime-client.js`, fixture) — grep clean. No emoji (tests
`\p{Extended_Pictographic}` + my grep). New strings are PT-PT formal. CSS is brand-neutral: every
color is `var(--color-*, fallback)`, hex only as var fallbacks (established codebase pattern).

**8. Boundaries — PASS.** No auth/permission logic added (spotlight is draw-only; startTour routing
is pure dispatch). Chokepoint clean. `tour-player.js` imports nothing; the panel imports only local
siblings. `api/src` change is limited to removing one constant from an array.

## Findings (all Low)

**1. [Low — robustness] Double-start re-entrancy in the tour player.**
`tour-player.js:271` `start()` has no guard against being called while a run is in flight. A second
`start()` sets `cancelled=false` and enters a second `run()` loop (`:236`) that shares the module's
mutable `stepIndex`/`status`/`spec`/`advanceResolve`/`cleanupAwait`. The second loop's `waitManual`
(`:111`) overwrites `advanceResolve`, orphaning the first loop's pending promise; if the first loop
was at an `await-action`, its capture-phase click listener + interval + timeout leak because
`cleanupAwait` (`:139`) was also overwritten and `cancel()` only runs the latest cleanup.
*Scenario:* while a teach-launched tour is mid-flight the composer stays active
(`AssistantPanel.jsx` renders it unconditionally), so a user message whose reply carries a
`startTour` action re-enters via `startTourPlayback` (`:311-312`) with no in-flight check. Effect is
a visual tour restart plus a leaked listener, not a hard wedge. *Fix:* early-return from `start()`
(or `startTourPlayback`) when `status` is `loading|playing|awaiting`. The primary UI path (the
launcher) is already guarded — it is hidden while `tourActive`.

**2. [Low — UX] Collapsing the panel mid-tour orphans the on-page spotlight.**
`AssistantPanel.jsx:438-445` returns only the launcher when `collapsed`, and `tourActive`/`TourView`
are computed *after* that early return (`:447`). The header close button calls `setCollapsed(true)`
(`:454`) without stopping the player, so the runtime spotlight backdrop + ring remain on the page
with no visible advance/exit controls. It is recoverable (re-opening restores `TourView`, and
`pointer-events:none` keeps the page usable), and await-action clicks still advance via the document
listener — but a `waitManual` step (spotlight/inject-prompt) leaves a dimmed page until re-open.
*Fix:* treat the header close as tour cancel while a tour is active, or keep a minimal "resume tour"
affordance in the collapsed state.

**3. [Low — coverage] `annotate-result` and `external-image-step` are handled but never exercised.**
The player implements all six step types (`tour-player.js:194-233`), but the unit test only greps
for the `case` labels (`tour-player.test.ts:63-74`) and the live fixture drives only
`navigate/spotlight/await-action/inject-prompt` — `annotate-result` and `external-image-step` have
no behavioural coverage. In particular the image URL construction
`DEMOS_ENDPOINT.replace('/demos/','/demos/assets/') + step.image` (`tour-player.js:225`) is never
verified against a real serving route, so it may be a dead/broken path. Non-blocking (neither type
is in the E2 acceptance path), but worth a follow-up test or an explicit dismissal.

**4. [Low — context, not an E2 defect] Selector-stability rests on a generation convention.**
The rebuild gate proves `app-nav`/`app-content` survive *one* real modification, but their survival
depends on the coding agent honouring the "Do NOT rebuild the shell … never remove the
data-demo-target attributes" instruction in `App.jsx:4-18` — a strong bolded convention, not a
lint/CI-enforced invariant (unlike the import/chokepoint rules). The `home-empty` finding
(`fc27f10`) is itself an instance of the shell/placeholder boundary living *inside* `App.jsx`. This
is an E1/scaffold-architecture consideration; E2's empirical proof is honest for its scope.

## Bottom line

The zero-token guarantee is proven from source (no send path exists) and asserted by a real request
counter across the whole tour; the C3 refactor is behaviour-preserving (tests green, same ring
semantics, spotlight provably queue-external and draw-only); no XSS/auth/chokepoint/boundary
regressions; diagram updated. Evidence (cast + screenshots + live-output) is genuine and internally
consistent. **APPROVE.**
