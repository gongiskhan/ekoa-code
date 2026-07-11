# ekoa-code docs

The map of the docs set. These docs are the authoritative as-built record for agents and humans; the
build-run spec and gate journal are retired (archive note below). Start with `architecture.md`.

## The docs

| Doc | What it is |
|---|---|
| `architecture.md` | THE architecture doc: product, repo layout, module map + tier/direction rules, import boundaries (FIXED-1), the LLM egress chokepoint (FIXED-3/8/13), injected seams, and the agent/knowledge/apps/automations/integrations/billing subsystems. |
| `api-contract.md` | The `shared/` contract conventions: error envelope, auth tiers, the four SSE streams, the served-app byte-compat plane, and the schema-coverage / mount-coverage / protocol-parity gates (with the honor-system caveat). |
| `security.md` | The numbered security invariants + enforcement homes, the anonymisation pipeline, access-control model, served-app admission planes, frame-header state, and incident-response + secure-development posture. |
| `testing.md` | The five-layer QA process, the test estate map, the suite-ledger and contract gates, how to run everything (`ci:lane`, `e2e`, `e2e:server`, `gate:*`), e2e discipline, and the live-verification playbook. |
| `operations-runbook.md` | Run (the run driver), test lanes, deploy dry-run, secrets/env, model-credential re-provisioning, the knowledge importer, backup, and known-flake pointers. |
| `governance.md` | Where decisions and findings live, the standing invariants, review policy, reference-access rule, and the spec/RUN_LOG archive note. |
| `findings.md` | THE live findings ledger: open, recently fixed, accepted/by-design. |
| `decisions.md` | The append-only decision journal (dated entries not derivable from code or git). |
| `known-flakes.md` | Observed test flakes and their environmental causes; linked from the runbook. |
| `diagrams/` | The 12 Excalidraw sources (`01`..`12`). First-class (FIXED-12): a structural change without its diagram update is incomplete, and review must reject it. |

## Security policy skeleton

`security/` holds the ISMS-seed policy pages (`access-control.md`, `incident-response.md`,
`secure-development.md`), distilled into `security.md`; they grow into the ISMS at certification phase.

## Archive

The build-run design record - `spec/` (19 chapters + `SPEC.md`) and `RUN_LOG.md` (the append-only
gate journal) - was **retired 2026-07 by operator decision** in favour of this docs set. History is
preserved in git and under the tag `archive/pre-docs-cleanup-2026-07`. It is no longer normative;
consult it only for build-run provenance these docs do not carry (see `governance.md`).
