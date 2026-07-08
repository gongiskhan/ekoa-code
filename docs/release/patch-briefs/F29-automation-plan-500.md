# F29: plan-from-goal deterministically 500s - a masked planner post-processing throw

**Severity / class:** high / bug

**Symptom:** `POST /api/v1/automations/plan` (natural-language automation authoring) returns
`500 {code:INTERNAL, "Erro interno."}` deterministically (2 identical attempts) as a bc-adm org-admin.
Isolated to the planner/rehearsal path: manual `POST /automations` = 201 and a direct
`POST /automations/:id/runs` reaches `completed` as the same actor, so the creation gate, persist, and
engine are sound. An `automation-plan` billing row IS minted, so the planner MODEL CALL ran and metered -
the throw is DOWNSTREAM of it. Evidence: `docs/release/evidence/J8-webhooks/j8b-automation.json`
(planFromGoal "500 INTERNAL - DETERMINISTIC (2 attempts, identical)"; narrowing.manualCreate201 +
normalRunCompleted true; billing.typeCounts `automation-plan:1`).

**Root cause (verified by reading code):**
- (a) CONFIRMED (as a class, not the exact line). The throw is in the planner's post-model-call
  processing, reached via `automation/service.ts:255` `await plannerPlanFromGoal(...)`. `runOneShot`
  mints the billing row FIRST (`automation/planner.ts:230`), THEN any of these throw a PLAIN `Error`:
  parse miss `planner.ts:237`; `validatePlanOutput` unexpected-status / no-steps / bad-step
  `planner.ts:266,271,302,307`; or the corrective-retry hard-fail `planner.ts:224` ("could not produce a
  valid plan after a corrective retry"). Which one fires depends on the model's output for that goal (see
  the caveat).
- (b) REFUTED for the rehearsal run-start. `startRunInternal` (`service.ts:313-346`) awaits only the
  initial `automationRuns.insert` (works - normal runs share it), then fires `rehearseAutomation`
  fire-and-forget: it is `async` (`automation/engine.ts:259`) so it cannot throw synchronously, and
  `void run.catch(() => undefined)` (`service.ts:344`) swallows any rejection. A rehearsal engine error
  cannot surface as this 500.
- (c) CONFIRMED. The route `handle` wrapper (`routes/automations.ts:54-63`) maps a
  non-`AutomationServiceError` to `sendError(res,'INTERNAL','Erro interno.')` and logs ONLY `err.message`
  (`:60`) - not the stack/cause - so the true error is a one-line stderr entry the probe did not capture.

**Fix scope:**
- Stop the hard-500: map an unusable model plan to a STRUCTURED outcome the client can render (reuse the
  `awaiting_integration` shape or add a `plan_failed` shape carrying the violations) instead of throwing a
  bare `Error` that becomes a generic INTERNAL. At minimum the corrective-retry hard-fail
  (`planner.ts:224`) and the parse/validate throws become handled outcomes.
- De-mask 500 causes: make the `handle` wrapper log the full error (stack + cause), not just
  `err.message` (`routes/automations.ts:60`), so any future planner throw is diagnosable from logs.
- NON-goals: not the webhook->run pipeline (verified PASS); not the creation gate / persist / engine
  (verified sound); do not weaken the closed-vocabulary cross-validation - keep it, just fail honestly.

**Regression test first:** extend `api/tests/contract/automations.test.ts` (it already `vi.mock`s
`runOneShot` and POSTs `/automations/plan`): drive the planner with realistic imperfect model outputs -
the shapes that currently throw (non-JSON, empty `steps`, an invalid step `type`, a plan failing
`crossValidatePlan` on both passes) - and assert the endpoint returns a handled non-500 outcome, NOT
`{code:INTERNAL}`; a happy-path plan still returns 2xx with a persisted automation + rehearsal `runId`.
Add planner-unit coverage per throw site in `api/tests/automation/planner.test.ts`. Must fail first.

**Acceptance:** `POST /automations/plan` never returns `INTERNAL` for a merely-imperfect plan (it returns
a structured 2xx plan + persisted automation + rehearsal run, or a rendered planner-failure); any genuine
500 logs the real cause (stack) server-side; contract + planner + service suites green.

**Notes:** No egress change - the planner call stays `llm/` `runOneShot` (`user_work` /
`automation-plan`), chokepoint intact (FIXED-3/8/13). CAVEAT: the EXACT throwing line is
model-output-dependent and NOT pinnable from static code - a live repro with the api server's stderr
captured (the wrapper already `console.error`s `err.message`) names it. No diagram change unless the
response contract gains a `plan_failed` shape, in which case update the ch03 §3.8.18 plan-endpoint shape
+ its diagram (FIXED-12).
