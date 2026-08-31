# Integrations as the Single Surface — Convergence Plan

**Date:** 2026-08-17 · **Base:** `feat/schedules` (schedules shipped) · **Status:** for review, nothing built
**Ground truth:** VERIFICATION.md (Phase 0) + a five-agent recon of the blast radius, evidence shapes,
migration mapping, publish/feedback seams, and reuse-ladder inputs. Every claim below carries a file anchor
in the recon transcripts; the load-bearing ones are cited inline.

---

## What this converges, in one paragraph

Integrations becomes the only user-facing surface for work that touches outside systems. The backend
already has one executor rail, one write gate, one authoring path; what is missing is the *surface*:
a per-integration detail page (actions, read-only steps, runs, evidence, schedules), a per-user feedback
channel, the parametrize/compose rungs in `achieve`, the publish doors (built but never mounted), and
then — only then — the removal of everything automation-branded. The engine, the `/api/v1/automations`
contract (public, versioned, Rule 7), triggers, and schedules keep working unchanged underneath.

---

## Decisions I need from you (each has a recommended default; silence = default)

- **D1 — Parametrize safety rule.** A model-filled arg landing in the request BODY is covered by the
  human's standing shape+destination approval exactly as caller-supplied args are today. An arg landing
  in the resolved TARGET (path/query placeholder) selects the resource under one standing approval whose
  dialog only ever showed `{{arg}}`. **Default: model may fill body args always; path/query args only on
  `mutates:false` actions.** (Writes keep human-supplied targeting.)
- **D2 — Feedback write auth.** The C3 lessons write is `user` (not `user-or-key`) on Rule-8 grounds: free
  text that lands in future prompts, written by a key-bearing agent, is self-injection. Per-user feedback
  IS future-prompt guidance. **Default: `user` write; agents read it, never write it.**
- **D3 — Migration mode for existing automations.** **Default: report-only boot import** (the
  legacy-runtime-import shape: idempotent, content-hashed, env-flag opt-in), minting *wrapper* actions
  that point at existing automation rows. Never renumber/delete — automation ids are live references
  from triggers, schedules, run history.
- **D4 — Server-side "Automação" prose.** Even with all routes hidden, users still see the word in the
  consent dialog (`action-consent.ts:255`), run errors (`engine.ts:1167`), schedules errors, and chat-agent
  replies (the injected catalog says "Available automations"). **Default: reword these in the hide slice**
  (consent prose, error envelopes, catalog prompt) rather than accept the leak.
- **D5 — Evidence on promoted/global integrations.** Evidence lives in a tenant-scoped collection that is
  structurally outside the published snapshot, so promotion carries none by construction. **Default: that
  structural exclusion IS the sanitization for v1**; synthetic samples for global integrations are a
  follow-up, not this plan.

---

## Wave 1 — the replacement surface (nothing removed yet; app shippable throughout)

### S1. Evidence model + capture
New tenant-scoped collection `integration_action_evidence`, deterministic `_id` over
`(orgId, integrationKey, actionName)` — one live evidence row per action, superseded wholesale on each
validated run (the action-consent `idFor` discipline). Never a field on the definition doc: it would ride
`publishedSnapshot` into other orgs and race the 16 MB doc limit.
- **api-call:** the redacted `requestSummary` is ALREADY built on every call (`action-executor.ts:574`,
  `redactSecretsDeep`) and discarded on success — persist it plus a redacted, 8 KB-capped response sample
  on 2xx. No new redaction machinery; reusing the failure path's is the safety argument.
- **browser-steps / bash-cli:** the bound run already records everything (per-step screenshots via the
  authenticated screenshot plane; `local_command` stdout/stderr on `StepRecord.output`). Evidence stores
  `{runId, stepIndex}` pointers + capped excerpts. The 7-day screenshot sweep gets an exemption for
  pinned evidence runs (and the GDPR erasure path extends to the pins).
- **Graduation gains teeth:** promotion to trusted currently proves *shape*, never behavior (an action can
  graduate having never run). Promotion starts referencing the evidence row — "last validated run" becomes
  the graduation prerequisite the brief asked for.
- Gates: contract test + COVERED keys, Rule 5 isolation suite (evidence is per-tenant state), diagrams 02+05.

### S2. Integration detail page (`/integrations/[key]`)
The page the brief describes, and the new home for what `/automations/[id]` provides today:
actions list (description, backing chip, mutates/consent state — data the capability view already
carries), read-only steps view per backing (api-call: method+URL template + evidence sample; browser/bash:
the bound automation's step list, read-only, with per-step screenshots/output from the evidence run),
last run status, runs history (automation-backed actions already yield `runId`s), the action's schedules
(my schedules store filtered by target), and run-now. The existing list page keeps connection/consent
management; rows link into the detail.

### S3. Per-user step feedback
New store keyed `(orgId, userId, integrationKey, actionName, stepRef?)` (action-consent tuple pattern,
idempotent upsert). UI: an "add note" affordance on the read-only steps view; author sees/edits only
their own. Consumption — prompt attachment at the three model-touching seams, never executor logic
(FIXED-4): a third scrubbed section in `composeIntegrationContext` (reaches chat/automation/builder agents
via `load_context`), the automation planner/rehearsal prompt for browser-steps guidance, and the author's
own feedback as a hint in achieve's drafting prompt. `scrubSecretText` before every prompt egress (the
lessons floor); structurally excluded from publish (separate collection); documented: feedback does NOT
follow a copy-on-author fork (new key). Self-heal note: the rehearsal/vision path consuming feedback for
that user's runs is exactly the brief's "feedback feeds self-heal" assumption — confirmed feasible, lands here.

## Wave 2 — the reuse ladder (the safety slice)

### S4. Parametrize rung
`matchActionForGoal` stays deterministic and untouched — the module's own text forbids a model picking
the ACTION, and that stays the whole safety argument. What changes: on a match against a TRUSTED action
whose declared args the goal seems to carry, a third `authorWithRepair` specialisation (a `PlanDrafter`
seam beside `ActionDrafter`, bound in server.ts) runs ONE tool-less WORKHORSE turn producing
`{args}` in a fenced block; then a small deterministic verifier in the authored-action style:
args ⊆ `argsSchema` declared (note: the executor never enforces argsSchema — this verifier is the only
check, so it must be real), scrub pass over values, render-probe of the resolved URL through
`assertOriginAllowed`, and the D1 rule. Then `executeIntegrationCapabilityAction` — the write gate is
inherited with zero new code (lock 1). Refusals extend `AchieveRefusalCode` additively.
**Precedent, pinned correctly:** the automation planner already turns NL into integration args executed
through the same gate; chat does NOT (it has no integration tool) — the safety case cites the planner.
Billing: `checkAllowance` first, `user_work` billed to caller, `integration-builder` tag (achieve's own).

### S5. Compose rung + the canonical test
Compose is NOT a prompt slice — there is no server-side join anywhere (CollectionsEngine is list/get;
`store.query` is single-field, in-memory). Smallest honest addition: a deterministic post-stage in
achieve — execute the matched trusted READ action, then filter/join its result against an `app_data`
collection with a `SimpleQuery`-class predicate (reusing the recipe DSL vocabulary, no new interpreter
power for artifacts). The model's only contribution is naming the collection/field/predicate; the stage
itself is TypeScript. **Canonical test committed:** "todos os processos de clientes com menos de 40 anos"
resolves as `get-ongoing-processes` (trusted read) + a join against the tenant's clients collection,
mints nothing, and the run record shows the planner's decision (`outcome: 'composed'`, the rungs
considered). Reads only in v1; a composed WRITE is refused with its own code.

## Wave 3 — sharing finished

### S6. Mount the publish doors + promotion rules
Five descriptors + thin routes over logic that already exists and is already tested:
`requestPublish`/`withdrawPublish` = `user`; `listPublishRequests`/`publishDefinition` = `super-admin`;
`previewPublish` = `user` (module-internal admission). None `user-or-key` (the setGlobal precedent: a key
must never publish to every org). Literal paths before `/:key` (the file's own ordering trap). Supersede:
`publishDefinition` on a key that already has a live snapshot replaces it wholesale with the `supersedes`
stamp — that IS the brief's "promoting a user-built integration may replace the existing public one";
tenant copies unaffected (they fork on self-extension already). Evidence sanitization per D5: structural.
Per-user feedback never travels: separate collection, no publish path reads it. The review queue the E2
slice designed becomes reachable for the first time.

## Wave 4 — the hide

### S7. Automations → integrations migration (report-only first)
Three tiers from the mapping recon: (1) automations that are exactly one `api_call` step flatten into
self-contained api-call actions; (2) everything else gets a WRAPPER action (`automationBinding` — the
mechanism, tenancy, write gate and consent story exist end-to-end; citius is the live proof); (3)
sub-automation graphs, declarations/cofre refs, rehearsal/vision stay engine-internal behind the wrappers.
Known degradations, recorded not hidden: the action rail is owner-only (org-visible automations narrow),
and synchronous action semantics collapse mid-run pauses (`paused_for_user` etc.) to a coded failure —
wrapped automations that pause mid-run keep their full lifecycle only via the runs surface (S2 shows it).
The authored-action api-call-only guardrail is NOT widened; migration mints bindings via the builder save
path, not achieve. MCP arrives later as its own backing (already explicitly stubbed in the union).
Rule 10 entry with review date fixed at the start.

### S8. Hide + copy sweep + spec disposition
The census checklist, complete: nav row; the three `/automations` pages become redirects into the
integration detail (or 410 for `/new`); the integrations page's "Refinar passos"/"Criar automações"
affordances re-point into the detail page; my schedules pages' two `/automations` links re-point;
`PauseForUserOverlay` rebrands (it pops for headless runs regardless); the schedules locale slice
rewords "Automatização"; the knowledge banner line; per D4 the server prose (consent dialog, engine error,
routes' PT strings, the chat catalog prompt heading + tool naming pass). Tests: THREE band1 zero-change
specs hard-assert automation UI — each gets an explicit ledger disposition (rewrite against the new
surface; retire only with the written justification docs/testing.md requires);
`automation-deterministic` keeps its API legs, drops the UI leg; `regressions-dashboard`'s CITIUS row
assertion re-anchors. `stores/automations.ts`, `useAutomationRun`, every `/api/v1/automations` descriptor
and route: UNTOUCHED (public capability API; the coverage gates pin them).

## Wave 5 — the proof (Phase 3, adapted)

### S9. Citius reference case
Build the "ongoing processes" action honestly: the declared `consultar_processo` template is a
singular-by-number lookup; a list-ongoing-processes automation template + wrapper action is new work,
needs a real Citius session to validate (the CS5 seam). Then the reference schedule: the notifications
fetch as an `integration_action` schedule target — the supervisor, blocked-run consent surfacing, and
evidence capture all exercise the full converged stack.

### S10. Evidence run + report
The brief's Phase 3 list against the converged system, captured into `evidence/`: the two Citius actions
(scheduled + manual), the under-40 compose demo with the planner's decision visible, one deliberate
self-extension (mint → guardrails → trust → deterministic re-run), the UI surfaces (detail page, read-only
steps + evidence per backing, a feedback entry, schedules view), and a promotion dry-run showing what the
snapshot contains versus the origin (evidence + feedback absent, credentials scrubbed). Closing report.

---

## Standing constraints (all wired into every slice)

Tenancy everywhere (Rule 5 isolation suites for the two new stores); credentials only as references —
evidence capture reuses the executor's own redaction and adds no egress; write gate untouched (achieve's
six locks preserved verbatim; parametrize inherits the gate, never reaches past it); keys never wider
than their user (new write surfaces are `user` per D2/publish precedents); Rule 7 additive (every shared/
change lands with contract tests + coverage-pin updates + OpenAPI/client regen in the same PR); FIXED-12
diagrams per slice; adversarial cross-model review before merge (every wave touches shared/ or auth-class
surfaces). The locale files are shared with in-flight WIP — same hunk-staging discipline as the schedules
commit.

## Order & shape

S1 → S2 → S3 are sequential (each consumes the previous). S4 can start parallel to S2/S3 (disjoint
files). S6 is independent after S1 (sanitization stance). S7/S8 strictly last before S9/S10. Each slice
lands green through the full gate lane before the next starts; the app is shippable after every slice.
