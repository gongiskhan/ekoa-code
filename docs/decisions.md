# Decisions (autothing-run bookkeeping)

The canonical decision journal for the implementation run is `RUN_LOG.md` at the repo root (append-only, chapter 14 §14.2.3 discipline: GATE / DECISION / AMBIGUITY / DEVIATION / ABORT entries). This file holds only autothing-run bookkeeping — foundation deferrals and run blockers — so the audit surface is not split.

- 2026-07-06 — Foundation: root `CLAUDE.md` is deliberately NOT scaffolded by the foundation step. It is a spec deliverable of build phase 0 (gate G0) and must contain the verbatim blocks of spec/02-module-map.md §2.9 and spec/13-test-review-strategy.md §13.10 (FIXED-12, chapter 13 §13.10). Generic scaffolding would be clobbered; the phase-0 slice authors it.
- 2026-07-06 — Foundation: /docs roles are covered by the spec itself (product-overview ← spec/01-system-overview.md; architecture ← spec/02-module-map.md + spec/diagrams/; conventions ← SPEC.md CONV register + chapter 13 §13.10 block; decisions ← RUN_LOG.md). Pointers land in the phase-0 CLAUDE.md reference list; no duplicate docs created (non-clobber rule).
- 2026-07-06 — Foundation: `/run`/`/verify` dev commands unknown until the phase-0 scaffold exists (greenfield). The phase-0 slice records the dev command + ports in the area skills when it creates them.
- 2026-07-06 — Tooling: gitleaks + semgrep installed via brew for the G0 CI security gates (security addendum D.4). codex CLI present for the per-gate adversarial reviews (chapter 13 §13.7).
