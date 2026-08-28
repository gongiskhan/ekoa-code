# Cornerstone acceptance - evidence + status

**Date:** 2026-08-28 · **Build:** main @ `39ab834` (K0-K6 + two review rounds applied)

The cornerstone: a free-text automation run against an outside system becomes a per-user
integration carrying a learned recipe; the first run discovers + captures the private API,
every later run replays deterministically with zero model calls, drift self-heals and supersedes,
and the user sees their integrations getting faster on the Integrations surface.

## What is PROVEN, deterministically (committed suites, `deterministic-proof.txt`)

Every MECHANICAL leg of the acceptance demo has committed, re-runnable coverage. These drive the
real hosted-side logic (real definition store, real recipe store, real automation engine); the
daemon browser session is a fake that feeds scripted capture frames, so what is proven is the
hosted half - the half this build changed.

| Demo leg | Suite | What it asserts |
|---|---|---|
| free-text goal -> a "Minha Integração" appears carrying a wrapper action | `integrations/definition-mint.test.ts`, `automation/plan-mint-wiring.test.ts` | planFromGoal mints the per-site definition, names the action so the matcher finds it, stamps provenance, answers `PlanResponse.integration`; Rule-5 two-org isolation |
| the recipe carries header NAMES only, never values | `integrations/recipe-store.test.ts`, `automation/replay-mount.test.ts` | `assertCarriesNoValues`; a credential that rode in on an arg never reaches the page |
| 2nd run replays the same real API with ZERO model calls | `automation/discovery-replay-acceptance.test.ts` ("run 2 replays ... with ZERO model calls"; "a third and fourth run are the same again") | replay short-circuits the automation, spy asserts zero LLM calls |
| break a selector -> self-heal supersedes | `discovery-replay-acceptance.test.ts` ("the moved endpoint is detected as drift at zero model cost, then superseded in-tenant"), `automation/self-heal.test.ts` | drift classified, `supersedeRecipe` bumps version + stamps lineage, tenant-scoped |
| the detail page shows it got faster | `automation/replay-mount.test.ts` (stats bump), `integrations/recipe-store.test.ts` (stats lifecycle) | `recordReplay` bumps replayCount/lastReplayMs; typed wire `replay` block |
| first contact halts for the ceremony, then learns | `automation/resume-learn.test.ts` | the post-ceremony learn re-run fires on completion with the parked action identity |
| the loop is bounded + single-writer | `replay-mount.test.ts` (heal ceiling, ownership gate, replay budget), `budgets.test.ts` (pins) | HEAL_BUDGET clears an unhealable recipe; a non-owner peer's refusal never destroys the recipe |
| chat door refuses writes | `agents/catalog-tools.test.ts`, `automation/recipe-mutates.test.ts` | recipe-derived mutation gate; actor identity is the bound run actor |

Full api suite green on HEAD: **6029 passed** (the only 3 "failures" in a from-cold whole-repo run
were pre-fix reads of the 3 estate pins the cornerstone legitimately moved, all committed green in
`1d84bdf`).

Two independent review rounds, findings applied:
- **Fresh-context adversarial review** (5 lenses -> refute-verify): 2 HIGH + several MEDIUM fixed in `204cd64`.
- **Codex cross-model checkpoint** (3 scoped passes): credential-in-actionRetry, ekoa write-gate,
  classifier injection, catalog injection, re-plan TOCTOU fixed in `39ab834`; residuals ledgered.

## Live state, precisely

**The ceremony mechanic is confirmed working** (operator, 2026-08-28): the headed login -> session
capture -> resume flow was exercised and worked in a prior session. The cornerstone did NOT modify
that mechanic - K2/K3 changed what the action surface REPORTS at the halt and what fires AFTER the
resume, not the capture itself - so the operator-gated human-login leg that this agent could not
drive on a headless box is not a blocker: it is known-good.

**The cornerstone-specific legs that ride on top are proven DETERMINISTICALLY, not from that prior
ceremony test** (they postdate it - the commits did not exist when the ceremony was last exercised):
mint-on-plan creating the integration (K1), the post-ceremony learn re-run producing a recipe (K3),
zero-model replay, and drift -> supersede - all in the table above, driving the real hosted-side
logic with a scripted daemon capture.

**Recommended (non-blocking) final smoke:** one pass of `runbook.md` against `fixture-portal.mjs`
on a display machine with the repacked+paired bridge and a HEAD-build stack, to see the new code's
recipe badge appear live end to end. This is a confidence check on the wiring of the NEW code into
the known-good ceremony, not a gate the build waits on. Verify the recipe badge actually appears
before calling that smoke done - that is the "unit-green while broken" failure mode the build guards
against.
