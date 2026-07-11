# Governance

The lightweight successor to the build-run governance: where decisions and findings live, the
standing invariants that outlive the retired spec, the review policy, and the reference-access rule.

## Journals

- **Decisions** - `docs/decisions.md`. Append-only, dated entries. Log a decision here when a choice
  is not derivable from the code or git history: a deviation from prior intent, an accepted tradeoff,
  a scope call, an incident write-up. Convert relative dates to absolute.
- **Findings** - `docs/findings.md`. The live findings ledger: OPEN findings first, then recently
  fixed, then accepted/by-design. A finding closes only by a landed fix + a committed test, or a
  written dismissal - never silently.

## Standing invariants (survive the retired spec)

These are binding regardless of the archived spec. Each is enforced or reviewed as noted; details in
the linked doc.

- **Import boundaries (FIXED-1)** - `web`/`api`/`shared` may not cross; lint-enforced, CI-fatal
  (`docs/architecture.md`).
- **Egress chokepoint (FIXED-3/8/13)** - Anthropic access only inside `api/src/llm/`; ESLint ban +
  grep gate + subprocess base-URL invariant (`docs/architecture.md`, `docs/security.md`).
- **Diagram invariant (FIXED-12)** - the 12 Excalidraw sources under `docs/diagrams/` are first-class:
  a structural change without its diagram update in the same unit of work is incomplete, and review
  must reject it.
- **QA five layers (ch13 §13.10)** - baseline / discovery / regression / review / periodic audit are
  binding; every change lands inside them (`docs/testing.md`).
- **Suite-ledger census** - the ported specs + drivers on disk must match the ledger counts exactly; a
  new spec is registered in the same change (`docs/testing.md`).
- **Determinism ratchet** - every accepted review or incident finding ships a deterministic guard
  (test, lint rule, Semgrep pattern, grep gate) in the same fix.

## Review policy

Every PR gets a model code review. A PR that touches `shared/`, auth, billing, the LLM module, or the
collections engine - or exceeds 300 changed non-test lines - additionally gets an adversarial
cross-model review and merges only on its approval. PRs touching security-critical surfaces
(authz/tenant, the shared contract, the anonymisation/egress pipeline, auth middleware/session
handling) are the intended scope of the cross-model security checkpoint.

## Reference access

`../ekoa-dev` and `../ekoa-deploy` are **READ-ONLY references** - the old codebase and deploy assets.
Read them to understand carried behavior or wire formats; never copy a secret value out of them into
this repo or its env files. Secrets come from the managed store (GCP Secret Manager in prod, a
bootstrap-generated key in dev).

## Archive

The build-run design record - `spec/` (19 chapters + `SPEC.md`), the `spec/diagrams/` sources (now
living at `docs/diagrams/`), and `RUN_LOG.md` (the append-only gate journal) - was **retired 2026-07
by operator decision** in favour of this docs set. History is preserved in git and under the tag
`archive/pre-docs-cleanup-2026-07`. Consult it only for build-run provenance an as-built doc does not
carry (a gate's evidence, a superseded amendment, the per-callsite Anthropic inventory); it is no
longer normative - these docs are.

Source comments citing `spec/<chapter> §…` or RUN_LOG entries are historical provenance of the
build run — they resolve inside the archive tag, not in the working tree. Leave them intact when
editing surrounding code; the docs above are the living rule.
