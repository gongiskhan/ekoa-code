# LANDING (FINAL) — Ekoa Apps Get an Operator (run 20260712-150958-4bb23640)

**Terminal state: COMPLETE. All 31 slices gated. Merged to and living ON `main`.**
(The earlier `LANDING.md` describes the FIRST abort at 16 slices; it is superseded by this packet.)

Per your instruction ("merge to main and then resume the work. Dont create branches!"), the run
was fast-forward-merged to `main` (`d55bd02..1a3e9ad`) and every subsequent slice landed directly on
`main`. No branches. `operator-run` is deleted; the per-slice `operator/<slice>` tags anchor each one.

## What the product now is
Every Ekoa-generated **app** ships with a per-app operator assistant that (1) drives the app's UI
in-page (the C3 action runtime), (2) teaches via zero-token declarative tours, (3) answers the app's
domain from org-scoped indexed knowledge with citations - and, for admins, (4) **changes the app**:
an edit request becomes a scoped patch-run (a follow-up build) with preview / approve / one-click
rollback. Users who can't build get a **request-changes** queue to the org-admins. The builder
persona is gone: **super-admin** / **org-admin** / **user**, enforced by a real capability layer.

## The 31 slices (all fully gated: committed re-runnable test + deterministic wall + fresh-context
review + cross-model Codex review + live/asciinema evidence; tag `operator/<slice>`)
- **S0** capability seam. **A1-A5** exploration analyses + 3 decision memos. **B1-B4** internal bases
  (registry/loader, the `app` base, mustEdit gate, instruction migration ~671-tok/build shrink).
- **C1-C5** artifact-type classifier, action-registry contract, in-page action runtime, assistant
  tool-defs + audit, registry round-trip gate. **D1-D3** served-app assistant endpoint (owner-billed,
  cited grounding), the panel, the 3-mode gate.
- **E1-E2** build-time tours + zero-token playback. **F1-F2** knowledge-during-build + the fees
  live proof. **G1-G2** metering/billing-truth + the panel-as-platform-served-lazy-asset.
- **H1-H6 SECURITY BLOCK (atomic, landed together, block-level codex-reviewed):**
  - **H1** real role->capability matrix replacing the permissive stub; `builder`->`user` migration
    (durable-revocation boot step + legacy-JWT shim); capability gates on EVERY app build/edit vector;
    **closed a live cross-tenant IDOR** (any user could drive a code-writing agent in any app's
    sandbox); made `tokenEpoch`+`billingLocked` durable (also closed the carried billingLocked-at-boot
    finding); follow-up TOCTOU re-validation.
  - **H2** `whoami` admin detection that mirrors the H1 edit gate exactly - fail-closed, oracle-free.
  - **H3** admin edit mode (detect-then-ask opt-in; patch-run preview/approve/guarded-rollback).
  - **H4** request-changes queue with cross-org isolation both directions.
  - **H5** assertion layer: capability matrix + grep gates (no permissive stub / no orphan role) +
    cross-org assistant-retrieval isolation + destructive-action authz + **two live journeys (edit +
    request-changes) that PASS end-to-end** (real admin patch run + rollback; live cross-org block).
  - **H6** the run-level codex adversarial review over the whole block - APPROVE.

## NEEDS HUMAN EYES (in priority order)
1. **`served-app-data-unauthenticated-writes` (HIGH, pre-existing, operator DECISION owed).** The
   served-app data plane `/api/app-data/:collection` authenticates NO caller - anyone who knows an
   app id can `POST`/`PUT`/`DELETE` that app's data cross-tenant. The declared collection write-mode
   (`session`/`server`) is unenforced, and the app-sso cookie isn't even sent to that path. This is a
   DIFFERENT axis from the platform role/capability layer H1-H4 close (which IS complete). H5's
   assertion layer SURFACED it (the H5 worker had documented it away as safe; codex + the lead
   re-disposed it honestly). It is tripwired (`destructive-action-authz.test.ts`) and ledgered
   (`docs/findings.md`). FIX = a served-app-data-plane architecture change (enforce the write mode +
   make an app-sso session verifiable at the data path) spanning the ~200-app estate - your call, a
   dedicated post-H slice.
2. **Decision memos** (`memos/{registry,tour-format,base-set,token-shrink}.md`) - the extend-vs-rebuild
   / reuse-vs-new / base-set calls, each with cited evidence. Confirm or redirect.
3. **The org-scoped app-edit policy** (documented, H2): an org-admin edits own + org-shared apps; a
   super-admin does NOT cross-org edit. If you want platform-wide super-admin app editing, it's a
   deliberate H1+H2+served-data change - flagged, not assumed.
4. **`collection-rule-access-unenforced`** (medium) + the other open `docs/findings.md` entries.

## The Codex two-model gate earned its cost
Codex returned NEEDS-WORK on EVERY security slice - each a REAL defect the single fresh review
missed: H1 (2 High: non-durable revocation, ungated app-edit vectors), H2 (a fail-closed hole + an
oracle), H3 (2 Med: SSE-close false "no change", stale-sha rollback wiping concurrent changes), H4
(High: cross-org queue injection), H5 (High: a documented-away real gap), H6 (2 emergent cross-slice:
billing-locked false-offer, dead convert path). All fixed + re-verified.

## Verification posture
Full api lane **1630 passed / 1 pre-existing skip**; web 168; shared 36. tsc (api src+test, web) +
eslint + chokepoint grep + gitleaks clean throughout. The `can()` stub is gone - H5 grep-gates that
no permissive marker or orphan `builder` role survives. `docs/security.md`, `docs/findings.md`, and
the diagrams (03/04/07/10/12) are current.

## Merge
Everything is on `main` and pushed. `git log --oneline d55bd02..HEAD` for the full set;
`git tag -l 'operator/*'` for the per-slice anchors. **Do not deploy to real users until the
served-app-data-plane decision (#1) is made** - the platform permission layer is complete, but the
served-app data plane's caller-auth is the open architecture question.
