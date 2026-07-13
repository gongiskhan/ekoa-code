# LANDING — Ekoa Apps Get an Operator (run 20260712-150958-4bb23640)

> **STALE — superseded 2026-07-13.** This packet describes the FIRST abort (16 slices, resume point D2).
> The run has since resumed and landed D2, D3, E1, E2, F1, G1 (22/31 gated; F2 in flight), and the
> operator MERGED everything to main (ff `d55bd02..1a3e9ad`) with the run continuing ON MAIN.
> Current state: `RUN_LOG.md` (repo root) + `evidence-index.json`. A fresh LANDING packet is written
> at the run's actual end. The "NEEDS HUMAN EYES" and assumptions-ledger sections below remain valid.

**Terminal state: ABORTED on operator request ("stop the run").** Not a failure — a clean operator stop with the operate spine complete. Nothing merged to main; everything sits on branch `operator-run` awaiting your diff review.

## What landed (16 fully-gated slices + 1 enabling change)

Every slice below passed the full per-slice pipeline: committed re-runnable test / live verification, deterministic security wall (gitleaks/semgrep/audit), a fresh-context Anthropic review AND a cross-model Codex adversarial pass, with asciinema/e2e evidence. Tags `operator/<slice>`.

| Slice | What | Commit |
|---|---|---|
| S0 | run setup: `can()` permissive-stub seam + shared capability vocabulary | f9dee3c |
| A1–A5 | exploration analyses (automations/actions, demos/tutorials, knowledge hooks, templates archaeology + measured token tax) + 3 decision memos | 97f66d6 |
| B1 | base registry + loader + build-flow selection (reconnects the dropped internal-bases system) | e879e06 / d1247b4 |
| B2 | the `app` base (shell + assistant mount + wiring over the injected runtime + protocol client) | 576e641 / a034ca1 / 9e92757 |
| B3 | base-manifest `mustEdit` signal in the honest-completion gate (closes F16/F28 for base builds) | 3f06499 |
| B4 | instruction migration: type-specific structure moved into bases; measured ~671-token/build always-on shrink | dcdd488 / 280e2c7 |
| C1 | artifact-type classifier in scoping (only apps get the operator) | a179a75 / 0137e54 |
| C2 | action-registry contract: shared `AppActionManifest` + ui_actions capture at activation | b8ba9a9 / 72e229f |
| C3 | in-page action runtime (state-layer dispatch, highlight, destructive confirm, pause-on-input) + shell nav hook | 14f45e5 / aec0181 |
| C4 | assistant tool definitions from the manifest + audit through the single `logActivity` path | 88e027d |
| C5 | registry round-trip e2e gate (issue → visible execute → destructive confirm → cancel) + tester-harness helper | 5acd1ab / 2d9cd42 |
| D1 | served-app assistant endpoint POST /api/app-assistant through the chokepoint (owner-org grounding + citations + mode inference + proposed actions), billed to the artifact owner | f363557 |
| D2-prep | same-document `window.__ekoaActions` API on the runtime (enables the same-document panel) | 4541861 |

**The operate spine is complete**: internal bases → classifier → action registry → in-page runtime → assistant tool-defs + audit → verified round-trip → assistant endpoint. Per the brief's meter strategy, 1–4 (the must-land spine) is fully landed.

## What did NOT land (resume here)

- **D2** (assistant panel UI in the app base) — the worker was authoring, produced no committed output. **Resume point.** The enabling `window.__ekoaActions` API (D2-prep) is committed and tested, so D2 is unblocked.
- **D3** (scripted 3-mode gate), **E1–E2** (build-time tours + panel playback), **F1–F2** (knowledge-during-build + fees sample), **G1–G2** (metering + perf) — not started.
- **H1–H6** (the SECURITY BLOCK: roles/capability layer, identity/session, edit mode, request-changes, assertions, Codex block review) — **untouched by design** (model-tier sequencing rule). The `can(capability)` seam remains a clearly-marked `PERMISSIVE-STUB` (`api/src/auth/capabilities.ts`); no permission logic exists anywhere in the landed slices. H must land together-or-not-at-all; leaving it unstarted is the correct partial state (a permission-stubbed platform, not a half-secured one).

## Assumptions ledger (decisions made on your behalf)

See `RUN_SPEC.md` for the full 12-entry ledger. Load-bearing ones: registry built fresh on the client plane + unified at the manifest level (automations engine untouched, migration documented); tour format = reuse the surviving Tutorial Bridge (not started); `app`+`document` bases wired first; assistant billed to the artifact owner via `assistant-chat` attribution; store is Mongo (brief's "Firestore" is stale).

## NEEDS HUMAN EYES

1. **Decision memos** (`memos/{registry,tour-format,base-set}.md`) — the extend-vs-rebuild / reuse-vs-new / base-set calls, each with cited evidence. Confirm or redirect.
2. **PLATFORM SECURITY finding (flagged, not fixed)** — `bootState` loads the activation cache without `billingLocked` (`server.ts` ~660), so after a restart a billing-locked owner reads as unlocked from the cache until the billing tracker next writes them; this affects the WHOLE served-app plane via `admitOwner`, is pre-existing (not introduced by this run), and D1 is independently guarded by its live allowance check. Belongs in the H security block's adversarial pass. **A Fable feature run deliberately did not alter platform auth/activation boot infrastructure.**
3. **B4 double-review catch** — both the fresh-context AND codex reviews independently caught a real lossy-delete (the password-SSO flow + `load_context` were removed from the always-on instructions before being added to the bases); fixed in 280e2c7. The green live build could NOT have caught it (no probe exercised a password-login/integration app). This is the run's clearest evidence the dual-review gate earns its cost.
4. **C5 → D2 gap (resolved)** — the runtime was postMessage-to-parent only; the same-document panel needed a direct API. Added in D2-prep (4541861). D2 consumes it.
5. **Suite ledger** — the C5 `action-registry` e2e is a feature-run artifact not registered in the build-run `SUITE_LEDGER.json` (its census is already in documented committed-baseline debt); register it when folding into main.

## Deviations / friction

- Subagent final-message delivery was broken this session; all gate agents wrote verdicts to files under the runDir (primary channel). Friction-logged.
- The dev-stack credential path: the legacy `~/.ekoa/claude-auth.json` snapshot rotates with the operator's live Claude session (fails live turns silently); the sanctioned path is the dedicated-account `boot-b.mjs`. Recorded in `docs/known-flakes.md`. boot-b's api health window was widened 60s→180s for the grown sandbox estate.
- The LLM build verifier is nondeterministic (a VERIFY_FAILED on identical fixed code during B2/C5); the round-trip gates run with verify off since they test the runtime, not the verifier.

## Merge

`operator-run` off main (d55bd02). Per-slice checkpoint commits + tags. Review the diff, then fast-forward or squash as you prefer. `git log --oneline main..operator-run` for the full set. The `can()` stub and the unstarted H block mean the permission model is NOT yet enforced — do not deploy to real users without the security block.
