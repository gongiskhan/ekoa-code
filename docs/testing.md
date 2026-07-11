# Testing

The five-layer QA process, the test estate map, the suite-ledger and contract gates, how to run
everything, and the live-verification playbook. Binding: skipping a layer makes a change incomplete.

## QA process (non-negotiable, ch13 §13.10)

Testing runs in five layers. Every change lands inside them.

1. **Baseline.** The ported e2e suite is the safety net. It stays green on every PR. A red baseline
   spec is fixed before any new work merges.
2. **Discovery.** Vision-based exploratory passes (an agent drives the real UI; a model analyzes the
   screenshots) surface probable issues and edge cases. Discovery runs are never CI gates and never
   regression. Every finding is closed by a deterministic test or a written dismissal - never
   silently.
3. **Regression.** Findings become deterministic tests: Playwright e2e for user-visible behavior,
   contract tests validating every response against the `shared/` zod schemas, unit tests where logic
   warrants. Every schema exported from `shared/` must be exercised by the contract suite (coverage
   gate). Every non-2xx body must validate against the shared error envelope. New endpoint means new
   contract test in the same PR. Stubs for API responses must be validated against the `shared/`
   schemas.
4. **Review.** Every PR gets a model code review. PRs touching `shared/`, auth, billing, the LLM
   module, or the collections engine - or exceeding 300 changed non-test lines - additionally get an
   adversarial cross-model review and merge only on its approval.
5. **Periodic audit.** Recurring vision passes re-exercise the product and adjust the e2e suite: new
   behavior gets a spec, stale specs are retired explicitly.

Modules travel with their tests: a PR that changes a module without its tests fails review. E2e specs
use real UI login, no protocol stubs except schema-validated ones, and assert zero console errors
where they touch the dashboard.

## Test estate map

- **`api/tests/`** - vitest, one dir per area: `contract/` (contract + envelope + the coverage
  gates), `llm/`, `agents/`, `automation/`, `apps/`, `knowledge/`, `memory/`, `billing/`, `auth/`,
  `integrations/`, `events/`, `data/`, `legal/`, `services/`, `streaming/`, `bridge/`, plus
  `security-headers.test.ts` and `health.test.ts`. Named security suites live here: `cross-org.test.ts`,
  in-org sharing, rate/spend-cap, the anonymisation payload-capture harness, and the bridge S1-S6
  scenarios (`fake-daemon/`). `migration/` holds the protocol-parity replay suites.
- **`api/tests/e2e/`** - node full-app e2e drivers (`*.e2e.mjs`): served-app plane, legal suite, and
  the deferred `erp-*` tenant-fork drivers (awaiting CUTOVER).
- **`api/tests/journeys/`** - the zero-dependency HTTP journey probe kit (`_lib.mjs`, `j*.mjs`) plus
  the credentialed `boot-b.mjs` harness. Re-runnable; the source of the release-hardening findings.
- **`web/__tests__/`** - web unit tests (`components/`, `lib/`, store logic).
- **`web/e2e/`** - Playwright dashboard specs (real-UI login).

## Suite ledger (`scripts/suite-ledger-run.mjs`, ledger `api/tests/SUITE_LEDGER.json`)

The single source of truth for which ported artifacts run at the current gate. Behavior: **census** -
assert the Playwright specs + node drivers on disk match the ledger counts exactly (a missing or
extra artifact fails the run, never a silent omission); partition into DUE vs AWAITING (AWAITING ->
`skipped (awaiting G<N>)`, never handed to a runner); with `--run`, DUE specs execute. **Ratchet:** an
artifact once green at its gate may never regress to skip/red. A NEW spec must be registered in the
ledger (a band) in the same change that adds it, or the census goes red - this is the mechanism that
forces new behavior to travel with a registered spec. `npm run gate:ledger` runs the census-only
lane; `npm run e2e` runs `--run`.

## Contract gates

- **schema-coverage** - every `shared/` descriptor is COVERED (hand-maintained allowlist) or PENDING
  (pinned count); neither = build failure. **Honor-system caveat:** it does NOT verify a test
  exercises a COVERED endpoint, so a green gate is not proof a body matches its schema (27/154 COVERED
  unexercised at the last audit; has shipped real bugs). Per-endpoint contract tests are the real
  coverage.
- **mount-coverage** - every declared path must be MOUNTED (401 = router exists, 404 = unmounted).
  DESCOPED to shrink-only (the EXCLUDED list may only shrink); proves the router exists, not a
  specific sub-route.
- **protocol-parity** - the `api/tests/migration/` suites replay legacy workloads + billing to prove
  parity on the carried surfaces.

## How to run

- `npm run ci:lane` - the single per-PR gate. In order: `lint` (ESLint over the repo + web lint -
  where the import-boundary and no-`@anthropic-ai` rules fire), `gate:chokepoint`,
  `gate:encryption-key`, `gate:garrison` (the grep guards), `typecheck` (all workspaces), `test` (all
  workspaces - unit + contract under vitest), then `build` (shared, api, web).
- `npm run test` - vitest across workspaces (no build).
- `npm run e2e` - the suite-ledger `--run` lane (Playwright + node drivers).
- `npm run e2e:server` (`scripts/e2e-with-server.mjs`) - boots `dev-api.mjs --built` (build first),
  waits for the featured-app prebuild, runs the ledger e2e. Carries documented committed-baseline debt
  (band1 dashboard specs need the separately-running Next web; band2 retired-`/api/v1/action` specs;
  the deferred `erp-*` CUTOVER fork). Not a regression - see `docs/known-flakes.md`.
- Security gates, out of the lane: `gate:sast` (semgrep), `gate:secrets` (gitleaks), `gate:audit`
  (`npm audit --audit-level=high`).

## E2e discipline

Real-UI login (`admin`/`tmp12345` in dev), no protocol stubs except schema-validated ones, zero
console errors where a spec touches the dashboard. **CORS note for Playwright stubs:** the dashboard
calls the api cross-origin in dev, so a `page.route` stub of an api response must reflect the request
Origin and allow `Authorization` (mirror what the dev CORS proxy injects) or the browser blocks the
stubbed response at preflight.

## Live-verification playbook

The running api serves `api/dist`, so **api source changes are not live until you rebuild and
restart**. After changing `api/`:

1. `npm run build` (or at least the api workspace build).
2. Restart the stack (`node .claude/skills/run-ekoa-code/driver.mjs up`).
3. Re-provision the model credential - the `credentials` singleton lives in the ephemeral in-memory
   Mongo and is wiped on restart: `node .claude/skills/run-ekoa-code/provision-credential.mjs` (see
   `docs/operations-runbook.md`). `GET /health` should read `claudeAuth.ok=true`,
   `meteringAnomalies=0`, `gatewayUnmeteredCalls=0` before you trust a live model turn.
