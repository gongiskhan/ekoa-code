# ekoa-code docs

The map of what is documented and which layer is authoritative. Two layers:

- **Normative design record** - `spec/` (19 chapters + `SPEC.md`) and `spec/diagrams/`. The spec
  wins by rule during the build; it is marked, never deleted. Chapter-by-chapter build status is in
  the as-built annex below.
- **As-built layer** - what the rc-1 code actually does, where it diverges from the spec, and how to
  run/operate/repair it. Everything under `docs/`.

## Start here

| If you want to... | Read |
|---|---|
| Orient in 5 minutes (topology, module map, chokepoint) | `as-built-architecture.md` |
| Run, test, deploy-dry-run, or operate the stack | `operations-runbook.md` |
| Know what is built vs partial vs deferred, per spec chapter | `spec-status-annex.md` |
| See the open as-built defects and their fixes | `release/FINDINGS.md` |
| Understand a past decision | `decisions.md`, then `../RUN_LOG.md` (append-only gate journal) |

## As-built layer (this directory)

- `as-built-architecture.md` - one-page architecture overview with pointers into the still-normative
  spec chapters.
- `operations-runbook.md` - run (the run-ekoa-code driver), test lanes (ci:lane, e2e:server + its
  documented baseline debt), deploy dry-run, secrets/env posture, backup, known flakes.
- `spec-status-annex.md` - every spec chapter marked as-built-verified / with-findings /
  partially-built / historical / deferred. The live delta list is `release/FINDINGS.md`.
- `diagram-census-and-deviation-annex.md` - G13 diagram/FIXED-12 reconciliation + the RUN_LOG
  deviation count check.
- `security/` - policy skeleton: `access-control.md`, `incident-response.md`,
  `secure-development.md`.

## Release hardening (`release/`)

The 2026-07-08 rc-1 verification run (this layer fixes nothing; it verifies and curates):

- `release/FINDINGS.md` - one row per finding across the 9 product journeys, classified
  bug/harness-gap/judgment/docs-gap with severity + evidence pointer. **The authoritative delta
  between spec/code and reality.**
- `release/patch-briefs/` - one ready-to-run patch-profile brief per `bug` finding.
- `release/e2e-harness-remediation-brief.md` - spec for the later run that closes the e2e baseline
  debt (full-stack boot, REST-migrate the retired-protocol specs, fold in the journey suite).
- `release/probes/` - the zero-dependency HTTP journey probe kit (`_lib.mjs`, `j*.mjs`) + the
  credentialed `boot-b.mjs` harness. Re-runnable; destined to become the permanent journey suite.
- `release/evidence/` - captured probe output per journey (the compliance trail; keep).

## Historical (marked, not deleted - the amendment audit trail)

- `AMENDMENT-2-DIFF-SUMMARY.md`, `ekoa-code-spec-amendment-2-consolidated-ledger.md` - the Amendment
  2 record that reshaped the spec (Mongo not Supabase, no license gate, etc.).
- `autothing/` - build-run scaffolding (`friction-log.md`, `known-flakes.md`, `runs/`). Historical
  process record; the colima/mongo flake note in `known-flakes.md` is still operationally useful
  (linked from the runbook).

## Elsewhere in the repo

- `../spec/` - normative design (chapters 01-18 + SPEC.md); `../spec/diagrams/` first-class
  (FIXED-12: a structural change without its diagram update is incomplete).
- `../RUN_LOG.md` - append-only build journal: every gate G-P..G13, every DEVIATION, the terminal
  completed-with-blockers verdict. Compliance material; never edited retroactively.
- `../CLAUDE.md` - agent guidance + the verbatim ch02 §2.9 (lint/CI enforcement) and ch13 §13.10 (QA
  process + diagram invariant) blocks.
- `../.claude/skills/` - area skills: ekoa-architecture, ekoa-testing, ekoa-governance,
  run-ekoa-code.
