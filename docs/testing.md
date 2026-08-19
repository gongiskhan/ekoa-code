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
  in-org sharing, rate/spend-cap, the anonymisation payload-capture harness,
  `locality-isolation.test.ts` (Rule 5 for execution locality: an org's run is never routed out
  through another org's machine, staged with real pairing + grant rows and asserted through both the
  injected seam and selection itself), and the bridge S1-S6 scenarios (`fake-daemon/`). `migration/`
  holds the protocol-parity replay suites.
- **The P4 locality suites, and what each is for** (they overlap on purpose, and the overlap is the
  point - a decision this slice makes wrong is an account lock, so each layer proves a different
  thing about it). `automation/locality.test.ts` drives the PURE decision table with real arguments,
  including the retired-ceremony-machine cases. `automation/engine-locality.test.ts` drives the REAL
  engine and asserts on `contextRequests` - whether a hosted browser was reached at all and by which
  route - because a run's final status cannot distinguish "ran hosted and then failed" from "never
  ran hosted"; it also carries the credential-gate ORDERING cases, staged with a real Cofre password
  item, a real standing grant and a real login recipe so the typist could genuinely have opened a
  browser. `automation/credential-gate.test.ts` asserts on the ARGUMENT handed to `ensureSession`
  (the posture half of the permit), and `automation/session-establishment.test.ts` on what the
  absent permit does (`needs-human`, nothing opened). `automation/config.test.ts` pins the hosted
  browser's kill switch in BOTH environments, including under `NODE_ENV=production`.
- **The P4 wiring pins, and why each exists as its own case.** Every safety property this slice
  established was, at one point, deletable with every suite still green - so each is now pinned by a
  case that was CONFIRMED BY MUTATION (break the source, watch it redden, restore). The ceremony
  preference is wired in two independently-deletable halves and gets two cases built to separate
  them: the half-A case gates an `integration` step, which has no locality of its own so no
  re-resolution can fire, and observes the preference on the NEXT step; the half-B case gates the
  browser step itself. Deleting half B reddens the half-B case alone. A third case connects the
  ceremony machine and expects the run to COMPLETE, so neither is satisfiable by an engine that
  simply refuses everything. `automation/locality.test.ts` additionally censuses `clearedBy` across
  every refusal the module can produce - an account with NO machine in it is the only refusal waiting
  cannot clear - and
  `automation/service.test.ts` pins BOTH blocked codes reaching `startRunForTrigger`, not just
  `awaiting_daemon`. On the web side the badge's own spec is not enough: the two PAGES that render
  it are pinned separately (`components/schedules-page.test.tsx`,
  `components/schedule-detail-page.test.tsx`), on the WORDS a person reads, because dropping the
  `code` prop leaves a component that is correct, tested and permanently on its generic fallback.
- **Four fixture rules this slice learned the hard way, and all four generalise.**
  (1) DRIVE EVERY MEMBER OF A SET THAT GATES BEHAVIOUR, not the cheapest one. Every locality fixture
  drove a `wait` step, so `STEP_TYPES_NEEDING_BROWSER` - the sole gate deciding which steps get a
  locality verdict at all - could be cut to `new Set(['wait'])` with 94 files and 1324 tests still
  green, leaving the three step types that actually drive a page (`navigate`, `browser`, `verify`)
  covered by nothing. `engine-locality.test.ts` now runs one case per member, in both directions,
  via `describe.each(browserNeedingSteps)`. The observable has to be the halt MESSAGE, never the run
  status: a step waved past locality falls through to the executor's own "there is no browser here",
  which ends the run in the SAME status with the same empty context log.
  (2) A FIXTURE WITH ONE CANDIDATE CANNOT PROVE A CHOICE. The permit-route case used a fleet of one
  machine which was also the connected daemon, so it passed identically whether the permit carried
  the daemon's own line or `resolveEgress`'s independent `usable[0]` pick - there was only one thing
  to pick. Any assertion about WHICH of several things was chosen needs the wrong answer to be
  available and, better, listed first.
  (3) A FIXTURE MUST STAMP A SHAPE PRODUCTION ACTUALLY EMITS - the costliest of the four, and the
  reason round five exists. Every P4.2 fixture paired `establishedBy: { kind: 'machine' }` with
  `boundEgress: { kind: 'datacenter' }`, under a comment saying that kept checkout out of the way.
  It did, by describing a session NO code path in this repo produces: `bridge/attended.ts` writes
  machine+residential, the hosted typist writes cloud+datacenter, and `EstablishmentVantage` - the
  only other route to the field - has no production producer at all. So the suite proved a variant
  that cannot exist while the shape that does exist halted at the credential gate, and the entire
  P4.2 path was dead in the shipped product with every case green. THE RULE: for any fixture that
  stamps stored state, name the production writer that emits that exact shape, in the fixture. If
  you cannot name one, the fixture is the bug. A comment explaining that a fixture shape is
  CONVENIENT is a reason to re-read it, not a reason to keep it - convenience is usually the sound
  of a real precondition being stepped over, and here the precondition was the one input the run
  loop never supplied.
  (4) A GUARD WHOSE ONLY OBSERVABLE IS A STATUS ANOTHER BRANCH ALSO PRODUCES IS UNPINNABLE. Two
  engine guards were mutable to no effect: skipping the credential gate for a locality-refused step,
  and clearing `stepLocality` between steps. Both left status, halt and message identical when
  broken, because a different branch produced the same record. Their tests had to observe the SIDE
  EFFECT instead - a second browser context that should not exist, and the proxy a login actually
  left through - which is the general move when a mutation survives.
- **A census must be a census.** `locality.test.ts`'s `clearedBy` coverage was five hand-written
  inputs under a docblock claiming to cover every refusal the module produces; a new terminal branch
  could be added, reached, and leave it green. It now walks the CROSS PRODUCT of the input space
  (postures, targets, offline policies, preferences, daemon states, fleet listings, the kill switch),
  collects every distinct refusal actually emitted, and asserts the collected set against an
  enumerated one - so a new refusal of either kind reddens it, and so does an existing NEUTRAL one
  quietly turning terminal, which is how a schedule starts auto-pausing on a shut laptop. A census
  only catches what its space REACHES, which is not a formality, twice over: a branch conditioned on
  more than two fleet candidates was missed by the first version of the space (hence the larger
  fleet), and the space carried `[]` as its only empty listing until `[]` and `null` became different
  facts - so the terminal empty-account branch would have been invisible to it.
- **`api/tests/automation/local-browser-context.test.ts`** - the LAST MILE, and the reason the
  provider takes its browser as an argument. Deciding a route is proved everywhere; APPLYING it was
  proved nowhere, because the application lived in an inline closure in `server.ts` that nothing
  could bind - so reducing it to `return browser.newContext()`, every residential run silently
  leaving from the datacenter, left the whole repository green. The seam is now
  `localBrowserContextProviderUsing(openBrowser)` and this suite drives the real function with a
  recording browser, asserting the launch options Chromium would actually have received.
- **`api/tests/e2e/`** - node full-app e2e drivers (`*.e2e.mjs`): served-app plane, legal suite, and
  the deferred `erp-*` tenant-fork drivers (awaiting CUTOVER).
- **`api/tests/journeys/`** - the zero-dependency HTTP journey probe kit (`_lib.mjs`, `j*.mjs`) plus
  the credentialed `boot-b.mjs` harness. Re-runnable; the source of the release-hardening findings.
- **`clients/bridge/test/`** - the daemon's own vitest estate, one dir per module (`runtime/`,
  `browser/`, `engine/`, `tools/`, `verify/`, `session/`, `ledger/`, `containment/`, `auth/`, `cli/`,
  `surface/`, `attended/`, `autostart/`, `claims/`, `transport/`, `wire/`, plus `lint/` which runs the
  ROOT eslint config over virtual files to prove the fs-containment ban still fires). `test/security/`
  holds the I9 lifecycle suites, of the class of `api/tests/security/*`: **`secret-no-disk`** (a
  delivered+consumed value appears in NO file under `EKOA_BRIDGE_HOME` - config, ledger, profiles),
  **`secret-no-log`** (neither the value nor its env-var NAMES reach any log, console or ledger sink,
  with the one deliberate boundary - a command that itself names the variable - asserted as such),
  **`outbound-redaction`** (a bash step and a browser observation that echo a delivered value leave
  `send` scrubbed, raw and in common encodings), **`secret-zeroize`** (held Buffers are `fill(0)`ed
  after the child exits, when it throws, and on TTL sweep). `test/integration/` is the heavy canary
  (mongodb-memory-server + `api/dist` + the real WS bridge server), excluded from the unit lane and
  run as its own CI step. **No unit test launches a browser**: the persistent-profile launcher and the
  Playwright page surface are injected interfaces, so the headed paths are exercised against fakes and
  only the real headed launch needs a display.
- **`web/__tests__/`** - web unit tests (`components/`, `lib/`, store logic).
  `components/run-status-badge.test.tsx` is the durable regression for copy that derives from a
  CODE rather than a bare status: it pins that each `blocked` cause reads differently, that the
  fallback for an unknown code is vague rather than specifically wrong, and that en/pt stay
  key-for-key.
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
- `npm run e2e:server` (`scripts/e2e-with-server.mjs`) - boots the WHOLE stack through the committed
  `run-ekoa-code` driver (api on an internal port, the CORS proxy on `backend.port`, and the web app),
  waits for both planes, runs the ledger e2e. Carries documented committed-baseline debt
  (band1 dashboard specs need the separately-running Next web; band2 retired-`/api/v1/action` specs;
  the deferred `erp-*` CUTOVER fork). Not a regression - see `docs/known-flakes.md`.
  **It binds fixed ports.** `backend.port` (4111) is read from the committed file and is NOT
  configurable; the web port is `EKOA_WEB_PORT` (3000) and the specs' base URL is `WEB_BASE_URL`.
  A dev server already holding one of them makes the whole estate red for a reason that has nothing
  to do with the code - set both env vars rather than reading the result. See `docs/findings.md`
  `e2e-server-loses-to-a-running-dev-server`.
- Security gates, out of the lane: `gate:sast` (semgrep), `gate:secrets` (gitleaks), `gate:audit`
  (`scripts/audit-gate.mjs` - a per-advisory ledger, because `npm audit --audit-level=high` is
  all-or-nothing and was therefore unsatisfiable and unread).

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

### The composition root's own bindings (P4, 2026-08-19)

A seam BODY being testable is not the same as its BINDING being tested, and the difference is a
whole class of surviving mutant. Both P4 bindings in `api/src/server.ts` were deleted, one at a
time, with the entire suite still green and exit 0:

- `setEgressCandidateResolver(...)` - without it `loadEgressCandidates` returns the default `null`
  ("this process has no listing"), so `fleetIsKnownEmpty` is never true and `machineRetired` always
  answers no. Both terminal halts P4 added become unreachable and the unbounded neutral retry
  returns.
- `setLocalBrowserContextProvider(...)` - reverted to the pre-P4 closure, `proxyOptionFor` is never
  applied, so every run that resolved a machine route leaves from the datacenter while every
  decision above it reports success.

They survived for a structural reason worth stating as a rule: **every suite that exercises a seam
installs its own implementation first**, which overrides whatever the composition root did. A suite
that begins with `setX(fake)` can never observe the production binding of `X`, so a repository whose
seams are all tested that way has no coverage of its composition root at all - and a clean deletion
takes the imports with it, so lint and typecheck stay silent too.

THE RULE. A seam whose production binding carries behaviour (not merely "some function is present")
gets a composition-root test that boots the real `buildApp` and asserts the seam answers as the REAL
implementation. `api/tests/automation/composition-root-locality.test.ts` and
`api/tests/llm/ruleset-resolver.test.ts` are the two instances. Two things make such a test honest:

1. Reset the seams to their defaults BEFORE `buildApp`, and never re-bind afterwards.
2. Assert something only the real implementation can produce. `loadEgressCandidates` answering `[]`
   is the example - the unbound default answers `null`, and "not null" is exactly the distinction
   the branch's terminal halts rest on. Asserting merely that a function was installed would pass
   against a resolver bound to `async () => []`.

Where the real implementation needs a resource a test cannot have (here: a Playwright launch), the
resource is injected at the composition root through `RuntimeDeps` rather than reached for inside
the binding - optional, defaulting to production's, so the binding under test is the one that ships.
