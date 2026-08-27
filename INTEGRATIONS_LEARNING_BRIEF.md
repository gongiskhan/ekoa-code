# Brief — the learning cornerstone: automations that become integrations and get faster

**For:** a fresh autonomous session. **Date:** 2026-08-27. **Repo:** `ekoa-code` (work on `main` via short-lived slices).

## The one-paragraph goal (the cornerstone the operator cares about)

When a user runs an automation against an outside system, the platform should **turn that run into a
per-user integration that carries a learned recipe** — so the *first* run discovers the flow
(vision-first) and captures the private API under it, and *every later run replays it deterministically,
faster, with no model calls*; when a replay drifts, it **self-heals** and supersedes the recipe; and the
user **sees their integrations getting faster and more reliable** on the Integrations surface. The far
goal is **learning across users** (a recipe discovered by one tenant makes the same site faster for
others) — behind an explicit trust boundary. This is the flywheel; nothing else in the product matters
as much.

## Read these FIRST (the plan already exists; do not re-invent it)

- `CONVERGENCE_PLAN.md` (repo root) — "Integrations as the Single Surface" (S1–S10): the detail page,
  per-user feedback, parametrize/compose, publish, migration (D3 wrapper actions), hide-automations.
  This is the SURFACE half.
- The P2 slice detail in the plan file
  `~/.claude/plans/elegant-floating-crescent-agent-aplan-engine-e34d8ff159a986d3.md` — the recipe
  engine (P2.0 recipe shape, **P2.1 discovery driver**, P2.2 network capture, P2.3 CDP replay, P2.4
  self-heal). This is the LEARNING half.
- `docs/CONVERGENCE_AUDIT.md`, `docs/INTEGRATIONS_UNIFICATION_AUDIT.md`, `docs/CAPABILITY_CONTRACT.md`.
- `docs/decisions.md` (D-* recipe/binding/ceremony entries) and `docs/findings.md` (OPEN residuals).
- Code that already exists: `api/src/automation/recipe.ts`, `api/src/integrations/recipe-store.ts`,
  `api/src/integrations/recipe-lifecycle.ts`, `api/src/automation/network-capture.ts`,
  `api/src/automation/executors/injected-call.ts`, `api/src/automation/self-heal.ts`,
  `api/src/automation/integration-automations.ts`, `api/src/integrations/service.ts`,
  `api/src/automation/service.ts`.

## Current state — what is BUILT vs the GAP (verified read-only 2026-08-27; re-verify, do not trust)

**BUILT (the learning machinery exists, and is wired to INTEGRATION ACTIONS):**
- `recipe.ts` — the compiled recipe (header NAMES not values, three-layer enforced), the durable shape.
- `network-capture.ts` → `injected-call.ts` — capture the private calls, then deterministic replay.
- `self-heal.ts` + `recipe-store.supersedeRecipe` — drift → re-learn → supersede, wired into
  `automation/service.ts` (~:1849). So "keeps building, faster next time" works **for an integration
  action's browser-steps flow**.

**THE GAP (this is the operator's cornerstone, and it is NOT wired):**
1. **No discovery DRIVER.** There is no `api/src/automation/discovery.ts`. `recipe.ts` names P2.1
   ("Discovery itself... authors a recipe from a goal") as a consumer that should exist, but the
   first-run **goal → recipe authoring** does not. Confirm this (grep `discovery`, `authorRecipe`,
   check `rehearsal.ts`/`planner.ts` for whether authoring lives there). If it is genuinely absent,
   **this is the first thing to build** — nothing downstream flywheels without it.
2. **No automation → integration AUTO-CREATION.** `integration-automations.ts` goes the wrong way
   (an integration PACKAGE provisions automations). Nothing takes a *free-text automation run* and
   mints/updates a per-user integration ("Minha Integração") that carries the learned recipe. That is
   why "Minhas Integrações" is empty after runs.
3. **The convergence SURFACE (S1–S10) is only partly landed** (task ledger says "in progress"). Audit
   which S-slices actually shipped (detail page, feedback, parametrize/compose, publish, migration,
   hide) so the user can SEE an integration and watch it get faster.
4. **Cross-user learning is not built** and is the last, most careful phase (tenant trust boundary;
   `self-heal.ts` only hints at platform-wide intent). Do NOT cross tenants without an explicit,
   reviewed sharing/consent model.

## First move (do this before proposing a build)

A **read-only audit**, fanned out: (a) does P2.1 discovery/authoring exist anywhere, and where does a
browser-steps run's recipe get FIRST written (not just superseded)? (b) exactly which S1–S10 slices
landed, with anchors; (c) trace, end to end, what happens when a user runs a free-text automation
against a new site today — where does the "become an integration + learn" chain break? Produce the map,
THEN plan the slices. Adversarially verify the map before building (this codebase has been unit-green
while broken before — see the ceremony-stream lifecycle audit, `D-CEREMONY-STREAM-LIFECYCLE`).

## Acceptance (the demo that proves the cornerstone)

1. Run a free-text automation against a login-gated site (the ceremony/capture path is DONE — reuse it).
2. A **"Minha Integração"** appears for that site, carrying a **recipe** (header names only, no values).
3. **Second run replays deterministically** — an LLM spy asserts **zero model calls**, and it is
   measurably faster (target 1–2 min per the P2 gate).
4. Break a selector → **self-heal re-discovers and supersedes** the recipe (version bump, `supersedes`
   stamp), reads heal silently, a write re-heal pauses for assent.
5. The Integrations detail page **shows** the integration, its runs, and that it got faster/more
   reliable. Promotion dry-run shows the snapshot carries no evidence/feedback (D5).
6. (Later phase) a recipe learned by one tenant accelerates another, behind the reviewed sharing model.

## Standing constraints (non-negotiable)

No Claude/AI attribution in commits/PRs; no tracked CLAUDE.md/.claude anywhere. Tenancy enforced (Rule 5
isolation suite for every new store); credentials as references only, never in model context/logs/traces
(the recipe's header-NAMES-only rule is exactly this — keep it). Rule 7 additive (contract tests +
coverage pins + OpenAPI/client regen in the same PR). The five-layer QA; adversarial cross-model review
before merging anything touching shared/auth/llm/collections or >300 non-test lines — **and re-audit the
fixes** (the ceremony work proved fixes introduce regressions). Every phase green through the full gate
lane before the next. No em dash; no emoji in UI. Diagram invariant (FIXED-12): structural change updates
`docs/diagrams/` in the same unit of work.
