# Cornerstone - handoff to a new machine / new session

**Written:** 2026-08-31 · **State of `main`:** `b62a622` · **Author session:** the cornerstone build
(dev-madrid). This file is the durable ground truth: the session's own memory and scratch files are
machine-local and do NOT travel. Read this plus `CORNERSTONE_PLAN.md` (repo root) before continuing.

## What the cornerstone is

When a user runs an automation against an outside system, the platform turns that run into a
per-user integration carrying a learned recipe: the first run discovers the flow and captures the
private API under it, every later run replays deterministically with zero model calls, drift
self-heals and supersedes the recipe, and the user sees their integrations getting faster on the
Integrations surface.

## What is BUILT and on main (K0-K6, plus two review rounds and live fixes)

| Slice | What landed |
|---|---|
| K1 | **mint-on-plan** - `api/src/integrations/definition-mint.ts`. `planFromGoal` mints a per-site tenant integration (key from the plan's first navigate origin) carrying an `automationBinding` wrapper action, named through the reuse matcher's own tokenizer, `mutates` decided by a deterministic floor + a fail-closed chokepoint classifier. `PlanResponse.integration` (+ `integrationSkipped` reason). |
| K2 | **honest `needs_credentials`** at the action surface + the schedules `blocked` channel for `integration_action` targets. |
| K3 | **learning survives the ceremony** - the parked run row carries the storable action's identity (`actionRetry`, secret-scrubbed), and the post-ceremony resume fires ONE background learn-armed re-execution via the `setResumeLearnDriver` seam. |
| K4 | **replay visibility** - store-owned recipe stats (replayCount / lastReplayedAt / lastReplayMs / learnedRunMs / driftStreak), a typed `replay` block on the execute response gated on an out-of-band `automationEnvelope` marker, audit provenance, and the detail-page recipe badge + forget control. |
| K5 | **the doors** - the goal box on Integrações → Minhas, and the six chat catalog tools (`call_automation`, `call_integration_action`, `call_ekoa_action`, `list_*`) the catalog prompt had always advertised. |
| K6 | **bounded + single-writer** - `HEAL_BUDGET` (drift-heal ceiling via `driftStreak`), `REPLAY_BUDGET` (aborts the attempt, not just ignores it), ownership-gated `clearRefusedRecipe`. |

Decisions: `docs/decisions.md`, 2026-08-28, `D-CORNERSTONE-{MINT-SHAPE, DOORS, LEARN-ON-RESUME,
MUTATES-CLASS}`. Open findings and their backstops: `docs/findings.md` (OPEN section).

## What the LIVE runs found and fixed (this is the valuable part)

Five defects that no suite had caught, each found by actually running it on a paired Mac bridge:

1. **`authType` missing on minted rows** → every minted action was permanently unrunnable
   ("Ligue esta integração" with nothing to connect). Both the executor and the capability view key
   off `authType === 'none'`. Fixed `6500b91`, self-heal for pre-fix rows in `90ea8b0`.
2. **The builder edit dialog destroyed `automationBinding`** on save (it maps actions onto an
   HTTP-shaped draft) → a working browser-steps action became an unrunnable api-call one and its
   recipe was orphaned. The store now carries bindings forward per action name. `90ea8b0`.
3. **A category-less definition crashed the whole integrations grid** (`categoryLabel(undefined)`).
   `fd011ec`.
4. **The mint refusal reason never reached the user** → "nothing happened". `9b6e19a`.
5. **THE BIG ONE - `rebaseSelfUrl` hijacked every loopback navigate onto the dashboard origin.**
   A step `navigate http://127.0.0.1:45180/painel` was rewritten to `http://localhost:3000/painel`
   before `page.goto`; the fixture was never contacted, the 404 was recorded as a COMPLETED
   navigate, and the fixer then burned ~150k tokens failing to explain it. Now narrow (only ports
   that could plausibly be Ekoa), non-silent, and a navigate verifies the origin it landed on.
   `b62a622`. It also caught a pre-existing production bug: `u.host = base.host` does not clear a
   port, so `localhost:3000` rebased onto `https://app.ekoa.io` produced `app.ekoa.io:3000`.

## Where the demo got to

Confirmed working live: mint-on-plan, the integration surfacing as **Ativado** with run-now enabled,
the daemon accepting delegated browser work, the engine driving real steps with per-step
screenshots, the vision layer producing an accurate human-readable pause, and the chat catalog tools
invoking an action and translating its refusal.

**Never yet reached live:** the credential ceremony on the fixture's login wall, and therefore the
learn → zero-model replay → drift → supersede legs. Every one of those legs IS proven
deterministically (`deterministic-proof.txt`, 137 tests, incl. "run 2 replays ... with ZERO model
calls" and "the moved endpoint is detected as drift ... then superseded in-tenant"). What is missing
is one live pass, which was blocked by defect 5 above - now fixed and untested live.

**So the immediate next step is: re-run the demo per `runbook.md` and get past the login wall.**

## Traps that cost hours (do not rediscover them)

- **The bridge daemon is mandatory** for browser steps: `127.0.0.1` classifies **adversarial**
  (closed default), and `locality.ts` refuses an adversarial origin BEFORE any local-browser
  fallback flag is read. `EKOA_AUTOMATION_LOCAL_BROWSER` will not help.
- **`desktop.automation` is a tier-2 opt-in edited into the daemon's OWN config file**
  (`~/.ekoa-bridge/config.json`, `extraCapabilities`). It is deliberately not grantable from the
  dashboard. Advertising it is only half - Cortex still needs the per-org grant in Settings →
  Devices (default deny, both must hold). A re-pair silently drops the advertisement.
- **The dev Mongo is ephemeral**: admin re-seeded every boot (`admin`/`tmp12345`, no forced password
  change), and org state - including bridge grants - dies with it.
- **Never reuse Claude Code's own Anthropic login** for the model credential; ekoa uses a dedicated
  account (`claude setup-token` on that account).
- **The builder's "Executar Teste" panel cannot test a browser-steps action** (it is HTTP-only).
  Use run-now on the integration detail page.
- A stale `api/dist` silently serves old code; rebuild `shared` then `api` after every pull.
