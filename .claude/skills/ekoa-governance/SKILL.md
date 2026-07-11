---
name: ekoa-governance
description: Governance for ekoa-code — decision journal, findings ledger, review policy, reference-access rules for ../ekoa-dev and ../ekoa-deploy, archive pointers. Load BEFORE logging a decision, changing standing rules, or touching ../ekoa-dev / ../ekoa-deploy. Do NOT use for code structure (ekoa-architecture) or test mechanics (ekoa-testing).
---

# ekoa-governance

Normative source: `docs/governance.md`. The rc-1 build-run machinery (gate template, RUN_LOG,
abort semantics) is RETIRED — history is preserved at git tag `archive/pre-docs-cleanup-2026-07`.

## Journals (both append-only, dated entries)
- **Decisions** → `docs/decisions.md`: any choice a future reader would be surprised by —
  standing-rule changes, spec-of-record amendments, accepted risks, deferred work with reasons.
- **Findings** → `docs/findings.md`: the LIVE defect/risk ledger (OPEN / RECENTLY FIXED /
  ACCEPTED). A discovery run or review finding is closed by a deterministic test or a written
  dismissal here — never silently.

## Standing invariants (survive any cleanup; enforced by lint/CI/tests)
1. Import boundaries + egress chokepoint + module tiers (see ekoa-architecture).
2. Diagram invariant (FIXED-12): structural change ⇒ `docs/diagrams/*.excalidraw` updated in the same unit of work.
3. The five-layer QA process is binding (see ekoa-testing); suite-ledger census is strict.
4. Review policy: every PR gets a model code review. PRs touching `shared/`, auth, billing, `llm/`, the collections engine — or exceeding 300 changed non-test lines — additionally get an adversarial cross-model review and merge only on its approval.

## Reference access
`../ekoa-dev` (old Cortex) and `../ekoa-deploy` are READ-ONLY references. Deploy-config SHAPE
only — NEVER copy secret values. Old-cortex content (prompts, skills, tests) may be ported only
with runtime-truth validation against THIS repo's code (old claims about APIs/tools must be
verified before they ship in content).

## Archive
`spec/` (19 chapters + reference audits), `RUN_LOG.md`, `PLAN.md`, and the run evidence were
retired 2026-07 by operator decision. Everything is recoverable from git history at tag
`archive/pre-docs-cleanup-2026-07`. Do not resurrect them as living docs; distill anything
still needed into `docs/`.
