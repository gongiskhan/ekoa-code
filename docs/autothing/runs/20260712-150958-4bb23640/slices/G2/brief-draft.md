# G2 delegation brief (DRAFT - prepared at tick 985; delegate ONLY after E2 lands, then FINALIZE against E2's changes)

Slice G2: panel perf budget (lazy-load) + perf gate. Kind mixed, size 2, dep D2 (passed). BLOCKED until E2 lands: E2 holds the panel file reservations AND adds the tour player to the same files - G2 must lazy-load the FINAL panel (with player), not the pre-E2 one.

G2 ACCEPTANCE (FLOW_PLAN): panel lazy-loads (no blocking work on the app main thread); simple perf assertion in the app base (load delta budget) green with panel mounted.

SHAPE (finalize after E2):
1. Lazy-load: the assistant panel (AssistantPanel.jsx + tour player + css) must not be parsed/executed on app first paint - mount.js defers loading the panel chunk until launcher interaction or idle (dynamic import / requestIdleCallback pattern consistent with the scaffold's esbuild setup). The launcher itself stays tiny and immediate.
2. Perf assertion in the app base test rig: measure app load with panel mounted vs budget (load delta budget - pick a defensible number from measurement, not invented; document the baseline measurement in impl-notes).
3. e2e proof on a fresh app build: launcher visible immediately, panel chunk network-loaded only on open (or idle), tour playback still works after lazy mount (regression guard on E2).

CONSTRAINTS: no security/permission logic; PT-PT; no emoji; the C3 runtime stays eagerly injected (actions must work without the panel opened - only the PANEL lazy-loads, never the action runtime); serialize on the stack; console gate with the standard allowlist (whoami 401 + app-health 5xx).

RESERVED PATHS (reserve at delegation): api/assets/bases/app/scaffold/frontend/src/lib/assistant/** (mount.js chiefly), scaffold build config if chunking needs it, api/tests/e2e/panel-perf.e2e.mjs, api/tests/apps/panel-lazy.test.ts, slices/G2/**.

FINALIZATION CHECKLIST (lead, at delegation time): read E2 impl-notes + final panel file layout; confirm how the tour player is wired into mount.js; confirm whether esbuild scaffold supports code-splitting for the app bundle (if NOT, the lazy pattern is runtime fetch/eval of a second asset like the C3 runtime does - decide then); update HEAD + stack state.
