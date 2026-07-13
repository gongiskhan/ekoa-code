# G2 delegation brief - FINAL (supersedes brief-draft.md; finalized 2026-07-13 post-E2/F2, run resumed ON MAIN)

Slice G2: panel perf budget (lazy-load) + perf gate. Kind mixed, size 2-3, dep D2+E2 (both passed).
Run context change: the run now commits DIRECTLY TO MAIN (operator instruction; no branches). Same
reserved-path discipline; the lead runs the gates.

## ACCEPTANCE (FLOW_PLAN, unchanged)
Panel lazy-loads (no blocking work on the app main thread); simple perf assertion in the app base
(load delta budget) green with panel mounted; e2e proof on a fresh app build.

## PATTERN DECISION (lead, finalization checklist answered)
The app frontend bundle is esbuild `format:'iife'` (api/src/apps/builder.ts:291) and the serving
validity check REQUIRES the single `bundle.js` IIFE shape (build-mechanics.ts bundleValid) - esbuild
code-splitting needs ESM, so in-bundle chunking is OUT. Decision: **the C3 pattern - the panel
becomes a platform-served runtime asset**, mirroring `action-runtime-client.js`
(api/src/apps/serving.ts:266,431):

1. **Panel runtime asset.** AssistantPanel.jsx + tour-player.js + AssistantPanel.css compile
   platform-side into ONE self-contained IIFE asset (React INCLUDED - the panel is already a
   separate React root rendered into `#ekoa-assistant-root`, zero interop with the app's React).
   Source moves from the scaffold to a platform dir (suggest `api/assets/panel-runtime/src/**`);
   compiled at api build time (esbuild step in the api build script) to `api/assets/panel-runtime.js`;
   served by serving.ts next to the action runtime (same headers/route family).
2. **Scaffold keeps only a tiny mount.js**: launcher render (immediate, no React needed - plain DOM,
   keep it a few KB) + lazy loader that injects the panel-runtime `<script>` on launcher interaction
   OR requestIdleCallback (whichever first). The C3 ACTION RUNTIME stays eagerly injected - only the
   PANEL lazy-loads; registry actions must work with the panel never opened.
3. **Why this over defer-mount-only**: true lazy (zero panel parse cost on app first paint), the
   asset caches ONCE across every served app, and panel fixes ship platform-side WITHOUT app rebuilds -
   this run already ledgered the pain of panel bugs frozen into built apps (E2/G1 scaffold-mid-edit
   collision). Old built apps carry the baked panel and keep working (the `__ekoaAssistantMounted`
   guard prevents double-mount); new builds get the lazy loader.

## SHAPE
1. Move panel source out of scaffold -> platform dir; add the api-build esbuild step (IIFE, browser,
   jsx automatic, css bundled or injected - match builder.ts sharedBuildOptions conventions).
2. serving.ts: serve `panel-runtime.js` (read-once like ACTION_RUNTIME_PATH; cache headers same as
   action runtime).
3. mount.js rewrite: plain-DOM launcher immediately; on first interaction or idle, inject the script,
   then hand off to the loaded panel (which self-mounts into #ekoa-assistant-root exactly as today).
   Keep the three mount guards (wait-for-node, once-only, quiet give-up).
4. Perf assertion (api/tests/apps/panel-lazy.test.ts): structural - the built app bundle contains NO
   panel/player/React-panel code (grep the fixture build output for panel markers), and mount.js stays
   under a measured byte budget (measure first, document the baseline in impl-notes; no invented numbers).
5. e2e (api/tests/e2e/panel-perf.e2e.mjs): fresh app build -> launcher visible immediately; panel-runtime
   network request happens ONLY on open (or idle) - assert request ordering/absence before interaction;
   tour playback still works after lazy mount (E2 regression guard); zero-token invariant intact
   (0 assistant POSTs during tour). Console gate with the standard allowlist (whoami 401 + app-health 5xx).
6. Tests move WITH the files (tour-player.behavior.test.ts import path etc.). Diagram: 07-content-composition
   (panel now platform-served, not scaffold-baked) - same unit of work.

## CONSTRAINTS
No security/permission logic (H-block rule; can() stays stubbed). PT-PT copy, no emoji, no em/en-dash
in authored copy. Serialize on the stack: NO fresh app builds by anyone else while scaffold is mid-edit
(the recorded sequencing rule); the lead holds the build-consuming e2e until scaffold edits are committed.
LLM budget: 1 fresh build for the e2e (+1 retry lead-authorized); 0 assistant turns needed (tour is
zero-token; if a turn is needed for a regression check, cap 1).

## RESERVED PATHS (reserve at delegation)
api/assets/panel-runtime/** (new), api/assets/bases/app/scaffold/frontend/src/lib/assistant/**,
api/src/apps/serving.ts, api/src/apps/builder.ts (only if the build-step hook lives there),
api package.json build script, api/tests/apps/panel-lazy.test.ts, api/tests/e2e/panel-perf.e2e.mjs,
api/tests/apps/tour-player*.test.ts (move), docs/diagrams/07-content-composition.excalidraw, slices/G2/**.
