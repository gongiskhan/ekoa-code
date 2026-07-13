# G2 impl-notes - panel perf budget (lazy-load) + perf gate

Status: DONE-GREEN (unit-level). The build-consuming e2e (panel-perf.e2e.mjs) is authored
+ syntax-checked but NOT run - the lead runs it after rebuilding/restarting the stack
(api/src changes and the new panel-runtime build step are not live until then).

## What I built (the C3 pattern: panel becomes a platform-served runtime asset)

The operator assistant panel (AssistantPanel + tour-player + CSS) was baked into every
generated app's IIFE bundle via the scaffold, carrying its OWN React copy. App bundles are
esbuild `format:'iife'` (builder.ts:291), so code-splitting is impossible - that is WHY the
C3 pattern was chosen. G2 moves the panel to a PLATFORM-SERVED runtime asset, lazily loaded
by a tiny plain-DOM launcher that stays in the app bundle.

1. **Panel source moved out of the scaffold** to `api/assets/panel-runtime/src/`
   (`AssistantPanel.jsx`, `AssistantPanel.css`, `tour-player.js` via `git mv` - history
   preserved) + a NEW entry `index.jsx` that self-mounts `<AssistantPanel/>` into
   `#ekoa-assistant-root` exactly as the old in-bundle mount.js did, keeping the three
   guards (bounded wait-for-node over animation frames; once-only via
   `node.__ekoaAssistantMounted`; quiet give-up past MAX_FRAMES). The panel bundles its OWN
   React - zero interop with the app's React (it is a separate root, unchanged from D2).
   - `AssistantPanel.jsx` gained a `defaultOpen` prop for the launcher handoff (open now on
     an explicit click, mount collapsed on an idle preload) + a mount-only focus effect.

2. **Platform-side esbuild compile step** `api/assets/panel-runtime/build.mjs` produces
   `api/assets/panel-runtime.js` (IIFE, browser, target es2020, jsx automatic, React from
   the WORKSPACE node_modules via nodePaths - mirrors builder.ts sharedBuildOptions). CSS is
   bundled INTO the single JS via a `cssInject` esbuild plugin (a `.css` import becomes a
   style-injecting IIFE, guarded by `data-ekoa-panel`) so the asset is fully self-contained.
   Two deliberate deviations from sharedBuildOptions, appropriate for a served PLATFORM asset
   (not a per-app dev bundle): production React build (`NODE_ENV production`) + `minify:true`
   - smaller, cached once across every served app, no dev warnings in a lawyer's face.
   `buildPanelRuntime({ write })` is importable (the offline test compiles in memory);
   the CLI form writes the asset. Wired into the api build: `"build": "tsc -b && node
   assets/panel-runtime/build.mjs"`. Compiled artifact is `.gitignore`d (built at build time).
   - Verified: `node assets/panel-runtime/build.mjs` -> 221079 bytes, head
     `"use strict";(()=>{...` (IIFE), contains `ekoa-assistant-root` + `data-ekoa-panel`,
     zero `anthropic` occurrences.

3. **serving.ts** serves `/__ekoa/panel-runtime.js` exactly like the action runtime
   (read-once at boot from `api/assets/panel-runtime.js`, same JS content-type + CORS * +
   5-min cache, sibling route). Missing-at-startup fallback body:
   `/* ekoa panel runtime unavailable */` (mirrors the action-runtime fallback).

4. **Scaffold mount.js rewritten** to a MINIMAL plain-DOM launcher + lazy loader (NO React
   import): renders the launcher immediately (fixed bottom-right, class
   `ekoa-assistant-launcher` + inline styles mirroring AssistantPanel.css via the same
   CSS-var contract, ChatIcon SVG + "Assistente", aria-label "Abrir o assistente",
   PT-PT). On first launcher CLICK it sets `window.__ekoaAssistantAutoOpen = true` and
   injects the panel-runtime `<script>` (once); on idle it preloads without the flag. The
   loaded asset self-mounts and REMOVES the boot launcher (`data-ekoa-boot-launcher`) so
   there are never two launchers. index.jsx's `mountAssistant()` call site is unchanged.

## Idle-preload timing (deliberate, documented)

The brief: load on "FIRST launcher interaction OR requestIdleCallback (whichever first, idle
deferred ~2s fallback where rIC is absent)". I FLOOR the idle preload at 2000ms
(`setTimeout` then `requestIdleCallback({timeout:2000})`, or a plain `setTimeout` where rIC
is absent). Rationale: a promptly-interacting visitor (and the perf gate) always trigger the
load via their CLICK, never an eager idle fetch - so the "no panel-runtime fetch before
interaction" invariant is DETERMINISTIC, while a genuinely idle session is still warmed at
~2s. `ensurePanelLoaded()` is once-only, so a click after an idle preload (or vice versa)
never double-fetches.

## Handoff (open vs stay-closed)

- CLICK -> `window.__ekoaAssistantAutoOpen = true` -> asset mounts `AssistantPanel
  defaultOpen` -> panel opens + focuses the composer.
- IDLE preload -> no flag -> asset mounts collapsed (its own launcher), boot launcher
  removed -> warm but never steals the screen.

## Measured mount.js baseline + chosen budget (brief item 7b)

- Old baked mount.js (React import + createRoot): 2177 bytes, but it pulled the ENTIRE panel
  + a second React (~150KB+) into every app bundle.
- NEW plain-DOM launcher mount.js: **MEASURED 5273 bytes** (React-free; dense comments kept
  per the codebase idiom, which ship in the non-minified app bundle).
- Budget set at **8192 bytes** (~1.55x the measured baseline) in panel-lazy.test.ts. Defensible
  headroom for edits while guarding against the launcher ever regrowing into a heavy in-bundle
  module - the whole point of G2 is that the app bundle stops carrying the panel + a second
  React. Not an invented number: measured first, budget = measured x ~1.55.

## Tests

- Moved WITH the files: `tests/apps/tour-player.test.ts` (ASSIST base URL ->
  `api/assets/panel-runtime/src/`) and `tests/apps/tour-player.behavior.test.ts` (import path).
- NEW `tests/apps/panel-lazy.test.ts`: (a) scaffold assistant dir carries ONLY mount.js
  (AssistantPanel.jsx/css + tour-player.js gone; panel-runtime/src has them + index.jsx);
  (b) mount.js is React-free + renders launcher + lazy-loads + under the 8192-byte budget +
  no emoji; (c) the panel-runtime esbuild step compiles clean OFFLINE (in-memory,
  `write:false`, same real-esbuild posture as builder.test.ts) into an IIFE; (d) the compiled
  asset self-mounts (`ekoa-assistant-root`), injects styles (`data-ekoa-panel`), and carries
  no provider reference (a split `anthrop`+`ic` needle keeps this file clean of the token).
- NEW `tests/e2e/panel-perf.e2e.mjs`: committed re-runnable driver (modelled on
  tour-playback.e2e.mjs + assistant-panel.e2e.mjs; safeJson + transient-tolerant poll + 20min
  build deadline copied from fees-knowledge.e2e.mjs; verifyBuilds:false; benign allowlist =
  favicon + whoami 401 + app-health 5xx). Asserts: (a) launcher visible immediately + zero
  panel-runtime fetch before interaction; (b) click -> exactly one panel-runtime fetch + panel
  opens; (c) tour still plays after lazy mount (E2 fixture, full 6-step walk to "concluído");
  (d) zero POST /api/app-assistant throughout + still exactly one panel-runtime fetch (idle
  never double-loads); (e) zero non-benign console errors. DO NOT RUN until the stack is
  rebuilt+restarted (the panel-runtime route must be live).

## Diagram (FIXED-12)

Updated BOTH diagrams (lead approved 03 after my archaeology; 03 reserved to me under the run
identity):

- `docs/diagrams/03-request-crud.excalidraw` (the AFFECTED diagram, FIXED-12): amended the
  `e2-player-text` block (the panel/tour-player description) with three lines - "(G2) panel +
  player now load lazily as ONE platform-served asset /__ekoa/panel-runtime.js (sibling of the
  C3 runtime), injected by the scaffold launcher on interaction/idle - not baked into the app
  bundle." Grew `e2-player-rect` 90 -> 135 and `e2-player-text` 74 -> 111 (proportional, 6 -> 9
  lines) into the free space below; matches the file's element style (same font 24 / teal color),
  no emoji, no em-dash. Same minimal-text-amend approach E2 used.
- `docs/diagrams/07-content-composition.excalidraw` (reserved): KEPT the accurate NB on the
  `b1-base` box ("scaffold/+wiring -> files") that the panel + tour-player are NO LONGER baked
  here (platform-served lazy runtime, G2). Lead confirmed keeping it.

## Base skill docs (brief item 10)

`api/assets/bases/app/skills/using-the-assistant-panel.md`: updated to state the panel is a
platform-served runtime asset lazy-loaded by the app-bundle launcher (mount.js), that panel
improvements reach every app without a rebuild, and (kept true) the coding agent must never
render into `#ekoa-assistant-root`. `authoring-tours.md` needed no change (no moved-file
reference). The assertions the D2 suite pins (`platform`, `ui_actions`, `declaring-ui-actions.md`,
no emoji) are preserved.

## Commands run + results (unit-level; NO stack ops / fresh app builds / restarts / commits)

- `cd api && npx tsc --noEmit -p tsconfig.json` -> exit 0
- `cd api && npx tsc --noEmit -p tsconfig.test.json` -> exit 0
- `npx eslint` on serving.ts + the 4 touched/added .ts tests -> exit 0
  (assets/**/*.mjs + api/assets/** are eslint-ignored by design - .eslintrc.cjs; the .mjs
  drivers are node --check'd instead)
- `node --check tests/e2e/panel-perf.e2e.mjs` -> syntax OK; `node --check
  assets/panel-runtime/build.mjs` -> syntax OK
- `node assets/panel-runtime/build.mjs` -> built 221079-byte IIFE, markers present, egress-clean
- `cd api && npx vitest run tests/apps/` -> **19 files, 196 tests, all passed**
  (includes the moved tour-player suites, the updated assistant-panel D2 suite, and the new
  panel-lazy suite)
- `npm run gate:chokepoint` (repo root) -> clean (no @anthropic-ai/ or api.anthropic.com
  outside api/src/llm/)

## Reserved-path compliance (git status)

Within reserved paths: `.gitignore` (line), `api/assets/panel-runtime/**` (new src + build.mjs;
compiled panel-runtime.js is gitignored), `api/assets/bases/app/scaffold/frontend/src/lib/
assistant/**` (mount.js rewrite + the moved-away files), `api/src/apps/serving.ts`,
`api/package.json` (build script), `api/tests/apps/panel-lazy.test.ts`,
`api/tests/e2e/panel-perf.e2e.mjs`, `api/tests/apps/tour-player*.test.ts` (moved imports),
`docs/diagrams/07-content-composition.excalidraw`,
`api/assets/bases/app/skills/using-the-assistant-panel.md`, `slices/G2/**`.

Three edits OUTSIDE the reserved list, each mandatory and flagged to the lead:
1. `api/tests/apps/assistant-panel.test.ts` (D2 suite) - imports the MOVED panel; would
   hard-fail at load. Repointed panel/css imports to panel-runtime/src, added an ENTRY const
   for the asset's index.jsx, and rewrote the mount-wiring block to the lazy-load split
   (launcher in the bundle, self-mount in the asset). Required for `vitest run tests/apps/` green.
2. `api/tests/SUITE_LEDGER.json` - the suite-ledger census counts every
   api/tests/e2e/*.e2e.mjs on disk against node_drivers.drivers; adding panel-perf.e2e.mjs
   made it 21 vs 20 (census FAIL). Registered "panel-perf" (targetGate "operator-run G2",
   same convention as assistant-panel/tour-playback/fees-knowledge). Parity restored 21==21.
   (panel-lazy.test.ts is a tests/apps unit file, NOT censused by the runner - no entry needed.)
3. `docs/diagrams/03-request-crud.excalidraw` - lead approved + reserved to me; UPDATED (see
   Diagram section). No longer deferred.

`web/next-env.d.ts` shows modified but was already modified at session start - NOT my change.

## Deferred items

- panel-perf.e2e.mjs execution: needs the lead to rebuild api (runs the new panel-runtime
  build step) + restart + re-provision, so `/__ekoa/panel-runtime.js` serves the 221KB asset.
  (Lead owns the wall re-run, commit, stack rebuild+restart, live gate, and reviews.)
