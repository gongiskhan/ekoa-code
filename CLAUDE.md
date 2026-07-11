# ekoa-code — agent guidance

The rebuilt Ekoa/Cortex platform: one conventional Node.js + TypeScript service. `api/` and `web/` are sibling apps; `shared/` holds only the API contract (zod schemas + inferred types + endpoint descriptor maps). Code + `docs/` are truth. Diagrams in `docs/diagrams/` are first-class (FIXED-12). The retired build spec and run log live only in git history (tag `archive/pre-docs-cleanup-2026-07`).

Routing index (area skills under `.claude/skills/`):
- **ekoa-architecture** — module map, import boundaries, the LLM egress chokepoint, injected seams. Load before writing or moving any file.
- **ekoa-testing** — the five-layer test strategy, CI per-PR lane, contract-test mechanism, suite ledger, security suite classes, live-verification playbook. Load before writing tests or claiming a change verified.
- **ekoa-governance** — decision journal, findings ledger, review policy, reference-access rules. Load before logging a decision or touching ../ekoa-dev / ../ekoa-deploy.
- **run-ekoa-code** — boot the full stack locally (handles the CSP/CORS dev traps + credential provisioning).

Canonical docs (`docs/`): architecture → `architecture.md` + `diagrams/`; contract conventions → `api-contract.md`; security → `security.md`; testing → `testing.md`; governance → `governance.md`; operations → `operations-runbook.md`; decisions → `decisions.md` (append-only); live defect ledger → `findings.md`.

## Import boundaries (FIXED-1) — lint-enforced

- `web/` may import `shared/` only, never `api/`.
- `api/` may import `shared/` only, never `web/`.
- `shared/` imports nothing outside itself (zod only).

## Egress chokepoint (FIXED-3, FIXED-8, FIXED-13) — lint + grep enforced

No file outside `api/src/llm/` may import `@anthropic-ai/*` (including `@anthropic-ai/claude-agent-sdk`) or reference `api.anthropic.com`. `api/src/llm/` is the single egress module with three concerns — attribution + metering, the anonymisation pipeline, and provider routing config. Agent SDK subprocess spawns are pointed at the chokepoint via `ANTHROPIC_BASE_URL`; no spawn may carry a provider base URL other than the chokepoint's.

## Lint and CI enforcement

1. **Repo boundaries (FIXED-1).** ESLint `import/no-restricted-paths` with three zones: `web/**` may not import from `api/**`; `api/**` may not import from `web/**`; `shared/**` may not import from either. CI fails on violation.
2. **Egress chokepoint - one module, three concerns (FIXED-3, FIXED-8, FIXED-13).** ESLint `no-restricted-imports` banning `@anthropic-ai/*` (including `@anthropic-ai/claude-agent-sdk`) everywhere in `api/src/**`, with a single override lifting the ban for `api/src/llm/**`. Belt-and-braces CI step: a grep gate failing the build if `api.anthropic.com` or `@anthropic-ai/` appears in any file outside `api/src/llm/` (catches raw `fetch` calls that the import rule cannot see). Because `llm/` is the sole importer/instantiator of the Anthropic client, attribution + metering, the anonymisation pipeline, and provider routing config all sit on the one egress route with no bypass. Subprocess paths (Agent SDK spawns) are invisible to import lint, so they are pointed at the chokepoint via base URL/env at spawn time: no spawn may carry a provider base URL other than the chokepoint's.
3. **Module direction.** ESLint `import/no-restricted-paths` zones encoding the tier table (`docs/architecture.md`) - at minimum: nothing imports `routes/` or `server.ts`; `routes/` does not import `data/`; only `server.ts` imports across the injected seams; nothing outside `api/src/llm/` imports `llm/` internals other than its public entry.
4. **Diagram invariant (FIXED-12).** Not lintable; a standing rule: a structural change without its diagram update is incomplete, and review must reject it.

## QA process (non-negotiable)

Testing runs in five layers. Every change lands inside them; skipping a layer makes the change incomplete.

1. **Baseline.** The ported e2e suite is the safety net. It stays green on every PR. A red baseline spec is fixed before any new work merges.
2. **Discovery.** Vision-based exploratory passes (an agent drives the real UI; a model analyzes the screenshots) surface probable issues and edge cases. Discovery runs are never CI gates and never regression. Every finding is closed by a deterministic test or a written dismissal in `docs/findings.md` - never silently.
3. **Regression.** Findings become deterministic tests: Playwright e2e for user-visible behavior, contract tests validating every response against the `shared/` zod schemas, unit tests where logic warrants. Every non-2xx body must validate against the shared error envelope. New endpoint means new contract test in the same PR. Test stubs for API responses must be validated against the `shared/` schemas.
4. **Review.** Every PR gets a model code review. PRs touching `shared/`, auth, billing, the LLM module, or the collections engine - or exceeding 300 changed non-test lines - additionally get an adversarial cross-model review and merge only on its approval.
5. **Periodic audit.** Recurring vision passes re-exercise the product and adjust the e2e suite: new behavior gets a spec, stale specs are retired explicitly.

Modules travel with their tests: a PR that ports or changes a module without its tests fails review. E2e specs use real UI login, no protocol stubs except schema-validated ones, and assert zero console errors where they touch the dashboard.

## Diagrams (non-negotiable)

The system is documented visually in Excalidraw under `docs/diagrams/`. Any change that alters structure, flow, or data shape must update the affected diagrams in the same unit of work. A structural change without its diagram update is incomplete, and review must reject it.
