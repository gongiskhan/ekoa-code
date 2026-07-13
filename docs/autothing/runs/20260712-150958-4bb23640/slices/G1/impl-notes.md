# G1 — Assistant metering + billing-truth probe extension (tours/registry provably free)

Kind: api · Size: 3 · Dep: D1 (passed) · Branch: `operator-run`
Status: **LIVE GATE PENDING RESUME** (paused by the lead mid-run for an unrelated scaffold-edit collision; see §6). Proof slice — **no production code change**.

## 1. What G1 proves (acceptance)

D1 already meters the served-app assistant: `POST /api/app-assistant` runs one model call through the llm/ chokepoint one-shot, metered + attributed to the RESOLVED ARTIFACT OWNER (`agentType: 'assistant-chat'`, a UserWorkAgentType), never the anonymous visitor. G1 does **not** re-implement any of that — it PROVES it live and extends the journeys' billing-truth reconciliation (actions-log vs `GET /api/v1/billing/history`) to the assistant plane, with four claims:

1. **Metered + attributed to the owner, not the caller.** N=2 real assistant turns -> exactly TWO new `assistant-chat` rows in the OWNER's ledger with metered tokens > 0, while the driving VISITOR's ledger gains ZERO.
2. **Breakdown.** `GET /api/v1/billing/breakdown` (super-admin, grouped by `agentType`) now carries an `assistant-chat` line with tokens > 0.
3. **Tour playback is free.** A full overview tour played through the E2 teach launcher fires ZERO `POST /api/app-assistant` and adds ZERO new billing rows.
4. **Registry-only actions are free.** A registry action dispatched through `window.__ekoaActions.execute` runs entirely in-page — ZERO model POSTs, ZERO new billing rows.

Deliverable driver: `api/tests/e2e/assistant-billing.e2e.mjs` (committed, re-runnable; modeled on the D3 driver `assistant-modes.e2e.mjs` + the E2 driver `tour-playback.e2e.mjs`).

## 2. Ground truth (verified by reading the code, before writing the probe)

- **agentType string** = `assistant-chat`. `api/src/apps/app-assistant.ts:280-285` builds the attribution `{ kind:'user_work', agentType:'assistant-chat', billeeUserId: input.owner.userId, artifactId: input.artifactId }` and passes it to the injected `deps.oneShot` (`:287`). This is the ONLY model egress in the turn — `deps.ground` (grounding) and `deps.decide` (`decideForTask(..., 'WORKHORSE')`) are both SYNCHRONOUS/pure (no model call, no billing). So **one turn -> exactly one metered row**; there is no memory-extract or secondary metered call on this path (unlike hosted chat).
- **Owner is server-resolved, caller is never read.** `api/src/apps/app-assistant-route.ts` is HEADER-SCOPED (`POST /api/app-assistant`, no `requireAuth`). The owner comes from `X-Ekoa-App-Id -> resolveApp -> ownerUserId` (`:70-111`); billing is billed to `admission.owner.userId` (the allowance gate `:124` and the metering attribution). The endpoint NEVER reads the caller's JWT — so "billed to owner, not the visitor" holds by construction. G1 makes it observable by driving the panel as a DISTINCT visitor.
- **Ledger surfaces.** `token_events` rows carry `agentType` (`api/src/billing/tracker.ts:47,194`) and are single-writer (only the chokepoint records). `GET /api/v1/billing/history` is actor-scoped (`api/src/routes/billing.ts:38-42` -> `historyFor(actorOf(req).userId)`; `service.ts:77-93` exposes each row's `agentType` as `type` and `metered` as `tokens`). `GET /api/v1/billing/breakdown` is super-admin, platform-wide, grouped by `agentType` (`billing.ts:60-62`; `service.ts:99-112`).
- **Admin is a super-admin** (`api/src/auth/service.ts:57-72` seeds role `super-admin`) — so `/breakdown` is readable with the admin token.
- **Serving is public** (`api/src/apps/serving.ts:435` "ALL public") and **new users are active** (`api/src/auth/users-service.ts:39` `setActivation(id,{active:true,...})`) — so a distinct visitor can drive the served app, and the owner-activation admission gate passes.

**No attribution gap found.** The metering + attribution path is correct and complete in static review; per the slice contract this is a proof slice with NO production code change and NO contract test needed. `api/src/billing/**` was reserved contingently and left untouched.

## 3. Probe design + rationale

- **Owner = admin** (builds the app, so `artifact.userId = admin`). This follows the proven D3/E2 build pattern (guaranteed-activated owner) and keeps the metered assertion clean: at baseline admin has **0** `assistant-chat` rows (verified — see §5), so a delta of exactly 2 is unambiguous. The metered assertion filters on `type === 'assistant-chat'` specifically (admin's ledger already holds ~92 rows of other agentTypes from builds), so it is immune to concurrent non-assistant billing.
- **Caller = a distinct visitor.** The browser context is authenticated as a separate, non-owner builder user (`g1-visitor`). Because the endpoint ignores the caller identity, this makes billing-truth OBSERVABLE on two separate ledgers: owner +2, visitor +0. Provisioning is idempotent (`tryLogin` first; create org+user only if absent) so re-runs on the same boot never duplicate.
- **Ordering: registry -> tour -> metered.** The two zero-cost (LLM-free) claims run FIRST, so the N=2 assistant budget is only spent once the panel is proven healthy. A broken panel/tour therefore fails BEFORE any real turn is burned (which is exactly what happened in the first run — §6).
- **Determinism.** Every assertion is STRUCTURAL: ledger row counts by agentType + billee, the browser-side `POST /api/app-assistant` request counter (client-side proof that playback/registry issue no model call), and the C3 runtime's own result status / DOM effect. The served tour is the same schema-valid `e2-overview-tour.json` fixture E2 uses, fulfilled at the browser boundary (`page.route`) — the only stub QA permits. The two metered turns are plain informational PT-PT prompts (no operate surface needed; metering fires on the one-shot regardless of whether the turn proposes actions).
- **Budget cap.** A hard `LLM_BUDGET = 3` ceiling: 2 turns + at most one transient non-200 retry. `fireTurn` refuses to exceed it.
- **Console gate** copied VERBATIM from the D2/D3/E2 drivers: favicon 404 + anonymous whoami 401 (`/api/app-sso/me`) + dev-proxy app-health 5xx. The lead's "two documented allowlists" are the two app-specific platform behaviours (whoami 401 + app-health 5xx); the favicon 404 is the universal served-app 404 already allowlisted by every sibling driver, so it is included to match the proven, passing allowlist ("copy from the D2 driver").
- **Driver hardening (added while paused):** `openPanel` now, on a launcher-mount timeout, dumps a page diagnostic (ekoa globals present? runtime installed? which `ekoa-assistant` elements exist? script srcs) and fails with an actionable message — so a rerun reader can tell an ABSENT/BROKEN panel bundle (e.g. a scaffold snapshotted mid-edit) from a genuine launcher regression, without re-driving.

## 4. Commands run + results

| Step | Command | Result |
|---|---|---|
| Stack liveness | `curl POST /api/v1/auth/login {admin}` | HTTP 200 (stack up: api :4211, proxy :4111, web :3000) |
| Syntax | `node --check api/tests/e2e/assistant-billing.e2e.mjs` | OK (before + after hardening) |
| Tooling | `command -v asciinema`; `import('playwright')` | both available |
| Non-LLM plumbing smoke (scratchpad `g1-smoke.mjs`) | admin login / visitor provision / ledger reads / breakdown | all green (see §5) |
| **Live probe (asciinema)** | `node tests/e2e/assistant-billing.e2e.mjs` | **FAILED at openPanel** (external cause — §6) |

## 5. Static smoke test (non-LLM plumbing) — all green

Ran a scratchpad script against the live stack to de-risk every HTTP shape BEFORE spending a build/turn:

- admin login 200; admin is super-admin (`/billing/breakdown` -> 200).
- visitor provisioning: `POST /orgs` 201, `POST /users` 201 (role builder, `active:true`), visitor login 200; `GET /auth/me` returns `{id,...}`.
- visitor `GET /billing/history` -> 200, 0 items, 0 `assistant-chat`.
- admin `GET /billing/history` -> 200, 92 items, **0 `assistant-chat`** (other agentTypes present: `memory-extract`, `pi-fast-loop`, `build`, `classify-in-build-intent`). Row shape: `{id,type,amountUsd,createdAt,description,tokens}`.
- admin `GET /billing/breakdown` -> 200, 4 agentTypes, no `assistant-chat` yet.

=> confirms the metered assertion is unambiguous (admin baseline `assistant-chat` = 0; expect exactly 2 after the run) and the visitor-ledger-unchanged assertion is meaningful.

## 6. First live run — FAILED at panel-open (external, paused by lead). Token budget intact.

`live-output.txt` / `evidence-live.cast` (both in this dir):

```
PASS admin login (artifact owner + super-admin for breakdown)
PASS distinct visitor provisioned + logged in (userId=14fb2aca-...) — drives the panel, must never be billed
PASS fresh app-base app built by admin (owner=admin, artifact=3a4be859-5426-4d70-8f22-c5f3363fcd39)
PASS tour serving route live (GET /api/demos/:appId -> 404)
E2E FAIL: locator.waitFor: Timeout 30000ms exceeded.
  - waiting for locator('.ekoa-assistant-launcher') to be visible
    at openPanel (assistant-billing.e2e.mjs)
```

**Cause (per lead, not my bug):** the E2 worker was concurrently rewriting the scaffold panel files (`AssistantPanel.jsx` / `tour-player.js`) for a review-fix batch. A fresh app build snapshots the scaffold at build time, so artifact `3a4be859` baked in a mid-edit, transiently broken panel — the launcher never mounted. The lead paused the live probe and will send RESUME LIVE once E2's fix batch is complete and statically green.

**Token budget honesty:**
- **Assistant (LLM) turns burned: 0.** The probe fires the N=2 metered turns LAST (after the registry action + full tour); it died at `openPanel`, before any turn. `grep "turn ... fired" live-output.txt` = 0.
- **Build cycles spent: 1** (artifact `3a4be859`, billed to admin as `build`/related agentTypes — NOT part of the N=2 assistant budget). This artifact is considered POISONED (mid-edit scaffold) and will be discarded; RESUME will build a FRESH artifact.

## 7. On RESUME LIVE (remaining work)

1. Build a FRESH app (new artifactId — do NOT reuse `3a4be859`).
2. Run `node api/tests/e2e/assistant-billing.e2e.mjs` under asciinema (overwrites `evidence-live.cast` + `live-output.txt`).
3. Green = the four PASS blocks (metered owner +2 / visitor +0, breakdown, tour-free, registry-free) + the console gate + final line `G1 LIVE GATE: PASS`.
4. Update this file's §4/§6 with the green output and flip the status to PASS.

## 8. Suite-ledger note (flagged, NOT edited — outside reserved paths)

`scripts/suite-ledger-run.mjs` censuses every `api/tests/e2e/*.e2e.mjs` on disk against `SUITE_LEDGER.json` `node_drivers.drivers` (a count-match in both directions). Disk now has **19** `.e2e.mjs` (my new driver makes it the 20th on RESUME... it is already present -> 19 total counting it), but the ledger lists **14**. The four sibling operator-run drivers (`action-registry`/C5, `assistant-panel`/D2, `assistant-modes`/D3, `tour-playback`/E2) are ALSO unregistered — i.e. the operator-run drivers are reconciled into the ledger in a BATCH (by the lead at gate time), not self-registered per slice, and this census is already red on the branch independently of G1.

Per the constraint "do not edit anything outside reserved paths; flag the reason first", I did **not** touch `SUITE_LEDGER.json`. When the lead reconciles the ledger, my entry (matching the minimal `{name,targetGate,note?}` schema) is:

```json
{ "name": "assistant-billing", "targetGate": "G1", "note": "operator-run G1: assistant metering + billing-truth live probe (owner-billed, visitor-free, tour+registry zero-token)" }
```

(and the 4 sibling operator-run drivers need entries too, for the census to go green).

## 9. Constraints honored

- No security/auth/permission logic touched (H block).
- Egress chokepoint untouched.
- No production code change (proof slice; no attribution gap found).
- No diagram change — this is a proof slice; it alters no structure, flow, or data shape (the diagram invariant does not apply). Stated explicitly per the delegation.
- PT-PT: the two turn prompts are PT-PT; no new user-facing strings.
- Reserved paths only: created `api/tests/e2e/assistant-billing.e2e.mjs`; wrote `slices/G1/**`; left `api/src/billing/**` untouched (no gap). Did not commit (lead runs the gates).
- Real-token discipline: 0 assistant turns on the failed run; budget cap `LLM_BUDGET=3` enforced in the driver.
