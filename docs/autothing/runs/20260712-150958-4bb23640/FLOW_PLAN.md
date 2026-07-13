# FLOW_PLAN — Ekoa Apps Get an Operator (run 20260712-150958-4bb23640)

Derives from `RUN_SPEC.md` (read it first; its assumptions ledger governs). Profile: **build**. Branch: **`operator-run`** off main; checkpoint commit + tag `operator/<sliceId>` per slice; NOTHING merges to main (operator reviews the diff). Docs-kind slices run reduced gates (deterministic wall + fresh-context review of the deliverable vs the brief; no e2e/design/walkthrough — recorded as kind-conditional skips). Any slice touching the build pipeline keeps `api/tests/journeys/j3-build.mjs` green. Every api-behavior slice: contract test same slice; suite-ledger registration same change; diagram update when structure/flow/data changes. PT-PT for all lawyer-facing strings; NO emoji in UI code. NO security design/code anywhere before H* (permission needs call the S0 `can()` stub).

## Slice table

| id | title | kind | size | group | deps | status |
|---|---|---|---|---|---|---|
| S0 | run setup: branch, can() stub seam, run dirs | api | 1 | s0 | — | passed |
| A1 | exploration: automations layer + action primitives | docs | 2 | A | S0 | passed |
| A2 | exploration: demos/tutorials salvage (incl. ../ekoa-dev) | docs | 2 | A | S0 | passed |
| A3 | exploration: knowledge hooks + retrieval path | docs | 2 | A | S0 | passed |
| A4 | exploration: internal-templates archaeology + measured token-tax baseline | docs | 2 | A | S0 | passed |
| A5 | decision memos: registry / tour format / base set | docs | 2 | A | A1,A2,A3,A4 | passed |
| B1 | base registry + loader + build-flow selection | api | 5 | B | A5 | passed |
| B2 | the `app` base (panel mount point, protocol client, token link, error boundaries) | mixed | 5 | B | B1 | passed |
| B3 | base-manifest per-build verification (closes F16/F28 class) | api | 3 | B | B1 | passed |
| B4 | instruction migration: boilerplate → bases, measured shrink | docs | 3 | B | B1,B2,A4 | passed |
| C1 | artifact-type classifier in scoping (apps get the operator) | api | 3 | C | A5 | passed |
| C2 | action-registry contract: shared/ schema + build-time emission | api | 4 | C | A5 | passed |
| C3 | in-page action runtime (state-layer dispatch, highlight, destructive confirm) | mixed | 6 | C | B2,C2 | passed |
| C4 | assistant tool definitions from manifest + audit rows | api | 4 | C | C2 | passed |
| C5 | registry test-harness dual use + round-trip gate | api | 3 | C | C3,C4 | passed |
| D1 | assistant endpoint: /api/app-assistant through the chokepoint (grounding, citations, mode inference) | api | 6 | D | C4 | passed |
| D2 | assistant panel UI in the app base (first-open, modes, driving indicator, pause-on-input) | ui | 6 | D | B2,C3 | passed |
| D3 | three-modes scripted gate + pause assertion + cited answer | mixed | 3 | D | D1,D2 | passed |
| E1 | build-time tour generation (overview + per-journey, registry-ID selectors) | api | 4 | E | C2,A2 | pending |
| E2 | tour playback via panel (zero-token) + rebuild selector-stability gate | mixed | 4 | E | E1,D2 | pending |
| F1 | knowledge-during-build (detect domain-heavy, request uploads, index mid-build, narrate) | api | 5 | F | A3 | pending |
| F2 | fees sample app + seeded docs + cited-answer gate | mixed | 2 | F | F1,D1 | pending |
| G1 | assistant metering + billing-truth probe extension (tours/registry free) | api | 3 | G | D1 | pending |
| G2 | panel perf budget (lazy-load) + perf gate | mixed | 2 | G | D2 | pending |
| H1 | SECURITY: roles capability layer, builder→user migration, permission-gated build requests | mixed | 6 | H | all A–G | pending |
| H2 | SECURITY: identity/session handoff (explore, decide-and-document, implement; detect-then-ask) | api | 5 | H | H1 | pending |
| H3 | SECURITY: edit mode (admins) — scoped patch runs, preview/approve/rollback, admin discovery | mixed | 7 | H | H1,H2 | pending |
| H4 | SECURITY: request-changes queue (users) + refused-build feed | mixed | 5 | H | H1 | pending |
| H5 | SECURITY: assertions — capability matrix, no permissive stubs, edit journey, server-side destructive authz, cross-org isolation, request-changes journey | api | 5 | H | H1,H2,H3,H4 | pending |
| H6 | SECURITY: Codex adversarial review over the whole block + journey suite green | docs | 2 | H | H5 | pending |

31 slices total (incl. S0); sizes on a ~100-point whole-run scale; none > 8. SPINE = S0,A*,B*,C* (must land). NEXT = D*,E*,F*,G*. SECURITY = H* — contiguous, last, lands together or not at all (a partial H layer is worse than the stubbed seam; if the meter runs short, stop cleanly after G and leave H untouched).

## Per-slice acceptance (concise; RUN_SPEC's run-level criteria govern)

- **S0**: branch `operator-run` cut from main (next-env.d.ts churn restored); `api/src/auth/capabilities.ts` permissive `can()` stub + `shared/` capability union (marked PERMISSIVE-STUB, no callers yet); `docs/autothing/runs/<run>/analysis/` + `/memos/` dirs; ci:lane green.
- **A1**: `analysis/01-automations-actions.md` — verified map of automation step vocabulary, platform-primitives/MANIFEST capabilities, executor path; evidence for extend-vs-rebuild; confirms/kills the prior lean (registry as foundation).
- **A2**: `analysis/02-demos-tutorials.md` — demo-spec v1 capabilities vs tour needs; bridge command surface; player state machine; ../ekoa-dev delta; reuse verdict + gaps (registry-ID targets, execution steps).
- **A3**: `analysis/03-knowledge-hooks.md` — can indexing run mid-build (service call path, actor/org threading); retrieval + citation shape for the assistant; gaps needing a new hook.
- **A4**: `analysis/04-internal-templates.md` — where scaffold/instructions encode structure; MEASURED per-build structural-instruction token tax (the B4 baseline); where the internal-bases decision was dropped (bases authored, loader never built).
- **A5**: `memos/{registry,tour-format,base-set}.md` — recommendation + evidence each; flagged for operator in LANDING packet. Registry memo must state the manifest-level unification (UI actions + data capabilities in one per-app operate manifest) and the automations-migration path (documented, not executed).
- **B1**: loader reads `api/assets/bases/<id>` (manifest.json zod-validated); build flow selects a base (agent-selected with deterministic fallback by artifact type); scaffold consumes base scaffold via `templateScaffoldFiles`; generic starters remain the no-base fallback; J3 green; unit+contract tests.
- **B2**: new `api/assets/bases/app/` carrying: panel mount point + placeholder, protocol client stub, design-token link (served by reference), error boundaries, MANIFEST.md conventions; a base-built sample app builds and serves; J3-with-base green.
- **B3**: verify-runner asserts base-manifest files were replaced/extended by generation; a deliberately untouched-base build FAILS verification; test proves both directions.
- **B4**: structural boilerplate moved from `api/content/coding-agent/SKILL.md` into bases; migrated instruction content DELETED; measured shrink vs A4 baseline recorded in run docs (target: meaningful reduction, honestly reported).
- **C1**: scoping emits artifact type (app|presentation|report|document); only `app` artifacts get operator wiring; classifier output persisted on the artifact; contract test.
- **C2**: `shared/` action-manifest schema (navigate/setField/toggle/select/highlight/startTour + app-specific, destructive flag, param types); builder emits it at build time; stored with the artifact; contract test validates emitted manifests.
- **C3**: in-page runtime (app base) executes manifest actions through the app's own state dispatch (same events as human interaction — validation always applies); visible highlight; destructive actions get client confirmation; postMessage transport origin-pinned (demo-bridge pattern); sample-app action executes visibly.
- **C4**: assistant-side: manifest → typed tool definitions; every executed action logs an audit row via the single `logActivity` path; no permission logic (can() stub only).
- **C5**: tester agent can drive a built app through the registry; a journey probe for built apps uses it; ROUND-TRIP GATE: Cortex issues actions → UI visibly executes → audit rows land → destructive action prompts confirmation.
- **D1**: `POST /api/app-assistant` implemented per the (additively evolved) shared descriptor through `llm/` public entry, attribution `assistant-chat` billed to artifact owner; org-scoped knowledge grounding with citations; mode inference (do/show/teach); response can carry actions + citations + tour refs; contract tests incl. error envelope; mount-coverage updated.
- **D2**: panel mounts in every app-base app; first-open message states 3 capabilities with PT-PT examples (app-specific examples generated at build time); modes switchable; visible cursor/glow while driving; ANY user input pauses driving immediately; no emoji; design audit green.
- **D3**: scripted conversation e2e exercises all three modes on the sample app; pause-on-user-input asserted; a domain question returns a cited answer from indexed content.
- **E1**: builder generates declarative tours (overview + one per main journey) using registry-ID selectors; validated by the demo-spec (extended) schema; stored with the artifact.
- **E2**: tours playable from the panel client-side with ZERO LLM tokens (asserted: no token_events from playback); after a rebuild, highlights still match real elements (selector stability via registry IDs); gate green.
- **F1**: scoping detects domain-heavy apps → asks where knowledge comes from → accepts uploads → indexes into the org's knowledge area DURING the build → narrates it in the build stream; org-scoped; new hook covered by tests.
- **F2**: fees sample app built with seeded docs; assistant answers a fees question with a citation into the seeded content; committed re-runnable driver.
- **G1**: every assistant LLM turn metered + attributed (extends token_events/agentType); billing-truth probe extended to assistant turns and green; tour playback + registry-only actions provably free.
- **G2**: panel lazy-loads (no blocking work on app main thread); simple perf assertion in the app base (load delta budget) green with panel mounted.
- **H1–H6**: per BRIEF Phases 9–10 (coarse by design; detailed design AT implementation time, on the security block's opening). Binding: capability layer replaces the stub everywhere (grep: no permissive can() remains); Mongo (not Firestore) migration builder→user; refused build request → pre-drafted request to org-admin (never a dead end); detect-then-ask for edit powers; edit = scoped patch-profile runs (preview/approve/rollback); request-changes captures route+screen state from the registry; H5 asserts everything server-side incl. destructive-action authorisation and cross-org knowledge isolation via assistant retrieval; H6 = one-pass Codex adversarial review over the block + full journey suite green.

## Parallelism & shared-runtime notes

- Parallel-safe groups: {A1,A2,A3,A4}; {B3 with C1,C2 after B1}; {C3,C4}; {D1 vs D2}; {E1 vs F1}; {G1,G2}; {H3,H4}.
- SERIALIZE: the dev stack (one running api+web; rebuild+restart+re-provision credential after api changes — docs/testing.md playbook), any playwright-cli/browser recorder, esbuild sandbox builds for the SAME sample app, all `codex exec` calls (run-wide).
- Sample-app dependency: C5/D3/E2/F2/G2 gates all build/reuse the canonical fees sample app through the real pipeline (J3-style probe against the dev stack); those gates serialize on the stack.
- Cross-session: claim each slice's files as agent-mail reservations before editing; release on slice pass/block.

## Gate config notes

- docs-kind slices: test gate = committed deliverable + lint/typecheck wall green; adversarialReview reviews the document against brief/spec; adversarialTest/design/walkthrough kind-skipped (recorded).
- codexSliceReview: build profile → runs on every slice; expect classifier-redirect handling per Part 3 on security-flavored content (H block).
- deliberateRed + mutation: ON (≥3 slices).
- Turn cap: max(300, 80×31) = **2480** (runaway brake, not a schedule).

## Critical files

- `api/src/apps/scaffold.ts` — templateScaffoldFiles seam the base loader feeds.
- `api/src/apps/injected-context.ts` + `api/src/apps/serving.ts` — how in-app runtime JS ships (demo-bridge precedent; the action runtime + panel follow it).
- `api/src/agents/build.ts` + `api/src/apps/build-mechanics.ts` — build flow: base selection, manifest/tour emission, knowledge narration hooks.
- `shared/src/app-assistant.ts` (+ new shared action-manifest module) — the contract everything validates against.
- `api/src/llm/index.ts` + `api/src/billing/tracker.ts` — the only egress + metering path the assistant may use.
