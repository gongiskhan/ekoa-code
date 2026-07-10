# RUN_SPEC — batch-final consolidation (run 20260710-100824-ee82acc1)

## What / why
One final remediation run before the operator simply uses the product: (0) reconcile the layered repo state (rc-1 → batch-1 tags → live operator-era fixes) into an explicit FINDINGS status dashboard on ONE branch `batch-final`, (1) close the verified-open findings that matter — F10 deny-list egress wiring, F26 de-anonymisation whitespace round-trip, F3 Registo rows, F29 automation-plan 500s, F7 honest failed-build page — each regression-test-first with its own `bf-<finding>` tag, and (2) prove the J3 build journey end-to-end twice (verify ON/OFF) against the real running stack, leaving it running for the operator. Binding inputs: the operator's Batch Final brief (conversation), `docs/release/FINDINGS.md`, `docs/release/patch-briefs/*`, RUN_LOG.md.

## Ground truth (Phase-0 exploration, 2026-07-10)
- All 7 batch-1 slices LANDED and PASSED on main (tags `batch1-{f2,f16-f28,f20,f1,f22,routes,f25}` all ancestors of `main@ef786f8`; linear history; no divergent branches). Batch-1 verdict was completed-with-blockers only because codex was unauthenticated (all cross-model gates DEGRADED) and the live J3 leg was credential-blocked.
- Verified FIXED+TESTED at HEAD: F1, F2, F4/F5/F6, F11 (`da0d0fa` + 11-case contract test — supersedes stash@{0}), F16/F28, F20, F21 (resolver wired `context.ts:73` ← `chat.ts:119`), F22, F25 (re-fix `af8b556`, accepted residual documented).
- Verified OPEN at HEAD: F10 (resolver never wired; store never read), F29 (planner throws → opaque 500), F7 (serving ignores build failure), F3 (login/build never logged), F26 (exact-match detok; reflowed tokens leak fakes).
- Codex CLI now authenticated (API key) — cross-model gates can run this time.
- Model credential for live journeys NOT present on this host (no env var, no `~/.config/ekoa/claude-credentials.json`) — Phase-3 dependency, operator-notified early.

## Acceptance criteria
1. `docs/release/FINDINGS.md` carries a complete status column (fixed-verified | fixed-untested | partial | open | wont-fix-minor | deferred); every inherited fix has a green test; ci:lane green on `batch-final`; tag `bf-reconciled`.
2. F10/F26/F3/F29/F7 each: red regression test first → fix → green; deterministic wall green; fresh-context review approve; tag `bf-<finding>`. F10+F26 additionally get the per-slice Codex adversarial pass.
3. J3 build journey passes TWICE (verify OFF via `j3-build.mjs` phases, verify ON via `j3b-followup.mjs`): honest completion, served app is the REAL app (zero scaffold copy), app-data plane works.
4. Touched-journey probes green: j1 (auth), j2 (grounded chat full reply), j4 (memory write→recall), j6 (anonymisation incl. deny-list masking), j8b (automation plan), registo rows assertions.
5. Stack LEFT RUNNING: seeded credential, admin login printed, served demo app URL printed.
6. Run-level: built-in security review + Codex checkpoint (now expected to actually run); FINDINGS final status committed; rc-1 untouched; NO merge to main.

## Non-goals
Full-stack e2e harness (batch-2 brief), F9, F24, F27, F30, docs-gaps, the 502-masks-401 diagnostics slice, the gateway-apikey billing-bypass observation, the `/usage` crash + StrictMode double-session dashboard findings, schema-coverage honor-system rework, `SourceInput` divergence, web `__tests__` tsc exclusion — all recorded as open/deferred in FINDINGS, not fixed here. No gold-plating.

## Assumptions ledger
| # | Decision made on the operator's behalf | Chosen | Alternative |
|---|---|---|---|
| A1 | Batch-1 remainder | Nothing to re-implement — all 7 slices verified landed+tested at HEAD; Phase 1 collapses to the stale remote `batch1-f25` tag (retry push once, else operator action) and carrying cross-model duty into this run's now-authenticated Codex gates | Re-execute batch-1 slices (rejected: verified fixed) |
| A2 | F21 | Fixed at HEAD; backfill ONE wiring test (stored memory demonstrably enters `assembleRunContext` for a chat run) in S0 | Full re-implementation per brief (unnecessary) |
| A3 | F11 / stash@{0} | Superseded by `da0d0fa` (stronger + tested). Archive-tag the stash commit (`archive/stash-f11-pre-hardening`) then drop the stash | Keep the stash (clutter) or blind-pop (would conflict) |
| A4 | F7 size | SMALL confirmed by design (additive `Job.error` schema field + one serve-path gate + one response helper; no migration) → in scope | wont-fix-minor (trigger not met) |
| A5 | F10 persistence | Dedicated encrypted `anonymisationDenyLists` collection per spec ch04 §4.3 (spec-wins) + org-admin CRUD under `/api/v1/org/deny-list`; resolver returns re-wrapped ciphertext so `anonymise/` internals stay untouched; ~30s TTL cache invalidated on write | Brief's org-settings sketch (contradicts spec ch04) |
| A6 | F29 wire shape | 200 + `plan.status='plan_failed'` + `reason` (consistent with `awaiting_integration`; `PlanResponse` can carry it) | 422 error envelope (cannot carry plan payload) |
| A7 | Phase-3 credential | Operator notified EARLY (Slack) with the exact provisioning command; slices S0–S5 proceed regardless; if still absent at Phase 3, graceful PAUSED with next-action | Use the local Claude Code keychain token (rejected: known session-invalidation flake + classifier-denied exploration) |
| A8 | S4 (F29) kind | `api` despite one tiny web-store error branch — no visual surface changes; design audit not meaningful | `mixed` (would force a UI design audit on an error string) |
| A9 | codexSliceReview scope | S1 (F10) + S2 (F26) — egress boundary per the brief; S3's one-line `login()` touch is covered by the fresh-context review + the run-level checkpoint's auth scope | Also per-slice codex on S3 (marginal value, serial-codex cost) |
| A10 | Registo `targetIds` wire bug | Fix in-slice (S3): `registoEntry` emits an object where the schema demands `z.array(Id)` — the new contract test cannot pass over it | Defer (would force the test to codify a schema violation) |
