---
name: ekoa-governance
description: Run mechanics for the ekoa-code build — gate template, checkpoint commits, RUN_LOG.md discipline, abort semantics, reference-access rules, decision precedence. Load BEFORE passing any gate, logging any decision, or touching ../ekoa-dev / ../ekoa-deploy. Do NOT use for code structure (ekoa-architecture) or test mechanics (ekoa-testing).
---

# ekoa-governance

Normative source: `spec/14-build-sequence.md` §14.1-14.3.

## Decision precedence (14.1)
1. FIXED decisions — never negotiable; impossible-as-specified → ABORT procedure (14.2.4), never improvise.
2. Chapter text — deviations only where reality contradicts the spec, ALWAYS logged as DEVIATION.
3. `spec/reference/` docs — ground truth for carried behavior.
4. Conventional practice — fills unspecified detail; log DECISION only when a future reader would be surprised.
Material ambiguities: resolve via precedence, log AMBIGUITY. Never silent.

## The gate template (14.2.1 — ALL six, in order)
1. Phase green condition met (command exit 0 / artifact check).
2. Full per-PR CI lane exit 0.
3. BOTH reviews on the cumulative phase diff — Claude review then adversarial Codex review — verdicts in RUN_LOG; red adversarial verdict blocks.
4. Suite ledger updated; ratchet holds.
5. Affected diagrams updated in-phase (FIXED-12) or "no structural change" noted in the GATE entry.
6. Checkpoint commit `checkpoint: G<N> <phase-name>` + git tag `gate-<N>` — itself green under item 2.

## RUN_LOG.md (append-only, repo root)
Entries timestamped ISO-8601 UTC + current phase: GATE (evidence, review verdicts, ledger delta, diagram note, tag) · DECISION (options, choice, reason) · AMBIGUITY (passages, reading, precedence rule) · DEVIATION (spec section, why, what instead) · ABORT (14.2.4). An undocumented deviation found later is a spec violation of the run.

## Reference access (14.1 — exhaustive; everything else is answered from spec/)
`../ekoa-dev` and `../ekoa-deploy` are READ-ONLY. Sanctioned: (a) `ekoa-dev/ekoa/` wholesale for the ch12 web migration; (b) old Cortex only through files named port-as-is/adapt by `spec/reference/carryover-audit.md`; (c) the test estate per `spec/reference/test-audit.md`; (d) `ekoa-deploy` deploy-config SHAPE only — NEVER copy secret values; (e) design docs cited by ch17/18. Carryover verdicts are normative; disagreement on contact with reality = logged DEVIATION.

## Abort (14.2.4)
FIXED impossible as specified → halt, branch `abort/G<N>`, ABORT entry (FIXED-n, evidence, attempts, ≥2 candidate resolutions), final report. No gate after it is attempted.
