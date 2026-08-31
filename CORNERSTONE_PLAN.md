# Cornerstone - free-text runs become learning integrations

**Date:** 2026-08-28 · **Status:** approved (4 decisions taken), building
**Ground truth:** two-round fanned audit (10 auditors, 37 verdicts, 0 refuted on core), adversarially
verified against live call chains. Key corrections to the brief: the P2 recipe spine is LANDED and live
for integration-action runs (not "built-not-wired"); P2.1 discovery was built and deliberately deleted
in the recorded P2 RE-CUT (docs/decisions.md:2132) because a second driving loop had no production entry.

## The architecture conclusion

Do NOT teach free-text runs to learn (that refights the recorded RE-CUT argument). Instead: the
free-text run becomes an integration action at plan time (mint-on-plan), and the existing verified
spine (observeNetwork -> learnFromRun -> putRecipe/supersedeRecipe -> replayIntegrationAction) learns
for free. One driving loop, one learn seam, zero new learning code.

## Verified chain breaks this plan closes

1. **No door.** /automations/new is 410; `planFromGoal` has zero web callers; chat mounts only
   knowledge_search/knowledge_read/delegate_to_local while the injected catalog teaches agents
   `call_automation`/`call_integration_action`/`list_*` tools that are defined nowhere (catalog.ts:301-311).
2. **Free-text runs never learn.** `observeNetwork` has exactly one supplier: `runAutomationForAction`
   (service.ts:1665-1674), armed only when `storable = named && !mutating`. startRun/resume/trigger/
   schedule paths pass none.
3. **No automation -> integration auto-create.** Definition writers are only the builder PUT and
   achieve's author arm. `userCreated:true` projects from any tenant Mongo definition row
   (definition-registry.ts:187), so a minted row appears in "Minhas Integrações" automatically.
4. **Ceremony-resume severs learning.** `dispatchCredentialResume` calls the engine directly
   (service.ts:942-948) with no observeNetwork and no action identity; `learnFromRun`'s only call site
   is service.ts:1689. First-contact runs on login-gated sites learn nothing.
5. **Replay is invisible.** `replay-<uuid>` short-circuit (service.ts:1532): no run row, no evidence,
   audit row non-discriminating; `replayed`/`recipeVersion` ride untyped in `z.unknown()` data;
   listRecipes/forgetRecipe mounted + contract-tested, zero web callers; no speed indicator anywhere.
6. **Halt code lies at the action surface.** A needs_credentials engine halt flattens to
   `automation_failed` (service.ts:1699-1705; no needs_credentials in IntegrationErrorCode), so a
   scheduled integration_action with a dead session auto-pauses after 20 fires with zero notification.
7. **Heal thrash unbounded.** No cap on drift -> re-learn -> supersede cycles; DISCOVERY_BUDGET is
   declared and consumed by nothing; `clearRefusedRecipe` is ownership-ungated (peer clear/relearn
   thrash, no multi-user suite).
8. **Live loop never ran whole.** Daemon capture/inject protocol matches by construction (shared zod
   both sides), but the deployed bridge bundle is unverified (repack pending), re-pair drops the
   desktop.automation advertisement, and the four-run acceptance matrix has never run.

## Decisions (taken 2026-08-28, journaled in docs/decisions.md at build time)

- **D-K1 mint shape: per-site integration.** Key derived from target origin; all automations against
  one site become actions on one integration. Action naming honors the lexical matcher precedent (D-S9-4).
- **D-K2 doors: both, UI first.** Goal box on the Integrations surface (plan -> mint -> run, live
  viewer), then the chat SDK tools the catalog already teaches.
- **D-K3 learn-on-resume: auto re-run.** Persist action identity on the run row; when a
  ceremony-resumed run completes, fire one background learn-armed re-execution through
  runAutomationForAction. Reads only (recipes exist only for non-mutating actions), so the re-run is safe.
- **D-K4 mutates classification: deterministic floor + model verdict at plan time.** Write-shaped
  signals force mutating; otherwise a model verdict (through the llm chokepoint) confirms read.
  User can flip on the detail page. Wrong-read risk stays bounded by the execute-time write gate + consent.

## Slices

### K0 - ledger groundwork
Journal D-K1..D-K4. Ledger the verified defects as findings: misleading halt code (break 6),
scheduled-action silent degradation, unbounded heal thrash, ungated clearRefusedRecipe, action-cache
persisting resolved fill values verbatim (cache.ts:259-289 - audit incidental, needs triage).
Fix CONVERGENCE_RUN_REPORT.md's S7 date (journal-authoritative 2026-11-14, report copied S9's 11-21).

### K1 - mint on plan (the auto-create)
Plan path (`planFromGoal`, service.ts:516) gains a deterministic post-stage: derive origin -> resolve
or create the per-site tenant IntegrationDefinition -> mint a wrapper action (automationBinding) named
for the matcher -> stamp `source.integrationKey` provenance on the automation (provision-path
mechanism). Mutates classifier per D-K4 (deterministic floor; model verdict via the chokepoint).
Gates: Rule 5 isolation suite for the mint path; Rule 7 additive on any wire change (contract test +
coverage pins + OpenAPI regen); diagram 02 update.

### K2 - honest halt + schedule channel
Add `needs_credentials` to the action-surface result codes (ActionRunResult union,
IntegrationErrorCode) additively; mapIntegrationOutcome maps it to blocked; blocked integration_action
schedule fires notify like automation targets do. Contract tests pin the enums.

### K3 - learn across the ceremony (auto re-run)
StoredRun carries `{integrationKey, actionName}` (additive). dispatchCredentialResume's background
promise, on completed status + identity present + action non-mutating, fires one learn-armed
re-execution via runAutomationForAction. Dedupe via the existing signals map; .catch swallow mirrors
service.ts:1689-1692. Suite: halt -> mint session -> resume -> background learn produces recipe v1.

### K4 - replay visibility (the "getting faster" surface)
- shared: additive typed fields on the execute response (replayed, recipeVersion, runId, summary,
  durationMs) + contract test + coverage pin + OpenAPI regen (keep user-defined-poll's runId+status shape).
- recipe-store: replayCount, lastReplayedAt, lastReplayMs, learnedRunMs on the recipe row.
- auditExecute payload gains replayed/recipeVersion/runId (no wire change).
- web /integrations/[key]: recipe badge per action (version, learned date, replay count, last replay
  vs authored duration), forget-recipe affordance (DELETE mounted, unused), runNow toast renders the
  replay summary. listRecipes feeds a per-integration recipes view. Text labels only, no emoji.

### K5 - doors
UI: goal affordance on /integrations (PT-first copy) -> POST /automations/plan (now minting) ->
navigate to /integrations/[key]?action=... -> run-now -> existing live run viewer stack.
Chat: implement call_automation / call_integration_action / call_ekoa_action / list_* as SdkToolSpecs;
add to toolPolicyFor allowedTools AND chat.ts sdkTools; route action calls through
executeIntegrationCapabilityAction so consent/write gates are inherited.

### K6 - robustness
HEAL_BUDGET in budgets.ts (pinned): cap drift-heal cycles per action per window using the supersedes
lineage as the streak signal; on cap, clearRecipe + finding-grade log. Ownership-gate
clearRefusedRecipe. Replay attempt timeout knob. Multi-user suite: two users, one org - pins the
clear/relearn thrash fix and documents the doomed-replay cost for lower-tier peers.

### K7 - live acceptance + evidence
Repack the bridge bundle (pack:dist), verify deployed daemon speaks captureOp/injectedCall,
re-establish the desktop.automation grant. Then the demo, captured into evidence/cornerstone/:
free-text goal on a login-gated site -> ceremony -> "Minha Integração" appears carrying the recipe
(header names only) -> second run replays zero-model, measurably faster -> break a selector ->
self-heal supersedes -> detail page shows the improvement.

## Standing constraints (every slice)
Tenancy (Rule 5) suites for touched stores; credentials as references only (header-names-only rule is
already store-enforced: assertCarriesNoValues refuses, never repairs); Rule 7 additive with contract
tests + coverage pins + OpenAPI in the same PR; five-layer QA; adversarial cross-model review (shared/,
auth-class, and >300-line slices); diagram invariant (FIXED-12); no em dash, no emoji in UI; no AI
attribution in commits.

## Order
K0 -> K1 -> K2 -> K3 -> K4 -> K5 -> K6 -> K7. K2 can land parallel to K1 (disjoint files). App
shippable after every slice; each slice green through the full gate lane before the next starts.

## Far goal (explicitly out of scope here)
Cross-user learning stays absent by contract ("A COMPILED RECIPE NEVER CROSSES ORGS"). When it comes,
it builds on the publish/snapshot rail + a recipe-sharing scrub that today is absent by design.
