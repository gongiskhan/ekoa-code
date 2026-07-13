# G1 — Fresh-context adversarial review verdict

**Commit:** `20b1c70` (feat(operator-run/g1): billing-truth probe for the assistant plane)
**Reviewer:** fresh-context, no prior stake. Static review + claim verification against source. Live driver NOT run (real-token cost).
**Scope reviewed:** the full committed driver `api/tests/e2e/assistant-billing.e2e.mjs`, the cited ground-truth source, the evidence (`live-output.txt`, `evidence-live.cast`, 3 screenshots), and the diff scope.

## VERDICT: APPROVE

The deliverable proves G1's acceptance honestly. Every ground-truth claim in `impl-notes.md §2` is correct against source; the probe cannot pass while the acceptance property fails; the diff touches only tests + run docs; no production, security, or chokepoint code changed. Three Low findings below — none blocks the gate.

---

## What I verified (evidence-cited)

### 1. Ground-truth claims (impl-notes §2) — all CORRECT
- **Attribution to the owner, not the caller.** `api/src/apps/app-assistant.ts:280-285` builds `{ kind:'user_work', agentType:'assistant-chat', billeeUserId: input.owner.userId, artifactId: input.artifactId }` and passes it to the injected one-shot at `:287`. `deps.oneShot` is the ONLY model egress in `runAppAssistant` — `deps.ground` (`:267`) and `deps.decide` (`:276`) are pure/synchronous. So one turn → exactly one metered row. Correct.
- **Header-scoped, caller JWT never read.** `api/src/apps/app-assistant-route.ts` mounts `POST /app-assistant` with no `requireAuth` (`:126`); the owner is server-resolved from `X-Ekoa-App-Id → resolveApp → ownerUserId` (`:71-111`); billing/allowance is keyed to `ekoaAssistant.owner.userId` (`:124`). The handler reads only `req.ekoaAssistant` (server-resolved) + `req.body`; the caller's `Authorization` is never consulted for identity. "Billed to owner, not the visitor" holds by construction. Correct.
- **Ledger surfaces.** `token_events` carries `agentType`/`metered` and is single-writer via `recordTokenEvent` (`api/src/billing/tracker.ts:44-56,190-204`). `GET /billing/history` is actor-scoped → `historyFor(actorOf(req).userId)` (`api/src/routes/billing.ts:38-42`); `service.ts:77-93` exposes each row's `agentType` as `type` and `metered` as `tokens`. `GET /billing/breakdown` is `superAdmin`-gated, platform-wide, grouped by `agentType` (`billing.ts:60-62`; `service.ts:99-112`). Correct.
- Admin-is-super-admin and serving-is-public are empirically confirmed by the live run (breakdown returned 200; a featured app served 200 to the distinct visitor).

**No attribution gap. The "no production change" claim is justified** — `git show 20b1c70 --name-only` touches only `api/tests/e2e/assistant-billing.e2e.mjs` + `slices/G1/**`. `api/src/**`, `shared/**`, `web/**`, and `api/src/llm/**` are untouched. Chokepoint and security/permission logic untouched.

### 2. Assertion honesty (the crux) — the probe CANNOT pass while the property fails
- **(a) Metered = EXACTLY 2, agentType-filtered.** `assistant-billing.e2e.mjs:466` asserts `ownerAfter - ownerBefore === TURNS.length` (=2), where both counts filter `type === 'assistant-chat'` (`:182-183`). Not `>=1`. The two new rows are re-checked for `type==='assistant-chat'` and `tokens>0` (`:469-473`), taken as the two newest (history is `timestamp:-1`, `service.ts:78`).
- **(b) Visitor-unchanged reads the visitor's own ledger AFTER the turns.** `:456`/`:465` read `assistantChatCount(visitor.token)` (actor-scoped to the visitor) before and after the two turns; `:467` asserts delta `=== 0`. A "billed to caller" bug fails BOTH the owner (+0) and visitor (+2) assertions; double-billing fails the visitor assertion; a third-party billee fails the owner assertion. No false-pass path.
- **(c) Tours-free / registry-free count BOTH surfaces.** Registry: `:391` client POST delta `=== 0` AND `:393` owner-row delta `=== 0`. Tour: `:442` client POST delta `=== 0` AND `:444` owner-row delta `=== 0`. Both the browser-side `POST /api/app-assistant` counter and the server ledger are checked.
- **(d) Deltas are baselined at the right time and fail safe.** Every zero-cost baseline is taken immediately before its action (`:379-380`, `:401-402`); the metered baseline (`:455`) is after the (zero-adding) tour+registry. A stray row landing in any window makes a zero-delta non-zero (FAIL) or the exact-2 an over-count (FAIL) — it can only false-FAIL, never false-PASS.
- **(e) POST matcher is broad enough and self-consistent.** The counter (`:335`) and `fireTurn`'s `waitForResponse` (`:223`) both match `url().includes('/api/app-assistant')` — the real endpoint. If a turn hit a different path, `fireTurn` would time out (loud fail), never silently under-count. `:478` ties `assistantPosts - postsBeforeTour === llmTurns`, binding browser POSTs to fired turns.

### 3. Flake resistance — SOLID (the async-write race is closed by construction)
The checklist's main worry (ledger read too early) does not apply: the ledger write is fully awaited before the HTTP 200. `runOneShot` awaits `meter(...)` (`api/src/llm/client.ts:896`) → `recordTokenEvent` → `await tokenEvents.insert(...)` (`tracker.ts:190`) AND the CAS meter fold (`tracker.ts:210`) before returning; `runAppAssistant` awaits `deps.oneShot` (`app-assistant.ts:287`); the route awaits `runAppAssistant` before `res.json` (`app-assistant-route.ts:141-159`). So by the time the browser's `waitForResponse` resolves 200, the row is committed. Only the fire-and-forget `usageNotifier` (`tracker.ts:234-239`) is un-awaited, and it writes no ledger row. **Budget cap is real:** `fireTurn` hard-checks `llmTurns >= LLM_BUDGET` (`:220`) with `LLM_BUDGET=3` (2 turns + 1 retry). The "a retried transient failure writes no row" claim (`:476-478`) holds: a non-abort transport error / rate-cap in `runOneShot` throws BEFORE `meter` (`client.ts:866,896`), and admission/validation non-200s occur before `runAppAssistant` runs — no row. (The one path that would write a row on a non-200, abort-after-meter at `client.ts:896→899`, is not exercised by the driver and would over-count → FAIL, not false-pass.)

### 4. Stub discipline / console gate — clean
- The served tour is the committed `api/tests/e2e/fixtures/e2-overview-tour.json`, fulfilled at `page.route('**/api/demos/**')` (`:339`). That exact fixture is schema-validated against `demoSpecSchema` via `validateDemoSpec` in `api/tests/apps/tour-player.test.ts:189-194`. Acceptable per QA (schema-validated stub).
- `benign()` (`:197-211`) is verbatim identical to the D3 (`assistant-modes.e2e.mjs:166-179`) and E2 (`tour-playback.e2e.mjs:154-167`) drivers: favicon 404, `/api/app-sso/me` 401, `/api/app-health` 5xx only. Not broadened.

### 5. Isolation / cleanup — adequate
Visitor provisioning is idempotent (`tryLogin` first, `:120-121`). Featuring is reverted on both the success tail (`:499-503`) and the failure catch (`:512-514`), so a failed run never leaves the app publicly featured.

### 6. Evidence corroborates the PASS lines
`live-output.txt` shows 14 PASS + `G1 LIVE GATE: PASS`. The screenshots are authentic and consistent: `live-02-tour-done.png` shows "Tutorial concluído", the injected prompt in the composer, the planted `REGISTO-LOCAL-G1` field, and a spotlight ring; `live-03-metered-turns.png` shows a real teach-mode reply with a "Fontes" citations block.

---

## Findings

**F1 (Low, process/CI) — the committed driver is unregistered in the suite ledger.**
`api/tests/SUITE_LEDGER.json` lists 14 `node_drivers`; disk has 19 `*.e2e.mjs`. `assistant-billing` is absent — as are the sibling operator-run drivers (`tour-playback` confirmed absent). This makes the `scripts/suite-ledger-run.mjs` census red on `operator-run` independently of G1. Correctly flagged and NOT self-fixed in `impl-notes.md §8` (editing the ledger is outside G1's reserved paths). Action: the lead's batch ledger reconcile must include the entry from §8 before/at gate close, else a census CI step fails.

**F2 (Low, flake vector on a shared stack) — exact-count assertions false-FAIL under concurrent admin billing.**
`:466` (`=== 2`) and the zero-delta assertions assume no other actor bills an `assistant-chat` turn to admin during the window. On the shared dev stack, a concurrent driver firing an admin-billed assistant turn would over-count → FAIL. This is fail-safe (never a false pass) and the impl-notes treat isolation as a manual-run assumption, but it is a genuine re-run fragility if drivers are ever run in parallel. No change required for a serialized gate run.

**F3 (Low, residue) — build + settings side effects are not torn down.**
`buildSampleApp` (`:138-155`) creates a fresh artifact every run (never deleted; only un-featured) and PATCHes admin `settings.build.verifyBuilds=false` persistently (`:140`). Both accumulate on the ephemeral dev Mongo. Consistent with the C5/D2/D3/E2 siblings and harmless to re-runs (the metered assertion is delta-based + agentType-filtered, so stale artifacts do not perturb it). Informational.

---

## Conclusion
APPROVE. G1 is a legitimate proof slice: it verifies D1's metering/attribution live on two separate ledgers, extends billing-truth to the assistant plane, and proves tour + registry playback free — with structural, fail-safe assertions that cannot pass while the property fails, over a race-free ledger read, with verbatim console discipline and a schema-validated stub. No production/security/chokepoint code changed. The three Low findings are process/isolation notes, not correctness defects.
