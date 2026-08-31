# VERIFICATION — "Integrations as the Single Surface" brief, Phase 0

**Date:** 2026-08-17
**Working branch:** `verify/integrations-single-surface` (cut from `main` @ `6b5e6e1`)
**Repo verified:** `/home/ggomes/dev/ekoa-code`
**Method:** git history across all branches, file/identifier evidence, and gates executed directly.

---

## VERDICT: STOP — "found, but not built as assumed"

The work is **real, substantial, and merged into `main`**. It is not missing and it is not a fragment.
But it is **materially different from the assumed state** in several places, and those places are
precisely the ones Phase 2 and Phase 3 depend on. Two of the three STOP triggers in the brief are met:

1. **Tests are failing on `main`.** `npm run gate:client-drift` exits 1 (evidence below).
2. **The assumed capability surface is materially overstated** in four load-bearing respects
   (reuse ladder, scheduling, ongoing-processes fetch, evidence sanitisation) — see The Delta.

Per the brief's gate ("Found but materially different … same STOP rule, with the delta spelled out"),
**no convergence work was performed.** Nothing outside this file was changed.

---

## Why Gonçalo could not see the work

It is in `ekoa-code` only, and `main` is pushed (`git log origin/main..main` is empty).

| Repo | Has the integrations rebuild? | Evidence |
|---|---|---|
| **`ekoa-code`** | **Yes — all of it, on `main` (= `origin/main`)** | see table below |
| `ekoa-mono` | No | no `api/src/integrations/`, no citius match |
| `ekoa-dev` | No | no `integration-achieve.ts`; only older `docs/integrations-citius.md` + one e2e spec |

A secondary reason it feels absent **inside the product**: the backend is rich but the UI is thin.
`web/app/(dashboard)/integrations/` is a **single `page.tsx`** with no per-integration detail route,
no steps view, no evidence, no runs history, no schedules — while `automations/` still has three
routes and remains the second entry in the sidebar. Almost none of the D3/E2/CS work is reachable
from the UI.

---

## Evidence table

Legend: **F** found as claimed · **P** partial · **D** materially different · **N** not found.
All commits below are ancestors of `main` (verified with `git merge-base --is-ancestor`).

### Cortex capability contract

| # | Claim | St | Commit | Evidence |
|---|---|---|---|---|
| 1 | Generated OpenAPI + drift gates in CI | **F** | `8fd8748` | `docs/openapi/cortex.v1.json` (3.1.0, 26 paths / 31 ops / 66 schemas); `api/scripts/generate-openapi.mjs`; `api/tests/contract/openapi-drift.test.ts` — **13/13 pass, re-run now**. Caveat: enforcement rides `npm test`, not the `gate:openapi` script, which **no lane invokes** (documented at `docs/api-contract.md:246`). |
| 2 | `cortex` CLI | **F** | `efb5759` | `clients/cortex-cli/`, `bin/cortex.mjs`; 4 command groups; `--help` exits 0. Private/unpublished workspace binary. |
| 3 | Generated client | **P** | `efb5759` | Exists (`src/generated/cortex-v1.d.ts`, openapi-typescript 7.13.0) **but is STALE — gate RED, and it is the one failing test in the whole 5040-test estate**. See Blocker 1. |
| 4 | CI compiles before testing | **P** | `fdf092c` | True in `.github/workflows/ci.yml` (build → typecheck → build → test). **False in the `ci:lane` script** that `docs/operations-runbook.md:56` calls "the single per-PR gate": it still runs `typecheck && test && build`, build last. The two lanes also differ in gate coverage. |

### Integrations rebuild (21 slices)

`RUN_LOG.md:806` plans "core 13 slices + Citius 8 slices"; `RUN_LOG.md:1376` records
`slice=D3 committed — the LAST slice; 21/21`. The run brief at `RUN_LOG.md:795` matches the
assumed state nearly verbatim. **The 21 slices did happen.**

| # | Claim | St | Evidence |
|---|---|---|---|
| 5 | Tenant-scoped store, private by default | **F** | literal `visibility: 'private'` under `// PRIVATE BY DEFAULT` at `definition-save.ts:107`; read predicate `isDefinitionVisibleTo` (`definition-store.ts:218`); wire enum cannot express a tenant publish (`TenantDefinitionVisibility = z.enum(['private','org'])`, `shared/src/integrations.ts:158`). |
| 6 | Credentials as Cofre items by ID, never values | **P** | Reference is real (`integration_configs.cofreItemId` ↔ `cofre_items.integrationLink`), and no value crosses the wire (`configSummary`, `service.ts:85`). **But the Cofre item is an explicit Rule-10 SHADOW**: the live read is still `config.credentialsCiphertext` (`action-executor.ts:525`). See Blocker 2. |
| 7 | Explicit `backingType` per action (API, MCP, CLI/bash, browser, Ekoa action) | **D** | **Three members, not five**: `'api-call' \| 'bash-cli' \| 'browser-steps'` at `api/src/integrations/definitions.ts:80` (not in `shared/`, which keeps `z.string()` off the wire at `:337`). **`mcp-call` is explicitly NOT modelled** (`definitions.ts:70-74`); there is **no "Ekoa action" backing** — that case is `browser-steps` + `automationBinding`. The field is **optional**, derived by `resolveBackingType` when absent. *In fairness: Phase 2.1 of the brief already scopes "MCP added as a new action type" as new work, so only the assumed-state bullet overstates it — the remedy is already planned. The missing "Ekoa action" backing is not covered either way.* |
| 8 | Write gate in the executor | **F** | `checkActionConsent` from `executeUserIntegrationAction` (`action-executor.ts:281`), refusing `code:'awaiting_consent'` at `:291`, **before any credential load**; only a literal `mutates === false` counts as a read. |
| 9 | Per-integration lessons-learned | **F** | `definition-lessons.ts`; `GET/PATCH /api/v1/integrations/:key/lessons`; prompt composition at `server.ts:430`; rule "raw to the editor, scrubbed to the prompt". |

### Public capability surface + `achieve` (D3)

| # | Claim | St | Evidence |
|---|---|---|---|
| 10 | Public list/get/execute, user-or-key | **F** | `GET /api/v1/integrations`, `GET /api/v1/integrations/:key`, `POST /api/v1/integrations/:key/actions/:actionName/execute` — all `auth:'user-or-key'`, all mounting `requireUserOrApiKey`; a contract test walks the express stack asserting declared set == key-reachable set. |
| 11 | Key never wider than its user | **F** | `GATEWAY_KEY_PREFIX` gating → `verdict.userId` → live `users.get(...)` supplying `owner.role/orgId/active`; the key doc stores no role. |
| 12 | Shared authoring core | **P** | Real, and shared by **three** callers (integration builder, automation planner, `achieve` via the `ActionDrafter` seam at `server.ts:1089`) — its own docblock still names only two. |
| 13 | `achieve` endpoint | **F** | `POST /api/v1/integrations/:key/achieve`, user-or-key; `trustAction` deliberately held at `auth:'user'` so a key cannot bless its own draft. |
| 14 | **Reuse ladder** (reuse → parametrize → compose → mint) | **D** | **Does not exist.** See Blocker 3. |

### Sharing / publishing (E1-E2)

| # | Claim | St | Evidence |
|---|---|---|---|
| 15 | Publish as frozen cross-org snapshot, versioned | **P** | Mechanism is complete and well-tested (`publishSnapshot` at `definition-store.ts:655`; `publishedViewOf` applied by `crossOrgView` to every cross-org read). **But it has NO HTTP route** — `previewPublish`/`publishDefinition`/`requestPublish`/`withdrawPublishRequest`/`listPublishRequests` have zero non-test callers. "Versioned" overstates: one live snapshot per definition, a one-deep `supersedes` stamp, no version chain, no consumer pinning. |
| 16 | Private by default; super-admin global toggle | **F** | `POST /api/v1/integrations/definitions/:id/global` → `setVisibility` (`routes/integrations.ts:274`). Note this door writes **no snapshot**; such rows are served cross-org through the read-time floor. |
| 17 | Self-extension on a global writes to the tenant copy | **F** | copy-on-author forks a fresh private tenant row. |
| 18 | **Promotion sanitises evidence** | **D** | **Does not exist as described.** See Blocker 4. |

### Citius connector (CS1-CS8)

| # | Claim | St | Evidence |
|---|---|---|---|
| 19 | Citius connector exists | **F** | Parser (CS1), mock WebForms portal (CS2), two-pass verifier (CS3), HTTP inbox connector (CS4), session seam (CS5), join module (CS6), web panel (CS7), lessons seam (CS8) — **10 test files, ~6,900 test lines**. |
| 20 | Completeness-verified notification sync | **F** | The rule is `api/src/events/verified-sync.ts:306-309`. |
| 21 | **"Ongoing processes" fetch** | **D** | **No such fetch exists.** See Blocker 5. |
| 22 | **A schedule on the sync** | **N** | **Nothing schedules it.** See Blocker 6. |

### Target-state features Phase 2 assumes are converging

| Feature | St | Evidence |
|---|---|---|
| Schedule entity (recurring run + fixed params) | **N** | No `Schedule` type, no cron, no `nextRunAt`, no route/store/UI anywhere in `shared/`, `api/src`, `web/`. |
| Per-step feedback on an **action** | **P** | Feedback exists on automation **run** steps (`POST /api/v1/automations/runs/:id/steps/:stepId/feedback`, owner-guarded), not on an action's steps; and it is consumed only indirectly (cache eviction + a `user-correction` memory that nothing reads back by tag). |
| Integrations UI: steps read-only | **N** | Not rendered. The only "steps" string is a link label navigating **away** to `/automations/{id}`. |
| Integrations UI: evidence per backing type | **N** | **No evidence artefact exists anywhere in the data model** — no sample-response, output, or screenshot field on any definition. |
| Integrations UI: last run / schedules / runs history | **N** | Per-card status is connection state only. |
| Automations hidden | **N** | `/automations` is a full list + editor + run-history surface and is the **second sidebar entry**. |

### The two "open" write-gate findings — **already FIXED**

Both were closed on **2026-08-04**, ahead of the assumed state (`docs/findings.md:3657`):
`consent-target-shows-an-uninterpolated-template-and-config-can-redirect-it` is **FIXED**, by keying
an approval on `(org, user, integration, action, shape, **destination**)` where the destination is the
**resolved** target, resolved from `publicConfigValues` so the gate still answers before any credential
is decrypted. Suite: `api/tests/security/consent-destination-binding.test.ts` (7 cases,
reverted-and-verified). Re-validated live: the dialog shows `VAI EXECUTAR POST https://ntfy.sh/<real topic>`,
and moving the topic returns 403 with a re-prompt naming the new destination.

**Phase 2 item 8 is therefore already done.** It needs a regression check, not a rebuild.

---

## Full suite, executed on this branch (`npm test`, 2026-08-17)

| Workspace | Result |
|---|---|
| `api` | **4484 passed**, 2 skipped (4486) — 1045s |
| `web` | **461 passed** (57 files) |
| `@ekoa/cortex-cli` | **94 passed, 1 FAILED** (95) |
| **Total** | **5039 passing, 1 failing** |

The estate has grown well past the claimed ~4,425 (the 2026-08-03 end-of-run figure was 4421).
**Exactly one test fails**, and it is the drift test in Blocker 1:
`tests/drift.test.ts > regenerates byte-identically (a spec change that skipped the client fails here)`.
`npm test` exits 1 in the `@ekoa/cortex-cli` workspace.

> Note for anyone re-running this: piping `npm test` into `tail` reports the *pipe's* exit code, so
> the run looks like `exited with code 0` while npm actually exited 1 — the same "green because it
> was not looking" class `RUN_LOG.md:1390` records. Capture the exit code directly.

## The delta — six blockers a new plan must absorb

**1. `main` is RED. The generated client is stale.** Executed directly:
```
$ npm run gate:client-drift
CLIENT DRIFT: the committed generated client no longer matches docs/openapi/cortex.v1.json.
  drifted: cortex-v1.d.ts
```
Cause: `922749c` (2026-08-11) added `KnowledgeScope` to the spec without regenerating; the generated
dir was last touched by `0778b18` (2026-08-06). Committed spec has 4 `KnowledgeScope` hits, committed
client has 0. **The gate has been red for six days**, and it fails `npm test` in the `@ekoa/cortex-cli`
workspace, so CI's `npm test` step is red on `main` as it stands. One-line fix, but it must land first.

**2. A Rule-10 cutover date has silently expired.** `docs/decisions.md:154` fixes the Cofre
cutover-or-remove date at **2026-08-15**. Today is **2026-08-17**: neither the cutover nor the
removal has landed, and the shadow is still parallel. CLAUDE.md Rule 10 says "no permanent parallel
implementations, no flags that become furniture" — this is now one.

**3. There is no reuse ladder, and `achieve` cannot do the canonical test.** What exists is a
**two-rung lexical fork** — reuse-as-is, or mint new. No parametrize rung, no compose rung, and the
planner is **not a model**: `matchActionForGoal` tokenises the goal and requires the goal to name
*every* token of the action's name (`nameTokens.every((t) => goalSet.has(t))`); ties refuse as
`ambiguous_goal`. Critically, **`achieve` extracts no arguments from the natural language** — `args`
comes from `body.args ?? {}` (`routes/integrations.ts:435`), so the goal string is used *only* for
selection. The design is deliberate and the reasoning is sound (module comment: *"the thing being
picked may be a WRITE… 'the model thought you meant `delete_invoice`' is not a sentence this product
should be able to say"*).
Consequence: **the brief's canonical test — "all processes belonging to clients under 40" resolving
as an existing action plus a post-filter/join — cannot pass today, and is not a tuning job.** It
needs the parametrize and compose rungs built, including NL argument extraction, against a planner
deliberately built to be lexical. That is a design decision for you, not a convergence step.

**4. Evidence sanitisation cannot be added to promotion, because evidence does not exist.**
`publish-scrub.ts` is a thorough **credential/secret** scrubber (deterministic floor + blanket
literal-secret scan + one span-removal model pass over `skillMd`/`lessons`/`description`/
`credentialGuide`). But there is **no sample-response, output, or screenshot field on the definition
document at all**, so there is nothing to strip. Phase 2 item 7's sanitisation rule presupposes
Phase 2 item 2's evidence model. They are one build, not two, and the order is fixed.
Worth flagging: platform-authored provenance (`authoring.authoredBy` user id, `authoring.goal` free
text, `verification.checks[].detail`) **does** ride into the published snapshot today.

**5. There is no "ongoing processes" fetch.** The nearest identifiers are two *declarative* actions,
`consultar_processo` and `fetch_documentos_processo` (`api/assets/integrations/citius/automations/*.json`),
both **singular lookups requiring `numeroProcesso`**, both natural-language browser-step templates
with **zero TypeScript implementation**. SKILL.md admits they resolve to `unknown_automation` until a
real session provisions them, and the provisioner it names (`provisionCitiusAutomations` in
`citius-connect.ts`) **does not exist in this repo**. "processos em curso" appears nowhere.
Phase 3.1 requires this action working. It must be built.

**6. There is no scheduling, so the Citius reference case cannot be demonstrated.**
`syncCitiusNotifications` has exactly **one** call site: `POST /api/v1/sync/citius/notificacoes`
(`routes/sync.ts:116`), gated on `CITIUS_SYNC_ENABLED === 'true'` (default OFF → 404), triggered
only by a manual button. A generic `ListenerSupervisor` exists and the citius package declares
`listenerConfig.intervalMs: 900000` — but `user-defined-poll.ts` **never reads `intervalMs`** (the
15-minute figure is inert), that path would call the *automation* action `consultar_notificacoes`
which shares nothing with `runVerifiedSync` (no watermark, no two-pass proof), and nothing in the
repo creates a citius listener trigger. `insolvencia-watch.ts:1-25` says it outright: the listener
*"has NO runtime anywhere in the codebase — the missing piece is a small poll scheduler."*
Phase 3.1's "scheduled notifications fetch every 5 minutes" is a **net-new build**, not a config.

---

## Two gates the original run recorded as NOT RUN

Carried forward honestly from `RUN_LOG.md:1396`, still open:

- **D3 never received its fresh-context adversarial review.** Its implementing session was stopped
  before the gate phase. What was done instead was orchestrator self-verification — explicitly *not*
  a decorrelated reader.
- **`web/e2e/integration-achieve.spec.ts` was registered and parses, but was never executed.**
  Running it needs the full stack booted with a real UI login.

`gate:ledger` also exits 1, but that is the known pre-existing invocation-mode failure
("136 artifact(s) are due at G12 but `--run` was not passed"); its census half passes and balances.

---

## What was and was not done

- **Done:** full-repo verification across all branches, tags and stashes; per-artifact evidence;
  gates executed directly rather than read.
- **Not done, deliberately:** every item of Phase 1, 2 and 3. The gate said stop; nothing was built,
  no `evidence/` folder was produced, and no code outside this file was touched.
- Uncommitted WIP that pre-existed this session (`chat/page.tsx`, `empty-state.tsx`, `locales/*`)
  was carried onto the branch untouched and not committed.

## Recommended order for the new plan

1. **Unblock CI** — regenerate the client (`npm run generate --workspace @ekoa/cortex-cli`). Red main
   invalidates every downstream "verified" claim.
2. **Resolve the expired Rule-10 Cofre cutover** — cut over or remove; either way, re-date the decision.
3. **Decide the `achieve` question** — the lexical planner is a deliberate safety property. Adding
   parametrize/compose rungs means deciding how much model judgement is allowed to select and
   parameterise a *write*. This is the largest open design question in the brief and it is yours.
4. **Build the evidence model first, sanitisation second** — item 7 depends on item 2.
5. **Build scheduling and the ongoing-processes action** — both are net-new; Phase 3 cannot run without them.
6. **Then** the UI convergence (hide Automations, integration detail page, read-only steps, feedback),
   which is the part that most closely matches the brief's description of the remaining work.
