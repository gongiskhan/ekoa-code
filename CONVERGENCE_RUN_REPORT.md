# Execution Plane, Bridge, and Integrations Convergence - Run Report

**Dates:** 2026-08-18 to 2026-08-24 · **Repo:** ekoa-code · **Final main:** `b7778aa`, pushed
**Estate at close:** 7,217+ tests green across five workspaces; every gate green (chokepoint, garrison, secrets, openapi, client-drift, encryption-key, audit, sast); exactly ONE branch (`main`).

## Outcome

Everything the brief asked for that can be built and proven without operator credentials is built, adversarially reviewed, live-verified where a browser can reach it, merged to main, and pushed. P0-P4 landed first (bridge move-in and de-rot, interactive browser executor with the I9 secret lifecycle, discovery/capture/replay, `needs_credentials` with auto-resume, locality + preferential bridge). Convergence S1-S9 followed, each slice through the full gate lane plus an adversarial cross-model review round with every confirmed finding closed by a mutation-proven test. The S10 evidence run then drove the converged product live and proved the ladder, the self-extension loop end to end (real model, real UI consent), the D5 publish exclusion on the wire, and the S7 migration report - and found three new findings, all ledgered. The one remaining stage is the four-run acceptance matrix, which needs the operator's credentials (below).

## Merge record - every branch and ref

| Ref | Disposition |
|---|---|
| `feat/schedules` | Merged first (own adversarial round: 15 confirmed, all closed) |
| `feature/os-mode-run-1`, `fix/chokepoint-blindspot-and-secrets-gate`, `staging-env-gcp`, `verify/integrations-single-surface`, `origin/mega-run` | Deleted - strict ancestors of main |
| `wip/uploads-attachments` | Abandoned + deleted per operator decision; tip `daed969` recorded for reflog recovery |
| `origin/feat/ad-broker-endpoint` | Deleted per operator decision; tip `4fb19d8` recorded |
| Chat-strip WIP (5 files) | Committed as its own change |
| `stash@{0}` (generated junk), `stash@{1}` (drill churn, operator decision), `stash@{2}` (superseded, closed in findings) | Dropped |
| `feat/s6-publish-doors` | Merged (`3ab397f`): 9 commits, 5 review rounds; backup ref `backup/s6-pre-secret-scrub` verified fixture-only and deleted (tip `7e2ae202...` recorded) |
| `feat/s4-s5-reuse-ladder` | Merged (`ff2a109`): 9 commits, 9 review rounds |
| `feat/s2-s3-detail-surface` | Merged (`3def970`): 1 commit after a 21-finding round (2 blockers: the evidence read did not compile and was written against S1's retired store key); live e2e 2/2 |
| `feat/s3-step-feedback` | Merged (`7a9e016`): per-user notes; 3-major round closed; live e2e 4/4 incl. the orphaned-note leg |
| `feat/s7-s8-migration-hide` | Merged (`bcdafdc`): 3 commits; 30-finding round (1 blocker: route tenancy pinned at the wrong unit) + a third commit fixing a REAL pre-existing S2 defect its own spec caught (the capability wire carried the package author's placeholder automation id, so every automation-backed steps view 404'd); live e2e 20/20 + 1 documented skip |
| `feat/s9-citius-ongoing` | Merged (`d6f4357`): tenant-read `processos` action + reference schedule; 20-finding round (major: bare-noun names let destructive goals match READ actions and answer "executed" - PRE-EXISTING across five shipped packages because `get` is a stopword; fixed estate-wide with the `read_only_match` refusal on the reuse rung) |

Also landed on main directly: the secrets-gate rewrite (`b8dffa4` - path allowlists removed, values enumerated, differential mutation test), the nanoid audit fix (`b651cb3`), the f5 crawl-flake determinism fix (`a99c0da`), and the estate-verification process finding (`3402771`).

## Verification discipline - what the run itself got wrong and fixed

Three self-findings are in `docs/findings.md` because the verification process, not just the product, had defects: (1) the estate was once run concurrently with its own build and judged through a tail pipe whose exit code was tail's - S6 merged on that evidence shape and was re-proven after; (2) a builder's pattern `pkill` killed another agent's estate run cross-worktree - the memory and ledger now carry the "a process pattern is not a scope" rule; (3) stdout interleaving between concurrent sessions made one mutation run vacuous - all mutation proofs now assert fragment counts and md5s in self-contained processes.

## S10 evidence run (operator-free legs) - `evidence/s10/`

- **A - compose demo: partially proven.** The deterministic matcher, the full ladder on the wire, the never-synced watermark, and the `read_only_match` destructive-goal refusal are all captured. `outcome: "composed"` itself never fired - it needs real Citius rows (acceptance run 2).
- **B - self-extension: proven end to end.** Gateway key mints a provisional action; trust refused twice for the right reasons (shape drift; no validated run - S1's graduation teeth holding at runtime); the real UI consent dialog approves the exact write; re-run answers `executed` with zero authoring. Two UI gaps filed (no `trust` UI; wrong-tab authorize link).
- **C - UI surfaces: proven.** Ten screenshots: list, detail, COBERTURA sentence, read-only steps with per-step notes, notes written and erased, the reference schedule created through the real form.
- **D - promotion dry-run: proven on the wire.** The snapshot walked key by key: no evidence, no feedback, no authorship, no goal - structurally unreachable, not filtered. Found a real defect: the floor redacts `authoring.shape` (md5 trips `LONG_HEX_RE`), silently demoting trusted actions cross-org. Fails closed; ledgered with a position-based fix path.
- **E - migration report: proven for `wrap`.** All four Citius sequences classify wrap with reasons, engine-internal features, and the pause-collapse degradation carried on the artifact. `flatten: 0` is absence of input, not proof.

## Open findings and deferrals (all ledgered with reasons)

- `publish-floor-redacts-the-authoring-shape...` (MINOR, fails closed) - fix by position-exemption, not by widening `LONG_HEX_RE`.
- `the-self-extension-loop-has-no-ui-for-its-promotion-step` (MINOR) - `trustAction` has zero web callers.
- The detail page's authorize link lands on the platform tab (MINOR).
- `undeclared-origins-are-bridge-only-so-a-daemonless-dev-halts-browser-steps` (pre-existing, OPEN) - blocks half of `automation-deterministic` (split, documented skip).
- S7's Rule 10 migration write half: review date 2026-11-14 (per the S7 decision journal entry; an earlier revision of this line carried S9's date by mistake); the classification pass ships report-only by design.
- 17 unreachable automation-authoring components: deliberately kept until S7's review date (ledgered).
- The S9 coverage gap ("processes with notifications", not "processes"): measured only by the acceptance run; second source decision at the D-S9-1 review date.
- 232 pre-existing lint warnings (unchanged all run): a dedicated sweep, not slice work.

## The acceptance matrix - what the operator must do

Each run needs one credential ceremony; everything after it is autonomous. The stack must be up (`npm run dev` from main) with a paired bridge for runs 1-3 (run `ekoa-bridge pair` on the machine that will hold the sessions).

1. **Uber Eats (adversarial browser on the bridge, read-only).** Start the run; it pauses `needs_credentials` with mode `ceremony`. Open the headed bridge window it names, log in (OTP/CAPTCHA by hand). The run auto-resumes: vision discovery, network capture, CDP replay, a deterministic second run, and a forced-drift self-heal, all captured to evidence.
2. **Citius (permissive browser + typist).** Put the Citius credential into the Cofre portal when prompted. The typist establishes the session; the sync lands notifications; the `processos` action fills; the under-40 compose demo produces its real `composed` answer; the reference schedule fires. This also measures the S9 coverage gap and proves the inbox HTML parses - the two things no fixture could.
3. **Google Workspace (CLI on bridge + OAuth).** Complete the OAuth consent when the run pauses. The CLI action runs on the bridge with the secret delivered under I9 (one-time, RAM-only, zeroized, redacted outbound).
4. **Zoho (pure API, cloud egress).** Arm the refresh token once (`zoho-sign` connect in the UI); the run then proves unattended OAuth refresh with no human and no bridge.

Say which run to stage first and I will set it up and tell you exactly when and where each ceremony is needed.
